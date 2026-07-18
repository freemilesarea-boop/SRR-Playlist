-- 0559_admin_ai_enterprise_value_optimization_intelligence.sql
-- AI-OPS-55 — Enterprise Value Optimization Intelligence, Benefit
-- Realization & ROI Governance Center.
--
-- Enterprise Vision → Mission → Strategy → Execution → Resource
-- Intelligence → Business Outcome → Benefit Realization → ROI Analysis →
-- Value Leakage Detection → Optimization Opportunity → Executive Value
-- Review → Value Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * ROI ≠ Business Success — 투자 자동 승인/자동 취소/Budget 자동 변경/
--    Portfolio 자동 변경/KPI 자동 변경/Strategy 자동 변경/Project 자동 종료
--    RPC 자체가 없음.
--  * Benefit ≠ Profit. Value ≠ Revenue. Correlation ≠ Causation.
--    Optimization ≠ Automatic Improvement. Recommendation ≠ Decision.
--  * Forecast ≠ Future Fact. Pattern ≠ Causality. Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0514/0520/0545/0547/0548/0549/
--    0551/0555/0557/0558 원본 무변경(참조만).
--  * 이름 충돌 실측: 0549(AI-OPS-45)가 ai_enterprise_value_events ·
--    admin_enterprise_value_* 를 이미 사용 → 본 계층은
--    ai_enterprise_value_realizations / ai_enterprise_value_optimization_* /
--    admin_enterprise_value_realization_* / admin_enterprise_value_optimization_*
--    로 명명(별개 계층·원본 무변경).
--  * 회계 원장/ERP 재무 원장/빌링/CRM 매출/원가 회계/시장 벤치마크 피드는
--    실측 부재 — insufficient_data 로 유지(분석은 수동 기록 기반).
--  * ROI Timeline/Benefit·Value·Leakage·Optimization History 는 신규 테이블
--    대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Value Realization(≠ 회계 원장 — Benefit/ROI 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_value_realizations (
  id                              uuid primary key default gen_random_uuid(),
  realization_code                text not null,
  realization_name                text not null,
  value_category                  text not null check (value_category in ('financial','operational','strategic','customer','market','product','portfolio','investment','executive','enterprise','custom')),
  realization_status              text not null default 'observed' check (realization_status in ('observed','candidate','review_reference','archived_reference','insufficient_data')),
  realization_summary             text,
  roi_status                      text not null default 'insufficient_data' check (roi_status in ('exceptional_roi_candidate','strong_roi_candidate','acceptable_roi_candidate','weak_roi_candidate','insufficient_data')),
  benefit_status                  text not null default 'insufficient_data' check (benefit_status in ('fully_realized_candidate','mostly_realized_candidate','partially_realized_candidate','unrealized_candidate','insufficient_data')),
  leakage_status                  text not null default 'insufficient_data' check (leakage_status in ('critical_leakage_candidate','elevated_leakage_candidate','manageable_leakage_candidate','negligible_leakage_candidate','insufficient_data')),
  confidence                      int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  business_value_id               uuid,
  strategy_portfolio_id           uuid,
  execution_program_id            uuid,
  decision_scenario_id            uuid,
  outcome_result                  jsonb,
  roi_result                      jsonb,
  benefit_result                  jsonb,
  cost_benefit_result             jsonb,
  leakage_result                  jsonb,
  investment_effectiveness_result jsonb,
  kpi_contribution_result         jsonb,
  portfolio_value_result          jsonb,
  optimization_opportunities      jsonb not null default '[]'::jsonb,
  scorecard_result                jsonb,
  value_history                   jsonb not null default '[]'::jsonb,   -- ROI Timeline/Benefit·Value·Leakage·Optimization History 통합 append
  recommendation_candidate        jsonb,
  realization_reviews             jsonb not null default '[]'::jsonb,
  review_reference                jsonb,
  learning_references             jsonb not null default '[]'::jsonb,
  assumptions                     jsonb not null default '[]'::jsonb,
  unknown_factors                 jsonb not null default '[]'::jsonb,
  external_factors                jsonb not null default '[]'::jsonb,
  evidence                        jsonb not null default '[]'::jsonb,
  limitations                     jsonb not null default '[]'::jsonb,
  idempotency_key                 text,
  created_by                      uuid,
  reviewed_by                     uuid,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);
create unique index if not exists uq_aevr_idem on public.ai_enterprise_value_realizations (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aevr_status on public.ai_enterprise_value_realizations (realization_status, value_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Value Optimization Review(§9 — 요청/Reference 기록만, 투자/전략 변경은
--    사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_value_optimization_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  value_realization_id      uuid not null,
  review_type               text not null check (review_type in ('value_review','executive_review','human_review')),
  review_status             text not null default 'requested' check (review_status in ('requested','in_review','review_reference_recorded','revision_requested','insufficient_data')),
  review_summary            text,
  findings                  jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aevo_idem on public.ai_enterprise_value_optimization_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aevo_real on public.ai_enterprise_value_optimization_reviews (value_realization_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Value Optimization 이벤트(31종) — Outcome/ROI/Benefit/Cost-Benefit/
--    Leakage/Investment Effectiveness/KPI Contribution/Portfolio Value/
--    Timeline/Opportunity/Scorecard/Recommendation/Review/Learning/Link 통합
--    Audit(자동 투자 승인 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_value_optimization_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('value_realization_created','value_realization_reviewed','business_outcome_reviewed','roi_assessment_reviewed','benefit_realization_reviewed','cost_benefit_reviewed','value_leakage_reviewed','investment_effectiveness_reviewed','kpi_contribution_reviewed','portfolio_value_reviewed','roi_timeline_recorded','optimization_opportunity_recorded','executive_value_summary_recorded','executive_value_scorecard_recorded','value_recommendation_recorded','value_optimization_review_created','value_optimization_review_reviewed','value_review_requested','executive_review_requested','human_review_requested','value_review_reference_recorded','value_revision_requested','value_learning_recorded','business_value_reference_linked','portfolio_reference_linked','program_reference_linked','scenario_reference_linked','mission_reference_linked','kpi_reference_linked','capacity_reference_linked','commitment_reference_linked')),
  value_realization_id      uuid,
  value_review_id           uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aevoe_evt on public.ai_enterprise_value_optimization_events (event_type, created_at desc);
create index if not exists idx_aevoe_real on public.ai_enterprise_value_optimization_events (value_realization_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Value Realization 생성 — 자동 투자 승인 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_realization_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_value_realizations;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'value_category','');
  -- 자동 투자 승인/취소/Budget·Portfolio·KPI·Strategy 변경/Project 종료 계열 — 구조적 차단.
  if v_cat in ('automatic_investment_approval','automatic_investment_cancellation','automatic_budget_change','automatic_portfolio_change','automatic_kpi_change','automatic_strategy_change','automatic_project_termination') then
    raise exception '금지된 value_category(자동 투자 승인 계열 비활성)';
  end if;
  if v_cat not in ('financial','operational','strategic','customer','market','product','portfolio','investment','executive','enterprise','custom') then
    raise exception '허용되지 않는 value_category';
  end if;
  if coalesce(btrim(p_payload->>'realization_name'),'') = '' then raise exception 'realization_name 필수'; end if;
  if nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_value_realizations where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'roi_is_not_business_success', true); end if;
  end if;
  insert into public.ai_enterprise_value_realizations (realization_code, realization_name, value_category, realization_summary, business_value_id, strategy_portfolio_id, execution_program_id, decision_scenario_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'realization_code',''), 'EVR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'realization_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'realization_summary',''), 2000),''),
    nullif(p_payload->>'business_value_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    nullif(p_payload->>'execution_program_id','')::uuid, nullif(p_payload->>'decision_scenario_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, detail, payload, actor_id)
  values ('value_realization_created', v_id, left(v_cat, 80) || ' (Value 관측 Candidate — 자동 투자 승인 없음)', jsonb_build_object('realization_name', p_payload->>'realization_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'observed', 'roi_is_not_business_success', true, 'investment_approved', false, 'investment_cancelled', false, 'budget_changed', false, 'portfolio_changed', false, 'kpi_changed', false, 'strategy_changed', false, 'project_terminated', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Value Realization 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_realization_review(p_realization_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_value_realizations; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'value_realization_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_observed','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_value_realizations where id = p_realization_id;
  if v_row.id is null then raise exception 'Value Realization 없음(실존 검증 실패)'; end if;
  if v_row.realization_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_observed' then v_next := 'observed'; v_note := ' (관측 상태 표시 ≠ 투자 결정)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 투자/전략 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Value Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 투자/전략 변경은 사람)'; v_evt := 'value_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'investment_approved', false, 'budget_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_value_realizations set review_reference = v_ref, realization_reviews = realization_reviews || jsonb_build_array(v_ref) where id = p_realization_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_value_realizations set realization_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_realization_id;
  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, detail, payload, actor_id)
  values (v_evt, p_realization_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_realization_id, 'status', v_next, 'roi_is_not_business_success', true, 'investment_approved', false, 'investment_cancelled', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Value Optimization Review 생성/검토(§9 — Self-Review 차단·Review ≠
--    Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_optimization_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_real public.ai_enterprise_value_realizations; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_value_optimization_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('value_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'value_realization_id','') is null then raise exception 'value_realization_id 필수'; end if;
  select * into v_real from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid;
  if v_real.id is null then raise exception 'Value Realization 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_value_optimization_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_value_optimization_reviews (review_code, value_realization_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EVO-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_real.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'value_review' then 'value_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, value_review_id, detail, payload, actor_id)
  values (v_evt, v_real.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 투자/전략 변경은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, value_review_id, detail, payload, actor_id)
  values ('value_optimization_review_created', v_real.id, v_id, 'Value Optimization Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'investment_approved', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_value_optimization_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_value_optimization_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_value_optimization_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Value Optimization Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'investment_approved', false, 'investment_cancelled', false, 'budget_changed', false,
    'portfolio_changed', false, 'strategy_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 투자/전략 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Value Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 투자/전략 변경은 사람)';
    update public.ai_enterprise_value_optimization_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_value_realizations set
      realization_reviews = realization_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.value_realization_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_value_optimization_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, value_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'value_review_reference_recorded' when p_action = 'request_revision' then 'value_revision_requested' else 'value_optimization_review_reviewed' end,
    v_row.value_realization_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'investment_approved', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Value Optimization 이벤트 기록(통합) — 자동 투자 승인 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_optimization_event_record(p_kind text, p_reason text, p_payload jsonb, p_realization_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('business_outcome_reviewed','roi_assessment_reviewed','benefit_realization_reviewed','cost_benefit_reviewed','value_leakage_reviewed','investment_effectiveness_reviewed','kpi_contribution_reviewed','portfolio_value_reviewed','roi_timeline_recorded','optimization_opportunity_recorded','executive_value_summary_recorded','executive_value_scorecard_recorded','value_recommendation_recorded','value_review_requested','executive_review_requested','human_review_requested','value_learning_recorded','business_value_reference_linked','portfolio_reference_linked','program_reference_linked','scenario_reference_linked','mission_reference_linked','kpi_reference_linked','capacity_reference_linked','commitment_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_realization_id is not null and not exists (select 1 from public.ai_enterprise_value_realizations where id = p_realization_id) then raise exception 'Value Realization 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_value_optimization_reviews where id = p_review_id) then raise exception 'Value Optimization Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'business_outcome_reviewed' then
    if v_result not in ('fully_realized_candidate','mostly_realized_candidate','partially_realized_candidate','unrealized_candidate','insufficient_data') then raise exception '허용되지 않는 business outcome result(§6 — 5종)'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set outcome_result = p_payload, value_history = value_history || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'roi_assessment_reviewed' then
    if coalesce(p_payload->>'roi_dimension','') not in ('financial_return','operational_gain','strategic_value','resource_efficiency','sustainability') then
      raise exception '허용되지 않는 roi_dimension(§5 — 5종)';
    end if;
    if v_result not in ('exceptional_roi_candidate','strong_roi_candidate','acceptable_roi_candidate','weak_roi_candidate','insufficient_data') then raise exception '허용되지 않는 roi result(§5 — 5종)'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set roi_status = v_result, roi_result = coalesce(roi_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'roi_dimension', p_payload), value_history = value_history || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'benefit_realization_reviewed' then
    if coalesce(p_payload->>'benefit_dimension','') not in ('planned_benefit','delivered_benefit','benefit_gap','kpi_achievement','business_outcome') then
      raise exception '허용되지 않는 benefit_dimension(§6 — 5종)';
    end if;
    if v_result not in ('fully_realized_candidate','mostly_realized_candidate','partially_realized_candidate','unrealized_candidate','insufficient_data') then raise exception '허용되지 않는 benefit result(§6 — 5종)'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set benefit_status = v_result, benefit_result = coalesce(benefit_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'benefit_dimension', p_payload), value_history = value_history || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'cost_benefit_reviewed' then
    if v_result not in ('favorable_cost_benefit_candidate','balanced_cost_benefit_candidate','unfavorable_cost_benefit_candidate','cost_benefit_unverified','insufficient_data') then raise exception '허용되지 않는 cost benefit result'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set cost_benefit_result = p_payload, updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'value_leakage_reviewed' then
    if coalesce(p_payload->>'leakage_dimension','') not in ('budget_leakage','resource_leakage','time_leakage','opportunity_leakage','process_leakage') then
      raise exception '허용되지 않는 leakage_dimension(§7 — 5종)';
    end if;
    if v_result not in ('critical_leakage_candidate','elevated_leakage_candidate','manageable_leakage_candidate','negligible_leakage_candidate','insufficient_data') then raise exception '허용되지 않는 leakage result(§7 — 5종)'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set leakage_status = v_result, leakage_result = coalesce(leakage_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'leakage_dimension', p_payload), value_history = value_history || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'investment_effectiveness_reviewed' then
    if v_result not in ('highly_effective_investment_candidate','effective_investment_candidate','marginally_effective_investment_candidate','ineffective_investment_candidate','investment_effectiveness_unverified','insufficient_data') then raise exception '허용되지 않는 investment effectiveness result'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set investment_effectiveness_result = p_payload, updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'kpi_contribution_reviewed' then
    if v_result not in ('primary_contributor_candidate','supporting_contributor_candidate','minimal_contribution_candidate','kpi_contribution_unverified','insufficient_data') then raise exception '허용되지 않는 kpi contribution result'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set kpi_contribution_result = p_payload, updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'portfolio_value_reviewed' then
    if v_result not in ('high_value_portfolio_candidate','moderate_value_portfolio_candidate','low_value_portfolio_candidate','portfolio_value_unverified','insufficient_data') then raise exception '허용되지 않는 portfolio value result'; end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set portfolio_value_result = p_payload, updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'roi_timeline_recorded' and p_realization_id is not null then
    -- ROI Timeline/Benefit·Value·Leakage·Optimization History 는 JSONB 통합.
    update public.ai_enterprise_value_realizations set value_history = value_history || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id;
  end if;
  if p_kind = 'optimization_opportunity_recorded' then
    -- Optimization ≠ Automatic Improvement — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Optimization Opportunity 기록 금지';
    end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set optimization_opportunities = optimization_opportunities || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'executive_value_scorecard_recorded' and p_realization_id is not null then
    update public.ai_enterprise_value_realizations set scorecard_result = p_payload, updated_at = now() where id = p_realization_id;
  end if;
  if p_kind = 'value_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_value_realization','review_business_outcome','review_roi_assessment','review_benefit_realization','review_cost_benefit','review_value_leakage','review_investment_effectiveness','review_kpi_contribution','review_portfolio_value','record_roi_timeline','record_optimization_opportunity','build_executive_value_summary','build_executive_value_scorecard','request_value_review','request_executive_review','request_human_review','record_value_learning','link_business_value_reference','link_portfolio_reference','link_kpi_reference','link_capacity_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Value Recommendation 금지';
    end if;
    if p_realization_id is not null then update public.ai_enterprise_value_realizations set recommendation_candidate = p_payload, updated_at = now() where id = p_realization_id; end if;
  end if;
  if p_kind = 'value_learning_recorded' and p_realization_id is not null then
    update public.ai_enterprise_value_realizations set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_realization_id;
  end if;
  if p_kind = 'business_value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'kpi_reference_linked' and nullif(p_payload->>'kpi_id','') is not null
     and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
    raise exception 'KPI 없음(실존 검증 실패 — 0548)';
  end if;
  if p_kind = 'capacity_reference_linked' and nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패 — 0558)';
  end if;
  if p_kind = 'commitment_reference_linked' and nullif(p_payload->>'commitment_id','') is not null
     and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
    raise exception 'Execution Commitment 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_value_optimization_events (event_type, value_realization_id, value_review_id, detail, payload, actor_id)
  values (p_kind, p_realization_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'business_outcome_reviewed' then ' (Business Outcome ≠ 회계 확정 — Value ≠ Revenue)'
      when p_kind = 'roi_assessment_reviewed' then ' (ROI ≠ Business Success)'
      when p_kind = 'benefit_realization_reviewed' then ' (Benefit ≠ Profit)'
      when p_kind = 'cost_benefit_reviewed' then ' (Cost/Benefit ≠ 투자 결정)'
      when p_kind = 'value_leakage_reviewed' then ' (Leakage 관측 ≠ 책임 판정)'
      when p_kind = 'investment_effectiveness_reviewed' then ' (Effectiveness ≠ 투자 승인)'
      when p_kind = 'kpi_contribution_reviewed' then ' (Correlation ≠ Causation)'
      when p_kind = 'portfolio_value_reviewed' then ' (Portfolio Value ≠ Portfolio 변경)'
      when p_kind = 'roi_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'optimization_opportunity_recorded' then ' (Optimization ≠ Automatic Improvement)'
      when p_kind = 'executive_value_summary_recorded' then ' (Summary ≠ 투자 확정)'
      when p_kind = 'executive_value_scorecard_recorded' then ' (Scorecard ≠ 투자 지시)'
      when p_kind = 'value_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'value_review_requested' then ' (Value Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — 투자/전략 변경은 사람)'
      when p_kind = 'value_learning_recorded' then ' (Value Learning ≠ 자동 투자 변경)'
      when p_kind = 'business_value_reference_linked' then ' (Business Value Reference ≠ 회계 반영 — 0549 참조만)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 변경)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'kpi_reference_linked' then ' (KPI Reference ≠ KPI 변경 — 0548 참조만)'
      when p_kind = 'capacity_reference_linked' then ' (Capacity Reference ≠ 자원 재배치 — 0558 참조만)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ 실행 보장)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'investment_approved', false, 'investment_cancelled', false, 'budget_changed', false, 'portfolio_changed', false, 'kpi_changed', false, 'strategy_changed', false, 'project_terminated', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_realizations_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_value_realizations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_value_realizations
  where (p_status is null or realization_status = p_status)
    and (p_category is null or value_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_value_optimization_reviews_list(p_realization_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_value_optimization_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_value_optimization_reviews
  where (p_realization_id is null or value_realization_id = p_realization_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_value_optimization_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'realizations', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_value_realizations),
      'observed', (select count(*) from public.ai_enterprise_value_realizations where realization_status = 'observed'),
      'candidate', (select count(*) from public.ai_enterprise_value_realizations where realization_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_value_realizations where realization_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_value_realizations where realization_status = 'archived_reference'),
      'exceptional_roi', (select count(*) from public.ai_enterprise_value_realizations where roi_status = 'exceptional_roi_candidate'),
      'strong_roi', (select count(*) from public.ai_enterprise_value_realizations where roi_status = 'strong_roi_candidate'),
      'weak_roi', (select count(*) from public.ai_enterprise_value_realizations where roi_status = 'weak_roi_candidate'),
      'fully_realized', (select count(*) from public.ai_enterprise_value_realizations where benefit_status = 'fully_realized_candidate'),
      'unrealized', (select count(*) from public.ai_enterprise_value_realizations where benefit_status = 'unrealized_candidate'),
      'critical_leakage', (select count(*) from public.ai_enterprise_value_realizations where leakage_status in ('critical_leakage_candidate','elevated_leakage_candidate')),
      'by_category', (select coalesce(jsonb_object_agg(value_category, cnt), '{}'::jsonb) from (select value_category, count(*) cnt from public.ai_enterprise_value_realizations group by value_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_value_optimization_reviews),
      'requested', (select count(*) from public.ai_enterprise_value_optimization_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_value_optimization_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_value_optimization_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_value_optimization_reviews where review_status = 'revision_requested')
    ),
    'value_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_value_optimization_events),
      'outcome_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'business_outcome_reviewed'),
      'roi_assessments', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'roi_assessment_reviewed'),
      'benefit_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'benefit_realization_reviewed'),
      'cost_benefit_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'cost_benefit_reviewed'),
      'leakage_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'value_leakage_reviewed'),
      'effectiveness_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'investment_effectiveness_reviewed'),
      'kpi_contribution_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'kpi_contribution_reviewed'),
      'portfolio_value_reviews', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'portfolio_value_reviewed'),
      'roi_timelines', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'roi_timeline_recorded'),
      'optimization_opportunities', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'optimization_opportunity_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'executive_value_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'executive_value_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'value_recommendation_recorded'),
      'value_review_requests', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'value_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'value_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'value_learning_recorded'),
      'business_value_links', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'business_value_reference_linked'),
      'kpi_links', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'kpi_reference_linked'),
      'capacity_links', (select count(*) from public.ai_enterprise_value_optimization_events where event_type = 'capacity_reference_linked')
    ),
    -- Value 원천 실측(전부 읽기 전용):
    'value_actuals', jsonb_build_object(
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'kpis_0548', (select count(*) from public.ai_enterprise_kpis),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'capacity_resources_0558', (select count(*) from public.ai_enterprise_capacity_resources),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes)
    ),
    'value_unavailable', jsonb_build_array('accounting_ledger_feed','erp_finance_ledger','billing_system_feed','crm_revenue_feed','cost_accounting_system','market_benchmark_feed'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'roi_is_not_business_success', true, 'benefit_is_not_profit', true,
    'value_is_not_revenue', true, 'correlation_is_not_causation', true,
    'optimization_is_not_automatic_improvement', true, 'recommendation_is_not_decision', true,
    'forecast_is_not_future_fact', true, 'pattern_is_not_causality', true, 'confidence_is_not_certainty', true,
    'no_auto_investment_approval', true, 'no_auto_investment_cancellation', true, 'no_auto_budget_change', true,
    'no_auto_portfolio_change', true, 'no_auto_kpi_change', true, 'no_auto_strategy_change', true,
    'no_auto_project_termination', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_value_optimization_audit(p_limit int default 100)
returns setof public.ai_enterprise_value_optimization_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_value_optimization_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_value_realizations enable row level security;
alter table public.ai_enterprise_value_optimization_reviews enable row level security;
alter table public.ai_enterprise_value_optimization_events enable row level security;

comment on table public.ai_enterprise_value_realizations is 'AI-OPS-55 — Value Realization(≠ 회계 원장·Category 11종·자동 투자 승인 차단·ROI ≠ Business Success·0549 Value 계층과 별개).';
comment on table public.ai_enterprise_value_optimization_reviews is 'AI-OPS-55 — Value Optimization Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_value_optimization_events is 'AI-OPS-55 — Value Optimization 이벤트 31종(자동 투자 승인 이벤트 생성 금지·Correlation ≠ Causation).';
