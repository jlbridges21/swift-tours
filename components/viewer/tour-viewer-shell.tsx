"use client";

import { useMemo, useState, type ReactNode } from "react";

import { FullscreenToggle } from "@/components/viewer/fullscreen-toggle";
import { PanoramaViewer } from "@/components/viewer/panorama-viewer-client";
import { SceneStrip } from "@/components/viewer/scene-strip";
import { ShareButton } from "@/components/viewer/share-button";
import { TourViewTracker } from "@/components/viewer/tour-view-tracker";
import type { Hotspot, Scene, Tour } from "@/types";

export type TourViewerShellProps = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
  /** When true, record a public view (public page only). */
  trackViews?: boolean;
  /** Optional top banner (owner preview). */
  banner?: ReactNode;
  /** Show share button (public page). */
  showShare?: boolean;
};

function resolveStartSceneId(tour: Tour, scenes: Scene[]): string | undefined {
  if (tour.cover_scene_id) {
    const cover = scenes.find((s) => s.id === tour.cover_scene_id);
    if (cover) return cover.id;
  }
  return scenes[0]?.id;
}

export function TourViewerShell({
  tour,
  scenes,
  hotspots,
  trackViews = false,
  banner,
  showShare = true,
}: TourViewerShellProps) {
  const startSceneId = useMemo(
    () => resolveStartSceneId(tour, scenes),
    [tour, scenes],
  );
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(
    startSceneId ?? null,
  );

  if (scenes.length === 0) {
    return (
      <div className="flex h-dvh items-center justify-center bg-neutral-950 text-white">
        <p className="text-sm text-white/70">This tour has no scenes yet.</p>
      </div>
    );
  }

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-black">
      {trackViews ? <TourViewTracker tourId={tour.id} /> : null}

      {banner ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
          <div className="pointer-events-auto">{banner}</div>
        </div>
      ) : null}

      <div className="absolute inset-0">
        <PanoramaViewer
          scenes={scenes}
          hotspots={hotspots}
          startSceneId={startSceneId}
          currentSceneId={currentSceneId ?? undefined}
          mode="view"
          className="h-full w-full"
          onSceneChange={setCurrentSceneId}
        />
      </div>

      {/* Top overlay — pointer-events none on container so drag passes through */}
      <div
        className={`pointer-events-none absolute inset-x-0 z-10 bg-gradient-to-b from-black/65 via-black/25 to-transparent px-4 pb-16 pt-4 ${
          banner ? "top-10" : "top-0"
        }`}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 max-w-xl text-white drop-shadow-sm">
            <h1 className="truncate text-lg font-semibold tracking-tight sm:text-xl">
              {tour.title}
            </h1>
            {tour.description ? (
              <p className="mt-0.5 line-clamp-2 text-sm text-white/85">
                {tour.description}
              </p>
            ) : null}
          </div>

          <div className="pointer-events-auto flex shrink-0 items-center gap-2">
            {showShare ? (
              <ShareButton title={tour.title} text={tour.description} />
            ) : null}
            <FullscreenToggle />
          </div>
        </div>
      </div>

      <SceneStrip
        scenes={scenes}
        currentSceneId={currentSceneId}
        onSelect={setCurrentSceneId}
      />
    </div>
  );
}
