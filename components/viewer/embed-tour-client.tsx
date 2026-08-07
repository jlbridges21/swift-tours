"use client";

import { useSearchParams } from "next/navigation";

import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import { parseEmbedSearchParams } from "@/lib/embed-options";
import type { Hotspot, Scene, Tour } from "@/types";

type EmbedTourClientProps = {
  tour: Tour;
  scenes: Scene[];
  hotspots: Hotspot[];
};

/**
 * Reads embed chrome query params on the client so the server page can stay
 * ISR-compatible (awaiting searchParams forces DYNAMIC_SERVER_USAGE).
 */
export function EmbedTourClient({
  tour,
  scenes,
  hotspots,
}: EmbedTourClientProps) {
  const searchParams = useSearchParams();
  const chrome = parseEmbedSearchParams(searchParams);

  return (
    <TourViewerShell
      tour={tour}
      scenes={scenes}
      hotspots={hotspots}
      trackViews
      embedMode
      branded={chrome.branded}
      showTitle={chrome.showTitle}
      showThumbs={chrome.showThumbs}
      showShare={chrome.showShare}
      showFullscreen={chrome.showFullscreen}
      autorotate={chrome.autorotate}
      startSceneId={chrome.startSceneId}
      allowGyro={chrome.showGyro}
      allowVr={chrome.showVr}
      allowIntro={chrome.showIntro}
    />
  );
}
