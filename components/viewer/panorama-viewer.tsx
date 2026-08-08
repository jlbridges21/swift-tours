"use client";

/**
 * Coordinates are RADIANS end-to-end.
 * Photo Sphere Viewer uses radians internally; the hotspots / scenes tables store
 * yaw & pitch as double precision radians. Do not convert to degrees.
 */

import { Viewer, events } from "@photo-sphere-viewer/core";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";
import {
  MarkersPlugin,
  type MarkerConfig,
} from "@photo-sphere-viewer/markers-plugin";
import { StereoPlugin } from "@photo-sphere-viewer/stereo-plugin";
import {
  VirtualTourPlugin,
  type VirtualTourLink,
  type VirtualTourNode,
} from "@photo-sphere-viewer/virtual-tour-plugin";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import {
  composeCanvasFilter,
  PSV_CANVAS_SELECTOR,
  type SceneAdjustments,
} from "@/lib/adjustments";
import {
  applyLittlePlanetPose,
  runLittlePlanetIntro,
  type LittlePlanetHandle,
} from "@/lib/little-planet";
import {
  getMaxTextureSize,
  resolvePanoramaPath,
} from "@/lib/gl-capabilities";
import {
  buildHotspotMarkerHtml,
  clampHotspotSize,
  escapeHtml,
  isLabelVisibility,
  sanitizeHotspotColor,
} from "@/lib/hotspot-styles";
import {
  planeRotationForMode,
  resolvePositionMode,
  upsertHotspotLayerElement,
} from "@/lib/hotspot-placement";
import {
  buildNadirMarkerConfig,
  isNadirMarkerId,
  NADIR_MARKER_ID,
} from "@/lib/nadir";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import {
  DEFAULT_VIEWER_EFFECTS,
  easeInCubic,
  easeOutCubic,
  prefersReducedMotion,
  resolveTransitionOptions,
  walkthroughArrivalYaw,
  ZOOM_WALK_IN_PUSH,
  ZOOM_WALKTHROUGH_SETTLE,
  ZOOM_WIDE,
  type ViewerEffectsSettings,
} from "@/lib/viewer-effects";
import type { Hotspot, Scene } from "@/types";

import { InfoHotspotPopover } from "@/components/viewer/info-hotspot-popover";

import "@photo-sphere-viewer/core/index.css";
import "@photo-sphere-viewer/markers-plugin/index.css";
import "@photo-sphere-viewer/virtual-tour-plugin/index.css";

export type PanoramaViewerScene = Pick<
  Scene,
  | "id"
  | "name"
  | "storage_path"
  | "thumbnail_path"
  | "compat_path"
  | "width"
  | "height"
  | "initial_yaw"
  | "initial_pitch"
  | "nadir_patch_path"
  | "nadir_disabled"
  | "adjust_brightness"
  | "adjust_contrast"
  | "adjust_saturation"
> & {
  /** Client-only blob: URL for instant nadir preview before upload finishes. */
  nadir_preview_url?: string | null;
};

export type PanoramaViewerHotspot = Pick<
  Hotspot,
  | "id"
  | "scene_id"
  | "target_scene_id"
  | "type"
  | "yaw"
  | "pitch"
  | "label"
  | "content"
  | "style_shape"
  | "style_color"
  | "style_size"
  | "style_animation"
  | "label_visibility"
  | "video_id"
  | "video_start"
  | "position_mode"
  | "style_rotation"
  | "orient_yaw"
  | "orient_pitch"
>;

/** Tour-level nadir render settings (size/opacity/rotation are live; patch is per-scene). */
export type PanoramaNadirSettings = {
  size: number;
  opacity: number;
  rotation: number;
};

export type PanoramaClickPayload = {
  yaw: number;
  pitch: number;
  clientX: number;
  clientY: number;
  markerId?: string;
};

export type PanoramaViewerProps = {
  scenes: PanoramaViewerScene[];
  hotspots: PanoramaViewerHotspot[];
  startSceneId?: string;
  currentSceneId?: string;
  selectedHotspotId?: string | null;
  /** When true, show a crosshair — placing a new hotspot. */
  placing?: boolean;
  mode: "view" | "edit";
  className?: string;
  ariaLabel?: string;
  /** Increment to force-close the info popover (Escape priority from parent). */
  closeInfoPopoverNonce?: number;
  /** Floor patch size / opacity / spin — applied at render time. */
  nadirSettings?: PanoramaNadirSettings;
  /** Intro / transition / gyro-VR tour settings. */
  viewerEffects?: ViewerEffectsSettings;
  /**
   * When false, skip little-planet intro (e.g. ?start= override or intro=0).
   * Default true when intro_effect is little_planet.
   */
  runIntro?: boolean;
  /** Increment to replay the little-planet intro without remounting. */
  introReplayNonce?: number;
  /**
   * When true, temporarily clear the CSS filter (press-and-hold before/after).
   * Same code path in edit and view — only the editor sets this.
   */
  adjustmentsBypassed?: boolean;
  onSceneChange?: (sceneId: string) => void;
  onPanoramaClick?: (payload: PanoramaClickPayload) => void;
  onMarkerSelect?: (hotspotId: string) => void;
  /** Live yaw/pitch while dragging a marker (edit mode). */
  onMarkerMoving?: (hotspotId: string, yaw: number, pitch: number) => void;
  /** Final yaw/pitch after a drag ends (edit mode). */
  onMarkerMoved?: (hotspotId: string, yaw: number, pitch: number) => void;
  onInfoPopoverOpenChange?: (open: boolean) => void;
  /** View mode: open gallery modal for this hotspot. */
  onOpenGallery?: (hotspotId: string) => void;
  /** View mode: open video modal for this hotspot. */
  onOpenVideo?: (hotspotId: string) => void;
  /** Fired on any hotspot activation (link / info / gallery / video). */
  onHotspotActivate?: (hotspotId: string) => void;
  onViewerReady?: (viewer: Viewer) => void;
};

type InfoOverlay = {
  id: string;
  yaw: number;
  pitch: number;
  label: string | null;
  content: string | null;
};

function markerSize(hotspot: PanoramaViewerHotspot): {
  width: number;
  height: number;
} {
  const size = clampHotspotSize(hotspot.style_size);
  if (hotspot.style_shape === "label") {
    const height = Math.max(22, Math.round(size * 0.55));
    return { width: Math.max(size, 96), height };
  }
  return { width: size, height: size };
}

export function hotspotToMarkerConfig(
  hotspot: PanoramaViewerHotspot,
  selected: boolean,
  scenes: PanoramaViewerScene[] = [],
  layerCache?: Map<string, HTMLElement>,
): MarkerConfig {
  const type =
    hotspot.type === "link" ||
    hotspot.type === "gallery" ||
    hotspot.type === "video"
      ? hotspot.type
      : "info";
  const targetName =
    hotspot.target_scene_id != null
      ? (scenes.find((scene) => scene.id === hotspot.target_scene_id)?.name ??
        null)
      : null;
  const visibility = isLabelVisibility(hotspot.label_visibility)
    ? hotspot.label_visibility
    : "hover";
  const size = markerSize(hotspot);
  const tooltipLabel =
    hotspot.label?.trim() ||
    targetName ||
    (type === "link"
      ? "Go to scene"
      : type === "gallery"
        ? "Gallery"
        : type === "video"
          ? "Video"
          : "Info");

  const positionMode = resolvePositionMode(hotspot.position_mode);
  const styleRotation =
    typeof hotspot.style_rotation === "number" &&
    Number.isFinite(hotspot.style_rotation)
      ? hotspot.style_rotation
      : 0;
  const orientYaw =
    typeof hotspot.orient_yaw === "number" && Number.isFinite(hotspot.orient_yaw)
      ? hotspot.orient_yaw
      : 0;
  const orientPitch =
    typeof hotspot.orient_pitch === "number" &&
    Number.isFinite(hotspot.orient_pitch)
      ? hotspot.orient_pitch
      : 0;

  const html = buildHotspotMarkerHtml({
    shape: hotspot.style_shape,
    color: sanitizeHotspotColor(hotspot.style_color),
    size: hotspot.style_size,
    animation: hotspot.style_animation,
    labelVisibility: hotspot.label_visibility,
    label: hotspot.label,
    fallbackLabel: targetName,
    selected,
  });

  const data = {
    hotspotId: hotspot.id,
    type,
    label: hotspot.label,
    content: hotspot.content,
    targetSceneId: hotspot.target_scene_id,
    videoId: hotspot.video_id,
    videoStart: hotspot.video_start,
    yaw: hotspot.yaw,
    pitch: hotspot.pitch,
    positionMode,
  };

  const tooltip =
    visibility === "hover" ? escapeHtml(tooltipLabel) : undefined;

  if (positionMode === "floor" || positionMode === "wall") {
    const cache = layerCache ?? new Map<string, HTMLElement>();
    const element = upsertHotspotLayerElement(cache, hotspot.id, html);
    const rotation = planeRotationForMode(
      positionMode,
      styleRotation,
      orientYaw,
      orientPitch,
    );
    return {
      id: hotspot.id,
      position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
      elementLayer: element,
      size,
      anchor: "center center",
      rotation,
      tooltip,
      data,
    };
  }

  // 2D billboard — style_rotation as CSS transform on marker content.
  const rotatedHtml =
    styleRotation !== 0
      ? `<div style="transform:rotate(${styleRotation}deg);transform-origin:center center;">${html}</div>`
      : html;

  return {
    id: hotspot.id,
    position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
    html: rotatedHtml,
    size,
    anchor: "center center",
    // PSV may render tooltip content as HTML — escape user/scene names.
    tooltip,
    data,
  };
}

function resolveStartId(
  scenes: PanoramaViewerScene[],
  startSceneId?: string,
): string {
  if (startSceneId && scenes.some((scene) => scene.id === startSceneId)) {
    return startSceneId;
  }
  return scenes[0].id;
}

let loggedMaxTextureSize = false;
const loggedPanoramaTier = new Set<string>();

function panoramaUrlForScene(scene: PanoramaViewerScene): string {
  const maxTextureSize = getMaxTextureSize();
  const { path, tier } = resolvePanoramaPath(scene, maxTextureSize);

  if (
    process.env.NODE_ENV === "development" &&
    !loggedPanoramaTier.has(scene.id)
  ) {
    loggedPanoramaTier.add(scene.id);
    if (!loggedMaxTextureSize) {
      loggedMaxTextureSize = true;
      console.info(
        `[panorama] GL_MAX_TEXTURE_SIZE=${maxTextureSize}; choosing full vs compat per scene`,
      );
    }
    console.info(
      `[panorama] scene ${scene.id}: tier=${tier} width=${scene.width ?? "unknown"} path=${path}`,
    );
  }

  return publicUrl(path);
}

function nadirMarkerForScene(
  scene: PanoramaViewerScene,
  settings: PanoramaNadirSettings | undefined,
): MarkerConfig | null {
  if (!settings || scene.nadir_disabled) return null;

  const preview = scene.nadir_preview_url?.trim();
  const stored = scene.nadir_patch_path;
  if (!preview && !stored) return null;

  const imageUrl =
    preview ||
    (stored!.startsWith("blob:") || stored!.startsWith("http")
      ? stored!
      : publicUrl(stored!));

  return buildNadirMarkerConfig({
    imageUrl,
    size: settings.size,
    opacity: settings.opacity,
    rotationDegrees: settings.rotation,
  });
}

function buildNodes(
  scenes: PanoramaViewerScene[],
  hotspots: PanoramaViewerHotspot[],
  mode: "view" | "edit",
  nadirSettings?: PanoramaNadirSettings,
  layerCache?: Map<string, HTMLElement>,
): VirtualTourNode[] {
  return scenes.map((scene) => {
    const sceneHotspots = hotspots.filter(
      (hotspot) => hotspot.scene_id === scene.id,
    );

    // Per-scene landing view — VirtualTourNode has no native startPosition in 5.15.1,
    // so we stash radians on node.data and apply them on node-changed (unless fromLink).
    const nodeData = {
      initialYaw: scene.initial_yaw,
      initialPitch: scene.initial_pitch,
    };

    const panorama = panoramaUrlForScene(scene);
    const thumbnail = scene.thumbnail_path
      ? publicUrl(scene.thumbnail_path)
      : undefined;

    // Edit mode: no VirtualTour links (they'd navigate on click). Markers are
    // managed separately via MarkersPlugin add/update/remove.
    if (mode === "edit") {
      return {
        id: scene.id,
        name: scene.name,
        panorama,
        thumbnail,
        links: [],
        markers: [],
        data: nodeData,
      };
    }

    // View mode: style every hotspot as a MarkersPlugin marker (same HTML as
    // edit). Link navigation is handled in select-marker → setCurrentNode so
    // appearance stays identical. Empty VT links avoids the default 3D arrows.
    const markers: MarkerConfig[] = sceneHotspots.map((hotspot) =>
      hotspotToMarkerConfig(hotspot, false, scenes, layerCache),
    );
    const nadir = nadirMarkerForScene(scene, nadirSettings);
    if (nadir) markers.push(nadir);

    return {
      id: scene.id,
      name: scene.name,
      panorama,
      thumbnail,
      links: [] as VirtualTourLink[],
      markers,
      data: nodeData,
    };
  });
}

function serializeNodesKey(
  nodes: VirtualTourNode[],
  mode: "view" | "edit",
  nadirSettings?: PanoramaNadirSettings,
): string {
  if (mode === "edit") {
    return JSON.stringify(
      nodes.map((node) => ({
        id: node.id,
        panorama: node.panorama,
        thumbnail: node.thumbnail,
        name: node.name,
        data: node.data,
      })),
    );
  }

  return JSON.stringify({
    nadir: nadirSettings ?? null,
    nodes: nodes.map((node) => ({
      id: node.id,
      panorama: node.panorama,
      thumbnail: node.thumbnail,
      name: node.name,
      data: node.data,
      markers: (node.markers ?? []).map((marker) => ({
        id: marker.id,
        position: marker.position,
        html: marker.html,
        imageLayer: marker.imageLayer,
        elementLayer: Boolean(marker.elementLayer),
        size: marker.size,
        opacity: marker.opacity,
        rotation: marker.rotation,
        tooltip: marker.tooltip,
        data: marker.data,
      })),
    })),
  });
}

function syncEditMarkers(
  markers: MarkersPlugin,
  sceneHotspots: PanoramaViewerHotspot[],
  highlightedHotspotId: string | null | undefined,
  scenes: PanoramaViewerScene[],
  skipPositionUpdateId?: string | null,
  layerCache?: Map<string, HTMLElement>,
) {
  const existingById = new Map(
    markers.getMarkers().map((marker) => [marker.id, marker]),
  );
  const nextIds = new Set(sceneHotspots.map((hotspot) => hotspot.id));

  for (const hotspot of sceneHotspots) {
    const config = hotspotToMarkerConfig(
      hotspot,
      hotspot.id === highlightedHotspotId,
      scenes,
      layerCache,
    );
    // Drag owns position for this marker — don't snap it back mid-gesture.
    if (hotspot.id === skipPositionUpdateId) continue;

    const existing = existingById.get(hotspot.id);
    if (existing) {
      const nextIsLayer =
        resolvePositionMode(hotspot.position_mode) !== "2d";
      const existingIsLayer = existing.isCss3d();
      // Marker type (html ↔ elementLayer) cannot change via updateMarker.
      if (nextIsLayer !== existingIsLayer) {
        markers.removeMarker(hotspot.id);
        markers.addMarker(config);
      } else {
        markers.updateMarker(config);
      }
    } else {
      markers.addMarker(config);
    }
  }

  for (const id of existingById.keys()) {
    // Never remove the reserved nadir layer here — syncNadirMarker owns it.
    if (!nextIds.has(id) && !isNadirMarkerId(id)) {
      markers.removeMarker(id);
      layerCache?.delete(id);
    }
  }
}

function syncNadirMarker(
  markers: MarkersPlugin,
  scene: PanoramaViewerScene | undefined,
  settings: PanoramaNadirSettings | undefined,
) {
  const config = scene ? nadirMarkerForScene(scene, settings) : null;
  const existing = markers.getMarkers().some((m) => isNadirMarkerId(m.id));

  if (!config) {
    if (existing) markers.removeMarker(NADIR_MARKER_ID);
    return;
  }

  if (existing) {
    markers.updateMarker(config);
  } else {
    markers.addMarker(config);
  }
}

function applyNodeInitialView(
  viewer: Viewer,
  node: VirtualTourNode,
  fromLink: unknown,
) {
  // Link navigation: keep viewing direction for spatial continuity.
  if (fromLink) return;

  const data = node.data as
    | { initialYaw?: number; initialPitch?: number }
    | undefined;
  if (
    typeof data?.initialYaw !== "number" ||
    typeof data?.initialPitch !== "number"
  ) {
    return;
  }

  viewer.rotate({ yaw: data.initialYaw, pitch: data.initialPitch });
}

/**
 * Walkthrough arrival for A→B link nav.
 * Prefer return-hotspot reciprocity; else first visit uses initial_yaw;
 * else preserve the current heading.
 */
function resolveWalkthroughRotateTo(
  fromSceneId: string | undefined,
  toNode: VirtualTourNode,
  viewer: Viewer,
  hotspots: PanoramaViewerHotspot[],
  visited: Set<string>,
): { yaw: number; pitch: number } | null {
  if (!fromSceneId) return null;

  const returnLink = hotspots.find(
    (h) =>
      h.scene_id === toNode.id &&
      h.target_scene_id === fromSceneId &&
      h.type === "link",
  );
  if (returnLink) {
    return { yaw: walkthroughArrivalYaw(returnLink.yaw), pitch: 0 };
  }

  if (!visited.has(toNode.id)) {
    const data = toNode.data as
      | { initialYaw?: number; initialPitch?: number }
      | undefined;
    if (typeof data?.initialYaw === "number") {
      return { yaw: data.initialYaw, pitch: 0 };
    }
  }

  const current = viewer.getPosition();
  return { yaw: current.yaw, pitch: current.pitch };
}

type CanvasVisualState = {
  adjustments: Partial<SceneAdjustments> | null;
  bypassed: boolean;
  blurPx: number;
  scale: number;
};

function syncCanvasVisuals(viewer: Viewer, state: CanvasVisualState) {
  const canvas = viewer.container.querySelector(
    PSV_CANVAS_SELECTOR,
  ) as HTMLCanvasElement | null;
  if (!canvas) return;

  const filter = composeCanvasFilter({
    adjustments: state.bypassed ? null : state.adjustments,
    blurPx: state.blurPx,
  });
  if (filter) {
    canvas.style.filter = filter;
  } else {
    canvas.style.removeProperty("filter");
  }

  if (Math.abs(state.scale - 1) > 0.001) {
    canvas.style.transform = `scale(${state.scale.toFixed(4)})`;
  } else {
    canvas.style.removeProperty("transform");
  }
}

/**
 * blur(0→peak) + scale(1→1.06) over `durationMs` (push phase), ease-in.
 * Arrival settle uses runArrivalSettleAnimation instead.
 */
function runMotionBlurAnimation(
  durationMs: number,
  onFrame: (blurPx: number, scale: number) => void,
): () => void {
  let raf = 0;
  const start = performance.now();

  const tick = (now: number) => {
    const raw = Math.min(1, (now - start) / Math.max(1, durationMs));
    // Default (non–walk-in) path: symmetric envelope over the full transition.
    const envelope = raw <= 0.5 ? raw / 0.5 : (1 - raw) / 0.5;
    const blurPx = 6 * envelope;
    const scale = 1 + 0.06 * envelope;
    onFrame(blurPx, scale);
    if (raw < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      onFrame(0, 1);
      raf = 0;
    }
  };

  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    onFrame(0, 1);
  };
}

/** Push-phase blur: 0 → peak with ease-in (pairs with outgoing zoom push). */
function runPushBlurAnimation(
  durationMs: number,
  onFrame: (blurPx: number, scale: number) => void,
): () => void {
  let raf = 0;
  const start = performance.now();

  const tick = (now: number) => {
    const raw = Math.min(1, (now - start) / Math.max(1, durationMs));
    const t = easeInCubic(raw);
    onFrame(6 * t, 1 + 0.06 * t);
    if (raw < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      onFrame(6, 1.06);
      raf = 0;
    }
  };

  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
  };
}

/**
 * Arrival settle: zoom wide→default, blur peak→0, on the same ease-out timeline.
 * Opacity is driven by PSV's fade over the same duration.
 */
function runArrivalSettleAnimation(
  durationMs: number,
  fromZoom: number,
  toZoom: number,
  fromBlur: number,
  fromScale: number,
  onFrame: (zoom: number, blurPx: number, scale: number) => void,
): () => void {
  let raf = 0;
  const start = performance.now();

  const tick = (now: number) => {
    const raw = Math.min(1, (now - start) / Math.max(1, durationMs));
    const t = easeOutCubic(raw);
    const zoom = fromZoom + (toZoom - fromZoom) * t;
    const blurPx = fromBlur * (1 - t);
    const scale = fromScale + (1 - fromScale) * t;
    onFrame(zoom, blurPx, scale);
    if (raw < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      onFrame(toZoom, 0, 1);
      raf = 0;
    }
  };

  raf = requestAnimationFrame(tick);
  return () => {
    if (raf) cancelAnimationFrame(raf);
    onFrame(toZoom, 0, 1);
  };
}

const LINK_WAIT_HINT_MS = 2000;

const DRAG_THRESHOLD_PX = 5;
const MARKER_ID_PREFIX = "psv-marker-";

function markerElementFromTarget(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof Element)) return null;
  return target.closest(".psv-marker") as HTMLElement | null;
}

function hotspotIdFromMarkerElement(el: HTMLElement): string | null {
  if (!el.id.startsWith(MARKER_ID_PREFIX)) return null;
  return el.id.slice(MARKER_ID_PREFIX.length) || null;
}

export function PanoramaViewer({
  scenes,
  hotspots,
  startSceneId,
  currentSceneId,
  selectedHotspotId,
  placing = false,
  mode,
  className,
  ariaLabel,
  closeInfoPopoverNonce = 0,
  nadirSettings,
  viewerEffects = DEFAULT_VIEWER_EFFECTS,
  runIntro = true,
  introReplayNonce = 0,
  adjustmentsBypassed = false,
  onSceneChange,
  onPanoramaClick,
  onMarkerSelect,
  onMarkerMoving,
  onMarkerMoved,
  onInfoPopoverOpenChange,
  onOpenGallery,
  onOpenVideo,
  onHotspotActivate,
  onViewerReady,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const nodesKeyRef = useRef<string>("");
  const modeRef = useRef(mode);
  const onSceneChangeRef = useRef(onSceneChange);
  const onPanoramaClickRef = useRef(onPanoramaClick);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const onMarkerMovingRef = useRef(onMarkerMoving);
  const onMarkerMovedRef = useRef(onMarkerMoved);
  const onInfoPopoverOpenChangeRef = useRef(onInfoPopoverOpenChange);
  const onOpenGalleryRef = useRef(onOpenGallery);
  const onOpenVideoRef = useRef(onOpenVideo);
  const onHotspotActivateRef = useRef(onHotspotActivate);
  const onViewerReadyRef = useRef(onViewerReady);
  /** True while the initial setNodes→setCurrentNode load is in flight. */
  const bootstrappingRef = useRef(false);
  /** Scene id the controlled effect should not re-request during bootstrap. */
  const bootstrapSceneIdRef = useRef<string | null>(null);
  const draggingIdRef = useRef<string | null>(null);
  const suppressClickRef = useRef(false);
  const hotspotsRef = useRef(hotspots);
  const scenesRef = useRef(scenes);
  const viewerEffectsRef = useRef(viewerEffects);
  const introPendingRef = useRef(false);
  const introHandleRef = useRef<LittlePlanetHandle | null>(null);
  const introRanRef = useRef(false);
  /** Scenes entered this viewer session (walkthrough first-visit fallback). */
  const visitedScenesRef = useRef<Set<string>>(new Set());
  /** Reuse CSS3D elementLayer DOM nodes across marker syncs. */
  const hotspotLayerCacheRef = useRef<Map<string, HTMLElement>>(new Map());
  /** Motion blur / scale envelope during link transitions (composed into canvas filter). */
  const motionBlurPxRef = useRef(0);
  const motionScaleRef = useRef(1);
  const motionBlurCancelRef = useRef<(() => void) | null>(null);
  const canvasAdjustmentsRef = useRef<{
    adjustments: Partial<SceneAdjustments> | null;
    bypassed: boolean;
  }>({ adjustments: null, bypassed: false });
  /** Texture preload promises keyed by scene id (link targets). */
  const preloadPromisesRef = useRef<Map<string, Promise<void>>>(new Map());
  /** First texture + orientation applied; safe to fade the canvas in. */
  const [panoramaRevealed, setPanoramaRevealed] = useState(false);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [infoOverlay, setInfoOverlay] = useState<InfoOverlay | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);
  /** Subtle hint when a link target still isn't cached after ~2s. */
  const [linkWaitHint, setLinkWaitHint] = useState(false);

  modeRef.current = mode;
  onSceneChangeRef.current = onSceneChange;
  onPanoramaClickRef.current = onPanoramaClick;
  onMarkerSelectRef.current = onMarkerSelect;
  onMarkerMovingRef.current = onMarkerMoving;
  onMarkerMovedRef.current = onMarkerMoved;
  onInfoPopoverOpenChangeRef.current = onInfoPopoverOpenChange;
  onOpenGalleryRef.current = onOpenGallery;
  onOpenVideoRef.current = onOpenVideo;
  onHotspotActivateRef.current = onHotspotActivate;
  onViewerReadyRef.current = onViewerReady;
  hotspotsRef.current = hotspots;
  scenesRef.current = scenes;
  viewerEffectsRef.current = viewerEffects;

  const hasScenes = scenes.length > 0;
  const highlightedHotspotId = selectedHotspotId;

  useEffect(() => {
    onInfoPopoverOpenChangeRef.current?.(infoOverlay != null);
  }, [infoOverlay]);

  useEffect(() => {
    if (closeInfoPopoverNonce > 0) {
      setInfoOverlay(null);
    }
  }, [closeInfoPopoverNonce]);

  useEffect(() => {
    if (!selectedHotspotId) {
      setInfoOverlay(null);
    }
  }, [selectedHotspotId]);

  const startScene = useMemo(() => {
    if (!hasScenes) return null;
    const preferred = currentSceneId ?? startSceneId;
    const id = resolveStartId(scenes, preferred);
    return scenes.find((scene) => scene.id === id) ?? scenes[0];
  }, [hasScenes, scenes, startSceneId, currentSceneId]);

  useEffect(() => {
    if (!hasScenes || !containerRef.current || !startScene) {
      return;
    }

    setLoadError(null);
    setLoadTimedOut(false);
    setInfoOverlay(null);
    setPanoramaRevealed(false);

    const nodes = buildNodes(
      scenes,
      hotspots,
      mode,
      nadirSettings,
      hotspotLayerCacheRef.current,
    );
    const startId = resolveStartId(scenes, currentSceneId ?? startSceneId);
    let cancelled = false;
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let revealRaf = 0;

    const wantIntro =
      runIntro &&
      viewerEffects.introEffect === "little_planet" &&
      !prefersReducedMotion();
    introPendingRef.current = wantIntro;
    introRanRef.current = false;
    introHandleRef.current = null;

    const revealPanorama = () => {
      if (cancelled) return;
      // Double rAF: apply orientation this frame, paint next, then fade in.
      revealRaf = requestAnimationFrame(() => {
        revealRaf = requestAnimationFrame(() => {
          if (!cancelled) setPanoramaRevealed(true);
        });
      });
    };

    // Create the viewer WITHOUT feeding nodes into plugin config. Plugin.init()
    // would otherwise call setNodes→setCurrentNode before our React effects run;
    // the controlled currentSceneId effect then aborts that in-flight load
    // (ERR_ABORTED), which is the first-scene hang under Strict Mode.
    const viewer = new Viewer({
      container: containerRef.current,
      navbar: ["zoom", "move", "fullscreen"],
      // Little-planet opens looking straight down, fisheye on, fully zoomed out.
      // Normal tours use the start scene's stored landing angles.
      defaultYaw: wantIntro ? 0 : startScene.initial_yaw,
      defaultPitch: wantIntro ? -Math.PI / 2 : startScene.initial_pitch,
      defaultZoomLvl: wantIntro ? 0 : 50,
      fisheye: wantIntro ? 1 : 0,
      mousewheel: true,
      mousemove: true,
      touchmoveTwoFingers: false,
      plugins: [
        MarkersPlugin.withConfig({
          clickEventOnMarker: false,
        }),
        // Gyroscope before Stereo — StereoPlugin requires it at init.
        GyroscopePlugin.withConfig({
          touchmove: true,
          roll: true,
        }),
        StereoPlugin.withConfig(),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
          transitionOptions: (to, from, fromLink) => {
            const resolved = resolveTransitionOptions(
              viewerEffectsRef.current.transition,
            );
            const base: {
              showLoader: boolean;
              effect: "none" | "fade" | "black" | "white";
              speed: number;
              rotation: boolean;
              zoomTo?: number;
              rotateTo?: { yaw: number; pitch: number };
            } = {
              // Link navigations never show PSV's spinner — preload + hold.
              showLoader: fromLink ? false : resolved.showLoader,
              effect: resolved.effect,
              speed: resolved.speed,
              rotation: resolved.rotation,
              // Zoom-through only when navigating via a link (hotspot).
              // Zoom walk-in omits zoomTo — the click handler owns push/settle.
              zoomTo:
                resolved.zoomTo !== undefined &&
                fromLink &&
                !resolved.isZoomWalkIn
                  ? resolved.zoomTo
                  : undefined,
            };

            // Bake initial view into setPanorama for non-link navigations so the
            // texture never appears at the wrong angle (pano XMP / 0,0) and then
            // snaps. Link navigations keep fromLinkPosition from the VT plugin.
            let result = base;
            if (fromLink || introPendingRef.current) {
              result = base;

              // Walkthrough: override arrival heading on link nav only.
              if (
                fromLink &&
                viewerEffectsRef.current.walkthroughEnabled &&
                from?.id
              ) {
                const arrival = resolveWalkthroughRotateTo(
                  from.id,
                  to,
                  viewer,
                  hotspotsRef.current,
                  visitedScenesRef.current,
                );
                if (arrival) {
                  const returnLink = hotspotsRef.current.find(
                    (h) =>
                      h.scene_id === to.id &&
                      h.target_scene_id === from.id &&
                      h.type === "link",
                  );
                  const firstVisit = !visitedScenesRef.current.has(to.id);
                  result = {
                    ...result,
                    rotateTo: arrival,
                    // Animate toward return/initial; preserve heading without a spin.
                    rotation: Boolean(returnLink) || firstVisit,
                  };
                }
              }
            } else {
              const data = to.data as
                | { initialYaw?: number; initialPitch?: number }
                | undefined;
              if (
                typeof data?.initialYaw === "number" &&
                typeof data?.initialPitch === "number"
              ) {
                result = {
                  ...base,
                  rotateTo: {
                    yaw: data.initialYaw,
                    pitch: data.initialPitch,
                  },
                  // Apply as baked position, not a visible rotate animation.
                  rotation: false,
                };
              }
            }

            if (process.env.NODE_ENV === "development") {
              console.debug("[swift-tours transitionOptions]", {
                to: to.id,
                fromLink: Boolean(fromLink),
                fromLinkPosition: fromLink
                  ? {
                      yaw: (fromLink as { position?: { yaw?: number } })
                        .position?.yaw,
                      pitch: (fromLink as { position?: { pitch?: number } })
                        .position?.pitch,
                    }
                  : null,
                result,
              });
            }

            return result;
          },
        }),
      ],
    });

    viewerRef.current = viewer;
    nodesKeyRef.current = serializeNodesKey(nodes, mode, nadirSettings);
    onViewerReadyRef.current?.(viewer);

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markersPlugin = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);

    if (!tour || !markersPlugin) {
      viewer.destroy();
      viewerRef.current = null;
      setLoadError("Failed to initialize tour plugins.");
      return;
    }

    const clearLoadTimeout = () => {
      if (loadTimeoutId) {
        clearTimeout(loadTimeoutId);
        loadTimeoutId = null;
      }
    };

    const armLoadTimeout = () => {
      clearLoadTimeout();
      loadTimeoutId = setTimeout(() => {
        if (cancelled || tour.getCurrentNode()) return;
        setLoadTimedOut(true);
      }, 60_000);
    };

    /** Preload a scene's panorama texture (no-op if already in flight / done). */
    const preloadSceneTexture = (sceneId: string): Promise<void> => {
      const existing = preloadPromisesRef.current.get(sceneId);
      if (existing) return existing;

      const scene = scenesRef.current.find((s) => s.id === sceneId);
      if (!scene) return Promise.resolve();

      const url = panoramaUrlForScene(scene);
      const promise = viewer.textureLoader
        .preloadPanorama(url)
        .then(() => undefined)
        .catch(() => {
          preloadPromisesRef.current.delete(sceneId);
        });
      preloadPromisesRef.current.set(sceneId, promise);
      return promise;
    };

    /** After the current scene has settled, preload every link target on it. */
    const preloadLinkTargetsForScene = (sceneId: string) => {
      const targets = hotspotsRef.current.filter(
        (h) =>
          h.scene_id === sceneId &&
          h.type === "link" &&
          typeof h.target_scene_id === "string",
      );
      for (const hotspot of targets) {
        if (hotspot.target_scene_id) {
          void preloadSceneTexture(hotspot.target_scene_id);
        }
      }
    };

    const applyMotionFrame = (blurPx: number, scale: number) => {
      motionBlurPxRef.current = blurPx;
      motionScaleRef.current = scale;
      syncCanvasVisuals(viewer, {
        adjustments: canvasAdjustmentsRef.current.adjustments,
        bypassed: canvasAdjustmentsRef.current.bypassed,
        blurPx,
        scale,
      });
    };

    const startIntroIfNeeded = (node: VirtualTourNode) => {
      if (!introPendingRef.current || introRanRef.current || cancelled) return;
      introPendingRef.current = false;
      introRanRef.current = true;

      const data = node.data as
        | { initialYaw?: number; initialPitch?: number }
        | undefined;
      const target = {
        yaw:
          typeof data?.initialYaw === "number"
            ? data.initialYaw
            : startScene.initial_yaw,
        pitch:
          typeof data?.initialPitch === "number"
            ? data.initialPitch
            : startScene.initial_pitch,
        zoom: 50,
      };

      // Ensure little-planet pose in case something moved the camera on load.
      applyLittlePlanetPose(viewer);
      introHandleRef.current = runLittlePlanetIntro(viewer, target);
    };

    const handleNodeChanged = (event: {
      node: VirtualTourNode;
      data?: { fromLink?: unknown };
    }) => {
      if (cancelled) return;
      bootstrappingRef.current = false;
      bootstrapSceneIdRef.current = null;
      clearLoadTimeout();
      setLoadTimedOut(false);
      setLoadError(null);
      setInfoOverlay(null);
      onSceneChangeRef.current?.(event.node.id);
      visitedScenesRef.current.add(event.node.id);

      // First-scene intro owns the camera — start only once texture is ready.
      if (introPendingRef.current && !event.data?.fromLink) {
        if (viewer.state.ready) {
          startIntroIfNeeded(event.node);
          revealPanorama();
        }
        return;
      }

      // Do NOT viewer.rotate() here. Non-link navigations bake initial view into
      // setPanorama via transitionOptions.rotateTo (as position). A post-load
      // rotate was the visible snap. Link navigations keep fromLinkPosition.

      // Preload link targets only after the current scene has finished loading.
      if (viewer.state.ready && modeRef.current === "view") {
        preloadLinkTargetsForScene(event.node.id);
      }
    };
    tour.addEventListener("node-changed", handleNodeChanged);

    // Intro / reveal only after the first panorama has fully loaded — never
    // during the setNodes bootstrap texture fetch.
    const handleReady = () => {
      if (cancelled) return;
      const node = tour.getCurrentNode();
      if (node && introPendingRef.current) {
        startIntroIfNeeded(node);
      } else if (node && !introPendingRef.current) {
        applyNodeInitialView(viewer, node, null);
      }
      revealPanorama();
      // First scene settled — now safe to preload its link targets.
      if (node && modeRef.current === "view") {
        preloadLinkTargetsForScene(node.id);
      }
    };
    viewer.addEventListener("ready", handleReady);

    const handlePanoramaError = (event: { error: Error }) => {
      if (cancelled) return;
      bootstrappingRef.current = false;
      clearLoadTimeout();
      setLoadError(
        event.error.message || "Failed to load panorama. Check the image path.",
      );
    };
    viewer.addEventListener("panorama-error", handlePanoramaError);

    const handleSelectMarker = (event: {
      marker: {
        id: string;
        data?: {
          type?: string;
          label?: string | null;
          content?: string | null;
          targetSceneId?: string | null;
          yaw?: number;
          pitch?: number;
          nadir?: boolean;
        };
      };
    }) => {
      // Reserved floor overlay — never select, navigate, or open popovers.
      if (isNadirMarkerId(event.marker.id) || event.marker.data?.nadir) {
        return;
      }

      if (modeRef.current === "edit") {
        onMarkerSelectRef.current?.(event.marker.id);
        return;
      }

      if (
        event.marker.data?.type === "link" &&
        event.marker.data.targetSceneId
      ) {
        setInfoOverlay(null);
        onHotspotActivateRef.current?.(event.marker.id);
        if (modeRef.current === "view") {
          const yaw = event.marker.data.yaw;
          const pitch = event.marker.data.pitch;
          const targetId = event.marker.data.targetSceneId;
          // Pass a synthetic fromLink so VT can rotate/zoom toward the hotspot.
          // Without this, setCurrentNode has no direction and zoom/rotate are no-ops.
          const fromLink: VirtualTourLink | undefined =
            typeof yaw === "number" && typeof pitch === "number"
              ? {
                  nodeId: targetId,
                  position: { yaw, pitch },
                }
              : undefined;

          const resolved = resolveTransitionOptions(
            viewerEffectsRef.current.transition,
          );

          // Kick preload immediately on click (also started on pointerenter).
          const preloadPromise = preloadSceneTexture(targetId);
          const walkthroughOn =
            viewerEffectsRef.current.walkthroughEnabled &&
            !prefersReducedMotion();

          /** Land fully zoomed out; walkthrough alone eases in slightly (≈8%). */
          const beginArrivalZoom = (fadeMs: number) => {
            // BEFORE the new scene fades in — max FOV, no post-reveal snap.
            viewer.zoom(ZOOM_WIDE);
            if (!walkthroughOn) {
              applyMotionFrame(0, 1);
              return;
            }
            motionBlurCancelRef.current?.();
            motionBlurCancelRef.current = runArrivalSettleAnimation(
              fadeMs,
              ZOOM_WIDE,
              ZOOM_WALKTHROUGH_SETTLE,
              motionBlurPxRef.current || 0,
              motionScaleRef.current || 1,
              (zoom, blurPx, scale) => {
                viewer.zoom(zoom);
                applyMotionFrame(blurPx, scale);
              },
            );
          };

          // Zoom walk-in: outgoing push, then arrival wide (+ optional walkthrough nudge).
          if (fromLink && resolved.isZoomWalkIn) {
            const linkYaw =
              typeof fromLink.position === "object" &&
              fromLink.position &&
              "yaw" in fromLink.position
                ? Number(fromLink.position.yaw)
                : yaw;
            const linkPitch =
              typeof fromLink.position === "object" &&
              fromLink.position &&
              "pitch" in fromLink.position
                ? Number(fromLink.position.pitch)
                : pitch;
            if (
              typeof linkYaw !== "number" ||
              typeof linkPitch !== "number" ||
              !Number.isFinite(linkYaw) ||
              !Number.isFinite(linkPitch)
            ) {
              void tour.setCurrentNode(targetId, undefined, fromLink);
              return;
            }

            const pushMs = Math.round(resolved.speed * 0.45);
            const fadeMs = Math.max(300, resolved.speed - pushMs);

            void (async () => {
              motionBlurCancelRef.current?.();
              motionBlurCancelRef.current = runPushBlurAnimation(
                pushMs,
                applyMotionFrame,
              );

              try {
                await viewer.animate({
                  yaw: linkYaw,
                  pitch: linkPitch,
                  zoom: ZOOM_WALK_IN_PUSH,
                  speed: pushMs,
                  easing: "inCubic",
                });
              } catch {
                // Aborted — still attempt arrival if possible.
              }

              // Hold the outgoing push while the target texture finishes.
              // No spinner unless the wait exceeds ~2s.
              let hintTimer: ReturnType<typeof setTimeout> | null =
                setTimeout(() => {
                  if (!cancelled) setLinkWaitHint(true);
                }, LINK_WAIT_HINT_MS);
              try {
                await preloadPromise;
              } catch {
                // Fall through — setCurrentNode / panorama-error handle failures.
              } finally {
                if (hintTimer) clearTimeout(hintTimer);
                hintTimer = null;
                setLinkWaitHint(false);
              }

              if (cancelled) return;

              beginArrivalZoom(fadeMs);

              void tour.setCurrentNode(
                targetId,
                {
                  effect: "fade",
                  speed: fadeMs,
                  showLoader: false,
                  // Zoom owned by beginArrivalZoom — do not pass zoomTo.
                  rotation: walkthroughOn,
                },
                fromLink,
              );
            })();
            return;
          }

          const useBlur =
            Boolean(fromLink) &&
            (resolved.forceMotionBlur ||
              viewerEffectsRef.current.transition.motionBlur) &&
            !prefersReducedMotion();

          if (useBlur) {
            motionBlurCancelRef.current?.();
            motionBlurCancelRef.current = runMotionBlurAnimation(
              resolved.speed,
              applyMotionFrame,
            );
          }

          // Non–zoom-walk-in link nav: wait briefly for preload without spinner.
          void (async () => {
            let hintTimer: ReturnType<typeof setTimeout> | null = setTimeout(
              () => {
                if (!cancelled) setLinkWaitHint(true);
              },
              LINK_WAIT_HINT_MS,
            );
            try {
              await preloadPromise;
            } catch {
              // ignore
            } finally {
              if (hintTimer) clearTimeout(hintTimer);
              setLinkWaitHint(false);
            }
            if (cancelled) return;

            const fadeMs = resolved.speed;
            beginArrivalZoom(fadeMs);

            void tour.setCurrentNode(
              targetId,
              { showLoader: false },
              fromLink,
            );
          })();
        }
        return;
      }

      if (event.marker.data?.type === "gallery") {
        setInfoOverlay(null);
        onHotspotActivateRef.current?.(event.marker.id);
        onOpenGalleryRef.current?.(event.marker.id);
        return;
      }

      if (event.marker.data?.type === "video") {
        setInfoOverlay(null);
        onHotspotActivateRef.current?.(event.marker.id);
        onOpenVideoRef.current?.(event.marker.id);
        return;
      }

      if (event.marker.data?.type === "info") {
        onHotspotActivateRef.current?.(event.marker.id);
        const yaw = event.marker.data.yaw;
        const pitch = event.marker.data.pitch;
        if (typeof yaw !== "number" || typeof pitch !== "number") {
          setInfoOverlay(null);
          return;
        }
        setInfoOverlay({
          id: event.marker.id,
          yaw,
          pitch,
          label: event.marker.data.label ?? null,
          content: event.marker.data.content ?? null,
        });
        return;
      }

      setInfoOverlay(null);
    };
    markersPlugin.addEventListener("select-marker", handleSelectMarker);

    const handleUnselectMarker = () => {
      setInfoOverlay(null);
    };
    markersPlugin.addEventListener("unselect-marker", handleUnselectMarker);

    // Eager preload on hover / press of a link marker (after first scene is ready).
    const maybePreloadFromMarkerEvent = (event: Event) => {
      if (modeRef.current !== "view" || !viewer.state.ready) return;
      const markerEl = markerElementFromTarget(event.target);
      if (!markerEl) return;
      const id = hotspotIdFromMarkerElement(markerEl);
      if (!id) return;
      const hotspot = hotspotsRef.current.find((h) => h.id === id);
      if (
        hotspot?.type === "link" &&
        typeof hotspot.target_scene_id === "string"
      ) {
        void preloadSceneTexture(hotspot.target_scene_id);
      }
    };
    viewer.container.addEventListener(
      "pointerenter",
      maybePreloadFromMarkerEvent,
      true,
    );
    viewer.container.addEventListener(
      "pointerdown",
      maybePreloadFromMarkerEvent,
      true,
    );

    if (mode === "edit" && currentSceneId) {
      syncEditMarkers(
        markersPlugin,
        hotspots.filter((hotspot) => hotspot.scene_id === currentSceneId),
        highlightedHotspotId,
        scenes,
        null,
        hotspotLayerCacheRef.current,
      );
      syncNadirMarker(
        markersPlugin,
        scenes.find((scene) => scene.id === currentSceneId),
        nadirSettings,
      );
    }

    // Listeners are attached — now start the tour in one shot.
    bootstrappingRef.current = true;
    bootstrapSceneIdRef.current = startId;
    armLoadTimeout();
    tour.setNodes(nodes, startId);
    visitedScenesRef.current = new Set([startId]);

    return () => {
      cancelled = true;
      clearLoadTimeout();
      if (revealRaf) cancelAnimationFrame(revealRaf);
      motionBlurCancelRef.current?.();
      motionBlurCancelRef.current = null;
      motionBlurPxRef.current = 0;
      motionScaleRef.current = 1;
      bootstrappingRef.current = false;
      bootstrapSceneIdRef.current = null;
      introHandleRef.current?.cancel();
      introHandleRef.current = null;
      setLinkWaitHint(false);
      viewer.container.removeEventListener(
        "pointerenter",
        maybePreloadFromMarkerEvent,
        true,
      );
      viewer.container.removeEventListener(
        "pointerdown",
        maybePreloadFromMarkerEvent,
        true,
      );
      // Invalidate in-flight setCurrentNode chains before destroy so they
      // abort cleanly instead of calling loadNode on a deleted datasource
      // (React Strict Mode remount).
      const tourState = tour as unknown as {
        state?: { loadingNode?: string | null };
      };
      if (tourState.state) {
        tourState.state.loadingNode = null;
      }
      viewer.destroy();
      viewerRef.current = null;
      nodesKeyRef.current = "";
      preloadPromisesRef.current.clear();
    };
    // Recreate on empty↔non-empty and explicit retry. Scene/hotspot updates
    // go through the nodes effect below. Do NOT recreate for intro/transition
    // setting changes — that would reintroduce the first-scene hang risk.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScenes, retryNonce]);

  // Replay little-planet intro without remounting the viewer.
  useEffect(() => {
    if (introReplayNonce <= 0) return;
    const viewer = viewerRef.current;
    if (!viewer || prefersReducedMotion()) return;
    if (viewerEffects.introEffect !== "little_planet") return;

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const node = tour?.getCurrentNode();
    const data = node?.data as
      | { initialYaw?: number; initialPitch?: number }
      | undefined;
    const scene =
      scenes.find((s) => s.id === (currentSceneId ?? startSceneId)) ??
      scenes[0];
    if (!scene) return;

    introHandleRef.current?.cancel();
    applyLittlePlanetPose(viewer);
    introHandleRef.current = runLittlePlanetIntro(viewer, {
      yaw:
        typeof data?.initialYaw === "number"
          ? data.initialYaw
          : scene.initial_yaw,
      pitch:
        typeof data?.initialPitch === "number"
          ? data.initialPitch
          : scene.initial_pitch,
      zoom: 50,
    });
  }, [
    introReplayNonce,
    viewerEffects.introEffect,
    scenes,
    currentSceneId,
    startSceneId,
  ]);

  // Update tour nodes when scenes (or view-mode hotspot graph) change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes) return;

    const nodes = buildNodes(
      scenes,
      hotspots,
      mode,
      nadirSettings,
      hotspotLayerCacheRef.current,
    );
    const key = serializeNodesKey(nodes, mode, nadirSettings);
    if (key === nodesKeyRef.current) return;
    nodesKeyRef.current = key;

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    if (!tour) return;

    const currentId = tour.getCurrentNode()?.id;
    const nextStart =
      currentId && nodes.some((node) => node.id === currentId)
        ? currentId
        : resolveStartId(scenes, currentSceneId ?? startSceneId);

    bootstrappingRef.current = true;
    bootstrapSceneIdRef.current = nextStart;
    tour.setNodes(nodes, nextStart);
  }, [scenes, hotspots, startSceneId, currentSceneId, hasScenes, mode, nadirSettings]);

  // Controlled scene selection (user / parent-driven).
  useEffect(() => {
    if (!currentSceneId || !hasScenes) return;

    const viewer = viewerRef.current;
    if (!viewer) return;

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    if (!tour) return;

    const currentId = tour.getCurrentNode()?.id;
    if (currentId === currentSceneId) return;

    // Initial setNodes(startId) already requested this node. Calling
    // setCurrentNode again aborts the in-flight texture load (ERR_ABORTED)
    // and is the first-scene hang under React Strict Mode.
    if (
      bootstrappingRef.current &&
      bootstrapSceneIdRef.current === currentSceneId
    ) {
      return;
    }

    void tour.setCurrentNode(currentSceneId);
  }, [currentSceneId, hasScenes]);

  // Edit mode: keep MarkersPlugin in sync without clearing the whole set.
  useEffect(() => {
    if (mode !== "edit" || !hasScenes || !currentSceneId) return;

    const viewer = viewerRef.current;
    if (!viewer) return;

    const markersPlugin = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    if (!markersPlugin) return;

    syncEditMarkers(
      markersPlugin,
      hotspots.filter((hotspot) => hotspot.scene_id === currentSceneId),
      highlightedHotspotId,
      scenes,
      draggingIdRef.current,
      hotspotLayerCacheRef.current,
    );
    syncNadirMarker(
      markersPlugin,
      scenes.find((scene) => scene.id === currentSceneId),
      nadirSettings,
    );
  }, [
    mode,
    hasScenes,
    currentSceneId,
    hotspots,
    scenes,
    selectedHotspotId,
    highlightedHotspotId,
    nadirSettings,
  ]);

  // Per-scene CSS filter on the WebGL canvas (not the viewer root — markers
  // live in a sibling `.psv-markers` layer and must stay unfiltered).
  // Nadir imageLayer is inside the canvas, so it receives the same filter.
  // Motion blur composes into the same filter string (never overwrites).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes) return;

    const sceneId =
      currentSceneId && scenes.some((scene) => scene.id === currentSceneId)
        ? currentSceneId
        : resolveStartId(scenes, startSceneId);
    const scene = scenes.find((item) => item.id === sceneId) ?? null;

    canvasAdjustmentsRef.current = {
      adjustments: scene,
      bypassed: adjustmentsBypassed,
    };

    syncCanvasVisuals(viewer, {
      adjustments: scene,
      bypassed: adjustmentsBypassed,
      blurPx: motionBlurPxRef.current,
      scale: motionScaleRef.current,
    });
  }, [
    hasScenes,
    scenes,
    currentSceneId,
    startSceneId,
    adjustmentsBypassed,
    retryNonce,
  ]);

  // Edit mode: drag markers to reposition (PSV has no built-in drag).
  useEffect(() => {
    const maybeViewer = viewerRef.current;
    if (!maybeViewer || !hasScenes || mode !== "edit") return;
    const viewer: Viewer = maybeViewer;

    const markersPlugin = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);
    if (!markersPlugin) return;

    const root = viewer.container;
    root.classList.add("st-editor-markers");

    type DragState = {
      id: string;
      pointerId: number;
      startX: number;
      startY: number;
      originYaw: number;
      originPitch: number;
      dragging: boolean;
      lastYaw: number;
      lastPitch: number;
      markerEl: HTMLElement;
    };

    let state: DragState | null = null;

    function restoreViewerControls() {
      viewer.setOption("mousemove", true);
    }

    function cancelDrag(restoreOrigin: boolean) {
      if (!state) return;
      const current = state;
      state = null;
      draggingIdRef.current = null;
      current.markerEl.classList.remove("st-marker-dragging");
      restoreViewerControls();
      try {
        current.markerEl.releasePointerCapture(current.pointerId);
      } catch {
        // already released
      }

      if (restoreOrigin) {
        markersPlugin.updateMarker({
          id: current.id,
          position: { yaw: current.originYaw, pitch: current.originPitch },
        });
        onMarkerMovingRef.current?.(
          current.id,
          current.originYaw,
          current.originPitch,
        );
      }
    }

    function onPointerDown(event: PointerEvent) {
      if (event.button !== 0 && event.pointerType === "mouse") return;
      const markerEl = markerElementFromTarget(event.target);
      if (!markerEl) return;
      const id = hotspotIdFromMarkerElement(markerEl);
      if (!id || isNadirMarkerId(id)) return;

      const hotspot = hotspotsRef.current.find((item) => item.id === id);
      if (!hotspot) return;

      // Disable panorama orbit immediately so clicks/drags on markers don't spin the view.
      viewer.setOption("mousemove", false);

      state = {
        id,
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originYaw: hotspot.yaw,
        originPitch: hotspot.pitch,
        dragging: false,
        lastYaw: hotspot.yaw,
        lastPitch: hotspot.pitch,
        markerEl,
      };
      draggingIdRef.current = id;
      markerEl.setPointerCapture(event.pointerId);
    }

    function onPointerMove(event: PointerEvent) {
      if (!state || event.pointerId !== state.pointerId) return;

      const dx = event.clientX - state.startX;
      const dy = event.clientY - state.startY;
      if (!state.dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
        state.dragging = true;
        state.markerEl.classList.add("st-marker-dragging");
        event.preventDefault();
      } else {
        event.preventDefault();
      }

      const rect = viewer.container.getBoundingClientRect();
      const point = {
        x: event.clientX - rect.left,
        y: event.clientY - rect.top,
      };
      let position;
      try {
        position = viewer.dataHelper.viewerCoordsToSphericalCoords(point);
      } catch {
        return;
      }

      state.lastYaw = position.yaw;
      state.lastPitch = position.pitch;
      markersPlugin.updateMarker({
        id: state.id,
        position: { yaw: position.yaw, pitch: position.pitch },
      });
      onMarkerMovingRef.current?.(state.id, position.yaw, position.pitch);

      setInfoOverlay((prev) =>
        prev && prev.id === state!.id
          ? { ...prev, yaw: position.yaw, pitch: position.pitch }
          : prev,
      );
    }

    function onPointerUp(event: PointerEvent) {
      if (!state || event.pointerId !== state.pointerId) return;
      const current = state;
      const wasDragging = current.dragging;
      state = null;
      draggingIdRef.current = null;
      current.markerEl.classList.remove("st-marker-dragging");
      restoreViewerControls();
      try {
        current.markerEl.releasePointerCapture(current.pointerId);
      } catch {
        // already released
      }

      if (wasDragging) {
        suppressClickRef.current = true;
        window.setTimeout(() => {
          suppressClickRef.current = false;
        }, 0);
        onMarkerMovedRef.current?.(
          current.id,
          current.lastYaw,
          current.lastPitch,
        );
      }
    }

    function onPointerCancel(event: PointerEvent) {
      if (!state || event.pointerId !== state.pointerId) return;
      cancelDrag(true);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && state) {
        event.preventDefault();
        cancelDrag(true);
      }
    }

    root.addEventListener("pointerdown", onPointerDown);
    root.addEventListener("pointermove", onPointerMove);
    root.addEventListener("pointerup", onPointerUp);
    root.addEventListener("pointercancel", onPointerCancel);
    window.addEventListener("keydown", onKeyDown);

    return () => {
      root.classList.remove("st-editor-markers");
      root.removeEventListener("pointerdown", onPointerDown);
      root.removeEventListener("pointermove", onPointerMove);
      root.removeEventListener("pointerup", onPointerUp);
      root.removeEventListener("pointercancel", onPointerCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (state) cancelDrag(true);
    };
  }, [mode, hasScenes, retryNonce]);

  // Edit-mode panorama click (empty space only — markers use select-marker).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes || mode !== "edit") return;

    const handleClick = (event: events.ClickEvent) => {
      if (event.data.rightclick) return;
      // Ignore the click that ends a drag.
      if (suppressClickRef.current) return;

      const markerId =
        event.data.marker && typeof event.data.marker === "object"
          ? ((event.data.marker as { id?: string }).id ?? undefined)
          : undefined;

      if (!markerId) {
        setInfoOverlay(null);
      }

      onPanoramaClickRef.current?.({
        yaw: event.data.yaw,
        pitch: event.data.pitch,
        clientX: event.data.clientX,
        clientY: event.data.clientY,
        markerId,
      });
    };

    viewer.addEventListener(events.ClickEvent.type, handleClick);
    return () => {
      viewer.removeEventListener(events.ClickEvent.type, handleClick);
    };
  }, [mode, hasScenes, retryNonce]);

  // View mode: close info popover when clicking empty panorama.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes || mode !== "view" || !infoOverlay) return;

    const handleClick = (event: events.ClickEvent) => {
      if (event.data.rightclick) return;
      const markerId =
        event.data.marker && typeof event.data.marker === "object"
          ? ((event.data.marker as { id?: string }).id ?? undefined)
          : undefined;
      if (!markerId) {
        setInfoOverlay(null);
      }
    };

    viewer.addEventListener(events.ClickEvent.type, handleClick);
    return () => {
      viewer.removeEventListener(events.ClickEvent.type, handleClick);
    };
  }, [mode, hasScenes, infoOverlay, retryNonce]);

  // Keep open popover content/position in sync with hotspot edits.
  useEffect(() => {
    if (!infoOverlay) return;
    if (draggingIdRef.current === infoOverlay.id) return;
    const hotspot = hotspots.find((item) => item.id === infoOverlay.id);
    if (!hotspot || hotspot.type !== "info") {
      setInfoOverlay(null);
      return;
    }
    if (
      hotspot.label === infoOverlay.label &&
      hotspot.content === infoOverlay.content &&
      hotspot.yaw === infoOverlay.yaw &&
      hotspot.pitch === infoOverlay.pitch
    ) {
      return;
    }
    setInfoOverlay({
      id: hotspot.id,
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
      label: hotspot.label,
      content: hotspot.content,
    });
  }, [hotspots, infoOverlay]);

  function handleRetry() {
    setLoadError(null);
    setLoadTimedOut(false);
    setRetryNonce((n) => n + 1);
  }

  function closeInfoOverlay() {
    setInfoOverlay(null);
  }

  if (!hasScenes) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[240px] items-center justify-center rounded-xl bg-muted text-sm text-muted-foreground",
          className,
        )}
      >
        Upload a scene to preview the tour.
      </div>
    );
  }

  const showFailure = Boolean(loadError) || loadTimedOut;

  return (
    <div
      role="img"
      aria-label={ariaLabel ?? "360° panorama viewer"}
      className={cn(
        // Parent must give this an explicit height — WebGL canvases in a
        // zero-height container render nothing. Default fills the parent.
        "relative h-full min-h-[240px] overflow-hidden rounded-xl bg-black",
        placing && "cursor-crosshair",
        className,
      )}
    >
      <div
        ref={containerRef}
        className={cn(
          "size-full transition-opacity duration-300 ease-out",
          panoramaRevealed ? "opacity-100" : "opacity-0",
        )}
        style={viewerHostStyle}
      />

      {!panoramaRevealed && !showFailure ? (
        <div
          className="absolute inset-0 z-[80] flex items-center justify-center bg-black"
          aria-hidden
        >
          <div className="size-8 animate-spin rounded-full border-2 border-white/25 border-t-white" />
        </div>
      ) : null}

      {linkWaitHint && panoramaRevealed && !showFailure ? (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-8 z-[70] flex justify-center"
          aria-live="polite"
        >
          <span className="rounded-md bg-black/55 px-3 py-1.5 text-xs text-white/80 backdrop-blur-sm">
            Loading next scene…
          </span>
        </div>
      ) : null}

      {showFailure ? (
        <div className="absolute inset-0 z-[90] flex flex-col items-center justify-center gap-3 bg-black/80 p-6 text-center text-sm text-white">
          <p>
            {loadError ||
              "This panorama is taking too long to load. Check your connection and try again."}
          </p>
          <button
            type="button"
            className="min-h-11 rounded-md bg-white px-4 text-sm font-medium text-black focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            onClick={handleRetry}
          >
            Retry
          </button>
        </div>
      ) : null}

      {infoOverlay && viewerRef.current ? (
        <InfoHotspotPopover
          viewer={viewerRef.current}
          yaw={infoOverlay.yaw}
          pitch={infoOverlay.pitch}
          label={infoOverlay.label}
          content={infoOverlay.content}
          onClose={closeInfoOverlay}
          preferLeft={mode === "edit"}
        />
      ) : null}
    </div>
  );
}

const viewerHostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
};
