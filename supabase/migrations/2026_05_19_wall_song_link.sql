-- Wall posts can attach a song link — either an Off-Stage track or an external URL
-- (YouTube / Spotify / Apple Music). Both columns are nullable; UI shows at most one.

alter table public.wall_notes
  add column if not exists track_id uuid references public.tracks(id) on delete set null,
  add column if not exists external_url text;

create index if not exists wall_notes_track_idx on public.wall_notes(track_id);
