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
import { cn } from "@/lib/utils";
import type { Hotspot, Scene } from "@/types";

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
  mode: "view" | "edit";
  className?: string;
  onSceneChange?: (sceneId: string) => void;
  onPanoramaClick?: (payload: PanoramaClickPayload) => void;
  onMarkerSelect?: (hotspotId: string) => void;
  onViewerReady?: (viewer: Viewer) => void;
};

type InfoOverlay = {
  label: string | null;
  content: string | null;
};

function markerHtml(type: "link" | "info", selected: boolean): string {
  const border = selected ? "#3b82f6" : "rgba(255,255,255,0.95)";
  const bg =
    type === "link" ? "rgba(37,99,235,0.92)" : "rgba(15,15,15,0.88)";
  const icon = type === "link" ? "→" : "i";
  return `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${bg};color:#fff;font-size:13px;font-weight:700;font-family:system-ui,sans-serif;border:2px solid ${border};box-shadow:${selected ? "0 0 0 3px rgba(59,130,246,0.45)" : "none"};cursor:pointer;user-select:none;">${icon}</div>`;
}

export function hotspotToMarkerConfig(
  hotspot: PanoramaViewerHotspot,
  selected: boolean,
): MarkerConfig {
  const type = hotspot.type === "link" ? "link" : "info";
  return {
    id: hotspot.id,
    position: { yaw: hotspot.yaw, pitch: hotspot.pitch },
    html: markerHtml(type, selected),
    size: { width: 28, height: 28 },
    anchor: "center center",
    tooltip: hotspot.label ?? (type === "link" ? "Link" : "Info"),
    data: {
      hotspotId: hotspot.id,
      type,
      label: hotspot.label,
      content: hotspot.content,
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
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  return scenes.map((scene) => {
    const sceneHotspots = hotspots.filter(
      (hotspot) => hotspot.scene_id === scene.id,
    );

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
      };
    }

    const links: VirtualTourLink[] = sceneHotspots
      .filter(
        (hotspot) =>
          hotspot.type === "link" &&
          hotspot.target_scene_id !== null &&
          sceneIds.has(hotspot.target_scene_id),
      )
      .map((hotspot) => ({
        nodeId: hotspot.target_scene_id as string,
        position: {
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
        },
        data: { label: hotspot.label },
      }));

    const markers = sceneHotspots
      .filter((hotspot) => hotspot.type === "info")
      .map((hotspot) => hotspotToMarkerConfig(hotspot, false));

    return {
      id: scene.id,
      name: scene.name,
      panorama: publicUrl(scene.storage_path),
      thumbnail: scene.thumbnail_path
        ? publicUrl(scene.thumbnail_path)
        : undefined,
      links,
      markers,
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
      })),
    );
  }

  return JSON.stringify(
    nodes.map((node) => ({
      id: node.id,
      panorama: node.panorama,
      thumbnail: node.thumbnail,
      name: node.name,
      links: (node.links ?? []).map((link) => ({
        nodeId: link.nodeId,
        position: link.position,
        data: link.data,
      })),
      markers: (node.markers ?? []).map((marker) => ({
        id: marker.id,
        position: marker.position,
        data: marker.data,
        tooltip: marker.tooltip,
      })),
    })),
  );
}

function syncEditMarkers(
  markers: MarkersPlugin,
  sceneHotspots: PanoramaViewerHotspot[],
  selectedHotspotId: string | null | undefined,
) {
  const existingIds = new Set(markers.getMarkers().map((marker) => marker.id));
  const nextIds = new Set(sceneHotspots.map((hotspot) => hotspot.id));

  for (const hotspot of sceneHotspots) {
    const config = hotspotToMarkerConfig(
      hotspot,
      hotspot.id === selectedHotspotId,
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

export function PanoramaViewer({
  scenes,
  hotspots,
  startSceneId,
  currentSceneId,
  selectedHotspotId,
  mode,
  className,
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

  const [loadError, setLoadError] = useState<string | null>(null);
  const [infoOverlay, setInfoOverlay] = useState<InfoOverlay | null>(null);

  modeRef.current = mode;
  onSceneChangeRef.current = onSceneChange;
  onPanoramaClickRef.current = onPanoramaClick;
  onMarkerSelectRef.current = onMarkerSelect;
  onViewerReadyRef.current = onViewerReady;

  const hasScenes = scenes.length > 0;

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
    setInfoOverlay(null);

    const nodes = buildNodes(scenes, hotspots, mode);
    const startId = resolveStartId(scenes, currentSceneId ?? startSceneId);

    const viewer = new Viewer({
      container: containerRef.current,
      navbar: ["zoom", "move", "fullscreen"],
      defaultYaw: startScene.initial_yaw,
      defaultPitch: startScene.initial_pitch,
      plugins: [
        MarkersPlugin.withConfig({
          // Marker clicks fire select-marker only — not also viewer click.
          clickEventOnMarker: false,
        }),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
          nodes,
          startNodeId: startId,
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

    if (mode === "edit" && currentSceneId) {
      syncEditMarkers(
        markersPlugin,
        hotspots.filter((hotspot) => hotspot.scene_id === currentSceneId),
        selectedHotspotId,
      );
    }

    const handleNodeChanged = (event: { node: { id: string } }) => {
      setInfoOverlay(null);
      onSceneChangeRef.current?.(event.node.id);
    };
    tour.addEventListener("node-changed", handleNodeChanged);

    const handlePanoramaError = (event: { error: Error }) => {
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
        };
      };
    }) => {
      if (modeRef.current === "edit") {
        onMarkerSelectRef.current?.(event.marker.id);
        return;
      }

      if (event.marker.data?.type === "info") {
        setInfoOverlay({
          label: event.marker.data.label ?? null,
          content: event.marker.data.content ?? null,
        });
      }
    };
    markersPlugin.addEventListener("select-marker", handleSelectMarker);

    const handleUnselectMarker = () => {
      if (modeRef.current !== "edit") {
        setInfoOverlay(null);
      }
    };
    markersPlugin.addEventListener("unselect-marker", handleUnselectMarker);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      nodesKeyRef.current = "";
    };
    // Intentionally only recreate when going between empty ↔ non-empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScenes]);

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
        : resolveStartId(scenes, startSceneId);

    tour.setNodes(nodes, nextStart);
  }, [scenes, hotspots, startSceneId, hasScenes, mode]);

  // Controlled scene selection.
  useEffect(() => {
    if (!currentSceneId || !hasScenes) return;

    const viewer = viewerRef.current;
    if (!viewer) return;

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    if (!tour) return;

    const currentId = tour.getCurrentNode()?.id;
    if (currentId === currentSceneId) return;

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
      selectedHotspotId,
    );
  }, [mode, hasScenes, currentSceneId, hotspots, selectedHotspotId]);

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
  }, [mode, hasScenes]);

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

  return (
    <div
      className={cn(
        // Parent must give this an explicit height — WebGL canvases in a
        // zero-height container render nothing. Default fills the parent.
        "relative h-full min-h-[240px] overflow-hidden rounded-xl bg-black",
        className,
      )}
    >
      <div ref={containerRef} className="size-full" style={viewerHostStyle} />

      {loadError ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/80 p-6 text-center text-sm text-white">
          {loadError}
        </div>
      ) : null}

      {mode === "view" && infoOverlay ? (
        <div className="absolute bottom-4 left-4 z-10 max-w-sm rounded-lg bg-background/95 p-3 text-sm shadow-md ring-1 ring-foreground/10">
          {infoOverlay.label ? (
            <p className="font-medium">{infoOverlay.label}</p>
          ) : null}
          {infoOverlay.content ? (
            <p className="mt-1 text-muted-foreground">{infoOverlay.content}</p>
          ) : null}
          {!infoOverlay.label && !infoOverlay.content ? (
            <p className="text-muted-foreground">Info hotspot</p>
          ) : null}
          <button
            type="button"
            className="mt-2 text-xs text-muted-foreground underline-offset-2 hover:underline"
            onClick={() => setInfoOverlay(null)}
          >
            Close
          </button>
        </div>
      ) : null}
    </div>
  );
}

const viewerHostStyle: CSSProperties = {
  width: "100%",
  height: "100%",
};
