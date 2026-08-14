import "server-only";

import { fal } from "@fal-ai/client";

import {
  buildFallbackRoomAnalysis,
  type StagingRoomAnalysis,
  type ViewAnalysis,
  type WallFeature,
  type FurnitureCapacity,
} from "@/lib/staging/layout-shared";
import type { ViewStrategyId } from "@/lib/staging/view-strategies";

const VISION_ENDPOINT = "fal-ai/any-llm/vision";
const VISION_MODEL = "google/gemini-2.5-flash-lite";

function configureFal(): boolean {
  const key = process.env.FAL_KEY?.trim();
  if (!key) return false;
  fal.config({ credentials: key });
  return true;
}

function asWall(raw: unknown): WallFeature {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (
    s === "blank_wall" ||
    s === "window" ||
    s === "door" ||
    s === "fireplace" ||
    s === "closet" ||
    s === "opening" ||
    s === "mixed"
  ) {
    return s;
  }
  if (s.includes("window")) return "window";
  if (s.includes("door")) return "door";
  if (s.includes("fire")) return "fireplace";
  if (s.includes("closet")) return "closet";
  if (s.includes("open") || s.includes("hall")) return "opening";
  if (s.includes("blank")) return "blank_wall";
  return "mixed";
}

function asCapacity(raw: unknown): FurnitureCapacity {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "large" || s === "small" || s === "clear") return s;
  if (s.includes("large") || s.includes("sofa")) return "large";
  if (s.includes("clear") || s.includes("none") || s.includes("block")) {
    return "clear";
  }
  return "small";
}

function asFloorSpace(raw: unknown): ViewAnalysis["floor_space"] {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "ample" || s === "moderate" || s === "narrow" || s === "none") {
    return s;
  }
  return "moderate";
}

/**
 * One vision call for the scene: describe each directional view crop.
 * `imageUrls` must be ordered by view index (0..n-1).
 */
export async function analyzeRoomViews(options: {
  strategy: ViewStrategyId;
  imageUrls: string[];
}): Promise<StagingRoomAnalysis> {
  const fallback = buildFallbackRoomAnalysis(
    options.strategy,
    options.imageUrls.length,
  );
  if (!configureFal() || options.imageUrls.length === 0) return fallback;

  try {
    const n = options.imageUrls.length;
    const result = await fal.subscribe(VISION_ENDPOINT, {
      input: {
        model: VISION_MODEL,
        image_urls: options.imageUrls,
        prompt: `You are analyzing ${n} perspective photos of the SAME vacant room, in order (image 0 … image ${n - 1}). Each photo faces a different direction from the room center.
For EACH image index return what is on that wall/direction and whether furniture can go there.
Reply with ONLY valid JSON:
{"views":[{"index":0,"wall":"blank_wall|window|door|fireplace|closet|opening|mixed","wall_detail":"short phrase","floor_space":"ample|moderate|narrow|none","capacity":"large|small|clear"}]}
Rules:
- capacity "large" = blank or mostly clear wall with enough floor for a sofa/bed
- capacity "small" = can take a chair, plant, or console only
- capacity "clear" = doorway, primary window walkway, or circulation — must stay empty
- Do not invent furniture; the room is vacant.
- Exactly ${n} entries, indices 0..${n - 1}.`,
        system_prompt: "Return only JSON. No markdown fences.",
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as {
      views?: Array<Record<string, unknown>>;
    };
    if (!Array.isArray(parsed.views) || parsed.views.length === 0) {
      return fallback;
    }

    const byIndex = new Map<number, ViewAnalysis>();
    for (const row of parsed.views) {
      const index =
        typeof row.index === "number"
          ? row.index
          : Number.parseInt(String(row.index), 10);
      if (!Number.isFinite(index) || index < 0 || index >= n) continue;
      byIndex.set(index, {
        index,
        wall: asWall(row.wall),
        wall_detail:
          typeof row.wall_detail === "string" && row.wall_detail.trim()
            ? row.wall_detail.trim().slice(0, 200)
            : "unspecified",
        floor_space: asFloorSpace(row.floor_space),
        capacity: asCapacity(row.capacity),
      });
    }

    const views: ViewAnalysis[] = [];
    for (let i = 0; i < n; i++) {
      views.push(byIndex.get(i) ?? fallback.views[i]!);
    }

    return {
      strategy: options.strategy,
      views,
      analyzed_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[room-analysis] vision failed, using fallback", err);
    return fallback;
  }
}
