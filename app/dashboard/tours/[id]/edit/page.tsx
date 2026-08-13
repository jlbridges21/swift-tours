import { notFound, redirect } from "next/navigation";

import { TourEditor } from "@/components/editor/tour-editor";
import {
  getTourById,
  listFloorPlansForTour,
  listHotspotImagesForTour,
  listHotspotsForTour,
  listSceneGroupsForTour,
  listScenesForTour,
} from "@/lib/queries/tours";
import { isStagingEnabled } from "@/lib/staging/providers";
import { createClient } from "@/lib/supabase/server";

type EditTourPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTourPage({ params }: EditTourPageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tour = await getTourById(id);
  if (!tour) {
    notFound();
  }

  const [scenes, groups, floorPlans, hotspots, hotspotImages] =
    await Promise.all([
      listScenesForTour(id),
      listSceneGroupsForTour(id),
      listFloorPlansForTour(id),
      listHotspotsForTour(id),
      listHotspotImagesForTour(id),
    ]);

  return (
    <TourEditor
      tour={tour}
      scenes={scenes}
      groups={groups}
      floorPlans={floorPlans}
      hotspots={hotspots}
      hotspotImages={hotspotImages}
      userId={user.id}
      stagingEnabled={isStagingEnabled()}
    />
  );
}
