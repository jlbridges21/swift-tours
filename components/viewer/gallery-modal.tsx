"use client";

import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";
import type { HotspotImage } from "@/types";

type GalleryModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images: HotspotImage[];
  title?: string | null;
};

export function GalleryModal({
  open,
  onOpenChange,
  images,
  title,
}: GalleryModalProps) {
  const ordered = [...images].sort((a, b) => a.position - b.position);
  const [index, setIndex] = useState(0);
  const touchStartX = useRef<number | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) setIndex(0);
  }, [open, ordered.length]);

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  const current = ordered[index] ?? null;
  const multi = ordered.length > 1;

  const go = useCallback(
    (delta: number) => {
      if (!multi) return;
      setIndex((prev) => (prev + delta + ordered.length) % ordered.length);
    },
    [multi, ordered.length],
  );

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, go]);

  // Preload adjacent full-size images.
  useEffect(() => {
    if (!open || !multi) return;
    const prev = ordered[(index - 1 + ordered.length) % ordered.length];
    const next = ordered[(index + 1) % ordered.length];
    for (const img of [prev, next]) {
      if (!img) continue;
      const el = new Image();
      el.src = publicUrl(img.storage_path);
    }
  }, [open, multi, index, ordered]);

  function onPointerDown(event: ReactPointerEvent) {
    touchStartX.current = event.clientX;
  }

  function onPointerUp(event: ReactPointerEvent) {
    if (touchStartX.current == null) return;
    const dx = event.clientX - touchStartX.current;
    touchStartX.current = null;
    if (Math.abs(dx) < 40) return;
    go(dx < 0 ? 1 : -1);
  }

  if (ordered.length === 0) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 rounded-none border-0 bg-black p-0 text-white max-[639px]:rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-4xl sm:rounded-xl sm:ring-1 sm:ring-white/15"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
          <DialogTitle className="truncate text-sm font-medium text-white">
            {title?.trim() || "Gallery"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            Image gallery
          </DialogDescription>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label="Close gallery"
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div
          className="relative flex min-h-0 flex-1 items-center justify-center bg-black"
          onPointerDown={onPointerDown}
          onPointerUp={onPointerUp}
        >
          {current ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={publicUrl(current.storage_path)}
              alt={current.caption ?? ""}
              className="max-h-[min(70vh,720px)] max-w-full object-contain"
              draggable={false}
            />
          ) : null}

          {multi ? (
            <>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="absolute left-2 top-1/2 -translate-y-1/2"
                aria-label="Previous image"
                onClick={() => go(-1)}
              >
                <ChevronLeftIcon className="size-4" />
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="icon-sm"
                className="absolute right-2 top-1/2 -translate-y-1/2"
                aria-label="Next image"
                onClick={() => go(1)}
              >
                <ChevronRightIcon className="size-4" />
              </Button>
            </>
          ) : null}
        </div>

        <div className="space-y-2 px-3 py-3 sm:px-4">
          {multi ? (
            <p className="text-center text-xs text-white/70">
              {index + 1} / {ordered.length}
            </p>
          ) : null}
          {current?.caption ? (
            <p className="text-center text-sm text-white/90">{current.caption}</p>
          ) : null}
          {multi ? (
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {ordered.map((image, i) => (
                <button
                  key={image.id}
                  type="button"
                  onClick={() => setIndex(i)}
                  className={cn(
                    "relative h-12 w-16 shrink-0 overflow-hidden rounded border-2",
                    i === index ? "border-white" : "border-transparent opacity-70",
                  )}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={publicUrl(image.thumbnail_path ?? image.storage_path)}
                    alt=""
                    className="size-full object-cover"
                  />
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
