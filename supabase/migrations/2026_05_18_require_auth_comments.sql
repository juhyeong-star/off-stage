-- Require login for comments
-- Previously track_comments / wall_note_comments accepted anonymous inserts (author_id=null).
-- Tighten both to require an authenticated session and that author_id matches the session user.

-- ── track_comments ─────────────────────────────────────────
drop policy if exists "track_comments_insert_any"  on public.track_comments;
drop policy if exists "track_comments_insert_auth" on public.track_comments;
create policy "track_comments_insert_auth" on public.track_comments
  for insert with check (auth.uid() is not null and author_id = auth.uid());

-- ── wall_note_comments ─────────────────────────────────────
drop policy if exists "wnc_insert_any"  on public.wall_note_comments;
drop policy if exists "wnc_insert_auth" on public.wall_note_comments;
create policy "wnc_insert_auth" on public.wall_note_comments
  for insert with check (auth.uid() is not null and author_id = auth.uid());
