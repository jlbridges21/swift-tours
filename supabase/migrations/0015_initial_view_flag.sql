-- Distinguish "no initial view set" from "initial view at 0,0", and make
-- walkthrough-style heading the default for all tours.

-- Limitation: a scene deliberately saved at exactly yaw=0 AND pitch=0 before
-- this migration will be treated as unset. Acceptable one-time edge case.
alter table public.scenes
  add column if not exists has_initial_view boolean not null default false;

update public.scenes
set has_initial_view = true
where initial_yaw <> 0
   or initial_pitch <> 0;

-- Walkthrough alignment is now always-on. Column left in place (vestigial);
-- do not drop it.
update public.tours
set walkthrough_enabled = true;
