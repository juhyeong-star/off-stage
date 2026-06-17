-- ============================================================
-- 2026_06_17_tracks_lyrics.sql
-- 업로드 시 적는 '가사'를 곡(앨범) 페이지에 연결 — tracks 에 lyrics 컬럼 추가.
--
-- 배경: 예전엔 업로드 가사를 '우리들의 벽'에 자동 게시만 하고 트랙엔 저장하지 않았음.
--       이제 가사를 트랙에 저장해서 앨범 페이지의 '가사' 섹션에 표시하고,
--       주절주절(벽) 자동 게시는 끔(사용자 요청).
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run (한 번만).
--       idempotent — 여러 번 실행해도 안전. 컬럼이 없으면 클라이언트가 가사만 빼고
--       업로드하므로, 이 SQL 실행 전에도 업로드 자체는 막히지 않음(가사만 저장 안 됨).
-- ============================================================

alter table public.tracks
  add column if not exists lyrics text;

-- (선택) 확인용:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='tracks' and column_name='lyrics';
