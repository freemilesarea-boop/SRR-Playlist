-- 0562_admin_ai_enterprise_innovation_intelligence.sql
-- AI-OPS-58 — Enterprise Innovation Intelligence, Innovation Portfolio &
-- Future Opportunity Center.
--
-- Enterprise Vision → Mission → Strategy → Execution → Continuous
-- Improvement → Innovation Opportunity Detection → Innovation Portfolio →
-- Innovation Readiness → Future Opportunity Analysis → Innovation
-- Prioritization → Executive Innovation Review → Innovation Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Opportunity ≠ Guaranteed Success — 신규 사업 자동 시작/제품 자동 출시/
--    투자 자동 승인/Budget 자동 변경/조직 자동 변경/Strategy 자동 변경/계약
--    자동 체결 RPC 자체가 없음.
--  * Innovation ≠ Business Success. Potential ≠ Outcome.
--    Forecast ≠ Future Fact. Correlation ≠ Causation.
--    Recommendation ≠ Decision. Priority ≠ Mandatory Order.
--  * Confidence ≠ Certainty. Null → 0 변환 금지.
--    insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0547/0549/0555/0556/0557/0558/
--    0559/0560/0561 원본 무변경(참조만).
--  * 이름 실측: ai_enterprise_innovations / innovation_reviews /
--    innovation_events · admin_enterprise_innovation_* 전부 미사용 확인 —
--    스펙 권장명 그대로 사용(충돌 없음).
--  * 시장 조사/특허 DB/스타트업 생태계/기술 레이더/고객 인사이트/R&D 랩
--    피드는 실측 부재 — insufficient_data 로 유지(분석은 수동 기록 기반).
--  * Innovation Timeline/Opportunity·Portfolio·Risk·Innovation Learning
--    History 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Innovation(≠ 사업 원장 — 혁신 기회 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_innovations (
  id                        uuid primary key default gen_random_uuid(),
  innovation_code           text not null,
  innovation_name           text not null,
  innovation_category       text not null check (innovation_category in ('technology','product','service','platform','market','business_model','process','organization','executive','enterprise','custom')),
  innovation_status         text not null default 'discovered' check (innovation_status in ('discovered','candidate','review_reference','archived_reference','insufficient_data')),
  innovation_summary        text,
  opportunity_status        text not null default 'insufficient_data' check (opportunity_status in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data')),
  risk_status               text not null default 'insufficient_data' check (risk_status in ('low_risk_candidate','manageable_risk_candidate','elevated_risk_candidate','critical_risk_candidate','insufficient_data')),
  portfolio_status          text not null default 'insufficient_data' check (portfolio_status in ('highly_balanced_candidate','balanced_candidate','partially_balanced_candidate','imbalanced_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  improvement_id            uuid,
  transformation_id         uuid,
  decision_scenario_id      uuid,
  mission_id                uuid,
  opportunity_result        jsonb,
  risk_result               jsonb,
  portfolio_result          jsonb,
  readiness_result          jsonb,
  future_opportunity_result jsonb,
  technology_result         jsonb,
  market_result             jsonb,
  alignment_result          jsonb,
  priority_result           jsonb,
  scorecard_result          jsonb,
  innovation_history        jsonb not null default '[]'::jsonb,   -- Innovation Timeline/Opportunity·Portfolio·Risk·Learning History 통합 append
  recommendation_candidate  jsonb,
  innovation_reviews        jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
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
create unique index if not exists uq_aein_idem on public.ai_enterprise_innovations (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aein_status on public.ai_enterprise_innovations (innovation_status, innovation_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Innovation Review(§9 — 요청/Reference 기록만, Innovation 실행은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_innovation_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  innovation_id             uuid not null,
  review_type               text not null check (review_type in ('innovation_review','executive_review','human_review')),
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
create unique index if not exists uq_aeiv_idem on public.ai_enterprise_innovation_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeiv_inn on public.ai_enterprise_innovation_reviews (innovation_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Innovation 이벤트(31종) — Opportunity/Risk/Portfolio/Readiness/Future/
--    Technology/Market/Alignment/Priority/Timeline/Scorecard/Recommendation/
--    Review/Learning/Link 통합 Audit(자동 사업 시작 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_innovation_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('innovation_discovered','innovation_reviewed','innovation_opportunity_reviewed','innovation_risk_reviewed','innovation_portfolio_reviewed','innovation_readiness_reviewed','future_opportunity_reviewed','technology_opportunity_reviewed','market_potential_reviewed','mission_alignment_reviewed','innovation_priority_reviewed','innovation_timeline_recorded','executive_innovation_summary_recorded','executive_innovation_scorecard_recorded','innovation_recommendation_recorded','innovation_review_created','innovation_review_reviewed','innovation_review_requested','executive_review_requested','human_review_requested','innovation_review_reference_recorded','innovation_revision_requested','innovation_learning_recorded','improvement_reference_linked','transformation_reference_linked','value_reference_linked','capacity_reference_linked','scenario_reference_linked','mission_reference_linked','environment_reference_linked','program_reference_linked')),
  innovation_id             uuid,
  innovation_review_id      uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeine_evt on public.ai_enterprise_innovation_events (event_type, created_at desc);
create index if not exists idx_aeine_inn on public.ai_enterprise_innovation_events (innovation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Innovation 생성 — 자동 사업 시작 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_innovation_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_innovations;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'innovation_category','');
  -- 자동 사업 시작/제품 출시/투자 승인/Budget·조직·전략 변경/계약 체결 계열 — 구조적 차단.
  if v_cat in ('automatic_business_launch','automatic_product_launch','automatic_investment_approval','automatic_budget_change','automatic_organization_change','automatic_strategy_change','automatic_contract_signing') then
    raise exception '금지된 innovation_category(자동 사업 시작 계열 비활성)';
  end if;
  if v_cat not in ('technology','product','service','platform','market','business_model','process','organization','executive','enterprise','custom') then
    raise exception '허용되지 않는 innovation_category';
  end if;
  if coalesce(btrim(p_payload->>'innovation_name'),'') = '' then raise exception 'innovation_name 필수'; end if;
  if nullif(p_payload->>'improvement_id','') is not null
     and not exists (select 1 from public.ai_enterprise_improvements where id = (p_payload->>'improvement_id')::uuid) then
    raise exception 'Improvement 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'transformation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid) then
    raise exception 'Transformation 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_innovations where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'opportunity_is_not_guaranteed_success', true); end if;
  end if;
  insert into public.ai_enterprise_innovations (innovation_code, innovation_name, innovation_category, innovation_summary, improvement_id, transformation_id, decision_scenario_id, mission_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'innovation_code',''), 'EIN-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'innovation_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'innovation_summary',''), 2000),''),
    nullif(p_payload->>'improvement_id','')::uuid, nullif(p_payload->>'transformation_id','')::uuid,
    nullif(p_payload->>'decision_scenario_id','')::uuid, nullif(p_payload->>'mission_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, detail, payload, actor_id)
  values ('innovation_discovered', v_id, left(v_cat, 80) || ' (혁신 기회 관측 Candidate — 자동 사업 시작 없음)', jsonb_build_object('innovation_name', p_payload->>'innovation_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'discovered', 'opportunity_is_not_guaranteed_success', true, 'business_launched', false, 'product_launched', false, 'investment_approved', false, 'budget_changed', false, 'organization_changed', false, 'strategy_changed', false, 'contract_signed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Innovation 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_innovation_review(p_innovation_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_innovations; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'innovation_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_discovered','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_innovations where id = p_innovation_id;
  if v_row.id is null then raise exception 'Innovation 없음(실존 검증 실패)'; end if;
  if v_row.innovation_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_discovered' then v_next := 'discovered'; v_note := ' (발견 상태 표시 ≠ 사업 시작)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Innovation 실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Innovation Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — Innovation 실행은 사람)'; v_evt := 'innovation_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'business_launched', false, 'investment_approved', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_innovations set review_reference = v_ref, innovation_reviews = innovation_reviews || jsonb_build_array(v_ref) where id = p_innovation_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_innovations set innovation_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_innovation_id;
  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, detail, payload, actor_id)
  values (v_evt, p_innovation_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_innovation_id, 'status', v_next, 'opportunity_is_not_guaranteed_success', true, 'business_launched', false, 'product_launched', false, 'investment_approved', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Innovation Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_innovation_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_inn public.ai_enterprise_innovations; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_innovation_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('innovation_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'innovation_id','') is null then raise exception 'innovation_id 필수'; end if;
  select * into v_inn from public.ai_enterprise_innovations where id = (p_payload->>'innovation_id')::uuid;
  if v_inn.id is null then raise exception 'Innovation 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_innovation_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_innovation_reviews (review_code, innovation_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EIV-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_inn.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'innovation_review' then 'innovation_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, innovation_review_id, detail, payload, actor_id)
  values (v_evt, v_inn.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — Innovation 실행은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, innovation_review_id, detail, payload, actor_id)
  values ('innovation_review_created', v_inn.id, v_id, 'Innovation Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'business_launched', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_innovation_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_innovation_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_innovation_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Innovation Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'business_launched', false, 'product_launched', false, 'investment_approved', false,
    'budget_changed', false, 'strategy_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Innovation 실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Innovation Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — Innovation 실행은 사람)';
    update public.ai_enterprise_innovation_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_innovations set
      innovation_reviews = innovation_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.innovation_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_innovation_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, innovation_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'innovation_review_reference_recorded' when p_action = 'request_revision' then 'innovation_revision_requested' else 'innovation_review_reviewed' end,
    v_row.innovation_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'business_launched', false, 'investment_approved', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Innovation 이벤트 기록(통합) — 자동 사업 시작 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_innovation_event_record(p_kind text, p_reason text, p_payload jsonb, p_innovation_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('innovation_opportunity_reviewed','innovation_risk_reviewed','innovation_portfolio_reviewed','innovation_readiness_reviewed','future_opportunity_reviewed','technology_opportunity_reviewed','market_potential_reviewed','mission_alignment_reviewed','innovation_priority_reviewed','innovation_timeline_recorded','executive_innovation_summary_recorded','executive_innovation_scorecard_recorded','innovation_recommendation_recorded','innovation_review_requested','executive_review_requested','human_review_requested','innovation_learning_recorded','improvement_reference_linked','transformation_reference_linked','value_reference_linked','capacity_reference_linked','scenario_reference_linked','mission_reference_linked','environment_reference_linked','program_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_innovation_id is not null and not exists (select 1 from public.ai_enterprise_innovations where id = p_innovation_id) then raise exception 'Innovation 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_innovation_reviews where id = p_review_id) then raise exception 'Innovation Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'innovation_opportunity_reviewed' then
    if coalesce(p_payload->>'opportunity_dimension','') not in ('strategic_value','market_potential','technical_feasibility','resource_availability','innovation_readiness') then
      raise exception '허용되지 않는 opportunity_dimension(§5 — 5종)';
    end if;
    if v_result not in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data') then raise exception '허용되지 않는 opportunity result(§5 — 5종)'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set opportunity_status = v_result, opportunity_result = coalesce(opportunity_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'opportunity_dimension', p_payload), innovation_history = innovation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_risk_reviewed' then
    if coalesce(p_payload->>'risk_dimension','') not in ('technology_risk','market_risk','resource_risk','execution_risk','governance_risk') then
      raise exception '허용되지 않는 risk_dimension(§6 — 5종)';
    end if;
    if v_result not in ('low_risk_candidate','manageable_risk_candidate','elevated_risk_candidate','critical_risk_candidate','insufficient_data') then raise exception '허용되지 않는 risk result(§6 — 5종)'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set risk_status = v_result, risk_result = coalesce(risk_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'risk_dimension', p_payload), innovation_history = innovation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_portfolio_reviewed' then
    if coalesce(p_payload->>'portfolio_dimension','') not in ('portfolio_balance','strategic_alignment','investment_diversity','innovation_coverage','long_term_sustainability') then
      raise exception '허용되지 않는 portfolio_dimension(§7 — 5종)';
    end if;
    if v_result not in ('highly_balanced_candidate','balanced_candidate','partially_balanced_candidate','imbalanced_candidate','insufficient_data') then raise exception '허용되지 않는 portfolio result(§7 — 5종)'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set portfolio_status = v_result, portfolio_result = coalesce(portfolio_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'portfolio_dimension', p_payload), innovation_history = innovation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_readiness_reviewed' then
    if v_result not in ('highly_ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data') then raise exception '허용되지 않는 readiness result'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set readiness_result = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'future_opportunity_reviewed' then
    -- Potential ≠ Outcome — Evidence 없이 미래 기회 기록 차단.
    if v_result not in ('high_potential_candidate','moderate_potential_candidate','low_potential_candidate','potential_unverified','insufficient_data') then raise exception '허용되지 않는 future opportunity result'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Future Opportunity 기록 금지';
    end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set future_opportunity_result = p_payload, innovation_history = innovation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'technology_opportunity_reviewed' then
    if v_result not in ('strategic_technology_candidate','emerging_technology_candidate','commodity_technology_candidate','technology_unverified','insufficient_data') then raise exception '허용되지 않는 technology result'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set technology_result = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'market_potential_reviewed' then
    if v_result not in ('large_market_candidate','niche_market_candidate','saturated_market_candidate','market_unverified','insufficient_data') then raise exception '허용되지 않는 market result'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set market_result = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'mission_alignment_reviewed' then
    if v_result not in ('strongly_aligned_candidate','partially_aligned_candidate','misaligned_candidate','alignment_unverified','insufficient_data') then raise exception '허용되지 않는 alignment result'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set alignment_result = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_priority_reviewed' then
    if v_result not in ('high_priority_candidate','medium_priority_candidate','low_priority_candidate','priority_unverified','insufficient_data') then raise exception '허용되지 않는 priority result'; end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set priority_result = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_timeline_recorded' and p_innovation_id is not null then
    update public.ai_enterprise_innovations set innovation_history = innovation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id;
  end if;
  if p_kind = 'executive_innovation_scorecard_recorded' and p_innovation_id is not null then
    update public.ai_enterprise_innovations set scorecard_result = p_payload, updated_at = now() where id = p_innovation_id;
  end if;
  if p_kind = 'innovation_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_innovation_candidate','review_innovation_opportunity','review_innovation_risk','review_innovation_portfolio','review_innovation_readiness','review_future_opportunity','review_technology_opportunity','review_market_potential','review_mission_alignment','review_innovation_priority','record_innovation_timeline','build_executive_innovation_summary','build_executive_innovation_scorecard','request_innovation_review','request_executive_review','request_human_review','record_innovation_learning','link_improvement_reference','link_transformation_reference','link_scenario_reference','pilot_review_candidate','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Innovation Recommendation 금지';
    end if;
    if p_innovation_id is not null then update public.ai_enterprise_innovations set recommendation_candidate = p_payload, updated_at = now() where id = p_innovation_id; end if;
  end if;
  if p_kind = 'innovation_learning_recorded' and p_innovation_id is not null then
    update public.ai_enterprise_innovations set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_innovation_id;
  end if;
  if p_kind = 'improvement_reference_linked' and nullif(p_payload->>'improvement_id','') is not null
     and not exists (select 1 from public.ai_enterprise_improvements where id = (p_payload->>'improvement_id')::uuid) then
    raise exception 'Improvement 없음(실존 검증 실패 — 0561)';
  end if;
  if p_kind = 'transformation_reference_linked' and nullif(p_payload->>'transformation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid) then
    raise exception 'Transformation 없음(실존 검증 실패 — 0560)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'value_realization_id','') is not null
     and not exists (select 1 from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid) then
    raise exception 'Value Realization 없음(실존 검증 실패 — 0559)';
  end if;
  if p_kind = 'capacity_reference_linked' and nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패 — 0558)';
  end if;
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'environment_reference_linked' and nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_innovation_events (event_type, innovation_id, innovation_review_id, detail, payload, actor_id)
  values (p_kind, p_innovation_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'innovation_opportunity_reviewed' then ' (Opportunity ≠ Guaranteed Success)'
      when p_kind = 'innovation_risk_reviewed' then ' (Risk 관측 후보 ≠ 실패 확정)'
      when p_kind = 'innovation_portfolio_reviewed' then ' (Portfolio 관측 ≠ Portfolio 변경)'
      when p_kind = 'innovation_readiness_reviewed' then ' (Readiness ≠ Success)'
      when p_kind = 'future_opportunity_reviewed' then ' (Potential ≠ Outcome — Forecast ≠ Future Fact)'
      when p_kind = 'technology_opportunity_reviewed' then ' (Technology 관측 후보 ≠ 도입 결정)'
      when p_kind = 'market_potential_reviewed' then ' (Market Potential ≠ 시장 확정)'
      when p_kind = 'mission_alignment_reviewed' then ' (Alignment 관측 ≠ Mission 변경)'
      when p_kind = 'innovation_priority_reviewed' then ' (Priority ≠ Mandatory Order)'
      when p_kind = 'innovation_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_innovation_summary_recorded' then ' (Summary ≠ 사업 시작 확정)'
      when p_kind = 'executive_innovation_scorecard_recorded' then ' (Scorecard ≠ 투자 지시)'
      when p_kind = 'innovation_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'innovation_review_requested' then ' (Innovation Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — Innovation 실행은 사람)'
      when p_kind = 'innovation_learning_recorded' then ' (Innovation Learning ≠ 자동 사업 시작)'
      when p_kind = 'improvement_reference_linked' then ' (Improvement Reference ≠ 개선 적용 — 0561 참조만)'
      when p_kind = 'transformation_reference_linked' then ' (Transformation Reference ≠ 조직 변경 — 0560 참조만)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 투자 결정 — 0559 참조만)'
      when p_kind = 'capacity_reference_linked' then ' (Capacity Reference ≠ 자원 재배치 — 0558 참조만)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'environment_reference_linked' then ' (Environment Reference ≠ 전략 변경 — 0556 참조만)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'business_launched', false, 'product_launched', false, 'investment_approved', false, 'budget_changed', false, 'organization_changed', false, 'strategy_changed', false, 'contract_signed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_innovations_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_innovations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_innovations
  where (p_status is null or innovation_status = p_status)
    and (p_category is null or innovation_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_innovation_reviews_list(p_innovation_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_innovation_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_innovation_reviews
  where (p_innovation_id is null or innovation_id = p_innovation_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_innovation_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'innovations', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_innovations),
      'discovered', (select count(*) from public.ai_enterprise_innovations where innovation_status = 'discovered'),
      'candidate', (select count(*) from public.ai_enterprise_innovations where innovation_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_innovations where innovation_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_innovations where innovation_status = 'archived_reference'),
      'exceptional', (select count(*) from public.ai_enterprise_innovations where opportunity_status = 'exceptional_candidate'),
      'strong', (select count(*) from public.ai_enterprise_innovations where opportunity_status = 'strong_candidate'),
      'weak', (select count(*) from public.ai_enterprise_innovations where opportunity_status = 'weak_candidate'),
      'critical_risk', (select count(*) from public.ai_enterprise_innovations where risk_status in ('critical_risk_candidate','elevated_risk_candidate')),
      'low_risk', (select count(*) from public.ai_enterprise_innovations where risk_status in ('low_risk_candidate','manageable_risk_candidate')),
      'balanced', (select count(*) from public.ai_enterprise_innovations where portfolio_status in ('highly_balanced_candidate','balanced_candidate')),
      'imbalanced', (select count(*) from public.ai_enterprise_innovations where portfolio_status in ('partially_balanced_candidate','imbalanced_candidate')),
      'by_category', (select coalesce(jsonb_object_agg(innovation_category, cnt), '{}'::jsonb) from (select innovation_category, count(*) cnt from public.ai_enterprise_innovations group by innovation_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_innovation_reviews),
      'requested', (select count(*) from public.ai_enterprise_innovation_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_innovation_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_innovation_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_innovation_reviews where review_status = 'revision_requested')
    ),
    'innovation_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_innovation_events),
      'opportunity_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_opportunity_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_risk_reviewed'),
      'portfolio_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_portfolio_reviewed'),
      'readiness_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_readiness_reviewed'),
      'future_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'future_opportunity_reviewed'),
      'technology_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'technology_opportunity_reviewed'),
      'market_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'market_potential_reviewed'),
      'alignment_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'mission_alignment_reviewed'),
      'priority_reviews', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_priority_reviewed'),
      'timelines', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'executive_innovation_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'executive_innovation_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_recommendation_recorded'),
      'innovation_review_requests', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'innovation_learning_recorded'),
      'improvement_links', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'improvement_reference_linked'),
      'transformation_links', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'transformation_reference_linked'),
      'scenario_links', (select count(*) from public.ai_enterprise_innovation_events where event_type = 'scenario_reference_linked')
    ),
    -- Innovation 원천 실측(전부 읽기 전용):
    'innovation_actuals', jsonb_build_object(
      'improvements_0561', (select count(*) from public.ai_enterprise_improvements),
      'transformations_0560', (select count(*) from public.ai_enterprise_transformations),
      'value_realizations_0559', (select count(*) from public.ai_enterprise_value_realizations),
      'capacity_resources_0558', (select count(*) from public.ai_enterprise_capacity_resources),
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'innovation_unavailable', jsonb_build_array('market_research_feed','patent_database_feed','startup_ecosystem_feed','technology_radar_feed','customer_insight_feed','rnd_lab_system'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'opportunity_is_not_guaranteed_success', true, 'innovation_is_not_business_success', true,
    'potential_is_not_outcome', true, 'forecast_is_not_future_fact', true,
    'correlation_is_not_causation', true, 'recommendation_is_not_decision', true,
    'priority_is_not_mandatory_order', true, 'confidence_is_not_certainty', true,
    'no_auto_business_launch', true, 'no_auto_product_launch', true, 'no_auto_investment_approval', true,
    'no_auto_budget_change', true, 'no_auto_organization_change', true, 'no_auto_strategy_change', true,
    'no_auto_contract_signing', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_innovation_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_innovation_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_innovation_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_innovations enable row level security;
alter table public.ai_enterprise_innovation_reviews enable row level security;
alter table public.ai_enterprise_innovation_events enable row level security;

comment on table public.ai_enterprise_innovations is 'AI-OPS-58 — Innovation(≠ 사업 원장·Category 11종·자동 사업 시작 차단·Opportunity ≠ Guaranteed Success).';
comment on table public.ai_enterprise_innovation_reviews is 'AI-OPS-58 — Innovation Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_innovation_events is 'AI-OPS-58 — Innovation 이벤트 31종(자동 사업 시작 이벤트 생성 금지·Potential ≠ Outcome).';
