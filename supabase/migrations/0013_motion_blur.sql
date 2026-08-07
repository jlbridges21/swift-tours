-- Motion blur on hotspot (link) transitions.

alter table public.tours
  add column if not exists transition_motion_blur boolean not null default false;
