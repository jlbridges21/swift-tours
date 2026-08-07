"use client";

import type { Viewer } from "@photo-sphere-viewer/core";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  updateSceneInitialView,
  updateTourTitle,
} from "@/app/dashboard/tours/[id]/actions";
import { SceneSidebar } from "@/components/editor/scene-sidebar";
import {
  SaveStatusIndicator,
  SaveStatusProvider,
  useSaveStatus,
} from "@/components/editor/save-status";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PanoramaViewer } from "@/components/viewer/panorama-viewer-client";
import type { Hotspot, Scene, Tour } from "@/types";

type TourEditorProps = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
  userId: string;
};

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
  hotspots,
  userId,
}: TourEditorProps) {
  const { run } = useSaveStatus();
  const viewerRef = useRef<Viewer | null>(null);

  const [scenes, setScenes] = useState(initialScenes);
  const [title, setTitle] = useState(tour.title);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(
    initialScenes[0]?.id ?? null,
  );

  useEffect(() => {
    setScenes(initialScenes);
  }, [initialScenes]);

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

  const activeScene = useMemo(
    () => scenes.find((scene) => scene.id === activeSceneId) ?? null,
    [scenes, activeSceneId],
  );

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

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
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
              <a href={`/tour/${tour.slug}`} target="_blank" rel="noreferrer" />
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
            onScenesChange={setScenes}
            onActiveSceneChange={setActiveSceneId}
          />
        </div>

        <div className="order-1 flex min-h-0 min-w-0 flex-1 flex-col lg:order-2">
          <div className="min-h-[40vh] flex-1 lg:min-h-0">
            <PanoramaViewer
              scenes={scenes}
              hotspots={hotspots}
              currentSceneId={activeSceneId ?? undefined}
              startSceneId={tour.cover_scene_id ?? undefined}
              mode="edit"
              className="rounded-none"
              onSceneChange={setActiveSceneId}
              onViewerReady={(viewer) => {
                viewerRef.current = viewer;
              }}
            />
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
              disabled={!activeScene}
              title="Save the current camera angle as where visitors look when they land on this scene"
              onClick={() => {
                void setInitialView();
              }}
            >
              Set as initial view
            </Button>
          </div>
        </div>

        <aside className="order-3 hidden h-full w-[300px] shrink-0 flex-col border-l bg-background lg:flex">
          <div className="border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Hotspots
          </div>
          <div className="flex flex-1 items-center justify-center p-4 text-center text-sm text-muted-foreground">
            Hotspots
          </div>
        </aside>
      </div>
    </div>
  );
}
