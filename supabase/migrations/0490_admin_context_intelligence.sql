-- ============================================
-- 0490_admin_context_intelligence.sql
--
-- Phase AI-MUSIC-2 — Context Intelligence Engine.
--
-- 음악 성과를 단일 업종/단일 Track 기준이 아니라 **상황(Context) 조합** 기준으로 학습한다.
-- Context = 지원되는 Dimension 조합(Store Type · Daypart · Weekday Group). 각 Context 에서
-- 어떤 Track/Playlist/Genre/Mood 가 실제 KPI 성과가 좋은지 집계한다.
--
--   Context → Track Performance → Playlist Performance → Context Health → Recommendation → Evidence
--
-- 이 마이그레이션은 **읽기 전용 집계 RPC 만** 추가한다(기존 Playback/Queue/Scheduler/Crossfade/
-- Playlist Generator/Rotation/Track Intelligence/Rollout/Recommendation 무변경). Score/Health/
-- Confidence/Recommendation/Comparison 계산은 프론트 contextIntel.ts(순수 로직·단위 테스트).
--
-- 지원/미지원(실제 DB 재확인, 추측 금지):
--   - 지원(Context Key): Store Type(store_type_slug, 10종) · Daypart(created_at KST) ·
--     Weekday Group(weekday/weekend, KST isodow).
--   - 지원(Context 내 분석): Track · Playlist(playlist_id) · Genre(tracks.main_genre) ·
--     Mood(tracks.mood) · Rollout Stage(track_rollouts).
--   - 미지원: Brand(playback_events_v2.business_id 100% NULL → 재생-브랜드 연결 없음) ·
--     Individual Store(store_id 없음, business_id NULL) · Region(없음) · Weather/Temperature/
--     Humidity(없음) · Holiday/Event(없음) · BPM(tracks.bpm 100% NULL) ·
--     Season(데이터 단일 계절만 존재 → 비교 불가, 범위만 표시).
--
-- 절대 조건: 실제 KPI 만 · 미지원 Dimension 은 Context Key 에서 제외 · 표본 부족은 상위 Context
--   로 fallback(기록) · Score/Health/Confidence/Completion/Skip 0~100 clamp · NaN/Infinity 금지 ·
--   SECURITY DEFINER + search_path 고정 · 관리자 가드 · Dimension whitelist · limit/sample clamp.
-- ============================================

-- 관리자 가드 _admin_growth_guard()(0472) · range/time_band/season 헬퍼(0484) 재사용.

-- Weekday Group 헬퍼(KST isodow → weekday/weekend). 프론트/SQL 동일 정의 유지 위해 SQL 이 산출.
create or replace function public._context_weekday_group(p_isodow int)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_isodow in (6, 7) then 'weekend' else 'weekday' end;
$$;

-- 유효 Daypart band 화이트리스트(_playlist_time_band 결과와 동일 집합). 미지원 값이면 NULL(제외).
create or replace function public._context_norm_daypart(p_band text)
returns text
language sql
immutable
set search_path = public
as $$
  select case when p_band in ('새벽','아침','점심','오후','저녁','심야') then p_band else null end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Context Overview — Level-1(Store Type) Context 목록 + KPI/표본(Explorer 랜딩).
--    미지원 Dimension 은 여기서 조합하지 않는다(Store Type 만 = 안정적 Level 1).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_overview(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_items jsonb;
  v_season_range jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_items
  from (
    select
      e.store_type_slug as store_type,
      count(*) as events,
      count(distinct e.track_id) as track_count,
      count(distinct e.playlist_id) as playlist_count,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds,
      max(e.created_at) as last_event_at
    from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug is not null
    group by e.store_type_slug
  ) t;

  -- 계절 데이터 범위(단일 계절 여부 판정용) — 실제 존재하는 계절/기간만 표시.
  select to_jsonb(s) into v_season_range from (
    select
      count(distinct public._playlist_season(extract(month from (e.created_at at time zone 'Asia/Seoul'))::int)) as distinct_seasons,
      min(e.created_at) as earliest,
      max(e.created_at) as latest
    from public.playback_events_v2 e
    where e.created_at >= v_since
  ) s;

  return jsonb_build_object(
    'range', coalesce(p_range,'30d'),
    'items', v_items,
    'season_range', v_season_range,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_context_overview(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Context Detail — 요청 Grain(Store Type[+Daypart[+Weekday Group]])을 표본 기준으로
--    해석(fallback)하고, 해석된 Context 의 KPI + Track/Playlist/Genre/Mood 랭킹 반환.
--    Baseline(전체 평균)도 함께 반환(비교/추천용). 미지원 Dimension 은 무시.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_detail(
  p_store_type text,
  p_daypart text default null,
  p_weekday_group text default null,
  p_range text default '30d',
  p_min_sample int default 20
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_min int := greatest(1, least(coalesce(p_min_sample, 20), 1000));
  -- 요청 Dimension 정규화(화이트리스트, 미지원/오타 → NULL 로 제외).
  v_req_dp text := public._context_norm_daypart(p_daypart);
  v_req_wg text := case when p_weekday_group in ('weekday','weekend') then p_weekday_group else null end;
  v_c_l1 int; v_c_l2 int; v_c_l3 int;
  v_resolved text; v_use_dp text; v_use_wg text; v_fallback boolean := false;
  v_summary jsonb; v_tracks jsonb; v_playlists jsonb; v_genres jsonb; v_moods jsonb; v_baseline jsonb;
begin
  perform public._admin_growth_guard();

  if p_store_type is null then
    return jsonb_build_object('supported', false, 'reason', 'store_type 필수(Context 최소 Grain)', 'generated_at', now());
  end if;

  -- 후보 Grain 별 표본(이벤트 수) 계산.
  select count(*) into v_c_l1 from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug = p_store_type;

  select count(*) into v_c_l2 from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_req_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_req_dp);

  select count(*) into v_c_l3 from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_req_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_req_dp)
      and (v_req_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_req_wg);

  -- 가장 세분화된 유효 Grain 선택(표본 >= min). 부족하면 상위로 fallback.
  if v_req_dp is not null and v_req_wg is not null and v_c_l3 >= v_min then
    v_resolved := 'L3'; v_use_dp := v_req_dp; v_use_wg := v_req_wg;
  elsif v_req_dp is not null and v_c_l2 >= v_min then
    v_resolved := 'L2'; v_use_dp := v_req_dp; v_use_wg := null;
  else
    v_resolved := 'L1'; v_use_dp := null; v_use_wg := null;
  end if;
  v_fallback := (v_req_dp is not null or v_req_wg is not null)
                and not (v_resolved = 'L3' and v_req_wg is not null)
                and not (v_resolved = 'L2' and v_req_wg is null and v_req_dp is not null);

  -- 해석된 Context KPI 요약.
  select to_jsonb(s) into v_summary from (
    select
      count(*) as events,
      count(distinct e.track_id) as track_count,
      count(distinct e.playlist_id) as playlist_count,
      count(distinct tr.main_genre) as genre_count,
      count(distinct tr.mood) as mood_count,
      count(*) filter (where tr.main_genre is null) as unknown_genre_events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds,
      count(*) filter (where e.event_type='like') as likes,
      count(*) filter (where e.event_type='replay') as replays,
      max(e.created_at) as last_event_at,
      case when max(e.created_at) is not null then round(extract(epoch from (now()-max(e.created_at)))/86400, 1) else null end as days_since_last
    from public.playback_events_v2 e
    left join public.tracks tr on tr.id = e.track_id
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_use_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_dp)
      and (v_use_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_wg)
  ) s;

  -- Track 랭킹(Context 내).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_tracks from (
    select e.track_id, tr.title, tr.artist, tr.main_genre as genre, tr.mood,
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds,
      max(e.created_at) as last_played_at
    from public.playback_events_v2 e
    join public.tracks tr on tr.id = e.track_id
    where e.created_at >= v_since and e.store_type_slug = p_store_type and e.track_id is not null
      and (v_use_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_dp)
      and (v_use_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_wg)
    group by e.track_id, tr.title, tr.artist, tr.main_genre, tr.mood
    order by events desc
    limit 50
  ) t;

  -- Playlist 랭킹(Context 내).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_playlists from (
    select e.playlist_id, p.title,
      count(*) as events,
      count(distinct e.track_id) as unique_track_count,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds
    from public.playback_events_v2 e
    left join public.playlists p on p.id = e.playlist_id
    where e.created_at >= v_since and e.store_type_slug = p_store_type and e.playlist_id is not null
      and (v_use_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_dp)
      and (v_use_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_wg)
    group by e.playlist_id, p.title
    order by events desc
    limit 50
  ) t;

  -- Genre 랭킹(main_genre, null→unknown 분리).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_genres from (
    select coalesce(tr.main_genre, '(unknown)') as key,
      (tr.main_genre is null) as is_unknown,
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate
    from public.playback_events_v2 e
    join public.tracks tr on tr.id = e.track_id
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_use_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_dp)
      and (v_use_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_wg)
    group by tr.main_genre
  ) t;

  -- Mood 랭킹(null→unknown 분리).
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_moods from (
    select coalesce(tr.mood, '(unknown)') as key,
      (tr.mood is null) as is_unknown,
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate
    from public.playback_events_v2 e
    join public.tracks tr on tr.id = e.track_id
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_use_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_dp)
      and (v_use_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_use_wg)
    group by tr.mood
  ) t;

  -- Baseline: 전체 평균(같은 기간) — 비교/추천 기준.
  select to_jsonb(b) into v_baseline from (
    select
      count(*) as events,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds
    from public.playback_events_v2 e
    where e.created_at >= v_since
  ) b;

  return jsonb_build_object(
    'store_type', p_store_type,
    'requested', jsonb_build_object('daypart', v_req_dp, 'weekday_group', v_req_wg),
    'resolved', jsonb_build_object('grain', v_resolved, 'daypart', v_use_dp, 'weekday_group', v_use_wg, 'fallback', v_fallback),
    'candidate_samples', jsonb_build_object('l1', v_c_l1, 'l2', v_c_l2, 'l3', v_c_l3, 'min_sample', v_min),
    'range', coalesce(p_range,'30d'),
    'summary', v_summary,
    'tracks', v_tracks,
    'playlists', v_playlists,
    'genres', v_genres,
    'moods', v_moods,
    'baseline', v_baseline,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_context_detail(text, text, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Context Trend — 해석 없이 요청 Grain 그대로(유효 Dimension 만)의 기간별 추이 시계열.
--    bucket: 7d/30d→일, 90d→주, 12m→월. 각 bucket 의 events/completion/skip/avg_listen/
--    track_count/playlist_count. 최소 데이터 포인트는 프론트에서 판정.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_context_trend(
  p_store_type text,
  p_daypart text default null,
  p_weekday_group text default null,
  p_range text default '90d'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_req_dp text := public._context_norm_daypart(p_daypart);
  v_req_wg text := case when p_weekday_group in ('weekday','weekend') then p_weekday_group else null end;
  v_bucket text := case coalesce(p_range,'90d') when '7d' then 'day' when '30d' then 'day' when '90d' then 'week' else 'month' end;
  v_series jsonb;
begin
  perform public._admin_growth_guard();

  if p_store_type is null then
    return jsonb_build_object('supported', false, 'reason', 'store_type 필수', 'generated_at', now());
  end if;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.bucket_start), '[]'::jsonb) into v_series from (
    select
      date_trunc(v_bucket, (e.created_at at time zone 'Asia/Seoul')) as bucket_start,
      count(*) as events,
      count(distinct e.track_id) as track_count,
      count(distinct e.playlist_id) as playlist_count,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round(avg(e.listened_seconds)::numeric, 1) as avg_listen_seconds
    from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug = p_store_type
      and (v_req_dp is null or public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) = v_req_dp)
      and (v_req_wg is null or public._context_weekday_group(extract(isodow from (e.created_at at time zone 'Asia/Seoul'))::int) = v_req_wg)
    group by bucket_start
  ) t;

  return jsonb_build_object(
    'store_type', p_store_type,
    'daypart', v_req_dp,
    'weekday_group', v_req_wg,
    'range', coalesce(p_range,'90d'),
    'bucket', v_bucket,
    'series', v_series,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_context_trend(text, text, text, text) to authenticated;
