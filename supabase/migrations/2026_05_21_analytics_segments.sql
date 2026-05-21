-- ============================================================
-- 2026_05_21_analytics_segments.sql
-- Per-track segment heatmap: for any track, count how many distinct
-- listeners had a progress/end event with position_sec falling in
-- each N-second bucket. Lets us see which parts of the song people
-- actually listened to and where they drop off.
--
-- Resolution: client now sends a progress heartbeat every 5s with
-- audio.currentTime → one position sample per 5-second window per
-- active listener.
-- ============================================================

create or replace function public.track_segment_stats(
  p_track_id   uuid,
  p_bucket_sec int default 5
)
returns table (
  bucket_start int,    -- bucket lower bound in seconds (0, 5, 10, …)
  listeners    int,    -- distinct listeners (user_id or session_id)
  samples      int     -- total progress/end events that landed here
) language sql security definer set search_path = public as $$
  with samples as (
    select coalesce(user_id::text, session_id) as listener,
           (position_sec / p_bucket_sec) * p_bucket_sec as bucket
      from public.play_events
     where track_id  = p_track_id
       and event_type in ('progress','end')
       and position_sec is not null
       and position_sec >= 0
  )
  select bucket::int,
         count(distinct listener)::int,
         count(*)::int
    from samples
   group by bucket
   order by bucket;
$$;
grant execute on function public.track_segment_stats(uuid, int) to anon, authenticated;
