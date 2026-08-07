-- Scene groups: optional floor/building/area organization within a tour.

create table if not exists public.scene_groups (
  id uuid primary key default gen_random_uuid(),
  tour_id uuid not null references public.tours (id) on delete cascade,
  name text not null default 'New group',
  position int not null default 0,
  created_at timestamptz not null default now()
);

alter table public.scenes
  add column if not exists group_id uuid references public.scene_groups (id) on delete set null;

create index if not exists scene_groups_tour_id_position_idx
  on public.scene_groups (tour_id, position);

create index if not exists scenes_group_id_position_idx
  on public.scenes (group_id, position);

grant select, insert, update, delete on public.scene_groups to authenticated;
grant select on public.scene_groups to anon;

alter table public.scene_groups enable row level security;

-- scene_groups RLS mirrors scenes: owner CRUD via tours; anon select when public.
drop policy if exists "scene_groups_select" on public.scene_groups;
create policy "scene_groups_select"
  on public.scene_groups
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scene_groups.tour_id
        and (
          tours.owner_id = (select auth.uid())
          or tours.is_public = true
        )
    )
  );

drop policy if exists "scene_groups_insert" on public.scene_groups;
create policy "scene_groups_insert"
  on public.scene_groups
  for insert
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = scene_groups.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "scene_groups_update" on public.scene_groups;
create policy "scene_groups_update"
  on public.scene_groups
  for update
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scene_groups.tour_id
        and tours.owner_id = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = scene_groups.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "scene_groups_delete" on public.scene_groups;
create policy "scene_groups_delete"
  on public.scene_groups
  for delete
  using (
    exists (
      select 1
      from public.tours
      where tours.id = scene_groups.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );
