/**
 * Scene groups: optional tour organization by floor / building / area.
 * Tours with no groups keep a flat scene list — identical to pre-groups behavior.
 */

export const UNGROUPED_KEY = "ungrouped" as const;

export type SceneGroupLike = {
  id: string;
  name: string;
  position: number;
};

export type SceneLike = {
  id: string;
  group_id: string | null;
  position: number;
};

/**
 * Effective tour order:
 *   1. Groups by group.position
 *   2. Each group's scenes by scene.position
 *   3. Ungrouped scenes by scene.position (implicit final bucket)
 */
export function sortScenesByGroupOrder<
  TScene extends SceneLike,
  TGroup extends SceneGroupLike,
>(scenes: TScene[], groups: TGroup[]): TScene[] {
  const groupOrder = [...groups].sort((a, b) => a.position - b.position);
  const byGroup = new Map<string | null, TScene[]>();

  for (const scene of scenes) {
    const key = scene.group_id;
    const list = byGroup.get(key) ?? [];
    list.push(scene);
    byGroup.set(key, list);
  }

  for (const list of byGroup.values()) {
    list.sort((a, b) => a.position - b.position);
  }

  const ordered: TScene[] = [];
  for (const group of groupOrder) {
    ordered.push(...(byGroup.get(group.id) ?? []));
  }
  ordered.push(...(byGroup.get(null) ?? []));
  return ordered;
}

/** Scenes belonging to a group (or null = ungrouped), sorted by position. */
export function scenesInGroup<TScene extends SceneLike>(
  scenes: TScene[],
  groupId: string | null,
): TScene[] {
  return scenes
    .filter((scene) => scene.group_id === groupId)
    .sort((a, b) => a.position - b.position);
}

export function collapsedGroupsStorageKey(tourId: string): string {
  return `swift-tours:collapsed-groups:${tourId}`;
}

export function readCollapsedGroups(tourId: string): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(collapsedGroupsStorageKey(tourId));
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return new Set();
  }
}

export function writeCollapsedGroups(tourId: string, ids: Set<string>): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      collapsedGroupsStorageKey(tourId),
      JSON.stringify([...ids]),
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
