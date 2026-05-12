-- ============================================
-- 0003_charts.sql
-- 차트(일간/주간/월간/Top100/장르별) RPC
-- 일반 사용자도 호출 가능 (집계만 반환, 개인정보 없음)
-- ============================================

-- 기간 → 시작 시각 변환 헬퍼
create or replace function public._chart_period_start(period text)
returns timestamptz
language plpgsql
immutable
as $$
declare
  kst_now timestamptz := now() at time zone 'Asia/Seoul';
begin
  case lower(period)
    when 'daily'   then return (date_trunc('day',   kst_now) at time zone 'Asia/Seoul');
    when 'weekly'  then return (now() - interval '7 days');
    when 'monthly' then return (now() - interval '30 days');
    when 'all'     then return timestamp '1970-01-01';
    else                return (date_trunc('day', kst_now) at time zone 'Asia/Seoul');
  end case;
end;
$$;

-- ============================================
-- 1) 트랙 차트 — 기간/Top N
-- ============================================
create or replace function public.get_track_chart(
  period text default 'daily',
  limit_count int default 100
)
returns table(
  rank bigint,
  track_id uuid,
  title text,
  artist text,
  genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  play_count bigint,
  completed_count bigint,
  total_listened_seconds bigint,
  playlist_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
begin
  return query
  with agg as (
    select
      se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since
      and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select
    row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id as track_id,
    t.title,
    t.artist,
    t.genre,
    t.mood,
    t.cover_url,
    t.audio_url,
    t.duration,
    coalesce(a.plays, 0) as play_count,
    coalesce(a.completes, 0) as completed_count,
    coalesce(a.listened, 0) as total_listened_seconds,
    (select count(*) from public.playlist_tracks pt where pt.track_id = t.id) as playlist_count
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
  order by play_count desc, t.created_at desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.get_track_chart(text, int) to anon, authenticated;

-- ============================================
-- 2) 장르 차트 — 장르별 총 재생수
-- ============================================
create or replace function public.get_genre_chart(
  period text default 'weekly'
)
returns table(
  genre text,
  play_count bigint,
  track_count bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
begin
  return query
  with se_agg as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened,
      count(distinct t.id) as tracks
    from public.tracks t
    left join public.stream_events se
      on se.track_id = t.id
     and se.created_at >= since
     and se.event_type in ('milestone_30s','complete')
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select g, plays, tracks, listened
  from se_agg
  where tracks > 0
  order by plays desc, g asc;
end;
$$;

grant execute on function public.get_genre_chart(text) to anon, authenticated;

-- ============================================
-- 3) 장르별 트랙 차트
-- ============================================
create or replace function public.get_track_chart_by_genre(
  genre_filter text,
  period text default 'weekly',
  limit_count int default 50
)
returns table(
  rank bigint,
  track_id uuid,
  title text,
  artist text,
  genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  play_count bigint,
  completed_count bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
  g_filter text := nullif(trim(genre_filter), '');
begin
  return query
  with agg as (
    select
      se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since
      and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select
    row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays, 0),
    coalesce(a.completes, 0),
    coalesce(a.listened, 0)
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
    and (
      (g_filter = '기타' and (t.genre is null or trim(t.genre) = ''))
      or (g_filter is not null and t.genre = g_filter)
      or g_filter is null
    )
  order by coalesce(a.plays, 0) desc, t.created_at desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.get_track_chart_by_genre(text, text, int) to anon, authenticated;

-- ============================================
-- 4) 사용 가능한 장르 목록 (재생 많은 순)
-- ============================================
create or replace function public.list_genres()
returns table(
  genre text,
  track_count bigint,
  play_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with all_genres as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) as tc
    from public.tracks t
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  ),
  plays as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) as pc
    from public.tracks t
    join public.stream_events se on se.track_id = t.id
    where se.event_type = 'milestone_30s'
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select ag.g, ag.tc, coalesce(p.pc, 0)
  from all_genres ag
  left join plays p on p.g = ag.g
  order by coalesce(p.pc, 0) desc, ag.g asc;
end;
$$;

grant execute on function public.list_genres() to anon, authenticated;
