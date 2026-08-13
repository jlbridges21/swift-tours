import "server-only";

import { fal } from "@fal-ai/client";
import sharp from "sharp";

import type {
  InpaintInput,
  InpaintPollResult,
  InpaintSubmitResult,
  StagingProvider,
} from "@/lib/staging/providers/types";
import { estimateFluxFillCostCents } from "@/lib/staging/providers/fal-flux-fill";

/** Vision describe (any-llm) + FLUX Fill. */
export const FAL_VISION_ENDPOINT = "fal-ai/any-llm/vision";
export const FAL_FLUX_FILL_ENDPOINT = "fal-ai/flux-pro/v1/fill";

const VISION_MODEL = "google/gemini-2.5-flash-lite";

function requireFalKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error("FAL_KEY is not set.");
  }
  return key;
}

function configureFal() {
  fal.config({ credentials: requireFalKey() });
}

async function assertReachable(
  label: string,
  url: string,
): Promise<{ width: number; height: number }> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${label} URL not reachable (HTTP ${res.status}): ${url}`);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`${label} is not a decodable image: ${url}`);
  }
  return { width: meta.width, height: meta.height };
}

/**
 * Describe the ground surface in the crop for use as a Fill content prompt.
 * Never mention tripods/cameras/removal.
 */
async function describeGroundSurface(imageUrl: string): Promise<string> {
  configureFal();
  const result = await fal.subscribe(FAL_VISION_ENDPOINT, {
    input: {
      model: VISION_MODEL,
      image_urls: [imageUrl],
      prompt:
        "Describe ONLY the ground/floor/surface material visible around the centre of this top-down photo. Reply with a short comma-separated phrase suitable as an inpainting prompt for continuing that surface (e.g. 'green lawn grass, natural outdoor turf, even daylight'). Do not mention people, cameras, tripods, equipment, removal, or objects. Do not use verbs.",
      system_prompt:
        "Reply with only the surface description phrase, no quotes or preamble.",
    },
    logs: false,
  });

  const data = result.data as { output?: string };
  const raw = (data.output ?? "").trim().replace(/^["']|["']$/g, "");
  if (!raw || raw.length < 8) {
    return "continuous ground surface, matching surrounding texture and color, even lighting, empty surface";
  }
  // Strip forbidden words if the model slips.
  const cleaned = raw
    .replace(/\b(tripod|camera|remove|erase|delete|equipment)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || raw;
}

/**
 * Option 1: vision-derived prompt → FLUX Fill.
 * Uses the same queue submit/poll pattern as plain Fill.
 */
export const falVisionFillProvider: StagingProvider = {
  name: "fal_vision_fill",
  kind: "fill",

  async submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult> {
    configureFal();
    const imageUrl = input.imageUrl;
    const maskUrl = input.maskUrl;
    if (!imageUrl || !maskUrl) {
      throw new Error("fal vision+Fill requires imageUrl and maskUrl.");
    }

    const [imageMeta, maskMeta] = await Promise.all([
      assertReachable("image_url", imageUrl),
      assertReachable("mask_url", maskUrl),
    ]);
    if (
      imageMeta.width !== maskMeta.width ||
      imageMeta.height !== maskMeta.height
    ) {
      throw new Error(
        `image/mask dimension mismatch: ${imageMeta.width}×${imageMeta.height} vs ${maskMeta.width}×${maskMeta.height}`,
      );
    }

    const description = await describeGroundSurface(imageUrl);
    const prompt = `${description}, continuous empty surface, even lighting`;

    console.info(
      "[fal-vision-fill] vision description",
      JSON.stringify({ description, prompt }),
    );

    const falInput = {
      prompt,
      image_url: imageUrl,
      mask_url: maskUrl,
      output_format: "jpeg" as const,
      num_images: 1,
      enhance_prompt: false,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };

    console.info(
      "[fal-vision-fill] submit payload",
      JSON.stringify({ endpoint: FAL_FLUX_FILL_ENDPOINT, input: falInput }),
    );

    const submitted = await fal.queue.submit(FAL_FLUX_FILL_ENDPOINT, {
      input: falInput,
    });
    const requestId =
      (submitted as { request_id?: string }).request_id ??
      (submitted as { requestId?: string }).requestId;
    if (!requestId) throw new Error("fal Fill submit returned no request_id.");

    return {
      providerJobId: requestId,
      meta: { prompt, description },
    };
  },

  async pollInpaint(providerJobId: string): Promise<InpaintPollResult> {
    configureFal();
    const status = await fal.queue.status(FAL_FLUX_FILL_ENDPOINT, {
      requestId: providerJobId,
      logs: false,
    });
    const s = (status as { status?: string }).status ?? "";
    if (s === "IN_QUEUE") return { status: "queued" };
    if (s === "IN_PROGRESS") return { status: "processing" };
    if (s !== "COMPLETED") {
      return {
        status: "failed",
        error:
          (status as { error?: string }).error ??
          `fal job ended with status “${s || "unknown"}”.`,
        retryable: true,
      };
    }

    const result = await fal.queue.result(FAL_FLUX_FILL_ENDPOINT, {
      requestId: providerJobId,
    });
    console.info(
      "[fal-vision-fill] raw result",
      JSON.stringify({ requestId: providerJobId, data: result.data }),
    );
    const data = result.data as {
      images?: Array<{ url?: string; width?: number; height?: number }>;
    };
    const url = data.images?.[0]?.url;
    if (!url) {
      return {
        status: "failed",
        error: "fal result contained no image URL.",
        retryable: true,
      };
    }
    const res = await fetch(url);
    if (!res.ok) {
      return {
        status: "failed",
        error: `Failed to download fal result (${res.status}).`,
        retryable: true,
      };
    }
    const image = Buffer.from(await res.arrayBuffer());
    const meta = await sharp(image).metadata();
    const width = data.images?.[0]?.width ?? meta.width ?? 1024;
    const height = data.images?.[0]?.height ?? meta.height ?? 1024;
    // Vision call is cheap (~fraction of a cent); Fill dominates.
    return {
      status: "completed",
      image,
      costCents: estimateFluxFillCostCents(width, height) + 1,
    };
  },
};
