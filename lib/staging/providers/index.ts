import "server-only";

import { falFluxFillProvider } from "@/lib/staging/providers/fal-flux-fill";
import type { StagingProvider } from "@/lib/staging/providers/types";

/**
 * Resolve the staging provider from STAGING_PROVIDER.
 * Server-only — never import from Client Components.
 */
export function getStagingProvider(): StagingProvider {
  const name = (process.env.STAGING_PROVIDER ?? "fal_flux_fill").trim();

  switch (name) {
    case "fal_flux_fill": {
      if (!process.env.FAL_KEY?.trim()) {
        throw new Error(
          "STAGING_PROVIDER is fal_flux_fill but FAL_KEY is missing.",
        );
      }
      return falFluxFillProvider;
    }
    default:
      throw new Error(
        `Unknown STAGING_PROVIDER “${name}”. Supported: fal_flux_fill.`,
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
