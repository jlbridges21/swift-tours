"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";

import { updateTour } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatViewCount } from "@/lib/format";
import {
  HOTSPOT_SHAPES,
  PRESET_COLORS,
  SHAPE_DISPLAY_NAMES,
  SHAPE_PREVIEW_SVG,
  isHotspotShape,
  sanitizeHotspotColor,
  type HotspotShape,
} from "@/lib/hotspot-styles";
import type { TourListItem } from "@/lib/queries/tours";
import { cn } from "@/lib/utils";
import {
  INTRO_EFFECTS,
  TRANSITION_EFFECTS,
  isIntroEffect,
  isTransitionEffect,
  type IntroEffect,
  type TransitionEffect,
} from "@/lib/viewer-effects";

type TourSettingsDialogProps = {
  tour: TourListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

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

export function TourSettingsDialog({
  tour,
  open,
  onOpenChange,
}: TourSettingsDialogProps) {
  const [title, setTitle] = useState(tour.title);
  const [description, setDescription] = useState(tour.description ?? "");
  const [isPublic, setIsPublic] = useState(tour.is_public);
  const [defaultShape, setDefaultShape] = useState<HotspotShape>(
    isHotspotShape(tour.default_hotspot_shape)
      ? tour.default_hotspot_shape
      : "arrow",
  );
  const [defaultColor, setDefaultColor] = useState(
    sanitizeHotspotColor(tour.default_hotspot_color),
  );
  const [introEffect, setIntroEffect] = useState<IntroEffect>(
    isIntroEffect(tour.intro_effect) ? tour.intro_effect : "none",
  );
  const [transitionEffect, setTransitionEffect] = useState<TransitionEffect>(
    isTransitionEffect(tour.transition_effect)
      ? tour.transition_effect
      : "fade",
  );
  const [transitionSpeed, setTransitionSpeed] = useState(
    tour.transition_speed ?? 1500,
  );
  const [transitionZoom, setTransitionZoom] = useState(
    tour.transition_zoom ?? true,
  );
  const [transitionRotation, setTransitionRotation] = useState(
    tour.transition_rotation ?? true,
  );
  const [gyroscopeEnabled, setGyroscopeEnabled] = useState(
    tour.gyroscope_enabled ?? true,
  );
  const [vrEnabled, setVrEnabled] = useState(tour.vr_enabled ?? true);
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(tour.title);
      setDescription(tour.description ?? "");
      setIsPublic(tour.is_public);
      setDefaultShape(
        isHotspotShape(tour.default_hotspot_shape)
          ? tour.default_hotspot_shape
          : "arrow",
      );
      setDefaultColor(sanitizeHotspotColor(tour.default_hotspot_color));
      setIntroEffect(
        isIntroEffect(tour.intro_effect) ? tour.intro_effect : "none",
      );
      setTransitionEffect(
        isTransitionEffect(tour.transition_effect)
          ? tour.transition_effect
          : "fade",
      );
      setTransitionSpeed(tour.transition_speed ?? 1500);
      setTransitionZoom(tour.transition_zoom ?? true);
      setTransitionRotation(tour.transition_rotation ?? true);
      setGyroscopeEnabled(tour.gyroscope_enabled ?? true);
      setVrEnabled(tour.vr_enabled ?? true);
    }
    onOpenChange(next);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateTour(tour.id, {
        title,
        description: description.trim() ? description.trim() : null,
        is_public: isPublic,
        default_hotspot_shape: defaultShape,
        default_hotspot_color: defaultColor,
        intro_effect: introEffect,
        transition_effect: transitionEffect,
        transition_speed: transitionSpeed,
        transition_zoom: transitionZoom,
        transition_rotation: transitionRotation,
        gyroscope_enabled: gyroscopeEnabled,
        vr_enabled: vrEnabled,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Tour updated");
      onOpenChange(false);
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tour settings</DialogTitle>
          <DialogDescription>
            Update the title, description, visibility, and viewer effects.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          {formatViewCount(tour.view_count)}
        </p>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor={`title-${tour.id}`}>Title</Label>
            <Input
              id={`title-${tour.id}`}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={`description-${tour.id}`}>Description</Label>
            <Textarea
              id={`description-${tour.id}`}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              disabled={pending}
            />
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor={`public-${tour.id}`} className="flex-1 font-normal">
              Public — anyone with the link can view
            </Label>
            <Switch
              id={`public-${tour.id}`}
              checked={isPublic}
              onCheckedChange={setIsPublic}
              disabled={pending}
            />
          </div>

          <div className="flex flex-col gap-2 border-t border-foreground/10 pt-4">
            <Label>Default hotspot style</Label>
            <p className="text-xs text-muted-foreground">
              Applies only to new hotspots. Existing markers keep their current
              style.
            </p>
            <div className="grid grid-cols-3 gap-1.5">
              {HOTSPOT_SHAPES.map((key) => (
                <button
                  key={key}
                  type="button"
                  disabled={pending}
                  title={SHAPE_DISPLAY_NAMES[key]}
                  aria-label={SHAPE_DISPLAY_NAMES[key]}
                  aria-pressed={defaultShape === key}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    defaultShape === key
                      ? "border-foreground bg-muted"
                      : "border-transparent hover:bg-muted/60",
                  )}
                  onClick={() => setDefaultShape(key)}
                >
                  <span
                    className="text-foreground"
                    dangerouslySetInnerHTML={{
                      __html: SHAPE_PREVIEW_SVG[key],
                    }}
                  />
                  <span className="truncate">{SHAPE_DISPLAY_NAMES[key]}</span>
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={pending}
                  aria-label={`Default color ${preset}`}
                  aria-pressed={
                    defaultColor.toUpperCase() === preset.toUpperCase()
                  }
                  className={cn(
                    "size-7 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
                    defaultColor.toUpperCase() === preset.toUpperCase()
                      ? "ring-2 ring-ring ring-offset-1"
                      : "border-foreground/20",
                  )}
                  style={{ backgroundColor: preset }}
                  onClick={() => setDefaultColor(sanitizeHotspotColor(preset))}
                />
              ))}
              <input
                type="color"
                aria-label="Custom default color"
                value={defaultColor}
                disabled={pending}
                className="size-7 cursor-pointer rounded-md border border-foreground/20 bg-transparent p-0 disabled:opacity-50"
                onChange={(event) =>
                  setDefaultColor(sanitizeHotspotColor(event.target.value))
                }
              />
            </div>
          </div>

          <div className="flex flex-col gap-3 border-t border-foreground/10 pt-4">
            <div>
              <Label>Effects</Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Gyroscope and VR buttons only appear on phones — missing them on
                desktop is expected.
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
                      introEffect === value
                        ? "bg-background shadow-sm"
                        : "text-muted-foreground",
                    )}
                    onClick={() => setIntroEffect(value)}
                  >
                    {INTRO_LABELS[value]}
                  </button>
                ))}
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={introEffect !== "little_planet"}
                nativeButton={false}
                render={
                  <Link
                    href={`/dashboard/tours/${tour.id}/preview`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Replay intro
              </Button>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`transition-${tour.id}`} className="text-xs">
                Transition
              </Label>
              <select
                id={`transition-${tour.id}`}
                className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                value={transitionEffect}
                disabled={pending}
                onChange={(event) => {
                  const value = event.target.value;
                  if (isTransitionEffect(value)) setTransitionEffect(value);
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
                  Speed ({transitionSpeed} ms)
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
                value={transitionSpeed}
                disabled={pending}
                onChange={(event) =>
                  setTransitionSpeed(Number(event.target.value))
                }
                className="w-full accent-foreground"
              />
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor={`tz-${tour.id}`}
                  className="flex-1 text-xs font-normal"
                >
                  Zoom through (toward hotspot)
                </Label>
                <Switch
                  id={`tz-${tour.id}`}
                  checked={transitionZoom}
                  onCheckedChange={setTransitionZoom}
                  disabled={pending}
                />
              </div>
              <div className="flex items-center justify-between gap-4">
                <Label
                  htmlFor={`tr-${tour.id}`}
                  className="flex-1 text-xs font-normal"
                >
                  Rotate toward hotspot
                </Label>
                <Switch
                  id={`tr-${tour.id}`}
                  checked={transitionRotation}
                  onCheckedChange={setTransitionRotation}
                  disabled={pending}
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-4">
              <Label
                htmlFor={`gyro-${tour.id}`}
                className="flex-1 text-xs font-normal"
              >
                Allow gyroscope control
              </Label>
              <Switch
                id={`gyro-${tour.id}`}
                checked={gyroscopeEnabled}
                onCheckedChange={setGyroscopeEnabled}
                disabled={pending}
              />
            </div>
            <div className="flex items-center justify-between gap-4">
              <Label
                htmlFor={`vr-${tour.id}`}
                className="flex-1 text-xs font-normal"
              >
                Allow cardboard VR (stereo)
              </Label>
              <Switch
                id={`vr-${tour.id}`}
                checked={vrEnabled}
                onCheckedChange={setVrEnabled}
                disabled={pending}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
