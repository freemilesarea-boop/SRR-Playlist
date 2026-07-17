-- 0543_admin_ai_predictive_enterprise_intelligence.sql
-- AI-OPS-39 — Predictive Enterprise Intelligence, Forecast Calibration &
-- Human-Reviewed Early Warning Center.
--
-- Observed Enterprise Signals → Forecast Definition → Baseline → Leading Indicator →
-- Risk Trend → Forecast Run → Prediction Error → Confidence Calibration → Forecast Drift →
-- Threshold Candidate → Early Warning Candidate → Cross-Domain Impact → Human Warning Review →
-- Escalation Recommendation → Decision Reference → Observed Outcome → Forecast Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Forecast ≠ Future Fact. Trend ≠ Guaranteed Continuation. Leading Indicator ≠ Cause.
--  * Warning Candidate ≠ Alert(실제 발송 없음). Threshold Candidate ≠ Applied Threshold.
--  * Confidence ≠ Correctness. Calibration Candidate ≠ Verified Calibration.
--  * Drift/FP/FN Candidate ≠ Confirmed. Escalation Recommendation ≠ Escalation.
--  * No Warning ≠ No Risk. 미실행 Forecast Run completed 차단(Evidence+started_at).
--  * 실제 Alert 발송/Incident 생성/Escalation/Threshold·Runtime·Connector·Automation·
--    Policy·Capacity·Infrastructure 변경 — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0499~0542 원본 무변경(참조만).
--  * Signal Window/Baseline/Threshold Candidate/Calibration/Outcome/FP·FN/Effectiveness 는
--    신규 테이블 대신 Events + JSONB 통합(후보 8 → 4 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Forecast Definition(자동 Monitoring 설정 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_forecast_definitions (
  id                        uuid primary key default gen_random_uuid(),
  forecast_code             text not null,
  forecast_name             text not null,
  forecast_domain           text not null check (forecast_domain in ('runtime_latency','runtime_failure','connector_timeout','connector_failure','approval_queue','review_delay','evidence_gap','duplicate_side_effect','incident_escalation','recovery_duration','capacity_utilization','capacity_exhaustion','cost_growth','throughput_decline','human_workload','policy_effectiveness','false_positive_growth','scope_violation','permission_violation','security_risk','privacy_risk','compliance_risk','operational_friction','enterprise_growth','custom_reference')),
  target_metric             text not null,
  target_scope_type         text not null default 'enterprise' check (target_scope_type in ('global','enterprise','brand','store','connector','automation','agent')),
  target_scope_id           text,
  source_metric_references  jsonb not null default '[]'::jsonb,
  source_table_references   jsonb not null default '[]'::jsonb,
  baseline_method           text not null default 'insufficient_data' check (baseline_method in ('fixed_period_baseline','rolling_average_baseline','rolling_median_baseline','prior_period_baseline','same_weekday_baseline','same_hour_baseline','policy_version_baseline','pre_change_baseline','post_change_baseline','enterprise_snapshot_baseline','insufficient_data')),
  rolling_window_definition jsonb not null default '{}'::jsonb,
  forecast_horizons         jsonb not null default '[]'::jsonb,
  aggregation_interval      text,
  minimum_sample_size       int not null default 10 check (minimum_sample_size >= 1),
  required_data_completeness int check (required_data_completeness is null or (required_data_completeness >= 0 and required_data_completeness <= 100)),
  known_external_factors    jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  leading_indicator_candidates jsonb not null default '[]'::jsonb,
  lagging_indicator_references jsonb not null default '[]'::jsonb,
  threshold_candidate_rules jsonb not null default '[]'::jsonb,
  warning_candidate_rules   jsonb not null default '[]'::jsonb,
  model_reference_type      text not null default 'none' check (model_reference_type in ('none','baseline_projection','rolling_trend','scenario_derived','manual_reference')),
  model_reference_id        text,
  model_version             text,
  output_schema_version     int not null default 1,
  assumptions               jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  support_status            text not null default 'support_unverified' check (support_status in ('supported_reference','partially_supported','support_unverified','unsupported')),
  definition_status         text not null default 'draft' check (definition_status in ('draft','pending_evidence','pending_review','reviewed_reference','approved_for_forecast_reference','forecast_blocked','invalidated','rejected','insufficient_data')),
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aefd_idem on public.ai_enterprise_forecast_definitions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aefd_status on public.ai_enterprise_forecast_definitions (definition_status, forecast_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Forecast Run(실제 미래 아님 — 미실행 completed 차단).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_forecast_runs (
  id                        uuid primary key default gen_random_uuid(),
  run_code                  text not null,
  forecast_definition_id    uuid not null,
  forecast_domain           text not null,
  target_metric             text not null,
  target_scope_type         text not null default 'enterprise',
  target_scope_id           text,
  forecast_horizon_minutes  int check (forecast_horizon_minutes is null or (forecast_horizon_minutes >= 15 and forecast_horizon_minutes <= 525600)),
  source_window_start       timestamptz,
  source_window_end         timestamptz,
  baseline_reference        jsonb,
  input_dataset_reference   text,
  input_hash                text,
  sample_size               int check (sample_size is null or sample_size >= 0),
  data_completeness         int check (data_completeness is null or (data_completeness >= 0 and data_completeness <= 100)),
  forecast_method           text not null check (forecast_method in ('baseline_projection_reference','rolling_trend_reference','moving_average_reference','median_trend_reference','scenario_derived_reference','historical_similarity_reference','capacity_projection_reference','cost_projection_reference','manual_reference','insufficient_data')),
  model_reference           text,
  model_version             text,
  predicted_value           numeric,
  predicted_range_low       numeric,
  predicted_range_high      numeric,
  predicted_direction       text check (predicted_direction is null or predicted_direction in ('increasing','decreasing','stable','unknown')),
  predicted_risk_class      text check (predicted_risk_class is null or predicted_risk_class in ('negligible_risk_candidate','low_risk_candidate','moderate_risk_candidate','high_risk_candidate','critical_risk_candidate','risk_unverified','insufficient_data')),
  predicted_threshold_crossing_at timestamptz,
  leading_indicator_results jsonb,
  trend_result              jsonb,
  cross_domain_impact_result jsonb,
  prediction_error          jsonb,
  calibration_result        jsonb,
  drift_result              jsonb,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  run_status                text not null default 'draft' check (run_status in ('draft','pending_review','ready_reference','running_reference','completed_reference','completed_with_limitation','blocked_reference','failed_reference','forecast_model_unavailable','baseline_unavailable','prediction_unverified','sample_too_small','invalidated','insufficient_data')),
  idempotency_key           text,
  started_by                uuid,
  reviewed_by               uuid,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aefr_idem on public.ai_enterprise_forecast_runs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aefr_status on public.ai_enterprise_forecast_runs (run_status, created_at desc);
create index if not exists idx_aefr_def on public.ai_enterprise_forecast_runs (forecast_definition_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Early Warning Candidate(실제 Alert 아님 — 발송 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_early_warning_candidates (
  id                        uuid primary key default gen_random_uuid(),
  warning_code              text not null,
  forecast_definition_id    uuid not null,
  forecast_run_id           uuid,
  threshold_candidate_reference jsonb not null default '{}'::jsonb,
  warning_domain            text not null,
  warning_type              text not null check (warning_type in ('runtime_degradation_candidate','connector_degradation_candidate','connector_failure_candidate','approval_bottleneck_candidate','incident_escalation_candidate','recovery_deterioration_candidate','capacity_exhaustion_candidate','cost_escalation_candidate','throughput_decline_candidate','workload_overload_candidate','policy_effectiveness_decline_candidate','false_positive_growth_candidate','security_risk_candidate','privacy_risk_candidate','compliance_risk_candidate','operational_friction_candidate','multi_domain_risk_candidate','insufficient_data')),
  target_scope_type         text not null default 'enterprise',
  target_scope_id           text,
  warning_status            text not null default 'candidate' check (warning_status in ('candidate','pending_evidence','pending_review','reviewed_reference','escalation_recommended_reference','watch_reference','dismissed_reference','false_positive_candidate','outcome_pending','outcome_linked_reference','closed_reference','closed_with_limitation','invalidated','insufficient_data')),
  severity_candidate        text not null default 'severity_unverified' check (severity_candidate in ('informational_candidate','low_candidate','moderate_candidate','high_candidate','critical_candidate','severity_unverified','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  detected_at               timestamptz not null default now(),
  expected_event_window_start timestamptz,
  expected_event_window_end timestamptz,
  expected_lead_time_minutes int check (expected_lead_time_minutes is null or expected_lead_time_minutes >= 0),
  observed_signals          jsonb not null default '[]'::jsonb,
  leading_indicator_results jsonb,
  projected_impact          jsonb,
  cross_domain_impact       jsonb,
  affected_scopes           jsonb not null default '{}'::jsonb,
  recommended_review_deadline timestamptz,
  escalation_recommendation jsonb,
  suggested_human_roles     jsonb not null default '[]'::jsonb,
  outcome_reference         jsonb,
  effectiveness_result      jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  reviewed_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aewc_idem on public.ai_enterprise_early_warning_candidates (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aewc_status on public.ai_enterprise_early_warning_candidates (warning_status, warning_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Forecast 이벤트(24종) — Baseline/Signal Window/Indicator/Trend/Error/
--    Calibration/Drift/Threshold/FP·FN/Effectiveness/Learning 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_forecast_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('forecast_definition_created','forecast_definition_reviewed','forecast_run_created','forecast_run_started_reference','forecast_run_completed_reference','baseline_recorded','signal_window_recorded','leading_indicator_reviewed','trend_reviewed','prediction_error_recorded','calibration_reviewed','forecast_drift_reviewed','threshold_candidate_created','threshold_candidate_reviewed','early_warning_candidate_created','early_warning_reviewed','warning_watch_reference_recorded','escalation_recommendation_recorded','warning_outcome_linked','false_positive_candidate_reviewed','false_negative_candidate_reviewed','warning_effectiveness_reviewed','forecast_learning_reference_recorded','forecast_invalidated')),
  forecast_definition_id    uuid,
  forecast_run_id           uuid,
  warning_candidate_id      uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aefe_evt on public.ai_enterprise_forecast_events (event_type, created_at desc);
create index if not exists idx_aefe_warn on public.ai_enterprise_forecast_events (warning_candidate_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Definition 생성/검토.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_forecast_definition_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_forecast_definitions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'forecast_domain','');
  -- 초기 Phase 비활성 도메인(자동 변경/민감 예측 계열) — 구조적 차단.
  if v_domain in ('automatic_threshold_mutation','automatic_incident_creation','automatic_connector_disable','automatic_automation_disable','automatic_capacity_scaling','automatic_infrastructure_change','automatic_cost_commitment','automatic_policy_mutation','employee_performance_prediction','personal_behavior_prediction','credit_risk_prediction','medical_prediction') then
    raise exception '금지된 forecast domain(초기 Phase 비활성)';
  end if;
  if v_domain not in ('runtime_latency','runtime_failure','connector_timeout','connector_failure','approval_queue','review_delay','evidence_gap','duplicate_side_effect','incident_escalation','recovery_duration','capacity_utilization','capacity_exhaustion','cost_growth','throughput_decline','human_workload','policy_effectiveness','false_positive_growth','scope_violation','permission_violation','security_risk','privacy_risk','compliance_risk','operational_friction','enterprise_growth','custom_reference') then
    raise exception '허용되지 않는 forecast_domain';
  end if;
  if coalesce(btrim(p_payload->>'forecast_name'),'') = '' then raise exception 'forecast_name 필수'; end if;
  if coalesce(btrim(p_payload->>'target_metric'),'') = '' then raise exception 'target_metric 필수'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_forecast_definitions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'forecast_is_not_future_fact', true); end if;
  end if;
  insert into public.ai_enterprise_forecast_definitions (forecast_code, forecast_name, forecast_domain, target_metric, target_scope_type, target_scope_id, source_metric_references, source_table_references, baseline_method, rolling_window_definition, forecast_horizons, aggregation_interval, minimum_sample_size, required_data_completeness, known_external_factors, unknown_factors, leading_indicator_candidates, lagging_indicator_references, threshold_candidate_rules, warning_candidate_rules, model_reference_type, model_reference_id, model_version, assumptions, evidence, limitations, support_status, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'forecast_code',''), 'FCD-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'forecast_name', 200), v_domain, left(p_payload->>'target_metric', 120),
    coalesce(nullif(p_payload->>'target_scope_type',''), 'enterprise'), nullif(p_payload->>'target_scope_id',''),
    coalesce(p_payload->'source_metric_references', '[]'::jsonb), coalesce(p_payload->'source_table_references', '[]'::jsonb),
    coalesce(nullif(p_payload->>'baseline_method',''), 'insufficient_data'),
    coalesce(p_payload->'rolling_window_definition', '{}'::jsonb), coalesce(p_payload->'forecast_horizons', '[]'::jsonb),
    nullif(p_payload->>'aggregation_interval',''),
    greatest(coalesce((p_payload->>'minimum_sample_size')::int, 10), 1),
    case when nullif(p_payload->>'required_data_completeness','') is null then null else least(100, greatest(0, (p_payload->>'required_data_completeness')::int)) end,
    coalesce(p_payload->'known_external_factors', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'leading_indicator_candidates', '[]'::jsonb), coalesce(p_payload->'lagging_indicator_references', '[]'::jsonb),
    coalesce(p_payload->'threshold_candidate_rules', '[]'::jsonb), coalesce(p_payload->'warning_candidate_rules', '[]'::jsonb),
    coalesce(nullif(p_payload->>'model_reference_type',''), 'none'), nullif(p_payload->>'model_reference_id',''), nullif(p_payload->>'model_version',''),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    case when coalesce(nullif(p_payload->>'model_reference_type',''), 'none') = 'none' then 'partially_supported' else 'supported_reference' end,
    v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, detail, payload, actor_id)
  values ('forecast_definition_created', v_id, left(v_domain, 80) || ' (Definition ≠ Monitoring 설정 — draft·자동 경보 없음)', jsonb_build_object('target_metric', p_payload->>'target_metric'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'forecast_is_not_future_fact', true, 'alert_dispatched', false, 'production_changed', false);
end $$;

create or replace function public.admin_enterprise_forecast_definition_review(p_definition_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_forecast_definitions; v_next text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','mark_reviewed','approve_for_forecast','block_forecast','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_forecast_definitions where id = p_definition_id;
  if v_row.id is null then raise exception 'Definition 없음(실존 검증 실패)'; end if;
  if v_row.definition_status in ('rejected','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.definition_status; end if;
  if v_row.created_by = v_uid and p_action = 'approve_for_forecast' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action = 'approve_for_forecast' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인 금지';
    end if;
    v_next := 'approved_for_forecast_reference';
    v_note := v_note || ' (Forecast 참조 승인 ≠ 자동 경보 승인)';
  elsif p_action = 'block_forecast' then v_next := 'forecast_blocked';
  elsif p_action = 'reject' then v_next := 'rejected';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_forecast_definitions set definition_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_definition_id;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, detail, payload, actor_id)
  values (case when p_action = 'invalidate' then 'forecast_invalidated' else 'forecast_definition_reviewed' end,
    p_definition_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_definition_id, 'status', v_next, 'alert_dispatched', false, 'production_changed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Forecast Run 생성/진행 — Definition 승인 선행·미실행 completed 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_forecast_run_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_def public.ai_enterprise_forecast_definitions; v_method text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_forecast_runs;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_method := coalesce(p_payload->>'forecast_method','');
  -- 초기 Phase 금지 메서드 — 구조적 차단.
  if v_method in ('autonomous_ml_training','live_model_deployment','automatic_model_replacement','automatic_threshold_tuning') then
    raise exception '금지된 forecast_method(초기 Phase 차단)';
  end if;
  if v_method not in ('baseline_projection_reference','rolling_trend_reference','moving_average_reference','median_trend_reference','scenario_derived_reference','historical_similarity_reference','capacity_projection_reference','cost_projection_reference','manual_reference','insufficient_data') then
    raise exception '허용되지 않는 forecast_method';
  end if;
  select * into v_def from public.ai_enterprise_forecast_definitions where id = nullif(p_payload->>'forecast_definition_id','')::uuid;
  if v_def.id is null then raise exception 'Forecast Definition 없음(실존 검증 실패)'; end if;
  if v_def.definition_status <> 'approved_for_forecast_reference' then
    raise exception 'definition_unapproved: approved_for_forecast_reference 상태에서만 Run 생성 가능';
  end if;
  if nullif(p_payload->>'source_window_start','') is not null and nullif(p_payload->>'source_window_end','') is not null then
    if (p_payload->>'source_window_end')::timestamptz <= (p_payload->>'source_window_start')::timestamptz then raise exception 'signal window 범위 오류'; end if;
    if (p_payload->>'source_window_end')::timestamptz - (p_payload->>'source_window_start')::timestamptz > interval '365 days' then raise exception 'signal window 365일 초과'; end if;
  end if;
  if coalesce((p_payload->>'sample_size')::int, 0) < 0 then raise exception '음수 sample_size 차단'; end if;
  if coalesce((p_payload->>'sample_size')::int, 0) > 10000 then raise exception 'sample 10,000 초과(Signal Sample Abuse 차단)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_forecast_runs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'forecast_is_not_future_fact', true); end if;
  end if;
  insert into public.ai_enterprise_forecast_runs (run_code, forecast_definition_id, forecast_domain, target_metric, target_scope_type, target_scope_id, forecast_horizon_minutes, source_window_start, source_window_end, input_dataset_reference, input_hash, sample_size, data_completeness, forecast_method, model_reference, model_version, assumptions, unknown_factors, external_factors, limitations, idempotency_key, started_by)
  values (left(coalesce(nullif(p_payload->>'run_code',''), 'FCR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_def.id, v_def.forecast_domain, v_def.target_metric, v_def.target_scope_type, v_def.target_scope_id,
    nullif(p_payload->>'forecast_horizon_minutes','')::int,
    nullif(p_payload->>'source_window_start','')::timestamptz, nullif(p_payload->>'source_window_end','')::timestamptz,
    left(coalesce(p_payload->>'input_dataset_reference',''), 200), nullif(p_payload->>'input_hash',''),
    nullif(p_payload->>'sample_size','')::int,
    case when nullif(p_payload->>'data_completeness','') is null then null else least(100, greatest(0, (p_payload->>'data_completeness')::int)) end,
    v_method, nullif(p_payload->>'model_reference',''), nullif(p_payload->>'model_version',''),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, forecast_run_id, detail, payload, actor_id)
  values ('forecast_run_created', v_def.id, v_id, left(v_method, 80) || ' (Forecast ≠ Future Fact — draft·자동 실행 없음)', jsonb_build_object('horizon_minutes', p_payload->>'forecast_horizon_minutes'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'forecast_is_not_future_fact', true, 'alert_dispatched', false, 'production_changed', false);
end $$;

create or replace function public.admin_enterprise_forecast_run_record(p_run_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_forecast_runs; v_next text := null; v_evt text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_ready','start_reference','complete_reference','complete_with_limitation','block','fail','mark_model_unavailable','mark_baseline_unavailable','mark_prediction_unverified','mark_sample_too_small','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_forecast_runs where id = p_run_id;
  if v_row.id is null then raise exception 'Forecast Run 없음(실존 검증 실패)'; end if;
  if v_row.run_status in ('invalidated','completed_reference','completed_with_limitation','failed_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.run_status;
  end if;

  if p_action = 'mark_ready' then v_next := 'ready_reference';
  elsif p_action = 'start_reference' then
    v_next := 'running_reference'; v_evt := 'forecast_run_started_reference';
    update public.ai_enterprise_forecast_runs set started_at = coalesce(started_at, now()) where id = p_run_id;
  elsif p_action in ('complete_reference','complete_with_limitation') then
    -- 실행하지 않은 Forecast 를 Completed 로 표시하지 않음 — Evidence + started_at 필수.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed Forecast 금지(prediction_unverified)';
    end if;
    if v_row.started_at is null then raise exception 'started_at 없는 completed Forecast 금지'; end if;
    v_next := case when p_action = 'complete_reference' then 'completed_reference' else 'completed_with_limitation' end;
    v_evt := 'forecast_run_completed_reference';
    v_note := ' (Forecast ≠ Future Fact·Confidence ≠ Correctness)';
    update public.ai_enterprise_forecast_runs set
      completed_at = now(),
      baseline_reference = coalesce(p_payload->'baseline_reference', baseline_reference),
      predicted_value = case when nullif(p_payload->>'predicted_value','') is null then predicted_value else (p_payload->>'predicted_value')::numeric end,
      predicted_range_low = case when nullif(p_payload->>'predicted_range_low','') is null then predicted_range_low else (p_payload->>'predicted_range_low')::numeric end,
      predicted_range_high = case when nullif(p_payload->>'predicted_range_high','') is null then predicted_range_high else (p_payload->>'predicted_range_high')::numeric end,
      predicted_direction = coalesce(nullif(p_payload->>'predicted_direction',''), predicted_direction),
      predicted_risk_class = coalesce(nullif(p_payload->>'predicted_risk_class',''), predicted_risk_class),
      predicted_threshold_crossing_at = coalesce(nullif(p_payload->>'predicted_threshold_crossing_at','')::timestamptz, predicted_threshold_crossing_at),
      leading_indicator_results = coalesce(p_payload->'leading_indicator_results', leading_indicator_results),
      trend_result = coalesce(p_payload->'trend_result', trend_result),
      cross_domain_impact_result = coalesce(p_payload->'cross_domain_impact_result', cross_domain_impact_result),
      evidence = coalesce(p_payload->'evidence', evidence),
      confidence = case when nullif(p_payload->>'confidence','') is null then confidence else least(100, greatest(0, (p_payload->>'confidence')::int)) end
      where id = p_run_id;
  elsif p_action = 'block' then v_next := 'blocked_reference';
  elsif p_action = 'fail' then v_next := 'failed_reference';
  elsif p_action = 'mark_model_unavailable' then v_next := 'forecast_model_unavailable';
  elsif p_action = 'mark_baseline_unavailable' then v_next := 'baseline_unavailable';
  elsif p_action = 'mark_prediction_unverified' then v_next := 'prediction_unverified';
  elsif p_action = 'mark_sample_too_small' then v_next := 'sample_too_small';
  else v_next := 'invalidated'; v_evt := 'forecast_invalidated';
  end if;

  update public.ai_enterprise_forecast_runs set run_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_run_id;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, forecast_run_id, detail, payload, actor_id)
  values (coalesce(v_evt, 'forecast_run_started_reference'), v_row.forecast_definition_id, p_run_id,
    left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_run_id, 'status', v_next, 'forecast_is_not_future_fact', true, 'alert_dispatched', false, 'production_changed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Early Warning Candidate 생성/검토 — Warning ≠ Alert·발송 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_warning_candidate_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_def public.ai_enterprise_forecast_definitions; v_type text; v_sev text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_early_warning_candidates;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'warning_type','');
  if v_type not in ('runtime_degradation_candidate','connector_degradation_candidate','connector_failure_candidate','approval_bottleneck_candidate','incident_escalation_candidate','recovery_deterioration_candidate','capacity_exhaustion_candidate','cost_escalation_candidate','throughput_decline_candidate','workload_overload_candidate','policy_effectiveness_decline_candidate','false_positive_growth_candidate','security_risk_candidate','privacy_risk_candidate','compliance_risk_candidate','operational_friction_candidate','multi_domain_risk_candidate','insufficient_data') then
    raise exception '허용되지 않는 warning_type';
  end if;
  v_sev := coalesce(nullif(p_payload->>'severity_candidate',''), 'severity_unverified');
  if v_sev not in ('informational_candidate','low_candidate','moderate_candidate','high_candidate','critical_candidate','severity_unverified','insufficient_data') then
    raise exception '허용되지 않는 severity';
  end if;
  select * into v_def from public.ai_enterprise_forecast_definitions where id = nullif(p_payload->>'forecast_definition_id','')::uuid;
  if v_def.id is null then raise exception 'Forecast Definition 없음(실존 검증 실패)'; end if;
  if nullif(p_payload->>'forecast_run_id','') is not null
     and not exists (select 1 from public.ai_enterprise_forecast_runs where id = (p_payload->>'forecast_run_id')::uuid) then
    raise exception 'Forecast Run 없음(실존 검증 실패)';
  end if;
  if jsonb_array_length(coalesce(p_payload->'affected_scope_ids', '[]'::jsonb)) > 100 then raise exception 'warning scope 100개 초과'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_early_warning_candidates where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'warning_is_not_alert', true); end if;
  end if;
  insert into public.ai_enterprise_early_warning_candidates (warning_code, forecast_definition_id, forecast_run_id, threshold_candidate_reference, warning_domain, warning_type, target_scope_type, target_scope_id, severity_candidate, confidence, expected_event_window_start, expected_event_window_end, expected_lead_time_minutes, observed_signals, leading_indicator_results, projected_impact, cross_domain_impact, affected_scopes, recommended_review_deadline, escalation_recommendation, suggested_human_roles, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'warning_code',''), 'EWC-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_def.id, nullif(p_payload->>'forecast_run_id','')::uuid,
    coalesce(p_payload->'threshold_candidate_reference', '{}'::jsonb),
    v_def.forecast_domain, v_type,
    coalesce(nullif(p_payload->>'target_scope_type',''), v_def.target_scope_type), coalesce(nullif(p_payload->>'target_scope_id',''), v_def.target_scope_id),
    v_sev,
    case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end,
    nullif(p_payload->>'expected_event_window_start','')::timestamptz, nullif(p_payload->>'expected_event_window_end','')::timestamptz,
    case when nullif(p_payload->>'expected_lead_time_minutes','') is null then null else greatest(0, (p_payload->>'expected_lead_time_minutes')::int) end,
    coalesce(p_payload->'observed_signals', '[]'::jsonb), p_payload->'leading_indicator_results',
    p_payload->'projected_impact', p_payload->'cross_domain_impact',
    coalesce(p_payload->'affected_scopes', '{}'::jsonb),
    nullif(p_payload->>'recommended_review_deadline','')::timestamptz,
    p_payload->'escalation_recommendation', coalesce(p_payload->'suggested_human_roles', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, warning_candidate_id, detail, payload, actor_id)
  values ('early_warning_candidate_created', v_def.id, v_id, left(v_type, 100) || ' (Warning Candidate ≠ Alert — 발송 없음·사람 검토 필요)', jsonb_build_object('severity', v_sev), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'candidate', 'warning_is_not_alert', true, 'alert_dispatched', false, 'incident_created', false, 'escalated', false, 'production_changed', false);
end $$;

create or replace function public.admin_enterprise_warning_review(p_warning_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_early_warning_candidates; v_next text := null; v_evt text := 'early_warning_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_reviewed','watch','recommend_escalation','dismiss','mark_false_positive','link_outcome','record_effectiveness','close','close_with_limitation','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_early_warning_candidates where id = p_warning_id;
  if v_row.id is null then raise exception 'Warning Candidate 없음(실존 검증 실패)'; end if;
  if v_row.warning_status in ('invalidated','closed_reference','closed_with_limitation','dismissed_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.warning_status;
  end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action = 'watch' then v_next := 'watch_reference'; v_evt := 'warning_watch_reference_recorded';
  elsif p_action = 'recommend_escalation' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Escalation Recommendation 금지';
    end if;
    v_next := 'escalation_recommended_reference'; v_evt := 'escalation_recommendation_recorded';
    v_note := ' (Recommendation ≠ Escalation — 실제 Escalation/발송 없음)';
    update public.ai_enterprise_early_warning_candidates set escalation_recommendation = p_payload where id = p_warning_id;
  elsif p_action = 'dismiss' then v_next := 'dismissed_reference';
  elsif p_action = 'mark_false_positive' then
    v_next := 'false_positive_candidate'; v_evt := 'false_positive_candidate_reviewed';
    v_note := ' (False Positive Candidate ≠ Confirmed)';
  elsif p_action = 'link_outcome' then
    v_next := 'outcome_linked_reference'; v_evt := 'warning_outcome_linked';
    v_note := ' (Outcome Link ≠ 예방 증명·Causality 아님)';
    update public.ai_enterprise_early_warning_candidates set outcome_reference = p_payload where id = p_warning_id;
  elsif p_action = 'record_effectiveness' then
    if coalesce(p_payload->>'result','') not in ('effective_warning_candidate','partially_effective_candidate','ineffective_warning_candidate','too_late_candidate','excessive_false_positive_candidate','missed_warning_candidate','effectiveness_unverified','causality_unverified','sample_too_small','insufficient_data') then
      raise exception '허용되지 않는 effectiveness result';
    end if;
    v_evt := 'warning_effectiveness_reviewed';
    update public.ai_enterprise_early_warning_candidates set effectiveness_result = p_payload where id = p_warning_id;
  elsif p_action in ('close','close_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Closure 금지';
    end if;
    v_next := case when p_action = 'close' then 'closed_reference' else 'closed_with_limitation' end;
  else v_next := 'invalidated'; v_evt := 'forecast_invalidated';
  end if;

  if v_next is not null then
    update public.ai_enterprise_early_warning_candidates set warning_status = v_next, reviewed_by = v_uid, reviewed_at = now(), updated_at = now() where id = p_warning_id;
  end if;
  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, forecast_run_id, warning_candidate_id, detail, payload, actor_id)
  values (v_evt, v_row.forecast_definition_id, v_row.forecast_run_id, p_warning_id,
    left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.warning_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_warning_id, 'status', coalesce(v_next, v_row.warning_status), 'alert_dispatched', false, 'incident_created', false, 'escalated', false, 'production_changed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Forecast 이벤트 기록(통합) — Baseline/Signal Window/Indicator/Trend/
--    Error/Calibration/Drift/Threshold/FP·FN/Learning.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_forecast_event_record(p_kind text, p_reason text, p_payload jsonb, p_definition_id uuid default null, p_run_id uuid default null, p_warning_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('baseline_recorded','signal_window_recorded','leading_indicator_reviewed','trend_reviewed','prediction_error_recorded','calibration_reviewed','forecast_drift_reviewed','threshold_candidate_created','threshold_candidate_reviewed','false_positive_candidate_reviewed','false_negative_candidate_reviewed','forecast_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Run·Warning 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_definition_id is not null and not exists (select 1 from public.ai_enterprise_forecast_definitions where id = p_definition_id) then raise exception 'Definition 없음(실존 검증 실패)'; end if;
  if p_run_id is not null and not exists (select 1 from public.ai_enterprise_forecast_runs where id = p_run_id) then raise exception 'Run 없음(실존 검증 실패)'; end if;
  if p_warning_id is not null and not exists (select 1 from public.ai_enterprise_early_warning_candidates where id = p_warning_id) then raise exception 'Warning 없음(실존 검증 실패)'; end if;

  if p_kind = 'baseline_recorded' and coalesce(p_payload->>'result','') not in ('baseline_ready_reference','baseline_partial','baseline_stale_candidate','baseline_scope_mismatch','baseline_seasonality_unverified','sample_too_small','baseline_unavailable','insufficient_data') then
    raise exception '허용되지 않는 baseline result';
  end if;
  if p_kind = 'leading_indicator_reviewed' and coalesce(p_payload->>'result','') not in ('leading_indicator_candidate','weak_leading_indicator_candidate','inconsistent_lead_candidate','lagging_indicator_candidate','coincident_indicator_candidate','correlation_unverified','causality_unverified','sample_too_small','insufficient_data') then
    raise exception '허용되지 않는 indicator result';
  end if;
  if p_kind = 'trend_reviewed' and coalesce(p_payload->>'result','') not in ('stable_trend_candidate','increasing_trend_candidate','decreasing_trend_candidate','accelerating_trend_candidate','decelerating_trend_candidate','volatile_trend_candidate','reversal_candidate','trend_unverified','sample_too_small','insufficient_data') then
    raise exception '허용되지 않는 trend result';
  end if;
  if p_kind = 'prediction_error_recorded' then
    if coalesce(p_payload->>'result','') not in ('error_low_candidate','error_moderate_candidate','error_high_candidate','direction_match_only','range_match_only','threshold_match_only','outcome_unverified','sample_too_small','insufficient_data') then
      raise exception '허용되지 않는 error result';
    end if;
    if p_run_id is not null then update public.ai_enterprise_forecast_runs set prediction_error = p_payload, updated_at = now() where id = p_run_id; end if;
  end if;
  if p_kind = 'calibration_reviewed' then
    if coalesce(p_payload->>'result','') not in ('well_calibrated_candidate','overconfident_candidate','underconfident_candidate','calibration_drift_candidate','calibration_unverified','sample_too_small','calibration_unavailable','insufficient_data') then
      raise exception '허용되지 않는 calibration result';
    end if;
    if p_run_id is not null then update public.ai_enterprise_forecast_runs set calibration_result = p_payload, updated_at = now() where id = p_run_id; end if;
  end if;
  if p_kind = 'forecast_drift_reviewed' then
    if coalesce(p_payload->>'result','') not in ('no_material_drift_candidate','minor_drift_candidate','moderate_drift_candidate','severe_drift_candidate','structural_drift_candidate','drift_unverified','insufficient_data') then
      raise exception '허용되지 않는 drift result';
    end if;
    if p_run_id is not null then update public.ai_enterprise_forecast_runs set drift_result = p_payload, updated_at = now() where id = p_run_id; end if;
  end if;
  if p_kind in ('threshold_candidate_created','threshold_candidate_reviewed') then
    if p_kind = 'threshold_candidate_created' and coalesce(p_payload->>'threshold_type','') not in ('absolute_value','relative_change','rolling_average','rolling_median','percentile','slope','acceleration','volatility','duration_above','duration_below','compound_condition','cross_domain_condition','manual_reference','insufficient_data') then
      raise exception '허용되지 않는 threshold_type';
    end if;
  end if;
  if p_kind = 'false_negative_candidate_reviewed' and coalesce(p_payload->>'result','') not in ('false_negative_candidate','missed_signal_candidate','threshold_gap_candidate','data_gap_candidate','unsupported_domain_candidate','external_factor_candidate','false_negative_unverified','insufficient_data') then
    raise exception '허용되지 않는 false negative result';
  end if;
  if p_kind = 'false_positive_candidate_reviewed' and coalesce(p_payload->>'result','') not in ('false_positive_candidate','likely_false_positive_candidate','unresolved_warning_candidate','external_factor_explained_candidate','data_quality_candidate','duplicate_warning_candidate','false_positive_unverified','insufficient_data') then
    raise exception '허용되지 않는 false positive result';
  end if;

  insert into public.ai_enterprise_forecast_events (event_type, forecast_definition_id, forecast_run_id, warning_candidate_id, detail, payload, actor_id)
  values (p_kind, p_definition_id, p_run_id, p_warning_id,
    left(p_reason, 200) || case
      when p_kind = 'baseline_recorded' then ' (Baseline ≠ 미래 보장)'
      when p_kind = 'signal_window_recorded' then ' (Signal Window ≠ 원인)'
      when p_kind = 'leading_indicator_reviewed' then ' (Leading Indicator ≠ Cause)'
      when p_kind = 'trend_reviewed' then ' (Trend ≠ Guaranteed Continuation)'
      when p_kind = 'prediction_error_recorded' then ' (Error ≠ Model Failure)'
      when p_kind = 'calibration_reviewed' then ' (Calibration Candidate ≠ Verified Calibration)'
      when p_kind = 'forecast_drift_reviewed' then ' (Drift Candidate ≠ Confirmed Drift)'
      when p_kind like 'threshold%' then ' (Threshold Candidate ≠ Applied Threshold — 실제 적용 없음)'
      when p_kind = 'false_positive_candidate_reviewed' then ' (FP Candidate ≠ Confirmed)'
      when p_kind = 'false_negative_candidate_reviewed' then ' (FN Candidate ≠ Confirmed·No Warning ≠ No Risk)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'alert_dispatched', false, 'threshold_applied', false, 'incident_created', false, 'production_changed', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_forecast_definitions(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_forecast_definitions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_forecast_definitions
  where (p_status is null or definition_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_forecast_runs(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_forecast_runs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_forecast_runs
  where (p_status is null or run_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_warning_candidates(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_early_warning_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_early_warning_candidates
  where (p_status is null or warning_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_forecast_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'definitions', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_forecast_definitions),
      'pending_review', (select count(*) from public.ai_enterprise_forecast_definitions where definition_status in ('pending_review','pending_evidence')),
      'approved', (select count(*) from public.ai_enterprise_forecast_definitions where definition_status = 'approved_for_forecast_reference'),
      'blocked', (select count(*) from public.ai_enterprise_forecast_definitions where definition_status = 'forecast_blocked')
    ),
    'runs', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_forecast_runs),
      'completed', (select count(*) from public.ai_enterprise_forecast_runs where run_status in ('completed_reference','completed_with_limitation')),
      'blocked', (select count(*) from public.ai_enterprise_forecast_runs where run_status = 'blocked_reference'),
      'unverified', (select count(*) from public.ai_enterprise_forecast_runs where run_status = 'prediction_unverified'),
      'model_unavailable', (select count(*) from public.ai_enterprise_forecast_runs where run_status = 'forecast_model_unavailable'),
      'baseline_unavailable', (select count(*) from public.ai_enterprise_forecast_runs where run_status = 'baseline_unavailable'),
      'sample_too_small', (select count(*) from public.ai_enterprise_forecast_runs where run_status = 'sample_too_small')
    ),
    'warnings', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_early_warning_candidates),
      'pending_review', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status in ('candidate','pending_evidence','pending_review')),
      'watch', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status = 'watch_reference'),
      'escalation_recommended', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status = 'escalation_recommended_reference'),
      'critical', (select count(*) from public.ai_enterprise_early_warning_candidates where severity_candidate = 'critical_candidate'),
      'false_positive_candidates', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status = 'false_positive_candidate'),
      'outcome_pending', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status = 'outcome_pending'),
      'outcome_linked', (select count(*) from public.ai_enterprise_early_warning_candidates where warning_status = 'outcome_linked_reference'),
      'by_type', (select coalesce(jsonb_object_agg(warning_type, cnt), '{}'::jsonb) from (select warning_type, count(*) cnt from public.ai_enterprise_early_warning_candidates group by warning_type) t)
    ),
    'forecast_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_forecast_events),
      'baselines', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'baseline_recorded'),
      'signal_windows', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'signal_window_recorded'),
      'leading_indicators', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'leading_indicator_reviewed'),
      'trend_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'trend_reviewed'),
      'prediction_errors', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'prediction_error_recorded'),
      'calibration_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'calibration_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'forecast_drift_reviewed'),
      'threshold_candidates', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'threshold_candidate_created'),
      'threshold_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'threshold_candidate_reviewed'),
      'false_positive_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'false_positive_candidate_reviewed'),
      'false_negative_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'false_negative_candidate_reviewed'),
      'effectiveness_reviews', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'warning_effectiveness_reviewed'),
      'learning_references', (select count(*) from public.ai_enterprise_forecast_events where event_type = 'forecast_learning_reference_recorded')
    ),
    -- Signal 원천 실측(전부 읽기 전용):
    'signal_actuals', jsonb_build_object(
      'assurance_signals_0537', (select count(*) from public.ai_runtime_assurance_signals),
      'runtime_events_0536', (select count(*) from public.ai_runtime_execution_events),
      'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates),
      'incidents_0502', (select count(*) from public.ai_incidents),
      'recovery_candidates_0502', (select count(*) from public.ai_recovery_candidates),
      'execution_requests_0535', (select count(*) from public.ai_execution_requests),
      'capacity_metrics_0508', (select count(*) from public.ai_capacity_metrics),
      'capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots),
      'cost_snapshots_0508', (select count(*) from public.ai_cost_snapshots),
      'scenario_runs_0542', (select count(*) from public.ai_enterprise_scenario_runs),
      'twin_runs_0540', (select count(*) from public.ai_enterprise_twin_runs),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'post_change_observations_0506', (select count(*) from public.ai_post_change_observations)
    ),
    'forecast_unavailable', jsonb_build_array('trained_forecast_model','anomaly_detection_engine','alert_dispatcher','pager_system','provider_state_feed','region_outage_feed','human_absence_calendar','seasonality_dataset'),   -- 원본 없음(실측)
    'forecast_is_not_future_fact', true, 'trend_is_not_guaranteed_continuation', true, 'leading_indicator_is_not_cause', true,
    'warning_candidate_is_not_alert', true, 'threshold_candidate_is_not_applied', true, 'confidence_is_not_correctness', true,
    'no_warning_is_not_no_risk', true, 'no_auto_alert', true, 'no_auto_incident', true, 'no_auto_escalation', true,
    'no_auto_threshold_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_forecast_audit(p_limit int default 100)
returns setof public.ai_enterprise_forecast_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_forecast_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_forecast_definitions enable row level security;
alter table public.ai_enterprise_forecast_runs enable row level security;
alter table public.ai_enterprise_early_warning_candidates enable row level security;
alter table public.ai_enterprise_forecast_events enable row level security;

comment on table public.ai_enterprise_forecast_definitions is 'AI-OPS-39 — Forecast Definition(자동 Monitoring 아님·도메인 25종·금지 12종 차단·approved ≠ 자동 경보 승인).';
comment on table public.ai_enterprise_forecast_runs is 'AI-OPS-39 — Forecast Run(Forecast ≠ Future Fact·미실행 completed 차단·금지 method 4종 차단·Error/Calibration/Drift JSONB 통합).';
comment on table public.ai_enterprise_early_warning_candidates is 'AI-OPS-39 — Early Warning Candidate(≠ Alert·발송 없음·Escalation Recommendation ≠ Escalation·Outcome/Effectiveness JSONB 통합).';
comment on table public.ai_enterprise_forecast_events is 'AI-OPS-39 — Forecast 이벤트 24종(자동 경보/Incident/Escalation 없음).';
