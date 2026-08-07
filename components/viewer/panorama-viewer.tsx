"use client";

/**
 * Coordinates are RADIANS end-to-end.
 * Photo Sphere Viewer uses radians internally; the hotspots / scenes tables store
 * yaw & pitch as double precision radians. Do not convert to degrees.
 */

import { Viewer, events } from "@photo-sphere-viewer/core";
import {
  MarkersPlugin,
  type MarkerConfig,
} from "@photo-sphere-viewer/markers-plugin";
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

import { publicUrl } from "@/lib/storage";
import {
  buildHotspotMarkerHtml,
  clampHotspotSize,
  escapeHtml,
  isLabelVisibility,
  sanitizeHotspotColor,
} from "@/lib/hotspot-styles";
import { cn } from "@/lib/utils";
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
  | "initial_yaw"
  | "initial_pitch"
>;

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
>;

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
  /** Armed one-shot reposition mode — highlight this marker and use crosshair cursor. */
  movingHotspotId?: string | null;
  mode: "view" | "edit";
  className?: string;
  ariaLabel?: string;
  onSceneChange?: (sceneId: string) => void;
  onPanoramaClick?: (payload: PanoramaClickPayload) => void;
  onMarkerSelect?: (hotspotId: string) => void;
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
): MarkerConfig {
  const type = hotspot.type === "link" ? "link" : "info";
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
    (type === "link" ? "Go to scene" : "Info");

  return {
    id: hotspot.id,
    position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
    html: buildHotspotMarkerHtml({
      shape: hotspot.style_shape,
      color: sanitizeHotspotColor(hotspot.style_color),
      size: hotspot.style_size,
      animation: hotspot.style_animation,
      labelVisibility: hotspot.label_visibility,
      label: hotspot.label,
      fallbackLabel: targetName,
      selected,
    }),
    size,
    anchor: "center center",
    // PSV may render tooltip content as HTML — escape user/scene names.
    tooltip: visibility === "hover" ? escapeHtml(tooltipLabel) : undefined,
    data: {
      hotspotId: hotspot.id,
      type,
      label: hotspot.label,
      content: hotspot.content,
      targetSceneId: hotspot.target_scene_id,
      yaw: hotspot.yaw,
      pitch: hotspot.pitch,
    },
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

function buildNodes(
  scenes: PanoramaViewerScene[],
  hotspots: PanoramaViewerHotspot[],
  mode: "view" | "edit",
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

    // Edit mode: no VirtualTour links (they'd navigate on click). Markers are
    // managed separately via MarkersPlugin add/update/remove.
    if (mode === "edit") {
      return {
        id: scene.id,
        name: scene.name,
        panorama: publicUrl(scene.storage_path),
        thumbnail: scene.thumbnail_path
          ? publicUrl(scene.thumbnail_path)
          : undefined,
        links: [],
        markers: [],
        data: nodeData,
      };
    }

    // View mode: style every hotspot as a MarkersPlugin marker (same HTML as
    // edit). Link navigation is handled in select-marker → setCurrentNode so
    // appearance stays identical. Empty VT links avoids the default 3D arrows.
    const markers = sceneHotspots.map((hotspot) =>
      hotspotToMarkerConfig(hotspot, false, scenes),
    );

    return {
      id: scene.id,
      name: scene.name,
      panorama: publicUrl(scene.storage_path),
      thumbnail: scene.thumbnail_path
        ? publicUrl(scene.thumbnail_path)
        : undefined,
      links: [] as VirtualTourLink[],
      markers,
      data: nodeData,
    };
  });
}

function serializeNodesKey(
  nodes: VirtualTourNode[],
  mode: "view" | "edit",
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

  return JSON.stringify(
    nodes.map((node) => ({
      id: node.id,
      panorama: node.panorama,
      thumbnail: node.thumbnail,
      name: node.name,
      data: node.data,
      markers: (node.markers ?? []).map((marker) => ({
        id: marker.id,
        position: marker.position,
        html: marker.html,
        size: marker.size,
        tooltip: marker.tooltip,
        data: marker.data,
      })),
    })),
  );
}

function syncEditMarkers(
  markers: MarkersPlugin,
  sceneHotspots: PanoramaViewerHotspot[],
  highlightedHotspotId: string | null | undefined,
  scenes: PanoramaViewerScene[],
) {
  const existingIds = new Set(markers.getMarkers().map((marker) => marker.id));
  const nextIds = new Set(sceneHotspots.map((hotspot) => hotspot.id));

  for (const hotspot of sceneHotspots) {
    const config = hotspotToMarkerConfig(
      hotspot,
      hotspot.id === highlightedHotspotId,
      scenes,
    );
    if (existingIds.has(hotspot.id)) {
      markers.updateMarker(config);
    } else {
      markers.addMarker(config);
    }
  }

  for (const id of existingIds) {
    if (!nextIds.has(id)) {
      markers.removeMarker(id);
    }
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

export function PanoramaViewer({
  scenes,
  hotspots,
  startSceneId,
  currentSceneId,
  selectedHotspotId,
  movingHotspotId,
  mode,
  className,
  ariaLabel,
  onSceneChange,
  onPanoramaClick,
  onMarkerSelect,
  onViewerReady,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const nodesKeyRef = useRef<string>("");
  const modeRef = useRef(mode);
  const onSceneChangeRef = useRef(onSceneChange);
  const onPanoramaClickRef = useRef(onPanoramaClick);
  const onMarkerSelectRef = useRef(onMarkerSelect);
  const onViewerReadyRef = useRef(onViewerReady);
  /** True while the initial setNodes→setCurrentNode load is in flight. */
  const bootstrappingRef = useRef(false);
  /** Scene id the controlled effect should not re-request during bootstrap. */
  const bootstrapSceneIdRef = useRef<string | null>(null);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  const [infoOverlay, setInfoOverlay] = useState<InfoOverlay | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  modeRef.current = mode;
  onSceneChangeRef.current = onSceneChange;
  onPanoramaClickRef.current = onPanoramaClick;
  onMarkerSelectRef.current = onMarkerSelect;
  onViewerReadyRef.current = onViewerReady;

  const hasScenes = scenes.length > 0;
  const highlightedHotspotId = movingHotspotId ?? selectedHotspotId;

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

    const nodes = buildNodes(scenes, hotspots, mode);
    const startId = resolveStartId(scenes, currentSceneId ?? startSceneId);
    let cancelled = false;
    let loadTimeoutId: ReturnType<typeof setTimeout> | null = null;

    // Create the viewer WITHOUT feeding nodes into plugin config. Plugin.init()
    // would otherwise call setNodes→setCurrentNode before our React effects run;
    // the controlled currentSceneId effect then aborts that in-flight load
    // (ERR_ABORTED), which is the first-scene hang under Strict Mode.
    const viewer = new Viewer({
      container: containerRef.current,
      navbar: ["zoom", "move", "fullscreen"],
      defaultYaw: startScene.initial_yaw,
      defaultPitch: startScene.initial_pitch,
      mousewheel: true,
      mousemove: true,
      touchmoveTwoFingers: false,
      plugins: [
        MarkersPlugin.withConfig({
          clickEventOnMarker: false,
        }),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
        }),
      ],
    });

    viewerRef.current = viewer;
    nodesKeyRef.current = serializeNodesKey(nodes, mode);
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
      }, 30_000);
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
      applyNodeInitialView(viewer, event.node, event.data?.fromLink);
    };
    tour.addEventListener("node-changed", handleNodeChanged);

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
        };
      };
    }) => {
      if (modeRef.current === "edit") {
        onMarkerSelectRef.current?.(event.marker.id);
      }

      if (
        event.marker.data?.type === "link" &&
        event.marker.data.targetSceneId
      ) {
        setInfoOverlay(null);
        if (modeRef.current === "view") {
          void tour.setCurrentNode(event.marker.data.targetSceneId);
        }
        return;
      }

      if (event.marker.data?.type === "info") {
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

    if (mode === "edit" && currentSceneId) {
      syncEditMarkers(
        markersPlugin,
        hotspots.filter((hotspot) => hotspot.scene_id === currentSceneId),
        highlightedHotspotId,
        scenes,
      );
    }

    // Listeners are attached — now start the tour in one shot.
    bootstrappingRef.current = true;
    bootstrapSceneIdRef.current = startId;
    armLoadTimeout();
    tour.setNodes(nodes, startId);

    return () => {
      cancelled = true;
      clearLoadTimeout();
      bootstrappingRef.current = false;
      bootstrapSceneIdRef.current = null;
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
    };
    // Recreate on empty↔non-empty and explicit retry. Scene/hotspot updates
    // go through the nodes effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScenes, retryNonce]);

  // Update tour nodes when scenes (or view-mode hotspot graph) change.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes) return;

    const nodes = buildNodes(scenes, hotspots, mode);
    const key = serializeNodesKey(nodes, mode);
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
  }, [scenes, hotspots, startSceneId, currentSceneId, hasScenes, mode]);

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
    );
  }, [
    mode,
    hasScenes,
    currentSceneId,
    hotspots,
    scenes,
    selectedHotspotId,
    movingHotspotId,
    highlightedHotspotId,
  ]);

  // Edit-mode panorama click (empty space only — markers use select-marker).
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes || mode !== "edit") return;

    const handleClick = (event: events.ClickEvent) => {
      if (event.data.rightclick) return;

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
        movingHotspotId && "cursor-crosshair",
        className,
      )}
    >
      <div ref={containerRef} className="size-full" style={viewerHostStyle} />

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
        />
      ) : null}
    </div>
  );
}

const viewerHostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
};
