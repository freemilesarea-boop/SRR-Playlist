-- ============================================
-- 0477_admin_streaming_intel.sql
--
-- Phase ADMIN-STREAMING-1 — Streaming Intelligence Dashboard.
--
-- 핵심 원칙: 기존 Observability(Store Monitoring 0353 · Now Playing 0356/0376 ·
-- NOC/Fleet 0385 · Enterprise Ops 0395 · Streaming v2 0412/0413 · Playback Events
-- v2 0253)를 **재사용**한다. Streaming/Playback/Fleet/Store/Player Health · Heartbeat
-- · Incident · Recovery · Quality Score 계산을 **새로 만들지 않는다**(중복 구현 금지).
--
-- 프론트는 아래 기존 RPC 를 그대로 호출한다(프로덕션 존재 확인):
--   admin_noc_kpi() · admin_noc_store_health_list(...) · _noc_store_health_score(store)
--   admin_now_playing_kpi() · admin_store_monitoring_kpi()
--   admin_stream_v2_health(scope,id,days) · admin_stream_v2_overview(days,...)
--   admin_recent_player_errors(days,limit) · admin_list_event_quality_issues(days,limit)
--   admin_enterprise_ops_overview()
--
-- 이 마이그레이션은 기존 RPC 가 다루지 않는 **부족한 부분만** 신규로 추가한다:
--   (A) 전역 재생 스냅샷(admin 관점 playback KPI) + 데이터 지원 매트릭스
--   (B) 재생 시계열(playback timeline) — 기존에 admin 전역 시계열 RPC 없음
-- 기존 RPC 는 무변경. 읽기 전용. 스트리밍/재생/큐 로직 변경 없음.
--
-- ── 텔레메트리 실측 (프로덕션 read-only) ──────────────────────────────────
--   playback_events_v2: event_type(play_start 945·play_complete 713·skip 61·play_25/50/75
--     ·volume_low·replay·muted·player_error) · listened_seconds · completion_percent
--     · device_type(3종) · browser(chrome/safari) · os · business_id(전부 null).
--   stream_events: start/milestone_30s/complete · listened_seconds.
--   stream_ingest_v2(3990): event_type · stream_quality(**전부 null → Quality Score 미지원**)
--     · network_state(전부 online) · heartbeat_verified.
--   stream_sessions_v2(1351): heartbeat_count(합 27719) · last_heartbeat_at.
--   brand_player_sessions(5): current_track_id(재생 중) · last_seen_at(online ≤5분 = 0).
--
-- ── 미지원 (추정 금지 → "데이터 없음") — 텔레메트리 미수집 ──────────────────
--   Streaming Quality Score(stream_quality null) · Buffer(avg/max/store/browser/device) ·
--   Crossfade · TTFA(Time To First Audio) · Track Transition Gap · Playback Retry ·
--   Decoder/Media/Audio/Autoplay/Queue/Device Error(서버엔 generic player_error 만) ·
--   Queue(Size/Delay/Empty/Recovery/Rebuild) · Scheduler Delay · Store 단위 Streaming
--   Score/Buffer/Error/Recovery/Queue/Crossfade(playback_events_v2.business_id null).
--   ※ Buffer/Crossfade/Decoder/TTFA 는 클라이언트(audioDiagnosticsStore) 로컬에만 존재하고
--     서버로 전송되지 않는다(WEB-OBS 분석 결과). 따라서 서버 집계 불가.
--
-- ── 정합성 ─── 완료율/스킵율 0~100, Health/Quality 0~100(기존 RPC 값 그대로).
--   NaN/Infinity 금지는 프론트 순수함수가 담당. 기존 WEB-OBS 계산과 불일치 없음
--   (재계산하지 않고 기존 RPC 값을 그대로 노출).
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- (A) admin_streaming_summary() — 전역 재생 스냅샷 + 지원 매트릭스.
--     기존 store-scoped now_playing/noc 와 달리 전역 playback_events_v2 기준 admin KPI.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_online_cutoff timestamptz := now() - interval '5 minutes';
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select jsonb_build_object(
    -- 현재 재생/Player (brand_player_sessions — Business phase 와 동일 정의)
    'now_playing', (select count(*) from public.brand_player_sessions where current_track_id is not null),
    'online_players', (select count(*) from public.brand_player_sessions where last_seen_at >= v_online_cutoff),
    'offline_players', (select count(*) from public.brand_player_sessions where last_seen_at is null or last_seen_at < v_online_cutoff),
    'total_players', (select count(*) from public.brand_player_sessions),
    'online_cutoff_minutes', 5,
    -- 오늘 재생 (stream_events start = 재생 시작 이벤트)
    'today_streams', (select count(*) from public.stream_events where event_type='start' and (created_at at time zone 'Asia/Seoul')::date = v_today),
    'today_listen_seconds', (select coalesce(round(sum(listened_seconds)),0) from public.stream_events where (created_at at time zone 'Asia/Seoul')::date = v_today),
    'avg_listen_seconds', (select coalesce(round(avg(listened_seconds)),0) from public.playback_events_v2 where listened_seconds > 0),
    -- Playback 성공/스킵 (playback_events_v2)
    'pb_start', (select count(*) from public.playback_events_v2 where event_type='play_start'),
    'pb_complete', (select count(*) from public.playback_events_v2 where event_type='play_complete'),
    'pb_skip', (select count(*) from public.playback_events_v2 where event_type='skip'),
    'pb_error', (select count(*) from public.playback_events_v2 where event_type='player_error'),
    -- Heartbeat (stream_sessions_v2)
    'heartbeat_total', (select coalesce(sum(heartbeat_count),0) from public.stream_sessions_v2),
    'heartbeat_sessions', (select count(*) from public.stream_sessions_v2 where last_heartbeat_at is not null),
    -- Device / Browser 분포 (재생 시작 기준)
    'by_device', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc),'[]'::jsonb)
      from (select coalesce(device_type,'(미상)') k, count(*) c from public.playback_events_v2 where event_type='play_start' group by 1 order by c desc limit 6) q),
    'by_browser', (select coalesce(jsonb_agg(jsonb_build_object('key', k, 'count', c) order by c desc),'[]'::jsonb)
      from (select coalesce(browser,'(미상)') k, count(*) c from public.playback_events_v2 where event_type='play_start' group by 1 order by c desc limit 6) q),
    -- 데이터 지원 매트릭스 (실제 텔레메트리 존재 여부)
    'support', jsonb_build_object(
      'playback', true, 'skip', true, 'completion', true, 'heartbeat', true,
      'device_browser', true, 'player_online', true,
      'streaming_quality', (select count(*) > 0 from public.stream_ingest_v2 where stream_quality is not null),
      'buffer', false, 'crossfade', false, 'ttfa', false, 'decoder_error', false,
      'queue', false, 'scheduler', false, 'store_playback', (select count(*) > 0 from public.playback_events_v2 where business_id is not null),
      'recovery', false
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_streaming_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- (B) admin_streaming_timeline(p_range) — 재생 시계열 (신규 · 전역 admin 시계열).
--     playback_events_v2(start/complete/skip) + stream_events(streams/listen), zero-fill.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_timeline(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_unit text; v_start date; v_end date; v_result jsonb;
begin
  perform public._admin_growth_guard();

  if p_range='7d' then      v_unit:='day';   v_start:=v_today-6;  v_end:=v_today;
  elsif p_range='30d' then  v_unit:='day';   v_start:=v_today-29; v_end:=v_today;
  elsif p_range='90d' then  v_unit:='day';   v_start:=v_today-89; v_end:=v_today;
  elsif p_range='12m' then  v_unit:='month';
    v_start:=(date_trunc('month',v_today)-interval '11 months')::date; v_end:=date_trunc('month',v_today)::date;
  else raise exception 'invalid range: %, allowed: 7d|30d|90d|12m', p_range using errcode='22023';
  end if;

  with cal as (
    select case when v_unit='day' then gs::date else date_trunc('month',gs)::date end bucket
    from generate_series(v_start::timestamp, v_end::timestamp, case when v_unit='day' then interval '1 day' else interval '1 month' end) gs
  ),
  pe as (
    select case when v_unit='day' then (created_at at time zone 'Asia/Seoul')::date
                else date_trunc('month',(created_at at time zone 'Asia/Seoul')::date)::date end bucket, event_type
    from public.playback_events_v2
    where (created_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  se as (
    select case when v_unit='day' then (created_at at time zone 'Asia/Seoul')::date
                else date_trunc('month',(created_at at time zone 'Asia/Seoul')::date)::date end bucket,
           listened_seconds, event_type
    from public.stream_events
    where (created_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  pagg as (
    select bucket,
      count(*) filter (where event_type='play_start')    starts,
      count(*) filter (where event_type='play_complete') completes,
      count(*) filter (where event_type='skip')          skips,
      count(*) filter (where event_type='player_error')  errors
    from pe group by bucket
  ),
  sagg as (
    select bucket, count(*) filter (where event_type='start') streams, coalesce(sum(listened_seconds),0) listen
    from se group by bucket
  )
  select jsonb_build_object(
    'range', p_range, 'unit', v_unit, 'start', v_start, 'end', v_end,
    'points', coalesce(jsonb_agg(jsonb_build_object(
      'bucket', c.bucket,
      'starts', coalesce(p.starts,0), 'completes', coalesce(p.completes,0),
      'skips', coalesce(p.skips,0), 'errors', coalesce(p.errors,0),
      'streams', coalesce(s.streams,0), 'listen_seconds', coalesce(s.listen,0)
    ) order by c.bucket), '[]'::jsonb),
    'generated_at', now()
  ) into v_result
  from cal c left join pagg p on p.bucket=c.bucket left join sagg s on s.bucket=c.bucket;

  return v_result;
end;
$$;

grant execute on function public.admin_streaming_timeline(text) to authenticated;
