-- ============================================================
-- 2026_06_18_favorites_bookmarks_sync_rls.sql
-- 즐겨찾기(내 우주)가 PC↔모바일 동기화 안 되던 문제.
--
-- 원인: 곡 좋아요(track_favorites)·포스트잇 수집(note_bookmarks) 두 테이블은
--   마이그레이션 없이 대시보드에서 수동 생성돼 RLS 정책이 불완전했음.
--   (형제 테이블 note_favorites 도 같은 이유로 DELETE 정책이 빠져 있던 게 확인됨.)
--   정책이 막혀 본인 좋아요/수집이 서버에 저장·조회가 안 되니, 각 기기가 자기
--   localStorage 만 보여 "전혀 다른 즐겨찾기"처럼 보임.
--
-- 해결: 두 테이블 모두 '본인 행' self CRUD(select/insert/update/delete) 보장.
--   둘 다 비공개(self read) — 내 즐겨찾기는 나만 봄. 같은 계정이면 어느 기기서든
--   같은 서버 데이터를 읽어 동기화됨.
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run (한 번만).
--   idempotent — drop policy if exists 로 여러 번 실행해도 안전.
--   (테이블은 이미 존재. 없으면 먼저 만들어져 있어야 함.)
-- ============================================================

-- ── 곡 좋아요 (track_favorites: user_id, track_id, favorited_at) ──
alter table public.track_favorites enable row level security;

drop policy if exists "track_favorites_self_select" on public.track_favorites;
create policy "track_favorites_self_select"
  on public.track_favorites for select
  using (auth.uid() = user_id);

drop policy if exists "track_favorites_self_write" on public.track_favorites;
create policy "track_favorites_self_write"
  on public.track_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ── 포스트잇 수집 (note_bookmarks: user_id, note_id) ──
alter table public.note_bookmarks enable row level security;

drop policy if exists "note_bookmarks_self_select" on public.note_bookmarks;
create policy "note_bookmarks_self_select"
  on public.note_bookmarks for select
  using (auth.uid() = user_id);

drop policy if exists "note_bookmarks_self_write" on public.note_bookmarks;
create policy "note_bookmarks_self_write"
  on public.note_bookmarks for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (선택) 확인용 — 정책 목록:
-- select tablename, policyname, cmd from pg_policies
--   where schemaname='public' and tablename in ('track_favorites','note_bookmarks')
--   order by tablename, cmd;
