"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import type { Scene } from "@/types";

export type SceneActionResult = {
  error?: string;
};

function editorPath(tourId: string) {
  return `/dashboard/tours/${tourId}/edit`;
}

async function requireOwnedTour(tourId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "You must be signed in." as const,
      supabase,
      user: null,
      tour: null,
    };
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .select("id, owner_id, cover_scene_id")
    .eq("id", tourId)
    .maybeSingle();

  if (error) {
    return { error: error.message, supabase, user: null, tour: null };
  }

  if (!tour || tour.owner_id !== user.id) {
    return { error: "Tour not found.", supabase, user: null, tour: null };
  }

  return { error: null, supabase, user, tour };
}

export async function createScene(
  tourId: string,
  input: {
    id: string;
    name: string;
    storagePath: string;
    thumbnailPath: string;
    position: number;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase, tour } = owned;

  const { error: insertError } = await supabase.from("scenes").insert({
    id: input.id,
    tour_id: tourId,
    name: input.name,
    storage_path: input.storagePath,
    thumbnail_path: input.thumbnailPath,
    position: input.position,
  });

  if (insertError) {
    return { error: insertError.message };
  }

  if (!tour.cover_scene_id) {
    const { error: coverError } = await supabase
      .from("tours")
      .update({ cover_scene_id: input.id })
      .eq("id", tourId);

    if (coverError) {
      return { error: coverError.message };
    }
  }

  revalidatePath(editorPath(tourId));
  revalidatePath("/dashboard");
  return {};
}

export async function renameScene(
  sceneId: string,
  name: string,
): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Scene name is required." };
  }

  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select("id, tour_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return { error: sceneError.message };
  }

  if (!scene) {
    return { error: "Scene not found." };
  }

  const owned = await requireOwnedTour(scene.tour_id);
  if (owned.error) {
    return { error: owned.error };
  }

  const { error } = await supabase
    .from("scenes")
    .update({ name: trimmed })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(scene.tour_id));
  return {};
}

export async function deleteScene(sceneId: string): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select("id, tour_id, storage_path, thumbnail_path")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return { error: sceneError.message };
  }

  if (!scene) {
    return { error: "Scene not found." };
  }

  const owned = await requireOwnedTour(scene.tour_id);
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  // Delete storage objects before the row — paths are lost once the row is gone.
  const paths = [scene.storage_path];
  if (scene.thumbnail_path) {
    paths.push(scene.thumbnail_path);
  }

  const { error: storageError } = await supabase.storage
    .from("panoramas")
    .remove(paths);

  if (storageError) {
    return { error: storageError.message };
  }

  const wasCover = owned.tour.cover_scene_id === sceneId;

  const { error: deleteError } = await supabase
    .from("scenes")
    .delete()
    .eq("id", sceneId);

  if (deleteError) {
    return { error: deleteError.message };
  }

  if (wasCover) {
    const { data: nextCover, error: nextError } = await supabase
      .from("scenes")
      .select("id")
      .eq("tour_id", scene.tour_id)
      .order("position", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (nextError) {
      return { error: nextError.message };
    }

    const { error: coverError } = await supabase
      .from("tours")
      .update({ cover_scene_id: nextCover?.id ?? null })
      .eq("id", scene.tour_id);

    if (coverError) {
      return { error: coverError.message };
    }
  }

  revalidatePath(editorPath(scene.tour_id));
  revalidatePath("/dashboard");
  return {};
}

export async function reorderScenes(
  tourId: string,
  orderedSceneIds: string[],
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase } = owned;

  const { data: existing, error: fetchError } = await supabase
    .from("scenes")
    .select("*")
    .eq("tour_id", tourId);

  if (fetchError) {
    return { error: fetchError.message };
  }

  const byId = new Map((existing ?? []).map((scene) => [scene.id, scene]));
  const upserts: Scene[] = [];

  for (const [position, id] of orderedSceneIds.entries()) {
    const scene = byId.get(id);
    if (!scene) {
      return { error: "One or more scenes were not found." };
    }
    upserts.push({ ...scene, position });
  }

  const { error } = await supabase.from("scenes").upsert(upserts);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(tourId));
  return {};
}

export async function updateSceneInitialView(
  sceneId: string,
  yaw: number,
  pitch: number,
): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const { data: scene, error: sceneError } = await supabase
    .from("scenes")
    .select("id, tour_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return { error: sceneError.message };
  }

  if (!scene) {
    return { error: "Scene not found." };
  }

  const owned = await requireOwnedTour(scene.tour_id);
  if (owned.error) {
    return { error: owned.error };
  }

  const { error } = await supabase
    .from("scenes")
    .update({
      initial_yaw: yaw,
      initial_pitch: pitch,
    })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(scene.tour_id));
  return {};
}

export async function updateTourTitle(
  tourId: string,
  title: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const trimmed = title.trim();
  if (!trimmed) {
    return { error: "Title is required." };
  }

  const { error } = await owned.supabase
    .from("tours")
    .update({ title: trimmed })
    .eq("id", tourId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(tourId));
  revalidatePath("/dashboard");
  return {};
}

async function requireOwnedScene(sceneId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "You must be signed in." as const,
      supabase,
      user: null,
      scene: null,
      tour: null,
    };
  }

  const { data: scene, error } = await supabase
    .from("scenes")
    .select("id, tour_id")
    .eq("id", sceneId)
    .maybeSingle();

  if (error) {
    return {
      error: error.message,
      supabase,
      user: null,
      scene: null,
      tour: null,
    };
  }

  if (!scene) {
    return {
      error: "Scene not found.",
      supabase,
      user: null,
      scene: null,
      tour: null,
    };
  }

  const owned = await requireOwnedTour(scene.tour_id);
  if (owned.error || !owned.tour) {
    return {
      error: owned.error ?? "Unauthorized.",
      supabase,
      user: null,
      scene: null,
      tour: null,
    };
  }

  return { error: null, supabase, user, scene, tour: owned.tour };
}

async function requireOwnedHotspot(hotspotId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "You must be signed in." as const,
      supabase,
      hotspot: null,
      scene: null,
    };
  }

  const { data: hotspot, error } = await supabase
    .from("hotspots")
    .select("id, scene_id")
    .eq("id", hotspotId)
    .maybeSingle();

  if (error) {
    return { error: error.message, supabase, hotspot: null, scene: null };
  }

  if (!hotspot) {
    return {
      error: "Hotspot not found.",
      supabase,
      hotspot: null,
      scene: null,
    };
  }

  const owned = await requireOwnedScene(hotspot.scene_id);
  if (owned.error || !owned.scene) {
    return {
      error: owned.error ?? "Unauthorized.",
      supabase,
      hotspot: null,
      scene: null,
    };
  }

  return { error: null, supabase, hotspot, scene: owned.scene };
}

export async function createHotspot(
  sceneId: string,
  input: {
    id: string;
    type: "link" | "info";
    targetSceneId?: string | null;
    yaw: number;
    pitch: number;
    label?: string | null;
    content?: string | null;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedScene(sceneId);
  if (owned.error || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  if (input.type === "link") {
    if (!input.targetSceneId) {
      return { error: "A link hotspot needs a target scene." };
    }
    if (input.targetSceneId === sceneId) {
      return { error: "A link cannot target its own scene." };
    }
  }

  const { error } = await owned.supabase.from("hotspots").insert({
    id: input.id,
    scene_id: sceneId,
    type: input.type,
    target_scene_id: input.type === "link" ? input.targetSceneId : null,
    yaw: input.yaw,
    pitch: input.pitch,
    label: input.label ?? null,
    content: input.type === "info" ? (input.content ?? null) : null,
  });

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(owned.scene.tour_id));
  return {};
}

export async function updateHotspot(
  hotspotId: string,
  patch: {
    type?: "link" | "info";
    targetSceneId?: string | null;
    yaw?: number;
    pitch?: number;
    label?: string | null;
    content?: string | null;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.hotspot || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const update: {
    type?: string;
    target_scene_id?: string | null;
    yaw?: number;
    pitch?: number;
    label?: string | null;
    content?: string | null;
  } = {};

  if (patch.type !== undefined) update.type = patch.type;
  if (patch.targetSceneId !== undefined) {
    update.target_scene_id = patch.targetSceneId;
  }
  if (patch.yaw !== undefined) update.yaw = patch.yaw;
  if (patch.pitch !== undefined) update.pitch = patch.pitch;
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.content !== undefined) update.content = patch.content;

  if (update.type === "info") {
    update.target_scene_id = null;
  }

  const { error } = await owned.supabase
    .from("hotspots")
    .update(update)
    .eq("id", hotspotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(owned.scene.tour_id));
  return {};
}

export async function deleteHotspot(
  hotspotId: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.hotspot || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { error } = await owned.supabase
    .from("hotspots")
    .delete()
    .eq("id", hotspotId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath(editorPath(owned.scene.tour_id));
  return {};
}
