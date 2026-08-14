import "server-only";

import { fal } from "@fal-ai/client";

import {
  buildFallbackStagingPlan,
  type RoomType,
  type StagingPlan,
  type StagingQuestionnaire,
  sanitizeNotes,
} from "@/lib/staging/staging-plan-shared";

const LLM_ENDPOINT = "fal-ai/any-llm";
const LLM_MODEL = "google/gemini-2.5-flash-lite";

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

function fallbackRoomSentence(
  roomType: RoomType,
  plan: StagingPlan,
  roomKey: string,
): string {
  const style = plan.style.toLowerCase();
  const palette = plan.palette.toLowerCase();
  const market = plan.market.toLowerCase();
  // Vary by room_key hash so two bedrooms differ while staying on-brand.
  const salt = roomKey.split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  const woods = ["walnut", "oak", "light ash", "espresso-stained wood"];
  const metals = ["brushed brass", "matte black", "aged bronze", "chrome"];
  const wood = woods[salt % woods.length]!;
  const metal = metals[(salt >> 3) % metals.length]!;

  switch (roomType) {
    case "living_room":
      return `a ${style} sofa in ${palette} upholstery, complementary seating, a ${wood} coffee table with ${metal} accents, an area rug, and restrained decor`;
    case "dining_room":
      return `a ${wood} dining table seating for a ${market}, upholstered chairs, a simple centerpiece, and lighting that matches existing fixtures`;
    case "bedroom":
    case "primary_bedroom":
      return `a made bed with coordinated ${palette} linens, nightstands with lamps featuring ${metal} finishes, and soft textiles — arrangement unique to ${roomKey.replace(/_/g, " ")}`;
    case "kitchen":
      return `styled counters with a small plant or bowl, bar stools if an island exists, and no appliance changes`;
    case "office":
      return `a ${wood} desk and chair, a task lamp with ${metal} finish, and sparse ${style} desk accessories`;
    case "bathroom":
      return `folded towels, a small plant, and subtle toiletries — no fixture changes`;
    case "entry":
      return `a console or bench in ${wood}, a mirror or art, and a simple rug runner`;
    case "basement":
      return `comfortable seating and a side table in a ${style} style, keeping columns and stairs unchanged`;
    case "outdoor":
      return `outdoor seating and a low table appropriate for the climate, keeping hardscape unchanged`;
    default:
      return `a few essential ${style} pieces in ${palette} tones that fit the space without crowding`;
  }
}

/**
 * Generate a locked staging plan shell from questionnaire answers.
 * Room descriptions are NOT filled here — they freeze per room_key on first use.
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
 * Freeze a furniture description for a room_key the first time it is needed.
 * Does not overwrite an existing frozen sentence.
 */
export async function ensureFrozenRoomDescription(options: {
  plan: StagingPlan;
  roomKey: string;
  roomType: RoomType;
}): Promise<StagingPlan> {
  const { roomKey, roomType } = options;
  const plan = {
    ...options.plan,
    rooms: { ...options.plan.rooms },
    room_types: { ...(options.plan.room_types ?? {}) },
  };

  if (plan.rooms[roomKey]?.trim()) {
    plan.room_types[roomKey] = plan.room_types[roomKey] ?? roomType;
    return plan;
  }

  // Legacy: old plans keyed descriptions by room_type — adopt once.
  if (plan.rooms[roomType]?.trim() && !plan.rooms[roomKey]) {
    // Only reuse type-keyed text if no other room_key of this type exists yet.
    const siblings = Object.keys(plan.rooms).filter(
      (k) => k !== roomType && plan.room_types[k] === roomType,
    );
    if (siblings.length === 0) {
      plan.rooms[roomKey] = plan.rooms[roomType]!;
      plan.room_types[roomKey] = roomType;
      delete plan.rooms[roomType];
      return plan;
    }
  }

  const fallbackSentence = fallbackRoomSentence(roomType, plan, roomKey);
  if (!configureFal()) {
    plan.rooms[roomKey] = fallbackSentence;
    plan.room_types[roomKey] = roomType;
    return plan;
  }

  try {
    const existing = Object.entries(plan.rooms)
      .filter(([k]) => k !== roomKey)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n");

    const result = await fal.subscribe(LLM_ENDPOINT, {
      input: {
        model: LLM_MODEL,
        temperature: LLM_TEMPERATURE,
        prompt: `Write ONE furniture sentence for virtual staging of a vacant ${roomType.replace(/_/g, " ")} (room id: ${roomKey}).
Return ONLY valid JSON: {"description":"…"}.
Must share the tour style (${plan.style}) and palette (${plan.palette}) / density (${plan.density}) / market (${plan.market}).
Global: ${plan.global_descriptors}.
Include hints: ${plan.includes.join(", ") || "none"}.
Already-frozen rooms in this tour (make this DIFFERENT furniture, same house language):
${existing || "(none yet)"}
No verbs of removal. No architecture changes. Specific pieces with materials and colors.`,
        system_prompt: "Return only JSON. No markdown fences.",
      },
      logs: false,
    });

    const data = result.data as { output?: string };
    const raw = (data.output ?? "").trim();
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    let sentence = fallbackSentence;
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as { description?: string };
      if (
        typeof parsed.description === "string" &&
        parsed.description.trim().length > 12
      ) {
        sentence = parsed.description.trim().slice(0, 500);
      }
    }
    plan.rooms[roomKey] = sentence;
    plan.room_types[roomKey] = roomType;
    return plan;
  } catch (err) {
    console.error("[staging-plan] room description failed, fallback", err);
    plan.rooms[roomKey] = fallbackSentence;
    plan.room_types[roomKey] = roomType;
    return plan;
  }
}
