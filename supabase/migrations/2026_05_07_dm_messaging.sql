-- ================================================================
-- Migration: 1:1 DM 메시지 (Phase 1 — text only, polling 기반)
-- 적용: Supabase Dashboard → SQL Editor → 붙여넣기 → Run
-- ================================================================

-- 대화방: 두 유저당 1개. (user_a_id, user_b_id) 쌍은 정렬돼서 중복 차단.
create table if not exists public.dm_conversations (
  id uuid primary key default uuid_generate_v4(),
  user_a_id uuid not null references public.profiles(id) on delete cascade,
  user_b_id uuid not null references public.profiles(id) on delete cascade,
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (user_a_id <> user_b_id)
);
create unique index if not exists dm_conv_pair_idx on public.dm_conversations (
  least(user_a_id, user_b_id),
  greatest(user_a_id, user_b_id)
);
create index if not exists dm_conv_user_a_idx on public.dm_conversations (user_a_id, last_message_at desc);
create index if not exists dm_conv_user_b_idx on public.dm_conversations (user_b_id, last_message_at desc);

-- 메시지
create table if not exists public.dm_messages (
  id uuid primary key default uuid_generate_v4(),
  conversation_id uuid not null references public.dm_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id),
  text text not null check (length(text) between 1 and 2000),
  created_at timestamptz not null default now(),
  read_at timestamptz null
);
create index if not exists dm_messages_conv_idx on public.dm_messages (conversation_id, created_at);

-- RLS: 본인이 참여한 대화만 read/write
alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;

drop policy if exists "dm_conv_read"   on public.dm_conversations;
drop policy if exists "dm_conv_create" on public.dm_conversations;
drop policy if exists "dm_conv_update" on public.dm_conversations;
drop policy if exists "dm_msg_read"    on public.dm_messages;
drop policy if exists "dm_msg_send"    on public.dm_messages;

create policy "dm_conv_read" on public.dm_conversations
  for select using (auth.uid() in (user_a_id, user_b_id));
create policy "dm_conv_create" on public.dm_conversations
  for insert with check (auth.uid() in (user_a_id, user_b_id));
create policy "dm_conv_update" on public.dm_conversations
  for update using (auth.uid() in (user_a_id, user_b_id));

create policy "dm_msg_read" on public.dm_messages
  for select using (
    exists (select 1 from public.dm_conversations c
            where c.id = conversation_id
              and auth.uid() in (c.user_a_id, c.user_b_id))
  );
create policy "dm_msg_send" on public.dm_messages
  for insert with check (
    auth.uid() = sender_id
    and exists (select 1 from public.dm_conversations c
                where c.id = conversation_id
                  and auth.uid() in (c.user_a_id, c.user_b_id))
  );
