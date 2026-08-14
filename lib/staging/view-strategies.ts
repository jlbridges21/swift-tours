/**
 * View strategies for multi-view room staging bake-off.
 * Angles in radians. Pitch: +up / −down.
 */

export type StagingViewSpec = {
  index: number;
  yaw: number;
  pitch: number;
  /** Vertical FOV in radians. */
  fov: number;
  label: string;
};

export type ViewStrategyId = "A" | "B" | "C" | "D";

export type ViewStrategy = {
  id: ViewStrategyId;
  name: string;
  description: string;
  /** Perspective output size (square). */
  size: number;
  views: StagingViewSpec[];
};

function deg(d: number): number {
  return (d * Math.PI) / 180;
}

/** A. Four cardinal views, ~110° FOV, pitched down ~20°. */
export function strategyA(): ViewStrategy {
  const fov = deg(110);
  const pitch = deg(-20);
  const yaws = [0, 90, 180, 270].map(deg);
  return {
    id: "A",
    name: "Four cardinal @ 110°",
    description: "Four views, 110° FOV, pitched −20°, generous overlap",
    size: 1024,
    views: yaws.map((yaw, index) => ({
      index,
      yaw,
      pitch,
      fov,
      label: `cardinal_${index}`,
    })),
  };
}

/** B. Six views, ~90° FOV, pitched down ~15°. */
export function strategyB(): ViewStrategy {
  const fov = deg(90);
  const pitch = deg(-15);
  const yaws = [0, 60, 120, 180, 240, 300].map(deg);
  return {
    id: "B",
    name: "Six views @ 90°",
    description: "Six views, 90° FOV, pitched −15°",
    size: 1024,
    views: yaws.map((yaw, index) => ({
      index,
      yaw,
      pitch,
      fov,
      label: `six_${index}`,
    })),
  };
}

/** C. Three wide views, ~140° FOV. */
export function strategyC(): ViewStrategy {
  const fov = deg(140);
  const pitch = deg(-18);
  const yaws = [0, 120, 240].map(deg);
  return {
    id: "C",
    name: "Three wide @ 140°",
    description: "Three views, 140° FOV — fewer boundaries",
    size: 1280,
    views: yaws.map((yaw, index) => ({
      index,
      yaw,
      pitch,
      fov,
      label: `wide_${index}`,
    })),
  };
}

/**
 * D. Single stereographic lower-hemisphere (little planet) — handled separately
 * via nadirCrop in the processor when strategy is D.
 */
export function strategyD(): ViewStrategy {
  return {
    id: "D",
    name: "Little-planet nadir",
    description: "One stereographic lower-hemisphere view of the entire floor",
    size: 1536,
    views: [
      {
        index: 0,
        yaw: 0,
        pitch: -Math.PI / 2,
        fov: deg(160),
        label: "little_planet",
      },
    ],
  };
}

export function getViewStrategy(id: ViewStrategyId): ViewStrategy {
  switch (id) {
    case "A":
      return strategyA();
    case "B":
      return strategyB();
    case "C":
      return strategyC();
    case "D":
      return strategyD();
    default:
      return strategyA();
  }
}

/** Rough cost: $0.04 per Kontext image × view count. */
export function estimateStrategyCostCents(id: ViewStrategyId): number {
  const s = getViewStrategy(id);
  return s.views.length * 4;
}

/** Rough wall time: ~45s per view + composite. */
export function estimateStrategySeconds(id: ViewStrategyId): number {
  const s = getViewStrategy(id);
  return s.views.length * 45 + 20;
}
