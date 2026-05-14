-- ============================================
-- 0019_artist_streaming_analytics.sql
--
-- 아티스트 본인 음원 일간 스트리밍 분석 RPC.
--
-- 집계 기준:
--   stream_events.event_type='milestone_30s' 1건 = 1 스트리밍
--   - 기존 get_track_chart / admin_top_tracks 와 동일 규칙
--   - 클라이언트 Player.tsx 는 트랙당 세션당 1회만 milestone_30s 전송
--     (milestoneSentRef) → 자연 dedup
--   - 더 엄격한 dedup 이 필요하면 distinct (user_id, session_id, track_id, day)
--     로 바꿀 수 있음 (현재 MVP 는 단순 count)
--
-- 보안:
--   - 본인 owner_user_id 트랙만 집계 — auth.uid() 강제
--   - security definer + search_path = public
-- ============================================

-- ----------------------
-- RPC: get_artist_daily_streams
--   일자별 트랙별 스트리밍 수
-- ----------------------
create or replace function public.get_artist_daily_streams(p_days int default 30)
returns table(
  day date,
  track_id uuid,
  title text,
  daily_streams bigint
)
language sql
security definer
set search_path = public
as $$
  with bound as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as d
  ),
  mine as (
    select t.id, t.title
    from public.tracks t
    where t.owner_user_id = auth.uid()
  )
  select
    (date_trunc('day', se.created_at at time zone 'UTC') at time zone 'UTC')::date as day,
    m.id as track_id,
    m.title,
    count(*)::bigint as daily_streams
  from mine m
  join public.stream_events se on se.track_id = m.id
  where se.event_type = 'milestone_30s'
    and se.created_at >= now() - ((select d from bound) || ' days')::interval
  group by 1, 2, 3
  order by 1 desc, 4 desc;
$$;

grant execute on function public.get_artist_daily_streams(int) to authenticated;

-- ----------------------
-- RPC: get_artist_streaming_summary
--   곡별 요약 — 총합 / 오늘 / 7일 / 30일
-- ----------------------
create or replace function public.get_artist_streaming_summary()
returns table(
  track_id uuid,
  title text,
  visibility_status text,
  total_streams bigint,
  today_streams bigint,
  last_7d_streams bigint,
  last_30d_streams bigint,
  last_played_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  with mine as (
    select t.id, t.title, t.visibility_status
    from public.tracks t
    where t.owner_user_id = auth.uid()
  )
  select
    m.id as track_id,
    m.title,
    m.visibility_status,
    count(se.*) filter (where se.event_type = 'milestone_30s')::bigint as total,
    count(se.*) filter (
      where se.event_type = 'milestone_30s'
        and se.created_at >= date_trunc('day', now())
    )::bigint as today,
    count(se.*) filter (
      where se.event_type = 'milestone_30s'
        and se.created_at >= now() - interval '7 days'
    )::bigint as last_7d,
    count(se.*) filter (
      where se.event_type = 'milestone_30s'
        and se.created_at >= now() - interval '30 days'
    )::bigint as last_30d,
    max(se.created_at) filter (where se.event_type = 'milestone_30s') as last_played_at
  from mine m
  left join public.stream_events se on se.track_id = m.id
  group by m.id, m.title, m.visibility_status
  order by total desc, m.title asc;
$$;

grant execute on function public.get_artist_streaming_summary() to authenticated;

-- 확인 — 본인 곡이 있어야 데이터가 보임
select count(*) as my_tracks
from public.tracks
where owner_user_id = auth.uid();
