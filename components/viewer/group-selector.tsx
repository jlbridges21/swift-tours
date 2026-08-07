"use client";

import { useEffect, useMemo, useState } from "react";

import { scenesInGroup } from "@/lib/scene-groups";
import { cn } from "@/lib/utils";
import type { Scene, SceneGroup } from "@/types";

export const OTHER_GROUP_KEY = "__other__" as const;

type GroupSelectorProps = {
  groups: SceneGroup[];
  scenes: Scene[];
  selectedKey: string;
  onSelect: (key: string) => void;
};

/**
 * Horizontal pill row, or a native select when there are many groups.
 * Only rendered by the parent when the tour has at least one group.
 */
export function GroupSelector({
  groups,
  scenes,
  selectedKey,
  onSelect,
}: GroupSelectorProps) {
  const sorted = useMemo(
    () => [...groups].sort((a, b) => a.position - b.position),
    [groups],
  );
  const ungrouped = useMemo(() => scenesInGroup(scenes, null), [scenes]);
  const showOther = ungrouped.length > 0;

  const options = useMemo(() => {
    const items = sorted.map((group) => ({
      key: group.id,
      label: group.name,
      count: scenesInGroup(scenes, group.id).length,
    }));
    if (showOther) {
      items.push({
        key: OTHER_GROUP_KEY,
        label: "Other",
        count: ungrouped.length,
      });
    }
    return items;
  }, [sorted, scenes, showOther, ungrouped.length]);

  const useDropdown = options.length > 5;

  if (useDropdown) {
    return (
      <div className="pointer-events-auto mx-auto w-full max-w-5xl px-4 pb-2">
        <label className="sr-only" htmlFor="tour-group-select">
          Scene group
        </label>
        <select
          id="tour-group-select"
          value={selectedKey}
          onChange={(event) => onSelect(event.target.value)}
          className="w-full max-w-xs rounded-md border border-white/25 bg-black/55 px-3 py-1.5 text-sm text-white backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
        >
          {options.map((option) => (
            <option key={option.key} value={option.key}>
              {option.label}
              {option.count > 0 ? ` (${option.count})` : ""}
            </option>
          ))}
        </select>
      </div>
    );
  }

  return (
    <div
      role="tablist"
      aria-label="Scene groups"
      className="pointer-events-auto mx-auto flex max-w-5xl gap-2 overflow-x-auto overscroll-x-contain px-4 pb-2 [-webkit-overflow-scrolling:touch]"
    >
          {options.map((option) => {
        const active = option.key === selectedKey;
        return (
          <button
            key={option.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onSelect(option.key)}
            className={cn(
              "shrink-0 rounded-full px-3 py-1 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white",
              active
                ? "bg-white text-black"
                : "bg-white/15 text-white hover:bg-white/25",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Resolve which selector key owns a scene. */
export function groupKeyForScene(
  scene: Scene | undefined,
  groups: SceneGroup[],
): string | null {
  if (!scene) return null;
  if (scene.group_id && groups.some((group) => group.id === scene.group_id)) {
    return scene.group_id;
  }
  if (groups.length > 0 && scene.group_id === null) {
    return OTHER_GROUP_KEY;
  }
  return scene.group_id;
}

export function useAutoSelectedGroupKey(
  groups: SceneGroup[],
  scenes: Scene[],
  currentSceneId: string | null,
): [string, (key: string) => void] {
  const initial = useMemo(() => {
    const scene = scenes.find((item) => item.id === currentSceneId) ?? scenes[0];
    const key = groupKeyForScene(scene, groups);
    if (key) return key;
    return groups[0]?.id ?? OTHER_GROUP_KEY;
  }, [groups, scenes, currentSceneId]);

  const [selectedKey, setSelectedKey] = useState(initial);

  useEffect(() => {
    const scene = scenes.find((item) => item.id === currentSceneId);
    const key = groupKeyForScene(scene, groups);
    if (key) setSelectedKey(key);
  }, [currentSceneId, scenes, groups]);

  return [selectedKey, setSelectedKey];
}

export function filterScenesForGroupKey(
  scenes: Scene[],
  groups: SceneGroup[],
  key: string,
): Scene[] {
  if (key === OTHER_GROUP_KEY) {
    return scenesInGroup(scenes, null);
  }
  if (groups.some((group) => group.id === key)) {
    return scenesInGroup(scenes, key);
  }
  return scenes;
}
