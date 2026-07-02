-- ============================================================
-- verify_all_access.sql   (2026-07-02)
--
-- 목적: "나는 되는데 남은 안 됨"을 없앤다.
--   모든 로그인 사용자가 음원 업로드 · 프로듀싱 투표 · 좋아요 · 담기(즐겨찾기)를
--   오류 없이 할 수 있도록, 필요한 테이블 / 스토리지 버킷 / RLS 정책을 한 번에 보장.
--
-- 사용법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run.
--   ✅ 멱등(idempotent) — 여러 번 실행해도 안전 (drop policy if exists + create).
--   ✅ 이미 있는 것은 건너뛰고, 빠진 것만 채운다.
--   맨 아래 확인 쿼리 결과로 상태를 점검할 수 있음.
-- ============================================================

-- ── 0) 스토리지 버킷: audio / covers / avatars (없으면 생성, public 보장) ──
insert into storage.buckets (id, name, public)
values ('audio','audio',true), ('covers','covers',true), ('avatars','avatars',true)
on conflict (id) do update set public = true;

-- storage.objects 정책: 업로드=로그인 유저, 읽기=공개
drop policy if exists "audio_upload_auth"   on storage.objects;
create policy "audio_upload_auth"   on storage.objects for insert to authenticated with check (bucket_id = 'audio');
drop policy if exists "audio_read_all"      on storage.objects;
create policy "audio_read_all"      on storage.objects for select using (bucket_id = 'audio');
drop policy if exists "covers_upload_auth"  on storage.objects;
create policy "covers_upload_auth"  on storage.objects for insert to authenticated with check (bucket_id = 'covers');
drop policy if exists "covers_read_all"     on storage.objects;
create policy "covers_read_all"     on storage.objects for select using (bucket_id = 'covers');
drop policy if exists "avatars_upload_auth" on storage.objects;
create policy "avatars_upload_auth" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
drop policy if exists "avatars_read_all"    on storage.objects;
create policy "avatars_read_all"    on storage.objects for select using (bucket_id = 'avatars');

-- ── 1) tracks: 업로드=본인(artist_id), 읽기=공개 ──
alter table public.tracks enable row level security;
drop policy if exists "tracks_insert_own" on public.tracks;
create policy "tracks_insert_own" on public.tracks for insert to authenticated with check (auth.uid() = artist_id);
drop policy if exists "tracks_update_own" on public.tracks;
create policy "tracks_update_own" on public.tracks for update to authenticated using (auth.uid() = artist_id);
drop policy if exists "tracks_delete_own" on public.tracks;
create policy "tracks_delete_own" on public.tracks for delete to authenticated using (auth.uid() = artist_id);
drop policy if exists "tracks_select_all" on public.tracks;
create policy "tracks_select_all" on public.tracks for select using (true);

-- ── 2) profiles: backfill(프로필 없는 유저 채움) + RLS + ensure_my_profile() ──
--    (업로드 FK 위반 방지 — OAuth/매직링크 가입자 profiles 행 없을 때 업로드 막힘)
insert into public.profiles (id, name, avatar_url)
select u.id,
       coalesce(nullif(u.raw_user_meta_data->>'name',''),
                nullif(u.raw_user_meta_data->>'full_name',''),
                nullif(split_part(coalesce(u.email,''),'@',1),''),
                '익명'),
       u.raw_user_meta_data->>'avatar_url'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

alter table public.profiles enable row level security;
drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert" on public.profiles for insert with check (auth.uid() = id);
drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);
drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read" on public.profiles for select using (true);

create or replace function public.ensure_my_profile()
returns void as $$
declare
  v_user_id uuid := auth.uid();
  v_email text; v_meta jsonb; v_name text;
begin
  if v_user_id is null then raise exception '로그인이 필요해요'; end if;
  select email, raw_user_meta_data into v_email, v_meta from auth.users where id = v_user_id;
  v_name := coalesce(nullif(v_meta->>'name',''),
                     nullif(v_meta->>'full_name',''),
                     nullif(split_part(coalesce(v_email,''),'@',1),''),
                     '익명');
  insert into public.profiles (id, name) values (v_user_id, v_name) on conflict (id) do nothing;
end;
$$ language plpgsql security definer;
grant execute on function public.ensure_my_profile() to authenticated;

-- ── 3) 프로듀싱 투표: 테이블 + 정책(읽기=공개, 쓰기=본인) ──
create table if not exists public.producing_rounds (
  id uuid primary key default gen_random_uuid(),
  project_id text not null, track_id text,
  artist_id uuid references auth.users(id) on delete cascade, artist_name text,
  question text not null, candidates jsonb not null default '[]'::jsonb,
  status text not null default 'open', closes_at timestamptz,
  created_at timestamptz not null default now()
);
create table if not exists public.producing_comments (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.producing_rounds(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null, user_name text,
  body text not null, created_at timestamptz not null default now()
);
create table if not exists public.producing_votes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.producing_rounds(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade, user_name text,
  choice text not null, created_at timestamptz not null default now(),
  unique (round_id, user_id)
);
create index if not exists idx_pr_rounds_project on public.producing_rounds(project_id);
create index if not exists idx_pr_votes_round     on public.producing_votes(round_id);
create index if not exists idx_pr_comments_round  on public.producing_comments(round_id);

alter table public.producing_rounds   enable row level security;
alter table public.producing_comments enable row level security;
alter table public.producing_votes    enable row level security;

drop policy if exists "pr_rounds_read" on public.producing_rounds;
create policy "pr_rounds_read"   on public.producing_rounds   for select using (true);
drop policy if exists "pr_comments_read" on public.producing_comments;
create policy "pr_comments_read" on public.producing_comments for select using (true);
drop policy if exists "pr_votes_read" on public.producing_votes;
create policy "pr_votes_read"    on public.producing_votes    for select using (true);

drop policy if exists "pr_rounds_insert" on public.producing_rounds;
create policy "pr_rounds_insert" on public.producing_rounds for insert with check (auth.uid() = artist_id);
drop policy if exists "pr_rounds_update" on public.producing_rounds;
create policy "pr_rounds_update" on public.producing_rounds for update using (auth.uid() = artist_id);
drop policy if exists "pr_rounds_delete" on public.producing_rounds;
create policy "pr_rounds_delete" on public.producing_rounds for delete using (auth.uid() = artist_id);

drop policy if exists "pr_comments_insert" on public.producing_comments;
create policy "pr_comments_insert" on public.producing_comments for insert with check (auth.uid() = user_id);
drop policy if exists "pr_comments_delete" on public.producing_comments;
create policy "pr_comments_delete" on public.producing_comments for delete using (auth.uid() = user_id);

drop policy if exists "pr_votes_insert" on public.producing_votes;
create policy "pr_votes_insert" on public.producing_votes for insert with check (auth.uid() = user_id);
drop policy if exists "pr_votes_update" on public.producing_votes;
create policy "pr_votes_update" on public.producing_votes for update using (auth.uid() = user_id);
drop policy if exists "pr_votes_delete" on public.producing_votes;
create policy "pr_votes_delete" on public.producing_votes for delete using (auth.uid() = user_id);

-- ── 4) 곡 좋아요(track_favorites) + 포스트잇 담기(note_bookmarks) ──
create table if not exists public.track_favorites (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  favorited_at timestamptz not null default now(),
  unique (user_id, track_id)
);
alter table public.track_favorites enable row level security;
drop policy if exists "track_favorites_self_select" on public.track_favorites;
create policy "track_favorites_self_select" on public.track_favorites for select using (auth.uid() = user_id);
drop policy if exists "track_favorites_self_write" on public.track_favorites;
create policy "track_favorites_self_write" on public.track_favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.note_bookmarks (
  user_id uuid not null references public.profiles(id) on delete cascade,
  note_id uuid not null references public.wall_notes(id) on delete cascade,
  bookmarked_at timestamptz not null default now(),
  primary key (user_id, note_id)
);
alter table public.note_bookmarks enable row level security;
drop policy if exists "note_bookmarks_self_select" on public.note_bookmarks;
create policy "note_bookmarks_self_select" on public.note_bookmarks for select using (auth.uid() = user_id);
drop policy if exists "note_bookmarks_self_write" on public.note_bookmarks;
create policy "note_bookmarks_self_write" on public.note_bookmarks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ── 5) 포스트잇 좋아요(note_favorites) — 테이블이 있으면 정책 보장, 없으면 건너뜀 ──
do $$
begin
  if to_regclass('public.note_favorites') is not null then
    execute 'alter table public.note_favorites enable row level security';
    execute 'drop policy if exists "note_favorites_public_read" on public.note_favorites';
    execute 'create policy "note_favorites_public_read" on public.note_favorites for select using (true)';
    execute 'drop policy if exists "note_favorites_self_write" on public.note_favorites';
    execute 'drop policy if exists "note_favorites_self_insert" on public.note_favorites';
    execute 'create policy "note_favorites_self_write" on public.note_favorites for all using (auth.uid() = user_id) with check (auth.uid() = user_id)';
  end if;
end $$;

-- ============================================================
-- 확인 쿼리 — 실행 후 이 결과들을 눈으로 점검
-- ============================================================
-- (1) 프로필 없는 유저 = 0 이어야 정상 (업로드 FK 안전)
select 'users_without_profile' as check_name, count(*)::text as value
  from auth.users u left join public.profiles p on p.id = u.id where p.id is null;

-- (2) 버킷 3개(audio,covers,avatars) 다 있고 public 이어야 정상
select 'bucket: '||id as check_name, (case when public then 'public ✅' else 'PRIVATE ⚠️' end) as value
  from storage.buckets where id in ('audio','covers','avatars') order by id;

-- (3) 핵심 테이블별 정책 개수 (0 이면 그 기능이 모두에게 막혀 있다는 뜻)
select 'policies: '||tablename as check_name, count(*)::text as value
  from pg_policies
  where schemaname='public'
    and tablename in ('tracks','producing_rounds','producing_votes','producing_comments',
                      'track_favorites','note_bookmarks','profiles')
  group by tablename order by tablename;
