-- =============================================================================
-- TourBuilder — initial schema, RLS, and Storage
-- Paste into Supabase SQL Editor (or run via supabase db push).
-- Idempotent where reasonable; safe to re-run.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Extensions
-- -----------------------------------------------------------------------------
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------

create table if not exists public.tours (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users (id) on delete cascade,
  title text not null default 'Untitled Tour',
  description text,
  slug text not null unique,
  cover_scene_id uuid,
  is_public boolean not null default true,
  password_hash text, -- unused in MVP; Phase 2 password-protected tours
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.scenes (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  name text not null default 'Scene',
  storage_path text not null,
  thumbnail_path text,
  position int not null default 0,
  initial_yaw double precision not null default 0,
  initial_pitch double precision not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.hotspots (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  target_scene_id uuid references public.scenes (id) on delete cascade,
  type text not null default 'link' check (type in ('link', 'info')),
  yaw double precision not null,
  pitch double precision not null,
  label text,
  content text,
  created_at timestamptz not null default now()
);

create table if not exists public.tour_views (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  viewed_at timestamptz not null default now()
);

-- Cover scene FK (deferred until scenes exists)
alter table public.tours drop constraint if exists fk_cover_scene;
alter table public.tours
  add constraint fk_cover_scene
  foreign key (cover_scene_id)
  references public.scenes (id)
  on delete set null;

-- -----------------------------------------------------------------------------
-- Indexes (RLS policies subquery these columns on every row)
-- -----------------------------------------------------------------------------

create index if not exists tours_owner_id_idx on public.tours (owner_id);
create index if not exists tours_slug_idx on public.tours (slug);
create index if not exists scenes_tour_id_position_idx on public.scenes (tour_id, position);
create index if not exists hotspots_scene_id_idx on public.hotspots (scene_id);
create index if not exists hotspots_target_scene_id_idx on public.hotspots (target_scene_id);
create index if not exists tour_views_tour_id_viewed_at_idx on public.tour_views (tour_id, viewed_at);

-- -----------------------------------------------------------------------------
-- updated_at trigger on tours
-- -----------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_tours_updated_at on public.tours;
create trigger set_tours_updated_at
  before update on public.tours
  for each row
  execute function public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Grants (PostgREST roles)
-- -----------------------------------------------------------------------------

grant select, insert, update, delete on public.tours to authenticated;
grant select on public.tours to anon;

grant select, insert, update, delete on public.scenes to authenticated;
grant select on public.scenes to anon;

grant select, insert, update, delete on public.hotspots to authenticated;
grant select on public.hotspots to anon;

grant select, insert on public.tour_views to authenticated;
grant insert on public.tour_views to anon;
grant select on public.tour_views to authenticated;

-- Column-level protection: the public-tour SELECT policy would otherwise expose
-- password_hash to every anonymous visitor via SELECT *. Phase 2 will use this
-- column for gated tours; until then, anon must not read it.
revoke select (password_hash) on public.tours from anon;

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------

alter table public.tours enable row level security;
alter table public.scenes enable row level security;
alter table public.hotspots enable row level security;
alter table public.tour_views enable row level security;

-- tours ----------------------------------------------------------------------

drop policy if exists "tours_select" on public.tours;
create policy "tours_select"
  on public.tours
  for select
  using (
    owner_id = (select auth.uid())
    or is_public = true
  );

drop policy if exists "tours_insert" on public.tours;
create policy "tours_insert"
  on public.tours
  for insert
  with check (owner_id = (select auth.uid()));

drop policy if exists "tours_update" on public.tours;
create policy "tours_update"
  on public.tours
  for update
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

drop policy if exists "tours_delete" on public.tours;
create policy "tours_delete"
  on public.tours
  for delete
  using (owner_id = (select auth.uid()));

-- scenes ---------------------------------------------------------------------

drop policy if exists "scenes_select" on public.scenes;
create policy "scenes_select"
  on public.scenes
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scenes.tour_id
        and (
          tours.owner_id = (select auth.uid())
          or tours.is_public = true
        )
    )
  );

drop policy if exists "scenes_insert" on public.scenes;
create policy "scenes_insert"
  on public.scenes
  for insert
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = scenes.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "scenes_update" on public.scenes;
create policy "scenes_update"
  on public.scenes
  for update
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scenes.tour_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = scenes.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "scenes_delete" on public.scenes;
create policy "scenes_delete"
  on public.scenes
  for delete
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scenes.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

-- hotspots -------------------------------------------------------------------

drop policy if exists "hotspots_select" on public.hotspots;
create policy "hotspots_select"
  on public.hotspots
  for select
  using (
    exists (
      select 1
      from public.scenes
      join public.tours on tours.id = scenes.tour_id
      where scenes.id = hotspots.scene_id
        and (
          tours.owner_id = (select auth.uid())
          or tours.is_public = true
        )
    )
  );

drop policy if exists "hotspots_insert" on public.hotspots;
create policy "hotspots_insert"
  on public.hotspots
  for insert
  with check (
    exists (
      select 1
      from public.scenes
      join public.tours on tours.id = scenes.tour_id
      where scenes.id = hotspots.scene_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "hotspots_update" on public.hotspots;
create policy "hotspots_update"
  on public.hotspots
  for update
  using (
    exists (
      select 1
      from public.scenes
      join public.tours on tours.id = scenes.tour_id
      where scenes.id = hotspots.scene_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.scenes
      join public.tours on tours.id = scenes.tour_id
      where scenes.id = hotspots.scene_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "hotspots_delete" on public.hotspots;
create policy "hotspots_delete"
  on public.hotspots
  for delete
  using (
    exists (
      select 1
      from public.scenes
      join public.tours on tours.id = scenes.tour_id
      where scenes.id = hotspots.scene_id
        and tours.owner_id = (select auth.uid())
    )
  );

-- tour_views -----------------------------------------------------------------
-- insert: anyone (anon + authenticated); select: tour owner only
-- no update / delete policies on purpose

drop policy if exists "tour_views_insert" on public.tour_views;
create policy "tour_views_insert"
  on public.tour_views
  for insert
  with check (true);

drop policy if exists "tour_views_select" on public.tour_views;
create policy "tour_views_select"
  on public.tour_views
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = tour_views.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- Storage: panoramas bucket
--
-- TRADEOFF (MVP): this bucket is PUBLIC. Anyone who obtains an object URL can
-- view the image even if the parent tour is private/unlisted. Phase 2 should
-- switch to private objects + signed URLs so access tracks tour RLS.
--
-- Path convention enforced below: {user_id}/{tour_id}/{scene_id}.jpg
-- -----------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'panoramas',
  'panoramas',
  true,
  52428800, -- 50 MB
  array['image/jpeg', 'image/png', 'image/webp']::text[]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "panoramas_select" on storage.objects;
create policy "panoramas_select"
  on storage.objects
  for select
  using (bucket_id = 'panoramas');

drop policy if exists "panoramas_insert" on storage.objects;
create policy "panoramas_insert"
  on storage.objects
  for insert
  with check (
    bucket_id = 'panoramas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "panoramas_update" on storage.objects;
create policy "panoramas_update"
  on storage.objects
  for update
  using (
    bucket_id = 'panoramas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'panoramas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "panoramas_delete" on storage.objects;
create policy "panoramas_delete"
  on storage.objects
  for delete
  using (
    bucket_id = 'panoramas'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
