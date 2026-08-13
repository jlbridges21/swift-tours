import "server-only";

import { fal } from "@fal-ai/client";
import sharp from "sharp";

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

/**
 * fal bills by rounding image megapixels UP to the nearest whole MP.
 * 1024×1024 = 1.048576 MP → 2 MP → 10¢. UI must use this, not “5¢ flat”.
 */
export function estimateFluxFillCostCents(
  width: number,
  height: number,
): number {
  const mp = Math.max(1, Math.ceil((width * height) / 1_000_000));
  return mp * FAL_FLUX_FILL_CENTS_PER_MP;
}

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
 * Fail loudly if fal cannot fetch our conditioning assets.
 * A 404 image_url makes Fill degrade toward pure generation (white / stock).
 */
async function assertPublicUrlReachable(
  label: string,
  url: string,
): Promise<{ width: number; height: number; bytes: number }> {
  const res = await fetch(url, { method: "GET", cache: "no-store" });
  if (!res.ok) {
    throw new Error(
      `${label} URL not reachable (HTTP ${res.status}): ${url}`,
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength < 32) {
    throw new Error(`${label} URL returned an empty/tiny body: ${url}`);
  }
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) {
    throw new Error(`${label} URL is not a decodable image: ${url}`);
  }
  return { width: meta.width, height: meta.height, bytes: buf.byteLength };
}

/**
 * fal.ai FLUX.1 [pro] Fill via the Queue API.
 *
 * Docs (fal-ai/flux-pro/v1/fill):
 * - Auth: FAL_KEY env or fal.config({ credentials })
 * - Inputs: prompt, image_url, mask_url (URLs or base64 data URIs)
 * - Mask must match image dimensions; white=inpaint, black=preserve
 *   (confirmed via fal’s example mask_knight.jpeg: corners black, edit region white)
 * - No native negative_prompt — do not append removal verbs / object names
 * - Queue: fal.queue.submit → status → result (do not use subscribe on Vercel)
 * - Pricing: $0.05/MP rounded up (1024² → 2 MP → $0.10)
 */
export const falFluxFillProvider: StagingProvider = {
  name: "fal_flux_fill",
  kind: "fill",

  async submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult> {
    configureFal();

    const imageUrl = input.imageUrl;
    const maskUrl = input.maskUrl;
    if (!imageUrl || !maskUrl) {
      throw new Error(
        "fal Fill requires imageUrl and maskUrl (upload crops to Storage first).",
      );
    }

    const [imageMeta, maskMeta] = await Promise.all([
      assertPublicUrlReachable("image_url", imageUrl),
      assertPublicUrlReachable("mask_url", maskUrl),
    ]);

    if (
      imageMeta.width !== maskMeta.width ||
      imageMeta.height !== maskMeta.height
    ) {
      throw new Error(
        `image/mask dimension mismatch: image ${imageMeta.width}×${imageMeta.height} vs mask ${maskMeta.width}×${maskMeta.height}. Fill requires identical sizes.`,
      );
    }

    // Fill has no negative_prompt. Do NOT fold “Avoid: tripod…” — those words
    // become content. Prompt must describe desired floor only.
    const prompt = input.prompt.trim();

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
      "[fal-flux-fill] submit payload",
      JSON.stringify({
        endpoint: FAL_FLUX_FILL_ENDPOINT,
        input: falInput,
        imageMeta,
        maskMeta,
      }),
    );

    try {
      const submitted = await fal.queue.submit(FAL_FLUX_FILL_ENDPOINT, {
        input: falInput,
      });

      const requestId =
        (submitted as { request_id?: string }).request_id ??
        (submitted as { requestId?: string }).requestId;

      if (!requestId) {
        throw new Error("fal queue submit returned no request_id.");
      }

      console.info(
        "[fal-flux-fill] submit response",
        JSON.stringify({ request_id: requestId, raw: submitted }),
      );

      return { providerJobId: requestId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[fal-flux-fill] submit error", message);
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
        console.info(
          "[fal-flux-fill] raw result",
          JSON.stringify({
            requestId: providerJobId,
            data: result.data,
            requestIdFromResult: (result as { requestId?: string }).requestId,
          }),
        );

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
        const meta = await sharp(image).metadata();
        const width = data.images?.[0]?.width ?? meta.width ?? 1024;
        const height = data.images?.[0]?.height ?? meta.height ?? 1024;

        return {
          status: "completed",
          image,
          costCents: estimateFluxFillCostCents(width, height),
        };
      }

      // FAILED or unknown
      const detail =
        (status as { error?: string }).error ??
        `fal job ended with status “${s || "unknown"}”.`;
      console.error("[fal-flux-fill] poll failed status", JSON.stringify(status));
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
