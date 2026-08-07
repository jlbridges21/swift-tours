"use client";

import {
  MapIcon,
  Trash2Icon,
  UploadIcon,
  XIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { toast } from "sonner";

import {
  assignScenesToFloorPlan,
  createFloorPlan,
  deleteFloorPlan,
  renameFloorPlan,
  updateFloorPlanGroup,
  updateScenePlanPlacement,
} from "@/app/dashboard/tours/[id]/actions";
import { useSaveStatus } from "@/components/editor/save-status";
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
import {
  FloorPlanFrame,
  floorPlanMarkerStyle,
} from "@/components/viewer/floor-plan-frame";
import {
  processFloorPlan,
  validateFloorPlan,
} from "@/lib/floor-plan-image";
import {
  clampPlanCoord,
  isScenePlaced,
  placedScenesOnPlan,
  scenesOnPlan,
  unplacedScenesOnPlan,
} from "@/lib/floor-plans";
import { createClient } from "@/lib/supabase/client";
import { floorPlanPath } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { FloorPlan, Scene, SceneGroup } from "@/types";

const DRAG_THRESHOLD_PX = 5;

type FloorPlanEditorProps = {
  tourId: string;
  userId: string;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
  onFloorPlansChange: (plans: FloorPlan[]) => void;
  onActiveSceneChange: (sceneId: string | null) => void;
  className?: string;
};

export function FloorPlanEditor({
  tourId,
  userId,
  scenes,
  groups,
  floorPlans,
  activeSceneId,
  onScenesChange,
  onFloorPlansChange,
  onActiveSceneChange,
  className,
}: FloorPlanEditorProps) {
  const { run } = useSaveStatus();
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(
    floorPlans[0]?.id ?? null,
  );
  const [placingSceneId, setPlacingSceneId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<FloorPlan | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [uploadGroupId, setUploadGroupId] = useState<string | "tour">("tour");
  const fileRef = useRef<HTMLInputElement>(null);

  const sortedPlans = useMemo(
    () => [...floorPlans].sort((a, b) => a.position - b.position),
    [floorPlans],
  );

  useEffect(() => {
    if (selectedPlanId && floorPlans.some((p) => p.id === selectedPlanId)) {
      return;
    }
    setSelectedPlanId(floorPlans[0]?.id ?? null);
  }, [floorPlans, selectedPlanId]);

  const plan = sortedPlans.find((p) => p.id === selectedPlanId) ?? null;
  const assigned = plan ? scenesOnPlan(scenes, plan.id) : [];
  const placed = plan ? placedScenesOnPlan(scenes, plan.id) : [];
  const unplaced = plan ? unplacedScenesOnPlan(scenes, plan.id) : [];

  useEffect(() => {
    if (!placingSceneId) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setPlacingSceneId(null);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [placingSceneId]);

  async function handleUpload(file: File) {
    const valid = await validateFloorPlan(file);
    if (!valid.ok) {
      toast.error(valid.error);
      return;
    }

    setUploading(true);
    try {
      const processed = await processFloorPlan(file);
      const planId = crypto.randomUUID();
      const path = floorPlanPath(userId, tourId, planId, processed.extension);
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from("panoramas")
        .upload(path, processed.blob, {
          contentType: processed.contentType,
          cacheControl: "31536000",
          upsert: false,
        });

      if (uploadError) {
        toast.error(uploadError.message);
        return;
      }

      const groupId = uploadGroupId === "tour" ? null : uploadGroupId;
      const nameFromFile =
        file.name.replace(/\.[^/.]+$/, "").trim() || "Floor plan";

      const result = await createFloorPlan(tourId, {
        id: planId,
        name: nameFromFile,
        storagePath: path,
        width: processed.width,
        height: processed.height,
        groupId,
      });

      if (result.error || !result.plan) {
        await supabase.storage.from("panoramas").remove([path]);
        toast.error(result.error ?? "Could not create floor plan");
        return;
      }

      onFloorPlansChange([...floorPlans, result.plan]);
      setSelectedPlanId(result.plan.id);
      toast.success("Floor plan uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handlePlaceAt(planX: number, planY: number) {
    if (!plan || !placingSceneId) return;

    const sceneId = placingSceneId;
    const x = clampPlanCoord(planX);
    const y = clampPlanCoord(planY);
    const previous = scenes;
    const nextUnplaced = unplaced.filter((s) => s.id !== sceneId);

    onScenesChange(
      scenes.map((scene) =>
        scene.id === sceneId
          ? {
              ...scene,
              floor_plan_id: plan.id,
              plan_x: x,
              plan_y: y,
            }
          : scene,
      ),
    );
    setPlacingSceneId(nextUnplaced[0]?.id ?? null);
    onActiveSceneChange(sceneId);

    const ok = await run(() =>
      updateScenePlanPlacement(sceneId, {
        floorPlanId: plan.id,
        planX: x,
        planY: y,
      }),
    );
    if (!ok) {
      onScenesChange(previous);
      setPlacingSceneId(sceneId);
      toast.error("Could not place scene");
    }
  }

  async function handleUnplace(sceneId: string) {
    const previous = scenes;
    onScenesChange(
      scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, plan_x: null, plan_y: null }
          : scene,
      ),
    );
    const ok = await run(() =>
      updateScenePlanPlacement(sceneId, { planX: null, planY: null }),
    );
    if (!ok) {
      onScenesChange(previous);
      toast.error("Could not unplace scene");
    }
  }

  async function handleMarkerMove(
    sceneId: string,
    planX: number,
    planY: number,
  ) {
    const x = clampPlanCoord(planX);
    const y = clampPlanCoord(planY);
    const previous = scenes;
    onScenesChange(
      scenes.map((scene) =>
        scene.id === sceneId
          ? { ...scene, plan_x: x, plan_y: y }
          : scene,
      ),
    );
    const ok = await run(() =>
      updateScenePlanPlacement(sceneId, { planX: x, planY: y }),
    );
    if (!ok) {
      onScenesChange(previous);
      toast.error("Could not move marker");
    }
  }

  async function handleAssignGroup() {
    if (!plan) return;
    const previous = scenes;
    const targetGroupId = plan.group_id;
    onScenesChange(
      scenes.map((scene) => {
        const match =
          targetGroupId === null
            ? scene.group_id === null
            : scene.group_id === targetGroupId;
        return match ? { ...scene, floor_plan_id: plan.id } : scene;
      }),
    );
    const ok = await run(() =>
      assignScenesToFloorPlan(plan.id, { groupId: targetGroupId }),
    );
    if (!ok) {
      onScenesChange(previous);
      toast.error("Could not assign scenes");
      return;
    }
    toast.success("Scenes assigned — place them on the plan");
  }

  async function handleDeletePlan(target: FloorPlan) {
    const previousPlans = floorPlans;
    const previousScenes = scenes;
    onFloorPlansChange(floorPlans.filter((p) => p.id !== target.id));
    onScenesChange(
      scenes.map((scene) =>
        scene.floor_plan_id === target.id
          ? {
              ...scene,
              floor_plan_id: null,
              plan_x: null,
              plan_y: null,
            }
          : scene,
      ),
    );
    setDeleting(true);
    const ok = await run(() => deleteFloorPlan(target.id));
    setDeleting(false);
    if (!ok) {
      onFloorPlansChange(previousPlans);
      onScenesChange(previousScenes);
      toast.error("Could not delete floor plan");
      return;
    }
    setDeleteTarget(null);
    toast.success("Floor plan deleted");
  }

  const assignLabel =
    plan?.group_id == null
      ? "Assign all ungrouped scenes to this plan"
      : `Assign all scenes in “${groups.find((g) => g.id === plan.group_id)?.name ?? "group"}” to this plan`;

  return (
    <div className={cn("flex flex-col gap-3 p-3", className)}>
      <div className="flex items-start gap-2">
        <MapIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        <div>
          <p className="text-sm font-medium">Floor plan</p>
          <p className="text-xs text-muted-foreground">
            Upload a plan, assign scenes, then place markers with one click each.
          </p>
        </div>
      </div>

      <div className="space-y-2 rounded-lg bg-muted/40 p-2">
        <Label className="text-xs">New plan applies to</Label>
        <select
          className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={uploadGroupId}
          onChange={(event) =>
            setUploadGroupId(
              event.target.value === "tour" ? "tour" : event.target.value,
            )
          }
        >
          <option value="tour">Entire tour (no group)</option>
          {groups.map((group) => (
            <option key={group.id} value={group.id}>
              Group: {group.name}
            </option>
          ))}
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void handleUpload(file);
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          disabled={uploading}
          onClick={() => fileRef.current?.click()}
        >
          <UploadIcon className="size-3.5" />
          {uploading ? "Uploading…" : "Upload plan"}
        </Button>
      </div>

      {sortedPlans.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No floor plans yet. Upload a JPG, PNG, or WebP of your floor layout.
        </p>
      ) : (
        <>
          {sortedPlans.length > 1 ? (
            <div className="space-y-1">
              <Label className="text-xs">Active plan</Label>
              <select
                className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={selectedPlanId ?? ""}
                onChange={(event) => {
                  setSelectedPlanId(event.target.value);
                  setPlacingSceneId(null);
                }}
              >
                {sortedPlans.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                    {item.group_id
                      ? ` · ${groups.find((g) => g.id === item.group_id)?.name ?? "group"}`
                      : " · tour-wide"}
                  </option>
                ))}
              </select>
            </div>
          ) : null}

          {plan ? (
            <>
              <div className="space-y-2">
                <Label className="text-xs">Name</Label>
                <Input
                  defaultValue={plan.name}
                  key={plan.id}
                  className="h-8"
                  onBlur={(event) => {
                    const trimmed = event.target.value.trim();
                    if (!trimmed || trimmed === plan.name) {
                      event.target.value = plan.name;
                      return;
                    }
                    const previous = floorPlans;
                    onFloorPlansChange(
                      floorPlans.map((item) =>
                        item.id === plan.id
                          ? { ...item, name: trimmed }
                          : item,
                      ),
                    );
                    void run(() => renameFloorPlan(plan.id, trimmed)).then(
                      (ok) => {
                        if (!ok) {
                          onFloorPlansChange(previous);
                          toast.error("Could not rename plan");
                        }
                      },
                    );
                  }}
                />
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Bound to</Label>
                <select
                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-sm"
                  value={plan.group_id ?? "tour"}
                  onChange={(event) => {
                    const next =
                      event.target.value === "tour"
                        ? null
                        : event.target.value;
                    const previous = floorPlans;
                    onFloorPlansChange(
                      floorPlans.map((item) =>
                        item.id === plan.id
                          ? { ...item, group_id: next }
                          : item,
                      ),
                    );
                    void run(() => updateFloorPlanGroup(plan.id, next)).then(
                      (ok) => {
                        if (!ok) {
                          onFloorPlansChange(previous);
                          toast.error("Could not update plan binding");
                        }
                      },
                    );
                  }}
                >
                  <option value="tour">Entire tour (no group)</option>
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      Group: {group.name}
                    </option>
                  ))}
                </select>
              </div>

              <p className="text-xs text-muted-foreground">
                {placed.length} of {assigned.length} scenes placed
                {assigned.length === 0
                  ? " — assign scenes first"
                  : null}
              </p>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="w-full"
                onClick={() => {
                  void handleAssignGroup();
                }}
              >
                {assignLabel}
              </Button>

              <PlanCanvas
                plan={plan}
                scenes={placed}
                activeSceneId={activeSceneId}
                placing={Boolean(placingSceneId)}
                onPlace={(x, y) => {
                  void handlePlaceAt(x, y);
                }}
                onSelectScene={onActiveSceneChange}
                onMoveMarker={(sceneId, x, y) => {
                  void handleMarkerMove(sceneId, x, y);
                }}
                onUnplace={(sceneId) => {
                  void handleUnplace(sceneId);
                }}
              />

              {placingSceneId ? (
                <p className="rounded-md bg-amber-500/15 px-2 py-1.5 text-xs text-amber-950 dark:text-amber-100">
                  Click the plan to place “
                  {scenes.find((s) => s.id === placingSceneId)?.name ?? "scene"}
                  ”. Esc cancels.
                </p>
              ) : null}

              {unplaced.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    Unplaced
                  </p>
                  <ul className="flex flex-col gap-1">
                    {unplaced.map((scene) => (
                      <li
                        key={scene.id}
                        className="flex items-center justify-between gap-2 rounded-md px-2 py-1 ring-1 ring-foreground/10"
                      >
                        <span className="truncate text-sm">{scene.name}</span>
                        <Button
                          type="button"
                          size="xs"
                          variant={
                            placingSceneId === scene.id
                              ? "default"
                              : "outline"
                          }
                          onClick={() =>
                            setPlacingSceneId(
                              placingSceneId === scene.id ? null : scene.id,
                            )
                          }
                        >
                          {placingSceneId === scene.id ? "Armed" : "Place"}
                        </Button>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : assigned.length > 0 ? (
                <p className="text-xs text-muted-foreground">
                  All assigned scenes are placed.
                </p>
              ) : null}

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full text-destructive hover:text-destructive"
                onClick={() => setDeleteTarget(plan)}
              >
                <Trash2Icon className="size-3.5" />
                Delete plan
              </Button>
            </>
          ) : null}
        </>
      )}

      <AlertDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Delete “{deleteTarget?.name ?? "plan"}”?
            </AlertDialogTitle>
            <AlertDialogDescription>
              The plan image is removed. Scenes stay in the tour; their markers
              on this plan are cleared.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (deleteTarget) void handleDeletePlan(deleteTarget);
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

type PlanCanvasProps = {
  plan: FloorPlan;
  scenes: Scene[];
  activeSceneId: string | null;
  placing: boolean;
  onPlace: (x: number, y: number) => void;
  onSelectScene: (sceneId: string) => void;
  onMoveMarker: (sceneId: string, x: number, y: number) => void;
  onUnplace: (sceneId: string) => void;
};

function PlanCanvas({
  plan,
  scenes,
  activeSceneId,
  placing,
  onPlace,
  onSelectScene,
  onMoveMarker,
  onUnplace,
}: PlanCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [livePositions, setLivePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  const fractionFromEvent = useCallback((clientX: number, clientY: number) => {
    const el = containerRef.current;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: clampPlanCoord((clientX - rect.left) / rect.width),
      y: clampPlanCoord((clientY - rect.top) / rect.height),
    };
  }, []);

  return (
    <div
      className={cn(
        "flex w-full justify-center overflow-hidden rounded-md bg-muted ring-1 ring-foreground/10",
        placing && "cursor-crosshair",
      )}
      onClick={(event) => {
        if (!placing) return;
        if ((event.target as HTMLElement).closest("[data-plan-marker]")) {
          return;
        }
        const frac = fractionFromEvent(event.clientX, event.clientY);
        if (frac) onPlace(frac.x, frac.y);
      }}
    >
      <div ref={containerRef} className="max-w-full">
        <FloorPlanFrame plan={plan} imageClassName="max-h-[min(50vh,420px)]">
          {scenes.map((scene) => {
            if (!isScenePlaced(scene)) return null;
            const live = livePositions[scene.id];
            const x = live?.x ?? scene.plan_x!;
            const y = live?.y ?? scene.plan_y!;
            const active = scene.id === activeSceneId;

            return (
              <PlanMarker
                key={scene.id}
                scene={scene}
                x={x}
                y={y}
                active={active}
                onSelect={() => onSelectScene(scene.id)}
                onUnplace={() => onUnplace(scene.id)}
                onLiveMove={(nx, ny) => {
                  setLivePositions((prev) => ({
                    ...prev,
                    [scene.id]: { x: nx, y: ny },
                  }));
                }}
                onCommitMove={(nx, ny) => {
                  setLivePositions((prev) => {
                    const next = { ...prev };
                    delete next[scene.id];
                    return next;
                  });
                  onMoveMarker(scene.id, nx, ny);
                }}
                fractionFromEvent={fractionFromEvent}
              />
            );
          })}
        </FloorPlanFrame>
      </div>
    </div>
  );
}

function PlanMarker({
  scene,
  x,
  y,
  active,
  onSelect,
  onUnplace,
  onLiveMove,
  onCommitMove,
  fractionFromEvent,
}: {
  scene: Scene;
  x: number;
  y: number;
  active: boolean;
  onSelect: () => void;
  onUnplace: () => void;
  onLiveMove: (x: number, y: number) => void;
  onCommitMove: (x: number, y: number) => void;
  fractionFromEvent: (
    clientX: number,
    clientY: number,
  ) => { x: number; y: number } | null;
}) {
  const draggingRef = useRef(false);
  const startRef = useRef<{
    pointerId: number;
    x: number;
    y: number;
    moved: boolean;
  } | null>(null);

  function onPointerDown(event: ReactPointerEvent<HTMLButtonElement>) {
    if (event.button === 2) return;
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    startRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
    draggingRef.current = false;
  }

  function onPointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    const dy = event.clientY - start.y;
    if (!start.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
    start.moved = true;
    draggingRef.current = true;
    const frac = fractionFromEvent(event.clientX, event.clientY);
    if (frac) onLiveMove(frac.x, frac.y);
  }

  function onPointerUp(event: ReactPointerEvent<HTMLButtonElement>) {
    const start = startRef.current;
    if (!start || start.pointerId !== event.pointerId) return;
    startRef.current = null;
    try {
      event.currentTarget.releasePointerCapture(event.pointerId);
    } catch {
      // already released
    }
    if (start.moved) {
      const frac = fractionFromEvent(event.clientX, event.clientY);
      if (frac) onCommitMove(frac.x, frac.y);
      return;
    }
    onSelect();
  }

  return (
    <div
      data-plan-marker
      className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
      style={floorPlanMarkerStyle(x, y)}
    >
      <button
        type="button"
        title={scene.name}
        aria-label={scene.name}
        className={cn(
          "relative rounded-full shadow-sm outline-none ring-2 ring-white focus-visible:ring-2 focus-visible:ring-sky-300",
          active ? "size-4 bg-sky-500" : "size-2.5 bg-neutral-950",
        )}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onContextMenu={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onUnplace();
        }}
      />
      <button
        type="button"
        aria-label={`Unplace ${scene.name}`}
        className="absolute -top-2 -right-2 flex size-3.5 items-center justify-center rounded-full bg-background text-[9px] text-muted-foreground shadow ring-1 ring-foreground/15 hover:text-foreground"
        onClick={(event) => {
          event.stopPropagation();
          onUnplace();
        }}
      >
        <XIcon className="size-2.5" />
      </button>
    </div>
  );
}
