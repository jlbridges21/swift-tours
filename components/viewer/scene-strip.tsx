"use client";

import { useEffect, useRef } from "react";

import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { Scene } from "@/types";

type SceneStripProps = {
  scenes: Scene[];
  currentSceneId: string | null;
  onSelect: (sceneId: string) => void;
};

export function SceneStrip({
  scenes,
  currentSceneId,
  onSelect,
}: SceneStripProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentSceneId]);

  if (scenes.length <= 1) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent pb-3 pt-10">
      <div className="pointer-events-auto mx-auto flex max-w-5xl gap-2 overflow-x-auto px-4 scrollbar-thin">
        {scenes.map((scene) => {
          const active = scene.id === currentSceneId;
          const thumb = scene.thumbnail_path
            ? publicUrl(scene.thumbnail_path)
            : null;

          return (
            <button
              key={scene.id}
              ref={active ? activeRef : undefined}
              type="button"
              onClick={() => onSelect(scene.id)}
              className={cn(
                "relative h-16 w-24 shrink-0 overflow-hidden rounded-md border-2 transition",
                active
                  ? "border-white shadow-md"
                  : "border-transparent opacity-80 hover:opacity-100",
              )}
              aria-label={scene.name}
              aria-current={active ? "true" : undefined}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={thumb}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <span className="flex h-full w-full items-center justify-center bg-neutral-800 text-[10px] text-white/80">
                  {scene.name}
                </span>
              )}
              <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[10px] text-white">
                {scene.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
