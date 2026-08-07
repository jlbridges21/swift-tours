"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { HEX_COLOR_RE, isHotspotShape } from "@/lib/hotspot-styles";
import { isNadirType } from "@/lib/nadir";
import { generateSlug } from "@/lib/slug";
import { sceneObjectPaths } from "@/lib/storage";
import { createClient } from "@/lib/supabase/server";
import type { HotspotInsert, SceneInsert, TourInsert } from "@/types";

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
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
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
    })
    .eq("id", id)
    .select("slug")
    .maybeSingle();

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/dashboard/tours/${id}/edit`);
  if (tour?.slug) {
    revalidatePath(`/tour/${tour.slug}`);
    revalidatePath(`/embed/${tour.slug}`);
  }
  return {};
}

export async function updateTourNadir(
  id: string,
  input: {
    nadir_type?: string;
    nadir_logo_path?: string | null;
    nadir_size?: number;
    nadir_opacity?: number;
    nadir_rotation?: number;
  },
): Promise<ActionResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "You must be signed in to update a tour." };
  }

  const patch: {
    nadir_type?: string;
    nadir_logo_path?: string | null;
    nadir_size?: number;
    nadir_opacity?: number;
    nadir_rotation?: number;
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

  if (Object.keys(patch).length === 0) {
    return {};
  }

  const { data: tour, error } = await supabase
    .from("tours")
    .update(patch)
    .eq("id", id)
    .select("slug")
    .maybeSingle();

  if (error) {
    return { error: error.message };
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
    .select("slug")
    .eq("id", id)
    .maybeSingle();

  // Collect storage paths before the row (and cascade) disappears.
  const { data: scenes, error: scenesError } = await supabase
    .from("scenes")
    .select("storage_path, thumbnail_path, compat_path, nadir_patch_path")
    .eq("tour_id", id);

  if (scenesError) {
    return { error: scenesError.message };
  }

  const paths: string[] = [];
  for (const scene of scenes ?? []) {
    paths.push(...sceneObjectPaths(scene));
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

  const { error } = await supabase.from("tours").delete().eq("id", id);

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

  const created = await insertTourWithUniqueSlug(supabase, {
    owner_id: user.id,
    title: `${original.title} (Copy)`,
    description: original.description,
    is_public: false,
    default_hotspot_shape: original.default_hotspot_shape,
    default_hotspot_color: original.default_hotspot_color,
    nadir_type: original.nadir_type,
    nadir_logo_path: original.nadir_logo_path,
    nadir_size: original.nadir_size,
    nadir_opacity: original.nadir_opacity,
    nadir_rotation: original.nadir_rotation,
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
          position: scene.position,
          initial_yaw: scene.initial_yaw,
          initial_pitch: scene.initial_pitch,
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

        const { error: updateSceneError } = await supabase
          .from("scenes")
          .update({
            storage_path: newStoragePath,
            thumbnail_path: newThumbnailPath,
            compat_path: newCompatPath,
            nadir_patch_path: newNadirPath,
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
      if (hotspots.length > 0) {
        const hotspotInserts: HotspotInsert[] = hotspots.map((hotspot) => {
          const newSceneId = sceneIdMap.get(hotspot.scene_id);
          if (!newSceneId) {
            throw new Error("Missing scene remap for hotspot.");
          }

          return {
            scene_id: newSceneId,
            target_scene_id: hotspot.target_scene_id
              ? (sceneIdMap.get(hotspot.target_scene_id) ?? null)
              : null,
            type: hotspot.type,
            yaw: hotspot.yaw,
            pitch: hotspot.pitch,
            label: hotspot.label,
            content: hotspot.content,
          };
        });

        const { error: insertHotspotsError } = await supabase
          .from("hotspots")
          .insert(hotspotInserts);

        if (insertHotspotsError) {
          await rollback();
          return { error: insertHotspotsError.message };
        }
      }

      const newCoverSceneId = original.cover_scene_id
        ? (sceneIdMap.get(original.cover_scene_id) ?? null)
        : null;

      if (newCoverSceneId) {
        const { error: coverError } = await supabase
          .from("tours")
          .update({ cover_scene_id: newCoverSceneId })
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
