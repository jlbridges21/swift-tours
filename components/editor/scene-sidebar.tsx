"use client";

import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, Trash2Icon } from "lucide-react";
import Image from "next/image";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import {
  deleteScene,
  renameScene,
  reorderScenes,
  updateSceneNadirDisabled,
} from "@/app/dashboard/tours/[id]/actions";
import { useSaveStatus } from "@/components/editor/save-status";
import { SceneUploader } from "@/components/scenes/scene-uploader";
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
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Scene } from "@/types";

type SceneSidebarProps = {
  tourId: string;
  userId: string;
  scenes: Scene[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
  onActiveSceneChange: (sceneId: string | null) => void;
  nadirType?: string;
  nadirLogoPath?: string | null;
  onNadirPatchReady?: (sceneId: string, nadirPatchPath: string) => void;
};

export function SceneSidebar({
  tourId,
  userId,
  scenes,
  activeSceneId,
  onScenesChange,
  onActiveSceneChange,
  nadirType = "none",
  nadirLogoPath = null,
  onNadirPatchReady,
}: SceneSidebarProps) {
  const { run } = useSaveStatus();
  const [deleteTarget, setDeleteTarget] = useState<Scene | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const nextPosition =
    scenes.reduce((max, scene) => Math.max(max, scene.position), -1) + 1;

  const activeScene =
    scenes.find((scene) => scene.id === activeSceneId) ?? null;

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = scenes.findIndex((scene) => scene.id === active.id);
    const newIndex = scenes.findIndex((scene) => scene.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const previous = scenes;
    const reordered = arrayMove(scenes, oldIndex, newIndex).map(
      (scene, position) => ({ ...scene, position }),
    );
    onScenesChange(reordered);

    const ok = await run(() =>
      reorderScenes(
        tourId,
        reordered.map((scene) => scene.id),
      ),
    );

    if (!ok) {
      onScenesChange(previous);
      toast.error("Could not save scene order");
    }
  }

  async function handleDelete(scene: Scene) {
    const index = scenes.findIndex((item) => item.id === scene.id);
    const previous = scenes;
    const remaining = scenes.filter((item) => item.id !== scene.id);
    onScenesChange(remaining);

    if (activeSceneId === scene.id) {
      const fallback =
        remaining[Math.min(index, Math.max(remaining.length - 1, 0))] ?? null;
      onActiveSceneChange(fallback?.id ?? null);
    }

    setDeleting(true);
    const ok = await run(() => deleteScene(scene.id));
    setDeleting(false);
    if (!ok) {
      onScenesChange(previous);
      onActiveSceneChange(activeSceneId);
      toast.error("Could not delete scene");
      return;
    }

    setDeleteTarget(null);
    toast.success("Scene deleted");
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-background lg:w-[280px] lg:shrink-0">
      <div className="border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Scenes
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {scenes.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <p className="text-sm font-medium">No scenes yet</p>
            <p className="text-sm text-muted-foreground">
              Upload a 360° equirectangular photo below to start building this
              tour.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {scenes.length === 1 ? (
              <p className="px-2 text-xs text-muted-foreground">
                Add a second scene to enable navigation hotspots between rooms.
              </p>
            ) : null}
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragEnd={(event) => {
                void handleDragEnd(event);
              }}
            >
              <SortableContext
                items={scenes.map((scene) => scene.id)}
                strategy={verticalListSortingStrategy}
              >
                <ul
                  className="flex flex-col gap-1"
                  role="listbox"
                  aria-label="Tour scenes"
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") {
                      return;
                    }
                    event.preventDefault();
                    const index = scenes.findIndex(
                      (scene) => scene.id === activeSceneId,
                    );
                    const nextIndex =
                      event.key === "ArrowDown"
                        ? Math.min(scenes.length - 1, Math.max(0, index) + 1)
                        : Math.max(0, (index < 0 ? 0 : index) - 1);
                    onActiveSceneChange(scenes[nextIndex]?.id ?? null);
                  }}
                >
                  {scenes.map((scene, index) => (
                    <SortableSceneItem
                      key={scene.id}
                      scene={scene}
                      index={index}
                      active={scene.id === activeSceneId}
                      onSelect={() => onActiveSceneChange(scene.id)}
                      onRename={async (name) => {
                        const previous = scenes;
                        onScenesChange(
                          scenes.map((item) =>
                            item.id === scene.id ? { ...item, name } : item,
                          ),
                        );
                        const ok = await run(() => renameScene(scene.id, name));
                        if (!ok) {
                          onScenesChange(previous);
                          toast.error("Could not rename scene");
                        }
                      }}
                      onRequestDelete={() => setDeleteTarget(scene)}
                    />
                  ))}
                </ul>
              </SortableContext>
            </DndContext>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t p-2">
        {activeScene && nadirType !== "none" ? (
          <div className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2 py-2">
            <Label
              htmlFor="nadir-disabled"
              className="text-xs leading-snug text-muted-foreground"
            >
              Disable nadir patch for this scene
            </Label>
            <Switch
              id="nadir-disabled"
              checked={activeScene.nadir_disabled}
              onCheckedChange={(checked) => {
                const previous = scenes;
                onScenesChange(
                  scenes.map((scene) =>
                    scene.id === activeScene.id
                      ? { ...scene, nadir_disabled: checked }
                      : scene,
                  ),
                );
                void run(() =>
                  updateSceneNadirDisabled(activeScene.id, checked),
                ).then((ok) => {
                  if (!ok) {
                    onScenesChange(previous);
                    toast.error("Could not update nadir setting");
                  }
                });
              }}
            />
          </div>
        ) : null}
        <SceneUploader
          tourId={tourId}
          userId={userId}
          nextPosition={nextPosition}
          nadirType={nadirType}
          nadirLogoPath={nadirLogoPath}
          onNadirPatchReady={onNadirPatchReady}
        />
      </div>

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleteTarget?.name ?? "scene"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This removes the panorama and any hotspots on this scene. This
              cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (deleteTarget) void handleDelete(deleteTarget);
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

type SortableSceneItemProps = {
  scene: Scene;
  index: number;
  active: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onRequestDelete: () => void;
};

function SortableSceneItem({
  scene,
  index,
  active,
  onSelect,
  onRename,
  onRequestDelete,
}: SortableSceneItemProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: scene.id });

  const [name, setName] = useState(scene.name);
  const thumb = scene.thumbnail_path
    ? publicUrl(scene.thumbnail_path)
    : null;

  useEffect(() => {
    setName(scene.name);
  }, [scene.name]);

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex items-start gap-1 rounded-lg p-1.5 ring-1 ring-transparent",
        active && "bg-muted ring-foreground/10",
        isDragging && "z-10 bg-background shadow-md",
      )}
    >
      <button
        type="button"
        className="mt-2 touch-none text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>

      <button
        type="button"
        className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={onSelect}
        role="option"
        aria-selected={active}
      >
        <div className="relative mt-0.5 size-12 shrink-0 overflow-hidden rounded-md bg-muted">
          {thumb ? (
            <Image
              src={thumb}
              alt=""
              fill
              className="object-cover"
              sizes="48px"
            />
          ) : null}
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-[11px] text-muted-foreground">#{index + 1}</p>
          <Input
            value={name}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed || trimmed === scene.name) {
                setName(scene.name);
                return;
              }
              void onRename(trimmed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="h-7 px-1.5 text-sm"
          />
        </div>
      </button>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="mt-1 shrink-0"
        aria-label={`Delete ${scene.name}`}
        onClick={(event) => {
          event.stopPropagation();
          onRequestDelete();
        }}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}
