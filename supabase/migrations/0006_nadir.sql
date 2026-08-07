-- Nadir (tripod) patch settings: tour defaults + per-scene generated overlays.

alter table public.tours
  add column if not exists nadir_type text not null default 'none',
  add column if not exists nadir_logo_path text,
  add column if not exists nadir_size double precision not null default 0.35,
  add column if not exists nadir_opacity double precision not null default 1.0,
  add column if not exists nadir_rotation double precision not null default 0;

alter table public.tours drop constraint if exists tours_nadir_type_check;
alter table public.tours
  add constraint tours_nadir_type_check
  check (nadir_type in ('none', 'blur', 'logo'));

alter table public.tours drop constraint if exists tours_nadir_size_check;
alter table public.tours
  add constraint tours_nadir_size_check
  check (nadir_size between 0.1 and 1.0);

alter table public.tours drop constraint if exists tours_nadir_opacity_check;
alter table public.tours
  add constraint tours_nadir_opacity_check
  check (nadir_opacity between 0.1 and 1.0);

alter table public.scenes
  add column if not exists nadir_patch_path text,
  add column if not exists nadir_disabled boolean not null default false;
