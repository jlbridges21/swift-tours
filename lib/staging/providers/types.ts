export type InpaintInput = {
  /** The perspective crop (JPEG/PNG bytes). */
  image: Buffer;
  /** White = regenerate, black = preserve (same dimensions as image). */
  mask: Buffer;
  prompt: string;
  negativePrompt?: string;
  /** Unused by Fill; present for the Kontext adapter later. */
  referenceImages?: Buffer[];
  seed?: number;
  /** Multiple candidates when the provider supports it (Kontext: 1–4). */
  numImages?: number;
  /**
   * Publicly reachable URLs for image/mask when the provider requires URLs
   * (preferred over base64 to stay under body limits).
   */
  imageUrl?: string;
  maskUrl?: string;
};

export type InpaintSubmitResult = {
  providerJobId: string;
  meta?: Record<string, unknown>;
};

export type InpaintPollResult =
  | { status: "queued" | "processing" }
  | {
      status: "completed";
      image: Buffer;
      /** Extra candidates when num_images > 1. */
      images?: Buffer[];
      costCents?: number;
    }
  | {
      status: "failed";
      error: string;
      /** Rate limits / timeouts may retry; content filter must not. */
      retryable: boolean;
    };

export type StagingProviderKind = "fill" | "edit" | "local";

/**
 * AI staging provider. Implementations must use a queue (submit + poll) so
 * Vercel functions are never held open waiting on the model — except `local`
 * providers which complete synchronously inside the process tick.
 */
export interface StagingProvider {
  name: string;
  /** fill = masked FLUX Fill; edit = instruction model; local = no network AI. */
  kind?: StagingProviderKind;
  submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult>;
  pollInpaint(providerJobId: string): Promise<InpaintPollResult>;
}
