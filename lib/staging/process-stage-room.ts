import "server-only";

import sharp from "sharp";

import { decodeImageToRgba, encodeRgbaToJpeg } from "@/lib/staging/image-codec";
import { isStagingDebugEnabled } from "@/lib/staging/process-job-constants";
import {
  applyPitchFalloff,
  assertOutsideMaskUnchanged,
  compositeWithBlendAlpha,
  equirectToPerspective,
  nadirCrop,
  nadirCropToEquirect,
  perspectiveToEquirect,
  type CoverageMask,
  type RgbaImage,
} from "@/lib/staging/projection";
import { getStagingProvider } from "@/lib/staging/providers";
import { FAL_KONTEXT_COST_CENTS } from "@/lib/staging/providers/fal-kontext";
import {
  composeRoomStagingPrompt,
  type RoomType,
  type StagingIntensity,
  type StagingPlan,
} from "@/lib/staging/staging-plan-shared";
import {
  getViewStrategy,
  type ViewStrategyId,
} from "@/lib/staging/view-strategies";
import { resolveStagingInputPath } from "@/lib/staging/variant-paths";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  publicUrl,
  stagingDebugPath,
  stagingRoomCandidateCompatPath,
  stagingRoomCandidatePath,
  stagingViewResultPath,
  stagingViewSourcePath,
  stagingWorkDir,
  stagingWorkingEquirectPath,
} from "@/lib/storage";
import type { Json } from "@/types/database";

export type StageRoomJobResult = {
  candidatePath: string;
  costCents: number | null;
  step: number;
  totalSteps: number;
};

type ViewResultEntry = {
  index: number;
  status: string;
  sourcePath?: string;
  resultPath?: string;
  providerJobId?: string;
  costCents?: number;
};

function withoutLease(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...params };
  delete next.leaseUntil;
  return next;
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

async function uploadDebug(
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
  if (error) throw new Error(error.message);
  return publicUrl(path);
}

/**
 * Side-by-side collage so single-image Kontext can see the prior adjacent view.
 * Left = current empty crop; right = previous staged result.
 */
async function buildReferenceCollage(
  current: Buffer,
  previous: Buffer,
): Promise<Buffer> {
  const left = sharp(current).resize(768, 768, { fit: "fill" });
  const right = sharp(previous).resize(768, 768, { fit: "fill" });
  const [l, r] = await Promise.all([left.toBuffer(), right.toBuffer()]);
  return sharp({
    create: {
      width: 1536,
      height: 768,
      channels: 3,
      background: { r: 0, g: 0, b: 0 },
    },
  })
    .composite([
      { input: l, left: 0, top: 0 },
      { input: r, left: 768, top: 0 },
    ])
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function failJob(
  jobId: string,
  message: string,
): Promise<{ status: "failed"; error: string }> {
  const admin = createAdminClient();
  await admin
    .from("staging_jobs")
    .update({ status: "failed", error: message })
    .eq("id", jobId);
  return { status: "failed", error: message };
}

/**
 * Multi-step room staging. Each process tick completes at most ONE view
 * (submit or poll) or the final composite — never the whole job.
 */
export async function processStageRoomJob(job: {
  id: string;
  tour_id: string;
  scene_id: string | null;
  params: Record<string, unknown>;
  provider_job_id: string | null;
  step: number;
  total_steps: number | null;
  view_results: unknown;
  reference_paths?: unknown;
}): Promise<{
  status: "succeeded" | "failed" | "processing";
  result?: StageRoomJobResult;
  error?: string;
}> {
  if (!job.scene_id) return failJob(job.id, "Job is missing scene_id.");

  const admin = createAdminClient();
  const debug = isStagingDebugEnabled();

  const { data: scene, error: sceneError } = await admin
    .from("scenes")
    .select(
      "id, tour_id, storage_path, cleaned_path, cleaned_enabled, staged_path, staged_compat_path, staged_enabled, room_type, width, height",
    )
    .eq("id", job.scene_id)
    .maybeSingle();
  if (sceneError) return failJob(job.id, sceneError.message);
  if (!scene || scene.tour_id !== job.tour_id) {
    return failJob(job.id, "Scene not found for this tour.");
  }

  const { data: tour, error: tourError } = await admin
    .from("tours")
    .select("id, owner_id, staging_plan, staging_seed")
    .eq("id", job.tour_id)
    .maybeSingle();
  if (tourError) return failJob(job.id, tourError.message);
  if (!tour) return failJob(job.id, "Tour not found.");

  const ownerId = tour.owner_id;
  const plan = (tour.staging_plan ?? job.params.plan) as StagingPlan | null;
  if (!plan || typeof plan !== "object" || !plan.rooms) {
    return failJob(
      job.id,
      "Tour has no locked staging plan — complete the questionnaire first.",
    );
  }

  const strategyId = (job.params.strategy as ViewStrategyId) || "A";
  const strategy = getViewStrategy(strategyId);
  const roomType = (job.params.roomType as RoomType) ||
    (scene.room_type as RoomType) ||
    "living_room";
  const intensity =
    (job.params.intensity as StagingIntensity) || "fully";
  const seed =
    typeof tour.staging_seed === "number"
      ? tour.staging_seed
      : typeof plan.seed === "number"
        ? plan.seed
        : 42;
  const sceneNote =
    typeof job.params.note === "string" ? job.params.note.trim() : "";

  const totalSteps = strategy.views.length + 1; // views + composite
  let step = typeof job.step === "number" ? job.step : 0;
  let viewResults = Array.isArray(job.view_results)
    ? ([...job.view_results] as ViewResultEntry[])
    : [];
  let referencePaths = Array.isArray(job.reference_paths)
    ? (job.reference_paths.filter((p) => typeof p === "string") as string[])
    : [];

  // Bootstrap views + totals on first tick only (do not reset progress).
  if (!job.total_steps) {
    const basePrompt = composeRoomStagingPrompt({ roomType, plan, intensity });
    const promptWithNote = sceneNote
      ? `${basePrompt} Additional note for this room: ${sceneNote}`
      : basePrompt;

    await admin
      .from("staging_jobs")
      .update({
        total_steps: totalSteps,
        step: 0,
        view_results: [] as unknown as Json,
        reference_paths: [] as unknown as Json,
        params: {
          ...withoutLease(job.params),
          strategy: strategyId,
          roomType,
          intensity,
          seed,
          prompt: promptWithNote,
        } as Json,
      })
      .eq("id", job.id);

    // Insert staging_views rows without overwriting existing progress.
    const { data: existingViews } = await admin
      .from("staging_views")
      .select("view_index")
      .eq("job_id", job.id);
    const have = new Set((existingViews ?? []).map((v) => v.view_index));
    const missing = strategy.views.filter((v) => !have.has(v.index));
    if (missing.length > 0) {
      await admin.from("staging_views").insert(
        missing.map((v) => ({
          scene_id: scene.id,
          job_id: job.id,
          view_index: v.index,
          yaw: v.yaw,
          pitch: v.pitch,
          fov: v.fov,
          status: "pending" as const,
        })),
      );
    }
    step = 0;
    viewResults = [];
    referencePaths = [];
  }

  const prompt =
    typeof job.params.prompt === "string" && job.params.prompt.trim()
      ? job.params.prompt.trim()
      : (() => {
          const base = composeRoomStagingPrompt({ roomType, plan, intensity });
          return sceneNote
            ? `${base} Additional note for this room: ${sceneNote}`
            : base;
        })();

  // ── Composite step ──────────────────────────────────────────────────
  if (step >= strategy.views.length) {
    try {
      return await runCompositeStep({
        admin,
        jobId: job.id,
        ownerId,
        tourId: job.tour_id,
        scene,
        strategy,
        viewResults,
        params: job.params,
        debug,
        prompt,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Composite failed.";
      console.error("[stage_room] composite", message, err);
      return failJob(job.id, message);
    }
  }

  // ── View step ───────────────────────────────────────────────────────
  const viewSpec = strategy.views[step]!;
  const existing = viewResults.find((r) => r.index === step);

  // Already succeeded — advance without re-paying. Re-queue for next tick.
  if (existing?.status === "succeeded" && existing.resultPath) {
    await admin
      .from("staging_jobs")
      .update({
        status: "queued",
        step: step + 1,
        provider_job_id: null,
        params: withoutLease(job.params) as Json,
      })
      .eq("id", job.id);
    return { status: "processing" };
  }

  let provider;
  try {
    provider = getStagingProvider("fal_flux_kontext");
  } catch (err) {
    return failJob(
      job.id,
      err instanceof Error ? err.message : "Provider not configured.",
    );
  }

  // Poll in-flight provider job for this view.
  if (job.provider_job_id) {
    const poll = await provider.pollInpaint(job.provider_job_id);
    if (poll.status === "queued" || poll.status === "processing") {
      await admin
        .from("staging_jobs")
        .update({ params: withoutLease(job.params) as Json })
        .eq("id", job.id);
      return { status: "processing" };
    }
    if (poll.status !== "completed") {
      await admin
        .from("staging_views")
        .update({ status: "failed" })
        .eq("job_id", job.id)
        .eq("view_index", step);
      return failJob(
        job.id,
        poll.status === "failed" ? poll.error : "Provider failed.",
      );
    }

    let resultBuf = poll.image;
    // If we submitted a collage, take the left half.
    if (job.params.usedCollage === true) {
      const meta = await sharp(resultBuf).metadata();
      if (meta.width && meta.height && meta.width >= meta.height * 1.5) {
        resultBuf = await sharp(resultBuf)
          .extract({
            left: 0,
            top: 0,
            width: Math.floor(meta.width / 2),
            height: meta.height,
          })
          .resize(strategy.size, strategy.size, { fit: "fill" })
          .jpeg({ quality: 92 })
          .toBuffer();
      }
    } else {
      const meta = await sharp(resultBuf).metadata();
      if (
        meta.width !== strategy.size ||
        meta.height !== strategy.size
      ) {
        resultBuf = await sharp(resultBuf)
          .resize(strategy.size, strategy.size, { fit: "fill" })
          .jpeg({ quality: 92 })
          .toBuffer();
      }
    }

    const resultPath = stagingViewResultPath(
      ownerId,
      job.tour_id,
      job.id,
      step,
    );
    const { error: upErr } = await admin.storage
      .from("panoramas")
      .upload(resultPath, resultBuf, {
        contentType: "image/jpeg",
        cacheControl: "120",
        upsert: true,
      });
    if (upErr) return failJob(job.id, upErr.message);

    if (debug) {
      await uploadDebug(
        ownerId,
        job.tour_id,
        job.id,
        `view-${step}-result.jpg`,
        resultBuf,
        "image/jpeg",
      );
    }

    const cost = poll.costCents ?? FAL_KONTEXT_COST_CENTS;
    const entry: ViewResultEntry = {
      index: step,
      status: "succeeded",
      sourcePath:
        typeof job.params.currentSourcePath === "string"
          ? job.params.currentSourcePath
          : undefined,
      resultPath,
      providerJobId: job.provider_job_id,
      costCents: cost,
    };
    const nextResults = [
      ...viewResults.filter((r) => r.index !== step),
      entry,
    ];
    const priorCost =
      typeof job.params.accruedCostCents === "number"
        ? job.params.accruedCostCents
        : 0;

    await admin
      .from("staging_views")
      .update({
        status: "succeeded",
        result_path: resultPath,
        source_path: entry.sourcePath ?? null,
      })
      .eq("job_id", job.id)
      .eq("view_index", step);

    const refPaths = [...referencePaths, resultPath];

    await admin
      .from("staging_jobs")
      .update({
        // Re-queue so the next poll tick can claim without waiting for stale.
        status: "queued",
        step: step + 1,
        provider_job_id: null,
        view_results: nextResults as unknown as Json,
        reference_paths: refPaths as unknown as Json,
        cost_cents: priorCost + cost,
        params: {
          ...withoutLease(job.params),
          accruedCostCents: priorCost + cost,
          usedCollage: false,
          currentSourcePath: null,
        } as Json,
      })
      .eq("id", job.id);

    return {
      status: "processing",
      result: {
        candidatePath: "",
        costCents: priorCost + cost,
        step: step + 1,
        totalSteps,
      },
    };
  }

  // Submit a new view.
  try {
    const sourcePath = resolveStagingInputPath(scene);
    const { data: file, error: dlErr } = await admin.storage
      .from("panoramas")
      .download(sourcePath);
    if (dlErr || !file) {
      return failJob(job.id, dlErr?.message ?? "Failed to download panorama.");
    }
    const original = await decodeImageToRgba(
      Buffer.from(await file.arrayBuffer()),
    );

    let cropJpeg: Buffer;
    if (strategyId === "D") {
      const crop = nadirCrop(original, {
        fovDegrees: 160,
        size: strategy.size,
      });
      cropJpeg = await encodeRgbaToJpeg(crop, 92);
    } else {
      const persp = equirectToPerspective(original, {
        yaw: viewSpec.yaw,
        pitch: viewSpec.pitch,
        fov: viewSpec.fov,
        width: strategy.size,
        height: strategy.size,
      });
      cropJpeg = await encodeRgbaToJpeg(persp, 92);
    }

    const sourceUpload = stagingViewSourcePath(
      ownerId,
      job.tour_id,
      job.id,
      step,
    );
    await admin.storage.from("panoramas").upload(sourceUpload, cropJpeg, {
      contentType: "image/jpeg",
      cacheControl: "120",
      upsert: true,
    });

    if (debug) {
      await uploadDebug(
        ownerId,
        job.tour_id,
        job.id,
        `view-${step}-source.jpg`,
        cropJpeg,
        "image/jpeg",
      );
    }

    // Adjacent reference: prior succeeded view as collage right half.
    let submitBuf = cropJpeg;
    let usedCollage = false;
    const prior = viewResults
      .filter((r) => r.status === "succeeded" && r.resultPath)
      .sort((a, b) => b.index - a.index)[0];
    if (prior?.resultPath) {
      const { data: prevFile } = await admin.storage
        .from("panoramas")
        .download(prior.resultPath);
      if (prevFile) {
        const prevBuf = Buffer.from(await prevFile.arrayBuffer());
        submitBuf = await buildReferenceCollage(cropJpeg, prevBuf);
        usedCollage = true;
      }
    }

    const submitPath = usedCollage
      ? `${stagingWorkDir(ownerId, job.tour_id, job.id)}/views/${step}-collage.jpg`
      : sourceUpload;
    if (usedCollage) {
      await admin.storage.from("panoramas").upload(submitPath, submitBuf, {
        contentType: "image/jpeg",
        cacheControl: "60",
        upsert: true,
      });
    }

    const imageUrl = publicUrl(submitPath);
    const stagedPrompt = usedCollage
      ? `${prompt} The image is a side-by-side pair: furnish ONLY the LEFT half. The RIGHT half is an adjacent already-staged view — match the same furniture pieces, materials, and lighting in the overlap.`
      : prompt;

    const submitted = await provider.submitInpaint({
      image: submitBuf,
      mask: Buffer.alloc(0),
      imageUrl,
      prompt: stagedPrompt,
      seed: seed + step * 17,
      numImages: 1,
    });

    await admin
      .from("staging_views")
      .update({
        status: "processing",
        source_path: sourceUpload,
      })
      .eq("job_id", job.id)
      .eq("view_index", step);

    await admin
      .from("staging_jobs")
      .update({
        status: "processing",
        provider: provider.name,
        provider_job_id: submitted.providerJobId,
        total_steps: totalSteps,
        params: {
          ...withoutLease(job.params),
          strategy: strategyId,
          roomType,
          intensity,
          seed,
          prompt,
          currentSourcePath: sourceUpload,
          usedCollage,
        } as Json,
      })
      .eq("id", job.id);

    return {
      status: "processing",
      result: {
        candidatePath: "",
        costCents: null,
        step,
        totalSteps,
      },
    };
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to submit staging view.";
    console.error("[stage_room] submit view", step, message, err);
    return failJob(job.id, message);
  }
}

async function runCompositeStep(options: {
  admin: ReturnType<typeof createAdminClient>;
  jobId: string;
  ownerId: string;
  tourId: string;
  scene: {
    id: string;
    storage_path: string;
    cleaned_path: string | null;
    cleaned_enabled: boolean | null;
    width: number | null;
    height: number | null;
  };
  strategy: ReturnType<typeof getViewStrategy>;
  viewResults: ViewResultEntry[];
  params: Record<string, unknown>;
  debug: boolean;
  prompt: string;
}): Promise<{
  status: "succeeded" | "failed" | "processing";
  result?: StageRoomJobResult;
  error?: string;
}> {
  const {
    admin,
    jobId,
    ownerId,
    tourId,
    scene,
    strategy,
    viewResults,
    params,
    debug,
  } = options;

  const succeeded = strategy.views.map((v) =>
    viewResults.find((r) => r.index === v.index && r.status === "succeeded"),
  );
  if (succeeded.some((s) => !s?.resultPath)) {
    return failJob(jobId, "Cannot composite — not all views succeeded.");
  }

  const sourcePath = resolveStagingInputPath(scene);
  const { data: file, error: dlErr } = await admin.storage
    .from("panoramas")
    .download(sourcePath);
  if (dlErr || !file) {
    return failJob(jobId, dlErr?.message ?? "Failed to download panorama.");
  }
  const original = await decodeImageToRgba(
    Buffer.from(await file.arrayBuffer()),
  );

  let working: RgbaImage = {
    data: new Uint8ClampedArray(original.data),
    width: original.width,
    height: original.height,
  };

  // Accumulate union of blend alphas for outside-region assertion.
  const unionAlpha: CoverageMask = {
    data: new Float32Array(original.width * original.height),
    width: original.width,
    height: original.height,
  };

  for (const v of strategy.views) {
    const entry = succeeded[v.index]!;
    const { data: resFile, error: resErr } = await admin.storage
      .from("panoramas")
      .download(entry!.resultPath!);
    if (resErr || !resFile) {
      return failJob(jobId, resErr?.message ?? `Missing view ${v.index}.`);
    }
    const staged = await decodeImageToRgba(
      Buffer.from(await resFile.arrayBuffer()),
    );

    let patch: RgbaImage;
    let coverage: CoverageMask;
    if (strategy.id === "D") {
      const re = nadirCropToEquirect(staged, {
        fovDegrees: 160,
        size: strategy.size,
        targetWidth: original.width,
        targetHeight: original.height,
      });
      patch = re.image;
      coverage = re.mask;
    } else {
      const re = perspectiveToEquirect(staged, {
        yaw: v.yaw,
        pitch: v.pitch,
        fov: v.fov,
        targetWidth: original.width,
        targetHeight: original.height,
      });
      patch = re.image;
      coverage = re.mask;
    }

    const faded = applyPitchFalloff(coverage);
    for (let i = 0; i < unionAlpha.data.length; i++) {
      unionAlpha.data[i] = Math.max(unionAlpha.data[i]!, faded.data[i]!);
    }

    working = compositeWithBlendAlpha(working, patch, faded);
  }

  // Assert: outside the union of all view coverages (with pitch falloff),
  // pixels match the pristine original.
  assertOutsideMaskUnchanged(original, working, unionAlpha);

  const candidateJpeg = await encodeRgbaToJpeg(working, 92);
  const candidatePath = stagingRoomCandidatePath(ownerId, tourId, jobId);
  const { error: upErr } = await admin.storage
    .from("panoramas")
    .upload(candidatePath, candidateJpeg, {
      contentType: "image/jpeg",
      cacheControl: "120",
      upsert: true,
    });
  if (upErr) return failJob(jobId, upErr.message);

  let compatPath: string | null = null;
  const compatJpeg = await encodeCompatJpeg(candidateJpeg, 4096);
  if (compatJpeg) {
    const cPath = stagingRoomCandidateCompatPath(ownerId, tourId, jobId);
    const { error: cErr } = await admin.storage
      .from("panoramas")
      .upload(cPath, compatJpeg, {
        contentType: "image/jpeg",
        cacheControl: "120",
        upsert: true,
      });
    if (!cErr) compatPath = cPath;
  }

  if (debug) {
    await uploadDebug(
      ownerId,
      tourId,
      jobId,
      "06-result.jpg",
      candidateJpeg,
      "image/jpeg",
    );
    const workingPath = stagingWorkingEquirectPath(ownerId, tourId, jobId);
    await admin.storage
      .from("panoramas")
      .upload(workingPath, candidateJpeg, {
        contentType: "image/jpeg",
        upsert: true,
      });
  }

  const costCents =
    typeof params.accruedCostCents === "number" ? params.accruedCostCents : null;

  // Candidate only — do not enable staged_enabled.
  await admin
    .from("scenes")
    .update({
      staging_candidate_path: candidatePath,
      staging_candidate_job_id: jobId,
    })
    .eq("id", scene.id);

  await admin
    .from("staging_jobs")
    .update({
      status: "succeeded",
      step: strategy.views.length + 1,
      result_path: candidatePath,
      cost_cents: costCents,
      error: null,
      provider_job_id: null,
      params: {
        ...withoutLease(params),
        awaitingReview: true,
        candidatePath,
        candidateCompatPath: compatPath,
        candidateUrl: publicUrl(candidatePath),
        debugUrls: debug
          ? {
              "06-result.jpg": publicUrl(
                stagingDebugPath(ownerId, tourId, jobId, "06-result.jpg"),
              ),
            }
          : undefined,
      } as Json,
    })
    .eq("id", jobId);

  return {
    status: "succeeded",
    result: {
      candidatePath,
      costCents,
      step: strategy.views.length + 1,
      totalSteps: strategy.views.length + 1,
    },
  };
}
