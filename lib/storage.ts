import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

function storageClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Matches storage RLS: first folder segment must be the authenticated user id. */
export function scenePath(
  userId: string,
  tourId: string,
  sceneId: string,
  extension: ".jpg" | ".png" | string = ".jpg",
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${userId}/${tourId}/${sceneId}${ext}`;
}

/** 4096-wide GPU-compat fallback (always JPEG). */
export function compatPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_4k.jpg`;
}

export function thumbPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_thumb.jpg`;
}

/** Per-scene generated nadir (floor) patch PNG. */
export function nadirPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_nadir.png`;
}

/** Floor plan image under the tour folder (RLS-safe via userId prefix). */
export function floorPlanPath(
  userId: string,
  tourId: string,
  planId: string,
  extension: ".jpg" | string = ".jpg",
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${userId}/${tourId}/plans/${planId}${ext}`;
}

/** Gallery full-size JPEG under the tour folder. */
export function galleryPath(
  userId: string,
  tourId: string,
  imageId: string,
): string {
  return `${userId}/${tourId}/gallery/${imageId}.jpg`;
}

/** Gallery thumbnail JPEG. */
export function galleryThumbPath(
  userId: string,
  tourId: string,
  imageId: string,
): string {
  return `${userId}/${tourId}/gallery/${imageId}_thumb.jpg`;
}

/** Collect storage objects for a gallery slide. */
export function galleryImageObjectPaths(image: {
  storage_path: string;
  thumbnail_path?: string | null;
}): string[] {
  const paths = [image.storage_path];
  if (image.thumbnail_path) paths.push(image.thumbnail_path);
  return paths;
}

/** Custom branding logo under the user's folder (RLS-safe). */
export function brandingLogoPath(
  userId: string,
  fileId: string,
  extension: ".png" | ".svg" | string = ".png",
): string {
  const ext = extension.startsWith(".") ? extension : `.${extension}`;
  return `${userId}/branding/${fileId}${ext}`;
}

export function publicUrl(path: string): string {
  const { data } = storageClient().storage.from("panoramas").getPublicUrl(path);
  return data.publicUrl;
}

/** Collect all panorama objects for a scene (full, compat, thumb, nadir). */
export function sceneObjectPaths(scene: {
  storage_path: string;
  thumbnail_path?: string | null;
  compat_path?: string | null;
  nadir_patch_path?: string | null;
}): string[] {
  const paths = [scene.storage_path];
  if (scene.compat_path) paths.push(scene.compat_path);
  if (scene.thumbnail_path) paths.push(scene.thumbnail_path);
  if (scene.nadir_patch_path) paths.push(scene.nadir_patch_path);
  return paths;
}
