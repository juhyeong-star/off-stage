-- =====================================================================
-- OFFLOG — 공연(무대) 신청 투표 · 팀 단위 신청 + 영상 URL
--
-- 배경: 기존 "무대" 라운드(레드포인트·공감홀)는 발매곡(WORKS) 신청뿐이라
--   팀명·참가자·연락처·음악 스타일·영상(유튜브/구글드라이브)을 받을 수 없었다.
--
--   ⚠️ 라운드 정의(이름·마감·좌석수)는 여전히 offlog.html의 ROUNDS 배열에
--      하드코딩돼 있다(관리자 화면을 만들지 않기로 한 결정). round_id는 그
--      ROUNDS[].id 문자열을 그대로 참조하는 text 컬럼이며 DB 외래키가 아니다
--      — logs.work_id(발매 작품 id 참조, 역시 text)와 동일한 컨벤션.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

-- ── 1. 공연 신청 ──────────────────────────────────────────────────────
create table if not exists public.perf_entries (
  id          uuid primary key default gen_random_uuid(),
  round_id    text not null,                  -- ROUNDS[].id 매칭 (FK 아님 — logs.work_id 컨벤션)
  author_id   uuid not null references auth.users(id) on delete cascade,
  team_name   text not null,
  members     text not null,                  -- 참가자(자유 텍스트, 쉼표 구분)
  contact     text not null,                  -- 연락처 — 투표 화면에는 절대 노출하지 않는다(운영자만 SQL로 조회)
  song_title  text not null,
  is_cover    boolean not null default false, -- false=오리지널, true=커버
  style       text not null,                  -- 음악 스타일(자유 텍스트)
  video_url   text not null check (video_url ~* '^https?://'),
  votes_count int not null default 0,
  hidden      boolean not null default false, -- 운영 킬스위치 — 삭제 대신 이 값만 true로 (관리자 화면 없이 SQL로)
  created_at  timestamptz not null default now(),
  unique (round_id, author_id)                 -- 라운드당 신청 1건(중복 방지)
);

create index if not exists idx_perf_entries_round  on public.perf_entries(round_id, hidden);
create index if not exists idx_perf_entries_author on public.perf_entries(author_id);

alter table public.perf_entries enable row level security;

drop policy if exists "perf_entries_read" on public.perf_entries;
create policy "perf_entries_read" on public.perf_entries for select
  using (hidden = false or auth.uid() = author_id);

drop policy if exists "perf_entries_insert_self" on public.perf_entries;
create policy "perf_entries_insert_self" on public.perf_entries for insert
  with check (auth.uid() = author_id);

drop policy if exists "perf_entries_delete_self" on public.perf_entries;
create policy "perf_entries_delete_self" on public.perf_entries for delete
  using (auth.uid() = author_id);


-- ── 2. 투표 (1인 1표 · track_reactions와 동일한 ledger 방식) ───────────
create table if not exists public.perf_votes (
  id         uuid primary key default gen_random_uuid(),
  entry_id   uuid not null references public.perf_entries(id) on delete cascade,
  voter_id   uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (entry_id, voter_id)
);

create index if not exists idx_perf_votes_entry on public.perf_votes(entry_id);
create index if not exists idx_perf_votes_voter on public.perf_votes(voter_id);

alter table public.perf_votes enable row level security;

drop policy if exists "perf_votes_read" on public.perf_votes;
create policy "perf_votes_read" on public.perf_votes for select using (true);

drop policy if exists "perf_votes_insert_self" on public.perf_votes;
create policy "perf_votes_insert_self" on public.perf_votes for insert
  with check (auth.uid() = voter_id);


-- ── 3. 투표 1건 = 기록 + 득표수 원자적 증가 (한 번의 함수 호출) ────────
-- 이미 투표했으면(unique 위반) 그냥 현재 득표수를 반환 — 클라이언트가 분기 안 해도 됨.
create or replace function public.cast_perf_vote(p_entry_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'auth required';
  end if;

  insert into public.perf_votes (entry_id, voter_id)
  values (p_entry_id, auth.uid())
  on conflict (entry_id, voter_id) do nothing;

  if found then
    update public.perf_entries set votes_count = votes_count + 1
    where id = p_entry_id
    returning votes_count into v_count;
  else
    select votes_count into v_count from public.perf_entries where id = p_entry_id;
  end if;

  return v_count;
end;
$$;

grant execute on function public.cast_perf_vote(uuid) to authenticated;

-- =====================================================================
-- 참고
--  · round_id에 CHECK/FK가 없는 건 의도적 — 신청 폼이 항상 ROUNDS 배열에서
--    고르게 돼 있어 UI를 통하는 한 잘못된 값이 들어올 수 없다.
--  · 레드포인트(rp)·공감홀(gh) 등 기존 라운드는 이 테이블을 쓰지 않는다.
--    새 라운드부터만 사용한다(entrySrc:'perf' 마커로 구분).
-- =====================================================================
