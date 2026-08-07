"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { Scene } from "@/types";

export type PlaceHotspotDraft = {
  yaw: number;
  pitch: number;
  clientX: number;
  clientY: number;
};

type PlaceHotspotPanelProps = {
  draft: PlaceHotspotDraft;
  scenes: Scene[];
  activeSceneId: string;
  onCancel: () => void;
  onCreateLink: (input: {
    targetSceneId: string;
    label: string;
    addReturnLink: boolean;
  }) => Promise<void>;
  onCreateInfo: (input: { label: string; content: string }) => Promise<void>;
};

type Mode = "choose" | "link" | "info";

function clampPanelPosition(clientX: number, clientY: number) {
  const panelWidth = 280;
  const panelHeight = 320;
  const margin = 12;
  const x = Math.min(
    Math.max(margin, clientX),
    window.innerWidth - panelWidth - margin,
  );
  const y = Math.min(
    Math.max(margin, clientY),
    window.innerHeight - panelHeight - margin,
  );
  return { left: x, top: y };
}

export function PlaceHotspotPanel({
  draft,
  scenes,
  activeSceneId,
  onCancel,
  onCreateLink,
  onCreateInfo,
}: PlaceHotspotPanelProps) {
  const [mode, setMode] = useState<Mode>("choose");
  const [targetSceneId, setTargetSceneId] = useState("");
  const [label, setLabel] = useState("");
  const [content, setContent] = useState("");
  const [addReturnLink, setAddReturnLink] = useState(true);
  const [pending, setPending] = useState(false);
  const [position, setPosition] = useState(() =>
    clampPanelPosition(draft.clientX, draft.clientY),
  );

  const otherScenes = useMemo(
    () => scenes.filter((scene) => scene.id !== activeSceneId),
    [scenes, activeSceneId],
  );

  useEffect(() => {
    setPosition(clampPanelPosition(draft.clientX, draft.clientY));
    setMode("choose");
    setTargetSceneId("");
    setLabel("");
    setContent("");
    setAddReturnLink(true);
    setPending(false);
  }, [draft]);

  useEffect(() => {
    if (otherScenes.length > 0 && !targetSceneId) {
      setTargetSceneId(otherScenes[0].id);
    }
  }, [otherScenes, targetSceneId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !pending) onCancel();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCancel, pending]);

  return (
    <div
      className="fixed z-50 w-[280px] rounded-xl bg-background p-3 text-sm shadow-lg ring-1 ring-foreground/10"
      style={{ left: position.left, top: position.top }}
      role="dialog"
      aria-modal="true"
      aria-label="Create hotspot"
    >
      {mode === "choose" ? (
        <div className="flex flex-col gap-2">
          <p className="text-xs font-medium text-muted-foreground">
            Add hotspot
          </p>
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            disabled={otherScenes.length === 0 || pending}
            title={
              otherScenes.length === 0
                ? "Link hotspots need at least two scenes in the tour"
                : undefined
            }
            onClick={() => setMode("link")}
          >
            Link to scene
          </Button>
          <Button
            type="button"
            variant="outline"
            className="justify-start"
            disabled={pending}
            onClick={() => setMode("info")}
          >
            Info hotspot
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={onCancel}
          >
            Cancel
          </Button>
        </div>
      ) : null}

      {mode === "link" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!targetSceneId || pending) return;
            setPending(true);
            void onCreateLink({
              targetSceneId,
              label: label.trim(),
              addReturnLink,
            }).finally(() => setPending(false));
          }}
        >
          <p className="text-xs font-medium text-muted-foreground">
            Link to scene
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="target-scene">Target scene</Label>
            <select
              id="target-scene"
              className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
              value={targetSceneId}
              onChange={(event) => setTargetSceneId(event.target.value)}
              required
              disabled={pending}
            >
              {otherScenes.map((scene) => (
                <option key={scene.id} value={scene.id}>
                  {scene.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="link-label">Label (optional)</Label>
            <Input
              id="link-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={pending}
            />
          </div>
          <label className="flex items-start gap-2 text-xs leading-snug">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={addReturnLink}
              onChange={(event) => setAddReturnLink(event.target.checked)}
              disabled={pending}
            />
            Also add a return link from the target scene
          </label>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              disabled={pending}
              onClick={() => setMode("choose")}
            >
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      ) : null}

      {mode === "info" ? (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (pending) return;
            setPending(true);
            void onCreateInfo({
              label: label.trim(),
              content: content.trim(),
            }).finally(() => setPending(false));
          }}
        >
          <p className="text-xs font-medium text-muted-foreground">
            Info hotspot
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="info-label">Label</Label>
            <Input
              id="info-label"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="info-content">Content</Label>
            <Textarea
              id="info-content"
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              disabled={pending}
            />
          </div>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="ghost"
              className="flex-1"
              disabled={pending}
              onClick={() => setMode("choose")}
            >
              Back
            </Button>
            <Button type="submit" className="flex-1" disabled={pending}>
              {pending ? "Creating…" : "Create"}
            </Button>
          </div>
        </form>
      ) : null}
    </div>
  );
}
