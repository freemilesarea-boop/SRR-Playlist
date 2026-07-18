-- 0549_admin_ai_enterprise_value_intelligence.sql
-- AI-OPS-45 — Enterprise Value Intelligence, Business Value Attribution &
-- ROI Governance Center.
--
-- Enterprise Strategy → Strategic Initiative → Execution Outcome →
-- Performance KPI → Business Value → Value Attribution → ROI Analysis →
-- Investment Effectiveness → Enterprise Value Score → Value Trade-off →
-- Executive Value Review → Observed Business Outcome → Value Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Business Value ≠ Financial Statement. ROI Candidate ≠ Accounting ROI.
--  * ROI ≠ Investment Decision — ROI 자동 승인/확정 RPC 자체가 없음.
--  * Value Attribution ≠ Proven Causality. KPI Improvement ≠ Value Creation.
--  * Revenue Increase ≠ Enterprise Value Increase.
--  * Enterprise Value Score ≠ Company Valuation(자동 기업가치 산정/M&A 판단/
--    투자자 공시 계열 category 구조적 차단).
--  * Value Recommendation ≠ Decision. Executive Review ≠ Approval.
--  * Outcome Link ≠ Proven Causality. Forecast ≠ Future Fact. Confidence ≠ Certainty.
--  * Null → 0 변환 금지(observed_value/investment/benefit 는 null 유지 가능).
--    insufficient_data / sample_too_small 유지.
--  * 자동 투자 승인/중단·자동 Budget/Resource Allocation/Strategy/KPI/Portfolio
--    변경·자동 Payment/Settlement/회계 처리/Production/Deploy/Merge — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0513/0514/0520/0545/0546/0547/0548
--    원본 무변경(참조만).
--  * Value Attribution/ROI History/Enterprise Value Score 는 신규 테이블 대신
--    JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Business Value Model(≠ 재무제표/회계 계정).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_business_values (
  id                        uuid primary key default gen_random_uuid(),
  value_code                text not null,
  value_name                text not null,
  value_category            text not null check (value_category in ('revenue','profitability','customer','brand','artist','store','platform','operations','ai_capability','innovation','reliability','security','compliance','strategic','long_term','custom')),
  value_status              text not null default 'draft' check (value_status in ('draft','active_reference','paused_reference','deprecated_reference','insufficient_data')),
  value_description         text,
  unit_type                 text,
  direction                 text not null default 'unspecified' check (direction in ('higher_is_better','lower_is_better','unspecified')),
  strategic_initiative_id   uuid,
  strategy_portfolio_id     uuid,
  execution_program_id      uuid,
  kpi_id                    uuid,
  baseline_value            numeric,
  baseline_recorded_at      timestamptz,
  baseline_source_reference text,
  current_value_reference   numeric,
  current_observed_at       timestamptz,
  investment_reference      numeric,
  investment_source_reference text,
  benefit_reference         numeric,
  time_horizon_reference    text,
  value_trend_status        text not null default 'insufficient_data' check (value_trend_status in ('strong_positive_candidate','moderate_positive_candidate','stable_candidate','moderate_negative_candidate','strong_negative_candidate','insufficient_data')),
  roi_status                text not null default 'insufficient_data' check (roi_status in ('excellent_roi_candidate','acceptable_roi_candidate','uncertain_roi_candidate','poor_roi_candidate','insufficient_data')),
  attribution_status        text not null default 'insufficient_data' check (attribution_status in ('strong_attribution_candidate','moderate_attribution_candidate','weak_attribution_candidate','attribution_unverified','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  trend_result              jsonb,
  roi_result                jsonb,
  roi_history               jsonb not null default '[]'::jsonb,
  attribution_result        jsonb,
  kpi_link_result           jsonb,
  execution_link_result     jsonb,
  investment_effectiveness_result jsonb,
  drift_result              jsonb,
  correlation_result        jsonb,
  cross_domain_result       jsonb,
  value_score_result        jsonb,
  tradeoff_result           jsonb,
  scorecard_result          jsonb,
  recommendation_candidate  jsonb,
  value_reviews             jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  outcome_reference         jsonb,
  learning_references       jsonb not null default '[]'::jsonb,
  kpi_references            jsonb not null default '[]'::jsonb,
  initiative_references     jsonb not null default '[]'::jsonb,
  portfolio_references      jsonb not null default '[]'::jsonb,
  program_references        jsonb not null default '[]'::jsonb,
  outcome_links             jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aebv_idem on public.ai_enterprise_business_values (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aebv_status on public.ai_enterprise_business_values (value_status, value_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Enterprise Value Snapshot(Observed Business Value — Null → 0 변환 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_value_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  business_value_id         uuid not null,
  snapshot_period_reference text,
  observed_value            numeric,
  observed_at               timestamptz,
  investment_reference      numeric,
  benefit_reference         numeric,
  source_reference_type     text,
  source_reference_id       text,
  data_quality              text not null default 'quality_unverified' check (data_quality in ('verified_source_reference','proxy_candidate','manual_entry_reference','quality_unverified','insufficient_data')),
  sample_size               int check (sample_size is null or sample_size >= 0),
  variance_vs_baseline      numeric,
  notes                     text,
  evidence                  jsonb not null default '[]'::jsonb,
  created_by                uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aevs_val on public.ai_enterprise_value_snapshots (business_value_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Value 이벤트(32종) — Trend/Attribution/KPI·Execution Link/ROI/
--    Investment Effectiveness/Confidence/Drift/Correlation/Cross-Domain/
--    Value Score/Scorecard/Summary/Trade-off/Recommendation/Review/
--    Reference Link/Outcome/Learning 통합 Audit(자동 확정 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_value_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('value_model_created','value_reviewed','value_baseline_recorded','value_investment_reference_recorded','value_snapshot_recorded','value_trend_reviewed','value_attribution_reviewed','kpi_value_link_reviewed','execution_value_link_reviewed','roi_candidate_reviewed','investment_effectiveness_reviewed','value_confidence_reviewed','value_drift_reviewed','value_correlation_reviewed','cross_domain_value_reviewed','enterprise_value_score_recorded','strategic_value_scorecard_recorded','executive_value_summary_recorded','value_tradeoff_reviewed','value_recommendation_recorded','value_review_requested','executive_review_requested','strategy_review_requested','value_review_reference_recorded','value_revision_requested','kpi_reference_linked','initiative_reference_linked','portfolio_reference_linked','program_reference_linked','decision_outcome_linked','business_outcome_linked','value_learning_reference_recorded')),
  business_value_id         uuid,
  value_snapshot_id         uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeve_evt on public.ai_enterprise_value_events (event_type, created_at desc);
create index if not exists idx_aeve_val on public.ai_enterprise_value_events (business_value_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Business Value Model 생성 — 기업가치 산정/M&A/공시 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_business_value_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_business_values;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'value_category','');
  -- 기업가치 산정/M&A/투자자 공시/개인 평가 계열 — 구조적 차단.
  if v_cat in ('company_valuation','enterprise_valuation','ma_decision','investor_disclosure','stock_price_target','fundraising_decision','personal_performance_value','individual_compensation_value','credit_decision') then
    raise exception '금지된 value_category(기업가치 산정/M&A/공시/개인 평가 계열 비활성)';
  end if;
  if v_cat not in ('revenue','profitability','customer','brand','artist','store','platform','operations','ai_capability','innovation','reliability','security','compliance','strategic','long_term','custom') then
    raise exception '허용되지 않는 value_category';
  end if;
  if coalesce(btrim(p_payload->>'value_name'),'') = '' then raise exception 'value_name 필수'; end if;
  if coalesce(nullif(p_payload->>'direction',''), 'unspecified') not in ('higher_is_better','lower_is_better','unspecified') then
    raise exception '허용되지 않는 direction';
  end if;
  if nullif(p_payload->>'strategic_initiative_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
    raise exception 'Strategic Initiative 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'kpi_id','') is not null
     and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
    raise exception 'Enterprise KPI 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_business_values where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'value_is_not_financial_statement', true); end if;
  end if;
  insert into public.ai_enterprise_business_values (value_code, value_name, value_category, value_description, unit_type, direction, strategic_initiative_id, strategy_portfolio_id, execution_program_id, kpi_id, time_horizon_reference, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'value_code',''), 'EBV-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'value_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'value_description',''), 2000),''),
    nullif(left(coalesce(p_payload->>'unit_type',''), 40),''),
    coalesce(nullif(p_payload->>'direction',''), 'unspecified'),
    nullif(p_payload->>'strategic_initiative_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    nullif(p_payload->>'execution_program_id','')::uuid, nullif(p_payload->>'kpi_id','')::uuid,
    nullif(left(coalesce(p_payload->>'time_horizon_reference',''), 60),''),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_value_events (event_type, business_value_id, detail, payload, actor_id)
  values ('value_model_created', v_id, left(v_cat, 80) || ' (Business Value ≠ Financial Statement — draft·자동 확정 없음)', jsonb_build_object('value_name', p_payload->>'value_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'value_is_not_financial_statement', true, 'roi_confirmed', false, 'investment_approved', false, 'budget_changed', false, 'accounting_applied', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Value 검토/Baseline/Investment Reference — deprecated 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_business_value_review(p_value_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_business_values; v_next text := null; v_evt text := 'value_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('activate_reference','pause_reference','deprecate_reference','mark_insufficient_data','record_baseline','record_investment_reference','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_business_values where id = p_value_id;
  if v_row.id is null then raise exception 'Business Value 없음(실존 검증 실패)'; end if;
  if v_row.value_status = 'deprecated_reference' and p_action <> 'invalidate' then
    raise exception '종결 상태 재결정 차단(deprecated_reference)';
  end if;

  if p_action = 'activate_reference' then v_next := 'active_reference'; v_note := ' (Active Reference ≠ 검증된 가치 보증)';
  elsif p_action = 'pause_reference' then v_next := 'paused_reference';
  elsif p_action = 'deprecate_reference' then v_next := 'deprecated_reference';
  elsif p_action = 'mark_insufficient_data' then v_next := 'insufficient_data';
  elsif p_action = 'record_baseline' then
    if nullif(p_payload->>'baseline_value','') is null then raise exception 'baseline_value 필수'; end if;
    if coalesce(nullif(p_payload->>'baseline_source_reference',''), '') = '' then
      raise exception '출처 없는 Value Baseline 기록 금지(baseline_source_reference 필수)';
    end if;
    v_evt := 'value_baseline_recorded'; v_note := ' (Baseline ≠ 회계 확정 수치)';
    update public.ai_enterprise_business_values set
      baseline_value = (p_payload->>'baseline_value')::numeric,
      baseline_recorded_at = now(),
      baseline_source_reference = left(p_payload->>'baseline_source_reference', 200),
      reviewed_by = v_uid, updated_at = now()
    where id = p_value_id;
  elsif p_action = 'record_investment_reference' then
    -- Investment Reference ≠ 회계 장부 — 출처 없이 기록 차단.
    if nullif(p_payload->>'investment_reference','') is null then raise exception 'investment_reference 필수'; end if;
    if coalesce(nullif(p_payload->>'investment_source_reference',''), '') = '' then
      raise exception '출처 없는 Investment Reference 기록 금지';
    end if;
    v_evt := 'value_investment_reference_recorded'; v_note := ' (Investment Reference ≠ 회계 장부/집행 승인)';
    update public.ai_enterprise_business_values set
      investment_reference = (p_payload->>'investment_reference')::numeric,
      investment_source_reference = left(p_payload->>'investment_source_reference', 200),
      benefit_reference = coalesce(nullif(p_payload->>'benefit_reference','')::numeric, benefit_reference),
      reviewed_by = v_uid, updated_at = now()
    where id = p_value_id;
  else v_next := 'insufficient_data'; v_evt := 'value_reviewed';
  end if;

  if v_next is not null then
    update public.ai_enterprise_business_values set value_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_value_id;
  end if;
  insert into public.ai_enterprise_value_events (event_type, business_value_id, detail, payload, actor_id)
  values (v_evt, p_value_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.value_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_value_id, 'status', coalesce(v_next, v_row.value_status), 'value_is_not_financial_statement', true, 'roi_confirmed', false, 'investment_approved', false, 'budget_changed', false, 'accounting_applied', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Value Snapshot 기록 — Observed Business Value(관측 없으면 null 유지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_snapshot_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_val public.ai_enterprise_business_values; v_obs numeric; v_quality text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if nullif(p_payload->>'business_value_id','') is null then raise exception 'business_value_id 필수'; end if;
  select * into v_val from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid;
  if v_val.id is null then raise exception 'Business Value 없음(실존 검증 실패)'; end if;
  v_quality := coalesce(nullif(p_payload->>'data_quality',''), 'quality_unverified');
  if v_quality not in ('verified_source_reference','proxy_candidate','manual_entry_reference','quality_unverified','insufficient_data') then
    raise exception '허용되지 않는 data_quality';
  end if;
  if v_quality = 'verified_source_reference' and coalesce(nullif(p_payload->>'source_reference_id',''), '') = '' then
    raise exception '출처 없는 verified_source_reference 금지(quality_unverified 유지)';
  end if;
  v_obs := nullif(p_payload->>'observed_value','')::numeric;   -- null 이면 null 유지(0 치환 금지).
  insert into public.ai_enterprise_value_snapshots (business_value_id, snapshot_period_reference, observed_value, observed_at, investment_reference, benefit_reference, source_reference_type, source_reference_id, data_quality, sample_size, variance_vs_baseline, notes, evidence, created_by)
  values (v_val.id,
    nullif(left(coalesce(p_payload->>'snapshot_period_reference',''), 60),''),
    v_obs,
    coalesce(nullif(p_payload->>'observed_at','')::timestamptz, now()),
    nullif(p_payload->>'investment_reference','')::numeric, nullif(p_payload->>'benefit_reference','')::numeric,
    nullif(left(coalesce(p_payload->>'source_reference_type',''), 80),''), nullif(p_payload->>'source_reference_id',''),
    v_quality,
    case when nullif(p_payload->>'sample_size','') is null then null else greatest(0, (p_payload->>'sample_size')::int) end,
    case when v_obs is null or v_val.baseline_value is null then null else v_obs - v_val.baseline_value end,
    nullif(left(coalesce(p_payload->>'notes',''), 500),''),
    coalesce(p_payload->'evidence', '[]'::jsonb), v_uid)
  returning id into v_id;
  if v_obs is not null then
    update public.ai_enterprise_business_values set current_value_reference = v_obs, current_observed_at = now(), updated_at = now() where id = v_val.id;
  end if;
  insert into public.ai_enterprise_value_events (event_type, business_value_id, value_snapshot_id, detail, payload, actor_id)
  values ('value_snapshot_recorded', v_val.id, v_id, 'Observed Business Value (관측값 없으면 null 유지 — 0 치환 금지)', jsonb_build_object('observed_value', v_obs, 'data_quality', v_quality), v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'business_value_id', v_val.id, 'observed_value_present', v_obs is not null, 'roi_confirmed', false, 'investment_approved', false, 'accounting_applied', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Executive Value Review — 요청/Reference 기록만. Self-Review 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_executive_review(p_value_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_business_values; v_evt text; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_value_review','request_executive_review','request_strategy_review','record_review_reference','request_revision') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_business_values where id = p_value_id;
  if v_row.id is null then raise exception 'Business Value 없음(실존 검증 실패)'; end if;

  if p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Executive Review ≠ Approval).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Value Review Reference 금지';
    end if;
    v_evt := 'value_review_reference_recorded';
    v_note := ' (Review Reference ≠ Approval — 투자/경영 결정은 사람·ROI 확정 없음)';
  elsif p_action = 'request_value_review' then v_evt := 'value_review_requested'; v_note := ' (Value Review 요청 — 최종 판단은 사람)';
  elsif p_action = 'request_executive_review' then v_evt := 'executive_review_requested'; v_note := ' (Executive Review 요청 ≠ Approval)';
  elsif p_action = 'request_strategy_review' then v_evt := 'strategy_review_requested'; v_note := ' (Strategy Review 요청 — 전략 변경은 사람)';
  else v_evt := 'value_revision_requested';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_value_decision_confirmed', p_action = 'record_review_reference',
    'roi_confirmed', false, 'investment_approved', false, 'investment_terminated', false,
    'budget_changed', false, 'strategy_changed', false, 'accounting_applied', false, 'production_applied', false);
  update public.ai_enterprise_business_values set
    value_reviews = value_reviews || jsonb_build_array(v_review),
    review_reference = case when p_action = 'record_review_reference' then v_review else review_reference end,
    reviewed_by = v_uid, updated_at = now()
  where id = p_value_id;
  insert into public.ai_enterprise_value_events (event_type, business_value_id, detail, payload, actor_id)
  values (v_evt, p_value_id, left(p_reason, 200) || v_note, v_review, v_uid);
  return jsonb_build_object('ok', true, 'id', p_value_id, 'review_action', p_action, 'review_is_not_approval', true, 'roi_confirmed', false, 'investment_approved', false, 'investment_terminated', false, 'budget_changed', false, 'strategy_changed', false, 'accounting_applied', false, 'production_applied', false, 'human_decision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Value 이벤트 기록(통합) — 자동 확정 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_value_event_record(p_kind text, p_reason text, p_payload jsonb, p_value_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('value_trend_reviewed','value_attribution_reviewed','kpi_value_link_reviewed','execution_value_link_reviewed','roi_candidate_reviewed','investment_effectiveness_reviewed','value_confidence_reviewed','value_drift_reviewed','value_correlation_reviewed','cross_domain_value_reviewed','enterprise_value_score_recorded','strategic_value_scorecard_recorded','executive_value_summary_recorded','value_tradeoff_reviewed','value_recommendation_recorded','kpi_reference_linked','initiative_reference_linked','portfolio_reference_linked','program_reference_linked','decision_outcome_linked','business_outcome_linked','value_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_value_id is not null and not exists (select 1 from public.ai_enterprise_business_values where id = p_value_id) then raise exception 'Business Value 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'value_trend_reviewed' then
    if v_result not in ('strong_positive_candidate','moderate_positive_candidate','stable_candidate','moderate_negative_candidate','strong_negative_candidate','insufficient_data') then raise exception '허용되지 않는 value trend result'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set value_trend_status = v_result, trend_result = p_payload, updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'value_attribution_reviewed' then
    if coalesce(p_payload->>'attribution_dimension','') not in ('strategy_contribution','execution_contribution','kpi_contribution','resource_contribution','external_factors','unknown_factors') then
      raise exception '허용되지 않는 attribution_dimension';
    end if;
    if v_result not in ('strong_attribution_candidate','moderate_attribution_candidate','weak_attribution_candidate','attribution_unverified','insufficient_data') then raise exception '허용되지 않는 attribution result'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set attribution_status = v_result, attribution_result = coalesce(attribution_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'attribution_dimension', p_payload), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind in ('kpi_value_link_reviewed','execution_value_link_reviewed') then
    if v_result not in ('strong_link_candidate','moderate_link_candidate','weak_link_candidate','no_material_link_candidate','link_unverified','insufficient_data') then raise exception '허용되지 않는 link result'; end if;
    if p_kind = 'kpi_value_link_reviewed' and nullif(p_payload->>'kpi_id','') is not null
       and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
      raise exception 'Enterprise KPI 없음(실존 검증 실패)';
    end if;
    if p_kind = 'execution_value_link_reviewed' and nullif(p_payload->>'execution_program_id','') is not null
       and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
      raise exception 'Execution Program 없음(실존 검증 실패)';
    end if;
    if p_value_id is not null then
      update public.ai_enterprise_business_values set
        kpi_link_result = case when p_kind = 'kpi_value_link_reviewed' then p_payload else kpi_link_result end,
        execution_link_result = case when p_kind = 'execution_value_link_reviewed' then p_payload else execution_link_result end,
        updated_at = now()
      where id = p_value_id;
    end if;
  end if;
  if p_kind = 'roi_candidate_reviewed' then
    if v_result not in ('excellent_roi_candidate','acceptable_roi_candidate','uncertain_roi_candidate','poor_roi_candidate','insufficient_data') then raise exception '허용되지 않는 roi result'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 ROI Candidate 기록 금지(ROI Candidate ≠ Accounting ROI)';
    end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set roi_status = v_result, roi_result = p_payload, roi_history = roi_history || jsonb_build_array(p_payload || jsonb_build_object('recorded_at', now())), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'investment_effectiveness_reviewed' then
    if v_result not in ('high_effectiveness_candidate','moderate_effectiveness_candidate','low_effectiveness_candidate','ineffective_candidate','effectiveness_unverified','insufficient_data') then raise exception '허용되지 않는 effectiveness result'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set investment_effectiveness_result = p_payload, updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'value_confidence_reviewed' then
    if nullif(p_payload->>'confidence','') is null then raise exception 'confidence 필수'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set confidence = least(100, greatest(0, (p_payload->>'confidence')::int)), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'value_drift_reviewed' then
    if v_result not in ('no_material_value_drift_candidate','minor_value_drift_candidate','moderate_value_drift_candidate','severe_value_drift_candidate','value_drift_unverified','insufficient_data') then raise exception '허용되지 않는 value drift result'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set drift_result = p_payload, updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind in ('value_correlation_reviewed','cross_domain_value_reviewed') then
    if v_result not in ('strong_correlation_candidate','moderate_correlation_candidate','weak_correlation_candidate','no_material_correlation_candidate','diverging_domains_candidate','sample_too_small','correlation_unverified','insufficient_data') then raise exception '허용되지 않는 correlation result'; end if;
    if p_value_id is not null then
      update public.ai_enterprise_business_values set
        correlation_result = case when p_kind = 'value_correlation_reviewed' then p_payload else correlation_result end,
        cross_domain_result = case when p_kind = 'cross_domain_value_reviewed' then p_payload else cross_domain_result end,
        updated_at = now()
      where id = p_value_id;
    end if;
  end if;
  if p_kind = 'enterprise_value_score_recorded' then
    if nullif(p_payload->>'value_score','') is null then raise exception 'value_score 필수'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set value_score_result = p_payload || jsonb_build_object('value_score', least(100, greatest(0, (p_payload->>'value_score')::int)), 'score_is_not_company_valuation', true), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'strategic_value_scorecard_recorded' and p_value_id is not null then
    update public.ai_enterprise_business_values set scorecard_result = p_payload, updated_at = now() where id = p_value_id;
  end if;
  if p_kind = 'value_tradeoff_reviewed' then
    if coalesce(p_payload->>'axis','') not in ('short_term_roi_vs_long_term_value','brand_value_vs_revenue','customer_satisfaction_vs_revenue','growth_vs_profitability','innovation_vs_reliability','cost_vs_capability') then
      raise exception '허용되지 않는 tradeoff axis';
    end if;
    if v_result not in ('favorable_tradeoff_candidate','balanced_tradeoff_candidate','conflicting_tradeoff_candidate','mixed_tradeoff_candidate','tradeoff_unverified','insufficient_data') then raise exception '허용되지 않는 tradeoff result'; end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set tradeoff_result = coalesce(tradeoff_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'axis', p_payload), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'value_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_business_value_model','record_value_baseline','record_investment_reference','record_value_snapshot','review_value_trend','review_value_attribution','review_kpi_value_link','review_execution_value_link','review_roi_candidate','review_investment_effectiveness','review_value_confidence','review_value_drift','review_value_correlation','review_cross_domain_value','record_enterprise_value_score','build_strategic_value_scorecard','build_executive_value_summary','review_value_tradeoff','request_value_review','request_executive_review','request_strategy_review','link_business_outcome','record_value_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Value Recommendation 금지';
    end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set recommendation_candidate = p_payload, updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'kpi_reference_linked' then
    if nullif(p_payload->>'kpi_id','') is not null
       and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
      raise exception 'Enterprise KPI 없음(실존 검증 실패)';
    end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set kpi_references = kpi_references || jsonb_build_array(p_payload), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'initiative_reference_linked' then
    if nullif(p_payload->>'strategic_initiative_id','') is not null
       and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
      raise exception 'Strategic Initiative 없음(실존 검증 실패)';
    end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set initiative_references = initiative_references || jsonb_build_array(p_payload), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' then
    if nullif(p_payload->>'execution_program_id','') is not null
       and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
      raise exception 'Execution Program 없음(실존 검증 실패)';
    end if;
    if p_value_id is not null then update public.ai_enterprise_business_values set program_references = program_references || jsonb_build_array(p_payload), updated_at = now() where id = p_value_id; end if;
  end if;
  if p_kind = 'decision_outcome_linked' and nullif(p_payload->>'decision_outcome_id','') is not null
     and not exists (select 1 from public.ai_decision_outcomes where id = (p_payload->>'decision_outcome_id')::uuid) then
    raise exception 'Decision Outcome 없음(실존 검증 실패)';
  end if;
  if p_kind = 'business_outcome_linked' and p_value_id is not null then
    update public.ai_enterprise_business_values set outcome_reference = p_payload, outcome_links = outcome_links || jsonb_build_array(p_payload), updated_at = now() where id = p_value_id;
  end if;
  if p_kind = 'value_learning_reference_recorded' and p_value_id is not null then
    update public.ai_enterprise_business_values set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_value_id;
  end if;

  insert into public.ai_enterprise_value_events (event_type, business_value_id, detail, payload, actor_id)
  values (p_kind, p_value_id,
    left(p_reason, 200) || case
      when p_kind = 'value_trend_reviewed' then ' (Value Trend ≠ Future Trend)'
      when p_kind = 'value_attribution_reviewed' then ' (Value Attribution ≠ Proven Causality)'
      when p_kind = 'kpi_value_link_reviewed' then ' (KPI Improvement ≠ Value Creation)'
      when p_kind = 'execution_value_link_reviewed' then ' (Execution Link ≠ Value 인과 확정)'
      when p_kind = 'roi_candidate_reviewed' then ' (ROI Candidate ≠ Accounting ROI/Investment Decision)'
      when p_kind = 'investment_effectiveness_reviewed' then ' (Effectiveness Candidate ≠ 투자 중단 신호)'
      when p_kind = 'value_confidence_reviewed' then ' (Confidence ≠ Certainty)'
      when p_kind = 'value_drift_reviewed' then ' (Value Drift ≠ 자동 재배분 신호)'
      when p_kind = 'value_correlation_reviewed' then ' (Value Correlation ≠ Causality)'
      when p_kind = 'cross_domain_value_reviewed' then ' (Revenue Increase ≠ Enterprise Value Increase)'
      when p_kind = 'enterprise_value_score_recorded' then ' (Enterprise Value Score ≠ Company Valuation)'
      when p_kind = 'strategic_value_scorecard_recorded' then ' (Scorecard ≠ 경영 평가 확정)'
      when p_kind = 'executive_value_summary_recorded' then ' (Summary ≠ 가치 확정)'
      when p_kind = 'value_tradeoff_reviewed' then ' (Trade-off Candidate ≠ 자동 우선순위 결정)'
      when p_kind = 'value_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'kpi_reference_linked' then ' (KPI Reference ≠ Value 인과)'
      when p_kind = 'initiative_reference_linked' then ' (Initiative Reference ≠ Value 창출 확정)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 성공)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ ROI 확정)'
      when p_kind = 'decision_outcome_linked' then ' (Decision Outcome Link ≠ Proven Causality)'
      when p_kind = 'business_outcome_linked' then ' (Outcome Link ≠ Proven Causality)'
      when p_kind = 'value_learning_reference_recorded' then ' (Learning Reference ≠ 자동 전략 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'roi_confirmed', false, 'investment_approved', false, 'investment_terminated', false, 'budget_changed', false, 'strategy_changed', false, 'accounting_applied', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_business_values_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_business_values language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_business_values
  where (p_status is null or value_status = p_status)
    and (p_category is null or value_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_value_snapshots_list(p_value_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_value_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_value_snapshots
  where (p_value_id is null or business_value_id = p_value_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_value_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'values', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_business_values),
      'draft', (select count(*) from public.ai_enterprise_business_values where value_status = 'draft'),
      'active', (select count(*) from public.ai_enterprise_business_values where value_status = 'active_reference'),
      'paused', (select count(*) from public.ai_enterprise_business_values where value_status = 'paused_reference'),
      'deprecated', (select count(*) from public.ai_enterprise_business_values where value_status = 'deprecated_reference'),
      'with_baseline', (select count(*) from public.ai_enterprise_business_values where baseline_value is not null),
      'with_investment', (select count(*) from public.ai_enterprise_business_values where investment_reference is not null),
      'with_observed', (select count(*) from public.ai_enterprise_business_values where current_value_reference is not null),
      'positive_trend', (select count(*) from public.ai_enterprise_business_values where value_trend_status in ('strong_positive_candidate','moderate_positive_candidate')),
      'negative_trend', (select count(*) from public.ai_enterprise_business_values where value_trend_status in ('moderate_negative_candidate','strong_negative_candidate')),
      'excellent_roi', (select count(*) from public.ai_enterprise_business_values where roi_status = 'excellent_roi_candidate'),
      'poor_roi', (select count(*) from public.ai_enterprise_business_values where roi_status = 'poor_roi_candidate'),
      'uncertain_roi', (select count(*) from public.ai_enterprise_business_values where roi_status = 'uncertain_roi_candidate'),
      'strong_attribution', (select count(*) from public.ai_enterprise_business_values where attribution_status = 'strong_attribution_candidate'),
      'attribution_unverified', (select count(*) from public.ai_enterprise_business_values where attribution_status = 'attribution_unverified'),
      'reviewed_references', (select count(*) from public.ai_enterprise_business_values where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(value_category, cnt), '{}'::jsonb) from (select value_category, count(*) cnt from public.ai_enterprise_business_values group by value_category) t)
    ),
    'snapshots', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_value_snapshots),
      'with_observed_value', (select count(*) from public.ai_enterprise_value_snapshots where observed_value is not null),
      'null_observed', (select count(*) from public.ai_enterprise_value_snapshots where observed_value is null),
      'verified_source', (select count(*) from public.ai_enterprise_value_snapshots where data_quality = 'verified_source_reference'),
      'quality_unverified', (select count(*) from public.ai_enterprise_value_snapshots where data_quality = 'quality_unverified')
    ),
    'value_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_value_events),
      'baselines', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_baseline_recorded'),
      'investment_references', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_investment_reference_recorded'),
      'snapshots', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_snapshot_recorded'),
      'trend_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_trend_reviewed'),
      'attribution_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_attribution_reviewed'),
      'kpi_link_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'kpi_value_link_reviewed'),
      'execution_link_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'execution_value_link_reviewed'),
      'roi_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'roi_candidate_reviewed'),
      'effectiveness_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'investment_effectiveness_reviewed'),
      'confidence_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_confidence_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_drift_reviewed'),
      'correlation_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_correlation_reviewed'),
      'cross_domain_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'cross_domain_value_reviewed'),
      'value_scores', (select count(*) from public.ai_enterprise_value_events where event_type = 'enterprise_value_score_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_value_events where event_type = 'strategic_value_scorecard_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_value_events where event_type = 'executive_value_summary_recorded'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_tradeoff_reviewed'),
      'recommendations', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_recommendation_recorded'),
      'value_review_requests', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_value_events where event_type = 'executive_review_requested'),
      'strategy_review_requests', (select count(*) from public.ai_enterprise_value_events where event_type = 'strategy_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_review_reference_recorded'),
      'kpi_links', (select count(*) from public.ai_enterprise_value_events where event_type = 'kpi_reference_linked'),
      'initiative_links', (select count(*) from public.ai_enterprise_value_events where event_type = 'initiative_reference_linked'),
      'program_links', (select count(*) from public.ai_enterprise_value_events where event_type = 'program_reference_linked'),
      'decision_outcome_links', (select count(*) from public.ai_enterprise_value_events where event_type = 'decision_outcome_linked'),
      'business_outcome_links', (select count(*) from public.ai_enterprise_value_events where event_type = 'business_outcome_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_value_events where event_type = 'value_learning_reference_recorded')
    ),
    -- Value 원천 실측(전부 읽기 전용):
    'value_actuals', jsonb_build_object(
      'enterprise_kpis_0548', (select count(*) from public.ai_enterprise_kpis),
      'kpi_snapshots_0548', (select count(*) from public.ai_enterprise_kpi_snapshots),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'execution_plans_0547', (select count(*) from public.ai_enterprise_execution_plans),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'strategic_initiatives_0545', (select count(*) from public.ai_enterprise_strategic_initiatives),
      'resource_inventory_0546', (select count(*) from public.ai_enterprise_resource_inventory),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities)
    ),
    'value_unavailable', jsonb_build_array('accounting_ledger_feed','financial_statement_feed','revenue_recognition_feed','company_valuation_model','market_data_feed','investor_relations_system','ma_analysis_system'),   -- 원본 없음(실측)
    'value_is_not_financial_statement', true, 'roi_candidate_is_not_accounting_roi', true,
    'roi_is_not_investment_decision', true, 'attribution_is_not_proven_causality', true,
    'kpi_improvement_is_not_value_creation', true, 'revenue_increase_is_not_enterprise_value_increase', true,
    'value_score_is_not_company_valuation', true, 'recommendation_is_not_decision', true,
    'review_is_not_approval', true, 'outcome_link_is_not_proven_causality', true,
    'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_roi_approval', true, 'no_auto_investment_approval', true, 'no_auto_investment_termination', true,
    'no_auto_budget_change', true, 'no_auto_strategy_change', true, 'no_auto_accounting', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_value_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_value_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_value_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_business_values enable row level security;
alter table public.ai_enterprise_value_snapshots enable row level security;
alter table public.ai_enterprise_value_events enable row level security;

comment on table public.ai_enterprise_business_values is 'AI-OPS-45 — Business Value Model(≠ 재무제표·Category 16종·기업가치 산정/M&A/공시 계열 차단·ROI Candidate ≠ Accounting ROI·자동 투자 승인/중단 없음).';
comment on table public.ai_enterprise_value_snapshots is 'AI-OPS-45 — Value Snapshot(Observed Business Value·Null → 0 변환 금지·verified 표기는 출처 필수).';
comment on table public.ai_enterprise_value_events is 'AI-OPS-45 — Value 이벤트 32종(자동 확정 이벤트 생성 금지·Enterprise Value Score ≠ Company Valuation).';
