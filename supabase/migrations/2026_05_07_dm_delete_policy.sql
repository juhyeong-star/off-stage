-- ================================================================
-- Migration: DM Phase 3 — 본인 메시지 삭제 RLS 정책
-- 적용: Supabase Dashboard → SQL Editor → 붙여넣기 → Run
-- ================================================================

-- 본인이 보낸 메시지만 삭제 가능
drop policy if exists "dm_msg_delete_own" on public.dm_messages;
create policy "dm_msg_delete_own" on public.dm_messages
  for delete using (auth.uid() = sender_id);

-- (선택) Realtime DELETE 이벤트에서 row의 id 외 컬럼도 받고 싶다면 REPLICA IDENTITY FULL 설정.
-- 우리는 id만 필요하니 설정 안 해도 됨 (PK는 항상 포함됨).
