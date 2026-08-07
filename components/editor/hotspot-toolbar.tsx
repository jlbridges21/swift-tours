"use client";

import {
  ImagesIcon,
  InfoIcon,
  Link2Icon,
  PlayIcon,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { HotspotType } from "@/lib/hotspot-styles";

export type PlaceableHotspotType = HotspotType;

export type HotspotToolDefinition = {
  type: PlaceableHotspotType;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  /** When true, the tool needs at least two scenes. */
  requiresMultipleScenes?: boolean;
};

/** Extend this array when new hotspot types ship. */
export const HOTSPOT_TOOLS: HotspotToolDefinition[] = [
  {
    type: "link",
    label: "Add link hotspot",
    shortLabel: "Link",
    icon: Link2Icon,
    requiresMultipleScenes: true,
  },
  {
    type: "info",
    label: "Add info hotspot",
    shortLabel: "Info",
    icon: InfoIcon,
  },
  {
    type: "gallery",
    label: "Add gallery hotspot",
    shortLabel: "Gallery",
    icon: ImagesIcon,
  },
  {
    type: "video",
    label: "Add video hotspot",
    shortLabel: "Video",
    icon: PlayIcon,
  },
];

const AUTO_RETURN_KEY = "swift-tours:auto-return-link";

export function readAutoReturnLink(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const raw = window.localStorage.getItem(AUTO_RETURN_KEY);
    if (raw === null) return true;
    return raw === "1" || raw === "true";
  } catch {
    return true;
  }
}

function writeAutoReturnLink(value: boolean) {
  try {
    window.localStorage.setItem(AUTO_RETURN_KEY, value ? "1" : "0");
  } catch {
    // ignore quota / private mode
  }
}

type HotspotToolbarProps = {
  placingType: PlaceableHotspotType | null;
  onPlacingTypeChange: (type: PlaceableHotspotType | null) => void;
  sceneCount: number;
  disabled?: boolean;
  autoReturnLink: boolean;
  onAutoReturnLinkChange: (value: boolean) => void;
};

export function HotspotToolbar({
  placingType,
  onPlacingTypeChange,
  sceneCount,
  disabled = false,
  autoReturnLink,
  onAutoReturnLinkChange,
}: HotspotToolbarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2 border-b bg-background px-3 py-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {HOTSPOT_TOOLS.map((tool) => {
          const Icon = tool.icon;
          const needsScenes =
            Boolean(tool.requiresMultipleScenes) && sceneCount < 2;
          const armed = placingType === tool.type;
          const toolDisabled = disabled || needsScenes;

          return (
            <Button
              key={tool.type}
              type="button"
              size="sm"
              variant={armed ? "default" : "outline"}
              disabled={toolDisabled}
              title={
                needsScenes
                  ? "Add another scene before creating link hotspots"
                  : armed
                    ? "Cancel placing"
                    : tool.label
              }
              aria-pressed={armed}
              onClick={() =>
                onPlacingTypeChange(armed ? null : tool.type)
              }
            >
              <Icon className="size-3.5" />
              <span className="hidden sm:inline">{tool.label}</span>
              <span className="sm:hidden">{tool.shortLabel}</span>
            </Button>
          );
        })}
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Label
          htmlFor="auto-return-link"
          className="text-xs font-normal text-muted-foreground"
        >
          Auto-create return link
        </Label>
        <Switch
          id="auto-return-link"
          checked={autoReturnLink}
          disabled={disabled}
          onCheckedChange={(checked) => {
            writeAutoReturnLink(checked);
            onAutoReturnLinkChange(checked);
          }}
        />
      </div>
    </div>
  );
}

/** Hydrate auto-return preference after mount (avoids SSR mismatch). */
export function useAutoReturnLinkPreference(): [
  boolean,
  (value: boolean) => void,
] {
  const [value, setValue] = useState(true);
  useEffect(() => {
    setValue(readAutoReturnLink());
  }, []);
  return [value, setValue];
}

export function placingBannerText(type: PlaceableHotspotType): string {
  const tool = HOTSPOT_TOOLS.find((item) => item.type === type);
  const name = tool?.shortLabel.toLowerCase() ?? type;
  return `Click on the panorama to place a ${name} hotspot — Esc to cancel`;
}
