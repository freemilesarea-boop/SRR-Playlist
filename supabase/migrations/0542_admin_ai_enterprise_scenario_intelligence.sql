-- 0542_admin_ai_enterprise_scenario_intelligence.sql
-- AI-OPS-38 — Enterprise Scenario Intelligence, Scenario Replay & Multi-Future Comparison Center.
--
-- Historical Event Reference → Scenario Template(Versioning) → Historical Replay →
-- Scenario Branching → Variable Injection → Multi-Future → Timeline Evolution →
-- Cross-Scenario Comparison → Trade-off/Robustness/Regret → Human Review →
-- Executive Option Candidate → Decision Reference → Observed Outcome Link →
-- Accuracy/Drift Candidate → Scenario Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Scenario ≠ Reality. Replay ≠ Reoccurrence. Historical Event ≠ Future Event.
--  * Prediction ≠ Future Fact. Branch Probability ≠ True Probability.
--  * Robust Option ≠ Correct Option. Lowest Regret ≠ Best Decision.
--  * Comparison ≠ Automatic Ranking(자동 승자 없음). Simulation ≠ Execution.
--  * Accuracy Candidate ≠ Verified Accuracy. Drift Candidate ≠ Confirmed Failure.
--  * 미실행 Run/Branch 를 Completed 로 표시하지 않음(Evidence+started_at 게이트).
--  * 분기 근거 없는 확률 표시 금지(branch_probability_unverified).
--  * Failure Injection/Chaos Test/Production 실행·변경/자동 Decision — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0499~0541 원본 테이블 무변경(참조만).
--  * Timeline Step/Decision Point/Comparison/Outcome/각종 Review 는 신규 테이블 대신
--    Events + Run JSONB 로 통합(테이블 최소화 — 후보 7 → 4).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Scenario Template(실행 정의 아님 — Versioning 포함).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_scenario_templates (
  id                        uuid primary key default gen_random_uuid(),
  template_code             text not null,
  template_name             text not null,
  scenario_domain           text not null check (scenario_domain in ('runtime_failure','connector_failure','provider_failure','approval_delay','human_absence','agent_failure','policy_conflict','policy_change','recovery_failure','evidence_gap','permission_failure','scope_violation','queue_growth','capacity_shortage','cost_spike','scale_growth','region_failure','multi_incident','multi_policy_change','new_connector','new_enterprise','operational_bottleneck','custom_reference')),
  scenario_type             text,
  template_version          int not null default 1 check (template_version >= 1),
  previous_version_id       uuid,
  version_compatibility     text not null default 'version_unverified' check (version_compatibility in ('version_ready_reference','backward_compatible_reference','compatible_with_limitation','breaking_change_candidate','version_unverified','insufficient_data')),
  change_summary            text,
  source_type               text not null default 'insufficient_data' check (source_type in ('historical_incident','runtime_session','policy_simulation','rollout_observation','decision_outcome','enterprise_snapshot','manual_reference','synthetic_reference','insufficient_data')),
  source_reference_id       uuid,
  source_snapshot_id        uuid,
  historical_event_reference jsonb not null default '{}'::jsonb,
  baseline_requirements     jsonb not null default '[]'::jsonb,
  required_twin_layers      jsonb not null default '[]'::jsonb,
  required_data_sources     jsonb not null default '[]'::jsonb,
  initial_conditions        jsonb not null default '{}'::jsonb,
  scenario_variables        jsonb not null default '[]'::jsonb,
  default_assumptions       jsonb not null default '[]'::jsonb,
  known_external_factors    jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  timeline_definition       jsonb not null default '[]'::jsonb,
  decision_points           jsonb not null default '[]'::jsonb,
  transition_rules          jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  success_conditions        jsonb not null default '[]'::jsonb,
  failure_conditions        jsonb not null default '[]'::jsonb,
  recovery_conditions       jsonb not null default '[]'::jsonb,
  expected_outputs          jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  support_status            text not null default 'support_unverified' check (support_status in ('supported_reference','partially_supported','support_unverified','unsupported')),
  template_status           text not null default 'draft' check (template_status in ('draft','pending_evidence','pending_review','reviewed_reference','approved_for_replay_reference','replay_blocked','invalidated','rejected','insufficient_data')),
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aest_idem on public.ai_enterprise_scenario_templates (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aest_status on public.ai_enterprise_scenario_templates (template_status, scenario_domain);
create index if not exists idx_aest_code_ver on public.ai_enterprise_scenario_templates (template_code, template_version desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Scenario Run(실제 운영 실행 아님 — 미실행 completed 차단).
--    Timeline Step/Decision Point/Multi-Future/Comparison/Trade-off/
--    Robustness/Regret/Outcome 결과는 JSONB 컬럼 + Events 로 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_scenario_runs (
  id                        uuid primary key default gen_random_uuid(),
  run_code                  text not null,
  scenario_template_id      uuid not null,
  scenario_template_version int not null default 1,
  enterprise_snapshot_id    uuid not null,
  source_twin_run_id        uuid,
  run_mode                  text not null check (run_mode in ('historical_replay_reference','deterministic_reference','multi_future_reference','branch_comparison_reference','robustness_reference','regret_reference','combined_reference')),
  run_status                text not null default 'draft' check (run_status in ('draft','pending_review','ready_reference','running_reference','completed_reference','completed_with_limitation','blocked_reference','failed_reference','replay_unavailable','prediction_unverified','sample_too_small','invalidated','insufficient_data')),
  scenario_scope_type       text not null default 'enterprise' check (scenario_scope_type in ('global','enterprise','brand','store','connector','agent')),
  scenario_scope_id         text,
  horizon_minutes           int check (horizon_minutes is null or (horizon_minutes >= 60 and horizon_minutes <= 525600)),
  input_variables           jsonb not null default '{}'::jsonb,
  input_hash                text,
  branch_generation_strategy text not null default 'manual_reference',
  max_branch_depth          int not null default 3 check (max_branch_depth >= 1 and max_branch_depth <= 6),
  max_branch_count          int not null default 20 check (max_branch_count >= 1 and max_branch_count <= 100),
  timeline_result           jsonb,
  branch_summary            jsonb,
  future_state_results      jsonb,
  comparison_result         jsonb,
  tradeoff_result           jsonb,
  robustness_result         jsonb,
  regret_result             jsonb,
  risk_result               jsonb,
  opportunity_result        jsonb,
  outcome_reference         jsonb,
  accuracy_candidate        jsonb,
  drift_candidate           jsonb,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  sample_size               int check (sample_size is null or sample_size >= 0),
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  started_by                uuid,
  reviewed_by               uuid,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aesr_idem on public.ai_enterprise_scenario_runs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aesr_status on public.ai_enterprise_scenario_runs (run_status, created_at desc);
create index if not exists idx_aesr_template on public.ai_enterprise_scenario_runs (scenario_template_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Scenario Branch(Branch Probability ≠ True Probability).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_scenario_branches (
  id                        uuid primary key default gen_random_uuid(),
  branch_code               text not null,
  scenario_run_id           uuid not null,
  parent_branch_id          uuid,
  branch_name               text not null,
  branch_depth              int not null default 1 check (branch_depth >= 1 and branch_depth <= 6),
  branch_trigger            text,
  branch_condition          jsonb not null default '{}'::jsonb,
  transition_type           text check (transition_type is null or transition_type in ('metric_threshold','time_elapsed','event_detected','event_missing','approval_received_reference','approval_delayed_reference','connector_status_reference','policy_status_reference','capacity_limit_candidate','cost_limit_candidate','risk_limit_candidate','human_intervention_reference','recovery_reference','unknown')),
  selected_option_reference text,
  future_case_type          text check (future_case_type is null or future_case_type in ('base_case_candidate','best_case_candidate','worst_case_candidate','conservative_case_candidate','aggressive_case_candidate','delayed_response_candidate','immediate_response_candidate','no_action_candidate','limited_action_candidate','policy_applied_reference','policy_not_applied_reference','recovery_success_candidate','recovery_failure_candidate','custom_branch_reference')),
  variable_overrides        jsonb not null default '{}'::jsonb,
  probability_candidate     int check (probability_candidate is null or (probability_candidate >= 0 and probability_candidate <= 100)),
  probability_basis         text,
  probability_confidence    int check (probability_confidence is null or (probability_confidence >= 0 and probability_confidence <= 100)),
  branch_status             text not null default 'draft' check (branch_status in ('draft','ready_reference','running_reference','completed_reference','completed_with_limitation','blocked_reference','pruned_reference','invalidated','sample_too_small','insufficient_data')),
  projected_outputs         jsonb,
  risk_projection           jsonb,
  cost_projection           jsonb,
  capacity_projection       jsonb,
  opportunity_projection    jsonb,
  human_workload_projection jsonb,
  recovery_projection       jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aesb_idem on public.ai_enterprise_scenario_branches (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aesb_run on public.ai_enterprise_scenario_branches (scenario_run_id, branch_depth, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Scenario 이벤트(29종) — Replay/Injection/Timeline Step/Decision Point/
--    Multi-Future/Comparison/Trade-off/Robustness/Regret/Common Risk·Safe/
--    Recommendation/Human Review/Decision Reference/Outcome/Accuracy/Drift 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_scenario_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('scenario_template_created','scenario_template_reviewed','scenario_template_versioned','replay_requested_reference','replay_started_reference','replay_completed_reference','variable_schema_recorded','scenario_injection_reviewed','scenario_run_created','scenario_run_started_reference','scenario_run_completed_reference','scenario_branch_created','scenario_branch_pruned_reference','decision_point_recorded','timeline_step_recorded','multi_future_generated_reference','scenario_comparison_created','tradeoff_reviewed','robustness_reviewed','regret_reviewed','common_risk_reviewed','common_safe_condition_reviewed','scenario_recommendation_recorded','human_scenario_review_recorded','decision_reference_recorded','observed_outcome_linked','accuracy_candidate_reviewed','drift_candidate_reviewed','scenario_invalidated')),
  scenario_template_id      uuid,
  scenario_run_id           uuid,
  scenario_branch_id        uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aese_evt on public.ai_enterprise_scenario_events (event_type, created_at desc);
create index if not exists idx_aese_run on public.ai_enterprise_scenario_events (scenario_run_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Template 생성/검토/버전.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_scenario_template_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_source text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_scenario_templates;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'scenario_domain','');
  -- 초기 Phase 비활성 도메인(파괴/실주입/실변경/인사 계열) — 구조적 차단.
  if v_domain in ('production_chaos_execution','destructive_failure_injection','real_provider_shutdown','real_connector_disable','real_account_lock','real_permission_revocation','real_policy_mutation','real_payment_failure','real_settlement_mutation','real_data_corruption','real_infrastructure_failure','employee_performance_simulation','personal_behavior_prediction') then
    raise exception '금지된 scenario domain(초기 Phase 비활성)';
  end if;
  if v_domain not in ('runtime_failure','connector_failure','provider_failure','approval_delay','human_absence','agent_failure','policy_conflict','policy_change','recovery_failure','evidence_gap','permission_failure','scope_violation','queue_growth','capacity_shortage','cost_spike','scale_growth','region_failure','multi_incident','multi_policy_change','new_connector','new_enterprise','operational_bottleneck','custom_reference') then
    raise exception '허용되지 않는 scenario_domain';
  end if;
  v_source := coalesce(nullif(p_payload->>'source_type',''), 'insufficient_data');
  if v_source not in ('historical_incident','runtime_session','policy_simulation','rollout_observation','decision_outcome','enterprise_snapshot','manual_reference','synthetic_reference','insufficient_data') then
    raise exception '허용되지 않는 source_type';
  end if;
  if coalesce(btrim(p_payload->>'template_name'),'') = '' then raise exception 'template_name 필수'; end if;
  if jsonb_array_length(coalesce(p_payload->'scenario_variables','[]'::jsonb)) > 100 then raise exception 'scenario_variables 100개 초과'; end if;
  if nullif(p_payload->>'source_snapshot_id','') is not null
     and not exists (select 1 from public.ai_enterprise_state_snapshots where id = (p_payload->>'source_snapshot_id')::uuid) then
    raise exception 'Snapshot 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_scenario_templates where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'scenario_is_not_reality', true); end if;
  end if;
  insert into public.ai_enterprise_scenario_templates (template_code, template_name, scenario_domain, scenario_type, source_type, source_reference_id, source_snapshot_id, historical_event_reference, baseline_requirements, required_twin_layers, required_data_sources, initial_conditions, scenario_variables, default_assumptions, known_external_factors, unknown_factors, timeline_definition, decision_points, transition_rules, stop_conditions, success_conditions, failure_conditions, recovery_conditions, expected_outputs, evidence, limitations, support_status, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'template_code',''), 'SCT-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'template_name', 200), v_domain, left(coalesce(p_payload->>'scenario_type',''), 80),
    v_source, nullif(p_payload->>'source_reference_id','')::uuid, nullif(p_payload->>'source_snapshot_id','')::uuid,
    coalesce(p_payload->'historical_event_reference', '{}'::jsonb),
    coalesce(p_payload->'baseline_requirements', '[]'::jsonb), coalesce(p_payload->'required_twin_layers', '[]'::jsonb),
    coalesce(p_payload->'required_data_sources', '[]'::jsonb), coalesce(p_payload->'initial_conditions', '{}'::jsonb),
    coalesce(p_payload->'scenario_variables', '[]'::jsonb), coalesce(p_payload->'default_assumptions', '[]'::jsonb),
    coalesce(p_payload->'known_external_factors', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'timeline_definition', '[]'::jsonb), coalesce(p_payload->'decision_points', '[]'::jsonb),
    coalesce(p_payload->'transition_rules', '[]'::jsonb), coalesce(p_payload->'stop_conditions', '[]'::jsonb),
    coalesce(p_payload->'success_conditions', '[]'::jsonb), coalesce(p_payload->'failure_conditions', '[]'::jsonb),
    coalesce(p_payload->'recovery_conditions', '[]'::jsonb), coalesce(p_payload->'expected_outputs', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    case when v_source = 'synthetic_reference' then 'partially_supported' when v_source = 'insufficient_data' then 'support_unverified' else 'supported_reference' end,
    v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, detail, payload, actor_id)
  values ('scenario_template_created', v_id,
    left(v_domain, 80) || case when v_source = 'synthetic_reference' then ' (Synthetic Reference — 실제 사건 아님)' else '' end || ' (Template ≠ Execution — draft)',
    jsonb_build_object('source_type', v_source), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'template_is_not_execution', true, 'scenario_is_not_reality', true, 'production_changed', false);
end $$;

create or replace function public.admin_enterprise_scenario_template_review(p_template_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_scenario_templates; v_next text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','mark_reviewed','approve_for_replay','block_replay','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_scenario_templates where id = p_template_id;
  if v_row.id is null then raise exception 'Template 없음(실존 검증 실패)'; end if;
  if v_row.template_status in ('rejected','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.template_status; end if;
  if v_row.created_by = v_uid and p_action = 'approve_for_replay' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action = 'approve_for_replay' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인 금지';
    end if;
    v_next := 'approved_for_replay_reference';
    v_note := v_note || ' (Replay 참조 승인 ≠ 실행 승인)';
  elsif p_action = 'block_replay' then v_next := 'replay_blocked';
  elsif p_action = 'reject' then v_next := 'rejected';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_scenario_templates set template_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_template_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, detail, payload, actor_id)
  values (case when p_action = 'invalidate' then 'scenario_invalidated' else 'scenario_template_reviewed' end,
    p_template_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_template_id, 'status', v_next, 'production_changed', false, 'auto_executed', false, 'human_decision', true);
end $$;

create or replace function public.admin_enterprise_scenario_template_version(p_template_id uuid, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_scenario_templates; v_id uuid; v_compat text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Change Summary(Reason) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_scenario_templates where id = p_template_id;
  if v_row.id is null then raise exception 'Template 없음(실존 검증 실패)'; end if;
  v_compat := coalesce(nullif(p_payload->>'version_compatibility',''), 'version_unverified');
  if v_compat not in ('version_ready_reference','backward_compatible_reference','compatible_with_limitation','breaking_change_candidate','version_unverified','insufficient_data') then
    raise exception '허용되지 않는 version_compatibility';
  end if;
  -- 새 버전 행 생성(원본 불변) — 동일 Scenario 라도 버전에 따라 결과가 달라질 수 있음을 명시.
  insert into public.ai_enterprise_scenario_templates (template_code, template_name, scenario_domain, scenario_type, template_version, previous_version_id, version_compatibility, change_summary, source_type, source_reference_id, source_snapshot_id, historical_event_reference, baseline_requirements, required_twin_layers, required_data_sources, initial_conditions, scenario_variables, default_assumptions, known_external_factors, unknown_factors, timeline_definition, decision_points, transition_rules, stop_conditions, success_conditions, failure_conditions, recovery_conditions, expected_outputs, evidence, limitations, support_status, created_by)
  values (v_row.template_code, coalesce(nullif(p_payload->>'template_name',''), v_row.template_name), v_row.scenario_domain, v_row.scenario_type,
    v_row.template_version + 1, v_row.id, v_compat, left(p_reason, 500),
    v_row.source_type, v_row.source_reference_id, v_row.source_snapshot_id, v_row.historical_event_reference,
    coalesce(p_payload->'baseline_requirements', v_row.baseline_requirements), coalesce(p_payload->'required_twin_layers', v_row.required_twin_layers),
    coalesce(p_payload->'required_data_sources', v_row.required_data_sources), coalesce(p_payload->'initial_conditions', v_row.initial_conditions),
    coalesce(p_payload->'scenario_variables', v_row.scenario_variables), coalesce(p_payload->'default_assumptions', v_row.default_assumptions),
    coalesce(p_payload->'known_external_factors', v_row.known_external_factors), coalesce(p_payload->'unknown_factors', v_row.unknown_factors),
    coalesce(p_payload->'timeline_definition', v_row.timeline_definition), coalesce(p_payload->'decision_points', v_row.decision_points),
    coalesce(p_payload->'transition_rules', v_row.transition_rules), coalesce(p_payload->'stop_conditions', v_row.stop_conditions),
    coalesce(p_payload->'success_conditions', v_row.success_conditions), coalesce(p_payload->'failure_conditions', v_row.failure_conditions),
    coalesce(p_payload->'recovery_conditions', v_row.recovery_conditions), coalesce(p_payload->'expected_outputs', v_row.expected_outputs),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', v_row.limitations), v_row.support_status, v_uid)
  returning id into v_id;
  if jsonb_array_length(coalesce(p_payload->'scenario_variables', v_row.scenario_variables)) > 100 then raise exception 'scenario_variables 100개 초과'; end if;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, detail, payload, actor_id)
  values ('scenario_template_versioned', v_id, left(p_reason, 200) || ' (v' || v_row.template_version + 1 || ' — 버전별 결과 상이 가능)', jsonb_build_object('previous_version_id', v_row.id, 'compatibility', v_compat), v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'template_version', v_row.template_version + 1, 'previous_version_id', v_row.id, 'version_compatibility', v_compat, 'production_changed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Scenario Run 생성/진행 — Template 승인 선행·미실행 completed 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_scenario_run_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_tpl public.ai_enterprise_scenario_templates; v_mode text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_scenario_runs;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_mode := coalesce(p_payload->>'run_mode','');
  -- 초기 Phase 금지 모드 — 구조적 차단.
  if v_mode in ('production_execution','live_chaos_test','real_connector_test','real_policy_apply_test','unattended_multi_agent_execution') then
    raise exception '금지된 run_mode(초기 Phase 차단)';
  end if;
  if v_mode not in ('historical_replay_reference','deterministic_reference','multi_future_reference','branch_comparison_reference','robustness_reference','regret_reference','combined_reference') then
    raise exception '허용되지 않는 run_mode';
  end if;
  select * into v_tpl from public.ai_enterprise_scenario_templates where id = nullif(p_payload->>'scenario_template_id','')::uuid;
  if v_tpl.id is null then raise exception 'Template 없음(실존 검증 실패)'; end if;
  if v_tpl.template_status <> 'approved_for_replay_reference' then
    raise exception 'template_unapproved: approved_for_replay_reference 상태에서만 Run 생성 가능';
  end if;
  if not exists (select 1 from public.ai_enterprise_state_snapshots where id = nullif(p_payload->>'enterprise_snapshot_id','')::uuid and snapshot_status <> 'invalidated') then
    raise exception 'Snapshot 없음/무효화(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'source_twin_run_id','') is not null
     and not exists (select 1 from public.ai_enterprise_twin_runs where id = (p_payload->>'source_twin_run_id')::uuid) then
    raise exception 'Twin Run 없음(실존 검증 실패)';
  end if;
  if coalesce(p_payload->>'scenario_scope_type','enterprise') = 'global' and coalesce(p_payload->>'cross_enterprise','false') = 'true' then
    raise exception 'cross_enterprise_blocked';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_scenario_runs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'simulation_is_not_execution', true); end if;
  end if;
  insert into public.ai_enterprise_scenario_runs (run_code, scenario_template_id, scenario_template_version, enterprise_snapshot_id, source_twin_run_id, run_mode, scenario_scope_type, scenario_scope_id, horizon_minutes, input_variables, input_hash, branch_generation_strategy, max_branch_depth, max_branch_count, assumptions, unknown_factors, limitations, idempotency_key, started_by)
  values (left(coalesce(nullif(p_payload->>'run_code',''), 'SCR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_tpl.id, v_tpl.template_version, (p_payload->>'enterprise_snapshot_id')::uuid, nullif(p_payload->>'source_twin_run_id','')::uuid,
    v_mode, coalesce(nullif(p_payload->>'scenario_scope_type',''), 'enterprise'), nullif(p_payload->>'scenario_scope_id',''),
    nullif(p_payload->>'horizon_minutes','')::int,
    coalesce(p_payload->'input_variables', '{}'::jsonb), nullif(p_payload->>'input_hash',''),
    coalesce(nullif(p_payload->>'branch_generation_strategy',''), 'manual_reference'),
    least(greatest(coalesce((p_payload->>'max_branch_depth')::int, 3), 1), 6),
    least(greatest(coalesce((p_payload->>'max_branch_count')::int, 20), 1), 100),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, scenario_run_id, detail, payload, actor_id)
  values ('scenario_run_created', v_tpl.id, v_id, left(v_mode, 80) || ' (Simulation ≠ Execution — draft·자동 실행 없음)', jsonb_build_object('template_version', v_tpl.template_version), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'simulation_is_not_execution', true, 'prediction_is_not_future_fact', true, 'production_changed', false, 'auto_executed', false);
end $$;

create or replace function public.admin_enterprise_scenario_run_record(p_run_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_scenario_runs; v_next text := null; v_evt text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_ready','start_reference','complete_reference','complete_with_limitation','block','fail','mark_replay_unavailable','mark_prediction_unverified','mark_sample_too_small','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_scenario_runs where id = p_run_id;
  if v_row.id is null then raise exception 'Scenario Run 없음(실존 검증 실패)'; end if;
  if v_row.run_status in ('invalidated','completed_reference','completed_with_limitation','failed_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.run_status;
  end if;

  if p_action = 'mark_ready' then v_next := 'ready_reference';
  elsif p_action = 'start_reference' then
    v_next := 'running_reference'; v_evt := 'scenario_run_started_reference';
    update public.ai_enterprise_scenario_runs set started_at = coalesce(started_at, now()) where id = p_run_id;
  elsif p_action in ('complete_reference','complete_with_limitation') then
    -- 실행하지 않은 Run 을 Completed 로 표시하지 않음 — Evidence + started_at 필수.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed Run 금지(prediction_unverified)';
    end if;
    if v_row.started_at is null then raise exception 'started_at 없는 completed Run 금지'; end if;
    v_next := case when p_action = 'complete_reference' then 'completed_reference' else 'completed_with_limitation' end;
    v_evt := 'scenario_run_completed_reference';
    v_note := ' (Prediction ≠ Future Fact·Timeline ≠ Actual Schedule)';
    update public.ai_enterprise_scenario_runs set
      completed_at = now(),
      timeline_result = coalesce(p_payload->'timeline_result', timeline_result),
      branch_summary = coalesce(p_payload->'branch_summary', branch_summary),
      future_state_results = coalesce(p_payload->'future_state_results', future_state_results),
      comparison_result = coalesce(p_payload->'comparison_result', comparison_result),
      tradeoff_result = coalesce(p_payload->'tradeoff_result', tradeoff_result),
      robustness_result = coalesce(p_payload->'robustness_result', robustness_result),
      regret_result = coalesce(p_payload->'regret_result', regret_result),
      risk_result = coalesce(p_payload->'risk_result', risk_result),
      opportunity_result = coalesce(p_payload->'opportunity_result', opportunity_result),
      evidence = coalesce(p_payload->'evidence', evidence),
      confidence = case when nullif(p_payload->>'confidence','') is null then confidence else least(100, greatest(0, (p_payload->>'confidence')::int)) end,
      sample_size = case when nullif(p_payload->>'sample_size','') is null then sample_size else greatest(0, (p_payload->>'sample_size')::int) end
      where id = p_run_id;
  elsif p_action = 'block' then v_next := 'blocked_reference';
  elsif p_action = 'fail' then v_next := 'failed_reference';
  elsif p_action = 'mark_replay_unavailable' then v_next := 'replay_unavailable';
  elsif p_action = 'mark_prediction_unverified' then v_next := 'prediction_unverified';
  elsif p_action = 'mark_sample_too_small' then v_next := 'sample_too_small';
  else v_next := 'invalidated'; v_evt := 'scenario_invalidated';
  end if;

  update public.ai_enterprise_scenario_runs set run_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_run_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, scenario_run_id, detail, payload, actor_id)
  values (coalesce(v_evt, 'scenario_run_started_reference'), v_row.scenario_template_id, p_run_id,
    left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_run_id, 'status', v_next, 'simulation_is_not_execution', true, 'production_changed', false, 'auto_executed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Branch 생성/검토 — Depth/Count 제한·확률 근거 게이트·미실행 completed 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_scenario_branch_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_run public.ai_enterprise_scenario_runs; v_parent public.ai_enterprise_scenario_branches; v_depth int; v_count int; v_prob int; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_scenario_branches;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_run from public.ai_enterprise_scenario_runs where id = nullif(p_payload->>'scenario_run_id','')::uuid;
  if v_run.id is null then raise exception 'Scenario Run 없음(실존 검증 실패)'; end if;
  select count(*) into v_count from public.ai_enterprise_scenario_branches where scenario_run_id = v_run.id;
  if v_count >= v_run.max_branch_count then raise exception 'branch count 초과(run 제한 %건 — Branch Explosion 차단)', v_run.max_branch_count; end if;
  v_depth := 1;
  if nullif(p_payload->>'parent_branch_id','') is not null then
    select * into v_parent from public.ai_enterprise_scenario_branches where id = (p_payload->>'parent_branch_id')::uuid;
    if v_parent.id is null or v_parent.scenario_run_id <> v_run.id then raise exception 'Parent Branch 없음/다른 Run(실존 검증 실패)'; end if;
    v_depth := v_parent.branch_depth + 1;
    if v_depth > v_run.max_branch_depth then raise exception 'branch depth 초과(run 제한 %)', v_run.max_branch_depth; end if;
  end if;
  if coalesce(btrim(p_payload->>'branch_name'),'') = '' then raise exception 'branch_name 필수'; end if;
  if nullif(p_payload->>'transition_type','') is not null and p_payload->>'transition_type' not in ('metric_threshold','time_elapsed','event_detected','event_missing','approval_received_reference','approval_delayed_reference','connector_status_reference','policy_status_reference','capacity_limit_candidate','cost_limit_candidate','risk_limit_candidate','human_intervention_reference','recovery_reference','unknown') then
    raise exception '허용되지 않는 transition_type';
  end if;
  -- 분기 확률: 근거(probability_basis) 없는 확률 표시 금지 — branch_probability_unverified 유지.
  v_prob := case when nullif(p_payload->>'probability_candidate','') is null then null else least(100, greatest(0, (p_payload->>'probability_candidate')::int)) end;
  if v_prob is not null and coalesce(btrim(p_payload->>'probability_basis'),'') = '' then
    raise exception 'branch_probability_unverified: 근거 없는 확률 표시 금지(probability_basis 필수)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_scenario_branches where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'branch_probability_is_not_true_probability', true); end if;
  end if;
  insert into public.ai_enterprise_scenario_branches (branch_code, scenario_run_id, parent_branch_id, branch_name, branch_depth, branch_trigger, branch_condition, transition_type, selected_option_reference, future_case_type, variable_overrides, probability_candidate, probability_basis, probability_confidence, assumptions, unknown_factors, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'branch_code',''), 'SCB-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_run.id, nullif(p_payload->>'parent_branch_id','')::uuid, left(p_payload->>'branch_name', 200), v_depth,
    left(coalesce(p_payload->>'branch_trigger',''), 200), coalesce(p_payload->'branch_condition', '{}'::jsonb),
    nullif(p_payload->>'transition_type',''), left(coalesce(p_payload->>'selected_option_reference',''), 200),
    nullif(p_payload->>'future_case_type',''),
    coalesce(p_payload->'variable_overrides', '{}'::jsonb), v_prob, nullif(p_payload->>'probability_basis',''),
    case when nullif(p_payload->>'probability_confidence','') is null then null else least(100, greatest(0, (p_payload->>'probability_confidence')::int)) end,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_run_id, scenario_branch_id, detail, payload, actor_id)
  values ('scenario_branch_created', v_run.id, v_id, left(coalesce(p_payload->>'future_case_type', p_payload->>'branch_name'), 120) || ' (Branch ≠ Actual Future·확률은 Candidate)', jsonb_build_object('depth', v_depth), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'branch_depth', v_depth, 'branch_probability_is_not_true_probability', true, 'production_changed', false, 'auto_executed', false);
end $$;

create or replace function public.admin_enterprise_scenario_branch_review(p_branch_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_scenario_branches; v_next text; v_evt text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_ready','start_reference','complete_reference','complete_with_limitation','block','prune','mark_sample_too_small','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_scenario_branches where id = p_branch_id;
  if v_row.id is null then raise exception 'Branch 없음(실존 검증 실패)'; end if;
  if v_row.branch_status in ('invalidated','pruned_reference','completed_reference','completed_with_limitation') then
    raise exception '종결 상태 재결정 차단(%)', v_row.branch_status;
  end if;

  if p_action = 'mark_ready' then v_next := 'ready_reference';
  elsif p_action = 'start_reference' then v_next := 'running_reference';
  elsif p_action in ('complete_reference','complete_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed Branch 금지(미실행 completed 차단)';
    end if;
    v_next := case when p_action = 'complete_reference' then 'completed_reference' else 'completed_with_limitation' end;
    v_note := ' (Branch ≠ Actual Future)';
    update public.ai_enterprise_scenario_branches set
      projected_outputs = coalesce(p_payload->'projected_outputs', projected_outputs),
      risk_projection = coalesce(p_payload->'risk_projection', risk_projection),
      cost_projection = coalesce(p_payload->'cost_projection', cost_projection),
      capacity_projection = coalesce(p_payload->'capacity_projection', capacity_projection),
      opportunity_projection = coalesce(p_payload->'opportunity_projection', opportunity_projection),
      human_workload_projection = coalesce(p_payload->'human_workload_projection', human_workload_projection),
      recovery_projection = coalesce(p_payload->'recovery_projection', recovery_projection),
      evidence = coalesce(p_payload->'evidence', evidence)
      where id = p_branch_id;
  elsif p_action = 'block' then v_next := 'blocked_reference';
  elsif p_action = 'prune' then v_next := 'pruned_reference'; v_evt := 'scenario_branch_pruned_reference';
  elsif p_action = 'mark_sample_too_small' then v_next := 'sample_too_small';
  else v_next := 'invalidated'; v_evt := 'scenario_invalidated';
  end if;

  update public.ai_enterprise_scenario_branches set branch_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_branch_id;
  insert into public.ai_enterprise_scenario_events (event_type, scenario_run_id, scenario_branch_id, detail, payload, actor_id)
  values (coalesce(v_evt, 'scenario_branch_created'), v_row.scenario_run_id, p_branch_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_branch_id, 'status', v_next, 'production_changed', false, 'auto_executed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Scenario 이벤트 기록(통합) — Replay/Injection/Timeline/Decision Point/
--    Multi-Future/Comparison/Trade-off/Robustness/Regret/Recommendation/
--    Decision Reference/Outcome/Accuracy/Drift.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_scenario_event_record(p_kind text, p_reason text, p_payload jsonb, p_template_id uuid default null, p_run_id uuid default null, p_branch_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_steps int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('replay_requested_reference','replay_started_reference','replay_completed_reference','variable_schema_recorded','scenario_injection_reviewed','decision_point_recorded','timeline_step_recorded','multi_future_generated_reference','scenario_comparison_created','tradeoff_reviewed','robustness_reviewed','regret_reviewed','common_risk_reviewed','common_safe_condition_reviewed','scenario_recommendation_recorded','human_scenario_review_recorded','decision_reference_recorded','observed_outcome_linked','accuracy_candidate_reviewed','drift_candidate_reviewed') then
    raise exception '허용되지 않는 kind(생성/승인/Run·Branch 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_template_id is not null and not exists (select 1 from public.ai_enterprise_scenario_templates where id = p_template_id) then raise exception 'Template 없음(실존 검증 실패)'; end if;
  if p_run_id is not null and not exists (select 1 from public.ai_enterprise_scenario_runs where id = p_run_id) then raise exception 'Run 없음(실존 검증 실패)'; end if;
  if p_branch_id is not null and not exists (select 1 from public.ai_enterprise_scenario_branches where id = p_branch_id) then raise exception 'Branch 없음(실존 검증 실패)'; end if;

  if p_kind = 'timeline_step_recorded' then
    if p_run_id is null then raise exception 'timeline_step 은 run 필수'; end if;
    select count(*) into v_steps from public.ai_enterprise_scenario_events where scenario_run_id = p_run_id and event_type = 'timeline_step_recorded';
    if v_steps >= 500 then raise exception 'timeline step 500개 초과(Timeline Explosion 차단)'; end if;
  end if;
  if p_kind = 'replay_completed_reference' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Replay 완료 금지(replay_unverified)';
    end if;
    if coalesce(p_payload->>'result','') not in ('replay_ready_reference','replay_completed_reference','replay_partial','replay_event_gap_candidate','replay_order_unverified','replay_duplicate_candidate','replay_scope_mismatch','replay_external_factor_unverified','replay_bias_candidate','sample_too_small','stale_input_candidate','replay_unavailable','insufficient_data') then
      raise exception '허용되지 않는 replay result';
    end if;
  end if;
  if p_kind = 'scenario_comparison_created' then
    if p_payload->'run_ids' is null or jsonb_typeof(p_payload->'run_ids') <> 'array' or jsonb_array_length(p_payload->'run_ids') < 2 then
      raise exception 'Comparison 은 Run 2개 이상 필요';
    end if;
    if jsonb_array_length(p_payload->'run_ids') > 20 then raise exception 'Comparison Run 20개 초과'; end if;
  end if;
  if p_kind = 'scenario_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation','') not in ('create_scenario_template','gather_replay_evidence','create_historical_replay','define_variables','validate_variable_ranges','create_scenario_branch','generate_base_case','generate_best_case','generate_worst_case','generate_no_action_case','compare_scenarios','review_tradeoffs','review_robustness','review_regret','review_common_risks','review_common_safe_conditions','request_human_scenario_review','record_decision_reference','link_observed_outcome','review_accuracy_candidate','review_drift_candidate','update_scenario_template_reference','insufficient_data') then
      raise exception '허용되지 않는 recommendation type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Recommendation 금지';
    end if;
  end if;
  if p_kind = 'decision_reference_recorded' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Decision Reference 금지';
    end if;
  end if;
  if p_kind = 'observed_outcome_linked' then
    if p_run_id is null then raise exception 'Outcome 연결은 run 필수'; end if;
    update public.ai_enterprise_scenario_runs set outcome_reference = p_payload, updated_at = now() where id = p_run_id;
  end if;
  if p_kind = 'accuracy_candidate_reviewed' then
    if coalesce(p_payload->>'result','') not in ('accuracy_candidate_high','accuracy_candidate_moderate','accuracy_candidate_low','direction_match_only','range_match_only','accuracy_unverified','outcome_unverified','sample_too_small','insufficient_data') then
      raise exception '허용되지 않는 accuracy result';
    end if;
    if p_run_id is not null then update public.ai_enterprise_scenario_runs set accuracy_candidate = p_payload, updated_at = now() where id = p_run_id; end if;
  end if;
  if p_kind = 'drift_candidate_reviewed' then
    if coalesce(p_payload->>'result','') not in ('no_material_drift_candidate','minor_drift_candidate','moderate_drift_candidate','severe_drift_candidate','structural_drift_candidate','drift_unverified','insufficient_data') then
      raise exception '허용되지 않는 drift result';
    end if;
    if p_run_id is not null then update public.ai_enterprise_scenario_runs set drift_candidate = p_payload, updated_at = now() where id = p_run_id; end if;
  end if;

  insert into public.ai_enterprise_scenario_events (event_type, scenario_template_id, scenario_run_id, scenario_branch_id, detail, payload, actor_id)
  values (p_kind, p_template_id, p_run_id, p_branch_id,
    left(p_reason, 200) || case
      when p_kind like 'replay%' then ' (Replay ≠ Reoccurrence·과거의 완벽한 재현 아님)'
      when p_kind = 'scenario_injection_reviewed' then ' (Injection ≠ 실제 장애 주입)'
      when p_kind = 'timeline_step_recorded' then ' (Timeline ≠ Actual Schedule)'
      when p_kind = 'decision_point_recorded' then ' (AI 는 Decision Point 를 생성만 — 결정하지 않음)'
      when p_kind = 'multi_future_generated_reference' then ' (Future ≠ Fact)'
      when p_kind = 'scenario_comparison_created' then ' (Comparison ≠ Automatic Ranking — 자동 승자 없음)'
      when p_kind = 'tradeoff_reviewed' then ' (Trade-off Score ≠ Business Value)'
      when p_kind = 'robustness_reviewed' then ' (Robust Option ≠ Correct Option)'
      when p_kind = 'regret_reviewed' then ' (Lowest Regret ≠ Best Decision)'
      when p_kind = 'scenario_recommendation_recorded' then ' (Recommendation ≠ Decision — 실행은 사람)'
      when p_kind = 'decision_reference_recorded' then ' (Decision Reference ≠ Decision)'
      when p_kind = 'observed_outcome_linked' then ' (Outcome Reference ≠ 인과관계 증명)'
      when p_kind = 'accuracy_candidate_reviewed' then ' (Accuracy Candidate ≠ Verified Accuracy)'
      when p_kind = 'drift_candidate_reviewed' then ' (Drift Candidate ≠ Confirmed Model Failure)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'production_changed', false, 'auto_executed', false, 'recommendation_is_not_decision', true, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_scenario_templates(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_scenario_templates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_scenario_templates
  where (p_status is null or template_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_scenario_runs(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_scenario_runs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_scenario_runs
  where (p_status is null or run_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_scenario_branches(p_run_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_scenario_branches language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_scenario_branches
  where (p_run_id is null or scenario_run_id = p_run_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_scenario_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'templates', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_scenario_templates),
      'pending_review', (select count(*) from public.ai_enterprise_scenario_templates where template_status in ('pending_review','pending_evidence')),
      'approved_for_replay', (select count(*) from public.ai_enterprise_scenario_templates where template_status = 'approved_for_replay_reference'),
      'replay_blocked', (select count(*) from public.ai_enterprise_scenario_templates where template_status = 'replay_blocked'),
      'versions_recorded', (select count(*) from public.ai_enterprise_scenario_templates where template_version > 1)
    ),
    'runs', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_scenario_runs),
      'replay_runs', (select count(*) from public.ai_enterprise_scenario_runs where run_mode = 'historical_replay_reference'),
      'completed', (select count(*) from public.ai_enterprise_scenario_runs where run_status in ('completed_reference','completed_with_limitation')),
      'blocked', (select count(*) from public.ai_enterprise_scenario_runs where run_status = 'blocked_reference'),
      'unverified', (select count(*) from public.ai_enterprise_scenario_runs where run_status = 'prediction_unverified'),
      'replay_unavailable', (select count(*) from public.ai_enterprise_scenario_runs where run_status = 'replay_unavailable'),
      'sample_too_small', (select count(*) from public.ai_enterprise_scenario_runs where run_status = 'sample_too_small')
    ),
    'branches', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_scenario_branches),
      'completed', (select count(*) from public.ai_enterprise_scenario_branches where branch_status in ('completed_reference','completed_with_limitation')),
      'blocked', (select count(*) from public.ai_enterprise_scenario_branches where branch_status = 'blocked_reference'),
      'pruned', (select count(*) from public.ai_enterprise_scenario_branches where branch_status = 'pruned_reference'),
      'base_case', (select count(*) from public.ai_enterprise_scenario_branches where future_case_type = 'base_case_candidate'),
      'best_case', (select count(*) from public.ai_enterprise_scenario_branches where future_case_type = 'best_case_candidate'),
      'worst_case', (select count(*) from public.ai_enterprise_scenario_branches where future_case_type = 'worst_case_candidate'),
      'no_action', (select count(*) from public.ai_enterprise_scenario_branches where future_case_type = 'no_action_candidate')
    ),
    'scenario_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_scenario_events),
      'replays_completed', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'replay_completed_reference'),
      'replay_partial', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'replay_completed_reference' and payload->>'result' = 'replay_partial'),
      'timeline_steps', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'timeline_step_recorded'),
      'decision_points', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'decision_point_recorded'),
      'multi_future_sets', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'multi_future_generated_reference'),
      'comparisons', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'scenario_comparison_created'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'tradeoff_reviewed'),
      'robustness_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'robustness_reviewed'),
      'regret_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'regret_reviewed'),
      'common_risks', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'common_risk_reviewed'),
      'common_safe_conditions', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'common_safe_condition_reviewed'),
      'recommendations', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'scenario_recommendation_recorded'),
      'human_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'human_scenario_review_recorded'),
      'decision_references', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'decision_reference_recorded'),
      'outcome_links', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'observed_outcome_linked'),
      'accuracy_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'accuracy_candidate_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_scenario_events where event_type = 'drift_candidate_reviewed')
    ),
    -- Replay 원천 실측(전부 읽기 전용):
    'replay_actuals', jsonb_build_object(
      'runtime_events_0536', (select count(*) from public.ai_runtime_execution_events),
      'incidents_0502', (select count(*) from public.ai_incidents),
      'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates),
      'postmortems_0538', (select count(*) from public.ai_runtime_postmortems),
      'policy_simulation_runs_0539', (select count(*) from public.ai_policy_simulation_runs),
      'twin_runs_0540', (select count(*) from public.ai_enterprise_twin_runs),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'post_change_observations_0506', (select count(*) from public.ai_post_change_observations),
      'commitment_events_0520', (select count(*) from public.ai_commitment_events),
      'capacity_metrics_0508', (select count(*) from public.ai_capacity_metrics),
      'cost_models_0508', (select count(*) from public.ai_cost_models)
    ),
    'scenario_unavailable', jsonb_build_array('true_probability_model','chaos_engine','failure_injection_engine','production_replay_engine','provider_state_feed','region_outage_feed','human_absence_calendar'),   -- 원본 없음(실측)
    'scenario_is_not_reality', true, 'replay_is_not_reoccurrence', true, 'prediction_is_not_future_fact', true,
    'branch_probability_is_not_true_probability', true, 'robust_option_is_not_correct_option', true,
    'lowest_regret_is_not_best_decision', true, 'comparison_is_not_automatic_ranking', true,
    'simulation_is_not_execution', true, 'no_auto_decision', true, 'no_auto_execution', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_scenario_audit(p_limit int default 100)
returns setof public.ai_enterprise_scenario_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_scenario_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_scenario_templates enable row level security;
alter table public.ai_enterprise_scenario_runs enable row level security;
alter table public.ai_enterprise_scenario_branches enable row level security;
alter table public.ai_enterprise_scenario_events enable row level security;

comment on table public.ai_enterprise_scenario_templates is 'AI-OPS-38 — Scenario Template(실행 정의 아님·금지 도메인 13종 차단·Versioning·approved_for_replay ≠ 실행 승인).';
comment on table public.ai_enterprise_scenario_runs is 'AI-OPS-38 — Scenario Run(Simulation ≠ Execution·미실행 completed 차단·금지 run_mode 5종 차단·Timeline/Comparison/Trade-off/Robustness/Regret/Outcome JSONB 통합).';
comment on table public.ai_enterprise_scenario_branches is 'AI-OPS-38 — Scenario Branch(Depth≤6·Count≤100·근거 없는 확률 차단·Branch ≠ Actual Future).';
comment on table public.ai_enterprise_scenario_events is 'AI-OPS-38 — Scenario 이벤트 29종(Recommendation ≠ Decision·자동 실행 없음).';
