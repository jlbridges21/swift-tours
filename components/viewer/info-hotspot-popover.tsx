"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import { events } from "@photo-sphere-viewer/core";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

const EDGE_PAD = 12;
const MARKER_GAP = 14;
const MAX_WIDTH = 320;
const SHEET_BREAKPOINT = 640;

export type InfoHotspotPopoverProps = {
  viewer: Viewer;
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
  onClose: () => void;
  /** Bias placement toward the left so edit-mode right panel stays clear. */
  preferLeft?: boolean;
};

type AnchorSide = "above" | "below";

type Layout = {
  mode: "anchor" | "sheet";
  visible: boolean;
  left: number;
  top: number;
  side: AnchorSide;
  arrowLeft: number;
};

function computeLayout(
  viewer: Viewer,
  yaw: number,
  pitch: number,
  popoverWidth: number,
  popoverHeight: number,
  preferLeft = false,
): Layout {
  const size = viewer.getSize();
  const sheet = size.width < SHEET_BREAKPOINT;
  const visible = viewer.dataHelper.isPointVisible({ yaw, pitch });
  const point = viewer.dataHelper.sphericalCoordsToViewerCoords({
    yaw,
    pitch,
  });

  if (sheet) {
    return {
      mode: "sheet",
      visible,
      left: 0,
      top: 0,
      side: "above",
      arrowLeft: 0,
    };
  }

  const width = Math.min(MAX_WIDTH, size.width - EDGE_PAD * 2);
  const height = popoverHeight || 120;
  const measuredWidth = popoverWidth > 0 ? Math.min(popoverWidth, width) : width;

  let side: AnchorSide = "above";
  let top = point.y - height - MARKER_GAP;
  if (top < EDGE_PAD) {
    side = "below";
    top = point.y + MARKER_GAP;
  }

  // Prefer centering on the marker; clamp into the viewer.
  let left = point.x - measuredWidth / 2;
  // In the editor, keep clear of the right hotspot panel by biasing left.
  if (preferLeft) {
    left = Math.min(left, size.width - measuredWidth - EDGE_PAD - 24);
    left = Math.min(left, point.x - measuredWidth + 40);
  }
  left = Math.max(EDGE_PAD, Math.min(left, size.width - measuredWidth - EDGE_PAD));

  // If below would overflow the bottom, try above again when there's room.
  if (side === "below" && top + height > size.height - EDGE_PAD) {
    const aboveTop = point.y - height - MARKER_GAP;
    if (aboveTop >= EDGE_PAD) {
      side = "above";
      top = aboveTop;
    } else {
      top = Math.max(EDGE_PAD, size.height - height - EDGE_PAD);
    }
  }

  const arrowLeft = Math.max(
    16,
    Math.min(point.x - left, measuredWidth - 16),
  );

  return {
    mode: "anchor",
    visible,
    left,
    top,
    side,
    arrowLeft,
  };
}

/**
 * Anchored info popover that tracks a spherical hotspot position in viewer pixels.
 * Label/content are rendered as plain text (whitespace preserved) — never as HTML.
 */
export function InfoHotspotPopover({
  viewer,
  yaw,
  pitch,
  label,
  content,
  onClose,
  preferLeft = false,
}: InfoHotspotPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef<number | null>(null);
  const [layout, setLayout] = useState<Layout>({
    mode: "anchor",
    visible: true,
    left: 0,
    top: 0,
    side: "above",
    arrowLeft: 160,
  });

  const updatePosition = () => {
    const el = panelRef.current;
    const width = el?.offsetWidth ?? MAX_WIDTH;
    const height = el?.offsetHeight ?? 120;
    setLayout(
      computeLayout(viewer, yaw, pitch, width, height, preferLeft),
    );
  };

  const scheduleUpdate = () => {
    if (rafRef.current != null) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      updatePosition();
    });
  };

  useLayoutEffect(() => {
    updatePosition();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- yaw/pitch/viewer drive layout
  }, [viewer, yaw, pitch, label, content, preferLeft]);

  useEffect(() => {
    const onPosition = () => scheduleUpdate();
    const onZoom = () => scheduleUpdate();
    const onSize = () => scheduleUpdate();

    viewer.addEventListener(events.PositionUpdatedEvent.type, onPosition);
    viewer.addEventListener(events.ZoomUpdatedEvent.type, onZoom);
    viewer.addEventListener(events.SizeUpdatedEvent.type, onSize);

    return () => {
      viewer.removeEventListener(events.PositionUpdatedEvent.type, onPosition);
      viewer.removeEventListener(events.ZoomUpdatedEvent.type, onZoom);
      viewer.removeEventListener(events.SizeUpdatedEvent.type, onSize);
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, yaw, pitch]);

  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => scheduleUpdate());
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewer, yaw, pitch, label, content, layout.mode]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  // Keep listeners mounted even while off-screen so we can reappear when visible.
  if (!layout.visible) {
    return (
      <div
        ref={panelRef}
        className="pointer-events-none invisible absolute"
        aria-hidden
      />
    );
  }

  if (layout.mode === "sheet") {
    return (
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label?.trim() || "Hotspot info"}
        className="absolute inset-x-0 bottom-0 z-[95] max-h-[45%] overflow-hidden rounded-t-xl border-t border-white/10 bg-zinc-950/95 text-white shadow-2xl backdrop-blur-md"
        onClick={(event) => event.stopPropagation()}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-start gap-2 p-4">
          <div className="min-w-0 flex-1 overflow-y-auto">
            <p className="text-sm font-semibold">
              {label?.trim() || "Info"}
            </p>
            {content?.trim() ? (
              <p className="mt-2 whitespace-pre-wrap text-sm text-white/80">
                {content}
              </p>
            ) : (
              <p className="mt-2 text-sm text-white/50">No details added.</p>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={onClose}
          >
            ×
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label={label?.trim() || "Hotspot info"}
      className={cn(
        "absolute z-[95] flex max-h-[min(40vh,280px)] w-[min(100%,320px)] flex-col overflow-hidden rounded-lg border border-white/10 bg-zinc-950/95 text-white shadow-2xl backdrop-blur-md",
      )}
      style={{ left: layout.left, top: layout.top }}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {/* Pointer arrow aimed at the marker */}
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute left-0 size-0 border-x-[7px] border-x-transparent",
          layout.side === "above"
            ? "top-full border-t-[8px] border-t-zinc-950/95"
            : "bottom-full border-b-[8px] border-b-zinc-950/95",
        )}
        style={{ transform: `translateX(${layout.arrowLeft - 7}px)` }}
      />

      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1 overflow-y-auto">
          <p className="text-sm font-semibold">{label?.trim() || "Info"}</p>
          {content?.trim() ? (
            <p className="mt-1.5 whitespace-pre-wrap text-sm text-white/80">
              {content}
            </p>
          ) : (
            <p className="mt-1.5 text-sm text-white/50">No details added.</p>
          )}
        </div>
        <button
          type="button"
          aria-label="Close"
          className="shrink-0 rounded-md px-2 py-1 text-lg leading-none text-white/70 hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          onClick={onClose}
        >
          ×
        </button>
      </div>
    </div>
  );
}
