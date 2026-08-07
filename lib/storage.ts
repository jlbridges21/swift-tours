import { createClient as createSupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

function storageClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}

/** Matches storage RLS: first folder segment must be the authenticated user id. */
export function scenePath(userId: string, tourId: string, sceneId: string): string {
  return `${userId}/${tourId}/${sceneId}.jpg`;
}

export function thumbPath(userId: string, tourId: string, sceneId: string): string {
  return `${userId}/${tourId}/${sceneId}_thumb.jpg`;
}

export function publicUrl(path: string): string {
  const { data } = storageClient().storage.from("panoramas").getPublicUrl(path);
  return data.publicUrl;
}
