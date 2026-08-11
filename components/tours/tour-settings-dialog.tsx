"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

import {
  listOwnedTourScenes,
  updateTour,
} from "@/app/dashboard/actions";
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

type TourSettingsDialogProps = {
  tour: TourListItem;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

type SceneOption = { id: string; name: string };

export function TourSettingsDialog({
  tour,
  open,
  onOpenChange,
}: TourSettingsDialogProps) {
  const router = useRouter();
  const [title, setTitle] = useState(tour.title);
  const [description, setDescription] = useState(tour.description ?? "");
  const [isPublic, setIsPublic] = useState(tour.is_public);
  const [coverSceneId, setCoverSceneId] = useState(tour.cover_scene_id ?? "");
  // "Same as cover" when start is null or equals cover.
  const [startSceneId, setStartSceneId] = useState(() =>
    tour.start_scene_id && tour.start_scene_id !== tour.cover_scene_id
      ? tour.start_scene_id
      : "",
  );
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [defaultShape, setDefaultShape] = useState<HotspotShape>(
    isHotspotShape(tour.default_hotspot_shape)
      ? tour.default_hotspot_shape
      : "arrow",
  );
  const [defaultColor, setDefaultColor] = useState(
    sanitizeHotspotColor(tour.default_hotspot_color),
  );
  const [pending, startTransition] = useTransition();

  function handleOpenChange(next: boolean) {
    if (next) {
      setTitle(tour.title);
      setDescription(tour.description ?? "");
      setIsPublic(tour.is_public);
      setCoverSceneId(tour.cover_scene_id ?? "");
      setStartSceneId(
        tour.start_scene_id && tour.start_scene_id !== tour.cover_scene_id
          ? tour.start_scene_id
          : "",
      );
      setDefaultShape(
        isHotspotShape(tour.default_hotspot_shape)
          ? tour.default_hotspot_shape
          : "arrow",
      );
      setDefaultColor(sanitizeHotspotColor(tour.default_hotspot_color));
      void listOwnedTourScenes(tour.id).then(setScenes);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    void listOwnedTourScenes(tour.id).then(setScenes);
  }, [open, tour.id]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const result = await updateTour(tour.id, {
        title,
        description: description.trim() ? description.trim() : null,
        is_public: isPublic,
        default_hotspot_shape: defaultShape,
        default_hotspot_color: defaultColor,
        cover_scene_id: coverSceneId || null,
        // Empty = "Same as cover" → store null so resolution falls through.
        start_scene_id: startSceneId || null,
      });

      if (result.error) {
        toast.error(result.error);
        return;
      }

      toast.success("Tour updated");
      onOpenChange(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Tour settings</DialogTitle>
          <DialogDescription>
            Update the title, description, visibility, and opening scene. Viewer
            effects live in the editor under the Effects tab.
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

          {scenes.length > 0 ? (
            <div className="flex flex-col gap-3 border-t border-foreground/10 pt-4">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`cover-${tour.id}`}>Cover scene</Label>
                <p className="text-xs text-muted-foreground">
                  Thumbnail for the dashboard card and social previews.
                </p>
                <select
                  id={`cover-${tour.id}`}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={coverSceneId}
                  disabled={pending}
                  onChange={(event) => setCoverSceneId(event.target.value)}
                >
                  <option value="">None</option>
                  {scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`start-${tour.id}`}>Start scene</Label>
                <p className="text-xs text-muted-foreground">
                  Where visitors begin the tour. Independent of the cover
                  thumbnail.
                </p>
                <select
                  id={`start-${tour.id}`}
                  className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
                  value={startSceneId}
                  disabled={pending}
                  onChange={(event) => setStartSceneId(event.target.value)}
                >
                  <option value="">Same as cover</option>
                  {scenes.map((scene) => (
                    <option key={scene.id} value={scene.id}>
                      {scene.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          ) : null}

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
