-- 0516_admin_ai_strategic_scenario_portfolio_intelligence.sql
-- Phase AI-OPS-13 — Enterprise Strategic Scenario Intelligence, Portfolio Optimization &
-- Capital Allocation Center.
--
-- 실제 전략/재무/용량 구조 분석 결과(추측 없음 — 0508/0511/0512/0514/0515 검증 완료):
--   Revenue: subscriptions(current_amount — MRR 실측)/payment_orders(paid)/subscription_plans.
--   Contract/Settlement: artist_contracts(0057)/settlement_policies(0059)/artist_settlements(0060).
--   Cost: ai_cost_models/ai_cost_snapshots(0508) — 단가 미입력 시 cost_unknown.
--     인건비/마케팅비/영업비/현금흐름 데이터 없음 → cost_unknown 정직 표기.
--   Capacity: ai_capacity_metrics/plans(0508) — limit 미입력 시 resource_capacity_unknown.
--     인력 Capacity 데이터 없음. 시장 규모/경쟁사/지역/Pipeline/Lead 데이터 없음
--     → market_data_unavailable 정직 표기.
--   Strategy Evidence: ai_executive_*(0503/0511)/ai_decision_memory·outcomes(0514)/
--     ai_organizational_learnings·policy_evolution(0515)/ai_knowledge_*(0513).
--
-- 전략 정직성(전부 강제):
--   * Forecast ≠ 실제 미래. Scenario ≠ 확정 사업계획. 예상 매출/비용 ≠ 실제.
--   * Hard Constraint 위반 → feasible 금지. 자원 총량 초과/중복 배정 생성 금지.
--   * selected_reference/approved_reference ≠ 실제 예산 집행/실행.
--   * 자동 예산/지출/인력/가격/계약/정산/서버/투자/영업/모델 학습 전부 없음.
--   * Trigger 없음 · 삭제 RPC 없음 · Budget/Payment RPC 없음 · 원본 테이블 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Strategic Objective — 목표 Reference(실행 보장 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_objectives (
  id                  uuid primary key default gen_random_uuid(),
  objective_code      text not null unique,
  title               text not null,
  strategic_domain    text not null check (strategic_domain in ('revenue','growth','enterprise','store','artist','content','playlist','contract','settlement','cost','capacity','reliability','security','privacy','compliance','operations','technology','infrastructure','product','policy','organizational','executive')),
  objective_type      text not null check (objective_type in ('revenue_growth','mrr_growth','enterprise_growth','store_growth','artist_growth','retention_improvement','churn_reduction','contract_renewal','margin_improvement','cost_reduction','capacity_expansion','reliability_improvement','security_risk_reduction','operational_efficiency','playlist_performance','market_expansion','product_expansion','strategic_partnership','governance_improvement','resilience_improvement','manual')),
  objective_status    text not null default 'draft' check (objective_status in ('draft','proposed','pending_review','approved_reference','active_reference','paused_reference','completed_reference','rejected','cancelled','expired','invalidated')),
  scope_type          text not null default 'unverified',
  scope_id            text,
  target_metric       text,
  target_direction    text check (target_direction is null or target_direction in ('increase','decrease','maintain','no_regression','range','unknown')),
  target_value        numeric,
  baseline_value      numeric,                                 -- 없으면 null(0 변환 금지)
  start_at            timestamptz,
  target_at           timestamptz,
  priority            int check (priority is null or (priority >= 1 and priority <= 5)),
  constraints_note    text,
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["active_reference ≠ 실제 실행 중","completed_reference ≠ 목표 달성 보장"]'::jsonb,
  source_version      text not null default 'strat_v1(0516)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (target_at is null or start_at is null or target_at > start_at)
);
create index if not exists idx_strat_obj on public.ai_strategic_objectives (objective_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Assumption — 검증 상태 포함(Unverified 비중 → Forecast 신뢰 제한).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_assumptions (
  id                  uuid primary key default gen_random_uuid(),
  assumption_code     text not null unique,
  strategic_objective_id uuid references public.ai_strategic_objectives(id),
  assumption_type     text not null check (assumption_type in ('demand_growth','price','churn','conversion','renewal','usage','capacity','unit_cost','fixed_cost','variable_cost','hiring_capacity','operational_capacity','incident_rate','security_risk','market_growth','partner_contribution','content_supply','playlist_adoption','manual')),
  description         text not null,
  input_value         numeric,
  value_unit          text check (value_unit is null or value_unit in ('krw','percent','count','hours','gb','ratio','days','manual')),
  source_type         text not null default 'manual' check (source_type in ('internal_data','decision_outcome','organizational_learning','forecast','external','manual')),
  verification_status text not null default 'unverified' check (verification_status in ('verified_by_internal_data','partially_verified','external_reference_only','unverified','stale_candidate','conflicting','unsupported','insufficient_data')),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  sensitivity         text check (sensitivity is null or sensitivity in ('low_sensitivity','moderate_sensitivity','high_sensitivity','critical_sensitivity','insufficient_data')),
  valid_from          timestamptz,
  valid_to            timestamptz,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to > valid_from)
);
create index if not exists idx_strat_asm on public.ai_strategic_assumptions (assumption_type, verification_status);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Constraint — Hard Constraint 우선(위반 시 feasible 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_constraints (
  id                  uuid primary key default gen_random_uuid(),
  constraint_code     text not null unique,
  strategic_objective_id uuid references public.ai_strategic_objectives(id),
  constraint_type     text not null check (constraint_type in ('budget','cash','people','time','database','storage','bandwidth','player_capacity','operational_capacity','support_capacity','settlement_capacity','legal','contract','security','privacy','compliance','policy','technology','dependency','mutual_exclusion','manual')),
  resource_type       text,
  minimum_value       numeric,
  maximum_value       numeric,
  current_value       numeric,                                 -- 미확인 시 null(resource_capacity_unknown)
  unit                text check (unit is null or unit in ('krw','percent','count','hours','gb','ratio','days','manual')),
  hard_constraint     boolean not null default false,
  exclusivity_group   text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["current_value null = resource_capacity_unknown(임의 추정 금지)"]'::jsonb,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (maximum_value is null or minimum_value is null or maximum_value >= minimum_value)
);
create index if not exists idx_strat_con on public.ai_strategic_constraints (constraint_type, hard_constraint);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Scenario — 시뮬레이션 입력(실행 계획 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_scenarios (
  id                  uuid primary key default gen_random_uuid(),
  scenario_code       text not null unique,
  strategic_objective_id uuid references public.ai_strategic_objectives(id),
  scenario_name       text not null,
  scenario_type       text not null check (scenario_type in ('base_case','upside_case','downside_case','stress_case','conservative_case','aggressive_case','alternative_case','no_action_case','custom')),
  scenario_status     text not null default 'draft' check (scenario_status in ('draft','ready_for_simulation','simulated','waiting_evidence','infeasible','reviewed','selected_reference','rejected','cancelled','expired','invalidated')),
  scenario_horizon    text not null default '90_day' check (scenario_horizon in ('30_day','90_day','180_day','1_year','3_year','custom')),
  assumption_ids      jsonb not null default '[]'::jsonb,
  constraint_ids      jsonb not null default '[]'::jsonb,
  forecast_results    jsonb,                                   -- 순수 로직 산출(범위 포함 — 실제 미래 아님)
  input_validation    jsonb,
  expected_benefits   jsonb not null default '[]'::jsonb,
  expected_costs      jsonb not null default '[]'::jsonb,      -- cost_unknown 가능
  expected_risks      jsonb not null default '[]'::jsonb,
  feasibility_status  text not null default 'feasibility_unverified' check (feasibility_status in ('feasible_reference','partially_feasible','hard_constraint_violated','dependency_unverified','resource_capacity_unknown','cost_unknown','infeasible','feasibility_unverified','insufficient_data')),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["시뮬레이션 입력 — 확정 사업계획 아님","Forecast ≠ 실제 미래","selected_reference ≠ 실행 승인"]'::jsonb,
  source_version      text not null default 'strat_v1(0516)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_strat_scn on public.ai_strategic_scenarios (scenario_type, scenario_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Initiative + Portfolio + Allocation(실제 프로젝트/예산/인력 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_initiatives (
  id                  uuid primary key default gen_random_uuid(),
  initiative_code     text not null unique,
  strategic_objective_id uuid references public.ai_strategic_objectives(id),
  title               text not null,
  initiative_type     text not null check (initiative_type in ('acquire_enterprise_candidate','expand_store_candidate','enter_industry_candidate','enter_region_candidate','launch_product_candidate','improve_retention_candidate','renew_contract_candidate','expand_playlist_candidate','acquire_content_candidate','increase_capacity_candidate','reduce_cost_candidate','improve_reliability_candidate','reduce_security_risk_candidate','improve_governance_candidate','strategic_partnership_candidate','manual')),
  strategic_domain    text not null,
  required_budget     numeric check (required_budget is null or required_budget >= 0),
  required_resources  jsonb not null default '[]'::jsonb,
  expected_value_note text,
  expected_cost_note  text,                                    -- cost_unknown 가능
  expected_risk_note  text,
  dependencies        jsonb not null default '[]'::jsonb,      -- initiative_code 배열
  mutual_exclusion_group text,
  reversibility       text check (reversibility is null or reversibility in ('reversible','partially_reversible','irreversible','unknown')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["후보만 — 프로젝트 생성/업무 할당 없음"]'::jsonb,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','proposed','reviewed','selected_reference','deferred_reference','rejected','invalidated')),
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_strat_init on public.ai_strategic_initiatives (initiative_type, lifecycle_status);

create table if not exists public.ai_strategic_portfolios (
  id                  uuid primary key default gen_random_uuid(),
  portfolio_code      text not null unique,
  title               text not null,
  strategic_objective_id uuid references public.ai_strategic_objectives(id),
  scenario_id         uuid references public.ai_strategic_scenarios(id),
  initiative_ids      jsonb not null default '[]'::jsonb,
  portfolio_type      text not null check (portfolio_type in ('balanced','growth_focused','revenue_focused','retention_focused','cost_focused','resilience_focused','risk_reduction','conservative','aggressive','custom')),
  total_required_budget numeric check (total_required_budget is null or total_required_budget >= 0),
  expected_value_summary text,
  expected_cost_summary text,
  expected_risk_summary text,
  concentration_summary jsonb,
  feasibility_status  text not null default 'feasibility_unverified' check (feasibility_status in ('feasible_reference','partially_feasible','hard_constraint_violated','dependency_unverified','resource_capacity_unknown','cost_unknown','mutually_exclusive_conflict','infeasible','feasibility_unverified','insufficient_data')),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["후보 비교용 — 실제 예산/실행 아님","approved_reference ≠ 집행"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','selected_reference','deferred_reference','rejected','cancelled','expired','invalidated')),
  reviewer_id         uuid,
  approver_id         uuid,
  self_approval_warning boolean not null default false,
  decision_reason     text,
  source_version      text not null default 'strat_v1(0516)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz
);
create index if not exists idx_strat_pf on public.ai_strategic_portfolios (review_status, created_at desc);

create table if not exists public.ai_resource_allocation_candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_code      text not null unique,
  strategic_portfolio_id uuid not null references public.ai_strategic_portfolios(id),
  resource_type       text not null check (resource_type in ('budget','cash','engineering_capacity','operations_capacity','sales_capacity','support_capacity','content_capacity','storage','bandwidth','database_capacity','settlement_capacity','executive_attention','calendar_time')),
  available_amount    numeric,                                 -- 미확인 시 null(resource_capacity_unknown)
  reserve_amount      numeric check (reserve_amount is null or reserve_amount >= 0),
  allocated_amount    numeric not null check (allocated_amount >= 0),
  allocation_items    jsonb not null default '[]'::jsonb,      -- [{initiative_code, amount}]
  constraint_status   text not null default 'insufficient_data' check (constraint_status in ('ready_for_human_review','reserve_violated','over_allocated','double_allocation_detected','dependency_unverified','resource_capacity_unknown','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["배분 후보 — 실제 Budget/인력/서버 설정 미변경","회계 전표/송금 아님"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','selected_reference','rejected','invalidated')),
  source_version      text not null default 'strat_v1(0516)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_strat_alloc on public.ai_resource_allocation_candidates (strategic_portfolio_id, constraint_status);

create table if not exists public.ai_strategic_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('objective_created','assumption_saved','constraint_saved','scenario_created','scenario_simulated','scenario_reviewed','initiative_created','portfolio_created','portfolio_reviewed','allocation_candidate_created','allocation_safety_checked','recommendation_created','decision_reference_recorded','external_strategic_action_reference','scenario_outcome_linked','strategic_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_strat_evt on public.ai_strategic_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 요약 — 원본 실측 참조(미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_strategic_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'objectives_by_status', (select coalesce(jsonb_object_agg(objective_status, n), '{}'::jsonb) from (select objective_status, count(*) n from public.ai_strategic_objectives group by objective_status) x),
    'assumptions_by_verification', (select coalesce(jsonb_object_agg(verification_status, n), '{}'::jsonb) from (select verification_status, count(*) n from public.ai_strategic_assumptions group by verification_status) x),
    'constraints_total', (select count(*) from public.ai_strategic_constraints),
    'hard_constraints', (select count(*) from public.ai_strategic_constraints where hard_constraint),
    'scenarios_by_type', (select coalesce(jsonb_object_agg(scenario_type, n), '{}'::jsonb) from (select scenario_type, count(*) n from public.ai_strategic_scenarios group by scenario_type) x),
    'scenarios_by_status', (select coalesce(jsonb_object_agg(scenario_status, n), '{}'::jsonb) from (select scenario_status, count(*) n from public.ai_strategic_scenarios group by scenario_status) x),
    'initiatives_total', (select count(*) from public.ai_strategic_initiatives),
    'portfolios_by_feasibility', (select coalesce(jsonb_object_agg(feasibility_status, n), '{}'::jsonb) from (select feasibility_status, count(*) n from public.ai_strategic_portfolios group by feasibility_status) x),
    'allocations_by_status', (select coalesce(jsonb_object_agg(constraint_status, n), '{}'::jsonb) from (select constraint_status, count(*) n from public.ai_resource_allocation_candidates group by constraint_status) x),
    -- 실측 원본(참조만):
    'source_actuals', jsonb_build_object(
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'revenue_30d', (select coalesce(sum(amount), 0) from public.payment_orders where status = 'paid' and paid_at >= now() - interval '30 days'),
      'active_subscriptions', (select count(*) from public.subscriptions where status in ('active','cancel_scheduled')),
      'active_stores', (select count(*) from public.users where account_type = 'business' and withdrawn_at is null),
      'contracts_signed', (select count(*) from public.artist_contracts where status = 'signed'),
      'settlement_total', (select coalesce(sum(final_payout_amount), 0) from public.artist_settlements),
      'labor_cost', 'cost_unknown', 'marketing_cost', 'cost_unknown', 'market_size', 'market_data_unavailable'
    ),
    'no_auto_budget', true, 'no_auto_execution', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 생성/조회 RPC(공통: guard·whitelist·idempotency·Evidence 필수).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_strategic_objective_create(
  p_code text, p_title text, p_domain text, p_type text, p_evidence jsonb,
  p_target_metric text default null, p_target_direction text default null, p_target_value numeric default null,
  p_baseline_value numeric default null, p_priority int default null, p_start_at timestamptz default null, p_target_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  select id into v_id from public.ai_strategic_objectives where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_objectives (objective_code, title, strategic_domain, objective_type, target_metric, target_direction, target_value, baseline_value, priority, start_at, target_at, evidence, objective_status, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_domain, p_type, p_target_metric, p_target_direction, p_target_value, p_baseline_value, p_priority, p_start_at, p_target_at, p_evidence, 'proposed', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('objective_created', v_id, p_code || ' (' || p_type || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_objectives(p_status text default null, p_limit int default 100)
returns setof public.ai_strategic_objectives language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_objectives where (p_status is null or objective_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_assumption_save(
  p_code text, p_type text, p_description text, p_evidence jsonb,
  p_objective_id uuid default null, p_value numeric default null, p_unit text default null,
  p_source_type text default 'manual', p_verification text default 'unverified', p_confidence numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_description is null or btrim(p_description) = '' then raise exception 'description 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_objective_id is not null and not exists (select 1 from public.ai_strategic_objectives where id = p_objective_id) then raise exception 'objective 실존 검증 실패'; end if;
  select id into v_id from public.ai_strategic_assumptions where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_assumptions (assumption_code, strategic_objective_id, assumption_type, description, input_value, value_unit, source_type, verification_status, confidence, evidence, idempotency_key, created_by)
  values (p_code, p_objective_id, p_type, left(p_description, 1000), p_value, p_unit, coalesce(p_source_type, 'manual'), coalesce(p_verification, 'unverified'), p_confidence, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('assumption_saved', v_id, p_code || ' (' || p_type || '/' || coalesce(p_verification, 'unverified') || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_assumptions(p_limit int default 100)
returns setof public.ai_strategic_assumptions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_assumptions order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_constraint_save(
  p_code text, p_type text, p_evidence jsonb, p_objective_id uuid default null,
  p_resource_type text default null, p_min numeric default null, p_max numeric default null,
  p_current numeric default null, p_unit text default null, p_hard boolean default false, p_exclusivity text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  select id into v_id from public.ai_strategic_constraints where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_constraints (constraint_code, strategic_objective_id, constraint_type, resource_type, minimum_value, maximum_value, current_value, unit, hard_constraint, exclusivity_group, evidence, idempotency_key, created_by)
  values (p_code, p_objective_id, p_type, p_resource_type, p_min, p_max, p_current, p_unit, coalesce(p_hard, false), p_exclusivity, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('constraint_saved', v_id, p_code || ' (' || p_type || case when p_hard then '/hard' else '' end || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_constraints(p_limit int default 100)
returns setof public.ai_strategic_constraints language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_constraints order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_scenario_create(
  p_code text, p_name text, p_type text, p_horizon text, p_evidence jsonb,
  p_objective_id uuid default null, p_assumption_ids jsonb default '[]'::jsonb, p_constraint_ids jsonb default '[]'::jsonb,
  p_forecast_results jsonb default null, p_input_validation jsonb default null,
  p_feasibility text default 'feasibility_unverified', p_confidence numeric default null, p_unknown_factors jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_name is null or btrim(p_name) = '' then raise exception 'scenario_name 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_objective_id is not null and not exists (select 1 from public.ai_strategic_objectives where id = p_objective_id) then raise exception 'objective 실존 검증 실패'; end if;
  if jsonb_array_length(coalesce(p_assumption_ids, '[]'::jsonb)) > 50 or jsonb_array_length(coalesce(p_constraint_ids, '[]'::jsonb)) > 50 then raise exception '연결 50개 제한'; end if;
  if pg_column_size(coalesce(p_forecast_results, '{}'::jsonb)) > 32768 then raise exception 'forecast payload 크기 초과'; end if;
  select id into v_id from public.ai_strategic_scenarios where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_scenarios (scenario_code, strategic_objective_id, scenario_name, scenario_type, scenario_status, scenario_horizon, assumption_ids, constraint_ids, forecast_results, input_validation, feasibility_status, confidence, evidence, unknown_factors, idempotency_key, created_by)
  values (p_code, p_objective_id, left(p_name, 200), p_type, case when p_forecast_results is not null then 'simulated' else 'draft' end, p_horizon, coalesce(p_assumption_ids, '[]'::jsonb), coalesce(p_constraint_ids, '[]'::jsonb), p_forecast_results, p_input_validation, coalesce(p_feasibility, 'feasibility_unverified'), p_confidence, p_evidence, coalesce(p_unknown_factors, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id)
  values (case when p_forecast_results is not null then 'scenario_simulated' else 'scenario_created' end, v_id, p_code || ' (' || p_type || '/' || p_horizon || ') — Forecast ≠ 실제 미래', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_scenario_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('ready_for_simulation','simulated','waiting_evidence','infeasible','reviewed','selected_reference','rejected','cancelled','expired','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select scenario_status into v_cur from public.ai_strategic_scenarios where id = p_id for update;
  if v_cur is null then raise exception 'scenario 없음'; end if;
  if v_cur in ('rejected','cancelled','expired','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_strategic_scenarios set scenario_status = p_status, updated_at = now() where id = p_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('scenario_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (selected_reference ≠ 실행 승인)', v_uid);
  return jsonb_build_object('ok', true, 'scenario_status', p_status, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_scenarios(p_type text default null, p_status text default null, p_limit int default 100)
returns setof public.ai_strategic_scenarios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_scenarios
    where (p_type is null or scenario_type = p_type) and (p_status is null or scenario_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_initiative_create(
  p_code text, p_title text, p_type text, p_domain text, p_evidence jsonb,
  p_objective_id uuid default null, p_budget numeric default null, p_dependencies jsonb default '[]'::jsonb,
  p_exclusion_group text default null, p_reversibility text default null,
  p_value_note text default null, p_cost_note text default null, p_risk_note text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_budget is not null and p_budget < 0 then raise exception 'budget 음수 금지'; end if;
  select id into v_id from public.ai_strategic_initiatives where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_initiatives (initiative_code, strategic_objective_id, title, initiative_type, strategic_domain, required_budget, dependencies, mutual_exclusion_group, reversibility, expected_value_note, expected_cost_note, expected_risk_note, evidence, idempotency_key, created_by)
  values (p_code, p_objective_id, left(p_title, 200), p_type, p_domain, p_budget, coalesce(p_dependencies, '[]'::jsonb), p_exclusion_group, p_reversibility, p_value_note, coalesce(p_cost_note, 'cost_unknown'), p_risk_note, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('initiative_created', v_id, p_code || ' (' || p_type || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'project_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_initiatives(p_limit int default 100)
returns setof public.ai_strategic_initiatives language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_initiatives order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_portfolio_create(
  p_code text, p_title text, p_type text, p_evidence jsonb,
  p_objective_id uuid default null, p_scenario_id uuid default null, p_initiative_ids jsonb default '[]'::jsonb,
  p_total_budget numeric default null, p_feasibility text default 'feasibility_unverified',
  p_concentration jsonb default null, p_confidence numeric default null,
  p_value_summary text default null, p_cost_summary text default null, p_risk_summary text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_total_budget is not null and p_total_budget < 0 then raise exception 'budget 음수 금지'; end if;
  if jsonb_array_length(coalesce(p_initiative_ids, '[]'::jsonb)) > 30 then raise exception 'initiative 30개 제한(조합 폭발 방지)'; end if;
  if p_scenario_id is not null and not exists (select 1 from public.ai_strategic_scenarios where id = p_scenario_id) then raise exception 'scenario 실존 검증 실패'; end if;
  select id into v_id from public.ai_strategic_portfolios where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_portfolios (portfolio_code, title, strategic_objective_id, scenario_id, initiative_ids, portfolio_type, total_required_budget, feasibility_status, concentration_summary, confidence, expected_value_summary, expected_cost_summary, expected_risk_summary, evidence, review_status, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_objective_id, p_scenario_id, coalesce(p_initiative_ids, '[]'::jsonb), p_type, p_total_budget, coalesce(p_feasibility, 'feasibility_unverified'), p_concentration, p_confidence, p_value_summary, coalesce(p_cost_summary, 'cost_unknown'), p_risk_summary, p_evidence, 'pending_review', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('portfolio_created', v_id, p_code || ' (' || p_type || '/' || coalesce(p_feasibility, 'feasibility_unverified') || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'budget_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_portfolio_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_maker uuid; v_warn boolean := false;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','selected_reference','deferred_reference','rejected','cancelled','expired','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select review_status, created_by into v_cur, v_maker from public.ai_strategic_portfolios where id = p_id for update;
  if v_cur is null then raise exception 'portfolio 없음'; end if;
  if v_cur in ('rejected','cancelled','expired','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_status = 'selected_reference' and v_maker = v_uid then v_warn := true; end if;
  update public.ai_strategic_portfolios
     set review_status = p_status, decision_reason = p_reason, reviewer_id = v_uid,
         approver_id = case when p_status = 'selected_reference' then v_uid else approver_id end,
         self_approval_warning = self_approval_warning or v_warn, reviewed_at = now()
   where id = p_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('portfolio_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (selected_reference ≠ 예산 집행)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'self_approval_warning', v_warn, 'budget_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_portfolios(p_status text default null, p_limit int default 100)
returns setof public.ai_strategic_portfolios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_portfolios where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Allocation Candidate — 총량/Reserve/중복 배정 서버 검증(실제 배분 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_resource_allocation_create(
  p_code text, p_portfolio_id uuid, p_resource_type text, p_allocated numeric,
  p_items jsonb, p_evidence jsonb, p_available numeric default null, p_reserve numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_sum numeric := 0; v_item jsonb; v_codes text[] := '{}'; v_code text; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_strategic_portfolios where id = p_portfolio_id) then raise exception 'portfolio 실존 검증 실패'; end if;
  if p_allocated is null or p_allocated < 0 then raise exception '배분 음수/null 금지'; end if;
  if p_reserve is not null and p_reserve < 0 then raise exception 'reserve 음수 금지'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'allocation_items 필수'; end if;
  if jsonb_array_length(p_items) > 30 then raise exception 'item 30개 제한'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  -- 합계/중복 배정 검증
  for v_item in select * from jsonb_array_elements(p_items) loop
    if (v_item->>'amount') is null or (v_item->>'amount')::numeric < 0 then raise exception 'item 금액 음수/null 금지'; end if;
    v_sum := v_sum + (v_item->>'amount')::numeric;
    v_code := v_item->>'initiative_code';
    if v_code = any(v_codes) then
      v_status := 'double_allocation_detected';
    end if;
    v_codes := array_append(v_codes, v_code);
  end loop;
  if v_status is null then
    if abs(v_sum - p_allocated) > 0.01 then raise exception 'item 합계(%)와 allocated(%) 불일치', v_sum, p_allocated; end if;
    if p_available is null then v_status := 'resource_capacity_unknown';        -- 총량 미확인 — feasible 단정 금지
    elsif p_allocated > p_available - coalesce(p_reserve, 0) then
      v_status := case when p_allocated > p_available then 'over_allocated' else 'reserve_violated' end;
    else v_status := 'ready_for_human_review';
    end if;
  end if;
  select id into v_id from public.ai_resource_allocation_candidates where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_resource_allocation_candidates (candidate_code, strategic_portfolio_id, resource_type, available_amount, reserve_amount, allocated_amount, allocation_items, constraint_status, evidence, review_status, idempotency_key, created_by)
  values (p_code, p_portfolio_id, p_resource_type, p_available, p_reserve, p_allocated, p_items, v_status, p_evidence, 'pending_review', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategic_events (event_type, ref_id, detail, actor_id) values ('allocation_candidate_created', v_id, p_code || ' (' || p_resource_type || '/' || v_status || ') — 실제 예산 미변경', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'constraint_status', v_status, 'budget_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_resource_allocation_candidates(p_limit int default 100)
returns setof public.ai_resource_allocation_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_resource_allocation_candidates order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_strategic_external_action_reference(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('budget_approved_reference','initiative_started_reference','initiative_paused_reference','initiative_completed_reference','enterprise_acquired_reference','contract_signed_reference','capacity_added_reference','hiring_completed_reference','partnership_signed_reference','product_launched_reference','campaign_started_reference','cost_reduction_completed_reference','strategic_action_cancelled_reference','manual_strategic_action_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_strategic_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_strategic_action_reference', p_ref_id, p_action_type || ' — ' || left(p_reason, 200), jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'production_applied', false);
end $$;

create or replace function public.admin_strategic_audit(p_limit int default 100)
returns setof public.ai_strategic_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_strategic_objectives enable row level security;
alter table public.ai_strategic_assumptions enable row level security;
alter table public.ai_strategic_constraints enable row level security;
alter table public.ai_strategic_scenarios enable row level security;
alter table public.ai_strategic_initiatives enable row level security;
alter table public.ai_strategic_portfolios enable row level security;
alter table public.ai_resource_allocation_candidates enable row level security;
alter table public.ai_strategic_events enable row level security;

comment on table public.ai_strategic_objectives is 'AI-OPS-13 — 전략 목표 Reference(active_reference ≠ 실행 중·달성 보장 아님).';
comment on table public.ai_strategic_assumptions is 'AI-OPS-13 — 가정(검증 상태 8종 — unverified 비중 높으면 Forecast 신뢰 제한).';
comment on table public.ai_strategic_constraints is 'AI-OPS-13 — 제약(hard 위반 시 feasible 금지·current null=capacity_unknown).';
comment on table public.ai_strategic_scenarios is 'AI-OPS-13 — 시나리오(시뮬레이션 입력 — 확정 사업계획/실제 미래 아님).';
comment on table public.ai_strategic_initiatives is 'AI-OPS-13 — Initiative 후보(프로젝트 생성/업무 할당 없음).';
comment on table public.ai_strategic_portfolios is 'AI-OPS-13 — 포트폴리오 후보(selected_reference ≠ 예산 집행).';
comment on table public.ai_resource_allocation_candidates is 'AI-OPS-13 — 배분 후보(총량/Reserve/중복 서버 검증 — 실제 Budget/인력/서버 미변경).';
comment on table public.ai_strategic_events is 'AI-OPS-13 — Strategic Audit(event_type whitelist 16종).';
