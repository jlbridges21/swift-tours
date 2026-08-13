import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireUser, stagingError } from "@/lib/staging/auth";
import { isStagingEnabled } from "@/lib/staging/providers";
import { processStagingJob } from "@/lib/staging/process-job";

export const runtime = "nodejs";
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/staging/jobs/[id]/process
 * Owner-triggered worker tick — never blocks waiting on fal end-to-end.
 */
export async function POST(_request: Request, context: RouteContext) {
  if (!isStagingEnabled()) {
    return stagingError(
      503,
      "STAGING_DISABLED",
      "Staging is not enabled on this deployment (STAGING_ENABLED must be \"true\").",
    );
  }

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
    .select("id, tour_id")
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
    .select("id, slug, owner_id")
    .eq("id", job.tour_id)
    .maybeSingle();

  if (tourError) {
    return stagingError(500, "INTERNAL", tourError.message);
  }
  if (!tour) {
    return stagingError(404, "NOT_FOUND", "Tour not found.");
  }
  if (tour.owner_id !== auth.user.id) {
    return stagingError(403, "FORBIDDEN", "You do not own this tour.");
  }

  let result;
  try {
    result = await processStagingJob(id);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Staging process failed.";
    if (
      message.includes("FAL_KEY") ||
      message.includes("STAGING_PROVIDER") ||
      message.includes("Provider")
    ) {
      return stagingError(503, "PROVIDER_MISCONFIGURED", message);
    }
    return stagingError(500, "INTERNAL", message);
  }

  if (result.status === "succeeded" && tour.slug) {
    revalidatePath(`/tour/${tour.slug}`);
    revalidatePath(`/embed/${tour.slug}`);
  }

  if (result.status === "failed") {
    return stagingError(
      422,
      "JOB_FAILED",
      result.error ?? "Staging job failed.",
      { status: result.status },
    );
  }

  return NextResponse.json({
    status: result.status,
    result: result.result,
    error: result.error,
  });
}
