/**
 * Probe GL_MAX_TEXTURE_SIZE once and reuse it.
 * Creates a throwaway context, reads the limit, then loses the context so we
 * do not leak live WebGL contexts (browsers cap how many can exist).
 */

import {
  resolveViewerVariant,
  type SceneVariantPaths,
} from "@/lib/staging/variant-paths";

const FALLBACK_MAX_TEXTURE_SIZE = 4096;

let memoized: number | null = null;

export function getMaxTextureSize(): number {
  if (memoized != null) return memoized;

  if (typeof document === "undefined") {
    memoized = FALLBACK_MAX_TEXTURE_SIZE;
    return memoized;
  }

  try {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const gl =
      (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ||
      (canvas.getContext("webgl") as WebGLRenderingContext | null);

    if (!gl) {
      memoized = FALLBACK_MAX_TEXTURE_SIZE;
      return memoized;
    }

    const size = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    memoized =
      typeof size === "number" && Number.isFinite(size) && size > 0
        ? size
        : FALLBACK_MAX_TEXTURE_SIZE;

    const lose = gl.getExtension("WEBGL_lose_context");
    lose?.loseContext();

    return memoized;
  } catch {
    memoized = FALLBACK_MAX_TEXTURE_SIZE;
    return memoized;
  }
}

export type PanoramaUrlTier = "full" | "compat";

export type ScenePanoramaSource = SceneVariantPaths & {
  id?: string;
  width: number | null;
};

/**
 * Choose which variant to show (cleaned → original), then full-res
 * vs 4k compat based on device GPU limits.
 *
 * CRITICAL: Call this synchronously when building VirtualTour nodes — never
 * hot-swap the panorama URL after setNodes(nodes, startId).
 */
export function resolvePanoramaPath(
  scene: ScenePanoramaSource,
  maxTextureSize: number = getMaxTextureSize(),
): { path: string; tier: PanoramaUrlTier; variant: "cleaned" | "original" } {
  const variant = resolveViewerVariant(scene);
  const width = scene.width ?? 0;
  if (width > maxTextureSize && variant.compatPath) {
    return {
      path: variant.compatPath,
      tier: "compat",
      variant: variant.kind,
    };
  }
  return {
    path: variant.fullPath,
    tier: "full",
    variant: variant.kind,
  };
}
