import "server-only";

import sharp from "sharp";

import { decodeImageToRgba, encodeRgbaToJpeg } from "@/lib/staging/image-codec";
import {
  NADIR_FILL_CROP_SIZE,
  NADIR_FILL_FOV_DEGREES,
  NADIR_FILL_MASK_FEATHER_PX,
  NADIR_FILL_MASK_RADIUS_RATIO,
  isStagingDebugEnabled,
  type NadirFillJobResult,
} from "@/lib/staging/process-job-constants";
import {
  assertOutsideMaskUnchanged,
  compositeWithBlendAlpha,
  coverageMaskToRgba,
  makeCenteredCircleMask,
  nadirCrop,
  nadirCropToEquirect,
  nadirMaskToEquirect,
  type RgbaImage,
} from "@/lib/staging/projection";
import {
  defaultAiProviderName,
  getStagingProvider,
  isStagingEnabled,
} from "@/lib/staging/providers";
import { KONTEXT_DEFAULT_PROMPT } from "@/lib/staging/providers/fal-kontext";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  publicUrl,
  stagingCandidateCompatPath,
  stagingCandidatePath,
  stagingDebugPath,
  stagingWorkCropPath,
  stagingWorkMaskPath,
} from "@/lib/storage";
import type { Json } from "@/types/database";

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

async function cleanupWorking(
  ownerId: string,
  tourId: string,
  jobId: string,
  options?: { keepDebug?: boolean; keepCandidates?: boolean },
): Promise<void> {
  const admin = createAdminClient();
  const paths = [
    stagingWorkCropPath(ownerId, tourId, jobId),
    stagingWorkMaskPath(ownerId, tourId, jobId),
  ];
  if (!options?.keepDebug) {
    for (const name of [
      "01-source-crop.jpg",
      "02-mask.png",
      "03-model-output.jpg",
      "04-reprojected.png",
      "05-composite-alpha.png",
      "06-result.jpg",
    ]) {
      paths.push(stagingDebugPath(ownerId, tourId, jobId, name));
    }
  }
  if (!options?.keepCandidates) {
    for (let i = 0; i < 4; i++) {
      paths.push(stagingCandidatePath(ownerId, tourId, jobId, i));
      paths.push(stagingCandidateCompatPath(ownerId, tourId, jobId, i));
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
    await cleanupWorking(cleanup.ownerId, cleanup.tourId, jobId, {
      keepDebug: isStagingDebugEnabled(),
      keepCandidates: false,
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

function withoutLease(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...params };
  delete next.leaseUntil;
  return next;
}

export async function processNadirFillJob(job: {
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

  const providerName =
    typeof job.params.provider === "string"
      ? job.params.provider
      : defaultAiProviderName();

  let provider;
  try {
    provider = getStagingProvider(providerName);
  } catch (err) {
    return failJob(
      job.id,
      err instanceof Error ? err.message : "Provider not configured.",
    );
  }

  // ── Phase A: prepare crop/mask and submit ───────────────────────────
  if (!job.provider_job_id) {
    try {
      // Always read the ORIGINAL panorama for fill — never a prior cleaned
      // variant — so retries stay byte-identical to the pre-job scene.
      const sourcePath = scene.storage_path;
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
      const crop = nadirCrop(rgba, { fovDegrees, size: cropSize });
      const mask = makeCenteredCircleMask(
        cropSize,
        maskRadiusRatio,
        maskFeatherPx,
      );

      const prompt =
        provider.kind === "edit"
          ? KONTEXT_DEFAULT_PROMPT
          : typeof job.params.prompt === "string" && job.params.prompt.trim()
            ? job.params.prompt.trim()
            : "continuous ground surface, matching surrounding texture and color, even lighting, empty surface";

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

      const numImages =
        provider.kind === "edit"
          ? Math.min(2, typeof job.params.numImages === "number" ? job.params.numImages : 2)
          : 1;

      const submitted = await provider.submitInpaint({
        image: cropJpeg,
        mask: maskPng,
        imageUrl,
        maskUrl,
        prompt,
        numImages,
        seed:
          typeof job.params.seed === "number" ? job.params.seed : undefined,
      });

      // Clear lease so the next tick can run Phase B immediately.
      const { error: updateError } = await admin
        .from("staging_jobs")
        .update({
          status: "processing",
          provider: provider.name,
          provider_job_id: submitted.providerJobId,
          params: {
            ...withoutLease(job.params),
            fovDegrees,
            cropSize,
            maskRadiusRatio,
            maskFeatherPx,
            sourcePath,
            cropPath,
            maskPath,
            provider: provider.name,
            prompt:
              typeof submitted.meta?.prompt === "string"
                ? submitted.meta.prompt
                : prompt,
            imageUrl,
            maskUrl,
            debug,
            numImages,
            ...(debug ? { debugUrls } : {}),
          } as Json,
        })
        .eq("id", job.id);

      if (updateError) {
        return failJob(job.id, updateError.message, cleanup);
      }

      // Local providers finish in the same tick — fall through by re-reading.
      if (provider.kind === "local") {
        job.provider_job_id = submitted.providerJobId;
        job.params = {
          ...job.params,
          sourcePath,
          cropPath,
          maskPath,
          provider: provider.name,
          prompt,
        };
      } else {
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
      }
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Failed to submit nadir fill.";
      console.error("[nadir-fill] phase A error", message, err);
      return failJob(job.id, message, cleanup);
    }
  }

  // ── Phase B: poll provider; write CANDIDATE (do not enable cleaned) ─
  try {
    const poll = await provider.pollInpaint(job.provider_job_id!);

    if (poll.status === "queued" || poll.status === "processing") {
      // Release lease for the next tick.
      await admin
        .from("staging_jobs")
        .update({
          params: withoutLease(job.params) as Json,
        })
        .eq("id", job.id);
      return { status: "processing" };
    }

    if (poll.status !== "completed") {
      // AI failed — if not already texture_fill, leave failed (UI can retry
      // with texture mode). Do not auto-mutate the scene.
      return failJob(
        job.id,
        poll.status === "failed" ? poll.error : "Unexpected provider status.",
        cleanup,
      );
    }

    const sourcePath =
      typeof job.params.sourcePath === "string"
        ? job.params.sourcePath
        : scene.storage_path;

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

    const candidateBuffers = poll.images?.length ? poll.images : [poll.image];
    const candidatePaths: string[] = [];
    const candidateUrls: string[] = [];
    const compatPaths: Array<string | null> = [];

    const circleMask = makeCenteredCircleMask(
      cropSize,
      maskRadiusRatio,
      maskFeatherPx,
    );
    const reprojectParams = {
      fovDegrees,
      size: cropSize,
      targetWidth: original.width,
      targetHeight: original.height,
    };
    const blendAlpha = nadirMaskToEquirect(circleMask, reprojectParams);

    let firstPatch: RgbaImage | null = null;

    for (let i = 0; i < candidateBuffers.length; i++) {
      const buf = candidateBuffers[i]!;
      const filledCrop = await decodeImageToRgba(buf);
      const cropForReproject =
        filledCrop.width === cropSize && filledCrop.height === cropSize
          ? filledCrop
          : await decodeImageToRgba(
              await sharp(buf)
                .resize(cropSize, cropSize, { fit: "fill" })
                .jpeg()
                .toBuffer(),
            );

      const { image: patch } = nadirCropToEquirect(
        cropForReproject,
        reprojectParams,
      );
      if (i === 0) firstPatch = patch;

      const composited = compositeWithBlendAlpha(original, patch, blendAlpha);
      assertOutsideMaskUnchanged(original, composited, blendAlpha);

      const candidateJpeg = await encodeRgbaToJpeg(composited, 92);
      const outPath = stagingCandidatePath(ownerId, job.tour_id, job.id, i);
      const { error: upErr } = await admin.storage
        .from("panoramas")
        .upload(outPath, candidateJpeg, {
          contentType: "image/jpeg",
          cacheControl: "120",
          upsert: true,
        });
      if (upErr) return failJob(job.id, upErr.message, cleanup);

      candidatePaths.push(outPath);
      candidateUrls.push(publicUrl(outPath));

      let compat: string | null = null;
      const compatJpeg = await encodeCompatJpeg(candidateJpeg, 4096);
      if (compatJpeg) {
        const cPath = stagingCandidateCompatPath(
          ownerId,
          job.tour_id,
          job.id,
          i,
        );
        const { error: cErr } = await admin.storage
          .from("panoramas")
          .upload(cPath, compatJpeg, {
            contentType: "image/jpeg",
            cacheControl: "120",
            upsert: true,
          });
        if (!cErr) compat = cPath;
      }
      compatPaths.push(compat);

      if (debug && i === 0) {
        const reprojectedPng = await encodeRgbaToPng(patch);
        const alphaPng = await encodeRgbaToPng(coverageMaskToRgba(blendAlpha));
        const debugUrls = {
          ...((job.params.debugUrls as Record<string, string> | undefined) ??
            {}),
          "03-model-output.jpg": await uploadDebugArtifact(
            ownerId,
            job.tour_id,
            job.id,
            "03-model-output.jpg",
            buf,
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
            candidateJpeg,
            "image/jpeg",
          ),
        };
        job.params.debugUrls = debugUrls;
      }
    }

    void firstPatch;

    const costCents = poll.costCents ?? null;
    const { error: jobUpErr } = await admin
      .from("staging_jobs")
      .update({
        status: "succeeded",
        result_path: candidatePaths[0] ?? null,
        cost_cents: costCents,
        error: null,
        params: {
          ...withoutLease(job.params),
          candidatePaths,
          candidateUrls,
          candidateCompatPaths: compatPaths,
          awaitingReview: true,
          ...(debug
            ? { debugUrls: job.params.debugUrls as Record<string, string> }
            : {}),
        } as Json,
      })
      .eq("id", job.id);

    if (jobUpErr) {
      await cleanupWorking(ownerId, job.tour_id, job.id, {
        keepDebug: debug,
        keepCandidates: true,
      });
      return {
        status: "succeeded",
        result: {
          cleanedPath: candidatePaths[0] ?? "",
          cleanedCompatPath: compatPaths[0] ?? null,
          costCents,
          providerJobId: job.provider_job_id!,
          cropSize,
          fovDegrees,
        },
        error: jobUpErr.message,
      };
    }

    // Scene is UNTOUCHED — user must Apply. Clean working crop/mask only.
    await admin.storage
      .from("panoramas")
      .remove([
        stagingWorkCropPath(ownerId, job.tour_id, job.id),
        stagingWorkMaskPath(ownerId, job.tour_id, job.id),
      ]);

    return {
      status: "succeeded",
      result: {
        cleanedPath: candidatePaths[0] ?? "",
        cleanedCompatPath: compatPaths[0] ?? null,
        costCents,
        providerJobId: job.provider_job_id!,
        cropSize,
        fovDegrees,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Nadir fill processing failed.";
    console.error("[nadir-fill] phase B error", message, err);
    return failJob(job.id, message, cleanup);
  }
}

// Re-export timeout constant for claimStagingJob consumers.
export { JOB_ABSOLUTE_TIMEOUT_MS } from "@/lib/staging/process-job-constants";
