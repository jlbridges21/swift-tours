"use client";

import {
  closestCorners,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
  type UniqueIdentifier,
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
import {
  ChevronDownIcon,
  FolderPlusIcon,
  GripVerticalIcon,
  MoreHorizontalIcon,
  Trash2Icon,
} from "lucide-react";
import Image from "next/image";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createGroup,
  deleteGroup,
  deleteScene,
  renameGroup,
  renameScene,
  reorderGroups,
  persistSceneContainerOrders,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { adjustmentFilter } from "@/lib/adjustments";
import {
  readCollapsedGroups,
  scenesInGroup,
  sortScenesByGroupOrder,
  UNGROUPED_KEY,
  writeCollapsedGroups,
} from "@/lib/scene-groups";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { FloorPlan, Scene, SceneGroup } from "@/types";

type SceneSidebarProps = {
  tourId: string;
  userId: string;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
  onGroupsChange: (groups: SceneGroup[]) => void;
  onFloorPlansChange: (plans: FloorPlan[]) => void;
  onActiveSceneChange: (sceneId: string | null) => void;
  nadirType?: string;
  nadirLogoPath?: string | null;
  nadirLogoSource?: string;
  nadirFeather?: number;
  onNadirPatchReady?: (sceneId: string, nadirPatchPath: string) => void;
};

function groupSortableId(groupId: string) {
  return `group:${groupId}`;
}

function parseGroupSortableId(id: UniqueIdentifier): string | null {
  const value = String(id);
  return value.startsWith("group:") ? value.slice("group:".length) : null;
}

function containerId(groupId: string | null) {
  return groupId === null ? `container:${UNGROUPED_KEY}` : `container:${groupId}`;
}

function parseContainerId(id: UniqueIdentifier): string | null | undefined {
  const value = String(id);
  if (!value.startsWith("container:")) return undefined;
  const key = value.slice("container:".length);
  return key === UNGROUPED_KEY ? null : key;
}

function findSceneContainer(
  sceneId: string,
  scenes: Scene[],
): string | null {
  return scenes.find((scene) => scene.id === sceneId)?.group_id ?? null;
}

function resolveOverContainer(
  overId: UniqueIdentifier,
  scenes: Scene[],
): string | null | undefined {
  const asContainer = parseContainerId(overId);
  if (asContainer !== undefined) return asContainer;
  const asGroup = parseGroupSortableId(overId);
  if (asGroup !== null) return asGroup;
  if (!scenes.some((scene) => scene.id === String(overId))) {
    return undefined;
  }
  return findSceneContainer(String(overId), scenes);
}

function containerSignature(
  scenes: Scene[],
  containers: Array<string | null>,
): string {
  return containers
    .map((container) =>
      scenesInGroup(scenes, container)
        .map((scene) => `${scene.id}:${scene.group_id}:${scene.position}`)
        .join(","),
    )
    .join("|");
}

export function SceneSidebar({
  tourId,
  userId,
  scenes,
  groups,
  floorPlans,
  activeSceneId,
  onScenesChange,
  onGroupsChange,
  onFloorPlansChange,
  onActiveSceneChange,
  nadirType = "none",
  nadirLogoPath = null,
  nadirLogoSource = "default",
  nadirFeather = 0.35,
  onNadirPatchReady,
}: SceneSidebarProps) {
  const { run } = useSaveStatus();
  const [deleteTarget, setDeleteTarget] = useState<Scene | null>(null);
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<SceneGroup | null>(
    null,
  );
  const [deleting, setDeleting] = useState(false);
  const [activeDragId, setActiveDragId] = useState<UniqueIdentifier | null>(
    null,
  );
  const dragOriginRef = useRef<{
    sceneId: string;
    groupId: string | null;
    scenes: Scene[];
  } | null>(null);
  const scenesRef = useRef(scenes);
  scenesRef.current = scenes;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [uploadGroupId, setUploadGroupId] = useState<string | null>(null);

  useEffect(() => {
    setCollapsed(readCollapsedGroups(tourId));
  }, [tourId]);

  useEffect(() => {
    const active = scenes.find((scene) => scene.id === activeSceneId);
    if (active) {
      setUploadGroupId(active.group_id);
    }
  }, [activeSceneId, scenes]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const sortedGroups = useMemo(
    () => [...groups].sort((a, b) => a.position - b.position),
    [groups],
  );

  const orderedScenes = useMemo(
    () => sortScenesByGroupOrder(scenes, sortedGroups),
    [scenes, sortedGroups],
  );

  const ungroupedScenes = useMemo(
    () => scenesInGroup(scenes, null),
    [scenes],
  );

  const nextPosition = useMemo(() => {
    const bucket = scenesInGroup(scenes, uploadGroupId);
    return bucket.reduce((max, scene) => Math.max(max, scene.position), -1) + 1;
  }, [scenes, uploadGroupId]);

  const activeScene =
    scenes.find((scene) => scene.id === activeSceneId) ?? null;

  const hasGroups = sortedGroups.length > 0;

  function toggleCollapsed(groupId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      writeCollapsedGroups(tourId, next);
      return next;
    });
  }

  function applySceneOrder(nextScenes: Scene[]) {
    onScenesChange(sortScenesByGroupOrder(nextScenes, sortedGroups));
  }

  async function persistContainerOrders(
    previousScenes: Scene[],
    nextScenes: Scene[],
    containers: Array<string | null>,
  ) {
    const unique = [...new Set(containers.map((c) => c ?? UNGROUPED_KEY))].map(
      (key) => (key === UNGROUPED_KEY ? null : key),
    );

    const payload = unique.map((container) => ({
      groupId: container,
      orderedSceneIds: scenesInGroup(nextScenes, container).map(
        (scene) => scene.id,
      ),
    }));

    let actionResult: Awaited<ReturnType<typeof persistSceneContainerOrders>> =
      {};
    const ok = await run(async () => {
      actionResult = await persistSceneContainerOrders(tourId, payload);
      return actionResult;
    });

    if (!ok) {
      onScenesChange(previousScenes);
      toast.error(
        actionResult.error ?? "Could not save scene group or order",
      );
      return false;
    }

    if (actionResult.scenes) {
      onScenesChange(sortScenesByGroupOrder(actionResult.scenes, sortedGroups));
    }
    return true;
  }

  function handleDragStart(event: DragStartEvent) {
    setActiveDragId(event.active.id);
    if (parseGroupSortableId(event.active.id)) {
      dragOriginRef.current = null;
      return;
    }
    const sceneId = String(event.active.id);
    const snapshot = scenesRef.current;
    if (!snapshot.some((scene) => scene.id === sceneId)) {
      dragOriginRef.current = null;
      return;
    }
    dragOriginRef.current = {
      sceneId,
      groupId: findSceneContainer(sceneId, snapshot),
      scenes: snapshot.map((scene) => ({ ...scene })),
    };
  }

  function handleDragOver(event: DragOverEvent) {
    try {
      const { active, over } = event;
      if (!over) return;
      if (parseGroupSortableId(active.id)) return;

      const activeId = String(active.id);
      if (!scenes.some((scene) => scene.id === activeId)) return;

      const overContainer = resolveOverContainer(over.id, scenes);
      if (overContainer === undefined) return;

      const activeContainer = findSceneContainer(activeId, scenes);
      if (activeContainer === overContainer) return;

      const moving = scenes.find((scene) => scene.id === activeId);
      if (!moving) return;

      const without = scenes.filter((scene) => scene.id !== activeId);
      const destScenes = scenesInGroup(without, overContainer);
      let insertIndex = destScenes.length;
      if (
        parseContainerId(over.id) === undefined &&
        parseGroupSortableId(over.id) === null
      ) {
        const overIndex = destScenes.findIndex((scene) => scene.id === over.id);
        if (overIndex >= 0) insertIndex = overIndex;
      }

      const newDest = [...destScenes];
      newDest.splice(insertIndex, 0, { ...moving, group_id: overContainer });

      const next = scenes.map((scene) => {
        if (scene.id === activeId) {
          return {
            ...scene,
            group_id: overContainer,
            position: newDest.findIndex((item) => item.id === activeId),
          };
        }
        if (scene.group_id === overContainer) {
          const position = newDest.findIndex((item) => item.id === scene.id);
          return position >= 0 ? { ...scene, position } : scene;
        }
        if (scene.group_id === activeContainer) {
          const sourceList = scenesInGroup(without, activeContainer);
          const position = sourceList.findIndex((item) => item.id === scene.id);
          return position >= 0 ? { ...scene, position } : scene;
        }
        return scene;
      });

      applySceneOrder(next);
    } catch (error) {
      console.error("[scene-sidebar] handleDragOver", error);
    }
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    const origin = dragOriginRef.current;
    dragOriginRef.current = null;
    setActiveDragId(null);

    try {
      if (!over) return;

      const draggedGroupId = parseGroupSortableId(active.id);
      if (draggedGroupId) {
        const overGroupId =
          parseGroupSortableId(over.id) ??
          (parseContainerId(over.id) !== undefined
            ? parseContainerId(over.id)
            : findSceneContainer(String(over.id), scenes));

        if (!overGroupId || overGroupId === draggedGroupId) return;

        const oldIndex = sortedGroups.findIndex((g) => g.id === draggedGroupId);
        const newIndex = sortedGroups.findIndex((g) => g.id === overGroupId);
        if (oldIndex < 0 || newIndex < 0) return;

        const previous = groups;
        const reordered = arrayMove(sortedGroups, oldIndex, newIndex).map(
          (group, position) => ({ ...group, position }),
        );
        onGroupsChange(reordered);

        let actionResult: Awaited<ReturnType<typeof reorderGroups>> = {};
        const ok = await run(async () => {
          actionResult = await reorderGroups(
            tourId,
            reordered.map((group) => group.id),
          );
          return actionResult;
        });
        if (!ok) {
          onGroupsChange(previous);
          toast.error(actionResult.error ?? "Could not save group order");
          return;
        }
        if (actionResult.groups) {
          onGroupsChange(actionResult.groups);
        }
        return;
      }

      const activeId = String(active.id);
      const latestScenes = scenesRef.current;
      if (!latestScenes.some((scene) => scene.id === activeId)) return;

      const overContainer = resolveOverContainer(over.id, latestScenes);
      if (overContainer === undefined) return;

      // Origin before onDragOver mutations — required for cross-container persist.
      const previous = origin?.scenes ?? latestScenes.map((scene) => ({ ...scene }));
      const originContainer =
        origin?.sceneId === activeId
          ? origin.groupId
          : findSceneContainer(activeId, previous);

      let next = latestScenes.map((scene) => ({ ...scene }));

      if (originContainer === overContainer) {
        const list = scenesInGroup(next, overContainer);
        const oldIndex = list.findIndex((scene) => scene.id === activeId);
        const newIndex = list.findIndex((scene) => scene.id === over.id);
        if (oldIndex < 0) return;
        const targetIndex = newIndex < 0 ? list.length - 1 : newIndex;
        if (oldIndex !== targetIndex) {
          const moved = arrayMove(list, oldIndex, targetIndex);
          next = next.map((scene) => {
            if (scene.group_id !== overContainer) return scene;
            const position = moved.findIndex((item) => item.id === scene.id);
            return position >= 0 ? { ...scene, position } : scene;
          });
        }
      } else {
        // Cross-container: rebuild destination from current over target.
        next = next.map((scene) =>
          scene.id === activeId ? { ...scene, group_id: overContainer } : scene,
        );

        const destList = scenesInGroup(
          next.filter((scene) => scene.id !== activeId),
          overContainer,
        );
        const overIndex = destList.findIndex((scene) => scene.id === over.id);
        const insertAt =
          parseContainerId(over.id) !== undefined
            ? destList.length
            : overIndex >= 0
              ? overIndex
              : destList.length;
        const moving = next.find((scene) => scene.id === activeId);
        if (!moving) return;
        destList.splice(insertAt, 0, {
          ...moving,
          group_id: overContainer,
        });

        next = next.map((scene) => {
          const destPos = destList.findIndex((item) => item.id === scene.id);
          if (destPos >= 0) {
            return { ...scene, group_id: overContainer, position: destPos };
          }
          if (scene.group_id === originContainer) {
            const sourceList = scenesInGroup(
              next.filter((s) => s.id !== activeId),
              originContainer,
            );
            const position = sourceList.findIndex(
              (item) => item.id === scene.id,
            );
            return position >= 0
              ? { ...scene, group_id: originContainer, position }
              : scene;
          }
          return scene;
        });
      }

      const containers =
        originContainer === overContainer
          ? [overContainer]
          : [originContainer, overContainer];

      const beforeSig = containerSignature(previous, containers);
      const afterSig = containerSignature(next, containers);

      if (beforeSig === afterSig) {
        return;
      }

      applySceneOrder(next);
      await persistContainerOrders(previous, next, containers);
    } catch (error) {
      console.error("[scene-sidebar] handleDragEnd", error);
      if (origin?.scenes) {
        onScenesChange(origin.scenes);
      }
      toast.error("Could not finish scene drag");
    }
  }

  async function handleDelete(scene: Scene) {
    const index = orderedScenes.findIndex((item) => item.id === scene.id);
    const previous = scenes;
    const remaining = scenes.filter((item) => item.id !== scene.id);
    onScenesChange(remaining);

    if (activeSceneId === scene.id) {
      const orderedRemaining = sortScenesByGroupOrder(remaining, sortedGroups);
      const fallback =
        orderedRemaining[
          Math.min(index, Math.max(orderedRemaining.length - 1, 0))
        ] ?? null;
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

  async function handleCreateGroup() {
    const ok = await run(async () => {
      const result = await createGroup(tourId, "New group");
      if (result.error || !result.group) {
        return { error: result.error ?? "Could not create group." };
      }
      onGroupsChange([...groups, result.group]);
      setUploadGroupId(result.group.id);
      return {};
    });
    if (!ok) {
      toast.error("Could not create group");
    }
  }

  async function handleDeleteGroup(group: SceneGroup) {
    const previousGroups = groups;
    const previousScenes = scenes;
    const previousPlans = floorPlans;
    const removedPlans = floorPlans.filter((plan) => plan.group_id === group.id);
    onGroupsChange(groups.filter((item) => item.id !== group.id));
    onFloorPlansChange(
      floorPlans.filter((plan) => plan.group_id !== group.id),
    );
    onScenesChange(
      scenes.map((scene) => {
        let next = scene;
        if (scene.group_id === group.id) {
          next = { ...next, group_id: null };
        }
        if (
          scene.floor_plan_id &&
          removedPlans.some((plan) => plan.id === scene.floor_plan_id)
        ) {
          next = {
            ...next,
            floor_plan_id: null,
            plan_x: null,
            plan_y: null,
          };
        }
        return next;
      }),
    );
    if (uploadGroupId === group.id) {
      setUploadGroupId(null);
    }

    setDeleting(true);
    const ok = await run(() => deleteGroup(group.id));
    setDeleting(false);
    if (!ok) {
      onGroupsChange(previousGroups);
      onScenesChange(previousScenes);
      onFloorPlansChange(previousPlans);
      toast.error("Could not delete group");
      return;
    }

    setDeleteGroupTarget(null);
    toast.success(
      removedPlans.length > 0
        ? "Group deleted — scenes ungrouped, linked floor plans removed"
        : "Group deleted — scenes are now ungrouped",
    );
  }

  return (
    <aside className="flex h-full min-h-0 w-full flex-col border-r bg-background lg:w-[280px] lg:shrink-0">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Scenes
        </span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs"
          onClick={() => {
            void handleCreateGroup();
          }}
        >
          <FolderPlusIcon className="size-3.5" />
          New group
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {scenes.length === 0 && !hasGroups ? (
          <div className="flex flex-col items-center gap-2 px-2 py-8 text-center">
            <p className="text-sm font-medium">No scenes yet</p>
            <p className="text-sm text-muted-foreground">
              Upload a 360° equirectangular photo below to start building this
              tour.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {scenes.length === 1 && !hasGroups ? (
              <p className="px-2 text-xs text-muted-foreground">
                Add a second scene to enable navigation hotspots between rooms.
              </p>
            ) : null}

            <DndContext
              sensors={sensors}
              collisionDetection={closestCorners}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={handleDragStart}
              onDragOver={handleDragOver}
              onDragEnd={(event) => {
                void handleDragEnd(event);
              }}
              onDragCancel={() => setActiveDragId(null)}
            >
              {!hasGroups ? (
                <SortableContext
                  items={orderedScenes.map((scene) => scene.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <SceneList
                    scenes={orderedScenes}
                    activeSceneId={activeSceneId}
                    globalOffset={0}
                    onActiveSceneChange={onActiveSceneChange}
                    onRename={async (scene, name) => {
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
                    onRequestDelete={setDeleteTarget}
                  />
                </SortableContext>
              ) : (
                <>
                  <SortableContext
                    items={sortedGroups.map((group) =>
                      groupSortableId(group.id),
                    )}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="flex flex-col gap-2">
                      {sortedGroups.map((group) => {
                        const groupScenes = scenesInGroup(scenes, group.id);
                        const isCollapsed = collapsed.has(group.id);
                        return (
                          <SortableGroupSection
                            key={group.id}
                            group={group}
                            scenes={groupScenes}
                            collapsed={isCollapsed}
                            selectedForUpload={uploadGroupId === group.id}
                            activeSceneId={activeSceneId}
                            activeDragId={activeDragId}
                            onToggleCollapse={() => toggleCollapsed(group.id)}
                            onSelectUpload={() => setUploadGroupId(group.id)}
                            onActiveSceneChange={onActiveSceneChange}
                            onRenameGroup={async (name) => {
                              const previous = groups;
                              onGroupsChange(
                                groups.map((item) =>
                                  item.id === group.id
                                    ? { ...item, name }
                                    : item,
                                ),
                              );
                              const ok = await run(() =>
                                renameGroup(group.id, name),
                              );
                              if (!ok) {
                                onGroupsChange(previous);
                                toast.error("Could not rename group");
                              }
                            }}
                            onRequestDeleteGroup={() =>
                              setDeleteGroupTarget(group)
                            }
                            onRenameScene={async (scene, name) => {
                              const previous = scenes;
                              onScenesChange(
                                scenes.map((item) =>
                                  item.id === scene.id
                                    ? { ...item, name }
                                    : item,
                                ),
                              );
                              const ok = await run(() =>
                                renameScene(scene.id, name),
                              );
                              if (!ok) {
                                onScenesChange(previous);
                                toast.error("Could not rename scene");
                              }
                            }}
                            onRequestDeleteScene={setDeleteTarget}
                          />
                        );
                      })}
                    </div>
                  </SortableContext>

                  <UngroupedSection
                    scenes={ungroupedScenes}
                    selectedForUpload={uploadGroupId === null}
                    activeSceneId={activeSceneId}
                    onSelectUpload={() => setUploadGroupId(null)}
                    onActiveSceneChange={onActiveSceneChange}
                    onRenameScene={async (scene, name) => {
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
                    onRequestDeleteScene={setDeleteTarget}
                  />
                </>
              )}
            </DndContext>
          </div>
        )}
      </div>

      <div className="space-y-2 border-t p-2">
        {hasGroups ? (
          <p className="px-1 text-[11px] text-muted-foreground">
            New uploads go to{" "}
            <span className="font-medium text-foreground">
              {uploadGroupId
                ? (sortedGroups.find((g) => g.id === uploadGroupId)?.name ??
                  "group")
                : "Ungrouped"}
            </span>
          </p>
        ) : null}
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
          groupId={uploadGroupId}
          nadirType={nadirType}
          nadirLogoPath={nadirLogoPath}
          nadirLogoSource={nadirLogoSource}
          nadirFeather={nadirFeather}
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

      <AlertDialog
        open={deleteGroupTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteGroupTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleteGroupTarget?.name ?? "group"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Scenes in this group will not be deleted — they become ungrouped.
              You can reassign them later.
              {deleteGroupTarget &&
              floorPlans.some(
                (plan) => plan.group_id === deleteGroupTarget.id,
              ) ? (
                <>
                  {" "}
                  Floor plans bound to this group will also be deleted (their
                  images are removed).
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (deleteGroupTarget) void handleDeleteGroup(deleteGroupTarget);
              }}
            >
              {deleting ? "Deleting…" : "Delete group"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

function SceneList({
  scenes,
  activeSceneId,
  globalOffset,
  onActiveSceneChange,
  onRename,
  onRequestDelete,
}: {
  scenes: Scene[];
  activeSceneId: string | null;
  globalOffset: number;
  onActiveSceneChange: (sceneId: string | null) => void;
  onRename: (scene: Scene, name: string) => Promise<void>;
  onRequestDelete: (scene: Scene) => void;
}) {
  return (
    <ul
      className="flex flex-col gap-1"
      role="listbox"
      aria-label="Tour scenes"
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        event.preventDefault();
        const index = scenes.findIndex((scene) => scene.id === activeSceneId);
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
          index={globalOffset + index}
          active={scene.id === activeSceneId}
          onSelect={() => onActiveSceneChange(scene.id)}
          onRename={(name) => onRename(scene, name)}
          onRequestDelete={() => onRequestDelete(scene)}
        />
      ))}
    </ul>
  );
}

function SortableGroupSection({
  group,
  scenes,
  collapsed,
  selectedForUpload,
  activeSceneId,
  activeDragId,
  onToggleCollapse,
  onSelectUpload,
  onActiveSceneChange,
  onRenameGroup,
  onRequestDeleteGroup,
  onRenameScene,
  onRequestDeleteScene,
}: {
  group: SceneGroup;
  scenes: Scene[];
  collapsed: boolean;
  selectedForUpload: boolean;
  activeSceneId: string | null;
  activeDragId: UniqueIdentifier | null;
  onToggleCollapse: () => void;
  onSelectUpload: () => void;
  onActiveSceneChange: (sceneId: string | null) => void;
  onRenameGroup: (name: string) => Promise<void>;
  onRequestDeleteGroup: () => void;
  onRenameScene: (scene: Scene, name: string) => Promise<void>;
  onRequestDeleteScene: (scene: Scene) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: groupSortableId(group.id),
    data: { type: "group", groupId: group.id },
  });

  const [name, setName] = useState(group.name);
  useEffect(() => {
    setName(group.name);
  }, [group.name]);

  const dropId = containerId(group.id);
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: dropId,
    data: { type: "container", groupId: group.id },
  });

  const draggingScene =
    activeDragId != null &&
    parseGroupSortableId(activeDragId) === null &&
    String(activeDragId) !== dropId;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "rounded-lg ring-1 ring-foreground/10",
        isDragging && "z-10 opacity-80 shadow-md",
        selectedForUpload && "ring-foreground/25",
      )}
    >
      <div className="flex items-center gap-1 px-1.5 py-1.5">
        <button
          type="button"
          className="touch-none text-muted-foreground hover:text-foreground"
          aria-label="Drag to reorder group"
          {...attributes}
          {...listeners}
        >
          <GripVerticalIcon className="size-4" />
        </button>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground"
          aria-expanded={!collapsed}
          aria-label={collapsed ? "Expand group" : "Collapse group"}
          onClick={onToggleCollapse}
        >
          <ChevronDownIcon
            className={cn(
              "size-4 transition-transform",
              collapsed && "-rotate-90",
            )}
          />
        </button>
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={onSelectUpload}
        >
          <Input
            value={name}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => {
              const trimmed = name.trim();
              if (!trimmed || trimmed === group.name) {
                setName(group.name);
                return;
              }
              void onRenameGroup(trimmed);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            className="h-7 px-1.5 text-sm font-medium"
            aria-label="Group name"
          />
        </button>
        <span className="shrink-0 pr-1 text-[11px] text-muted-foreground tabular-nums">
          {scenes.length}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                className="shrink-0"
              />
            }
          >
            <MoreHorizontalIcon className="size-3.5" />
            <span className="sr-only">Group actions</span>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-32">
            <DropdownMenuItem
              onClick={() => {
                const next = window.prompt("Rename group", group.name);
                if (next == null) return;
                const trimmed = next.trim();
                if (!trimmed || trimmed === group.name) return;
                void onRenameGroup(trimmed);
              }}
            >
              Rename
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              onClick={onRequestDeleteGroup}
            >
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {!collapsed ? (
        <div
          ref={setDropRef}
          className={cn(
            "min-h-8 border-t border-foreground/5 px-1 py-1",
            isOver && draggingScene && "bg-muted/60",
          )}
        >
          <SortableContext
            items={scenes.map((scene) => scene.id)}
            strategy={verticalListSortingStrategy}
          >
            {scenes.length === 0 ? (
              <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
                Drop scenes here
              </p>
            ) : (
              <SceneList
                scenes={scenes}
                activeSceneId={activeSceneId}
                globalOffset={0}
                onActiveSceneChange={onActiveSceneChange}
                onRename={onRenameScene}
                onRequestDelete={onRequestDeleteScene}
              />
            )}
          </SortableContext>
        </div>
      ) : null}
    </div>
  );
}

function UngroupedSection({
  scenes,
  selectedForUpload,
  activeSceneId,
  onSelectUpload,
  onActiveSceneChange,
  onRenameScene,
  onRequestDeleteScene,
}: {
  scenes: Scene[];
  selectedForUpload: boolean;
  activeSceneId: string | null;
  onSelectUpload: () => void;
  onActiveSceneChange: (sceneId: string | null) => void;
  onRenameScene: (scene: Scene, name: string) => Promise<void>;
  onRequestDeleteScene: (scene: Scene) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: containerId(null),
    data: { type: "container", groupId: null },
  });

  return (
    <div
      className={cn(
        "rounded-lg ring-1 ring-dashed ring-foreground/15",
        selectedForUpload && "ring-foreground/30",
      )}
    >
      <button
        type="button"
        className="flex w-full items-center justify-between px-2.5 py-2 text-left"
        onClick={onSelectUpload}
      >
        <span className="text-xs font-medium text-muted-foreground">
          Ungrouped
        </span>
        <span className="text-[11px] text-muted-foreground tabular-nums">
          {scenes.length}
        </span>
      </button>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-8 border-t border-foreground/5 px-1 py-1",
          isOver && "bg-muted/60",
        )}
      >
        <SortableContext
          items={scenes.map((scene) => scene.id)}
          strategy={verticalListSortingStrategy}
        >
          {scenes.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-muted-foreground">
              Drag here to ungroup
            </p>
          ) : (
            <SceneList
              scenes={scenes}
              activeSceneId={activeSceneId}
              globalOffset={0}
              onActiveSceneChange={onActiveSceneChange}
              onRename={onRenameScene}
              onRequestDelete={onRequestDeleteScene}
            />
          )}
        </SortableContext>
      </div>
    </div>
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
  } = useSortable({
    id: scene.id,
    data: { type: "scene", groupId: scene.group_id },
  });

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
              style={{ filter: adjustmentFilter(scene) || undefined }}
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
