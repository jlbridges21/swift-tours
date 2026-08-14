import "server-only";

import { fal } from "@fal-ai/client";

import {
  buildFallbackStagingPlan,
  normalizeRoomPlanEntry,
  normalizeStagingPlanRooms,
  validatePiecePhrases,
  type RoomType,
  type StagingPlan,
  type StagingQuestionnaire,
  type StagingRoomPlan,
  sanitizeNotes,
} from "@/lib/staging/staging-plan-shared";

const LLM_ENDPOINT = "fal-ai/any-llm";
const LLM_MODEL = "google/gemini-2.5-flash-lite";
const PIECE_GEN_MAX_ATTEMPTS = 3;

/**
 * fal-ai/any-llm accepts `temperature` (0 = deterministic). It does NOT accept a seed.
 * Vision endpoint (any-llm/vision) likewise: temperature yes, seed no.
 */
export const LLM_TEMPERATURE = 0;

function configureFal(): boolean {
  const key = process.env.FAL_KEY?.trim();
  if (!key) return false;
  fal.config({ credentials: key });
  return true;
}

/** Deterministic structured pieces when the LLM is unavailable or keeps failing validation. */
export function fallbackRoomPieces(
  roomType: RoomType,
  plan: StagingPlan,
  roomKey: string,
): string[] {
  const style = plan.style.toLowerCase();
  const palette = plan.palette.toLowerCase();
  const market = plan.market.toLowerCase();
  const salt = roomKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const woods = ["walnut", "oak", "light ash", "espresso-stained wood"];
  const metals = ["brushed brass", "matte black", "aged bronze", "chrome"];
  const wood = woods[salt % woods.length]!;
  const metal = metals[(salt >> 3) % metals.length]!;

  switch (roomType) {
    case "living_room":
      return [
        `a ${style} sofa in ${palette} upholstery`,
        `two complementary accent chairs`,
        `a ${wood} coffee table with ${metal} accents`,
        `a softly patterned area rug`,
        `a large abstract canvas above the sofa`,
        `a tall potted plant in a woven basket`,
      ];
    case "dining_room":
      return [
        `a ${wood} dining table for a ${market}`,
        `upholstered dining chairs in ${palette} fabric`,
        `a simple low centerpiece bowl`,
        `a matching runner on the table`,
      ];
    case "bedroom":
    case "primary_bedroom":
      return [
        `a made bed with coordinated ${palette} linens`,
        `two nightstands with ${metal} lamps`,
        `a soft area rug beside the bed`,
        `a simple framed print above the bed`,
      ];
    case "kitchen":
      return [
        `styled counters with a small plant`,
        `two bar stools at the island`,
        `a ceramic bowl of fruit`,
      ];
    case "office":
      return [
        `a ${wood} writing desk`,
        `a comfortable desk chair`,
        `a task lamp with ${metal} finish`,
        `sparse ${style} desk accessories`,
      ];
    case "bathroom":
      return [
        `a stack of folded towels`,
        `a small potted plant`,
        `subtle toiletries on the vanity`,
      ];
    case "entry":
      return [
        `a console table in ${wood}`,
        `a mirror above the console`,
        `a simple rug runner`,
      ];
    case "basement":
      return [
        `a comfortable ${style} sofa`,
        `a low side table`,
        `a floor lamp with ${metal} finish`,
      ];
    case "outdoor":
      return [
        `outdoor seating for the climate`,
        `a low outdoor coffee table`,
        `a potted outdoor plant`,
      ];
    default:
      return [
        `a few essential ${style} pieces`,
        `accents in ${palette} tones`,
        `a simple area rug`,
      ];
  }
}

function formatExistingRooms(plan: StagingPlan): string {
  return Object.entries(plan.rooms)
    .filter(([, v]) => v.pieces.length > 0 && !v.needs_regeneration)
    .map(([k, v]) => `${k}: ${JSON.stringify(v.pieces)}`)
    .join("\n");
}

/**
 * Generate a locked staging plan shell from questionnaire answers.
 * Room piece lists are NOT filled here — they freeze per room_key on first use.
 */
export async function generateLockedStagingPlan(
  q: StagingQuestionnaire,
  seed: number,
): Promise<StagingPlan> {
  const fallback = buildFallbackStagingPlan(q, seed);
  if (!configureFal()) return fallback;

  try {
    const result = await fal.subscribe(LLM_ENDPOINT, {
      input: {
        model: LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        prompt: `You write global descriptors for virtual staging of vacant real-estate photos.
Return ONLY valid JSON: {"global_descriptors":"…"}.
One short phrase covering wood tones, metals, textiles that stay consistent across every room.
Style: ${q.style}. Palette: ${q.palette}. Density: ${q.density}. Market: ${q.market}.
Include: ${q.includes.join(", ") || "none"}.
Notes: ${sanitizeNotes(q.notes) || "none"}.`,
        system_prompt: "Return only JSON. No markdown fences.",
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallback;
    const parsed = JSON.parse(jsonMatch[0]) as {
      global_descriptors?: string;
    };

    return {
      ...fallback,
      global_descriptors:
        typeof parsed.global_descriptors === "string" &&
        parsed.global_descriptors.trim().length > 8
          ? parsed.global_descriptors.trim().slice(0, 400)
          : fallback.global_descriptors,
      rooms: {},
      room_types: {},
      locked_at: new Date().toISOString(),
    };
  } catch (err) {
    console.error("[staging-plan] generate failed, using fallback", err);
    return fallback;
  }
}

/**
 * Normalize plan rooms on load (legacy string → needs_regeneration).
 * Does not invent pieces for legacy rooms.
 */
export function normalizeStagingPlan(plan: StagingPlan): StagingPlan {
  return {
    ...plan,
    rooms: normalizeStagingPlanRooms(
      plan.rooms as unknown as Record<string, unknown>,
    ),
    room_types: { ...(plan.room_types ?? {}) },
  };
}

async function generateValidatedPieces(options: {
  plan: StagingPlan;
  roomKey: string;
  roomType: RoomType;
}): Promise<string[]> {
  const { plan, roomKey, roomType } = options;
  const fallback = fallbackRoomPieces(roomType, plan, roomKey);
  const fallbackCheck = validatePiecePhrases(fallback);
  if (!fallbackCheck.ok) {
    throw new Error(
      `Internal fallback pieces failed validation for ${roomKey}: ${JSON.stringify(fallbackCheck.failures)}`,
    );
  }

  if (!configureFal()) return fallbackCheck.pieces;

  let lastFailures: unknown = null;
  for (let attempt = 1; attempt <= PIECE_GEN_MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fal.subscribe(LLM_ENDPOINT, {
        input: {
          model: LLM_MODEL,
          temperature: LLM_TEMPERATURE,
          prompt: `You list furniture for virtual staging of a vacant ${roomType.replace(/_/g, " ")} (room id: ${roomKey}).
Return ONLY valid JSON: {"pieces":["…","…"]}.

Each array element MUST be:
- A single self-contained noun phrase naming ONE piece (a set like "two cream armchairs" counts as one).
- Free of connector language — no "anchors the space", "complemented by", "all arranged on", "paired with".
- Allowed to reference an anchor piece ("above the sofa", "in front of the windows").
- At least 3 words, no sentence-ending periods.

Must share the tour style (${plan.style}) and palette (${plan.palette}) / density (${plan.density}) / market (${plan.market}).
Global: ${plan.global_descriptors}.
Include hints: ${plan.includes.join(", ") || "none"}.
Already-frozen rooms in this tour (make this DIFFERENT furniture, same house language):
${formatExistingRooms(plan) || "(none yet)"}
No verbs of removal. No architecture changes. Specific pieces with materials and colors.`,
          system_prompt: "Return only JSON. No markdown fences.",
        },
        logs: false,
      });

      const data = result.data as { output?: string };
      const raw = (data.output ?? "").trim();
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        lastFailures = { reason: "no JSON", raw: raw.slice(0, 200) };
        console.warn(
          `[staging-plan] pieces attempt ${attempt}/${PIECE_GEN_MAX_ATTEMPTS}: no JSON`,
        );
        continue;
      }
      const parsed = JSON.parse(jsonMatch[0]) as { pieces?: unknown };
      const validated = validatePiecePhrases(parsed.pieces);
      if (!validated.ok) {
        lastFailures = validated.failures;
        console.warn(
          `[staging-plan] pieces attempt ${attempt}/${PIECE_GEN_MAX_ATTEMPTS} failed validation for ${roomKey}:`,
          validated.failures,
        );
        continue;
      }
      console.info(
        `[staging-plan] froze pieces for ${roomKey} (${validated.pieces.length} items)`,
        validated.pieces,
      );
      return validated.pieces;
    } catch (err) {
      lastFailures = err;
      console.error(
        `[staging-plan] pieces attempt ${attempt}/${PIECE_GEN_MAX_ATTEMPTS} error`,
        err,
      );
    }
  }

  console.warn(
    `[staging-plan] using fallback pieces for ${roomKey} after validation failures`,
    lastFailures,
  );
  return fallbackCheck.pieces;
}

/**
 * Freeze a structured pieces list for a room_key the first time it is needed.
 * Legacy prose entries are marked needs_regeneration and NOT auto-parsed.
 * Pass `force: true` to regenerate (preserves tour style/palette/seed).
 */
export async function ensureFrozenRoomDescription(options: {
  plan: StagingPlan;
  roomKey: string;
  roomType: RoomType;
  force?: boolean;
}): Promise<StagingPlan> {
  const { roomKey, roomType, force = false } = options;
  const plan = normalizeStagingPlan(options.plan);

  const existing = plan.rooms[roomKey];

  // Legacy or empty — do not invent unless force regenerating.
  if (existing?.needs_regeneration && !force) {
    plan.room_types[roomKey] = plan.room_types[roomKey] ?? roomType;
    return plan;
  }

  if (existing && !existing.needs_regeneration && existing.pieces.length > 0 && !force) {
    plan.room_types[roomKey] = plan.room_types[roomKey] ?? roomType;
    return plan;
  }

  // Legacy: old plans keyed by room_type (string or object) — adopt once if unused.
  if (!existing && !force) {
    const typeKeyed = normalizeRoomPlanEntry(
      (options.plan.rooms as Record<string, unknown>)[roomType],
    );
    if (typeKeyed) {
      const siblings = Object.keys(plan.rooms).filter(
        (k) => k !== roomType && plan.room_types[k] === roomType,
      );
      if (siblings.length === 0) {
        if (typeKeyed.needs_regeneration) {
          plan.rooms[roomKey] = typeKeyed;
          plan.room_types[roomKey] = roomType;
          delete plan.rooms[roomType];
          return plan;
        }
        if (typeKeyed.pieces.length > 0) {
          plan.rooms[roomKey] = typeKeyed;
          plan.room_types[roomKey] = roomType;
          delete plan.rooms[roomType];
          return plan;
        }
      }
    }
  }

  const pieces = await generateValidatedPieces({ plan, roomKey, roomType });
  const entry: StagingRoomPlan = {
    pieces,
    needs_regeneration: false,
  };
  plan.rooms[roomKey] = entry;
  plan.room_types[roomKey] = roomType;
  return plan;
}

/** Explicit regenerate for a room_key — clears legacy flag, keeps tour style/seed. */
export async function regenerateRoomPieces(options: {
  plan: StagingPlan;
  roomKey: string;
  roomType: RoomType;
}): Promise<StagingPlan> {
  return ensureFrozenRoomDescription({ ...options, force: true });
}
