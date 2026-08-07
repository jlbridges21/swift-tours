/**
 * Little-planet intro: fisheye + nadir zoom-out, then animate to the scene view.
 * animate() cannot tween fisheye — we step it down with rAF alongside animate().
 */

import type { Viewer } from "@photo-sphere-viewer/core";

const INTRO_MS = 2500;

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

export type LittlePlanetTarget = {
  yaw: number;
  pitch: number;
  zoom: number;
};

export type LittlePlanetHandle = {
  cancel: () => void;
  done: Promise<void>;
};

/**
 * Assumes the viewer is already in little-planet pose (fisheye on, zoom 0, pitch -π/2).
 * Animates to the target view and clears fisheye.
 */
export function runLittlePlanetIntro(
  viewer: Viewer,
  target: LittlePlanetTarget,
): LittlePlanetHandle {
  let cancelled = false;
  let rafId = 0;
  let resolveDone: () => void = () => {};
  const done = new Promise<void>((resolve) => {
    resolveDone = resolve;
  });

  const finish = (jump: boolean) => {
    if (cancelled && !jump) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    void viewer.stopAnimation();
    viewer.setOption("fisheye", 0);
    if (jump) {
      viewer.rotate({ yaw: target.yaw, pitch: target.pitch });
      viewer.zoom(target.zoom);
    }
    resolveDone();
  };

  const start = performance.now();
  const fromFisheye = 1;

  const tick = (now: number) => {
    if (cancelled) return;
    const t = Math.min(1, (now - start) / INTRO_MS);
    const eased = easeInOutCubic(t);
    viewer.setOption("fisheye", fromFisheye * (1 - eased));
    if (t < 1) {
      rafId = requestAnimationFrame(tick);
    } else {
      viewer.setOption("fisheye", 0);
      resolveDone();
    }
  };

  void viewer
    .animate({
      yaw: target.yaw,
      pitch: target.pitch,
      zoom: target.zoom,
      speed: INTRO_MS,
      easing: "inOutCubic",
    })
    .then(() => {
      /* position/zoom settled; fisheye rAF may still be finishing */
    });

  rafId = requestAnimationFrame(tick);

  const onCancel = () => finish(true);
  const root = viewer.container;
  root.addEventListener("pointerdown", onCancel, { once: true });
  root.addEventListener("wheel", onCancel, { once: true, passive: true });
  window.addEventListener("keydown", onCancel, { once: true });

  return {
    cancel: () => {
      root.removeEventListener("pointerdown", onCancel);
      root.removeEventListener("wheel", onCancel);
      window.removeEventListener("keydown", onCancel);
      finish(true);
    },
    done: done.finally(() => {
      root.removeEventListener("pointerdown", onCancel);
      root.removeEventListener("wheel", onCancel);
      window.removeEventListener("keydown", onCancel);
    }),
  };
}

export function applyLittlePlanetPose(viewer: Viewer): void {
  viewer.setOption("fisheye", 1);
  viewer.zoom(0);
  viewer.rotate({ yaw: 0, pitch: -Math.PI / 2 });
}
