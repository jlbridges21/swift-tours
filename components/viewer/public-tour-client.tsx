"use client";

import { useSearchParams } from "next/navigation";

import { TourViewerShell } from "@/components/viewer/tour-viewer-shell";
import { isValidSceneIdParam } from "@/lib/embed-options";
import type {
  FloorPlan,
  Hotspot,
  HotspotImage,
  Scene,
  SceneGroup,
  Tour,
} from "@/types";

type PublicTourClientProps = {
  tour: Tour;
  scenes: Scene[];
  groups: SceneGroup[];
  floorPlans: FloorPlan[];
  hotspots: Hotspot[];
  hotspotImages: HotspotImage[];
};

/**
 * Reads `?start=` on the client so the server page can stay ISR-compatible
 * (awaiting searchParams forces DYNAMIC_SERVER_USAGE).
 */
export function PublicTourClient({
  tour,
  scenes,
  groups,
  floorPlans,
  hotspots,
  hotspotImages,
}: PublicTourClientProps) {
  const searchParams = useSearchParams();
  const startRaw = searchParams.get("start");
  const startSceneId = isValidSceneIdParam(startRaw) ? startRaw : null;

  return (
    <TourViewerShell
      tour={tour}
      scenes={scenes}
      groups={groups}
      floorPlans={floorPlans}
      hotspots={hotspots}
      hotspotImages={hotspotImages}
      trackViews
      showShare
      startSceneId={startSceneId}
    />
  );
}
