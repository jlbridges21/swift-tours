-- Per-scene image adjustments (CSS filter at render time — never baked into files).

alter table public.scenes
  add column if not exists adjust_brightness double precision not null default 1.0,
  add column if not exists adjust_contrast double precision not null default 1.0,
  add column if not exists adjust_saturation double precision not null default 1.0;

alter table public.scenes drop constraint if exists scenes_adjust_brightness_check;
alter table public.scenes
  add constraint scenes_adjust_brightness_check
  check (adjust_brightness between 0.5 and 1.5);

alter table public.scenes drop constraint if exists scenes_adjust_contrast_check;
alter table public.scenes
  add constraint scenes_adjust_contrast_check
  check (adjust_contrast between 0.5 and 1.5);

alter table public.scenes drop constraint if exists scenes_adjust_saturation_check;
alter table public.scenes
  add constraint scenes_adjust_saturation_check
  check (adjust_saturation between 0.0 and 2.0);
