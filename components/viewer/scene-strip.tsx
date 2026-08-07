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
  const listRef = useRef<HTMLDivElement | null>(null);
  const reduceMotion =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  useEffect(() => {
    activeRef.current?.scrollIntoView({
      behavior: reduceMotion ? "auto" : "smooth",
      inline: "center",
      block: "nearest",
    });
  }, [currentSceneId, reduceMotion]);

  if (scenes.length <= 1) {
    return null;
  }

  function moveSelection(delta: number) {
    const index = scenes.findIndex((scene) => scene.id === currentSceneId);
    const next = scenes[Math.min(scenes.length - 1, Math.max(0, index + delta))];
    if (next) onSelect(next.id);
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/70 via-black/35 to-transparent pb-3 pt-10">
      <div
        ref={listRef}
        role="listbox"
        aria-label="Tour scenes"
        tabIndex={0}
        className="pointer-events-auto mx-auto flex max-w-5xl gap-2 overflow-x-auto overscroll-x-contain px-4 [-webkit-overflow-scrolling:touch] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") {
            event.preventDefault();
            moveSelection(1);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            moveSelection(-1);
          } else if (event.key === "Enter" && currentSceneId) {
            event.preventDefault();
            onSelect(currentSceneId);
          }
        }}
      >
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
              role="option"
              aria-selected={active}
              onClick={() => onSelect(scene.id)}
              className={cn(
                "relative h-14 w-[4.5rem] shrink-0 overflow-hidden rounded-md border-2 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:h-16 sm:w-24",
                active
                  ? "border-white shadow-md"
                  : "border-transparent opacity-80 hover:opacity-100",
              )}
              aria-label={scene.name}
            >
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element -- strip thumbs; avoid layout cost of next/image in overlay
                <img
                  src={thumb}
                  alt=""
                  loading="lazy"
                  decoding="async"
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
