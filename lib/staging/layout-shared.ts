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

/** Per-view staging prompt — only the pieces assigned to THIS view. */
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
    (descriptors ? `${descriptors}. ` : "") +
    `Add NO other furniture, rugs, art, or decor. The rest of this room's furnishings are ` +
    `outside this view and must not appear here. ` +
    `Keep the existing walls, windows, doors, flooring, ceiling, trim, and light fixtures ` +
    `exactly as they are. Do not change the room's architecture, layout, or perspective. ` +
    `Photorealistic real estate photography, natural lighting matching the existing scene.`
  );
}

/** Same-room adjacent view (continuity within one room_key). */
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

/**
 * Force-split helper for bake-off: redistribute pieces across ≥2 non-clear views.
 */
export function forceSplitLayout(layout: StagingLayout): StagingLayout {
  const allPieces = layout.views.flatMap((v) => v.pieces);
  if (allPieces.length < 2) return layout;

  const targets = layout.views.filter((v) => {
    // Prefer views that already had capacity in analysis — keep indices.
    return true;
  });
  if (targets.length < 2) return layout;

  const next = layout.views.map((v) => ({ index: v.index, pieces: [] as string[] }));
  // Put first half on first view with any prior pieces or index 0; rest on next.
  const usable = next.filter((_, i) => layout.views[i] !== undefined);
  const a = usable[0]!;
  const b = usable[1] ?? usable[0]!;
  const mid = Math.ceil(allPieces.length / 2);
  a.pieces = allPieces.slice(0, mid);
  b.pieces = allPieces.slice(mid);
  // Clear others
  for (const v of next) {
    if (v.index !== a.index && v.index !== b.index) v.pieces = [];
  }
  return {
    ...layout,
    views: next,
    planned_at: new Date().toISOString(),
  };
}

/**
 * Deterministic fallback layout when the text model is unavailable.
 * Puts large seating on the first large-capacity wall; floor pieces with seating;
 * small accents on remaining usable views; clears doorway/window-only views.
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

  const isFloorCentre = (p: string) =>
    /\b(rug|carpet|coffee table|ottoman|centerpiece)\b/i.test(p);

  const largeHost =
    views.find((_, i) => options.analysis.views[i]?.capacity === "large") ??
    views[0];
  const smallHosts = views.filter(
    (_, i) =>
      options.analysis.views[i]?.capacity === "small" ||
      options.analysis.views[i]?.capacity === "large",
  );

  const floorPieces: string[] = [];
  const otherPieces: string[] = [];
  for (const p of pieces) {
    if (isFloorCentre(p)) floorPieces.push(p);
    else otherPieces.push(p);
  }

  if (largeHost) {
    for (const p of otherPieces) {
      // Prefer blank/large walls for sofas and art; distribute round-robin after.
      if (
        /\b(sofa|couch|sectional|loveseat|bed|dining table)\b/i.test(p) ||
        largeHost.pieces.length === 0
      ) {
        largeHost.pieces.push(p);
      } else {
        const host =
          smallHosts.find((h) => h.index !== largeHost.index) ?? largeHost;
        host.pieces.push(p);
      }
    }
    // Floor-centre with the primary seating view.
    largeHost.pieces.push(...floorPieces);
  }

  // Rebalance: if a clear-capacity view got pieces, move them.
  for (let i = 0; i < views.length; i++) {
    const capacity = options.analysis.views[i]?.capacity;
    if (capacity === "clear" && views[i]!.pieces.length > 0) {
      const dest =
        views.find(
          (v, j) =>
            j !== i && options.analysis.views[j]?.capacity !== "clear",
        ) ?? largeHost;
      if (dest && dest !== views[i]) {
        dest.pieces.push(...views[i]!.pieces);
        views[i]!.pieces = [];
      }
    }
  }

  return {
    strategy: options.strategy,
    views,
    source_room_description: options.roomDescription,
    planned_at: new Date().toISOString(),
  };
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
