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

/** Full-resolution AI-staged equirectangular panorama (JPEG). */
export function stagedPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_staged.jpg`;
}

/** 4096-wide GPU-compat for the staged variant. */
export function stagedCompatPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_staged_4k.jpg`;
}

/** Full-resolution AI-cleaned (tripod/nadir fill) equirectangular panorama. */
export function cleanedPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_cleaned.jpg`;
}

/** 4096-wide GPU-compat for the cleaned variant. */
export function cleanedCompatPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_cleaned_4k.jpg`;
}

/** Working crops/masks for an in-flight staging job. */
export function stagingWorkDir(
  userId: string,
  tourId: string,
  jobId: string,
): string {
  return `${userId}/${tourId}/staging/${jobId}`;
}

export function stagingWorkCropPath(
  userId: string,
  tourId: string,
  jobId: string,
): string {
  return `${stagingWorkDir(userId, tourId, jobId)}/crop.jpg`;
}

export function stagingWorkMaskPath(
  userId: string,
  tourId: string,
  jobId: string,
): string {
  return `${stagingWorkDir(userId, tourId, jobId)}/mask.png`;
}

/** Debug / round-trip verification output (not used by the viewer). */
export function stagingRoundtripPath(
  userId: string,
  tourId: string,
  sceneId: string,
): string {
  return `${userId}/${tourId}/${sceneId}_staging_roundtrip.jpg`;
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

/**
 * Collect all panorama objects for a scene.
 * Six logical objects when every variant exists:
 *   storage_path, compat_path, thumbnail_path, nadir_patch_path,
 *   cleaned_path, cleaned_compat_path, staged_path, staged_compat_path
 * (thumb + nadir + two AI variants + originals — audit call sites on change).
 */
export function sceneObjectPaths(scene: {
  storage_path: string;
  thumbnail_path?: string | null;
  compat_path?: string | null;
  nadir_patch_path?: string | null;
  cleaned_path?: string | null;
  cleaned_compat_path?: string | null;
  staged_path?: string | null;
  staged_compat_path?: string | null;
}): string[] {
  const paths = [scene.storage_path];
  if (scene.compat_path) paths.push(scene.compat_path);
  if (scene.thumbnail_path) paths.push(scene.thumbnail_path);
  if (scene.nadir_patch_path) paths.push(scene.nadir_patch_path);
  if (scene.cleaned_path) paths.push(scene.cleaned_path);
  if (scene.cleaned_compat_path) paths.push(scene.cleaned_compat_path);
  if (scene.staged_path) paths.push(scene.staged_path);
  if (scene.staged_compat_path) paths.push(scene.staged_compat_path);
  return paths;
}
