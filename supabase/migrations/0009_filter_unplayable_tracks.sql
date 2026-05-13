-- ============================================
-- 0009_filter_unplayable_tracks.sql
--
-- 추천/차트 RPC 가 audio_url 이 null/빈문자열인 트랙을 반환하지 않도록
-- 가드 추가. 클라이언트 무한 next() 캐스케이드 차단을 위한 server-side
-- 1차 방어선.
--
-- 변경 RPC:
--   - public.recommend_tracks_by_context  (0008)
--   - public.recommend_similar_tracks     (0008)
--   - public.get_track_chart              (0003)
--   - public.get_track_chart_by_genre     (0003)
--
-- 모두 CREATE OR REPLACE 이므로 멱등. 반복 실행 안전.
-- ============================================

-- ----------------------
-- 1) recommend_tracks_by_context
-- ----------------------
create or replace function public.recommend_tracks_by_context(
  p_time_slot text default null,
  p_situation text default null,
  p_business_type text default null,
  p_mood text default null,
  p_limit int default 20
)
returns table(
  track_id uuid,
  title text,
  artist text,
  genre text,
  main_genre text,
  sub_genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  score int,
  score_reasons text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then 15 else 0 end), 0) +
        coalesce((case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then 20 else 0 end), 0) +
        coalesce((case when p_mood is not null and lower(coalesce(t.mood, '')) = lower(p_mood) then 10 else 0 end), 0) +
        coalesce((case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then 10 else 0 end), 0) +
        coalesce(t.recommendation_priority, 0)
      ) as s,
      array_remove(array[
        case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then format('+15 %s 시간대', p_time_slot) end,
        case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then format('+25 %s 상황', p_situation) end,
        case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then format('+25 %s 업종', p_business_type) end,
        case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then format('+20 %s 무드', p_mood) end,
        case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then '+10 매장 적합 보컬' end,
        case when coalesce(t.recommendation_priority, 0) > 0 then format('+%s 우선순위', t.recommendation_priority) end
      ], null) as reasons
    from public.tracks t
    where coalesce(t.is_recommendable, true) = true
      and coalesce(t.visibility, 'public') <> 'private'
      and t.audio_url is not null
      and length(btrim(t.audio_url)) > 0
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.sub_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int as score,
    s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_tracks_by_context(text, text, text, text, int) to anon, authenticated;

-- ----------------------
-- 2) recommend_similar_tracks
-- ----------------------
create or replace function public.recommend_similar_tracks(
  p_track_id uuid,
  p_limit int default 20
)
returns table(
  track_id uuid,
  title text,
  artist text,
  genre text,
  main_genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  score int,
  score_reasons text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
begin
  select * into src from public.tracks where id = p_track_id;
  if src.id is null then return; end if;

  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when t.main_genre is not null and t.main_genre = src.main_genre then 20 else 0 end), 0) +
        coalesce((case when t.sub_genre is not null and t.sub_genre = src.sub_genre then 15 else 0 end), 0) +
        coalesce(
          (case when array_length(t.mood_tags, 1) > 0 and array_length(src.mood_tags, 1) > 0
            then array_length(array(select unnest(t.mood_tags) intersect select unnest(src.mood_tags)), 1) * 7
            else 0 end), 0) +
        coalesce(
          (case when array_length(t.situation_tags, 1) > 0 and array_length(src.situation_tags, 1) > 0
            then array_length(array(select unnest(t.situation_tags) intersect select unnest(src.situation_tags)), 1) * 5
            else 0 end), 0) +
        coalesce(
          (case when t.bpm is not null and src.bpm is not null
            then greatest(0, 10 - abs(t.bpm - src.bpm) / 4)
            else 0 end), 0) +
        coalesce(
          (case when t.energy_level is not null and src.energy_level is not null
            then greatest(0, 10 - abs(t.energy_level - src.energy_level) * 2)
            else 0 end), 0) +
        coalesce(
          (case when t.lyric_type is not null and t.lyric_type = src.lyric_type then 10 else 0 end), 0) +
        coalesce(
          (case when t.brightness_level is not null and src.brightness_level is not null
            then greatest(0, 5 - abs(t.brightness_level - src.brightness_level)) else 0 end), 0) +
        coalesce(
          (case when t.emotional_intensity is not null and src.emotional_intensity is not null
            then greatest(0, 5 - abs(t.emotional_intensity - src.emotional_intensity)) else 0 end), 0)
      ) as s,
      array_remove(array[
        case when t.main_genre = src.main_genre then '+20 같은 메인 장르' end,
        case when t.sub_genre = src.sub_genre then '+15 같은 서브 장르' end,
        case when t.lyric_type = src.lyric_type then '+10 같은 가사 유형' end
      ], null) as reasons
    from public.tracks t
    where t.id <> p_track_id
      and coalesce(t.is_recommendable, true) = true
      and coalesce(t.visibility, 'public') <> 'private'
      and t.audio_url is not null
      and length(btrim(t.audio_url)) > 0
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int, s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_similar_tracks(uuid, int) to anon, authenticated;

-- ----------------------
-- 3) get_track_chart
-- ----------------------
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
    and t.audio_url is not null
    and length(btrim(t.audio_url)) > 0
  order by play_count desc, t.created_at desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.get_track_chart(text, int) to anon, authenticated;

-- ----------------------
-- 4) get_track_chart_by_genre
-- ----------------------
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
    and t.audio_url is not null
    and length(btrim(t.audio_url)) > 0
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
