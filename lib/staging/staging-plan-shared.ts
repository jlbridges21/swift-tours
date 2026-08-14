/**
 * Locked tour staging plan — types, constants, and prompt helpers.
 * Safe for client + server (no server-only).
 */

export const STAGING_STYLES = [
  "Modern",
  "Contemporary",
  "Traditional",
  "Transitional",
  "Farmhouse",
  "Mid-century modern",
  "Coastal",
  "Industrial",
  "Scandinavian",
] as const;

export const STAGING_PALETTES = [
  "Neutral warm",
  "Neutral cool",
  "Warm earth tones",
  "Cool greys",
  "Soft with muted accents",
  "Bold accents",
] as const;

export const STAGING_DENSITIES = [
  "Minimal (essentials only)",
  "Balanced",
  "Fully furnished",
] as const;

export const STAGING_MARKETS = [
  "Starter home",
  "Family home",
  "Luxury",
  "Rental",
  "Downsizer",
] as const;

export const STAGING_INCLUDES = [
  "Wall art",
  "Area rugs",
  "Plants",
  "Window treatments",
  "Lamps and lighting",
  "Books and decor",
] as const;

export const ROOM_TYPES = [
  "living_room",
  "bedroom",
  "primary_bedroom",
  "kitchen",
  "dining_room",
  "office",
  "bathroom",
  "entry",
  "basement",
  "outdoor",
  "other",
] as const;

export type RoomType = (typeof ROOM_TYPES)[number];

export type StagingIntensity = "fully" | "lightly" | "empty";

export type StagingQuestionnaire = {
  style: (typeof STAGING_STYLES)[number];
  palette: (typeof STAGING_PALETTES)[number];
  density: (typeof STAGING_DENSITIES)[number];
  market: (typeof STAGING_MARKETS)[number];
  includes: Array<(typeof STAGING_INCLUDES)[number]>;
  notes?: string;
};

export type StagingPlan = {
  style: string;
  palette: string;
  seed: number;
  density: string;
  market: string;
  includes: string[];
  notes: string;
  global_descriptors: string;
  rooms: Partial<Record<RoomType, string>>;
  locked_at: string;
};

const MAX_NOTES = 400;

export function sanitizeNotes(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_NOTES);
}

export function composeRoomStagingPrompt(options: {
  roomType: RoomType;
  plan: StagingPlan;
  intensity?: StagingIntensity;
}): string {
  const { roomType, plan, intensity = "fully" } = options;
  if (intensity === "empty") {
    return "Leave this room empty. Do not add furniture or decor. Keep the existing architecture exactly as photographed.";
  }

  const roomLabel = roomType.replace(/_/g, " ");
  const furniture =
    plan.rooms[roomType]?.trim() ||
    `tasteful ${plan.density.toLowerCase()} furnishings appropriate for a ${roomLabel}`;
  const light =
    intensity === "lightly"
      ? "Stage lightly with only the essential pieces from this list"
      : "Furnish this empty";

  return (
    `${light} ${roomLabel}. Add ${furniture}. ${plan.global_descriptors}. ` +
    `Keep the existing walls, windows, doors, flooring, ceiling, trim, and light fixtures ` +
    `exactly as they are. Do not change the room's architecture, layout, or perspective. ` +
    `Photorealistic real estate photography, natural lighting matching the existing scene.`
  );
}

/** Deterministic fallback plan when the text model is unavailable. */
export function buildFallbackStagingPlan(
  q: StagingQuestionnaire,
  seed: number,
): StagingPlan {
  const includes = q.includes.join(", ").toLowerCase() || "minimal decor";
  const notes = sanitizeNotes(q.notes);
  const global =
    `${q.palette.toLowerCase()}, ${q.style.toLowerCase()} aesthetic, ` +
    `${q.density.toLowerCase()} furniture density for a ${q.market.toLowerCase()}, ` +
    `including ${includes}` +
    (notes ? `; ${notes}` : "");

  const rooms: StagingPlan["rooms"] = {
    living_room: `a sofa and complementary seating in a ${q.style.toLowerCase()} style, a coffee table, an area rug, and restrained ${q.palette.toLowerCase()} accents`,
    dining_room: `a dining table with chairs sized for a ${q.market.toLowerCase()}, a simple centerpiece, and lighting that matches the existing fixtures`,
    bedroom: `a made bed with coordinated linens, two nightstands with lamps, and soft ${q.palette.toLowerCase()} textiles`,
    primary_bedroom: `a made bed with elevated linens, nightstands with lamps, and calm ${q.palette.toLowerCase()} textiles`,
    kitchen: `styled counters with a small plant or bowl, bar stools if an island exists, and no appliance changes`,
    office: `a desk and chair, a task lamp, and sparse ${q.style.toLowerCase()} desk accessories`,
    bathroom: `folded towels, a small plant, and subtle toiletries — no fixture changes`,
    entry: `a console or bench, a mirror or art, and a simple rug runner`,
    basement: `comfortable seating and a side table in a ${q.style.toLowerCase()} style, keeping columns and stairs unchanged`,
    outdoor: `outdoor seating and a low table appropriate for the climate, keeping hardscape unchanged`,
    other: `a few essential ${q.style.toLowerCase()} pieces that fit the space without crowding`,
  };

  return {
    style: q.style,
    palette: q.palette,
    seed,
    density: q.density,
    market: q.market,
    includes: [...q.includes],
    notes,
    global_descriptors: global,
    rooms,
    locked_at: new Date().toISOString(),
  };
}
