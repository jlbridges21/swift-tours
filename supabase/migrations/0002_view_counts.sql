-- Aggregated view counts for dashboard listing.
-- RLS on underlying tours / tour_views still applies via security_invoker.

create or replace view public.tour_view_counts
with (security_invoker = true)
as
select
  t.id as tour_id,
  coalesce(count(tv.id), 0)::bigint as view_count
from public.tours t
left join public.tour_views tv on tv.tour_id = t.id
group by t.id;

grant select on public.tour_view_counts to authenticated;
