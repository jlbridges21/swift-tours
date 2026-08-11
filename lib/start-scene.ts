import {
  sortScenesByGroupOrder,
  type SceneGroupLike,
  type SceneLike,
} from "@/lib/scene-groups";

/** Tour fields used when resolving the opening scene. */
export type TourOpeningSceneFields = {
  start_scene_id: string | null;
  cover_scene_id: string | null;
};

/**
 * Opening scene resolution (highest priority first):
 *   1. A valid `?start=` param that exists in this tour's scene list
 *   2. `tours.start_scene_id`
 *   3. `tours.cover_scene_id`
 *   4. The first scene in effective tour order (already sorted)
 *
 * Invalid / unknown start params fall through — never throw.
 * `orderedScenes` must already be in group/position order.
 */
export function resolveOpeningSceneId(
  tour: TourOpeningSceneFields,
  orderedScenes: ReadonlyArray<{ id: string }>,
  startParam?: string | null,
): string | undefined {
  if (
    typeof startParam === "string" &&
    startParam.length > 0 &&
    orderedScenes.some((scene) => scene.id === startParam)
  ) {
    return startParam;
  }

  if (tour.start_scene_id) {
    const start = orderedScenes.find((s) => s.id === tour.start_scene_id);
    if (start) return start.id;
  }

  if (tour.cover_scene_id) {
    const cover = orderedScenes.find((s) => s.id === tour.cover_scene_id);
    if (cover) return cover.id;
  }

  return orderedScenes[0]?.id;
}

/** Sort by group/position, then resolve the opening scene. */
export function resolveOpeningSceneIdFromTour<
  TScene extends SceneLike,
  TGroup extends SceneGroupLike,
>(
  tour: TourOpeningSceneFields,
  scenes: TScene[],
  groups: TGroup[],
  startParam?: string | null,
): string | undefined {
  const ordered = sortScenesByGroupOrder(scenes, groups);
  return resolveOpeningSceneId(tour, ordered, startParam);
}
