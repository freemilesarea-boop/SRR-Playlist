-- 0522_admin_ai_predictive_execution_forecasting.sql
-- Phase AI-OPS-19 — Predictive Execution Intelligence, Strategic Forecasting &
-- Executive Simulation Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0521 검증 완료):
--   예측 입력 원본: ai_execution_commitments/milestones/blockers/progress(0520),
--     ai_execution_delivery_snapshots(0521 — delivery pattern/quality/health),
--     ai_priority_aging_snapshots(0519), ai_decision_outcomes(0514).
--   KPI 원본: subscriptions(MRR)/users(매장·아티스트) 실측. CSAT/시장 데이터 없음(실측)
--     → projection_unavailable. Forecast 이력 자체가 신규 → 초기 표본 부족 정직 표기.
--
-- 예측 정직성(전부 강제):
--   * Forecast = Prediction. Prediction ≠ Outcome. Projection ≠ Commitment.
--   * Confidence 100 ≠ 성공 보장. Delay Forecast ≠ 실제 지연. Simulation ≠ Executive Decision.
--   * 표본<5 확정 금지(sample_too_small 서버 강제). 근거 부족 → forecast_unverified.
--   * Missing Data = Unknown 유지(null→0 변환 금지). 덮어쓰기 금지.
--   * Trigger 없음 · 삭제 RPC 없음 · 자동 배정/일정/KPI/Outcome/Production 변경 없음 · 원본 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Forecast — 예측 기록(미래 확정 아님·덮어쓰기 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_forecasts (
  id                  uuid primary key default gen_random_uuid(),
  forecast_code       text not null unique,
  forecast_kind       text not null check (forecast_kind in ('commitment_completion_probability','milestone_completion_forecast','delivery_delay_forecast','delivery_success_forecast','verification_readiness_forecast','outcome_observation_forecast','portfolio_completion_forecast','executive_priority_forecast','initiative_forecast','organizational_delivery_forecast','business_impact_forecast','executive_risk_forecast','organizational_health_forecast','kpi_projection','manual')),
  target_reference_type text,
  target_reference_id uuid,
  horizon             text not null default 'next_month' check (horizon in ('next_week','next_month','next_quarter','half_year','annual','manual')),
  predicted_value     numeric,
  predicted_low       numeric,
  predicted_high      numeric,
  predicted_unit      text check (predicted_unit is null or predicted_unit in ('percent','days','count','krw','score','manual')),
  probability_reference numeric check (probability_reference is null or (probability_reference >= 0 and probability_reference <= 100)),
  forecast_confidence numeric check (forecast_confidence is null or (forecast_confidence >= 0 and forecast_confidence <= 100)),
  sample_size         int not null default 0 check (sample_size >= 0),
  forecast_status     text not null default 'forecast_unverified' check (forecast_status in ('forecast_reference','sample_too_small','projection_unavailable','forecast_unverified','superseded_reference','invalidated','insufficient_data')),
  evidence_coverage   numeric check (evidence_coverage is null or (evidence_coverage >= 0 and evidence_coverage <= 100)),
  unknown_components  jsonb not null default '[]'::jsonb,
  missing_signals     jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  input_freshness     text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Forecast = Prediction ≠ Outcome","Confidence 100 ≠ 성공 보장","Delay Forecast ≠ 실제 지연","자동 확정/실행 없음"]'::jsonb,
  actual_value        numeric,                                 -- 사후 대조용(자동 기록 없음)
  actual_recorded_at  timestamptz,
  source_version      text not null default 'forecast_v1(0522)',
  input_hash          text not null,
  idempotency_key     text not null unique,
  created_by          uuid,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check (predicted_low is null or predicted_high is null or predicted_low <= predicted_high)
);
create index if not exists idx_exec_forecast on public.ai_execution_forecasts (forecast_kind, horizon, generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Executive Simulation — What-if/Resource/Dependency(가상 — 실행 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_simulations (
  id                  uuid primary key default gen_random_uuid(),
  simulation_code     text not null unique,
  simulation_kind     text not null check (simulation_kind in ('priority_removal_whatif','priority_addition_whatif','blocker_removal_whatif','resource_impact_simulation','dependency_propagation_forecast','capacity_change_simulation','deadline_change_whatif','portfolio_reshape_whatif','manual')),
  scenario_summary    text not null,
  baseline_snapshot   jsonb not null default '{}'::jsonb,      -- 입력 시점 실측 요약(원본 복제 아님)
  assumed_changes     jsonb not null default '[]'::jsonb,
  projected_effects   jsonb not null default '[]'::jsonb,      -- [{metric, direction, magnitude_reference}]
  affected_references jsonb not null default '[]'::jsonb,
  simulation_confidence numeric check (simulation_confidence is null or (simulation_confidence >= 0 and simulation_confidence <= 100)),
  simulation_status   text not null default 'counterfactual_unverified' check (simulation_status in ('simulated_reference','counterfactual_unverified','sample_too_small','invalidated','insufficient_data')),
  unknown_factors     jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Simulation ≠ Executive Decision","가상 결과 — 실제 배정/일정/실행 변경 없음","Projection ≠ Commitment"]'::jsonb,
  source_version      text not null default 'forecast_v1(0522)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_sim on public.ai_executive_simulations (simulation_kind, created_at desc);

-- Forecast 검토/Timeline/권고/외부 참조/Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_forecast_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('forecast_created','forecast_reviewed','forecast_superseded','forecast_actual_recorded','simulation_created','simulation_reviewed','dependency_propagation_forecasted','risk_forecast_calculated','health_forecast_calculated','forecast_timeline_reviewed','forecast_recommendation_created','external_forecast_reference','forecast_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_forecast_evt on public.ai_forecast_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — 실측 입력 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_forecast_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'forecasts_total', (select count(*) from public.ai_execution_forecasts),
    'forecasts_by_kind', (select coalesce(jsonb_object_agg(forecast_kind, n), '{}'::jsonb) from (select forecast_kind, count(*) n from public.ai_execution_forecasts group by forecast_kind) x),
    'forecasts_by_status', (select coalesce(jsonb_object_agg(forecast_status, n), '{}'::jsonb) from (select forecast_status, count(*) n from public.ai_execution_forecasts group by forecast_status) x),
    'forecasts_with_actual', (select count(*) from public.ai_execution_forecasts where actual_value is not null),
    'simulations_total', (select count(*) from public.ai_executive_simulations),
    'simulations_by_kind', (select coalesce(jsonb_object_agg(simulation_kind, n), '{}'::jsonb) from (select simulation_kind, count(*) n from public.ai_executive_simulations group by simulation_kind) x),
    -- 예측 입력 실측(참조만):
    'input_actuals', jsonb_build_object(
      'active_commitments', (select count(*) from public.ai_execution_commitments where commitment_status not in ('cancelled_reference','invalidated','expired','verified_complete_reference')),
      'active_blockers', (select count(*) from public.ai_commitment_blockers where blocker_status in ('detected','pending_review','active_reference')),
      'delivery_snapshots', (select count(*) from public.ai_execution_delivery_snapshots),
      'decision_outcomes', (select count(*) from public.ai_decision_outcomes),
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'customer_satisfaction', 'projection_unavailable',
      'market_data', 'projection_unavailable'
    ),
    'prediction_is_not_outcome', true, 'no_auto_forecast_confirmation', true, 'no_auto_assignment', true, 'no_auto_schedule_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Forecast 생성·조회 — 표본<5 확정 금지 서버 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_forecast_create(
  p_code text, p_kind text, p_horizon text, p_evidence jsonb,
  p_predicted numeric default null, p_low numeric default null, p_high numeric default null,
  p_unit text default null, p_probability numeric default null, p_confidence numeric default null,
  p_sample int default 0, p_evidence_coverage numeric default null,
  p_unknown jsonb default '[]'::jsonb, p_missing jsonb default '[]'::jsonb,
  p_assumptions jsonb default '[]'::jsonb, p_freshness text default null,
  p_target_type text default null, p_target_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_sample < 0 then raise exception 'sample 음수 금지'; end if;
  if p_low is not null and p_high is not null and p_low > p_high then raise exception 'low > high 금지'; end if;
  if pg_column_size(coalesce(p_unknown, '[]'::jsonb)) + pg_column_size(coalesce(p_assumptions, '[]'::jsonb)) > 32768 then raise exception 'payload 32KB 제한'; end if;
  -- KPI 원본 없는 projection 은 unavailable, 예측값 없으면 unverified, 표본<5 는 확정 금지
  v_status := case when p_kind = 'kpi_projection' and p_evidence_coverage is null then 'projection_unavailable'
                   when p_predicted is null and p_probability is null then 'forecast_unverified'
                   when p_sample < 5 then 'sample_too_small'
                   else 'forecast_reference' end;
  select id into v_id from public.ai_execution_forecasts where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_execution_forecasts (forecast_code, forecast_kind, target_reference_type, target_reference_id, horizon, predicted_value, predicted_low, predicted_high, predicted_unit, probability_reference, forecast_confidence, sample_size, forecast_status, evidence_coverage, unknown_components, missing_signals, assumptions, input_freshness, evidence, input_hash, idempotency_key, created_by)
  values (p_code, p_kind, p_target_type, p_target_id, p_horizon, p_predicted, p_low, p_high, p_unit, p_probability, p_confidence, p_sample, v_status, p_evidence_coverage, coalesce(p_unknown, '[]'::jsonb), coalesce(p_missing, '[]'::jsonb), coalesce(p_assumptions, '[]'::jsonb), p_freshness, p_evidence, md5(p_kind || p_horizon || coalesce(p_predicted::text, '')), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_forecast_events (event_type, ref_id, detail, actor_id) values ('forecast_created', v_id, p_code || ' (' || p_kind || '/' || v_status || ') — Prediction ≠ Outcome', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'forecast_status', v_status, 'outcome_guaranteed', false, 'production_applied', false);
end $$;

create or replace function public.admin_forecast_actual_record(p_id uuid, p_actual numeric, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_actual is null then raise exception 'actual 필수(사후 대조)'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select forecast_status into v_cur from public.ai_execution_forecasts where id = p_id for update;
  if v_cur is null then raise exception 'forecast 없음'; end if;
  if v_cur = 'invalidated' then raise exception '종결 상태에서 기록 불가'; end if;
  update public.ai_execution_forecasts set actual_value = p_actual, actual_recorded_at = now() where id = p_id;
  insert into public.ai_forecast_events (event_type, ref_id, detail, actor_id) values ('forecast_actual_recorded', p_id, left(p_reason, 200) || ' — 대조 기록(Forecast 정확도 ≠ 모델 전체 평가)', v_uid);
  return jsonb_build_object('ok', true, 'production_applied', false);
end $$;

create or replace function public.admin_forecasts(p_kind text default null, p_limit int default 100)
returns setof public.ai_execution_forecasts language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_forecasts where (p_kind is null or forecast_kind = p_kind)
    order by generated_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Simulation 생성·조회 — 가상 결과(실행/배정 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_simulation_create(
  p_code text, p_kind text, p_summary text, p_evidence jsonb,
  p_baseline jsonb default '{}'::jsonb, p_changes jsonb default '[]'::jsonb,
  p_effects jsonb default '[]'::jsonb, p_affected jsonb default '[]'::jsonb,
  p_confidence numeric default null, p_unknown jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_summary is null or btrim(p_summary) = '' then raise exception 'summary 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if pg_column_size(coalesce(p_baseline, '{}'::jsonb)) + pg_column_size(coalesce(p_effects, '[]'::jsonb)) > 32768 then raise exception 'payload 32KB 제한'; end if;
  if jsonb_array_length(coalesce(p_effects, '[]'::jsonb)) > 30 or jsonb_array_length(coalesce(p_affected, '[]'::jsonb)) > 30 then raise exception 'effects/affected 30개 제한'; end if;
  v_status := case when jsonb_array_length(coalesce(p_effects, '[]'::jsonb)) > 0 then 'simulated_reference' else 'counterfactual_unverified' end;
  select id into v_id from public.ai_executive_simulations where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_executive_simulations (simulation_code, simulation_kind, scenario_summary, baseline_snapshot, assumed_changes, projected_effects, affected_references, simulation_confidence, simulation_status, unknown_factors, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_summary, 1000), coalesce(p_baseline, '{}'::jsonb), coalesce(p_changes, '[]'::jsonb), coalesce(p_effects, '[]'::jsonb), coalesce(p_affected, '[]'::jsonb), p_confidence, v_status, coalesce(p_unknown, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_forecast_events (event_type, ref_id, detail, actor_id) values ('simulation_created', v_id, p_code || ' (' || p_kind || ') — Simulation ≠ Executive Decision·실제 변경 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'executed', false, 'resources_assigned', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_simulations(p_kind text default null, p_limit int default 100)
returns setof public.ai_executive_simulations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_simulations where (p_kind is null or simulation_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Governance Event / Audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_forecast_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('forecast_reviewed','simulation_reviewed','dependency_propagation_forecasted','risk_forecast_calculated','health_forecast_calculated','forecast_timeline_reviewed','forecast_recommendation_created','external_forecast_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_forecast_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'dependency_propagation_forecasted' then ' (가능성 계산 — 확정 아님)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'forecast_confirmed_as_fact', false, 'production_applied', false);
end $$;

create or replace function public.admin_forecast_audit(p_limit int default 100)
returns setof public.ai_forecast_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_forecast_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_execution_forecasts enable row level security;
alter table public.ai_executive_simulations enable row level security;
alter table public.ai_forecast_events enable row level security;

comment on table public.ai_execution_forecasts is 'AI-OPS-19 — Forecast(Prediction ≠ Outcome·표본<5 확정 금지·덮어쓰기 금지·actual 사후 대조만).';
comment on table public.ai_executive_simulations is 'AI-OPS-19 — Executive Simulation(What-if/Resource/Dependency — 가상 결과·실행/배정 없음).';
comment on table public.ai_forecast_events is 'AI-OPS-19 — Forecast Audit(event_type whitelist 13종·검토/Timeline/권고 통합).';
