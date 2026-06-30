-- ============================================================
-- 프로듀싱 = 데모 진화 라운드 투표
--   라운드(A/B 후보 + 댓글) → 청취자 한 표(토큰: A/B/댓글) → 마감/공개 → 프로듀서
--   한 사람 한 표(votes UNIQUE(round_id,user_id)) · 댓글 좋아요 = 그 댓글에 던진 표 수
-- Supabase SQL 편집기에서 한 번 실행하세요. (auth.users 참조 · RLS 포함)
-- ============================================================

-- 1) 라운드 ----------------------------------------------------
create table if not exists public.producing_rounds (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null,                 -- 곡 단위 키 (projectId 또는 'proj_'+trackId)
  track_id    text,                          -- 라운드를 연 데모(현재 최신) track id
  artist_id   uuid references auth.users(id) on delete cascade,  -- 만든 아티스트 (auth.uid())
  artist_name text,
  question    text not null,                 -- "후렴, 어떻게 갈까?"
  candidates  jsonb not null default '[]'::jsonb,  -- [{"key":"a","name":"몽환 신스"},{"key":"b","name":"펑키 기타"}]
  status      text not null default 'open',  -- 'open' | 'closed'
  closes_at   timestamptz,
  created_at  timestamptz not null default now()
);

-- 2) 댓글(다른 의견) ------------------------------------------
create table if not exists public.producing_comments (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.producing_rounds(id) on delete cascade,
  user_id    uuid references auth.users(id) on delete set null,
  user_name  text,
  body       text not null,
  created_at timestamptz not null default now()
);

-- 3) 투표(토큰: A/B/댓글 한 곳) -------------------------------
create table if not exists public.producing_votes (
  id         uuid primary key default gen_random_uuid(),
  round_id   uuid not null references public.producing_rounds(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  user_name  text,                           -- 덴ormalize(프로듀서 표시용)
  choice     text not null,                  -- 'a' | 'b' | 'c' | <comment uuid>
  created_at timestamptz not null default now(),
  unique (round_id, user_id)                 -- 한 사람 한 표
);

create index if not exists idx_pr_rounds_project  on public.producing_rounds(project_id);
create index if not exists idx_pr_rounds_track     on public.producing_rounds(track_id);
create index if not exists idx_pr_comments_round   on public.producing_comments(round_id);
create index if not exists idx_pr_votes_round      on public.producing_votes(round_id);

-- RLS --------------------------------------------------------
alter table public.producing_rounds   enable row level security;
alter table public.producing_comments enable row level security;
alter table public.producing_votes    enable row level security;

-- 읽기: 누구나(피드/결과 공개)
create policy "pr_rounds_read"   on public.producing_rounds   for select using (true);
create policy "pr_comments_read" on public.producing_comments for select using (true);
create policy "pr_votes_read"    on public.producing_votes    for select using (true);

-- 라운드 생성/마감: 본인(아티스트)만
create policy "pr_rounds_insert" on public.producing_rounds for insert with check (auth.uid() = artist_id);
create policy "pr_rounds_update" on public.producing_rounds for update using (auth.uid() = artist_id);

-- 댓글 작성: 로그인 본인
create policy "pr_comments_insert" on public.producing_comments for insert with check (auth.uid() = user_id);
create policy "pr_comments_delete" on public.producing_comments for delete using (auth.uid() = user_id);

-- 투표: 로그인 본인 (한 표 = 옮기면 update/삭제)
create policy "pr_votes_insert" on public.producing_votes for insert with check (auth.uid() = user_id);
create policy "pr_votes_update" on public.producing_votes for update using (auth.uid() = user_id);
create policy "pr_votes_delete" on public.producing_votes for delete using (auth.uid() = user_id);
