-- 0551_admin_ai_enterprise_governance_intelligence.sql
-- AI-OPS-47 — Enterprise Governance Intelligence, Strategic Decision
-- Governance & Executive Approval Center.
--
-- Enterprise Vision → Enterprise Policy → Strategic Decision Candidate →
-- Decision Context → Decision Evidence → Governance Validation → Policy
-- Compliance → Approval Workflow → Executive Approval → Decision Record →
-- Governance Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Decision Candidate ≠ Approved Decision. Review ≠ Approval.
--  * Approval Chain ≠ Final Approval — Decision 자동 승인/거절 RPC 자체가 없음.
--  * Policy Match ≠ Policy Compliance. Compliance Check ≠ Regulatory Approval.
--  * Recommendation ≠ Decision. Risk Summary ≠ Risk Elimination.
--  * Evidence Link ≠ Proven Fact. Similar Decision ≠ Same Outcome.
--  * Governance Score ≠ Executive Judgment. Forecast ≠ Future Fact.
--    Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Policy/Governance 변경·자동 Budget/Capital/Strategy/계약/Payment
--    승인·자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0512/0513/0514/0520/0545/
--    0547/0548/0549/0550 원본 무변경(참조만).
--  * ai_policy_rules 테이블은 실측 부재 — 실제 정책 원장은
--    ai_enterprise_policies(0512)/ai_constitution_rules(0496).
--  * Approval Timeline/Governance Validation/Decision Evidence 는 신규 테이블
--    대신 JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Governance Decision(≠ 승인된 의사결정).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_governance_decisions (
  id                        uuid primary key default gen_random_uuid(),
  decision_code             text not null,
  decision_name             text not null,
  governance_category       text not null check (governance_category in ('strategy','investment','budget','operations','product','security','compliance','ai','platform','infrastructure','hr','legal','partnership','incident','enterprise','custom')),
  decision_status           text not null default 'draft' check (decision_status in ('draft','under_review','awaiting_approval','approved_reference','rejected_reference','archived_reference','insufficient_data')),
  decision_summary          text,
  decision_context          jsonb,
  strategy_portfolio_id     uuid,
  investment_portfolio_id   uuid,
  execution_program_id      uuid,
  business_value_id         uuid,
  kpi_id                    uuid,
  validation_status         text not null default 'insufficient_data' check (validation_status in ('fully_validated_candidate','mostly_validated_candidate','partially_validated_candidate','validation_incomplete','insufficient_data')),
  risk_status               text not null default 'insufficient_data' check (risk_status in ('low_risk_candidate','moderate_risk_candidate','elevated_risk_candidate','high_risk_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence_summary          jsonb,
  policy_references         jsonb not null default '[]'::jsonb,
  related_decision_references jsonb not null default '[]'::jsonb,
  policy_mapping_result     jsonb,
  compliance_result         jsonb,
  validation_result         jsonb,
  risk_result               jsonb,
  timeline_result           jsonb,
  comparison_result         jsonb,
  executive_brief           jsonb,
  scorecard_result          jsonb,
  recommendation_candidate  jsonb,
  governance_reviews        jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  approval_reference        jsonb,
  rejection_reference       jsonb,
  decision_record           jsonb,
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
create unique index if not exists uq_aegd_idem on public.ai_enterprise_governance_decisions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aegd_status on public.ai_enterprise_governance_decisions (decision_status, governance_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Approval Workflow(§6 구성 — Chain ≠ Final Approval).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_approval_workflows (
  id                        uuid primary key default gen_random_uuid(),
  workflow_code             text not null,
  governance_decision_id    uuid not null,
  workflow_status           text not null default 'insufficient_data' check (workflow_status in ('approval_ready_candidate','additional_review_required','policy_conflict_detected','evidence_missing','insufficient_data')),
  initiator_reference       text,
  reviewer_references       jsonb not null default '[]'::jsonb,
  executive_approver_references jsonb not null default '[]'::jsonb,
  final_decision_owner_reference text,
  review_history            jsonb not null default '[]'::jsonb,
  approval_timeline         jsonb not null default '[]'::jsonb,
  chain_result              jsonb,
  notes                     text,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aeaw_idem on public.ai_enterprise_approval_workflows (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeaw_dec on public.ai_enterprise_approval_workflows (governance_decision_id, workflow_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Governance 이벤트(32종) — Context/Evidence/Policy Mapping/Validation/
--    Compliance/Risk/Approval Chain/Timeline/Comparison/Brief/Scorecard/
--    Recommendation/Review/Approval Reference/Record/Link/Learning 통합
--    Audit(자동 승인 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_governance_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('governance_decision_created','governance_decision_reviewed','decision_context_recorded','decision_evidence_recorded','evidence_summary_recorded','related_decision_search_recorded','policy_mapping_reviewed','governance_validation_reviewed','compliance_check_reviewed','decision_risk_reviewed','approval_workflow_created','approval_workflow_reviewed','approval_chain_reviewed','decision_timeline_recorded','decision_comparison_recorded','executive_brief_recorded','executive_governance_scorecard_recorded','governance_recommendation_recorded','governance_review_requested','executive_review_requested','compliance_review_requested','governance_review_reference_recorded','executive_approval_reference_recorded','decision_rejection_reference_recorded','decision_record_recorded','decision_revision_requested','policy_reference_linked','portfolio_reference_linked','program_reference_linked','value_reference_linked','decision_outcome_linked','governance_learning_reference_recorded')),
  governance_decision_id    uuid,
  approval_workflow_id      uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aege_evt on public.ai_enterprise_governance_events (event_type, created_at desc);
create index if not exists idx_aege_dec on public.ai_enterprise_governance_events (governance_decision_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Governance Decision 생성 — 자동 승인 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_governance_decision_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_governance_decisions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'governance_category','');
  -- 자동 승인/개인 평가 계열 — 구조적 차단(Decision Candidate ≠ Approved Decision).
  if v_cat in ('automatic_approval','automatic_rejection','automatic_policy_change','automatic_budget_approval','automatic_contract_approval','automatic_payment_approval','personal_performance_decision','credit_decision','medical_decision') then
    raise exception '금지된 governance_category(자동 승인/개인 평가 계열 비활성)';
  end if;
  if v_cat not in ('strategy','investment','budget','operations','product','security','compliance','ai','platform','infrastructure','hr','legal','partnership','incident','enterprise','custom') then
    raise exception '허용되지 않는 governance_category';
  end if;
  if coalesce(btrim(p_payload->>'decision_name'),'') = '' then raise exception 'decision_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'investment_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_investment_portfolios where id = (p_payload->>'investment_portfolio_id')::uuid) then
    raise exception 'Investment Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'kpi_id','') is not null
     and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
    raise exception 'Enterprise KPI 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_governance_decisions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'candidate_is_not_approved_decision', true); end if;
  end if;
  insert into public.ai_enterprise_governance_decisions (decision_code, decision_name, governance_category, decision_summary, decision_context, strategy_portfolio_id, investment_portfolio_id, execution_program_id, business_value_id, kpi_id, policy_references, related_decision_references, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'decision_code',''), 'EGD-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'decision_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'decision_summary',''), 2000),''),
    p_payload->'decision_context',
    nullif(p_payload->>'strategy_portfolio_id','')::uuid, nullif(p_payload->>'investment_portfolio_id','')::uuid,
    nullif(p_payload->>'execution_program_id','')::uuid, nullif(p_payload->>'business_value_id','')::uuid,
    nullif(p_payload->>'kpi_id','')::uuid,
    coalesce(p_payload->'policy_references', '[]'::jsonb), coalesce(p_payload->'related_decision_references', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, detail, payload, actor_id)
  values ('governance_decision_created', v_id, left(v_cat, 80) || ' (Decision Candidate ≠ Approved Decision — draft·자동 승인 없음)', jsonb_build_object('decision_name', p_payload->>'decision_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'candidate_is_not_approved_decision', true, 'decision_auto_approved', false, 'policy_changed', false, 'budget_approved', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Decision 검토/승인 Reference — Self-Approval 차단·종결 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_governance_decision_review(p_decision_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_governance_decisions; v_next text := null; v_evt text := 'governance_decision_reviewed'; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','mark_awaiting_approval','record_approval_reference','record_rejection_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_governance_decisions where id = p_decision_id;
  if v_row.id is null then raise exception 'Governance Decision 없음(실존 검증 실패)'; end if;
  if v_row.decision_status in ('approved_reference','rejected_reference','archived_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.decision_status;
  end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'decision_auto_approved', false, 'decision_auto_rejected', false,
    'policy_changed', false, 'budget_approved', false, 'capital_allocated', false,
    'contract_approved', false, 'payment_approved', false, 'production_applied', false);

  if p_action = 'start_review' then v_next := 'under_review';
  elsif p_action = 'mark_awaiting_approval' then
    -- 근거 없는 승인 대기 진입 차단(Evidence 필수).
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 awaiting_approval 진입 금지';
    end if;
    v_next := 'awaiting_approval'; v_note := ' (Awaiting Approval ≠ 승인)';
  elsif p_action = 'record_approval_reference' then
    -- Self-Approval 차단 + Evidence 필수(Executive Approval — 사람의 승인 기록).
    if v_row.created_by = v_uid then raise exception 'Self-Approval 차단(작성자 ≠ 승인자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Executive Approval Reference 금지';
    end if;
    v_next := 'approved_reference'; v_evt := 'executive_approval_reference_recorded';
    v_note := ' (Approval Reference — 사람의 승인 기록·자동 집행 없음)';
    update public.ai_enterprise_governance_decisions set
      approval_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence'),
      decision_record = v_ref || jsonb_build_object('record_type', 'approved_reference', 'evidence', p_payload->'evidence')
    where id = p_decision_id;
  elsif p_action = 'record_rejection_reference' then
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 결정자)'; end if;
    v_next := 'rejected_reference'; v_evt := 'decision_rejection_reference_recorded';
    update public.ai_enterprise_governance_decisions set
      rejection_reference = v_ref,
      decision_record = v_ref || jsonb_build_object('record_type', 'rejected_reference')
    where id = p_decision_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_governance_decisions set decision_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_decision_id;
  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, detail, payload, actor_id)
  values (v_evt, p_decision_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_decision_id, 'status', v_next, 'candidate_is_not_approved_decision', v_next <> 'approved_reference', 'human_approval_recorded', v_next = 'approved_reference', 'decision_auto_approved', false, 'policy_changed', false, 'budget_approved', false, 'capital_allocated', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Approval Workflow 생성/검토(§6 — Chain ≠ Final Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_approval_workflow_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_dec public.ai_enterprise_governance_decisions; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_approval_workflows;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if nullif(p_payload->>'governance_decision_id','') is null then raise exception 'governance_decision_id 필수'; end if;
  select * into v_dec from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid;
  if v_dec.id is null then raise exception 'Governance Decision 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_approval_workflows where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'chain_is_not_final_approval', true); end if;
  end if;
  insert into public.ai_enterprise_approval_workflows (workflow_code, governance_decision_id, initiator_reference, reviewer_references, executive_approver_references, final_decision_owner_reference, approval_timeline, notes, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'workflow_code',''), 'EAW-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_dec.id,
    nullif(left(coalesce(p_payload->>'initiator_reference',''), 120),''),
    coalesce(p_payload->'reviewer_references', '[]'::jsonb),
    coalesce(p_payload->'executive_approver_references', '[]'::jsonb),
    nullif(left(coalesce(p_payload->>'final_decision_owner_reference',''), 120),''),
    coalesce(p_payload->'approval_timeline', '[]'::jsonb),
    nullif(left(coalesce(p_payload->>'notes',''), 500),''),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, approval_workflow_id, detail, payload, actor_id)
  values ('approval_workflow_created', v_dec.id, v_id, 'Approval Workflow (Chain ≠ Final Approval — 최종 승인은 사람)', jsonb_build_object('workflow_code', p_payload->>'workflow_code'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'insufficient_data', 'chain_is_not_final_approval', true, 'decision_auto_approved', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_approval_workflow_review(p_workflow_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_approval_workflows; v_next text; v_note text := ''; v_entry jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_approval_ready','mark_additional_review','mark_policy_conflict','mark_evidence_missing','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_approval_workflows where id = p_workflow_id;
  if v_row.id is null then raise exception 'Approval Workflow 없음(실존 검증 실패)'; end if;

  if p_action = 'mark_approval_ready' then
    -- Evidence 없는 approval_ready 표시 차단(Ready ≠ 승인).
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 approval_ready 표시 금지(Ready ≠ 승인)';
    end if;
    v_next := 'approval_ready_candidate'; v_note := ' (Approval Ready Candidate ≠ Final Approval)';
  elsif p_action = 'mark_additional_review' then v_next := 'additional_review_required';
  elsif p_action = 'mark_policy_conflict' then v_next := 'policy_conflict_detected'; v_note := ' (Policy Conflict Candidate — 해석/해소는 사람)';
  elsif p_action = 'mark_evidence_missing' then v_next := 'evidence_missing';
  else v_next := 'insufficient_data';
  end if;

  v_entry := jsonb_build_object('action', p_action, 'reason', left(p_reason, 300), 'reviewed_by', v_uid, 'reviewed_at', now(), 'next_status', v_next);
  update public.ai_enterprise_approval_workflows set
    workflow_status = v_next,
    review_history = review_history || jsonb_build_array(v_entry),
    approval_timeline = approval_timeline || jsonb_build_array(v_entry),
    reviewed_by = v_uid, updated_at = now()
  where id = p_workflow_id;
  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, approval_workflow_id, detail, payload, actor_id)
  values ('approval_workflow_reviewed', v_row.governance_decision_id, p_workflow_id, left(p_reason, 200) || v_note, v_entry, v_uid);
  return jsonb_build_object('ok', true, 'id', p_workflow_id, 'status', v_next, 'chain_is_not_final_approval', true, 'decision_auto_approved', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Governance Review — 요청/Reference 기록만. Self-Review 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_governance_review(p_decision_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_governance_decisions; v_evt text; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_governance_review','request_executive_review','request_compliance_review','record_review_reference','request_revision') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_governance_decisions where id = p_decision_id;
  if v_row.id is null then raise exception 'Governance Decision 없음(실존 검증 실패)'; end if;

  if p_action = 'record_review_reference' then
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Governance Review Reference 금지';
    end if;
    v_evt := 'governance_review_reference_recorded';
    v_note := ' (Review Reference ≠ Approval — 최종 승인은 사람)';
  elsif p_action = 'request_governance_review' then v_evt := 'governance_review_requested'; v_note := ' (Governance Review 요청 — 최종 결정은 사람)';
  elsif p_action = 'request_executive_review' then v_evt := 'executive_review_requested'; v_note := ' (Executive Review 요청 ≠ Approval)';
  elsif p_action = 'request_compliance_review' then v_evt := 'compliance_review_requested'; v_note := ' (Compliance Review 요청 ≠ Regulatory Approval)';
  else v_evt := 'decision_revision_requested';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'decision_auto_approved', false, 'policy_changed', false, 'budget_approved', false, 'production_applied', false);
  update public.ai_enterprise_governance_decisions set
    governance_reviews = governance_reviews || jsonb_build_array(v_review),
    review_reference = case when p_action = 'record_review_reference' then v_review else review_reference end,
    reviewed_by = v_uid, updated_at = now()
  where id = p_decision_id;
  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, detail, payload, actor_id)
  values (v_evt, p_decision_id, left(p_reason, 200) || v_note, v_review, v_uid);
  return jsonb_build_object('ok', true, 'id', p_decision_id, 'review_action', p_action, 'review_is_not_approval', true, 'decision_auto_approved', false, 'policy_changed', false, 'budget_approved', false, 'production_applied', false, 'human_decision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Governance 이벤트 기록(통합) — 자동 승인 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_governance_event_record(p_kind text, p_reason text, p_payload jsonb, p_decision_id uuid default null, p_workflow_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('decision_context_recorded','decision_evidence_recorded','evidence_summary_recorded','related_decision_search_recorded','policy_mapping_reviewed','governance_validation_reviewed','compliance_check_reviewed','decision_risk_reviewed','approval_chain_reviewed','decision_timeline_recorded','decision_comparison_recorded','executive_brief_recorded','executive_governance_scorecard_recorded','governance_recommendation_recorded','policy_reference_linked','portfolio_reference_linked','program_reference_linked','value_reference_linked','decision_outcome_linked','governance_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_decision_id is not null and not exists (select 1 from public.ai_enterprise_governance_decisions where id = p_decision_id) then raise exception 'Governance Decision 없음(실존 검증 실패)'; end if;
  if p_workflow_id is not null and not exists (select 1 from public.ai_enterprise_approval_workflows where id = p_workflow_id) then raise exception 'Approval Workflow 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'decision_context_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set decision_context = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'decision_evidence_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set evidence = evidence || jsonb_build_array(p_payload), updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'evidence_summary_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set evidence_summary = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'related_decision_search_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set related_decision_references = related_decision_references || jsonb_build_array(p_payload), updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'policy_mapping_reviewed' then
    if v_result not in ('aligned_candidate','partial_match_candidate','policy_conflict_candidate','no_applicable_policy_candidate','policy_match_unverified','insufficient_data') then raise exception '허용되지 않는 policy mapping result'; end if;
    if nullif(p_payload->>'policy_id','') is not null
       and not exists (select 1 from public.ai_enterprise_policies where id = (p_payload->>'policy_id')::uuid) then
      raise exception 'Enterprise Policy 없음(실존 검증 실패)';
    end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set policy_mapping_result = p_payload, updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'governance_validation_reviewed' then
    if v_result not in ('fully_validated_candidate','mostly_validated_candidate','partially_validated_candidate','validation_incomplete','insufficient_data') then raise exception '허용되지 않는 validation result'; end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set validation_status = v_result, validation_result = p_payload, updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'compliance_check_reviewed' then
    if v_result not in ('compliant_candidate','partially_compliant_candidate','non_compliant_candidate','compliance_unverified','insufficient_data') then raise exception '허용되지 않는 compliance result'; end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set compliance_result = p_payload, updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'decision_risk_reviewed' then
    if coalesce(p_payload->>'risk_dimension','') not in ('strategic_risk','financial_risk','operational_risk','technical_risk','security_risk','compliance_risk','reputational_risk') then
      raise exception '허용되지 않는 risk_dimension';
    end if;
    if v_result not in ('low_risk_candidate','moderate_risk_candidate','elevated_risk_candidate','high_risk_candidate','insufficient_data') then raise exception '허용되지 않는 risk result'; end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set risk_status = v_result, risk_result = coalesce(risk_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'risk_dimension', p_payload), updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'approval_chain_reviewed' then
    if v_result not in ('chain_complete_candidate','chain_incomplete_candidate','approver_missing_candidate','chain_unverified','insufficient_data') then raise exception '허용되지 않는 chain result'; end if;
    if p_workflow_id is not null then update public.ai_enterprise_approval_workflows set chain_result = p_payload, updated_at = now() where id = p_workflow_id; end if;
  end if;
  if p_kind = 'decision_timeline_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set timeline_result = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'decision_comparison_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set comparison_result = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'executive_brief_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set executive_brief = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'executive_governance_scorecard_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set scorecard_result = p_payload, updated_at = now() where id = p_decision_id;
  end if;
  if p_kind = 'governance_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_governance_decision','record_decision_context','record_decision_evidence','summarize_evidence','search_related_decisions','review_policy_mapping','review_governance_validation','review_compliance_check','review_decision_risk','create_approval_workflow','review_approval_chain','record_decision_timeline','compare_decisions','build_executive_brief','build_executive_governance_scorecard','request_governance_review','request_executive_review','request_compliance_review','record_governance_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Governance Recommendation 금지';
    end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set recommendation_candidate = p_payload, updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'policy_reference_linked' then
    if nullif(p_payload->>'policy_id','') is not null
       and not exists (select 1 from public.ai_enterprise_policies where id = (p_payload->>'policy_id')::uuid) then
      raise exception 'Enterprise Policy 없음(실존 검증 실패)';
    end if;
    if p_decision_id is not null then update public.ai_enterprise_governance_decisions set policy_references = policy_references || jsonb_build_array(p_payload), updated_at = now() where id = p_decision_id; end if;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'investment_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_investment_portfolios where id = (p_payload->>'investment_portfolio_id')::uuid) then
    raise exception 'Investment Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if p_kind = 'decision_outcome_linked' and nullif(p_payload->>'decision_outcome_id','') is not null
     and not exists (select 1 from public.ai_decision_outcomes where id = (p_payload->>'decision_outcome_id')::uuid) then
    raise exception 'Decision Outcome 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_learning_reference_recorded' and p_decision_id is not null then
    update public.ai_enterprise_governance_decisions set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_decision_id;
  end if;

  insert into public.ai_enterprise_governance_events (event_type, governance_decision_id, approval_workflow_id, detail, payload, actor_id)
  values (p_kind, p_decision_id, p_workflow_id,
    left(p_reason, 200) || case
      when p_kind = 'decision_context_recorded' then ' (Context Candidate ≠ 결정 확정)'
      when p_kind = 'decision_evidence_recorded' then ' (Evidence Link ≠ Proven Fact)'
      when p_kind = 'evidence_summary_recorded' then ' (Summary ≠ 근거 충분성 확정)'
      when p_kind = 'related_decision_search_recorded' then ' (Similar Decision ≠ Same Outcome)'
      when p_kind = 'policy_mapping_reviewed' then ' (Policy Match ≠ Policy Compliance)'
      when p_kind = 'governance_validation_reviewed' then ' (Validation Candidate ≠ Approval)'
      when p_kind = 'compliance_check_reviewed' then ' (Compliance Check ≠ Regulatory Approval)'
      when p_kind = 'decision_risk_reviewed' then ' (Risk Summary ≠ Risk Elimination)'
      when p_kind = 'approval_chain_reviewed' then ' (Approval Chain ≠ Final Approval)'
      when p_kind = 'decision_timeline_recorded' then ' (Timeline ≠ 승인 일정 확정)'
      when p_kind = 'decision_comparison_recorded' then ' (Comparison ≠ 자동 선택)'
      when p_kind = 'executive_brief_recorded' then ' (Brief ≠ 결정 — 자동 발송 없음)'
      when p_kind = 'executive_governance_scorecard_recorded' then ' (Governance Score ≠ Executive Judgment)'
      when p_kind = 'governance_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'policy_reference_linked' then ' (Policy Reference ≠ 준수 확정)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ 투자 승인)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 승인)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 가치 확정)'
      when p_kind = 'decision_outcome_linked' then ' (Outcome Link ≠ Proven Causality)'
      when p_kind = 'governance_learning_reference_recorded' then ' (Learning Reference ≠ 자동 Governance 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'decision_auto_approved', false, 'decision_auto_rejected', false, 'policy_changed', false, 'budget_approved', false, 'capital_allocated', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_governance_decisions_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_governance_decisions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_governance_decisions
  where (p_status is null or decision_status = p_status)
    and (p_category is null or governance_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_approval_workflows_list(p_decision_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_approval_workflows language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_approval_workflows
  where (p_decision_id is null or governance_decision_id = p_decision_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_governance_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'decisions', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_governance_decisions),
      'draft', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'draft'),
      'under_review', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'under_review'),
      'awaiting_approval', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'awaiting_approval'),
      'approved', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'approved_reference'),
      'rejected', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'rejected_reference'),
      'archived', (select count(*) from public.ai_enterprise_governance_decisions where decision_status = 'archived_reference'),
      'fully_validated', (select count(*) from public.ai_enterprise_governance_decisions where validation_status = 'fully_validated_candidate'),
      'validation_incomplete', (select count(*) from public.ai_enterprise_governance_decisions where validation_status = 'validation_incomplete'),
      'high_risk', (select count(*) from public.ai_enterprise_governance_decisions where risk_status in ('elevated_risk_candidate','high_risk_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_governance_decisions where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(governance_category, cnt), '{}'::jsonb) from (select governance_category, count(*) cnt from public.ai_enterprise_governance_decisions group by governance_category) t)
    ),
    'workflows', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_approval_workflows),
      'approval_ready', (select count(*) from public.ai_enterprise_approval_workflows where workflow_status = 'approval_ready_candidate'),
      'additional_review', (select count(*) from public.ai_enterprise_approval_workflows where workflow_status = 'additional_review_required'),
      'policy_conflict', (select count(*) from public.ai_enterprise_approval_workflows where workflow_status = 'policy_conflict_detected'),
      'evidence_missing', (select count(*) from public.ai_enterprise_approval_workflows where workflow_status = 'evidence_missing')
    ),
    'governance_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_governance_events),
      'contexts', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_context_recorded'),
      'evidence_records', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_evidence_recorded'),
      'evidence_summaries', (select count(*) from public.ai_enterprise_governance_events where event_type = 'evidence_summary_recorded'),
      'related_searches', (select count(*) from public.ai_enterprise_governance_events where event_type = 'related_decision_search_recorded'),
      'policy_mappings', (select count(*) from public.ai_enterprise_governance_events where event_type = 'policy_mapping_reviewed'),
      'validations', (select count(*) from public.ai_enterprise_governance_events where event_type = 'governance_validation_reviewed'),
      'compliance_checks', (select count(*) from public.ai_enterprise_governance_events where event_type = 'compliance_check_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_risk_reviewed'),
      'chain_reviews', (select count(*) from public.ai_enterprise_governance_events where event_type = 'approval_chain_reviewed'),
      'timelines', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_timeline_recorded'),
      'comparisons', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_comparison_recorded'),
      'briefs', (select count(*) from public.ai_enterprise_governance_events where event_type = 'executive_brief_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_governance_events where event_type = 'executive_governance_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_governance_events where event_type = 'governance_recommendation_recorded'),
      'governance_review_requests', (select count(*) from public.ai_enterprise_governance_events where event_type = 'governance_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_governance_events where event_type = 'executive_review_requested'),
      'compliance_review_requests', (select count(*) from public.ai_enterprise_governance_events where event_type = 'compliance_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_governance_events where event_type = 'governance_review_reference_recorded'),
      'approval_references', (select count(*) from public.ai_enterprise_governance_events where event_type = 'executive_approval_reference_recorded'),
      'rejection_references', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_rejection_reference_recorded'),
      'policy_links', (select count(*) from public.ai_enterprise_governance_events where event_type = 'policy_reference_linked'),
      'portfolio_links', (select count(*) from public.ai_enterprise_governance_events where event_type = 'portfolio_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_governance_events where event_type = 'decision_outcome_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_governance_events where event_type = 'governance_learning_reference_recorded')
    ),
    -- Governance 원천 실측(전부 읽기 전용):
    'governance_actuals', jsonb_build_object(
      'investment_portfolios_0550', (select count(*) from public.ai_enterprise_investment_portfolios),
      'portfolio_scenarios_0550', (select count(*) from public.ai_enterprise_portfolio_scenarios),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'enterprise_kpis_0548', (select count(*) from public.ai_enterprise_kpis),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'governance_unavailable', jsonb_build_array('ai_policy_rules_table','legal_review_system','regulatory_filing_feed','board_meeting_system','contract_management_system','external_audit_feed'),   -- 원본 없음(실측 — 정책 원장은 ai_enterprise_policies/ai_constitution_rules)
    'candidate_is_not_approved_decision', true, 'review_is_not_approval', true,
    'approval_chain_is_not_final_approval', true, 'policy_match_is_not_compliance', true,
    'compliance_check_is_not_regulatory_approval', true, 'recommendation_is_not_decision', true,
    'risk_summary_is_not_risk_elimination', true, 'evidence_link_is_not_proven_fact', true,
    'similar_decision_is_not_same_outcome', true, 'governance_score_is_not_executive_judgment', true,
    'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_decision_approval', true, 'no_auto_decision_rejection', true, 'no_auto_policy_change', true,
    'no_auto_budget_approval', true, 'no_auto_capital_allocation', true, 'no_auto_contract_approval', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_governance_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_governance_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_governance_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_governance_decisions enable row level security;
alter table public.ai_enterprise_approval_workflows enable row level security;
alter table public.ai_enterprise_governance_events enable row level security;

comment on table public.ai_enterprise_governance_decisions is 'AI-OPS-47 — Governance Decision(≠ Approved Decision·Category 16종·자동 승인 계열 차단·Approval Reference 는 Self-Approval 차단+Evidence 필수·종결 재결정 차단).';
comment on table public.ai_enterprise_approval_workflows is 'AI-OPS-47 — Approval Workflow(§6 구성·Chain ≠ Final Approval·approval_ready 는 Evidence 필수).';
comment on table public.ai_enterprise_governance_events is 'AI-OPS-47 — Governance 이벤트 32종(자동 승인 이벤트 생성 금지·Governance Score ≠ Executive Judgment).';
