/**
 * Per-scene brightness / contrast / saturation.
 * Applied as a CSS `filter` on the PSV WebGL canvas at render time —
 * never re-encoded into the panorama file.
 *
 * Note: the nadir patch is a 3D `imageLayer` inside the canvas, so it receives
 * the same filter as the panorama. That keeps the blurred floor matching the
 * scene; a logo cap will also be adjusted. Acceptable trade-off.
 */

export type SceneAdjustments = {
  adjust_brightness: number;
  adjust_contrast: number;
  adjust_saturation: number;
};

export const DEFAULT_ADJUSTMENTS: SceneAdjustments = {
  adjust_brightness: 1,
  adjust_contrast: 1,
  adjust_saturation: 1,
};

const BRIGHTNESS_MIN = 0.5;
const BRIGHTNESS_MAX = 1.5;
const CONTRAST_MIN = 0.5;
const CONTRAST_MAX = 1.5;
const SATURATION_MIN = 0;
const SATURATION_MAX = 2;

function nearDefault(value: number, expected: number): boolean {
  return Math.abs(value - expected) < 0.0005;
}

export function clampBrightness(value: number): number {
  return Math.min(BRIGHTNESS_MAX, Math.max(BRIGHTNESS_MIN, value));
}

export function clampContrast(value: number): number {
  return Math.min(CONTRAST_MAX, Math.max(CONTRAST_MIN, value));
}

export function clampSaturation(value: number): number {
  return Math.min(SATURATION_MAX, Math.max(SATURATION_MIN, value));
}

export function normalizeAdjustments(
  input: Partial<SceneAdjustments> | null | undefined,
): SceneAdjustments {
  return {
    adjust_brightness: clampBrightness(
      input?.adjust_brightness ?? DEFAULT_ADJUSTMENTS.adjust_brightness,
    ),
    adjust_contrast: clampContrast(
      input?.adjust_contrast ?? DEFAULT_ADJUSTMENTS.adjust_contrast,
    ),
    adjust_saturation: clampSaturation(
      input?.adjust_saturation ?? DEFAULT_ADJUSTMENTS.adjust_saturation,
    ),
  };
}

export function isDefaultAdjustments(scene: Partial<SceneAdjustments>): boolean {
  const n = normalizeAdjustments(scene);
  return (
    nearDefault(n.adjust_brightness, 1) &&
    nearDefault(n.adjust_contrast, 1) &&
    nearDefault(n.adjust_saturation, 1)
  );
}

/**
 * CSS filter string for a scene. Empty when all values are defaults so the
 * filter property can be left unset in the common case.
 */
export function adjustmentFilter(
  scene: Partial<SceneAdjustments> | null | undefined,
): string {
  const n = normalizeAdjustments(scene);
  if (isDefaultAdjustments(n)) return "";
  return `brightness(${n.adjust_brightness}) contrast(${n.adjust_contrast}) saturate(${n.adjust_saturation})`;
}

/** PSV WebGL canvas — markers live in a sibling DOM layer outside this element. */
export const PSV_CANVAS_SELECTOR = ".psv-canvas";
