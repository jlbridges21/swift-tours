import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getViewStrategy,
  type ViewStrategyId,
} from "@/lib/staging/view-strategies";
import { publicUrl } from "@/lib/storage";

export type StagingOrderEntry = {
  sceneId: string;
  name: string;
  outboundLinks: number;
  roomKey: string | null;
  alreadyStaged: boolean;
};

/** Smallest absolute yaw delta on the circle. */
export function yawDelta(a: number, b: number): number {
  let d = ((a - b) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  return Math.abs(d);
}

/** True when hotspot yaw sits inside the view's horizontal FOV (square ≈ fov). */
export function yawInViewFov(
  hotspotYaw: number,
  viewYaw: number,
  fov: number,
): boolean {
  return yawDelta(hotspotYaw, viewYaw) <= fov / 2;
}

/**
 * Deterministic staging order: most outbound link hotspots first, then name.
 * Scenes already staged (staged_enabled + staged_path) are flagged but still listed.
 */
export async function computeTourStagingOrder(
  tourId: string,
): Promise<StagingOrderEntry[]> {
  const admin = createAdminClient();
  const { data: scenes, error } = await admin
    .from("scenes")
    .select(
      "id, name, room_key, staged_path, staged_enabled, position",
    )
    .eq("tour_id", tourId)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);

  const sceneIds = (scenes ?? []).map((s) => s.id);
  const counts = new Map<string, number>();
  for (const id of sceneIds) counts.set(id, 0);

  if (sceneIds.length > 0) {
    const { data: links, error: linkErr } = await admin
      .from("hotspots")
      .select("scene_id")
      .eq("type", "link")
      .in("scene_id", sceneIds);
    if (linkErr) throw new Error(linkErr.message);
    for (const row of links ?? []) {
      counts.set(row.scene_id, (counts.get(row.scene_id) ?? 0) + 1);
    }
  }

  const entries: StagingOrderEntry[] = (scenes ?? []).map((s) => ({
    sceneId: s.id,
    name: s.name,
    outboundLinks: counts.get(s.id) ?? 0,
    roomKey: s.room_key,
    alreadyStaged: Boolean(s.staged_enabled && s.staged_path),
  }));

  entries.sort((a, b) => {
    if (b.outboundLinks !== a.outboundLinks) {
      return b.outboundLinks - a.outboundLinks;
    }
    return a.name.localeCompare(b.name);
  });

  return entries;
}

export type AdjacentRoomCollage = {
  imagePath: string;
  imageUrl: string;
  targetSceneId: string;
  targetRoomKey: string;
  hotspotYaw: number;
};

/**
 * For a view in scene B, find a staged adjacent-room reference via the link graph.
 */
export async function findAdjacentRoomCollageRef(options: {
  tourId: string;
  sceneId: string;
  sceneRoomKey: string | null;
  viewYaw: number;
  viewFov: number;
  strategyId: ViewStrategyId;
}): Promise<AdjacentRoomCollage | null> {
  const admin = createAdminClient();
  const { data: links, error } = await admin
    .from("hotspots")
    .select("id, yaw, target_scene_id")
    .eq("scene_id", options.sceneId)
    .eq("type", "link")
    .not("target_scene_id", "is", null);
  if (error) throw new Error(error.message);

  const inView = (links ?? []).filter(
    (h) =>
      typeof h.target_scene_id === "string" &&
      yawInViewFov(h.yaw, options.viewYaw, options.viewFov),
  );
  if (inView.length === 0) return null;

  // Prefer the hotspot closest to view center.
  inView.sort(
    (a, b) =>
      yawDelta(a.yaw, options.viewYaw) - yawDelta(b.yaw, options.viewYaw),
  );

  for (const link of inView) {
    const targetId = link.target_scene_id!;
    const { data: target, error: tErr } = await admin
      .from("scenes")
      .select(
        "id, room_key, staged_path, staged_enabled, staging_layout",
      )
      .eq("id", targetId)
      .maybeSingle();
    if (tErr || !target) continue;
    if (!target.staged_enabled || !target.staged_path) continue;
    if (
      options.sceneRoomKey &&
      target.room_key &&
      target.room_key === options.sceneRoomKey
    ) {
      continue; // same physical room — use same-room collage instead
    }

    // Return link from target → B (best facing direction back).
    const { data: returns } = await admin
      .from("hotspots")
      .select("yaw")
      .eq("scene_id", targetId)
      .eq("type", "link")
      .eq("target_scene_id", options.sceneId);

    const returnYaw =
      returns && returns.length > 0
        ? returns.sort(
            (a, b) =>
              yawDelta(a.yaw, link.yaw + Math.PI) -
              yawDelta(b.yaw, link.yaw + Math.PI),
          )[0]!.yaw
        : (link.yaw + Math.PI) % (2 * Math.PI);

    // Prefer a persisted staged view whose yaw faces back toward B.
    const { data: views } = await admin
      .from("staging_views")
      .select("yaw, result_path, status, view_index")
      .eq("scene_id", targetId)
      .eq("status", "succeeded")
      .not("result_path", "is", null);

    let bestPath: string | null = null;
    if (views && views.length > 0) {
      const ranked = [...views].sort(
        (a, b) => yawDelta(a.yaw, returnYaw) - yawDelta(b.yaw, returnYaw),
      );
      bestPath = ranked[0]?.result_path ?? null;
    }

    // Fallback: crop from the staged equirect at the return yaw (strategy size).
    if (!bestPath && target.staged_path) {
      // Caller will crop if we only have equirect — signal via path + marker.
      bestPath = target.staged_path;
    }
    if (!bestPath) continue;

    return {
      imagePath: bestPath,
      imageUrl: publicUrl(bestPath),
      targetSceneId: targetId,
      targetRoomKey: target.room_key ?? "adjacent_room",
      hotspotYaw: link.yaw,
    };
  }

  return null;
}

/** Crop a perspective from an equirect path when the collage ref is a full pano. */
export async function loadCollageRightHalf(options: {
  path: string;
  preferViewResult: boolean;
  returnYaw?: number;
  strategyId: ViewStrategyId;
}): Promise<Buffer | null> {
  const admin = createAdminClient();
  const { data: file, error } = await admin.storage
    .from("panoramas")
    .download(options.path);
  if (error || !file) return null;
  const buf = Buffer.from(await file.arrayBuffer());

  // View result JPEGs are already perspective — use as-is.
  if (options.path.includes("/views/") && options.path.endsWith("-result.jpg")) {
    return buf;
  }

  // Full equirect — crop facing returnYaw.
  const { decodeImageToRgba, encodeRgbaToJpeg } = await import(
    "@/lib/staging/image-codec"
  );
  const { equirectToPerspective } = await import("@/lib/staging/projection");
  const strategy = getViewStrategy(options.strategyId);
  const rgba = await decodeImageToRgba(buf);
  const yaw = options.returnYaw ?? 0;
  const view = strategy.views[0]!;
  const persp = equirectToPerspective(rgba, {
    yaw,
    pitch: view.pitch,
    fov: view.fov,
    width: strategy.size,
    height: strategy.size,
  });
  return encodeRgbaToJpeg(persp, 92);
}
