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

export function publicUrl(path: string): string {
  const { data } = storageClient().storage.from("panoramas").getPublicUrl(path);
  return data.publicUrl;
}

/** Collect all panorama objects for a scene (full, compat, thumb). */
export function sceneObjectPaths(scene: {
  storage_path: string;
  thumbnail_path?: string | null;
  compat_path?: string | null;
}): string[] {
  const paths = [scene.storage_path];
  if (scene.compat_path) paths.push(scene.compat_path);
  if (scene.thumbnail_path) paths.push(scene.thumbnail_path);
  return paths;
}
