import "server-only";

import type {
  InpaintInput,
  InpaintPollResult,
  InpaintSubmitResult,
  StagingProvider,
} from "@/lib/staging/providers/types";
import { radialTextureFill } from "@/lib/staging/texture-fill";
import { decodeImageToRgba, encodeRgbaToJpeg } from "@/lib/staging/image-codec";

/**
 * Non-AI texture fill — free, instant. Completes in submit (sync).
 * pollInpaint is a no-op completed state using a local pseudo job id.
 */
const localResults = new Map<string, Buffer>();

export const textureFillProvider: StagingProvider = {
  name: "texture_fill",
  kind: "local",

  async submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult> {
    const crop = await decodeImageToRgba(input.image);
    const mask = await decodeImageToRgba(input.mask);
    const filled = radialTextureFill(crop, mask);
    const jpeg = await encodeRgbaToJpeg(filled, 92);
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    localResults.set(id, jpeg);
    // Bound memory: drop oldest if map grows.
    if (localResults.size > 32) {
      const first = localResults.keys().next().value;
      if (first) localResults.delete(first);
    }
    return { providerJobId: id, meta: { mode: "texture_fill" } };
  },

  async pollInpaint(providerJobId: string): Promise<InpaintPollResult> {
    const image = localResults.get(providerJobId);
    if (!image) {
      return {
        status: "failed",
        error: "Local texture fill result expired — retry the job.",
        retryable: true,
      };
    }
    localResults.delete(providerJobId);
    return { status: "completed", image, costCents: 0 };
  },
};
