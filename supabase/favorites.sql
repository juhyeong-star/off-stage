-- =====================================================================
-- Off-Stage — Track Favorites (곡 즐겨찾기)
-- 청취자가 좋아하는 곡을 별표로 저장. 자기 것만 read/write.
-- =====================================================================

create table if not exists public.track_favorites (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  track_id     uuid not null references public.tracks(id) on delete cascade,
  favorited_at timestamptz not null default now(),
  unique (user_id, track_id)
);

create index if not exists idx_track_favorites_user on public.track_favorites(user_id);
create index if not exists idx_track_favorites_track on public.track_favorites(track_id);

alter table public.track_favorites enable row level security;

drop policy if exists "track_favorites_select_self" on public.track_favorites;
create policy "track_favorites_select_self"
  on public.track_favorites for select
  using (auth.uid() = user_id);

drop policy if exists "track_favorites_insert_self" on public.track_favorites;
create policy "track_favorites_insert_self"
  on public.track_favorites for insert
  with check (auth.uid() = user_id);

drop policy if exists "track_favorites_delete_self" on public.track_favorites;
create policy "track_favorites_delete_self"
  on public.track_favorites for delete
  using (auth.uid() = user_id);
