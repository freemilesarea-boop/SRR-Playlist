-- 차트 장르 집계 기준을 레거시 tracks.genre → tracks.main_genre 로 교체.
-- 배경: 업로드/메타 파이프라인(set_track_selected_metadata)은 genre_tags/main_genre 만 채우고
--       레거시 genre 컬럼은 비워둔다. 차트 RPC가 genre 로 group by 하던 탓에 전 곡이 '기타'로 집계됨.
-- additive: 함수 본문 CREATE OR REPLACE 만. 컬럼/RLS/데이터/정산(stream_events) 무변경, release_status 무변경.
-- fallback: main_genre 가 NULL/빈값일 때만 '기타'.

-- 1) get_genre_chart : 집계 키 main_genre
create or replace function public.get_genre_chart(period text default 'weekly')
returns table(genre text, play_count bigint, track_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with se_agg as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened,
      count(distinct t.id) as tracks
    from public.tracks t
    left join public.stream_events se on se.track_id = t.id and se.created_at >= since and se.event_type in ('milestone_30s','complete')
    where t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  )
  select g, plays, tracks, listened from se_agg where tracks > 0 order by plays desc, g asc;
end; $$;

-- 2) get_track_chart_by_genre : 필터 + 출력 모두 main_genre
create or replace function public.get_track_chart_by_genre(genre_filter text, period text default 'weekly', limit_count integer default 50)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period); g_filter text := nullif(trim(genre_filter), '');
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  ),
  lk as (
    select tpe.track_id,
      greatest(0, count(*) filter (where tpe.event_type='like') - count(*) filter (where tpe.event_type='unlike')) as likes
    from public.track_play_events tpe where tpe.created_at >= since group by tpe.track_id
  )
  select row_number() over (order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.main_genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays,0), coalesce(a.completes,0), coalesce(lk.likes,0), coalesce(a.listened,0)
  from public.tracks t
  left join agg a on a.track_id = t.id
  left join lk on lk.track_id = t.id
  where coalesce(a.plays,0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and ((g_filter = '기타' and (t.main_genre is null or trim(t.main_genre) = ''))
         or (g_filter is not null and t.main_genre = g_filter) or g_filter is null)
  order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $$;

-- 3) get_track_chart : 출력 컬럼만 main_genre (필터/정렬 무변경)
create or replace function public.get_track_chart(period text default 'daily', limit_count integer default 100)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint, playlist_count bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  ),
  lk as (
    select tpe.track_id,
      greatest(0, count(*) filter (where tpe.event_type='like') - count(*) filter (where tpe.event_type='unlike')) as likes
    from public.track_play_events tpe where tpe.created_at >= since group by tpe.track_id
  )
  select row_number() over (order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.main_genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays,0), coalesce(a.completes,0), coalesce(lk.likes,0), coalesce(a.listened,0),
    (select count(*) from public.playlist_tracks pt where pt.track_id = t.id)
  from public.tracks t
  left join agg a on a.track_id = t.id
  left join lk on lk.track_id = t.id
  where coalesce(a.plays,0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
  order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $$;

-- 4) list_genres : 드롭다운 소스 main_genre
create or replace function public.list_genres()
returns table(genre text, track_count bigint, play_count bigint)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with all_genres as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g, count(*) as tc
    from public.tracks t
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  ),
  plays as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g, count(*) as pc
    from public.tracks t
    join public.stream_events se on se.track_id = t.id
    where se.event_type = 'milestone_30s'
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  )
  select ag.g, ag.tc, coalesce(p.pc, 0)
  from all_genres ag left join plays p on p.g = ag.g
  order by coalesce(p.pc, 0) desc, ag.g asc;
end; $$;

grant execute on function public.get_genre_chart(text) to anon, authenticated;
grant execute on function public.get_track_chart_by_genre(text, text, integer) to anon, authenticated;
grant execute on function public.get_track_chart(text, integer) to anon, authenticated;
grant execute on function public.list_genres() to anon, authenticated;
