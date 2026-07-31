-- ============================================================
-- delete-account.sql — 계정 탈퇴(완전 삭제)
--
-- 왜 필요한가: 앱스토어 Guideline 5.1.1(v). 가입이 가능한 앱은 앱 안에서
--   계정을 삭제할 수 있어야 하고, '비활성화'가 아니라 실제 데이터가 지워져야 한다.
--
-- 왜 SQL 이 필요한가: 브라우저의 anon 키로는 auth.users 를 지울 수 없다.
--   그래서 로그인한 본인만 자기 계정을 지울 수 있는 함수를 서버에 두고,
--   앱은 그 함수를 호출하기만 한다(security definer).
--
-- 실행: Supabase 대시보드 → SQL Editor → 전체 붙여넣고 Run (한 번만)
--   https://supabase.com/dashboard/project/vayzhmaggwpkbsrrsdqt/sql/new
--
-- 안전장치: auth.uid() 로 '지금 로그인한 본인'만 지운다. 남의 계정은 지울 수 없다.
-- ============================================================

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  rec record;
begin
  if uid is null then
    raise exception '로그인 상태가 아닙니다';
  end if;

  -- 1) 작성자 참조가 CASCADE 가 아닌 테이블은 직접 지운다.
  --
  --    · dm_messages.sender_id 는 삭제 동작이 지정돼 있지 않다(NO ACTION).
  --      그냥 두면 DM 을 보낸 적 있는 계정은 삭제가 외래키 위반으로 실패한다.
  --    · track_comments·wall_notes 등은 SET NULL 이라 계정만 지우면 글이 그대로 남는다.
  --      본인이 쓴 글이므로 함께 지운다.
  --
  --    아직 만들지 않은 테이블이 있을 수 있으므로 존재할 때만 실행한다.
  for rec in
    select * from (values
      ('dm_messages',        'sender_id'),
      ('track_comments',     'author_id'),
      ('wall_note_comments', 'author_id'),
      ('wall_notes',         'author_id'),
      ('reservations',       'user_id'),
      ('play_events',        'user_id'),
      ('note_views',         'viewer_id'),
      ('cheers',             'supporter_id')
    ) as x(tbl, col)
  loop
    if to_regclass('public.' || rec.tbl) is not null then
      execute format('delete from public.%I where %I = $1', rec.tbl, rec.col) using uid;
    end if;
  end loop;

  -- 2) 업로드한 파일(사진·음원)도 지운다. 컬럼 이름이 버전마다 달라서 둘 다 시도한다.
  begin
    execute 'delete from storage.objects where owner = $1' using uid;
  exception when others then
    begin
      execute 'delete from storage.objects where owner_id = $1::text' using uid;
    exception when others then
      raise notice '스토리지 파일 삭제 건너뜀: %', sqlerrm;
    end;
  end;

  -- 3) 계정 삭제. profiles·logs·tracks·follows 등 나머지는 CASCADE 로 함께 지워진다.
  delete from auth.users where id = uid;
end;
$$;

-- 로그인한 사용자만 호출할 수 있게
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- ── 확인 ──
-- 아래가 1행 나오면 함수가 준비된 것
select routine_name, security_type
from information_schema.routines
where routine_schema = 'public' and routine_name = 'delete_my_account';
