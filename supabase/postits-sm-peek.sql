-- ================================================================
-- Off-Stage — SM Entertainment & Peek 포스트잇 시드
--
-- 어디서 실행? Supabase Dashboard → SQL Editor → New query → 붙여넣기 → Run
-- (SQL Editor는 service-role로 실행되므로 RLS의 insert-auth 정책 통과)
--
-- 안전: author_id NULL + author_name 으로 게시.
-- 중복 방지: 동일한 (author_name, text) 조합이 이미 있으면 skip.
-- ================================================================

-- === SM Entertainment — 메이저 레이블 voice (IR/팬 공지 톤) ===
insert into wall_notes (author_id, author_name, text, color, rotation, created_at)
select * from (values
  (null::uuid, 'SM Entertainment'::text,
   E'VELVET 글로벌 투어 다음 주 공식 발표\nNYC · LA · 도쿄 · 파리 · 런던 단독공연\n선예매: STO 별빛 등급 후원자 우선권 🎫',
   'pink'::text, -1.4::real, timestamptz '2026-05-10 11:00:00+09'),

  (null, 'SM Entertainment',
   E'AETHER 「Cosmic Stage」 글로벌 누적 1.8억 스트리밍\n데뷔 6개월 K-pop 신기록\n로열티 분배 — 다음 분기 정산 예정 💎',
   'blue', 1.6, timestamptz '2026-05-09 18:00:00+09'),

  (null, 'SM Entertainment',
   E'LILIES 「Ribbon」 안무 챌린지\n글로벌 K-pop 챌린지 차트 1위 진입\n상위 후원자 100명 쇼케이스 백스테이지 초대 ✨',
   'green', -0.9, timestamptz '2026-05-07 15:30:00+09'),

  (null, 'SM Entertainment',
   E'新 보이그룹 9월 데뷔 확정\n멤버 7인, 평균 연령 18.5세\nSTO 사전 후원자 한정 프리데뷔 쇼케이스 우선 초대 🎤',
   'orange', 2.2, timestamptz '2026-05-06 20:00:00+09'),

  (null, 'SM Entertainment',
   E'VELVET 정규 3집 작업 시작\n멤버 작사·작곡 참여율 70% 목표\n진행 과정·미공개 컷 후원자 분께만 공유 📀',
   'purple', -2.1, timestamptz '2026-05-04 13:00:00+09'),

  (null, 'SM Entertainment',
   E'글로벌 콜라보 발표 — 다음 주 정식 공개\n美 그래미 노미네이션 아티스트 공동 작업\n자세한 건 후원자 페이지에서 먼저 🌍',
   'yellow', 1.1, timestamptz '2026-05-03 10:00:00+09'),

  (null, 'SM Entertainment',
   E'AETHER 일본 도쿄돔 단독공연 매진\n10만석 9분 컷\n팬분들 진심으로 감사합니다 🇯🇵🙏',
   'pink', -1.7, timestamptz '2026-05-01 09:00:00+09')
) as v(author_id, author_name, text, color, rotation, created_at)
where not exists (
  select 1 from wall_notes wn
  where wn.author_name = v.author_name and wn.text = v.text
);

-- === Peek — bedroom pop, 평소의 순간들을 프랑스어로 ===
insert into wall_notes (author_id, author_name, text, color, rotation, created_at)
select * from (values
  (null::uuid, 'Peek'::text,
   E'J''ai trouvé une mélodie ce matin ☁️\nUn petit air au piano dans ma chambre\nPeut-être pour le prochain EP 🎹',
   'blue'::text, -1.3::real, timestamptz '2026-05-11 07:30:00+09'),

  (null, 'Peek',
   E'Mon mouton est devenu mon co-producteur 🐑\nIl écoute toutes mes démos\nIl ne dit jamais non — coach parfait',
   'green', 1.9, timestamptz '2026-05-10 22:00:00+09'),

  (null, 'Peek',
   E'Café · cahier · guitare\nLa recette du dimanche après-midi ☕\nMerci d''être là avec moi 🤍',
   'orange', -2.0, timestamptz '2026-05-10 15:00:00+09'),

  (null, 'Peek',
   E'Je viens d''enregistrer dans ma chambre\nLes voisins ont fermé la fenêtre 🪟\nDésolée — mais merci pour l''inspiration',
   'yellow', 0.8, timestamptz '2026-05-09 23:30:00+09'),

  (null, 'Peek',
   E'Petit cadeau ce week-end :\nune démo cachée pour les backers 💌\nMerci d''avoir cru en moi dès le début',
   'pink', -1.5, timestamptz '2026-05-08 18:00:00+09'),

  (null, 'Peek',
   E'Tomber amoureuse de ma propre voix 🌷\nC''est mon objectif cette semaine\nVotre soutien me donne du courage',
   'purple', 2.3, timestamptz '2026-05-07 11:00:00+09'),

  (null, 'Peek',
   E'Première fois que je chante en français 🇫🇷\nUn peu timide mais\nje veux essayer pour vous ✨',
   'blue', -0.6, timestamptz '2026-05-05 20:30:00+09')
) as v(author_id, author_name, text, color, rotation, created_at)
where not exists (
  select 1 from wall_notes wn
  where wn.author_name = v.author_name and wn.text = v.text
);

-- === 글로벌 IR 데모용 — 외국인 사용 가정, 한·영·일·프 mix + 재미난 톤 ===
-- 오프스테이지: 메이저 레이블 도발 + J-POP rebrand 농담
insert into wall_notes (author_id, author_name, text, color, rotation, created_at)
select * from (values
  (null::uuid, '오프스테이지'::text,
   E'#내가 민희진 보다 잘함\n우리 직캠 한 번 보면 알아 👀\n— 오프스테이지 feat. 자신감 폭발',
   'pink'::text, -2.3::real, timestamptz '2026-05-11 15:00:00+09'),

  (null, '오프스테이지',
   E'#뉴진스 내가 챙긴다\n다음 컴백은 우리 손에 맡겨\nproduced by 오프스테이지 🔥',
   'blue', 1.8, timestamptz '2026-05-11 11:30:00+09'),

  (null, '오프스테이지',
   E'#hey we are new J-POP Rock Band 🌸\n#but we don''t speak japaness\n#but lyric is japaness — それでもいい?',
   'yellow', -0.7, timestamptz '2026-05-10 19:00:00+09'),

  (null, '김학생',
   E'#내음악들어봐 진짜로\n한 번만 들으면 멈출 수 없음\nspoiler: 고2 작곡과 미친 천재 😎',
   'green', -1.1, timestamptz '2026-05-09 17:00:00+09'),

  (null, '박신스',
   E'synthwave from Seoul → world 🌍\nplease give me a chance\nmy music doesn''t need translation',
   'purple', 0.9, timestamptz '2026-05-08 22:00:00+09'),

  (null, 'Peek',
   E'Hello! Bonjour! 안녕! こんにちは 🌷\nfirst time singing in 4 languages\n양 인형이 자랑스러워해 🐑',
   'pink', -1.8, timestamptz '2026-05-11 09:00:00+09')
) as v(author_id, author_name, text, color, rotation, created_at)
where not exists (
  select 1 from wall_notes wn
  where wn.author_name = v.author_name and wn.text = v.text
);

-- === 글로벌 리스너 — NYC / Tokyo / Madrid / Berlin ===
insert into wall_notes (author_id, author_name, text, color, rotation, created_at)
select * from (values
  (null::uuid, 'listener_aria'::text,
   E'just found this app from NYC 🗽\nthe shapes universe is unreal\nAngel Noise on loop all week',
   'green'::text, 1.4::real, timestamptz '2026-05-11 03:00:00+09'),

  (null, 'リスナー_さくら',
   E'東京から愛を込めて 🗼\nPeekのフランス語、最高に可愛い\n次の曲も楽しみ',
   'pink', -1.6, timestamptz '2026-05-10 20:30:00+09'),

  (null, 'listener_marcus',
   E'STO = Story Token Offering 💎\nfinally a music platform that pays artists\n#K-indie #global #futureofmusic',
   'purple', 2.1, timestamptz '2026-05-10 08:00:00+09'),

  (null, 'リスナー_ハル',
   E'深夜2時、ヘッドホンで聴く\nそれがangelnoiseの正しい使い方 🌙\n眠れない夜のための音楽',
   'blue', -2.0, timestamptz '2026-05-09 02:15:00+09'),

  (null, 'listener_diego',
   E'from Madrid 🇪🇸\n루시드 베어 = perfect for siesta\nstreaming chart Spain 1위 도전 중',
   'orange', 1.3, timestamptz '2026-05-08 14:00:00+09'),

  (null, 'listener_lena',
   E'Berlin techno scene meets K-indie 🇩🇪\nthis app is the future\nbuying STO shares of every demo',
   'green', -0.9, timestamptz '2026-05-07 22:00:00+09')
) as v(author_id, author_name, text, color, rotation, created_at)
where not exists (
  select 1 from wall_notes wn
  where wn.author_name = v.author_name and wn.text = v.text
);

-- 검증: 새로 들어간 노트 확인
select author_name, count(*) as note_count
from wall_notes
where author_name in (
  'SM Entertainment', 'Peek', '오프스테이지', '김학생', '박신스',
  'listener_aria', 'listener_marcus', 'listener_diego', 'listener_lena',
  'リスナー_さくら', 'リスナー_ハル'
)
group by author_name
order by author_name;
