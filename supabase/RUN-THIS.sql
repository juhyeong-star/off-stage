-- ============================================================
-- OFFLOG — 한 번에 실행 (로그 저장 + 계정 공개범위)
-- Supabase 대시보드 → SQL Editor 에 통째로 붙여넣고 Run
-- 기존 데이터(계정 57 · 팔로우 45 · 곡 52)는 그대로 보존됩니다
-- ============================================================


-- ── 1. 로그 테이블 ───────────────────────────────────────────────────
create table if not exists public.logs (
  id          uuid primary key default gen_random_uuid(),
  author_id   uuid not null references auth.users(id) on delete cascade,
  kind        text not null check (kind in ('note','ph','vid','snd')),
  text        text,                    -- 메모 본문
  caption     text,                    -- 사진·영상 설명 / 데모 제목
  media_url   text,                    -- 사진·영상·오디오 공개 URL (Storage)
  duration    text,                    -- 데모 길이 표시용 (예 '0:31')
  tone        text,                    -- 포스트잇 색 y|b|p
  visibility  text not null default 'private' check (visibility in ('private','public')),
  work_id     text,                    -- 발매(작품)에 담긴 로그면 그 id
  created_at  timestamptz not null default now()
);

create index if not exists idx_logs_author  on public.logs(author_id, created_at desc);
create index if not exists idx_logs_public   on public.logs(visibility, created_at desc);

alter table public.logs enable row level security;

-- 내 로그는 내가 전부 / 남의 로그는 public 만 읽기
drop policy if exists "logs_read" on public.logs;
create policy "logs_read" on public.logs for select
  using (visibility = 'public' or auth.uid() = author_id);

drop policy if exists "logs_insert_self" on public.logs;
create policy "logs_insert_self" on public.logs for insert
  with check (auth.uid() = author_id);

drop policy if exists "logs_update_self" on public.logs;
create policy "logs_update_self" on public.logs for update
  using (auth.uid() = author_id) with check (auth.uid() = author_id);

drop policy if exists "logs_delete_self" on public.logs;
create policy "logs_delete_self" on public.logs for delete
  using (auth.uid() = author_id);


-- ── 2. 사진·영상 저장용 스토리지 버킷 ────────────────────────────────
-- 공개 버킷(읽기 자유) — 업로드는 로그인 유저가 자기 폴더에만
insert into storage.buckets (id, name, public)
values ('log-media', 'log-media', true)
on conflict (id) do nothing;

drop policy if exists "log_media_read" on storage.objects;
create policy "log_media_read" on storage.objects for select
  using (bucket_id = 'log-media');

drop policy if exists "log_media_insert_self" on storage.objects;
create policy "log_media_insert_self" on storage.objects for insert
  with check (
    bucket_id = 'log-media'
    and auth.uid() is not null
    and (storage.foldername(name))[1] = auth.uid()::text   -- 내 폴더에만 업로드
  );

drop policy if exists "log_media_delete_self" on storage.objects;
create policy "log_media_delete_self" on storage.objects for delete
  using (
    bucket_id = 'log-media'
    and auth.uid()::text = (storage.foldername(name))[1]
  );


-- =====================================================================
-- 참고
--  · 실행 전에 올린 로그는 이 기기의 localStorage 에만 있다. 앱이 다음 실행 때
--    그것들을 자동으로 서버에 한 번 올려준다(마이그레이션). 그 전에 브라우저
--    데이터를 지우면 복구할 수 없다.
--  · 기존 곡(tracks)은 이미 서버에 저장되고 있어 영향 없다.
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
