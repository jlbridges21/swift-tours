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
  /** Original room description sentence the pieces were drawn from. */
  source_room_description: string;
  planned_at: string;
};

/**
 * Split a locked room description into discrete furniture pieces.
 * Prefer comma-separated clauses; keep each piece concrete.
 */
export function splitRoomDescriptionIntoPieces(description: string): string[] {
  const cleaned = description.replace(/\s+/g, " ").trim();
  if (!cleaned) return [];

  // Split on commas / " and " that introduce new articles.
  const parts = cleaned
    .split(/,\s*(?:and\s+)?|\s+and\s+(?=a\s|an\s|two\s|three\s|the\s)/i)
    .map((p) => p.trim().replace(/^and\s+/i, "").replace(/\.$/, ""))
    .filter((p) => p.length > 3);

  if (parts.length >= 2) return parts;

  // Fallback: whole sentence as one piece.
  return [cleaned.replace(/\.$/, "")];
}

export function piecesForView(
  layout: StagingLayout | null | undefined,
  viewIndex: number,
): string[] {
  if (!layout) return [];
  const entry = layout.views.find((v) => v.index === viewIndex);
  return entry?.pieces ?? [];
}

/** Per-view staging prompt — pieces first for adherence, then no-dupe, then globals. */
export function composeViewStagingPrompt(options: {
  pieces: string[];
  globalDescriptors: string;
}): string | null {
  const pieces = options.pieces.map((p) => p.trim()).filter(Boolean);
  if (pieces.length === 0) return null;

  const list = pieces.join("; ");
  const descriptors = options.globalDescriptors.trim();

  return (
    `Add to this view: ${list}. ` +
    `Some furniture may already be visible in this view. Leave it exactly as it is and do not duplicate it. Add only the pieces listed above. ` +
    (descriptors ? `${descriptors}. ` : "") +
    `Add NO other furniture, rugs, art, or decor. The rest of this room's furnishings are ` +
    `outside this view and must not appear here. ` +
    `Keep the existing walls, windows, doors, flooring, ceiling, trim, and light fixtures ` +
    `exactly as they are. Do not change the room's architecture, layout, or perspective. ` +
    `Photorealistic real estate photography, natural lighting matching the existing scene.`
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
    // Dependent phrasing, or shared noun while this piece is not itself the anchor type.
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
 * Cluster pieces into coherent groupings (primary seating + dependents first).
 * Used by the fallback planner and --force-split.
 */
export function clusterFurnitureGroups(pieces: string[]): string[][] {
  if (pieces.length === 0) return [];
  const remaining = [...pieces];
  const anchors = remaining.filter(isAnchorPiece);
  const primaryAnchor = anchors[0] ?? remaining[0]!;
  const primary: string[] = [];
  const secondary: string[] = [];

  for (const p of remaining) {
    if (p === primaryAnchor) {
      primary.push(p);
      continue;
    }
    if (
      pieceReferencesAnchor(p, primaryAnchor) ||
      isFloorCentrePiece(p) ||
      /\b(canvas|painting|art above|abstract)\b/i.test(p)
    ) {
      primary.push(p);
      continue;
    }
    if (anchors.includes(p) && p !== primaryAnchor) {
      secondary.push(p);
      continue;
    }
    if (
      /\b(armchair|side chair|accent chair|fig|plant|floor lamp|console)\b/i.test(
        p,
      )
    ) {
      secondary.push(p);
      continue;
    }
    primary.push(p);
  }

  // Ensure dependents of secondary anchors stay with them.
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

  if (secondary.length === 0) return [primaryFinal];
  return [primaryFinal, secondary];
}

/**
 * Move any piece that references another piece onto that piece's view.
 */
export function coalesceRelatedPieces(layout: StagingLayout): StagingLayout {
  const pieceToView = new Map<string, number>();
  for (const v of layout.views) {
    for (const p of v.pieces) pieceToView.set(p, v.index);
  }
  const all = layout.views.flatMap((v) => v.pieces);
  let changed = true;
  while (changed) {
    changed = false;
    for (const piece of all) {
      for (const other of all) {
        if (!pieceReferencesAnchor(piece, other)) continue;
        const from = pieceToView.get(piece);
        const to = pieceToView.get(other);
        if (from === undefined || to === undefined || from === to) continue;
        pieceToView.set(piece, to);
        changed = true;
      }
    }
  }
  const views = layout.views.map((v) => ({ index: v.index, pieces: [] as string[] }));
  for (const [piece, index] of pieceToView) {
    views.find((v) => v.index === index)?.pieces.push(piece);
  }
  // Preserve original order within each view.
  for (const v of views) {
    v.pieces.sort((a, b) => all.indexOf(a) - all.indexOf(b));
  }
  return { ...layout, views, planned_at: new Date().toISOString() };
}

/**
 * Force-split for bake-off: two coherent groupings across two usable views.
 * Never orphans a dependent (canvas above sofa stays with the sofa).
 */
export function forceSplitLayout(
  layout: StagingLayout,
  analysis?: StagingRoomAnalysis,
): StagingLayout {
  const allPieces = layout.views.flatMap((v) => v.pieces);
  if (allPieces.length < 2) return layout;

  const groups = clusterFurnitureGroups(allPieces);
  if (groups.length < 2) {
    // Artificial but coherent: anchors+deps vs remaining accents.
    const [only] = groups;
    if (!only || only.length < 2) return layout;
    const mid = Math.max(1, Math.ceil(only.length / 2));
    // Prefer splitting after the primary anchor cluster — keep first half together.
    groups.length = 0;
    groups.push(only.slice(0, mid), only.slice(mid));
  }

  const usableIndexes = layout.views
    .map((v) => v.index)
    .filter((i) => {
      const cap = analysis?.views.find((a) => a.index === i)?.capacity;
      return cap !== "clear";
    });
  const aIdx = usableIndexes[0] ?? 0;
  const bIdx = usableIndexes[1] ?? usableIndexes[0] ?? 1;

  const next = layout.views.map((v) => ({ index: v.index, pieces: [] as string[] }));
  const slotA = next.find((v) => v.index === aIdx)!;
  const slotB = next.find((v) => v.index === bIdx) ?? slotA;
  slotA.pieces = groups[0] ?? [];
  slotB.pieces = groups[1] ?? [];

  return coalesceRelatedPieces({
    ...layout,
    views: next,
    planned_at: new Date().toISOString(),
  });
}

/**
 * Deterministic fallback layout when the text model is unavailable.
 * Prefers concentrating the primary furniture grouping into ONE large-capacity view.
 */
export function buildFallbackLayoutPlan(options: {
  strategy: ViewStrategyId;
  roomDescription: string;
  analysis: StagingRoomAnalysis;
}): StagingLayout {
  const pieces = splitRoomDescriptionIntoPieces(options.roomDescription);
  const views = options.analysis.views.map((v) => ({
    index: v.index,
    pieces: [] as string[],
  }));

  const largeHost =
    views.find((_, i) => options.analysis.views[i]?.capacity === "large") ??
    views[0];
  const groups = clusterFurnitureGroups(pieces);

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

  // Clear-capacity views stay empty.
  for (let i = 0; i < views.length; i++) {
    if (options.analysis.views[i]?.capacity === "clear") {
      views[i]!.pieces = [];
    }
  }

  return coalesceRelatedPieces({
    strategy: options.strategy,
    views,
    source_room_description: options.roomDescription,
    planned_at: new Date().toISOString(),
  });
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
      wall: capacity === "clear" ? "opening" : capacity === "large" ? "blank_wall" : "mixed",
      wall_detail:
        capacity === "clear"
          ? "opening or circulation — keep clear"
          : capacity === "large"
            ? "mostly blank wall with usable floor"
            : "mixed features with limited floor",
      floor_space: capacity === "large" ? "ample" : capacity === "small" ? "moderate" : "narrow",
      capacity,
    });
  }
  return {
    strategy,
    views,
    analyzed_at: new Date().toISOString(),
  };
}
