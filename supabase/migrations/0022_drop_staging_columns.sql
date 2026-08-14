-- OPTIONAL / DO NOT RUN YET.
-- Drop virtual room staging columns and tables once you are confident nadir
-- cleanup still works without them. Leaving unused columns in place is fine.
--
-- IMPORTANT: staging_jobs.kind must continue to allow 'nadir_fill'. Do not
-- remove the staging_jobs table. Only trim room-staging-specific columns.

-- scenes: room staging variants + plan metadata
alter table public.scenes
  drop column if exists staged_path,
  drop column if exists staged_compat_path,
  drop column if exists staged_enabled,
  drop column if exists room_type,
  drop column if exists room_key,
  drop column if exists staging_candidate_path,
  drop column if exists staging_candidate_job_id,
  drop column if exists staging_room_analysis,
  drop column if exists staging_layout;

-- tours: locked staging questionnaire / plan
alter table public.tours
  drop column if exists staging_plan,
  drop column if exists staging_style,
  drop column if exists staging_seed;

-- per-view room staging rows
drop table if exists public.staging_views;

-- multi-step room staging fields on jobs (nadir_fill does not need these)
alter table public.staging_jobs
  drop column if exists step,
  drop column if exists total_steps,
  drop column if exists view_results,
  drop column if exists reference_paths;

-- Keep staging_jobs and kind='nadir_fill'. If a check constraint still lists
-- 'stage_room', recreate it as nadir_fill-only, for example:
--   alter table public.staging_jobs drop constraint if exists staging_jobs_kind_check;
--   alter table public.staging_jobs
--     add constraint staging_jobs_kind_check check (kind = 'nadir_fill');
