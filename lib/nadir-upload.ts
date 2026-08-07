/**
 * Client helpers: generate a nadir patch and upload it to Storage.
 */

import { updateSceneNadirPatch } from "@/app/dashboard/tours/[id]/actions";
import {
  DEFAULT_NADIR_LOGO_URL,
  generateNadirPatch,
  type NadirType,
} from "@/lib/nadir";
import { createClient } from "@/lib/supabase/client";
import { nadirPath, publicUrl } from "@/lib/storage";
import type { Scene } from "@/types";

export function resolveNadirLogoUrl(
  logoPath: string | null | undefined,
): string {
  if (!logoPath) return DEFAULT_NADIR_LOGO_URL;
  if (logoPath.startsWith("/") || logoPath.startsWith("http")) return logoPath;
  return publicUrl(logoPath);
}

export async function uploadNadirPatchForScene(options: {
  userId: string;
  tourId: string;
  scene: Pick<Scene, "id" | "storage_path">;
  type: Exclude<NadirType, "none">;
  logoPath: string | null;
}): Promise<{ path: string } | { error: string }> {
  const panoramaUrl = publicUrl(options.scene.storage_path);
  const blob = await generateNadirPatch(panoramaUrl, {
    type: options.type,
    logoUrl:
      options.type === "logo"
        ? resolveNadirLogoUrl(options.logoPath)
        : undefined,
  });

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
    return { error: uploadError.message };
  }

  const result = await updateSceneNadirPatch(options.scene.id, path);
  if (result.error) {
    return { error: result.error };
  }

  return { path };
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
