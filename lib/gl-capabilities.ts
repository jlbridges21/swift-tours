/**
 * Probe GL_MAX_TEXTURE_SIZE once and reuse it.
 * Creates a throwaway context, reads the limit, then loses the context so we
 * do not leak live WebGL contexts (browsers cap how many can exist).
 */

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

export type ScenePanoramaSource = {
  id?: string;
  storage_path: string;
  compat_path: string | null;
  width: number | null;
};

/**
 * Choose full-res vs 4k compat based on device GPU limits.
 * If the original exceeds the limit and there is no compat file, still return
 * the full URL so the load error path can surface a failure instead of a black sphere.
 */
export function resolvePanoramaPath(
  scene: ScenePanoramaSource,
  maxTextureSize: number = getMaxTextureSize(),
): { path: string; tier: PanoramaUrlTier } {
  const width = scene.width ?? 0;
  if (width > maxTextureSize && scene.compat_path) {
    return { path: scene.compat_path, tier: "compat" };
  }
  return { path: scene.storage_path, tier: "full" };
}
