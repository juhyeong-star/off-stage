-- =====================================================================
-- OFFLOG — 진행중인 프로젝트(캐스팅/협업 공고) 지원
--
-- 배경: "메인 디자인에 진행중인 프로젝트를 그룹 박스로 보여주고, 학생이
--   My 페이지에서 음원(오디오 파일) 또는 영상(URL)을 골라 올리면 그
--   프로젝트에 반영되게" 요청.
--
--   투표 라운드(ROUNDS/perf_entries)와는 성격이 달라 별도 테이블로 뗐다:
--   프로젝트는 공개 투표로 순위를 매기는 게 아니라, 브랜드/아티스트가
--   지원작을 검토해 직접 선정하는 캐스팅 공고다. votes_count 같은
--   투표 집계가 필요 없다.
--
--   ⚠️ 프로젝트 정의(브랜드명·설명·음원/영상 타입)는 ROUNDS와 동일한
--      컨벤션으로 offlog.html의 PROJECTS 배열에 하드코딩돼 있다.
--      project_id는 그 PROJECTS[].id를 그대로 참조하는 text 컬럼이며
--      DB 외래키가 아니다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

create table if not exists public.project_entries (
  id          uuid primary key default gen_random_uuid(),
  project_id  text not null,                  -- PROJECTS[].id 매칭 (FK 아님 — perf_entries.round_id 컨벤션)
  author_id   uuid not null references auth.users(id) on delete cascade,
  name        text not null,                  -- 지원자 이름
  contact     text not null,                  -- 연락처 — 목록엔 노출 안 함(선정 시에만 운영자가 SQL로 조회)
  note        text,                           -- 한 줄 소개(선택)
  media_kind  text not null check (media_kind in ('audio','video')),
  media_url   text not null check (media_url ~* '^https?://'),
  status      text not null default 'pending' check (status in ('pending','selected','rejected')),
  hidden      boolean not null default false, -- 운영 킬스위치 — 삭제 대신 이 값만 true로
  created_at  timestamptz not null default now(),
  unique (project_id, author_id)              -- 프로젝트당 지원 1건(중복 방지)
);

create index if not exists idx_project_entries_project on public.project_entries(project_id, hidden);
create index if not exists idx_project_entries_author  on public.project_entries(author_id);

alter table public.project_entries enable row level security;

drop policy if exists "project_entries_read" on public.project_entries;
create policy "project_entries_read" on public.project_entries for select
  using (hidden = false or auth.uid() = author_id);

drop policy if exists "project_entries_insert_self" on public.project_entries;
create policy "project_entries_insert_self" on public.project_entries for insert
  with check (auth.uid() = author_id);

drop policy if exists "project_entries_delete_self" on public.project_entries;
create policy "project_entries_delete_self" on public.project_entries for delete
  using (auth.uid() = author_id);

-- =====================================================================
-- 참고
--  · status(pending/selected/rejected)는 운영자가 SQL로 직접 바꾼다
--    (관리자 화면 없이 처리하는 기존 방침 — perf-entries.sql과 동일).
--  · 음원 지원은 Storage의 기존 'audio' 버킷을 projects/ 경로 아래
--    재사용한다(신규 버킷 불필요). 영상 지원은 URL만 저장한다.
-- =====================================================================
