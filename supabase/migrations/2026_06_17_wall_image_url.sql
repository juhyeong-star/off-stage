-- ============================================================
-- 2026_06_17_wall_image_url.sql
-- 주절주절(스레드 피드) 사진 첨부 — wall_notes 에 image_url 컬럼 추가.
--
-- 배경: 주절주절을 스레드/인스타식 피드로 바꾸면서 글에 사진을 붙일 수 있게 함.
--       사진 파일은 Supabase Storage 의 'covers' 버킷(이미 존재 + RLS 설정됨)에
--       업로드하고, 그 public URL 을 이 컬럼에 저장한다.
--       (별도 버킷/정책 추가 불필요 — covers_upload_auth / covers_read_all 재사용.)
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run (한 번만).
--       idempotent — 여러 번 실행해도 안전.
-- ============================================================

alter table public.wall_notes
  add column if not exists image_url text;

-- (선택) 확인용:
-- select column_name from information_schema.columns
--   where table_schema='public' and table_name='wall_notes' and column_name='image_url';
