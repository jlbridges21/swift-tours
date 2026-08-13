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
  /**
   * Publicly reachable URLs for image/mask when the provider requires URLs
   * (preferred over base64 to stay under body limits).
   */
  imageUrl?: string;
  maskUrl?: string;
};

export type InpaintSubmitResult = {
  providerJobId: string;
};

export type InpaintPollResult =
  | { status: "queued" | "processing" }
  | {
      status: "completed";
      image: Buffer;
      costCents?: number;
    }
  | {
      status: "failed";
      error: string;
      /** Rate limits / timeouts may retry; content filter must not. */
      retryable: boolean;
    };

/**
 * AI staging provider. Implementations must use a queue (submit + poll) so
 * Vercel functions are never held open waiting on the model.
 */
export interface StagingProvider {
  name: string;
  submitInpaint(input: InpaintInput): Promise<InpaintSubmitResult>;
  pollInpaint(providerJobId: string): Promise<InpaintPollResult>;
}
