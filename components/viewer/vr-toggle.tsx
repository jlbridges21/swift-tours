"use client";

/**
 * Cardboard-style split-screen stereo (phone-in-a-headset), not WebXR.
 * StereoPlugin requires GyroscopePlugin, enters fullscreen, locks landscape,
 * and hides MarkersPlugin markers for the duration (see plugin start()).
 */

import { GlassesIcon, XIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Viewer } from "@photo-sphere-viewer/core";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";
import { StereoPlugin } from "@photo-sphere-viewer/stereo-plugin";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isTouchOrientationDevice } from "@/lib/viewer-effects";

type VrToggleProps = {
  viewer: Viewer | null;
  enabled: boolean;
};

export function VrToggle({ viewer, enabled }: VrToggleProps) {
  const [available, setAvailable] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !isTouchOrientationDevice() || !viewer) {
      setAvailable(false);
      return;
    }
    const stereo = viewer.getPlugin<StereoPlugin>(StereoPlugin);
    const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin);
    if (!stereo || !gyro) {
      setAvailable(false);
      return;
    }
    let cancelled = false;
    void gyro.isSupported().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    const onUpdate = (event: { stereoEnabled: boolean }) => {
      setActive(event.stereoEnabled);
    };
    stereo.addEventListener("stereo-updated", onUpdate);
    setActive(stereo.isEnabled());
    return () => {
      cancelled = true;
      stereo.removeEventListener("stereo-updated", onUpdate);
    };
  }, [viewer, enabled]);

  useEffect(() => {
    if (!active) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || !viewer) return;
      const stereo = viewer.getPlugin<StereoPlugin>(StereoPlugin);
      stereo?.stop();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, viewer]);

  const enter = useCallback(() => {
    if (!viewer || busy) return;
    const stereo = viewer.getPlugin<StereoPlugin>(StereoPlugin);
    if (!stereo) return;
    setBusy(true);
    // start() must stay in the gesture chain for iOS gyro permission.
    void stereo
      .start()
      .then(() => {
        if (!stereo.isEnabled()) {
          toast.error(
            "VR needs motion access. Allow it when prompted, or enable it in Settings.",
          );
          setActive(false);
        } else {
          setActive(true);
        }
      })
      .catch(() => {
        toast.error("Could not start stereo VR on this device.");
        setActive(false);
      })
      .finally(() => setBusy(false));
  }, [viewer, busy]);

  const exit = useCallback(() => {
    if (!viewer) return;
    viewer.getPlugin<StereoPlugin>(StereoPlugin)?.stop();
    setActive(false);
  }, [viewer]);

  if (!enabled || !available) return null;

  if (active) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="min-h-11 min-w-11 bg-black/55 text-white hover:bg-black/70 sm:min-h-8 sm:min-w-0"
        aria-label="Exit VR stereo mode"
        onClick={exit}
      >
        <XIcon className="size-4" />
        <span className="hidden sm:inline">Exit VR</span>
      </Button>
    );
  }

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="min-h-11 min-w-11 bg-black/55 text-white hover:bg-black/70 sm:min-h-8 sm:min-w-0"
      aria-label="Enter cardboard VR stereo mode"
      title="Cardboard-style stereo (phone in a headset) — not WebXR"
      disabled={busy}
      onClick={enter}
    >
      <GlassesIcon className="size-4" />
      <span className="hidden sm:inline">VR</span>
    </Button>
  );
}
