-- ============================================
-- 0489_admin_track_intelligence.sql
--
-- Phase AI-MUSIC-1 — Track Intelligence & Lifecycle Engine.
--
-- Playlist 중심이 아니라 **Track 중심**으로 성과를 학습한다. Track → Playlist → Industry
-- → Brand → Store Type → Daypart → Season → Lifecycle → Health → Recommendation 구조.
--
-- 이 마이그레이션은 **읽기 전용 집계 RPC만** 추가한다(기존 Playback/Queue/Scheduler/
-- Generator/Rotation/Rollout/Recommendation 무변경). Health/Lifecycle/Trend/Recommendation
-- 계산은 프론트 trackIntel.ts(순수 로직). AI 가 존재하지 않는 메타데이터를 만들지 않는다.
--
-- 원천: playback_events_v2(track_id·event_type·listened·duration·store_type_slug·playlist_id·
--   created_at) + tracks(메타) + track_rollouts(stage). Brand 컬럼 부재 → Brand Intelligence
--   미지원(store_type proxy). key/vocal/explicit/energy/weather/event 미지원.
--
-- 절대 조건: 실제 KPI 만 · 점수 clamp · NaN/Infinity 금지 · SECURITY DEFINER+search_path 고정.
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용. range/band/season 헬퍼는 0484 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Track Intelligence 목록 — per-track 요약 KPI + 재생 윈도우(Overview/Health/Lifecycle).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_intel_list(p_range text default '90d', p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc, t.title), '[]'::jsonb) into v_result
  from (
    select tr.id as track_id, tr.title, tr.artist, tr.main_genre, tr.mood, tr.bpm, tr.duration,
      k.events, k.skip_rate, k.completion_rate, coalesce(k.likes,0) as likes, coalesce(k.replays,0) as replays,
      k.p7d, k.p30d, k.p90d, k.uniq_playlists, k.uniq_store_types, k.last_played_at,
      case when k.last_played_at is not null then round(extract(epoch from (now()-k.last_played_at))/86400,1) else null end as days_since_last_play,
      ro.stage as rollout_stage
    from public.tracks tr
    join (
      select e.track_id,
        count(*) as events,
        round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate,
        round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
        count(*) filter (where e.event_type='like') as likes,
        count(*) filter (where e.event_type='replay') as replays,
        count(*) filter (where e.created_at >= now()-interval '7 days') as p7d,
        count(*) filter (where e.created_at >= now()-interval '30 days') as p30d,
        count(*) filter (where e.created_at >= now()-interval '90 days') as p90d,
        count(distinct e.playlist_id) as uniq_playlists,
        count(distinct e.store_type_slug) as uniq_store_types,
        max(e.created_at) as last_played_at
      from public.playback_events_v2 e
      where e.created_at >= v_since and e.track_id is not null
      group by e.track_id
    ) k on k.track_id = tr.id
    left join public.track_rollouts ro on ro.track_id = tr.id
    order by k.events desc, tr.title
    limit v_limit
  ) t;

  return jsonb_build_object('range', coalesce(p_range,'90d'), 'items', v_result, 'generated_at', now());
end;
$$;

grant execute on function public.admin_track_intel_list(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Track Intelligence 상세 — 단일 Track 의 Industry/Daypart/Season/Playlist 분해(Graph).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_track_intel_detail(p_track_id uuid, p_range text default '90d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._playlist_range_interval(p_range);
  v_industry jsonb; v_daypart jsonb; v_season jsonb; v_playlist jsonb; v_summary jsonb;
begin
  perform public._admin_growth_guard();

  -- 요약
  select to_jsonb(s) into v_summary from (
    select p_track_id as track_id, tr.title, tr.artist, tr.main_genre, tr.mood, tr.bpm, tr.duration, ro.stage as rollout_stage,
      count(*) as events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric, 1) as completion_rate,
      round(100.0 * count(*) filter (where e.event_type='skip') / nullif(count(*),0), 1) as skip_rate
    from public.playback_events_v2 e
    join public.tracks tr on tr.id = p_track_id
    left join public.track_rollouts ro on ro.track_id = p_track_id
    where e.track_id = p_track_id and e.created_at >= v_since
    group by tr.title, tr.artist, tr.main_genre, tr.mood, tr.bpm, tr.duration, ro.stage
  ) s;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_industry from (
    select e.store_type_slug as key, count(*) events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) skip_rate
    from public.playback_events_v2 e where e.track_id = p_track_id and e.created_at >= v_since and e.store_type_slug is not null
    group by e.store_type_slug
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.band_order), '[]'::jsonb) into v_daypart from (
    select public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int) as key,
      min(case public._playlist_time_band(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int)
        when '새벽' then 0 when '아침' then 1 when '점심' then 2 when '오후' then 3 when '저녁' then 4 else 5 end) as band_order,
      count(*) events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) skip_rate
    from public.playback_events_v2 e where e.track_id = p_track_id and e.created_at >= v_since
    group by key
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_season from (
    select public._playlist_season(extract(month from (e.created_at at time zone 'Asia/Seoul'))::int) as key, count(*) events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) skip_rate
    from public.playback_events_v2 e where e.track_id = p_track_id and e.created_at >= v_since
    group by key
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_playlist from (
    select p.title as key, count(*) events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) skip_rate
    from public.playback_events_v2 e left join public.playlists p on p.id = e.playlist_id
    where e.track_id = p_track_id and e.created_at >= v_since and e.playlist_id is not null
    group by p.title
  ) t;

  return jsonb_build_object(
    'track_id', p_track_id, 'range', coalesce(p_range,'90d'), 'summary', v_summary,
    'by_industry', v_industry, 'by_daypart', v_daypart, 'by_season', v_season, 'by_playlist', v_playlist,
    'brand_supported', false,   -- Brand 컬럼 부재 → store_type proxy
    'generated_at', now()
  );
end;
$$;

grant execute on function public.admin_track_intel_detail(uuid, text) to authenticated;
