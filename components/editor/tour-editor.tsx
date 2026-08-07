"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import { MarkersPlugin } from "@photo-sphere-viewer/markers-plugin";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  createHotspot,
  updateHotspot,
  updateSceneInitialView,
  updateTourTitle,
} from "@/app/dashboard/tours/[id]/actions";
import { HotspotPanel } from "@/components/editor/hotspot-panel";
import {
  PlaceHotspotPanel,
  type PlaceHotspotDraft,
} from "@/components/editor/place-hotspot-panel";
import { SceneSidebar } from "@/components/editor/scene-sidebar";
import {
  SaveStatusIndicator,
  SaveStatusProvider,
  useSaveStatus,
} from "@/components/editor/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  PanoramaViewer,
  type PanoramaClickPayload,
} from "@/components/viewer/panorama-viewer-client";
import type { Hotspot, Scene, Tour } from "@/types";

type TourEditorProps = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
  userId: string;
};

function normalizeYaw(yaw: number): number {
  const twoPi = Math.PI * 2;
  return ((yaw % twoPi) + twoPi) % twoPi;
}

function reciprocalYaw(yaw: number): number {
  return normalizeYaw(yaw + Math.PI);
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
  hotspots: initialHotspots,
  userId,
}: TourEditorProps) {
  const { run, status } = useSaveStatus();
  const viewerRef = useRef<Viewer | null>(null);

  const [scenes, setScenes] = useState(initialScenes);
  const [hotspots, setHotspots] = useState(initialHotspots);
  const [title, setTitle] = useState(tour.title);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    initialScenes[0]?.id ?? null,
  );
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(
    null,
  );
  const [movingHotspotId, setMovingHotspotId] = useState<string | null>(null);
  const [placeDraft, setPlaceDraft] = useState<PlaceHotspotDraft | null>(null);

  useEffect(() => {
    setScenes(initialScenes);
  }, [initialScenes]);

  useEffect(() => {
    setHotspots(initialHotspots);
  }, [initialHotspots]);

  useEffect(() => {
    setTitle(tour.title);
  }, [tour.title]);

  useEffect(() => {
    if (scenes.length === 0) {
      setActiveSceneId(null);
      return;
    }
    if (!activeSceneId || !scenes.some((scene) => scene.id === activeSceneId)) {
      setActiveSceneId(scenes[0].id);
    }
  }, [scenes, activeSceneId]);

  useEffect(() => {
    setSelectedHotspotId(null);
    setMovingHotspotId(null);
    setPlaceDraft(null);
  }, [activeSceneId]);

  // Esc cancels armed move mode.
  useEffect(() => {
    if (!movingHotspotId) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMovingHotspotId(null);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [movingHotspotId]);

  useEffect(() => {
    if (movingHotspotId && !hotspots.some((h) => h.id === movingHotspotId)) {
      setMovingHotspotId(null);
    }
  }, [hotspots, movingHotspotId]);

  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) ?? null,
    [scenes, activeSceneId],
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
          ? { ...scene, initial_yaw: yaw, initial_pitch: pitch }
          : scene,
      ),
    );
    toast.success("Initial view saved");
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

    // Marker clicks are handled via onMarkerSelect (clickEventOnMarker: false).
    if (payload.markerId) {
      setSelectedHotspotId(payload.markerId);
      setPlaceDraft(null);
      // Do not disarm move on marker click — only Esc / Move toggle / successful move.
      return;
    }

    // Armed one-shot reposition — only when explicitly Move-armed.
    if (movingHotspotId) {
      const moving = hotspots.find((hotspot) => hotspot.id === movingHotspotId);
      if (moving && moving.scene_id === activeSceneId) {
        void moveHotspot(moving, payload.yaw, payload.pitch);
      }
      setMovingHotspotId(null);
      setPlaceDraft(null);
      return;
    }

    // Default: always open create panel on empty panorama clicks.
    setPlaceDraft({
      yaw: payload.yaw,
      pitch: payload.pitch,
      clientX: payload.clientX,
      clientY: payload.clientY,
    });
  }

  function toggleMove(hotspotId: string) {
    setPlaceDraft(null);
    setSelectedHotspotId(hotspotId);
    setMovingHotspotId((current) =>
      current === hotspotId ? null : hotspotId,
    );
  }

  async function moveHotspot(hotspot: Hotspot, yaw: number, pitch: number) {
    const previous = hotspots;
    const next = hotspots.map((item) =>
      item.id === hotspot.id ? { ...item, yaw, pitch } : item,
    );
    setHotspots(next);

    const ok = await run(() => updateHotspot(hotspot.id, { yaw, pitch }));
    if (!ok) {
      setHotspots(previous);
      toast.error("Could not move hotspot");
    }
  }

  async function createLinkHotspot(input: {
    targetSceneId: string;
    label: string;
    addReturnLink: boolean;
  }) {
    if (!activeSceneId || !placeDraft) return;

    const forwardId = crypto.randomUUID();
    const forward: Hotspot = {
      id: forwardId,
      scene_id: activeSceneId,
      target_scene_id: input.targetSceneId,
      type: "link",
      yaw: placeDraft.yaw,
      pitch: placeDraft.pitch,
      label: input.label || null,
      content: null,
      created_at: new Date().toISOString(),
    };

    const created: Hotspot[] = [forward];
    let returnHotspot: Hotspot | null = null;

    if (input.addReturnLink) {
      returnHotspot = {
        id: crypto.randomUUID(),
        scene_id: input.targetSceneId,
        target_scene_id: activeSceneId,
        type: "link",
        yaw: reciprocalYaw(placeDraft.yaw),
        pitch: 0,
        label: input.label || null,
        content: null,
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

    setPlaceDraft(null);

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

  async function createInfoHotspot(input: { label: string; content: string }) {
    if (!activeSceneId || !placeDraft) return;

    const id = crypto.randomUUID();
    const hotspot: Hotspot = {
      id,
      scene_id: activeSceneId,
      target_scene_id: null,
      type: "info",
      yaw: placeDraft.yaw,
      pitch: placeDraft.pitch,
      label: input.label || null,
      content: input.content || null,
      created_at: new Date().toISOString(),
    };

    const previous = hotspots;
    setHotspots([...hotspots, hotspot]);
    setSelectedHotspotId(id);

    const ok = await run(() =>
      createHotspot(activeSceneId, {
        id,
        type: "info",
        yaw: hotspot.yaw,
        pitch: hotspot.pitch,
        label: hotspot.label,
        content: hotspot.content,
      }),
    );

    if (!ok) {
      setHotspots(previous);
      setSelectedHotspotId(null);
      toast.error("Could not create info hotspot");
      return;
    }

    setPlaceDraft(null);
  }

  return (
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
            activeSceneId={activeSceneId}
            onScenesChange={(next) => {
              setScenes(next);
              pruneHotspotsForScenes(next);
            }}
            onActiveSceneChange={setActiveSceneId}
          />
        </div>

        <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="relative min-h-[40vh] flex-1 lg:min-h-0">
            {movingHotspotId ? (
              <div className="absolute top-3 left-1/2 z-20 max-w-[min(90%,28rem)] -translate-x-1/2 rounded-lg bg-background/95 px-3 py-2 text-center text-sm shadow-md ring-1 ring-foreground/10">
                Click a new location to move this hotspot — Esc to cancel
              </div>
            ) : null}

            <PanoramaViewer
              scenes={scenes}
              hotspots={hotspots}
              currentSceneId={activeSceneId ?? undefined}
              selectedHotspotId={selectedHotspotId}
              movingHotspotId={movingHotspotId}
              startSceneId={tour.cover_scene_id ?? undefined}
              mode="edit"
              className="rounded-none"
              onSceneChange={setActiveSceneId}
              onMarkerSelect={(id) => {
                setSelectedHotspotId(id);
                setPlaceDraft(null);
              }}
              onPanoramaClick={handlePanoramaClick}
              onViewerReady={(viewer) => {
                viewerRef.current = viewer;
              }}
            />

            {placeDraft && activeSceneId && !movingHotspotId ? (
              <PlaceHotspotPanel
                draft={placeDraft}
                scenes={scenes}
                activeSceneId={activeSceneId}
                onCancel={() => setPlaceDraft(null)}
                onCreateLink={(input) => createLinkHotspot(input)}
                onCreateInfo={(input) => createInfoHotspot(input)}
              />
            ) : null}
          </div>

          <div className="flex shrink-0 items-center gap-3 border-t px-3 py-2">
            <p className="min-w-0 flex-1 truncate text-sm">
              {activeScene ? (
                <>
                  <span className="text-muted-foreground">Active scene: </span>
                  <span className="font-medium">{activeScene.name}</span>
                </>
              ) : (
                <span className="text-muted-foreground">No scene selected</span>
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!activeScene || status === "saving"}
              title="Save the current camera angle as where visitors look when they land on this scene"
              onClick={() => {
                void setInitialView();
              }}
            >
              {status === "saving" ? "Saving…" : "Set as initial view"}
            </Button>
          </div>
        </div>

        <div className="order-3 hidden lg:flex">
          <HotspotPanel
            scenes={scenes}
            hotspots={hotspots}
            activeSceneId={activeSceneId}
            selectedHotspotId={selectedHotspotId}
            movingHotspotId={movingHotspotId}
            onSelect={setSelectedHotspotId}
            onHotspotsChange={setHotspots}
            onFaceHotspot={faceHotspot}
            onToggleMove={toggleMove}
          />
        </div>
      </div>
    </div>
  );
}
