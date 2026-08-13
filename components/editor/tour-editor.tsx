"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  clearSceneInitialView,
  createHotspot,
  setTourCoverAndStartScene,
  updateHotspot,
  updateSceneInitialView,
  updateTourTitle,
} from "@/app/dashboard/tours/[id]/actions";
import { AdjustmentsPanel } from "@/components/editor/adjustments-panel";
import {
  EffectsPanel,
  effectsFieldsFromTour,
  viewerEffectsFromFields,
  type TourEffectsFields,
} from "@/components/editor/effects-panel";
import { FloorPlanEditor } from "@/components/editor/floor-plan-editor";
import { HotspotPanel } from "@/components/editor/hotspot-panel";
import {
  HotspotToolbar,
  placingBannerText,
  useAutoReturnLinkPreference,
  type PlaceableHotspotType,
} from "@/components/editor/hotspot-toolbar";
import {
  NadirSettings,
  type EditorScene,
  type NadirTourFields,
} from "@/components/editor/nadir-settings";
import { SceneSidebar } from "@/components/editor/scene-sidebar";
import {
  SaveStatusIndicator,
  SaveStatusProvider,
  useSaveStatus,
} from "@/components/editor/save-status";
import { EmbedDialog } from "@/components/tours/embed-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { GalleryModal } from "@/components/viewer/gallery-modal";
import {
  PanoramaViewer,
  type PanoramaClickPayload,
} from "@/components/viewer/panorama-viewer-client";
import { VideoModal } from "@/components/viewer/video-modal";
import {
  DEFAULT_ANIMATION,
  DEFAULT_GALLERY_SHAPE,
  DEFAULT_INFO_SHAPE,
  DEFAULT_LABEL_VISIBILITY,
  DEFAULT_SIZE,
  DEFAULT_VIDEO_SHAPE,
  isHotspotShape,
  sanitizeHotspotColor,
} from "@/lib/hotspot-styles";
import { isNadirMarkerId } from "@/lib/nadir";
import { sortScenesByGroupOrder } from "@/lib/scene-groups";
import { resolveOpeningSceneId } from "@/lib/start-scene";
import { cn } from "@/lib/utils";
import type {
  FloorPlan,
  Hotspot,
  HotspotImage,
  Scene,
  SceneGroup,
  Tour,
} from "@/types";

type TourEditorProps = {
  tour: Tour;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  hotspots: Hotspot[];
  hotspotImages: HotspotImage[];
  userId: string;
  stagingEnabled?: boolean;
};

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  return ((yaw % twoPi) + twoPi) % twoPi;
}

function reciprocalYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return Boolean(
    target.closest("input, textarea, select, [contenteditable=true]"),
  );
}

function resolveOpeningSceneIdFromInitial(
  tour: Tour,
  scenes: Scene[],
  groups: SceneGroup[],
): string | null {
  const ordered = sortScenesByGroupOrder(scenes, groups);
  return resolveOpeningSceneId(tour, ordered) ?? null;
}

export function TourEditor(props: TourEditorProps) {
  return (
    <SaveStatusProvider>
      <TourEditorInner {...props} />
    </SaveStatusProvider>
  );
}

function TourEditorInner({
  tour,
  scenes: initialScenes,
  groups: initialGroups,
  floorPlans: initialFloorPlans,
  hotspots: initialHotspots,
  hotspotImages: initialHotspotImages,
  userId,
  stagingEnabled = false,
}: TourEditorProps) {
  const router = useRouter();
  const { run, status } = useSaveStatus();
  const viewerRef = useRef<Viewer | null>(null);

  const [scenes, setScenes] = useState<EditorScene[]>(initialScenes);
  const [groups, setGroups] = useState(initialGroups);
  const [floorPlans, setFloorPlans] = useState(initialFloorPlans);
  const [hotspots, setHotspots] = useState(initialHotspots);
  const [hotspotImages, setHotspotImages] = useState(initialHotspotImages);
  const [title, setTitle] = useState(tour.title);
  /** Optimistic override after "Set as cover image / start scene". */
  const [coverStartOverride, setCoverStartOverride] = useState<string | null>(
    null,
  );
  const coverSceneId = coverStartOverride ?? tour.cover_scene_id;
  const startSceneId =
    coverStartOverride !== null ? coverStartOverride : tour.start_scene_id;
  const [nadir, setNadir] = useState<NadirTourFields>({
    nadir_type: tour.nadir_type,
    nadir_logo_path: tour.nadir_logo_path,
    nadir_logo_source:
      tour.nadir_logo_source ??
      (tour.nadir_logo_path ? "custom" : "default"),
    nadir_size: tour.nadir_size,
    nadir_opacity: tour.nadir_opacity,
    nadir_rotation: tour.nadir_rotation,
    nadir_feather: tour.nadir_feather ?? 0.35,
  });
  const [effects, setEffects] = useState<TourEffectsFields>(() =>
    effectsFieldsFromTour(tour),
  );
  const [introReplayNonce, setIntroReplayNonce] = useState(0);
  const [rightPanel, setRightPanel] = useState<
    "hotspots" | "nadir" | "adjustments" | "floorplan" | "effects"
  >("hotspots");
  const [adjustmentsBypassed, setAdjustmentsBypassed] = useState(false);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(() =>
    resolveOpeningSceneIdFromInitial(tour, initialScenes, initialGroups),
  );
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(
    null,
  );
  const [placingType, setPlacingType] = useState<PlaceableHotspotType | null>(
    null,
  );
  const [autoReturnLink, setAutoReturnLink] = useAutoReturnLinkPreference();
  const [embedOpen, setEmbedOpen] = useState(false);
  const [infoPopoverOpen, setInfoPopoverOpen] = useState(false);
  const [closeInfoPopoverNonce, setCloseInfoPopoverNonce] = useState(0);
  const [galleryPreviewId, setGalleryPreviewId] = useState<string | null>(null);
  const [videoPreviewId, setVideoPreviewId] = useState<string | null>(null);

  useEffect(() => {
    setScenes(initialScenes);
  }, [initialScenes]);

  useEffect(() => {
    setGroups(initialGroups);
  }, [initialGroups]);

  useEffect(() => {
    setFloorPlans(initialFloorPlans);
  }, [initialFloorPlans]);

  useEffect(() => {
    setHotspots(initialHotspots);
  }, [initialHotspots]);

  useEffect(() => {
    setHotspotImages(initialHotspotImages);
  }, [initialHotspotImages]);

  useEffect(() => {
    setTitle(tour.title);
  }, [tour.title]);

  useEffect(() => {
    setNadir({
      nadir_type: tour.nadir_type,
      nadir_logo_path: tour.nadir_logo_path,
      nadir_logo_source:
        tour.nadir_logo_source ??
        (tour.nadir_logo_path ? "custom" : "default"),
      nadir_size: tour.nadir_size,
      nadir_opacity: tour.nadir_opacity,
      nadir_rotation: tour.nadir_rotation,
      nadir_feather: tour.nadir_feather ?? 0.35,
    });
  }, [
    tour.nadir_type,
    tour.nadir_logo_path,
    tour.nadir_logo_source,
    tour.nadir_size,
    tour.nadir_opacity,
    tour.nadir_rotation,
    tour.nadir_feather,
  ]);

  useEffect(() => {
    setEffects(effectsFieldsFromTour(tour));
  }, [
    tour.intro_effect,
    tour.transition_effect,
    tour.transition_speed,
    tour.transition_zoom,
    tour.transition_rotation,
    tour.transition_motion_blur,
    tour.gyroscope_enabled,
    tour.vr_enabled,
  ]);

  useEffect(() => {
    if (scenes.length === 0) {
      setActiveSceneId(null);
      return;
    }
    if (!activeSceneId || !scenes.some((scene) => scene.id === activeSceneId)) {
      const ordered = sortScenesByGroupOrder(scenes, groups);
      setActiveSceneId(
        resolveOpeningSceneId(
          {
            cover_scene_id: coverSceneId,
            start_scene_id: startSceneId,
          },
          ordered,
        ) ?? scenes[0].id,
      );
    }
  }, [scenes, groups, coverSceneId, startSceneId, activeSceneId]);

  useEffect(() => {
    setSelectedHotspotId(null);
    setPlacingType(null);
  }, [activeSceneId]);

  // Escape: cancel placing → close media modal → close popover → deselect.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      if (isTypingTarget(event.target)) return;

      if (placingType) {
        event.preventDefault();
        setPlacingType(null);
        return;
      }
      if (galleryPreviewId || videoPreviewId) {
        event.preventDefault();
        setGalleryPreviewId(null);
        setVideoPreviewId(null);
        return;
      }
      if (infoPopoverOpen) {
        event.preventDefault();
        setCloseInfoPopoverNonce((n) => n + 1);
        return;
      }
      if (selectedHotspotId) {
        event.preventDefault();
        setSelectedHotspotId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [
    placingType,
    galleryPreviewId,
    videoPreviewId,
    infoPopoverOpen,
    selectedHotspotId,
  ]);

  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) ?? null,
    [scenes, activeSceneId],
  );

  const orderedScenes = useMemo(
    () => sortScenesByGroupOrder(scenes, groups),
    [scenes, groups],
  );

  const editorStartSceneId = useMemo(
    () =>
      resolveOpeningSceneId(
        {
          cover_scene_id: coverSceneId,
          start_scene_id: startSceneId,
        },
        orderedScenes,
      ),
    [coverSceneId, startSceneId, orderedScenes],
  );

  const embedScenes = useMemo(
    () => scenes.map((scene) => ({ id: scene.id, name: scene.name })),
    [scenes],
  );

  function pruneHotspotsForScenes(nextScenes: Scene[]) {
    const ids = new Set(nextScenes.map((scene) => scene.id));
    setHotspots((prev) =>
      prev.filter(
        (hotspot) =>
          ids.has(hotspot.scene_id) &&
          (hotspot.target_scene_id === null ||
            ids.has(hotspot.target_scene_id)),
      ),
    );
  }

  async function saveTitle() {
    const trimmed = title.trim();
    if (!trimmed || trimmed === tour.title) {
      setTitle(tour.title);
      return;
    }

    const ok = await run(() => updateTourTitle(tour.id, trimmed));
    if (!ok) {
      setTitle(tour.title);
      toast.error("Could not update title");
    }
  }

  async function setInitialView() {
    if (!activeScene || !viewerRef.current) {
      toast.error("Viewer is not ready yet");
      return;
    }

    const { yaw, pitch } = viewerRef.current.getPosition();
    const ok = await run(() =>
      updateSceneInitialView(activeScene.id, yaw, pitch),
    );

    if (!ok) {
      toast.error("Could not save initial view");
      return;
    }

    setScenes((prev) =>
      prev.map((scene) =>
        scene.id === activeScene.id
          ? {
              ...scene,
              initial_yaw: yaw,
              initial_pitch: pitch,
              has_initial_view: true,
            }
          : scene,
      ),
    );
    toast.success("Initial view saved");
  }

  async function removeInitialView() {
    if (!activeScene) return;
    if (!activeScene.has_initial_view) return;

    const ok = await run(() => clearSceneInitialView(activeScene.id));
    if (!ok) {
      toast.error("Could not remove initial view");
      return;
    }

    setScenes((prev) =>
      prev.map((scene) =>
        scene.id === activeScene.id
          ? {
              ...scene,
              initial_yaw: 0,
              initial_pitch: 0,
              has_initial_view: false,
            }
          : scene,
      ),
    );
    toast.success("Initial view removed");
  }

  async function setAsCoverAndStart() {
    if (!activeSceneId || !activeScene) return;

    const previousOverride = coverStartOverride;
    setCoverStartOverride(activeSceneId);

    const ok = await run(() =>
      setTourCoverAndStartScene(tour.id, activeSceneId),
    );
    if (!ok) {
      setCoverStartOverride(previousOverride);
      toast.error("Could not set cover and start scene");
      return;
    }

    toast.success("Cover and start scene updated");
    router.refresh();
  }

  function faceHotspot(hotspot: Hotspot) {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    if (markers) {
      try {
        void markers.gotoMarker(hotspot.id, "8rpm");
        return;
      } catch {
        // Marker may not exist yet; fall through to animate.
      }
    }

    viewer.animate({
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
      speed: "8rpm",
    });
  }

  function handlePanoramaClick(payload: PanoramaClickPayload) {
    if (!activeSceneId) return;

    // Marker clicks arrive via onMarkerSelect, not here.
    if (payload.markerId) {
      setSelectedHotspotId(payload.markerId);
      return;
    }

    if (placingType) {
      void placeHotspot(placingType, payload.yaw, payload.pitch);
      return;
    }

    // IDLE: deselect only — never create or move.
    setSelectedHotspotId(null);
  }

  async function placeHotspot(
    type: PlaceableHotspotType,
    yaw: number,
    pitch: number,
  ) {
    if (!activeSceneId) return;

    if (type === "link") {
      const other = scenes.find((scene) => scene.id !== activeSceneId);
      if (!other) {
        toast.error("Add another scene before creating link hotspots");
        setPlacingType(null);
        return;
      }
      await createLinkHotspotAt(yaw, pitch, other.id, autoReturnLink);
    } else if (type === "info") {
      await createTypedHotspotAt("info", yaw, pitch, DEFAULT_INFO_SHAPE);
    } else if (type === "gallery") {
      await createTypedHotspotAt("gallery", yaw, pitch, DEFAULT_GALLERY_SHAPE);
    } else if (type === "video") {
      await createTypedHotspotAt("video", yaw, pitch, DEFAULT_VIDEO_SHAPE);
    }

    setPlacingType(null);
  }

  async function createLinkHotspotAt(
    yaw: number,
    pitch: number,
    targetSceneId: string,
    addReturnLink: boolean,
  ) {
    if (!activeSceneId) return;

    const forwardId = crypto.randomUUID();
    const linkShape = isHotspotShape(tour.default_hotspot_shape)
      ? tour.default_hotspot_shape
      : "arrow";
    const linkColor = sanitizeHotspotColor(tour.default_hotspot_color);
    const forward: Hotspot = {
      id: forwardId,
      scene_id: activeSceneId,
      target_scene_id: targetSceneId,
      type: "link",
      yaw,
      pitch,
      label: null,
      content: null,
      style_shape: linkShape,
      style_color: linkColor,
      style_size: DEFAULT_SIZE,
      style_animation: DEFAULT_ANIMATION,
      label_visibility: DEFAULT_LABEL_VISIBILITY,
      position_mode: "2d",
      style_rotation: 0,
      orient_yaw: 0,
      orient_pitch: 0,
      video_id: null,
      video_start: null,
      created_at: new Date().toISOString(),
    };

    const created: Hotspot[] = [forward];
    let returnHotspot: Hotspot | null = null;

    if (addReturnLink) {
      returnHotspot = {
        id: crypto.randomUUID(),
        scene_id: targetSceneId,
        target_scene_id: activeSceneId,
        type: "link",
        yaw: reciprocalYaw(yaw),
        pitch: 0,
        label: null,
        content: null,
        style_shape: linkShape,
        style_color: linkColor,
        style_size: DEFAULT_SIZE,
        style_animation: DEFAULT_ANIMATION,
        label_visibility: DEFAULT_LABEL_VISIBILITY,
        position_mode: "2d",
        style_rotation: 0,
        orient_yaw: 0,
        orient_pitch: 0,
        video_id: null,
        video_start: null,
        created_at: new Date().toISOString(),
      };
      created.push(returnHotspot);
    }

    const previous = hotspots;
    setHotspots([...hotspots, ...created]);
    setSelectedHotspotId(forwardId);

    const okForward = await run(() =>
      createHotspot(activeSceneId, {
        id: forward.id,
        type: "link",
        targetSceneId: forward.target_scene_id,
        yaw: forward.yaw,
        pitch: forward.pitch,
        label: forward.label,
      }),
    );

    if (!okForward) {
      setHotspots(previous);
      setSelectedHotspotId(null);
      toast.error("Could not create link hotspot");
      return;
    }

    if (returnHotspot) {
      const okReturn = await run(() =>
        createHotspot(returnHotspot!.scene_id, {
          id: returnHotspot!.id,
          type: "link",
          targetSceneId: returnHotspot!.target_scene_id,
          yaw: returnHotspot!.yaw,
          pitch: returnHotspot!.pitch,
          label: returnHotspot!.label,
        }),
      );

      if (!okReturn) {
        setHotspots((prev) =>
          prev.filter((hotspot) => hotspot.id !== returnHotspot!.id),
        );
        toast.error("Created link, but return link failed");
      }
    }
  }

  async function createTypedHotspotAt(
    type: "info" | "gallery" | "video",
    yaw: number,
    pitch: number,
    styleShape: string,
  ) {
    if (!activeSceneId) return;

    const id = crypto.randomUUID();
    const hotspot: Hotspot = {
      id,
      scene_id: activeSceneId,
      target_scene_id: null,
      type,
      yaw,
      pitch,
      label: null,
      content: null,
      style_shape: styleShape,
      style_color: sanitizeHotspotColor(tour.default_hotspot_color),
      style_size: DEFAULT_SIZE,
      style_animation: DEFAULT_ANIMATION,
      label_visibility: DEFAULT_LABEL_VISIBILITY,
      position_mode: "2d",
      style_rotation: 0,
      orient_yaw: 0,
      orient_pitch: 0,
      video_id: null,
      video_start: null,
      created_at: new Date().toISOString(),
    };

    const previous = hotspots;
    setHotspots([...hotspots, hotspot]);
    setSelectedHotspotId(id);
    setRightPanel("hotspots");

    const ok = await run(() =>
      createHotspot(activeSceneId, {
        id,
        type,
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        label: hotspot.label,
        content: hotspot.content,
      }),
    );

    if (!ok) {
      setHotspots(previous);
      setSelectedHotspotId(null);
      toast.error(`Could not create ${type} hotspot`);
    }
  }

  async function persistMarkerMove(
    hotspotId: string,
    yaw: number,
    pitch: number,
  ) {
    const previous = hotspots;
    setHotspots((prev) =>
      prev.map((item) =>
        item.id === hotspotId ? { ...item, yaw, pitch } : item,
      ),
    );

    const ok = await run(() => updateHotspot(hotspotId, { yaw, pitch }));
    if (!ok) {
      setHotspots(previous);
      toast.error("Could not move hotspot");
    }
  }

  function handleMarkerMoving(hotspotId: string, yaw: number, pitch: number) {
    setHotspots((prev) =>
      prev.map((item) =>
        item.id === hotspotId ? { ...item, yaw, pitch } : item,
      ),
    );
  }

  return (
    <>
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
        <div
          className="flex border-b bg-amber-50 px-4 py-2 text-center text-xs text-amber-950 lg:hidden dark:bg-amber-950/40 dark:text-amber-100"
          role="status"
        >
          Tour editing works best on a larger screen
        </div>
        <header className="flex shrink-0 items-center gap-3 border-b px-3 py-2">
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 px-2"
            nativeButton={false}
            render={<Link href="/dashboard" />}
          >
            ← Tours
          </Button>

          <Input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onBlur={() => {
              void saveTitle();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.currentTarget.blur();
              }
            }}
            className="h-8 max-w-md border-transparent bg-transparent px-2 text-base font-semibold tracking-tight shadow-none focus-visible:border-input focus-visible:bg-background"
            aria-label="Tour title"
          />

          <div className="ml-auto flex items-center gap-3">
            <SaveStatusIndicator />
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <Link href={`/dashboard/tours/${tour.id}/analytics`} />
              }
            >
              Analytics
            </Button>
            <Button
              variant="outline"
              size="sm"
              type="button"
              onClick={() => setEmbedOpen(true)}
            >
              Embed
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={
                <a
                  href={
                    tour.is_public
                      ? `/tour/${tour.slug}`
                      : `/dashboard/tours/${tour.id}/preview`
                  }
                  target="_blank"
                  rel="noreferrer"
                />
              }
            >
              Preview
            </Button>
          </div>
        </header>

        <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
          <div className="order-2 flex max-h-[40vh] min-h-0 w-full flex-col lg:order-1 lg:max-h-none lg:h-full lg:w-auto">
            <SceneSidebar
              tourId={tour.id}
              userId={userId}
              scenes={scenes}
              groups={groups}
              floorPlans={floorPlans}
              activeSceneId={activeSceneId}
              onScenesChange={(next) => {
                setScenes(next);
                pruneHotspotsForScenes(next);
              }}
              onGroupsChange={setGroups}
              onFloorPlansChange={setFloorPlans}
              onActiveSceneChange={setActiveSceneId}
              nadirType={nadir.nadir_type}
              nadirLogoPath={nadir.nadir_logo_path}
              nadirLogoSource={nadir.nadir_logo_source}
              nadirFeather={nadir.nadir_feather}
              onNadirPatchReady={(sceneId, nadirPatchPath) => {
                setScenes((prev) =>
                  prev.map((scene) =>
                    scene.id === sceneId
                      ? {
                          ...scene,
                          nadir_patch_path: nadirPatchPath,
                          nadir_preview_url: null,
                        }
                      : scene,
                  ),
                );
              }}
            />
          </div>

          <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
            <HotspotToolbar
              placingType={placingType}
              onPlacingTypeChange={setPlacingType}
              sceneCount={scenes.length}
              disabled={!activeSceneId}
              autoReturnLink={autoReturnLink}
              onAutoReturnLinkChange={setAutoReturnLink}
            />

            <div className="relative min-h-[40vh] flex-1 lg:min-h-0">
              {placingType ? (
                <div className="absolute top-3 left-1/2 z-20 max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-background/95 px-3 py-2 text-center text-sm shadow-md ring-1 ring-foreground/10">
                  {placingBannerText(placingType)}
                </div>
              ) : null}

              <PanoramaViewer
                scenes={scenes}
                hotspots={hotspots}
                currentSceneId={activeSceneId ?? undefined}
                selectedHotspotId={selectedHotspotId}
                placing={Boolean(placingType)}
                startSceneId={editorStartSceneId}
                mode="edit"
                className="rounded-none"
                closeInfoPopoverNonce={closeInfoPopoverNonce}
                nadirSettings={{
                  size: nadir.nadir_size,
                  opacity: nadir.nadir_opacity,
                  rotation: nadir.nadir_rotation,
                }}
                viewerEffects={viewerEffectsFromFields(effects)}
                runIntro={false}
                introReplayNonce={introReplayNonce}
                adjustmentsBypassed={adjustmentsBypassed}
                onInfoPopoverOpenChange={setInfoPopoverOpen}
                onSceneChange={setActiveSceneId}
                onMarkerSelect={(id) => {
                  if (isNadirMarkerId(id)) return;
                  setSelectedHotspotId(id);
                  setRightPanel("hotspots");
                }}
                onPanoramaClick={handlePanoramaClick}
                onMarkerMoving={handleMarkerMoving}
                onMarkerMoved={(id, yaw, pitch) => {
                  void persistMarkerMove(id, yaw, pitch);
                }}
                onViewerReady={(viewer) => {
                  viewerRef.current = viewer;
                }}
              />
            </div>

            <div className="flex shrink-0 items-center gap-2 border-t px-3 py-2 sm:gap-3">
              <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden">
                <p className="min-w-0 flex-1 truncate text-sm">
                  {activeScene ? (
                    <>
                      <span className="text-muted-foreground">
                        Active scene:{" "}
                      </span>
                      <span className="font-medium">{activeScene.name}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">
                      No scene selected
                    </span>
                  )}
                </p>
                {activeScene ? (
                  activeSceneId === coverSceneId &&
                  (startSceneId === null ||
                    activeSceneId === startSceneId) ? (
                    <span
                      className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground"
                      title="This scene is the cover image and start scene"
                    >
                      <CheckIcon className="size-3.5 shrink-0" aria-hidden />
                      <span className="whitespace-nowrap">
                        Cover &amp; start scene
                      </span>
                    </span>
                  ) : (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="min-h-11 shrink-0 whitespace-nowrap px-2 text-xs"
                      disabled={status === "saving"}
                      title="Use this scene as the dashboard cover and where visitors begin"
                      onClick={() => {
                        void setAsCoverAndStart();
                      }}
                    >
                      {status === "saving"
                        ? "Saving…"
                        : "Set as cover image / start scene"}
                    </Button>
                  )
                ) : null}
              </div>
              {activeScene ? (
                <span
                  className={cn(
                    "hidden shrink-0 text-[11px] sm:inline",
                    activeScene.has_initial_view
                      ? "text-foreground"
                      : "text-muted-foreground",
                  )}
                  title={
                    activeScene.has_initial_view
                      ? "This scene has a saved initial view"
                      : "No initial view set — link arrivals use walkthrough heading"
                  }
                >
                  {activeScene.has_initial_view
                    ? "Initial view set"
                    : "No initial view"}
                </span>
              ) : null}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 shrink-0"
                disabled={!activeScene || status === "saving"}
                title="Save the current camera angle as where visitors look when they land on this scene"
                onClick={() => {
                  void setInitialView();
                }}
              >
                {status === "saving" ? "Saving…" : "Set as initial view"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 shrink-0"
                disabled={
                  !activeScene ||
                  !activeScene.has_initial_view ||
                  status === "saving"
                }
                title={
                  activeScene?.has_initial_view
                    ? "Clear the saved landing angle for this scene"
                    : "This scene has no initial view to remove"
                }
                onClick={() => {
                  void removeInitialView();
                }}
              >
                Remove initial view
              </Button>
            </div>
          </div>

          <div className="order-3 hidden w-[300px] shrink-0 flex-col border-l lg:flex">
            <div
              className="flex shrink-0 gap-1 border-b p-1"
              role="tablist"
              aria-label="Editor side panel"
            >
              <button
                type="button"
                role="tab"
                aria-selected={rightPanel === "hotspots"}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium sm:text-xs",
                  rightPanel === "hotspots"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAdjustmentsBypassed(false);
                  setRightPanel("hotspots");
                }}
              >
                Hotspots
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightPanel === "nadir"}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium sm:text-xs",
                  rightPanel === "nadir"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAdjustmentsBypassed(false);
                  setRightPanel("nadir");
                }}
              >
                Nadir
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightPanel === "floorplan"}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium sm:text-xs",
                  rightPanel === "floorplan"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAdjustmentsBypassed(false);
                  setRightPanel("floorplan");
                }}
              >
                Plan
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightPanel === "effects"}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium sm:text-xs",
                  rightPanel === "effects"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => {
                  setAdjustmentsBypassed(false);
                  setRightPanel("effects");
                }}
              >
                Effects
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={rightPanel === "adjustments"}
                className={cn(
                  "flex-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium sm:text-xs",
                  rightPanel === "adjustments"
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
                onClick={() => setRightPanel("adjustments")}
              >
                Adjust
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {rightPanel === "nadir" ? (
                <NadirSettings
                  tourId={tour.id}
                  userId={userId}
                  scenes={scenes}
                  activeSceneId={activeSceneId}
                  values={nadir}
                  onChange={setNadir}
                  onScenesChange={setScenes}
                  stagingEnabled={stagingEnabled}
                />
              ) : rightPanel === "floorplan" ? (
                <FloorPlanEditor
                  tourId={tour.id}
                  userId={userId}
                  scenes={scenes}
                  groups={groups}
                  floorPlans={floorPlans}
                  activeSceneId={activeSceneId}
                  onScenesChange={setScenes}
                  onFloorPlansChange={setFloorPlans}
                  onActiveSceneChange={setActiveSceneId}
                />
              ) : rightPanel === "effects" ? (
                <EffectsPanel
                  tourId={tour.id}
                  values={effects}
                  onChange={setEffects}
                  onReplayIntro={() =>
                    setIntroReplayNonce((n) => n + 1)
                  }
                />
              ) : rightPanel === "adjustments" ? (
                <AdjustmentsPanel
                  tourId={tour.id}
                  scenes={scenes}
                  activeSceneId={activeSceneId}
                  onScenesChange={setScenes}
                  onHoldUnadjusted={setAdjustmentsBypassed}
                />
              ) : (
                <HotspotPanel
                  tourId={tour.id}
                  userId={userId}
                  scenes={scenes}
                  hotspots={hotspots}
                  hotspotImages={hotspotImages}
                  activeSceneId={activeSceneId}
                  selectedHotspotId={selectedHotspotId}
                  onSelect={setSelectedHotspotId}
                  onHotspotsChange={setHotspots}
                  onHotspotImagesChange={setHotspotImages}
                  onFaceHotspot={faceHotspot}
                  onPreviewGallery={setGalleryPreviewId}
                  onPreviewVideo={setVideoPreviewId}
                />
              )}
            </div>
          </div>
        </div>
      </div>

      <GalleryModal
        open={
          galleryPreviewId != null &&
          hotspotImages.some((img) => img.hotspot_id === galleryPreviewId)
        }
        onOpenChange={(open) => {
          if (!open) setGalleryPreviewId(null);
        }}
        images={hotspotImages.filter(
          (img) => img.hotspot_id === galleryPreviewId,
        )}
        title={
          hotspots.find((h) => h.id === galleryPreviewId)?.label ?? "Gallery"
        }
      />
      <VideoModal
        open={
          videoPreviewId != null &&
          Boolean(hotspots.find((h) => h.id === videoPreviewId)?.video_id)
        }
        onOpenChange={(open) => {
          if (!open) setVideoPreviewId(null);
        }}
        videoId={hotspots.find((h) => h.id === videoPreviewId)?.video_id}
        start={hotspots.find((h) => h.id === videoPreviewId)?.video_start}
        title={hotspots.find((h) => h.id === videoPreviewId)?.label}
      />

      <EmbedDialog
        tour={tour}
        scenes={embedScenes}
        open={embedOpen}
        onOpenChange={setEmbedOpen}
      />
    </>
  );
}
