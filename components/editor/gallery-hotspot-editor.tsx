"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVerticalIcon, Trash2Icon, UploadIcon } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import {
  createHotspotImage,
  deleteHotspotImage,
  reorderHotspotImages,
  updateHotspotImage,
} from "@/app/dashboard/tours/[id]/actions";
import { useSaveStatus } from "@/components/editor/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  GALLERY_MAX_IMAGES,
  GALLERY_UPLOAD_CONCURRENCY,
  mapPool,
  processGalleryImage,
  validateGalleryImage,
} from "@/lib/gallery-image";
import { createClient } from "@/lib/supabase/client";
import { galleryPath, galleryThumbPath, publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { HotspotImage } from "@/types";

type UploadStatus = {
  id: string;
  name: string;
  stage: "queued" | "preparing" | "uploading" | "saving" | "done" | "error";
  error?: string;
};

type GalleryHotspotEditorProps = {
  tourId: string;
  userId: string;
  hotspotId: string;
  images: HotspotImage[];
  onImagesChange: (images: HotspotImage[]) => void;
  onPreview?: () => void;
};

export function GalleryHotspotEditor({
  tourId,
  userId,
  hotspotId,
  images,
  onImagesChange,
  onPreview,
}: GalleryHotspotEditorProps) {
  const { run } = useSaveStatus();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploads, setUploads] = useState<UploadStatus[]>([]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const ordered = [...images].sort((a, b) => a.position - b.position);
  const atLimit = ordered.length >= GALLERY_MAX_IMAGES;
  const uploading = uploads.some(
    (item) => item.stage !== "done" && item.stage !== "error",
  );

  function patchUpload(id: string, patch: Partial<UploadStatus>) {
    setUploads((prev) =>
      prev.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    const remaining = GALLERY_MAX_IMAGES - ordered.length;
    if (remaining <= 0) {
      toast.error(`Galleries are limited to ${GALLERY_MAX_IMAGES} images.`);
      return;
    }

    const files = Array.from(fileList).slice(0, remaining);
    if (fileList.length > remaining) {
      toast.message(
        `Only ${remaining} more image${remaining === 1 ? "" : "s"} fit in this gallery.`,
      );
    }

    const jobs = files.map((file) => ({
      id: crypto.randomUUID(),
      file,
    }));
    setUploads(
      jobs.map((job) => ({
        id: job.id,
        name: job.file.name,
        stage: "queued",
      })),
    );

    const supabase = createClient();
    let nextPosition =
      ordered.reduce((max, img) => Math.max(max, img.position), -1) + 1;
    const created: HotspotImage[] = [];

    await mapPool(jobs, GALLERY_UPLOAD_CONCURRENCY, async (job) => {
      const valid = await validateGalleryImage(job.file);
      if (!valid.ok) {
        patchUpload(job.id, { stage: "error", error: valid.error });
        return;
      }

      patchUpload(job.id, { stage: "preparing" });
      let processed;
      try {
        processed = await processGalleryImage(job.file);
      } catch {
        patchUpload(job.id, {
          stage: "error",
          error: "Could not process image.",
        });
        return;
      }

      const storagePath = galleryPath(userId, tourId, job.id);
      const thumbPath = galleryThumbPath(userId, tourId, job.id);

      patchUpload(job.id, { stage: "uploading" });
      const { error: fullError } = await supabase.storage
        .from("panoramas")
        .upload(storagePath, processed.full, {
          contentType: processed.contentType,
          upsert: false,
        });
      if (fullError) {
        patchUpload(job.id, { stage: "error", error: fullError.message });
        return;
      }

      const { error: thumbError } = await supabase.storage
        .from("panoramas")
        .upload(thumbPath, processed.thumb, {
          contentType: processed.contentType,
          upsert: false,
        });
      if (thumbError) {
        await supabase.storage.from("panoramas").remove([storagePath]);
        patchUpload(job.id, { stage: "error", error: thumbError.message });
        return;
      }

      const position = nextPosition++;
      patchUpload(job.id, { stage: "saving" });
      const result = await createHotspotImage(hotspotId, {
        id: job.id,
        storagePath,
        thumbnailPath: thumbPath,
        position,
      });

      if (result.error) {
        await supabase.storage
          .from("panoramas")
          .remove([storagePath, thumbPath]);
        patchUpload(job.id, { stage: "error", error: result.error });
        return;
      }

      created.push({
        id: job.id,
        hotspot_id: hotspotId,
        storage_path: storagePath,
        thumbnail_path: thumbPath,
        caption: null,
        position,
        created_at: new Date().toISOString(),
      });
      patchUpload(job.id, { stage: "done" });
    });

    if (created.length > 0) {
      onImagesChange([...ordered, ...created]);
      toast.success(
        created.length === 1
          ? "Image added"
          : `${created.length} images added`,
      );
    }

    window.setTimeout(() => {
      setUploads((prev) =>
        prev.filter((item) => item.stage !== "done" && item.stage !== "error"),
      );
    }, 1500);

    if (inputRef.current) inputRef.current.value = "";
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = ordered.findIndex((img) => img.id === active.id);
    const newIndex = ordered.findIndex((img) => img.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(ordered, oldIndex, newIndex).map(
      (img, index) => ({ ...img, position: index }),
    );
    const previous = images;
    onImagesChange(reordered);

    const ok = await run(() =>
      reorderHotspotImages(
        hotspotId,
        reordered.map((img) => ({ id: img.id, position: img.position })),
      ),
    );
    if (!ok) {
      onImagesChange(previous);
      toast.error("Could not reorder images");
    }
  }

  async function handleCaption(imageId: string, caption: string) {
    const previous = images;
    onImagesChange(
      images.map((img) =>
        img.id === imageId ? { ...img, caption: caption || null } : img,
      ),
    );
    const ok = await run(() =>
      updateHotspotImage(imageId, { caption: caption || null }),
    );
    if (!ok) {
      onImagesChange(previous);
      toast.error("Could not update caption");
    }
  }

  async function handleDelete(imageId: string) {
    const previous = images;
    onImagesChange(images.filter((img) => img.id !== imageId));
    const ok = await run(() => deleteHotspotImage(imageId));
    if (!ok) {
      onImagesChange(previous);
      toast.error("Could not delete image");
      return;
    }
    toast.success("Image deleted");
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">Images</Label>
        {onPreview ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={ordered.length === 0}
            onClick={onPreview}
          >
            Preview
          </Button>
        ) : null}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        multiple
        className="sr-only"
        disabled={atLimit || uploading}
        onChange={(event) => {
          void handleFiles(event.target.files);
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={atLimit || uploading}
        onClick={() => inputRef.current?.click()}
      >
        <UploadIcon className="size-3.5" />
        {atLimit
          ? `Limit ${GALLERY_MAX_IMAGES} images`
          : uploading
            ? "Uploading…"
            : "Add images"}
      </Button>

      {atLimit ? (
        <p className="text-xs text-muted-foreground">
          This gallery is full ({GALLERY_MAX_IMAGES} images). Delete one to add
          more.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          JPG, PNG, or WebP. Up to {GALLERY_MAX_IMAGES} images.
        </p>
      )}

      {uploads.length > 0 ? (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {uploads.map((item) => (
            <li key={item.id}>
              {item.name}:{" "}
              {item.stage === "error" ? item.error ?? "failed" : item.stage}
            </li>
          ))}
        </ul>
      ) : null}

      {ordered.length > 0 ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={(event) => {
            void handleDragEnd(event);
          }}
        >
          <SortableContext
            items={ordered.map((img) => img.id)}
            strategy={rectSortingStrategy}
          >
            <ul className="flex flex-col gap-2">
              {ordered.map((image) => (
                <SortableGalleryImage
                  key={image.id}
                  image={image}
                  onCaption={(value) => {
                    void handleCaption(image.id, value);
                  }}
                  onDelete={() => {
                    void handleDelete(image.id);
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      ) : (
        <p className="rounded-md border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
          No images yet. Upload photos to build this gallery.
        </p>
      )}
    </div>
  );
}

function SortableGalleryImage({
  image,
  onCaption,
  onDelete,
}: {
  image: HotspotImage;
  onCaption: (value: string) => void;
  onDelete: () => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: image.id });

  const [caption, setCaption] = useState(image.caption ?? "");

  return (
    <li
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
      }}
      className={cn(
        "flex gap-2 rounded-lg border bg-background p-2",
        isDragging && "z-10 opacity-90 shadow-md",
      )}
    >
      <button
        type="button"
        className="mt-1 touch-none text-muted-foreground hover:text-foreground"
        aria-label="Drag to reorder"
        {...attributes}
        {...listeners}
      >
        <GripVerticalIcon className="size-4" />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={publicUrl(image.thumbnail_path ?? image.storage_path)}
        alt=""
        className="size-14 shrink-0 rounded object-cover"
      />
      <div className="min-w-0 flex-1 space-y-1">
        <Input
          value={caption}
          placeholder="Caption (optional)"
          className="h-8 text-xs"
          onChange={(event) => setCaption(event.target.value)}
          onBlur={() => {
            if ((image.caption ?? "") !== caption) {
              onCaption(caption);
            }
          }}
        />
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label="Delete image"
        onClick={onDelete}
      >
        <Trash2Icon />
      </Button>
    </li>
  );
}
