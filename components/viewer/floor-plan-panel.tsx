"use client";

import { XIcon } from "lucide-react";
import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@/components/ui/button";
import {
  isScenePlaced,
  placedScenesOnPlan,
} from "@/lib/floor-plans";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { FloorPlan, Scene } from "@/types";

type FloorPlanPanelProps = {
  scenes: Scene[];
  floorPlans: FloorPlan[];
  currentSceneId: string | null;
  onSelectScene: (sceneId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Returns the plan for the current scene, or null when the panel should hide. */
export function resolveCurrentFloorPlan(
  scenes: Scene[],
  floorPlans: FloorPlan[],
  currentSceneId: string | null,
): FloorPlan | null {
  const current = scenes.find((scene) => scene.id === currentSceneId);
  if (!current?.floor_plan_id) return null;
  return floorPlans.find((plan) => plan.id === current.floor_plan_id) ?? null;
}

/**
 * Collapsed corner panel / expanded overlay. Parent owns open state and the
 * toolbar toggle so the Map button can sit in the existing control row.
 */
export function FloorPlanPanel({
  scenes,
  floorPlans,
  currentSceneId,
  onSelectScene,
  open,
  onOpenChange,
}: FloorPlanPanelProps) {
  const plan = resolveCurrentFloorPlan(scenes, floorPlans, currentSceneId);
  const [expanded, setExpanded] = useState(false);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduceMotion(mq.matches);
    const onChange = () => setReduceMotion(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    if (!open) setExpanded(false);
  }, [open]);

  useEffect(() => {
    if (!expanded) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setExpanded(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const markers = useMemo(() => {
    if (!plan) return [];
    return placedScenesOnPlan(scenes, plan.id);
  }, [plan, scenes]);

  if (!plan || !open) {
    return null;
  }

  const aspect =
    plan.width > 0 && plan.height > 0 ? plan.width / plan.height : 1;

  return (
    <>
      {!expanded ? (
        <div className="pointer-events-auto absolute right-3 bottom-24 z-20 w-[min(100%-1.5rem,16rem)] overflow-hidden rounded-lg bg-black/70 text-white shadow-lg ring-1 ring-white/20 backdrop-blur-sm sm:bottom-28">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-xs font-medium hover:bg-white/10"
            onClick={() => setExpanded(true)}
          >
            <span className="truncate">{plan.name}</span>
            <span className="shrink-0 text-[10px] text-white/70">Expand</span>
          </button>
          <PlanImage
            plan={plan}
            markers={markers}
            currentSceneId={currentSceneId}
            aspect={aspect}
            reduceMotion={reduceMotion}
            onSelectScene={onSelectScene}
            className="max-h-40"
          />
        </div>
      ) : (
        <div className="pointer-events-auto fixed inset-0 z-40 flex items-end justify-center bg-black/55 p-0 sm:items-center sm:p-6">
          <div
            className="relative flex max-h-[85vh] w-full max-w-3xl flex-col rounded-t-2xl bg-neutral-950 text-white shadow-2xl ring-1 ring-white/15 sm:rounded-xl"
            role="dialog"
            aria-modal="true"
            aria-label={plan.name}
          >
            <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <h2 className="truncate text-sm font-semibold">{plan.name}</h2>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="text-white hover:bg-white/10 hover:text-white"
                aria-label="Close floor plan"
                onClick={() => setExpanded(false)}
              >
                <XIcon className="size-4" />
              </Button>
            </div>
            <div className="overflow-auto p-3">
              <PlanImage
                plan={plan}
                markers={markers}
                currentSceneId={currentSceneId}
                aspect={aspect}
                reduceMotion={reduceMotion}
                onSelectScene={onSelectScene}
                className="mx-auto w-full max-w-2xl"
              />
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PlanImage({
  plan,
  markers,
  currentSceneId,
  aspect,
  reduceMotion,
  onSelectScene,
  className,
}: {
  plan: FloorPlan;
  markers: Scene[];
  currentSceneId: string | null;
  aspect: number;
  reduceMotion: boolean;
  onSelectScene: (sceneId: string) => void;
  className?: string;
}) {
  return (
    <div
      className={cn("relative w-full overflow-hidden bg-neutral-900", className)}
      style={{ aspectRatio: `${aspect}` }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={publicUrl(plan.storage_path)}
        alt={plan.name}
        className="absolute inset-0 size-full object-contain"
        draggable={false}
      />
      {markers.map((scene) => {
        if (!isScenePlaced(scene)) return null;
        const here = scene.id === currentSceneId;
        const style: CSSProperties = {
          left: `${scene.plan_x! * 100}%`,
          top: `${scene.plan_y! * 100}%`,
        };
        return (
          <button
            key={scene.id}
            type="button"
            title={here ? `${scene.name} (you are here)` : scene.name}
            aria-label={here ? `${scene.name}, you are here` : scene.name}
            aria-current={here ? "true" : undefined}
            onClick={() => onSelectScene(scene.id)}
            className={cn(
              "absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              here
                ? "size-4 bg-neutral-950"
                : "size-3 bg-sky-400/90 hover:bg-sky-300",
              here && !reduceMotion && "animate-floor-plan-pulse",
            )}
            style={style}
          />
        );
      })}
    </div>
  );
}
