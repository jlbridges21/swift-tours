import { createClient } from "@/lib/supabase/server";
import type { Tour } from "@/types";

export type TourListItem = Tour & {
  scene_count: number;
  cover_thumbnail_path: string | null;
};

type TourQueryRow = Tour & {
  scenes: { count: number }[] | null;
  cover_scene: { thumbnail_path: string | null } | null;
};

export async function listTours(): Promise<TourListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("tours")
    .select(
      `
      *,
      scenes!scenes_tour_id_fkey(count),
      cover_scene:scenes!fk_cover_scene(thumbnail_path)
    `,
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  const rows = (data ?? []) as TourQueryRow[];

  return rows.map((row) => {
    const { scenes, cover_scene, ...tour } = row;
    return {
      ...tour,
      scene_count: scenes?.[0]?.count ?? 0,
      cover_thumbnail_path: cover_scene?.thumbnail_path ?? null,
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
