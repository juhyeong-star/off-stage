-- ================================================================
-- Migration: 유통사 제출용 메타 컬럼 추가
-- 적용 방법: Supabase Dashboard → SQL Editor → 이 파일 내용 붙여넣기 → Run
-- 적용 후 schema.sql도 동기화하면 좋음 (tracks 테이블 정의에 두 컬럼 추가).
-- ================================================================

alter table public.tracks
  add column if not exists dist_artist  text,
  add column if not exists release_date date;

-- 기존 행은 둘 다 NULL로 남음. 학생 업로드 폼에서 채우거나
-- 관리자가 어드민에서 ZIP 만들 때 info.txt에 빈 값으로 들어갈 뿐.
