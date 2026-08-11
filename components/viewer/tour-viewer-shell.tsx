"use client";

import { FullscreenToggle } from "@/components/viewer/fullscreen-toggle";
import {
  FloorPlanPanel,
  resolveCurrentFloorPlan,
} from "@/components/viewer/floor-plan-panel";
import { GalleryModal } from "@/components/viewer/gallery-modal";
import {
  filterScenesForGroupKey,
  GroupSelector,
  useAutoSelectedGroupKey,
} from "@/components/viewer/group-selector";
import { GyroToggle } from "@/components/viewer/gyro-toggle";
import { PanoramaViewer } from "@/components/viewer/panorama-viewer-client";
import { SceneStrip } from "@/components/viewer/scene-strip";
import { ShareButton } from "@/components/viewer/share-button";
import { TourViewTracker } from "@/components/viewer/tour-view-tracker";
import {
  AnalyticsTracker,
  type AnalyticsTrackerApi,
} from "@/components/viewer/analytics-tracker";
import { useAutorotate } from "@/components/viewer/use-autorotate";
import { VideoModal } from "@/components/viewer/video-modal";
import { VrToggle } from "@/components/viewer/vr-toggle";
import { Button } from "@/components/ui/button";
import { resolvePanoramaPath } from "@/lib/gl-capabilities";
import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { resolveOpeningSceneId } from "@/lib/start-scene";
import { publicUrl } from "@/lib/storage";
import {
  DEFAULT_VIEWER_EFFECTS,
  isIntroEffect,
  isTransitionEffect,
  type ViewerEffectsSettings,
} from "@/lib/viewer-effects";
import type {
  FloorPlan,
  Hotspot,
  HotspotImage,
  Scene,
  SceneGroup,
  Tour,
} from "@/types";
import { MapIcon } from "lucide-react";
import type { Viewer } from "@photo-sphere-viewer/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type TourViewerShellProps = {
  tour: Tour;
  scenes: Scene[];
  groups?: SceneGroup[];
  floorPlans?: FloorPlan[];
  hotspots: Hotspot[];
  hotspotImages?: HotspotImage[];
  /** When true, record a public view (public + embed pages). */
  trackViews?: boolean;
  /** Session analytics (dwell, clicks). Default true for viewer shells. */
  trackAnalytics?: boolean;
  /** Optional top banner (owner preview). */
  banner?: ReactNode;
  /** Show share button. Default true. */
  showShare?: boolean;
  /** Show tour title/description overlay. Default true. */
  showTitle?: boolean;
  /** Show scene thumbnail strip. Default true. */
  showThumbs?: boolean;
  /** Show group selector when groups exist. Default true. */
  showGroups?: boolean;
  /** Show floor plan panel when the current scene has a plan. Default true. */
  showPlan?: boolean;
  /** Show fullscreen control. Default true. */
  showFullscreen?: boolean;
  /** Slow auto-rotate until the user interacts. Default false. */
  autorotate?: boolean;
  /**
   * Unbranded / MLS mode — hides title, share, and any Swift Tours marks.
   * Single switch; overrides showTitle/showShare.
   */
  branded?: boolean;
  /** Optional `?start=` override (must match a scene in this tour). */
  startSceneId?: string | null;
  /** Post ready/dimensions to parent (iframe embeds). */
  embedMode?: boolean;
  /** Embed/query override: allow gyroscope chrome. Default true. */
  allowGyro?: boolean;
  /** Embed/query override: allow VR chrome. Default true. */
  allowVr?: boolean;
  /** Embed/query override: allow little-planet intro. Default true. */
  allowIntro?: boolean;
  /** Increment to replay little-planet intro. */
  introReplayNonce?: number;
};

function effectsFromTour(tour: Tour): ViewerEffectsSettings {
  return {
    introEffect: isIntroEffect(tour.intro_effect)
      ? tour.intro_effect
      : DEFAULT_VIEWER_EFFECTS.introEffect,
    transition: {
      effect: isTransitionEffect(tour.transition_effect)
        ? tour.transition_effect
        : DEFAULT_VIEWER_EFFECTS.transition.effect,
      speed: tour.transition_speed ?? DEFAULT_VIEWER_EFFECTS.transition.speed,
      zoom: tour.transition_zoom ?? true,
      rotation: tour.transition_rotation ?? true,
      motionBlur: tour.transition_motion_blur ?? false,
    },
    gyroscopeEnabled: tour.gyroscope_enabled ?? true,
    vrEnabled: tour.vr_enabled ?? true,
  };
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
  groups = [],
  floorPlans = [],
  hotspots,
  hotspotImages = [],
  trackViews = false,
  trackAnalytics = true,
  banner,
  showShare = true,
  showTitle = true,
  showThumbs = true,
  showGroups = true,
  showPlan = true,
  showFullscreen = true,
  autorotate = false,
  branded = true,
  startSceneId: startSceneOverride = null,
  embedMode = false,
  allowGyro = true,
  allowVr = true,
  allowIntro = true,
  introReplayNonce = 0,
}: TourViewerShellProps) {
  const effectiveShowTitle = branded && showTitle;
  const effectiveShowShare = branded && showShare;

  const orderedScenes = useMemo(
    () => sortScenesByGroupOrder(scenes, groups),
    [scenes, groups],
  );

  const startSceneId = useMemo(
    () => resolveOpeningSceneId(tour, orderedScenes, startSceneOverride),
    [tour, orderedScenes, startSceneOverride],
  );
  // null until the viewer reports a scene — coalesce with resolved start so a
  // late-arriving `?start=` override is not frozen behind the first paint.
  const [currentSceneId, setCurrentSceneId] = useState<string | null>(null);
  const effectiveSceneId = currentSceneId ?? startSceneId ?? null;
  const [firstSceneReady, setFirstSceneReady] = useState(false);
  const [viewer, setViewer] = useState<Viewer | null>(null);
  const [galleryHotspotId, setGalleryHotspotId] = useState<string | null>(null);
  const [videoHotspotId, setVideoHotspotId] = useState<string | null>(null);
  const analyticsRef = useRef<AnalyticsTrackerApi | null>(null);

  const mediaModalOpen = galleryHotspotId != null || videoHotspotId != null;
  useAutorotate(viewer, autorotate, mediaModalOpen);

  const galleryHotspot = useMemo(
    () => hotspots.find((h) => h.id === galleryHotspotId) ?? null,
    [hotspots, galleryHotspotId],
  );
  const galleryImages = useMemo(
    () =>
      galleryHotspotId
        ? hotspotImages.filter((img) => img.hotspot_id === galleryHotspotId)
        : [],
    [hotspotImages, galleryHotspotId],
  );
  const videoHotspot = useMemo(
    () => hotspots.find((h) => h.id === videoHotspotId) ?? null,
    [hotspots, videoHotspotId],
  );

  const effects = useMemo(() => effectsFromTour(tour), [tour]);
  const defaultOpeningId = useMemo(
    () => resolveOpeningSceneId(tour, orderedScenes, null),
    [tour, orderedScenes],
  );
  // Skip intro when `?start=` lands on a scene other than the tour default.
  const runIntro =
    allowIntro &&
    effects.introEffect === "little_planet" &&
    (!startSceneOverride || startSceneOverride === defaultOpeningId);

  const currentScene =
    orderedScenes.find((s) => s.id === effectiveSceneId) ?? orderedScenes[0];
  const preloadUrl = firstSceneReady
    ? nextLikelyPanorama(effectiveSceneId, hotspots, orderedScenes)
    : null;

  const hasGroups = groups.length > 0;
  const showGroupSelector = showGroups && hasGroups && showThumbs;
  const [selectedGroupKey, setSelectedGroupKey] = useAutoSelectedGroupKey(
    groups,
    orderedScenes,
    effectiveSceneId,
  );

  const stripScenes = useMemo(() => {
    if (!hasGroups || !showGroups) return orderedScenes;
    return filterScenesForGroupKey(orderedScenes, groups, selectedGroupKey);
  }, [hasGroups, showGroups, orderedScenes, groups, selectedGroupKey]);

  const showBottomChrome =
    showThumbs &&
    (showGroupSelector ||
      (!hasGroups && orderedScenes.length > 1) ||
      (hasGroups && stripScenes.length > 0));

  const currentFloorPlan = useMemo(
    () => resolveCurrentFloorPlan(orderedScenes, floorPlans, effectiveSceneId),
    [orderedScenes, floorPlans, effectiveSceneId],
  );
  const showFloorPlanChrome = showPlan && currentFloorPlan != null;
  // Always start closed on a fresh load — do not restore localStorage.
  const [planOpen, setPlanOpen] = useState(false);

  const showTopChrome =
    effectiveShowTitle ||
    effectiveShowShare ||
    showFullscreen ||
    showFloorPlanChrome ||
    (allowGyro && effects.gyroscopeEnabled) ||
    (allowVr && effects.vrEnabled);

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

  if (orderedScenes.length === 0) {
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
      {trackAnalytics ? (
        <AnalyticsTracker
          ref={analyticsRef}
          tourId={tour.id}
          isEmbed={embedMode}
          currentSceneId={effectiveSceneId}
        />
      ) : null}

      {banner ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-20">
          <div className="pointer-events-auto">{banner}</div>
        </div>
      ) : null}

      {/* z-0 isolates PSV's internal z-index:80 loader so overlays stay clickable */}
      <div className="absolute inset-0 z-0">
        <PanoramaViewer
          scenes={orderedScenes}
          hotspots={hotspots}
          startSceneId={startSceneId}
          currentSceneId={currentSceneId ?? undefined}
          mode="view"
          className="h-full w-full"
          nadirSettings={{
            size: tour.nadir_size,
            opacity: tour.nadir_opacity,
            rotation: tour.nadir_rotation,
          }}
          viewerEffects={effects}
          runIntro={runIntro}
          introReplayNonce={introReplayNonce}
          onSceneChange={(id) => {
            setCurrentSceneId(id);
            setFirstSceneReady(true);
          }}
          onViewerReady={setViewer}
          onOpenGallery={setGalleryHotspotId}
          onOpenVideo={setVideoHotspotId}
          onHotspotActivate={(id) => {
            analyticsRef.current?.recordHotspotClick(id);
          }}
          ariaLabel={
            currentScene
              ? `360° panorama: ${currentScene.name}`
              : `360° tour: ${tour.title}`
          }
        />
      </div>

      <GalleryModal
        open={galleryHotspotId != null && galleryImages.length > 0}
        onOpenChange={(open) => {
          if (!open) setGalleryHotspotId(null);
        }}
        images={galleryImages}
        title={galleryHotspot?.label}
      />
      <VideoModal
        open={videoHotspotId != null && Boolean(videoHotspot?.video_id)}
        onOpenChange={(open) => {
          if (!open) setVideoHotspotId(null);
        }}
        videoId={videoHotspot?.video_id}
        start={videoHotspot?.video_start}
        title={videoHotspot?.label}
      />

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
              {allowGyro ? (
                <GyroToggle
                  viewer={viewer}
                  enabled={effects.gyroscopeEnabled}
                />
              ) : null}
              {allowVr ? (
                <VrToggle viewer={viewer} enabled={effects.vrEnabled} />
              ) : null}
              {showFloorPlanChrome ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="bg-black/55 text-white hover:bg-black/70 min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
                  aria-pressed={planOpen}
                  aria-label={planOpen ? "Hide floor plan" : "Show floor plan"}
                  onClick={() => {
                    setPlanOpen((prev) => !prev);
                  }}
                >
                  <MapIcon className="size-4" />
                  <span className="hidden sm:inline">Floor plan</span>
                </Button>
              ) : null}
              {effectiveShowShare ? (
                <ShareButton title={tour.title} text={tour.description} />
              ) : null}
              {showFullscreen ? <FullscreenToggle /> : null}
            </div>
          </div>
        </div>
      ) : null}

      {showFloorPlanChrome ? (
        <FloorPlanPanel
          scenes={orderedScenes}
          floorPlans={floorPlans}
          currentSceneId={effectiveSceneId}
          onSelectScene={setCurrentSceneId}
          open={planOpen}
          onOpenChange={setPlanOpen}
        />
      ) : null}

      {showBottomChrome ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent pb-3 pt-10">
          {showGroupSelector ? (
            <GroupSelector
              groups={groups}
              scenes={orderedScenes}
              selectedKey={selectedGroupKey}
              onSelect={setSelectedGroupKey}
            />
          ) : null}
          <SceneStrip
            scenes={stripScenes}
            currentSceneId={effectiveSceneId}
            onSelect={setCurrentSceneId}
            embedded
            showWhenSingle={hasGroups && showGroups}
          />
        </div>
      ) : null}
    </div>
  );
}
