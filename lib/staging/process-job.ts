import "server-only";

import { decodeImageToRgba, encodeRgbaToJpeg } from "@/lib/staging/image-codec";
import {
  JOB_ABSOLUTE_TIMEOUT_MS,
  NADIR_FILL_CROP_SIZE,
  STAGE_ROOM_ABSOLUTE_TIMEOUT_MS,
  WORKER_LEASE_MS,
  isStagingDebugEnabled,
  type NadirFillJobResult,
} from "@/lib/staging/process-job-constants";
import { processNadirFillJob } from "@/lib/staging/process-nadir-fill";
import {
  processStageRoomJob,
  type StageRoomJobResult,
} from "@/lib/staging/process-stage-room";
import { roundTripNoEdit, type DiffStats } from "@/lib/staging/projection";
import { estimateFluxFillCostCents } from "@/lib/staging/providers/fal-flux-fill";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  stagingDebugPath,
  stagingWorkCropPath,
  stagingWorkMaskPath,
  stagingRoundtripPath,
} from "@/lib/storage";
import type { Json } from "@/types/database";

export {
  JOB_ABSOLUTE_TIMEOUT_MS,
  NADIR_FILL_CROP_SIZE,
  NADIR_FILL_FOV_DEGREES,
  NADIR_FILL_MASK_FEATHER_PX,
  NADIR_FILL_MASK_RADIUS_RATIO,
  STAGE_ROOM_ABSOLUTE_TIMEOUT_MS,
  STALE_PROCESSING_MS,
  WORKER_LEASE_MS,
  isStagingDebugEnabled,
} from "@/lib/staging/process-job-constants";
export type { NadirFillJobResult } from "@/lib/staging/process-job-constants";

/** Per-job cost for a default-size crop (honest fal rounding). */
export function nadirFillEstimatedCostCents(
  cropSize = NADIR_FILL_CROP_SIZE,
): number {
  return estimateFluxFillCostCents(cropSize, cropSize);
}

export const NADIR_FILL_PROMPT_LEGACY =
  "Continue the existing floor surface seamlessly through the center. Match the exact floor material, color, texture, grout lines or plank direction, and lighting. Fill only the masked tripod region. Add no objects, no furniture, no people, no shadows, no logos, and no text. Avoid: furniture, objects, people, text, watermark, tripod, camera, shadow, logo, reflections of equipment.";

export type RoundTripJobResult = {
  resultPath: string;
  replaceStats: DiffStats;
  changedOnlyStats: DiffStats;
  seamReplaceStats: DiffStats;
  viewCount: number;
  width: number;
  height: number;
  durationMs: number;
  peakHeapMb: number;
  peakRssMb: number;
};
function heapMb(): number {
  const m = process.memoryUsage();
  return (
    Math.round(
      ((m.heapUsed + (m.external ?? 0) + (m.arrayBuffers ?? 0)) / 1024 / 1024) *
        10,
    ) / 10
  );
}

function rssMb(): number {
  return Math.round((process.memoryUsage().rss / 1024 / 1024) * 10) / 10;
}

/**
 * Download a scene panorama, run a no-op projection round-trip, upload the
 * change-composite debug JPEG. No AI calls.
 */
export async function runRoundTripForScene(options: {
  ownerId: string;
  tourId: string;
  sceneId: string;
  storagePath: string;
  perspectiveSize?: number;
  /** Skip uploading the debug JPEG (gate measurement only). */
  skipUpload?: boolean;
}): Promise<RoundTripJobResult> {
  const admin = createAdminClient();
  const { data: file, error: downloadError } = await admin.storage
    .from("panoramas")
    .download(options.storagePath);

  if (downloadError || !file) {
    throw new Error(
      downloadError?.message ?? "Failed to download scene panorama.",
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  const rgba = await decodeImageToRgba(input);

  const perspectiveSize = options.perspectiveSize ?? 512;

  let peakHeap = heapMb();
  let peakRss = rssMb();
  const tick = setInterval(() => {
    peakHeap = Math.max(peakHeap, heapMb());
    peakRss = Math.max(peakRss, rssMb());
  }, 200);

  const t0 = performance.now();
  const trip = roundTripNoEdit(rgba, { perspectiveSize });
  const durationMs = Math.round(performance.now() - t0);
  clearInterval(tick);
  peakHeap = Math.max(peakHeap, heapMb());
  peakRss = Math.max(peakRss, rssMb());

  const resultPath = stagingRoundtripPath(
    options.ownerId,
    options.tourId,
    options.sceneId,
  );

  if (!options.skipUpload) {
    const jpeg = await encodeRgbaToJpeg(trip.changedOnly, 92);
    const { error: uploadError } = await admin.storage
      .from("panoramas")
      .upload(resultPath, jpeg, {
        contentType: "image/jpeg",
        cacheControl: "60",
        upsert: true,
      });

    if (uploadError) {
      throw new Error(uploadError.message);
    }
  }

  return {
    resultPath,
    replaceStats: trip.replaceStats,
    changedOnlyStats: trip.changedOnlyStats,
    seamReplaceStats: trip.seamReplaceStats,
    viewCount: trip.viewCount,
    width: rgba.width,
    height: rgba.height,
    durationMs,
    peakHeapMb: peakHeap,
    peakRssMb: peakRss,
  };
}

export async function claimStagingJob(jobId: string): Promise<
  | {
      ok: true;
      job: {
        id: string;
        tour_id: string;
        scene_id: string | null;
        kind: string;
        status: string;
        params: Record<string, unknown>;
        provider: string | null;
        provider_job_id: string | null;
        created_at: string;
        updated_at: string;
        step: number;
        total_steps: number | null;
        view_results: unknown;
        reference_paths: unknown;
      };
    }
  | { ok: false; error: string; soft?: boolean }
> {
  const admin = createAdminClient();
  const now = Date.now();

  const { data: job, error } = await admin
    .from("staging_jobs")
    .select(
      "id, tour_id, scene_id, kind, status, params, updated_at, created_at, provider, provider_job_id, step, total_steps, view_results, reference_paths",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!job) return { ok: false, error: "Job not found." };

  const params = (job.params ?? {}) as Record<string, unknown>;
  const absoluteTimeoutMs =
    job.kind === "stage_room"
      ? STAGE_ROOM_ABSOLUTE_TIMEOUT_MS
      : JOB_ABSOLUTE_TIMEOUT_MS;
  const createdAt = Date.parse(job.created_at);
  if (
    (job.status === "queued" || job.status === "processing") &&
    Number.isFinite(createdAt) &&
    now - createdAt > absoluteTimeoutMs
  ) {
    const minutes = Math.round(absoluteTimeoutMs / 60_000);
    const timeoutMsg = `Timed out after ${minutes} minutes still processing. The server worker may have been killed — retry the job.`;
    await admin
      .from("staging_jobs")
      .update({
        status: "failed",
        error: timeoutMsg,
      })
      .eq("id", jobId)
      .in("status", ["queued", "processing"]);
    return {
      ok: false,
      error: timeoutMsg,
    };
  }

  // Active worker lease — another /process tick owns this job.
  const leaseUntilRaw =
    typeof params.leaseUntil === "string" ? Date.parse(params.leaseUntil) : 0;
  const leaseActive =
    Number.isFinite(leaseUntilRaw) && leaseUntilRaw > now;
  if (job.status === "processing" && leaseActive) {
    return {
      ok: false,
      error: "Worker lease active.",
      soft: true,
    };
  }

  // Terminal states — nothing to do.
  if (
    job.status === "succeeded" ||
    job.status === "failed" ||
    job.status === "cancelled"
  ) {
    return {
      ok: false,
      error: `Job already ${job.status}.`,
      soft: true,
    };
  }

  // Reclaim queued jobs, or processing jobs whose worker lease has expired.
  // Multi-step stage_room clears the lease between views with no provider_job_id;
  // requiring stale/provider_job_id alone would stall the cursor forever.
  const reclaimable =
    job.status === "queued" ||
    (job.status === "processing" && !leaseActive);

  if (!reclaimable) {
    return {
      ok: false,
      error: "Job is already processing (not yet stale).",
      soft: true,
    };
  }

  const leaseUntil = new Date(now + WORKER_LEASE_MS).toISOString();
  const nextParams = { ...params, leaseUntil } as Json;

  const { data: claimed, error: claimError } = await admin
    .from("staging_jobs")
    .update({
      status: "processing",
      error: null,
      params: nextParams,
    })
    .eq("id", jobId)
    .eq("status", job.status)
    .select(
      "id, tour_id, scene_id, kind, status, params, provider, provider_job_id, created_at, updated_at, step, total_steps, view_results, reference_paths",
    )
    .maybeSingle();

  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed) {
    return {
      ok: false,
      error: "Failed to claim job (concurrent update).",
      soft: true,
    };
  }

  return {
    ok: true,
    job: {
      id: claimed.id,
      tour_id: claimed.tour_id,
      scene_id: claimed.scene_id,
      kind: claimed.kind,
      status: claimed.status,
      params: (claimed.params ?? {}) as Record<string, unknown>,
      provider: claimed.provider,
      provider_job_id: claimed.provider_job_id,
      created_at: claimed.created_at,
      updated_at: claimed.updated_at,
      step: claimed.step ?? 0,
      total_steps: claimed.total_steps ?? null,
      view_results: claimed.view_results ?? [],
      reference_paths: claimed.reference_paths ?? [],
    },
  };
}

async function cleanupStagingWork(
  ownerId: string,
  tourId: string,
  jobId: string,
  options?: { keepDebug?: boolean },
): Promise<void> {
  const admin = createAdminClient();
  const paths = [
    stagingWorkCropPath(ownerId, tourId, jobId),
    stagingWorkMaskPath(ownerId, tourId, jobId),
  ];
  if (!options?.keepDebug) {
    const debugNames = [
      "01-source-crop.jpg",
      "02-mask.png",
      "03-model-output.jpg",
      "04-reprojected.png",
      "05-composite-alpha.png",
      "06-result.jpg",
    ];
    for (const name of debugNames) {
      paths.push(stagingDebugPath(ownerId, tourId, jobId, name));
    }
  }
  await admin.storage.from("panoramas").remove(paths);
}

async function failJob(
  jobId: string,
  message: string,
  cleanup?: { ownerId: string; tourId: string },
): Promise<{ status: "failed"; error: string }> {
  const admin = createAdminClient();
  if (cleanup) {
    // Keep debug artifacts when diagnosing; always remove working crop/mask.
    await cleanupStagingWork(cleanup.ownerId, cleanup.tourId, jobId, {
      keepDebug: isStagingDebugEnabled(),
    });
  }
  await admin
    .from("staging_jobs")
    .update({
      status: "failed",
      error: message,
    })
    .eq("id", jobId);
  return { status: "failed", error: message };
}


export async function processStagingJob(jobId: string): Promise<{
  status: "succeeded" | "failed" | "processing";
  result?: RoundTripJobResult | NadirFillJobResult | StageRoomJobResult;
  error?: string;
  tourSlug?: string | null;
}> {
  const claimed = await claimStagingJob(jobId);
  if (!claimed.ok) {
    if (claimed.soft) {
      return { status: "processing" };
    }
    return { status: "failed", error: claimed.error };
  }

  const { job } = claimed;

  try {
    if (job.kind === "nadir_fill") {
      const result = await processNadirFillJob(job);
      const admin = createAdminClient();
      const { data: tour } = await admin
        .from("tours")
        .select("slug")
        .eq("id", job.tour_id)
        .maybeSingle();
      return { ...result, tourSlug: tour?.slug ?? null };
    }

    if (job.kind === "stage_room") {
      const result = await processStageRoomJob(job);
      const admin = createAdminClient();
      const { data: tour } = await admin
        .from("tours")
        .select("slug")
        .eq("id", job.tour_id)
        .maybeSingle();
      return { ...result, tourSlug: tour?.slug ?? null };
    }

    return failJob(jobId, `Unknown job kind “${job.kind}”.`);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Staging process failed.";
    console.error("[processStagingJob] thrown", {
      jobId,
      message,
      stack: err instanceof Error ? err.stack : undefined,
      memory: process.memoryUsage(),
    });
    return failJob(jobId, message);
  }
}
