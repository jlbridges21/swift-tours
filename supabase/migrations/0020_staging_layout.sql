-- Per-scene room analysis + furniture layout assignment for multi-view staging.

alter table public.scenes
  add column if not exists staging_room_analysis jsonb,
  add column if not exists staging_layout jsonb;
