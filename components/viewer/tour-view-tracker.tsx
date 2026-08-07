"use client";

import { useEffect } from "react";

type TourViewTrackerProps = {
  tourId: string;
};

export function TourViewTracker({ tourId }: TourViewTrackerProps) {
  useEffect(() => {
    const key = `swift-tours:viewed:${tourId}`;
    try {
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, "1");
    } catch {
      // sessionStorage unavailable — still attempt one POST.
    }

    let referrer = "";
    try {
      referrer = document.referrer || "";
    } catch {
      referrer = "";
    }

    void fetch(`/api/tours/${tourId}/view`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ referrer }),
    }).catch(() => {
      // Analytics must never break the viewer.
    });
  }, [tourId]);

  return null;
}
