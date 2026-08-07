import type { Database } from "@/types/database";

export type Tour = Database["public"]["Tables"]["tours"]["Row"];
export type Scene = Database["public"]["Tables"]["scenes"]["Row"];
export type Hotspot = Database["public"]["Tables"]["hotspots"]["Row"];

export type TourInsert = Database["public"]["Tables"]["tours"]["Insert"];
export type SceneInsert = Database["public"]["Tables"]["scenes"]["Insert"];
export type HotspotInsert = Database["public"]["Tables"]["hotspots"]["Insert"];
