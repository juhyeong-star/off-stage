-- ================================================================
-- Note Bookmarks (포스트잇 수집)
-- 청취자가 마음에 드는 포스트잇을 저장 — 본인만 볼 수 있음
-- ================================================================

create table if not exists public.note_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  note_id uuid not null references public.wall_notes(id) on delete cascade,
  bookmarked_at timestamptz not null default now(),
  primary key (user_id, note_id)
);

create index if not exists note_bookmarks_user_idx on public.note_bookmarks(user_id);
create index if not exists note_bookmarks_note_idx on public.note_bookmarks(note_id);

alter table public.note_bookmarks enable row level security;

-- 본인이 수집한 것만 조회
create policy "note_bookmarks_self_read"
  on public.note_bookmarks for select using (auth.uid() = user_id);

-- 본인 자격으로만 수집/취소
create policy "note_bookmarks_self_write"
  on public.note_bookmarks for all using (auth.uid() = user_id);
