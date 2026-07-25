-- =====================================================================
-- OFFLOG — 로그(사진·메모·영상·데모) 영구 저장
--
-- 문제 (2026-07-25 확인):
--   ❌ logs 테이블이 없어서 로그가 DB에 전혀 저장되지 않았다.
--      → localStorage 에만 저장 → 기기 바꾸면 사라지고, 캐시 지우면 사라지고,
--        iOS Safari 는 7일 미사용 시 자동 삭제(ITP).
--   ❌ 사진을 base64 dataURL 로 localStorage 에 넣어서 5MB 쿼터를 넘기면
--      저장이 통째로 실패했다 → "사진 올리면 저장이 안 된다"의 직접 원인.
--
-- 이 파일을 실행하면:
--   ✅ logs 테이블 생성 (로그가 계정에 영구 저장, 어느 기기에서나 보임)
--   ✅ log-media 스토리지 버킷 생성 (사진·영상 원본을 여기에, DB엔 URL만)
--   ✅ visibility(private/public) — 지시서 P0-1 대응. 기본 private.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

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
