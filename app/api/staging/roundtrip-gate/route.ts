import { NextResponse } from "next/server";

import { runRoundTripForScene } from "@/lib/staging/process-job";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * POST /api/staging/roundtrip-gate
 * Server-side Part 0 validation on Vercel (no session cookie).
 * Auth: Authorization: Bearer <STAGING_GATE_SECRET>
 *
 * Body: { sceneId: string, perspectiveSize?: number, skipUpload?: boolean }
 */
export async function POST(request: Request) {
  const secret = process.env.STAGING_GATE_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "STAGING_GATE_SECRET is not configured." },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== secret) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let body: {
    sceneId?: unknown;
    perspectiveSize?: unknown;
    skipUpload?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
  const perspectiveSize =
    typeof body.perspectiveSize === "number" ? body.perspectiveSize : 512;
  const skipUpload = body.skipUpload !== false;

  if (!sceneId) {
    return NextResponse.json({ error: "sceneId is required." }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select("id, tour_id, storage_path, width, height, name")
    .eq("id", sceneId)
    .maybeSingle();

  if (sceneError) {
    return NextResponse.json({ error: sceneError.message }, { status: 500 });
  }
  if (!scene) {
    return NextResponse.json({ error: "Scene not found." }, { status: 404 });
  }

  const { data: tour, error: tourError } = await admin
    .from("tours")
    .select("id, owner_id")
    .eq("id", scene.tour_id)
    .maybeSingle();

  if (tourError) {
    return NextResponse.json({ error: tourError.message }, { status: 500 });
  }
  if (!tour) {
    return NextResponse.json({ error: "Tour not found." }, { status: 404 });
  }

  try {
    const result = await runRoundTripForScene({
      ownerId: tour.owner_id,
      tourId: scene.tour_id,
      sceneId: scene.id,
      storagePath: scene.storage_path,
      perspectiveSize,
      skipUpload,
    });

    return NextResponse.json({
      where: "vercel",
      sceneId: scene.id,
      sceneName: scene.name,
      memoryStrategy:
        "Float32 accumulators + sequential views; full-res composite (no downscale)",
      vercelLimits: { memoryGb: 2, maxDurationSec: 300 },
      ...result,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "Round-trip gate failed.",
        heapMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      },
      { status: 500 },
    );
  }
}
