-- ================================================================
-- Track Backers (함께하기) — Phase 1: 정서적 후원
-- 데모 1개당 1유저가 1번만 함께함. 추후 후원금 컬럼 추가 가능.
-- ================================================================

create table if not exists public.track_backers (
  id uuid primary key default uuid_generate_v4(),
  track_id uuid not null references public.tracks(id) on delete cascade,
  backer_id uuid not null references public.profiles(id) on delete cascade,
  message text default '',
  -- Phase 2 reserved fields
  amount_krw integer default 0,        -- 후원 금액 (원). 0이면 정서적 후원
  payment_status text default 'free',  -- 'free','pending','paid','refunded'
  backed_at timestamptz not null default now(),
  unique (track_id, backer_id)
);

create index if not exists track_backers_track_idx on public.track_backers(track_id);
create index if not exists track_backers_user_idx on public.track_backers(backer_id);

alter table public.track_backers enable row level security;

-- 누구나 후원자 목록 볼 수 있음
create policy "track_backers_public_read"
  on public.track_backers for select using (true);

-- 로그인한 유저만 본인으로 함께하기 가능
create policy "track_backers_insert_self"
  on public.track_backers for insert
  with check (auth.uid() = backer_id);

-- 본인이 한 함께하기만 취소 가능
create policy "track_backers_delete_own"
  on public.track_backers for delete
  using (auth.uid() = backer_id);
