import "server-only";

import { fal } from "@fal-ai/client";

import {
  buildFallbackLayoutPlan,
  coalesceRelatedPieces,
  splitRoomDescriptionIntoPieces,
  type StagingLayout,
  type StagingRoomAnalysis,
  type LayoutViewAssignment,
} from "@/lib/staging/layout-shared";
import type { ViewStrategyId } from "@/lib/staging/view-strategies";

const LLM_ENDPOINT = "fal-ai/any-llm";
const LLM_MODEL = "google/gemini-2.5-flash-lite";

function configureFal(): boolean {
  const key = process.env.FAL_KEY?.trim();
  if (!key) return false;
  fal.config({ credentials: key });
  return true;
}

/**
 * Assign every furniture piece from the frozen room description to exactly one view.
 * Does not invent new pieces — only allocates the given description.
 */
export async function generateLayoutPlan(options: {
  strategy: ViewStrategyId;
  roomDescription: string;
  analysis: StagingRoomAnalysis;
}): Promise<StagingLayout> {
  const fallback = buildFallbackLayoutPlan(options);
  const pieces = splitRoomDescriptionIntoPieces(options.roomDescription);
  if (pieces.length === 0) return fallback;
  if (!configureFal()) return fallback;

  try {
    const result = await fal.subscribe(LLM_ENDPOINT, {
      input: {
        model: LLM_MODEL,
        // fal-ai/any-llm accepts temperature; seed is NOT supported.
        temperature: 0,
        prompt: `You assign virtual-staging furniture to camera views of a vacant room.
Frozen furniture list (use these pieces ONLY — you may lightly rephrase for placement but do not invent new items):
${pieces.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Room analysis JSON:
${JSON.stringify(options.analysis.views, null, 2)}

Return ONLY valid JSON:
{"views":[{"index":0,"pieces":["…"]}]}

Rules:
- Prefer concentrating a room's PRIMARY furniture grouping into ONE view (the best large-capacity wall). Single-view concentration is the correct default.
- Split across views ONLY when the room has separate functional zones (e.g. bedroom + seating nook, living + dining).
- When splitting, pieces that belong to one grouping stay together. If a piece's text references another piece (e.g. "canvas above the sofa"), assign it to the SAME view as that piece.
- Every listed piece appears in EXACTLY ONE view's pieces array.
- Do not invent pieces that are not in the list.
- Never assign furniture to a view with capacity "clear".
- Do not place a sofa/bed/large seating blocking a doorway, opening, or primary window walkway.
- Floor-centre items (rugs, coffee tables) go in the SAME view as the primary seating they belong with.
- A view may have an empty pieces array — that is correct for clear walls or unused directions.
- Include every view index from the analysis (${options.analysis.views.map((v) => v.index).join(", ")}).`,
        system_prompt: "Return only JSON. No markdown fences.",
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as {
      views?: Array<{ index?: unknown; pieces?: unknown }>;
    };
    if (!Array.isArray(parsed.views)) return fallback;

    const viewCount = options.analysis.views.length;
    const assignments: LayoutViewAssignment[] = Array.from(
      { length: viewCount },
      (_, i) => ({ index: i, pieces: [] as string[] }),
    );

    const used = new Set<string>();
    for (const row of parsed.views) {
      const index =
        typeof row.index === "number"
          ? row.index
          : Number.parseInt(String(row.index), 10);
      if (!Number.isFinite(index) || index < 0 || index >= viewCount) continue;
      const capacity = options.analysis.views[index]?.capacity;
      const list = Array.isArray(row.pieces)
        ? row.pieces.filter((p): p is string => typeof p === "string")
        : [];
      for (const piece of list) {
        const trimmed = piece.trim();
        if (!trimmed || used.has(trimmed.toLowerCase())) continue;
        if (capacity === "clear") continue;
        assignments[index]!.pieces.push(trimmed.slice(0, 240));
        used.add(trimmed.toLowerCase());
      }
    }

    // Ensure every original piece is placed somewhere (fuzzy: substring match).
    for (const piece of pieces) {
      const key = piece.toLowerCase();
      const already = [...used].some(
        (u) => u.includes(key.slice(0, 24)) || key.includes(u.slice(0, 24)),
      );
      if (already) continue;
      const host =
        assignments.find(
          (_, i) => options.analysis.views[i]?.capacity === "large",
        ) ??
        assignments.find(
          (_, i) => options.analysis.views[i]?.capacity !== "clear",
        ) ??
        assignments[0];
      if (host) {
        host.pieces.push(piece);
        used.add(key);
      }
    }

    return coalesceRelatedPieces({
      strategy: options.strategy,
      views: assignments,
      source_room_description: options.roomDescription,
      planned_at: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[layout-plan] generate failed, using fallback", err);
    return fallback;
  }
}
