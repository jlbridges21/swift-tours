import { createClient } from "@/lib/supabase/server";
import type { Hotspot, Scene, Tour } from "@/types";

export type TourListItem = Tour & {
  scene_count: number;
  cover_thumbnail_path: string | null;
  view_count: number;
};

type TourQueryRow = Tour & {
  scenes: { count: number }[] | null;
  cover_scene: { thumbnail_path: string | null } | null;
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
      cover_scene:scenes!fk_cover_scene(thumbnail_path),
      tour_views(count)
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TourQueryRow[];

  return rows.map((row) => {
    const { scenes, cover_scene, tour_views, ...tour } = row;
    return {
      ...tour,
      scene_count: scenes?.[0]?.count ?? 0,
      cover_thumbnail_path: cover_scene?.thumbnail_path ?? null,
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

export async function listScenesForTour(tourId: string): Promise<Scene[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("scenes")
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
