import { NextResponse } from "next/server";

import {
  requireOwnedTour,
  requireUser,
  stagingError,
} from "@/lib/staging/auth";
import {
  isStagingEnabled,
  stagingMaxJobsPerTour,
} from "@/lib/staging/providers";
import type { Json } from "@/types/database";

export const runtime = "nodejs";
/** Create is a light DB insert — keep short. */
export const maxDuration = 30;

const KIND_RE = /^(nadir_fill|stage_room)$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    return stagingError(
      503,
      "STAGING_DISABLED",
      "Staging is not enabled on this deployment (STAGING_ENABLED must be \"true\").",
    );
  }

  let body: CreateBody;
  try {
    body = (await request.json()) as CreateBody;
  } catch {
    return stagingError(400, "BAD_REQUEST", "Invalid JSON body.");
  }

  if (process.env.NODE_ENV === "development") {
    console.info("[staging/jobs] parsed body", {
      tourId: body.tourId ?? null,
      sceneId: body.sceneId ?? null,
      kind: body.kind ?? null,
      keys: Object.keys(body as object),
    });
  }

  const tourId = typeof body.tourId === "string" ? body.tourId.trim() : "";
  const sceneId = typeof body.sceneId === "string" ? body.sceneId.trim() : "";
  const kind = typeof body.kind === "string" ? body.kind.trim() : "";
  const params = asJsonObject(body.params);

  if (!tourId) {
    return stagingError(
      400,
      "BAD_REQUEST",
      "Missing required field “tourId”.",
    );
  }
  if (!UUID_RE.test(tourId)) {
    return stagingError(
      400,
      "BAD_REQUEST",
      "Field “tourId” must be a UUID.",
    );
  }
  if (!sceneId) {
    return stagingError(
      400,
      "BAD_REQUEST",
      "Missing required field “sceneId”.",
    );
  }
  if (!UUID_RE.test(sceneId)) {
    return stagingError(
      400,
      "BAD_REQUEST",
      "Field “sceneId” must be a UUID.",
    );
  }
  if (!KIND_RE.test(kind)) {
    return stagingError(
      400,
      "BAD_REQUEST",
      "Field “kind” must be nadir_fill or stage_room.",
    );
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

  const maxJobs = stagingMaxJobsPerTour();
  const { count, error: countError } = await owned.supabase
    .from("staging_jobs")
    .select("id", { count: "exact", head: true })
    .eq("tour_id", tourId);

  if (countError) {
    // Likely migration not applied (unknown column) or RLS.
    if (process.env.NODE_ENV === "development") {
      console.info("[staging/jobs] count error", countError);
    }
    return stagingError(500, "INTERNAL", countError.message);
  }
  if ((count ?? 0) >= maxJobs) {
    return stagingError(
      429,
      "RATE_LIMIT",
      `This tour has reached the staging job limit (${maxJobs}).`,
    );
  }

  const { data: scene, error: sceneError } = await owned.supabase
    .from("scenes")
    .select("id, tour_id")
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
    if (process.env.NODE_ENV === "development") {
      console.info("[staging/jobs] insert error", insertError);
    }
    return stagingError(
      500,
      "INTERNAL",
      insertError?.message ?? "Failed to create job.",
    );
  }

  return NextResponse.json({ job }, { status: 201 });
}

export async function GET() {
  const auth = await requireUser();
  if (!auth.user) {
    return stagingError(401, "UNAUTHORIZED", "Unauthorized.");
  }
  return stagingError(
    405,
    "BAD_REQUEST",
    "Use GET /api/staging/jobs/[id].",
  );
}
