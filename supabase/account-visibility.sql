-- =====================================================================
-- OFFLOG — P0-1 개정판: 계정 단위 공개/비공개 (인스타그램 모델)
--
-- 실제 DB 확인 결과 (2026-07-25):
--   profiles 컬럼 : id, name, avatar_url, role, sns_*, created_at, hero_url, bio
--                   → account_visibility 없음, 학교/반 소속 필드도 없음
--   follows  컬럼 : follower_id, followed_id, created_at
--                   → status 없음
--   계정 57개 / 팔로우 45건 (전부 보존)
--
-- 이 파일이 하는 일:
--   ✅ profiles.account_visibility 추가 (기본 public)
--   ✅ follows.status 추가 (기존 관계는 전부 accepted 로 마이그레이션)
--   ✅ 비공개 계정 보호 RLS (승인된 팔로워만 로그/곡 열람)
--
-- ⚠️ 변경 4(같은 반 자동 팔로우)는 이 파일에 없다.
--    계정에 학교·반 소속 정보 자체가 없어서 선행 작업이 필요하다.
--    소속 단위(반/학교)를 확정한 뒤 별도 파일로 진행한다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

-- ── 1. 계정 공개 범위 ────────────────────────────────────────────────
alter table public.profiles
  add column if not exists account_visibility text not null default 'public';

do $$ begin
  alter table public.profiles
    add constraint profiles_account_visibility_chk
    check (account_visibility in ('public','private'));
exception when duplicate_object then null; end $$;

-- 기존 계정 전체 → public (지시서 마이그레이션 항목)
update public.profiles set account_visibility='public' where account_visibility is null;


-- ── 2. 팔로우 요청/승인 상태 ─────────────────────────────────────────
alter table public.follows
  add column if not exists status text not null default 'accepted';

do $$ begin
  alter table public.follows
    add constraint follows_status_chk check (status in ('pending','accepted'));
exception when duplicate_object then null; end $$;

-- 기존 팔로우 관계 45건 → 전부 accepted (끊기지 않게)
update public.follows set status='accepted' where status is null or status not in ('pending','accepted');

create index if not exists idx_follows_followed_status on public.follows(followed_id, status);


-- ── 3. 비공개 계정 보호 (RLS) ────────────────────────────────────────
-- "이 사람의 콘텐츠를 내가 볼 수 있는가" 판정 함수
create or replace function public.can_view_account(target uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    target = auth.uid()                                        -- 내 것
    or coalesce((select p.account_visibility from public.profiles p where p.id = target), 'public') = 'public'
    or exists (                                                -- 승인된 팔로워
      select 1 from public.follows f
      where f.followed_id = target and f.follower_id = auth.uid() and f.status = 'accepted'
    );
$$;

-- 로그: 비공개 계정이면 승인된 팔로워만. (logs.sql 실행 후에만 적용됨)
do $$ begin
  if exists (select 1 from information_schema.tables where table_schema='public' and table_name='logs') then
    drop policy if exists "logs_read" on public.logs;
    create policy "logs_read" on public.logs for select
      using (auth.uid() = author_id or public.can_view_account(author_id));
  end if;
end $$;

-- 팔로우 요청은 본인이 만들고, 승인은 받는 사람이 한다
drop policy if exists "follows_update_target" on public.follows;
create policy "follows_update_target" on public.follows for update
  using (auth.uid() = followed_id) with check (auth.uid() = followed_id);


-- =====================================================================
-- 참고 — 이 파일에 넣지 않은 것과 이유
--  · 곡(tracks) RLS 는 건드리지 않았다. 이벤트 신청곡·발매곡은 계정 설정과
--    무관하게 항상 공개여야 하는데(지시서 변경 3), tracks 에 그 구분 필드가
--    아직 없다. 필드 확정 후 별도 적용.
--  · 게시물 단위 visibility 는 만들지 않는다(개정판에서 폐기).
--    단, logs.sql 이 이미 만든 logs.visibility 컬럼은 삭제하지 않고 방치한다
--    (롤백 대비 · 기본값 private 이라 위 정책이 우선한다).
-- =====================================================================
