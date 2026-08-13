"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { HEX_COLOR_RE, isHotspotShape } from "@/lib/hotspot-styles";
import { isNadirLogoSource, isNadirType } from "@/lib/nadir";
import { generateSlug } from "@/lib/slug";
import {
  galleryPath,
  galleryThumbPath,
  sceneObjectPaths,
} from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import {
  isIntroEffect,
  isTransitionEffect,
} from "@/lib/viewer-effects";
import type {
  FloorPlanInsert,
  HotspotImageInsert,
  HotspotInsert,
  SceneGroupInsert,
  SceneInsert,
  TourInsert,
} from "@/types";

export type ActionResult = {
  error?: string;
};

const UNIQUE_VIOLATION = "23505";

function extensionFromPath(path: string): string {
  const idx = path.lastIndexOf(".");
  if (idx === -1) return ".jpg";
  return path.slice(idx);
}

async function insertTourWithUniqueSlug(
  supabase: Awaited<ReturnType<typeof createClient>>,
  values: Omit<TourInsert, "slug">,
): Promise<{ id: string } | { error: string }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const slug = generateSlug();
    const { data, error } = await supabase
      .from("tours")
      .insert({ ...values, slug })
      .select("id")
      .single();

    if (!error && data) {
      return { id: data.id };
    }

    if (error?.code !== UNIQUE_VIOLATION) {
      return { error: error?.message ?? "Failed to create tour." };
    }
  }

  return { error: "Could not generate a unique tour URL. Please try again." };
}

export async function createTour(): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to create a tour." };
  }

  const result = await insertTourWithUniqueSlug(supabase, {
    owner_id: user.id,
    title: "Untitled Tour",
  });

  if ("error" in result) {
    return { error: result.error };
  }

  revalidatePath("/dashboard");
  redirect(`/dashboard/tours/${result.id}/edit`);
}

export async function updateTour(
  id: string,
  input: {
    title: string;
    description: string | null;
    is_public: boolean;
    default_hotspot_shape?: string;
    default_hotspot_color?: string;
    intro_effect?: string;
    transition_effect?: string;
    transition_speed?: number;
    transition_zoom?: boolean;
    transition_rotation?: boolean;
    gyroscope_enabled?: boolean;
    vr_enabled?: boolean;
    cover_scene_id?: string | null;
    start_scene_id?: string | null;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
  }

  const { data: existing } = await supabase
    .from("tours")
    .select("id, owner_id, slug")
    .eq("id", id)
    .maybeSingle();

  if (!existing || existing.owner_id !== user.id) {
    return { error: "Tour not found." };
  }

  const title = input.title.trim();
  if (!title) {
    return { error: "Title is required." };
  }

  if (
    input.default_hotspot_shape !== undefined &&
    !isHotspotShape(input.default_hotspot_shape)
  ) {
    return { error: "Invalid default hotspot shape." };
  }
  if (
    input.default_hotspot_color !== undefined &&
    !HEX_COLOR_RE.test(input.default_hotspot_color)
  ) {
    return { error: "Default color must be a hex value like #FFFFFF." };
  }
  if (
    input.intro_effect !== undefined &&
    !isIntroEffect(input.intro_effect)
  ) {
    return { error: "Invalid intro effect." };
  }
  if (
    input.transition_effect !== undefined &&
    !isTransitionEffect(input.transition_effect)
  ) {
    return { error: "Invalid transition effect." };
  }
  if (
    input.transition_speed !== undefined &&
    (input.transition_speed < 300 || input.transition_speed > 5000)
  ) {
    return { error: "Transition speed must be between 300 and 5000 ms." };
  }

  if (input.cover_scene_id || input.start_scene_id) {
    const ids = [input.cover_scene_id, input.start_scene_id].filter(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    if (ids.length > 0) {
      const { data: ownedScenes, error: sceneCheckError } = await supabase
        .from("scenes")
        .select("id")
        .eq("tour_id", id)
        .in("id", ids);

      if (sceneCheckError) {
        return { error: sceneCheckError.message };
      }
      const owned = new Set((ownedScenes ?? []).map((row) => row.id));
      if (input.cover_scene_id && !owned.has(input.cover_scene_id)) {
        return { error: "Cover scene must belong to this tour." };
      }
      if (input.start_scene_id && !owned.has(input.start_scene_id)) {
        return { error: "Start scene must belong to this tour." };
      }
    }
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .update({
      title,
      description: input.description,
      is_public: input.is_public,
      ...(input.default_hotspot_shape !== undefined
        ? { default_hotspot_shape: input.default_hotspot_shape }
        : {}),
      ...(input.default_hotspot_color !== undefined
        ? { default_hotspot_color: input.default_hotspot_color }
        : {}),
      ...(input.intro_effect !== undefined
        ? { intro_effect: input.intro_effect }
        : {}),
      ...(input.transition_effect !== undefined
        ? { transition_effect: input.transition_effect }
        : {}),
      ...(input.transition_speed !== undefined
        ? { transition_speed: input.transition_speed }
        : {}),
      ...(input.transition_zoom !== undefined
        ? { transition_zoom: input.transition_zoom }
        : {}),
      ...(input.transition_rotation !== undefined
        ? { transition_rotation: input.transition_rotation }
        : {}),
      ...(input.gyroscope_enabled !== undefined
        ? { gyroscope_enabled: input.gyroscope_enabled }
        : {}),
      ...(input.vr_enabled !== undefined
        ? { vr_enabled: input.vr_enabled }
        : {}),
      ...(input.cover_scene_id !== undefined
        ? { cover_scene_id: input.cover_scene_id }
        : {}),
      ...(input.start_scene_id !== undefined
        ? { start_scene_id: input.start_scene_id }
        : {}),
    })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("slug")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!tour) {
    return { error: "Tour not found." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/tours/${id}/edit`);
  if (tour?.slug) {
    revalidatePath(`/tour/${tour.slug}`);
    revalidatePath(`/embed/${tour.slug}`);
  }
  return {};
}

export async function updateTourEffects(
  id: string,
  input: {
    intro_effect?: string;
    transition_effect?: string;
    transition_speed?: number;
    transition_zoom?: boolean;
    transition_rotation?: boolean;
    transition_motion_blur?: boolean;
    walkthrough_enabled?: boolean;
    gyroscope_enabled?: boolean;
    vr_enabled?: boolean;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
  }

  if (
    input.intro_effect !== undefined &&
    !isIntroEffect(input.intro_effect)
  ) {
    return { error: "Invalid intro effect." };
  }
  if (
    input.transition_effect !== undefined &&
    !isTransitionEffect(input.transition_effect)
  ) {
    return { error: "Invalid transition effect." };
  }
  if (
    input.transition_speed !== undefined &&
    (input.transition_speed < 300 || input.transition_speed > 5000)
  ) {
    return { error: "Transition speed must be between 300 and 5000 ms." };
  }

  const { data: existing } = await supabase
    .from("tours")
    .select("id, owner_id, slug")
    .eq("id", id)
    .maybeSingle();

  if (!existing || existing.owner_id !== user.id) {
    return { error: "Tour not found." };
  }

  const { error } = await supabase
    .from("tours")
    .update({
      ...(input.intro_effect !== undefined
        ? { intro_effect: input.intro_effect }
        : {}),
      ...(input.transition_effect !== undefined
        ? { transition_effect: input.transition_effect }
        : {}),
      ...(input.transition_speed !== undefined
        ? { transition_speed: input.transition_speed }
        : {}),
      ...(input.transition_zoom !== undefined
        ? { transition_zoom: input.transition_zoom }
        : {}),
      ...(input.transition_rotation !== undefined
        ? { transition_rotation: input.transition_rotation }
        : {}),
      ...(input.transition_motion_blur !== undefined
        ? { transition_motion_blur: input.transition_motion_blur }
        : {}),
      ...(input.walkthrough_enabled !== undefined
        ? { walkthrough_enabled: input.walkthrough_enabled }
        : {}),
      ...(input.gyroscope_enabled !== undefined
        ? { gyroscope_enabled: input.gyroscope_enabled }
        : {}),
      ...(input.vr_enabled !== undefined
        ? { vr_enabled: input.vr_enabled }
        : {}),
    })
    .eq("id", id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/tours/${id}/edit`);
  if (existing.slug) {
    revalidatePath(`/tour/${existing.slug}`);
    revalidatePath(`/embed/${existing.slug}`);
  }
  return {};
}

export async function updateTourNadir(
  id: string,
  input: {
    nadir_type?: string;
    nadir_logo_path?: string | null;
    nadir_logo_source?: string;
    nadir_size?: number;
    nadir_opacity?: number;
    nadir_rotation?: number;
    nadir_feather?: number;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
  }

  const { data: existing } = await supabase
    .from("tours")
    .select("id, owner_id, slug")
    .eq("id", id)
    .maybeSingle();

  if (!existing || existing.owner_id !== user.id) {
    return { error: "Tour not found." };
  }

  const patch: {
    nadir_type?: string;
    nadir_logo_path?: string | null;
    nadir_logo_source?: string;
    nadir_size?: number;
    nadir_opacity?: number;
    nadir_rotation?: number;
    nadir_feather?: number;
  } = {};

  if (input.nadir_type !== undefined) {
    if (!isNadirType(input.nadir_type)) {
      return { error: "Invalid nadir type." };
    }
    patch.nadir_type = input.nadir_type;
  }
  if (input.nadir_logo_path !== undefined) {
    patch.nadir_logo_path = input.nadir_logo_path;
  }
  if (input.nadir_logo_source !== undefined) {
    if (!isNadirLogoSource(input.nadir_logo_source)) {
      return { error: "Invalid nadir logo source." };
    }
    patch.nadir_logo_source = input.nadir_logo_source;
  }
  if (input.nadir_size !== undefined) {
    if (input.nadir_size < 0.1 || input.nadir_size > 1) {
      return { error: "Nadir size must be between 0.1 and 1.0." };
    }
    patch.nadir_size = input.nadir_size;
  }
  if (input.nadir_opacity !== undefined) {
    if (input.nadir_opacity < 0.1 || input.nadir_opacity > 1) {
      return { error: "Nadir opacity must be between 0.1 and 1.0." };
    }
    patch.nadir_opacity = input.nadir_opacity;
  }
  if (input.nadir_rotation !== undefined) {
    patch.nadir_rotation = input.nadir_rotation;
  }
  if (input.nadir_feather !== undefined) {
    if (input.nadir_feather < 0 || input.nadir_feather > 1) {
      return { error: "Nadir feather must be between 0 and 1.0." };
    }
    patch.nadir_feather = input.nadir_feather;
  }

  if (Object.keys(patch).length === 0) {
    return {};
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .update(patch)
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("slug")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!tour) {
    return { error: "Tour not found." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/tours/${id}/edit`);
  if (tour?.slug) {
    revalidatePath(`/tour/${tour.slug}`);
    revalidatePath(`/embed/${tour.slug}`);
  }
  return {};
}

export async function setTourPublic(
  id: string,
  isPublic: boolean,
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .update({ is_public: isPublic })
    .eq("id", id)
    .eq("owner_id", user.id)
    .select("slug")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }
  if (!tour) {
    return { error: "Tour not found." };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/tours/${id}/edit`);
  revalidatePath(`/tour/${tour.slug}`);
  revalidatePath(`/embed/${tour.slug}`);
  return {};
}

export async function listOwnedTourScenes(
  tourId: string,
): Promise<{ id: string; name: string }[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return [];

  const { data: tour } = await supabase
    .from("tours")
    .select("id")
    .eq("id", tourId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!tour) return [];

  const { data } = await supabase
    .from("scenes")
    .select("id, name")
    .eq("tour_id", tourId)
    .order("position", { ascending: true });

  return data ?? [];
}

export async function deleteTour(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to delete a tour." };
  }

  const { data: existing } = await supabase
    .from("tours")
    .select("slug, owner_id")
    .eq("id", id)
    .maybeSingle();

  if (!existing || existing.owner_id !== user.id) {
    return { error: "Tour not found." };
  }

  // Collect storage paths before the row (and cascade) disappears.
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("id, storage_path, thumbnail_path, compat_path, nadir_patch_path, cleaned_path, cleaned_compat_path, staged_path, staged_compat_path")
    .eq("tour_id", id);

  if (scenesError) {
    return { error: scenesError.message };
  }

  const { data: plans, error: plansError } = await supabase
    .from("floor_plans")
    .select("storage_path")
    .eq("tour_id", id);

  if (plansError) {
    return { error: plansError.message };
  }

  const sceneIds = (scenes ?? []).map((scene) => scene.id);
  let galleryImages: { storage_path: string; thumbnail_path: string | null }[] =
    [];
  if (sceneIds.length > 0) {
    const { data: hotspotsForTour, error: hotspotsLookupError } = await supabase
      .from("hotspots")
      .select("id")
      .in("scene_id", sceneIds);
    if (hotspotsLookupError) {
      return { error: hotspotsLookupError.message };
    }
    const hotspotIds = (hotspotsForTour ?? []).map((h) => h.id);
    if (hotspotIds.length > 0) {
      const { data: images, error: imagesError } = await supabase
        .from("hotspot_images")
        .select("storage_path, thumbnail_path")
        .in("hotspot_id", hotspotIds);
      if (imagesError) {
        return { error: imagesError.message };
      }
      galleryImages = images ?? [];
    }
  }

  const paths: string[] = [];
  for (const scene of scenes ?? []) {
    paths.push(...sceneObjectPaths(scene));
  }
  for (const plan of plans ?? []) {
    paths.push(plan.storage_path);
  }
  for (const image of galleryImages) {
    paths.push(image.storage_path);
    if (image.thumbnail_path) paths.push(image.thumbnail_path);
  }

  const CHUNK = 100;
  for (let i = 0; i < paths.length; i += CHUNK) {
    const chunk = paths.slice(i, i + CHUNK);
    const { error: storageError } = await supabase.storage
      .from("panoramas")
      .remove(chunk);

    if (storageError) {
      console.error(
        "[deleteTour] storage remove failed; proceeding with row delete",
        { tourId: id, chunk, message: storageError.message },
      );
    }
  }

  const { error } = await supabase
    .from("tours")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  if (existing?.slug) {
    revalidatePath(`/tour/${existing.slug}`);
    revalidatePath(`/embed/${existing.slug}`);
  }
  return {};
}

export async function duplicateTour(id: string): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to duplicate a tour." };
  }

  const { data: original, error: originalError } = await supabase
    .from("tours")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (originalError) {
    return { error: originalError.message };
  }

  if (!original) {
    return { error: "Tour not found." };
  }

  if (original.owner_id !== user.id) {
    return { error: "Tour not found." };
  }

  const created = await insertTourWithUniqueSlug(supabase, {
    owner_id: user.id,
    title: `${original.title} (Copy)`,
    description: original.description,
    is_public: false,
    default_hotspot_shape: original.default_hotspot_shape,
    default_hotspot_color: original.default_hotspot_color,
    nadir_type: original.nadir_type,
    nadir_logo_path: original.nadir_logo_path,
    nadir_logo_source: original.nadir_logo_source,
    nadir_size: original.nadir_size,
    nadir_opacity: original.nadir_opacity,
    nadir_rotation: original.nadir_rotation,
    nadir_feather: original.nadir_feather,
    intro_effect: original.intro_effect,
    transition_effect: original.transition_effect,
    transition_speed: original.transition_speed,
    transition_zoom: original.transition_zoom,
    transition_rotation: original.transition_rotation,
    transition_motion_blur: original.transition_motion_blur,
    walkthrough_enabled: original.walkthrough_enabled,
    gyroscope_enabled: original.gyroscope_enabled,
    vr_enabled: original.vr_enabled,
  });

  if ("error" in created) {
    return { error: created.error };
  }

  const newTourId = created.id;
  const copiedStoragePaths: string[] = [];

  const rollback = async () => {
    if (copiedStoragePaths.length > 0) {
      const CHUNK = 100;
      for (let i = 0; i < copiedStoragePaths.length; i += CHUNK) {
        await supabase.storage
          .from("panoramas")
          .remove(copiedStoragePaths.slice(i, i + CHUNK));
      }
    }
    await supabase.from("tours").delete().eq("id", newTourId);
  };

  try {
    const { data: originalGroups, error: groupsError } = await supabase
      .from("scene_groups")
      .select("*")
      .eq("tour_id", id)
      .order("position", { ascending: true });

    if (groupsError) {
      await rollback();
      return { error: groupsError.message };
    }

    const groupIdMap = new Map<string, string>();
    const groups = originalGroups ?? [];

    if (groups.length > 0) {
      const groupInserts: SceneGroupInsert[] = groups.map((group) => {
        const newGroupId = crypto.randomUUID();
        groupIdMap.set(group.id, newGroupId);
        return {
          id: newGroupId,
          tour_id: newTourId,
          name: group.name,
          position: group.position,
        };
      });

      const { error: insertGroupsError } = await supabase
        .from("scene_groups")
        .insert(groupInserts);

      if (insertGroupsError) {
        await rollback();
        return { error: insertGroupsError.message };
      }
    }

    const { data: originalPlans, error: plansError } = await supabase
      .from("floor_plans")
      .select("*")
      .eq("tour_id", id)
      .order("position", { ascending: true });

    if (plansError) {
      await rollback();
      return { error: plansError.message };
    }

    const planIdMap = new Map<string, string>();
    const plans = originalPlans ?? [];

    if (plans.length > 0) {
      const planInserts: FloorPlanInsert[] = plans.map((plan) => {
        const newPlanId = crypto.randomUUID();
        planIdMap.set(plan.id, newPlanId);
        return {
          id: newPlanId,
          tour_id: newTourId,
          group_id: plan.group_id
            ? (groupIdMap.get(plan.group_id) ?? null)
            : null,
          name: plan.name,
          storage_path: plan.storage_path,
          width: plan.width,
          height: plan.height,
          position: plan.position,
        };
      });

      const { error: insertPlansError } = await supabase
        .from("floor_plans")
        .insert(planInserts);

      if (insertPlansError) {
        await rollback();
        return { error: insertPlansError.message };
      }

      for (const plan of plans) {
        const newPlanId = planIdMap.get(plan.id);
        if (!newPlanId) continue;

        const newPlanPath = `${user.id}/${newTourId}/plans/${newPlanId}${extensionFromPath(plan.storage_path)}`;
        const { error: copyPlanError } = await supabase.storage
          .from("panoramas")
          .copy(plan.storage_path, newPlanPath);

        if (copyPlanError) {
          await rollback();
          return { error: copyPlanError.message };
        }
        copiedStoragePaths.push(newPlanPath);

        const { error: updatePlanError } = await supabase
          .from("floor_plans")
          .update({ storage_path: newPlanPath })
          .eq("id", newPlanId);

        if (updatePlanError) {
          await rollback();
          return { error: updatePlanError.message };
        }
      }
    }

    const { data: originalScenes, error: scenesError } = await supabase
      .from("scenes")
      .select("*")
      .eq("tour_id", id)
      .order("position", { ascending: true });

    if (scenesError) {
      await rollback();
      return { error: scenesError.message };
    }

    const sceneIdMap = new Map<string, string>();
    const scenes = originalScenes ?? [];

    if (scenes.length > 0) {
      const sceneInserts: SceneInsert[] = scenes.map((scene) => {
        const newSceneId = crypto.randomUUID();
        sceneIdMap.set(scene.id, newSceneId);
        return {
          id: newSceneId,
          tour_id: newTourId,
          name: scene.name,
          storage_path: scene.storage_path,
          thumbnail_path: scene.thumbnail_path,
          compat_path: scene.compat_path,
          width: scene.width,
          height: scene.height,
          file_size: scene.file_size,
          nadir_patch_path: scene.nadir_patch_path,
          nadir_disabled: scene.nadir_disabled,
          cleaned_path: scene.cleaned_path,
          cleaned_compat_path: scene.cleaned_compat_path,
          cleaned_enabled: scene.cleaned_enabled,
          staged_path: scene.staged_path,
          staged_compat_path: scene.staged_compat_path,
          staged_enabled: scene.staged_enabled,
          adjust_brightness: scene.adjust_brightness,
          adjust_contrast: scene.adjust_contrast,
          adjust_saturation: scene.adjust_saturation,
          position: scene.position,
          initial_yaw: scene.initial_yaw,
          initial_pitch: scene.initial_pitch,
          has_initial_view: scene.has_initial_view,
          group_id: scene.group_id
            ? (groupIdMap.get(scene.group_id) ?? null)
            : null,
          floor_plan_id: scene.floor_plan_id
            ? (planIdMap.get(scene.floor_plan_id) ?? null)
            : null,
          plan_x: scene.plan_x,
          plan_y: scene.plan_y,
        };
      });

      const { error: insertScenesError } = await supabase
        .from("scenes")
        .insert(sceneInserts);

      if (insertScenesError) {
        await rollback();
        return { error: insertScenesError.message };
      }

      for (const scene of scenes) {
        const newSceneId = sceneIdMap.get(scene.id);
        if (!newSceneId) continue;

        const newStoragePath = `${user.id}/${newTourId}/${newSceneId}${extensionFromPath(scene.storage_path)}`;
        const { error: copyError } = await supabase.storage
          .from("panoramas")
          .copy(scene.storage_path, newStoragePath);

        if (copyError) {
          await rollback();
          return { error: copyError.message };
        }
        copiedStoragePaths.push(newStoragePath);

        let newThumbnailPath: string | null = null;
        if (scene.thumbnail_path) {
          newThumbnailPath = `${user.id}/${newTourId}/${newSceneId}_thumb${extensionFromPath(scene.thumbnail_path)}`;
          const { error: thumbCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.thumbnail_path, newThumbnailPath);

          if (thumbCopyError) {
            await rollback();
            return { error: thumbCopyError.message };
          }
          copiedStoragePaths.push(newThumbnailPath);
        }

        let newCompatPath: string | null = null;
        if (scene.compat_path) {
          newCompatPath = `${user.id}/${newTourId}/${newSceneId}_4k${extensionFromPath(scene.compat_path)}`;
          const { error: compatCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.compat_path, newCompatPath);

          if (compatCopyError) {
            await rollback();
            return { error: compatCopyError.message };
          }
          copiedStoragePaths.push(newCompatPath);
        }

        let newNadirPath: string | null = null;
        if (scene.nadir_patch_path) {
          newNadirPath = `${user.id}/${newTourId}/${newSceneId}_nadir.png`;
          const { error: nadirCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.nadir_patch_path, newNadirPath);

          if (nadirCopyError) {
            await rollback();
            return { error: nadirCopyError.message };
          }
          copiedStoragePaths.push(newNadirPath);
        }

        let newStagedPath: string | null = null;
        if (scene.staged_path) {
          newStagedPath = `${user.id}/${newTourId}/${newSceneId}_staged.jpg`;
          const { error: stagedCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.staged_path, newStagedPath);

          if (stagedCopyError) {
            await rollback();
            return { error: stagedCopyError.message };
          }
          copiedStoragePaths.push(newStagedPath);
        }

        let newStagedCompatPath: string | null = null;
        if (scene.staged_compat_path) {
          newStagedCompatPath = `${user.id}/${newTourId}/${newSceneId}_staged_4k.jpg`;
          const { error: stagedCompatCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.staged_compat_path, newStagedCompatPath);

          if (stagedCompatCopyError) {
            await rollback();
            return { error: stagedCompatCopyError.message };
          }
          copiedStoragePaths.push(newStagedCompatPath);
        }

        let newCleanedPath: string | null = null;
        if (scene.cleaned_path) {
          newCleanedPath = `${user.id}/${newTourId}/${newSceneId}_cleaned.jpg`;
          const { error: cleanedCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.cleaned_path, newCleanedPath);

          if (cleanedCopyError) {
            await rollback();
            return { error: cleanedCopyError.message };
          }
          copiedStoragePaths.push(newCleanedPath);
        }

        let newCleanedCompatPath: string | null = null;
        if (scene.cleaned_compat_path) {
          newCleanedCompatPath = `${user.id}/${newTourId}/${newSceneId}_cleaned_4k.jpg`;
          const { error: cleanedCompatCopyError } = await supabase.storage
            .from("panoramas")
            .copy(scene.cleaned_compat_path, newCleanedCompatPath);

          if (cleanedCompatCopyError) {
            await rollback();
            return { error: cleanedCompatCopyError.message };
          }
          copiedStoragePaths.push(newCleanedCompatPath);
        }

        const { error: updateSceneError } = await supabase
          .from("scenes")
          .update({
            storage_path: newStoragePath,
            thumbnail_path: newThumbnailPath,
            compat_path: newCompatPath,
            nadir_patch_path: newNadirPath,
            staged_path: newStagedPath,
            staged_compat_path: newStagedCompatPath,
            cleaned_path: newCleanedPath,
            cleaned_compat_path: newCleanedCompatPath,
          })
          .eq("id", newSceneId);

        if (updateSceneError) {
          await rollback();
          return { error: updateSceneError.message };
        }
      }

      const { data: originalHotspots, error: hotspotsError } = await supabase
        .from("hotspots")
        .select("*")
        .in(
          "scene_id",
          scenes.map((scene) => scene.id),
        );

      if (hotspotsError) {
        await rollback();
        return { error: hotspotsError.message };
      }

      const hotspots = originalHotspots ?? [];
      const hotspotIdMap = new Map<string, string>();
      if (hotspots.length > 0) {
        const hotspotInserts: HotspotInsert[] = hotspots.map((hotspot) => {
          const newSceneId = sceneIdMap.get(hotspot.scene_id);
          if (!newSceneId) {
            throw new Error("Missing scene remap for hotspot.");
          }
          const newHotspotId = crypto.randomUUID();
          hotspotIdMap.set(hotspot.id, newHotspotId);

          return {
            id: newHotspotId,
            scene_id: newSceneId,
            target_scene_id: hotspot.target_scene_id
              ? (sceneIdMap.get(hotspot.target_scene_id) ?? null)
              : null,
            type: hotspot.type,
            yaw: hotspot.yaw,
            pitch: hotspot.pitch,
            label: hotspot.label,
            content: hotspot.content,
            style_shape: hotspot.style_shape,
            style_color: hotspot.style_color,
            style_size: hotspot.style_size,
            style_animation: hotspot.style_animation,
            label_visibility: hotspot.label_visibility,
            video_id: hotspot.video_id,
            video_start: hotspot.video_start,
          };
        });

        const { error: insertHotspotsError } = await supabase
          .from("hotspots")
          .insert(hotspotInserts);

        if (insertHotspotsError) {
          await rollback();
          return { error: insertHotspotsError.message };
        }

        const originalHotspotIds = hotspots.map((h) => h.id);
        const { data: originalImages, error: imagesError } = await supabase
          .from("hotspot_images")
          .select("*")
          .in("hotspot_id", originalHotspotIds);

        if (imagesError) {
          await rollback();
          return { error: imagesError.message };
        }

        const images = originalImages ?? [];
        if (images.length > 0) {
          const imageInserts: HotspotImageInsert[] = [];

          for (const image of images) {
            const newHotspotId = hotspotIdMap.get(image.hotspot_id);
            if (!newHotspotId) {
              throw new Error("Missing hotspot remap for gallery image.");
            }
            const newImageId = crypto.randomUUID();
            const newStoragePath = galleryPath(user.id, newTourId, newImageId);
            const newThumbPath = image.thumbnail_path
              ? galleryThumbPath(user.id, newTourId, newImageId)
              : null;

            const { error: copyFullError } = await supabase.storage
              .from("panoramas")
              .copy(image.storage_path, newStoragePath);
            if (copyFullError) {
              await rollback();
              return { error: copyFullError.message };
            }
            copiedStoragePaths.push(newStoragePath);

            if (image.thumbnail_path && newThumbPath) {
              const { error: copyThumbError } = await supabase.storage
                .from("panoramas")
                .copy(image.thumbnail_path, newThumbPath);
              if (copyThumbError) {
                await rollback();
                return { error: copyThumbError.message };
              }
              copiedStoragePaths.push(newThumbPath);
            }

            imageInserts.push({
              id: newImageId,
              hotspot_id: newHotspotId,
              storage_path: newStoragePath,
              thumbnail_path: newThumbPath,
              caption: image.caption,
              position: image.position,
            });
          }

          const { error: insertImagesError } = await supabase
            .from("hotspot_images")
            .insert(imageInserts);

          if (insertImagesError) {
            await rollback();
            return { error: insertImagesError.message };
          }
        }
      }

      const newCoverSceneId = original.cover_scene_id
        ? (sceneIdMap.get(original.cover_scene_id) ?? null)
        : null;
      const newStartSceneId = original.start_scene_id
        ? (sceneIdMap.get(original.start_scene_id) ?? null)
        : null;

      if (newCoverSceneId || newStartSceneId) {
        const { error: coverError } = await supabase
          .from("tours")
          .update({
            cover_scene_id: newCoverSceneId,
            start_scene_id: newStartSceneId,
          })
          .eq("id", newTourId);

        if (coverError) {
          await rollback();
          return { error: coverError.message };
        }
      }
    }

    revalidatePath("/dashboard");
    return {};
  } catch (err) {
    await rollback();
    return {
      error: err instanceof Error ? err.message : "Failed to duplicate tour.",
    };
  }
}
