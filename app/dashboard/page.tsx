import { NewTourButton } from "@/components/tours/new-tour-button";
import { TourCard } from "@/components/tours/tour-card";
import { listTours } from "@/lib/queries/tours";

export default async function DashboardPage() {
  const tours = await listTours();

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your tours</h1>
        <NewTourButton />
      </div>

      {tours.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm text-muted-foreground">
            You don&apos;t have any tours yet. Create one to get started.
          </p>
          <NewTourButton />
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tours.map((tour) => (
            <TourCard key={tour.id} tour={tour} />
          ))}
        </div>
      )}
    </main>
  );
}
