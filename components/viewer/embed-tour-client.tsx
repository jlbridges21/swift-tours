"use client";

import { useSearchParams } from "next/navigation";

import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import { parseEmbedSearchParams } from "@/lib/embed-options";
import type {
  FloorPlan,
  Hotspot,
  HotspotImage,
  Scene,
  SceneGroup,
  Tour,
} from "@/types";

type EmbedTourClientProps = {
  tour: Tour;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  hotspots: Hotspot[];
  hotspotImages: HotspotImage[];
};

/**
 * Reads embed chrome query params on the client so the server page can stay
 * ISR-compatible (awaiting searchParams forces DYNAMIC_SERVER_USAGE).
 */
export function EmbedTourClient({
  tour,
  scenes,
  groups,
  floorPlans,
  hotspots,
  hotspotImages,
}: EmbedTourClientProps) {
  const searchParams = useSearchParams();
  const chrome = parseEmbedSearchParams(searchParams);

  return (
    <TourViewerShell
      tour={tour}
      scenes={scenes}
      groups={groups}
      floorPlans={floorPlans}
      hotspots={hotspots}
      hotspotImages={hotspotImages}
      trackViews
      embedMode
      branded={chrome.branded}
      showTitle={chrome.showTitle}
      showThumbs={chrome.showThumbs}
      showShare={chrome.showShare}
      showFullscreen={chrome.showFullscreen}
      showGroups={chrome.showGroups}
      showPlan={chrome.showPlan}
      autorotate={chrome.autorotate}
      startSceneId={chrome.startSceneId}
      allowGyro={chrome.showGyro}
      allowVr={chrome.showVr}
      allowIntro={chrome.showIntro}
    />
  );
}
