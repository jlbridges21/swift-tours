/**
 * One-shot nadir_fill E2E after room-staging excision.
 *   npx tsx --env-file=.env.local scripts/nadir-e2e-smoke.ts
 */
import Module from "node:module";

const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })
  ._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load =
  function (request: string, parent: unknown, isMain: boolean) {
    if (request === "server-only") return {};
    return (originalLoad as Function).call(this, request, parent, isMain);
  };

process.env.STAGING_ENABLED = "true";

const TOUR_ID = "3c477cd2-edf2-4fd6-93e0-037ccc43c151";
const SCENE_ID = "a6a49c11-e308-4c2f-86f7-158b4c16efe7"; // Entry
const PROVIDER = process.env.NADIR_E2E_PROVIDER || "texture_fill";

async function main() {
  const { createClient } = await import("@supabase/supabase-js");
  const { processStagingJob } = await import("../lib/staging/process-job");

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: job, error } = await sb
    .from("staging_jobs")
    .insert({
      tour_id: TOUR_ID,
      scene_id: SCENE_ID,
      kind: "nadir_fill",
      status: "queued",
      params: { provider: PROVIDER },
    })
    .select("id")
    .maybeSingle();
  if (error || !job) throw new Error(error?.message ?? "insert failed");
  console.log("created job", job.id, "provider", PROVIDER);

  let last: Awaited<ReturnType<typeof processStagingJob>> | null = null;
  for (let i = 0; i < 90; i++) {
    last = await processStagingJob(job.id);
    console.log(
      `tick ${i + 1}:`,
      last.status,
      last.error ?? "",
      typeof last.result === "object" ? JSON.stringify(last.result) : "",
    );
    if (last.status === "succeeded" || last.status === "failed") break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const { data: jobRow } = await sb
    .from("staging_jobs")
    .select("id, status, error, result_path, cost_cents")
    .eq("id", job.id)
    .maybeSingle();
  console.log("final job row:", JSON.stringify(jobRow, null, 2));

  // Always discard candidate so the scene is not left awaiting review.
  const { data: full } = await sb
    .from("staging_jobs")
    .select("params, result_path")
    .eq("id", job.id)
    .maybeSingle();
  const params = (full?.params ?? {}) as Record<string, unknown>;
  const paths = [
    ...(Array.isArray(params.candidatePaths)
      ? (params.candidatePaths as string[])
      : []),
    ...(Array.isArray(params.candidateCompatPaths)
      ? (params.candidateCompatPaths as Array<string | null>).filter(
          (p): p is string => Boolean(p),
        )
      : []),
    full?.result_path,
  ].filter((p): p is string => Boolean(p));
  if (paths.length) await sb.storage.from("panoramas").remove(paths);
  await sb
    .from("staging_jobs")
    .update({
      status: last?.status === "succeeded" ? "cancelled" : (jobRow?.status ?? "failed"),
      result_path: null,
      params: { ...params, awaitingReview: false, discarded: true },
    })
    .eq("id", job.id);

  if (last?.status !== "succeeded") {
    process.exitCode = 1;
    console.error("NADIR E2E FAILED");
    return;
  }
  console.log(`NADIR E2E OK (${PROVIDER}) — candidate discarded`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
