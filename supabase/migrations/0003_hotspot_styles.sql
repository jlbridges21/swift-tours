-- Hotspot appearance styles + tour-level defaults.
-- Existing rows pick up defaults; no backfill required.

alter table public.hotspots
  add column if not exists style_shape text not null default 'arrow',
  add column if not exists style_color text not null default '#FFFFFF',
  add column if not exists style_size int not null default 48,
  add column if not exists style_animation text not null default 'pulse',
  add column if not exists label_visibility text not null default 'hover';

alter table public.hotspots drop constraint if exists hotspots_style_shape_check;
alter table public.hotspots
  add constraint hotspots_style_shape_check
  check (style_shape in (
    'arrow', 'chevron', 'circle', 'ring', 'pin',
    'info', 'plus', 'pulse-dot', 'label'
  ));

alter table public.hotspots drop constraint if exists hotspots_style_size_check;
alter table public.hotspots
  add constraint hotspots_style_size_check
  check (style_size between 16 and 128);

alter table public.hotspots drop constraint if exists hotspots_style_animation_check;
alter table public.hotspots
  add constraint hotspots_style_animation_check
  check (style_animation in ('none', 'pulse', 'bounce', 'float'));

alter table public.hotspots drop constraint if exists hotspots_label_visibility_check;
alter table public.hotspots
  add constraint hotspots_label_visibility_check
  check (label_visibility in ('hover', 'always', 'never'));

alter table public.hotspots drop constraint if exists hotspots_style_color_check;
alter table public.hotspots
  add constraint hotspots_style_color_check
  check (style_color ~ '^#[0-9A-Fa-f]{6}$');

alter table public.tours
  add column if not exists default_hotspot_shape text not null default 'arrow',
  add column if not exists default_hotspot_color text not null default '#FFFFFF';

alter table public.tours drop constraint if exists tours_default_hotspot_shape_check;
alter table public.tours
  add constraint tours_default_hotspot_shape_check
  check (default_hotspot_shape in (
    'arrow', 'chevron', 'circle', 'ring', 'pin',
    'info', 'plus', 'pulse-dot', 'label'
  ));

alter table public.tours drop constraint if exists tours_default_hotspot_color_check;
alter table public.tours
  add constraint tours_default_hotspot_color_check
  check (default_hotspot_color ~ '^#[0-9A-Fa-f]{6}$');
