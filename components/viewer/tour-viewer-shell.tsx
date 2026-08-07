"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { FullscreenToggle } from "@/components/viewer/fullscreen-toggle";
import { PanoramaViewer } from "@/components/viewer/panorama-viewer-client";
import { SceneStrip } from "@/components/viewer/scene-strip";
import { ShareButton } from "@/components/viewer/share-button";
import { TourViewTracker } from "@/components/viewer/tour-view-tracker";
import { useAutorotate } from "@/components/viewer/use-autorotate";
import { resolvePanoramaPath } from "@/lib/gl-capabilities";
import { publicUrl } from "@/lib/storage";
import type { Hotspot, Scene, Tour } from "@/types";

export type TourViewerShellProps = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
  /** When true, record a public view (public + embed pages). */
  trackViews?: boolean;
  /** Optional top banner (owner preview). */
  banner?: ReactNode;
  /** Show share button. Default true. */
  showShare?: boolean;
  /** Show tour title/description overlay. Default true. */
  showTitle?: boolean;
  /** Show scene thumbnail strip. Default true. */
  showThumbs?: boolean;
  /** Show fullscreen control. Default true. */
  showFullscreen?: boolean;
  /** Slow auto-rotate until the user interacts. Default false. */
  autorotate?: boolean;
  /**
   * Unbranded / MLS mode — hides title, share, and any Swift Tours marks.
   * Single switch; overrides showTitle/showShare.
   */
  branded?: boolean;
  /** Override cover scene for initial view. */
  startSceneId?: string | null;
  /** Post ready/dimensions to parent (iframe embeds). */
  embedMode?: boolean;
};

function resolveStartSceneId(
  tour: Tour,
  scenes: Scene[],
  override?: string | null,
): string | undefined {
  if (override && scenes.some((scene) => scene.id === override)) {
    return override;
  }
  if (tour.cover_scene_id) {
    const cover = scenes.find((s) => s.id === tour.cover_scene_id);
    if (cover) return cover.id;
  }
  return scenes[0]?.id;
}

function nextLikelyPanorama(
  currentSceneId: string | null,
  hotspots: Hotspot[],
  scenes: Scene[],
): string | null {
  if (!currentSceneId) return null;
  const firstLink = hotspots.find(
    (h) =>
      h.scene_id === currentSceneId &&
      h.type === "link" &&
      h.target_scene_id,
  );
  if (!firstLink?.target_scene_id) return null;
  const target = scenes.find((s) => s.id === firstLink.target_scene_id);
  if (!target) return null;
  const { path } = resolvePanoramaPath(target);
  return publicUrl(path);
}

function postEmbedMessage(payload: Record<string, unknown>) {
  try {
    if (typeof window === "undefined" || window.parent === window) return;
    window.parent.postMessage(
      { source: "swift-tours", ...payload },
      "*",
    );
  } catch {
    // Cross-origin parent may reject — ignore.
  }
}

export function TourViewerShell({
  tour,
  scenes,
  hotspots,
  trackViews = false,
  banner,
  showShare = true,
  showTitle = true,
  showThumbs = true,
  showFullscreen = true,
  autorotate = false,
  branded = true,
  startSceneId: startSceneOverride = null,
  embedMode = false,
}: TourViewerShellProps) {
  const effectiveShowTitle = branded && showTitle;
  const effectiveShowShare = branded && showShare;

  const startSceneId = useMemo(
    () => resolveStartSceneId(tour, scenes, startSceneOverride),
    [tour, scenes, startSceneOverride],
  );
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(
    startSceneId ?? null,
  );
  const [firstSceneReady, setFirstSceneReady] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);

  useAutorotate(viewer, autorotate);

  const currentScene = scenes.find((s) => s.id === currentSceneId) ?? scenes[0];
  const preloadUrl = firstSceneReady
    ? nextLikelyPanorama(currentSceneId, hotspots, scenes)
    : null;

  const showTopChrome =
    effectiveShowTitle || effectiveShowShare || showFullscreen;

  useEffect(() => {
    if (!preloadUrl) return;
    const link = document.createElement("link");
    link.rel = "preload";
    link.as = "image";
    link.href = preloadUrl;
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [preloadUrl]);

  useEffect(() => {
    if (!embedMode) return;

    const publish = () => {
      postEmbedMessage({
        type: "ready",
        height: Math.round(
          document.documentElement.clientHeight || window.innerHeight || 450,
        ),
        width: Math.round(
          document.documentElement.clientWidth || window.innerWidth || 800,
        ),
      });
    };

    publish();
    window.addEventListener("resize", publish);
    return () => window.removeEventListener("resize", publish);
  }, [embedMode]);

  if (scenes.length === 0) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 bg-neutral-950 px-6 text-center text-white">
        <p className="text-lg font-medium tracking-tight">
          This tour has no scenes yet
        </p>
        <p className="max-w-sm text-sm text-white/65">
          The owner still needs to upload panoramas before there&apos;s anything
          to explore.
        </p>
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

      {/* z-0 isolates PSV's internal z-index:80 loader so overlays stay clickable */}
      <div className="absolute inset-0 z-0">
        <PanoramaViewer
          scenes={scenes}
          hotspots={hotspots}
          startSceneId={startSceneId}
          currentSceneId={currentSceneId ?? undefined}
          mode="view"
          className="h-full w-full"
          onSceneChange={(id) => {
            setCurrentSceneId(id);
            setFirstSceneReady(true);
          }}
          onViewerReady={setViewer}
          ariaLabel={
            currentScene
              ? `360° panorama: ${currentScene.name}`
              : `360° tour: ${tour.title}`
          }
        />
      </div>

      {showTopChrome ? (
        <div
          className={`pointer-events-none absolute inset-x-0 z-10 bg-gradient-to-b from-black/65 via-black/25 to-transparent px-4 pb-16 pt-4 ${
            banner ? "top-10" : "top-0"
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            {effectiveShowTitle ? (
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
            ) : (
              <div />
            )}

            <div className="pointer-events-auto flex shrink-0 items-center gap-2">
              {effectiveShowShare ? (
                <ShareButton title={tour.title} text={tour.description} />
              ) : null}
              {showFullscreen ? <FullscreenToggle /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showThumbs ? (
        <SceneStrip
          scenes={scenes}
          currentSceneId={currentSceneId}
          onSelect={setCurrentSceneId}
        />
      ) : null}
    </div>
  );
}
