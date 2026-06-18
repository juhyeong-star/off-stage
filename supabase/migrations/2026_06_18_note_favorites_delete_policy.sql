-- ============================================================
-- 2026_06_18_note_favorites_delete_policy.sql
-- 주절주절 좋아요 '취소'가 안 되던 문제 — note_favorites 에 본인 행 DELETE 를
-- 허용하는 RLS 정책이 없어서, 좋아요는 추가(INSERT)되지만 취소(DELETE)는 조용히
-- 0행 처리되고(에러 없음) 새로고침하면 다시 좋아요(빨강)로 되살아났음.
--
-- 증상: 모바일/PC 에서 하트 눌러 취소 → 흰색 됐다가 새로고침하면 빨강.
-- 원인: SELECT(공개 읽기) + INSERT(self) 정책만 있고 DELETE 정책이 없어 RLS 기본 거부.
-- 해결: 본인 행에 대한 전체 권한(insert/update/delete) self 정책으로 통일.
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run (한 번만).
--       idempotent — 여러 번 실행해도 안전.
-- ============================================================

alter table public.note_favorites enable row level security;

-- 공개 읽기(좋아요 수 카운트 + 다른 기기에서 내 좋아요 동기화) — 이미 있어도 재생성 안전.
drop policy if exists "note_favorites_public_read" on public.note_favorites;
create policy "note_favorites_public_read"
  on public.note_favorites for select
  using (true);

-- 본인 행 추가/삭제(좋아요/좋아요 취소). 예전 self 정책이 INSERT 만 있었다면 이걸로 교체돼
-- DELETE 까지 허용됨. for all = select/insert/update/delete 모두 (using=대상행 필터,
-- with check=쓰기 검증) → 본인(user_id=auth.uid()) 행만.
drop policy if exists "note_favorites_self_write" on public.note_favorites;
drop policy if exists "note_favorites_self_insert" on public.note_favorites;
create policy "note_favorites_self_write"
  on public.note_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- (선택) 확인용 — 정책 목록:
-- select policyname, cmd from pg_policies
--   where schemaname='public' and tablename='note_favorites';
