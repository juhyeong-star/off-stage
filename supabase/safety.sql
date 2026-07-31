-- ============================================================
-- safety.sql — 차단(block) · 신고(report)
--
-- 왜 필요한가: 앱스토어 Guideline 1.2 (Safety).
--   사용자가 콘텐츠를 올릴 수 있는 앱은 신고·차단 수단을 갖춰야 하고,
--   차단하면 그 사람의 콘텐츠가 피드에서 즉시 사라져야 한다.
--
-- 실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run (한 번만)
--   https://supabase.com/dashboard/project/vayzhmaggwpkbsrrsdqt/sql/new
--
-- 신고 확인(24시간 내 조치): Table Editor → reports 에서 status='open' 을 보면 된다.
--   조치한 뒤 status 를 'done' 으로 바꾼다.
-- ============================================================

-- ── 차단 ────────────────────────────────────────────────
create table if not exists public.blocks (
  blocker_id uuid        not null references auth.users(id) on delete cascade,
  blocked_id uuid        not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id)
);

alter table public.blocks enable row level security;

-- 내 차단 목록만 보고, 나만 차단하고 풀 수 있다
drop policy if exists blocks_select on public.blocks;
create policy blocks_select on public.blocks
  for select using (auth.uid() = blocker_id);

drop policy if exists blocks_insert on public.blocks;
create policy blocks_insert on public.blocks
  for insert with check (auth.uid() = blocker_id and blocker_id <> blocked_id);

drop policy if exists blocks_delete on public.blocks;
create policy blocks_delete on public.blocks
  for delete using (auth.uid() = blocker_id);

create index if not exists blocks_blocker_idx on public.blocks(blocker_id);

-- ── 신고 ────────────────────────────────────────────────
create table if not exists public.reports (
  id          uuid        primary key default gen_random_uuid(),
  reporter_id uuid        references auth.users(id) on delete set null,
  target_kind text        not null,          -- 'log' | 'track' | 'user' | 'comment'
  target_id   text,                          -- 대상 식별자(로그/곡 id 등)
  target_user uuid        references auth.users(id) on delete set null,
  reason      text        not null,          -- 사유(택1)
  detail      text,                          -- 자세한 설명(선택)
  status      text        not null default 'open',   -- open | done
  created_at  timestamptz not null default now()
);

alter table public.reports enable row level security;

-- 신고는 로그인한 본인 이름으로만 넣을 수 있고, 자기가 낸 신고만 볼 수 있다
-- (전체 목록은 대시보드에서 확인 — 신고자끼리 서로 못 보게)
drop policy if exists reports_insert on public.reports;
create policy reports_insert on public.reports
  for insert with check (auth.uid() = reporter_id);

drop policy if exists reports_select_own on public.reports;
create policy reports_select_own on public.reports
  for select using (auth.uid() = reporter_id);

create index if not exists reports_open_idx on public.reports(status, created_at desc);
create index if not exists reports_target_idx on public.reports(target_kind, target_id);

-- ── 신고가 쌓이면 자동 숨김 ─────────────────────────────
-- 서로 다른 사람 3명 이상이 신고한 콘텐츠는 모두에게서 감춘다.
-- 사람이 확인하기 전에도 즉시 차단되므로 "신속한 조치"(Guideline 1.2)를 충족한다.
--
-- 함수로 만든 이유: reports 는 RLS 로 본인 신고만 볼 수 있어서 일반 뷰로는 집계가 안 된다.
-- security definer 로 집계하되 대상 id 만 돌려주므로 누가 신고했는지는 드러나지 않는다.
--
-- 기준을 바꾸려면 아래 3 을 고치면 된다.
create or replace function public.hidden_targets()
returns table(target_kind text, target_id text)
language sql
security definer
stable
set search_path = public
as $$
  select r.target_kind, r.target_id
  from public.reports r
  where r.status = 'open' and r.target_id is not null
  group by r.target_kind, r.target_id
  having count(distinct r.reporter_id) >= 3;
$$;

revoke all on function public.hidden_targets() from public;
grant execute on function public.hidden_targets() to anon, authenticated;

-- ── 확인 ──
-- 두 줄(blocks, reports)이 나오면 정상
select table_name,
       (select count(*) from information_schema.columns c
         where c.table_schema='public' and c.table_name=t.table_name) as columns
from information_schema.tables t
where table_schema='public' and table_name in ('blocks','reports');
