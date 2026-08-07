"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

import type { PanoramaViewerProps } from "./panorama-viewer";

function PanoramaViewerLoading({ className }: { className?: string }) {
  return (
    <Skeleton
      className={cn("h-full min-h-[240px] w-full rounded-none", className)}
      aria-label="Loading panorama"
    />
  );
}

/**
 * SSR-safe entry point for the panorama viewer.
 * PSV touches window/document at module scope — `ssr: false` is only allowed
 * inside a Client Component in Next.js 16, which is why this wrapper exists.
 */
export const PanoramaViewer = dynamic(
  () =>
    import("./panorama-viewer").then((mod) => ({
      default: mod.PanoramaViewer,
    })),
  {
    ssr: false,
    loading: () => <PanoramaViewerLoading />,
  },
);

export type {
  PanoramaClickPayload,
  PanoramaNadirSettings,
  PanoramaViewerHotspot,
  PanoramaViewerProps,
  PanoramaViewerScene,
} from "./panorama-viewer";
