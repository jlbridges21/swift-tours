import { NextResponse } from "next/server";

import { requireOwnedTour, stagingError } from "@/lib/staging/auth";
import { runRoundTripForScene } from "@/lib/staging/process-job";
import { publicUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * POST /api/staging/roundtrip
 * Dev/owner verification: no-op projection round-trip for a scene.
 */
export async function POST(request: Request) {
  let body: { tourId?: unknown; sceneId?: unknown; perspectiveSize?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return stagingError(400, "BAD_REQUEST", "Invalid JSON body.");
  }

  const tourId = typeof body.tourId === "string" ? body.tourId.trim() : "";
  const sceneId = typeof body.sceneId === "string" ? body.sceneId.trim() : "";
  const perspectiveSize =
    typeof body.perspectiveSize === "number" ? body.perspectiveSize : 512;

  if (!tourId) {
    return stagingError(400, "BAD_REQUEST", "Missing required field “tourId”.");
  }
  if (!UUID_RE.test(tourId)) {
    return stagingError(400, "BAD_REQUEST", "Field “tourId” must be a UUID.");
  }
  if (!sceneId) {
    return stagingError(400, "BAD_REQUEST", "Missing required field “sceneId”.");
  }
  if (!UUID_RE.test(sceneId)) {
    return stagingError(400, "BAD_REQUEST", "Field “sceneId” must be a UUID.");
  }

  const owned = await requireOwnedTour(tourId);
  if (!owned.user) {
    return stagingError(401, "UNAUTHORIZED", owned.error ?? "Unauthorized.");
  }
  if (!owned.tour) {
    const status =
      owned.code === "FORBIDDEN"
        ? 403
        : owned.code === "UNAUTHORIZED"
          ? 401
          : owned.code === "INTERNAL"
            ? 500
            : 404;
    const code =
      owned.code === "FORBIDDEN"
        ? "FORBIDDEN"
        : owned.code === "UNAUTHORIZED"
          ? "UNAUTHORIZED"
          : owned.code === "INTERNAL"
            ? "INTERNAL"
            : "NOT_FOUND";
    return stagingError(status, code, owned.error ?? "Tour not found.");
  }

  const { data: scene, error: sceneError } = await owned.supabase
    .from("scenes")
    .select("id, tour_id, storage_path")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return stagingError(500, "INTERNAL", sceneError.message);
  }
  if (!scene) {
    return stagingError(404, "NOT_FOUND", "Scene not found.");
  }
  if (scene.tour_id !== tourId) {
    return stagingError(
      403,
      "FORBIDDEN",
      "Scene does not belong to this tour.",
    );
  }

  try {
    const result = await runRoundTripForScene({
      ownerId: owned.user.id,
      tourId,
      sceneId,
      storagePath: scene.storage_path,
      perspectiveSize,
    });

    return NextResponse.json({
      resultPath: result.resultPath,
      publicUrl: publicUrl(result.resultPath),
      viewCount: result.viewCount,
      width: result.width,
      height: result.height,
      durationMs: result.durationMs,
      peakHeapMb: result.peakHeapMb,
      peakRssMb: result.peakRssMb,
      replaceStats: result.replaceStats,
      changedOnlyStats: result.changedOnlyStats,
      seamReplaceStats: result.seamReplaceStats,
      note:
        "Eyeball: open publicUrl (or load the storage object). changedOnly should match the source; replaceStats measure pure reprojection error.",
    });
  } catch (err) {
    return stagingError(
      500,
      "INTERNAL",
      err instanceof Error ? err.message : "Round-trip failed.",
    );
  }
}
