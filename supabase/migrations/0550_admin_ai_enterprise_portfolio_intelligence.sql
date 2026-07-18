-- 0550_admin_ai_enterprise_portfolio_intelligence.sql
-- AI-OPS-46 — Enterprise Portfolio Intelligence, Investment Portfolio
-- Optimization & Strategic Capital Governance Center.
--
-- Enterprise Vision → Strategic Objectives → Strategic Initiatives →
-- Investment Portfolio → Capital Allocation Scenario → Portfolio
-- Diversification → Risk vs Return → Value Concentration → Scenario
-- Comparison → Portfolio Optimization Candidate → Executive Portfolio
-- Review → Portfolio Decision Reference → Portfolio Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Portfolio Candidate ≠ Approved Portfolio.
--  * Capital Allocation Candidate ≠ Capital Allocation — 자동 자본 배분/투자
--    승인 RPC 자체가 없음.
--  * Portfolio Optimization ≠ Investment Decision.
--  * Diversification Score ≠ Risk Guarantee. Concentration Risk ≠ Failure
--    Prediction. Opportunity Cost ≠ Actual Loss.
--  * Portfolio Recommendation ≠ Decision. Executive Review ≠ Approval.
--  * ROI Mix ≠ Accounting Return. Strategic Value Mix ≠ Financial Statement.
--  * Scenario Comparison ≠ Future Fact. Forecast ≠ Future Fact.
--    Confidence ≠ Certainty.
--  * Null → 0 변환 금지(capital/benefit 은 null 유지 가능).
--    insufficient_data / sample_too_small 유지.
--  * 자동 투자 승인/Capital Allocation/Budget/Strategy 변경·자동 Initiative
--    생성/종료·자동 Resource Allocation/KPI/Portfolio 변경·자동 회계 처리/
--    Payment/Production/Merge/Deploy/Rollback — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0514/0520/0545/0546/0547/0548/0549
--    원본 무변경(참조만).
--  * Portfolio Optimization/Trade-off/Opportunity Cost 는 신규 테이블 대신
--    JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Investment Portfolio(≠ 승인된 투자 포트폴리오).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_investment_portfolios (
  id                        uuid primary key default gen_random_uuid(),
  portfolio_code            text not null,
  portfolio_name            text not null,
  portfolio_category        text not null check (portfolio_category in ('growth','stability','innovation','operational_excellence','customer_experience','platform','ai','security','compliance','infrastructure','brand','content','store','strategic','long_term','custom')),
  portfolio_status          text not null default 'draft' check (portfolio_status in ('draft','active_reference','review_reference','deprecated_reference','insufficient_data')),
  portfolio_description     text,
  strategy_portfolio_id     uuid,
  total_capital_reference   numeric,
  capital_source_reference  text,
  diversification_status    text not null default 'insufficient_data' check (diversification_status in ('highly_diversified_candidate','well_diversified_candidate','moderately_diversified_candidate','concentrated_candidate','highly_concentrated_candidate','insufficient_data')),
  allocation_status         text not null default 'insufficient_data' check (allocation_status in ('recommended_candidate','acceptable_candidate','high_risk_candidate','insufficient_data')),
  optimization_status       text not null default 'insufficient_data' check (optimization_status in ('highly_optimized_candidate','optimized_candidate','partially_optimized_candidate','optimization_unverified','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  initiative_references     jsonb not null default '[]'::jsonb,
  business_value_references jsonb not null default '[]'::jsonb,
  kpi_references            jsonb not null default '[]'::jsonb,
  program_references        jsonb not null default '[]'::jsonb,
  resource_references       jsonb not null default '[]'::jsonb,
  balance_result            jsonb,
  diversification_result    jsonb,
  concentration_result      jsonb,
  roi_mix_result            jsonb,
  value_mix_result          jsonb,
  risk_return_result        jsonb,
  tradeoff_result           jsonb,
  comparison_result         jsonb,
  opportunity_cost_result   jsonb,
  capacity_fit_result       jsonb,
  optimization_result       jsonb,
  scorecard_result          jsonb,
  recommendation_candidate  jsonb,
  portfolio_reviews         jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  decision_reference        jsonb,
  learning_references       jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aeip_idem on public.ai_enterprise_investment_portfolios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeip_status on public.ai_enterprise_investment_portfolios (portfolio_status, portfolio_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Portfolio Scenario(Capital Allocation Candidate — 배분 집행 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_portfolio_scenarios (
  id                        uuid primary key default gen_random_uuid(),
  scenario_code             text not null,
  scenario_name             text not null,
  investment_portfolio_id   uuid not null,
  scenario_status           text not null default 'draft' check (scenario_status in ('draft','analyzed_candidate','compared_candidate','preferred_candidate','rejected_reference','superseded','insufficient_data')),
  scenario_summary          text,
  current_allocation        jsonb,
  proposed_allocation       jsonb,
  expected_benefit_candidate numeric,
  expected_risk_candidate   int check (expected_risk_candidate is null or (expected_risk_candidate >= 0 and expected_risk_candidate <= 100)),
  capacity_requirement      jsonb,
  opportunity_cost_candidate jsonb,
  allocation_result         jsonb,
  comparison_result         jsonb,
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
create unique index if not exists uq_aeps_idem on public.ai_enterprise_portfolio_scenarios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeps_pf on public.ai_enterprise_portfolio_scenarios (investment_portfolio_id, scenario_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Portfolio 이벤트(32종) — Balance/Diversification/Concentration/
--    ROI·Value Mix/Risk-Return/Trade-off/Comparison/Opportunity Cost/
--    Capacity Fit/Optimization/Scorecard/Summary/Recommendation/Review/
--    Decision Reference/Link/Learning 통합 Audit(자동 승인 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_portfolio_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('portfolio_created','portfolio_reviewed','portfolio_capital_reference_recorded','portfolio_scenario_created','portfolio_scenario_reviewed','capital_allocation_candidate_recorded','portfolio_balance_reviewed','diversification_reviewed','concentration_risk_reviewed','roi_mix_reviewed','value_mix_reviewed','risk_return_reviewed','portfolio_tradeoff_reviewed','scenario_comparison_recorded','opportunity_cost_reviewed','capacity_fit_reviewed','portfolio_optimization_reviewed','executive_portfolio_scorecard_recorded','executive_portfolio_summary_recorded','portfolio_recommendation_recorded','portfolio_review_requested','executive_review_requested','strategy_review_requested','portfolio_review_reference_recorded','portfolio_decision_reference_recorded','portfolio_revision_requested','initiative_reference_linked','business_value_reference_linked','kpi_reference_linked','program_reference_linked','resource_reference_linked','portfolio_learning_reference_recorded')),
  investment_portfolio_id   uuid,
  portfolio_scenario_id     uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aepe2_evt on public.ai_enterprise_portfolio_events (event_type, created_at desc);
create index if not exists idx_aepe2_pf on public.ai_enterprise_portfolio_events (investment_portfolio_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Investment Portfolio 생성 — 자동 자본 배분 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_investment_portfolio_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_investment_portfolios;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'portfolio_category','');
  -- 자동 집행/개인 평가 계열 — 구조적 차단(Portfolio Candidate ≠ Approved Portfolio).
  if v_cat in ('automatic_capital_allocation','automatic_investment_execution','automatic_budget_execution','automatic_trading','personal_investment_advice','personal_performance_portfolio','credit_decision','ma_execution') then
    raise exception '금지된 portfolio_category(자동 집행/개인 평가 계열 비활성)';
  end if;
  if v_cat not in ('growth','stability','innovation','operational_excellence','customer_experience','platform','ai','security','compliance','infrastructure','brand','content','store','strategic','long_term','custom') then
    raise exception '허용되지 않는 portfolio_category';
  end if;
  if coalesce(btrim(p_payload->>'portfolio_name'),'') = '' then raise exception 'portfolio_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_investment_portfolios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'portfolio_is_not_approved_portfolio', true); end if;
  end if;
  insert into public.ai_enterprise_investment_portfolios (portfolio_code, portfolio_name, portfolio_category, portfolio_description, strategy_portfolio_id, initiative_references, business_value_references, kpi_references, program_references, resource_references, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'portfolio_code',''), 'EIP-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'portfolio_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'portfolio_description',''), 2000),''),
    nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    coalesce(p_payload->'initiative_references', '[]'::jsonb), coalesce(p_payload->'business_value_references', '[]'::jsonb),
    coalesce(p_payload->'kpi_references', '[]'::jsonb), coalesce(p_payload->'program_references', '[]'::jsonb),
    coalesce(p_payload->'resource_references', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, detail, payload, actor_id)
  values ('portfolio_created', v_id, left(v_cat, 80) || ' (Portfolio Candidate ≠ Approved Portfolio — draft·자동 배분 없음)', jsonb_build_object('portfolio_name', p_payload->>'portfolio_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'portfolio_is_not_approved_portfolio', true, 'investment_approved', false, 'capital_allocated', false, 'budget_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Portfolio 검토/Capital Reference — deprecated 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_investment_portfolio_review(p_portfolio_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_investment_portfolios; v_next text := null; v_evt text := 'portfolio_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('activate_reference','mark_review_reference','deprecate_reference','mark_insufficient_data','record_capital_reference','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_investment_portfolios where id = p_portfolio_id;
  if v_row.id is null then raise exception 'Investment Portfolio 없음(실존 검증 실패)'; end if;
  if v_row.portfolio_status = 'deprecated_reference' and p_action <> 'invalidate' then
    raise exception '종결 상태 재결정 차단(deprecated_reference)';
  end if;

  if p_action = 'activate_reference' then v_next := 'active_reference'; v_note := ' (Active Reference ≠ 승인된 Portfolio)';
  elsif p_action = 'mark_review_reference' then v_next := 'review_reference';
  elsif p_action = 'deprecate_reference' then v_next := 'deprecated_reference';
  elsif p_action = 'mark_insufficient_data' then v_next := 'insufficient_data';
  elsif p_action = 'record_capital_reference' then
    -- Capital Reference ≠ 배분 집행 — 출처 없이 기록 차단.
    if nullif(p_payload->>'total_capital_reference','') is null then raise exception 'total_capital_reference 필수'; end if;
    if coalesce(nullif(p_payload->>'capital_source_reference',''), '') = '' then
      raise exception '출처 없는 Capital Reference 기록 금지';
    end if;
    v_evt := 'portfolio_capital_reference_recorded'; v_note := ' (Capital Reference ≠ 배분 집행/회계 확정)';
    update public.ai_enterprise_investment_portfolios set
      total_capital_reference = (p_payload->>'total_capital_reference')::numeric,
      capital_source_reference = left(p_payload->>'capital_source_reference', 200),
      reviewed_by = v_uid, updated_at = now()
    where id = p_portfolio_id;
  else v_next := 'insufficient_data'; v_evt := 'portfolio_reviewed';
  end if;

  if v_next is not null then
    update public.ai_enterprise_investment_portfolios set portfolio_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_portfolio_id;
  end if;
  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, detail, payload, actor_id)
  values (v_evt, p_portfolio_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.portfolio_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_portfolio_id, 'status', coalesce(v_next, v_row.portfolio_status), 'portfolio_is_not_approved_portfolio', true, 'investment_approved', false, 'capital_allocated', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Portfolio Scenario 생성/검토 — Preferred 는 Evidence 필수(≠ 승인).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_portfolio_scenario_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_pf public.ai_enterprise_investment_portfolios; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_portfolio_scenarios;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 65536 then raise exception 'scenario payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(btrim(p_payload->>'scenario_name'),'') = '' then raise exception 'scenario_name 필수'; end if;
  if nullif(p_payload->>'investment_portfolio_id','') is null then raise exception 'investment_portfolio_id 필수'; end if;
  select * into v_pf from public.ai_enterprise_investment_portfolios where id = (p_payload->>'investment_portfolio_id')::uuid;
  if v_pf.id is null then raise exception 'Investment Portfolio 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_portfolio_scenarios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'allocation_candidate_is_not_capital_allocation', true); end if;
  end if;
  insert into public.ai_enterprise_portfolio_scenarios (scenario_code, scenario_name, investment_portfolio_id, scenario_summary, current_allocation, proposed_allocation, expected_benefit_candidate, expected_risk_candidate, capacity_requirement, opportunity_cost_candidate, assumptions, unknown_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'scenario_code',''), 'EPS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'scenario_name', 200), v_pf.id,
    nullif(left(coalesce(p_payload->>'scenario_summary',''), 2000),''),
    p_payload->'current_allocation', p_payload->'proposed_allocation',
    nullif(p_payload->>'expected_benefit_candidate','')::numeric,
    case when nullif(p_payload->>'expected_risk_candidate','') is null then null else least(100, greatest(0, (p_payload->>'expected_risk_candidate')::int)) end,
    p_payload->'capacity_requirement', p_payload->'opportunity_cost_candidate',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, portfolio_scenario_id, detail, payload, actor_id)
  values ('portfolio_scenario_created', v_pf.id, v_id, 'Capital Allocation Scenario (Allocation Candidate ≠ Capital Allocation — draft)', jsonb_build_object('scenario_name', p_payload->>'scenario_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'allocation_candidate_is_not_capital_allocation', true, 'investment_approved', false, 'capital_allocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_portfolio_scenario_review(p_scenario_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_portfolio_scenarios; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_analyzed','mark_compared','mark_preferred','reject_reference','supersede','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_portfolio_scenarios where id = p_scenario_id;
  if v_row.id is null then raise exception 'Portfolio Scenario 없음(실존 검증 실패)'; end if;
  if v_row.scenario_status in ('rejected_reference','superseded') then raise exception '종결 상태 재결정 차단(%)', v_row.scenario_status; end if;

  if p_action = 'mark_analyzed' then v_next := 'analyzed_candidate';
  elsif p_action = 'mark_compared' then v_next := 'compared_candidate'; v_note := ' (Comparison ≠ Future Fact)';
  elsif p_action = 'mark_preferred' then
    -- Preferred Candidate ≠ 승인 — Evidence 없이 표시 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 preferred 표시 금지(Preferred Candidate ≠ 승인)';
    end if;
    v_next := 'preferred_candidate'; v_note := ' (Preferred Candidate ≠ 투자 승인)';
  elsif p_action = 'reject_reference' then v_next := 'rejected_reference';
  elsif p_action = 'supersede' then v_next := 'superseded';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_portfolio_scenarios set scenario_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_scenario_id;
  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, portfolio_scenario_id, detail, payload, actor_id)
  values ('portfolio_scenario_reviewed', v_row.investment_portfolio_id, p_scenario_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_scenario_id, 'status', v_next, 'allocation_candidate_is_not_capital_allocation', true, 'investment_approved', false, 'capital_allocated', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Executive Portfolio Review — 요청/Reference 기록만. Self-Review 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_portfolio_executive_review(p_portfolio_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_investment_portfolios; v_evt text; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_portfolio_review','request_executive_review','request_strategy_review','record_review_reference','record_decision_reference','request_revision') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_investment_portfolios where id = p_portfolio_id;
  if v_row.id is null then raise exception 'Investment Portfolio 없음(실존 검증 실패)'; end if;

  if p_action in ('record_review_reference','record_decision_reference') then
    -- Self-Review/Decision 차단 + Evidence 필수(Executive Review ≠ Approval,
    -- Decision Reference ≠ Capital Allocation).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Portfolio Review/Decision Reference 금지';
    end if;
    if p_action = 'record_review_reference' then
      v_evt := 'portfolio_review_reference_recorded';
      v_note := ' (Review Reference ≠ Approval — 투자/자본 결정은 사람)';
    else
      v_evt := 'portfolio_decision_reference_recorded';
      v_note := ' (Decision Reference ≠ Capital Allocation — 배분 집행 없음)';
    end if;
  elsif p_action = 'request_portfolio_review' then v_evt := 'portfolio_review_requested'; v_note := ' (Portfolio Review 요청 — 최종 결정은 사람)';
  elsif p_action = 'request_executive_review' then v_evt := 'executive_review_requested'; v_note := ' (Executive Review 요청 ≠ Approval)';
  elsif p_action = 'request_strategy_review' then v_evt := 'strategy_review_requested';
  else v_evt := 'portfolio_revision_requested';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'preferred_scenario_reference', p_payload->'preferred_scenario_reference',
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_portfolio_decision_confirmed', p_action = 'record_decision_reference',
    'investment_approved', false, 'capital_allocated', false, 'budget_changed', false,
    'strategy_changed', false, 'initiative_terminated', false, 'accounting_applied', false, 'production_applied', false);
  update public.ai_enterprise_investment_portfolios set
    portfolio_reviews = portfolio_reviews || jsonb_build_array(v_review),
    review_reference = case when p_action = 'record_review_reference' then v_review else review_reference end,
    decision_reference = case when p_action = 'record_decision_reference' then v_review else decision_reference end,
    reviewed_by = v_uid, updated_at = now()
  where id = p_portfolio_id;
  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, detail, payload, actor_id)
  values (v_evt, p_portfolio_id, left(p_reason, 200) || v_note, v_review, v_uid);
  return jsonb_build_object('ok', true, 'id', p_portfolio_id, 'review_action', p_action, 'review_is_not_approval', true, 'decision_reference_is_not_capital_allocation', true, 'investment_approved', false, 'capital_allocated', false, 'budget_changed', false, 'strategy_changed', false, 'initiative_terminated', false, 'accounting_applied', false, 'production_applied', false, 'human_decision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Portfolio 이벤트 기록(통합) — 자동 승인 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_portfolio_event_record(p_kind text, p_reason text, p_payload jsonb, p_portfolio_id uuid default null, p_scenario_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('capital_allocation_candidate_recorded','portfolio_balance_reviewed','diversification_reviewed','concentration_risk_reviewed','roi_mix_reviewed','value_mix_reviewed','risk_return_reviewed','portfolio_tradeoff_reviewed','scenario_comparison_recorded','opportunity_cost_reviewed','capacity_fit_reviewed','portfolio_optimization_reviewed','executive_portfolio_scorecard_recorded','executive_portfolio_summary_recorded','portfolio_recommendation_recorded','initiative_reference_linked','business_value_reference_linked','kpi_reference_linked','program_reference_linked','resource_reference_linked','portfolio_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_portfolio_id is not null and not exists (select 1 from public.ai_enterprise_investment_portfolios where id = p_portfolio_id) then raise exception 'Investment Portfolio 없음(실존 검증 실패)'; end if;
  if p_scenario_id is not null and not exists (select 1 from public.ai_enterprise_portfolio_scenarios where id = p_scenario_id) then raise exception 'Portfolio Scenario 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'capital_allocation_candidate_recorded' then
    if v_result not in ('recommended_candidate','acceptable_candidate','high_risk_candidate','insufficient_data') then raise exception '허용되지 않는 allocation result'; end if;
    -- Allocation Candidate ≠ Capital Allocation — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Capital Allocation Candidate 기록 금지';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set allocation_status = v_result, updated_at = now() where id = p_portfolio_id; end if;
    if p_scenario_id is not null then update public.ai_enterprise_portfolio_scenarios set allocation_result = p_payload, updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'portfolio_balance_reviewed' then
    if v_result not in ('well_balanced_candidate','moderately_balanced_candidate','imbalanced_candidate','severely_imbalanced_candidate','balance_unverified','insufficient_data') then raise exception '허용되지 않는 balance result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set balance_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'diversification_reviewed' then
    if v_result not in ('highly_diversified_candidate','well_diversified_candidate','moderately_diversified_candidate','concentrated_candidate','highly_concentrated_candidate','insufficient_data') then raise exception '허용되지 않는 diversification result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set diversification_status = v_result, diversification_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'concentration_risk_reviewed' then
    if v_result not in ('no_material_concentration_candidate','moderate_concentration_candidate','high_concentration_candidate','critical_concentration_candidate','concentration_unverified','insufficient_data') then raise exception '허용되지 않는 concentration result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set concentration_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'roi_mix_reviewed' then
    if v_result not in ('high_roi_mix_candidate','balanced_roi_mix_candidate','low_roi_mix_candidate','mixed_roi_candidate','roi_mix_unverified','insufficient_data') then raise exception '허용되지 않는 roi mix result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set roi_mix_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'value_mix_reviewed' then
    if v_result not in ('strategic_value_heavy_candidate','balanced_value_mix_candidate','short_term_heavy_candidate','value_mix_unverified','insufficient_data') then raise exception '허용되지 않는 value mix result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set value_mix_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'risk_return_reviewed' then
    if v_result not in ('favorable_risk_return_candidate','balanced_risk_return_candidate','unfavorable_risk_return_candidate','high_risk_low_return_candidate','risk_return_unverified','insufficient_data') then raise exception '허용되지 않는 risk return result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set risk_return_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_tradeoff_reviewed' then
    if coalesce(p_payload->>'axis','') not in ('growth_vs_stability','short_term_roi_vs_long_term_value','innovation_vs_operational_excellence','concentration_vs_diversification','risk_vs_return','capacity_vs_ambition') then
      raise exception '허용되지 않는 tradeoff axis';
    end if;
    if v_result not in ('favorable_tradeoff_candidate','balanced_tradeoff_candidate','conflicting_tradeoff_candidate','mixed_tradeoff_candidate','tradeoff_unverified','insufficient_data') then raise exception '허용되지 않는 tradeoff result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set tradeoff_result = coalesce(tradeoff_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'axis', p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'scenario_comparison_recorded' then
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set comparison_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
    if p_scenario_id is not null then update public.ai_enterprise_portfolio_scenarios set comparison_result = p_payload, updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'opportunity_cost_reviewed' then
    if v_result not in ('low_opportunity_cost_candidate','moderate_opportunity_cost_candidate','high_opportunity_cost_candidate','asymmetric_opportunity_cost_candidate','opportunity_cost_unverified','insufficient_data') then raise exception '허용되지 않는 opportunity cost result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set opportunity_cost_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
    if p_scenario_id is not null then update public.ai_enterprise_portfolio_scenarios set opportunity_cost_candidate = p_payload, updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'capacity_fit_reviewed' then
    if v_result not in ('fits_capacity_candidate','tight_capacity_candidate','exceeds_capacity_candidate','capacity_fit_unverified','insufficient_data') then raise exception '허용되지 않는 capacity fit result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set capacity_fit_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_optimization_reviewed' then
    if v_result not in ('highly_optimized_candidate','optimized_candidate','partially_optimized_candidate','optimization_unverified','insufficient_data') then raise exception '허용되지 않는 optimization result'; end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set optimization_status = v_result, optimization_result = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'executive_portfolio_scorecard_recorded' and p_portfolio_id is not null then
    update public.ai_enterprise_investment_portfolios set scorecard_result = p_payload, updated_at = now() where id = p_portfolio_id;
  end if;
  if p_kind = 'portfolio_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_investment_portfolio','create_portfolio_scenario','record_capital_reference','record_capital_allocation_candidate','review_portfolio_balance','review_diversification','review_concentration_risk','review_roi_mix','review_value_mix','review_risk_return','review_portfolio_tradeoff','compare_scenarios','review_opportunity_cost','review_capacity_fit','review_portfolio_optimization','build_executive_portfolio_scorecard','build_executive_portfolio_summary','request_portfolio_review','request_executive_review','request_strategy_review','record_portfolio_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Portfolio Recommendation 금지';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set recommendation_candidate = p_payload, updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'initiative_reference_linked' then
    if nullif(p_payload->>'strategic_initiative_id','') is not null
       and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
      raise exception 'Strategic Initiative 없음(실존 검증 실패)';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set initiative_references = initiative_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'business_value_reference_linked' then
    if nullif(p_payload->>'business_value_id','') is not null
       and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
      raise exception 'Business Value 없음(실존 검증 실패)';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set business_value_references = business_value_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'kpi_reference_linked' then
    if nullif(p_payload->>'kpi_id','') is not null
       and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
      raise exception 'Enterprise KPI 없음(실존 검증 실패)';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set kpi_references = kpi_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'program_reference_linked' then
    if nullif(p_payload->>'execution_program_id','') is not null
       and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
      raise exception 'Execution Program 없음(실존 검증 실패)';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set program_references = program_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'resource_reference_linked' then
    if nullif(p_payload->>'resource_id','') is not null
       and not exists (select 1 from public.ai_enterprise_resource_inventory where id = (p_payload->>'resource_id')::uuid) then
      raise exception 'Resource 없음(실존 검증 실패)';
    end if;
    if p_portfolio_id is not null then update public.ai_enterprise_investment_portfolios set resource_references = resource_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id; end if;
  end if;
  if p_kind = 'portfolio_learning_reference_recorded' and p_portfolio_id is not null then
    update public.ai_enterprise_investment_portfolios set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_portfolio_id;
  end if;

  insert into public.ai_enterprise_portfolio_events (event_type, investment_portfolio_id, portfolio_scenario_id, detail, payload, actor_id)
  values (p_kind, p_portfolio_id, p_scenario_id,
    left(p_reason, 200) || case
      when p_kind = 'capital_allocation_candidate_recorded' then ' (Allocation Candidate ≠ Capital Allocation)'
      when p_kind = 'portfolio_balance_reviewed' then ' (Balance Candidate ≠ 자동 재배분 신호)'
      when p_kind = 'diversification_reviewed' then ' (Diversification Score ≠ Risk Guarantee)'
      when p_kind = 'concentration_risk_reviewed' then ' (Concentration Risk ≠ Failure Prediction)'
      when p_kind = 'roi_mix_reviewed' then ' (ROI Mix ≠ Accounting Return)'
      when p_kind = 'value_mix_reviewed' then ' (Strategic Value Mix ≠ Financial Statement)'
      when p_kind = 'risk_return_reviewed' then ' (Risk vs Return Candidate ≠ 투자 결정)'
      when p_kind = 'portfolio_tradeoff_reviewed' then ' (Trade-off Candidate ≠ 자동 우선순위 결정)'
      when p_kind = 'scenario_comparison_recorded' then ' (Scenario Comparison ≠ Future Fact)'
      when p_kind = 'opportunity_cost_reviewed' then ' (Opportunity Cost ≠ Actual Loss)'
      when p_kind = 'capacity_fit_reviewed' then ' (Capacity Fit Candidate ≠ Resource 배정)'
      when p_kind = 'portfolio_optimization_reviewed' then ' (Optimization ≠ Investment Decision)'
      when p_kind = 'executive_portfolio_scorecard_recorded' then ' (Scorecard ≠ 경영 평가 확정)'
      when p_kind = 'executive_portfolio_summary_recorded' then ' (Summary ≠ Portfolio 확정)'
      when p_kind = 'portfolio_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'initiative_reference_linked' then ' (Initiative Reference ≠ Initiative 확대/축소 결정)'
      when p_kind = 'business_value_reference_linked' then ' (Value Reference ≠ Value 확정)'
      when p_kind = 'kpi_reference_linked' then ' (KPI Reference ≠ KPI 변경)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ Program 승인)'
      when p_kind = 'resource_reference_linked' then ' (Resource Reference ≠ Resource 배정)'
      when p_kind = 'portfolio_learning_reference_recorded' then ' (Learning Reference ≠ 자동 Portfolio 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'investment_approved', false, 'capital_allocated', false, 'budget_changed', false, 'strategy_changed', false, 'initiative_terminated', false, 'accounting_applied', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_investment_portfolios_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_investment_portfolios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_investment_portfolios
  where (p_status is null or portfolio_status = p_status)
    and (p_category is null or portfolio_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_portfolio_scenarios_list(p_portfolio_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_portfolio_scenarios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_portfolio_scenarios
  where (p_portfolio_id is null or investment_portfolio_id = p_portfolio_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_portfolio_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'portfolios', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_investment_portfolios),
      'draft', (select count(*) from public.ai_enterprise_investment_portfolios where portfolio_status = 'draft'),
      'active', (select count(*) from public.ai_enterprise_investment_portfolios where portfolio_status = 'active_reference'),
      'in_review', (select count(*) from public.ai_enterprise_investment_portfolios where portfolio_status = 'review_reference'),
      'deprecated', (select count(*) from public.ai_enterprise_investment_portfolios where portfolio_status = 'deprecated_reference'),
      'with_capital_reference', (select count(*) from public.ai_enterprise_investment_portfolios where total_capital_reference is not null),
      'diversified', (select count(*) from public.ai_enterprise_investment_portfolios where diversification_status in ('highly_diversified_candidate','well_diversified_candidate')),
      'concentrated', (select count(*) from public.ai_enterprise_investment_portfolios where diversification_status in ('concentrated_candidate','highly_concentrated_candidate')),
      'high_risk_allocation', (select count(*) from public.ai_enterprise_investment_portfolios where allocation_status = 'high_risk_candidate'),
      'optimized', (select count(*) from public.ai_enterprise_investment_portfolios where optimization_status in ('highly_optimized_candidate','optimized_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_investment_portfolios where review_reference is not null),
      'decision_references', (select count(*) from public.ai_enterprise_investment_portfolios where decision_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(portfolio_category, cnt), '{}'::jsonb) from (select portfolio_category, count(*) cnt from public.ai_enterprise_investment_portfolios group by portfolio_category) t)
    ),
    'scenarios', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_portfolio_scenarios),
      'draft', (select count(*) from public.ai_enterprise_portfolio_scenarios where scenario_status = 'draft'),
      'analyzed', (select count(*) from public.ai_enterprise_portfolio_scenarios where scenario_status = 'analyzed_candidate'),
      'compared', (select count(*) from public.ai_enterprise_portfolio_scenarios where scenario_status = 'compared_candidate'),
      'preferred', (select count(*) from public.ai_enterprise_portfolio_scenarios where scenario_status = 'preferred_candidate'),
      'rejected', (select count(*) from public.ai_enterprise_portfolio_scenarios where scenario_status = 'rejected_reference')
    ),
    'portfolio_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_portfolio_events),
      'capital_references', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_capital_reference_recorded'),
      'allocation_candidates', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'capital_allocation_candidate_recorded'),
      'balance_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_balance_reviewed'),
      'diversification_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'diversification_reviewed'),
      'concentration_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'concentration_risk_reviewed'),
      'roi_mix_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'roi_mix_reviewed'),
      'value_mix_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'value_mix_reviewed'),
      'risk_return_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'risk_return_reviewed'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_tradeoff_reviewed'),
      'scenario_comparisons', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'scenario_comparison_recorded'),
      'opportunity_cost_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'opportunity_cost_reviewed'),
      'capacity_fit_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'capacity_fit_reviewed'),
      'optimization_reviews', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_optimization_reviewed'),
      'scorecards', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'executive_portfolio_scorecard_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'executive_portfolio_summary_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_recommendation_recorded'),
      'portfolio_review_requests', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'executive_review_requested'),
      'strategy_review_requests', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'strategy_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_review_reference_recorded'),
      'decision_references', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_decision_reference_recorded'),
      'initiative_links', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'initiative_reference_linked'),
      'business_value_links', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'business_value_reference_linked'),
      'kpi_links', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'kpi_reference_linked'),
      'program_links', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'program_reference_linked'),
      'resource_links', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'resource_reference_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_portfolio_events where event_type = 'portfolio_learning_reference_recorded')
    ),
    -- Portfolio 원천 실측(전부 읽기 전용):
    'portfolio_actuals', jsonb_build_object(
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'value_snapshots_0549', (select count(*) from public.ai_enterprise_value_snapshots),
      'enterprise_kpis_0548', (select count(*) from public.ai_enterprise_kpis),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'strategic_initiatives_0545', (select count(*) from public.ai_enterprise_strategic_initiatives),
      'resource_inventory_0546', (select count(*) from public.ai_enterprise_resource_inventory),
      'resource_demands_0546', (select count(*) from public.ai_enterprise_resource_demands),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments)
    ),
    'portfolio_unavailable', jsonb_build_array('capital_market_feed','treasury_system','investment_committee_system','accounting_ledger_feed','financial_planning_system','external_benchmark_feed'),   -- 원본 없음(실측)
    'portfolio_candidate_is_not_approved_portfolio', true, 'allocation_candidate_is_not_capital_allocation', true,
    'optimization_is_not_investment_decision', true, 'diversification_score_is_not_risk_guarantee', true,
    'concentration_risk_is_not_failure_prediction', true, 'opportunity_cost_is_not_actual_loss', true,
    'recommendation_is_not_decision', true, 'review_is_not_approval', true,
    'roi_mix_is_not_accounting_return', true, 'value_mix_is_not_financial_statement', true,
    'scenario_comparison_is_not_future_fact', true, 'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_investment_approval', true, 'no_auto_capital_allocation', true, 'no_auto_budget_change', true,
    'no_auto_strategy_change', true, 'no_auto_initiative_change', true, 'no_auto_accounting', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_portfolio_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_portfolio_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_portfolio_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_investment_portfolios enable row level security;
alter table public.ai_enterprise_portfolio_scenarios enable row level security;
alter table public.ai_enterprise_portfolio_events enable row level security;

comment on table public.ai_enterprise_investment_portfolios is 'AI-OPS-46 — Investment Portfolio(≠ Approved Portfolio·Category 16종·자동 집행 계열 차단·Capital Reference 출처 필수·자동 투자 승인/자본 배분 없음).';
comment on table public.ai_enterprise_portfolio_scenarios is 'AI-OPS-46 — Capital Allocation Scenario(Allocation Candidate ≠ Capital Allocation·preferred 는 Evidence 필수·Comparison ≠ Future Fact).';
comment on table public.ai_enterprise_portfolio_events is 'AI-OPS-46 — Portfolio 이벤트 32종(자동 승인 이벤트 생성 금지·Decision Reference ≠ Capital Allocation).';
