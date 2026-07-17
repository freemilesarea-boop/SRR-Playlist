-- 0545_admin_ai_enterprise_strategy_intelligence.sql
-- AI-OPS-41 — Enterprise Strategy Intelligence, Strategic Portfolio &
-- Long-Horizon Planning Center.
--
-- Enterprise Vision Reference → Strategic Goal(계층/충돌) → Strategic Priority →
-- Strategic Initiative → Decision Portfolio → Initiative Dependency → Resource Demand →
-- Financial/Capacity/Workload Constraint → Portfolio Scenario → Long-Horizon Forecast →
-- Concentration/Diversification/Balance → Strategic Trade-off → Roadmap Candidate →
-- Human Strategy Review → Portfolio Approval Reference → Milestone/Commitment Reference →
-- Observed Strategic Outcome → Strategy Quality/Drift/Portfolio Drift → Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Strategy Candidate ≠ Approved Strategy. Portfolio Candidate ≠ Selected Portfolio.
--  * Roadmap Candidate ≠ Execution Schedule. Milestone Candidate ≠ Commitment.
--  * Portfolio Approval Reference ≠ 예산·자원 배분/Production Apply
--    (budget_allocated/resources_allocated/production_applied 항상 false).
--  * Budget Reference ≠ Available Cash. Resource Demand ≠ Reserved Resource.
--  * Concentration Candidate ≠ Confirmed Risk. Diversification ≠ Guaranteed Resilience.
--  * Robust Portfolio ≠ Correct Portfolio. Lowest Regret ≠ Best Strategy.
--  * 미실행 Initiative 를 Active/Completed 처럼 자동 기록하지 않음(Evidence 게이트).
--  * 자동 Strategy 확정/Portfolio 선택/예산·자원·인력 배정/Initiative 시작·중단/
--    Payment/Settlement/Contract/Pricing/Infrastructure/Production 변경 — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496~0544(0516/0524 corporate 계층 포함) 원본 무변경(참조만).
--  * Milestone/Review/Outcome/Dependency 는 신규 테이블 대신 JSONB + Events 통합(후보 8 → 4 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Strategic Goal(성과 보장 아님 — 계층 depth ≤ 6·circular/self 차단).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_strategic_goals (
  id                        uuid primary key default gen_random_uuid(),
  goal_code                 text not null,
  goal_name                 text not null,
  strategy_domain           text not null check (strategy_domain in ('enterprise_growth','market_expansion','product_expansion','service_expansion','customer_experience','store_growth','brand_growth','artist_ecosystem','content_supply','music_quality','playlist_quality','playback_reliability','operational_efficiency','automation_strategy','ai_capability','data_strategy','security_strategy','privacy_strategy','compliance_strategy','financial_sustainability','cost_optimization','revenue_growth_reference','capacity_strategy','infrastructure_strategy_reference','connector_strategy','partnership_strategy','contract_strategy_reference','organizational_capability','risk_reduction','innovation','strategic_resilience','custom_reference')),
  goal_type                 text not null default 'strategic_outcome_reference' check (goal_type in ('vision_reference','strategic_outcome_reference','growth_reference','resilience_reference','efficiency_reference','reliability_reference','financial_reference','customer_reference','operational_reference','capability_reference','compliance_reference','risk_reduction_reference','innovation_reference','custom_reference')),
  goal_status               text not null default 'draft' check (goal_status in ('draft','pending_evidence','pending_review','reviewed_reference','approved_strategy_reference','active_reference','paused_reference','deferred_reference','at_risk_candidate','blocked_candidate','achieved_reference','not_achieved_reference','superseded','invalidated','insufficient_data')),
  parent_goal_id            uuid,
  goal_level                int not null default 1 check (goal_level >= 1 and goal_level <= 6),
  goal_horizon              text,
  goal_summary              text,
  goal_rationale            text,
  target_scope_type         text not null default 'enterprise' check (target_scope_type in ('global','enterprise','brand','store','connector','automation','agent')),
  target_scope_id           text,
  target_metric_references  jsonb not null default '[]'::jsonb,
  baseline_references       jsonb not null default '[]'::jsonb,
  target_value_candidates   jsonb not null default '[]'::jsonb,
  target_range_candidates   jsonb not null default '[]'::jsonb,
  target_date_reference     timestamptz,
  success_conditions        jsonb not null default '[]'::jsonb,
  failure_conditions        jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  review_conditions         jsonb not null default '[]'::jsonb,
  priority_candidate        text not null default 'priority_unverified' check (priority_candidate in ('informational_candidate','low_candidate','normal_candidate','high_candidate','critical_candidate','priority_unverified','insufficient_data')),
  urgency_candidate         text not null default 'urgency_unverified' check (urgency_candidate in ('no_deadline_candidate','routine_candidate','time_sensitive_candidate','urgent_candidate','immediate_review_candidate','urgency_unverified','insufficient_data')),
  strategic_value_candidate jsonb,
  financial_value_reference jsonb,
  operational_value_candidate jsonb,
  customer_value_candidate  jsonb,
  risk_reduction_candidate  jsonb,
  goal_conflict_result      jsonb,
  dependencies              jsonb not null default '[]'::jsonb,
  blocking_conditions       jsonb not null default '[]'::jsonb,
  required_capabilities     jsonb not null default '[]'::jsonb,
  required_resources        jsonb not null default '[]'::jsonb,
  related_decision_references jsonb not null default '[]'::jsonb,
  related_commitment_references jsonb not null default '[]'::jsonb,
  related_knowledge_entities jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  missing_evidence          jsonb not null default '[]'::jsonb,
  conflicting_evidence      jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aesg_idem on public.ai_enterprise_strategic_goals (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aesg_status on public.ai_enterprise_strategic_goals (goal_status, strategy_domain, created_at desc);
create index if not exists idx_aesg_parent on public.ai_enterprise_strategic_goals (parent_goal_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Strategic Initiative(프로젝트 시작/실행 아님 — completed 는 Evidence+
--    외부 실행 Reference 필수).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_strategic_initiatives (
  id                        uuid primary key default gen_random_uuid(),
  initiative_code           text not null,
  initiative_name           text not null,
  strategy_domain           text not null,
  initiative_type           text not null check (initiative_type in ('research_reference','validation_reference','pilot_reference','phased_program_reference','capability_building_reference','operational_improvement_reference','product_development_reference','service_expansion_reference','market_expansion_reference','partnership_reference','connector_adoption_reference','infrastructure_planning_reference','cost_control_reference','risk_reduction_reference','governance_improvement_reference','compliance_improvement_reference','strategic_monitoring_reference','custom_reference')),
  initiative_status         text not null default 'draft' check (initiative_status in ('draft','pending_evidence','pending_review','viable_candidate','conditionally_viable_candidate','approved_strategy_reference','planned_reference','active_reference','paused_reference','deferred_reference','at_risk_candidate','blocked_candidate','completed_reference','completed_with_limitation','stopped_reference','rejected_reference','superseded','invalidated','insufficient_data')),
  initiative_summary        text,
  strategic_goal_references jsonb not null default '[]'::jsonb,
  decision_context_references jsonb not null default '[]'::jsonb,
  decision_option_references jsonb not null default '[]'::jsonb,
  executive_brief_references jsonb not null default '[]'::jsonb,
  owner_role_candidate      text,
  required_reviewer_roles   jsonb not null default '[]'::jsonb,
  target_scope_type         text not null default 'enterprise',
  target_scope_id           text,
  horizon_start_reference   timestamptz,
  horizon_end_reference     timestamptz,
  initiative_phase          text,
  sequence_candidate        int check (sequence_candidate is null or sequence_candidate >= 0),
  parallel_group_candidate  text,
  dependencies              jsonb not null default '[]'::jsonb,
  blocking_conditions       jsonb not null default '[]'::jsonb,
  prerequisite_capabilities jsonb not null default '[]'::jsonb,
  resource_demand           jsonb,
  financial_demand          jsonb,
  capacity_demand           jsonb,
  human_workload_demand     jsonb,
  connector_dependencies    jsonb not null default '[]'::jsonb,
  provider_dependencies     jsonb not null default '[]'::jsonb,
  contract_dependencies     jsonb not null default '[]'::jsonb,
  policy_constraints        jsonb not null default '[]'::jsonb,
  security_constraints      jsonb not null default '[]'::jsonb,
  privacy_constraints       jsonb not null default '[]'::jsonb,
  compliance_constraints    jsonb not null default '[]'::jsonb,
  expected_benefits         jsonb not null default '[]'::jsonb,
  expected_costs            jsonb not null default '[]'::jsonb,
  expected_revenue_reference jsonb,
  risk_projection           jsonb,
  opportunity_projection    jsonb,
  financial_impact          jsonb,
  capacity_impact           jsonb,
  operational_impact        jsonb,
  customer_experience_impact jsonb,
  store_operations_impact   jsonb,
  organizational_impact     jsonb,
  reversibility_result      jsonb,
  feasibility_result        jsonb,
  tradeoff_result           jsonb,
  robustness_result         jsonb,
  regret_result             jsonb,
  success_conditions        jsonb not null default '[]'::jsonb,
  failure_conditions        jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  observation_plan_reference jsonb,
  review_trigger_reference  jsonb,
  milestone_references      jsonb not null default '[]'::jsonb,
  commitment_references     jsonb not null default '[]'::jsonb,
  outcome_references        jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aesi_idem on public.ai_enterprise_strategic_initiatives (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aesi_status on public.ai_enterprise_strategic_initiatives (initiative_status, strategy_domain, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Strategy Portfolio(예산·자원 배분 아님 — 버전 관리·이전 결과 보존).
--    Scenario/Roadmap/Milestone/Review/Approval/Outcome/Quality/Drift JSONB 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_strategy_portfolios (
  id                        uuid primary key default gen_random_uuid(),
  portfolio_code            text not null,
  portfolio_name            text not null,
  portfolio_version         int not null default 1 check (portfolio_version >= 1),
  previous_portfolio_id     uuid,
  portfolio_status          text not null default 'draft' check (portfolio_status in ('draft','pending_evidence','pending_review','ready_for_strategy_review_reference','under_strategy_review','revision_requested','approved_strategy_reference','rejected_reference','deferred_reference','superseded','invalidated','outcome_pending','closed_reference','closed_with_limitation','insufficient_data')),
  portfolio_horizon_start   timestamptz,
  portfolio_horizon_end     timestamptz,
  enterprise_scope_id       text,
  brand_scope_references    jsonb not null default '[]'::jsonb,
  store_scope_references    jsonb not null default '[]'::jsonb,
  strategic_goal_references jsonb not null default '[]'::jsonb,
  initiative_references     jsonb not null default '[]'::jsonb,
  excluded_initiatives      jsonb not null default '[]'::jsonb,
  exclusion_reasons         jsonb not null default '[]'::jsonb,
  portfolio_scenarios       jsonb not null default '[]'::jsonb,
  selected_scenario_reference text,
  resource_envelope_reference jsonb,
  financial_envelope_reference jsonb,
  capacity_envelope_reference jsonb,
  human_workload_envelope_reference jsonb,
  allocation_candidates     jsonb not null default '[]'::jsonb,
  sequencing_candidate      jsonb,
  parallelization_candidate jsonb,
  critical_path_candidate   jsonb,
  concentration_result      jsonb,
  diversification_result    jsonb,
  balance_result            jsonb,
  financial_impact          jsonb,
  capacity_impact           jsonb,
  operational_impact        jsonb,
  customer_impact           jsonb,
  security_privacy_compliance_impact jsonb,
  risk_projection           jsonb,
  opportunity_projection    jsonb,
  tradeoff_result           jsonb,
  robustness_result         jsonb,
  regret_result             jsonb,
  reversibility_result      jsonb,
  feasibility_result        jsonb,
  roadmap_candidate         jsonb,
  milestone_candidates      jsonb not null default '[]'::jsonb,
  observation_plan_reference jsonb,
  review_trigger_reference  jsonb,
  recommendation_candidate  jsonb,
  strategy_reviews          jsonb not null default '[]'::jsonb,
  approval_reference        jsonb,
  outcome_reference         jsonb,
  strategy_quality_result   jsonb,
  strategy_drift_result     jsonb,
  portfolio_drift_result    jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aesp_idem on public.ai_enterprise_strategy_portfolios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aesp_status on public.ai_enterprise_strategy_portfolios (portfolio_status, portfolio_version desc, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Strategy 이벤트(43종) — Vision/Dependency/Conflict/Constraint/
--    Concentration/Balance/Trade-off/Roadmap/Milestone/Critical Path/
--    Review/Approval/Outcome/Quality/Drift/Learning 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_strategy_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('vision_reference_recorded','strategic_goal_created','strategic_goal_reviewed','strategic_goal_status_recorded','goal_dependency_recorded','goal_conflict_reviewed','strategic_priority_reviewed','strategic_initiative_created','strategic_initiative_reviewed','initiative_dependency_recorded','initiative_dependency_reviewed','strategy_portfolio_created','strategy_portfolio_versioned','portfolio_scenario_recorded','resource_demand_reviewed','financial_constraint_reviewed','capacity_constraint_reviewed','workload_constraint_reviewed','portfolio_concentration_reviewed','portfolio_diversification_reviewed','portfolio_balance_reviewed','strategic_tradeoff_reviewed','strategic_robustness_reviewed','strategic_regret_reviewed','strategic_reversibility_reviewed','strategic_feasibility_reviewed','roadmap_candidate_recorded','milestone_candidate_recorded','critical_path_reviewed','strategy_recommendation_recorded','human_strategy_review_started','portfolio_approval_reference_recorded','portfolio_rejection_reference_recorded','portfolio_defer_reference_recorded','strategy_revision_requested','commitment_reference_linked','decision_reference_linked','strategic_outcome_linked','strategy_quality_reviewed','strategy_drift_reviewed','portfolio_drift_reviewed','strategy_learning_reference_recorded','strategy_invalidated')),
  strategic_goal_id         uuid,
  strategic_initiative_id   uuid,
  strategy_portfolio_id     uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aese_evt on public.ai_enterprise_strategy_events (event_type, created_at desc);
create index if not exists idx_aese_pf on public.ai_enterprise_strategy_events (strategy_portfolio_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Strategic Goal 생성/검토 — circular/self parent 차단·depth ≤ 6·최대 200.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_strategic_goal_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_parent public.ai_enterprise_strategic_goals; v_level int := 1; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_strategic_goals;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'strategy_domain','');
  -- 초기 Phase 비활성 도메인(자동 집행/민감 전략 계열) — 구조적 차단.
  if v_domain in ('automatic_investment_execution','automatic_budget_allocation','automatic_resource_allocation','automatic_employee_assignment','automatic_hiring','automatic_termination','automatic_compensation','automatic_contract_execution','automatic_payment_execution','automatic_settlement_mutation','automatic_infrastructure_purchase','automatic_production_change','automatic_policy_application','personal_behavior_strategy','medical_strategy','credit_strategy') then
    raise exception '금지된 strategy domain(초기 Phase 비활성)';
  end if;
  if v_domain not in ('enterprise_growth','market_expansion','product_expansion','service_expansion','customer_experience','store_growth','brand_growth','artist_ecosystem','content_supply','music_quality','playlist_quality','playback_reliability','operational_efficiency','automation_strategy','ai_capability','data_strategy','security_strategy','privacy_strategy','compliance_strategy','financial_sustainability','cost_optimization','revenue_growth_reference','capacity_strategy','infrastructure_strategy_reference','connector_strategy','partnership_strategy','contract_strategy_reference','organizational_capability','risk_reduction','innovation','strategic_resilience','custom_reference') then
    raise exception '허용되지 않는 strategy_domain';
  end if;
  if coalesce(btrim(p_payload->>'goal_name'),'') = '' then raise exception 'goal_name 필수'; end if;
  if (select count(*) from public.ai_enterprise_strategic_goals) >= 200 then raise exception 'Strategic Goal 200개 초과(Goal Abuse 차단)'; end if;
  if nullif(p_payload->>'parent_goal_id','') is not null then
    select * into v_parent from public.ai_enterprise_strategic_goals where id = (p_payload->>'parent_goal_id')::uuid;
    if v_parent.id is null then raise exception 'Parent Goal 없음(실존 검증 실패)'; end if;
    v_level := v_parent.goal_level + 1;
    if v_level > 6 then raise exception 'Goal Hierarchy depth 6 초과'; end if;
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_strategic_goals where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'goal_is_not_guaranteed_outcome', true); end if;
  end if;
  insert into public.ai_enterprise_strategic_goals (goal_code, goal_name, strategy_domain, goal_type, parent_goal_id, goal_level, goal_horizon, goal_summary, goal_rationale, target_scope_type, target_scope_id, target_metric_references, baseline_references, target_value_candidates, target_range_candidates, target_date_reference, success_conditions, failure_conditions, stop_conditions, review_conditions, strategic_value_candidate, financial_value_reference, operational_value_candidate, customer_value_candidate, risk_reduction_candidate, dependencies, blocking_conditions, required_capabilities, required_resources, related_decision_references, related_commitment_references, related_knowledge_entities, evidence, missing_evidence, conflicting_evidence, assumptions, unknown_factors, external_factors, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'goal_code',''), 'ESG-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'goal_name', 200), v_domain,
    coalesce(nullif(p_payload->>'goal_type',''), 'strategic_outcome_reference'),
    nullif(p_payload->>'parent_goal_id','')::uuid, v_level,
    nullif(left(coalesce(p_payload->>'goal_horizon',''), 60),''),
    nullif(left(coalesce(p_payload->>'goal_summary',''), 2000),''), nullif(left(coalesce(p_payload->>'goal_rationale',''), 2000),''),
    coalesce(nullif(p_payload->>'target_scope_type',''), 'enterprise'), nullif(p_payload->>'target_scope_id',''),
    coalesce(p_payload->'target_metric_references', '[]'::jsonb), coalesce(p_payload->'baseline_references', '[]'::jsonb),
    coalesce(p_payload->'target_value_candidates', '[]'::jsonb), coalesce(p_payload->'target_range_candidates', '[]'::jsonb),
    nullif(p_payload->>'target_date_reference','')::timestamptz,
    coalesce(p_payload->'success_conditions', '[]'::jsonb), coalesce(p_payload->'failure_conditions', '[]'::jsonb),
    coalesce(p_payload->'stop_conditions', '[]'::jsonb), coalesce(p_payload->'review_conditions', '[]'::jsonb),
    p_payload->'strategic_value_candidate', p_payload->'financial_value_reference',
    p_payload->'operational_value_candidate', p_payload->'customer_value_candidate', p_payload->'risk_reduction_candidate',
    coalesce(p_payload->'dependencies', '[]'::jsonb), coalesce(p_payload->'blocking_conditions', '[]'::jsonb),
    coalesce(p_payload->'required_capabilities', '[]'::jsonb), coalesce(p_payload->'required_resources', '[]'::jsonb),
    coalesce(p_payload->'related_decision_references', '[]'::jsonb), coalesce(p_payload->'related_commitment_references', '[]'::jsonb),
    coalesce(p_payload->'related_knowledge_entities', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'missing_evidence', '[]'::jsonb),
    coalesce(p_payload->'conflicting_evidence', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategic_goal_id, detail, payload, actor_id)
  values ('strategic_goal_created', v_id, left(v_domain, 80) || ' (Goal ≠ Guaranteed Outcome — draft·자동 승인 없음)', jsonb_build_object('goal_name', p_payload->>'goal_name', 'goal_level', v_level), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'goal_level', v_level, 'initial_status', 'draft', 'goal_is_not_guaranteed_outcome', true, 'auto_approved', false, 'budget_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_strategic_goal_review(p_goal_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_strategic_goals; v_next text := null; v_evt text := 'strategic_goal_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_reviewed','approve_strategy','mark_active_reference','pause','defer','mark_at_risk','mark_blocked','mark_achieved','mark_not_achieved','supersede','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_strategic_goals where id = p_goal_id;
  if v_row.id is null then raise exception 'Strategic Goal 없음(실존 검증 실패)'; end if;
  if v_row.goal_status in ('superseded','invalidated','achieved_reference','not_achieved_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.goal_status;
  end if;
  if v_row.created_by = v_uid and p_action = 'approve_strategy' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action = 'approve_strategy' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Strategy 승인 금지(goal_basis_unverified)';
    end if;
    v_next := 'approved_strategy_reference'; v_note := v_note || ' (승인 Reference ≠ 예산·자원 배분)';
  elsif p_action = 'mark_active_reference' then
    v_next := 'active_reference'; v_evt := 'strategic_goal_status_recorded';
    v_note := ' (active_reference ≠ 실제 Initiative 실행 상태)';
  elsif p_action = 'pause' then v_next := 'paused_reference'; v_evt := 'strategic_goal_status_recorded';
  elsif p_action = 'defer' then v_next := 'deferred_reference'; v_evt := 'strategic_goal_status_recorded';
  elsif p_action = 'mark_at_risk' then v_next := 'at_risk_candidate'; v_evt := 'strategic_goal_status_recorded';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate'; v_evt := 'strategic_goal_status_recorded';
  elsif p_action = 'mark_achieved' then
    -- Evidence 없는 achieved 차단 — 달성 주장 ≠ 달성 사실.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 achieved 기록 금지';
    end if;
    v_next := 'achieved_reference'; v_evt := 'strategic_goal_status_recorded';
    v_note := ' (achieved_reference — Outcome ≠ Strategy Causality)';
  elsif p_action = 'mark_not_achieved' then v_next := 'not_achieved_reference'; v_evt := 'strategic_goal_status_recorded';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated'; v_evt := 'strategy_invalidated';
  end if;

  update public.ai_enterprise_strategic_goals set goal_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_goal_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategic_goal_id, detail, payload, actor_id)
  values (v_evt, p_goal_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_goal_id, 'status', v_next, 'goal_is_not_guaranteed_outcome', true, 'auto_approved', false, 'budget_allocated', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Strategic Initiative 생성/검토 — 금지 Type 차단·미실행 completed 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_strategic_initiative_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_type text; v_domain text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_strategic_initiatives;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'initiative_type','');
  -- 초기 Phase 금지 Initiative Type — 구조적 차단.
  if v_type in ('direct_production_execution','automatic_budget_spend','automatic_resource_assignment','automatic_contract_execution','automatic_payment','automatic_employee_action','automatic_infrastructure_purchase','automatic_policy_apply') then
    raise exception '금지된 initiative_type(초기 Phase 차단)';
  end if;
  if v_type not in ('research_reference','validation_reference','pilot_reference','phased_program_reference','capability_building_reference','operational_improvement_reference','product_development_reference','service_expansion_reference','market_expansion_reference','partnership_reference','connector_adoption_reference','infrastructure_planning_reference','cost_control_reference','risk_reduction_reference','governance_improvement_reference','compliance_improvement_reference','strategic_monitoring_reference','custom_reference') then
    raise exception '허용되지 않는 initiative_type';
  end if;
  v_domain := coalesce(p_payload->>'strategy_domain','');
  if coalesce(btrim(p_payload->>'initiative_name'),'') = '' then raise exception 'initiative_name 필수'; end if;
  if (select count(*) from public.ai_enterprise_strategic_initiatives) >= 200 then raise exception 'Strategic Initiative 200개 초과(Initiative Abuse 차단)'; end if;
  if jsonb_array_length(coalesce(p_payload->'dependencies', '[]'::jsonb)) > 500 then raise exception 'dependency 500개 초과'; end if;
  if nullif(p_payload->>'horizon_start_reference','') is not null and nullif(p_payload->>'horizon_end_reference','') is not null
     and (p_payload->>'horizon_end_reference')::timestamptz <= (p_payload->>'horizon_start_reference')::timestamptz then
    raise exception 'horizon 범위 오류(Date Abuse 차단)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_strategic_initiatives where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'initiative_is_not_execution', true); end if;
  end if;
  insert into public.ai_enterprise_strategic_initiatives (initiative_code, initiative_name, strategy_domain, initiative_type, initiative_summary, strategic_goal_references, decision_context_references, decision_option_references, executive_brief_references, owner_role_candidate, required_reviewer_roles, target_scope_type, target_scope_id, horizon_start_reference, horizon_end_reference, initiative_phase, sequence_candidate, parallel_group_candidate, dependencies, blocking_conditions, prerequisite_capabilities, resource_demand, financial_demand, capacity_demand, human_workload_demand, connector_dependencies, provider_dependencies, contract_dependencies, policy_constraints, security_constraints, privacy_constraints, compliance_constraints, expected_benefits, expected_costs, expected_revenue_reference, risk_projection, opportunity_projection, success_conditions, failure_conditions, stop_conditions, observation_plan_reference, review_trigger_reference, evidence, assumptions, unknown_factors, external_factors, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'initiative_code',''), 'ESI-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'initiative_name', 200), left(coalesce(nullif(v_domain,''), 'custom_reference'), 60), v_type,
    nullif(left(coalesce(p_payload->>'initiative_summary',''), 2000),''),
    coalesce(p_payload->'strategic_goal_references', '[]'::jsonb), coalesce(p_payload->'decision_context_references', '[]'::jsonb),
    coalesce(p_payload->'decision_option_references', '[]'::jsonb), coalesce(p_payload->'executive_brief_references', '[]'::jsonb),
    nullif(left(coalesce(p_payload->>'owner_role_candidate',''), 80),''), coalesce(p_payload->'required_reviewer_roles', '[]'::jsonb),
    coalesce(nullif(p_payload->>'target_scope_type',''), 'enterprise'), nullif(p_payload->>'target_scope_id',''),
    nullif(p_payload->>'horizon_start_reference','')::timestamptz, nullif(p_payload->>'horizon_end_reference','')::timestamptz,
    nullif(left(coalesce(p_payload->>'initiative_phase',''), 60),''),
    nullif(p_payload->>'sequence_candidate','')::int, nullif(left(coalesce(p_payload->>'parallel_group_candidate',''), 60),''),
    coalesce(p_payload->'dependencies', '[]'::jsonb), coalesce(p_payload->'blocking_conditions', '[]'::jsonb),
    coalesce(p_payload->'prerequisite_capabilities', '[]'::jsonb),
    p_payload->'resource_demand', p_payload->'financial_demand', p_payload->'capacity_demand', p_payload->'human_workload_demand',
    coalesce(p_payload->'connector_dependencies', '[]'::jsonb), coalesce(p_payload->'provider_dependencies', '[]'::jsonb),
    coalesce(p_payload->'contract_dependencies', '[]'::jsonb),
    coalesce(p_payload->'policy_constraints', '[]'::jsonb), coalesce(p_payload->'security_constraints', '[]'::jsonb),
    coalesce(p_payload->'privacy_constraints', '[]'::jsonb), coalesce(p_payload->'compliance_constraints', '[]'::jsonb),
    coalesce(p_payload->'expected_benefits', '[]'::jsonb), coalesce(p_payload->'expected_costs', '[]'::jsonb),
    p_payload->'expected_revenue_reference', p_payload->'risk_projection', p_payload->'opportunity_projection',
    coalesce(p_payload->'success_conditions', '[]'::jsonb), coalesce(p_payload->'failure_conditions', '[]'::jsonb),
    coalesce(p_payload->'stop_conditions', '[]'::jsonb),
    p_payload->'observation_plan_reference', p_payload->'review_trigger_reference',
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'assumptions', '[]'::jsonb),
    coalesce(p_payload->'unknown_factors', '[]'::jsonb), coalesce(p_payload->'external_factors', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategic_initiative_id, detail, payload, actor_id)
  values ('strategic_initiative_created', v_id, left(v_type, 80) || ' (Initiative ≠ 프로젝트 시작/실행 — draft)', jsonb_build_object('initiative_name', p_payload->>'initiative_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'initiative_is_not_execution', true, 'auto_approved', false, 'budget_allocated', false, 'resources_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_strategic_initiative_review(p_initiative_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_strategic_initiatives; v_next text := null; v_evt text := 'strategic_initiative_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_viable','mark_conditionally_viable','approve_strategy','mark_planned','pause','defer','mark_at_risk','mark_blocked','complete_reference','complete_with_limitation','stop_reference','reject','supersede','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_strategic_initiatives where id = p_initiative_id;
  if v_row.id is null then raise exception 'Strategic Initiative 없음(실존 검증 실패)'; end if;
  if v_row.initiative_status in ('superseded','invalidated','completed_reference','completed_with_limitation','stopped_reference','rejected_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.initiative_status;
  end if;
  if v_row.created_by = v_uid and p_action = 'approve_strategy' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_viable' then v_next := 'viable_candidate'; v_note := ' (Viable ≠ 실행)';
  elsif p_action = 'mark_conditionally_viable' then v_next := 'conditionally_viable_candidate';
  elsif p_action = 'approve_strategy' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Strategy 승인 금지(initiative_basis_unverified)';
    end if;
    v_next := 'approved_strategy_reference'; v_note := v_note || ' (승인 Reference ≠ Initiative 시작)';
  elsif p_action = 'mark_planned' then v_next := 'planned_reference';
  elsif p_action = 'pause' then v_next := 'paused_reference';
  elsif p_action = 'defer' then v_next := 'deferred_reference';
  elsif p_action = 'mark_at_risk' then v_next := 'at_risk_candidate';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate';
  elsif p_action in ('complete_reference','complete_with_limitation') then
    -- 실행하지 않은 Initiative 를 Completed 처럼 기록하지 않음 —
    -- Evidence + 외부 실행 Reference 필수.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed 기록 금지';
    end if;
    if coalesce(nullif(p_payload->>'external_execution_reference',''), '') = '' then
      raise exception '외부 실행 Reference 없는 completed 기록 금지(Initiative ≠ Execution)';
    end if;
    v_next := case when p_action = 'complete_reference' then 'completed_reference' else 'completed_with_limitation' end;
    v_note := ' (completed_reference — Outcome ≠ Causality)';
    update public.ai_enterprise_strategic_initiatives set outcome_references = outcome_references || jsonb_build_array(p_payload) where id = p_initiative_id;
  elsif p_action = 'stop_reference' then v_next := 'stopped_reference';
  elsif p_action = 'reject' then v_next := 'rejected_reference';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated'; v_evt := 'strategy_invalidated';
  end if;

  update public.ai_enterprise_strategic_initiatives set initiative_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_initiative_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategic_initiative_id, detail, payload, actor_id)
  values (v_evt, p_initiative_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_initiative_id, 'status', v_next, 'initiative_is_not_execution', true, 'auto_approved', false, 'budget_allocated', false, 'resources_allocated', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Strategy Portfolio 생성(버전 포함)/Human Strategy Review.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_strategy_portfolio_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_prev public.ai_enterprise_strategy_portfolios; v_version int := 1; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_strategy_portfolios;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 65536 then raise exception 'portfolio payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(btrim(p_payload->>'portfolio_name'),'') = '' then raise exception 'portfolio_name 필수'; end if;
  if jsonb_array_length(coalesce(p_payload->'initiative_references', '[]'::jsonb)) > 100 then raise exception 'Portfolio Initiative 100개 초과'; end if;
  if jsonb_array_length(coalesce(p_payload->'portfolio_scenarios', '[]'::jsonb)) > 20 then raise exception 'Portfolio Scenario 20개 초과'; end if;
  if jsonb_array_length(coalesce(p_payload->'milestone_candidates', '[]'::jsonb)) > 200 then raise exception 'Milestone 200개 초과'; end if;
  if nullif(p_payload->>'portfolio_horizon_start','') is not null and nullif(p_payload->>'portfolio_horizon_end','') is not null
     and (p_payload->>'portfolio_horizon_end')::timestamptz <= (p_payload->>'portfolio_horizon_start')::timestamptz then
    raise exception 'portfolio horizon 범위 오류(Date Abuse 차단)';
  end if;
  if nullif(p_payload->>'previous_portfolio_id','') is not null then
    select * into v_prev from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'previous_portfolio_id')::uuid;
    if v_prev.id is null then raise exception '이전 Portfolio 없음(실존 검증 실패)'; end if;
    v_version := v_prev.portfolio_version + 1;
    -- 이전 Portfolio 결과를 덮어쓰지 않음 — superseded 표시만.
    update public.ai_enterprise_strategy_portfolios set portfolio_status = 'superseded', updated_at = now() where id = v_prev.id and portfolio_status not in ('superseded','invalidated');
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_strategy_portfolios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'portfolio_is_not_selected_portfolio', true); end if;
  end if;
  insert into public.ai_enterprise_strategy_portfolios (portfolio_code, portfolio_name, portfolio_version, previous_portfolio_id, portfolio_horizon_start, portfolio_horizon_end, enterprise_scope_id, brand_scope_references, store_scope_references, strategic_goal_references, initiative_references, excluded_initiatives, exclusion_reasons, portfolio_scenarios, selected_scenario_reference, resource_envelope_reference, financial_envelope_reference, capacity_envelope_reference, human_workload_envelope_reference, allocation_candidates, sequencing_candidate, parallelization_candidate, critical_path_candidate, risk_projection, opportunity_projection, roadmap_candidate, milestone_candidates, observation_plan_reference, review_trigger_reference, recommendation_candidate, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'portfolio_code',''), 'ESP-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'portfolio_name', 200), v_version, nullif(p_payload->>'previous_portfolio_id','')::uuid,
    nullif(p_payload->>'portfolio_horizon_start','')::timestamptz, nullif(p_payload->>'portfolio_horizon_end','')::timestamptz,
    nullif(p_payload->>'enterprise_scope_id',''),
    coalesce(p_payload->'brand_scope_references', '[]'::jsonb), coalesce(p_payload->'store_scope_references', '[]'::jsonb),
    coalesce(p_payload->'strategic_goal_references', '[]'::jsonb), coalesce(p_payload->'initiative_references', '[]'::jsonb),
    coalesce(p_payload->'excluded_initiatives', '[]'::jsonb), coalesce(p_payload->'exclusion_reasons', '[]'::jsonb),
    coalesce(p_payload->'portfolio_scenarios', '[]'::jsonb), nullif(p_payload->>'selected_scenario_reference',''),
    p_payload->'resource_envelope_reference', p_payload->'financial_envelope_reference',
    p_payload->'capacity_envelope_reference', p_payload->'human_workload_envelope_reference',
    coalesce(p_payload->'allocation_candidates', '[]'::jsonb),
    p_payload->'sequencing_candidate', p_payload->'parallelization_candidate', p_payload->'critical_path_candidate',
    p_payload->'risk_projection', p_payload->'opportunity_projection',
    p_payload->'roadmap_candidate', coalesce(p_payload->'milestone_candidates', '[]'::jsonb),
    p_payload->'observation_plan_reference', p_payload->'review_trigger_reference', p_payload->'recommendation_candidate',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategy_portfolio_id, detail, payload, actor_id)
  values (case when v_version > 1 then 'strategy_portfolio_versioned' else 'strategy_portfolio_created' end, v_id,
    'v' || v_version::text || ' (Portfolio ≠ Selected Portfolio — 예산·자원 배분 아님)', jsonb_build_object('portfolio_version', v_version), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'portfolio_version', v_version, 'initial_status', 'draft', 'portfolio_is_not_selected_portfolio', true, 'auto_approved', false, 'budget_allocated', false, 'resources_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_strategy_portfolio_review(p_portfolio_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_strategy_portfolios; v_next text := null; v_evt text := 'human_strategy_review_started'; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','mark_ready_for_strategy_review','start_strategy_review','approve_portfolio_reference','approve_with_conditions_reference','reject_portfolio_reference','defer_portfolio_reference','request_revision_reference','request_more_evidence_reference','request_specialist_review_reference','mark_outcome_pending','close_reference','close_with_limitation','invalidate') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(승인/거절/보류/수정 전부)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_strategy_portfolios where id = p_portfolio_id;
  if v_row.id is null then raise exception 'Strategy Portfolio 없음(실존 검증 실패)'; end if;
  if v_row.portfolio_status in ('superseded','invalidated','closed_reference','closed_with_limitation','approved_strategy_reference','rejected_reference') then
    raise exception '종결/결정 상태 재결정 차단(%)', v_row.portfolio_status;
  end if;
  if p_action in ('approve_portfolio_reference','approve_with_conditions_reference') then
    -- Self-Approval 차단 + Evidence 필수(Approval Reference ≠ 예산·자원 배분).
    if v_row.created_by = v_uid then raise exception 'Self-Approval 차단(작성자 ≠ 승인자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Portfolio Approval Reference 금지';
    end if;
  end if;
  if p_action = 'mark_ready_for_strategy_review' and (p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0) then
    raise exception 'Evidence 없는 Strategy Review 상정 금지';
  end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence'; v_evt := 'strategy_revision_requested';
  elsif p_action = 'mark_ready_for_strategy_review' then v_next := 'ready_for_strategy_review_reference';
  elsif p_action = 'start_strategy_review' then v_next := 'under_strategy_review';
  elsif p_action in ('approve_portfolio_reference','approve_with_conditions_reference') then
    v_next := 'approved_strategy_reference'; v_evt := 'portfolio_approval_reference_recorded';
    v_note := ' (Approval Reference ≠ 예산·자원 배분/Production Apply — 전부 false)';
  elsif p_action = 'reject_portfolio_reference' then v_next := 'rejected_reference'; v_evt := 'portfolio_rejection_reference_recorded';
  elsif p_action = 'defer_portfolio_reference' then v_next := 'deferred_reference'; v_evt := 'portfolio_defer_reference_recorded';
  elsif p_action = 'request_revision_reference' then v_next := 'revision_requested'; v_evt := 'strategy_revision_requested';
  elsif p_action = 'request_more_evidence_reference' then v_next := 'pending_evidence'; v_evt := 'strategy_revision_requested';
  elsif p_action = 'request_specialist_review_reference' then v_next := 'pending_review'; v_evt := 'strategy_revision_requested';
  elsif p_action = 'mark_outcome_pending' then v_next := 'outcome_pending';
  elsif p_action in ('close_reference','close_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Closure 금지';
    end if;
    v_next := case when p_action = 'close_reference' then 'closed_reference' else 'closed_with_limitation' end;
  else v_next := 'invalidated'; v_evt := 'strategy_invalidated';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'portfolio_version', v_row.portfolio_version,
    'selected_scenario_reference', nullif(p_payload->>'selected_scenario_reference',''),
    'conditions', coalesce(p_payload->'conditions', '[]'::jsonb),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'required_specialists', coalesce(p_payload->'required_specialists', '[]'::jsonb),
    'approved_goal_references', coalesce(p_payload->'approved_goal_references', '[]'::jsonb),
    'approved_initiative_references', coalesce(p_payload->'approved_initiative_references', '[]'::jsonb),
    'excluded_initiative_references', coalesce(p_payload->'excluded_initiative_references', '[]'::jsonb),
    'exclusion_reasons', coalesce(p_payload->'exclusion_reasons', '[]'::jsonb),
    'milestone_references', coalesce(p_payload->'milestone_references', '[]'::jsonb),
    'commitment_references', coalesce(p_payload->'commitment_references', '[]'::jsonb),
    'decision_references', coalesce(p_payload->'decision_references', '[]'::jsonb),
    'observation_plan_reference', p_payload->'observation_plan_reference',
    'review_trigger_reference', p_payload->'review_trigger_reference',
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_strategy_decision_confirmed', true,
    'budget_allocated', false, 'resources_allocated', false, 'production_applied', false);
  update public.ai_enterprise_strategy_portfolios set
    portfolio_status = v_next, reviewed_by = v_uid, updated_at = now(),
    strategy_reviews = strategy_reviews || jsonb_build_array(v_review),
    approval_reference = case when p_action in ('approve_portfolio_reference','approve_with_conditions_reference') then v_review else approval_reference end
  where id = p_portfolio_id;
  insert into public.ai_enterprise_strategy_events (event_type, strategy_portfolio_id, detail, payload, actor_id)
  values (v_evt, p_portfolio_id, left(p_reason, 200) || v_note, v_review || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_portfolio_id, 'status', v_next, 'review_action', p_action, 'human_strategy_decision_confirmed', true, 'approval_is_not_allocation', true, 'auto_approved', false, 'budget_allocated', false, 'resources_allocated', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Strategy 이벤트 기록(통합) — Vision/Dependency/Conflict/Priority/
--    Constraint/Concentration/Diversification/Balance/Trade-off/Robustness/
--    Regret/Reversibility/Feasibility/Roadmap/Milestone/Critical Path/
--    Recommendation/Reference Link/Outcome/Quality/Drift/Learning.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_strategy_event_record(p_kind text, p_reason text, p_payload jsonb, p_goal_id uuid default null, p_initiative_id uuid default null, p_portfolio_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('vision_reference_recorded','goal_dependency_recorded','goal_conflict_reviewed','strategic_priority_reviewed','initiative_dependency_recorded','initiative_dependency_reviewed','portfolio_scenario_recorded','resource_demand_reviewed','financial_constraint_reviewed','capacity_constraint_reviewed','workload_constraint_reviewed','portfolio_concentration_reviewed','portfolio_diversification_reviewed','portfolio_balance_reviewed','strategic_tradeoff_reviewed','strategic_robustness_reviewed','strategic_regret_reviewed','strategic_reversibility_reviewed','strategic_feasibility_reviewed','roadmap_candidate_recorded','milestone_candidate_recorded','critical_path_reviewed','strategy_recommendation_recorded','commitment_reference_linked','decision_reference_linked','strategic_outcome_linked','strategy_quality_reviewed','strategy_drift_reviewed','portfolio_drift_reviewed','strategy_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_goal_id is not null and not exists (select 1 from public.ai_enterprise_strategic_goals where id = p_goal_id) then raise exception 'Goal 없음(실존 검증 실패)'; end if;
  if p_initiative_id is not null and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = p_initiative_id) then raise exception 'Initiative 없음(실존 검증 실패)'; end if;
  if p_portfolio_id is not null and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = p_portfolio_id) then raise exception 'Portfolio 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'goal_conflict_reviewed' then
    if v_result not in ('no_material_conflict_candidate','minor_conflict_candidate','moderate_conflict_candidate','major_conflict_candidate','structural_conflict_candidate','conflict_unverified','insufficient_data') then raise exception '허용되지 않는 conflict result'; end if;
    if p_goal_id is not null then update public.ai_enterprise_strategic_goals set goal_conflict_result = p_payload, updated_at = now() where id = p_goal_id; end if;
  end if;
  if p_kind = 'strategic_priority_reviewed' then
    if v_result not in ('informational_candidate','low_candidate','normal_candidate','high_candidate','critical_candidate','priority_unverified','insufficient_data') then raise exception '허용되지 않는 priority result'; end if;
    if p_goal_id is not null then update public.ai_enterprise_strategic_goals set priority_candidate = v_result, updated_at = now() where id = p_goal_id; end if;
  end if;
  if p_kind in ('initiative_dependency_recorded','initiative_dependency_reviewed') then
    if p_kind = 'initiative_dependency_recorded' and coalesce(p_payload->>'dependency_type','') not in ('prerequisite','enables','blocks','conflicts','shares_resource','shares_budget','shares_capacity','shares_provider','shares_connector','shares_contract','requires_policy','requires_approval','requires_capability','requires_milestone','replaces','supersedes','related_reference','unknown') then
      raise exception '허용되지 않는 dependency_type';
    end if;
    if p_kind = 'initiative_dependency_reviewed' and v_result not in ('dependency_ready_reference','dependency_partial','circular_dependency_candidate','dependency_conflict_candidate','dependency_blocked_candidate','dependency_unverified','insufficient_data') then
      raise exception '허용되지 않는 dependency result';
    end if;
  end if;
  if p_kind = 'portfolio_scenario_recorded' then
    if coalesce(p_payload->>'scenario_type','') not in ('base_case_candidate','growth_case_candidate','conservative_case_candidate','aggressive_case_candidate','budget_constrained_candidate','capacity_constrained_candidate','workforce_constrained_candidate','provider_failure_candidate','connector_failure_candidate','market_slowdown_candidate','accelerated_growth_candidate','compliance_constraint_candidate','no_new_initiative_candidate','strategic_focus_candidate','strategic_diversification_candidate','custom_reference') then
      raise exception '허용되지 않는 scenario_type';
    end if;
  end if;
  if p_kind = 'resource_demand_reviewed' and v_result not in ('resource_demand_ready_reference','resource_demand_partial','resource_bottleneck_candidate','specialist_shortage_candidate','reviewer_shortage_candidate','resource_availability_unverified','insufficient_data') then
    raise exception '허용되지 않는 resource result';
  end if;
  if p_kind = 'financial_constraint_reviewed' then
    if v_result not in ('within_budget_candidate','conditionally_within_budget_candidate','budget_pressure_candidate','budget_constraint_candidate','budget_exceeded_candidate','budget_unverified','insufficient_data') then raise exception '허용되지 않는 financial constraint result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set financial_impact = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'capacity_constraint_reviewed' then
    if v_result not in ('capacity_available_candidate','capacity_tight_candidate','capacity_bottleneck_candidate','capacity_exhaustion_candidate','capacity_unverified','insufficient_data') then raise exception '허용되지 않는 capacity result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set capacity_impact = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'workload_constraint_reviewed' and v_result not in ('workload_available_candidate','workload_pressure_candidate','workload_overload_candidate','reviewer_bottleneck_candidate','specialist_bottleneck_candidate','workload_unverified','insufficient_data') then
    raise exception '허용되지 않는 workload result';
  end if;
  if p_kind = 'portfolio_concentration_reviewed' then
    if v_result not in ('low_concentration_candidate','moderate_concentration_candidate','high_concentration_candidate','critical_concentration_candidate','concentration_unverified','insufficient_data') then raise exception '허용되지 않는 concentration result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set concentration_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_diversification_reviewed' then
    if v_result not in ('diversified_candidate','moderately_diversified_candidate','limited_diversification_candidate','superficial_diversification_candidate','diversification_unverified','insufficient_data') then raise exception '허용되지 않는 diversification result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set diversification_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_balance_reviewed' then
    if v_result not in ('balanced_portfolio_candidate','growth_heavy_candidate','stability_heavy_candidate','cost_heavy_candidate','innovation_heavy_candidate','risk_heavy_candidate','fragmented_portfolio_candidate','unbalanced_portfolio_candidate','balance_unverified','insufficient_data') then raise exception '허용되지 않는 balance result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set balance_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategic_tradeoff_reviewed' then
    if coalesce(p_payload->>'axis','') not in ('short_term_vs_long_term','growth_vs_stability','innovation_vs_reliability','cost_vs_quality','speed_vs_safety','concentration_vs_diversification','investment_vs_cash_preservation','automation_vs_human_control','expansion_vs_operational_readiness','customer_growth_vs_service_quality','capability_building_vs_immediate_revenue','reversible_option_vs_time_to_value','strategic_focus_vs_optionality') then
      raise exception '허용되지 않는 tradeoff axis';
    end if;
    if v_result not in ('favorable_tradeoff_candidate','balanced_tradeoff_candidate','unfavorable_tradeoff_candidate','mixed_tradeoff_candidate','tradeoff_unverified','insufficient_data') then raise exception '허용되지 않는 tradeoff result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set tradeoff_result = coalesce(tradeoff_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'axis', p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategic_robustness_reviewed' then
    if v_result not in ('robust_portfolio_candidate','conditionally_robust_candidate','fragile_portfolio_candidate','scenario_specific_candidate','robustness_unverified','insufficient_data') then raise exception '허용되지 않는 robustness result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set robustness_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategic_regret_reviewed' then
    if v_result not in ('lowest_regret_portfolio_candidate','low_regret_candidate','moderate_regret_candidate','high_regret_candidate','asymmetric_regret_candidate','regret_unverified','insufficient_data') then raise exception '허용되지 않는 regret result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set regret_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategic_reversibility_reviewed' then
    if v_result not in ('highly_reversible_candidate','reversible_with_condition_candidate','partially_reversible_candidate','difficult_to_reverse_candidate','irreversible_candidate','reversibility_unverified','insufficient_data') then raise exception '허용되지 않는 reversibility result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set reversibility_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
    if p_initiative_id is not null then update public.ai_enterprise_strategic_initiatives set reversibility_result = p_payload, updated_at = now() where id = p_initiative_id; end if;
  end if;
  if p_kind = 'strategic_feasibility_reviewed' then
    if v_result not in ('feasible_portfolio_candidate','conditionally_feasible_candidate','feasibility_blocked_candidate','feasibility_unverified','insufficient_data') then raise exception '허용되지 않는 feasibility result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set feasibility_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
    if p_initiative_id is not null then update public.ai_enterprise_strategic_initiatives set feasibility_result = p_payload, updated_at = now() where id = p_initiative_id; end if;
  end if;
  if p_kind = 'roadmap_candidate_recorded' and p_portfolio_id is not null then
    update public.ai_enterprise_strategy_portfolios set roadmap_candidate = p_payload, updated_at = now() where id = p_portfolio_id;
  end if;
  if p_kind = 'milestone_candidate_recorded' then
    if coalesce(nullif(p_payload->>'milestone_status',''), 'draft') not in ('draft','pending_evidence','pending_review','planned_reference','at_risk_candidate','blocked_candidate','achieved_reference','not_achieved_reference','deferred_reference','invalidated','insufficient_data') then
      raise exception '허용되지 않는 milestone_status';
    end if;
    -- 실제 완료 Evidence 없는 achieved 차단.
    if coalesce(p_payload->>'milestone_status','') = 'achieved_reference'
       and (p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0) then
      raise exception 'Evidence 없는 milestone achieved 금지';
    end if;
    if p_portfolio_id is not null then
      update public.ai_enterprise_strategy_portfolios set milestone_candidates = milestone_candidates || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id;
    end if;
  end if;
  if p_kind = 'critical_path_reviewed' then
    if v_result not in ('critical_path_candidate','multiple_critical_paths_candidate','near_critical_path_candidate','path_blocked_candidate','critical_path_unverified','insufficient_data') then raise exception '허용되지 않는 critical path result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set critical_path_candidate = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategy_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_strategic_goal','review_goal_conflict','create_strategic_initiative','gather_strategy_evidence','review_initiative_dependency','create_strategy_portfolio','create_portfolio_version','generate_base_portfolio_scenario','generate_budget_constrained_scenario','generate_capacity_constrained_scenario','review_resource_demand','review_financial_constraint','review_capacity_constraint','review_workload_constraint','reduce_portfolio_concentration_candidate','improve_portfolio_diversification_candidate','rebalance_portfolio_candidate','prioritize_initiative_candidate','defer_initiative_candidate','pause_initiative_reference','reject_current_portfolio_candidate','gather_more_evidence_candidate','request_specialist_review_candidate','create_roadmap_candidate','review_critical_path_candidate','request_human_strategy_review','record_portfolio_approval_reference','link_milestone_reference','link_commitment_reference','link_strategic_outcome','review_strategy_quality','review_strategy_drift','record_strategy_learning_reference','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Strategy Recommendation 금지';
    end if;
  end if;
  if p_kind = 'commitment_reference_linked' then
    if nullif(p_payload->>'commitment_id','') is not null
       and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
      raise exception 'Commitment 없음(실존 검증 실패)';
    end if;
    if p_initiative_id is not null then
      update public.ai_enterprise_strategic_initiatives set commitment_references = commitment_references || jsonb_build_array(p_payload), updated_at = now() where id = p_initiative_id;
    end if;
  end if;
  if p_kind = 'decision_reference_linked' then
    if nullif(p_payload->>'decision_context_id','') is not null
       and not exists (select 1 from public.ai_enterprise_decision_contexts where id = (p_payload->>'decision_context_id')::uuid) then
      raise exception 'Decision Context 없음(실존 검증 실패)';
    end if;
  end if;
  if p_kind = 'strategic_outcome_linked' and p_portfolio_id is not null then
    update public.ai_enterprise_strategy_portfolios set outcome_reference = p_payload, updated_at = now() where id = p_portfolio_id;
  end if;
  if p_kind = 'strategy_quality_reviewed' then
    if v_result not in ('high_quality_candidate','moderate_quality_candidate','low_quality_candidate','mixed_quality_candidate','outcome_unverified','causality_unverified','sample_too_small','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set strategy_quality_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'strategy_drift_reviewed' then
    if v_result not in ('no_material_drift_candidate','minor_drift_candidate','moderate_drift_candidate','severe_drift_candidate','structural_drift_candidate','drift_unverified','insufficient_data') then raise exception '허용되지 않는 drift result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set strategy_drift_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_drift_reviewed' then
    if v_result not in ('no_material_portfolio_drift_candidate','minor_portfolio_drift_candidate','moderate_portfolio_drift_candidate','severe_portfolio_drift_candidate','structural_portfolio_drift_candidate','portfolio_drift_unverified','insufficient_data') then raise exception '허용되지 않는 portfolio drift result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_strategy_portfolios set portfolio_drift_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;

  insert into public.ai_enterprise_strategy_events (event_type, strategic_goal_id, strategic_initiative_id, strategy_portfolio_id, detail, payload, actor_id)
  values (p_kind, p_goal_id, p_initiative_id, p_portfolio_id,
    left(p_reason, 200) || case
      when p_kind = 'vision_reference_recorded' then ' (Vision Reference ≠ 공식 Corporate Vision 확정)'
      when p_kind = 'goal_conflict_reviewed' then ' (Conflict Candidate ≠ 자동 Goal 제거 근거)'
      when p_kind = 'strategic_priority_reviewed' then ' (Priority Candidate ≠ Final Priority — 자동 정렬/승인 없음)'
      when p_kind like 'initiative_dependency%' then ' (Dependency Candidate ≠ Confirmed Dependency)'
      when p_kind = 'portfolio_scenario_recorded' then ' (Portfolio Scenario ≠ Reality)'
      when p_kind = 'resource_demand_reviewed' then ' (Resource Demand ≠ Reserved Resource)'
      when p_kind = 'financial_constraint_reviewed' then ' (Budget Reference ≠ Available Cash)'
      when p_kind = 'capacity_constraint_reviewed' then ' (Capacity Estimate ≠ Capacity Guarantee)'
      when p_kind = 'workload_constraint_reviewed' then ' (자동 인사 배치/평가 없음)'
      when p_kind = 'portfolio_concentration_reviewed' then ' (Concentration Candidate ≠ Confirmed Risk)'
      when p_kind = 'portfolio_diversification_reviewed' then ' (Diversification ≠ Guaranteed Resilience·자동 분산 권고 아님)'
      when p_kind = 'strategic_tradeoff_reviewed' then ' (자동 점수 Portfolio 선택 없음)'
      when p_kind = 'strategic_robustness_reviewed' then ' (Robust Portfolio ≠ Correct Portfolio)'
      when p_kind = 'strategic_regret_reviewed' then ' (Lowest Regret ≠ Best Strategy)'
      when p_kind = 'strategic_reversibility_reviewed' then ' (Reversibility ≠ Guaranteed Exit)'
      when p_kind = 'strategic_feasibility_reviewed' then ' (Feasibility ≠ Resource Reservation)'
      when p_kind = 'roadmap_candidate_recorded' then ' (Roadmap Candidate ≠ Execution Schedule)'
      when p_kind = 'milestone_candidate_recorded' then ' (Milestone Candidate ≠ Commitment)'
      when p_kind = 'critical_path_reviewed' then ' (Critical Path Candidate ≠ 일정 보장)'
      when p_kind = 'strategy_recommendation_recorded' then ' (Recommendation Candidate ≠ Approval)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ Completed Commitment)'
      when p_kind = 'decision_reference_linked' then ' (Decision Reference ≠ Execution)'
      when p_kind = 'strategic_outcome_linked' then ' (Outcome Link ≠ Strategy Causality)'
      when p_kind = 'strategy_quality_reviewed' then ' (Quality Candidate ≠ 경영진 성과 평가)'
      when p_kind = 'strategy_drift_reviewed' then ' (Drift Candidate ≠ Confirmed Failure)'
      when p_kind = 'portfolio_drift_reviewed' then ' (Portfolio Drift ≠ 자동 재조정 신호)'
      when p_kind = 'strategy_learning_reference_recorded' then ' (Learning Reference ≠ 자동 Goal·Portfolio 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_approved', false, 'budget_allocated', false, 'resources_allocated', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_strategic_goals(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_strategic_goals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_strategic_goals
  where (p_status is null or goal_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_strategic_initiatives(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_strategic_initiatives language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_strategic_initiatives
  where (p_status is null or initiative_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_strategy_portfolios(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_strategy_portfolios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_strategy_portfolios
  where (p_status is null or portfolio_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_strategy_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'goals', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_strategic_goals),
      'pending_review', (select count(*) from public.ai_enterprise_strategic_goals where goal_status in ('pending_evidence','pending_review')),
      'approved', (select count(*) from public.ai_enterprise_strategic_goals where goal_status = 'approved_strategy_reference'),
      'active_reference', (select count(*) from public.ai_enterprise_strategic_goals where goal_status = 'active_reference'),
      'at_risk', (select count(*) from public.ai_enterprise_strategic_goals where goal_status = 'at_risk_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_strategic_goals where goal_status = 'blocked_candidate'),
      'achieved', (select count(*) from public.ai_enterprise_strategic_goals where goal_status = 'achieved_reference'),
      'critical_priority', (select count(*) from public.ai_enterprise_strategic_goals where priority_candidate = 'critical_candidate'),
      'by_domain', (select coalesce(jsonb_object_agg(strategy_domain, cnt), '{}'::jsonb) from (select strategy_domain, count(*) cnt from public.ai_enterprise_strategic_goals group by strategy_domain) t)
    ),
    'initiatives', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_strategic_initiatives),
      'pending_review', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status in ('pending_evidence','pending_review')),
      'viable', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status = 'viable_candidate'),
      'approved', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status = 'approved_strategy_reference'),
      'blocked', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status = 'blocked_candidate'),
      'deferred', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status = 'deferred_reference'),
      'at_risk', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status = 'at_risk_candidate'),
      'completed_reference', (select count(*) from public.ai_enterprise_strategic_initiatives where initiative_status in ('completed_reference','completed_with_limitation'))
    ),
    'portfolios', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'pending_review', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status in ('ready_for_strategy_review_reference','under_strategy_review')),
      'revision_requested', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status = 'revision_requested'),
      'approved_references', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status = 'approved_strategy_reference'),
      'rejected_references', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status = 'rejected_reference'),
      'deferred_references', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status = 'deferred_reference'),
      'outcome_pending', (select count(*) from public.ai_enterprise_strategy_portfolios where portfolio_status = 'outcome_pending'),
      'max_version', (select coalesce(max(portfolio_version), 0) from public.ai_enterprise_strategy_portfolios)
    ),
    'strategy_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_strategy_events),
      'vision_references', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'vision_reference_recorded'),
      'goal_dependencies', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'goal_dependency_recorded'),
      'goal_conflicts', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'goal_conflict_reviewed'),
      'priority_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_priority_reviewed'),
      'initiative_dependencies', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'initiative_dependency_recorded'),
      'dependency_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'initiative_dependency_reviewed'),
      'scenarios', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_scenario_recorded'),
      'resource_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'resource_demand_reviewed'),
      'financial_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'financial_constraint_reviewed'),
      'capacity_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'capacity_constraint_reviewed'),
      'workload_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'workload_constraint_reviewed'),
      'concentration_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_concentration_reviewed'),
      'diversification_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_diversification_reviewed'),
      'balance_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_balance_reviewed'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_tradeoff_reviewed'),
      'robustness_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_robustness_reviewed'),
      'regret_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_regret_reviewed'),
      'reversibility_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_reversibility_reviewed'),
      'feasibility_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_feasibility_reviewed'),
      'roadmaps', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'roadmap_candidate_recorded'),
      'milestones', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'milestone_candidate_recorded'),
      'critical_paths', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'critical_path_reviewed'),
      'recommendations', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategy_recommendation_recorded'),
      'strategy_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'human_strategy_review_started'),
      'portfolio_approvals', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_approval_reference_recorded'),
      'portfolio_rejections', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_rejection_reference_recorded'),
      'portfolio_defers', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_defer_reference_recorded'),
      'revision_requests', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategy_revision_requested'),
      'commitment_links', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'commitment_reference_linked'),
      'decision_links', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'decision_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategic_outcome_linked'),
      'quality_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategy_quality_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategy_drift_reviewed'),
      'portfolio_drift_reviews', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'portfolio_drift_reviewed'),
      'learning_references', (select count(*) from public.ai_enterprise_strategy_events where event_type = 'strategy_learning_reference_recorded')
    ),
    -- Strategy 원천 실측(전부 읽기 전용):
    'strategy_actuals', jsonb_build_object(
      'decision_contexts_0544', (select count(*) from public.ai_enterprise_decision_contexts),
      'executive_briefs_0544', (select count(*) from public.ai_enterprise_executive_briefs),
      'decision_memory_0514', (select count(*) from public.ai_decision_memory),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'commitment_milestones_0520', (select count(*) from public.ai_commitment_milestones),
      'scenario_runs_0542', (select count(*) from public.ai_enterprise_scenario_runs),
      'forecast_runs_0543', (select count(*) from public.ai_enterprise_forecast_runs),
      'warning_candidates_0543', (select count(*) from public.ai_enterprise_early_warning_candidates),
      'capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots),
      'cost_snapshots_0508', (select count(*) from public.ai_cost_snapshots),
      'corporate_visions_0524', (select count(*) from public.ai_corporate_vision_records),
      'enterprise_contracts_0383', (select count(*) from public.enterprise_contracts),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities)
    ),
    'strategy_unavailable', jsonb_build_array('official_corporate_vision_dataset','budget_actuals_feed','cash_flow_feed','org_capacity_directory','provider_dependency_feed','project_management_system','initiative_execution_tracker','resource_reservation_system'),   -- 원본 없음(실측)
    'strategy_candidate_is_not_approved_strategy', true, 'portfolio_candidate_is_not_selected_portfolio', true,
    'roadmap_candidate_is_not_execution_schedule', true, 'milestone_candidate_is_not_commitment', true,
    'approval_reference_is_not_allocation', true, 'budget_reference_is_not_cash', true,
    'concentration_is_not_confirmed_risk', true, 'diversification_is_not_guaranteed_resilience', true,
    'no_auto_strategy', true, 'no_auto_portfolio_selection', true, 'no_auto_budget_allocation', true,
    'no_auto_resource_allocation', true, 'no_auto_initiative_execution', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_strategy_audit(p_limit int default 100)
returns setof public.ai_enterprise_strategy_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_strategy_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_strategic_goals enable row level security;
alter table public.ai_enterprise_strategic_initiatives enable row level security;
alter table public.ai_enterprise_strategy_portfolios enable row level security;
alter table public.ai_enterprise_strategy_events enable row level security;

comment on table public.ai_enterprise_strategic_goals is 'AI-OPS-41 — Strategic Goal(≠ Guaranteed Outcome·도메인 32종·금지 16종 차단·계층 depth ≤ 6·achieved 는 Evidence 필수·최대 200).';
comment on table public.ai_enterprise_strategic_initiatives is 'AI-OPS-41 — Strategic Initiative(≠ 실행·Type 18종·금지 8종 차단·completed 는 Evidence+외부 실행 Reference 필수·최대 200·dependency ≤ 500).';
comment on table public.ai_enterprise_strategy_portfolios is 'AI-OPS-41 — Strategy Portfolio(≠ 예산·자원 배분·버전 관리·Scenario ≤ 20·Initiative ≤ 100·Approval Reference 의 budget/resources/production 전부 false).';
comment on table public.ai_enterprise_strategy_events is 'AI-OPS-41 — Strategy 이벤트 43종(자동 Strategy/Portfolio 선택/배분/실행 없음).';
