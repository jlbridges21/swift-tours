"use client";

/**
 * Coordinates are RADIANS end-to-end.
 * Photo Sphere Viewer uses radians internally; the hotspots / scenes tables store
 * yaw & pitch as double precision radians. Do not convert to degrees — the hotspot
 * editor depends on this being consistent.
 */

import { Viewer, events } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
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

export type PanoramaViewerProps = {
  scenes: PanoramaViewerScene[];
  hotspots: PanoramaViewerHotspot[];
  startSceneId?: string;
  /** Controlled active node — updates via setCurrentNode without rebuilding the viewer. */
  currentSceneId?: string;
  mode: "view" | "edit";
  className?: string;
  onSceneChange?: (sceneId: string) => void;
  onPanoramaClick?: (yaw: number, pitch: number) => void;
  onViewerReady?: (viewer: Viewer) => void;
};

type InfoOverlay = {
  label: string | null;
  content: string | null;
};

const INFO_MARKER_HTML = `<div style="display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:rgba(15,15,15,0.85);color:#fff;font-size:13px;font-weight:600;font-family:system-ui,sans-serif;border:2px solid rgba(255,255,255,0.9);cursor:pointer;">i</div>`;

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
): VirtualTourNode[] {
  const sceneIds = new Set(scenes.map((scene) => scene.id));

  return scenes.map((scene) => {
    const sceneHotspots = hotspots.filter(
      (hotspot) => hotspot.scene_id === scene.id,
    );

    const links: VirtualTourLink[] = sceneHotspots
      .filter(
        (hotspot) =>
          hotspot.type === "link" &&
          hotspot.target_scene_id !== null &&
          sceneIds.has(hotspot.target_scene_id),
      )
      .map((hotspot) => ({
        nodeId: hotspot.target_scene_id as string,
        // Manual mode — yaw/pitch in radians (not latitude/longitude).
        position: {
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
        },
        data: { label: hotspot.label },
      }));

    const markers = sceneHotspots
      .filter((hotspot) => hotspot.type === "info")
      .map((hotspot) => ({
        id: hotspot.id,
        position: {
          yaw: hotspot.yaw,
          pitch: hotspot.pitch,
        },
        html: INFO_MARKER_HTML,
        size: { width: 28, height: 28 },
        anchor: "center center",
        tooltip: hotspot.label ?? "Info",
        data: {
          kind: "info" as const,
          label: hotspot.label,
          content: hotspot.content,
        },
      }));

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

function serializeNodesKey(nodes: VirtualTourNode[]): string {
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

export function PanoramaViewer({
  scenes,
  hotspots,
  startSceneId,
  currentSceneId,
  mode,
  className,
  onSceneChange,
  onPanoramaClick,
  onViewerReady,
}: PanoramaViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<Viewer | null>(null);
  const nodesKeyRef = useRef<string>("");
  const onSceneChangeRef = useRef(onSceneChange);
  const onPanoramaClickRef = useRef(onPanoramaClick);
  const onViewerReadyRef = useRef(onViewerReady);

  const [loadError, setLoadError] = useState<string | null>(null);
  const [infoOverlay, setInfoOverlay] = useState<InfoOverlay | null>(null);

  onSceneChangeRef.current = onSceneChange;
  onPanoramaClickRef.current = onPanoramaClick;
  onViewerReadyRef.current = onViewerReady;

  const hasScenes = scenes.length > 0;

  const startScene = useMemo(() => {
    if (!hasScenes) return null;
    const preferred = currentSceneId ?? startSceneId;
    const id = resolveStartId(scenes, preferred);
    return scenes.find((scene) => scene.id === id) ?? scenes[0];
  }, [hasScenes, scenes, startSceneId, currentSceneId]);

  // Instantiate once per "has scenes" lifetime. StrictMode double-mount is
  // handled by the cleanup calling viewer.destroy().
  useEffect(() => {
    if (!hasScenes || !containerRef.current || !startScene) {
      return;
    }

    setLoadError(null);
    setInfoOverlay(null);

    const nodes = buildNodes(scenes, hotspots);
    const startId = resolveStartId(scenes, currentSceneId ?? startSceneId);

    const viewer = new Viewer({
      container: containerRef.current,
      navbar: ["zoom", "move", "fullscreen"],
      defaultYaw: startScene.initial_yaw,
      defaultPitch: startScene.initial_pitch,
      plugins: [
        MarkersPlugin.withConfig({}),
        VirtualTourPlugin.withConfig({
          dataMode: "client",
          positionMode: "manual",
          nodes,
          startNodeId: startId,
        }),
      ],
    });

    viewerRef.current = viewer;
    nodesKeyRef.current = serializeNodesKey(nodes);
    onViewerReadyRef.current?.(viewer);

    const tour = viewer.getPlugin<VirtualTourPlugin>(VirtualTourPlugin);
    const markers = viewer.getPlugin<MarkersPlugin>(MarkersPlugin);

    if (!tour || !markers) {
      viewer.destroy();
      viewerRef.current = null;
      setLoadError("Failed to initialize tour plugins.");
      return;
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
        data?: {
          kind?: string;
          label?: string | null;
          content?: string | null;
        };
      };
    }) => {
      const data = event.marker.data;
      if (data?.kind !== "info") return;
      setInfoOverlay({
        label: data.label ?? null,
        content: data.content ?? null,
      });
    };
    markers.addEventListener("select-marker", handleSelectMarker);

    const handleUnselectMarker = () => {
      setInfoOverlay(null);
    };
    markers.addEventListener("unselect-marker", handleUnselectMarker);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      nodesKeyRef.current = "";
    };
    // Intentionally only recreate when going between empty ↔ non-empty.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasScenes]);

  // Update nodes/links on prop changes without recreating the Viewer.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes) return;

    const nodes = buildNodes(scenes, hotspots);
    const key = serializeNodesKey(nodes);
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
  }, [scenes, hotspots, startSceneId, hasScenes]);

  // Controlled scene selection from the parent (sidebar). Bail if already current
  // so onSceneChange → setState → setCurrentNode cannot loop.
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

  // Edit-mode panorama click → yaw/pitch in radians.
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || !hasScenes || mode !== "edit") return;

    const handleClick = (event: events.ClickEvent) => {
      if (event.data.rightclick) return;
      onPanoramaClickRef.current?.(event.data.yaw, event.data.pitch);
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

      {infoOverlay ? (
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
