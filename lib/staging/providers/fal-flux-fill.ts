import "server-only";

import { fal } from "@fal-ai/client";

import type {
  InpaintInput,
  InpaintPollResult,
  InpaintSubmitResult,
  StagingProvider,
} from "@/lib/staging/providers/types";

/** Current fal model id (confirmed against fal docs Aug 2026). */
export const FAL_FLUX_FILL_ENDPOINT = "fal-ai/flux-pro/v1/fill";

/** $0.05 per megapixel, rounded up — fal pricing page. */
export const FAL_FLUX_FILL_CENTS_PER_MP = 5;

function requireFalKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) {
    throw new Error(
      "FAL_KEY is not set. Add it as a server-only env var (never NEXT_PUBLIC_).",
    );
  }
  return key;
}

function configureFal() {
  fal.config({ credentials: requireFalKey() });
}

function estimateCostCents(width: number, height: number): number {
  const mp = Math.max(1, Math.ceil((width * height) / 1_000_000));
  return mp * FAL_FLUX_FILL_CENTS_PER_MP;
}

function isContentFilterError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("nsfw") ||
    m.includes("safety") ||
    m.includes("content filter") ||
    m.includes("moderation") ||
    m.includes("blocked")
  );
}

function isRateLimitError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("rate limit") ||
    m.includes("too many requests") ||
    m.includes("429")
  );
}

async function downloadImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to download fal result (${res.status}).`);
  }
  return Buffer.from(await res.arrayBuffer());
}

/**
 * fal.ai FLUX.1 [pro] Fill via the Queue API.
 *
 * Docs (fal-ai/flux-pro/v1/fill):
 * - Auth: FAL_KEY env or fal.config({ credentials })
 * - Inputs: prompt, image_url, mask_url (URLs or base64 data URIs)
 * - Mask must match image dimensions; white=inpaint, black=preserve
 * - No native negative_prompt — we fold negatives into the prompt
 * - Queue: fal.queue.submit → status → result (do not use subscribe on Vercel)
 * - Pricing: $0.05/MP rounded up
 */
export const falFluxFillProvider: StagingProvider = {
  name: "fal_flux_fill",

  async submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult> {
    configureFal();

    const imageUrl = input.imageUrl;
    const maskUrl = input.maskUrl;
    if (!imageUrl || !maskUrl) {
      throw new Error(
        "fal Fill requires imageUrl and maskUrl (upload crops to Storage first).",
      );
    }

    // Fill has no negative_prompt field — append avoid-list to the prompt.
    const prompt = input.negativePrompt
      ? `${input.prompt.trim()} Avoid: ${input.negativePrompt.trim()}.`
      : input.prompt;

    try {
      const submitted = await fal.queue.submit(FAL_FLUX_FILL_ENDPOINT, {
        input: {
          prompt,
          image_url: imageUrl,
          mask_url: maskUrl,
          output_format: "jpeg",
          num_images: 1,
          ...(typeof input.seed === "number" ? { seed: input.seed } : {}),
        },
      });

      const requestId =
        (submitted as { request_id?: string }).request_id ??
        (submitted as { requestId?: string }).requestId;

      if (!requestId) {
        throw new Error("fal queue submit returned no request_id.");
      }

      return { providerJobId: requestId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isContentFilterError(message)) {
        const e = new Error(
          `Content filter rejected this image: ${message}`,
        ) as Error & { retryable?: boolean };
        e.retryable = false;
        throw e;
      }
      if (isRateLimitError(message)) {
        const e = new Error(`Rate limited by fal: ${message}`) as Error & {
          retryable?: boolean;
        };
        e.retryable = true;
        throw e;
      }
      throw err;
    }
  },

  async pollInpaint(providerJobId: string): Promise<InpaintPollResult> {
    configureFal();

    try {
      const status = await fal.queue.status(FAL_FLUX_FILL_ENDPOINT, {
        requestId: providerJobId,
        logs: false,
      });

      const s = (status as { status?: string }).status ?? "";
      if (s === "IN_QUEUE") return { status: "queued" };
      if (s === "IN_PROGRESS") return { status: "processing" };

      if (s === "COMPLETED") {
        const result = await fal.queue.result(FAL_FLUX_FILL_ENDPOINT, {
          requestId: providerJobId,
        });
        const data = result.data as {
          images?: Array<{ url?: string; width?: number; height?: number }>;
          has_nsfw_concepts?: boolean[];
        };

        if (data.has_nsfw_concepts?.some(Boolean)) {
          return {
            status: "failed",
            error:
              "Content filter rejected the generated image (NSFW concepts detected).",
            retryable: false,
          };
        }

        const imageUrl = data.images?.[0]?.url;
        if (!imageUrl) {
          return {
            status: "failed",
            error: "fal result contained no image URL.",
            retryable: true,
          };
        }

        const image = await downloadImage(imageUrl);
        const width = data.images?.[0]?.width ?? 1024;
        const height = data.images?.[0]?.height ?? 1024;

        return {
          status: "completed",
          image,
          costCents: estimateCostCents(width, height),
        };
      }

      // FAILED or unknown
      const detail =
        (status as { error?: string }).error ??
        `fal job ended with status “${s || "unknown"}”.`;
      return {
        status: "failed",
        error: detail,
        retryable: !isContentFilterError(detail),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (isContentFilterError(message)) {
        return { status: "failed", error: message, retryable: false };
      }
      if (isRateLimitError(message)) {
        return {
          status: "failed",
          error: `Rate limited while polling fal: ${message}`,
          retryable: true,
        };
      }
      // Transient network — treat as still processing so the client retries.
      if (
        message.toLowerCase().includes("timeout") ||
        message.toLowerCase().includes("fetch failed")
      ) {
        return { status: "processing" };
      }
      return { status: "failed", error: message, retryable: true };
    }
  },
};
