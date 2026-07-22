-- =====================================================================
-- OFFLOG — 반응(도형) 저장용 테이블
--
-- 실제 DB 확인 결과 (2026-07-21):
--   ✅ profiles        : 있음 (id, name, avatar_url, role, sns_*, bio ...)
--   ✅ tracks          : 있음 (id, artist_id, title, audio_url, likes_count ...)
--   ✅ follows         : 있음 — 컬럼이 (follower_id, followed_id, created_at)
--                        ※ following_id 가 아니라 followed_id. 앱 코드를 여기에 맞춰 고쳤음.
--                        기존 팔로우 데이터 44건이 이미 들어있어 새로 만들면 안 된다.
--   ❌ track_reactions : 없음  ← 이 파일이 만드는 것
--
-- 이걸 실행해야 반응(소름/루프/울컥/최고)이 새로고침 후에도 남는다.
-- 실행 안 해도 앱은 정상 동작하고, 반응은 그 세션에서만 표시된다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

create table if not exists public.track_reactions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id)    on delete cascade,
  track_id   uuid not null references public.tracks(id) on delete cascade,
  kind       text not null check (kind in ('소름','루프','울컥','최고')),
  created_at timestamptz not null default now(),
  unique (user_id, track_id, kind)   -- 같은 곡 같은 반응은 1번(토글)
);

create index if not exists idx_track_reactions_track on public.track_reactions(track_id);
create index if not exists idx_track_reactions_user  on public.track_reactions(user_id);

alter table public.track_reactions enable row level security;

-- 카운트는 누구나 읽기(공개), 쓰기는 본인 것만
drop policy if exists "track_reactions_public_read"  on public.track_reactions;
create policy "track_reactions_public_read"  on public.track_reactions for select using (true);

drop policy if exists "track_reactions_insert_self" on public.track_reactions;
create policy "track_reactions_insert_self" on public.track_reactions for insert
  with check (auth.uid() = user_id);

drop policy if exists "track_reactions_delete_self" on public.track_reactions;
create policy "track_reactions_delete_self" on public.track_reactions for delete
  using (auth.uid() = user_id);


-- =====================================================================
-- 참고: follows 는 이미 있으므로 이 파일에서 만들지 않는다.
-- 혹시 로그인 후에도 팔로우가 저장되지 않으면, 아래로 RLS 정책만 확인/보강하면 된다.
-- (메인앱에서 이미 팔로우가 동작한다면 손댈 필요 없음)
--
--   alter table public.follows enable row level security;
--   create policy "follows_public_read" on public.follows for select using (true);
--   create policy "follows_insert_self" on public.follows for insert
--     with check (auth.uid() = follower_id);
--   create policy "follows_delete_self" on public.follows for delete
--     using (auth.uid() = follower_id);
-- =====================================================================
