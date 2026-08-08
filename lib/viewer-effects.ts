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

/**
 * PSV zoom levels: 0 = widest FOV (maxFov), 100 = tightest (minFov).
 * Confirmed against Viewer.zoom() / defaultZoomLvl / little-planet using 0.
 */
/** Outgoing push peak — camera drives into the hotspot. */
export const ZOOM_WALK_IN_PUSH = 90;
/** Arrival start — wider than default so the new room feels like stepping in. */
export const ZOOM_ARRIVAL_START = 25;
/** Settled viewing level (matches Viewer defaultZoomLvl for normal tours). */
export const ZOOM_DEFAULT = 50;

/** @deprecated Use ZOOM_WALK_IN_PUSH — kept for any external imports. */
export const ZOOM_WALK_IN_LEVEL = ZOOM_WALK_IN_PUSH;

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
    // Zoom levels are owned by the click handler (push + arrival settle).
    // Do not pass zoomTo here — PSV would animate from the push peak and
    // invert the arrival (zoomed-in → out).
    return {
      showLoader: false,
      effect: "fade",
      speed: Math.min(5000, Math.max(300, settings.speed)),
      rotation: true,
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

export function easeOutCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return 1 - Math.pow(1 - x, 3);
}

export function easeInCubic(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * x;
}
