-- ============================================
-- 0492_admin_prediction.sql
--
-- Phase AI-MUSIC-4 — Predictive Music Intelligence & AI Simulation Engine.
--
-- 기존이 "과거·현재"를 분석했다면, 이번에는 **미래 KPI 예측 + 변경 전 시뮬레이션**을 제공한다.
-- 예측/시뮬레이션 전용 — 자동 Playlist/Scheduler/Queue/Playback/Recommendation/Weight 변경 없음.
--
--   Predictive Context · Playlist/Track/Genre/Mood Simulation · Recommendation Impact ·
--   Counterfactual · Forecast Trend · Risk Prediction · Opportunity Detection · Prediction Confidence
--
-- 계산은 **대부분 프론트 predictiveIntel.ts(순수 로직·단위 테스트)**가 수행하며, 원천 KPI 는
-- 기존 RPC 를 최대 재사용한다(admin_context_detail/trend/drift/similarity/overview — AI-M2/M3).
-- 이 마이그레이션은 최소 신규만 추가한다:
--   1) admin_prediction_scan — 전 Context(Store Type) 두 기간 KPI 기울기(Opportunity/Risk/Forecast 랭킹).
--   2) prediction_snapshots 저장소 + save/history(Prediction History; 실시간 계산으로 충분한 부분은 저장 안 함).
--
-- 절대 조건: 기존 Context KPI/Learning 정의 변경 금지(재사용) · 추측 데이터 생성 금지 · Sample 부족이면
--   Prediction/Simulation/Forecast/Risk 생성 금지(프론트 gate) · 점수 0~100 clamp · NaN/Infinity 금지 ·
--   SECURITY DEFINER + search_path 고정 · 관리자 가드 · 접근은 RPC 만(저장소 직접 grant 없음).
-- ============================================

-- 가드 _admin_growth_guard()(0472) · range 헬퍼(0484) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Prediction Scan — 전 Store Type 의 최근 전체 KPI + 두 기간(prior/recent, 동일 길이) KPI/표본.
--    기울기(recent-prior)로 Opportunity/Risk/Forecast 방향을 프론트에서 산출. 표본 부족은 프론트 gate.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_prediction_scan(p_range text default '30d', p_min_sample int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full interval := public._playlist_range_interval(p_range);
  v_half interval := public._playlist_range_interval(p_range) / 2;
  v_recent_from timestamptz := now() - v_half;
  v_prior_from timestamptz := now() - v_full;
  v_min int := greatest(1, least(coalesce(p_min_sample,20), 100000));
  v_items jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.events desc), '[]'::jsonb) into v_items from (
    select
      e.store_type_slug as store_type,
      count(*) as events,
      round((avg(case when e.track_duration_seconds>0 then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as completion_rate,
      round(100.0*count(*) filter (where e.event_type='skip')/nullif(count(*),0),1) as skip_rate,
      round(avg(e.listened_seconds)::numeric,1) as avg_listen_seconds,
      count(distinct e.track_id) as track_count,
      count(distinct e.playlist_id) as playlist_count,
      -- prior 기간
      count(*) filter (where e.created_at >= v_prior_from and e.created_at < v_recent_from) as prior_events,
      round((avg(case when e.created_at >= v_prior_from and e.created_at < v_recent_from and e.track_duration_seconds>0
        then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as prior_completion,
      round(100.0*count(*) filter (where e.created_at >= v_prior_from and e.created_at < v_recent_from and e.event_type='skip')
        /nullif(count(*) filter (where e.created_at >= v_prior_from and e.created_at < v_recent_from),0),1) as prior_skip,
      round(avg(e.listened_seconds) filter (where e.created_at >= v_prior_from and e.created_at < v_recent_from)::numeric,1) as prior_listen,
      -- recent 기간
      count(*) filter (where e.created_at >= v_recent_from) as recent_events,
      round((avg(case when e.created_at >= v_recent_from and e.track_duration_seconds>0
        then least(1, e.listened_seconds/e.track_duration_seconds) end)*100)::numeric,1) as recent_completion,
      round(100.0*count(*) filter (where e.created_at >= v_recent_from and e.event_type='skip')
        /nullif(count(*) filter (where e.created_at >= v_recent_from),0),1) as recent_skip,
      round(avg(e.listened_seconds) filter (where e.created_at >= v_recent_from)::numeric,1) as recent_listen
    from public.playback_events_v2 e
    where e.created_at >= v_prior_from and e.store_type_slug is not null
    group by e.store_type_slug
    having count(*) >= v_min
  ) t;

  return jsonb_build_object('range', coalesce(p_range,'30d'), 'min_sample', v_min,
    'half_days', extract(epoch from v_half)/86400, 'items', v_items, 'generated_at', now());
end;
$$;

grant execute on function public.admin_prediction_scan(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Prediction Snapshot 저장소 — 운영자가 남긴 예측 기록(Prediction History). 접근은 RPC 만.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.prediction_snapshots (
  id              uuid primary key default gen_random_uuid(),
  context_key     text not null,
  prediction_type text not null,       -- forecast/simulation/risk/opportunity/counterfactual
  horizon         text,                -- 7d/30d/90d (해당 시)
  prediction      jsonb not null default '{}'::jsonb,
  confidence      int,
  evidence        jsonb not null default '[]'::jsonb,
  created_by      uuid,
  created_at      timestamptz not null default now()
);
comment on table public.prediction_snapshots is
  'AI-MUSIC-4 — Prediction History. 예측/시뮬레이션 결과 기록(예측 전용, 실제 변경 없음).';
create index if not exists idx_pred_snap on public.prediction_snapshots (context_key, created_at desc);

create or replace function public.admin_prediction_snapshot_save(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid; v_row public.prediction_snapshots;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'context_key','') = '' then raise exception 'context_key required' using errcode='22023'; end if;
  if coalesce(p_payload->>'prediction_type','') = '' then raise exception 'prediction_type required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Explainable Prediction — Evidence 없는 예측 저장 금지)' using errcode='22023';
  end if;

  insert into public.prediction_snapshots(context_key, prediction_type, horizon, prediction, confidence, evidence, created_by)
  values (
    p_payload->>'context_key', p_payload->>'prediction_type', nullif(p_payload->>'horizon',''),
    coalesce(p_payload->'prediction','{}'::jsonb),
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    p_payload->'evidence', auth.uid()
  ) returning id into v_id;

  select * into v_row from public.prediction_snapshots where id = v_id;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_prediction_snapshot_save(jsonb) to authenticated;

create or replace function public.admin_prediction_history(
  p_context_key text default null, p_prediction_type text default null, p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.prediction_snapshots s
    where (p_context_key is null or s.context_key = p_context_key)
      and (p_prediction_type is null or s.prediction_type = p_prediction_type)
    order by s.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_prediction_history(text, text, int) to authenticated;
