-- =====================================================================
-- OFFLOG — 레퍼런스용 가상 아티스트 3명
--
-- 배경: 지금 가입자 63명 중 로그를 써본 사람이 7명뿐이고, 새로 들어온 사람은
--   "여기에 뭘 어떻게 올리는 거지?"를 알 방법이 없다. 잘 채워진 계정 셋을
--   본보기로 두면 따라 하기 쉬워진다. 한글·영어를 섞어 두 종류 다 보이게 했다.
--
-- 미디어는 Supabase Storage가 아니라 레포의 /demo/ 에서 서빙한다 —
--   무료 저장소 1GB 중 이미 381MB를 썼고 그중 365MB가 오디오다.
--   샘플까지 거기 올리면 실제 학생들 몫이 줄어든다. 정적 파일은 Vercel이 그냥 준다.
--
-- 되돌리기: 맨 아래 롤백 블록 주석을 풀어 실행하면 3명과 그들의 콘텐츠가 전부 지워진다.
--
-- 실행법: Supabase 대시보드 → SQL Editor → 붙여넣고 Run
-- =====================================================================

do $$
declare
  base text := 'https://onoff-stage.com/demo/';
  u_harin  uuid := '00000000-0000-4000-a000-00000000d001';
  u_noah   uuid := '00000000-0000-4000-a000-00000000d002';
  u_chorok uuid := '00000000-0000-4000-a000-00000000d003';
begin

  -- ── 계정 ──────────────────────────────────────────────────────────
  -- profiles.id 가 auth.users(id) 를 참조하므로 먼저 만든다.
  -- 로그인은 불가능한 데모 전용 계정 — 비밀번호 해시를 넣지 않아 아무도 접속할 수 없다.
  insert into auth.users (id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
  values
    (u_harin,  '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
     'demo.harin@offlog.invalid',  '{"name":"유하린"}'::jsonb, now()-interval '40 days', now()),
    (u_noah,   '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
     'demo.noah@offlog.invalid',   '{"name":"Noah Kim"}'::jsonb, now()-interval '35 days', now()),
    (u_chorok, '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
     'demo.chorok@offlog.invalid', '{"name":"초록불 Chorokbul"}'::jsonb, now()-interval '28 days', now())
  on conflict (id) do nothing;

  -- ── 프로필 ────────────────────────────────────────────────────────
  insert into public.profiles (id, name, role, bio, avatar_url, account_visibility)
  values
    (u_harin, '유하린', 'artist',
     E'베드룸 팝 만들어요. 밤에 방에서 혼자 녹음합니다.\n작업 과정을 그대로 올려요 — 잘 된 날도, 망한 날도.',
     base||'harin-avatar.png', 'public'),
    (u_noah, 'Noah Kim', 'artist',
     E'Producer / beatmaker. Seoul ↔ LA.\nLo-fi hip hop, jazzy chords. Open to collabs — DM me.',
     base||'noah-avatar.png', 'public'),
    (u_chorok, '초록불 Chorokbul', 'artist',
     E'3인조 인디밴드. 기타 정우 · 베이스 하늘 · 드럼 세진.\n합주실에서 만든 걸 그날그날 남깁니다. We play loud.',
     base||'chorok-avatar.png', 'public')
  on conflict (id) do update
    set name=excluded.name, role=excluded.role, bio=excluded.bio,
        avatar_url=excluded.avatar_url, account_visibility=excluded.account_visibility;

  -- ── 로그 ──────────────────────────────────────────────────────────
  -- 기존 데모 로그를 지우고 다시 넣는다(여러 번 실행해도 안전).
  delete from public.logs where author_id in (u_harin, u_noah, u_chorok);

  -- 유하린 — 글 → 사진 → 데모 (하루하루 쌓이는 흐름을 보여준다)
  insert into public.logs (author_id, kind, text, caption, media_url, tone, visibility, created_at) values
    (u_harin,'note', E'훅이 안 나온다. 12시간째 같은 4마디만 듣는 중.\n내일 다시.', null, null,'y','public', now()-interval '5 days'),
    (u_harin,'ph',   null, '새벽 3시 작업실. 결국 코드 바꿨다', base||'harin-photo.png', null,'public', now()-interval '3 days'),
    (u_harin,'snd',  null, '방에서 (demo v3)', base||'harin-demo.wav', null,'public', now()-interval '2 days'),
    (u_harin,'note', E'믹스 끝. 드디어 발매 올린다.\n무서운데 후련하다.', null, null,'p','public', now()-interval '1 day');

  -- Noah Kim — 영어권 사용자가 봐도 자연스럽게
  insert into public.logs (author_id, kind, text, caption, media_url, tone, visibility, created_at) values
    (u_noah,'note', E'Chopped an old jazz record today. That Rhodes tone is unreal.\n샘플 하나로 하루가 갔다.', null, null,'b','public', now()-interval '6 days'),
    (u_noah,'snd',  null, 'midnight drive (beat)', base||'noah-demo.wav', null,'public', now()-interval '4 days'),
    (u_noah,'ph',   null, 'studio setup — finally fixed the monitor placement', base||'noah-photo.png', null,'public', now()-interval '2 days'),
    (u_noah,'note', E'Looking for a vocalist on this one. Korean or English, either works.\n같이 할 보컬 찾습니다.', null, null,'y','public', now()-interval '20 hours');

  -- 초록불 — 밴드. 합주 기록
  insert into public.logs (author_id, kind, text, caption, media_url, tone, visibility, created_at) values
    (u_chorok,'note', E'합주 3시간. 후렴 템포 8 올리니까 완전히 다른 곡이 됐다.\n세진이 말이 맞았음.', null, null,'y','public', now()-interval '7 days'),
    (u_chorok,'ph',   null, '연습실 낙서판 — 이번 앨범 트랙리스트', base||'chorok-photo.png', null,'public', now()-interval '4 days'),
    (u_chorok,'snd',  null, '초록불 - 소나기 (합주 러프)', base||'chorok-demo.wav', null,'public', now()-interval '3 days'),
    (u_chorok,'note', E'다음 주 홍대 공연. 셋리스트 짜는 중.\nCome through if you are around.', null, null,'b','public', now()-interval '18 hours');

  -- ── 발매곡 ────────────────────────────────────────────────────────
  -- '기록 → 발매'까지 이어지는 모습을 보여주는 게 핵심이다.
  delete from public.tracks where artist_id in (u_harin, u_noah, u_chorok);
  insert into public.tracks (artist_id, title, audio_url, cover_url, created_at) values
    (u_harin,  '방에서',            base||'harin-demo.wav',  base||'harin-cover.png',  now()-interval '1 day'),
    (u_noah,   'Midnight Drive',    base||'noah-demo.wav',   base||'noah-cover.png',   now()-interval '2 days'),
    (u_chorok, '소나기 Sonagi',     base||'chorok-demo.wav', base||'chorok-cover.png', now()-interval '3 days');

  -- ── 서로 팔로우 ───────────────────────────────────────────────────
  -- 셋이 서로 맞팔이면, 이 계정을 팔로우한 신규 유저의 홈이 바로 채워진다.
  delete from public.follows where follower_id in (u_harin,u_noah,u_chorok)
                                or followed_id in (u_harin,u_noah,u_chorok);
  insert into public.follows (follower_id, followed_id) values
    (u_harin,u_noah),(u_harin,u_chorok),
    (u_noah,u_harin),(u_noah,u_chorok),
    (u_chorok,u_harin),(u_chorok,u_noah)
  on conflict do nothing;

  raise notice '데모 아티스트 3명 준비 완료';
end $$;

select p.name, p.role,
       (select count(*) from public.logs   l where l.author_id=p.id) as logs,
       (select count(*) from public.tracks t where t.artist_id=p.id) as tracks
from public.profiles p
where p.id in ('00000000-0000-4000-a000-00000000d001',
               '00000000-0000-4000-a000-00000000d002',
               '00000000-0000-4000-a000-00000000d003');

-- =====================================================================
-- 롤백 — 데모 계정을 전부 지우려면 아래를 실행
-- =====================================================================
-- delete from auth.users where id in (
--   '00000000-0000-4000-a000-00000000d001',
--   '00000000-0000-4000-a000-00000000d002',
--   '00000000-0000-4000-a000-00000000d003');
-- (profiles·logs·tracks·follows 는 on delete cascade 로 함께 사라진다)
