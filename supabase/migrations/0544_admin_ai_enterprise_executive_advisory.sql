-- 0544_admin_ai_enterprise_executive_advisory.sql
-- AI-OPS-40 — Autonomous Executive Advisory, Decision Synthesis &
-- Human Approval Center.
--
-- Enterprise State → Scenario Options → Forecast Risk → Early Warning Candidates →
-- Policy Constraints → Impact Synthesis → Decision History → Observed Outcomes →
-- Multi-Agent Advisory Inputs → Executive Decision Context → Decision Option Synthesis →
-- Trade-off Explanation → Risk/Opportunity/Reversibility Review →
-- Executive Recommendation Candidate → Human Executive Review →
-- Approve/Reject/Defer/Request Revision → Decision Reference → Commitment Reference →
-- Observed Outcome Link → Decision Quality Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Advisory ≠ Decision. Recommendation Candidate ≠ Approved Recommendation.
--  * Executive Brief ≠ Executive Approval. Option ≠ Selected Option.
--  * Approval Reference ≠ Applied Change(production_applied 항상 false).
--  * Agent Agreement ≠ Truth. Agent Majority ≠ Correctness. Agent Conflict ≠ Error.
--  * Evidence Volume ≠ Evidence Quality. Confidence ≠ Correctness.
--  * Outcome Link ≠ Decision Causality. Decision Quality Candidate ≠ Verified Quality.
--  * 자동 Decision/승인/거절/최종 선택/Commitment 확정/Policy 적용/Payment/Settlement·
--    Contract·Pricing·Infrastructure·Production 변경 — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496~0543 원본 무변경(참조만).
--  * Executive Review/Decision Reference/Commitment Reference/Outcome Reference/
--    Quality/Drift/Learning 은 신규 테이블 대신 Events + Context JSONB 통합(후보 7 → 4 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Executive Decision Context(실제 의사결정 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_decision_contexts (
  id                        uuid primary key default gen_random_uuid(),
  decision_code             text not null,
  decision_title            text not null,
  decision_domain           text not null check (decision_domain in ('operational_risk','incident_response','runtime_reliability','connector_governance','automation_governance','agent_governance','policy_change','security_risk','privacy_risk','compliance_risk','capacity_planning','cost_management','resource_allocation','approval_bottleneck','recovery_strategy','enterprise_growth','new_enterprise_onboarding','new_connector_adoption','rollout_strategy','contract_risk_reference','settlement_impact_reference','payment_impact_reference','customer_experience','store_operations','organizational_workload','strategic_priority','custom_reference')),
  decision_type             text,
  decision_status           text not null default 'draft' check (decision_status in ('draft','pending_evidence','pending_advisory','pending_review','ready_for_executive_review_reference','under_executive_review','revision_requested','deferred_reference','approved_reference','rejected_reference','superseded','invalidated','outcome_pending','closed_reference','closed_with_limitation','insufficient_data')),
  priority_candidate        text not null default 'priority_unverified' check (priority_candidate in ('informational_candidate','low_candidate','normal_candidate','high_candidate','critical_candidate','priority_unverified','insufficient_data')),
  urgency_candidate         text not null default 'urgency_unverified' check (urgency_candidate in ('no_deadline_candidate','routine_candidate','time_sensitive_candidate','urgent_candidate','immediate_review_candidate','urgency_unverified','insufficient_data')),
  decision_scope_type       text not null default 'enterprise' check (decision_scope_type in ('global','enterprise','brand','store','connector','automation','agent')),
  decision_scope_id         text,
  executive_owner_role_candidate text,
  required_reviewer_roles   jsonb not null default '[]'::jsonb,
  decision_deadline_reference timestamptz,
  decision_question         text,
  context_summary           text,
  current_state_reference   jsonb,
  enterprise_snapshot_id    uuid,
  twin_run_references       jsonb not null default '[]'::jsonb,
  scenario_run_references   jsonb not null default '[]'::jsonb,
  forecast_run_references   jsonb not null default '[]'::jsonb,
  warning_candidate_references jsonb not null default '[]'::jsonb,
  incident_references       jsonb not null default '[]'::jsonb,
  policy_references         jsonb not null default '[]'::jsonb,
  commitment_references     jsonb not null default '[]'::jsonb,
  previous_decision_references jsonb not null default '[]'::jsonb,
  outcome_references        jsonb not null default '[]'::jsonb,
  knowledge_entity_references jsonb not null default '[]'::jsonb,
  agent_advisory_references jsonb not null default '[]'::jsonb,
  advisory_synthesis        jsonb,
  agent_agreement_result    jsonb,
  agent_conflict_result     jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  missing_evidence          jsonb not null default '[]'::jsonb,
  conflicting_evidence      jsonb not null default '[]'::jsonb,
  stale_evidence            jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  policy_constraints        jsonb not null default '[]'::jsonb,
  constitutional_constraints jsonb not null default '[]'::jsonb,
  compliance_constraints    jsonb not null default '[]'::jsonb,
  contract_constraints      jsonb not null default '[]'::jsonb,
  financial_constraints     jsonb not null default '[]'::jsonb,
  operational_constraints   jsonb not null default '[]'::jsonb,
  impact_synthesis          jsonb,
  executive_reviews         jsonb not null default '[]'::jsonb,
  decision_reference        jsonb,
  outcome_reference         jsonb,
  decision_quality_result   jsonb,
  decision_drift_result     jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aedc_idem on public.ai_enterprise_decision_contexts (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aedc_status on public.ai_enterprise_decision_contexts (decision_status, priority_candidate, created_at desc);
create index if not exists idx_aedc_domain on public.ai_enterprise_decision_contexts (decision_domain, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Decision Option(실행 계획 아님 — Viable Candidate ≠ 선택 완료).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_decision_options (
  id                        uuid primary key default gen_random_uuid(),
  decision_context_id       uuid not null,
  option_code               text not null,
  option_name               text not null,
  option_type               text not null check (option_type in ('no_action_reference','defer_reference','gather_more_evidence_reference','monitor_reference','limited_action_reference','phased_action_reference','reversible_action_reference','policy_change_reference','rollout_reference','rollback_reference','capacity_change_reference','cost_control_reference','governance_change_reference','operational_change_reference','escalation_reference','custom_reference')),
  option_status             text not null default 'draft' check (option_status in ('draft','pending_evidence','pending_review','viable_candidate','conditionally_viable_candidate','blocked_candidate','infeasible_candidate','rejected_reference','superseded','invalidated','insufficient_data')),
  option_summary            text,
  action_reference_type     text,
  action_reference_id       text,
  is_no_action_option       boolean not null default false,
  is_defer_option           boolean not null default false,
  is_evidence_gathering_option boolean not null default false,
  assumptions               jsonb not null default '[]'::jsonb,
  preconditions             jsonb not null default '[]'::jsonb,
  dependencies              jsonb not null default '[]'::jsonb,
  blocking_conditions       jsonb not null default '[]'::jsonb,
  required_approvals        jsonb not null default '[]'::jsonb,
  expected_benefits         jsonb not null default '[]'::jsonb,
  expected_costs            jsonb not null default '[]'::jsonb,
  risk_projection           jsonb,
  opportunity_projection    jsonb,
  financial_impact          jsonb,
  capacity_impact           jsonb,
  operational_impact        jsonb,
  security_impact           jsonb,
  privacy_impact            jsonb,
  compliance_impact         jsonb,
  contract_impact           jsonb,
  settlement_impact_reference jsonb,
  payment_impact_reference  jsonb,
  customer_experience_impact jsonb,
  store_operations_impact   jsonb,
  human_workload_impact     jsonb,
  reversibility_result      jsonb,
  rollback_reference        jsonb,
  implementation_complexity_candidate text,
  operational_friction_candidate text,
  time_to_value_candidate   text,
  expected_observation_period text,
  success_conditions        jsonb not null default '[]'::jsonb,
  failure_conditions        jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  tradeoff_results          jsonb,
  robustness_result         jsonb,
  regret_result             jsonb,
  feasibility_result        jsonb,
  alternatives              jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aedo_idem on public.ai_enterprise_decision_options (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aedo_ctx on public.ai_enterprise_decision_options (decision_context_id, option_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Executive Decision Brief(Decision/Approval 아님 — 사람 검토용 설명 계층).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_executive_briefs (
  id                        uuid primary key default gen_random_uuid(),
  brief_code                text not null,
  decision_context_id       uuid not null,
  brief_version             int not null default 1 check (brief_version >= 1),
  brief_status              text not null default 'draft' check (brief_status in ('draft','pending_evidence','pending_advisory','pending_review','ready_for_executive_review_reference','under_executive_review','revision_requested','reviewed_reference','superseded','invalidated','insufficient_data')),
  executive_summary         text,
  decision_question         text,
  why_now                   text,
  current_state             jsonb,
  key_signals               jsonb not null default '[]'::jsonb,
  key_warnings              jsonb not null default '[]'::jsonb,
  key_scenarios             jsonb not null default '[]'::jsonb,
  key_forecasts             jsonb not null default '[]'::jsonb,
  policy_constraints        jsonb not null default '[]'::jsonb,
  evidence_summary          jsonb,
  missing_evidence          jsonb not null default '[]'::jsonb,
  conflicting_evidence      jsonb not null default '[]'::jsonb,
  agent_advisory_summary    jsonb,
  agent_conflicts           jsonb not null default '[]'::jsonb,
  decision_options          jsonb not null default '[]'::jsonb,
  no_action_consequence     jsonb,
  tradeoff_summary          jsonb,
  robustness_summary        jsonb,
  regret_summary            jsonb,
  financial_impact_summary  jsonb,
  capacity_impact_summary   jsonb,
  operational_impact_summary jsonb,
  security_privacy_compliance_summary jsonb,
  reversibility_summary     jsonb,
  feasibility_summary       jsonb,
  preferred_option_candidate jsonb,
  alternative_options       jsonb not null default '[]'::jsonb,
  recommendation_candidate  text check (recommendation_candidate is null or recommendation_candidate in ('proceed_with_option_candidate','proceed_with_conditions_candidate','limited_action_candidate','phased_action_candidate','reversible_pilot_candidate','gather_more_evidence_candidate','request_specialist_review_candidate','defer_decision_candidate','maintain_current_state_candidate','monitor_and_review_candidate','reject_current_options_candidate','create_new_option_candidate','resolve_agent_conflict_candidate','resolve_evidence_conflict_candidate','review_policy_constraint_candidate','review_financial_constraint_candidate','review_capacity_constraint_candidate','review_contract_constraint_candidate','review_security_privacy_compliance_candidate','insufficient_data')),
  recommendation_reason     text,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  decision_deadline_reference timestamptz,
  required_reviewer_roles   jsonb not null default '[]'::jsonb,
  human_approval_required   boolean not null default true,
  implementation_reference  jsonb,
  observation_plan_reference jsonb,
  review_trigger_reference  jsonb,
  previous_brief_id         uuid,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aeeb_idem on public.ai_enterprise_executive_briefs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeeb_ctx on public.ai_enterprise_executive_briefs (decision_context_id, brief_version desc);
create index if not exists idx_aeeb_status on public.ai_enterprise_executive_briefs (brief_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Executive 이벤트(37종) — Evidence/Advisory/Agreement/Conflict/Constraint/
--    Impact/Reversibility/Feasibility/Trade-off/Robustness/Regret/Review/
--    Decision·Commitment·Outcome Reference/Quality/Drift/Learning 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_executive_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('decision_context_created','decision_context_updated','decision_priority_reviewed','decision_urgency_reviewed','evidence_recorded','evidence_gap_recorded','evidence_conflict_recorded','advisory_requested_reference','agent_advisory_recorded','agent_agreement_reviewed','agent_conflict_reviewed','decision_option_created','decision_option_reviewed','policy_constraint_reviewed','impact_synthesis_recorded','financial_impact_reviewed','reversibility_reviewed','feasibility_reviewed','tradeoff_reviewed','robustness_reviewed','regret_reviewed','executive_brief_created','executive_brief_versioned','executive_brief_reviewed','recommendation_candidate_recorded','executive_review_started','executive_revision_requested','executive_approval_reference_recorded','executive_rejection_reference_recorded','executive_defer_reference_recorded','decision_reference_recorded','commitment_reference_linked','observed_outcome_linked','decision_quality_reviewed','decision_drift_reviewed','decision_learning_reference_recorded','decision_invalidated')),
  decision_context_id       uuid,
  decision_option_id        uuid,
  executive_brief_id        uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeee_evt on public.ai_enterprise_executive_events (event_type, created_at desc);
create index if not exists idx_aeee_ctx on public.ai_enterprise_executive_events (decision_context_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Decision Context 생성/진행.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_context_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_decision_contexts;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'decision_domain','');
  -- 초기 Phase 비활성 도메인(자동 집행/민감 결정 계열) — 구조적 차단.
  if v_domain in ('automatic_investment_execution','automatic_payment_approval','automatic_contract_signature','automatic_employee_hiring','automatic_employee_termination','automatic_compensation_decision','automatic_credit_decision','automatic_legal_decision','automatic_medical_decision','automatic_production_change','automatic_policy_application','automatic_infrastructure_purchase','personal_behavior_decision') then
    raise exception '금지된 decision domain(초기 Phase 비활성)';
  end if;
  if v_domain not in ('operational_risk','incident_response','runtime_reliability','connector_governance','automation_governance','agent_governance','policy_change','security_risk','privacy_risk','compliance_risk','capacity_planning','cost_management','resource_allocation','approval_bottleneck','recovery_strategy','enterprise_growth','new_enterprise_onboarding','new_connector_adoption','rollout_strategy','contract_risk_reference','settlement_impact_reference','payment_impact_reference','customer_experience','store_operations','organizational_workload','strategic_priority','custom_reference') then
    raise exception '허용되지 않는 decision_domain';
  end if;
  if coalesce(btrim(p_payload->>'decision_title'),'') = '' then raise exception 'decision_title 필수'; end if;
  if jsonb_array_length(coalesce(p_payload->'required_reviewer_roles', '[]'::jsonb)) > 20 then raise exception 'reviewer role 20개 초과'; end if;
  if jsonb_array_length(coalesce(p_payload->'agent_advisory_references', '[]'::jsonb)) > 50 then raise exception 'agent advisory 50개 초과'; end if;
  if jsonb_array_length(coalesce(p_payload->'evidence', '[]'::jsonb)) > 100 then raise exception 'evidence 100개 초과'; end if;
  if nullif(p_payload->>'enterprise_snapshot_id','') is not null
     and not exists (select 1 from public.ai_enterprise_state_snapshots where id = (p_payload->>'enterprise_snapshot_id')::uuid) then
    raise exception 'Enterprise Snapshot 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_decision_contexts where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'advisory_is_not_decision', true); end if;
  end if;
  insert into public.ai_enterprise_decision_contexts (decision_code, decision_title, decision_domain, decision_type, decision_scope_type, decision_scope_id, executive_owner_role_candidate, required_reviewer_roles, decision_deadline_reference, decision_question, context_summary, current_state_reference, enterprise_snapshot_id, twin_run_references, scenario_run_references, forecast_run_references, warning_candidate_references, incident_references, policy_references, commitment_references, previous_decision_references, outcome_references, knowledge_entity_references, agent_advisory_references, evidence, missing_evidence, conflicting_evidence, stale_evidence, assumptions, unknown_factors, external_factors, policy_constraints, constitutional_constraints, compliance_constraints, contract_constraints, financial_constraints, operational_constraints, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'decision_code',''), 'EDC-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'decision_title', 200), v_domain, nullif(left(coalesce(p_payload->>'decision_type',''), 80),''),
    coalesce(nullif(p_payload->>'decision_scope_type',''), 'enterprise'), nullif(p_payload->>'decision_scope_id',''),
    nullif(left(coalesce(p_payload->>'executive_owner_role_candidate',''), 80),''),
    coalesce(p_payload->'required_reviewer_roles', '[]'::jsonb),
    nullif(p_payload->>'decision_deadline_reference','')::timestamptz,
    nullif(left(coalesce(p_payload->>'decision_question',''), 500),''), nullif(left(coalesce(p_payload->>'context_summary',''), 2000),''),
    p_payload->'current_state_reference', nullif(p_payload->>'enterprise_snapshot_id','')::uuid,
    coalesce(p_payload->'twin_run_references', '[]'::jsonb), coalesce(p_payload->'scenario_run_references', '[]'::jsonb),
    coalesce(p_payload->'forecast_run_references', '[]'::jsonb), coalesce(p_payload->'warning_candidate_references', '[]'::jsonb),
    coalesce(p_payload->'incident_references', '[]'::jsonb), coalesce(p_payload->'policy_references', '[]'::jsonb),
    coalesce(p_payload->'commitment_references', '[]'::jsonb), coalesce(p_payload->'previous_decision_references', '[]'::jsonb),
    coalesce(p_payload->'outcome_references', '[]'::jsonb), coalesce(p_payload->'knowledge_entity_references', '[]'::jsonb),
    coalesce(p_payload->'agent_advisory_references', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'missing_evidence', '[]'::jsonb),
    coalesce(p_payload->'conflicting_evidence', '[]'::jsonb), coalesce(p_payload->'stale_evidence', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb),
    coalesce(p_payload->'policy_constraints', '[]'::jsonb), coalesce(p_payload->'constitutional_constraints', '[]'::jsonb),
    coalesce(p_payload->'compliance_constraints', '[]'::jsonb), coalesce(p_payload->'contract_constraints', '[]'::jsonb),
    coalesce(p_payload->'financial_constraints', '[]'::jsonb), coalesce(p_payload->'operational_constraints', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, detail, payload, actor_id)
  values ('decision_context_created', v_id, left(v_domain, 80) || ' (Decision Context ≠ Decision — draft·자동 승인 없음)', jsonb_build_object('decision_title', p_payload->>'decision_title'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'advisory_is_not_decision', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_decision_context_review(p_context_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_decision_contexts; v_next text := null; v_evt text := 'decision_context_updated'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','mark_pending_advisory','start_review','mark_ready_for_executive_review','request_revision','mark_outcome_pending','link_outcome','close_reference','close_with_limitation','supersede','invalidate') then
    raise exception '허용되지 않는 action(Executive 승인/거절/보류는 executive_review_record 전용)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_decision_contexts where id = p_context_id;
  if v_row.id is null then raise exception 'Decision Context 없음(실존 검증 실패)'; end if;
  if v_row.decision_status in ('superseded','invalidated','closed_reference','closed_with_limitation') then
    raise exception '종결 상태 재결정 차단(%)', v_row.decision_status;
  end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_pending_advisory' then v_next := 'pending_advisory';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_ready_for_executive_review' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Executive Review 상정 금지(evidence_missing)';
    end if;
    v_next := 'ready_for_executive_review_reference';
    v_note := ' (Ready ≠ Approval — 사람 검토 대기)';
  elsif p_action = 'request_revision' then v_next := 'revision_requested'; v_evt := 'executive_revision_requested';
  elsif p_action = 'mark_outcome_pending' then v_next := 'outcome_pending';
  elsif p_action = 'link_outcome' then
    v_evt := 'observed_outcome_linked'; v_note := ' (Outcome Link ≠ Decision Causality)';
    update public.ai_enterprise_decision_contexts set outcome_reference = p_payload where id = p_context_id;
  elsif p_action in ('close_reference','close_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Closure 금지';
    end if;
    v_next := case when p_action = 'close_reference' then 'closed_reference' else 'closed_with_limitation' end;
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated'; v_evt := 'decision_invalidated';
  end if;

  if v_next is not null then
    update public.ai_enterprise_decision_contexts set decision_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_context_id;
  end if;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, detail, payload, actor_id)
  values (v_evt, p_context_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.decision_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_context_id, 'status', coalesce(v_next, v_row.decision_status), 'auto_approved', false, 'decision_executed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Decision Option 생성/검토 — Blocked Type 구조적 차단·Context당 최대 20개.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_option_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_ctx public.ai_enterprise_decision_contexts; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_decision_options;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'option_type','');
  -- 초기 Phase 금지 Option Type — 구조적 차단.
  if v_type in ('direct_production_execution','automatic_payment','automatic_contract_execution','automatic_employee_action','automatic_policy_apply','automatic_infrastructure_purchase') then
    raise exception '금지된 option_type(초기 Phase 차단)';
  end if;
  if v_type not in ('no_action_reference','defer_reference','gather_more_evidence_reference','monitor_reference','limited_action_reference','phased_action_reference','reversible_action_reference','policy_change_reference','rollout_reference','rollback_reference','capacity_change_reference','cost_control_reference','governance_change_reference','operational_change_reference','escalation_reference','custom_reference') then
    raise exception '허용되지 않는 option_type';
  end if;
  select * into v_ctx from public.ai_enterprise_decision_contexts where id = nullif(p_payload->>'decision_context_id','')::uuid;
  if v_ctx.id is null then raise exception 'Decision Context 없음(실존 검증 실패)'; end if;
  if v_ctx.decision_status in ('superseded','invalidated','closed_reference','closed_with_limitation') then
    raise exception '종결된 Context 에 Option 추가 금지(%)', v_ctx.decision_status;
  end if;
  if (select count(*) from public.ai_enterprise_decision_options where decision_context_id = v_ctx.id) >= 20 then
    raise exception 'Decision Option 20개 초과(Option Abuse 차단)';
  end if;
  if coalesce(btrim(p_payload->>'option_name'),'') = '' then raise exception 'option_name 필수'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_decision_options where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'option_is_not_selected_option', true); end if;
  end if;
  insert into public.ai_enterprise_decision_options (decision_context_id, option_code, option_name, option_type, option_summary, action_reference_type, action_reference_id, is_no_action_option, is_defer_option, is_evidence_gathering_option, assumptions, preconditions, dependencies, blocking_conditions, required_approvals, expected_benefits, expected_costs, risk_projection, opportunity_projection, financial_impact, capacity_impact, operational_impact, security_impact, privacy_impact, compliance_impact, contract_impact, settlement_impact_reference, payment_impact_reference, customer_experience_impact, store_operations_impact, human_workload_impact, rollback_reference, implementation_complexity_candidate, operational_friction_candidate, time_to_value_candidate, expected_observation_period, success_conditions, failure_conditions, stop_conditions, alternatives, unknown_factors, evidence, limitations, idempotency_key, created_by)
  values (v_ctx.id,
    left(coalesce(nullif(p_payload->>'option_code',''), 'EDO-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'option_name', 200), v_type,
    nullif(left(coalesce(p_payload->>'option_summary',''), 2000),''),
    nullif(left(coalesce(p_payload->>'action_reference_type',''), 80),''), nullif(p_payload->>'action_reference_id',''),
    v_type = 'no_action_reference', v_type = 'defer_reference', v_type = 'gather_more_evidence_reference',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'preconditions', '[]'::jsonb),
    coalesce(p_payload->'dependencies', '[]'::jsonb), coalesce(p_payload->'blocking_conditions', '[]'::jsonb),
    coalesce(p_payload->'required_approvals', '[]'::jsonb), coalesce(p_payload->'expected_benefits', '[]'::jsonb),
    coalesce(p_payload->'expected_costs', '[]'::jsonb),
    p_payload->'risk_projection', p_payload->'opportunity_projection', p_payload->'financial_impact',
    p_payload->'capacity_impact', p_payload->'operational_impact', p_payload->'security_impact',
    p_payload->'privacy_impact', p_payload->'compliance_impact', p_payload->'contract_impact',
    p_payload->'settlement_impact_reference', p_payload->'payment_impact_reference',
    p_payload->'customer_experience_impact', p_payload->'store_operations_impact', p_payload->'human_workload_impact',
    p_payload->'rollback_reference',
    nullif(left(coalesce(p_payload->>'implementation_complexity_candidate',''), 60),''),
    nullif(left(coalesce(p_payload->>'operational_friction_candidate',''), 60),''),
    nullif(left(coalesce(p_payload->>'time_to_value_candidate',''), 60),''),
    nullif(left(coalesce(p_payload->>'expected_observation_period',''), 60),''),
    coalesce(p_payload->'success_conditions', '[]'::jsonb), coalesce(p_payload->'failure_conditions', '[]'::jsonb),
    coalesce(p_payload->'stop_conditions', '[]'::jsonb), coalesce(p_payload->'alternatives', '[]'::jsonb),
    coalesce(p_payload->'unknown_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, decision_option_id, detail, payload, actor_id)
  values ('decision_option_created', v_ctx.id, v_id, left(v_type, 80) || ' (Option ≠ Selected Option — 실행 계획 아님)', jsonb_build_object('option_name', p_payload->>'option_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'option_is_not_selected_option', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_decision_option_review(p_option_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_decision_options; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_viable','mark_conditionally_viable','mark_blocked','mark_infeasible','reject_reference','supersede','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_decision_options where id = p_option_id;
  if v_row.id is null then raise exception 'Decision Option 없음(실존 검증 실패)'; end if;
  if v_row.option_status in ('rejected_reference','superseded','invalidated') then
    raise exception '종결 상태 재결정 차단(%)', v_row.option_status;
  end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_viable' then
    v_next := 'viable_candidate'; v_note := ' (Viable Candidate ≠ 선택 완료·자동 실행 없음)';
  elsif p_action = 'mark_conditionally_viable' then v_next := 'conditionally_viable_candidate';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate';
  elsif p_action = 'mark_infeasible' then v_next := 'infeasible_candidate';
  elsif p_action = 'reject_reference' then v_next := 'rejected_reference';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_decision_options set option_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_option_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, decision_option_id, detail, payload, actor_id)
  values ('decision_option_reviewed', v_row.decision_context_id, p_option_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_option_id, 'status', v_next, 'option_is_not_selected_option', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Executive Brief 생성(버전 포함)/검토 — Brief ≠ Decision/Approval.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_executive_brief_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_ctx public.ai_enterprise_decision_contexts; v_prev public.ai_enterprise_executive_briefs; v_version int := 1; v_rec text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_executive_briefs;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 65536 then raise exception 'brief payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_ctx from public.ai_enterprise_decision_contexts where id = nullif(p_payload->>'decision_context_id','')::uuid;
  if v_ctx.id is null then raise exception 'Decision Context 없음(실존 검증 실패)'; end if;
  if v_ctx.decision_status in ('superseded','invalidated','closed_reference','closed_with_limitation') then
    raise exception '종결된 Context 에 Brief 생성 금지(%)', v_ctx.decision_status;
  end if;
  v_rec := nullif(p_payload->>'recommendation_candidate','');
  if v_rec is not null and v_rec not in ('proceed_with_option_candidate','proceed_with_conditions_candidate','limited_action_candidate','phased_action_candidate','reversible_pilot_candidate','gather_more_evidence_candidate','request_specialist_review_candidate','defer_decision_candidate','maintain_current_state_candidate','monitor_and_review_candidate','reject_current_options_candidate','create_new_option_candidate','resolve_agent_conflict_candidate','resolve_evidence_conflict_candidate','review_policy_constraint_candidate','review_financial_constraint_candidate','review_capacity_constraint_candidate','review_contract_constraint_candidate','review_security_privacy_compliance_candidate','insufficient_data') then
    raise exception '허용되지 않는 recommendation_candidate';
  end if;
  if v_rec is not null and (p_payload->'evidence_summary' is null) and (p_payload->'evidence' is null) then
    raise exception 'Evidence 없는 Recommendation Candidate 금지';
  end if;
  if nullif(p_payload->>'previous_brief_id','') is not null then
    select * into v_prev from public.ai_enterprise_executive_briefs where id = (p_payload->>'previous_brief_id')::uuid;
    if v_prev.id is null then raise exception '이전 Brief 없음(실존 검증 실패)'; end if;
    if v_prev.decision_context_id <> v_ctx.id then raise exception '이전 Brief 의 Context 불일치'; end if;
    v_version := v_prev.brief_version + 1;
    update public.ai_enterprise_executive_briefs set brief_status = 'superseded', updated_at = now() where id = v_prev.id and brief_status not in ('superseded','invalidated');
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_executive_briefs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'brief_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_executive_briefs (brief_code, decision_context_id, brief_version, executive_summary, decision_question, why_now, current_state, key_signals, key_warnings, key_scenarios, key_forecasts, policy_constraints, evidence_summary, missing_evidence, conflicting_evidence, agent_advisory_summary, agent_conflicts, decision_options, no_action_consequence, tradeoff_summary, robustness_summary, regret_summary, financial_impact_summary, capacity_impact_summary, operational_impact_summary, security_privacy_compliance_summary, reversibility_summary, feasibility_summary, preferred_option_candidate, alternative_options, recommendation_candidate, recommendation_reason, confidence, decision_deadline_reference, required_reviewer_roles, implementation_reference, observation_plan_reference, review_trigger_reference, previous_brief_id, assumptions, unknown_factors, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'brief_code',''), 'EBF-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_ctx.id, v_version,
    nullif(left(coalesce(p_payload->>'executive_summary',''), 4000),''),
    nullif(left(coalesce(p_payload->>'decision_question',''), 500),''), nullif(left(coalesce(p_payload->>'why_now',''), 2000),''),
    p_payload->'current_state', coalesce(p_payload->'key_signals', '[]'::jsonb), coalesce(p_payload->'key_warnings', '[]'::jsonb),
    coalesce(p_payload->'key_scenarios', '[]'::jsonb), coalesce(p_payload->'key_forecasts', '[]'::jsonb),
    coalesce(p_payload->'policy_constraints', '[]'::jsonb), p_payload->'evidence_summary',
    coalesce(p_payload->'missing_evidence', '[]'::jsonb), coalesce(p_payload->'conflicting_evidence', '[]'::jsonb),
    p_payload->'agent_advisory_summary', coalesce(p_payload->'agent_conflicts', '[]'::jsonb),
    coalesce(p_payload->'decision_options', '[]'::jsonb), p_payload->'no_action_consequence',
    p_payload->'tradeoff_summary', p_payload->'robustness_summary', p_payload->'regret_summary',
    p_payload->'financial_impact_summary', p_payload->'capacity_impact_summary', p_payload->'operational_impact_summary',
    p_payload->'security_privacy_compliance_summary', p_payload->'reversibility_summary', p_payload->'feasibility_summary',
    p_payload->'preferred_option_candidate', coalesce(p_payload->'alternative_options', '[]'::jsonb),
    v_rec, nullif(left(coalesce(p_payload->>'recommendation_reason',''), 2000),''),
    case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end,
    nullif(p_payload->>'decision_deadline_reference','')::timestamptz,
    coalesce(p_payload->'required_reviewer_roles', '[]'::jsonb),
    p_payload->'implementation_reference', p_payload->'observation_plan_reference', p_payload->'review_trigger_reference',
    nullif(p_payload->>'previous_brief_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, executive_brief_id, detail, payload, actor_id)
  values (case when v_version > 1 then 'executive_brief_versioned' else 'executive_brief_created' end, v_ctx.id, v_id,
    'v' || v_version::text || ' (Brief ≠ Decision/Approval — Preferred Option Candidate ≠ Final Choice)', jsonb_build_object('brief_version', v_version, 'recommendation_candidate', v_rec), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'brief_version', v_version, 'initial_status', 'draft', 'brief_is_not_approval', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_executive_brief_review(p_brief_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_executive_briefs; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','mark_pending_advisory','start_review','mark_ready_for_executive_review','start_executive_review','request_revision','mark_reviewed','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_executive_briefs where id = p_brief_id;
  if v_row.id is null then raise exception 'Executive Brief 없음(실존 검증 실패)'; end if;
  if v_row.brief_status in ('superseded','invalidated','reviewed_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.brief_status;
  end if;
  if v_row.created_by = v_uid and p_action = 'mark_reviewed' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_pending_advisory' then v_next := 'pending_advisory';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_ready_for_executive_review' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Executive Review 상정 금지(evidence_missing)';
    end if;
    v_next := 'ready_for_executive_review_reference';
  elsif p_action = 'start_executive_review' then v_next := 'under_executive_review';
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  elsif p_action = 'mark_reviewed' then
    v_next := 'reviewed_reference'; v_note := v_note || ' (Reviewed ≠ Approved — Brief ≠ Executive Approval)';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_executive_briefs set brief_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_brief_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, executive_brief_id, detail, payload, actor_id)
  values ('executive_brief_reviewed', v_row.decision_context_id, p_brief_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_brief_id, 'status', v_next, 'brief_is_not_approval', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Human Executive Review — Approve/Reject/Defer/Revision 전부 Reference.
--    production_applied 는 본 Phase 에서 항상 false. Self-Approval 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_executive_review_record(p_context_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_ctx public.ai_enterprise_decision_contexts; v_next text := null; v_evt text; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_executive_review','approve_reference','approve_with_conditions_reference','reject_reference','defer_reference','request_revision_reference','request_more_evidence_reference','request_specialist_review_reference','invalidate') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(승인/거절/보류/수정 요청 전부)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_ctx from public.ai_enterprise_decision_contexts where id = p_context_id;
  if v_ctx.id is null then raise exception 'Decision Context 없음(실존 검증 실패)'; end if;
  if v_ctx.decision_status in ('superseded','invalidated','closed_reference','closed_with_limitation','approved_reference','rejected_reference') then
    raise exception '종결/결정 상태 재결정 차단(%)', v_ctx.decision_status;
  end if;
  if nullif(p_payload->>'executive_brief_id','') is not null
     and not exists (select 1 from public.ai_enterprise_executive_briefs where id = (p_payload->>'executive_brief_id')::uuid and decision_context_id = p_context_id) then
    raise exception 'Executive Brief 없음/Context 불일치(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'selected_option_reference','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_options where id = (p_payload->>'selected_option_reference')::uuid and decision_context_id = p_context_id) then
    raise exception 'Decision Option 없음/Context 불일치(실존 검증 실패)';
  end if;
  if p_action in ('approve_reference','approve_with_conditions_reference') then
    -- Self-Approval 차단 + Evidence 필수(Approval Reference ≠ Applied Change).
    if v_ctx.created_by = v_uid then raise exception 'Self-Approval 차단(작성자 ≠ 승인자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Approval Reference 금지';
    end if;
  end if;

  if p_action = 'start_executive_review' then v_next := 'under_executive_review'; v_evt := 'executive_review_started';
  elsif p_action in ('approve_reference','approve_with_conditions_reference') then
    v_next := 'approved_reference'; v_evt := 'executive_approval_reference_recorded';
    v_note := ' (Approval Reference ≠ Applied Change — production_applied=false)';
  elsif p_action = 'reject_reference' then v_next := 'rejected_reference'; v_evt := 'executive_rejection_reference_recorded';
  elsif p_action = 'defer_reference' then v_next := 'deferred_reference'; v_evt := 'executive_defer_reference_recorded';
  elsif p_action = 'request_revision_reference' then v_next := 'revision_requested'; v_evt := 'executive_revision_requested';
  elsif p_action = 'request_more_evidence_reference' then v_next := 'pending_evidence'; v_evt := 'executive_revision_requested';
  elsif p_action = 'request_specialist_review_reference' then v_next := 'pending_advisory'; v_evt := 'executive_revision_requested';
  else v_next := 'invalidated'; v_evt := 'decision_invalidated';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'executive_brief_id', nullif(p_payload->>'executive_brief_id',''),
    'selected_option_reference', nullif(p_payload->>'selected_option_reference',''),
    'conditions', coalesce(p_payload->'conditions', '[]'::jsonb),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'required_specialists', coalesce(p_payload->'required_specialists', '[]'::jsonb),
    'commitment_reference', p_payload->'commitment_reference',
    'decision_reference', p_payload->'decision_reference',
    'implementation_reference', p_payload->'implementation_reference',
    'observation_plan_reference', p_payload->'observation_plan_reference',
    'review_trigger_reference', p_payload->'review_trigger_reference',
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_decision_confirmed', true, 'production_applied', false);
  update public.ai_enterprise_decision_contexts set
    decision_status = v_next, reviewed_by = v_uid, updated_at = now(),
    executive_reviews = executive_reviews || jsonb_build_array(v_review)
  where id = p_context_id;
  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, executive_brief_id, detail, payload, actor_id)
  values (v_evt, p_context_id, nullif(p_payload->>'executive_brief_id','')::uuid,
    left(p_reason, 200) || v_note, v_review || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_context_id, 'status', v_next, 'review_action', p_action, 'human_decision_confirmed', true, 'approval_is_not_applied_change', true, 'auto_approved', false, 'decision_executed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Executive 이벤트 기록(통합) — Priority/Urgency/Evidence/Advisory/
--    Agreement/Conflict/Constraint/Impact/Financial/Reversibility/Feasibility/
--    Trade-off/Robustness/Regret/Recommendation/Decision·Commitment·Outcome
--    Reference/Quality/Drift/Learning.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_executive_event_record(p_kind text, p_reason text, p_payload jsonb, p_context_id uuid default null, p_option_id uuid default null, p_brief_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('decision_priority_reviewed','decision_urgency_reviewed','evidence_recorded','evidence_gap_recorded','evidence_conflict_recorded','advisory_requested_reference','agent_advisory_recorded','agent_agreement_reviewed','agent_conflict_reviewed','policy_constraint_reviewed','impact_synthesis_recorded','financial_impact_reviewed','reversibility_reviewed','feasibility_reviewed','tradeoff_reviewed','robustness_reviewed','regret_reviewed','recommendation_candidate_recorded','decision_reference_recorded','commitment_reference_linked','observed_outcome_linked','decision_quality_reviewed','decision_drift_reviewed','decision_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Executive 승인·거절은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_context_id is not null and not exists (select 1 from public.ai_enterprise_decision_contexts where id = p_context_id) then raise exception 'Context 없음(실존 검증 실패)'; end if;
  if p_option_id is not null and not exists (select 1 from public.ai_enterprise_decision_options where id = p_option_id) then raise exception 'Option 없음(실존 검증 실패)'; end if;
  if p_brief_id is not null and not exists (select 1 from public.ai_enterprise_executive_briefs where id = p_brief_id) then raise exception 'Brief 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'decision_priority_reviewed' then
    if v_result not in ('informational_candidate','low_candidate','normal_candidate','high_candidate','critical_candidate','priority_unverified','insufficient_data') then raise exception '허용되지 않는 priority result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set priority_candidate = v_result, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'decision_urgency_reviewed' then
    if v_result not in ('no_deadline_candidate','routine_candidate','time_sensitive_candidate','urgent_candidate','immediate_review_candidate','urgency_unverified','insufficient_data') then raise exception '허용되지 않는 urgency result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set urgency_candidate = v_result, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'evidence_recorded' and v_result <> '' and v_result not in ('evidence_ready_reference','evidence_partial','evidence_stale_candidate','evidence_conflict_candidate','evidence_duplicate_candidate','evidence_circularity_candidate','evidence_scope_mismatch','evidence_version_mismatch','evidence_missing','insufficient_data') then
    raise exception '허용되지 않는 evidence result';
  end if;
  if p_kind = 'agent_advisory_recorded' then
    if jsonb_array_length(coalesce(p_payload->'advisory_inputs', '[]'::jsonb)) > 50 then raise exception 'agent advisory 50개 초과'; end if;
    if v_result <> '' and v_result not in ('advisory_ready_reference','advisory_partial','advisory_conflict_candidate','advisory_consensus_candidate','advisory_majority_candidate','specialist_missing','shared_evidence_dependency_candidate','circular_reasoning_candidate','advisory_input_unavailable','insufficient_data') then
      raise exception '허용되지 않는 advisory result';
    end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set advisory_synthesis = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'agent_agreement_reviewed' then
    if v_result not in ('strong_agreement_candidate','moderate_agreement_candidate','weak_agreement_candidate','split_opinion_candidate','agreement_unverified','insufficient_data') then raise exception '허용되지 않는 agreement result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set agent_agreement_result = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'agent_conflict_reviewed' then
    if v_result not in ('no_material_conflict_candidate','minor_conflict_candidate','moderate_conflict_candidate','major_conflict_candidate','structural_conflict_candidate','conflict_unverified','insufficient_data') then raise exception '허용되지 않는 conflict result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set agent_conflict_result = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'policy_constraint_reviewed' and v_result not in ('constraint_clear_reference','conditional_constraint_candidate','approval_required_reference','secondary_review_required_reference','option_blocked_by_policy','option_blocked_by_constitution','option_blocked_by_compliance','option_blocked_by_contract','option_blocked_by_scope','constraint_unverified','insufficient_data') then
    raise exception '허용되지 않는 constraint result';
  end if;
  if p_kind = 'impact_synthesis_recorded' then
    if v_result not in ('isolated_impact_candidate','limited_impact_candidate','multi_domain_impact_candidate','enterprise_wide_impact_candidate','adverse_impact_candidate','mixed_impact_candidate','impact_unverified','insufficient_data') then raise exception '허용되지 않는 impact result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set impact_synthesis = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'financial_impact_reviewed' then
    if v_result not in ('favorable_financial_candidate','neutral_financial_candidate','adverse_financial_candidate','mixed_financial_candidate','budget_constraint_candidate','financial_impact_unverified','insufficient_data') then raise exception '허용되지 않는 financial result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set financial_impact = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'reversibility_reviewed' then
    if v_result not in ('highly_reversible_candidate','reversible_with_condition_candidate','partially_reversible_candidate','difficult_to_reverse_candidate','irreversible_candidate','reversibility_unverified','insufficient_data') then raise exception '허용되지 않는 reversibility result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set reversibility_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'feasibility_reviewed' then
    if v_result not in ('feasible_candidate','conditionally_feasible_candidate','feasibility_blocked_candidate','feasibility_unverified','insufficient_data') then raise exception '허용되지 않는 feasibility result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set feasibility_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'tradeoff_reviewed' then
    if coalesce(p_payload->>'axis','') not in ('risk_vs_cost','risk_vs_opportunity','cost_vs_reliability','speed_vs_safety','growth_vs_stability','automation_vs_human_control','approval_speed_vs_governance','capacity_vs_cost','customer_experience_vs_operational_friction','short_term_vs_long_term','reversibility_vs_time_to_value','opportunity_vs_downside') then
      raise exception '허용되지 않는 tradeoff axis';
    end if;
    if v_result not in ('favorable_tradeoff_candidate','balanced_tradeoff_candidate','unfavorable_tradeoff_candidate','mixed_tradeoff_candidate','tradeoff_unverified','insufficient_data') then raise exception '허용되지 않는 tradeoff result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set tradeoff_results = coalesce(tradeoff_results, '{}'::jsonb) || jsonb_build_object(p_payload->>'axis', p_payload), updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'robustness_reviewed' then
    if v_result not in ('robust_option_candidate','conditionally_robust_candidate','fragile_option_candidate','scenario_specific_candidate','robustness_unverified','insufficient_data') then raise exception '허용되지 않는 robustness result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set robustness_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'regret_reviewed' then
    if v_result not in ('lowest_regret_candidate','low_regret_candidate','moderate_regret_candidate','high_regret_candidate','asymmetric_regret_candidate','regret_unverified','insufficient_data') then raise exception '허용되지 않는 regret result'; end if;
    if p_option_id is not null then update public.ai_enterprise_decision_options set regret_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'recommendation_candidate_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('proceed_with_option_candidate','proceed_with_conditions_candidate','limited_action_candidate','phased_action_candidate','reversible_pilot_candidate','gather_more_evidence_candidate','request_specialist_review_candidate','defer_decision_candidate','maintain_current_state_candidate','monitor_and_review_candidate','reject_current_options_candidate','create_new_option_candidate','resolve_agent_conflict_candidate','resolve_evidence_conflict_candidate','review_policy_constraint_candidate','review_financial_constraint_candidate','review_capacity_constraint_candidate','review_contract_constraint_candidate','review_security_privacy_compliance_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Recommendation Candidate 금지';
    end if;
  end if;
  if p_kind = 'decision_reference_recorded' and p_context_id is not null then
    update public.ai_enterprise_decision_contexts set decision_reference = p_payload || jsonb_build_object('production_applied', false), updated_at = now() where id = p_context_id;
  end if;
  if p_kind = 'commitment_reference_linked' then
    if nullif(p_payload->>'commitment_id','') is not null
       and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
      raise exception 'Commitment 없음(실존 검증 실패)';
    end if;
    if p_context_id is not null then
      update public.ai_enterprise_decision_contexts set commitment_references = commitment_references || jsonb_build_array(p_payload), updated_at = now() where id = p_context_id;
    end if;
  end if;
  if p_kind = 'observed_outcome_linked' and p_context_id is not null then
    update public.ai_enterprise_decision_contexts set outcome_reference = p_payload, updated_at = now() where id = p_context_id;
  end if;
  if p_kind = 'decision_quality_reviewed' then
    if v_result not in ('high_quality_candidate','moderate_quality_candidate','low_quality_candidate','mixed_quality_candidate','outcome_unverified','causality_unverified','sample_too_small','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set decision_quality_result = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;
  if p_kind = 'decision_drift_reviewed' then
    if v_result not in ('no_material_drift_candidate','minor_drift_candidate','moderate_drift_candidate','severe_drift_candidate','structural_drift_candidate','drift_unverified','insufficient_data') then raise exception '허용되지 않는 drift result'; end if;
    if p_context_id is not null then update public.ai_enterprise_decision_contexts set decision_drift_result = p_payload, updated_at = now() where id = p_context_id; end if;
  end if;

  insert into public.ai_enterprise_executive_events (event_type, decision_context_id, decision_option_id, executive_brief_id, detail, payload, actor_id)
  values (p_kind, p_context_id, p_option_id, p_brief_id,
    left(p_reason, 200) || case
      when p_kind = 'decision_priority_reviewed' then ' (Priority Candidate ≠ 경영 우선순위 확정)'
      when p_kind = 'decision_urgency_reviewed' then ' (Urgency ≠ 자동 승인/자동 실행)'
      when p_kind = 'evidence_recorded' then ' (Evidence Volume ≠ Evidence Quality)'
      when p_kind = 'agent_advisory_recorded' then ' (Advisory ≠ Decision)'
      when p_kind = 'agent_agreement_reviewed' then ' (Agent Agreement ≠ Truth·Majority ≠ Correctness)'
      when p_kind = 'agent_conflict_reviewed' then ' (Agent Conflict ≠ Error)'
      when p_kind = 'policy_constraint_reviewed' then ' (Constraint 우회 없음)'
      when p_kind = 'financial_impact_reviewed' then ' (Financial Impact Candidate ≠ Accounting Fact)'
      when p_kind = 'reversibility_reviewed' then ' (Reversibility Candidate ≠ Guaranteed Rollback)'
      when p_kind = 'tradeoff_reviewed' then ' (자동 점수 순위 선택 없음)'
      when p_kind = 'robustness_reviewed' then ' (Robust Option ≠ Correct Option)'
      when p_kind = 'regret_reviewed' then ' (Lowest Regret Candidate ≠ Best Decision)'
      when p_kind = 'recommendation_candidate_recorded' then ' (Recommendation Candidate ≠ Approved Recommendation)'
      when p_kind = 'decision_reference_recorded' then ' (Decision Reference ≠ Execution)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ Completed Commitment)'
      when p_kind = 'observed_outcome_linked' then ' (Outcome Link ≠ Decision Causality)'
      when p_kind = 'decision_quality_reviewed' then ' (Quality Candidate ≠ Verified Decision Quality)'
      when p_kind = 'decision_drift_reviewed' then ' (Drift Candidate ≠ Confirmed Drift)'
      when p_kind = 'decision_learning_reference_recorded' then ' (Learning Reference ≠ 자동 정책 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_approved', false, 'decision_executed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_contexts(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_decision_contexts language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_decision_contexts
  where (p_status is null or decision_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_decision_options(p_context_id uuid default null, p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_decision_options language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_decision_options
  where (p_context_id is null or decision_context_id = p_context_id)
    and (p_status is null or option_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_executive_briefs(p_context_id uuid default null, p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_executive_briefs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_executive_briefs
  where (p_context_id is null or decision_context_id = p_context_id)
    and (p_status is null or brief_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_executive_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'contexts', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_decision_contexts),
      'pending_evidence', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'pending_evidence'),
      'pending_advisory', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'pending_advisory'),
      'pending_executive_review', (select count(*) from public.ai_enterprise_decision_contexts where decision_status in ('ready_for_executive_review_reference','under_executive_review')),
      'revision_requested', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'revision_requested'),
      'approved_references', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'approved_reference'),
      'rejected_references', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'rejected_reference'),
      'deferred_references', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'deferred_reference'),
      'outcome_pending', (select count(*) from public.ai_enterprise_decision_contexts where decision_status = 'outcome_pending'),
      'critical_priority', (select count(*) from public.ai_enterprise_decision_contexts where priority_candidate = 'critical_candidate'),
      'immediate_review', (select count(*) from public.ai_enterprise_decision_contexts where urgency_candidate = 'immediate_review_candidate'),
      'by_domain', (select coalesce(jsonb_object_agg(decision_domain, cnt), '{}'::jsonb) from (select decision_domain, count(*) cnt from public.ai_enterprise_decision_contexts group by decision_domain) t)
    ),
    'options', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_decision_options),
      'viable', (select count(*) from public.ai_enterprise_decision_options where option_status = 'viable_candidate'),
      'conditionally_viable', (select count(*) from public.ai_enterprise_decision_options where option_status = 'conditionally_viable_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_decision_options where option_status = 'blocked_candidate'),
      'infeasible', (select count(*) from public.ai_enterprise_decision_options where option_status = 'infeasible_candidate'),
      'no_action', (select count(*) from public.ai_enterprise_decision_options where is_no_action_option),
      'defer', (select count(*) from public.ai_enterprise_decision_options where is_defer_option),
      'evidence_gathering', (select count(*) from public.ai_enterprise_decision_options where is_evidence_gathering_option)
    ),
    'briefs', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_executive_briefs),
      'ready_for_executive_review', (select count(*) from public.ai_enterprise_executive_briefs where brief_status = 'ready_for_executive_review_reference'),
      'under_executive_review', (select count(*) from public.ai_enterprise_executive_briefs where brief_status = 'under_executive_review'),
      'revision_requested', (select count(*) from public.ai_enterprise_executive_briefs where brief_status = 'revision_requested'),
      'reviewed', (select count(*) from public.ai_enterprise_executive_briefs where brief_status = 'reviewed_reference'),
      'with_recommendation', (select count(*) from public.ai_enterprise_executive_briefs where recommendation_candidate is not null)
    ),
    'executive_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_executive_events),
      'evidence_records', (select count(*) from public.ai_enterprise_executive_events where event_type = 'evidence_recorded'),
      'evidence_gaps', (select count(*) from public.ai_enterprise_executive_events where event_type = 'evidence_gap_recorded'),
      'evidence_conflicts', (select count(*) from public.ai_enterprise_executive_events where event_type = 'evidence_conflict_recorded'),
      'agent_advisories', (select count(*) from public.ai_enterprise_executive_events where event_type = 'agent_advisory_recorded'),
      'agent_agreements', (select count(*) from public.ai_enterprise_executive_events where event_type = 'agent_agreement_reviewed'),
      'agent_conflicts', (select count(*) from public.ai_enterprise_executive_events where event_type = 'agent_conflict_reviewed'),
      'policy_constraints', (select count(*) from public.ai_enterprise_executive_events where event_type = 'policy_constraint_reviewed'),
      'impact_syntheses', (select count(*) from public.ai_enterprise_executive_events where event_type = 'impact_synthesis_recorded'),
      'financial_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'financial_impact_reviewed'),
      'reversibility_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'reversibility_reviewed'),
      'feasibility_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'feasibility_reviewed'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'tradeoff_reviewed'),
      'robustness_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'robustness_reviewed'),
      'regret_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'regret_reviewed'),
      'recommendations', (select count(*) from public.ai_enterprise_executive_events where event_type = 'recommendation_candidate_recorded'),
      'executive_approvals', (select count(*) from public.ai_enterprise_executive_events where event_type = 'executive_approval_reference_recorded'),
      'executive_rejections', (select count(*) from public.ai_enterprise_executive_events where event_type = 'executive_rejection_reference_recorded'),
      'executive_defers', (select count(*) from public.ai_enterprise_executive_events where event_type = 'executive_defer_reference_recorded'),
      'decision_references', (select count(*) from public.ai_enterprise_executive_events where event_type = 'decision_reference_recorded'),
      'commitment_links', (select count(*) from public.ai_enterprise_executive_events where event_type = 'commitment_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_executive_events where event_type = 'observed_outcome_linked'),
      'quality_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'decision_quality_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_executive_events where event_type = 'decision_drift_reviewed'),
      'learning_references', (select count(*) from public.ai_enterprise_executive_events where event_type = 'decision_learning_reference_recorded')
    ),
    -- Advisory 원천 실측(전부 읽기 전용):
    'advisory_actuals', jsonb_build_object(
      'decision_memory_0514', (select count(*) from public.ai_decision_memory),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'execution_requests_0535', (select count(*) from public.ai_execution_requests),
      'agents_0497', (select count(*) from public.ai_agents),
      'agent_collaboration_0497', (select count(*) from public.ai_agent_collaboration),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules),
      'scenario_runs_0542', (select count(*) from public.ai_enterprise_scenario_runs),
      'forecast_runs_0543', (select count(*) from public.ai_enterprise_forecast_runs),
      'warning_candidates_0543', (select count(*) from public.ai_enterprise_early_warning_candidates),
      'incidents_0502', (select count(*) from public.ai_incidents),
      'policy_specifications_0539', (select count(*) from public.ai_policy_change_specifications),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities)
    ),
    'advisory_unavailable', jsonb_build_array('trained_decision_model','executive_org_chart_data','reviewer_role_directory','agent_independence_verifier','evidence_reliability_model','accounting_actuals_feed','revenue_forecast_dataset','rollback_guarantee_engine','causality_model'),   -- 원본 없음(실측)
    'advisory_is_not_decision', true, 'recommendation_candidate_is_not_approval', true, 'brief_is_not_approval', true,
    'option_is_not_selected_option', true, 'agent_agreement_is_not_truth', true, 'confidence_is_not_correctness', true,
    'approval_reference_is_not_applied_change', true, 'outcome_link_is_not_causality', true,
    'no_auto_decision', true, 'no_auto_approval', true, 'no_auto_execution', true, 'no_auto_payment', true,
    'no_auto_settlement_change', true, 'no_auto_contract_execution', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_executive_audit(p_limit int default 100)
returns setof public.ai_enterprise_executive_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_executive_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_decision_contexts enable row level security;
alter table public.ai_enterprise_decision_options enable row level security;
alter table public.ai_enterprise_executive_briefs enable row level security;
alter table public.ai_enterprise_executive_events enable row level security;

comment on table public.ai_enterprise_decision_contexts is 'AI-OPS-40 — Executive Decision Context(≠ Decision·도메인 27종·금지 13종 차단·Executive Review/Decision·Outcome Reference/Quality/Drift JSONB 통합·production_applied 항상 false).';
comment on table public.ai_enterprise_decision_options is 'AI-OPS-40 — Decision Option(≠ 실행 계획·Type 16종·금지 6종 차단·Viable Candidate ≠ 선택 완료·Context당 최대 20개).';
comment on table public.ai_enterprise_executive_briefs is 'AI-OPS-40 — Executive Decision Brief(≠ Decision/Approval·버전 관리·Recommendation Candidate 20종·Preferred Option Candidate ≠ Final Choice).';
comment on table public.ai_enterprise_executive_events is 'AI-OPS-40 — Executive 이벤트 37종(자동 Decision/승인/실행/Payment/Production 변경 없음).';
