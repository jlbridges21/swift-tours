-- Virtual staging: room types, tour staging plan, multi-step jobs, staging_views.
-- Idempotent where reasonable.

-- ---------------------------------------------------------------------------
-- scenes
-- ---------------------------------------------------------------------------
alter table public.scenes
  add column if not exists room_type text
    check (
      room_type is null
      or room_type in (
        'living_room',
        'bedroom',
        'primary_bedroom',
        'kitchen',
        'dining_room',
        'office',
        'bathroom',
        'entry',
        'basement',
        'outdoor',
        'other'
      )
    ),
  add column if not exists staging_candidate_path text,
  add column if not exists staging_candidate_job_id uuid
    references public.staging_jobs (id) on delete set null;

-- ---------------------------------------------------------------------------
-- tours
-- ---------------------------------------------------------------------------
alter table public.tours
  add column if not exists staging_plan jsonb,
  add column if not exists staging_style text,
  add column if not exists staging_seed int;

-- ---------------------------------------------------------------------------
-- staging_jobs — multi-step cursor + per-view results
-- ---------------------------------------------------------------------------
alter table public.staging_jobs
  add column if not exists step int not null default 0,
  add column if not exists total_steps int,
  add column if not exists view_results jsonb not null default '[]'::jsonb,
  add column if not exists reference_paths jsonb;

-- ---------------------------------------------------------------------------
-- staging_views — persisted per-view artifacts (retries + future S4b refs)
-- ---------------------------------------------------------------------------
create table if not exists public.staging_views (
  id uuid primary key default gen_random_uuid(),
  scene_id uuid not null references public.scenes (id) on delete cascade,
  job_id uuid not null references public.staging_jobs (id) on delete cascade,
  view_index int not null,
  yaw double precision not null,
  pitch double precision not null,
  fov double precision not null,
  source_path text,
  result_path text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'succeeded', 'failed')),
  created_at timestamptz not null default now(),
  unique (job_id, view_index)
);

create index if not exists staging_views_job_id_idx
  on public.staging_views (job_id);

create index if not exists staging_views_scene_id_idx
  on public.staging_views (scene_id);

alter table public.staging_views enable row level security;

drop policy if exists "staging_views_select" on public.staging_views;
create policy "staging_views_select"
  on public.staging_views
  for select
  using (
    exists (
      select 1
      from public.staging_jobs
      join public.tours on tours.id = staging_jobs.tour_id
      where staging_jobs.id = staging_views.job_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_views_insert" on public.staging_views;
create policy "staging_views_insert"
  on public.staging_views
  for insert
  with check (
    exists (
      select 1
      from public.staging_jobs
      join public.tours on tours.id = staging_jobs.tour_id
      where staging_jobs.id = staging_views.job_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_views_update" on public.staging_views;
create policy "staging_views_update"
  on public.staging_views
  for update
  using (
    exists (
      select 1
      from public.staging_jobs
      join public.tours on tours.id = staging_jobs.tour_id
      where staging_jobs.id = staging_views.job_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.staging_jobs
      join public.tours on tours.id = staging_jobs.tour_id
      where staging_jobs.id = staging_views.job_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_views_delete" on public.staging_views;
create policy "staging_views_delete"
  on public.staging_views
  for delete
  using (
    exists (
      select 1
      from public.staging_jobs
      join public.tours on tours.id = staging_jobs.tour_id
      where staging_jobs.id = staging_views.job_id
        and tours.owner_id = (select auth.uid())
    )
  );

grant select, insert, update, delete on public.staging_views to authenticated;
grant all on public.staging_views to service_role;
