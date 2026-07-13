-- ============================================
-- 0484_admin_playlist_intelligence.sql
--
-- Phase AI-PLAYLIST-1 — Adaptive Playlist Intelligence Engine.
--
-- "성과가 좋은(실제 KPI 기준) Playlist" 를 추천하기 위한 **읽기 전용 성과 집계** +
-- 추천/학습 기록만 추가한다. 기존 Playback/Scheduler/Queue/Playlist 구조/Store Policy/
-- AI Recommendation 은 **변경하지 않는다**(재사용·읽기만).
--
-- 성과 원천: public.playback_events_v2 (playlist_id·track_id·event_type·listened_seconds·
--   track_duration_seconds·store_type_slug·created_at). 이벤트 기반이므로 KPI 는
--   "추적된 재생 이벤트" 기준이다(전수 재생 아님 — 프론트에서 명시).
--
-- 지원/미지원(실제 데이터 기준, 추측 금지):
--   - 지원: Playlist KPI(이벤트·Skip율·Completion·Like/Replay·Unique) · Industry(store_type)
--     · Time(시간대) · Season(월→계절) · Rankings.
--   - 미지원: 개별 Store 단위(playback_events_v2 에 store_id 없음 → store_type 만) ·
--     Weather(날씨 데이터 없음) · Event/Holiday 성과(이벤트 성과 데이터 없음).
--
-- 절대 조건: Evidence 없는 추천 저장 금지 / 자동 Playlist 교체 없음(Learning 기록만) /
--   점수·비율 clamp(0~100) / NaN·Infinity 금지 / SECURITY DEFINER+search_path 고정.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- range → interval 헬퍼(화이트리스트).
create or replace function public._playlist_range_interval(p_range text)
returns interval
language sql
immutable
set search_path = public
as $$
  select case coalesce(p_range,'30d')
    when '7d' then interval '7 days'
    when '30d' then interval '30 days'
    when '90d' then interval '90 days'
    when '12m' then interval '365 days'
    else interval '30 days'
  end;
$$;

-- 시간대 band(KST hour) 헬퍼.
create or replace function public._playlist_time_band(p_hour int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_hour between 0 and 5 then '새벽'
    when p_hour between 6 and 10 then '아침'
    when p_hour between 11 and 13 then '점심'
    when p_hour between 14 and 17 then '오후'
    when p_hour between 18 and 21 then '저녁'
    else '심야'
  end;
$$;

-- 계절 헬퍼(월→계절).
create or replace function public._playlist_season(p_month int)
returns text
language sql
immutable
set search_path = public
as $$
  select case
    when p_month in (3,4,5) then '봄'
    when p_month in (6,7,8) then '여름'
    when p_month in (9,10,11) then '가을'
    else '겨울'
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Playlist Intelligence — playlist/industry/time/season 집계(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_intelligence(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_int interval := public._playlist_range_interval(p_range);
  v_since timestamptz := now() - v_int;
  v_playlists jsonb; v_industries jsonb; v_time jsonb; v_season jsonb;
begin
  perform public._admin_growth_guard();

  -- Playlist 별 KPI
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_playlists
  from (
    select e.playlist_id, p.title as playlist_title,
      count(*) as events,
      count(*) filter (where e.event_type = 'skip') as skips,
      round(100.0 * count(*) filter (where e.event_type = 'skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds / e.track_duration_seconds) end) * 100)::numeric, 1) as completion_rate,
      count(*) filter (where e.event_type = 'like') as likes,
      count(*) filter (where e.event_type = 'replay') as replays,
      count(distinct e.track_id) as unique_tracks,
      count(distinct e.store_type_slug) as store_type_count,
      max(e.created_at) as last_event_at
    from public.playback_events_v2 e
    left join public.playlists p on p.id = e.playlist_id
    where e.created_at >= v_since and e.playlist_id is not null
    group by e.playlist_id, p.title
  ) t;

  -- Industry(store_type) 별 집계
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_industries
  from (
    select e.store_type_slug,
      count(*) as events,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds / e.track_duration_seconds) end) * 100)::numeric, 1) as completion_rate,
      count(distinct e.playlist_id) as playlist_count,
      count(distinct e.track_id) as unique_tracks
    from public.playback_events_v2 e
    where e.created_at >= v_since and e.store_type_slug is not null
    group by e.store_type_slug
  ) t;

  -- Time band 별 집계
  select coalesce(jsonb_agg(to_jsonb(t) order by t.band_order), '[]'::jsonb) into v_time
  from (
    select public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) as band,
      min(case public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int)
        when '새벽' then 0 when '아침' then 1 when '점심' then 2 when '오후' then 3 when '저녁' then 4 else 5 end) as band_order,
      count(*) as events,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds / e.track_duration_seconds) end) * 100)::numeric, 1) as completion_rate
    from public.playback_events_v2 e
    where e.created_at >= v_since
    group by band
  ) t;

  -- Season 별 집계
  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_season
  from (
    select public._playlist_season(extract(month from (e.created_at at time zone 'Asia/Seoul'))::int) as season,
      count(*) as events,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
      round((avg(case when e.track_duration_seconds > 0 then least(1, e.listened_seconds / e.track_duration_seconds) end) * 100)::numeric, 1) as completion_rate
    from public.playback_events_v2 e
    where e.created_at >= v_since
    group by season
  ) t;

  return jsonb_build_object(
    'range', coalesce(p_range,'30d'),
    'playlists', v_playlists, 'industries', v_industries, 'time_bands', v_time, 'seasons', v_season,
    'weather_supported', false, 'event_supported', false, 'store_level_supported', false,
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_playlist_intelligence(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Playlist Rankings — 성과 기준 상위/성장(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_playlist_rankings(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_int interval := public._playlist_range_interval(p_range);
  v_since timestamptz := now() - v_int;
  v_half timestamptz := now() - (v_int / 2);
  v_top jsonb; v_lowskip jsonb; v_growth jsonb;
begin
  perform public._admin_growth_guard();

  -- 완주율 상위(최소 이벤트 20 이상만 신뢰)
  select coalesce(jsonb_agg(to_jsonb(t) order by t.completion_rate desc nulls last), '[]'::jsonb) into v_top
  from (
    select p.title as playlist_title, count(*) as events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as completion_rate
    from public.playback_events_v2 e left join public.playlists p on p.id=e.playlist_id
    where e.created_at >= v_since and e.playlist_id is not null
    group by p.title having count(*) >= 20
    order by completion_rate desc nulls last limit 10
  ) t;

  -- Skip 낮은 순(안정)
  select coalesce(jsonb_agg(to_jsonb(t) order by t.skip_rate asc), '[]'::jsonb) into v_lowskip
  from (
    select p.title as playlist_title, count(*) as events,
      round(100.0 * count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) as skip_rate
    from public.playback_events_v2 e left join public.playlists p on p.id=e.playlist_id
    where e.created_at >= v_since and e.playlist_id is not null
    group by p.title having count(*) >= 20
    order by skip_rate asc limit 10
  ) t;

  -- 성장(후반 이벤트/전반 이벤트 비율)
  select coalesce(jsonb_agg(to_jsonb(t) order by t.growth_rate desc nulls last), '[]'::jsonb) into v_growth
  from (
    select p.title as playlist_title,
      count(*) filter (where e.created_at >= v_half) as recent_events,
      count(*) filter (where e.created_at < v_half) as prior_events,
      case when count(*) filter (where e.created_at < v_half) > 0
        then round(100.0 * (count(*) filter (where e.created_at >= v_half) - count(*) filter (where e.created_at < v_half))
             / count(*) filter (where e.created_at < v_half), 1)
        else null end as growth_rate
    from public.playback_events_v2 e left join public.playlists p on p.id=e.playlist_id
    where e.created_at >= v_since and e.playlist_id is not null
    group by p.title having count(*) >= 20
    order by growth_rate desc nulls last limit 10
  ) t;

  return jsonb_build_object('top_completion', v_top, 'lowest_skip', v_lowskip, 'top_growth', v_growth, 'range', coalesce(p_range,'30d'), 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_rankings(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Playlist 추천/학습 기록(신규). Evidence 필수. 자동 교체 없음(기록만).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.playlist_reco_history (
  id                    uuid primary key default gen_random_uuid(),
  rule_key              text not null,
  store_type_slug       text,
  time_band             text,
  target_playlist_title text,             -- 현재/대상 Playlist
  recommended_title     text,             -- 추천 Playlist
  reason                text,
  evidence              jsonb not null,   -- 근거 KPI(필수)
  state                 text not null default 'suggested' check (state in ('suggested','applied','dismissed')),
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.playlist_reco_history is
  'AI-PLAYLIST-1 — Playlist 추천/적용/기각 기록. 자동 교체 없음(Learning 기록만). Evidence 필수.';

create index if not exists idx_playlist_reco_created on public.playlist_reco_history (created_at desc);
create index if not exists idx_playlist_reco_rule on public.playlist_reco_history (rule_key);

create or replace function public.admin_playlist_reco_save(
  p_rule_key text, p_evidence jsonb,
  p_store_type_slug text default null, p_time_band text default null,
  p_target_title text default null, p_recommended_title text default null,
  p_reason text default null, p_state text default 'suggested'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform public._admin_growth_guard();

  if coalesce(p_rule_key,'') = '' then
    raise exception 'rule_key required' using errcode = '22023';
  end if;
  if p_state not in ('suggested','applied','dismissed') then
    raise exception 'invalid state: %', p_state using errcode = '22023';
  end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then
    raise exception 'evidence required (근거 없는 추천 저장 금지)' using errcode = '22023';
  end if;

  insert into public.playlist_reco_history(rule_key, store_type_slug, time_band, target_playlist_title, recommended_title, reason, evidence, state, created_by)
  values (p_rule_key, nullif(p_store_type_slug,''), nullif(p_time_band,''), nullif(p_target_title,''), nullif(p_recommended_title,''), p_reason, p_evidence, p_state, auth.uid())
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'state', p_state);
end;
$$;

grant execute on function public.admin_playlist_reco_save(text, jsonb, text, text, text, text, text, text) to authenticated;

create or replace function public.admin_playlist_history(p_limit int default 50)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 50), 200));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_result
  from (
    select h.id, h.rule_key, h.store_type_slug, h.time_band, h.target_playlist_title, h.recommended_title,
           h.reason, h.evidence, h.state, h.created_at, u.nickname as created_by_name
    from public.playlist_reco_history h
    left join public.users u on u.id = h.created_by
    order by h.created_at desc limit v_limit
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_history(int) to authenticated;

-- Learning Signal 집계(참고용; 자동 가중치/교체 없음).
create or replace function public.admin_playlist_learning()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.total desc), '[]'::jsonb) into v_result
  from (
    select h.rule_key,
      count(*) as total,
      count(*) filter (where h.state='applied') as applied,
      count(*) filter (where h.state='dismissed') as dismissed,
      count(*) filter (where h.state='suggested') as suggested,
      case when count(*) filter (where h.state in ('applied','dismissed')) > 0
        then round(100.0 * count(*) filter (where h.state='applied')
             / count(*) filter (where h.state in ('applied','dismissed')), 1)
        else null end as apply_rate,
      max(h.created_at) as last_at
    from public.playlist_reco_history h
    group by h.rule_key
  ) t;

  return jsonb_build_object('items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_playlist_learning() to authenticated;
