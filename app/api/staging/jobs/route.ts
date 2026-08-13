import { NextResponse } from "next/server";

import { requireOwnedTour, requireUser } from "@/lib/staging/auth";
import {
  isStagingEnabled,
  stagingMaxJobsPerTour,
} from "@/lib/staging/providers";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
/** Long enough for a full-sphere round-trip on large panos; within Hobby max. */
export const maxDuration = 300;

const KIND_RE = /^(nadir_fill|stage_room)$/;

type CreateBody = {
  tourId?: unknown;
  sceneId?: unknown;
  kind?: unknown;
  params?: unknown;
};

function asJsonObject(value: unknown): Record<string, Json> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, Json> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (
      entry === null ||
      typeof entry === "string" ||
      typeof entry === "number" ||
      typeof entry === "boolean"
    ) {
      out[key] = entry;
    } else if (typeof entry === "object") {
      out[key] = entry as Json;
    }
  }
  return out;
}

/**
 * POST /api/staging/jobs
 * Authenticated owner creates a queued staging job.
 */
export async function POST(request: Request) {
  if (!isStagingEnabled()) {
    return NextResponse.json(
      { error: "Staging is not enabled on this deployment." },
      { status: 403 },
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const tourId = typeof body.tourId === "string" ? body.tourId : "";
  const sceneId = typeof body.sceneId === "string" ? body.sceneId : "";
  const kind = typeof body.kind === "string" ? body.kind : "";
  const params = asJsonObject(body.params);

  if (!tourId || !sceneId || !KIND_RE.test(kind)) {
    return NextResponse.json(
      {
        error:
          "tourId, sceneId, and kind (nadir_fill|stage_room) are required.",
      },
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

  const maxJobs = stagingMaxJobsPerTour();
  const { count, error: countError } = await owned.supabase
    .from("staging_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId);

  if (countError) {
    return NextResponse.json({ error: countError.message }, { status: 500 });
  }
  if ((count ?? 0) >= maxJobs) {
    return NextResponse.json(
      {
        error: `This tour has reached the staging job limit (${maxJobs}).`,
      },
      { status: 429 },
    );
  }

  const { data: scene, error: sceneError } = await owned.supabase
    .from("scenes")
    .select("id, tour_id")
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

  const { data: job, error: insertError } = await owned.supabase
    .from("staging_jobs")
    .insert({
      tour_id: tourId,
      scene_id: sceneId,
      kind,
      status: "queued",
      params,
    })
    .select(
      "id, tour_id, scene_id, kind, status, params, provider, provider_job_id, created_at",
    )
    .maybeSingle();

  if (insertError || !job) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create job." },
      { status: 500 },
    );
  }

  return NextResponse.json({ job }, { status: 201 });
}

/**
 * GET /api/staging/jobs?id=… — convenience list is not exposed; use [id].
 * Kept empty so accidental GETs on the collection do not leak.
 */
export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  return NextResponse.json(
    { error: "Use GET /api/staging/jobs/[id]." },
    { status: 405 },
  );
}
