-- ============================================================
-- 2026_05_27_dm_helpers.sql
-- Convenience RPCs for the 1:1 DM system. Builds on the
-- dm_conversations + dm_messages tables defined in
-- 2026_05_07_dm_messaging.sql (apply that one first if you
-- haven't yet).
-- ============================================================

-- List the current user's conversations with last-message preview and
-- unread count. Joined with profiles for the other user's name + avatar.
create or replace function public.my_dm_conversations()
returns table (
  conversation_id uuid,
  other_id        uuid,
  other_name      text,
  other_avatar    text,
  last_text       text,
  last_sender_id  uuid,
  last_at         timestamptz,
  unread_count    int
) language sql security definer set search_path = public as $$
  with my_convs as (
    select
      c.id,
      c.last_message_at,
      case when c.user_a_id = auth.uid() then c.user_b_id else c.user_a_id end as other_id
    from public.dm_conversations c
    where auth.uid() in (c.user_a_id, c.user_b_id)
  ),
  last_msg as (
    select distinct on (m.conversation_id)
      m.conversation_id, m.text, m.sender_id, m.created_at
    from public.dm_messages m
    join my_convs c on c.id = m.conversation_id
    order by m.conversation_id, m.created_at desc
  ),
  unread as (
    select m.conversation_id, count(*)::int as cnt
    from public.dm_messages m
    join my_convs c on c.id = m.conversation_id
    where m.sender_id <> auth.uid() and m.read_at is null
    group by m.conversation_id
  )
  select
    mc.id as conversation_id,
    mc.other_id,
    p.name as other_name,
    p.avatar_url as other_avatar,
    lm.text as last_text,
    lm.sender_id as last_sender_id,
    coalesce(lm.created_at, mc.last_message_at) as last_at,
    coalesce(u.cnt, 0) as unread_count
  from my_convs mc
  left join public.profiles p on p.id = mc.other_id
  left join last_msg lm on lm.conversation_id = mc.id
  left join unread u on u.conversation_id = mc.id
  order by coalesce(lm.created_at, mc.last_message_at) desc;
$$;
grant execute on function public.my_dm_conversations() to authenticated;

-- Find an existing conversation between me and the other user, or create
-- one. Returns the conversation id. Insert is keyed by least/greatest
-- so the unique-pair index never fires.
create or replace function public.dm_get_or_create_conv(p_other_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  conv_id uuid;
  me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if me = p_other_id then raise exception 'cannot dm yourself'; end if;
  -- Find existing
  select id into conv_id
  from public.dm_conversations
  where (user_a_id = me and user_b_id = p_other_id)
     or (user_b_id = me and user_a_id = p_other_id)
  limit 1;
  if conv_id is not null then return conv_id; end if;
  -- Create new with deterministic ordering
  insert into public.dm_conversations (user_a_id, user_b_id)
  values (least(me, p_other_id), greatest(me, p_other_id))
  returning id into conv_id;
  return conv_id;
end $$;
grant execute on function public.dm_get_or_create_conv(uuid) to authenticated;

-- Mark all incoming messages in this conversation as read.
create or replace function public.dm_mark_read(p_conversation_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
begin
  if me is null then return; end if;
  -- Verify I'm a participant
  if not exists (
    select 1 from public.dm_conversations
    where id = p_conversation_id and me in (user_a_id, user_b_id)
  ) then return; end if;
  update public.dm_messages
  set read_at = now()
  where conversation_id = p_conversation_id
    and sender_id <> me
    and read_at is null;
end $$;
grant execute on function public.dm_mark_read(uuid) to authenticated;
