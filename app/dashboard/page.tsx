import type { Metadata } from "next";

import { NewTourButton } from "@/components/tours/new-tour-button";
import { TourCard } from "@/components/tours/tour-card";
import { listTours } from "@/lib/queries/tours";

export const metadata: Metadata = {
  title: "Dashboard",
  description: "Manage your Swift Tours virtual tours",
  robots: { index: false, follow: false },
};

export default async function DashboardPage() {
  const tours = await listTours();

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Your tours</h1>
        <NewTourButton />
      </div>

      {tours.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed px-6 py-16 text-center">
          <div className="flex max-w-sm flex-col gap-2">
            <p className="text-base font-medium tracking-tight">No tours yet</p>
            <p className="text-sm text-muted-foreground">
              Create a tour, upload a few 360° photos, and share a link in
              minutes.
            </p>
          </div>
          <NewTourButton />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tours.map((tour, index) => (
            <TourCard key={tour.id} tour={tour} priority={index < 3} />
          ))}
        </div>
      )}
    </main>
  );
}
