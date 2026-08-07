"use client";

import {
  ChevronLeftIcon,
  ImagesIcon,
  InfoIcon,
  Link2Icon,
  PlayIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  applyHotspotStyleToTour,
  createHotspot,
  deleteHotspot,
  updateHotspot,
} from "@/app/dashboard/tours/[id]/actions";
import { GalleryHotspotEditor } from "@/components/editor/gallery-hotspot-editor";
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
import { Textarea } from "@/components/ui/textarea";
import {
  HOTSPOT_ANIMATIONS,
  HOTSPOT_SHAPES,
  LABEL_VISIBILITIES,
  PRESET_COLORS,
  SHAPE_DISPLAY_NAMES,
  SHAPE_PREVIEW_SVG,
  clampHotspotSize,
  sanitizeHotspotColor,
  type HotspotAnimation,
  type HotspotShape,
  type LabelVisibility,
} from "@/lib/hotspot-styles";
import {
  parseYouTubeInput,
  youtubeThumbnailUrl,
} from "@/lib/youtube";
import { cn } from "@/lib/utils";
import type { Hotspot, HotspotImage, Scene } from "@/types";

type HotspotPanelProps = {
  tourId: string;
  userId: string;
  scenes: Scene[];
  hotspots: Hotspot[];
  hotspotImages: HotspotImage[];
  activeSceneId: string | null;
  selectedHotspotId: string | null;
  onSelect: (hotspotId: string | null) => void;
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  onHotspotImagesChange: (images: HotspotImage[]) => void;
  onFaceHotspot: (hotspot: Hotspot) => void;
  onPreviewGallery: (hotspotId: string) => void;
  onPreviewVideo: (hotspotId: string) => void;
};

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  return ((yaw % twoPi) + twoPi) % twoPi;
}

function reciprocalYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable=true]"),
  );
}

export function HotspotPanel({
  tourId,
  userId,
  scenes,
  hotspots,
  hotspotImages,
  activeSceneId,
  selectedHotspotId,
  onSelect,
  onHotspotsChange,
  onHotspotImagesChange,
  onFaceHotspot,
  onPreviewGallery,
  onPreviewVideo,
}: HotspotPanelProps) {
  const { run } = useSaveStatus();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sceneHotspots = useMemo(
    () =>
      activeSceneId
        ? hotspots.filter((hotspot) => hotspot.scene_id === activeSceneId)
        : [],
    [hotspots, activeSceneId],
  );

  const selected = useMemo(
    () => hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null,
    [hotspots, selectedHotspotId],
  );

  const sceneName = (id: string | null) =>
    scenes.find((scene) => scene.id === id)?.name ?? "Unknown scene";

  async function handleDelete(hotspotId: string) {
    const previous = hotspots;
    const previousImages = hotspotImages;
    onHotspotsChange(hotspots.filter((hotspot) => hotspot.id !== hotspotId));
    onHotspotImagesChange(
      hotspotImages.filter((image) => image.hotspot_id !== hotspotId),
    );
    if (selectedHotspotId === hotspotId) {
      onSelect(null);
    }

    setDeleting(true);
    const ok = await run(() => deleteHotspot(hotspotId));
    setDeleting(false);
    if (!ok) {
      onHotspotsChange(previous);
      onHotspotImagesChange(previousImages);
      toast.error("Could not delete hotspot");
      return;
    }

    setDeleteId(null);
    toast.success("Hotspot deleted");
  }

  // Delete / Backspace removes the selected hotspot (confirm first).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Delete" && event.key !== "Backspace") return;
      if (isTypingTarget(event.target)) return;
      if (!selectedHotspotId) return;
      if (selected && selected.scene_id !== activeSceneId) return;
      event.preventDefault();
      setDeleteId(selectedHotspotId);
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [selectedHotspotId, selected, activeSceneId]);

  const editing =
    selected != null && selected.scene_id === activeSceneId ? selected : null;

  return (
    <aside className="flex h-full w-full min-h-0 flex-col bg-background">
      <div className="border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {editing ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium tracking-wide text-muted-foreground uppercase hover:text-foreground"
            onClick={() => onSelect(null)}
          >
            <ChevronLeftIcon className="size-3.5" />
            Hotspots
          </button>
        ) : (
          "Hotspots"
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {editing ? (
          <HotspotEditor
            key={editing.id}
            tourId={tourId}
            userId={userId}
            hotspot={editing}
            scenes={scenes}
            onHotspotsChange={onHotspotsChange}
            allHotspots={hotspots}
            hotspotImages={hotspotImages}
            onHotspotImagesChange={onHotspotImagesChange}
            onRequestDelete={() => setDeleteId(editing.id)}
            onPreviewGallery={() => onPreviewGallery(editing.id)}
            onPreviewVideo={() => onPreviewVideo(editing.id)}
          />
        ) : !activeSceneId ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Select a scene to manage hotspots.
          </p>
        ) : sceneHotspots.length === 0 ? (
          <div className="flex flex-col gap-2 px-2 py-6 text-center">
            <p className="text-sm font-medium">No hotspots yet</p>
            <p className="text-sm text-muted-foreground">
              Use the toolbar to add a link, info, gallery, or video hotspot,
              then click the panorama to place it. Drag a marker to move it.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sceneHotspots.map((hotspot) => {
              const imageCount = hotspotImages.filter(
                (img) => img.hotspot_id === hotspot.id,
              ).length;
              const title =
                hotspot.label?.trim() ||
                (hotspot.type === "link"
                  ? `→ ${sceneName(hotspot.target_scene_id)}`
                  : hotspot.type === "gallery"
                    ? "Gallery"
                    : hotspot.type === "video"
                      ? "Video"
                      : "Info hotspot");
              const summary =
                hotspot.type === "gallery"
                  ? `${imageCount} image${imageCount === 1 ? "" : "s"}`
                  : hotspot.type === "video"
                    ? hotspot.video_id
                      ? "YouTube video"
                      : "No video yet"
                    : null;

              return (
                <li key={hotspot.id}>
                  <div className="flex w-full items-center gap-1 rounded-lg px-1 py-1 text-sm">
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/80"
                      onClick={() => {
                        onSelect(hotspot.id);
                        onFaceHotspot(hotspot);
                      }}
                    >
                      {hotspot.type === "link" ? (
                        <Link2Icon className="size-4 shrink-0 text-blue-600" />
                      ) : hotspot.type === "gallery" ? (
                        <ImagesIcon className="size-4 shrink-0 text-emerald-600" />
                      ) : hotspot.type === "video" ? (
                        <PlayIcon className="size-4 shrink-0 text-red-600" />
                      ) : (
                        <InfoIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">
                        {title}
                        {summary ? (
                          <span className="ml-1 text-xs text-muted-foreground">
                            · {summary}
                          </span>
                        ) : null}
                      </span>
                    </button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete hotspot"
                      onClick={() => setDeleteId(hotspot.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this hotspot?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (deleteId) void handleDelete(deleteId);
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

type HotspotEditorProps = {
  tourId: string;
  userId: string;
  hotspot: Hotspot;
  scenes: Scene[];
  allHotspots: Hotspot[];
  hotspotImages: HotspotImage[];
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  onHotspotImagesChange: (images: HotspotImage[]) => void;
  onRequestDelete: () => void;
  onPreviewGallery: () => void;
  onPreviewVideo: () => void;
};

function HotspotEditor({
  tourId,
  userId,
  hotspot,
  scenes,
  allHotspots,
  hotspotImages,
  onHotspotsChange,
  onHotspotImagesChange,
  onRequestDelete,
  onPreviewGallery,
  onPreviewVideo,
}: HotspotEditorProps) {
  const { run } = useSaveStatus();
  const [label, setLabel] = useState(hotspot.label ?? "");
  const [content, setContent] = useState(hotspot.content ?? "");
  const [targetSceneId, setTargetSceneId] = useState(
    hotspot.target_scene_id ?? "",
  );
  const [videoUrl, setVideoUrl] = useState(hotspot.video_id ?? "");
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoStart, setVideoStart] = useState(
    hotspot.video_start != null ? String(hotspot.video_start) : "",
  );
  const [shape, setShape] = useState<HotspotShape>(
    (hotspot.style_shape as HotspotShape) || "arrow",
  );
  const [color, setColor] = useState(sanitizeHotspotColor(hotspot.style_color));
  const [size, setSize] = useState(clampHotspotSize(hotspot.style_size));
  const [animation, setAnimation] = useState<HotspotAnimation>(
    (hotspot.style_animation as HotspotAnimation) || "pulse",
  );
  const [labelVisibility, setLabelVisibility] = useState<LabelVisibility>(
    (hotspot.label_visibility as LabelVisibility) || "hover",
  );
  const [applyOpen, setApplyOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [addingReturn, setAddingReturn] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const styleDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const galleryImages = useMemo(
    () => hotspotImages.filter((img) => img.hotspot_id === hotspot.id),
    [hotspotImages, hotspot.id],
  );

  const videoThumb = hotspot.video_id
    ? youtubeThumbnailUrl(hotspot.video_id)
    : null;

  const otherScenes = useMemo(
    () => scenes.filter((scene) => scene.id !== hotspot.scene_id),
    [scenes, hotspot.scene_id],
  );

  const hasReturnLink = useMemo(() => {
    if (hotspot.type !== "link" || !hotspot.target_scene_id) return true;
    return allHotspots.some(
      (item) =>
        item.type === "link" &&
        item.scene_id === hotspot.target_scene_id &&
        item.target_scene_id === hotspot.scene_id,
    );
  }, [allHotspots, hotspot]);

  useEffect(() => {
    setLabel(hotspot.label ?? "");
    setContent(hotspot.content ?? "");
    setTargetSceneId(hotspot.target_scene_id ?? "");
    setVideoUrl(hotspot.video_id ?? "");
    setVideoError(null);
    setVideoStart(
      hotspot.video_start != null ? String(hotspot.video_start) : "",
    );
    setShape((hotspot.style_shape as HotspotShape) || "arrow");
    setColor(sanitizeHotspotColor(hotspot.style_color));
    setSize(clampHotspotSize(hotspot.style_size));
    setAnimation((hotspot.style_animation as HotspotAnimation) || "pulse");
    setLabelVisibility(
      (hotspot.label_visibility as LabelVisibility) || "hover",
    );
  }, [
    hotspot.id,
    hotspot.label,
    hotspot.content,
    hotspot.target_scene_id,
    hotspot.video_id,
    hotspot.video_start,
    hotspot.style_shape,
    hotspot.style_color,
    hotspot.style_size,
    hotspot.style_animation,
    hotspot.label_visibility,
  ]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (styleDebounceRef.current) clearTimeout(styleDebounceRef.current);
    };
  }, []);

  function patchLocal(partial: Partial<Hotspot>) {
    onHotspotsChange(
      allHotspots.map((item) =>
        item.id === hotspot.id ? { ...item, ...partial } : item,
      ),
    );
  }

  function scheduleTextSave(next: {
    label?: string;
    content?: string;
  }) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void run(() =>
        updateHotspot(hotspot.id, {
          label: next.label !== undefined ? next.label || null : undefined,
          content:
            next.content !== undefined ? next.content || null : undefined,
        }),
      );
    }, 600);
  }

  function scheduleStyleSave(partial: {
    style_shape?: HotspotShape;
    style_color?: string;
    style_size?: number;
    style_animation?: HotspotAnimation;
    label_visibility?: LabelVisibility;
  }) {
    if (styleDebounceRef.current) clearTimeout(styleDebounceRef.current);
    styleDebounceRef.current = setTimeout(() => {
      void run(() => updateHotspot(hotspot.id, partial));
    }, 400);
  }

  async function saveTarget(nextTarget: string) {
    const previous = allHotspots;
    patchLocal({ target_scene_id: nextTarget });
    const ok = await run(() =>
      updateHotspot(hotspot.id, { targetSceneId: nextTarget }),
    );
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not update target scene");
    }
  }

  async function handleAddReturnLink() {
    if (!hotspot.target_scene_id || hasReturnLink) return;
    setAddingReturn(true);
    const id = crypto.randomUUID();
    const created: Hotspot = {
      id,
      scene_id: hotspot.target_scene_id,
      target_scene_id: hotspot.scene_id,
      type: "link",
      yaw: reciprocalYaw(hotspot.yaw),
      pitch: 0,
      label: hotspot.label,
      content: null,
      style_shape: hotspot.style_shape,
      style_color: hotspot.style_color,
      style_size: hotspot.style_size,
      style_animation: hotspot.style_animation,
      label_visibility: hotspot.label_visibility,
      video_id: null,
      video_start: null,
      created_at: new Date().toISOString(),
    };
    const previous = allHotspots;
    onHotspotsChange([...allHotspots, created]);
    const ok = await run(() =>
      createHotspot(created.scene_id, {
        id: created.id,
        type: "link",
        targetSceneId: created.target_scene_id,
        yaw: created.yaw,
        pitch: created.pitch,
        label: created.label,
      }),
    );
    setAddingReturn(false);
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not create return link");
      return;
    }
    toast.success("Return link created");
  }

  async function handleApplyToAll() {
    setApplying(true);
    const previous = allHotspots;
    const styled = {
      style_shape: shape,
      style_color: color,
      style_size: size,
      style_animation: animation,
      label_visibility: labelVisibility,
    };
    onHotspotsChange(
      allHotspots.map((item) => ({
        ...item,
        ...styled,
      })),
    );
    const ok = await run(() => applyHotspotStyleToTour(tourId, styled));
    setApplying(false);
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not apply style to all hotspots");
      return;
    }
    setApplyOpen(false);
    toast.success("Style applied to all hotspots");
  }

  async function saveVideoFromInput(raw: string) {
    const parsed = parseYouTubeInput(raw);
    if (!parsed) {
      setVideoError("Paste a YouTube URL or 11-character video id.");
      return;
    }
    setVideoError(null);
    setVideoUrl(parsed.id);
    const previous = allHotspots;
    const nextStart =
      parsed.start != null
        ? parsed.start
        : hotspot.video_start;
    if (parsed.start != null) {
      setVideoStart(String(parsed.start));
    }
    patchLocal({
      video_id: parsed.id,
      video_start: nextStart,
    });
    const ok = await run(() =>
      updateHotspot(hotspot.id, {
        video_id: parsed.id,
        video_start: nextStart,
      }),
    );
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not save video");
    }
  }

  async function saveVideoStart(raw: string) {
    const trimmed = raw.trim();
    const value =
      trimmed === ""
        ? null
        : Number.isFinite(Number(trimmed)) && Number(trimmed) >= 0
          ? Math.floor(Number(trimmed))
          : null;
    if (trimmed !== "" && value === null) {
      toast.error("Start time must be a number of seconds.");
      return;
    }
    const previous = allHotspots;
    patchLocal({ video_start: value });
    const ok = await run(() =>
      updateHotspot(hotspot.id, { video_start: value }),
    );
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not save start time");
    }
  }

  const typeLabel =
    hotspot.type === "link"
      ? "link"
      : hotspot.type === "gallery"
        ? "gallery"
        : hotspot.type === "video"
          ? "video"
          : "info";

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs font-medium text-muted-foreground uppercase">
        Edit {typeLabel}
      </p>

      {hotspot.type === "link" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`target-${hotspot.id}`}>Target scene</Label>
          <select
            id={`target-${hotspot.id}`}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={targetSceneId}
            onChange={(event) => {
              const value = event.target.value;
              setTargetSceneId(value);
              void saveTarget(value);
            }}
          >
            {otherScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`label-${hotspot.id}`}>Label</Label>
        <Input
          id={`label-${hotspot.id}`}
          value={label}
          onChange={(event) => {
            const value = event.target.value;
            setLabel(value);
            patchLocal({ label: value || null });
            scheduleTextSave({ label: value });
          }}
        />
      </div>

      {hotspot.type === "info" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`content-${hotspot.id}`}>Content</Label>
          <Textarea
            id={`content-${hotspot.id}`}
            rows={4}
            value={content}
            onChange={(event) => {
              const value = event.target.value;
              setContent(value);
              patchLocal({ content: value || null });
              scheduleTextSave({ content: value });
            }}
          />
        </div>
      ) : null}

      {hotspot.type === "gallery" ? (
        <GalleryHotspotEditor
          tourId={tourId}
          userId={userId}
          hotspotId={hotspot.id}
          images={galleryImages}
          onImagesChange={(nextForHotspot) => {
            const others = hotspotImages.filter(
              (img) => img.hotspot_id !== hotspot.id,
            );
            onHotspotImagesChange([...others, ...nextForHotspot]);
          }}
          onPreview={onPreviewGallery}
        />
      ) : null}

      {hotspot.type === "video" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={`video-${hotspot.id}`}>YouTube URL or id</Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hotspot.video_id}
              onClick={onPreviewVideo}
            >
              Preview
            </Button>
          </div>
          <Input
            id={`video-${hotspot.id}`}
            value={videoUrl}
            placeholder="https://youtu.be/… or video id"
            onChange={(event) => {
              setVideoUrl(event.target.value);
              setVideoError(null);
            }}
            onBlur={() => {
              if (videoUrl.trim() && videoUrl.trim() !== (hotspot.video_id ?? "")) {
                void saveVideoFromInput(videoUrl);
              }
            }}
            onPaste={(event) => {
              const text = event.clipboardData.getData("text");
              if (text) {
                event.preventDefault();
                setVideoUrl(text);
                void saveVideoFromInput(text);
              }
            }}
          />
          {videoError ? (
            <p className="text-xs text-destructive">{videoError}</p>
          ) : null}
          {hotspot.video_id ? (
            <div className="flex items-center gap-3 rounded-md border p-2">
              {videoThumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={videoThumb}
                  alt=""
                  className="h-14 w-24 rounded object-cover"
                />
              ) : null}
              <div className="min-w-0 text-xs">
                <p className="font-medium">Saved id</p>
                <p className="truncate font-mono text-muted-foreground">
                  {hotspot.video_id}
                </p>
              </div>
            </div>
          ) : null}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`vstart-${hotspot.id}`}>
              Start time (seconds, optional)
            </Label>
            <Input
              id={`vstart-${hotspot.id}`}
              inputMode="numeric"
              value={videoStart}
              placeholder="0"
              onChange={(event) => setVideoStart(event.target.value)}
              onBlur={() => {
                void saveVideoStart(videoStart);
              }}
            />
          </div>
        </div>
      ) : null}

      {hotspot.type === "link" && !hasReturnLink ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={addingReturn}
          onClick={() => {
            void handleAddReturnLink();
          }}
        >
          {addingReturn ? "Adding…" : "Add return link"}
        </Button>
      ) : null}

      <div className="border-t border-foreground/10 pt-3">
        <p className="mb-2 text-xs font-medium text-muted-foreground uppercase">
          Style
        </p>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label>Shape</Label>
            <div className="grid grid-cols-3 gap-1.5">
              {HOTSPOT_SHAPES.map((key) => (
                <button
                  key={key}
                  type="button"
                  title={SHAPE_DISPLAY_NAMES[key]}
                  aria-label={SHAPE_DISPLAY_NAMES[key]}
                  aria-pressed={shape === key}
                  className={cn(
                    "flex flex-col items-center gap-1 rounded-md border px-1 py-1.5 text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    shape === key
                      ? "border-foreground bg-muted"
                      : "border-transparent hover:bg-muted/60",
                  )}
                  onClick={() => {
                    setShape(key);
                    patchLocal({ style_shape: key });
                    scheduleStyleSave({ style_shape: key });
                  }}
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
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Color</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {PRESET_COLORS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  aria-label={`Color ${preset}`}
                  aria-pressed={color.toUpperCase() === preset.toUpperCase()}
                  className={cn(
                    "size-7 rounded-full border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    color.toUpperCase() === preset.toUpperCase()
                      ? "ring-2 ring-ring ring-offset-1"
                      : "border-foreground/20",
                  )}
                  style={{ backgroundColor: preset }}
                  onClick={() => {
                    const next = sanitizeHotspotColor(preset);
                    setColor(next);
                    patchLocal({ style_color: next });
                    scheduleStyleSave({ style_color: next });
                  }}
                />
              ))}
              <input
                type="color"
                aria-label="Custom color"
                value={color}
                className="size-7 cursor-pointer rounded-md border border-foreground/20 bg-transparent p-0"
                onChange={(event) => {
                  const next = sanitizeHotspotColor(event.target.value);
                  setColor(next);
                  patchLocal({ style_color: next });
                  scheduleStyleSave({ style_color: next });
                }}
              />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`size-${hotspot.id}`}>Size ({size}px)</Label>
            <input
              id={`size-${hotspot.id}`}
              type="range"
              min={16}
              max={128}
              value={size}
              className="w-full"
              onChange={(event) => {
                const next = clampHotspotSize(Number(event.target.value));
                setSize(next);
                patchLocal({ style_size: next });
                scheduleStyleSave({ style_size: next });
              }}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Animation</Label>
            <div className="flex flex-wrap gap-1">
              {HOTSPOT_ANIMATIONS.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={animation === key}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    animation === key
                      ? "bg-foreground text-background"
                      : "bg-muted hover:bg-muted/80",
                  )}
                  onClick={() => {
                    setAnimation(key);
                    patchLocal({ style_animation: key });
                    scheduleStyleSave({ style_animation: key });
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Label visibility</Label>
            <div className="flex flex-wrap gap-1">
              {LABEL_VISIBILITIES.map((key) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={labelVisibility === key}
                  className={cn(
                    "rounded-md px-2 py-1 text-xs capitalize focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    labelVisibility === key
                      ? "bg-foreground text-background"
                      : "bg-muted hover:bg-muted/80",
                  )}
                  onClick={() => {
                    setLabelVisibility(key);
                    patchLocal({ label_visibility: key });
                    scheduleStyleSave({ label_visibility: key });
                  }}
                >
                  {key}
                </button>
              ))}
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setApplyOpen(true)}
          >
            Apply this style to all hotspots in this tour
          </Button>
        </div>
      </div>

      <Button
        type="button"
        variant="destructive"
        size="sm"
        onClick={onRequestDelete}
      >
        <Trash2Icon className="size-3.5" />
        Delete hotspot
      </Button>

      <AlertDialog open={applyOpen} onOpenChange={setApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply style to all hotspots?</AlertDialogTitle>
            <AlertDialogDescription>
              This overwrites shape, color, size, animation, and label
              visibility on every hotspot in this tour.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={applying}
              onClick={() => {
                void handleApplyToAll();
              }}
            >
              {applying ? "Applying…" : "Apply to all"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
