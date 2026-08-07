"use client";

import { InfoIcon, Link2Icon, MoveIcon, Trash2Icon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import {
  deleteHotspot,
  updateHotspot,
} from "@/app/dashboard/tours/[id]/actions";
import { useSaveStatus } from "@/components/editor/save-status";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Hotspot, Scene } from "@/types";

type HotspotPanelProps = {
  scenes: Scene[];
  hotspots: Hotspot[];
  activeSceneId: string | null;
  selectedHotspotId: string | null;
  movingHotspotId: string | null;
  onSelect: (hotspotId: string | null) => void;
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  onFaceHotspot: (hotspot: Hotspot) => void;
  onToggleMove: (hotspotId: string) => void;
};

export function HotspotPanel({
  scenes,
  hotspots,
  activeSceneId,
  selectedHotspotId,
  movingHotspotId,
  onSelect,
  onHotspotsChange,
  onFaceHotspot,
  onToggleMove,
}: HotspotPanelProps) {
  const { run } = useSaveStatus();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const sceneHotspots = useMemo(
    () =>
      activeSceneId
        ? hotspots.filter((hotspot) => hotspot.scene_id === activeSceneId)
        : [],
    [hotspots, activeSceneId],
  );

  const selected = useMemo(
    () => hotspots.find((hotspot) => hotspot.id === selectedHotspotId) ?? null,
    [hotspots, selectedHotspotId],
  );

  const sceneName = (id: string | null) =>
    scenes.find((scene) => scene.id === id)?.name ?? "Unknown scene";

  async function handleDelete(hotspotId: string) {
    const previous = hotspots;
    onHotspotsChange(hotspots.filter((hotspot) => hotspot.id !== hotspotId));
    if (selectedHotspotId === hotspotId) {
      onSelect(null);
    }

    setDeleting(true);
    const ok = await run(() => deleteHotspot(hotspotId));
    setDeleting(false);
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not delete hotspot");
      return;
    }

    setDeleteId(null);
    toast.success("Hotspot deleted");
  }

  return (
    <aside className="flex h-full w-[300px] shrink-0 flex-col border-l bg-background">
      <div className="border-b px-3 py-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
        Hotspots
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {!activeSceneId ? (
          <p className="px-2 py-6 text-center text-sm text-muted-foreground">
            Select a scene to manage hotspots.
          </p>
        ) : sceneHotspots.length === 0 ? (
          <div className="flex flex-col gap-2 px-2 py-6 text-center">
            <p className="text-sm font-medium">No hotspots yet</p>
            <p className="text-sm text-muted-foreground">
              Click the panorama to place a link (jump to another scene) or an
              info marker visitors can tap.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-1">
            {sceneHotspots.map((hotspot) => {
              const active = hotspot.id === selectedHotspotId;
              const moving = hotspot.id === movingHotspotId;
              const title =
                hotspot.label?.trim() ||
                (hotspot.type === "link"
                  ? `→ ${sceneName(hotspot.target_scene_id)}`
                  : "Info hotspot");

              return (
                <li key={hotspot.id}>
                  <div
                    className={cn(
                      "flex w-full items-center gap-1 rounded-lg px-1 py-1 text-sm",
                      active && "bg-muted ring-1 ring-foreground/10",
                      moving && "ring-1 ring-blue-500",
                    )}
                  >
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-1 py-1 text-left hover:bg-muted/80"
                      onClick={() => {
                        onSelect(hotspot.id);
                        onFaceHotspot(hotspot);
                      }}
                    >
                      {hotspot.type === "link" ? (
                        <Link2Icon className="size-4 shrink-0 text-blue-600" />
                      ) : (
                        <InfoIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="min-w-0 flex-1 truncate">{title}</span>
                    </button>
                    <Button
                      type="button"
                      variant={moving ? "default" : "ghost"}
                      size="icon-xs"
                      aria-label={moving ? "Cancel move" : "Move hotspot"}
                      title={
                        moving
                          ? "Cancel move"
                          : "Move — click a new spot on the panorama"
                      }
                      onClick={() => onToggleMove(hotspot.id)}
                    >
                      <MoveIcon />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Delete hotspot"
                      onClick={() => setDeleteId(hotspot.id)}
                    >
                      <Trash2Icon />
                    </Button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {selected && selected.scene_id === activeSceneId ? (
          <HotspotEditor
            key={selected.id}
            hotspot={selected}
            scenes={scenes}
            onHotspotsChange={onHotspotsChange}
            allHotspots={hotspots}
            isMoving={selected.id === movingHotspotId}
            onToggleMove={() => onToggleMove(selected.id)}
          />
        ) : null}
      </div>

      <AlertDialog
        open={deleteId !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this hotspot?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deleting}
              onClick={() => {
                if (deleteId) void handleDelete(deleteId);
              }}
            >
              {deleting ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </aside>
  );
}

type HotspotEditorProps = {
  hotspot: Hotspot;
  scenes: Scene[];
  allHotspots: Hotspot[];
  onHotspotsChange: (hotspots: Hotspot[]) => void;
  isMoving: boolean;
  onToggleMove: () => void;
};

function HotspotEditor({
  hotspot,
  scenes,
  allHotspots,
  onHotspotsChange,
  isMoving,
  onToggleMove,
}: HotspotEditorProps) {
  const { run } = useSaveStatus();
  const [label, setLabel] = useState(hotspot.label ?? "");
  const [content, setContent] = useState(hotspot.content ?? "");
  const [targetSceneId, setTargetSceneId] = useState(
    hotspot.target_scene_id ?? "",
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const otherScenes = useMemo(
    () => scenes.filter((scene) => scene.id !== hotspot.scene_id),
    [scenes, hotspot.scene_id],
  );

  useEffect(() => {
    setLabel(hotspot.label ?? "");
    setContent(hotspot.content ?? "");
    setTargetSceneId(hotspot.target_scene_id ?? "");
  }, [hotspot.id, hotspot.label, hotspot.content, hotspot.target_scene_id]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  function patchLocal(partial: Partial<Hotspot>) {
    onHotspotsChange(
      allHotspots.map((item) =>
        item.id === hotspot.id ? { ...item, ...partial } : item,
      ),
    );
  }

  function scheduleTextSave(next: {
    label?: string;
    content?: string;
  }) {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void run(() =>
        updateHotspot(hotspot.id, {
          label: next.label !== undefined ? next.label || null : undefined,
          content:
            next.content !== undefined ? next.content || null : undefined,
        }),
      );
    }, 600);
  }

  async function saveTarget(nextTarget: string) {
    const previous = allHotspots;
    patchLocal({ target_scene_id: nextTarget });
    const ok = await run(() =>
      updateHotspot(hotspot.id, { targetSceneId: nextTarget }),
    );
    if (!ok) {
      onHotspotsChange(previous);
      toast.error("Could not update target scene");
    }
  }

  return (
    <div className="mt-3 flex flex-col gap-3 rounded-lg border border-foreground/10 p-3">
      <p className="text-xs font-medium text-muted-foreground uppercase">
        Edit {hotspot.type === "link" ? "link" : "info"}
      </p>

      <Button
        type="button"
        variant={isMoving ? "default" : "outline"}
        size="sm"
        className="justify-start"
        onClick={onToggleMove}
      >
        <MoveIcon className="size-3.5" />
        {isMoving ? "Cancel move" : "Move on panorama"}
      </Button>

      {hotspot.type === "link" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`target-${hotspot.id}`}>Target scene</Label>
          <select
            id={`target-${hotspot.id}`}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
            value={targetSceneId}
            onChange={(event) => {
              const value = event.target.value;
              setTargetSceneId(value);
              void saveTarget(value);
            }}
          >
            {otherScenes.map((scene) => (
              <option key={scene.id} value={scene.id}>
                {scene.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`label-${hotspot.id}`}>Label</Label>
        <Input
          id={`label-${hotspot.id}`}
          value={label}
          onChange={(event) => {
            const value = event.target.value;
            setLabel(value);
            patchLocal({ label: value || null });
            scheduleTextSave({ label: value });
          }}
        />
      </div>

      {hotspot.type === "info" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor={`content-${hotspot.id}`}>Content</Label>
          <Textarea
            id={`content-${hotspot.id}`}
            rows={4}
            value={content}
            onChange={(event) => {
              const value = event.target.value;
              setContent(value);
              patchLocal({ content: value || null });
              scheduleTextSave({ content: value });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
