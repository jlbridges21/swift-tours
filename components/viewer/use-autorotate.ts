"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import { useEffect, useRef } from "react";

const YAW_PER_MS = 0.00012; // ~0.4 rpm — slow until the user interacts

/**
 * Slow panorama autorotate without touching Viewer construction.
 * Stops permanently on the first user interaction with the viewer.
 * While `paused` is true (e.g. media modal open), rotation is suspended.
 */
export function useAutorotate(
  viewer: Viewer | null,
  enabled: boolean,
  paused = false,
) {
  const stoppedRef = useRef(false);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  useEffect(() => {
    if (!viewer || !enabled) return;

    stoppedRef.current = false;
    let rafId = 0;
    let last = performance.now();

    const stop = () => {
      stoppedRef.current = true;
      if (rafId) cancelAnimationFrame(rafId);
    };

    const tick = (now: number) => {
      if (stoppedRef.current) return;
      const dt = Math.min(64, now - last);
      last = now;
      if (!pausedRef.current) {
        try {
          const pos = viewer.getPosition();
          viewer.rotate({ yaw: pos.yaw + YAW_PER_MS * dt, pitch: pos.pitch });
        } catch {
          stop();
          return;
        }
      }
      rafId = requestAnimationFrame(tick);
    };

    const container = viewer.container;
    const onInteract = () => stop();
    container.addEventListener("pointerdown", onInteract, { passive: true });
    container.addEventListener("wheel", onInteract, { passive: true });
    container.addEventListener("touchstart", onInteract, { passive: true });
    window.addEventListener("keydown", onInteract);

    rafId = requestAnimationFrame(tick);

    return () => {
      stop();
      container.removeEventListener("pointerdown", onInteract);
      container.removeEventListener("wheel", onInteract);
      container.removeEventListener("touchstart", onInteract);
      window.removeEventListener("keydown", onInteract);
    };
  }, [viewer, enabled]);
}
