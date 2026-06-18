-- ============================================================
-- 2026_06_18_playlist_notes_sync.sql
-- 폴더(플레이리스트) 안에 담은 '포스트잇'이 PC↔모바일 동기화 안 되던 문제.
--
-- 원인: 폴더 곡은 playlist_tracks(서버)에 저장돼 동기화됐지만, 폴더 포스트잇은
--   localStorage('folder_notes:<id>')에만 저장돼 기기-로컬이었음. 그래서 폴더에
--   넣은 포스트잇이 다른 기기엔 안 보이고, 폴더 카운트(곡+노트)도 노트 수만큼 어긋남.
--
-- 해결: 폴더 포스트잇용 서버 테이블 playlist_notes 신설 + RLS. 곡(playlist_tracks)도
--   본인 폴더면 추가/삭제 보장(공개 읽기 유지).
--
-- 실행: Supabase 대시보드 → SQL Editor → Run (한 번만, idempotent).
-- ============================================================

-- ── 폴더 포스트잇 (playlist_notes) ──
create table if not exists public.playlist_notes (
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  note_id     uuid not null references public.wall_notes(id) on delete cascade,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, note_id)
);
create index if not exists playlist_notes_playlist_idx on public.playlist_notes(playlist_id);

alter table public.playlist_notes enable row level security;

-- 폴더 내용은 누구나 볼 수 있음(playlists 가 public read 라 일관)
drop policy if exists "playlist_notes_public_read" on public.playlist_notes;
create policy "playlist_notes_public_read"
  on public.playlist_notes for select using (true);

-- 추가/삭제는 그 폴더 주인만
drop policy if exists "playlist_notes_owner_write" on public.playlist_notes;
create policy "playlist_notes_owner_write"
  on public.playlist_notes for all
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.playlists p
                      where p.id = playlist_id and p.owner_id = auth.uid()));

-- ── 폴더 곡 (playlist_tracks) — 본인 폴더면 추가/삭제 보장(공개 읽기 유지) ──
alter table public.playlist_tracks enable row level security;

drop policy if exists "playlist_tracks_public_read" on public.playlist_tracks;
create policy "playlist_tracks_public_read"
  on public.playlist_tracks for select using (true);

drop policy if exists "playlist_tracks_owner_write" on public.playlist_tracks;
create policy "playlist_tracks_owner_write"
  on public.playlist_tracks for all
  using (exists (select 1 from public.playlists p
                 where p.id = playlist_id and p.owner_id = auth.uid()))
  with check (exists (select 1 from public.playlists p
                      where p.id = playlist_id and p.owner_id = auth.uid()));
