import "server-only";

import { fal } from "@fal-ai/client";

import {
  buildFallbackStagingPlan,
  type StagingPlan,
  type StagingQuestionnaire,
  ROOM_TYPES,
  sanitizeNotes,
} from "@/lib/staging/staging-plan-shared";

const VISION_ENDPOINT = "fal-ai/any-llm";

/**
 * Generate a locked staging plan from questionnaire answers using a text model,
 * then freeze it. Falls back to a deterministic template if the model fails.
 */
export async function generateLockedStagingPlan(
  q: StagingQuestionnaire,
  seed: number,
): Promise<StagingPlan> {
  const fallback = buildFallbackStagingPlan(q, seed);
  const key = process.env.FAL_KEY?.trim();
  if (!key) return fallback;

  try {
    fal.config({ credentials: key });
    const roomKeys = ROOM_TYPES.join(", ");
    const result = await fal.subscribe(VISION_ENDPOINT, {
      input: {
        model: "google/gemini-2.5-flash-lite",
        prompt: `You write concrete furniture lists for virtual staging of vacant real-estate photos.
Return ONLY valid JSON with keys: global_descriptors (string), rooms (object).
rooms must include these keys when relevant: ${roomKeys}.
Each rooms value is ONE sentence listing specific furniture pieces (fabrics, woods, colors) — no verbs of removal, no architecture changes.
Style: ${q.style}. Palette: ${q.palette}. Density: ${q.density}. Market: ${q.market}.
Include: ${q.includes.join(", ") || "none"}.
Notes: ${sanitizeNotes(q.notes) || "none"}.
Make pieces consistent across rooms (same wood tone, metal finish, textile family).`,
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as {
      global_descriptors?: string;
      rooms?: Record<string, string>;
    };

    const rooms: StagingPlan["rooms"] = { ...fallback.rooms };
    if (parsed.rooms && typeof parsed.rooms === "object") {
      for (const key of ROOM_TYPES) {
        const v = parsed.rooms[key];
        if (typeof v === "string" && v.trim().length > 12) {
          rooms[key] = v.trim().slice(0, 500);
        }
      }
    }

    return {
      ...fallback,
      global_descriptors:
        typeof parsed.global_descriptors === "string" &&
        parsed.global_descriptors.trim().length > 8
          ? parsed.global_descriptors.trim().slice(0, 400)
          : fallback.global_descriptors,
      rooms,
      locked_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[staging-plan] generate failed, using fallback", err);
    return fallback;
  }
}
