"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTourEffects } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import {
  INTRO_EFFECTS,
  TRANSITION_EFFECTS,
  isIntroEffect,
  isTransitionEffect,
  type IntroEffect,
  type TransitionEffect,
  type ViewerEffectsSettings,
} from "@/lib/viewer-effects";
import type { Tour } from "@/types";

const INTRO_LABELS: Record<IntroEffect, string> = {
  none: "None",
  little_planet: "Little planet",
};

const TRANSITION_LABELS: Record<TransitionEffect, string> = {
  none: "None (cut)",
  fade: "Fade",
  black: "Fade through black",
  white: "Fade through white",
};

export type TourEffectsFields = {
  intro_effect: string;
  transition_effect: string;
  transition_speed: number;
  transition_zoom: boolean;
  transition_rotation: boolean;
  gyroscope_enabled: boolean;
  vr_enabled: boolean;
};

type EffectsPanelProps = {
  tourId: string;
  values: TourEffectsFields;
  onChange: (next: TourEffectsFields) => void;
  /** Bump public/preview intro replay. */
  onReplayIntro?: () => void;
  className?: string;
};

export function effectsFieldsFromTour(tour: Tour): TourEffectsFields {
  return {
    intro_effect: isIntroEffect(tour.intro_effect) ? tour.intro_effect : "none",
    transition_effect: isTransitionEffect(tour.transition_effect)
      ? tour.transition_effect
      : "fade",
    transition_speed: tour.transition_speed ?? 1500,
    transition_zoom: tour.transition_zoom ?? true,
    transition_rotation: tour.transition_rotation ?? true,
    gyroscope_enabled: tour.gyroscope_enabled ?? true,
    vr_enabled: tour.vr_enabled ?? true,
  };
}

export function viewerEffectsFromFields(
  values: TourEffectsFields,
): ViewerEffectsSettings {
  return {
    introEffect: isIntroEffect(values.intro_effect)
      ? values.intro_effect
      : "none",
    transition: {
      effect: isTransitionEffect(values.transition_effect)
        ? values.transition_effect
        : "fade",
      speed: values.transition_speed,
      zoom: values.transition_zoom,
      rotation: values.transition_rotation,
    },
    gyroscopeEnabled: values.gyroscope_enabled,
    vrEnabled: values.vr_enabled,
  };
}

export function EffectsPanel({
  tourId,
  values,
  onChange,
  onReplayIntro,
  className,
}: EffectsPanelProps) {
  const [pending, startTransition] = useTransition();
  const [local, setLocal] = useState(values);

  useEffect(() => {
    setLocal(values);
  }, [values]);

  function update<K extends keyof TourEffectsFields>(
    key: K,
    value: TourEffectsFields[K],
  ) {
    const next = { ...local, [key]: value };
    setLocal(next);
    onChange(next);
    startTransition(async () => {
      const result = await updateTourEffects(tourId, { [key]: value });
      if (result.error) {
        toast.error(result.error);
        setLocal(values);
        onChange(values);
      }
    });
  }

  const intro = isIntroEffect(local.intro_effect)
    ? local.intro_effect
    : "none";
  const transition = isTransitionEffect(local.transition_effect)
    ? local.transition_effect
    : "fade";

  return (
    <div className={cn("flex flex-col gap-4 p-3", className)}>
      <div>
        <p className="text-sm font-medium">Viewer effects</p>
        <p className="text-xs text-muted-foreground">
          Intro and transitions apply on the public tour and preview. Gyro and
          VR buttons only appear on phones.
        </p>
      </div>

      <div className="space-y-2">
        <Label className="text-xs">Intro effect</Label>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
          {INTRO_EFFECTS.map((value) => (
            <button
              key={value}
              type="button"
              disabled={pending}
              className={cn(
                "rounded-md px-2 py-1.5 text-xs font-medium",
                intro === value
                  ? "bg-background shadow-sm"
                  : "text-muted-foreground",
              )}
              onClick={() => update("intro_effect", value)}
            >
              {INTRO_LABELS[value]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={intro !== "little_planet" || pending}
            onClick={() => onReplayIntro?.()}
          >
            Replay in editor
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="flex-1"
            disabled={intro !== "little_planet"}
            nativeButton={false}
            render={
              <Link
                href={`/dashboard/tours/${tourId}/preview`}
                target="_blank"
                rel="noreferrer"
              />
            }
          >
            Preview
          </Button>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`fx-transition-${tourId}`} className="text-xs">
          Transition
        </Label>
        <select
          id={`fx-transition-${tourId}`}
          className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
          value={transition}
          disabled={pending}
          onChange={(event) => {
            const value = event.target.value;
            if (isTransitionEffect(value)) {
              update("transition_effect", value);
            }
          }}
        >
          {TRANSITION_EFFECTS.map((value) => (
            <option key={value} value={value}>
              {TRANSITION_LABELS[value]}
            </option>
          ))}
        </select>
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs font-normal">
            Speed ({local.transition_speed} ms)
          </Label>
          <span className="text-xs tabular-nums text-muted-foreground">
            300–5000
          </span>
        </div>
        <input
          type="range"
          min={300}
          max={5000}
          step={50}
          value={local.transition_speed}
          disabled={pending}
          onChange={(event) =>
            update("transition_speed", Number(event.target.value))
          }
          className="w-full accent-foreground"
        />
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor={`fx-tz-${tourId}`}
            className="flex-1 text-xs font-normal"
          >
            Zoom through (toward hotspot)
          </Label>
          <Switch
            id={`fx-tz-${tourId}`}
            checked={local.transition_zoom}
            onCheckedChange={(checked) => update("transition_zoom", checked)}
            disabled={pending}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor={`fx-tr-${tourId}`}
            className="flex-1 text-xs font-normal"
          >
            Rotate toward hotspot
          </Label>
          <Switch
            id={`fx-tr-${tourId}`}
            checked={local.transition_rotation}
            onCheckedChange={(checked) =>
              update("transition_rotation", checked)
            }
            disabled={pending}
          />
        </div>
      </div>

      <div className="space-y-3 border-t border-foreground/10 pt-3">
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor={`fx-gyro-${tourId}`}
            className="flex-1 text-xs font-normal"
          >
            Allow gyroscope control
          </Label>
          <Switch
            id={`fx-gyro-${tourId}`}
            checked={local.gyroscope_enabled}
            onCheckedChange={(checked) =>
              update("gyroscope_enabled", checked)
            }
            disabled={pending}
          />
        </div>
        <div className="flex items-center justify-between gap-4">
          <Label
            htmlFor={`fx-vr-${tourId}`}
            className="flex-1 text-xs font-normal"
          >
            Allow VR / stereo mode
          </Label>
          <Switch
            id={`fx-vr-${tourId}`}
            checked={local.vr_enabled}
            onCheckedChange={(checked) => update("vr_enabled", checked)}
            disabled={pending}
          />
        </div>
      </div>
    </div>
  );
}
