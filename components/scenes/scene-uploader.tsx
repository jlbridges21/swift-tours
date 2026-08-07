"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";

import { createScene } from "@/app/dashboard/tours/[id]/actions";
import { processPanorama, validatePanorama } from "@/lib/image";
import { isNadirLogoSource, isNadirType } from "@/lib/nadir";
import { uploadNadirPatchForScene } from "@/lib/nadir-upload";
import { createClient } from "@/lib/supabase/client";
import { compatPath, scenePath, thumbPath } from "@/lib/storage";
import { cn } from "@/lib/utils";

type UploadStage =
  | "queued"
  | "preparing"
  | "uploading"
  | "saving"
  | "done"
  | "error";

type UploadItem = {
  key: string;
  file: File;
  sceneId: string;
  position: number;
  stage: UploadStage;
  warning?: string;
  error?: string;
};

type SceneUploaderProps = {
  tourId: string;
  userId: string;
  nextPosition: number;
  /** Assign new scenes to this group; null/undefined = ungrouped. */
  groupId?: string | null;
  /** When not 'none', generate a nadir patch after each scene is created (non-blocking). */
  nadirType?: string;
  nadirLogoPath?: string | null;
  nadirLogoSource?: string;
  nadirFeather?: number;
  onNadirPatchReady?: (sceneId: string, nadirPatchPath: string) => void;
};

const CONCURRENCY = 3;

const STAGE_LABEL: Record<UploadStage, string> = {
  queued: "Queued",
  preparing: "Preparing",
  uploading: "Uploading",
  saving: "Saving",
  done: "Done",
  error: "Error",
};

function nameFromFile(file: File): string {
  return file.name.replace(/\.[^/.]+$/, "") || "Scene";
}

async function mapPool<T>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let index = 0;

  async function run(): Promise<void> {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => run()),
  );
}

export function SceneUploader({
  tourId,
  userId,
  nextPosition,
  groupId = null,
  nadirType = "none",
  nadirLogoPath = null,
  nadirLogoSource = "default",
  nadirFeather = 0.35,
  onNadirPatchReady,
}: SceneUploaderProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [dragging, setDragging] = useState(false);

  const isWorking = items.some(
    (item) => !["done", "error"].includes(item.stage),
  );

  const updateItem = useCallback((key: string, patch: Partial<UploadItem>) => {
    setItems((prev) =>
      prev.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    );
  }, []);

  const processFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;

      const batch: UploadItem[] = files.map((file, index) => ({
        key: `${file.name}-${file.size}-${file.lastModified}-${index}-${crypto.randomUUID()}`,
        file,
        sceneId: crypto.randomUUID(),
        position: nextPosition + index,
        stage: "queued" as const,
      }));

      setItems(batch);

      const outcomes = { succeeded: 0, failed: 0 };

      await mapPool(batch, CONCURRENCY, async (item) => {
        const uploadedPaths: string[] = [];
        try {
          const validation = await validatePanorama(item.file);
          if (!validation.ok) {
            outcomes.failed += 1;
            updateItem(item.key, {
              stage: "error",
              error: validation.error ?? "Invalid file.",
            });
            return;
          }

          if (validation.warning) {
            updateItem(item.key, { warning: validation.warning });
          }

          updateItem(item.key, { stage: "preparing" });
          const processed = await processPanorama(item.file, {
            width: validation.width!,
            height: validation.height!,
          });

          const storageFull = scenePath(
            userId,
            tourId,
            item.sceneId,
            processed.extension,
          );
          const storageThumb = thumbPath(userId, tourId, item.sceneId);
          const storageCompat =
            processed.compat != null
              ? compatPath(userId, tourId, item.sceneId)
              : null;
          const supabase = createClient();

          updateItem(item.key, { stage: "uploading" });

          // Original bytes uploaded as-is — no re-encode (preserves quality).
          const originalUpload = await supabase.storage
            .from("panoramas")
            .upload(storageFull, processed.original, {
              contentType: processed.contentType,
              cacheControl: "31536000",
              upsert: false,
            });
          uploadedPaths.push(storageFull);

          if (originalUpload.error) {
            await supabase.storage.from("panoramas").remove(uploadedPaths);
            outcomes.failed += 1;
            updateItem(item.key, {
              stage: "error",
              error: originalUpload.error.message,
            });
            return;
          }

          const thumbUpload = await supabase.storage
            .from("panoramas")
            .upload(storageThumb, processed.thumb, {
              contentType: "image/jpeg",
              cacheControl: "31536000",
              upsert: false,
            });
          uploadedPaths.push(storageThumb);

          if (thumbUpload.error) {
            await supabase.storage.from("panoramas").remove(uploadedPaths);
            outcomes.failed += 1;
            updateItem(item.key, {
              stage: "error",
              error: thumbUpload.error.message,
            });
            return;
          }

          if (processed.compat && storageCompat) {
            const compatUpload = await supabase.storage
              .from("panoramas")
              .upload(storageCompat, processed.compat, {
                contentType: "image/jpeg",
                cacheControl: "31536000",
                upsert: false,
              });
            uploadedPaths.push(storageCompat);

            if (compatUpload.error) {
              await supabase.storage.from("panoramas").remove(uploadedPaths);
              outcomes.failed += 1;
              updateItem(item.key, {
                stage: "error",
                error: compatUpload.error.message,
              });
              return;
            }
          }

          updateItem(item.key, { stage: "saving" });
          const result = await createScene(tourId, {
            id: item.sceneId,
            name: nameFromFile(item.file),
            storagePath: storageFull,
            thumbnailPath: storageThumb,
            compatPath: storageCompat,
            width: processed.width,
            height: processed.height,
            fileSize: processed.fileSize,
            position: item.position,
            groupId,
          });

          if (result.error) {
            await supabase.storage.from("panoramas").remove(uploadedPaths);
            outcomes.failed += 1;
            updateItem(item.key, { stage: "error", error: result.error });
            return;
          }

          outcomes.succeeded += 1;
          updateItem(item.key, { stage: "done" });

          // Non-blocking: generate nadir patch after the scene row exists.
          if (isNadirType(nadirType) && nadirType !== "none") {
            void uploadNadirPatchForScene({
              userId,
              tourId,
              scene: {
                id: item.sceneId,
                storage_path: storageFull,
                thumbnail_path: storageThumb,
                compat_path: storageCompat,
              },
              type: nadirType,
              logoSource: isNadirLogoSource(nadirLogoSource)
                ? nadirLogoSource
                : "default",
              logoPath: nadirLogoPath,
              feather: nadirFeather,
            }).then((nadirResult) => {
              if ("path" in nadirResult) {
                onNadirPatchReady?.(item.sceneId, nadirResult.path);
              } else {
                console.error(
                  "[nadir] auto-generate after upload failed",
                  nadirResult.error,
                );
              }
            });
          }
        } catch (err) {
          if (uploadedPaths.length > 0) {
            const supabase = createClient();
            await supabase.storage.from("panoramas").remove(uploadedPaths);
          }
          outcomes.failed += 1;
          updateItem(item.key, {
            stage: "error",
            error:
              err instanceof Error ? err.message : "Upload failed unexpectedly.",
          });
        }
      });

      const { succeeded, failed } = outcomes;
      if (succeeded && failed) {
        toast.message(`Uploaded ${succeeded}, ${failed} failed`);
      } else if (succeeded) {
        toast.success(
          succeeded === 1
            ? "Uploaded 1 scene"
            : `Uploaded ${succeeded} scenes`,
        );
      } else if (failed) {
        toast.error(
          failed === 1 ? "Upload failed" : `All ${failed} uploads failed`,
        );
      }

      router.refresh();
    },
    [
      nextPosition,
      groupId,
      router,
      tourId,
      updateItem,
      userId,
      nadirType,
      nadirLogoPath,
      nadirLogoSource,
      nadirFeather,
      onNadirPatchReady,
    ],
  );

  function onSelect(fileList: FileList | null) {
    if (!fileList || isWorking) return;
    void processFiles(Array.from(fileList));
  }

  return (
    <div className="flex flex-col gap-4">
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
          dragging
            ? "border-foreground bg-muted/50"
            : "border-foreground/20 bg-muted/20",
          isWorking && "pointer-events-none opacity-60",
        )}
        onDragEnter={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={(event) => {
          event.preventDefault();
          setDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          onSelect(event.dataTransfer.files);
        }}
      >
        <p className="text-sm font-medium">Drop 360° photos here</p>
        <p className="text-xs text-muted-foreground">
          JPEG or PNG · up to 200MB · original quality preserved
        </p>
        <button
          type="button"
          className="mt-2 text-sm text-foreground underline-offset-4 hover:underline"
          onClick={() => inputRef.current?.click()}
          disabled={isWorking}
        >
          or browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,.jpg,.jpeg,.png"
          multiple
          className="hidden"
          onChange={(event) => {
            onSelect(event.target.files);
            event.target.value = "";
          }}
        />
      </div>

      {items.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.key}
              className="rounded-lg border border-foreground/10 px-3 py-2"
            >
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="truncate font-medium">{item.file.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {STAGE_LABEL[item.stage]}
                </span>
              </div>
              {item.stage === "uploading" ||
              item.stage === "preparing" ||
              item.stage === "saving" ? (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-1/3 animate-pulse rounded-full bg-foreground/40" />
                </div>
              ) : null}
              {item.warning ? (
                <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                  {item.warning}
                </p>
              ) : null}
              {item.error ? (
                <p className="mt-1 text-xs text-destructive">{item.error}</p>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
