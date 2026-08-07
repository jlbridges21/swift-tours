"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { MoreHorizontalIcon } from "lucide-react";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { deleteTour, duplicateTour } from "@/app/dashboard/actions";
import { TourSettingsDialog } from "@/components/tours/tour-settings-dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  formatRelativeDate,
  formatViewCount,
  panoramaPublicUrl,
} from "@/lib/format";
import type { TourListItem } from "@/lib/queries/tours";

type TourCardProps = {
  tour: TourListItem;
  priority?: boolean;
};

export function TourCard({ tour, priority = false }: TourCardProps) {
  const router = useRouter();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const coverUrl = panoramaPublicUrl(tour.cover_thumbnail_path);
  const sceneLabel =
    tour.scene_count === 0
      ? "No scenes yet"
      : `${tour.scene_count} ${tour.scene_count === 1 ? "scene" : "scenes"}`;

  function handleDuplicate() {
    startTransition(async () => {
      const result = await duplicateTour(tour.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tour duplicated");
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteTour(tour.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Tour deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <div className="group relative overflow-hidden rounded-xl ring-1 ring-foreground/10 transition-colors hover:ring-foreground/20">
        <Link
          href={`/dashboard/tours/${tour.id}/edit`}
          className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="relative aspect-[16/10] bg-muted">
            {coverUrl ? (
              <Image
                src={coverUrl}
                alt=""
                fill
                className="object-cover"
                sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw"
                {...(priority
                  ? { priority: true }
                  : { loading: "lazy" as const })}
              />
            ) : (
              <div className="flex size-full items-center justify-center bg-muted text-xs text-muted-foreground">
                No cover
              </div>
            )}
          </div>
          <div className="flex flex-col gap-2 p-4">
            <div className="flex items-start justify-between gap-3 pr-8">
              <h2 className="line-clamp-1 font-medium tracking-tight">
                {tour.title}
              </h2>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{sceneLabel}</span>
              <span aria-hidden="true">·</span>
              <span>{formatViewCount(tour.view_count)}</span>
              <span aria-hidden="true">·</span>
              <Badge variant={tour.is_public ? "default" : "secondary"}>
                {tour.is_public ? "Public" : "Unlisted"}
              </Badge>
              <span aria-hidden="true">·</span>
              <span>{formatRelativeDate(tour.created_at)}</span>
            </div>
          </div>
        </Link>

        <div
          className="absolute top-3 right-3"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger
              render={
                <Button
                  variant="secondary"
                  size="icon-sm"
                  className="shadow-sm"
                  disabled={pending}
                />
              }
            >
              <MoreHorizontalIcon />
              <span className="sr-only">Tour actions</span>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem
                onClick={() =>
                  router.push(`/dashboard/tours/${tour.id}/edit`)
                }
              >
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                Settings
              </DropdownMenuItem>
              <DropdownMenuItem disabled={pending} onClick={handleDuplicate}>
                {pending ? "Working…" : "Duplicate"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                variant="destructive"
                disabled={pending}
                onClick={() => setDeleteOpen(true)}
              >
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <TourSettingsDialog
        tour={tour}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
      />

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{tour.title}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete the tour and all of its scenes. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={pending}
              onClick={handleDelete}
            >
              {pending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
