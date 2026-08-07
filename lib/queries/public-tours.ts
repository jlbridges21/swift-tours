import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { createPublicClient } from "@/lib/supabase/public";
import type { Hotspot, Scene, SceneGroup, Tour } from "@/types";

export type PublicTourPayload = {
  tour: Tour;
  scenes: Scene[];
  groups: SceneGroup[];
  hotspots: Hotspot[];
};

type TourWithNested = Tour & {
  scenes:
    | (Scene & {
        hotspots: Hotspot[] | null;
      })[]
    | null;
  scene_groups: SceneGroup[] | null;
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
      scene_groups (*)
    `,
    )
    .eq("slug", slug)
    .eq("is_public", true)
    .order("position", { referencedTable: "scene_groups", ascending: true })
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
  const rawScenes = (row.scenes ?? []).map(({ hotspots: _h, ...scene }) => scene);
  const scenes = sortScenesByGroupOrder(rawScenes, groups);
  const hotspots = (row.scenes ?? []).flatMap((scene) => scene.hotspots ?? []);

  const { scenes: _scenes, scene_groups: _groups, ...tour } = row;

  return {
    tour,
    scenes,
    groups,
    hotspots,
  };
}
