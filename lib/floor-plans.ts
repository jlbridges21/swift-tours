/**
 * Floor plans: fractional marker coords (0..1) so plans scale without drift.
 * A scene with floor_plan_id but null plan_x/plan_y is unplaced — a normal state.
 */

export type FloorPlanLike = {
  id: string;
  group_id: string | null;
  name: string;
  position: number;
  width: number;
  height: number;
  storage_path: string;
};

export type ScenePlanLike = {
  id: string;
  floor_plan_id: string | null;
  plan_x: number | null;
  plan_y: number | null;
  group_id?: string | null;
};

export function isScenePlaced(scene: ScenePlanLike): boolean {
  return (
    scene.floor_plan_id != null &&
    scene.plan_x != null &&
    scene.plan_y != null
  );
}

export function clampPlanCoord(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

export function scenesOnPlan<T extends ScenePlanLike>(
  scenes: T[],
  planId: string,
): T[] {
  return scenes.filter((scene) => scene.floor_plan_id === planId);
}

export function placedScenesOnPlan<T extends ScenePlanLike>(
  scenes: T[],
  planId: string,
): T[] {
  return scenesOnPlan(scenes, planId).filter(isScenePlaced);
}

export function unplacedScenesOnPlan<T extends ScenePlanLike>(
  scenes: T[],
  planId: string,
): T[] {
  return scenesOnPlan(scenes, planId).filter((scene) => !isScenePlaced(scene));
}

export function floorPlanExpandedStorageKey(tourId: string): string {
  return `swift-tours:floor-plan-expanded:${tourId}`;
}

export function readFloorPlanExpanded(tourId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(floorPlanExpandedStorageKey(tourId)) === "1";
  } catch {
    return false;
  }
}

export function writeFloorPlanExpanded(tourId: string, expanded: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      floorPlanExpandedStorageKey(tourId),
      expanded ? "1" : "0",
    );
  } catch {
    // Quota / private mode — ignore.
  }
}
