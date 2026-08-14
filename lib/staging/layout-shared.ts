/**
 * Room analysis + layout plan types and prompt helpers (client-safe).
 */

import type { ViewStrategyId } from "@/lib/staging/view-strategies";

export type WallFeature =
  | "blank_wall"
  | "window"
  | "door"
  | "fireplace"
  | "closet"
  | "opening"
  | "mixed";

export type FurnitureCapacity = "large" | "small" | "clear";

export type ViewAnalysis = {
  index: number;
  wall: WallFeature;
  wall_detail: string;
  floor_space: "ample" | "moderate" | "narrow" | "none";
  capacity: FurnitureCapacity;
};

export type StagingRoomAnalysis = {
  strategy: ViewStrategyId;
  views: ViewAnalysis[];
  analyzed_at: string;
};

export type LayoutViewAssignment = {
  index: number;
  pieces: string[];
};

export type StagingLayout = {
  strategy: ViewStrategyId;
  views: LayoutViewAssignment[];
  /** Canonical furniture list — single source of truth for conservation. */
  source_pieces: string[];
  planned_at: string;
};

export class LayoutPieceConservationError extends Error {
  readonly missing: string[];
  readonly duplicated: string[];
  readonly unexpected: string[];
  readonly roomKey?: string;
  readonly raw?: unknown;

  constructor(options: {
    missing: string[];
    duplicated: string[];
    unexpected: string[];
    roomKey?: string;
    raw?: unknown;
  }) {
    const parts: string[] = [];
    if (options.roomKey) parts.push(`room_key=${options.roomKey}`);
    if (options.missing.length) {
      parts.push(`missing: ${JSON.stringify(options.missing)}`);
    }
    if (options.duplicated.length) {
      parts.push(`duplicated: ${JSON.stringify(options.duplicated)}`);
    }
    if (options.unexpected.length) {
      parts.push(`unexpected: ${JSON.stringify(options.unexpected)}`);
    }
    if (options.raw !== undefined) {
      parts.push(`raw: ${JSON.stringify(options.raw)}`);
    }
    super(
      `Layout piece conservation violated — every canonical piece must appear exactly once. ${parts.join("; ")}`,
    );
    this.name = "LayoutPieceConservationError";
    this.missing = options.missing;
    this.duplicated = options.duplicated;
    this.unexpected = options.unexpected;
    this.roomKey = options.roomKey;
    this.raw = options.raw;
  }
}

/**
 * Resolve the canonical piece contract from a layout.
 * Prefers source_pieces; never parses prose.
 */
export function layoutCanonicalPieces(layout: StagingLayout): string[] {
  if (Array.isArray(layout.source_pieces) && layout.source_pieces.length > 0) {
    return layout.source_pieces;
  }
  throw new LayoutPieceConservationError({
    missing: ["(no source_pieces on layout)"],
    duplicated: [],
    unexpected: [],
    raw: layout,
  });
}

/**
 * Hard invariant: every canonical piece appears EXACTLY ONCE across all views.
 * Throws LayoutPieceConservationError on violation — never repairs.
 */
export function assertPieceConservation(
  canonical: string[],
  layout: StagingLayout,
  context?: { roomKey?: string; raw?: unknown },
): void {
  const counts = new Map<string, number>();
  for (const v of layout.views) {
    for (const p of v.pieces) {
      counts.set(p, (counts.get(p) ?? 0) + 1);
    }
  }

  const missing: string[] = [];
  const duplicated: string[] = [];
  for (const piece of canonical) {
    const n = counts.get(piece) ?? 0;
    if (n === 0) missing.push(piece);
    if (n > 1) duplicated.push(piece);
    counts.delete(piece);
  }
  const unexpected = [...counts.keys()];

  if (missing.length || duplicated.length || unexpected.length) {
    throw new LayoutPieceConservationError({
      missing,
      duplicated,
      unexpected,
      roomKey: context?.roomKey,
      raw: context?.raw ?? {
        source_pieces: layout.source_pieces,
        views: layout.views,
      },
    });
  }
}

/** Log canonical list beside per-view assignment for bake-off / job visibility. */
export function formatPieceConservationLog(
  canonical: string[],
  layout: StagingLayout,
): string {
  const lines = [
    "canonical pieces:",
    ...canonical.map((p, i) => `  ${i + 1}. ${p}`),
    "per-view assignment:",
    ...layout.views.map(
      (v) =>
        `  view ${v.index}: ${
          v.pieces.length ? v.pieces.map((p) => JSON.stringify(p)).join(", ") : "(empty)"
        }`,
    ),
  ];
  return lines.join("\n");
}

/**
 * Map a free-text label onto an unused canonical piece (exact, then fuzzy).
 * Returns null when no unused canonical match exists.
 */
export function matchCanonicalPiece(
  label: string,
  canonical: string[],
  used: Set<string>,
): string | null {
  const trimmed = label.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();

  const exact = canonical.find((c) => !used.has(c) && c.toLowerCase() === lower);
  if (exact) return exact;

  const fuzzy = canonical.find((c) => {
    if (used.has(c)) return false;
    const ck = c.toLowerCase();
    return (
      ck.includes(lower.slice(0, 28)) ||
      lower.includes(ck.slice(0, 28)) ||
      tokenOverlap(ck, lower) >= 0.5
    );
  });
  return fuzzy ?? null;
}

function tokenOverlap(a: string, b: string): number {
  const ta = new Set(a.split(/\W+/).filter((t) => t.length > 2));
  const tb = new Set(b.split(/\W+/).filter((t) => t.length > 2));
  if (ta.size === 0 || tb.size === 0) return 0;
  let hit = 0;
  for (const t of ta) if (tb.has(t)) hit += 1;
  return hit / Math.min(ta.size, tb.size);
}

export function piecesForView(
  layout: StagingLayout | null | undefined,
  viewIndex: number,
): string[] {
  if (!layout) return [];
  const entry = layout.views.find((v) => v.index === viewIndex);
  return entry?.pieces ?? [];
}

/**
 * Prompt framing variants for adherence experiments / production default.
 * Default is "completion" — short-list experiment: completion + vacant held;
 * current + exclusion invented whole seating groups.
 */
export type StagingPromptFraming =
  | "current"
  | "completion"
  | "exclusion"
  | "vacant";

/**
 * Per-view staging prompt. Default framing is "completion" — the short-list
 * experiment showed it (and "vacant") obey "add nothing else"; "current" and
 * "exclusion" still invent whole seating groups.
 */
export function composeViewStagingPrompt(options: {
  pieces: string[];
  globalDescriptors: string;
  framing?: StagingPromptFraming;
}): string | null {
  const pieces = options.pieces.map((p) => p.trim()).filter(Boolean);
  if (pieces.length === 0) return null;

  const list = pieces.join("; ");
  const descriptors = options.globalDescriptors.trim();
  const framing = options.framing ?? "completion";
  const arch =
    `Keep the existing walls, windows, doors, flooring, ceiling, trim, and light fixtures ` +
    `exactly as they are. Do not change the room's architecture, layout, or perspective. ` +
    `Photorealistic real estate photography, natural lighting matching the existing scene.`;
  const alreadyThere =
    `Some furniture may already be visible in this view. Leave it exactly as it is and do not duplicate it. `;

  if (framing === "current") {
    return (
      `Add to this view: ${list}. ` +
      alreadyThere +
      `Add only the pieces listed above. ` +
      (descriptors ? `${descriptors}. ` : "") +
      `Add NO other furniture, rugs, art, or decor. The rest of this room's furnishings are ` +
      `outside this view and must not appear here. ` +
      arch
    );
  }

  if (framing === "exclusion") {
    return (
      `${list}. Do not add seating, tables, lamps, rugs, or artwork beyond what is listed. ` +
      alreadyThere +
      `Add only the pieces listed above. ` +
      (descriptors ? `${descriptors}. ` : "") +
      arch
    );
  }

  if (framing === "vacant") {
    return (
      `This is a vacant real-estate photograph. Place ONLY these exact items and leave ` +
      `every other floor and wall surface empty: ${list}. ` +
      `Do not invent a seating group, coffee table, rug, lamp, plant, or artwork to "complete" the room. ` +
      alreadyThere +
      (descriptors ? `Match materials/palette only: ${descriptors}. ` : "") +
      arch
    );
  }

  // completion (default)
  return (
    `This room is already fully staged. The only thing missing is ${list}. ` +
    `Add exactly that and nothing else. Every other surface stays empty. ` +
    alreadyThere +
    (descriptors ? `${descriptors}. ` : "") +
    arch
  );
}

/** @deprecated Intra-scene collage removed; progressive composite replaced it. */
export function collageContinuityInstruction(): string {
  return (
    ` The image is a side-by-side pair of the SAME room: furnish ONLY the LEFT half. ` +
    `The RIGHT half is the same room from an adjacent camera angle that is already staged. ` +
    `Any furniture visible in the overlap already exists — do not duplicate it. ` +
    `Match materials, scale, and lighting of pieces that continue across the seam.`
  );
}

/** Adjacent different room (cross-scene via link hotspot). */
export function collageAdjacentRoomInstruction(roomLabel: string): string {
  const label = roomLabel.replace(/_/g, " ");
  return (
    ` The image is a side-by-side pair: furnish ONLY the LEFT half (this room). ` +
    `The RIGHT half is the ADJACENT ROOM (${label}) as already staged. ` +
    `Any furniture visible through the opening must match it in style, material, and colour. ` +
    `Do not restage that room — only add this view's assigned pieces on the LEFT.`
  );
}

/** Stable image seed for a view: tour seed + view index × 17. */
export function viewImageSeed(tourSeed: number, viewIndex: number): number {
  return tourSeed + viewIndex * 17;
}

const ANCHOR_RE =
  /\b(sofa|couch|sectional|loveseat|bed|dining table|desk)\b/i;
const FLOOR_CENTRE_RE = /\b(rug|carpet|coffee table|ottoman|centerpiece)\b/i;
const PRIMARY_GROUP_RE =
  /\b(sofas?|couches?|sectionals?|loveseats?|rugs?|carpets?|coffee tables?|canvas|paintings?|abstract)\b/i;
const SECONDARY_GROUP_RE =
  /\b(armchairs?|side chairs?|accent chairs?|figs?|plants?|fiddle|floor lamps?|consoles?)\b/i;

function isAnchorPiece(p: string): boolean {
  return ANCHOR_RE.test(p);
}

function isFloorCentrePiece(p: string): boolean {
  return FLOOR_CENTRE_RE.test(p);
}

/** True when `piece` textually depends on `anchor` (e.g. canvas "above the sofa"). */
export function pieceReferencesAnchor(piece: string, anchor: string): boolean {
  if (piece === anchor) return false;
  const lower = piece.toLowerCase();
  const nouns = anchor
    .toLowerCase()
    .match(
      /\b(sofa|couch|sectional|loveseat|bed|table|desk|armchair|chair|rug|lamp)\b/g,
    );
  if (!nouns || nouns.length === 0) return false;
  return nouns.some((n) => {
    if (!lower.includes(n)) return false;
    return (
      new RegExp(
        `\\b(above|beside|with|on|under|near|behind|facing|against)\\b[\\s\\w-]*\\b${n}\\b`,
        "i",
      ).test(piece) ||
      (lower.includes(n) && !isAnchorPiece(piece) && isAnchorPiece(anchor))
    );
  });
}

/**
 * Cluster pieces into coherent groupings.
 * Primary: sofa/bed + dependents (canvas above sofa, rug, coffee table).
 * Secondary: armchairs, plants, accent pieces.
 * Every input piece appears in exactly one group.
 */
export function clusterFurnitureGroups(pieces: string[]): string[][] {
  if (pieces.length === 0) return [];

  const primary: string[] = [];
  const secondary: string[] = [];
  const anchors = pieces.filter(isAnchorPiece);
  const primaryAnchor = anchors[0] ?? null;

  for (const p of pieces) {
    if (primaryAnchor && p === primaryAnchor) {
      primary.push(p);
      continue;
    }
    if (
      (primaryAnchor && pieceReferencesAnchor(p, primaryAnchor)) ||
      isFloorCentrePiece(p) ||
      PRIMARY_GROUP_RE.test(p)
    ) {
      primary.push(p);
      continue;
    }
    if (SECONDARY_GROUP_RE.test(p)) {
      secondary.push(p);
      continue;
    }
    // Unknown → keep with primary seating group.
    primary.push(p);
  }

  // Dependents of secondary pieces move with them.
  const moved: string[] = [];
  for (const p of primary) {
    for (const a of secondary) {
      if (pieceReferencesAnchor(p, a)) {
        secondary.push(p);
        moved.push(p);
        break;
      }
    }
  }
  const primaryFinal = primary.filter((p) => !moved.includes(p));

  // Conservation inside the clusterer.
  const out =
    secondary.length === 0 ? [primaryFinal] : [primaryFinal, secondary];
  const seen = new Set(out.flat());
  if (seen.size !== pieces.length || pieces.some((p) => !seen.has(p))) {
    throw new LayoutPieceConservationError({
      missing: pieces.filter((p) => !seen.has(p)),
      duplicated: [],
      unexpected: [...seen].filter((p) => !pieces.includes(p)),
    });
  }
  return out;
}

/**
 * Move any piece that references another piece onto that piece's view.
 * Conserves the canonical piece set — throws if a piece would be lost.
 */
export function coalesceRelatedPieces(
  layout: StagingLayout,
  canonical?: string[],
): StagingLayout {
  const contract = canonical ?? layoutCanonicalPieces(layout);

  const pieceToView = new Map<string, number>();
  for (const v of layout.views) {
    for (const p of v.pieces) pieceToView.set(p, v.index);
  }

  // Only move pieces that are in the layout; never invent.
  const present = [...pieceToView.keys()];
  let changed = true;
  while (changed) {
    changed = false;
    for (const piece of present) {
      for (const other of present) {
        if (!pieceReferencesAnchor(piece, other)) continue;
        const from = pieceToView.get(piece);
        const to = pieceToView.get(other);
        if (from === undefined || to === undefined || from === to) continue;
        pieceToView.set(piece, to);
        changed = true;
      }
    }
  }

  const views = layout.views.map((v) => ({
    index: v.index,
    pieces: [] as string[],
  }));
  for (const [piece, index] of pieceToView) {
    views.find((v) => v.index === index)?.pieces.push(piece);
  }
  // Preserve canonical order within each view.
  for (const v of views) {
    v.pieces.sort((a, b) => contract.indexOf(a) - contract.indexOf(b));
  }

  const next: StagingLayout = {
    ...layout,
    views,
    planned_at: new Date().toISOString(),
  };
  assertPieceConservation(contract, next);
  return next;
}

/**
 * Force-split for bake-off: two coherent groupings across TWO DISTINCT views.
 * Always rebuilds from layout.source_pieces (never from view arrays alone).
 * Related pieces stay together: sofa + canvas + rug + coffee table vs armchairs + fig.
 */
export function forceSplitLayout(
  layout: StagingLayout,
  analysis?: StagingRoomAnalysis,
): StagingLayout {
  const canonical =
    layout.source_pieces?.length > 0
      ? [...layout.source_pieces]
      : layoutCanonicalPieces(layout);
  if (canonical.length < 2) {
    throw new Error(
      `--force-split requires at least 2 canonical pieces; got ${canonical.length}`,
    );
  }

  const groups = clusterFurnitureGroups(canonical);
  let groupA = groups[0] ?? [];
  let groupB = groups[1] ?? [];

  // Guarantee two non-empty groups for progressive-compositing tests.
  if (groupB.length === 0) {
    if (groupA.length < 2) {
      throw new Error(
        `--force-split cannot form two groups from: ${JSON.stringify(canonical)}`,
      );
    }
    // Keep primary anchor cluster intact: peel trailing secondary-ish pieces.
    const peelAt = Math.max(1, groupA.length - Math.ceil(groupA.length / 3));
    groupB = groupA.slice(peelAt);
    groupA = groupA.slice(0, peelAt);
  }

  if (groupA.length === 0 || groupB.length === 0) {
    throw new Error(
      `--force-split produced an empty group: A=${JSON.stringify(groupA)} B=${JSON.stringify(groupB)}`,
    );
  }

  const viewIndexes = layout.views.map((v) => v.index).sort((a, b) => a - b);
  if (viewIndexes.length < 2) {
    throw new Error("--force-split needs at least 2 views in the layout.");
  }

  // Prefer two non-clear views, but never collapse onto the same index.
  const usable = viewIndexes.filter((i) => {
    const cap = analysis?.views.find((a) => a.index === i)?.capacity;
    return cap !== "clear";
  });
  const aIdx = usable[0] ?? viewIndexes[0]!;
  const bIdx =
    usable.find((i) => i !== aIdx) ??
    viewIndexes.find((i) => i !== aIdx) ??
    viewIndexes[1]!;

  if (aIdx === bIdx) {
    throw new Error(
      `--force-split failed to pick two distinct views (only index ${aIdx}).`,
    );
  }

  const nextViews = layout.views.map((v) => ({
    index: v.index,
    pieces: [] as string[],
  }));
  const slotA = nextViews.find((v) => v.index === aIdx)!;
  const slotB = nextViews.find((v) => v.index === bIdx)!;
  slotA.pieces = [...groupA];
  slotB.pieces = [...groupB];

  return coalesceRelatedPieces(
    {
      ...layout,
      views: nextViews,
      source_pieces: canonical,
      planned_at: new Date().toISOString(),
    },
    canonical,
  );
}

/**
 * Deterministic fallback layout when the text model is unavailable.
 * Prefers concentrating the primary furniture grouping into ONE large-capacity view.
 */
export function buildFallbackLayoutPlan(options: {
  strategy: ViewStrategyId;
  /** Canonical pieces — already structured; never prose. */
  pieces: string[];
  analysis: StagingRoomAnalysis;
}): StagingLayout {
  const canonical = [...options.pieces];
  const views = options.analysis.views.map((v) => ({
    index: v.index,
    pieces: [] as string[],
  }));

  const largeHost =
    views.find((_, i) => options.analysis.views[i]?.capacity === "large") ??
    views[0];
  const groups = clusterFurnitureGroups(canonical);

  if (largeHost && groups[0]) {
    largeHost.pieces.push(...groups[0]);
  }
  // Only split when a second group exists (separate functional zone).
  if (groups[1] && groups[1].length > 0) {
    const second =
      views.find(
        (v, i) =>
          v.index !== largeHost?.index &&
          options.analysis.views[i]?.capacity !== "clear",
      ) ?? largeHost;
    second?.pieces.push(...groups[1]);
  }

  // Clear-capacity views stay empty — but never wipe pieces we just assigned
  // if that would orphan them onto a clear host. Re-home first.
  for (let i = 0; i < views.length; i++) {
    if (options.analysis.views[i]?.capacity !== "clear") continue;
    const orphaned = views[i]!.pieces;
    views[i]!.pieces = [];
    if (orphaned.length === 0) continue;
    const host =
      views.find(
        (v, j) =>
          v.index !== views[i]!.index &&
          options.analysis.views[j]?.capacity !== "clear",
      ) ?? largeHost;
    host?.pieces.push(...orphaned);
  }

  return coalesceRelatedPieces(
    {
      strategy: options.strategy,
      views,
      source_pieces: canonical,
      planned_at: new Date().toISOString(),
    },
    canonical,
  );
}

export function buildFallbackRoomAnalysis(
  strategy: ViewStrategyId,
  viewCount: number,
): StagingRoomAnalysis {
  const views: ViewAnalysis[] = [];
  for (let i = 0; i < viewCount; i++) {
    // Alternate: assume view 0 is often a blank seating wall, others mixed.
    const capacity: FurnitureCapacity =
      i === 0 ? "large" : i === viewCount - 1 ? "clear" : "small";
    views.push({
      index: i,
      wall:
        capacity === "clear"
          ? "opening"
          : capacity === "large"
            ? "blank_wall"
            : "mixed",
      wall_detail:
        capacity === "clear"
          ? "opening or circulation — keep clear"
          : capacity === "large"
            ? "mostly blank wall with usable floor"
            : "mixed features with limited floor",
      floor_space:
        capacity === "large" ? "ample" : capacity === "small" ? "moderate" : "narrow",
      capacity,
    });
  }
  return {
    strategy,
    views,
    analyzed_at: new Date().toISOString(),
  };
}
