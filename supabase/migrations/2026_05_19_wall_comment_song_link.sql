-- Comments on wall posts can attach a song link too — same shape as wall_notes.
alter table public.wall_note_comments
  add column if not exists track_id uuid references public.tracks(id) on delete set null,
  add column if not exists external_url text;

create index if not exists wnc_track_idx on public.wall_note_comments(track_id);
