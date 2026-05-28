-- ============================================================
-- 2026_05_28_fix_profile_trigger.sql
--
-- 증상 1) 어떤 사람은 곡 업로드가 되고 어떤 사람은 안 됨
--        → tracks.artist_id 는 profiles(id) 를 참조하는 FK.
--          프로필 행이 없는 유저는 업로드가 FK 위반으로 실패함.
-- 증상 2) 가입 단계에서 검은 화면에서 안 넘어감
--        → handle_new_user 트리거가 실패하면(예: name 이 NULL) 회원가입
--          트랜잭션 자체가 깨져서 "Database error saving new user" 로 멈춤.
--
-- 이 마이그레이션은:
--  (1) handle_new_user 를 절대 회원가입을 막지 않도록 견고하게 다시 만들고
--  (2) name 이 비어도 '익명' 으로 채우며
--  (3) 이미 가입했지만 프로필이 없던 유저 전부에게 프로필을 만들어준다(backfill).
--
-- 실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run (한 번만)
-- ============================================================

-- 1) 트리거 함수 — 예외가 나도 회원가입은 계속되게(exception 무시) + name 항상 채움
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

-- 2) Backfill — 프로필이 없는 기존 유저(=업로드 안 되던 유저) 전부 생성
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

-- 3) 확인용 — 프로필 없는 유저가 0명이어야 정상
-- select count(*) as users_without_profile
-- from auth.users u left join public.profiles p on p.id = u.id
-- where p.id is null;
