"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
  copySceneAdjustmentsToTour,
  updateSceneAdjustments,
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
import { Label } from "@/components/ui/label";
import {
  DEFAULT_ADJUSTMENTS,
  clampBrightness,
  clampContrast,
  clampSaturation,
  isDefaultAdjustments,
  type SceneAdjustments,
} from "@/lib/adjustments";
import { cn } from "@/lib/utils";
import type { Scene } from "@/types";

type AdjustmentsPanelProps = {
  tourId: string;
  scenes: Scene[];
  activeSceneId: string | null;
  onScenesChange: (scenes: Scene[]) => void;
  /** Press-and-hold before/after: true while showing the unadjusted image. */
  onHoldUnadjusted: (holding: boolean) => void;
  className?: string;
};

function formatValue(value: number): string {
  return value.toFixed(2);
}

export function AdjustmentsPanel({
  tourId,
  scenes,
  activeSceneId,
  onScenesChange,
  onHoldUnadjusted,
  className,
}: AdjustmentsPanelProps) {
  const { run } = useSaveStatus();
  const [copyOpen, setCopyOpen] = useState(false);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeScene =
    scenes.find((scene) => scene.id === activeSceneId) ?? null;

  useEffect(() => {
    return () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      onHoldUnadjusted(false);
    };
  }, [onHoldUnadjusted]);

  function patchScene(next: SceneAdjustments) {
    if (!activeScene) return;
    onScenesChange(
      scenes.map((scene) =>
        scene.id === activeScene.id ? { ...scene, ...next } : scene,
      ),
    );

    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      void run(() =>
        updateSceneAdjustments(activeScene.id, {
          adjust_brightness: next.adjust_brightness,
          adjust_contrast: next.adjust_contrast,
          adjust_saturation: next.adjust_saturation,
        }),
      );
    }, 400);
  }

  function setField<K extends keyof SceneAdjustments>(
    key: K,
    value: number,
  ) {
    if (!activeScene) return;
    const next = {
      adjust_brightness: activeScene.adjust_brightness,
      adjust_contrast: activeScene.adjust_contrast,
      adjust_saturation: activeScene.adjust_saturation,
      [key]: value,
    };
    patchScene(next);
  }

  function resetAll() {
    patchScene({ ...DEFAULT_ADJUSTMENTS });
  }

  async function handleCopyToAll() {
    if (!activeScene) return;
    const values: SceneAdjustments = {
      adjust_brightness: activeScene.adjust_brightness,
      adjust_contrast: activeScene.adjust_contrast,
      adjust_saturation: activeScene.adjust_saturation,
    };
    const previous = scenes;
    onScenesChange(scenes.map((scene) => ({ ...scene, ...values })));
    setCopyOpen(false);

    const ok = await run(() =>
      copySceneAdjustmentsToTour(tourId, activeScene.id),
    );
    if (!ok) {
      onScenesChange(previous);
      toast.error("Could not copy adjustments");
      return;
    }
    toast.success("Adjustments copied to all scenes");
  }

  if (!activeScene) {
    return (
      <div className={cn("p-3 text-sm text-muted-foreground", className)}>
        Select a scene to adjust brightness, contrast, and saturation.
      </div>
    );
  }

  const values: SceneAdjustments = {
    adjust_brightness: activeScene.adjust_brightness,
    adjust_contrast: activeScene.adjust_contrast,
    adjust_saturation: activeScene.adjust_saturation,
  };

  return (
    <div className={cn("flex flex-col gap-4 p-3", className)}>
      <div>
        <h2 className="text-sm font-semibold tracking-tight">Adjustments</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Brightness, contrast, and saturation for this scene. Applied live —
          the original panorama is never modified.
        </p>
      </div>

      <AdjustmentSlider
        label="Brightness"
        min={0.5}
        max={1.5}
        step={0.01}
        value={values.adjust_brightness}
        defaultValue={1}
        onChange={(v) => setField("adjust_brightness", clampBrightness(v))}
      />
      <AdjustmentSlider
        label="Contrast"
        min={0.5}
        max={1.5}
        step={0.01}
        value={values.adjust_contrast}
        defaultValue={1}
        onChange={(v) => setField("adjust_contrast", clampContrast(v))}
      />
      <AdjustmentSlider
        label="Saturation"
        min={0}
        max={2}
        step={0.01}
        value={values.adjust_saturation}
        defaultValue={1}
        onChange={(v) => setField("adjust_saturation", clampSaturation(v))}
      />

      <div className="flex flex-col gap-2 border-t pt-3">
        <Button
          type="button"
          variant="outline"
          className="w-full select-none"
          onPointerDown={(event) => {
            event.preventDefault();
            onHoldUnadjusted(true);
          }}
          onPointerUp={() => onHoldUnadjusted(false)}
          onPointerLeave={() => onHoldUnadjusted(false)}
          onPointerCancel={() => onHoldUnadjusted(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          Hold to compare (before)
        </Button>

        <Button
          type="button"
          variant="outline"
          className="w-full"
          disabled={isDefaultAdjustments(values)}
          onClick={resetAll}
        >
          Reset all
        </Button>

        <Button
          type="button"
          className="w-full"
          disabled={scenes.length < 2}
          onClick={() => setCopyOpen(true)}
        >
          Copy to all scenes
        </Button>
      </div>

      <AlertDialog open={copyOpen} onOpenChange={setCopyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Copy adjustments to all scenes?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces brightness, contrast, and saturation on every scene
              in this tour with the values from “{activeScene.name}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void handleCopyToAll();
              }}
            >
              Copy to all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function AdjustmentSlider({
  label,
  min,
  max,
  step,
  value,
  defaultValue,
  onChange,
}: {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  defaultValue: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label
          className="cursor-default text-xs"
          title="Double-click to reset"
          onDoubleClick={() => onChange(defaultValue)}
        >
          {label}
        </Label>
        <span className="text-xs tabular-nums text-muted-foreground">
          {formatValue(value)}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        title="Double-click to reset"
        onDoubleClick={() => onChange(defaultValue)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="w-full accent-foreground"
      />
    </div>
  );
}
