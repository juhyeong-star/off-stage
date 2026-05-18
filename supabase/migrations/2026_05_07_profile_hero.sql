-- ================================================================
-- Migration: 아티스트 페이지 우측 hero 사진 (프로필 대표 이미지)
-- 적용: Supabase Dashboard → SQL Editor → 붙여넣기 → Run
-- ================================================================

alter table public.profiles
  add column if not exists hero_url text;

-- NULL 허용 → 미업로드 시 우측에 사진 안 뜸 (현재 모습 유지)
-- 학생들이 본인 프로필 편집에서 한 장 올리면 자동 표시됨.
