import "server-only";

import { fal } from "@fal-ai/client";

import {
  assertPieceConservation,
  buildFallbackLayoutPlan,
  coalesceRelatedPieces,
  formatPieceConservationLog,
  LayoutPieceConservationError,
  matchCanonicalPiece,
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
 * Canonical piece strings are the contract — the layout stores those exact strings only.
 */
export async function generateLayoutPlan(options: {
  strategy: ViewStrategyId;
  roomDescription: string;
  analysis: StagingRoomAnalysis;
}): Promise<StagingLayout> {
  const canonical = splitRoomDescriptionIntoPieces(options.roomDescription);
  const fallback = buildFallbackLayoutPlan(options);

  if (canonical.length === 0) return fallback;
  if (!configureFal()) {
    console.info(
      "[layout-plan] conservation check (fallback, no FAL_KEY):\n" +
        formatPieceConservationLog(canonical, fallback),
    );
    return fallback;
  }

  try {
    const result = await fal.subscribe(LLM_ENDPOINT, {
      input: {
        model: LLM_MODEL,
        // fal-ai/any-llm accepts temperature; seed is NOT supported.
        temperature: 0,
        prompt: `You assign virtual-staging furniture to camera views of a vacant room.
Canonical furniture list (assign by 0-based piece_indices ONLY — do not rewrite the text):
${canonical.map((p, i) => `${i}. ${p}`).join("\n")}

Room analysis JSON:
${JSON.stringify(options.analysis.views, null, 2)}

Return ONLY valid JSON:
{"views":[{"index":0,"piece_indices":[0,1,2]}]}

Rules:
- Prefer concentrating a room's PRIMARY furniture grouping into ONE view (the best large-capacity wall). Single-view concentration is the correct default.
- Split across views ONLY when the room has separate functional zones (e.g. bedroom + seating nook, living + dining).
- When splitting, pieces that belong to one grouping stay together. If a piece references another (e.g. canvas above the sofa), assign both to the SAME view.
- Every piece index from 0..${canonical.length - 1} appears in EXACTLY ONE view's piece_indices array.
- Never assign furniture to a view with capacity "clear".
- Do not place a sofa/bed/large seating blocking a doorway, opening, or primary window walkway.
- Floor-centre items (rugs, coffee tables) go in the SAME view as the primary seating they belong with.
- A view may have an empty piece_indices array — that is correct for clear walls or unused directions.
- Include every view index from the analysis (${options.analysis.views.map((v) => v.index).join(", ")}).`,
        system_prompt: "Return only JSON. No markdown fences.",
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.warn("[layout-plan] LLM returned no JSON — using fallback");
      console.info(
        "[layout-plan] conservation check (fallback):\n" +
          formatPieceConservationLog(canonical, fallback),
      );
      return fallback;
    }
    const parsed = JSON.parse(jsonMatch[0]) as {
      views?: Array<{
        index?: unknown;
        piece_indices?: unknown;
        pieces?: unknown;
      }>;
    };
    if (!Array.isArray(parsed.views)) {
      console.warn("[layout-plan] LLM JSON missing views — using fallback");
      return fallback;
    }

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
      if (capacity === "clear") continue;

      // Prefer piece_indices (canonical contract).
      const indices = Array.isArray(row.piece_indices)
        ? row.piece_indices
            .map((n) =>
              typeof n === "number" ? n : Number.parseInt(String(n), 10),
            )
            .filter((n) => Number.isFinite(n))
        : [];

      if (indices.length > 0) {
        for (const i of indices) {
          const piece = canonical[i];
          if (!piece || used.has(piece)) continue;
          assignments[index]!.pieces.push(piece);
          used.add(piece);
        }
        continue;
      }

      // Legacy: string pieces → map onto unused canonical strings only.
      const list = Array.isArray(row.pieces)
        ? row.pieces.filter((p): p is string => typeof p === "string")
        : [];
      for (const label of list) {
        const matched = matchCanonicalPiece(label, canonical, used);
        if (!matched) continue;
        assignments[index]!.pieces.push(matched);
        used.add(matched);
      }
    }

    const layout: StagingLayout = {
      strategy: options.strategy,
      views: assignments,
      source_room_description: options.roomDescription,
      planned_at: new Date().toISOString(),
    };

    // Incomplete / wrong LLM assignment → THROW (never silent repair).
    assertPieceConservation(canonical, layout);

    const coalesced = coalesceRelatedPieces(layout, canonical);
    console.info(
      "[layout-plan] conservation check:\n" +
        formatPieceConservationLog(canonical, coalesced),
    );
    return coalesced;
  } catch (err) {
    // Never swallow conservation failures.
    if (err instanceof LayoutPieceConservationError) throw err;
    console.error("[layout-plan] generate failed, using fallback", err);
    console.info(
      "[layout-plan] conservation check (fallback after error):\n" +
        formatPieceConservationLog(canonical, fallback),
    );
    return fallback;
  }
}
