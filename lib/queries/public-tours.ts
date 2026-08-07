import { createPublicClient } from "@/lib/supabase/public";
import type { Hotspot, Scene, Tour } from "@/types";

export type PublicTourPayload = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
};

type TourWithNested = Tour & {
  scenes:
    | (Scene & {
        hotspots: Hotspot[] | null;
      })[]
    | null;
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
      )
    `,
    )
    .eq("slug", slug)
    .eq("is_public", true)
    .order("position", { referencedTable: "scenes", ascending: true })
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  if (!data) {
    return null;
  }

  const row = data as TourWithNested;
  const scenes = [...(row.scenes ?? [])].sort(
    (a, b) => a.position - b.position,
  );
  const hotspots = scenes.flatMap((scene) => scene.hotspots ?? []);

  const { scenes: _scenes, ...tour } = row;

  return {
    tour,
    scenes: scenes.map(({ hotspots: _h, ...scene }) => scene),
    hotspots,
  };
}
