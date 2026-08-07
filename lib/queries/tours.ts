import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { createClient } from "@/lib/supabase/server";
import type { FloorPlan, Hotspot, Scene, SceneGroup, Tour } from "@/types";

export type TourListItem = Tour & {
  scene_count: number;
  group_count: number;
  cover_thumbnail_path: string | null;
  cover_adjust_brightness: number;
  cover_adjust_contrast: number;
  cover_adjust_saturation: number;
  view_count: number;
};

type TourQueryRow = Tour & {
  scenes: { count: number }[] | null;
  scene_groups: { count: number }[] | null;
  cover_scene: {
    thumbnail_path: string | null;
    adjust_brightness: number;
    adjust_contrast: number;
    adjust_saturation: number;
  } | null;
  tour_views: { count: number }[] | null;
};

export async function listTours(): Promise<TourListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tours")
    .select(
      `
      *,
      scenes!scenes_tour_id_fkey(count),
      scene_groups(count),
      cover_scene:scenes!fk_cover_scene(
        thumbnail_path,
        adjust_brightness,
        adjust_contrast,
        adjust_saturation
      ),
      tour_views(count)
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TourQueryRow[];

  return rows.map((row) => {
    const { scenes, scene_groups, cover_scene, tour_views, ...tour } = row;
    return {
      ...tour,
      scene_count: scenes?.[0]?.count ?? 0,
      group_count: scene_groups?.[0]?.count ?? 0,
      cover_thumbnail_path: cover_scene?.thumbnail_path ?? null,
      cover_adjust_brightness: cover_scene?.adjust_brightness ?? 1,
      cover_adjust_contrast: cover_scene?.adjust_contrast ?? 1,
      cover_adjust_saturation: cover_scene?.adjust_saturation ?? 1,
      view_count: tour_views?.[0]?.count ?? 0,
    };
  });
}

export async function getTourById(id: string): Promise<Tour | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tours")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data;
}

export async function listSceneGroupsForTour(
  tourId: string,
): Promise<SceneGroup[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scene_groups")
    .select("*")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listScenesForTour(tourId: string): Promise<Scene[]> {
  const supabase = await createClient();

  const [{ data: scenes, error: scenesError }, { data: groups, error: groupsError }] =
    await Promise.all([
      supabase.from("scenes").select("*").eq("tour_id", tourId),
      supabase
        .from("scene_groups")
        .select("*")
        .eq("tour_id", tourId)
        .order("position", { ascending: true }),
    ]);

  if (scenesError) {
    throw new Error(scenesError.message);
  }
  if (groupsError) {
    throw new Error(groupsError.message);
  }

  return sortScenesByGroupOrder(scenes ?? [], groups ?? []);
}

export async function listFloorPlansForTour(
  tourId: string,
): Promise<FloorPlan[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("floor_plans")
    .select("*")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}

export async function listHotspotsForTour(tourId: string): Promise<Hotspot[]> {
  const supabase = await createClient();

  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("id")
    .eq("tour_id", tourId);

  if (scenesError) {
    throw new Error(scenesError.message);
  }

  const sceneIds = (scenes ?? []).map((scene) => scene.id);
  if (sceneIds.length === 0) {
    return [];
  }

  const { data, error } = await supabase
    .from("hotspots")
    .select("*")
    .in("scene_id", sceneIds);

  if (error) {
    throw new Error(error.message);
  }

  return data ?? [];
}
