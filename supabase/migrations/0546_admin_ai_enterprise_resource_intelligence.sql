-- 0546_admin_ai_enterprise_resource_intelligence.sql
-- AI-OPS-42 — Enterprise Resource Intelligence, Capital Allocation &
-- Capacity Planning Center.
--
-- Enterprise Resource Inventory → Resource Availability Reference → Human/Technical/
-- Operational Capacity → Financial Envelope → Strategic Initiative Demand →
-- Resource Demand Forecast → Resource Conflict → Capacity Gap → Funding Gap →
-- Allocation Option → Opportunity Cost → Allocation Trade-off →
-- Capital Allocation Recommendation Candidate → Human Resource/Finance Review →
-- Allocation Approval Reference → Commitment/Budget/Capacity Reference →
-- Observed Resource Outcome → Allocation Quality/Drift → Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Resource Inventory ≠ Verified Physical Inventory/회계 장부.
--  * Availability Candidate ≠ Guaranteed Availability. Demand ≠ Reserved Resource.
--  * Reservation Candidate ≠ Actual Reservation(외부 Reservation Reference 없으면
--    reserved_reference 기록 차단). Allocation Option ≠ Allocated Resource.
--  * Allocation Approval Reference ≠ Budget Execution(budget_allocated/
--    resources_allocated/capacity_provisioned/production_applied 항상 false).
--  * Budget Reference ≠ Available Cash. Cash Flow Reference ≠ Bank Balance.
--  * Capacity/Compute/Storage Candidate ≠ Provisioned. Gap Candidate ≠ Confirmed 부족.
--  * Opportunity Cost ≠ 확정 손실. Capital Efficiency ≠ 회계 ROI.
--  * Low Utilization ≠ 낭비. High Utilization ≠ Healthy.
--  * 자동 Budget/Resource/Capital Allocation·비용 집행·Payment·Refund·Settlement·
--    Contract·Provider 구매·Compute/Storage Provisioning·인력 배치·채용·해고·
--    Production 변경 — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0508/0524/0529/0536/0545 원본 무변경(참조만).
--  * Financial Envelope/Human·Technical Capacity/Reservation/Gap/Outcome/Quality/
--    Drift/Learning 은 신규 테이블 대신 JSONB + Events 통합(후보 다수 → 4 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Resource Inventory(자산 원장/회계 장부 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resource_inventory (
  id                        uuid primary key default gen_random_uuid(),
  resource_code             text not null,
  resource_name             text not null,
  resource_domain           text not null check (resource_domain in ('human_capacity','reviewer_capacity','specialist_capacity','operational_capacity','technical_capacity','engineering_capacity','ai_agent_capacity_reference','connector_capacity','provider_capacity','compute_capacity','storage_capacity','network_capacity','database_capacity','api_capacity','queue_capacity','workflow_capacity','incident_response_capacity','customer_support_capacity','store_operations_capacity','content_operations_capacity','music_quality_capacity','playlist_operations_capacity','financial_envelope_reference','budget_envelope_reference','cost_envelope_reference','cash_flow_reference','contract_capacity_reference','strategic_reserve_reference','contingency_capacity_reference','custom_reference')),
  resource_type             text not null check (resource_type in ('person_hour_reference','reviewer_hour_reference','specialist_hour_reference','operational_slot_reference','technical_slot_reference','compute_unit_reference','storage_unit_reference','network_unit_reference','api_quota_reference','connector_slot_reference','provider_quota_reference','database_capacity_reference','queue_capacity_reference','workflow_capacity_reference','budget_amount_reference','cost_limit_reference','cash_flow_reference','contingency_reserve_reference','strategic_reserve_reference','contract_capacity_reference','custom_reference')),
  resource_status           text not null default 'draft' check (resource_status in ('draft','pending_evidence','pending_review','available_candidate','partially_available_candidate','committed_reference','reserved_reference','constrained_candidate','bottleneck_candidate','exhausted_candidate','unavailable_reference','stale_candidate','superseded','invalidated','insufficient_data')),
  resource_scope_type       text not null default 'enterprise' check (resource_scope_type in ('global','enterprise','brand','store','connector','automation','agent')),
  resource_scope_id         text,
  resource_owner_role_reference text,
  source_reference_type     text,
  source_reference_id       text,
  unit_type                 text,
  currency_reference        text,
  total_capacity_candidate  numeric check (total_capacity_candidate is null or total_capacity_candidate >= 0),
  available_capacity_candidate numeric check (available_capacity_candidate is null or available_capacity_candidate >= 0),
  committed_capacity_reference numeric check (committed_capacity_reference is null or committed_capacity_reference >= 0),
  reserved_capacity_reference numeric check (reserved_capacity_reference is null or reserved_capacity_reference >= 0),
  utilized_capacity_candidate numeric check (utilized_capacity_candidate is null or utilized_capacity_candidate >= 0),
  unavailable_capacity_reference numeric check (unavailable_capacity_reference is null or unavailable_capacity_reference >= 0),
  capacity_headroom_candidate numeric,
  utilization_candidate     int check (utilization_candidate is null or (utilization_candidate >= 0 and utilization_candidate <= 100)),
  freshness_status          text not null default 'freshness_unverified' check (freshness_status in ('current_reference','recently_observed_reference','stale_resource_candidate','severely_stale_candidate','freshness_unverified','insufficient_data')),
  reliability_candidate     text not null default 'reliability_unverified' check (reliability_candidate in ('high_reliability_candidate','moderate_reliability_candidate','low_reliability_candidate','conflicting_source_candidate','reliability_unverified','insufficient_data')),
  data_completeness         int check (data_completeness is null or (data_completeness >= 0 and data_completeness <= 100)),
  observation_start         timestamptz,
  observation_end           timestamptz,
  forecast_horizon_reference text,
  provider_reference        text,
  connector_reference       text,
  contract_reference        text,
  cost_reference            jsonb,
  budget_reference          jsonb,
  reservation_reference     jsonb,
  availability_result       jsonb,
  human_capacity_result     jsonb,
  technical_capacity_result jsonb,
  commitment_references     jsonb not null default '[]'::jsonb,
  initiative_references     jsonb not null default '[]'::jsonb,
  portfolio_references      jsonb not null default '[]'::jsonb,
  restrictions              jsonb not null default '[]'::jsonb,
  policy_constraints        jsonb not null default '[]'::jsonb,
  security_constraints      jsonb not null default '[]'::jsonb,
  privacy_constraints       jsonb not null default '[]'::jsonb,
  compliance_constraints    jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aeri_idem on public.ai_enterprise_resource_inventory (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeri_status on public.ai_enterprise_resource_inventory (resource_status, resource_domain, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Initiative Resource Demand(예약/구매 요청 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resource_demands (
  id                        uuid primary key default gen_random_uuid(),
  demand_code               text not null,
  demand_name               text not null,
  strategic_initiative_id   uuid,
  strategy_portfolio_id     uuid,
  decision_context_reference text,
  resource_domain           text not null,
  resource_type             text not null,
  demand_status             text not null default 'draft' check (demand_status in ('draft','pending_evidence','pending_review','demand_ready_reference','partially_defined_candidate','resource_gap_candidate','funding_gap_candidate','capacity_gap_candidate','blocked_candidate','deferred_reference','superseded','invalidated','insufficient_data')),
  required_quantity_candidate numeric check (required_quantity_candidate is null or required_quantity_candidate >= 0),
  minimum_quantity_candidate numeric check (minimum_quantity_candidate is null or minimum_quantity_candidate >= 0),
  preferred_quantity_candidate numeric check (preferred_quantity_candidate is null or preferred_quantity_candidate >= 0),
  peak_quantity_candidate   numeric check (peak_quantity_candidate is null or peak_quantity_candidate >= 0),
  unit_type                 text,
  currency_reference        text,
  required_start_reference  timestamptz,
  required_end_reference    timestamptz,
  demand_horizon            text,
  demand_priority_candidate text not null default 'priority_unverified' check (demand_priority_candidate in ('informational_candidate','low_candidate','normal_candidate','high_candidate','critical_candidate','priority_unverified','insufficient_data')),
  demand_urgency_candidate  text not null default 'urgency_unverified' check (demand_urgency_candidate in ('no_deadline_candidate','routine_candidate','time_sensitive_candidate','urgent_candidate','immediate_review_candidate','urgency_unverified','insufficient_data')),
  demand_profile            jsonb,
  phase_demand              jsonb not null default '[]'::jsonb,
  recurring_demand          jsonb,
  one_time_demand           jsonb,
  dependency_references     jsonb not null default '[]'::jsonb,
  shared_resource_references jsonb not null default '[]'::jsonb,
  substitute_resource_candidates jsonb not null default '[]'::jsonb,
  resource_flexibility_candidate text,
  delay_tolerance_candidate text,
  scaling_behavior_candidate text,
  demand_forecast           jsonb,
  conflict_result           jsonb,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
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
create unique index if not exists uq_aerd_idem on public.ai_enterprise_resource_demands (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aerd_status on public.ai_enterprise_resource_demands (demand_status, resource_domain, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Resource Allocation Option(실제 Budget/Resource Allocation 아님).
--    Financial Envelope/Gap/Opportunity Cost/Efficiency/Review/Approval/
--    Outcome/Quality/Drift JSONB 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resource_allocation_options (
  id                        uuid primary key default gen_random_uuid(),
  allocation_code           text not null,
  allocation_name           text not null,
  strategy_portfolio_id     uuid,
  strategic_initiative_references jsonb not null default '[]'::jsonb,
  resource_demand_references jsonb not null default '[]'::jsonb,
  option_type               text not null check (option_type in ('no_allocation_reference','defer_allocation_reference','partial_allocation_reference','conditional_allocation_reference','phased_allocation_reference','reversible_allocation_reference','shared_allocation_reference','reserve_capacity_reference','contingency_allocation_reference','substitute_resource_reference','rebalance_candidate','budget_constrained_reference','capacity_constrained_reference','workload_constrained_reference','custom_reference')),
  option_status             text not null default 'draft' check (option_status in ('draft','pending_evidence','pending_review','viable_candidate','conditionally_viable_candidate','capacity_constrained_candidate','funding_constrained_candidate','workload_constrained_candidate','blocked_candidate','infeasible_candidate','rejected_reference','deferred_reference','superseded','invalidated','insufficient_data')),
  allocation_summary        text,
  allocation_horizon_start  timestamptz,
  allocation_horizon_end    timestamptz,
  resource_allocations      jsonb not null default '[]'::jsonb,
  excluded_demands          jsonb not null default '[]'::jsonb,
  exclusion_reasons         jsonb not null default '[]'::jsonb,
  deferred_demands          jsonb not null default '[]'::jsonb,
  partial_allocations       jsonb not null default '[]'::jsonb,
  substitute_resources      jsonb not null default '[]'::jsonb,
  shared_resource_plan      jsonb,
  reserve_capacity_plan     jsonb,
  contingency_plan          jsonb,
  capacity_plan_candidate   jsonb,
  financial_envelope_reference jsonb,
  budget_candidate          jsonb,
  capacity_candidate        jsonb,
  human_capacity_candidate  jsonb,
  technical_capacity_candidate jsonb,
  operational_capacity_candidate jsonb,
  opportunity_cost_candidate jsonb,
  capital_efficiency_candidate jsonb,
  utilization_candidate     jsonb,
  headroom_candidate        jsonb,
  concentration_result      jsonb,
  diversification_result    jsonb,
  conflict_result           jsonb,
  capacity_gap_result       jsonb,
  funding_gap_result        jsonb,
  tradeoff_result           jsonb,
  robustness_result         jsonb,
  regret_result             jsonb,
  reversibility_result      jsonb,
  feasibility_result        jsonb,
  success_conditions        jsonb not null default '[]'::jsonb,
  failure_conditions        jsonb not null default '[]'::jsonb,
  stop_conditions           jsonb not null default '[]'::jsonb,
  observation_plan_reference jsonb,
  review_trigger_reference  jsonb,
  recommendation_candidate  jsonb,
  allocation_reviews        jsonb not null default '[]'::jsonb,
  approval_reference        jsonb,
  outcome_reference         jsonb,
  allocation_quality_result jsonb,
  resource_drift_result     jsonb,
  allocation_drift_result   jsonb,
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
create unique index if not exists uq_aerao_idem on public.ai_enterprise_resource_allocation_options (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aerao_status on public.ai_enterprise_resource_allocation_options (option_status, option_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Resource 이벤트(41종) — Availability/Freshness/Reliability/Capacity/
--    Envelope/Forecast/Conflict/Gap/Opportunity Cost/Efficiency/Trade-off/
--    Review/Approval/Outcome/Quality/Drift/Learning 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resource_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('resource_inventory_created','resource_inventory_reviewed','resource_availability_reviewed','resource_freshness_reviewed','resource_reliability_reviewed','human_capacity_reviewed','technical_capacity_reviewed','operational_capacity_reviewed','financial_envelope_recorded','cash_flow_reference_recorded','resource_demand_created','resource_demand_reviewed','demand_forecast_reviewed','resource_reservation_candidate_recorded','resource_conflict_reviewed','overcommitment_reviewed','underutilization_reviewed','capacity_gap_reviewed','funding_gap_reviewed','workforce_gap_reviewed','allocation_option_created','allocation_option_reviewed','opportunity_cost_reviewed','capital_efficiency_reviewed','resource_utilization_reviewed','allocation_tradeoff_reviewed','allocation_robustness_reviewed','allocation_regret_reviewed','allocation_reversibility_reviewed','allocation_feasibility_reviewed','capacity_plan_recorded','allocation_recommendation_recorded','human_allocation_review_started','allocation_approval_reference_recorded','allocation_rejection_reference_recorded','allocation_defer_reference_recorded','allocation_revision_requested','budget_reference_linked','commitment_reference_linked','decision_reference_linked','portfolio_reference_linked','resource_outcome_linked','allocation_quality_reviewed','resource_drift_reviewed','allocation_drift_reviewed','resource_learning_reference_recorded','allocation_invalidated')),
  resource_id               uuid,
  resource_demand_id        uuid,
  allocation_option_id      uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aere_evt on public.ai_enterprise_resource_events (event_type, created_at desc);
create index if not exists idx_aere_opt on public.ai_enterprise_resource_events (allocation_option_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Resource Inventory 생성/검토 — reserved 는 외부 Reservation Reference 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resource_inventory_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_resource_inventory;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'resource_domain','');
  -- 초기 Phase 비활성 도메인(자동 집행/민감 결정 계열) — 구조적 차단.
  if v_domain in ('automatic_budget_allocation','automatic_resource_allocation','automatic_employee_assignment','automatic_hiring','automatic_termination','automatic_compensation','automatic_payment_execution','automatic_refund_execution','automatic_contract_execution','automatic_provider_purchase','automatic_compute_provisioning','automatic_storage_provisioning','automatic_capacity_scaling','automatic_infrastructure_purchase','automatic_production_change','automatic_policy_application','personal_performance_scoring','credit_decision','medical_resource_decision') then
    raise exception '금지된 resource domain(초기 Phase 비활성)';
  end if;
  if v_domain not in ('human_capacity','reviewer_capacity','specialist_capacity','operational_capacity','technical_capacity','engineering_capacity','ai_agent_capacity_reference','connector_capacity','provider_capacity','compute_capacity','storage_capacity','network_capacity','database_capacity','api_capacity','queue_capacity','workflow_capacity','incident_response_capacity','customer_support_capacity','store_operations_capacity','content_operations_capacity','music_quality_capacity','playlist_operations_capacity','financial_envelope_reference','budget_envelope_reference','cost_envelope_reference','cash_flow_reference','contract_capacity_reference','strategic_reserve_reference','contingency_capacity_reference','custom_reference') then
    raise exception '허용되지 않는 resource_domain';
  end if;
  v_type := coalesce(nullif(p_payload->>'resource_type',''), 'custom_reference');
  if coalesce(btrim(p_payload->>'resource_name'),'') = '' then raise exception 'resource_name 필수'; end if;
  if nullif(p_payload->>'observation_start','') is not null and nullif(p_payload->>'observation_end','') is not null
     and (p_payload->>'observation_end')::timestamptz <= (p_payload->>'observation_start')::timestamptz then
    raise exception 'observation 범위 오류(Date Abuse 차단)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_resource_inventory where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'inventory_is_not_ledger', true); end if;
  end if;
  insert into public.ai_enterprise_resource_inventory (resource_code, resource_name, resource_domain, resource_type, resource_scope_type, resource_scope_id, resource_owner_role_reference, source_reference_type, source_reference_id, unit_type, currency_reference, total_capacity_candidate, available_capacity_candidate, committed_capacity_reference, reserved_capacity_reference, utilized_capacity_candidate, unavailable_capacity_reference, capacity_headroom_candidate, utilization_candidate, data_completeness, observation_start, observation_end, forecast_horizon_reference, provider_reference, connector_reference, contract_reference, cost_reference, budget_reference, commitment_references, initiative_references, portfolio_references, restrictions, policy_constraints, security_constraints, privacy_constraints, compliance_constraints, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'resource_code',''), 'ERI-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'resource_name', 200), v_domain, v_type,
    coalesce(nullif(p_payload->>'resource_scope_type',''), 'enterprise'), nullif(p_payload->>'resource_scope_id',''),
    nullif(left(coalesce(p_payload->>'resource_owner_role_reference',''), 80),''),
    nullif(left(coalesce(p_payload->>'source_reference_type',''), 80),''), nullif(p_payload->>'source_reference_id',''),
    nullif(left(coalesce(p_payload->>'unit_type',''), 40),''), nullif(left(coalesce(p_payload->>'currency_reference',''), 10),''),
    nullif(p_payload->>'total_capacity_candidate','')::numeric, nullif(p_payload->>'available_capacity_candidate','')::numeric,
    nullif(p_payload->>'committed_capacity_reference','')::numeric, nullif(p_payload->>'reserved_capacity_reference','')::numeric,
    nullif(p_payload->>'utilized_capacity_candidate','')::numeric, nullif(p_payload->>'unavailable_capacity_reference','')::numeric,
    nullif(p_payload->>'capacity_headroom_candidate','')::numeric,
    case when nullif(p_payload->>'utilization_candidate','') is null then null else least(100, greatest(0, (p_payload->>'utilization_candidate')::int)) end,
    case when nullif(p_payload->>'data_completeness','') is null then null else least(100, greatest(0, (p_payload->>'data_completeness')::int)) end,
    nullif(p_payload->>'observation_start','')::timestamptz, nullif(p_payload->>'observation_end','')::timestamptz,
    nullif(left(coalesce(p_payload->>'forecast_horizon_reference',''), 60),''),
    nullif(p_payload->>'provider_reference',''), nullif(p_payload->>'connector_reference',''), nullif(p_payload->>'contract_reference',''),
    p_payload->'cost_reference', p_payload->'budget_reference',
    coalesce(p_payload->'commitment_references', '[]'::jsonb), coalesce(p_payload->'initiative_references', '[]'::jsonb),
    coalesce(p_payload->'portfolio_references', '[]'::jsonb), coalesce(p_payload->'restrictions', '[]'::jsonb),
    coalesce(p_payload->'policy_constraints', '[]'::jsonb), coalesce(p_payload->'security_constraints', '[]'::jsonb),
    coalesce(p_payload->'privacy_constraints', '[]'::jsonb), coalesce(p_payload->'compliance_constraints', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_resource_events (event_type, resource_id, detail, payload, actor_id)
  values ('resource_inventory_created', v_id, left(v_domain, 80) || ' (Inventory ≠ 자산 원장 — draft·자동 배정 없음)', jsonb_build_object('resource_name', p_payload->>'resource_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'inventory_is_not_ledger', true, 'auto_allocated', false, 'budget_allocated', false, 'capacity_provisioned', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_resource_inventory_review(p_resource_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_resource_inventory; v_next text := null; v_evt text := 'resource_inventory_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_available','mark_partially_available','mark_committed_reference','mark_reserved_reference','mark_constrained','mark_bottleneck','mark_exhausted','mark_unavailable','mark_stale','supersede','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_resource_inventory where id = p_resource_id;
  if v_row.id is null then raise exception 'Resource 없음(실존 검증 실패)'; end if;
  if v_row.resource_status in ('superseded','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.resource_status; end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_available' then
    v_next := 'available_candidate'; v_note := ' (available_candidate ≠ 사용 가능 보장)';
  elsif p_action = 'mark_partially_available' then v_next := 'partially_available_candidate';
  elsif p_action = 'mark_committed_reference' then v_next := 'committed_reference';
  elsif p_action = 'mark_reserved_reference' then
    -- 실제 외부 Reservation Reference 없으면 reserved 기록 차단.
    if coalesce(nullif(p_payload->>'external_reservation_reference',''), '') = '' then
      raise exception '외부 Reservation Reference 없는 reserved 기록 금지(Reservation Candidate ≠ Actual Reservation)';
    end if;
    v_next := 'reserved_reference';
    update public.ai_enterprise_resource_inventory set reservation_reference = p_payload where id = p_resource_id;
  elsif p_action = 'mark_constrained' then v_next := 'constrained_candidate';
  elsif p_action = 'mark_bottleneck' then v_next := 'bottleneck_candidate';
  elsif p_action = 'mark_exhausted' then v_next := 'exhausted_candidate';
  elsif p_action = 'mark_unavailable' then v_next := 'unavailable_reference';
  elsif p_action = 'mark_stale' then v_next := 'stale_candidate';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated'; v_evt := 'allocation_invalidated';
  end if;

  update public.ai_enterprise_resource_inventory set resource_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_resource_id;
  insert into public.ai_enterprise_resource_events (event_type, resource_id, detail, payload, actor_id)
  values (v_evt, p_resource_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_resource_id, 'status', v_next, 'auto_allocated', false, 'budget_allocated', false, 'capacity_provisioned', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Resource Demand 생성/검토 — Demand ≠ 예약/구매 요청.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resource_demand_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_domain text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_resource_demands;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_domain := coalesce(p_payload->>'resource_domain','');
  if v_domain in ('automatic_budget_allocation','automatic_resource_allocation','automatic_employee_assignment','automatic_hiring','automatic_termination','automatic_compensation','automatic_payment_execution','automatic_refund_execution','automatic_contract_execution','automatic_provider_purchase','automatic_compute_provisioning','automatic_storage_provisioning','automatic_capacity_scaling','automatic_infrastructure_purchase','automatic_production_change','automatic_policy_application','personal_performance_scoring','credit_decision','medical_resource_decision') then
    raise exception '금지된 resource domain(초기 Phase 비활성)';
  end if;
  if coalesce(btrim(p_payload->>'demand_name'),'') = '' then raise exception 'demand_name 필수'; end if;
  if nullif(p_payload->>'strategic_initiative_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
    raise exception 'Strategic Initiative 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'required_start_reference','') is not null and nullif(p_payload->>'required_end_reference','') is not null
     and (p_payload->>'required_end_reference')::timestamptz <= (p_payload->>'required_start_reference')::timestamptz then
    raise exception 'required 기간 범위 오류(Date Abuse 차단)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_resource_demands where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'demand_is_not_reservation', true); end if;
  end if;
  insert into public.ai_enterprise_resource_demands (demand_code, demand_name, strategic_initiative_id, strategy_portfolio_id, decision_context_reference, resource_domain, resource_type, required_quantity_candidate, minimum_quantity_candidate, preferred_quantity_candidate, peak_quantity_candidate, unit_type, currency_reference, required_start_reference, required_end_reference, demand_horizon, demand_profile, phase_demand, recurring_demand, one_time_demand, dependency_references, shared_resource_references, substitute_resource_candidates, resource_flexibility_candidate, delay_tolerance_candidate, scaling_behavior_candidate, demand_forecast, confidence, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'demand_code',''), 'ERD-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'demand_name', 200),
    nullif(p_payload->>'strategic_initiative_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    nullif(p_payload->>'decision_context_reference',''),
    left(coalesce(nullif(v_domain,''), 'custom_reference'), 60), left(coalesce(nullif(p_payload->>'resource_type',''), 'custom_reference'), 60),
    nullif(p_payload->>'required_quantity_candidate','')::numeric, nullif(p_payload->>'minimum_quantity_candidate','')::numeric,
    nullif(p_payload->>'preferred_quantity_candidate','')::numeric, nullif(p_payload->>'peak_quantity_candidate','')::numeric,
    nullif(left(coalesce(p_payload->>'unit_type',''), 40),''), nullif(left(coalesce(p_payload->>'currency_reference',''), 10),''),
    nullif(p_payload->>'required_start_reference','')::timestamptz, nullif(p_payload->>'required_end_reference','')::timestamptz,
    nullif(left(coalesce(p_payload->>'demand_horizon',''), 60),''),
    p_payload->'demand_profile', coalesce(p_payload->'phase_demand', '[]'::jsonb),
    p_payload->'recurring_demand', p_payload->'one_time_demand',
    coalesce(p_payload->'dependency_references', '[]'::jsonb), coalesce(p_payload->'shared_resource_references', '[]'::jsonb),
    coalesce(p_payload->'substitute_resource_candidates', '[]'::jsonb),
    nullif(left(coalesce(p_payload->>'resource_flexibility_candidate',''), 60),''),
    nullif(left(coalesce(p_payload->>'delay_tolerance_candidate',''), 60),''),
    nullif(left(coalesce(p_payload->>'scaling_behavior_candidate',''), 60),''),
    p_payload->'demand_forecast',
    case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_resource_events (event_type, resource_demand_id, detail, payload, actor_id)
  values ('resource_demand_created', v_id, left(v_domain, 80) || ' (Demand ≠ Reserved Resource — draft)', jsonb_build_object('demand_name', p_payload->>'demand_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'demand_is_not_reservation', true, 'auto_allocated', false, 'budget_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_resource_demand_review(p_demand_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_resource_demands; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_demand_ready','mark_partially_defined','mark_resource_gap','mark_funding_gap','mark_capacity_gap','mark_blocked','defer','supersede','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_resource_demands where id = p_demand_id;
  if v_row.id is null then raise exception 'Resource Demand 없음(실존 검증 실패)'; end if;
  if v_row.demand_status in ('superseded','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.demand_status; end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_demand_ready' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 demand_ready 금지(allocation_basis_unverified)';
    end if;
    v_next := 'demand_ready_reference'; v_note := ' (Demand Ready ≠ 예약/배정)';
  elsif p_action = 'mark_partially_defined' then v_next := 'partially_defined_candidate';
  elsif p_action = 'mark_resource_gap' then v_next := 'resource_gap_candidate';
  elsif p_action = 'mark_funding_gap' then v_next := 'funding_gap_candidate';
  elsif p_action = 'mark_capacity_gap' then v_next := 'capacity_gap_candidate';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate';
  elsif p_action = 'defer' then v_next := 'deferred_reference';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_resource_demands set demand_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_demand_id;
  insert into public.ai_enterprise_resource_events (event_type, resource_demand_id, detail, payload, actor_id)
  values ('resource_demand_reviewed', p_demand_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_demand_id, 'status', v_next, 'demand_is_not_reservation', true, 'auto_allocated', false, 'budget_allocated', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Allocation Option 생성/Human Resource·Finance Review — 금지 Type 차단·
--    Approval Reference 의 배정/집행 flag 전부 false.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_allocation_option_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_resource_allocation_options;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 65536 then raise exception 'allocation payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'option_type','');
  -- 초기 Phase 금지 Allocation Type — 구조적 차단.
  if v_type in ('direct_budget_execution','direct_resource_assignment','automatic_employee_assignment','automatic_payment_execution','automatic_provider_purchase','automatic_compute_provisioning','automatic_infrastructure_purchase') then
    raise exception '금지된 option_type(초기 Phase 차단)';
  end if;
  if v_type not in ('no_allocation_reference','defer_allocation_reference','partial_allocation_reference','conditional_allocation_reference','phased_allocation_reference','reversible_allocation_reference','shared_allocation_reference','reserve_capacity_reference','contingency_allocation_reference','substitute_resource_reference','rebalance_candidate','budget_constrained_reference','capacity_constrained_reference','workload_constrained_reference','custom_reference') then
    raise exception '허용되지 않는 option_type';
  end if;
  if coalesce(btrim(p_payload->>'allocation_name'),'') = '' then raise exception 'allocation_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if jsonb_array_length(coalesce(p_payload->'resource_demand_references', '[]'::jsonb)) > 200 then raise exception 'demand reference 200개 초과'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_resource_allocation_options where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'option_is_not_allocated_resource', true); end if;
  end if;
  insert into public.ai_enterprise_resource_allocation_options (allocation_code, allocation_name, strategy_portfolio_id, strategic_initiative_references, resource_demand_references, option_type, allocation_summary, allocation_horizon_start, allocation_horizon_end, resource_allocations, excluded_demands, exclusion_reasons, deferred_demands, partial_allocations, substitute_resources, shared_resource_plan, reserve_capacity_plan, contingency_plan, capacity_plan_candidate, financial_envelope_reference, budget_candidate, capacity_candidate, human_capacity_candidate, technical_capacity_candidate, operational_capacity_candidate, success_conditions, failure_conditions, stop_conditions, observation_plan_reference, review_trigger_reference, recommendation_candidate, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'allocation_code',''), 'RAO-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'allocation_name', 200),
    nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    coalesce(p_payload->'strategic_initiative_references', '[]'::jsonb), coalesce(p_payload->'resource_demand_references', '[]'::jsonb),
    v_type, nullif(left(coalesce(p_payload->>'allocation_summary',''), 2000),''),
    nullif(p_payload->>'allocation_horizon_start','')::timestamptz, nullif(p_payload->>'allocation_horizon_end','')::timestamptz,
    coalesce(p_payload->'resource_allocations', '[]'::jsonb), coalesce(p_payload->'excluded_demands', '[]'::jsonb),
    coalesce(p_payload->'exclusion_reasons', '[]'::jsonb), coalesce(p_payload->'deferred_demands', '[]'::jsonb),
    coalesce(p_payload->'partial_allocations', '[]'::jsonb), coalesce(p_payload->'substitute_resources', '[]'::jsonb),
    p_payload->'shared_resource_plan', p_payload->'reserve_capacity_plan', p_payload->'contingency_plan',
    p_payload->'capacity_plan_candidate', p_payload->'financial_envelope_reference',
    p_payload->'budget_candidate', p_payload->'capacity_candidate', p_payload->'human_capacity_candidate',
    p_payload->'technical_capacity_candidate', p_payload->'operational_capacity_candidate',
    coalesce(p_payload->'success_conditions', '[]'::jsonb), coalesce(p_payload->'failure_conditions', '[]'::jsonb),
    coalesce(p_payload->'stop_conditions', '[]'::jsonb),
    p_payload->'observation_plan_reference', p_payload->'review_trigger_reference', p_payload->'recommendation_candidate',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_resource_events (event_type, allocation_option_id, detail, payload, actor_id)
  values ('allocation_option_created', v_id, left(v_type, 80) || ' (Option ≠ Allocated Resource — draft·비용 집행 없음)', jsonb_build_object('allocation_name', p_payload->>'allocation_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'option_is_not_allocated_resource', true, 'auto_allocated', false, 'budget_allocated', false, 'resources_allocated', false, 'capacity_provisioned', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_allocation_review(p_option_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_resource_allocation_options; v_next text := null; v_evt text := 'human_allocation_review_started'; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_evidence','start_review','mark_viable','mark_conditionally_viable','mark_capacity_constrained','mark_funding_constrained','mark_workload_constrained','mark_blocked','mark_infeasible','approve_allocation_reference','approve_with_conditions_reference','reject_allocation_reference','defer_allocation_reference','request_revision_reference','supersede','invalidate') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(승인/거절/보류/수정 전부)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_resource_allocation_options where id = p_option_id;
  if v_row.id is null then raise exception 'Allocation Option 없음(실존 검증 실패)'; end if;
  if v_row.option_status in ('superseded','invalidated','rejected_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.option_status;
  end if;
  if p_action in ('approve_allocation_reference','approve_with_conditions_reference') then
    -- Self-Approval 차단 + Evidence 필수(Approval Reference ≠ Budget Execution).
    if v_row.created_by = v_uid then raise exception 'Self-Approval 차단(작성자 ≠ 승인자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Allocation Approval Reference 금지';
    end if;
  end if;

  if p_action = 'request_evidence' then v_next := 'pending_evidence'; v_evt := 'allocation_revision_requested';
  elsif p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_viable' then v_next := 'viable_candidate'; v_evt := 'allocation_option_reviewed'; v_note := ' (Viable ≠ Allocation 완료)';
  elsif p_action = 'mark_conditionally_viable' then v_next := 'conditionally_viable_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action = 'mark_capacity_constrained' then v_next := 'capacity_constrained_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action = 'mark_funding_constrained' then v_next := 'funding_constrained_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action = 'mark_workload_constrained' then v_next := 'workload_constrained_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action = 'mark_infeasible' then v_next := 'infeasible_candidate'; v_evt := 'allocation_option_reviewed';
  elsif p_action in ('approve_allocation_reference','approve_with_conditions_reference') then
    v_next := 'viable_candidate'; v_evt := 'allocation_approval_reference_recorded';
    v_note := ' (Approval Reference ≠ Budget Execution/Resource 배정 — 전부 false)';
  elsif p_action = 'reject_allocation_reference' then v_next := 'rejected_reference'; v_evt := 'allocation_rejection_reference_recorded';
  elsif p_action = 'defer_allocation_reference' then v_next := 'deferred_reference'; v_evt := 'allocation_defer_reference_recorded';
  elsif p_action = 'request_revision_reference' then v_next := 'pending_evidence'; v_evt := 'allocation_revision_requested';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'invalidated'; v_evt := 'allocation_invalidated';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'conditions', coalesce(p_payload->'conditions', '[]'::jsonb),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'approved_demand_references', coalesce(p_payload->'approved_demand_references', '[]'::jsonb),
    'excluded_demand_references', coalesce(p_payload->'excluded_demand_references', '[]'::jsonb),
    'budget_references', coalesce(p_payload->'budget_references', '[]'::jsonb),
    'commitment_references', coalesce(p_payload->'commitment_references', '[]'::jsonb),
    'observation_plan_reference', p_payload->'observation_plan_reference',
    'review_trigger_reference', p_payload->'review_trigger_reference',
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_allocation_decision_confirmed', true,
    'budget_allocated', false, 'resources_allocated', false, 'capacity_provisioned', false, 'production_applied', false);
  update public.ai_enterprise_resource_allocation_options set
    option_status = v_next, reviewed_by = v_uid, updated_at = now(),
    allocation_reviews = allocation_reviews || jsonb_build_array(v_review),
    approval_reference = case when p_action in ('approve_allocation_reference','approve_with_conditions_reference') then v_review else approval_reference end
  where id = p_option_id;
  insert into public.ai_enterprise_resource_events (event_type, allocation_option_id, detail, payload, actor_id)
  values (v_evt, p_option_id, left(p_reason, 200) || v_note, v_review || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_option_id, 'status', v_next, 'review_action', p_action, 'human_allocation_decision_confirmed', true, 'approval_is_not_execution', true, 'auto_allocated', false, 'budget_allocated', false, 'resources_allocated', false, 'capacity_provisioned', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Resource 이벤트 기록(통합) — Availability/Freshness/Reliability/
--    Capacity/Envelope/Forecast/Conflict/Gap/Opportunity Cost/Efficiency/
--    Utilization/Trade-off/Robustness/Regret/Reversibility/Feasibility/
--    Capacity Plan/Recommendation/Reference Link/Outcome/Quality/Drift/Learning.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resource_event_record(p_kind text, p_reason text, p_payload jsonb, p_resource_id uuid default null, p_demand_id uuid default null, p_option_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('resource_availability_reviewed','resource_freshness_reviewed','resource_reliability_reviewed','human_capacity_reviewed','technical_capacity_reviewed','operational_capacity_reviewed','financial_envelope_recorded','cash_flow_reference_recorded','demand_forecast_reviewed','resource_reservation_candidate_recorded','resource_conflict_reviewed','overcommitment_reviewed','underutilization_reviewed','capacity_gap_reviewed','funding_gap_reviewed','workforce_gap_reviewed','opportunity_cost_reviewed','capital_efficiency_reviewed','resource_utilization_reviewed','allocation_tradeoff_reviewed','allocation_robustness_reviewed','allocation_regret_reviewed','allocation_reversibility_reviewed','allocation_feasibility_reviewed','capacity_plan_recorded','allocation_recommendation_recorded','budget_reference_linked','commitment_reference_linked','decision_reference_linked','portfolio_reference_linked','resource_outcome_linked','allocation_quality_reviewed','resource_drift_reviewed','allocation_drift_reviewed','resource_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_resource_id is not null and not exists (select 1 from public.ai_enterprise_resource_inventory where id = p_resource_id) then raise exception 'Resource 없음(실존 검증 실패)'; end if;
  if p_demand_id is not null and not exists (select 1 from public.ai_enterprise_resource_demands where id = p_demand_id) then raise exception 'Demand 없음(실존 검증 실패)'; end if;
  if p_option_id is not null and not exists (select 1 from public.ai_enterprise_resource_allocation_options where id = p_option_id) then raise exception 'Allocation Option 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'resource_availability_reviewed' then
    if v_result not in ('availability_ready_reference','high_availability_candidate','moderate_availability_candidate','low_availability_candidate','constrained_availability_candidate','unavailable_candidate','availability_unverified','insufficient_data') then raise exception '허용되지 않는 availability result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_resource_inventory set availability_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'resource_freshness_reviewed' then
    if v_result not in ('current_reference','recently_observed_reference','stale_resource_candidate','severely_stale_candidate','freshness_unverified','insufficient_data') then raise exception '허용되지 않는 freshness result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_resource_inventory set freshness_status = v_result, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'resource_reliability_reviewed' then
    if v_result not in ('high_reliability_candidate','moderate_reliability_candidate','low_reliability_candidate','conflicting_source_candidate','reliability_unverified','insufficient_data') then raise exception '허용되지 않는 reliability result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_resource_inventory set reliability_candidate = v_result, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind in ('human_capacity_reviewed','operational_capacity_reviewed') then
    if v_result not in ('capacity_available_candidate','capacity_tight_candidate','workload_pressure_candidate','workload_overload_candidate','reviewer_bottleneck_candidate','specialist_bottleneck_candidate','capacity_unverified','insufficient_data') then raise exception '허용되지 않는 human capacity result'; end if;
    if p_kind = 'human_capacity_reviewed' and p_resource_id is not null then update public.ai_enterprise_resource_inventory set human_capacity_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'technical_capacity_reviewed' then
    if v_result not in ('capacity_available_candidate','capacity_tight_candidate','capacity_bottleneck_candidate','capacity_exhaustion_candidate','single_point_dependency_candidate','capacity_unverified','insufficient_data') then raise exception '허용되지 않는 technical capacity result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_resource_inventory set technical_capacity_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'financial_envelope_recorded' and coalesce(p_payload->>'envelope_type','') not in ('operating_budget_reference','strategic_budget_reference','initiative_budget_reference','contingency_budget_reference','infrastructure_budget_reference','provider_budget_reference','connector_budget_reference','staffing_budget_reference','marketing_budget_reference','content_budget_reference','reserve_reference','cash_flow_reference','cost_limit_reference','custom_reference') then
    raise exception '허용되지 않는 envelope_type';
  end if;
  if p_kind = 'demand_forecast_reviewed' then
    if v_result not in ('demand_forecast_ready_reference','demand_forecast_partial','peak_demand_candidate','accelerating_demand_candidate','volatile_demand_candidate','forecast_unverified','insufficient_data') then raise exception '허용되지 않는 demand forecast result'; end if;
    if p_demand_id is not null then update public.ai_enterprise_resource_demands set demand_forecast = p_payload, updated_at = now() where id = p_demand_id; end if;
  end if;
  if p_kind = 'resource_conflict_reviewed' then
    if v_result not in ('no_material_conflict_candidate','minor_conflict_candidate','moderate_conflict_candidate','major_conflict_candidate','structural_conflict_candidate','double_allocation_candidate','conflict_unverified','insufficient_data') then raise exception '허용되지 않는 conflict result'; end if;
    if p_demand_id is not null then update public.ai_enterprise_resource_demands set conflict_result = p_payload, updated_at = now() where id = p_demand_id; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set conflict_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'overcommitment_reviewed' and v_result not in ('no_overcommitment_candidate','near_overcommitment_candidate','overcommitment_candidate','severe_overcommitment_candidate','overcommitment_unverified','insufficient_data') then
    raise exception '허용되지 않는 overcommitment result';
  end if;
  if p_kind = 'underutilization_reviewed' and v_result not in ('healthy_headroom_candidate','moderate_underutilization_candidate','high_underutilization_candidate','strategic_reserve_candidate','underutilization_unverified','insufficient_data') then
    raise exception '허용되지 않는 underutilization result';
  end if;
  if p_kind = 'capacity_gap_reviewed' then
    if v_result not in ('no_capacity_gap_candidate','minor_capacity_gap_candidate','moderate_capacity_gap_candidate','severe_capacity_gap_candidate','critical_capacity_gap_candidate','capacity_gap_unverified','insufficient_data') then raise exception '허용되지 않는 capacity gap result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set capacity_gap_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'funding_gap_reviewed' then
    if v_result not in ('no_funding_gap_candidate','minor_funding_gap_candidate','moderate_funding_gap_candidate','severe_funding_gap_candidate','critical_funding_gap_candidate','funding_gap_unverified','insufficient_data') then raise exception '허용되지 않는 funding gap result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set funding_gap_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'workforce_gap_reviewed' and v_result not in ('no_workforce_gap_candidate','minor_workforce_gap_candidate','moderate_workforce_gap_candidate','severe_workforce_gap_candidate','specialist_gap_candidate','reviewer_gap_candidate','workforce_gap_unverified','insufficient_data') then
    raise exception '허용되지 않는 workforce gap result';
  end if;
  if p_kind = 'opportunity_cost_reviewed' then
    if v_result not in ('low_opportunity_cost_candidate','moderate_opportunity_cost_candidate','high_opportunity_cost_candidate','asymmetric_opportunity_cost_candidate','opportunity_cost_unverified','insufficient_data') then raise exception '허용되지 않는 opportunity cost result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set opportunity_cost_candidate = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'capital_efficiency_reviewed' then
    if v_result not in ('high_efficiency_candidate','moderate_efficiency_candidate','low_efficiency_candidate','mixed_efficiency_candidate','efficiency_unverified','insufficient_data') then raise exception '허용되지 않는 efficiency result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set capital_efficiency_candidate = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'resource_utilization_reviewed' and v_result not in ('healthy_utilization_candidate','high_utilization_candidate','overload_utilization_candidate','low_utilization_candidate','utilization_unverified','insufficient_data') then
    raise exception '허용되지 않는 utilization result';
  end if;
  if p_kind = 'allocation_tradeoff_reviewed' then
    if coalesce(p_payload->>'axis','') not in ('short_term_cost_vs_long_term_capability','revenue_vs_capability','budget_vs_capacity','concentration_vs_diversification','utilization_vs_headroom','fixed_vs_variable_cost','speed_vs_safety','growth_vs_stability','reserve_vs_deployment','automation_vs_human_control') then
      raise exception '허용되지 않는 tradeoff axis';
    end if;
    if v_result not in ('favorable_tradeoff_candidate','balanced_tradeoff_candidate','unfavorable_tradeoff_candidate','mixed_tradeoff_candidate','tradeoff_unverified','insufficient_data') then raise exception '허용되지 않는 tradeoff result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set tradeoff_result = coalesce(tradeoff_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'axis', p_payload), updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'allocation_robustness_reviewed' then
    if v_result not in ('robust_allocation_candidate','conditionally_robust_candidate','fragile_allocation_candidate','scenario_specific_candidate','robustness_unverified','insufficient_data') then raise exception '허용되지 않는 robustness result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set robustness_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'allocation_regret_reviewed' then
    if v_result not in ('lowest_regret_allocation_candidate','low_regret_candidate','moderate_regret_candidate','high_regret_candidate','asymmetric_regret_candidate','regret_unverified','insufficient_data') then raise exception '허용되지 않는 regret result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set regret_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'allocation_reversibility_reviewed' then
    if v_result not in ('highly_reversible_candidate','reversible_with_condition_candidate','partially_reversible_candidate','difficult_to_reverse_candidate','irreversible_candidate','reversibility_unverified','insufficient_data') then raise exception '허용되지 않는 reversibility result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set reversibility_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'allocation_feasibility_reviewed' then
    if v_result not in ('feasible_allocation_candidate','conditionally_feasible_candidate','feasibility_blocked_candidate','feasibility_unverified','insufficient_data') then raise exception '허용되지 않는 feasibility result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set feasibility_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'capacity_plan_recorded' and p_option_id is not null then
    update public.ai_enterprise_resource_allocation_options set capacity_plan_candidate = p_payload, updated_at = now() where id = p_option_id;
  end if;
  if p_kind = 'allocation_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_resource_inventory','review_resource_freshness','review_resource_reliability','review_availability','create_resource_demand','review_demand_forecast','review_resource_conflict','review_overcommitment','review_underutilization','review_capacity_gap','review_funding_gap','review_workforce_gap','create_allocation_option','create_partial_allocation_candidate','create_phased_allocation_candidate','create_reversible_allocation_candidate','create_reserve_capacity_candidate','defer_allocation_candidate','rebalance_allocation_candidate','review_opportunity_cost','review_capital_efficiency','gather_more_evidence_candidate','request_specialist_review_candidate','request_finance_review','request_resource_review','request_executive_review','record_allocation_approval_reference','link_budget_reference','link_commitment_reference','link_resource_outcome','review_allocation_quality','review_resource_drift','record_resource_learning_reference','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Allocation Recommendation 금지';
    end if;
  end if;
  if p_kind = 'commitment_reference_linked' then
    if nullif(p_payload->>'commitment_id','') is not null
       and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
      raise exception 'Commitment 없음(실존 검증 실패)';
    end if;
    if p_resource_id is not null then
      update public.ai_enterprise_resource_inventory set commitment_references = commitment_references || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id;
    end if;
  end if;
  if p_kind = 'decision_reference_linked' and nullif(p_payload->>'decision_context_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_contexts where id = (p_payload->>'decision_context_id')::uuid) then
    raise exception 'Decision Context 없음(실존 검증 실패)';
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'resource_outcome_linked' and p_option_id is not null then
    update public.ai_enterprise_resource_allocation_options set outcome_reference = p_payload, updated_at = now() where id = p_option_id;
  end if;
  if p_kind = 'allocation_quality_reviewed' then
    if v_result not in ('high_quality_candidate','moderate_quality_candidate','low_quality_candidate','mixed_quality_candidate','outcome_unverified','causality_unverified','sample_too_small','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set allocation_quality_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'resource_drift_reviewed' then
    if v_result not in ('no_material_drift_candidate','minor_drift_candidate','moderate_drift_candidate','severe_drift_candidate','structural_drift_candidate','drift_unverified','insufficient_data') then raise exception '허용되지 않는 resource drift result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set resource_drift_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;
  if p_kind = 'allocation_drift_reviewed' then
    if v_result not in ('no_material_allocation_drift_candidate','minor_allocation_drift_candidate','moderate_allocation_drift_candidate','severe_allocation_drift_candidate','structural_allocation_drift_candidate','allocation_drift_unverified','insufficient_data') then raise exception '허용되지 않는 allocation drift result'; end if;
    if p_option_id is not null then update public.ai_enterprise_resource_allocation_options set allocation_drift_result = p_payload, updated_at = now() where id = p_option_id; end if;
  end if;

  insert into public.ai_enterprise_resource_events (event_type, resource_id, resource_demand_id, allocation_option_id, detail, payload, actor_id)
  values (p_kind, p_resource_id, p_demand_id, p_option_id,
    left(p_reason, 200) || case
      when p_kind = 'resource_availability_reviewed' then ' (Availability Candidate ≠ Guaranteed Availability)'
      when p_kind = 'resource_freshness_reviewed' then ' (오래된 데이터는 stale_resource_candidate 유지)'
      when p_kind = 'resource_reliability_reviewed' then ' (Source 없으면 resource_source_unverified)'
      when p_kind = 'human_capacity_reviewed' then ' (개인 생산성·성과·보상 판단에 사용하지 않음)'
      when p_kind = 'technical_capacity_reviewed' then ' (Compute/Storage Candidate ≠ Provisioned)'
      when p_kind = 'financial_envelope_recorded' then ' (Envelope ≠ 회계 장부/은행 잔액)'
      when p_kind = 'cash_flow_reference_recorded' then ' (Cash Flow Reference ≠ Bank Balance)'
      when p_kind = 'demand_forecast_reviewed' then ' (Forecast ≠ Future Fact·Historical Usage ≠ Future Usage)'
      when p_kind = 'resource_reservation_candidate_recorded' then ' (Reservation Candidate ≠ Actual Reservation)'
      when p_kind = 'resource_conflict_reviewed' then ' (Conflict Candidate ≠ 자동 Demand 제거 근거)'
      when p_kind = 'overcommitment_reviewed' then ' (Overcommitment Candidate ≠ Confirmed Failure)'
      when p_kind = 'underutilization_reviewed' then ' (Low Utilization ≠ 낭비 — 자동 판정 없음)'
      when p_kind = 'capacity_gap_reviewed' then ' (Gap Candidate ≠ Confirmed Capacity Shortage)'
      when p_kind = 'funding_gap_reviewed' then ' (Funding Gap ≠ 회계상 적자 확정)'
      when p_kind = 'opportunity_cost_reviewed' then ' (Opportunity Cost ≠ 확정 손실)'
      when p_kind = 'capital_efficiency_reviewed' then ' (Capital Efficiency ≠ 회계 ROI)'
      when p_kind = 'resource_utilization_reviewed' then ' (High Utilization ≠ Healthy)'
      when p_kind = 'allocation_tradeoff_reviewed' then ' (자동 점수 Allocation 선택 없음)'
      when p_kind = 'allocation_robustness_reviewed' then ' (Robust ≠ Correct Allocation)'
      when p_kind = 'allocation_regret_reviewed' then ' (Lowest Regret ≠ Best Allocation)'
      when p_kind = 'allocation_reversibility_reviewed' then ' (Reversible ≠ Guaranteed Recovery)'
      when p_kind = 'allocation_feasibility_reviewed' then ' (Feasibility ≠ Resource Reservation)'
      when p_kind = 'capacity_plan_recorded' then ' (Capacity Plan Candidate ≠ Provisioning)'
      when p_kind = 'allocation_recommendation_recorded' then ' (Recommendation Candidate ≠ Approval)'
      when p_kind = 'budget_reference_linked' then ' (Budget Reference ≠ Available Cash)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ Completed Commitment)'
      when p_kind = 'decision_reference_linked' then ' (Decision Reference ≠ Execution)'
      when p_kind = 'resource_outcome_linked' then ' (Outcome Link ≠ Allocation Causality)'
      when p_kind = 'allocation_quality_reviewed' then ' (Quality Candidate ≠ Verified Management Quality)'
      when p_kind = 'resource_drift_reviewed' then ' (Resource Drift ≠ 자동 재배분 신호)'
      when p_kind = 'allocation_drift_reviewed' then ' (Allocation Drift ≠ Confirmed Misallocation)'
      when p_kind = 'resource_learning_reference_recorded' then ' (Learning Reference ≠ 자동 재배분)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_allocated', false, 'budget_allocated', false, 'resources_allocated', false, 'capacity_provisioned', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resource_inventory_list(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_resource_inventory language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resource_inventory
  where (p_status is null or resource_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_resource_demands_list(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_resource_demands language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resource_demands
  where (p_status is null or demand_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_allocation_options_list(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_resource_allocation_options language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resource_allocation_options
  where (p_status is null or option_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_resource_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'inventory', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resource_inventory),
      'pending_review', (select count(*) from public.ai_enterprise_resource_inventory where resource_status in ('pending_evidence','pending_review')),
      'available', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'available_candidate'),
      'committed', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'committed_reference'),
      'reserved', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'reserved_reference'),
      'bottleneck', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'bottleneck_candidate'),
      'exhausted', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'exhausted_candidate'),
      'stale', (select count(*) from public.ai_enterprise_resource_inventory where resource_status = 'stale_candidate' or freshness_status in ('stale_resource_candidate','severely_stale_candidate')),
      'by_domain', (select coalesce(jsonb_object_agg(resource_domain, cnt), '{}'::jsonb) from (select resource_domain, count(*) cnt from public.ai_enterprise_resource_inventory group by resource_domain) t)
    ),
    'demands', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resource_demands),
      'pending_review', (select count(*) from public.ai_enterprise_resource_demands where demand_status in ('pending_evidence','pending_review')),
      'ready', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'demand_ready_reference'),
      'resource_gap', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'resource_gap_candidate'),
      'funding_gap', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'funding_gap_candidate'),
      'capacity_gap', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'capacity_gap_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'blocked_candidate'),
      'deferred', (select count(*) from public.ai_enterprise_resource_demands where demand_status = 'deferred_reference')
    ),
    'allocation_options', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resource_allocation_options),
      'pending_review', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status in ('pending_evidence','pending_review')),
      'viable', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'viable_candidate'),
      'conditionally_viable', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'conditionally_viable_candidate'),
      'capacity_constrained', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'capacity_constrained_candidate'),
      'funding_constrained', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'funding_constrained_candidate'),
      'workload_constrained', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'workload_constrained_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'blocked_candidate'),
      'rejected', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'rejected_reference'),
      'deferred', (select count(*) from public.ai_enterprise_resource_allocation_options where option_status = 'deferred_reference'),
      'approved_references', (select count(*) from public.ai_enterprise_resource_allocation_options where approval_reference is not null)
    ),
    'resource_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resource_events),
      'availability_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_availability_reviewed'),
      'freshness_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_freshness_reviewed'),
      'reliability_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_reliability_reviewed'),
      'human_capacity_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'human_capacity_reviewed'),
      'technical_capacity_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'technical_capacity_reviewed'),
      'operational_capacity_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'operational_capacity_reviewed'),
      'financial_envelopes', (select count(*) from public.ai_enterprise_resource_events where event_type = 'financial_envelope_recorded'),
      'cash_flow_references', (select count(*) from public.ai_enterprise_resource_events where event_type = 'cash_flow_reference_recorded'),
      'demand_forecasts', (select count(*) from public.ai_enterprise_resource_events where event_type = 'demand_forecast_reviewed'),
      'reservation_candidates', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_reservation_candidate_recorded'),
      'conflict_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_conflict_reviewed'),
      'overcommitment_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'overcommitment_reviewed'),
      'underutilization_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'underutilization_reviewed'),
      'capacity_gap_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'capacity_gap_reviewed'),
      'funding_gap_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'funding_gap_reviewed'),
      'workforce_gap_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'workforce_gap_reviewed'),
      'opportunity_cost_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'opportunity_cost_reviewed'),
      'efficiency_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'capital_efficiency_reviewed'),
      'utilization_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_utilization_reviewed'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_tradeoff_reviewed'),
      'robustness_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_robustness_reviewed'),
      'regret_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_regret_reviewed'),
      'reversibility_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_reversibility_reviewed'),
      'feasibility_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_feasibility_reviewed'),
      'capacity_plans', (select count(*) from public.ai_enterprise_resource_events where event_type = 'capacity_plan_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_recommendation_recorded'),
      'allocation_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'human_allocation_review_started'),
      'allocation_approvals', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_approval_reference_recorded'),
      'allocation_rejections', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_rejection_reference_recorded'),
      'allocation_defers', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_defer_reference_recorded'),
      'revision_requests', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_revision_requested'),
      'budget_links', (select count(*) from public.ai_enterprise_resource_events where event_type = 'budget_reference_linked'),
      'commitment_links', (select count(*) from public.ai_enterprise_resource_events where event_type = 'commitment_reference_linked'),
      'decision_links', (select count(*) from public.ai_enterprise_resource_events where event_type = 'decision_reference_linked'),
      'portfolio_links', (select count(*) from public.ai_enterprise_resource_events where event_type = 'portfolio_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_outcome_linked'),
      'quality_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_quality_reviewed'),
      'resource_drift_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_drift_reviewed'),
      'allocation_drift_reviews', (select count(*) from public.ai_enterprise_resource_events where event_type = 'allocation_drift_reviewed'),
      'learning_references', (select count(*) from public.ai_enterprise_resource_events where event_type = 'resource_learning_reference_recorded')
    ),
    -- Resource 원천 실측(전부 읽기 전용):
    'resource_actuals', jsonb_build_object(
      'strategic_initiatives_0545', (select count(*) from public.ai_enterprise_strategic_initiatives),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'decision_contexts_0544', (select count(*) from public.ai_enterprise_decision_contexts),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'capacity_metrics_0508', (select count(*) from public.ai_capacity_metrics),
      'capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots),
      'cost_models_0508', (select count(*) from public.ai_cost_models),
      'cost_snapshots_0508', (select count(*) from public.ai_cost_snapshots),
      'connector_definitions_0536', (select count(*) from public.ai_connector_definitions),
      'connector_instances_0536', (select count(*) from public.ai_connector_instances),
      'agents_0497', (select count(*) from public.ai_agents),
      'resource_registry_0529', (select count(*) from public.ai_resource_registry),
      'enterprise_contracts_0383', (select count(*) from public.enterprise_contracts),
      'billing_invoices', (select count(*) from public.enterprise_billing_invoices),
      'subscriptions', (select count(*) from public.subscriptions)
    ),
    'resource_unavailable', jsonb_build_array('verified_physical_inventory','accounting_ledger_feed','bank_balance_feed','treasury_system','hr_availability_calendar','payroll_system','cloud_billing_api_feed','provider_quota_api_feed','reservation_system'),   -- 원본 없음(실측)
    'inventory_is_not_ledger', true, 'availability_is_not_guarantee', true, 'demand_is_not_reservation', true,
    'option_is_not_allocated_resource', true, 'approval_reference_is_not_budget_execution', true,
    'budget_reference_is_not_cash', true, 'capacity_candidate_is_not_provisioned', true,
    'opportunity_cost_is_not_confirmed_loss', true, 'efficiency_is_not_accounting_roi', true,
    'no_auto_budget_allocation', true, 'no_auto_resource_allocation', true, 'no_auto_capital_allocation', true,
    'no_auto_payment', true, 'no_auto_provisioning', true, 'no_auto_hiring', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_resource_audit(p_limit int default 100)
returns setof public.ai_enterprise_resource_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resource_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_resource_inventory enable row level security;
alter table public.ai_enterprise_resource_demands enable row level security;
alter table public.ai_enterprise_resource_allocation_options enable row level security;
alter table public.ai_enterprise_resource_events enable row level security;

comment on table public.ai_enterprise_resource_inventory is 'AI-OPS-42 — Resource Inventory(≠ 자산 원장/회계 장부·도메인 30종·금지 19종 차단·reserved 는 외부 Reservation Reference 필수).';
comment on table public.ai_enterprise_resource_demands is 'AI-OPS-42 — Initiative Resource Demand(≠ 예약/구매 요청·Initiative/Portfolio 실존 검증·demand_ready 는 Evidence 필수).';
comment on table public.ai_enterprise_resource_allocation_options is 'AI-OPS-42 — Allocation Option(≠ 실제 Budget/Resource Allocation·Type 15종·금지 7종 차단·Approval Reference 의 budget/resources/capacity/production 전부 false).';
comment on table public.ai_enterprise_resource_events is 'AI-OPS-42 — Resource 이벤트 47종(자동 배정/집행/Provisioning/Payment 없음).';
