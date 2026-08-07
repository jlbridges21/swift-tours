-- Full-resolution panoramas + GPU-compat fallback.
-- Existing scenes were uploaded at 4096×2048; see backfill note in the PR/report.

alter table public.scenes
  add column if not exists compat_path text,
  add column if not exists width int,
  add column if not exists height int,
  add column if not exists file_size int;
