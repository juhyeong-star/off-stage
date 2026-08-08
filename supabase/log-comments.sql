-- =====================================================================
-- OFFLOG — LOG 댓글 (협업용)
--
-- 배경: "애매한 세미 동그라미 등의 좋아요 표시 대신 댓글을 달 수 있는
--   구조 — 서로간에 협업을 할 수 있도록" 요청.
--   기존 반응(track_reactions: 소름/루프/울컥/최고 도형)은 곡(tracks)에만
--   달렸고, 감정 표시뿐이라 대화가 안 됐다. 로그에 직접 댓글을 단다.
--
--   log_id 는 public.logs(id) 를 참조하는 진짜 FK — 로그가 지워지면
--   댓글도 함께 사라진다(cascade).
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

create table if not exists public.log_comments (
  id          uuid primary key default gen_random_uuid(),
  log_id      uuid not null references public.logs(id) on delete cascade,
  author_id   uuid not null references auth.users(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index if not exists idx_log_comments_log on public.log_comments(log_id, created_at);
create index if not exists idx_log_comments_author on public.log_comments(author_id);

alter table public.log_comments enable row level security;

-- 읽기: 그 로그를 볼 수 있는 사람이면 댓글도 볼 수 있다.
-- logs 의 RLS(공개 로그 or 내 로그)를 그대로 따르게 exists 로 위임한다.
drop policy if exists "log_comments_read" on public.log_comments;
create policy "log_comments_read" on public.log_comments for select
  using (exists (select 1 from public.logs l where l.id = log_id));

-- 쓰기: 로그인한 본인 이름으로만
drop policy if exists "log_comments_insert_self" on public.log_comments;
create policy "log_comments_insert_self" on public.log_comments for insert
  with check (auth.uid() = author_id);

-- 삭제: 댓글 작성자 본인, 또는 그 로그의 주인(내 로그에 달린 댓글 정리)
drop policy if exists "log_comments_delete_self" on public.log_comments;
create policy "log_comments_delete_self" on public.log_comments for delete
  using (
    auth.uid() = author_id
    or exists (select 1 from public.logs l where l.id = log_id and l.author_id = auth.uid())
  );

-- =====================================================================
-- 참고
--  · 수정(update) 정책은 일부러 안 만들었다 — 댓글은 짧고, 틀리면 지우고
--    다시 다는 게 단순하다. 필요해지면 author_id 기준 update 정책 추가.
--  · 답글(대댓글)·멘션은 아직 없다. 협업 대화가 실제로 쌓이는 걸 보고
--    필요하면 parent_id 를 추가한다(YAGNI).
-- =====================================================================
