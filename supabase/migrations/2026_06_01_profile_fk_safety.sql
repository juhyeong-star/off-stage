-- ============================================================
-- 2026_06_01_profile_fk_safety.sql
--
-- 증상: 어떤 사람은 곡/메모 업로드가 되고 어떤 사람은 안 됨.
--       (이번엔 '이효원' 케이스 — 곡/벽 둘 다 막힘)
--
-- 진짜 원인: tracks.artist_id, wall_notes.author_id, wall_note_comments.author_id,
--           track_comments.author_id  모두  profiles(id) 를 참조하는 FK.
--           일부 사용자(특히 OAuth/매직링크로 가입한 옛 유저)에게 profiles 행이 없어서
--           INSERT 가 FK 위반으로 실패.
--
-- 이 마이그레이션은:
--  (1) handle_new_user 트리거를 더 견고하게 다시 만들고 (에러 나도 회원가입 진행)
--  (2) 프로필이 없는 기존 유저 전부에게 backfill (모든 케이스 다 잡힘)
--  (3) profiles RLS 가 자기 자신 row 를 INSERT/UPDATE 할 수 있게 보장
--      (클라이언트의 ensureProfileRow() 가 막힘 없이 행을 만들 수 있게)
--  (4) ensure_my_profile() RPC 함수 추가 — 클라가 호출하면 SECURITY DEFINER 로 안전하게 행 생성
--
-- 실행 방법: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run.
--            한 번만 실행하면 됨 (idempotent — 여러 번 실행해도 안전).
-- ============================================================

-- ── 1) 견고한 트리거 ────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger as $$
begin
  begin
    insert into public.profiles (id, name, avatar_url)
    values (
      new.id,
      coalesce(
        nullif(new.raw_user_meta_data->>'name', ''),
        nullif(new.raw_user_meta_data->>'full_name', ''),
        nullif(new.raw_user_meta_data->>'user_name', ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        '익명'
      ),
      new.raw_user_meta_data->>'avatar_url'
    )
    on conflict (id) do nothing;
  exception when others then
    -- 프로필 생성이 어떤 이유로든 실패해도 회원가입 자체는 절대 막지 않는다.
    raise warning 'handle_new_user failed for %: %', new.id, sqlerrm;
  end;
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ── 2) Backfill — 프로필이 없는 기존 유저 전부 생성 ─────────────
insert into public.profiles (id, name, avatar_url)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'user_name', ''),
    nullif(split_part(coalesce(u.email, ''), '@', 1), ''),
    '익명'
  ),
  u.raw_user_meta_data->>'avatar_url'
from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

-- ── 3) RLS — 자기 자신 row 만 INSERT/UPDATE 가능하게 보장 ────────
-- (이미 있을 수 있으니 drop + recreate 패턴)
alter table public.profiles enable row level security;

drop policy if exists "profiles_self_insert" on public.profiles;
create policy "profiles_self_insert"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update"
  on public.profiles for update
  using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "profiles_public_read" on public.profiles;
create policy "profiles_public_read"
  on public.profiles for select
  using (true);   -- 프로필은 누구나 읽기 가능 (작성자 이름/아바타 보여야 함)

-- ── 4) ensure_my_profile() RPC — 클라가 안전하게 자기 프로필 만들 수 있게 ──
-- SECURITY DEFINER 로 RLS 우회 — 자기 user.id 행만 만들기 때문에 안전.
create or replace function public.ensure_my_profile()
returns void as $$
declare
  v_user_id uuid := auth.uid();
  v_email text;
  v_meta jsonb;
  v_name text;
begin
  if v_user_id is null then
    raise exception '로그인이 필요해요';
  end if;
  select email, raw_user_meta_data into v_email, v_meta
    from auth.users where id = v_user_id;
  v_name := coalesce(
    nullif(v_meta->>'name', ''),
    nullif(v_meta->>'full_name', ''),
    nullif(v_meta->>'user_name', ''),
    nullif(split_part(coalesce(v_email, ''), '@', 1), ''),
    '익명'
  );
  insert into public.profiles (id, name)
  values (v_user_id, v_name)
  on conflict (id) do nothing;
end;
$$ language plpgsql security definer;

-- 클라이언트(인증된 유저)가 호출 가능하게 권한 부여
grant execute on function public.ensure_my_profile() to authenticated;

-- ── 5) 확인용 — 프로필 없는 유저가 0명이어야 정상 ────────────────
-- select count(*) as users_without_profile
-- from auth.users u left join public.profiles p on p.id = u.id
-- where p.id is null;
