import "server-only";

import { fal } from "@fal-ai/client";
import sharp from "sharp";

import type {
  InpaintInput,
  InpaintPollResult,
  InpaintSubmitResult,
  StagingProvider,
} from "@/lib/staging/providers/types";

/** Instruction-following edit — no mask; we mask at composite time. */
export const FAL_KONTEXT_ENDPOINT = "fal-ai/flux-pro/kontext";

/** Flat $0.04 per image (fal pricing Aug 2026). */
export const FAL_KONTEXT_COST_CENTS = 4;

const DEFAULT_EDIT_PROMPT =
  "Remove the camera tripod and any equipment at the centre of the image. Continue the surrounding ground surface naturally through the centre so it matches the texture, color, and lighting of the rest of the surface. Do not add objects, people, text, or shadows.";

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

async function assertReachable(label: string, url: string): Promise<void> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(`${label} URL not reachable (HTTP ${res.status}): ${url}`);
  }
}

/**
 * Option 2: FLUX Kontext [pro] — instruction-following image edit.
 * Mask is ignored by the API; callers must blend with the circular mask.
 */
export const falKontextProvider: StagingProvider = {
  name: "fal_flux_kontext",
  kind: "edit",

  async submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult> {
    configureFal();
    const imageUrl = input.imageUrl;
    if (!imageUrl) {
      throw new Error("fal Kontext requires imageUrl.");
    }
    await assertReachable("image_url", imageUrl);

    const prompt = (input.prompt?.trim() || DEFAULT_EDIT_PROMPT).slice(0, 2000);
    const falInput = {
      prompt,
      image_url: imageUrl,
      output_format: "jpeg" as const,
      num_images: Math.min(4, Math.max(1, input.numImages ?? 1)),
      guidance_scale: 3.5,
      enhance_prompt: false,
      ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
    };

    console.info(
      "[fal-kontext] submit payload",
      JSON.stringify({ endpoint: FAL_KONTEXT_ENDPOINT, input: falInput }),
    );

    const submitted = await fal.queue.submit(FAL_KONTEXT_ENDPOINT, {
      input: falInput,
    });
    const requestId =
      (submitted as { request_id?: string }).request_id ??
      (submitted as { requestId?: string }).requestId;
    if (!requestId) {
      throw new Error("fal Kontext submit returned no request_id.");
    }
    console.info(
      "[fal-kontext] submit response",
      JSON.stringify({ request_id: requestId }),
    );
    return { providerJobId: requestId, meta: { prompt } };
  },

  async pollInpaint(providerJobId: string): Promise<InpaintPollResult> {
    configureFal();
    const status = await fal.queue.status(FAL_KONTEXT_ENDPOINT, {
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
          `fal Kontext ended with status “${s || "unknown"}”.`,
        retryable: true,
      };
    }

    const result = await fal.queue.result(FAL_KONTEXT_ENDPOINT, {
      requestId: providerJobId,
    });
    console.info(
      "[fal-kontext] raw result",
      JSON.stringify({ requestId: providerJobId, data: result.data }),
    );

    const data = result.data as {
      images?: Array<{ url?: string; width?: number; height?: number }>;
      has_nsfw_concepts?: boolean[];
    };
    if (data.has_nsfw_concepts?.some(Boolean)) {
      return {
        status: "failed",
        error: "Content filter rejected the generated image.",
        retryable: false,
      };
    }

    const images = data.images ?? [];
    if (images.length === 0 || !images[0]?.url) {
      return {
        status: "failed",
        error: "fal Kontext result contained no image URL.",
        retryable: true,
      };
    }

    const buffers: Buffer[] = [];
    for (const img of images) {
      if (!img.url) continue;
      const res = await fetch(img.url);
      if (!res.ok) {
        return {
          status: "failed",
          error: `Failed to download Kontext result (${res.status}).`,
          retryable: true,
        };
      }
      buffers.push(Buffer.from(await res.arrayBuffer()));
    }

    return {
      status: "completed",
      image: buffers[0]!,
      images: buffers,
      costCents: FAL_KONTEXT_COST_CENTS * buffers.length,
    };
  },
};

export const KONTEXT_DEFAULT_PROMPT = DEFAULT_EDIT_PROMPT;
