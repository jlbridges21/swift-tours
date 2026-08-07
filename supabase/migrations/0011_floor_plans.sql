-- Floor plans: uploadable plan image per floor/group with fractional scene markers.

create table if not exists public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  group_id uuid references public.scene_groups (id) on delete cascade,
  name text not null default 'Floor plan',
  storage_path text not null,
  width int not null,
  height int not null,
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.scenes
  add column if not exists floor_plan_id uuid references public.floor_plans (id) on delete set null,
  add column if not exists plan_x double precision,
  add column if not exists plan_y double precision;

create index if not exists floor_plans_tour_id_position_idx
  on public.floor_plans (tour_id, position);

create index if not exists scenes_floor_plan_id_idx
  on public.scenes (floor_plan_id);

grant select, insert, update, delete on public.floor_plans to authenticated;
grant select on public.floor_plans to anon;

alter table public.floor_plans enable row level security;

-- floor_plans RLS mirrors scenes: owner CRUD via tours; anon select when public.
drop policy if exists "floor_plans_select" on public.floor_plans;
create policy "floor_plans_select"
  on public.floor_plans
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = floor_plans.tour_id
        and (
          tours.owner_id = (select auth.uid())
          or tours.is_public = true
        )
    )
  );

drop policy if exists "floor_plans_insert" on public.floor_plans;
create policy "floor_plans_insert"
  on public.floor_plans
  for insert
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = floor_plans.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "floor_plans_update" on public.floor_plans;
create policy "floor_plans_update"
  on public.floor_plans
  for update
  using (
    exists (
      select 1
      from public.tours
      where tours.id = floor_plans.tour_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = floor_plans.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "floor_plans_delete" on public.floor_plans;
create policy "floor_plans_delete"
  on public.floor_plans
  for delete
  using (
    exists (
      select 1
      from public.tours
      where tours.id = floor_plans.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );
