import Link from "next/link";
import { notFound } from "next/navigation";

import { Button } from "@/components/ui/button";
import { getTourById } from "@/lib/queries/tours";

type EditTourPageProps = {
  params: Promise<{ id: string }>;
};

export default async function EditTourPage({ params }: EditTourPageProps) {
  const { id } = await params;
  const tour = await getTourById(id);

  if (!tour) {
    notFound();
  }

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <div className="flex flex-col gap-4">
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
        <p className="text-sm text-muted-foreground">
          Scene management and the hotspot editor come next.
        </p>
      </div>
    </main>
  );
}
