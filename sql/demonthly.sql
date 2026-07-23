-- ============================================================
-- demon'thly = 이달의 데모 (Demo + monthly, n 묵음)
--   관리자가 '이벤트'(이달의 투표)를 생성 → 업로드 시 데모가 이벤트에 '참여'(entry)
--   → 청취자가 한 표(votes UNIQUE(event_id, voter_id)) → 득표순 순위.
-- Supabase SQL 편집기에서 한 번 실행하세요. (auth.users 참조 · RLS 포함 · 멱등)
-- ============================================================

-- 1) 이벤트(이달의 투표) --------------------------------------
create table if not exists public.demonthly_events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,                        -- "2026년 6월 이달의 데모"
  month       text,                                 -- 'YYYY-MM' (선택)
  status      text not null default 'active',       -- 'active' | 'closed'
  starts_at   timestamptz not null default now(),
  ends_at     timestamptz,                          -- 마감(D-day 계산용, 선택)
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);

-- 2) 참여(데모가 이벤트에 등록) -------------------------------
create table if not exists public.demonthly_entries (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.demonthly_events(id) on delete cascade,
  track_id    text not null,                        -- 데모 track id
  track_title text,                                 -- 표시용(비정규화)
  artist_name text,
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  unique (event_id, track_id)                       -- 한 이벤트에 같은 곡 한 번
);

-- 3) 투표(한 사람 이벤트당 한 표) -----------------------------
create table if not exists public.demonthly_votes (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references public.demonthly_events(id) on delete cascade,
  track_id    text not null,                        -- 어느 데모에 투표했나
  voter_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (event_id, voter_id)                       -- 이벤트당 한 표(옮기면 update)
);

create index if not exists idx_dm_events_status  on public.demonthly_events(status);
create index if not exists idx_dm_entries_event  on public.demonthly_entries(event_id);
create index if not exists idx_dm_votes_event    on public.demonthly_votes(event_id);
create index if not exists idx_dm_votes_track    on public.demonthly_votes(event_id, track_id);

-- RLS --------------------------------------------------------
alter table public.demonthly_events  enable row level security;
alter table public.demonthly_entries enable row level security;
alter table public.demonthly_votes   enable row level security;

-- 읽기: 누구나(투표 화면 공개)
drop policy if exists "dm_events_read"  on public.demonthly_events;
create policy "dm_events_read"  on public.demonthly_events  for select using (true);
drop policy if exists "dm_entries_read" on public.demonthly_entries;
create policy "dm_entries_read" on public.demonthly_entries for select using (true);
drop policy if exists "dm_votes_read"   on public.demonthly_votes;
create policy "dm_votes_read"   on public.demonthly_votes   for select using (true);

-- 이벤트 생성/수정/삭제: 로그인 사용자(생성자). ⚠️관리자 전용은 UI 로 게이트(role='admin').
--   더 엄격히 하려면 profiles.role 확인 정책으로 교체 가능.
drop policy if exists "dm_events_insert" on public.demonthly_events;
create policy "dm_events_insert" on public.demonthly_events for insert with check (auth.uid() = created_by);
drop policy if exists "dm_events_update" on public.demonthly_events;
create policy "dm_events_update" on public.demonthly_events for update using (auth.uid() = created_by);
drop policy if exists "dm_events_delete" on public.demonthly_events;
create policy "dm_events_delete" on public.demonthly_events for delete using (auth.uid() = created_by);

-- 참여 등록: 로그인 본인(업로더)
drop policy if exists "dm_entries_insert" on public.demonthly_entries;
create policy "dm_entries_insert" on public.demonthly_entries for insert with check (auth.uid() = created_by);
drop policy if exists "dm_entries_delete" on public.demonthly_entries;
create policy "dm_entries_delete" on public.demonthly_entries for delete using (auth.uid() = created_by);

-- 투표: 로그인 본인(한 표 = 옮기면 update/삭제)
drop policy if exists "dm_votes_insert" on public.demonthly_votes;
create policy "dm_votes_insert" on public.demonthly_votes for insert with check (auth.uid() = voter_id);
drop policy if exists "dm_votes_update" on public.demonthly_votes;
create policy "dm_votes_update" on public.demonthly_votes for update using (auth.uid() = voter_id);
drop policy if exists "dm_votes_delete" on public.demonthly_votes;
create policy "dm_votes_delete" on public.demonthly_votes for delete using (auth.uid() = voter_id);

-- 끝. 실행 후 window.Demonthly (supabase.js) 가 활성화됩니다.
