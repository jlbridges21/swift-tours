"use client";

import { XIcon } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { isYouTubeId, youtubeEmbedUrl } from "@/lib/youtube";

type VideoModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  videoId: string | null | undefined;
  start?: number | null;
  title?: string | null;
};

/**
 * YouTube modal. The iframe is mounted only while open so audio/resources
 * stop when the dialog closes.
 */
export function VideoModal({
  open,
  onOpenChange,
  videoId,
  start = null,
  title,
}: VideoModalProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const embed =
    open && isYouTubeId(videoId)
      ? youtubeEmbedUrl(videoId, { start, autoplay: true })
      : null;

  useEffect(() => {
    if (!open) return;
    // Restore focus to the close control when dialog opens (Radix also traps).
    const id = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => window.clearTimeout(id);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="flex h-dvh max-h-dvh w-full max-w-none flex-col gap-0 rounded-none border-0 bg-black p-0 text-white max-[639px]:rounded-none sm:h-auto sm:max-h-[90vh] sm:max-w-3xl sm:rounded-xl sm:ring-1 sm:ring-white/15"
      >
        <div className="flex items-center justify-between gap-3 px-3 py-2 sm:px-4">
          <DialogTitle className="truncate text-sm font-medium text-white">
            {title?.trim() || "Video"}
          </DialogTitle>
          <DialogDescription className="sr-only">
            YouTube video
          </DialogDescription>
          <Button
            ref={closeRef}
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-white hover:bg-white/10 hover:text-white"
            aria-label="Close video"
            onClick={() => onOpenChange(false)}
          >
            <XIcon className="size-4" />
          </Button>
        </div>

        <div className="relative w-full flex-1 bg-black sm:flex-none">
          <div className="relative aspect-video w-full">
            {embed ? (
              <iframe
                key={embed}
                src={embed}
                title={title?.trim() || "YouTube video"}
                className="absolute inset-0 size-full border-0"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                allowFullScreen
              />
            ) : (
              <div className="flex aspect-video items-center justify-center text-sm text-white/70">
                Video unavailable
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
