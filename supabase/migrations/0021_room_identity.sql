-- Room identity: multiple scenes can share one physical room (room_key).

alter table public.scenes
  add column if not exists room_key text;

create index if not exists scenes_tour_id_room_key_idx
  on public.scenes (tour_id, room_key);
