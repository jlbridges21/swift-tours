"use client";

/**
 * Session analytics for public / preview / embed viewers.
 * Idle (>60s) and hidden-tab time are excluded from duration and dwell.
 * Flushes send absolute totals so duplicate beacons cannot double-count.
 */

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

const VISITOR_KEY = "swift-tours:visitor-id";
const IDLE_MS = 60_000;
const FLUSH_MS = 30_000;
const MAX_DURATION_MS = 4 * 60 * 60 * 1000;

export type AnalyticsTrackerApi = {
  recordHotspotClick: (hotspotId: string) => void;
};

type AnalyticsTrackerProps = {
  tourId: string;
  isEmbed?: boolean;
  currentSceneId: string | null;
};

type PendingClick = {
  id: string;
  hotspot_id: string;
  clicked_at: string;
};

function readOrCreateVisitorId(): string {
  try {
    const existing = localStorage.getItem(VISITOR_KEY);
    if (existing && existing.length >= 8) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(VISITOR_KEY, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function clampMs(value: number): number {
  if (!Number.isFinite(value) || value < 0) return 0;
  return Math.min(MAX_DURATION_MS, Math.round(value));
}

export const AnalyticsTracker = forwardRef<
  AnalyticsTrackerApi,
  AnalyticsTrackerProps
>(function AnalyticsTracker(
  { tourId, isEmbed = false, currentSceneId },
  ref,
) {
  const sessionIdRef = useRef<string>(crypto.randomUUID());
  const visitorIdRef = useRef<string>("");
  const startedRef = useRef(false);

  const activeMsRef = useRef(0);
  const dwellRef = useRef<Map<string, number>>(new Map());
  const clicksRef = useRef<PendingClick[]>([]);
  const flushedClickIdsRef = useRef<Set<string>>(new Set());

  const sceneIdRef = useRef<string | null>(currentSceneId);
  const accumulatingRef = useRef(false);
  const tickStartedAtRef = useRef<number | null>(null);
  const lastInteractionRef = useRef(Date.now());
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useImperativeHandle(ref, () => ({
    recordHotspotClick(hotspotId: string) {
      try {
        if (!hotspotId) return;
        noteInteraction();
        clicksRef.current.push({
          id: crypto.randomUUID(),
          hotspot_id: hotspotId,
          clicked_at: new Date().toISOString(),
        });
      } catch {
        // Analytics must never break the viewer.
      }
    },
  }));

  function stopTick() {
    if (tickStartedAtRef.current != null) {
      const delta = Date.now() - tickStartedAtRef.current;
      activeMsRef.current += delta;
      const scene = sceneIdRef.current;
      if (scene) {
        dwellRef.current.set(
          scene,
          (dwellRef.current.get(scene) ?? 0) + delta,
        );
      }
      tickStartedAtRef.current = null;
    }
    accumulatingRef.current = false;
  }

  function startTick() {
    if (typeof document !== "undefined" && document.visibilityState === "hidden") {
      return;
    }
    if (accumulatingRef.current) return;
    accumulatingRef.current = true;
    tickStartedAtRef.current = Date.now();
  }

  function noteInteraction() {
    lastInteractionRef.current = Date.now();
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    idleTimerRef.current = setTimeout(() => {
      stopTick();
    }, IDLE_MS);
    startTick();
  }

  function buildPayload() {
    const wasAccumulating = accumulatingRef.current;
    stopTick();

    const clicks = clicksRef.current.filter(
      (c) => !flushedClickIdsRef.current.has(c.id),
    );

    const payload = {
      session_id: sessionIdRef.current,
      tour_id: tourId,
      visitor_id: visitorIdRef.current,
      is_embed: isEmbed,
      duration_ms: clampMs(activeMsRef.current),
      dwell: Array.from(dwellRef.current.entries()).map(([scene_id, dwell_ms]) => ({
        scene_id,
        dwell_ms: clampMs(dwell_ms),
      })),
      clicks,
    };

    // Resume the active window if we were still interactive and visible.
    if (
      wasAccumulating &&
      typeof document !== "undefined" &&
      document.visibilityState !== "hidden" &&
      Date.now() - lastInteractionRef.current < IDLE_MS
    ) {
      startTick();
    }

    return payload;
  }

  function markClicksFlushed(clicks: PendingClick[]) {
    for (const c of clicks) flushedClickIdsRef.current.add(c.id);
  }

  async function flush(useBeacon: boolean) {
    try {
      if (!startedRef.current || !visitorIdRef.current) return;
      const payload = buildPayload();
      const body = JSON.stringify(payload);

      if (useBeacon && typeof navigator !== "undefined" && navigator.sendBeacon) {
        const blob = new Blob([body], { type: "application/json" });
        const ok = navigator.sendBeacon("/api/analytics", blob);
        if (ok) markClicksFlushed(payload.clicks);
        return;
      }

      const res = await fetch("/api/analytics", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
      if (res.ok) markClicksFlushed(payload.clicks);
    } catch {
      // Swallow — analytics never breaks the viewer.
    }
  }

  useEffect(() => {
    sceneIdRef.current = currentSceneId;
  }, [currentSceneId]);

  useEffect(() => {
    let cancelled = false;
    let flushInterval: ReturnType<typeof setInterval> | null = null;

    try {
      visitorIdRef.current = readOrCreateVisitorId();
      sessionIdRef.current = crypto.randomUUID();

      void (async () => {
        try {
          const res = await fetch("/api/analytics", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              session_id: sessionIdRef.current,
              tour_id: tourId,
              visitor_id: visitorIdRef.current,
              is_embed: isEmbed,
              duration_ms: 0,
              dwell: [],
              clicks: [],
            }),
          });
          if (!cancelled && res.ok) {
            startedRef.current = true;
            noteInteraction();
          }
        } catch {
          // ignore
        }
      })();

      const onVisibility = () => {
        try {
          if (document.visibilityState === "hidden") {
            stopTick();
            void flush(true);
          } else {
            noteInteraction();
          }
        } catch {
          // ignore
        }
      };

      const onPageHide = () => {
        try {
          void flush(true);
        } catch {
          // ignore
        }
      };

      const onInteract = () => {
        try {
          noteInteraction();
        } catch {
          // ignore
        }
      };

      document.addEventListener("visibilitychange", onVisibility);
      window.addEventListener("pagehide", onPageHide);
      window.addEventListener("pointerdown", onInteract, { passive: true });
      window.addEventListener("keydown", onInteract);
      window.addEventListener("wheel", onInteract, { passive: true });
      window.addEventListener("touchstart", onInteract, { passive: true });

      flushInterval = setInterval(() => {
        void flush(false);
      }, FLUSH_MS);

      noteInteraction();

      return () => {
        cancelled = true;
        if (flushInterval) clearInterval(flushInterval);
        if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
        document.removeEventListener("visibilitychange", onVisibility);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("pointerdown", onInteract);
        window.removeEventListener("keydown", onInteract);
        window.removeEventListener("wheel", onInteract);
        window.removeEventListener("touchstart", onInteract);
        void flush(true);
      };
    } catch {
      return () => {
        cancelled = true;
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount once per tour
  }, [tourId, isEmbed]);

  return null;
});
