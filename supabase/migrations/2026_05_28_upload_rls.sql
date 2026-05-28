-- ============================================================
-- 2026_05_28_upload_rls.sql
-- 일반 아티스트(로그인한 모든 유저)도 곡을 업로드할 수 있게 RLS 정책 보강.
-- 증상: admin은 업로드되는데 일반 유저는 안 됨 → INSERT/스토리지 정책이
--       관리자나 특정 role로 제한돼 있을 가능성.
--
-- 실행: Supabase 대시보드 → SQL Editor → 붙여넣고 Run (한 번만)
-- ============================================================

-- 1) tracks 테이블 — 로그인 유저는 본인(artist_id=자기 uid) 행 INSERT 가능
alter table public.tracks enable row level security;

drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own"
  on public.tracks for insert
  to authenticated
  with check (auth.uid() = artist_id);

-- 본인 트랙 UPDATE/DELETE (수정/삭제)
drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own"
  on public.tracks for update
  to authenticated
  using (auth.uid() = artist_id);

drop policy if exists "tracks_delete_own" on public.tracks;
create policy "tracks_delete_own"
  on public.tracks for delete
  to authenticated
  using (auth.uid() = artist_id);

-- 누구나 SELECT (도형/벽 등 공개 열람)
drop policy if exists "tracks_select_all" on public.tracks;
create policy "tracks_select_all"
  on public.tracks for select
  using (true);

-- 2) 스토리지 버킷 — audio / covers 에 로그인 유저가 업로드 가능
--    (정책 이름이 이미 있으면 drop 후 재생성)
drop policy if exists "audio_upload_auth"  on storage.objects;
create policy "audio_upload_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'audio');

drop policy if exists "audio_read_all" on storage.objects;
create policy "audio_read_all"
  on storage.objects for select
  using (bucket_id = 'audio');

drop policy if exists "covers_upload_auth" on storage.objects;
create policy "covers_upload_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'covers');

drop policy if exists "covers_read_all" on storage.objects;
create policy "covers_read_all"
  on storage.objects for select
  using (bucket_id = 'covers');

-- avatars 도 같이 (프로필 사진)
drop policy if exists "avatars_upload_auth" on storage.objects;
create policy "avatars_upload_auth"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars');

drop policy if exists "avatars_read_all" on storage.objects;
create policy "avatars_read_all"
  on storage.objects for select
  using (bucket_id = 'avatars');
