-- 0517_admin_ai_business_causal_digital_twin_calibration.sql
-- Phase AI-OPS-14 — Enterprise Business Causal Intelligence, Confidence Calibration &
-- Corporate Digital Twin Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0485/0486/0504~0516 검증 완료):
--   Business Signal 원본: subscriptions/payment_orders(매출·MRR)/users(매장·아티스트)/
--     tracks/artist_contracts/artist_settlements/playback_events_v2/ai_incidents/
--     ai_capacity_metrics/ai_cost_snapshots/ai_security_events/ai_enterprise_policy_versions/
--     ai_strategic_scenarios·portfolios(0516).
--   Relationship 원본: FK(0513 검증)/ai_knowledge_relationships/ai_decision_memory 체인/
--     ai_organizational_learning_patterns.
--   Outcome 원본: ai_decision_outcomes(0514)/ai_post_change_observations(0506).
--   Confidence 원본: ai_operations/ai_policy_recommendations/ai_executive_decisions/
--     ai_strategic_scenarios·portfolios 의 confidence 필드.
--   실험 근거: playlist experiments(0485)/track rollouts(0486 pilot·expand·global)/
--     new track test pool — Random Assignment/Control Group 구조 없음
--     → experimental_evidence_unavailable 정직 표기(causal_confirmed 상태 자체가 없음).
--
-- 인과 정직성(전부 강제):
--   * 시간 선행/상관/KG 관계/Dependency 를 인과로 자동 승격하지 않음.
--   * causal_confirmed 상태 없음 — 최대 experimentally_supported_reference(절대 확정 아님).
--   * 효과가 원인보다 먼저면 direct candidate 승격 금지(서버 검증).
--   * 교란 요인/반증은 자동 제거·평균 제거 없이 jsonb 로 보존.
--   * Counterfactual = 실제 일어나지 않은 가상 결과(모든 행 limitations 고정).
--   * Digital Twin ≠ 실제 회사(calibrated_reference 도 동일성 주장 아님). Twin ≠ 실제 미래.
--   * Calibration 은 표본<5 확정 금지, 자동 Confidence/Weight 수정 없음. Snapshot 덮어쓰기 금지.
--   * Trigger 없음 · 삭제 RPC 없음 · Intervention RPC 없음 · 원본 테이블 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Business Signal — 관측 신호 기록(원본 복제 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_business_signals (
  id                  uuid primary key default gen_random_uuid(),
  signal_code         text not null unique,
  signal_domain       text not null check (signal_domain in ('revenue','growth','enterprise','store','artist','track','playlist','playback','contract','settlement','payout','cost','capacity','reliability','security','operations','policy','governance','executive','external_environment')),
  signal_type         text not null check (signal_type in ('revenue_change','mrr_change','store_growth','enterprise_growth','artist_growth','track_growth','contract_change','renewal_change','churn_change','streaming_change','playback_quality_change','playlist_performance_change','settlement_change','payout_change','cost_change','capacity_change','incident_change','recovery_change','security_risk_change','operational_risk_change','policy_change_reference','strategic_decision_reference','external_event_reference','manual')),
  source_system       text not null,
  source_reference_id uuid,
  scope_type          text not null default 'unverified',
  scope_id            text,
  metric_name         text not null,
  metric_value        numeric,                                 -- 없으면 null(0 변환 금지)
  metric_unit         text check (metric_unit is null or metric_unit in ('krw','percent','count','hours','gb','ratio','days','manual')),
  baseline_value      numeric,
  observed_at         timestamptz not null,
  observation_window_days int check (observation_window_days is null or observation_window_days > 0),
  data_coverage       numeric check (data_coverage is null or (data_coverage >= 0 and data_coverage <= 100)),
  sample_size         int check (sample_size is null or sample_size >= 0),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["관측 신호 — 원인/결과 단정 아님"]'::jsonb,
  source_version      text not null default 'causal_v1(0517)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_biz_sig on public.ai_business_signals (signal_domain, signal_type, observed_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Causal Candidate — 후보만(causal_confirmed 상태 없음). 교란/반증 jsonb 보존.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_business_causal_candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_code      text not null unique,
  cause_signal_id     uuid not null references public.ai_business_signals(id),
  effect_signal_id    uuid not null references public.ai_business_signals(id),
  causal_domain       text not null,
  candidate_type      text not null check (candidate_type in ('direct_effect_candidate','indirect_effect_candidate','mediated_effect_candidate','feedback_loop_candidate','common_cause_candidate','reverse_causality_candidate','spurious_correlation_candidate','external_factor_candidate','policy_effect_candidate','operational_effect_candidate','commercial_effect_candidate','technical_effect_candidate','manual')),
  time_lag_days       numeric,
  temporal_order_status text not null default 'insufficient_data' check (temporal_order_status in ('cause_precedes_effect','effect_precedes_cause','simultaneous','time_order_unclear','insufficient_data')),
  mechanism_hypothesis text,
  mechanism_status    text not null default 'mechanism_hypothesis_only' check (mechanism_status in ('mechanism_supported','partially_supported','mechanism_hypothesis_only','mechanism_missing','insufficient_data')),
  correlation_summary text,
  supporting_evidence jsonb not null default '[]'::jsonb,
  counter_evidence    jsonb not null default '[]'::jsonb,      -- 평균 제거 금지 — 보존
  confounders         jsonb not null default '[]'::jsonb,      -- 자동 제거 금지 — 목록 보존
  confounder_status   text not null default 'confounders_unreviewed' check (confounder_status in ('reviewed_no_material_confounder','possible_confounder','material_confounder','confounders_unreviewed','insufficient_data')),
  counter_evidence_status text not null default 'insufficient_data' check (counter_evidence_status in ('no_known_counter_evidence','limited_counter_evidence','material_counter_evidence','dominant_counter_evidence','conflicting_evidence','insufficient_data')),
  experimental_evidence jsonb not null default '[]'::jsonb,
  evidence_strength   text not null default 'insufficient_data' check (evidence_strength in ('strong_reference','moderate_reference','weak_reference','correlational_only','conflicting','insufficient_data')),
  causal_status       text not null default 'draft' check (causal_status in ('draft','correlational_only','temporally_supported','mechanism_supported','plausible_contribution','experimentally_supported_reference','conflicting_evidence','causality_unverified','rejected','invalidated','insufficient_data')),
  causal_confidence   numeric check (causal_confidence is null or (causal_confidence >= 0 and causal_confidence <= 100)),
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["후보 — 절대적 인과 확정 아님(causal_confirmed 상태 없음)"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','correlational_reference','plausible_contribution_reference','experimentally_supported_reference','conflicting','rejected','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  source_version      text not null default 'causal_v1(0517)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (cause_signal_id <> effect_signal_id)
);
create index if not exists idx_biz_causal on public.ai_business_causal_candidates (causal_status, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Counterfactual — 가상 결과(실제 Outcome 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_business_counterfactuals (
  id                  uuid primary key default gen_random_uuid(),
  counterfactual_code text not null unique,
  causal_candidate_id uuid references public.ai_business_causal_candidates(id),
  intervention_type   text not null check (intervention_type in ('remove_cause_candidate','increase_cause_candidate','decrease_cause_candidate','hold_constant_candidate','delay_intervention_candidate','alternative_policy_candidate','alternative_portfolio_candidate','no_action_case','manual')),
  intervention_summary text not null,
  baseline_scenario   text,
  counterfactual_scenario text not null,
  assumed_changes     jsonb not null default '[]'::jsonb,
  held_constant_factors jsonb not null default '[]'::jsonb,
  expected_effect     numeric,
  low_range           numeric,
  high_range          numeric,
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  verification_status text not null default 'counterfactual_unverified' check (verification_status in ('draft','ready_for_simulation','simulated_reference','waiting_evidence','counterfactual_unverified','rejected','invalidated','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["실제 일어나지 않은 가상 결과 — 실제 Outcome 아님"]'::jsonb,
  source_version      text not null default 'causal_v1(0517)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_biz_cf on public.ai_business_counterfactuals (verification_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Corporate Digital Twin — 집계 Snapshot(Production 복제/동일성 주장 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_corporate_digital_twins (
  id                  uuid primary key default gen_random_uuid(),
  twin_code           text not null unique,
  title               text not null,
  twin_scope          text not null check (twin_scope in ('company','enterprise','store_group','store','business_category','product','playlist_portfolio','contract_portfolio','infrastructure','operational_system','manual')),
  scope_id            text,
  model_version       text not null default 'twin_v1(0517)',
  included_domains    jsonb not null default '[]'::jsonb,
  state_snapshot      jsonb not null default '{}'::jsonb,      -- 집계 상태만(원본 복제 금지)
  simulations         jsonb not null default '[]'::jsonb,      -- [{name, inputs, outputs, notActualFuture}] 30개 제한
  baseline_at         timestamptz,
  snapshot_at         timestamptz not null default now(),
  input_coverage      numeric check (input_coverage is null or (input_coverage >= 0 and input_coverage <= 100)),
  input_validation    text not null default 'twin_input_incomplete' check (input_validation in ('complete_reference','partially_complete','twin_input_incomplete','stale_input_candidate','scope_unverified','insufficient_data')),
  twin_status         text not null default 'draft' check (twin_status in ('draft','input_incomplete','ready_for_simulation','calibrated_reference','stale_candidate','invalidated','unsupported','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["제한된 집계 모델 — 실제 회사 완전 복제 아님","Twin 결과 ≠ 실제 미래"]'::jsonb,
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_twin on public.ai_corporate_digital_twins (twin_status, snapshot_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Confidence Record + Calibration Snapshot(덮어쓰기 금지·자동 수정 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_confidence_records (
  id                  uuid primary key default gen_random_uuid(),
  confidence_code     text not null unique,
  confidence_domain   text not null,
  source_type         text not null check (source_type in ('ai_operations','ai_policy_recommendations','ai_executive_decisions','ai_strategic_scenarios','ai_strategic_portfolios','ai_decision_memory','forecast','manual')),
  source_reference_id uuid,
  predicted_confidence numeric check (predicted_confidence is null or (predicted_confidence >= 0 and predicted_confidence <= 100)),
  predicted_direction text check (predicted_direction is null or predicted_direction in ('increase','decrease','maintain','no_regression','range','unknown')),
  predicted_low       numeric,
  predicted_high      numeric,
  actual_outcome_status text,
  actual_direction    text,
  actual_value        numeric,
  observation_status  text not null default 'outcome_pending',
  causality_status    text not null default 'causality_unverified',
  calibration_eligible boolean not null default false,
  exclusion_reason    text,                                    -- 제외 사유 보존(삭제 금지)
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Confidence ≠ 사업 성공 확률","과거 오차 ≠ 미래 전체 평가"]'::jsonb,
  predicted_at        timestamptz,
  observed_at         timestamptz,
  source_version      text not null default 'causal_v1(0517)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_conf_rec on public.ai_confidence_records (confidence_domain, calibration_eligible);

create table if not exists public.ai_confidence_calibration_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  calibration_domain  text not null,
  source_type         text,
  date_range_start    timestamptz,
  date_range_end      timestamptz,
  sample_size         int not null default 0 check (sample_size >= 0),
  eligible_count      int not null default 0 check (eligible_count >= 0),
  excluded_count      int not null default 0 check (excluded_count >= 0),
  confidence_buckets  jsonb not null default '[]'::jsonb,
  calibration_metrics jsonb not null default '{}'::jsonb,
  calibration_status  text not null default 'insufficient_data' check (calibration_status in ('well_calibrated_reference','overconfident_candidate','underconfident_candidate','mixed_calibration','calibration_sample_too_small','causality_unverified','insufficient_data')),
  recommendations     jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["모델 전체 성능 일반화 금지","자동 Confidence/Weight 수정 없음"]'::jsonb,
  input_hash          text not null,
  generated_at        timestamptz not null default now(),
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (date_range_end is null or date_range_start is null or date_range_end > date_range_start)
);
create index if not exists idx_calib_snap on public.ai_confidence_calibration_snapshots (calibration_domain, generated_at desc);

create table if not exists public.ai_business_causal_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('signal_recorded','causal_candidate_created','temporal_order_reviewed','mechanism_reviewed','confounder_recorded','counter_evidence_recorded','causal_candidate_reviewed','causal_path_analyzed','propagation_analyzed','feedback_loop_detected','counterfactual_created','counterfactual_simulated_reference','twin_created','twin_snapshot_created','twin_simulation_recorded','vulnerability_chain_detected','resilience_calculated','confidence_record_created','calibration_snapshot_created','calibration_reviewed','external_evidence_reference','causal_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_biz_causal_evt on public.ai_business_causal_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 요약.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_causal_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'signals_total', (select count(*) from public.ai_business_signals),
    'signals_by_domain', (select coalesce(jsonb_object_agg(signal_domain, n), '{}'::jsonb) from (select signal_domain, count(*) n from public.ai_business_signals group by signal_domain) x),
    'candidates_by_status', (select coalesce(jsonb_object_agg(causal_status, n), '{}'::jsonb) from (select causal_status, count(*) n from public.ai_business_causal_candidates group by causal_status) x),
    'confounders_unreviewed', (select count(*) from public.ai_business_causal_candidates where confounder_status = 'confounders_unreviewed'),
    'counterfactuals_total', (select count(*) from public.ai_business_counterfactuals),
    'twins_by_status', (select coalesce(jsonb_object_agg(twin_status, n), '{}'::jsonb) from (select twin_status, count(*) n from public.ai_corporate_digital_twins group by twin_status) x),
    'confidence_records_total', (select count(*) from public.ai_confidence_records),
    'confidence_eligible', (select count(*) from public.ai_confidence_records where calibration_eligible),
    'confidence_excluded', (select count(*) from public.ai_confidence_records where not calibration_eligible),
    'calibration_snapshots', (select count(*) from public.ai_confidence_calibration_snapshots),
    -- 원본 실측(참조만) + 실험 근거 정직 표기:
    'source_actuals', jsonb_build_object(
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'active_stores', (select count(*) from public.users where account_type = 'business' and withdrawn_at is null),
      'decision_outcomes', (select count(*) from public.ai_decision_outcomes),
      'strategic_scenarios', (select count(*) from public.ai_strategic_scenarios),
      'kg_relationships', (select count(*) from public.ai_knowledge_relationships),
      'random_assignment', 'experimental_evidence_unavailable',
      'control_group', 'experimental_evidence_unavailable'
    ),
    'no_auto_causality_confirmation', true, 'no_auto_intervention', true, 'no_auto_confidence_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Signal / Candidate 생성·검토·조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_business_signal_create(
  p_code text, p_domain text, p_type text, p_source_system text, p_metric_name text,
  p_observed_at timestamptz, p_evidence jsonb, p_metric_value numeric default null,
  p_unit text default null, p_baseline numeric default null, p_window_days int default null,
  p_sample_size int default null, p_scope_type text default 'unverified', p_scope_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_metric_name is null or btrim(p_metric_name) = '' then raise exception 'metric_name 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_sample_size is not null and p_sample_size < 0 then raise exception 'sample_size 음수 금지'; end if;
  select id into v_id from public.ai_business_signals where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_business_signals (signal_code, signal_domain, signal_type, source_system, scope_type, scope_id, metric_name, metric_value, metric_unit, baseline_value, observed_at, observation_window_days, sample_size, evidence, idempotency_key, created_by)
  values (p_code, p_domain, p_type, p_source_system, coalesce(p_scope_type, 'unverified'), p_scope_id, p_metric_name, p_metric_value, p_unit, p_baseline, p_observed_at, p_window_days, p_sample_size, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id) values ('signal_recorded', v_id, p_code || ' (' || p_type || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_business_signals(p_domain text default null, p_limit int default 100)
returns setof public.ai_business_signals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_business_signals where (p_domain is null or signal_domain = p_domain)
    order by observed_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_causal_candidate_create(
  p_code text, p_cause_id uuid, p_effect_id uuid, p_domain text, p_type text,
  p_evidence jsonb, p_mechanism text default null, p_correlation text default null,
  p_temporal_order text default 'insufficient_data', p_mechanism_status text default 'mechanism_hypothesis_only',
  p_confounders jsonb default '[]'::jsonb, p_counter_evidence jsonb default '[]'::jsonb,
  p_causal_status text default 'draft', p_confidence numeric default null, p_time_lag numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cause_at timestamptz; v_effect_at timestamptz; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  select observed_at into v_cause_at from public.ai_business_signals where id = p_cause_id;
  select observed_at into v_effect_at from public.ai_business_signals where id = p_effect_id;
  if v_cause_at is null or v_effect_at is null then raise exception 'signal 실존 검증 실패'; end if;
  if p_cause_id = p_effect_id then raise exception 'self reference 금지'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if jsonb_array_length(coalesce(p_confounders, '[]'::jsonb)) > 30 or jsonb_array_length(coalesce(p_counter_evidence, '[]'::jsonb)) > 30 then raise exception '교란/반증 30개 제한'; end if;
  -- 시간 순서 서버 검증: 효과가 원인보다 먼저면 direct 승격 금지
  v_status := p_causal_status;
  if v_effect_at < v_cause_at then
    if p_type = 'direct_effect_candidate' then raise exception '효과가 원인보다 먼저 발생 — direct candidate 승격 금지(reverse_causality_candidate 검토)'; end if;
    v_status := 'causality_unverified';
  end if;
  if v_status in ('experimentally_supported_reference') then raise exception '생성 시 experimentally_supported 지정 금지 — 검토 워크플로만'; end if;
  select id into v_id from public.ai_business_causal_candidates where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_business_causal_candidates (candidate_code, cause_signal_id, effect_signal_id, causal_domain, candidate_type, time_lag_days, temporal_order_status, mechanism_hypothesis, mechanism_status, correlation_summary, supporting_evidence, counter_evidence, confounders, confounder_status, causal_status, causal_confidence, idempotency_key, created_by)
  values (p_code, p_cause_id, p_effect_id, p_domain, p_type, p_time_lag,
          case when v_effect_at < v_cause_at then 'effect_precedes_cause' when v_effect_at = v_cause_at then 'simultaneous' else coalesce(p_temporal_order, 'cause_precedes_effect') end,
          p_mechanism, coalesce(p_mechanism_status, 'mechanism_hypothesis_only'), p_correlation, p_evidence, coalesce(p_counter_evidence, '[]'::jsonb), coalesce(p_confounders, '[]'::jsonb),
          case when jsonb_array_length(coalesce(p_confounders, '[]'::jsonb)) > 0 then 'possible_confounder' else 'confounders_unreviewed' end,
          coalesce(v_status, 'draft'), p_confidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id) values ('causal_candidate_created', v_id, p_code || ' (' || p_type || ') — 인과 확정 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'causality_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_causal_candidate_review(p_id uuid, p_status text, p_reason text, p_causal_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','correlational_reference','plausible_contribution_reference','experimentally_supported_reference','conflicting','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_causal_status is not null and p_causal_status not in ('correlational_only','temporally_supported','mechanism_supported','plausible_contribution','experimentally_supported_reference','conflicting_evidence','causality_unverified','rejected','invalidated') then raise exception '허용되지 않는 causal_status'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select review_status into v_cur from public.ai_business_causal_candidates where id = p_id for update;
  if v_cur is null then raise exception 'candidate 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_business_causal_candidates
     set review_status = p_status, causal_status = coalesce(p_causal_status, causal_status), reviewer_id = v_uid, reviewed_at = now()
   where id = p_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id) values ('causal_candidate_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (절대 확정 아님)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'causality_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_causal_candidates(p_status text default null, p_limit int default 100)
returns setof public.ai_business_causal_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_business_causal_candidates where (p_status is null or causal_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Counterfactual / Twin.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_causal_counterfactual_create(
  p_code text, p_intervention_type text, p_summary text, p_cf_scenario text, p_evidence jsonb,
  p_candidate_id uuid default null, p_baseline text default null, p_expected numeric default null,
  p_low numeric default null, p_high numeric default null, p_confidence numeric default null,
  p_assumed jsonb default '[]'::jsonb, p_held jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_summary is null or btrim(p_summary) = '' or p_cf_scenario is null or btrim(p_cf_scenario) = '' then raise exception 'summary/scenario 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_candidate_id is not null and not exists (select 1 from public.ai_business_causal_candidates where id = p_candidate_id) then raise exception 'candidate 실존 검증 실패'; end if;
  select id into v_id from public.ai_business_counterfactuals where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_business_counterfactuals (counterfactual_code, causal_candidate_id, intervention_type, intervention_summary, baseline_scenario, counterfactual_scenario, assumed_changes, held_constant_factors, expected_effect, low_range, high_range, confidence, verification_status, evidence, idempotency_key, created_by)
  values (p_code, p_candidate_id, p_intervention_type, left(p_summary, 1000), p_baseline, left(p_cf_scenario, 2000), coalesce(p_assumed, '[]'::jsonb), coalesce(p_held, '[]'::jsonb), p_expected, p_low, p_high, p_confidence,
          case when p_expected is not null then 'simulated_reference' else 'draft' end, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id)
  values (case when p_expected is not null then 'counterfactual_simulated_reference' else 'counterfactual_created' end, v_id, p_code || ' — 가상 결과(실제 아님)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'actual_outcome', false, 'production_applied', false);
end $$;

create or replace function public.admin_causal_counterfactuals(p_limit int default 100)
returns setof public.ai_business_counterfactuals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_business_counterfactuals order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_corporate_twin_create(
  p_code text, p_title text, p_scope text, p_evidence jsonb,
  p_included_domains jsonb default '[]'::jsonb, p_state jsonb default '{}'::jsonb,
  p_simulations jsonb default '[]'::jsonb, p_input_coverage numeric default null,
  p_input_validation text default 'twin_input_incomplete', p_scope_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if pg_column_size(coalesce(p_state, '{}'::jsonb)) > 65536 then raise exception 'state snapshot 64KB 초과(원본 복제 금지)'; end if;
  if jsonb_array_length(coalesce(p_simulations, '[]'::jsonb)) > 30 then raise exception 'simulation 30개 제한'; end if;
  select id into v_id from public.ai_corporate_digital_twins where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_corporate_digital_twins (twin_code, title, twin_scope, scope_id, included_domains, state_snapshot, simulations, input_coverage, input_validation, twin_status, evidence, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_scope, p_scope_id, coalesce(p_included_domains, '[]'::jsonb), coalesce(p_state, '{}'::jsonb), coalesce(p_simulations, '[]'::jsonb), p_input_coverage, coalesce(p_input_validation, 'twin_input_incomplete'),
          case when p_input_validation = 'complete_reference' then 'ready_for_simulation' else 'input_incomplete' end, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id)
  values (case when jsonb_array_length(coalesce(p_simulations, '[]'::jsonb)) > 0 then 'twin_simulation_recorded' else 'twin_created' end, v_id, p_code || ' (' || p_scope || ') — 실제 회사 복제 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_identical', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_twins(p_limit int default 50)
returns setof public.ai_corporate_digital_twins language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_digital_twins order by snapshot_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Confidence Record / Calibration Snapshot.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_confidence_record_create(
  p_code text, p_domain text, p_source_type text, p_evidence jsonb,
  p_source_reference_id uuid default null, p_predicted numeric default null, p_direction text default null,
  p_low numeric default null, p_high numeric default null,
  p_actual_status text default null, p_actual_direction text default null, p_actual_value numeric default null,
  p_observation_status text default 'outcome_pending', p_eligible boolean default false, p_exclusion_reason text default null,
  p_predicted_at timestamptz default null, p_observed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if not coalesce(p_eligible, false) and (p_exclusion_reason is null or btrim(p_exclusion_reason) = '') then raise exception '제외 시 exclusion_reason 필수(보존)'; end if;
  select id into v_id from public.ai_confidence_records where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_confidence_records (confidence_code, confidence_domain, source_type, source_reference_id, predicted_confidence, predicted_direction, predicted_low, predicted_high, actual_outcome_status, actual_direction, actual_value, observation_status, calibration_eligible, exclusion_reason, evidence, predicted_at, observed_at, idempotency_key, created_by)
  values (p_code, p_domain, p_source_type, p_source_reference_id, p_predicted, p_direction, p_low, p_high, p_actual_status, p_actual_direction, p_actual_value, coalesce(p_observation_status, 'outcome_pending'), coalesce(p_eligible, false), p_exclusion_reason, p_evidence, p_predicted_at, p_observed_at, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id) values ('confidence_record_created', v_id, p_code || case when coalesce(p_eligible, false) then '' else ' (excluded: ' || coalesce(p_exclusion_reason, '') || ')' end, v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_confidence_records(p_domain text default null, p_limit int default 100)
returns setof public.ai_confidence_records language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_confidence_records where (p_domain is null or confidence_domain = p_domain)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_confidence_calibration_create(
  p_code text, p_domain text, p_evidence jsonb, p_source_type text default null,
  p_sample int default 0, p_eligible int default 0, p_excluded int default 0,
  p_buckets jsonb default '[]'::jsonb, p_metrics jsonb default '{}'::jsonb,
  p_status text default 'insufficient_data', p_recommendations jsonb default '[]'::jsonb,
  p_range_start timestamptz default null, p_range_end timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_hash text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_sample < 0 or p_eligible < 0 or p_excluded < 0 then raise exception '음수 count 금지'; end if;
  if p_eligible < 5 and p_status not in ('calibration_sample_too_small','insufficient_data') then raise exception '표본<5 — calibration 확정 금지(sample_too_small 만 허용)'; end if;
  v_hash := md5(p_domain || coalesce(p_source_type, '') || p_buckets::text || p_metrics::text);
  select id into v_id from public.ai_confidence_calibration_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_confidence_calibration_snapshots (snapshot_code, calibration_domain, source_type, date_range_start, date_range_end, sample_size, eligible_count, excluded_count, confidence_buckets, calibration_metrics, calibration_status, recommendations, evidence, input_hash, created_by)
  values (p_code, p_domain, p_source_type, p_range_start, p_range_end, p_sample, p_eligible, p_excluded, coalesce(p_buckets, '[]'::jsonb), coalesce(p_metrics, '{}'::jsonb), coalesce(p_status, 'insufficient_data'), coalesce(p_recommendations, '[]'::jsonb), p_evidence, v_hash, v_uid)
  returning id into v_id;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, actor_id) values ('calibration_snapshot_created', v_id, p_code || ' (' || coalesce(p_status, 'insufficient_data') || ') — 자동 Confidence 수정 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'confidence_auto_adjusted', false, 'production_applied', false);
end $$;

create or replace function public.admin_confidence_calibration_snapshots(p_limit int default 50)
returns setof public.ai_confidence_calibration_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_confidence_calibration_snapshots order by generated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

create or replace function public.admin_causal_external_evidence(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('experiment_result_reference','market_data_reference','provider_incident_reference','contract_outcome_reference','customer_research_reference','pricing_test_reference','capacity_test_reference','security_test_reference','operational_test_reference','manual_causal_evidence_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_business_causal_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_evidence_reference', p_ref_id, p_action_type || ' — ' || left(p_reason, 200) || ' (진위 자동 보장 없음)', jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'authenticity_guaranteed', false, 'production_applied', false);
end $$;

create or replace function public.admin_causal_audit(p_limit int default 100)
returns setof public.ai_business_causal_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_business_causal_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_business_signals enable row level security;
alter table public.ai_business_causal_candidates enable row level security;
alter table public.ai_business_counterfactuals enable row level security;
alter table public.ai_corporate_digital_twins enable row level security;
alter table public.ai_confidence_records enable row level security;
alter table public.ai_confidence_calibration_snapshots enable row level security;
alter table public.ai_business_causal_events enable row level security;

comment on table public.ai_business_signals is 'AI-OPS-14 — Business Signal(관측 신호 — 원인/결과 단정 아님·원본 복제 없음).';
comment on table public.ai_business_causal_candidates is 'AI-OPS-14 — 인과 후보(causal_confirmed 상태 없음·교란/반증 보존·시간 역행 direct 승격 금지).';
comment on table public.ai_business_counterfactuals is 'AI-OPS-14 — Counterfactual(가상 결과 — 실제 Outcome 아님).';
comment on table public.ai_corporate_digital_twins is 'AI-OPS-14 — Corporate Digital Twin(제한된 집계 모델 — 실제 회사/미래 아님).';
comment on table public.ai_confidence_records is 'AI-OPS-14 — Confidence Record(제외 사유 보존·Confidence ≠ 성공 확률).';
comment on table public.ai_confidence_calibration_snapshots is 'AI-OPS-14 — Calibration Snapshot(덮어쓰기 금지·표본<5 확정 차단·자동 수정 없음).';
comment on table public.ai_business_causal_events is 'AI-OPS-14 — Causal Audit(event_type whitelist 22종).';
