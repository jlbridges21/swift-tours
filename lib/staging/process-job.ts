import "server-only";

import sharp from "sharp";

import { decodeImageToRgba, encodeRgbaToJpeg } from "@/lib/staging/image-codec";
import {
  buildNadirFillPrompt,
  deriveFloorMaterialFromAnnulus,
  type FloorMaterialHint,
} from "@/lib/staging/floor-material";
import {
  assertOutsideMaskUnchanged,
  compositeWithBlendAlpha,
  coverageMaskToRgba,
  makeCenteredCircleMask,
  nadirCrop,
  nadirCropToEquirect,
  nadirMaskToEquirect,
  roundTripNoEdit,
  type DiffStats,
  type RgbaImage,
} from "@/lib/staging/projection";
import {
  getStagingProvider,
  isStagingEnabled,
} from "@/lib/staging/providers";
import { estimateFluxFillCostCents } from "@/lib/staging/providers/fal-flux-fill";
import { resolveStagingInputPath } from "@/lib/staging/variant-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  cleanedCompatPath,
  cleanedPath,
  publicUrl,
  stagingDebugPath,
  stagingWorkCropPath,
  stagingWorkMaskPath,
  stagingRoundtripPath,
} from "@/lib/storage";
import type { Json } from "@/types/database";

/** Jobs stuck in `processing` longer than this are reclaimable. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

/** Default stereographic cone for tripod removal (~120° downward). */
export const NADIR_FILL_FOV_DEGREES = 120;
export const NADIR_FILL_CROP_SIZE = 1024;
/** Circle radius as fraction of half-width (inner ~45%). */
export const NADIR_FILL_MASK_RADIUS_RATIO = 0.45;
/** Soft edge width (px) on the circular fill mask — generous to hide seams. */
export const NADIR_FILL_MASK_FEATHER_PX = 64;

/**
 * Legacy prompt (pre-fix). Contained “tripod” and was folded with
 * “Avoid: … tripod, camera …” — Fill treats those as desired content.
 * Kept only for incident reports / comparisons.
 */
export const NADIR_FILL_PROMPT_LEGACY =
  "Continue the existing floor surface seamlessly through the center. Match the exact floor material, color, texture, grout lines or plank direction, and lighting. Fill only the masked tripod region. Add no objects, no furniture, no people, no shadows, no logos, and no text. Avoid: furniture, objects, people, text, watermark, tripod, camera, shadow, logo, reflections of equipment.";

export function isStagingDebugEnabled(): boolean {
  return process.env.STAGING_DEBUG === "true";
}

/** Per-job cost for a default-size crop (honest fal rounding). */
export function nadirFillEstimatedCostCents(
  cropSize = NADIR_FILL_CROP_SIZE,
): number {
  return estimateFluxFillCostCents(cropSize, cropSize);
}
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

export type NadirFillJobResult = {
  cleanedPath: string;
  cleanedCompatPath: string | null;
  costCents: number | null;
  providerJobId: string;
  cropSize: number;
  fovDegrees: number;
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

async function encodeRgbaToPng(image: RgbaImage): Promise<Buffer> {
  return sharp(Buffer.from(image.data), {
    raw: {
      width: image.width,
      height: image.height,
      channels: 4,
    },
  })
    .png()
    .toBuffer();
}

async function encodeCompatJpeg(
  full: Buffer,
  maxWidth = 4096,
): Promise<Buffer | null> {
  const meta = await sharp(full).metadata();
  if (!meta.width || meta.width <= maxWidth) return null;
  return sharp(full)
    .resize({ width: maxWidth, withoutEnlargement: true })
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
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

export async function claimStagingJob(jobId: string): Promise<{
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
  };
} | { ok: false; error: string }> {
  const admin = createAdminClient();
  const staleBefore = new Date(Date.now() - STALE_PROCESSING_MS).toISOString();

  const { data: job, error } = await admin
    .from("staging_jobs")
    .select(
      "id, tour_id, scene_id, kind, status, params, updated_at, provider, provider_job_id",
    )
    .eq("id", jobId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!job) return { ok: false, error: "Job not found." };

  // Already processing with a provider id — allow poll ticks without reclaim.
  if (job.status === "processing" && job.provider_job_id) {
    return {
      ok: true,
      job: {
        id: job.id,
        tour_id: job.tour_id,
        scene_id: job.scene_id,
        kind: job.kind,
        status: job.status,
        params: (job.params ?? {}) as Record<string, unknown>,
        provider: job.provider,
        provider_job_id: job.provider_job_id,
      },
    };
  }

  const reclaimable =
    job.status === "queued" ||
    (job.status === "processing" && job.updated_at < staleBefore);

  if (!reclaimable) {
    if (job.status === "processing") {
      return {
        ok: false,
        error: "Job is already processing (not yet stale).",
      };
    }
    return {
      ok: false,
      error: `Job cannot be claimed in status “${job.status}”.`,
    };
  }

  const { data: claimed, error: claimError } = await admin
    .from("staging_jobs")
    .update({
      status: "processing",
      error: null,
    })
    .eq("id", jobId)
    .eq("status", job.status)
    .select(
      "id, tour_id, scene_id, kind, status, params, provider, provider_job_id",
    )
    .maybeSingle();

  if (claimError) return { ok: false, error: claimError.message };
  if (!claimed) {
    return { ok: false, error: "Failed to claim job (concurrent update)." };
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

async function uploadDebugArtifact(
  ownerId: string,
  tourId: string,
  jobId: string,
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<string> {
  const admin = createAdminClient();
  const path = stagingDebugPath(ownerId, tourId, jobId, filename);
  const { error } = await admin.storage.from("panoramas").upload(path, body, {
    contentType,
    cacheControl: "60",
    upsert: true,
  });
  if (error) throw new Error(`Debug upload ${filename}: ${error.message}`);
  return publicUrl(path);
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

async function processNadirFillJob(job: {
  id: string;
  tour_id: string;
  scene_id: string | null;
  params: Record<string, unknown>;
  provider_job_id: string | null;
}): Promise<{
  status: "succeeded" | "failed" | "processing";
  result?: NadirFillJobResult;
  error?: string;
}> {
  if (!isStagingEnabled()) {
    return failJob(job.id, "Staging is disabled (STAGING_ENABLED≠true).");
  }
  if (!job.scene_id) {
    return failJob(job.id, "Job is missing scene_id.");
  }

  const admin = createAdminClient();
  const debug = isStagingDebugEnabled();
  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select(
      "id, tour_id, storage_path, cleaned_path, cleaned_compat_path, cleaned_enabled, width, height",
    )
    .eq("id", job.scene_id)
    .maybeSingle();

  if (sceneError) return failJob(job.id, sceneError.message);
  if (!scene) return failJob(job.id, "Scene not found.");
  if (scene.tour_id !== job.tour_id) {
    return failJob(job.id, "Scene does not belong to this job’s tour.");
  }

  const { data: tour, error: tourError } = await admin
    .from("tours")
    .select("id, owner_id, slug")
    .eq("id", job.tour_id)
    .maybeSingle();

  if (tourError) return failJob(job.id, tourError.message);
  if (!tour) return failJob(job.id, "Tour not found.");

  const ownerId = tour.owner_id;
  const cleanup = { ownerId, tourId: job.tour_id };

  const fovDegrees =
    typeof job.params.fovDegrees === "number"
      ? job.params.fovDegrees
      : NADIR_FILL_FOV_DEGREES;
  const cropSize =
    typeof job.params.cropSize === "number"
      ? job.params.cropSize
      : NADIR_FILL_CROP_SIZE;
  const maskRadiusRatio =
    typeof job.params.maskRadiusRatio === "number"
      ? job.params.maskRadiusRatio
      : NADIR_FILL_MASK_RADIUS_RATIO;
  const maskFeatherPx =
    typeof job.params.maskFeatherPx === "number"
      ? job.params.maskFeatherPx
      : NADIR_FILL_MASK_FEATHER_PX;

  let provider;
  try {
    provider = getStagingProvider();
  } catch (err) {
    return failJob(
      job.id,
      err instanceof Error ? err.message : "Provider not configured.",
    );
  }

  // ── Phase A: prepare crop/mask and submit to fal queue ──────────────
  if (!job.provider_job_id) {
    try {
      const sourcePath = resolveStagingInputPath(scene);
      const { data: file, error: downloadError } = await admin.storage
        .from("panoramas")
        .download(sourcePath);
      if (downloadError || !file) {
        return failJob(
          job.id,
          downloadError?.message ?? "Failed to download panorama.",
          cleanup,
        );
      }

      const rgba = await decodeImageToRgba(
        Buffer.from(await file.arrayBuffer()),
      );
      // Extract + reproject pair: nadirCrop ↔ nadirCropToEquirect (stereographic).
      const crop = nadirCrop(rgba, { fovDegrees, size: cropSize });
      const mask = makeCenteredCircleMask(
        cropSize,
        maskRadiusRatio,
        maskFeatherPx,
      );

      const materialParam = job.params.floorMaterial;
      const material: FloorMaterialHint =
        materialParam === "hardwood" ||
        materialParam === "tile" ||
        materialParam === "carpet" ||
        materialParam === "concrete" ||
        materialParam === "laminate" ||
        materialParam === "generic"
          ? materialParam
          : deriveFloorMaterialFromAnnulus(crop, mask);
      const prompt = buildNadirFillPrompt(material);

      const cropJpeg = await encodeRgbaToJpeg(crop, 92);
      const maskPng = await encodeRgbaToPng(mask);

      const cropPath = stagingWorkCropPath(ownerId, job.tour_id, job.id);
      const maskPath = stagingWorkMaskPath(ownerId, job.tour_id, job.id);

      const { error: cropUpErr } = await admin.storage
        .from("panoramas")
        .upload(cropPath, cropJpeg, {
          contentType: "image/jpeg",
          cacheControl: "60",
          upsert: true,
        });
      if (cropUpErr) return failJob(job.id, cropUpErr.message, cleanup);

      const { error: maskUpErr } = await admin.storage
        .from("panoramas")
        .upload(maskPath, maskPng, {
          contentType: "image/png",
          cacheControl: "60",
          upsert: true,
        });
      if (maskUpErr) return failJob(job.id, maskUpErr.message, cleanup);

      const imageUrl = publicUrl(cropPath);
      const maskUrl = publicUrl(maskPath);

      let debugUrls: Record<string, string> = {};
      if (debug) {
        debugUrls["01-source-crop.jpg"] = await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "01-source-crop.jpg",
          cropJpeg,
          "image/jpeg",
        );
        debugUrls["02-mask.png"] = await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "02-mask.png",
          maskPng,
          "image/png",
        );
      }

      const submitted = await provider.submitInpaint({
        image: cropJpeg,
        mask: maskPng,
        imageUrl,
        maskUrl,
        prompt,
      });

      const { error: updateError } = await admin
        .from("staging_jobs")
        .update({
          status: "processing",
          provider: provider.name,
          provider_job_id: submitted.providerJobId,
          params: {
            ...job.params,
            fovDegrees,
            cropSize,
            maskRadiusRatio,
            maskFeatherPx,
            sourcePath,
            cropPath,
            maskPath,
            floorMaterial: material,
            prompt,
            imageUrl,
            maskUrl,
            debug,
            ...(debug ? { debugUrls } : {}),
          } as Json,
        })
        .eq("id", job.id);

      if (updateError) {
        return failJob(job.id, updateError.message, cleanup);
      }

      return {
        status: "processing",
        result: {
          cleanedPath: "",
          cleanedCompatPath: null,
          costCents: null,
          providerJobId: submitted.providerJobId,
          cropSize,
          fovDegrees,
        },
      };
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to submit nadir fill.";
      return failJob(job.id, message, cleanup);
    }
  }

  // ── Phase B: poll fal once; finish or stay processing ───────────────
  try {
    const poll = await provider.pollInpaint(job.provider_job_id);

    if (poll.status === "queued" || poll.status === "processing") {
      return { status: "processing" };
    }

    if (poll.status !== "completed") {
      return failJob(
        job.id,
        poll.status === "failed" ? poll.error : "Unexpected provider status.",
        cleanup,
      );
    }

    // Completed — composite onto full-res original (never leave partial variant).
    const sourcePath =
      typeof job.params.sourcePath === "string"
        ? job.params.sourcePath
        : resolveStagingInputPath(scene);

    const { data: file, error: downloadError } = await admin.storage
      .from("panoramas")
      .download(sourcePath);
    if (downloadError || !file) {
      return failJob(
        job.id,
        downloadError?.message ?? "Failed to re-download panorama.",
        cleanup,
      );
    }

    const original = await decodeImageToRgba(
      Buffer.from(await file.arrayBuffer()),
    );
    const filledCrop = await decodeImageToRgba(poll.image);

    // Ensure crop size matches expectation (provider may return same dims).
    const cropForReproject =
      filledCrop.width === cropSize && filledCrop.height === cropSize
        ? filledCrop
        : await decodeImageToRgba(
            await sharp(poll.image)
              .resize(cropSize, cropSize, { fit: "fill" })
              .jpeg()
              .toBuffer(),
          );

    // Same stereographic pair as extract: nadirCrop ↔ nadirCropToEquirect.
    const reprojectParams = {
      fovDegrees,
      size: cropSize,
      targetWidth: original.width,
      targetHeight: original.height,
    };
    const { image: patch } = nadirCropToEquirect(
      cropForReproject,
      reprojectParams,
    );

    // Rebuild the circular mask (params stored on job) and reproject it —
    // final blend alpha = feathered circular mask ∧ FOV coverage.
    const circleMask = makeCenteredCircleMask(
      cropSize,
      maskRadiusRatio,
      maskFeatherPx,
    );
    const blendAlpha = nadirMaskToEquirect(circleMask, reprojectParams);

    const composited = compositeWithBlendAlpha(original, patch, blendAlpha);
    assertOutsideMaskUnchanged(original, composited, blendAlpha);

    const cleanedJpeg = await encodeRgbaToJpeg(composited, 92);
    const outPath = cleanedPath(ownerId, job.tour_id, scene.id);
    const compatOutPath = cleanedCompatPath(ownerId, job.tour_id, scene.id);

    let debugUrls =
      (job.params.debugUrls as Record<string, string> | undefined) ?? {};
    if (debug) {
      const reprojectedPng = await encodeRgbaToPng(patch);
      const alphaPng = await encodeRgbaToPng(coverageMaskToRgba(blendAlpha));
      debugUrls = {
        ...debugUrls,
        "03-model-output.jpg": await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "03-model-output.jpg",
          poll.image,
          "image/jpeg",
        ),
        "04-reprojected.png": await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "04-reprojected.png",
          reprojectedPng,
          "image/png",
        ),
        "05-composite-alpha.png": await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "05-composite-alpha.png",
          alphaPng,
          "image/png",
        ),
        "06-result.jpg": await uploadDebugArtifact(
          ownerId,
          job.tour_id,
          job.id,
          "06-result.jpg",
          cleanedJpeg,
          "image/jpeg",
        ),
      };
    }

    // Upload cleaned first; only then flip scene flags (no partial success).
    const { error: cleanedUpErr } = await admin.storage
      .from("panoramas")
      .upload(outPath, cleanedJpeg, {
        contentType: "image/jpeg",
        cacheControl: "3600",
        upsert: true,
      });
    if (cleanedUpErr) return failJob(job.id, cleanedUpErr.message, cleanup);

    let compatPath: string | null = null;
    const compatJpeg = await encodeCompatJpeg(cleanedJpeg, 4096);
    if (compatJpeg) {
      const { error: compatUpErr } = await admin.storage
        .from("panoramas")
        .upload(compatOutPath, compatJpeg, {
          contentType: "image/jpeg",
          cacheControl: "3600",
          upsert: true,
        });
      if (compatUpErr) {
        // Roll back cleaned object so we don't leave an orphan variant.
        await admin.storage.from("panoramas").remove([outPath]);
        return failJob(job.id, compatUpErr.message, cleanup);
      }
      compatPath = compatOutPath;
    }

    const { error: sceneUpErr } = await admin
      .from("scenes")
      .update({
        cleaned_path: outPath,
        cleaned_compat_path: compatPath,
        cleaned_enabled: true,
      })
      .eq("id", scene.id);

    if (sceneUpErr) {
      await admin.storage
        .from("panoramas")
        .remove([outPath, ...(compatPath ? [compatPath] : [])]);
      return failJob(job.id, sceneUpErr.message, cleanup);
    }

    const costCents = poll.costCents ?? null;
    const { error: jobUpErr } = await admin
      .from("staging_jobs")
      .update({
        status: "succeeded",
        result_path: outPath,
        cost_cents: costCents,
        error: null,
        params: {
          ...job.params,
          ...(debug ? { debugUrls } : {}),
          costNote: `fal Fill bills ceil(MP)×$0.05; ${cropSize}² → ${estimateFluxFillCostCents(cropSize, cropSize)}¢`,
        } as Json,
      })
      .eq("id", job.id);

    if (jobUpErr) {
      // Cleaned assets are already live; surface the bookkeeping error without
      // deleting the good variant.
      await cleanupStagingWork(ownerId, job.tour_id, job.id, {
        keepDebug: debug,
      });
      return {
        status: "succeeded",
        result: {
          cleanedPath: outPath,
          cleanedCompatPath: compatPath,
          costCents,
          providerJobId: job.provider_job_id,
          cropSize,
          fovDegrees,
        },
        error: jobUpErr.message,
      };
    }

    // Normal mode: delete working + any stray debug. Debug mode: keep debug/.
    await cleanupStagingWork(ownerId, job.tour_id, job.id, { keepDebug: debug });

    return {
      status: "succeeded",
      result: {
        cleanedPath: outPath,
        cleanedCompatPath: compatPath,
        costCents,
        providerJobId: job.provider_job_id,
        cropSize,
        fovDegrees,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Nadir fill processing failed.";
    return failJob(job.id, message, cleanup);
  }
}

export async function processStagingJob(jobId: string): Promise<{
  status: "succeeded" | "failed" | "processing";
  result?: RoundTripJobResult | NadirFillJobResult;
  error?: string;
  tourSlug?: string | null;
}> {
  const claimed = await claimStagingJob(jobId);
  if (!claimed.ok) {
    return { status: "failed", error: claimed.error };
  }

  const { job } = claimed;

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
    return failJob(
      jobId,
      "stage_room is not implemented yet — use nadir_fill first.",
    );
  }

  return failJob(jobId, `Unknown job kind “${job.kind}”.`);
}
