/**
 * Shared derivation for panorama variants.
 *
 * Job INPUT  = cleaned_path ?? storage_path
 * Viewer     = cleaned (if enabled) ?? storage_path
 * Then GPU max-texture-size picks full vs *_compat for the chosen variant.
 */

export type SceneVariantPaths = {
  storage_path: string;
  compat_path?: string | null;
  cleaned_path?: string | null;
  cleaned_compat_path?: string | null;
  cleaned_enabled?: boolean | null;
  /** Unused by viewer; kept for storage cleanup / optional later drop. */
  staged_path?: string | null;
  staged_compat_path?: string | null;
  staged_enabled?: boolean | null;
  width?: number | null;
};

/** Source panorama for a new AI job (builds on cleaned floor when present). */
export function resolveStagingInputPath(scene: SceneVariantPaths): string {
  if (scene.cleaned_path) return scene.cleaned_path;
  return scene.storage_path;
}

export type ResolvedVariant = {
  /** Logical variant before GPU compat selection. */
  kind: "cleaned" | "original";
  fullPath: string;
  compatPath: string | null;
};

/**
 * Pick which panorama variant the viewer should load (ignoring GPU limits).
 * Only uses a derived variant when *_enabled AND path is non-null.
 */
export function resolveViewerVariant(scene: SceneVariantPaths): ResolvedVariant {
  if (scene.cleaned_enabled && scene.cleaned_path) {
    return {
      kind: "cleaned",
      fullPath: scene.cleaned_path,
      compatPath: scene.cleaned_compat_path ?? null,
    };
  }
  return {
    kind: "original",
    fullPath: scene.storage_path,
    compatPath: scene.compat_path ?? null,
  };
}

/** True when a baked AI floor is showing — skip the client nadir overlay disc. */
export function shouldSkipNadirOverlay(scene: SceneVariantPaths): boolean {
  return Boolean(scene.cleaned_enabled && scene.cleaned_path);
}
