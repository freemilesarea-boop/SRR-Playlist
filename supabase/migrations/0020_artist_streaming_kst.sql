-- ============================================
-- 0020_artist_streaming_kst.sql
--
-- 아티스트 스트리밍 분석 RPC 의 일자/오늘 집계를 한국시간(Asia/Seoul) 기준으로 변경.
-- (이전 0019 는 UTC 기준)
--
-- 변경 사항:
--   1) get_artist_daily_streams 의 day 필드 →
--      (created_at AT TIME ZONE 'Asia/Seoul')::date
--   2) get_artist_streaming_summary 의 today/7d/30d 경계 →
--      KST 자정 (date_trunc('day', now() AT TIME ZONE 'Asia/Seoul') AT TIME ZONE 'Asia/Seoul')
--      · today = KST 오늘 자정 이후
--      · last_7d = KST 6일 전 자정 이후 (오늘 포함 7일)
--      · last_30d = KST 29일 전 자정 이후 (오늘 포함 30일)
--   3) total / last_played_at 는 변경 없음 (시점 무관)
--
-- 멱등 (CREATE OR REPLACE).
-- ============================================

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
    -- KST 기준 일자
    (se.created_at at time zone 'Asia/Seoul')::date as day,
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
  with kst_bounds as (
    -- KST 오늘 자정의 timestamptz (UTC 인스턴트)
    select
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')                       as today_start,
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '6 days'   as d7_start,
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '29 days'  as d30_start
  ),
  mine as (
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
        and se.created_at >= (select today_start from kst_bounds)
    )::bigint as today,
    count(se.*) filter (
      where se.event_type = 'milestone_30s'
        and se.created_at >= (select d7_start from kst_bounds)
    )::bigint as last_7d,
    count(se.*) filter (
      where se.event_type = 'milestone_30s'
        and se.created_at >= (select d30_start from kst_bounds)
    )::bigint as last_30d,
    max(se.created_at) filter (where se.event_type = 'milestone_30s') as last_played_at
  from mine m
  left join public.stream_events se on se.track_id = m.id
  group by m.id, m.title, m.visibility_status
  order by total desc, m.title asc;
$$;

grant execute on function public.get_artist_streaming_summary() to authenticated;

-- 확인: KST 경계 timestamptz 출력 (디버그용)
select
  now() as utc_now,
  (now() at time zone 'Asia/Seoul')::timestamp as kst_clock,
  (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') as kst_today_start_utc;
