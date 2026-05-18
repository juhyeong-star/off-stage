-- ================================================================
-- Collaborators + Artist Bio (About)
-- - tracks.collaborators : 같이 만든 아티스트 목록 (JSONB)
--     예: [{"name": "민지", "userId": "uuid-or-null"}, ...]
-- - profiles.bio          : 아티스트 자기소개 (Artist About 탭)
-- ================================================================

alter table public.tracks
  add column if not exists collaborators jsonb not null default '[]'::jsonb;

-- 콜라보 멤버 이름으로 트랙 조회 빠르게 — JSONB GIN
create index if not exists tracks_collaborators_idx
  on public.tracks using gin (collaborators);

alter table public.profiles
  add column if not exists bio text;
