-- Staging jobs + per-scene staged panorama path (viewer wiring comes later).

alter table public.scenes
  add column if not exists staged_path text,
  add column if not exists staged_enabled boolean not null default false;

create table if not exists public.staging_jobs (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  scene_id uuid references public.scenes (id) on delete cascade,
  kind text not null check (kind in ('nadir_fill', 'stage_room')),
  status text not null default 'queued'
    check (status in ('queued', 'processing', 'succeeded', 'failed', 'cancelled')),
  params jsonb not null default '{}'::jsonb,
  result_path text,
  error text,
  cost_cents int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists staging_jobs_tour_id_created_at_idx
  on public.staging_jobs (tour_id, created_at desc);

create index if not exists staging_jobs_status_idx
  on public.staging_jobs (status);

create index if not exists staging_jobs_scene_id_idx
  on public.staging_jobs (scene_id);

alter table public.staging_jobs enable row level security;

-- Owner-only via tours. Service role bypasses RLS for workers (intentional).

drop policy if exists "staging_jobs_select" on public.staging_jobs;
create policy "staging_jobs_select"
  on public.staging_jobs
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = staging_jobs.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_jobs_insert" on public.staging_jobs;
create policy "staging_jobs_insert"
  on public.staging_jobs
  for insert
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = staging_jobs.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_jobs_update" on public.staging_jobs;
create policy "staging_jobs_update"
  on public.staging_jobs
  for update
  using (
    exists (
      select 1
      from public.tours
      where tours.id = staging_jobs.tour_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = staging_jobs.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "staging_jobs_delete" on public.staging_jobs;
create policy "staging_jobs_delete"
  on public.staging_jobs
  for delete
  using (
    exists (
      select 1
      from public.tours
      where tours.id = staging_jobs.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

-- Keep updated_at fresh on row changes (worker claim / complete).
create or replace function public.set_staging_jobs_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists staging_jobs_set_updated_at on public.staging_jobs;
create trigger staging_jobs_set_updated_at
  before update on public.staging_jobs
  for each row
  execute function public.set_staging_jobs_updated_at();
