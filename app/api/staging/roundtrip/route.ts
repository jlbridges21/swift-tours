import { NextResponse } from "next/server";

import { requireOwnedTour } from "@/lib/staging/auth";
import { runRoundTripForScene } from "@/lib/staging/process-job";
import { publicUrl } from "@/lib/storage";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/staging/roundtrip
 * Dev/owner verification: no-op projection round-trip for a scene.
 * Writes `{userId}/{tourId}/{sceneId}_staging_roundtrip.jpg` and returns stats.
 *
 * In production this still requires ownership (safe), but prefer local/dev use.
 */
export async function POST(request: Request) {
  let body: { tourId?: unknown; sceneId?: unknown; perspectiveSize?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tourId = typeof body.tourId === "string" ? body.tourId : "";
  const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
  const perspectiveSize =
    typeof body.perspectiveSize === "number" ? body.perspectiveSize : 512;

  if (!tourId || !sceneId) {
    return NextResponse.json(
      { error: "tourId and sceneId are required." },
      { status: 400 },
    );
  }

  const owned = await requireOwnedTour(tourId);
  if (!owned.user || !owned.tour) {
    return NextResponse.json(
      { error: owned.error ?? "Unauthorized." },
      { status: owned.error === "Unauthorized." ? 401 : 404 },
    );
  }

  const { data: scene, error: sceneError } = await owned.supabase
    .from("scenes")
    .select("id, tour_id, storage_path")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return NextResponse.json({ error: sceneError.message }, { status: 500 });
  }
  if (!scene || scene.tour_id !== tourId) {
    return NextResponse.json(
      { error: "Scene not found in this tour." },
      { status: 404 },
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
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Round-trip failed.",
      },
      { status: 500 },
    );
  }
}
