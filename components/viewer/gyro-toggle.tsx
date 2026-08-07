"use client";

/**
 * Device-orientation control. Requires HTTPS — plain http (including LAN IPs
 * in local dev) will not receive DeviceOrientation events; that is a browser
 * security restriction, not a bug in this toggle.
 *
 * iOS 13+ permission MUST be requested inside this click handler (the
 * GyroscopePlugin calls DeviceOrientationEvent.requestPermission from start()).
 * Do not await anything before start() or iOS silently denies.
 */

import { CompassIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import type { Viewer } from "@photo-sphere-viewer/core";
import { GyroscopePlugin } from "@photo-sphere-viewer/gyroscope-plugin";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isTouchOrientationDevice } from "@/lib/viewer-effects";

type GyroToggleProps = {
  viewer: Viewer | null;
  /** Tour-level availability flag. */
  enabled: boolean;
};

export function GyroToggle({ viewer, enabled }: GyroToggleProps) {
  const [supported, setSupported] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!enabled || !isTouchOrientationDevice() || !viewer) {
      setSupported(false);
      return;
    }
    const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin);
    if (!gyro) {
      setSupported(false);
      return;
    }
    let cancelled = false;
    void gyro.isSupported().then((ok) => {
      if (!cancelled) setSupported(ok);
    });
    const onUpdate = (event: { gyroscopeEnabled: boolean }) => {
      setActive(event.gyroscopeEnabled);
    };
    gyro.addEventListener("gyroscope-updated", onUpdate);
    setActive(gyro.isEnabled());
    return () => {
      cancelled = true;
      gyro.removeEventListener("gyroscope-updated", onUpdate);
    };
  }, [viewer, enabled]);

  const toggle = useCallback(() => {
    if (!viewer || busy) return;
    const gyro = viewer.getPlugin<GyroscopePlugin>(GyroscopePlugin);
    if (!gyro) return;

    if (gyro.isEnabled()) {
      gyro.stop();
      setActive(false);
      return;
    }

    // Call start() synchronously from the gesture — plugin requests iOS
    // permission internally. Do not await beforehand.
    setBusy(true);
    void gyro
      .start()
      .then(() => {
        if (!gyro.isEnabled()) {
          toast.error(
            "Motion access was denied. Enable it in Safari settings to use gyroscope.",
          );
          setActive(false);
        } else {
          setActive(true);
        }
      })
      .catch(() => {
        toast.error("Could not enable gyroscope on this device.");
        setActive(false);
      })
      .finally(() => setBusy(false));
  }, [viewer, busy]);

  if (!enabled || !supported) return null;

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="min-h-11 min-w-11 bg-black/55 text-white hover:bg-black/70 sm:min-h-8 sm:min-w-0"
      aria-label={active ? "Disable gyroscope" : "Enable gyroscope"}
      aria-pressed={active}
      disabled={busy}
      onClick={toggle}
    >
      <CompassIcon className="size-4" />
      <span className="hidden sm:inline">{active ? "Gyro on" : "Gyro"}</span>
    </Button>
  );
}
