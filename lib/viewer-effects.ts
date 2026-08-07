/**
 * Tour viewer effects: intro, transitions, gyro/VR availability.
 */

export type IntroEffect = "none" | "little_planet";
export type TransitionEffect = "none" | "fade" | "black" | "white" | "zoom";

export const INTRO_EFFECTS: IntroEffect[] = ["none", "little_planet"];
export const TRANSITION_EFFECTS: TransitionEffect[] = [
  "none",
  "fade",
  "black",
  "white",
  "zoom",
];

/** Peak zoom level during the zoom (walk-in) preset — strong push without clipping at 100. */
export const ZOOM_WALK_IN_LEVEL = 90;

export function isIntroEffect(value: string): value is IntroEffect {
  return (INTRO_EFFECTS as string[]).includes(value);
}

export function isTransitionEffect(value: string): value is TransitionEffect {
  return (TRANSITION_EFFECTS as string[]).includes(value);
}

export type ViewerTransitionSettings = {
  effect: TransitionEffect;
  speed: number;
  zoom: boolean;
  rotation: boolean;
  /** CSS motion blur during link (hotspot) transitions. */
  motionBlur: boolean;
};

export type ViewerEffectsSettings = {
  introEffect: IntroEffect;
  transition: ViewerTransitionSettings;
  /** Keep heading consistent via return-hotspot reciprocity on link nav. */
  walkthroughEnabled: boolean;
  gyroscopeEnabled: boolean;
  vrEnabled: boolean;
};

export const DEFAULT_VIEWER_EFFECTS: ViewerEffectsSettings = {
  introEffect: "none",
  transition: {
    effect: "fade",
    speed: 1500,
    zoom: true,
    rotation: true,
    motionBlur: false,
  },
  walkthroughEnabled: false,
  gyroscopeEnabled: true,
  vrEnabled: true,
};

export function prefersReducedMotion(): boolean {
  if (typeof window === "undefined") return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Touch + DeviceOrientation — gyro/VR chrome only belongs on phones. */
export function isTouchOrientationDevice(): boolean {
  if (typeof window === "undefined") return false;
  const touch =
    "ontouchstart" in window ||
    (typeof navigator !== "undefined" && navigator.maxTouchPoints > 0);
  const orientation = "DeviceOrientationEvent" in window;
  return touch && orientation;
}

export type ResolvedTransitionOptions = {
  showLoader: boolean;
  /** PSV-supported effect (zoom preset maps to fade). */
  effect: "none" | "fade" | "black" | "white";
  speed: number;
  rotation: boolean;
  zoomTo?: number;
  /** True when the tour transition_effect is the zoom walk-in preset. */
  isZoomWalkIn: boolean;
  /** Force CSS motion blur for this transition. */
  forceMotionBlur: boolean;
};

export function resolveTransitionOptions(
  settings: ViewerTransitionSettings,
): ResolvedTransitionOptions {
  const reduced = prefersReducedMotion();
  const isZoomWalkIn = settings.effect === "zoom";

  if (reduced) {
    return {
      showLoader: true,
      effect: "fade",
      speed: isZoomWalkIn ? 500 : 400,
      rotation: false,
      isZoomWalkIn: false,
      forceMotionBlur: false,
    };
  }

  if (isZoomWalkIn) {
    return {
      showLoader: true,
      effect: "fade",
      speed: Math.min(5000, Math.max(300, settings.speed)),
      rotation: true,
      zoomTo: ZOOM_WALK_IN_LEVEL,
      isZoomWalkIn: true,
      forceMotionBlur: true,
    };
  }

  const effect: "none" | "fade" | "black" | "white" =
    settings.effect === "none"
      ? "none"
      : settings.effect === "black"
        ? "black"
        : settings.effect === "white"
          ? "white"
          : "fade";

  return {
    showLoader: true,
    effect,
    speed: Math.min(5000, Math.max(300, settings.speed)),
    rotation: settings.rotation,
    zoomTo: settings.zoom ? 100 : undefined,
    isZoomWalkIn: false,
    forceMotionBlur: false,
  };
}

/** Normalize yaw to (-π, π]. */
export function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  let value = yaw % twoPi;
  if (value <= -Math.PI) value += twoPi;
  if (value > Math.PI) value -= twoPi;
  return value;
}

/**
 * Walkthrough arrival yaw: face forward out of the return doorway
 * (return hotspot yaw + π). Pitch stays level (0).
 */
export function walkthroughArrivalYaw(returnHotspotYaw: number): number {
  return normalizeYaw(returnHotspotYaw + Math.PI);
}
