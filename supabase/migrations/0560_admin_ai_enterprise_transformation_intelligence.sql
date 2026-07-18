-- 0560_admin_ai_enterprise_transformation_intelligence.sql
-- AI-OPS-56 — Enterprise Transformation Intelligence, Change Management &
-- Organizational Evolution Center.
--
-- Enterprise Vision → Mission → Strategy → Execution → Value Optimization →
-- Transformation Candidates → Change Impact Analysis → Transformation
-- Readiness → Stakeholder Analysis → Organizational Evolution → Executive
-- Transformation Review → Transformation Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Readiness ≠ Successful Transformation — 조직 자동 개편/인사 자동 이동/
--    전략 자동 변경/Budget 자동 변경/KPI 자동 변경/Project 자동 생성/계약
--    자동 변경 RPC 자체가 없음.
--  * Change Impact ≠ Actual Outcome. Recommendation ≠ Decision.
--    Priority ≠ Mandatory Order. Organizational Evolution ≠ Automatic Change.
--  * Forecast ≠ Future Fact. Pattern ≠ Causality. Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0547/0549/0551/0552/0555/0556/
--    0557/0558/0559 원본 무변경(참조만).
--  * 이름 실측: ai_enterprise_transformations / transformation_reviews /
--    transformation_events · admin_enterprise_transformation_* 전부 미사용
--    확인 — 스펙 권장명 그대로 사용(충돌 없음).
--  * HR 정보 시스템/직원 설문/변화관리 도구/조직도 시스템/교육 플랫폼/문화
--    진단 피드는 실측 부재 — insufficient_data 로 유지(분석은 수동 기록 기반).
--  * Transformation Timeline/Change·Readiness·Stakeholder·Evolution History 는
--    신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Transformation(≠ 조직 개편 원장 — 변화 후보 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_transformations (
  id                        uuid primary key default gen_random_uuid(),
  transformation_code       text not null,
  transformation_name       text not null,
  transformation_category   text not null check (transformation_category in ('organization','strategy','operations','process','technology','product','portfolio','governance','workforce','executive','enterprise','custom')),
  transformation_status     text not null default 'proposed' check (transformation_status in ('proposed','candidate','review_reference','archived_reference','insufficient_data')),
  transformation_summary    text,
  impact_status             text not null default 'insufficient_data' check (impact_status in ('high_impact_candidate','moderate_impact_candidate','low_impact_candidate','uncertain_candidate','insufficient_data')),
  readiness_status          text not null default 'insufficient_data' check (readiness_status in ('highly_ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data')),
  stakeholder_status        text not null default 'insufficient_data' check (stakeholder_status in ('highly_affected_candidate','moderately_affected_candidate','minimally_affected_candidate','unknown_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  value_realization_id      uuid,
  organization_model_id     uuid,
  decision_scenario_id      uuid,
  execution_program_id      uuid,
  impact_result             jsonb,
  readiness_result          jsonb,
  stakeholder_result        jsonb,
  evolution_result          jsonb,
  dependency_result         jsonb,
  priority_result           jsonb,
  risk_result               jsonb,
  resistance_result         jsonb,
  alignment_result          jsonb,
  scorecard_result          jsonb,
  transformation_history    jsonb not null default '[]'::jsonb,   -- Transformation Timeline/Change·Readiness·Stakeholder·Evolution History 통합 append
  recommendation_candidate  jsonb,
  transformation_reviews    jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aetf_idem on public.ai_enterprise_transformations (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aetf_status on public.ai_enterprise_transformations (transformation_status, transformation_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Transformation Review(§9 — 요청/Reference 기록만, 실행은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_transformation_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  transformation_id         uuid not null,
  review_type               text not null check (review_type in ('transformation_review','executive_review','human_review')),
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
create unique index if not exists uq_aetr_idem on public.ai_enterprise_transformation_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aetr_tf on public.ai_enterprise_transformation_reviews (transformation_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Transformation 이벤트(31종) — Impact/Readiness/Stakeholder/Evolution/
--    Dependency/Priority/Risk/Resistance/Alignment/Timeline/Scorecard/
--    Recommendation/Review/Learning/Link 통합 Audit(자동 조직 개편 이벤트
--    생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_transformation_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('transformation_created','transformation_reviewed','change_impact_reviewed','transformation_readiness_reviewed','stakeholder_analysis_reviewed','organizational_evolution_reviewed','change_dependency_recorded','transformation_priority_reviewed','change_risk_reviewed','resistance_analysis_reviewed','mission_alignment_reviewed','transformation_timeline_recorded','executive_transformation_summary_recorded','executive_transformation_scorecard_recorded','change_recommendation_recorded','transformation_review_created','transformation_review_reviewed','transformation_review_requested','executive_review_requested','human_review_requested','transformation_review_reference_recorded','transformation_revision_requested','transformation_learning_recorded','value_reference_linked','organization_reference_linked','scenario_reference_linked','program_reference_linked','mission_reference_linked','environment_reference_linked','governance_reference_linked','capacity_reference_linked')),
  transformation_id         uuid,
  transformation_review_id  uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aetfe_evt on public.ai_enterprise_transformation_events (event_type, created_at desc);
create index if not exists idx_aetfe_tf on public.ai_enterprise_transformation_events (transformation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Transformation 생성 — 자동 조직 개편 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_transformation_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_transformations;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'transformation_category','');
  -- 자동 조직 개편/인사 이동/전략·Budget·KPI 변경/Project 생성/계약 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_reorganization','automatic_personnel_transfer','automatic_strategy_change','automatic_budget_change','automatic_kpi_change','automatic_project_creation','automatic_contract_change') then
    raise exception '금지된 transformation_category(자동 조직 개편 계열 비활성)';
  end if;
  if v_cat not in ('organization','strategy','operations','process','technology','product','portfolio','governance','workforce','executive','enterprise','custom') then
    raise exception '허용되지 않는 transformation_category';
  end if;
  if coalesce(btrim(p_payload->>'transformation_name'),'') = '' then raise exception 'transformation_name 필수'; end if;
  if nullif(p_payload->>'value_realization_id','') is not null
     and not exists (select 1 from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid) then
    raise exception 'Value Realization 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_transformations where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'readiness_is_not_successful_transformation', true); end if;
  end if;
  insert into public.ai_enterprise_transformations (transformation_code, transformation_name, transformation_category, transformation_summary, value_realization_id, organization_model_id, decision_scenario_id, execution_program_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'transformation_code',''), 'ETF-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'transformation_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'transformation_summary',''), 2000),''),
    nullif(p_payload->>'value_realization_id','')::uuid, nullif(p_payload->>'organization_model_id','')::uuid,
    nullif(p_payload->>'decision_scenario_id','')::uuid, nullif(p_payload->>'execution_program_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, detail, payload, actor_id)
  values ('transformation_created', v_id, left(v_cat, 80) || ' (Transformation 후보 — 자동 조직 개편 없음)', jsonb_build_object('transformation_name', p_payload->>'transformation_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'proposed', 'readiness_is_not_successful_transformation', true, 'reorganization_applied', false, 'personnel_moved', false, 'strategy_changed', false, 'budget_changed', false, 'kpi_changed', false, 'project_created', false, 'contract_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Transformation 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_transformation_review(p_transformation_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_transformations; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'transformation_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_proposed','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_transformations where id = p_transformation_id;
  if v_row.id is null then raise exception 'Transformation 없음(실존 검증 실패)'; end if;
  if v_row.transformation_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_proposed' then v_next := 'proposed'; v_note := ' (제안 상태 표시 ≠ 실행 결정)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 조직 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Transformation Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 조직 변경은 사람)'; v_evt := 'transformation_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'reorganization_applied', false, 'strategy_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_transformations set review_reference = v_ref, transformation_reviews = transformation_reviews || jsonb_build_array(v_ref) where id = p_transformation_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_transformations set transformation_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_transformation_id;
  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, detail, payload, actor_id)
  values (v_evt, p_transformation_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_transformation_id, 'status', v_next, 'readiness_is_not_successful_transformation', true, 'reorganization_applied', false, 'personnel_moved', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Transformation Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_transformation_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_tf public.ai_enterprise_transformations; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_transformation_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('transformation_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'transformation_id','') is null then raise exception 'transformation_id 필수'; end if;
  select * into v_tf from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid;
  if v_tf.id is null then raise exception 'Transformation 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_transformation_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_transformation_reviews (review_code, transformation_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'ETR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_tf.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'transformation_review' then 'transformation_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, transformation_review_id, detail, payload, actor_id)
  values (v_evt, v_tf.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 조직 변경은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, transformation_review_id, detail, payload, actor_id)
  values ('transformation_review_created', v_tf.id, v_id, 'Transformation Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'reorganization_applied', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_transformation_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_transformation_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_transformation_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Transformation Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'reorganization_applied', false, 'personnel_moved', false, 'strategy_changed', false,
    'budget_changed', false, 'kpi_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 조직 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Transformation Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 조직 변경은 사람)';
    update public.ai_enterprise_transformation_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_transformations set
      transformation_reviews = transformation_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.transformation_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_transformation_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, transformation_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'transformation_review_reference_recorded' when p_action = 'request_revision' then 'transformation_revision_requested' else 'transformation_review_reviewed' end,
    v_row.transformation_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'reorganization_applied', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Transformation 이벤트 기록(통합) — 자동 조직 개편 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_transformation_event_record(p_kind text, p_reason text, p_payload jsonb, p_transformation_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('change_impact_reviewed','transformation_readiness_reviewed','stakeholder_analysis_reviewed','organizational_evolution_reviewed','change_dependency_recorded','transformation_priority_reviewed','change_risk_reviewed','resistance_analysis_reviewed','mission_alignment_reviewed','transformation_timeline_recorded','executive_transformation_summary_recorded','executive_transformation_scorecard_recorded','change_recommendation_recorded','transformation_review_requested','executive_review_requested','human_review_requested','transformation_learning_recorded','value_reference_linked','organization_reference_linked','scenario_reference_linked','program_reference_linked','mission_reference_linked','environment_reference_linked','governance_reference_linked','capacity_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_transformation_id is not null and not exists (select 1 from public.ai_enterprise_transformations where id = p_transformation_id) then raise exception 'Transformation 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_transformation_reviews where id = p_review_id) then raise exception 'Transformation Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'change_impact_reviewed' then
    if coalesce(p_payload->>'impact_dimension','') not in ('organizational_impact','operational_impact','financial_impact','strategic_impact','cultural_impact') then
      raise exception '허용되지 않는 impact_dimension(§5 — 5종)';
    end if;
    if v_result not in ('high_impact_candidate','moderate_impact_candidate','low_impact_candidate','uncertain_candidate','insufficient_data') then raise exception '허용되지 않는 impact result(§5 — 5종)'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set impact_status = v_result, impact_result = coalesce(impact_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'impact_dimension', p_payload), transformation_history = transformation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'transformation_readiness_reviewed' then
    if coalesce(p_payload->>'readiness_dimension','') not in ('leadership_readiness','workforce_readiness','process_readiness','technology_readiness','governance_readiness') then
      raise exception '허용되지 않는 readiness_dimension(§6 — 5종)';
    end if;
    if v_result not in ('highly_ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data') then raise exception '허용되지 않는 readiness result(§6 — 5종)'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set readiness_status = v_result, readiness_result = coalesce(readiness_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'readiness_dimension', p_payload), transformation_history = transformation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'stakeholder_analysis_reviewed' then
    if coalesce(p_payload->>'stakeholder_group','') not in ('executive','management','workforce','partner','customer') then
      raise exception '허용되지 않는 stakeholder_group(§7 — 5종)';
    end if;
    if v_result not in ('highly_affected_candidate','moderately_affected_candidate','minimally_affected_candidate','unknown_candidate','insufficient_data') then raise exception '허용되지 않는 stakeholder result(§7 — 5종)'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set stakeholder_status = v_result, stakeholder_result = coalesce(stakeholder_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'stakeholder_group', p_payload), transformation_history = transformation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'organizational_evolution_reviewed' then
    if v_result not in ('evolution_ready_candidate','evolution_in_progress_candidate','evolution_stalled_candidate','evolution_unverified','insufficient_data') then raise exception '허용되지 않는 evolution result'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set evolution_result = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'change_dependency_recorded' and p_transformation_id is not null then
    -- Change Dependency 는 JSONB 통합(Dependency ≠ 자동 조정).
    update public.ai_enterprise_transformations set dependency_result = p_payload, updated_at = now() where id = p_transformation_id;
  end if;
  if p_kind = 'transformation_priority_reviewed' then
    if v_result not in ('high_priority_candidate','medium_priority_candidate','low_priority_candidate','priority_unverified','insufficient_data') then raise exception '허용되지 않는 priority result'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set priority_result = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'change_risk_reviewed' then
    if v_result not in ('critical_risk_candidate','elevated_risk_candidate','manageable_risk_candidate','negligible_risk_candidate','insufficient_data') then raise exception '허용되지 않는 change risk result'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set risk_result = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'resistance_analysis_reviewed' then
    if v_result not in ('high_resistance_candidate','moderate_resistance_candidate','low_resistance_candidate','resistance_unverified','insufficient_data') then raise exception '허용되지 않는 resistance result'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set resistance_result = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'mission_alignment_reviewed' then
    if v_result not in ('strongly_aligned_candidate','partially_aligned_candidate','misaligned_candidate','alignment_unverified','insufficient_data') then raise exception '허용되지 않는 alignment result'; end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set alignment_result = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'transformation_timeline_recorded' and p_transformation_id is not null then
    update public.ai_enterprise_transformations set transformation_history = transformation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_transformation_id;
  end if;
  if p_kind = 'executive_transformation_scorecard_recorded' and p_transformation_id is not null then
    update public.ai_enterprise_transformations set scorecard_result = p_payload, updated_at = now() where id = p_transformation_id;
  end if;
  if p_kind = 'change_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_transformation_candidate','review_change_impact','review_transformation_readiness','review_stakeholder_analysis','review_organizational_evolution','record_change_dependency','review_transformation_priority','review_change_risk','review_resistance_analysis','review_mission_alignment','record_transformation_timeline','build_executive_transformation_summary','build_executive_transformation_scorecard','request_transformation_review','request_executive_review','request_human_review','record_transformation_learning','link_value_reference','link_organization_reference','link_capacity_reference','phased_rollout_review_candidate','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Change Recommendation 금지';
    end if;
    if p_transformation_id is not null then update public.ai_enterprise_transformations set recommendation_candidate = p_payload, updated_at = now() where id = p_transformation_id; end if;
  end if;
  if p_kind = 'transformation_learning_recorded' and p_transformation_id is not null then
    update public.ai_enterprise_transformations set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_transformation_id;
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'value_realization_id','') is not null
     and not exists (select 1 from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid) then
    raise exception 'Value Realization 없음(실존 검증 실패 — 0559)';
  end if;
  if p_kind = 'organization_reference_linked' and nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'environment_reference_linked' and nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if p_kind = 'capacity_reference_linked' and nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패 — 0558)';
  end if;

  insert into public.ai_enterprise_transformation_events (event_type, transformation_id, transformation_review_id, detail, payload, actor_id)
  values (p_kind, p_transformation_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'change_impact_reviewed' then ' (Change Impact ≠ Actual Outcome)'
      when p_kind = 'transformation_readiness_reviewed' then ' (Readiness ≠ Successful Transformation)'
      when p_kind = 'stakeholder_analysis_reviewed' then ' (Stakeholder 관측 ≠ 개인 평가)'
      when p_kind = 'organizational_evolution_reviewed' then ' (Organizational Evolution ≠ Automatic Change)'
      when p_kind = 'change_dependency_recorded' then ' (Dependency 기록 ≠ 자동 조정)'
      when p_kind = 'transformation_priority_reviewed' then ' (Priority ≠ Mandatory Order)'
      when p_kind = 'change_risk_reviewed' then ' (Change Risk 관측 ≠ 실패 확정)'
      when p_kind = 'resistance_analysis_reviewed' then ' (저항 관측 후보 ≠ 개인/조직 판정)'
      when p_kind = 'mission_alignment_reviewed' then ' (Alignment 관측 ≠ Mission 변경)'
      when p_kind = 'transformation_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_transformation_summary_recorded' then ' (Summary ≠ 조직 변경 확정)'
      when p_kind = 'executive_transformation_scorecard_recorded' then ' (Scorecard ≠ 개편 지시)'
      when p_kind = 'change_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'transformation_review_requested' then ' (Transformation Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — 조직 변경은 사람)'
      when p_kind = 'transformation_learning_recorded' then ' (Transformation Learning ≠ 자동 조직 변경)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 투자 결정 — 0559 참조만)'
      when p_kind = 'organization_reference_linked' then ' (Organization Reference ≠ 조직 변경 — 0552 참조만)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'environment_reference_linked' then ' (Environment Reference ≠ 전략 변경 — 0556 참조만)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인 — 0551 참조만)'
      when p_kind = 'capacity_reference_linked' then ' (Capacity Reference ≠ 자원 재배치 — 0558 참조만)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'reorganization_applied', false, 'personnel_moved', false, 'strategy_changed', false, 'budget_changed', false, 'kpi_changed', false, 'project_created', false, 'contract_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_transformations_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_transformations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_transformations
  where (p_status is null or transformation_status = p_status)
    and (p_category is null or transformation_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_transformation_reviews_list(p_transformation_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_transformation_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_transformation_reviews
  where (p_transformation_id is null or transformation_id = p_transformation_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_transformation_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'transformations', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_transformations),
      'proposed', (select count(*) from public.ai_enterprise_transformations where transformation_status = 'proposed'),
      'candidate', (select count(*) from public.ai_enterprise_transformations where transformation_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_transformations where transformation_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_transformations where transformation_status = 'archived_reference'),
      'high_impact', (select count(*) from public.ai_enterprise_transformations where impact_status = 'high_impact_candidate'),
      'uncertain_impact', (select count(*) from public.ai_enterprise_transformations where impact_status = 'uncertain_candidate'),
      'ready', (select count(*) from public.ai_enterprise_transformations where readiness_status in ('highly_ready_candidate','mostly_ready_candidate')),
      'not_ready', (select count(*) from public.ai_enterprise_transformations where readiness_status in ('partially_ready_candidate','not_ready_candidate')),
      'highly_affected', (select count(*) from public.ai_enterprise_transformations where stakeholder_status = 'highly_affected_candidate'),
      'by_category', (select coalesce(jsonb_object_agg(transformation_category, cnt), '{}'::jsonb) from (select transformation_category, count(*) cnt from public.ai_enterprise_transformations group by transformation_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_transformation_reviews),
      'requested', (select count(*) from public.ai_enterprise_transformation_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_transformation_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_transformation_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_transformation_reviews where review_status = 'revision_requested')
    ),
    'transformation_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_transformation_events),
      'impact_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'change_impact_reviewed'),
      'readiness_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_readiness_reviewed'),
      'stakeholder_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'stakeholder_analysis_reviewed'),
      'evolution_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'organizational_evolution_reviewed'),
      'dependency_records', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'change_dependency_recorded'),
      'priority_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_priority_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'change_risk_reviewed'),
      'resistance_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'resistance_analysis_reviewed'),
      'alignment_reviews', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'mission_alignment_reviewed'),
      'timelines', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'executive_transformation_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'executive_transformation_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'change_recommendation_recorded'),
      'transformation_review_requests', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'transformation_learning_recorded'),
      'value_links', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'value_reference_linked'),
      'organization_links', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'organization_reference_linked'),
      'capacity_links', (select count(*) from public.ai_enterprise_transformation_events where event_type = 'capacity_reference_linked')
    ),
    -- Transformation 원천 실측(전부 읽기 전용):
    'transformation_actuals', jsonb_build_object(
      'value_realizations_0559', (select count(*) from public.ai_enterprise_value_realizations),
      'capacity_resources_0558', (select count(*) from public.ai_enterprise_capacity_resources),
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'organization_models_0552', (select count(*) from public.ai_enterprise_organization_models),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'transformation_unavailable', jsonb_build_array('hr_information_system','employee_survey_feed','change_management_tool_feed','org_chart_system','training_platform_feed','culture_assessment_feed'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'readiness_is_not_successful_transformation', true, 'change_impact_is_not_actual_outcome', true,
    'recommendation_is_not_decision', true, 'priority_is_not_mandatory_order', true,
    'evolution_is_not_automatic_change', true, 'correlation_is_not_causation', true,
    'forecast_is_not_future_fact', true, 'pattern_is_not_causality', true, 'confidence_is_not_certainty', true,
    'no_auto_reorganization', true, 'no_auto_personnel_transfer', true, 'no_auto_strategy_change', true,
    'no_auto_budget_change', true, 'no_auto_kpi_change', true, 'no_auto_project_creation', true,
    'no_auto_contract_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_transformation_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_transformation_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_transformation_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_transformations enable row level security;
alter table public.ai_enterprise_transformation_reviews enable row level security;
alter table public.ai_enterprise_transformation_events enable row level security;

comment on table public.ai_enterprise_transformations is 'AI-OPS-56 — Transformation(≠ 조직 개편 원장·Category 12종·자동 조직 개편 차단·Readiness ≠ Successful Transformation).';
comment on table public.ai_enterprise_transformation_reviews is 'AI-OPS-56 — Transformation Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_transformation_events is 'AI-OPS-56 — Transformation 이벤트 31종(자동 조직 개편 이벤트 생성 금지·Change Impact ≠ Actual Outcome).';
