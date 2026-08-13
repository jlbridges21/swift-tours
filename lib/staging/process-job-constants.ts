/** Shared nadir-fill constants (no server-only side effects). */

/** Jobs stuck in `processing` longer than this are reclaimable. */
export const STALE_PROCESSING_MS = 10 * 60 * 1000;

/**
 * Wider FOV + smaller mask so surrounding surface dominates the frame.
 * 150° FOV ≈ lots of real floor context; mask ratio 0.22 ≈ disc is ~15% of area
 * (π·0.22²) rather than ~32% at 0.45 — Fill/Kontext have less to invent.
 * 1536² keeps texture detail; cost scales with MP (acceptable for correctness).
 */
export const NADIR_FILL_FOV_DEGREES = 150;
export const NADIR_FILL_CROP_SIZE = 1536;
export const NADIR_FILL_MASK_RADIUS_RATIO = 0.22;
export const NADIR_FILL_MASK_FEATHER_PX = 72;

export const WORKER_LEASE_MS = 120_000;
export const JOB_ABSOLUTE_TIMEOUT_MS = 8 * 60 * 1000;

export function isStagingDebugEnabled(): boolean {
  return process.env.STAGING_DEBUG === "true";
}

export type NadirFillJobResult = {
  cleanedPath: string;
  cleanedCompatPath: string | null;
  costCents: number | null;
  providerJobId: string;
  cropSize: number;
  fovDegrees: number;
};
