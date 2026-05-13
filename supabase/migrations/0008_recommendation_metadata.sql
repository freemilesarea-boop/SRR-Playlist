-- ============================================
-- 0008_recommendation_metadata.sql
-- 트랙 메타데이터 확장 + 룰 기반 추천 RPC
-- ============================================

-- ============================================
-- tracks 테이블 컬럼 확장
-- ============================================
alter table public.tracks
  add column if not exists main_genre text,
  add column if not exists sub_genre text,
  add column if not exists language text,
  add column if not exists lyric_type text,
  add column if not exists bpm int,
  add column if not exists energy_level int check (energy_level between 1 and 5),
  add column if not exists brightness_level int check (brightness_level between 1 and 5),
  add column if not exists emotional_intensity int check (emotional_intensity between 1 and 5),
  add column if not exists vocal_presence int check (vocal_presence between 1 and 5),
  add column if not exists mood_tags text[] default '{}',
  add column if not exists situation_tags text[] default '{}',
  add column if not exists time_slots text[] default '{}',
  add column if not exists season_tags text[] default '{}',
  add column if not exists business_tags text[] default '{}',
  add column if not exists visibility text default 'public',
  add column if not exists recommendation_priority int default 0,
  add column if not exists copyright_status text default 'unknown',
  add column if not exists is_recommendable boolean default true;

-- 인덱스 (GIN — 배열 검색용)
create index if not exists idx_tracks_main_genre on public.tracks(main_genre);
create index if not exists idx_tracks_mood_tags on public.tracks using gin(mood_tags);
create index if not exists idx_tracks_situation_tags on public.tracks using gin(situation_tags);
create index if not exists idx_tracks_time_slots on public.tracks using gin(time_slots);
create index if not exists idx_tracks_business_tags on public.tracks using gin(business_tags);
create index if not exists idx_tracks_recommendable on public.tracks(is_recommendable, visibility);

-- ============================================
-- RPC 1: 컨텍스트 기반 트랙 추천
-- ============================================
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

-- ============================================
-- RPC 2: 유사 트랙 추천
-- ============================================
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

-- ============================================
-- RPC 3: 컨텍스트 기반 플리 추천
-- (플리 안 트랙들의 평균 컨텍스트 점수)
-- ============================================
create or replace function public.recommend_playlists_by_context(
  p_time_slot text default null,
  p_situation text default null,
  p_business_type text default null,
  p_limit int default 10
)
returns table(
  playlist_id uuid,
  title text,
  category text,
  thumbnail_url text,
  description text,
  is_business_only boolean,
  time_slot text,
  score numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with track_scores as (
    select
      pt.playlist_id,
      avg(
        case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then 15 else 0 end
        + case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then 25 else 0 end
        + case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then 25 else 0 end
        + coalesce(t.recommendation_priority, 0)
      ) as avg_s
    from public.playlist_tracks pt
    join public.tracks t on t.id = pt.track_id
    where coalesce(t.is_recommendable, true) = true
    group by pt.playlist_id
  )
  select
    p.id, p.title, p.category, p.thumbnail_url, p.description, p.is_business_only, p.time_slot,
    coalesce(ts.avg_s, 0)::numeric as score
  from public.playlists p
  left join track_scores ts on ts.playlist_id = p.id
  -- time_slot 컬럼도 보너스
  order by (
    coalesce(ts.avg_s, 0)
    + case when p_time_slot is not null and p.time_slot = p_time_slot then 10 else 0 end
    + case when p_business_type is not null and (p.business_category = p_business_type or p.is_business_only) then 5 else 0 end
  ) desc, p.sort_order asc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_playlists_by_context(text, text, text, int) to anon, authenticated;
