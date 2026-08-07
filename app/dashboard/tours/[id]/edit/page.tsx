import { notFound, redirect } from "next/navigation";

import { TourEditor } from "@/components/editor/tour-editor";
import {
  getTourById,
  listHotspotsForTour,
  listScenesForTour,
} from "@/lib/queries/tours";
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

  const [scenes, hotspots] = await Promise.all([
    listScenesForTour(id),
    listHotspotsForTour(id),
  ]);

  return (
    <TourEditor
      tour={tour}
      scenes={scenes}
      hotspots={hotspots}
      userId={user.id}
    />
  );
}
