"use client";

import { MaximizeIcon, MinimizeIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { Button } from "@/components/ui/button";

export function FullscreenToggle() {
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    function onChange() {
      setIsFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggle = useCallback(async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Fullscreen may be blocked by the browser.
    }
  }, []);

  return (
    <Button
      type="button"
      variant="secondary"
      size="sm"
      className="bg-black/55 text-white hover:bg-black/70 min-h-11 min-w-11 sm:min-h-8 sm:min-w-0"
      onClick={() => {
        void toggle();
      }}
      aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
    >
      {isFullscreen ? (
        <MinimizeIcon className="size-4" />
      ) : (
        <MaximizeIcon className="size-4" />
      )}
      <span className="hidden sm:inline">
        {isFullscreen ? "Exit" : "Fullscreen"}
      </span>
    </Button>
  );
}
