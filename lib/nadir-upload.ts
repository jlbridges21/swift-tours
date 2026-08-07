/**
 * Client helpers: generate a nadir patch and upload it to Storage.
 */

import { updateSceneNadirPatch } from "@/app/dashboard/tours/[id]/actions";
import {
  DEFAULT_NADIR_LOGO_URL,
  generateNadirPatch,
  nadirSamplePath,
  type NadirLogoSource,
  type NadirType,
} from "@/lib/nadir";
import { createClient } from "@/lib/supabase/client";
import { nadirPath, publicUrl } from "@/lib/storage";
import type { Scene } from "@/types";

export function resolveNadirLogoUrl(
  logoSource: NadirLogoSource | string | null | undefined,
  logoPath: string | null | undefined,
): string {
  if (logoSource === "custom" && logoPath?.trim()) {
    const path = logoPath.trim();
    if (
      path.startsWith("/") ||
      path.startsWith("http") ||
      path.startsWith("blob:")
    ) {
      return path;
    }
    return publicUrl(path);
  }
  return DEFAULT_NADIR_LOGO_URL;
}

export type NadirGenerateInput = {
  userId: string;
  tourId: string;
  scene: Pick<
    Scene,
    "id" | "storage_path" | "thumbnail_path" | "compat_path"
  >;
  type: Exclude<NadirType, "none">;
  logoSource: NadirLogoSource;
  logoPath: string | null;
  feather: number;
  /** Fired with a blob: URL as soon as generation finishes (before upload). */
  onPreviewUrl?: (sceneId: string, previewUrl: string) => void;
};

export async function uploadNadirPatchForScene(
  options: NadirGenerateInput,
): Promise<{ path: string; previewUrl: string } | { error: string }> {
  const sampleUrl = publicUrl(nadirSamplePath(options.scene));
  let blob: Blob;
  try {
    blob = await generateNadirPatch(sampleUrl, {
      type: options.type,
      logoSource: options.logoSource,
      logoUrl:
        options.type === "logo"
          ? resolveNadirLogoUrl(options.logoSource, options.logoPath)
          : undefined,
      feather: options.feather,
    });
  } catch (err) {
    return {
      error:
        err instanceof Error ? err.message : "Failed to generate nadir patch.",
    };
  }

  const previewUrl = URL.createObjectURL(blob);
  options.onPreviewUrl?.(options.scene.id, previewUrl);

  const path = nadirPath(options.userId, options.tourId, options.scene.id);
  const supabase = createClient();
  const { error: uploadError } = await supabase.storage
    .from("panoramas")
    .upload(path, blob, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: true,
    });

  if (uploadError) {
    URL.revokeObjectURL(previewUrl);
    return { error: uploadError.message };
  }

  const result = await updateSceneNadirPatch(options.scene.id, path);
  if (result.error) {
    URL.revokeObjectURL(previewUrl);
    return { error: result.error };
  }

  // Caller should apply `path` to local state, then revoke `previewUrl`.
  return { path, previewUrl };
}

export async function clearNadirPatchForScene(
  scene: Pick<Scene, "id" | "nadir_patch_path">,
): Promise<{ error?: string }> {
  return updateSceneNadirPatch(scene.id, null);
}

/** Process scenes a few at a time. */
export async function mapPool<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  async function run() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  }

  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => run(),
  );
  await Promise.all(runners);
  return results;
}
