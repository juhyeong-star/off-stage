-- =====================================================================
-- Off-Stage / OFFLOG — Social writes (팔로우 · 반응)
-- 로그인한 사용자만 자기 행위를 저장. 카운트는 공개 read.
-- Supabase 대시보드 → SQL Editor 에 붙여넣고 Run.  (plays.sql 과 동일 방식)
-- =====================================================================

-- ── 1) 팔로우: 팬(auth user)이 아티스트(profile)를 팔로우 ──
create table if not exists public.follows (
  id           uuid primary key default gen_random_uuid(),
  follower_id  uuid not null references auth.users(id)   on delete cascade,  -- 누르는 사람
  following_id uuid not null references public.profiles(id) on delete cascade, -- 팔로우 대상 아티스트
  created_at   timestamptz not null default now(),
  unique (follower_id, following_id)
);
create index if not exists idx_follows_follower  on public.follows(follower_id);
create index if not exists idx_follows_following on public.follows(following_id);

alter table public.follows enable row level security;

-- 카운트/팔로잉 여부는 누구나 읽을 수 있게(공개), 쓰기는 본인 것만
drop policy if exists "follows_public_read"  on public.follows;
create policy "follows_public_read"  on public.follows for select using (true);

drop policy if exists "follows_insert_self" on public.follows;
create policy "follows_insert_self" on public.follows for insert
  with check (auth.uid() = follower_id);

drop policy if exists "follows_delete_self" on public.follows;
create policy "follows_delete_self" on public.follows for delete
  using (auth.uid() = follower_id);


-- ── 2) 반응: 곡(track)에 남기는 도형 반응 (소름/루프/울컥/최고) ──
create table if not exists public.track_reactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id)  on delete cascade,
  track_id   uuid not null references public.tracks(id) on delete cascade,
  kind       text not null check (kind in ('소름','루프','울컥','최고')),
  created_at timestamptz not null default now(),
  unique (user_id, track_id, kind)   -- 같은 곡 같은 반응은 1번(토글)
);
create index if not exists idx_track_reactions_track on public.track_reactions(track_id);
create index if not exists idx_track_reactions_user  on public.track_reactions(user_id);

alter table public.track_reactions enable row level security;

drop policy if exists "track_reactions_public_read"  on public.track_reactions;
create policy "track_reactions_public_read"  on public.track_reactions for select using (true);

drop policy if exists "track_reactions_insert_self" on public.track_reactions;
create policy "track_reactions_insert_self" on public.track_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "track_reactions_delete_self" on public.track_reactions;
create policy "track_reactions_delete_self" on public.track_reactions for delete
  using (auth.uid() = user_id);
