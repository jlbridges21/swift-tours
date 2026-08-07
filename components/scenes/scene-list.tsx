"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowDownIcon, ArrowUpIcon, Trash2Icon } from "lucide-react";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  deleteScene,
  renameScene,
  reorderScenes,
} from "@/app/dashboard/tours/[id]/actions";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { adjustmentFilter } from "@/lib/adjustments";
import { publicUrl } from "@/lib/storage";
import type { Scene } from "@/types";

type SceneListProps = {
  tourId: string;
  scenes: Scene[];
};

export function SceneList({ tourId, scenes }: SceneListProps) {
  if (scenes.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No scenes yet. Upload at least two 360° photos — hotspots need two or
          more scenes to link between.
        </p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {scenes.map((scene, index) => (
        <SceneListItem
          key={scene.id}
          tourId={tourId}
          scene={scene}
          index={index}
          total={scenes.length}
          orderedIds={scenes.map((s) => s.id)}
        />
      ))}
    </ul>
  );
}

type SceneListItemProps = {
  tourId: string;
  scene: Scene;
  index: number;
  total: number;
  orderedIds: string[];
};

function SceneListItem({
  tourId,
  scene,
  index,
  total,
  orderedIds,
}: SceneListItemProps) {
  const router = useRouter();
  const [name, setName] = useState(scene.name);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const thumb = scene.thumbnail_path
    ? publicUrl(scene.thumbnail_path)
    : null;

  useEffect(() => {
    setName(scene.name);
  }, [scene.name]);

  function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === scene.name) {
      setName(scene.name);
      return;
    }

    startTransition(async () => {
      const result = await renameScene(scene.id, trimmed);
      if (result.error) {
        toast.error(result.error);
        setName(scene.name);
        return;
      }
      router.refresh();
    });
  }

  function move(direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= total) return;

    const next = [...orderedIds];
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed);

    startTransition(async () => {
      const result = await reorderScenes(tourId, next);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      router.refresh();
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const result = await deleteScene(scene.id);
      if (result.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Scene deleted");
      setDeleteOpen(false);
      router.refresh();
    });
  }

  return (
    <>
      <li className="flex items-center gap-3 rounded-xl ring-1 ring-foreground/10 p-3">
        <div className="relative size-16 shrink-0 overflow-hidden rounded-md bg-muted">
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              fill
              className="object-cover"
              sizes="64px"
              style={{ filter: adjustmentFilter(scene) || undefined }}
            />
          ) : null}
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">#{index + 1}</span>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onBlur={saveName}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.currentTarget.blur();
                }
              }}
              disabled={pending}
              className="h-8"
            />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending || index === 0}
            onClick={() => move(-1)}
            aria-label="Move scene up"
          >
            <ArrowUpIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending || index === total - 1}
            onClick={() => move(1)}
            aria-label="Move scene down"
          >
            <ArrowDownIcon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            onClick={() => setDeleteOpen(true)}
            aria-label="Delete scene"
          >
            <Trash2Icon />
          </Button>
        </div>
      </li>

      <AlertDialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete “{scene.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes the panorama and any hotspots on this scene. This
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
