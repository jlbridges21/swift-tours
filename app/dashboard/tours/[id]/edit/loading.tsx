import { Skeleton } from "@/components/ui/skeleton";

export default function TourEditorLoading() {
  return (
    <div className="flex h-[100dvh] flex-col">
      <div className="flex h-12 shrink-0 items-center gap-3 border-b px-3">
        <Skeleton className="h-8 w-8" />
        <Skeleton className="h-8 w-48" />
        <div className="ml-auto flex gap-2">
          <Skeleton className="h-7 w-16" />
          <Skeleton className="h-7 w-20" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[280px] shrink-0 flex-col border-r p-2 lg:flex">
          <Skeleton className="mb-2 h-4 w-16" />
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="mb-1 h-14 w-full" />
          ))}
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <Skeleton className="min-h-0 flex-1 rounded-none" />
          <div className="flex h-11 items-center border-t px-3">
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
        <div className="hidden w-[300px] shrink-0 flex-col border-l p-2 lg:flex">
          <Skeleton className="mb-2 h-4 w-20" />
          <Skeleton className="h-24 w-full" />
        </div>
      </div>
    </div>
  );
}
