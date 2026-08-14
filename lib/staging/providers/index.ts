import "server-only";

import { falFluxFillProvider } from "@/lib/staging/providers/fal-flux-fill";
import { falKontextProvider } from "@/lib/staging/providers/fal-kontext";
import { falVisionFillProvider } from "@/lib/staging/providers/fal-vision-fill";
import { textureFillProvider } from "@/lib/staging/providers/texture-fill";
import type { StagingProvider } from "@/lib/staging/providers/types";

export type StagingProviderName =
  | "fal_flux_fill"
  | "fal_vision_fill"
  | "fal_flux_kontext"
  | "texture_fill";

/**
 * Resolve the staging provider from STAGING_PROVIDER or an explicit override.
 * Server-only — never import from Client Components.
 */
export function getStagingProvider(
  override?: string | null,
): StagingProvider {
  const name = (
    override?.trim() ||
    process.env.STAGING_PROVIDER ||
    "fal_flux_kontext"
  ).trim() as StagingProviderName;

  switch (name) {
    case "fal_flux_fill": {
      if (!process.env.FAL_KEY?.trim()) {
        throw new Error(
          "STAGING_PROVIDER is fal_flux_fill but FAL_KEY is missing.",
        );
      }
      return falFluxFillProvider;
    }
    case "fal_vision_fill": {
      if (!process.env.FAL_KEY?.trim()) {
        throw new Error(
          "STAGING_PROVIDER is fal_vision_fill but FAL_KEY is missing.",
        );
      }
      return falVisionFillProvider;
    }
    case "fal_flux_kontext": {
      if (!process.env.FAL_KEY?.trim()) {
        throw new Error(
          "STAGING_PROVIDER is fal_flux_kontext but FAL_KEY is missing.",
        );
      }
      return falKontextProvider;
    }
    case "texture_fill":
      return textureFillProvider;
    default:
      throw new Error(
        `Unknown STAGING_PROVIDER “${name}”. Supported: fal_flux_kontext, fal_vision_fill, fal_flux_fill, texture_fill.`,
      );
  }
}

export function isStagingEnabled(): boolean {
  return process.env.STAGING_ENABLED === "true";
}

export function stagingMaxJobsPerTour(): number {
  const raw = process.env.STAGING_MAX_JOBS_PER_TOUR;
  const n = raw ? Number.parseInt(raw, 10) : 50;
  return Number.isFinite(n) && n > 0 ? n : 50;
}

/** Tour-wide AI spend cap (cents). Default $20. */
export function stagingMaxSpendCentsPerTour(): number {
  const raw = process.env.STAGING_MAX_SPEND_CENTS_PER_TOUR;
  const n = raw ? Number.parseInt(raw, 10) : 2000;
  return Number.isFinite(n) && n > 0 ? n : 2000;
}

/**
 * Per-job cost cap (cents). stage_room defaults higher because one scene is
 * several model calls; override with STAGING_MAX_COST_CENTS_PER_JOB.
 */
export function stagingMaxCostCentsPerJob(kind: string): number {
  const raw = process.env.STAGING_MAX_COST_CENTS_PER_JOB;
  if (raw) {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return kind === "stage_room" ? 50 : 20;
}

/** Default AI provider for new jobs when the client does not specify. */
export function defaultAiProviderName(): StagingProviderName {
  const env = (process.env.STAGING_PROVIDER ?? "fal_flux_kontext").trim();
  if (
    env === "fal_flux_fill" ||
    env === "fal_vision_fill" ||
    env === "fal_flux_kontext" ||
    env === "texture_fill"
  ) {
    return env;
  }
  return "fal_flux_kontext";
}
