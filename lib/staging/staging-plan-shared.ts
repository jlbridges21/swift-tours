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

/**
 * Structured furniture list for one room_key.
 * Legacy plans stored a prose string — those are normalized to
 * `{ pieces: [], needs_regeneration: true, legacy_description }` on read.
 */
export type StagingRoomPlan = {
  pieces: string[];
  /** True when this room still has a legacy prose description. */
  needs_regeneration?: boolean;
  /** Original prose kept for diagnostics only — never parsed into pieces. */
  legacy_description?: string;
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
  /**
   * Furniture lists keyed by room_key (e.g. living_room_1), NOT room_type.
   */
  rooms: Record<string, StagingRoomPlan>;
  /** room_key → room_type used when the description was frozen. */
  room_types: Record<string, RoomType>;
  locked_at: string;
};

const MAX_NOTES = 400;

/** Connector / prose openers that indicate a fragment, not a piece. */
const CONNECTOR_START_RE =
  /^(complemented|arranged|anchored|paired|finished|complete|featuring|including|with|and|all|also|plus|alongside|surrounded|accented|topped|set|placed|positioned|while|which|that|on|in|by|for|to|from|of)\b/i;

/** Mid-phrase prose connectors the model must not emit. */
const CONNECTOR_PHRASE_RE =
  /\b(anchors the space|complemented by|all arranged on|paired with|finished with|surrounded by|accented with|topped with)\b/i;

export type PieceValidationFailure = {
  index: number;
  piece: string;
  reason: string;
};

export type PieceValidationResult =
  | { ok: true; pieces: string[] }
  | { ok: false; failures: PieceValidationFailure[] };

/**
 * Validate a model-produced pieces array before freezing.
 *
 * Rules (reject the whole array if any element fails):
 * 1. Must be a non-empty array of strings.
 * 2. Each piece must have at least 3 words.
 * 3. Must not start with a connector word (complemented, arranged, with, and, …).
 * 4. Must not contain a sentence-ending period.
 * 5. Must not contain prose connector phrases ("anchors the space", "complemented by", …).
 */
export function validatePiecePhrases(raw: unknown): PieceValidationResult {
  if (!Array.isArray(raw) || raw.length === 0) {
    return {
      ok: false,
      failures: [
        {
          index: -1,
          piece: "",
          reason: "pieces must be a non-empty JSON array",
        },
      ],
    };
  }

  const failures: PieceValidationFailure[] = [];
  const pieces: string[] = [];

  raw.forEach((item, index) => {
    if (typeof item !== "string") {
      failures.push({
        index,
        piece: String(item),
        reason: "piece must be a string",
      });
      return;
    }
    const piece = item.replace(/\s+/g, " ").trim();
    if (!piece) {
      failures.push({ index, piece: item, reason: "piece is empty" });
      return;
    }
    const words = piece.split(" ").filter(Boolean);
    if (words.length < 3) {
      failures.push({
        index,
        piece,
        reason: `fewer than 3 words (${words.length})`,
      });
    }
    if (CONNECTOR_START_RE.test(piece)) {
      failures.push({
        index,
        piece,
        reason: "starts with a connector word",
      });
    }
    if (piece.includes(".")) {
      failures.push({
        index,
        piece,
        reason: "contains a sentence-ending period",
      });
    }
    if (CONNECTOR_PHRASE_RE.test(piece)) {
      failures.push({
        index,
        piece,
        reason: "contains prose connector language",
      });
    }
    pieces.push(piece);
  });

  if (failures.length > 0) return { ok: false, failures };
  return { ok: true, pieces };
}

export function isStagingRoomPlan(value: unknown): value is StagingRoomPlan {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return Array.isArray(v.pieces);
}

/** True when this room entry is legacy prose or explicitly flagged. */
export function roomPlanNeedsRegeneration(
  entry: StagingRoomPlan | string | null | undefined,
): boolean {
  if (entry == null) return false;
  if (typeof entry === "string") return true;
  return entry.needs_regeneration === true || !entry.pieces?.length;
}

/**
 * Normalize a single rooms[key] value. Legacy strings are NOT parsed —
 * they become `{ pieces: [], needs_regeneration: true, legacy_description }`.
 */
export function normalizeRoomPlanEntry(
  value: unknown,
): StagingRoomPlan | null {
  if (value == null) return null;
  if (typeof value === "string") {
    const legacy = value.trim();
    if (!legacy) return null;
    return {
      pieces: [],
      needs_regeneration: true,
      legacy_description: legacy,
    };
  }
  if (isStagingRoomPlan(value)) {
    const pieces = value.pieces
      .filter((p): p is string => typeof p === "string")
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (value.needs_regeneration || pieces.length === 0) {
      return {
        pieces: [],
        needs_regeneration: true,
        legacy_description:
          typeof value.legacy_description === "string"
            ? value.legacy_description
            : undefined,
      };
    }
    return {
      pieces,
      needs_regeneration: false,
      legacy_description: value.legacy_description,
    };
  }
  return null;
}

/** Normalize an entire plan's rooms map (legacy string → needs_regeneration). */
export function normalizeStagingPlanRooms(
  rooms: Record<string, unknown> | null | undefined,
): Record<string, StagingRoomPlan> {
  const out: Record<string, StagingRoomPlan> = {};
  if (!rooms || typeof rooms !== "object") return out;
  for (const [key, value] of Object.entries(rooms)) {
    const entry = normalizeRoomPlanEntry(value);
    if (entry) out[key] = entry;
  }
  return out;
}

export function getRoomPieces(
  plan: StagingPlan,
  roomKey: string,
): string[] | null {
  const entry = plan.rooms[roomKey];
  if (!entry || entry.needs_regeneration || !entry.pieces?.length) return null;
  return entry.pieces;
}

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
  /** Prefer room_key lookup; falls back to roomType for legacy plans. */
  roomKey?: string;
}): string {
  const { roomType, plan, intensity = "fully", roomKey } = options;
  if (intensity === "empty") {
    return "Leave this room empty. Do not add furniture or decor. Keep the existing architecture exactly as photographed.";
  }

  const roomLabel = roomType.replace(/_/g, " ");
  const entry =
    (roomKey ? plan.rooms[roomKey] : undefined) ?? plan.rooms[roomType];
  const furniture =
    entry && !entry.needs_regeneration && entry.pieces.length > 0
      ? entry.pieces.join("; ")
      : `tasteful ${plan.density.toLowerCase()} furnishings appropriate for a ${roomLabel}`;
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

  return {
    style: q.style,
    palette: q.palette,
    seed,
    density: q.density,
    market: q.market,
    includes: [...q.includes],
    notes,
    global_descriptors: global,
    rooms: {},
    room_types: {},
    locked_at: new Date().toISOString(),
  };
}
