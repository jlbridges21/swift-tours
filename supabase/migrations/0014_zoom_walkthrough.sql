-- Zoom (walk-in) transition preset, walkthrough heading mode,
-- hotspot placement (2d / floor / wall) + rotation, and analytics tables.

-- ─── Tours: zoom effect + walkthrough ───────────────────────────────────────

alter table public.tours drop constraint if exists tours_transition_effect_check;
alter table public.tours
  add constraint tours_transition_effect_check
  check (transition_effect in ('none', 'fade', 'black', 'white', 'zoom'));

alter table public.tours
  add column if not exists walkthrough_enabled boolean not null default false;

-- ─── Hotspots: placement mode + orientation ───────────────────────────────

alter table public.hotspots
  add column if not exists position_mode text not null default '2d',
  add column if not exists style_rotation double precision not null default 0,
  add column if not exists orient_yaw double precision not null default 0,
  add column if not exists orient_pitch double precision not null default 0;

alter table public.hotspots drop constraint if exists hotspots_position_mode_check;
alter table public.hotspots
  add constraint hotspots_position_mode_check
  check (position_mode in ('2d', 'floor', 'wall'));

alter table public.hotspots drop constraint if exists hotspots_style_rotation_check;
alter table public.hotspots
  add constraint hotspots_style_rotation_check
  check (style_rotation >= 0 and style_rotation <= 360);

-- ─── Analytics ────────────────────────────────────────────────────────────

create table if not exists public.tour_sessions (
  id uuid primary key,
  tour_id uuid not null references public.tours (id) on delete cascade,
  visitor_id text not null,
  is_embed boolean not null default false,
  started_at timestamptz not null default now(),
  duration_ms int not null default 0
);

create table if not exists public.scene_dwell (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tour_sessions (id) on delete cascade,
  scene_id uuid not null references public.scenes (id) on delete cascade,
  dwell_ms int not null default 0
);

create table if not exists public.hotspot_clicks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.tour_sessions (id) on delete cascade,
  hotspot_id uuid not null references public.hotspots (id) on delete cascade,
  clicked_at timestamptz not null default now()
);

create index if not exists tour_sessions_tour_id_started_at_idx
  on public.tour_sessions (tour_id, started_at);

create index if not exists scene_dwell_session_id_idx
  on public.scene_dwell (session_id);

create index if not exists scene_dwell_scene_id_idx
  on public.scene_dwell (scene_id);

create index if not exists hotspot_clicks_hotspot_id_idx
  on public.hotspot_clicks (hotspot_id);

-- Idempotent dwell flushes: one row per session×scene, absolute dwell_ms.
create unique index if not exists scene_dwell_session_scene_uidx
  on public.scene_dwell (session_id, scene_id);

grant select, insert, update on public.tour_sessions to anon;
grant select, insert, update on public.tour_sessions to authenticated;
grant select, insert, update on public.scene_dwell to anon;
grant select, insert, update on public.scene_dwell to authenticated;
grant select, insert on public.hotspot_clicks to anon;
grant select, insert on public.hotspot_clicks to authenticated;

alter table public.tour_sessions enable row level security;
alter table public.scene_dwell enable row level security;
alter table public.hotspot_clicks enable row level security;

-- Anon/authenticated may insert sessions for any existing tour (public + owner preview).
drop policy if exists "tour_sessions_insert" on public.tour_sessions;
create policy "tour_sessions_insert"
  on public.tour_sessions
  for insert
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = tour_sessions.tour_id
    )
  );

-- Updates allowed for any row the client can address by id (session is secret).
-- Duration/dwell flushes are cumulative; RLS cannot bind visitor_id without JWT.
drop policy if exists "tour_sessions_update" on public.tour_sessions;
create policy "tour_sessions_update"
  on public.tour_sessions
  for update
  using (
    exists (
      select 1
      from public.tours
      where tours.id = tour_sessions.tour_id
    )
  )
  with check (
    exists (
      select 1
      from public.tours
      where tours.id = tour_sessions.tour_id
    )
  );

-- Owner may read all sessions for their tours.
drop policy if exists "tour_sessions_select_owner" on public.tour_sessions;
create policy "tour_sessions_select_owner"
  on public.tour_sessions
  for select
  using (
    exists (
      select 1
      from public.tours
      where tours.id = tour_sessions.tour_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "scene_dwell_insert" on public.scene_dwell;
create policy "scene_dwell_insert"
  on public.scene_dwell
  for insert
  with check (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = scene_dwell.session_id
    )
  );

drop policy if exists "scene_dwell_update" on public.scene_dwell;
create policy "scene_dwell_update"
  on public.scene_dwell
  for update
  using (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = scene_dwell.session_id
    )
  )
  with check (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = scene_dwell.session_id
    )
  );

drop policy if exists "scene_dwell_select_owner" on public.scene_dwell;
create policy "scene_dwell_select_owner"
  on public.scene_dwell
  for select
  using (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = scene_dwell.session_id
        and tours.owner_id = (select auth.uid())
    )
  );

drop policy if exists "hotspot_clicks_insert" on public.hotspot_clicks;
create policy "hotspot_clicks_insert"
  on public.hotspot_clicks
  for insert
  with check (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = hotspot_clicks.session_id
    )
  );

drop policy if exists "hotspot_clicks_select_owner" on public.hotspot_clicks;
create policy "hotspot_clicks_select_owner"
  on public.hotspot_clicks
  for select
  using (
    exists (
      select 1
      from public.tour_sessions
      join public.tours on tours.id = tour_sessions.tour_id
      where tour_sessions.id = hotspot_clicks.session_id
        and tours.owner_id = (select auth.uid())
    )
  );

-- Owner analytics aggregate (security invoker — RLS applies).
create or replace function public.tour_analytics_summary(
  p_tour_id uuid,
  p_since timestamptz default null
)
returns json
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  result json;
begin
  -- Ensure caller owns the tour (defense in depth alongside RLS).
  if not exists (
    select 1 from public.tours
    where id = p_tour_id and owner_id = (select auth.uid())
  ) then
    raise exception 'not authorized';
  end if;

  select json_build_object(
    'summary', json_build_object(
      'unique_visitors', (
        select count(distinct visitor_id)::int
        from public.tour_sessions s
        where s.tour_id = p_tour_id
          and (p_since is null or s.started_at >= p_since)
      ),
      'total_sessions', (
        select count(*)::int
        from public.tour_sessions s
        where s.tour_id = p_tour_id
          and (p_since is null or s.started_at >= p_since)
      ),
      'avg_duration_ms', (
        select coalesce(avg(s.duration_ms), 0)::float8
        from public.tour_sessions s
        where s.tour_id = p_tour_id
          and (p_since is null or s.started_at >= p_since)
          and s.duration_ms > 0
      ),
      'total_hotspot_clicks', (
        select count(*)::int
        from public.hotspot_clicks hc
        join public.tour_sessions s on s.id = hc.session_id
        where s.tour_id = p_tour_id
          and (p_since is null or s.started_at >= p_since)
      )
    ),
    'scenes', coalesce((
      select json_agg(row_to_json(x) order by x.sort_key)
      from (
        select
          sc.id,
          sc.name,
          sc.thumbnail_path,
          sc.group_id,
          sc.position as sort_key,
          coalesce(v.views, 0)::int as views,
          coalesce(v.avg_dwell_ms, 0)::float8 as avg_dwell_ms,
          case
            when sess.total_sessions = 0 then 0
            else round(100.0 * coalesce(v.views, 0) / sess.total_sessions, 1)
          end as reach_pct
        from public.scenes sc
        cross join lateral (
          select count(*)::int as total_sessions
          from public.tour_sessions s
          where s.tour_id = p_tour_id
            and (p_since is null or s.started_at >= p_since)
        ) sess
        left join lateral (
          select
            count(distinct sd.session_id)::int as views,
            avg(sd.dwell_ms)::float8 as avg_dwell_ms
          from public.scene_dwell sd
          join public.tour_sessions s on s.id = sd.session_id
          where sd.scene_id = sc.id
            and s.tour_id = p_tour_id
            and (p_since is null or s.started_at >= p_since)
            and sd.dwell_ms > 0
        ) v on true
        where sc.tour_id = p_tour_id
      ) x
    ), '[]'::json),
    'hotspots', coalesce((
      select json_agg(row_to_json(h) order by h.scene_position, h.created_at)
      from (
        select
          hs.id,
          hs.type,
          hs.label,
          hs.scene_id,
          sc.name as scene_name,
          sc.position as scene_position,
          hs.created_at,
          tgt.name as target_scene_name,
          coalesce(c.clicks, 0)::int as clicks,
          case
            when coalesce(sv.views, 0) = 0 then 0
            else round(100.0 * coalesce(c.clicks, 0) / sv.views, 1)
          end as ctr_pct
        from public.hotspots hs
        join public.scenes sc on sc.id = hs.scene_id
        left join public.scenes tgt on tgt.id = hs.target_scene_id
        left join lateral (
          select count(*)::int as clicks
          from public.hotspot_clicks hc
          join public.tour_sessions s on s.id = hc.session_id
          where hc.hotspot_id = hs.id
            and s.tour_id = p_tour_id
            and (p_since is null or s.started_at >= p_since)
        ) c on true
        left join lateral (
          select count(distinct sd.session_id)::int as views
          from public.scene_dwell sd
          join public.tour_sessions s on s.id = sd.session_id
          where sd.scene_id = hs.scene_id
            and s.tour_id = p_tour_id
            and (p_since is null or s.started_at >= p_since)
            and sd.dwell_ms > 0
        ) sv on true
        where sc.tour_id = p_tour_id
      ) h
    ), '[]'::json)
  ) into result;

  return result;
end;
$$;

revoke all on function public.tour_analytics_summary(uuid, timestamptz) from public;
grant execute on function public.tour_analytics_summary(uuid, timestamptz) to authenticated;
