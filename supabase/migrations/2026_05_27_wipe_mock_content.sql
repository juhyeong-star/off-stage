-- ============================================================
-- 2026_05_27_wipe_mock_content.sql
-- 가짜 시드 데이터(트랙·포스트잇·댓글·응원·분석 이력) 전부 삭제.
-- ⚠️ 한 번만 실행. profiles / auth.users / DM 대화는 건드리지 않음.
--
-- 실행 방법:
--   Supabase 대시보드 → SQL Editor → 이 파일 내용 붙여넣고 "Run"
-- ============================================================

-- 1) Track derivative tables  (FK 참조하는 것부터)
truncate table public.track_comments cascade;
truncate table public.cheers          cascade;
truncate table public.play_events     cascade;

-- 2) Wall (포스트잇)
truncate table public.wall_note_comments cascade;
truncate table public.note_favorites     cascade;
truncate table public.note_views         cascade;
truncate table public.wall_notes         cascade;

-- 3) Tracks 자체
truncate table public.tracks cascade;

-- ============================================================
-- (Optional) — 사용자 즐겨찾기(별표)도 비우고 싶으면 아래 주석 해제
-- truncate table public.track_favorites cascade;
-- ============================================================
