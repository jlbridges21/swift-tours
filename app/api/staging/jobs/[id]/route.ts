import { NextResponse } from "next/server";

import { requireUser, stagingError } from "@/lib/staging/auth";

export const runtime = "nodejs";
/** Status poll — must stay cheap. */
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/staging/jobs/[id] — owner-only job status.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  if (!id) {
    return stagingError(400, "BAD_REQUEST", "Missing job id.");
  }

  const auth = await requireUser();
  if (!auth.user) {
    return stagingError(401, "UNAUTHORIZED", "Unauthorized.");
  }

  const { data: job, error } = await auth.supabase
    .from("staging_jobs")
    .select(
      "id, tour_id, scene_id, kind, status, params, result_path, error, cost_cents, provider, provider_job_id, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return stagingError(500, "INTERNAL", error.message);
  }
  if (!job) {
    return stagingError(404, "NOT_FOUND", "Job not found.");
  }

  const { data: tour, error: tourError } = await auth.supabase
    .from("tours")
    .select("id, owner_id")
    .eq("id", job.tour_id)
    .maybeSingle();

  if (tourError) {
    return stagingError(500, "INTERNAL", tourError.message);
  }
  if (!tour || tour.owner_id !== auth.user.id) {
    return stagingError(403, "FORBIDDEN", "You do not own this tour.");
  }

  return NextResponse.json({ job });
}
