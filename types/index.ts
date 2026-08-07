import type { Database } from "@/types/database";

export type Tour = Database["public"]["Tables"]["tours"]["Row"];
export type Scene = Database["public"]["Tables"]["scenes"]["Row"];
export type SceneGroup = Database["public"]["Tables"]["scene_groups"]["Row"];
export type FloorPlan = Database["public"]["Tables"]["floor_plans"]["Row"];
export type Hotspot = Database["public"]["Tables"]["hotspots"]["Row"];

export type TourInsert = Database["public"]["Tables"]["tours"]["Insert"];
export type SceneInsert = Database["public"]["Tables"]["scenes"]["Insert"];
export type SceneGroupInsert =
  Database["public"]["Tables"]["scene_groups"]["Insert"];
export type FloorPlanInsert =
  Database["public"]["Tables"]["floor_plans"]["Insert"];
export type HotspotInsert = Database["public"]["Tables"]["hotspots"]["Insert"];
