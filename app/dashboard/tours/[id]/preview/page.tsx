import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import {
  getTourById,
  listHotspotsForTour,
  listScenesForTour,
} from "@/lib/queries/tours";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function TourPreviewPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const tour = await getTourById(id);
  if (!tour || tour.owner_id !== user.id) {
    notFound();
  }

  const [scenes, hotspots] = await Promise.all([
    listScenesForTour(id),
    listHotspotsForTour(id),
  ]);

  return (
    <TourViewerShell
      tour={tour}
      scenes={scenes}
      hotspots={hotspots}
      trackViews={false}
      showShare={false}
      banner={
        <div className="flex items-center justify-between gap-3 bg-amber-500 px-4 py-2 text-sm font-medium text-amber-950">
          <span>
            {tour.is_public
              ? "Preview — this is how visitors see your tour"
              : "Preview — this tour is unlisted"}
          </span>
          <Link
            href={`/dashboard/tours/${tour.id}/edit`}
            className="underline-offset-2 hover:underline"
          >
            Back to editor
          </Link>
        </div>
      }
    />
  );
}
