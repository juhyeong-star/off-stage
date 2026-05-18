-- ================================================================
-- Migration: DM Phase 2 — Realtime publication 추가
-- 적용: Supabase Dashboard → SQL Editor → 붙여넣기 → Run
-- (Phase 1 마이그레이션 후에 실행)
-- ================================================================

-- 클라이언트가 dm_messages / dm_conversations INSERT/UPDATE를
-- 실시간으로 구독할 수 있도록 publication에 추가.
-- RLS는 그대로 적용되므로 본인이 참여한 대화만 푸시됨.
alter publication supabase_realtime add table public.dm_messages;
alter publication supabase_realtime add table public.dm_conversations;

-- 만약 이미 publication에 들어있으면 위 명령은 에러 떨어질 수 있음.
-- 그 경우 이 SQL은 무시하고 넘어가면 됨 (Phase 1만 적용된 상태에서도 polling은 계속 동작).
