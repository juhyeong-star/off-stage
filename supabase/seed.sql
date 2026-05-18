-- ================================================================
-- Off-Stage Seed Data
-- Populates Supabase with mock tracks/demos matching the localStorage
-- mock data so Supabase (not localStorage) is the single source of truth.
--
-- PREREQUISITE: You must first create 5 "artist" auth users via the
-- Supabase Dashboard (Authentication → Users → Add User with email
-- confirmation OFF), one per mock artist below. Note down each user's
-- UUID from the Users list, then paste them into the INSERT INTO
-- artist_map section below before running this file.
--
-- HOW TO RUN:
-- 1. Create the 5 users in Auth UI
-- 2. Fill in the UUID variables in the block below
-- 3. Paste everything into SQL Editor → Run
-- ================================================================

-- ===== 1. Map artist names → user UUIDs (fill these in!) =========
-- Replace each '00000000-0000-0000-0000-000000000000' with the actual
-- user UUID from Supabase Auth → Users page.

do $$
declare
  uid_kim_music    uuid := '00000000-0000-0000-0000-000000000000';  -- 김음악
  uid_lee_compose  uuid := '00000000-0000-0000-0000-000000000000';  -- 이작곡
  uid_park_synth   uuid := '00000000-0000-0000-0000-000000000000';  -- 박신스
  uid_kim_student  uuid := '00000000-0000-0000-0000-000000000000';  -- 김학생
  uid_park_band    uuid := '00000000-0000-0000-0000-000000000000';  -- 박밴드

  -- Project UUIDs (generated here so demos + master share the same project_id)
  pid_t1 uuid := gen_random_uuid();
  pid_t2 uuid := gen_random_uuid();
  pid_t3 uuid := gen_random_uuid();
  pid_t4 uuid := gen_random_uuid();
  pid_t5 uuid := gen_random_uuid();
  pid_t6 uuid := gen_random_uuid();
  pid_t7 uuid := gen_random_uuid();
  pid_t8 uuid := gen_random_uuid();
  pid_t9 uuid := gen_random_uuid();
  pid_t10 uuid := gen_random_uuid();
begin
  -- ==== Update profiles with proper names/roles ====
  update profiles set name = '김음악',   role = 'artist', avatar_url = 'https://i.pravatar.cc/150?img=11' where id = uid_kim_music;
  update profiles set name = '이작곡',   role = 'artist', avatar_url = 'https://i.pravatar.cc/150?img=12' where id = uid_lee_compose;
  update profiles set name = '박신스',   role = 'artist', avatar_url = 'https://i.pravatar.cc/150?img=13' where id = uid_park_synth;
  update profiles set name = '김학생',   role = 'artist', avatar_url = 'https://i.pravatar.cc/150?img=20' where id = uid_kim_student;
  update profiles set name = '박밴드',   role = 'artist', avatar_url = 'https://i.pravatar.cc/150?img=17' where id = uid_park_band;

  -- ==== Master tracks (one per project) ====
  insert into tracks (project_id, artist_id, title, audio_url, cover_url, version, version_label, is_demo, tags, shape, shape_color, lines, likes_count, plays_count) values
  (pid_t1,  uid_kim_music,    'Midnight Drive',       'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',  'https://images.unsplash.com/photo-1614613535308-eb5fbd3d2c17?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['1982년 느낌','synthwave','드라이브','new retro wave','레트로','밤','새벽 감성','chill','신디사이저','김음악 음악'],       'oval',          '#FF9800', ARRAY['#my music is the best','#1982년 감성 드라이브','#김음악의 첫 트랙 들어봐!'],  124, 1050),
  (pid_t2,  uid_lee_compose,  'Rainy City Blues',     'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['lofi','비 오는 날','카페 무드','chillhop','보사노바','R&B','일렉피아노','이작곡 음악','mellow','우울'],                       'star',          '#FF4081', ARRAY['#비 오는 날 감성 lofi','#카페에서 작업했어요 ☔','#이작곡 신곡 Rainy City Blues'],  85,  600),
  (pid_t3,  uid_park_synth,   'Neon Horizon',         'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',  'https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['synthwave','neon','밤','사이버펑크','드라이브','retro wave','신스','박신스 음악','야경','감성'],                            'triangle',      '#2979FF', ARRAY['#네온 감성 synthwave','#밤에 들으면 미침','#박신스 Neon Horizon'],  342, 5200),
  (pid_t4,  uid_kim_student,  'Spring Awakening',     'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3',  'https://images.unsplash.com/photo-1493225457124-a1a2a5f5f9af?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['고1 작곡과','봄','어쿠스틱','indie folk','첫 곡','학생 작곡','기타','입학','따뜻함','풋풋함'],                             'rect',          '#7C4DFF', ARRAY['#고1이 작곡했어 들어봐!','#봄에 어쿠스틱 기타로','#음원명: Spring Awakening'],  56,  210),
  (pid_t5,  uid_park_band,    'Midnight Jazz',        'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3',  'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['jazz','고3 기타과 음악','밤','bebop','재즈 잼','기타 솔로','박밴드','smooth jazz','ballad','어른스러움'],               'circle',        '#76FF03', ARRAY['#재즈 미쳤다 진짜','#고3 기타과의 자존심','#Midnight Jazz 🎷'],  920, 13000),
  (pid_t6,  uid_lee_compose,  'Sunset Groove',        'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3',  'https://images.unsplash.com/photo-1550684848-fac1c5b4e853?auto=format&fit=crop&q=80&w=500',  'final', 'Final', false, ARRAY['funky','드라이브','노을','disco','디스코','70년대 느낌','해변','베이스 라인','이작곡 음악','신남'],                          'parallelogram', '#FFD600', ARRAY['#funky 하면 이 곡이지','#드라이브 BGM 추천','#이작곡 Sunset Groove 🌅'],  128, 870),
  (pid_t7,  uid_kim_music,    'Velvet Sky',           'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-12.mp3', 'https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?auto=format&fit=crop&q=80&w=500', 'final', 'Final', false, ARRAY['dream pop','밤하늘','감성','신스팝','잠 안 올 때','reverb','슈게이징','김음악 음악','우주','몽환'],                       'hexagon',       '#7C4DFF', ARRAY['#벨벳처럼 부드러운 밤','#잠 안 올 때 이 곡','#김음악 Velvet Sky 🌌'],  210, 2800),
  (pid_t8,  uid_park_synth,   'Midnight Confession',  'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-13.mp3', 'https://images.unsplash.com/photo-1504509546545-e000b4a62425?auto=format&fit=crop&q=80&w=500', 'final', 'Final', false, ARRAY['synthwave','새벽','고백','감성적','박신스 음악','신스','고2','밤 운전','멜랑콜리','사랑'],                                      'diamond',       '#EA80FC', ARRAY['#새벽 고백 synthwave','#이 곡 들으면 마음이','#박신스 Midnight Confession'],  178, 1980),
  (pid_t9,  uid_lee_compose,  'Coffee & Rain',        'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-14.mp3', 'https://images.unsplash.com/photo-1447933601403-0c6688de566e?auto=format&fit=crop&q=80&w=500', 'final', 'Final', false, ARRAY['lofi','커피','비','카페 무드','작업용','공부 BGM','이작곡 음악','잔잔','오전','평온'],                                         'oval',          '#FFD54F', ARRAY['#카페 lofi','#비 오는 오전','#이작곡 Coffee & Rain ☕'],  89,  740),
  (pid_t10, uid_kim_student,  'School Bell',          'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-15.mp3', 'https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&q=80&w=500', 'final', 'Final', false, ARRAY['학교','indie rock','고2','하교','청춘','기타 리프','김학생 음악','밴드','풋풋함','에너지'],                                  'rect',          '#00E5FF', ARRAY['#하교종 울리면','#indie rock 좋아해?','#김학생 School Bell 🔔'],  62,  310);

  -- (Demo tracks can be seeded similarly with version='demo1/2/3/4' and is_demo=true —
  -- omitted here for brevity; extend this file later if you want Supabase-backed demos.)
end;
$$;

-- ===== 2. Seed sample wall notes (only if empty) ================
insert into wall_notes (author_id, author_name, text, color, rotation, created_at)
select
  null,
  unnest(ARRAY['익명1','익명2','익명3']),
  unnest(ARRAY['오늘 새벽에 만든 비트 들어봐줘 ✨','비 오는 날 카페에서 작업하기 딱 좋은 곡 추천해줘 ☔','synthwave 좋아하는 친구들 모여라! 같이 합주실 잡고 싶어 🎹']),
  unnest(ARRAY['yellow','blue','pink']),
  unnest(ARRAY[-2, 1.5, -1]),
  now()
where not exists (select 1 from wall_notes limit 1);
