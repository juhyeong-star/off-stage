-- ============================================================
-- 2026_05_21_analytics.sql
-- Analytics: play_events + note_views + aggregate RPCs.
-- - play_events: every play start / heartbeat / end (also covers
--   "shape clicks" via source='shape').
-- - note_views:  one row per (note_id, session_id) — anonymous OK.
-- - Raw rows are NOT readable by clients; aggregates are exposed
--   via SECURITY DEFINER RPCs.
-- ============================================================

-- ── 1. play_events ───────────────────────────────────────────
create table if not exists public.play_events (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid references public.tracks(id) on delete cascade,
  user_id      uuid references auth.users(id) on delete set null,
  session_id   text not null,
  event_type   text not null check (event_type in ('start','progress','end')),
  position_sec int,
  listened_sec int,
  duration_sec int,
  source       text,   -- 'shape' | 'wall' | 'playlist' | 'artist' | 'universe' | 'other'
  created_at   timestamptz not null default now()
);
create index if not exists play_events_track_idx
  on public.play_events(track_id, created_at desc);
create index if not exists play_events_session_idx
  on public.play_events(session_id);
create index if not exists play_events_user_idx
  on public.play_events(user_id) where user_id is not null;

-- ── 2. note_views ────────────────────────────────────────────
create table if not exists public.note_views (
  id         uuid primary key default gen_random_uuid(),
  note_id    uuid references public.wall_notes(id) on delete cascade,
  viewer_id  uuid references auth.users(id) on delete set null,
  session_id text not null,
  created_at timestamptz not null default now()
);
-- Dedupe: one row per (note, session)
create unique index if not exists note_views_dedupe
  on public.note_views(note_id, session_id);

-- ── 3. RLS ───────────────────────────────────────────────────
alter table public.play_events enable row level security;
alter table public.note_views  enable row level security;

drop policy if exists play_events_insert_any on public.play_events;
create policy play_events_insert_any on public.play_events
  for insert with check (true);

drop policy if exists note_views_insert_any on public.note_views;
create policy note_views_insert_any on public.note_views
  for insert with check (true);

-- No SELECT policy → raw rows hidden. Aggregates come from RPCs below.

-- ── 4. RPCs ──────────────────────────────────────────────────

-- Per-track stats — public; used on artist page
create or replace function public.track_stats(p_track_id uuid)
returns table (
  plays_total      int,
  unique_listeners int,
  listeners_30s    int,
  avg_listened_sec numeric,
  completion_rate  numeric
) language sql security definer set search_path = public as $$
  select
    (select count(*)
       from public.play_events
      where track_id = p_track_id and event_type = 'start')::int,
    (select count(distinct coalesce(user_id::text, session_id))
       from public.play_events
      where track_id = p_track_id and event_type = 'start')::int,
    (select count(distinct coalesce(user_id::text, session_id))
       from public.play_events
      where track_id = p_track_id and event_type = 'end' and listened_sec >= 30)::int,
    coalesce((select avg(listened_sec)
       from public.play_events
      where track_id = p_track_id and event_type = 'end'), 0)::numeric,
    coalesce((select avg(case when duration_sec > 0
                              then listened_sec::numeric / duration_sec
                              else 0 end)
       from public.play_events
      where track_id = p_track_id and event_type = 'end'), 0)::numeric;
$$;
grant execute on function public.track_stats(uuid) to anon, authenticated;

-- Per-note view count — public
create or replace function public.note_view_count(p_note_id uuid)
returns int language sql security definer set search_path = public as $$
  select count(*)::int from public.note_views where note_id = p_note_id;
$$;
grant execute on function public.note_view_count(uuid) to anon, authenticated;

-- My notes' view counts — only the caller's own notes
create or replace function public.my_notes_views()
returns table (note_id uuid, views int)
language sql security definer set search_path = public as $$
  select nv.note_id, count(*)::int
    from public.note_views nv
    join public.wall_notes wn on wn.id = nv.note_id
   where wn.author_id = auth.uid()
   group by nv.note_id;
$$;
grant execute on function public.my_notes_views() to authenticated;

-- My tracks' stats — only the caller's own tracks (artist_id = uid)
create or replace function public.my_tracks_stats()
returns table (
  track_id         uuid,
  plays_total      int,
  unique_listeners int,
  listeners_30s    int,
  avg_listened_sec numeric
) language sql security definer set search_path = public as $$
  select
    t.id,
    (select count(*) from public.play_events pe
       where pe.track_id = t.id and pe.event_type = 'start')::int,
    (select count(distinct coalesce(pe.user_id::text, pe.session_id))
       from public.play_events pe
      where pe.track_id = t.id and pe.event_type = 'start')::int,
    (select count(distinct coalesce(pe.user_id::text, pe.session_id))
       from public.play_events pe
      where pe.track_id = t.id and pe.event_type = 'end' and pe.listened_sec >= 30)::int,
    coalesce((select avg(pe.listened_sec) from public.play_events pe
       where pe.track_id = t.id and pe.event_type = 'end'), 0)::numeric
  from public.tracks t
  where t.artist_id = auth.uid();
$$;
grant execute on function public.my_tracks_stats() to authenticated;

-- Admin: overall stats
create or replace function public.admin_overall_stats()
returns table (
  total_plays         int,
  total_listeners     int,
  total_listeners_30s int,
  total_note_views    int,
  events_today        int
) language plpgsql security definer set search_path = public as $$
declare
  is_admin boolean;
begin
  select exists(select 1 from public.profiles
                where id = auth.uid() and role = 'admin') into is_admin;
  if not is_admin then raise exception 'not authorized'; end if;
  return query
  select
    (select count(*) from public.play_events where event_type = 'start')::int,
    (select count(distinct coalesce(user_id::text, session_id))
       from public.play_events where event_type = 'start')::int,
    (select count(distinct coalesce(user_id::text, session_id))
       from public.play_events
      where event_type = 'end' and listened_sec >= 30)::int,
    (select count(*) from public.note_views)::int,
    (select count(*) from public.play_events
      where created_at > now() - interval '1 day')::int;
end $$;
grant execute on function public.admin_overall_stats() to authenticated;

-- Admin: top tracks
create or replace function public.admin_top_tracks(p_limit int default 20)
returns table (
  track_id        uuid,
  plays           int,
  listeners_30s   int
) language plpgsql security definer set search_path = public as $$
declare
  is_admin boolean;
begin
  select exists(select 1 from public.profiles
                where id = auth.uid() and role = 'admin') into is_admin;
  if not is_admin then raise exception 'not authorized'; end if;
  return query
  select
    pe.track_id,
    count(*) filter (where pe.event_type = 'start')::int,
    count(distinct coalesce(pe.user_id::text, pe.session_id))
      filter (where pe.event_type = 'end' and pe.listened_sec >= 30)::int
  from public.play_events pe
  where pe.track_id is not null
  group by pe.track_id
  order by 2 desc
  limit p_limit;
end $$;
grant execute on function public.admin_top_tracks(int) to authenticated;
