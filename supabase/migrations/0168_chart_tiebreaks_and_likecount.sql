-- 0168 — 차트 순위: tie-break(play→complete→like→created) + like_count. stream_events 읽기만(미변경).
drop function if exists public.get_track_chart(text, integer);
create function public.get_track_chart(period text default 'daily', limit_count integer default 100)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint, playlist_count bigint)
language plpgsql security definer set search_path to 'public' as $function$
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
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
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
end; $function$;
grant execute on function public.get_track_chart(text, integer) to anon, authenticated;

drop function if exists public.get_track_chart_by_genre(text, text, integer);
create function public.get_track_chart_by_genre(genre_filter text, period text default 'weekly', limit_count integer default 50)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $function$
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
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
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
    and ((g_filter = '기타' and (t.genre is null or trim(t.genre) = ''))
         or (g_filter is not null and t.genre = g_filter) or g_filter is null)
  order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $function$;
grant execute on function public.get_track_chart_by_genre(text, text, integer) to anon, authenticated;
