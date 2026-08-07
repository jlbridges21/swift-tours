/**
 * Hotspot placement modes: 2D billboard, floor plane, wall plane.
 * Floor/wall use MarkersPlugin `elementLayer` (CSS3D) so SVG shapes render in 3D.
 */

export const HOTSPOT_POSITION_MODES = ["2d", "floor", "wall"] as const;
export type HotspotPositionMode = (typeof HOTSPOT_POSITION_MODES)[number];

export function isHotspotPositionMode(
  value: string | null | undefined,
): value is HotspotPositionMode {
  return (
    value === "2d" || value === "floor" || value === "wall"
  );
}

export function resolvePositionMode(
  value: string | null | undefined,
): HotspotPositionMode {
  return isHotspotPositionMode(value) ? value : "2d";
}

export function clampStyleRotation(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  const wrapped = ((value % 360) + 360) % 360;
  return wrapped;
}

/** Orient offsets are small radians; clamp to ±π to avoid wild spins. */
export function clampOrientRadians(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(Math.PI, Math.max(-Math.PI, value));
}

/**
 * CSS3D elementLayer rotation after lookAt(center).
 * Floor: pitch ≈ π/2 lays the plane flat; wall uses lookAt facing + fine-tune.
 */
export function planeRotationForMode(
  mode: HotspotPositionMode,
  styleRotationDeg: number,
  orientYaw: number,
  orientPitch: number,
): { yaw: number; pitch: number; roll: number } {
  const roll = (clampStyleRotation(styleRotationDeg) * Math.PI) / 180;
  const yaw = clampOrientRadians(orientYaw);
  const pitchOff = clampOrientRadians(orientPitch);

  if (mode === "floor") {
    return {
      yaw,
      pitch: Math.PI / 2 + pitchOff,
      roll,
    };
  }

  // wall (and unused for 2d)
  return {
    yaw,
    pitch: pitchOff,
    roll,
  };
}

/** Build / refresh a DOM element for elementLayer markers. */
export function upsertHotspotLayerElement(
  cache: Map<string, HTMLElement>,
  hotspotId: string,
  html: string,
): HTMLElement {
  let el = cache.get(hotspotId);
  if (!el) {
    el = document.createElement("div");
    el.className = "st-hotspot-layer";
    el.style.display = "block";
    el.style.pointerEvents = "auto";
    el.style.cursor = "pointer";
    cache.set(hotspotId, el);
  }
  el.innerHTML = html;
  return el;
}
