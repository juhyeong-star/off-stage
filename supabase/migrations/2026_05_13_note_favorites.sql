-- ================================================================
-- Note Favorites (포스트잇 공개 좋아요 / 모음)
-- 누구나 포스트잇을 "좋아요" 할 수 있고, 좋아한 글은 그 사람의
-- 아티스트 페이지의 "내가 모은 글" 탭에 공개됨.
-- (참고: note_bookmarks 는 비공개 저장이라 별개로 유지)
-- ================================================================

create table if not exists public.note_favorites (
  user_id uuid not null references public.profiles(id) on delete cascade,
  note_id uuid not null references public.wall_notes(id) on delete cascade,
  favorited_at timestamptz not null default now(),
  primary key (user_id, note_id)
);

create index if not exists note_favorites_user_idx on public.note_favorites(user_id);
create index if not exists note_favorites_note_idx on public.note_favorites(note_id);

alter table public.note_favorites enable row level security;

-- 공개 좋아요 — 누구나 누가 무엇을 좋아했는지 볼 수 있음
create policy "note_favorites_public_read"
  on public.note_favorites for select using (true);

-- 본인 자격으로만 좋아요/취소 가능
create policy "note_favorites_self_write"
  on public.note_favorites for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
