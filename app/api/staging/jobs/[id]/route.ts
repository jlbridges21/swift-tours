import { NextResponse } from "next/server";

import { requireUser } from "@/lib/staging/auth";

export const runtime = "nodejs";
export const maxDuration = 60;

type RouteContext = {
  params: Promise<{ id: string }>;
};

/**
 * GET /api/staging/jobs/[id] — owner-only job status.
 */
export async function GET(_request: Request, context: RouteContext) {
  const { id } = await context.params;
  const auth = await requireUser();
  if (!auth.user) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const { data: job, error } = await auth.supabase
    .from("staging_jobs")
    .select(
      "id, tour_id, scene_id, kind, status, params, result_path, error, cost_cents, provider, provider_job_id, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!job) {
    return NextResponse.json({ error: "Job not found." }, { status: 404 });
  }

  return NextResponse.json({ job });
}
