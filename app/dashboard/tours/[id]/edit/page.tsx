import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { SceneList } from "@/components/scenes/scene-list";
import { SceneUploader } from "@/components/scenes/scene-uploader";
import { Button } from "@/components/ui/button";
import { getTourById, listScenesForTour } from "@/lib/queries/tours";
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

  const scenes = await listScenesForTour(id);
  const nextPosition =
    scenes.reduce((max, scene) => Math.max(max, scene.position), -1) + 1;

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 p-6">
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          size="sm"
          className="w-fit px-0"
          nativeButton={false}
          render={<Link href="/dashboard" />}
        >
          ← Back to tours
        </Button>
        <h1 className="text-2xl font-semibold tracking-tight">{tour.title}</h1>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Upload scenes</h2>
        <SceneUploader
          tourId={tour.id}
          userId={user.id}
          nextPosition={nextPosition}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-medium">Scenes</h2>
        <SceneList tourId={tour.id} scenes={scenes} />
      </section>
    </main>
  );
}
