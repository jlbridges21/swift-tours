-- Separate "where the tour opens" from the cover/thumbnail scene.
-- cover_scene_id remains the dashboard card + social OG image.
-- start_scene_id is the default opening scene for visitors (nullable =
-- same resolution fallthrough as cover / first-in-order).

alter table public.tours
  add column if not exists start_scene_id uuid;

alter table public.tours drop constraint if exists fk_start_scene;
alter table public.tours
  add constraint fk_start_scene
  foreign key (start_scene_id)
  references public.scenes (id)
  on delete set null;

create index if not exists tours_start_scene_id_idx
  on public.tours (start_scene_id);
