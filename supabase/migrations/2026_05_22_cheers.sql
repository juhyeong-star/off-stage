-- ============================================================
-- 2026_05_22_cheers.sql
-- 응원 (cheer): a supporter sends a one-time message to an
-- artist's track. Messages stack up on the artist's heart wall.
-- - One cheer per (supporter, track) — enforced by a unique index.
-- - Anyone can read (the heart wall is public).
-- - Supporter or the artist can delete a cheer.
-- ============================================================

create table if not exists public.cheers (
  id             uuid primary key default gen_random_uuid(),
  artist_id      uuid references auth.users(id) on delete cascade,
  artist_name    text,
  track_id       uuid references public.tracks(id) on delete cascade,
  track_title    text,
  supporter_id   uuid references auth.users(id) on delete set null,
  supporter_name text,
  message        text not null,
  created_at     timestamptz not null default now()
);

-- One cheer per supporter per track
create unique index if not exists cheers_once
  on public.cheers(supporter_id, track_id);
create index if not exists cheers_artist_idx
  on public.cheers(artist_id, created_at desc);
create index if not exists cheers_supporter_idx
  on public.cheers(supporter_id, created_at desc);

alter table public.cheers enable row level security;

drop policy if exists cheers_insert on public.cheers;
create policy cheers_insert on public.cheers
  for insert with check (auth.uid() = supporter_id);

drop policy if exists cheers_select on public.cheers;
create policy cheers_select on public.cheers
  for select using (true);

-- supporter may remove their own cheer; the artist may remove cheers on their wall
drop policy if exists cheers_delete on public.cheers;
create policy cheers_delete on public.cheers
  for delete using (auth.uid() = supporter_id or auth.uid() = artist_id);
