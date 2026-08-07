"use client";

import type { CSSProperties, ReactNode } from "react";

import { publicUrl } from "@/lib/storage";
import { cn } from "@/lib/utils";

type FloorPlanFramePlan = {
  name: string;
  storage_path: string;
  width: number;
  height: number;
};

type FloorPlanFrameProps = {
  plan: FloorPlanFramePlan;
  /**
   * Constraints on the IMAGE (e.g. `max-h-40`). The wrapper shrink-wraps to the
   * laid-out image, so marker percentages map to the painted pixels — never a
   * letterboxed outer box.
   */
  imageClassName?: string;
  className?: string;
  children?: ReactNode;
};

/**
 * Shared floor-plan image frame for editor, collapsed panel, and expanded overlay.
 * Markers/children must be positioned as % of this frame (0–100), not an outer container.
 */
export function FloorPlanFrame({
  plan,
  imageClassName,
  className,
  children,
}: FloorPlanFrameProps) {
  return (
    <div className={cn("relative inline-block max-w-full", className)}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={publicUrl(plan.storage_path)}
        alt={plan.name}
        width={plan.width > 0 ? plan.width : undefined}
        height={plan.height > 0 ? plan.height : undefined}
        className={cn("block h-auto w-auto max-w-full", imageClassName)}
        draggable={false}
      />
      {children ? (
        <div className="absolute inset-0">{children}</div>
      ) : null}
    </div>
  );
}

export function floorPlanMarkerStyle(
  planX: number,
  planY: number,
): CSSProperties {
  return {
    left: `${planX * 100}%`,
    top: `${planY * 100}%`,
  };
}
