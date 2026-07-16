-- 0539_admin_ai_policy_simulation_rollout.sql
-- Phase AI-OPS-36 — Enterprise Policy Simulation, Change Impact Intelligence &
-- Human-Approved Assurance Rollout Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * Policy 실측: ai_runtime_policy_proposals(0538 — approved_reference 등 14 status),
--     ai_enterprise_policies/policy_versions(0512), ai_constitution_rules(0496 —
--     immutable), ai_governance_events(0496) — 전부 읽기 전용 참조.
--   * Rollout 실측: track_rollouts(0486)는 음악 트랙 도메인 progressive rollout 로
--     Assurance Policy 와 별개(무변경). 범용 Feature Flag/Canary/Staging/Policy Apply
--     Engine/자동 Rollout Engine 없음. Vercel Preview 환경 실존(배포 검증용).
--   * Simulation 실측: 0536 Sessions/0537 Signals·Incident Candidates 이력이
--     Historical Replay 원본. 전용 Counterfactual Model 없음 → simulation_model_unverified.
--   신규 테이블 4개(specifications/simulation_runs/rollout_plans/rollout_events) —
--   Baseline/Conflict/Compatibility/BlastRadius/Friction/Benefit/Validation/Gate/
--   Application Reference/Observation/Closure 는 이벤트(payload jsonb)와 JSONB 필드로
--   통합(baseline_snapshots/validation_plans/application_references 테이블 미생성).
--
-- Policy Simulation 정직성(전부 강제):
--   * Proposal ≠ Approved. Approved Reference ≠ Applied. Simulation ≠ Reality.
--   * Replay ≠ Future Outcome. Counterfactual ≠ Fact. Compatibility ≠ Safety.
--   * No Detected Conflict ≠ No Conflict. Plan ≠ Execution. Sandbox Pass ≠ Production Safety.
--   * Application Reference ≠ Verified Application ≠ Effectiveness.
--   * 자동 승인/적용/Threshold·Runtime Rule·Constitution·Trust·Permission·Scope 변경/
--     Rollout 시작·확대/Rollback/발송 없음. production_global·unattended·automatic
--     전략 차단. Cross-Enterprise 전개 차단.
--   * 실행하지 않은 Simulation 을 completed 로 표시하지 않음(Evidence 게이트).
--   * Unknown 유지(null→0 금지). Trigger 없음 · 삭제 RPC 금지 · 종결 재결정 차단.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Policy Change Specification(적용 아님 — 변경 명세).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_change_specifications (
  id                        uuid primary key default gen_random_uuid(),
  change_code               text not null,
  policy_proposal_id        uuid not null,
  policy_domain             text not null check (policy_domain in ('connector_governance','automation_governance','execution_gateway','runtime_preconditions','runtime_assurance','permission_validation','scope_validation','risk_evaluation','dry_run_requirement','sandbox_requirement','idempotency_requirement','timeout_policy','retry_policy','checkpoint_policy','evidence_policy','cleanup_policy','observation_policy','escalation_policy','recovery_policy','closure_policy')),
  change_type               text not null check (change_type in ('add_rule','modify_rule','disable_rule_reference','strengthen_validation','relax_validation','require_secondary_approval','remove_secondary_approval_reference','require_dry_run','require_sandbox','require_idempotency','modify_timeout','modify_retry_limit','require_checkpoint','modify_evidence_requirement','modify_cleanup_requirement','modify_observation_window','modify_escalation_rule','modify_recovery_requirement','modify_closure_requirement','insufficient_data')),
  current_policy_reference  text,
  proposed_policy_reference text,
  current_policy_snapshot   jsonb not null default '{}'::jsonb,
  proposed_policy_snapshot  jsonb not null default '{}'::jsonb,
  normalized_delta          jsonb not null default '{}'::jsonb,
  affected_execution_domains jsonb not null default '[]'::jsonb,
  affected_environment_scopes jsonb not null default '["non_production"]'::jsonb,
  affected_scope_types      jsonb not null default '[]'::jsonb,
  expected_benefit          text,
  potential_side_effects    jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  risk_level                text not null default 'risk_unverified' check (risk_level in ('negligible','low','moderate','high','critical','risk_unverified','insufficient_data')),
  reversibility_status      text not null default 'rollback_unverified',
  rollback_reference_required boolean not null default true,
  validation_required       boolean not null default true,
  simulation_required       boolean not null default true,
  observation_required      boolean not null default true,
  specification_status      text not null default 'draft' check (specification_status in ('draft','pending_evidence','pending_review','reviewed_reference','approved_for_simulation_reference','simulation_blocked','validation_pending','rollout_plan_pending','rejected','invalidated','insufficient_data')),
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_pcs_idem on public.ai_policy_change_specifications (idempotency_key) where idempotency_key is not null;
create index if not exists idx_pcs_status on public.ai_policy_change_specifications (specification_status, policy_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Policy Simulation Run(실제 적용 아님 — Simulation ≠ Reality).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_simulation_runs (
  id                        uuid primary key default gen_random_uuid(),
  simulation_code           text not null,
  policy_change_specification_id uuid not null,
  simulation_type           text not null check (simulation_type in ('historical_replay','counterfactual','conflict_check','compatibility_check','blast_radius_analysis','operational_friction_analysis','safety_benefit_analysis','combined_assessment')),
  simulation_status         text not null default 'draft' check (simulation_status in ('draft','pending_review','running_reference','completed_reference','completed_with_limitation','blocked_reference','failed_reference','simulation_unverified','sample_too_small','insufficient_data')),
  simulation_scope_type     text not null default 'global' check (simulation_scope_type in ('global','enterprise','brand','store','user')),
  simulation_scope_id       text,
  baseline_snapshot_reference jsonb not null default '{}'::jsonb,
  input_dataset_reference   text,
  input_hash                text,
  sample_size               int check (sample_size is null or sample_size >= 0),
  replay_result             jsonb,
  counterfactual_result     jsonb,
  conflict_result           jsonb,
  compatibility_result      jsonb,
  blast_radius_result       jsonb,
  friction_result           jsonb,
  safety_benefit_result     jsonb,
  expected_changes          jsonb not null default '[]'::jsonb,
  expected_side_effects     jsonb not null default '[]'::jsonb,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  simulated_by              uuid,
  reviewed_by               uuid,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now()
);
create unique index if not exists uq_psr_idem on public.ai_policy_simulation_runs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_psr_spec on public.ai_policy_simulation_runs (policy_change_specification_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Controlled Rollout Plan(계획 ≠ 실행 — 자동 Rollout/확대/Rollback 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_rollout_plans (
  id                        uuid primary key default gen_random_uuid(),
  rollout_code              text not null,
  policy_change_specification_id uuid not null,
  policy_simulation_run_id  uuid not null,
  rollout_strategy          text not null check (rollout_strategy in ('reference_only','preview_validation','sandbox_validation','non_production_pilot','enterprise_limited_reference','brand_limited_reference','store_limited_reference','manual_application_reference')),
  rollout_status            text not null default 'draft' check (rollout_status in ('draft','pending_simulation','simulation_blocked','pending_validation','validation_unverified','pending_review','approval_missing','approved_reference','ready_for_manual_application_reference','application_reference_recorded','application_unverified','observation_pending','observation_in_progress_reference','closure_pending','closed_reference','closed_with_limitation','rejected','cancelled','invalidated','insufficient_data')),
  environment_scope         text not null default 'non_production' check (environment_scope in ('non_production','sandbox','reference_only')),
  target_scope_type         text not null default 'store' check (target_scope_type in ('enterprise','brand','store','user')),
  target_scope_ids          jsonb not null default '[]'::jsonb,
  excluded_scope_ids        jsonb not null default '[]'::jsonb,
  rollout_stages            jsonb not null default '[]'::jsonb,
  stage_entry_criteria      jsonb not null default '[]'::jsonb,
  stage_exit_criteria       jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  rollback_conditions       jsonb not null default '[]'::jsonb,
  observation_windows       jsonb not null default '[]'::jsonb,
  evidence_requirements     jsonb not null default '[]'::jsonb,
  assigned_reviewers        jsonb not null default '[]'::jsonb,
  estimated_blast_radius    text not null default 'blast_radius_unverified',
  estimated_operational_friction text not null default 'friction_unverified',
  expected_benefit          text,
  potential_side_effects    jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  approved_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_prp_idem on public.ai_policy_rollout_plans (idempotency_key) where idempotency_key is not null;
create index if not exists idx_prp_status on public.ai_policy_rollout_plans (rollout_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Rollout 이벤트(27종) — Baseline/Conflict/Compatibility/Blast/Friction/
--    Benefit/Validation/Gate/Application/Observation/Closure 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_rollout_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('change_specification_created','change_specification_reviewed','baseline_snapshot_recorded','historical_replay_started_reference','historical_replay_completed_reference','counterfactual_simulation_started_reference','counterfactual_simulation_completed_reference','policy_conflict_reviewed','compatibility_reviewed','blast_radius_reviewed','operational_friction_reviewed','safety_benefit_reviewed','validation_plan_created','validation_evidence_recorded','rollout_plan_created','rollout_plan_reviewed','rollout_approval_reference_recorded','rollout_gate_reviewed','policy_application_reference_recorded','policy_application_verified_reference','post_rollout_observation_started_reference','post_rollout_observation_completed_reference','unexpected_effect_detected','rollout_pause_review_requested','rollback_review_requested','rollout_closure_reviewed','rollout_invalidated')),
  policy_change_specification_id uuid,
  policy_simulation_run_id  uuid,
  policy_rollout_plan_id    uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_pre_evt on public.ai_policy_rollout_events (event_type, created_at desc);
create index if not exists idx_pre_evt_plan on public.ai_policy_rollout_events (policy_rollout_plan_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Change Specification 생성/검토(적용 아님).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_change_specification_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_prop uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_policy_change_specifications;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_prop := nullif(p_payload->>'policy_proposal_id','')::uuid;
  if v_prop is null or not exists (select 1 from public.ai_runtime_policy_proposals where id = v_prop) then
    raise exception 'Policy Proposal(0538) 없음(실존 검증 실패)';
  end if;
  if coalesce(p_payload->>'policy_domain','') in ('constitution_mutation','trust_formula_mutation','authentication_mutation','rls_mutation','payment_policy_mutation','settlement_policy_mutation','contract_policy_mutation','pricing_policy_mutation','production_infrastructure_mutation','secret_policy_mutation','destructive_data_policy_mutation','employee_policy_mutation') then
    raise exception '금지된 policy domain(초기 Phase 비활성)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_policy_change_specifications where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'policy_applied', false); end if;
  end if;
  insert into public.ai_policy_change_specifications (change_code, policy_proposal_id, policy_domain, change_type, current_policy_reference, proposed_policy_reference, current_policy_snapshot, proposed_policy_snapshot, normalized_delta, affected_execution_domains, affected_environment_scopes, affected_scope_types, expected_benefit, potential_side_effects, assumptions, unknown_factors, limitations, risk_level, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'change_code',''), 'PCS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_prop, p_payload->>'policy_domain', coalesce(nullif(p_payload->>'change_type',''), 'insufficient_data'),
    left(coalesce(p_payload->>'current_policy_reference',''), 200), left(coalesce(p_payload->>'proposed_policy_reference',''), 200),
    coalesce(p_payload->'current_policy_snapshot', '{}'::jsonb), coalesce(p_payload->'proposed_policy_snapshot', '{}'::jsonb), coalesce(p_payload->'normalized_delta', '{}'::jsonb),
    coalesce(p_payload->'affected_execution_domains', '[]'::jsonb), coalesce(p_payload->'affected_environment_scopes', '["non_production"]'::jsonb), coalesce(p_payload->'affected_scope_types', '[]'::jsonb),
    left(coalesce(p_payload->>'expected_benefit',''), 500), coalesce(p_payload->'potential_side_effects', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    coalesce(nullif(p_payload->>'risk_level',''), 'risk_unverified'), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, detail, payload, actor_id)
  values ('change_specification_created', v_id, left(coalesce(p_payload->>'change_type',''), 80) || ' (Specification ≠ Application — draft 시작)', jsonb_build_object('domain', p_payload->>'policy_domain'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'specification_is_not_application', true, 'policy_applied', false, 'threshold_changed', false);
end $$;

create or replace function public.admin_policy_change_specification_review(p_spec_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_policy_change_specifications; v_next text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','mark_reviewed','approve_for_simulation','mark_simulation_blocked','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_policy_change_specifications where id = p_spec_id;
  if v_row.id is null then raise exception 'Change Specification 없음(실존 검증 실패)'; end if;
  if v_row.specification_status in ('rejected','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.specification_status; end if;
  if v_row.created_by = v_uid and p_action = 'approve_for_simulation' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action = 'approve_for_simulation' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인 금지';
    end if;
    v_next := 'approved_for_simulation_reference';
    v_note := v_note || ' (Simulation 승인 ≠ 적용 승인)';
  elsif p_action = 'mark_simulation_blocked' then v_next := 'simulation_blocked';
  elsif p_action = 'reject' then v_next := 'rejected';
  else v_next := 'invalidated';
  end if;

  update public.ai_policy_change_specifications set specification_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_spec_id;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, detail, payload, actor_id)
  values (case when p_action = 'invalidate' then 'rollout_invalidated' else 'change_specification_reviewed' end,
    p_spec_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_spec_id, 'status', v_next, 'policy_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Simulation Run 기록 — 미실행 completed 금지(Evidence 게이트)·승인 선행.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_simulation_run_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_spec public.ai_policy_change_specifications; v_status text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_policy_simulation_runs; v_conf int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_spec from public.ai_policy_change_specifications where id = nullif(p_payload->>'policy_change_specification_id','')::uuid;
  if v_spec.id is null then raise exception 'Change Specification 없음(실존 검증 실패)'; end if;
  if v_spec.specification_status <> 'approved_for_simulation_reference' then
    raise exception 'specification_unreviewed: approved_for_simulation_reference 상태에서만 Simulation 기록 가능';
  end if;
  v_status := coalesce(nullif(p_payload->>'simulation_status',''), 'draft');
  -- 실행하지 않은 Simulation 을 completed 로 표시하지 않음 — Evidence + started/completed 필수.
  if v_status in ('completed_reference','completed_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed Simulation 금지(simulation_unverified)';
    end if;
    if nullif(p_payload->>'started_at','') is null then raise exception 'started_at 없는 completed Simulation 금지'; end if;
  end if;
  if coalesce((p_payload->>'sample_size')::int, 0) < 0 then raise exception '음수 sample_size 차단'; end if;
  v_conf := case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end;
  if v_idem is not null then
    select * into v_existing from public.ai_policy_simulation_runs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'simulation_is_not_reality', true); end if;
  end if;
  insert into public.ai_policy_simulation_runs (simulation_code, policy_change_specification_id, simulation_type, simulation_status, simulation_scope_type, simulation_scope_id, baseline_snapshot_reference, input_dataset_reference, input_hash, sample_size, replay_result, counterfactual_result, conflict_result, compatibility_result, blast_radius_result, friction_result, safety_benefit_result, expected_changes, expected_side_effects, confidence, evidence, limitations, idempotency_key, simulated_by, started_at, completed_at)
  values (left(coalesce(nullif(p_payload->>'simulation_code',''), 'SIM-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_spec.id, p_payload->>'simulation_type', v_status,
    coalesce(nullif(p_payload->>'simulation_scope_type',''), 'global'), nullif(p_payload->>'simulation_scope_id',''),
    coalesce(p_payload->'baseline_snapshot_reference', '{}'::jsonb), left(coalesce(p_payload->>'input_dataset_reference',''), 200), nullif(p_payload->>'input_hash',''),
    nullif(p_payload->>'sample_size','')::int,
    p_payload->'replay_result', p_payload->'counterfactual_result', p_payload->'conflict_result', p_payload->'compatibility_result',
    p_payload->'blast_radius_result', p_payload->'friction_result', p_payload->'safety_benefit_result',
    coalesce(p_payload->'expected_changes', '[]'::jsonb), coalesce(p_payload->'expected_side_effects', '[]'::jsonb),
    v_conf, coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid,
    nullif(p_payload->>'started_at','')::timestamptz, nullif(p_payload->>'completed_at','')::timestamptz)
  returning id into v_id;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, policy_simulation_run_id, detail, payload, actor_id)
  values (case when p_payload->>'simulation_type' = 'historical_replay' then 'historical_replay_completed_reference'
    when p_payload->>'simulation_type' = 'counterfactual' then 'counterfactual_simulation_completed_reference'
    else 'counterfactual_simulation_started_reference' end,
    v_spec.id, v_id, left(coalesce(p_payload->>'simulation_type',''), 80) || ' (Simulation ≠ Reality·Replay ≠ Future Outcome)', jsonb_build_object('status', v_status), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'simulation_is_not_reality', true, 'counterfactual_is_not_fact', true, 'policy_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Rollout Plan 생성/검토 — 금지 전략·Cross-Enterprise·Production 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_rollout_plan_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_spec uuid; v_sim public.ai_policy_simulation_runs; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_policy_rollout_plans;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_spec := nullif(p_payload->>'policy_change_specification_id','')::uuid;
  if v_spec is null or not exists (select 1 from public.ai_policy_change_specifications where id = v_spec) then
    raise exception 'Change Specification 없음(실존 검증 실패)';
  end if;
  select * into v_sim from public.ai_policy_simulation_runs where id = nullif(p_payload->>'policy_simulation_run_id','')::uuid;
  if v_sim.id is null then raise exception 'Simulation Run 없음(실존 검증 실패)'; end if;
  if coalesce(p_payload->>'rollout_strategy','') in ('production_global','unattended_rollout','automatic_expansion','automatic_rollback','cross_enterprise_rollout') then
    raise exception '금지된 rollout strategy(초기 Phase 차단)';
  end if;
  if coalesce(p_payload->>'environment_scope','') = 'production' then raise exception 'production environment 차단'; end if;
  if jsonb_array_length(coalesce(p_payload->'target_scope_ids', '[]'::jsonb)) > 50 then raise exception 'target scope 50개 초과(광역 전개 차단)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_policy_rollout_plans where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'rollout_started', false); end if;
  end if;
  insert into public.ai_policy_rollout_plans (rollout_code, policy_change_specification_id, policy_simulation_run_id, rollout_strategy, environment_scope, target_scope_type, target_scope_ids, excluded_scope_ids, rollout_stages, stage_entry_criteria, stage_exit_criteria, stop_conditions, rollback_conditions, observation_windows, evidence_requirements, assigned_reviewers, estimated_blast_radius, estimated_operational_friction, expected_benefit, potential_side_effects, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'rollout_code',''), 'ROLL-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_spec, v_sim.id, p_payload->>'rollout_strategy',
    coalesce(nullif(p_payload->>'environment_scope',''), 'non_production'),
    coalesce(nullif(p_payload->>'target_scope_type',''), 'store'),
    coalesce(p_payload->'target_scope_ids', '[]'::jsonb), coalesce(p_payload->'excluded_scope_ids', '[]'::jsonb),
    coalesce(p_payload->'rollout_stages', '[]'::jsonb), coalesce(p_payload->'stage_entry_criteria', '[]'::jsonb), coalesce(p_payload->'stage_exit_criteria', '[]'::jsonb),
    coalesce(p_payload->'stop_conditions', '[]'::jsonb), coalesce(p_payload->'rollback_conditions', '[]'::jsonb),
    coalesce(p_payload->'observation_windows', '[]'::jsonb), coalesce(p_payload->'evidence_requirements', '[]'::jsonb), coalesce(p_payload->'assigned_reviewers', '[]'::jsonb),
    left(coalesce(nullif(p_payload->>'estimated_blast_radius',''), 'blast_radius_unverified'), 40), left(coalesce(nullif(p_payload->>'estimated_operational_friction',''), 'friction_unverified'), 60),
    left(coalesce(p_payload->>'expected_benefit',''), 500), coalesce(p_payload->'potential_side_effects', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, policy_simulation_run_id, policy_rollout_plan_id, detail, payload, actor_id)
  values ('rollout_plan_created', v_spec, v_sim.id, v_id, left(coalesce(p_payload->>'rollout_strategy',''), 80) || ' (Plan ≠ Execution — draft 시작·자동 Rollout 없음)', jsonb_build_object('environment', coalesce(nullif(p_payload->>'environment_scope',''), 'non_production')), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'plan_is_not_execution', true, 'rollout_started', false, 'auto_expansion', false);
end $$;

create or replace function public.admin_policy_rollout_review(p_plan_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_policy_rollout_plans; v_sim public.ai_policy_simulation_runs; v_next text := null; v_evt text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','approve','gate_review','record_application_reference','verify_application','start_observation','complete_observation','record_unexpected_effect','request_pause_review','request_rollback_review','close','close_with_limitation','reject','cancel','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_policy_rollout_plans where id = p_plan_id;
  if v_row.id is null then raise exception 'Rollout Plan 없음(실존 검증 실패)'; end if;
  if v_row.rollout_status in ('closed_reference','closed_with_limitation','rejected','cancelled','invalidated') then
    raise exception '종결 상태 재결정 차단(%)', v_row.rollout_status;
  end if;
  if v_row.created_by = v_uid and p_action = 'approve' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review'; v_evt := 'rollout_plan_reviewed';
  elsif p_action = 'approve' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Rollout 승인 금지';
    end if;
    v_next := 'approved_reference'; v_evt := 'rollout_approval_reference_recorded';
    v_note := v_note || ' (approved_reference ≠ applied)';
    update public.ai_policy_rollout_plans set approved_by = v_uid where id = p_plan_id;
  elsif p_action = 'gate_review' then
    -- Rollout Gate(서버 강제): 승인 + Simulation completed + Stop/Rollback/Observation 정의 필수.
    if v_row.rollout_status not in ('approved_reference') then raise exception 'rollout_gate: approval_missing'; end if;
    select * into v_sim from public.ai_policy_simulation_runs where id = v_row.policy_simulation_run_id;
    if v_sim.simulation_status not in ('completed_reference','completed_with_limitation') then raise exception 'rollout_gate: simulation_missing(completed 아님)'; end if;
    if jsonb_array_length(v_row.stop_conditions) = 0 then raise exception 'rollout_gate: stop_condition_missing'; end if;
    if jsonb_array_length(v_row.rollback_conditions) = 0 then raise exception 'rollout_gate: rollback_unverified(조건 미정의)'; end if;
    if jsonb_array_length(v_row.observation_windows) = 0 then raise exception 'rollout_gate: observation_plan_missing'; end if;
    if jsonb_array_length(v_row.assigned_reviewers) = 0 then raise exception 'rollout_gate: reviewer_missing'; end if;
    v_next := 'ready_for_manual_application_reference'; v_evt := 'rollout_gate_reviewed';
    v_note := ' (ready ≠ applied — 수동 Application Reference 만 허용)';
  elsif p_action = 'record_application_reference' then
    if v_row.rollout_status <> 'ready_for_manual_application_reference' then raise exception 'gate ready 상태에서만 Application Reference 기록 가능'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Application Reference 금지(application_unverified)';
    end if;
    if length(coalesce(p_payload->>'external_reference_url','')) > 500 then raise exception 'External Reference 길이 초과'; end if;
    v_next := 'application_reference_recorded'; v_evt := 'policy_application_reference_recorded';
    v_note := ' (Reference ≠ 실제 적용 성공 — 원본 Policy 미변경)';
  elsif p_action = 'verify_application' then
    if v_row.rollout_status not in ('application_reference_recorded','application_unverified') then raise exception 'Application Reference 기록 없이 검증 불가'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Application 검증 금지';
    end if;
    v_next := 'observation_pending'; v_evt := 'policy_application_verified_reference';
    v_note := ' (Verified Application ≠ Effectiveness)';
  elsif p_action = 'start_observation' then
    if v_row.rollout_status not in ('observation_pending','application_reference_recorded','application_unverified') then raise exception 'Application 기록 없이 관측 불가'; end if;
    v_next := 'observation_in_progress_reference'; v_evt := 'post_rollout_observation_started_reference';
  elsif p_action = 'complete_observation' then
    if coalesce(p_payload->>'observation','') not in ('expected_effect_candidate','mixed_effect_candidate','adverse_effect_candidate','no_material_change_candidate','effectiveness_unverified','causality_unverified','sample_too_small','stale_input_candidate','insufficient_data') then
      raise exception '허용되지 않는 observation 결과';
    end if;
    v_next := 'closure_pending'; v_evt := 'post_rollout_observation_completed_reference';
    v_note := ' (Observation ≠ Causality)';
  elsif p_action = 'record_unexpected_effect' then v_evt := 'unexpected_effect_detected';
  elsif p_action = 'request_pause_review' then v_evt := 'rollout_pause_review_requested';
  elsif p_action = 'request_rollback_review' then v_evt := 'rollback_review_requested'; v_note := ' (Rollback 검토 요청 — 자동 Rollback 없음)';
  elsif p_action in ('close','close_with_limitation') then
    if v_row.rollout_status <> 'closure_pending' then raise exception '관측 완료 없는 Closure 금지(observation_pending)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Closure 금지';
    end if;
    v_next := case when p_action = 'close' then 'closed_reference' else 'closed_with_limitation' end;
    v_evt := 'rollout_closure_reviewed';
    v_note := ' (Closure ≠ Outcome Achievement)';
  elsif p_action = 'reject' then v_next := 'rejected'; v_evt := 'rollout_plan_reviewed';
  elsif p_action = 'cancel' then v_next := 'cancelled'; v_evt := 'rollout_plan_reviewed';
  else v_next := 'invalidated'; v_evt := 'rollout_invalidated';
  end if;

  if v_next is not null then
    update public.ai_policy_rollout_plans set rollout_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_plan_id;
  end if;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, policy_simulation_run_id, policy_rollout_plan_id, detail, payload, actor_id)
  values (v_evt, v_row.policy_change_specification_id, v_row.policy_simulation_run_id, p_plan_id,
    left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.rollout_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_plan_id, 'status', coalesce(v_next, v_row.rollout_status), 'policy_applied', false, 'rollout_executed', false, 'auto_expansion', false, 'auto_rollback', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Rollout 이벤트 기록(통합) — Baseline/Conflict/Compatibility/Blast/
--    Friction/Benefit/Validation 검토.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_rollout_event_record(p_kind text, p_reason text, p_payload jsonb, p_spec_id uuid default null, p_sim_id uuid default null, p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('baseline_snapshot_recorded','historical_replay_started_reference','policy_conflict_reviewed','compatibility_reviewed','blast_radius_reviewed','operational_friction_reviewed','safety_benefit_reviewed','validation_plan_created','validation_evidence_recorded','unexpected_effect_detected') then
    raise exception '허용되지 않는 kind(생성/검토/승인/적용은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_spec_id is not null and not exists (select 1 from public.ai_policy_change_specifications where id = p_spec_id) then raise exception 'Specification 없음(실존 검증 실패)'; end if;
  if p_sim_id is not null and not exists (select 1 from public.ai_policy_simulation_runs where id = p_sim_id) then raise exception 'Simulation Run 없음(실존 검증 실패)'; end if;
  if p_plan_id is not null and not exists (select 1 from public.ai_policy_rollout_plans where id = p_plan_id) then raise exception 'Rollout Plan 없음(실존 검증 실패)'; end if;
  if p_kind = 'baseline_snapshot_recorded' and coalesce((p_payload->>'sample_size')::int, 0) < 0 then raise exception '음수 sample_size 차단'; end if;
  if p_kind = 'policy_conflict_reviewed' and coalesce(p_payload->>'result','') not in ('no_conflict_detected_reference','constitution_conflict_candidate','governance_conflict_candidate','security_conflict_candidate','privacy_conflict_candidate','compliance_conflict_candidate','permission_conflict_candidate','scope_conflict_candidate','connector_conflict_candidate','automation_conflict_candidate','environment_conflict_candidate','duplicate_rule_candidate','circular_dependency_candidate','contradictory_requirement_candidate','impossible_precondition_candidate','conflict_unverified','insufficient_data') then
    raise exception '허용되지 않는 conflict result';
  end if;
  insert into public.ai_policy_rollout_events (event_type, policy_change_specification_id, policy_simulation_run_id, policy_rollout_plan_id, detail, payload, actor_id)
  values (p_kind, p_spec_id, p_sim_id, p_plan_id,
    left(p_reason, 200) || case
      when p_kind = 'baseline_snapshot_recorded' then ' (Baseline ≠ 미래 결과 보장)'
      when p_kind = 'policy_conflict_reviewed' then ' (No Detected Conflict ≠ No Conflict)'
      when p_kind = 'compatibility_reviewed' then ' (Compatibility ≠ Safety)'
      when p_kind = 'blast_radius_reviewed' then ' (Estimate ≠ Actual Impact)'
      when p_kind = 'operational_friction_reviewed' then ' (Friction Estimate ≠ UX Fact)'
      when p_kind = 'safety_benefit_reviewed' then ' (Benefit Candidate ≠ Actual Benefit)'
      when p_kind = 'validation_evidence_recorded' then ' (Validation Plan ≠ Validation Success·Sandbox Pass ≠ Production Safety)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'policy_applied', false, 'rollout_executed', false, 'auto_action_taken', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용 — 0538/0512/0496 원본 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_change_specifications(p_status text default null, p_limit int default 100)
returns setof public.ai_policy_change_specifications language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_change_specifications s
    where (p_status is null or s.specification_status = p_status)
    order by s.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_policy_simulation_runs(p_status text default null, p_limit int default 100)
returns setof public.ai_policy_simulation_runs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_simulation_runs r
    where (p_status is null or r.simulation_status = p_status)
    order by r.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_policy_rollout_plans(p_status text default null, p_limit int default 100)
returns setof public.ai_policy_rollout_plans language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_rollout_plans p
    where (p_status is null or p.rollout_status = p_status)
    order by p.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_policy_simulation_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'specifications', jsonb_build_object(
      'total', (select count(*) from public.ai_policy_change_specifications),
      'draft', (select count(*) from public.ai_policy_change_specifications where specification_status = 'draft'),
      'pending_review', (select count(*) from public.ai_policy_change_specifications where specification_status = 'pending_review'),
      'approved_for_simulation', (select count(*) from public.ai_policy_change_specifications where specification_status = 'approved_for_simulation_reference'),
      'simulation_blocked', (select count(*) from public.ai_policy_change_specifications where specification_status = 'simulation_blocked')
    ),
    'simulations', jsonb_build_object(
      'total', (select count(*) from public.ai_policy_simulation_runs),
      'completed', (select count(*) from public.ai_policy_simulation_runs where simulation_status in ('completed_reference','completed_with_limitation')),
      'blocked', (select count(*) from public.ai_policy_simulation_runs where simulation_status = 'blocked_reference'),
      'unverified', (select count(*) from public.ai_policy_simulation_runs where simulation_status = 'simulation_unverified'),
      'sample_too_small', (select count(*) from public.ai_policy_simulation_runs where simulation_status = 'sample_too_small')
    ),
    'rollouts', jsonb_build_object(
      'total', (select count(*) from public.ai_policy_rollout_plans),
      'draft', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'draft'),
      'pending_review', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'pending_review'),
      'approval_missing', (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('draft','pending_simulation','pending_validation','pending_review','approval_missing')),
      'approved', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'approved_reference'),
      'gate_ready', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'ready_for_manual_application_reference'),
      'application_recorded', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'application_reference_recorded'),
      'application_unverified', (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('application_reference_recorded','application_unverified')),
      'observation_pending', (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('observation_pending','observation_in_progress_reference')),
      'closure_pending', (select count(*) from public.ai_policy_rollout_plans where rollout_status = 'closure_pending'),
      'closed', (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('closed_reference','closed_with_limitation'))
    ),
    'rollout_events', jsonb_build_object(
      'total', (select count(*) from public.ai_policy_rollout_events),
      'baselines', (select count(*) from public.ai_policy_rollout_events where event_type = 'baseline_snapshot_recorded'),
      'conflict_reviews', (select count(*) from public.ai_policy_rollout_events where event_type = 'policy_conflict_reviewed'),
      'conflict_candidates', (select count(*) from public.ai_policy_rollout_events where event_type = 'policy_conflict_reviewed' and payload->>'result' like '%conflict_candidate'),
      'compatibility_reviews', (select count(*) from public.ai_policy_rollout_events where event_type = 'compatibility_reviewed'),
      'validation_evidence', (select count(*) from public.ai_policy_rollout_events where event_type = 'validation_evidence_recorded'),
      'unexpected_effects', (select count(*) from public.ai_policy_rollout_events where event_type = 'unexpected_effect_detected'),
      'rollback_reviews', (select count(*) from public.ai_policy_rollout_events where event_type = 'rollback_review_requested')
    ),
    -- 원본 실측(전부 읽기 전용):
    'policy_actuals', jsonb_build_object(
      'proposals_0538', (select count(*) from public.ai_runtime_policy_proposals),
      'proposals_approved_0538', (select count(*) from public.ai_runtime_policy_proposals where proposal_status in ('approved_reference','approved_with_limitation')),
      'policy_versions_0512', (select count(*) from public.ai_enterprise_policy_versions),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules where is_active),
      'constitution_immutable_0496', (select count(*) from public.ai_constitution_rules where immutable),
      'runtime_sessions_0536', (select count(*) from public.ai_runtime_execution_sessions),
      'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates)
    ),
    'simulation_unavailable', jsonb_build_array('counterfactual_model_engine','feature_flag_system','canary_infrastructure','staging_environment','policy_apply_engine','automatic_rollout_engine','provider_state_feed'),   -- 원본 없음(실측)
    'simulation_available_reference', jsonb_build_array('runtime_history_0536_0537','policy_versions_0512','constitution_rules_0496','vercel_preview_environment'),
    'no_auto_policy_approval', true, 'no_auto_policy_application', true, 'no_auto_threshold_change', true, 'no_auto_rollout', true,
    'no_auto_rollout_expansion', true, 'no_auto_rollback', true, 'no_constitution_trust_permission_scope_mutation', true,
    'simulation_is_not_reality', true, 'replay_is_not_future_outcome', true, 'compatibility_is_not_safety', true,
    'no_detected_conflict_is_not_no_conflict', true, 'application_reference_is_not_verified', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_policy_rollout_audit(p_limit int default 100)
returns setof public.ai_policy_rollout_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_rollout_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_policy_change_specifications enable row level security;
alter table public.ai_policy_simulation_runs enable row level security;
alter table public.ai_policy_rollout_plans enable row level security;
alter table public.ai_policy_rollout_events enable row level security;

comment on table public.ai_policy_change_specifications is 'AI-OPS-36 — Policy Change Specification(적용 아님·금지 도메인 12종 차단·approved_for_simulation ≠ 적용 승인·종결 재결정 차단).';
comment on table public.ai_policy_simulation_runs is 'AI-OPS-36 — Policy Simulation Run(Simulation ≠ Reality — 미실행 completed 차단·spec 승인 선행 필수).';
comment on table public.ai_policy_rollout_plans is 'AI-OPS-36 — Controlled Rollout Plan(Plan ≠ Execution·production_global/unattended/automatic/cross-enterprise 전략 차단·Gate: 승인+Simulation completed+Stop/Rollback/Observation/Reviewer 필수).';
comment on table public.ai_policy_rollout_events is 'AI-OPS-36 — Rollout Audit(27종 — Baseline/Conflict/Compatibility/Blast/Friction/Benefit/Validation/Gate/Application/Observation/Closure 통합·실제 Policy 원본 미변경).';
