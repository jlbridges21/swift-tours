-- Viewer effects: little-planet intro, transitions, gyroscope & VR availability.

alter table public.tours
  add column if not exists intro_effect text not null default 'none',
  add column if not exists transition_effect text not null default 'fade',
  add column if not exists transition_speed int not null default 1500,
  add column if not exists transition_zoom boolean not null default true,
  add column if not exists transition_rotation boolean not null default true,
  add column if not exists gyroscope_enabled boolean not null default true,
  add column if not exists vr_enabled boolean not null default true;

alter table public.tours drop constraint if exists tours_intro_effect_check;
alter table public.tours
  add constraint tours_intro_effect_check
  check (intro_effect in ('none', 'little_planet'));

alter table public.tours drop constraint if exists tours_transition_effect_check;
alter table public.tours
  add constraint tours_transition_effect_check
  check (transition_effect in ('none', 'fade', 'black', 'white'));

alter table public.tours drop constraint if exists tours_transition_speed_check;
alter table public.tours
  add constraint tours_transition_speed_check
  check (transition_speed between 300 and 5000);
