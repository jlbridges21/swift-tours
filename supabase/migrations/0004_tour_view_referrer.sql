-- Optional referrer for embedded tour analytics (parent page URL).
-- Truncation and sanitization happen in the API — treat as untrusted text.

alter table public.tour_views
  add column if not exists referrer text;
