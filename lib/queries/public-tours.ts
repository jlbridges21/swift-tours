import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { createPublicClient } from "@/lib/supabase/public";
import type { FloorPlan, Hotspot, Scene, SceneGroup, Tour } from "@/types";

export type PublicTourPayload = {
  tour: Tour;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  hotspots: Hotspot[];
};

type TourWithNested = Tour & {
  scenes:
    | (Scene & {
        hotspots: Hotspot[] | null;
      })[]
    | null;
  scene_groups: SceneGroup[] | null;
  floor_plans: FloorPlan[] | null;
};

export async function getPublicTourBySlug(
  slug: string,
): Promise<PublicTourPayload | null> {
  const supabase = createPublicClient();

  const { data, error } = await supabase
    .from("tours")
    .select(
      `
      *,
      scenes!scenes_tour_id_fkey (
        *,
        hotspots!hotspots_scene_id_fkey (*)
      ),
      scene_groups (*),
      floor_plans (*)
    `,
    )
    .eq("slug", slug)
    .eq("is_public", true)
    .order("position", { referencedTable: "scene_groups", ascending: true })
    .order("position", { referencedTable: "floor_plans", ascending: true })
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const row = data as TourWithNested;
  const groups = [...(row.scene_groups ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const floorPlans = [...(row.floor_plans ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const rawScenes = (row.scenes ?? []).map(({ hotspots: _h, ...scene }) => scene);
  const scenes = sortScenesByGroupOrder(rawScenes, groups);
  const hotspots = (row.scenes ?? []).flatMap((scene) => scene.hotspots ?? []);

  const {
    scenes: _scenes,
    scene_groups: _groups,
    floor_plans: _plans,
    ...tour
  } = row;

  return {
    tour,
    scenes,
    groups,
    floorPlans,
    hotspots,
  };
}
