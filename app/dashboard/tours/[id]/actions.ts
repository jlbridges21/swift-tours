"use server";

import { revalidatePath } from "next/cache";

import {
  DEFAULT_ANIMATION,
  DEFAULT_LABEL_VISIBILITY,
  DEFAULT_SIZE,
  HEX_COLOR_RE,
  defaultShapeForHotspotType,
  isHotspotShape,
  isHotspotType,
  sanitizeHotspotColor,
  validateStylePatch,
  type HotspotType,
} from "@/lib/hotspot-styles";
import {
  clampBrightness,
  clampContrast,
  clampSaturation,
} from "@/lib/adjustments";
import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { clampPlanCoord } from "@/lib/floor-plans";
import {
  galleryImageObjectPaths,
  sceneObjectPaths,
} from "@/lib/storage";
import { isYouTubeId } from "@/lib/youtube";
import { createClient } from "@/lib/supabase/server";
import type { FloorPlan, Scene, SceneGroup } from "@/types";

export type SceneActionResult = {
  error?: string;
  scenes?: Scene[];
  groups?: SceneGroup[];
};

function editorPath(tourId: string) {
  return `/dashboard/tours/${tourId}/edit`;
}

function revalidateTourCaches(tourId: string, slug?: string | null) {
  revalidatePath(editorPath(tourId));
  revalidatePath("/dashboard");
  if (slug) {
    revalidatePath(`/tour/${slug}`);
  }
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
    .select(
      "id, owner_id, cover_scene_id, slug, default_hotspot_shape, default_hotspot_color",
    )
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
    compatPath?: string | null;
    width: number;
    height: number;
    fileSize: number;
    position: number;
    groupId?: string | null;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase, tour } = owned;

  let groupId: string | null = input.groupId ?? null;
  if (groupId) {
    const { data: group, error: groupError } = await supabase
      .from("scene_groups")
      .select("id, tour_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) {
      return { error: groupError.message };
    }
    if (!group || group.tour_id !== tourId) {
      return { error: "Group not found." };
    }
  }

  const { error: insertError } = await supabase.from("scenes").insert({
    id: input.id,
    tour_id: tourId,
    name: input.name,
    storage_path: input.storagePath,
    thumbnail_path: input.thumbnailPath,
    compat_path: input.compatPath ?? null,
    width: input.width,
    height: input.height,
    file_size: input.fileSize,
    position: input.position,
    group_id: groupId,
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

  revalidateTourCaches(tourId, tour.slug);
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

  revalidateTourCaches(scene.tour_id, owned.tour?.slug);
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
    .select(
      "id, tour_id, storage_path, thumbnail_path, compat_path, nadir_patch_path",
    )
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
  // Scene panoramas + any gallery images on this scene's hotspots.
  const paths = sceneObjectPaths(scene);

  const { data: sceneHotspots } = await supabase
    .from("hotspots")
    .select("id")
    .eq("scene_id", sceneId);
  const hotspotIds = (sceneHotspots ?? []).map((h) => h.id);
  if (hotspotIds.length > 0) {
    const { data: galleryImages } = await supabase
      .from("hotspot_images")
      .select("storage_path, thumbnail_path")
      .in("hotspot_id", hotspotIds);
    for (const image of galleryImages ?? []) {
      paths.push(...galleryImageObjectPaths(image));
    }
  }

  const { error: storageError } = await supabase.storage
    .from("panoramas")
    .remove(paths);

  if (storageError) {
    console.error(
      "[deleteScene] storage remove failed; proceeding with row delete",
      { sceneId, paths, message: storageError.message },
    );
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
    const [{ data: remaining, error: remainingError }, { data: groups, error: groupsError }] =
      await Promise.all([
        supabase.from("scenes").select("*").eq("tour_id", scene.tour_id),
        supabase
          .from("scene_groups")
          .select("*")
          .eq("tour_id", scene.tour_id),
      ]);

    if (remainingError) {
      return { error: remainingError.message };
    }
    if (groupsError) {
      return { error: groupsError.message };
    }

    const ordered = sortScenesByGroupOrder(remaining ?? [], groups ?? []);
    const nextCover = ordered[0] ?? null;

    const { error: coverError } = await supabase
      .from("tours")
      .update({ cover_scene_id: nextCover?.id ?? null })
      .eq("id", scene.tour_id);

    if (coverError) {
      return { error: coverError.message };
    }
  }

  revalidateTourCaches(scene.tour_id, owned.tour.slug);
  return {};
}

/**
 * Reorder scenes within one group (or the ungrouped bucket when groupId is null).
 * Also assigns group_id so cross-group drops can commit via this action.
 *
 * Uses explicit .update() per row — never .upsert() with partial payloads, which
 * can reset omitted columns to defaults under PostgREST ON CONFLICT.
 */
export async function reorderScenes(
  tourId: string,
  groupId: string | null,
  orderedSceneIds: string[],
): Promise<SceneActionResult> {
  return persistSceneContainerOrders(tourId, [
    { groupId, orderedSceneIds },
  ]);
}

/**
 * Persist one or more group buckets in a single round-trip.
 * Cross-container drops must use this so source + destination commit together
 * before any cache revalidation.
 */
export async function persistSceneContainerOrders(
  tourId: string,
  containers: Array<{ groupId: string | null; orderedSceneIds: string[] }>,
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase } = owned;

  for (const { groupId } of containers) {
    if (!groupId) continue;
    const { data: group, error: groupError } = await supabase
      .from("scene_groups")
      .select("id, tour_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) {
      return { error: groupError.message };
    }
    if (!group || group.tour_id !== tourId) {
      return { error: "Group not found." };
    }
  }

  const allIds = containers.flatMap((container) => container.orderedSceneIds);
  if (allIds.length > 0) {
    const { data: existing, error: fetchError } = await supabase
      .from("scenes")
      .select("id")
      .eq("tour_id", tourId)
      .in("id", allIds);

    if (fetchError) {
      return { error: fetchError.message };
    }

    const found = new Set((existing ?? []).map((scene) => scene.id));
    for (const id of allIds) {
      if (!found.has(id)) {
        return { error: "One or more scenes were not found." };
      }
    }
  }

  for (const { groupId, orderedSceneIds } of containers) {
    for (const [position, id] of orderedSceneIds.entries()) {
      const { error } = await supabase
        .from("scenes")
        .update({ position, group_id: groupId })
        .eq("id", id)
        .eq("tour_id", tourId);
      if (error) {
        return { error: error.message };
      }
    }
  }

  const { data: scenes, error: reloadError } = await supabase
    .from("scenes")
    .select("*")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });

  if (reloadError) {
    return { error: reloadError.message };
  }

  revalidateTourCaches(tourId, owned.tour?.slug);
  return { scenes: scenes ?? [] };
}

export async function createGroup(
  tourId: string,
  name = "New group",
): Promise<SceneActionResult & { group?: SceneGroup }> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const trimmed = name.trim() || "New group";
  const { supabase } = owned;

  const { data: existing, error: fetchError } = await supabase
    .from("scene_groups")
    .select("position")
    .eq("tour_id", tourId)
    .order("position", { ascending: false })
    .limit(1);

  if (fetchError) {
    return { error: fetchError.message };
  }

  const position = (existing?.[0]?.position ?? -1) + 1;

  const { data: group, error } = await supabase
    .from("scene_groups")
    .insert({
      tour_id: tourId,
      name: trimmed,
      position,
    })
    .select("*")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(tourId, owned.tour.slug);
  return { group };
}

export async function renameGroup(
  groupId: string,
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
    return { error: "Group name is required." };
  }

  const { data: group, error: groupError } = await supabase
    .from("scene_groups")
    .select("id, tour_id")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return { error: groupError.message };
  }
  if (!group) {
    return { error: "Group not found." };
  }

  const owned = await requireOwnedTour(group.tour_id);
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { error } = await supabase
    .from("scene_groups")
    .update({ name: trimmed })
    .eq("id", groupId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(group.tour_id, owned.tour.slug);
  return {};
}

/** Deletes the group only — scenes keep their rows with group_id set to null. */
export async function deleteGroup(groupId: string): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const { data: group, error: groupError } = await supabase
    .from("scene_groups")
    .select("id, tour_id")
    .eq("id", groupId)
    .maybeSingle();

  if (groupError) {
    return { error: groupError.message };
  }
  if (!group) {
    return { error: "Group not found." };
  }

  const owned = await requireOwnedTour(group.tour_id);
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { error } = await supabase
    .from("scene_groups")
    .delete()
    .eq("id", groupId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(group.tour_id, owned.tour.slug);
  return {};
}

export async function reorderGroups(
  tourId: string,
  orderedGroupIds: string[],
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase } = owned;

  const { data: existing, error: fetchError } = await supabase
    .from("scene_groups")
    .select("*")
    .eq("tour_id", tourId);

  if (fetchError) {
    return { error: fetchError.message };
  }

  const byId = new Map((existing ?? []).map((group) => [group.id, group]));

  if (orderedGroupIds.length === 0) {
    return {};
  }

  for (const id of orderedGroupIds) {
    if (!byId.has(id)) {
      return { error: "One or more groups were not found." };
    }
  }

  // Explicit column updates only — never partial upsert.
  for (const [position, id] of orderedGroupIds.entries()) {
    const { error } = await supabase
      .from("scene_groups")
      .update({ position })
      .eq("id", id)
      .eq("tour_id", tourId);
    if (error) {
      return { error: error.message };
    }
  }

  const { data: groups, error: reloadError } = await supabase
    .from("scene_groups")
    .select("*")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });

  if (reloadError) {
    return { error: reloadError.message };
  }

  revalidateTourCaches(tourId, owned.tour.slug);
  return { groups: groups ?? [] };
}

export async function moveSceneToGroup(
  sceneId: string,
  groupId: string | null,
  newPosition: number,
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
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  if (groupId) {
    const { data: group, error: groupError } = await supabase
      .from("scene_groups")
      .select("id, tour_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) {
      return { error: groupError.message };
    }
    if (!group || group.tour_id !== scene.tour_id) {
      return { error: "Group not found." };
    }
  }

  const { error } = await supabase
    .from("scenes")
    .update({
      group_id: groupId,
      position: newPosition,
    })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  const { data: scenes, error: reloadError } = await supabase
    .from("scenes")
    .select("*")
    .eq("tour_id", scene.tour_id)
    .order("position", { ascending: true });

  if (reloadError) {
    return { error: reloadError.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour.slug);
  return { scenes: scenes ?? [] };
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

  if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) {
    return { error: "Invalid camera angles." };
  }

  const { error } = await supabase
    .from("scenes")
    .update({
      initial_yaw: yaw,
      initial_pitch: pitch,
      has_initial_view: true,
    })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour?.slug);
  return {};
}

export async function clearSceneInitialView(
  sceneId: string,
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
      initial_yaw: 0,
      initial_pitch: 0,
      has_initial_view: false,
    })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour?.slug);
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

  revalidateTourCaches(tourId, owned.tour?.slug);
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
      tour: null,
    };
  }

  const { data: hotspot, error } = await supabase
    .from("hotspots")
    .select("id, scene_id, type")
    .eq("id", hotspotId)
    .maybeSingle();

  if (error) {
    return {
      error: error.message,
      supabase,
      hotspot: null,
      scene: null,
      tour: null,
    };
  }

  if (!hotspot) {
    return {
      error: "Hotspot not found.",
      supabase,
      hotspot: null,
      scene: null,
      tour: null,
    };
  }

  const owned = await requireOwnedScene(hotspot.scene_id);
  if (owned.error || !owned.scene) {
    return {
      error: owned.error ?? "Unauthorized.",
      supabase,
      hotspot: null,
      scene: null,
      tour: null,
    };
  }

  return {
    error: null,
    supabase,
    hotspot,
    scene: owned.scene,
    tour: owned.tour,
  };
}

export async function createHotspot(
  sceneId: string,
  input: {
    id: string;
    type: HotspotType;
    targetSceneId?: string | null;
    yaw: number;
    pitch: number;
    label?: string | null;
    content?: string | null;
    videoId?: string | null;
    videoStart?: number | null;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedScene(sceneId);
  if (owned.error || !owned.scene || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  if (!isHotspotType(input.type)) {
    return { error: "Invalid hotspot type." };
  }

  if (input.type === "link") {
    if (!input.targetSceneId) {
      return { error: "A link hotspot needs a target scene." };
    }
    if (input.targetSceneId === sceneId) {
      return { error: "A link cannot target its own scene." };
    }
  }

  if (input.type === "video") {
    if (input.videoId != null && !isYouTubeId(input.videoId)) {
      return { error: "Invalid YouTube video id." };
    }
    if (
      input.videoStart != null &&
      (!Number.isFinite(input.videoStart) || input.videoStart < 0)
    ) {
      return { error: "Start time must be zero or greater." };
    }
  }

  const tourDefaults = owned.tour as {
    default_hotspot_shape?: string;
    default_hotspot_color?: string;
    slug?: string;
  };

  const styleShape =
    input.type === "link"
      ? isHotspotShape(tourDefaults.default_hotspot_shape ?? "")
        ? tourDefaults.default_hotspot_shape!
        : "arrow"
      : defaultShapeForHotspotType(input.type);
  const styleColor = sanitizeHotspotColor(
    tourDefaults.default_hotspot_color ?? "#FFFFFF",
  );

  const { error } = await owned.supabase.from("hotspots").insert({
    id: input.id,
    scene_id: sceneId,
    type: input.type,
    target_scene_id: input.type === "link" ? input.targetSceneId : null,
    yaw: input.yaw,
    pitch: input.pitch,
    label: input.label ?? null,
    content: input.type === "info" ? (input.content ?? null) : null,
    video_id: input.type === "video" ? (input.videoId ?? null) : null,
    video_start: input.type === "video" ? (input.videoStart ?? null) : null,
    style_shape: styleShape,
    style_color: styleColor,
    style_size: DEFAULT_SIZE,
    style_animation: DEFAULT_ANIMATION,
    label_visibility: DEFAULT_LABEL_VISIBILITY,
  });

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function updateHotspot(
  hotspotId: string,
  patch: {
    type?: HotspotType;
    targetSceneId?: string | null;
    yaw?: number;
    pitch?: number;
    label?: string | null;
    content?: string | null;
    video_id?: string | null;
    video_start?: number | null;
    style_shape?: string;
    style_color?: string;
    style_size?: number;
    style_animation?: string;
    label_visibility?: string;
    position_mode?: string;
    style_rotation?: number;
    orient_yaw?: number;
    orient_pitch?: number;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.hotspot || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const styleError = validateStylePatch(patch);
  if (styleError) {
    return { error: styleError };
  }

  if (patch.position_mode !== undefined) {
    if (
      patch.position_mode !== "2d" &&
      patch.position_mode !== "floor" &&
      patch.position_mode !== "wall"
    ) {
      return { error: "Invalid placement mode." };
    }
  }
  if (patch.style_rotation !== undefined) {
    if (
      !Number.isFinite(patch.style_rotation) ||
      patch.style_rotation < 0 ||
      patch.style_rotation > 360
    ) {
      return { error: "Rotation must be between 0 and 360." };
    }
  }
  if (patch.orient_yaw !== undefined && !Number.isFinite(patch.orient_yaw)) {
    return { error: "Invalid orientation yaw." };
  }
  if (
    patch.orient_pitch !== undefined &&
    !Number.isFinite(patch.orient_pitch)
  ) {
    return { error: "Invalid orientation pitch." };
  }

  if (patch.video_id !== undefined && patch.video_id !== null) {
    if (!isYouTubeId(patch.video_id)) {
      return { error: "Invalid YouTube video id." };
    }
  }
  if (patch.video_start !== undefined && patch.video_start !== null) {
    if (!Number.isFinite(patch.video_start) || patch.video_start < 0) {
      return { error: "Start time must be zero or greater." };
    }
  }

  const update: {
    type?: string;
    target_scene_id?: string | null;
    yaw?: number;
    pitch?: number;
    label?: string | null;
    content?: string | null;
    video_id?: string | null;
    video_start?: number | null;
    style_shape?: string;
    style_color?: string;
    style_size?: number;
    style_animation?: string;
    label_visibility?: string;
    position_mode?: string;
    style_rotation?: number;
    orient_yaw?: number;
    orient_pitch?: number;
  } = {};

  if (patch.type !== undefined) update.type = patch.type;
  if (patch.targetSceneId !== undefined) {
    update.target_scene_id = patch.targetSceneId;
  }
  if (patch.yaw !== undefined) update.yaw = patch.yaw;
  if (patch.pitch !== undefined) update.pitch = patch.pitch;
  if (patch.label !== undefined) update.label = patch.label;
  if (patch.content !== undefined) update.content = patch.content;
  if (patch.video_id !== undefined) update.video_id = patch.video_id;
  if (patch.video_start !== undefined) update.video_start = patch.video_start;
  if (patch.style_shape !== undefined) update.style_shape = patch.style_shape;
  if (patch.style_color !== undefined) {
    update.style_color = sanitizeHotspotColor(patch.style_color);
  }
  if (patch.style_size !== undefined) update.style_size = patch.style_size;
  if (patch.style_animation !== undefined) {
    update.style_animation = patch.style_animation;
  }
  if (patch.label_visibility !== undefined) {
    update.label_visibility = patch.label_visibility;
  }
  if (patch.position_mode !== undefined) {
    update.position_mode = patch.position_mode;
  }
  if (patch.style_rotation !== undefined) {
    update.style_rotation = patch.style_rotation;
  }
  if (patch.orient_yaw !== undefined) update.orient_yaw = patch.orient_yaw;
  if (patch.orient_pitch !== undefined) {
    update.orient_pitch = patch.orient_pitch;
  }

  if (update.type === "info" || update.type === "gallery" || update.type === "video") {
    update.target_scene_id = null;
  }
  if (update.type && update.type !== "video") {
    update.video_id = null;
    update.video_start = null;
  }
  if (update.type && update.type !== "info") {
    update.content = null;
  }

  const { error } = await owned.supabase
    .from("hotspots")
    .update(update)
    .eq("id", hotspotId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function applyHotspotStyleToTour(
  tourId: string,
  style: {
    style_shape: string;
    style_color: string;
    style_size: number;
    style_animation: string;
    label_visibility: string;
    position_mode?: string;
    style_rotation?: number;
    orient_yaw?: number;
    orient_pitch?: number;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const styleError = validateStylePatch(style);
  if (styleError) {
    return { error: styleError };
  }
  if (!HEX_COLOR_RE.test(style.style_color)) {
    return { error: "Color must be a hex value like #FFFFFF." };
  }
  if (
    style.position_mode !== undefined &&
    style.position_mode !== "2d" &&
    style.position_mode !== "floor" &&
    style.position_mode !== "wall"
  ) {
    return { error: "Invalid placement mode." };
  }

  const { data: scenes, error: scenesError } = await owned.supabase
    .from("scenes")
    .select("id")
    .eq("tour_id", tourId);

  if (scenesError) {
    return { error: scenesError.message };
  }

  const sceneIds = (scenes ?? []).map((scene) => scene.id);
  if (sceneIds.length === 0) {
    return {};
  }

  const { error } = await owned.supabase
    .from("hotspots")
    .update({
      style_shape: style.style_shape,
      style_color: sanitizeHotspotColor(style.style_color),
      style_size: style.style_size,
      style_animation: style.style_animation,
      label_visibility: style.label_visibility,
      ...(style.position_mode !== undefined
        ? { position_mode: style.position_mode }
        : {}),
      ...(style.style_rotation !== undefined
        ? { style_rotation: style.style_rotation }
        : {}),
      ...(style.orient_yaw !== undefined ? { orient_yaw: style.orient_yaw } : {}),
      ...(style.orient_pitch !== undefined
        ? { orient_pitch: style.orient_pitch }
        : {}),
    })
    .in("scene_id", sceneIds);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(tourId, owned.tour.slug);
  return {};
}

export async function deleteHotspot(
  hotspotId: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.hotspot || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { data: galleryImages } = await owned.supabase
    .from("hotspot_images")
    .select("storage_path, thumbnail_path")
    .eq("hotspot_id", hotspotId);

  const paths: string[] = [];
  for (const image of galleryImages ?? []) {
    paths.push(...galleryImageObjectPaths(image));
  }
  if (paths.length > 0) {
    const { error: storageError } = await owned.supabase.storage
      .from("panoramas")
      .remove(paths);
    if (storageError) {
      console.error(
        "[deleteHotspot] gallery storage remove failed; proceeding with row delete",
        { hotspotId, paths, message: storageError.message },
      );
    }
  }

  const { error } = await owned.supabase
    .from("hotspots")
    .delete()
    .eq("id", hotspotId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function createHotspotImage(
  hotspotId: string,
  input: {
    id: string;
    storagePath: string;
    thumbnailPath?: string | null;
    caption?: string | null;
    position: number;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.hotspot || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }
  if (owned.hotspot.type !== "gallery") {
    return { error: "Images can only be added to gallery hotspots." };
  }

  const { count, error: countError } = await owned.supabase
    .from("hotspot_images")
    .select("id", { count: "exact", head: true })
    .eq("hotspot_id", hotspotId);

  if (countError) {
    return { error: countError.message };
  }
  if ((count ?? 0) >= 20) {
    return { error: "Galleries are limited to 20 images." };
  }

  const { error } = await owned.supabase.from("hotspot_images").insert({
    id: input.id,
    hotspot_id: hotspotId,
    storage_path: input.storagePath,
    thumbnail_path: input.thumbnailPath ?? null,
    caption: input.caption ?? null,
    position: input.position,
  });

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function updateHotspotImage(
  imageId: string,
  patch: { caption?: string | null; position?: number },
): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: image, error: imageError } = await supabase
    .from("hotspot_images")
    .select("id, hotspot_id")
    .eq("id", imageId)
    .maybeSingle();

  if (imageError) return { error: imageError.message };
  if (!image) return { error: "Image not found." };

  const owned = await requireOwnedHotspot(image.hotspot_id);
  if (owned.error || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const update: { caption?: string | null; position?: number } = {};
  if (patch.caption !== undefined) update.caption = patch.caption;
  if (patch.position !== undefined) update.position = patch.position;

  const { error } = await supabase
    .from("hotspot_images")
    .update(update)
    .eq("id", imageId);

  if (error) return { error: error.message };

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function reorderHotspotImages(
  hotspotId: string,
  items: { id: string; position: number }[],
): Promise<SceneActionResult> {
  const owned = await requireOwnedHotspot(hotspotId);
  if (owned.error || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  for (const item of items) {
    const { error } = await owned.supabase
      .from("hotspot_images")
      .update({ position: item.position })
      .eq("id", item.id)
      .eq("hotspot_id", hotspotId);
    if (error) return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function deleteHotspotImage(
  imageId: string,
): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You must be signed in." };

  const { data: image, error: imageError } = await supabase
    .from("hotspot_images")
    .select("id, hotspot_id, storage_path, thumbnail_path")
    .eq("id", imageId)
    .maybeSingle();

  if (imageError) return { error: imageError.message };
  if (!image) return { error: "Image not found." };

  const owned = await requireOwnedHotspot(image.hotspot_id);
  if (owned.error || !owned.scene) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const paths = galleryImageObjectPaths(image);
  const { error: storageError } = await supabase.storage
    .from("panoramas")
    .remove(paths);
  if (storageError) {
    console.error(
      "[deleteHotspotImage] storage remove failed; proceeding with row delete",
      { imageId, paths, message: storageError.message },
    );
  }

  const { error } = await supabase
    .from("hotspot_images")
    .delete()
    .eq("id", imageId);

  if (error) return { error: error.message };

  revalidateTourCaches(owned.scene.tour_id, owned.tour?.slug);
  return {};
}

export async function updateSceneNadirPatch(
  sceneId: string,
  nadirPatchPath: string | null,
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
    .select("id, tour_id, nadir_patch_path")
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

  if (
    scene.nadir_patch_path &&
    scene.nadir_patch_path !== nadirPatchPath
  ) {
    const { error: removeError } = await supabase.storage
      .from("panoramas")
      .remove([scene.nadir_patch_path]);
    if (removeError) {
      console.error("[updateSceneNadirPatch] storage remove failed", {
        path: scene.nadir_patch_path,
        message: removeError.message,
      });
    }
  }

  const { error } = await supabase
    .from("scenes")
    .update({ nadir_patch_path: nadirPatchPath })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour.slug);
  return {};
}

export async function updateSceneNadirDisabled(
  sceneId: string,
  disabled: boolean,
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
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { error } = await supabase
    .from("scenes")
    .update({ nadir_disabled: disabled })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour.slug);
  return {};
}

export async function updateSceneAdjustments(
  sceneId: string,
  input: {
    adjust_brightness: number;
    adjust_contrast: number;
    adjust_saturation: number;
  },
): Promise<SceneActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in." };
  }

  const brightness = clampBrightness(input.adjust_brightness);
  const contrast = clampContrast(input.adjust_contrast);
  const saturation = clampSaturation(input.adjust_saturation);

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
  if (owned.error || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { error } = await supabase
    .from("scenes")
    .update({
      adjust_brightness: brightness,
      adjust_contrast: contrast,
      adjust_saturation: saturation,
    })
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(scene.tour_id, owned.tour.slug);
  return {};
}

export async function copySceneAdjustmentsToTour(
  tourId: string,
  sourceSceneId: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.tour || !owned.supabase) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { data: source, error: sourceError } = await owned.supabase
    .from("scenes")
    .select(
      "id, tour_id, adjust_brightness, adjust_contrast, adjust_saturation",
    )
    .eq("id", sourceSceneId)
    .maybeSingle();

  if (sourceError) {
    return { error: sourceError.message };
  }
  if (!source || source.tour_id !== tourId) {
    return { error: "Scene not found." };
  }

  const { error } = await owned.supabase
    .from("scenes")
    .update({
      adjust_brightness: source.adjust_brightness,
      adjust_contrast: source.adjust_contrast,
      adjust_saturation: source.adjust_saturation,
    })
    .eq("tour_id", tourId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(tourId, owned.tour.slug);
  return {};
}

async function requireOwnedFloorPlan(planId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      error: "You must be signed in." as const,
      supabase,
      plan: null,
      tour: null,
    };
  }

  const { data: plan, error } = await supabase
    .from("floor_plans")
    .select("*")
    .eq("id", planId)
    .maybeSingle();

  if (error) {
    return { error: error.message, supabase, plan: null, tour: null };
  }
  if (!plan) {
    return { error: "Floor plan not found.", supabase, plan: null, tour: null };
  }

  const owned = await requireOwnedTour(plan.tour_id);
  if (owned.error || !owned.tour) {
    return {
      error: owned.error ?? "Unauthorized.",
      supabase,
      plan: null,
      tour: null,
    };
  }

  return { error: null, supabase, plan, tour: owned.tour };
}

export async function createFloorPlan(
  tourId: string,
  input: {
    id: string;
    name: string;
    storagePath: string;
    width: number;
    height: number;
    groupId?: string | null;
  },
): Promise<SceneActionResult & { plan?: FloorPlan }> {
  const owned = await requireOwnedTour(tourId);
  if (owned.error || !owned.user || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const { supabase } = owned;
  let groupId: string | null = input.groupId ?? null;

  if (groupId) {
    const { data: group, error: groupError } = await supabase
      .from("scene_groups")
      .select("id, tour_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) return { error: groupError.message };
    if (!group || group.tour_id !== tourId) {
      return { error: "Group not found." };
    }
  }

  const { data: existing, error: fetchError } = await supabase
    .from("floor_plans")
    .select("position")
    .eq("tour_id", tourId)
    .order("position", { ascending: false })
    .limit(1);

  if (fetchError) {
    return { error: fetchError.message };
  }

  const position = (existing?.[0]?.position ?? -1) + 1;
  const trimmed = input.name.trim() || "Floor plan";

  const { data: plan, error } = await supabase
    .from("floor_plans")
    .insert({
      id: input.id,
      tour_id: tourId,
      group_id: groupId,
      name: trimmed,
      storage_path: input.storagePath,
      width: input.width,
      height: input.height,
      position,
    })
    .select("*")
    .single();

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(tourId, owned.tour.slug);
  return { plan };
}

export async function renameFloorPlan(
  planId: string,
  name: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedFloorPlan(planId);
  if (owned.error || !owned.plan || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const trimmed = name.trim();
  if (!trimmed) {
    return { error: "Plan name is required." };
  }

  const { error } = await owned.supabase
    .from("floor_plans")
    .update({ name: trimmed })
    .eq("id", planId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.plan.tour_id, owned.tour.slug);
  return {};
}

export async function updateFloorPlanGroup(
  planId: string,
  groupId: string | null,
): Promise<SceneActionResult> {
  const owned = await requireOwnedFloorPlan(planId);
  if (owned.error || !owned.plan || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  if (groupId) {
    const { data: group, error: groupError } = await owned.supabase
      .from("scene_groups")
      .select("id, tour_id")
      .eq("id", groupId)
      .maybeSingle();
    if (groupError) return { error: groupError.message };
    if (!group || group.tour_id !== owned.plan.tour_id) {
      return { error: "Group not found." };
    }
  }

  const { error } = await owned.supabase
    .from("floor_plans")
    .update({ group_id: groupId })
    .eq("id", planId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.plan.tour_id, owned.tour.slug);
  return {};
}

export async function deleteFloorPlan(
  planId: string,
): Promise<SceneActionResult> {
  const owned = await requireOwnedFloorPlan(planId);
  if (owned.error || !owned.plan || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const storagePath = owned.plan.storage_path;

  const { error } = await owned.supabase
    .from("floor_plans")
    .delete()
    .eq("id", planId);

  if (error) {
    return { error: error.message };
  }

  const { error: storageError } = await owned.supabase.storage
    .from("panoramas")
    .remove([storagePath]);

  if (storageError) {
    console.error("[deleteFloorPlan] storage remove failed", {
      planId,
      path: storagePath,
      message: storageError.message,
    });
  }

  revalidateTourCaches(owned.plan.tour_id, owned.tour.slug);
  return {};
}

/** Assign scenes to a plan without placing markers (plan_x/plan_y stay null). */
export async function assignScenesToFloorPlan(
  planId: string,
  options?: { groupId?: string | null },
): Promise<SceneActionResult> {
  const owned = await requireOwnedFloorPlan(planId);
  if (owned.error || !owned.plan || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const groupId =
    options && "groupId" in options ? options.groupId : owned.plan.group_id;

  let query = owned.supabase
    .from("scenes")
    .update({ floor_plan_id: planId })
    .eq("tour_id", owned.plan.tour_id);

  if (groupId === null) {
    query = query.is("group_id", null);
  } else if (typeof groupId === "string") {
    query = query.eq("group_id", groupId);
  }

  const { error } = await query;
  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.plan.tour_id, owned.tour.slug);
  return {};
}

export async function updateScenePlanPlacement(
  sceneId: string,
  input: {
    floorPlanId?: string | null;
    planX?: number | null;
    planY?: number | null;
  },
): Promise<SceneActionResult> {
  const owned = await requireOwnedScene(sceneId);
  if (owned.error || !owned.scene || !owned.tour) {
    return { error: owned.error ?? "Unauthorized." };
  }

  const update: {
    floor_plan_id?: string | null;
    plan_x?: number | null;
    plan_y?: number | null;
  } = {};

  if (input.floorPlanId !== undefined) {
    if (input.floorPlanId) {
      const { data: plan, error: planError } = await owned.supabase
        .from("floor_plans")
        .select("id, tour_id")
        .eq("id", input.floorPlanId)
        .maybeSingle();
      if (planError) return { error: planError.message };
      if (!plan || plan.tour_id !== owned.scene.tour_id) {
        return { error: "Floor plan not found." };
      }
    }
    update.floor_plan_id = input.floorPlanId;
  }

  if (input.planX !== undefined) {
    update.plan_x = input.planX === null ? null : clampPlanCoord(input.planX);
  }
  if (input.planY !== undefined) {
    update.plan_y = input.planY === null ? null : clampPlanCoord(input.planY);
  }

  const { error } = await owned.supabase
    .from("scenes")
    .update(update)
    .eq("id", sceneId);

  if (error) {
    return { error: error.message };
  }

  revalidateTourCaches(owned.scene.tour_id, owned.tour.slug);
  return {};
}
