import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/staging/auth";
import { processStagingJob } from "@/lib/staging/process-job";

export const runtime = "nodejs";
/** Prep + one fal poll + composite; fal itself is not awaited to completion. */
export const maxDuration = 300;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * POST /api/staging/jobs/[id]/process
 * Owner-triggered worker tick:
 *   - nadir_fill: submit to fal queue OR poll once and composite when ready
 * Never blocks the function waiting on the model end-to-end.
 */
export async function POST(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: job, error } = await auth.supabase
    .from("staging_jobs")
    .select("id, tour_id")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  const { data: tour } = await auth.supabase
    .from("tours")
    .select("id, slug")
    .eq("id", job.tour_id)
    .eq("owner_id", auth.user.id)
    .maybeSingle();

  if (!tour) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const result = await processStagingJob(id);

  if (result.status === "succeeded" && tour.slug) {
    revalidatePath(`/tour/${tour.slug}`);
    revalidatePath(`/embed/${tour.slug}`);
  }

  if (result.status === "failed") {
    return NextResponse.json(
      { status: result.status, error: result.error },
      { status: 422 },
    );
  }

  return NextResponse.json({
    status: result.status,
    result: result.result,
    error: result.error,
  });
}
