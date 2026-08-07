-- Nadir logo source discrimination + feather (baked into patch).

alter table public.tours
  add column if not exists nadir_feather double precision not null default 0.35,
  add column if not exists nadir_logo_source text not null default 'default';

alter table public.tours drop constraint if exists tours_nadir_feather_check;
alter table public.tours
  add constraint tours_nadir_feather_check
  check (nadir_feather between 0.0 and 1.0);

alter table public.tours drop constraint if exists tours_nadir_logo_source_check;
alter table public.tours
  add constraint tours_nadir_logo_source_check
  check (nadir_logo_source in ('default', 'custom'));

-- Backfill: existing custom logo paths → 'custom'
update public.tours
set nadir_logo_source = 'custom'
where nadir_logo_path is not null
  and nadir_logo_source = 'default';
