-- Gallery + YouTube video hotspots.
-- Store YouTube video_id (11 chars), never a full URL.
-- Gallery slides live in hotspot_images with cascade delete.

alter table public.hotspots drop constraint if exists hotspots_type_check;
alter table public.hotspots
  add constraint hotspots_type_check
  check (type in ('link', 'info', 'gallery', 'video'));

alter table public.hotspots
  add column if not exists video_id text,
  add column if not exists video_start int;

alter table public.hotspots drop constraint if exists hotspots_video_id_check;
alter table public.hotspots
  add constraint hotspots_video_id_check
  check (
    video_id is null
    or video_id ~ '^[A-Za-z0-9_-]{11}$'
  );

alter table public.hotspots drop constraint if exists hotspots_video_start_check;
alter table public.hotspots
  add constraint hotspots_video_start_check
  check (video_start is null or video_start >= 0);

-- Marker shapes for gallery / video defaults.
alter table public.hotspots drop constraint if exists hotspots_style_shape_check;
alter table public.hotspots
  add constraint hotspots_style_shape_check
  check (style_shape in (
    'arrow', 'chevron', 'circle', 'ring', 'pin',
    'info', 'plus', 'pulse-dot', 'label',
    'gallery', 'video'
  ));

alter table public.tours drop constraint if exists tours_default_hotspot_shape_check;
alter table public.tours
  add constraint tours_default_hotspot_shape_check
  check (default_hotspot_shape in (
    'arrow', 'chevron', 'circle', 'ring', 'pin',
    'info', 'plus', 'pulse-dot', 'label',
    'gallery', 'video'
  ));

create table if not exists public.hotspot_images (
  id uuid primary key default gen_random_uuid(),
  hotspot_id uuid not null references public.hotspots (id) on delete cascade,
  storage_path text not null,
  thumbnail_path text,
  caption text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists hotspot_images_hotspot_id_position_idx
  on public.hotspot_images (hotspot_id, position);

grant select, insert, update, delete on public.hotspot_images to authenticated;
grant select on public.hotspot_images to anon;

alter table public.hotspot_images enable row level security;

-- Owner CRUD via hotspot_images → hotspots → scenes → tours;
-- anon select when the parent tour is public.
drop policy if exists "hotspot_images_select" on public.hotspot_images;
create policy "hotspot_images_select"
  on public.hotspot_images
  for select
  using (
    exists (
      select 1
      from public.hotspots
      join public.scenes on scenes.id = hotspots.scene_id
      join public.tours on tours.id = scenes.tour_id
      where hotspots.id = hotspot_images.hotspot_id
        and (
          tours.owner_id = (select auth.uid())
          or tours.is_public = true
        )
    )
  );

drop policy if exists "hotspot_images_insert" on public.hotspot_images;
create policy "hotspot_images_insert"
  on public.hotspot_images
  for insert
  with check (
    exists (
      select 1
      from public.hotspots
      join public.scenes on scenes.id = hotspots.scene_id
      join public.tours on tours.id = scenes.tour_id
      where hotspots.id = hotspot_images.hotspot_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "hotspot_images_update" on public.hotspot_images;
create policy "hotspot_images_update"
  on public.hotspot_images
  for update
  using (
    exists (
      select 1
      from public.hotspots
      join public.scenes on scenes.id = hotspots.scene_id
      join public.tours on tours.id = scenes.tour_id
      where hotspots.id = hotspot_images.hotspot_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.hotspots
      join public.scenes on scenes.id = hotspots.scene_id
      join public.tours on tours.id = scenes.tour_id
      where hotspots.id = hotspot_images.hotspot_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "hotspot_images_delete" on public.hotspot_images;
create policy "hotspot_images_delete"
  on public.hotspot_images
  for delete
  using (
    exists (
      select 1
      from public.hotspots
      join public.scenes on scenes.id = hotspots.scene_id
      join public.tours on tours.id = scenes.tour_id
      where hotspots.id = hotspot_images.hotspot_id
        and tours.owner_id = (select auth.uid())
    )
  );
