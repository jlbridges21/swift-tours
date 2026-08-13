-- Cleaned (tripod/nadir) + staged compat variants; provider fields on jobs.
-- Tripod removal and furniture staging stay independently revertible.

alter table public.scenes
  add column if not exists cleaned_path text,
  add column if not exists cleaned_compat_path text,
  add column if not exists cleaned_enabled boolean not null default false,
  add column if not exists staged_compat_path text;

alter table public.staging_jobs
  add column if not exists provider text,
  add column if not exists provider_job_id text;

create index if not exists staging_jobs_provider_job_id_idx
  on public.staging_jobs (provider_job_id)
  where provider_job_id is not null;
