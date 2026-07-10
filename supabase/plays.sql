-- =====================================================================
-- Off-Stage — Track Play Count (실제 재생수 서버 반영)
-- 지금까지는 재생 카운트가 로컬(localStorage)에만 저장돼서 다른 사람 눈엔 안 보였음.
-- 이 함수는 tracks.plays_count 를 원자적으로 +1 — RLS 우회(security definer)로
-- 로그인 안 한 청취자도 호출 가능(누구나 곡을 들을 수 있어야 하니까).
-- =====================================================================

create or replace function public.increment_track_plays(p_track_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.tracks set plays_count = plays_count + 1 where id = p_track_id;
$$;

grant execute on function public.increment_track_plays(uuid) to anon, authenticated;
