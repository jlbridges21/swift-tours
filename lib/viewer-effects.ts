/**
 * Tour viewer effects: intro, transitions, gyro/VR availability.
 */

export type IntroEffect = "none" | "little_planet";
export type TransitionEffect = "none" | "fade" | "black" | "white";

export const INTRO_EFFECTS: IntroEffect[] = ["none", "little_planet"];
export const TRANSITION_EFFECTS: TransitionEffect[] = [
  "none",
  "fade",
  "black",
  "white",
];

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

export function resolveTransitionOptions(
  settings: ViewerTransitionSettings,
): {
  showLoader: boolean;
  effect: "none" | "fade" | "black" | "white";
  speed: number;
  rotation: boolean;
  zoomTo?: number;
} {
  const reduced = prefersReducedMotion();
  if (reduced) {
    return {
      showLoader: true,
      effect: "fade",
      speed: 400,
      rotation: false,
    };
  }

  const effect =
    settings.effect === "none" ? "none" : settings.effect;
  return {
    showLoader: true,
    effect,
    speed: Math.min(5000, Math.max(300, settings.speed)),
    rotation: settings.rotation,
    // Zoom-through: push in toward the link before/during the crossfade.
    // Only meaningful when fromLink is present (caller gates this).
    zoomTo: settings.zoom ? 100 : undefined,
  };
}
