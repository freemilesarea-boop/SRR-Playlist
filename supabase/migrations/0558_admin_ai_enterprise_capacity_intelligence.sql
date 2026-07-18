-- 0558_admin_ai_enterprise_capacity_intelligence.sql
-- AI-OPS-54 — Enterprise Resource Intelligence, Capacity Planning &
-- Constraint Optimization Center.
--
-- Enterprise Vision → Mission → Strategy → Scenario → Resource Inventory →
-- Capacity Planning → Constraint Detection → Dependency Analysis →
-- Execution Readiness → Optimization Candidates → Executive Resource
-- Review → Resource Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Capacity ≠ Guaranteed Delivery — Resource 자동 재배치/인력 자동 이동/
--    Budget 자동 변경/Project 자동 시작·종료/계약 자동 체결·종료/Organization
--    자동 변경 RPC 자체가 없음.
--  * Bottleneck ≠ Root Cause. Constraint ≠ Failure. Optimization ≠ Automatic
--    Improvement. Readiness ≠ Success. Recommendation ≠ Decision.
--  * Forecast ≠ Future Fact. Pattern ≠ Causality. Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0520/0545/0546/0547/0551/0552/
--    0555/0556/0557 원본 무변경(참조만).
--  * 이름 충돌 실측: 0546(AI-OPS-42)이 ai_enterprise_resource_events ·
--    admin_enterprise_resource_* 를 이미 사용 → 본 계층은
--    ai_enterprise_capacity_* / admin_enterprise_capacity_* 로 명명(별개
--    계층·원본 무변경).
--  * HR 캐파 시스템/타임트래킹/ERP 재무 원장/자원 예약/PM 도구/클라우드 비용
--    피드는 실측 부재 — insufficient_data 로 유지(분석은 수동 기록 기반).
--  * Capacity Timeline/Resource·Constraint·Optimization History/Dependency
--    Graph 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Capacity Resource(≠ 자원 배치 원장 — 용량/제약 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_capacity_resources (
  id                        uuid primary key default gen_random_uuid(),
  resource_code             text not null,
  resource_name             text not null,
  resource_category         text not null check (resource_category in ('workforce','budget','infrastructure','technology','operations','ai','project','portfolio','vendor','executive','enterprise','custom')),
  resource_status           text not null default 'insufficient_data' check (resource_status in ('available','constrained','overloaded','underutilized','review_reference','archived_reference','insufficient_data')),
  resource_summary          text,
  capacity_status           text not null default 'insufficient_data' check (capacity_status in ('sufficient_candidate','constrained_candidate','overloaded_candidate','unavailable_candidate','insufficient_data')),
  constraint_status         text not null default 'insufficient_data' check (constraint_status in ('critical_constraint_candidate','elevated_constraint_candidate','manageable_constraint_candidate','negligible_constraint_candidate','insufficient_data')),
  readiness_status          text not null default 'insufficient_data' check (readiness_status in ('ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  decision_scenario_id      uuid,
  execution_program_id      uuid,
  organization_model_id     uuid,
  strategy_portfolio_id     uuid,
  capacity_result           jsonb,
  constraint_result         jsonb,
  readiness_result          jsonb,
  utilization_result        jsonb,
  workload_result           jsonb,
  budget_result             jsonb,
  dependency_result         jsonb,
  bottleneck_result         jsonb,
  optimization_candidates   jsonb not null default '[]'::jsonb,
  scorecard_result          jsonb,
  capacity_history          jsonb not null default '[]'::jsonb,   -- Capacity Timeline/Resource·Constraint·Optimization History 통합 append
  recommendation_candidate  jsonb,
  resource_reviews          jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aecr_idem on public.ai_enterprise_capacity_resources (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aecr_status on public.ai_enterprise_capacity_resources (resource_status, resource_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Capacity Review(§9 — 요청/Reference 기록만, Resource 변경은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_capacity_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  capacity_resource_id      uuid not null,
  review_type               text not null check (review_type in ('resource_review','executive_review','human_review')),
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
create unique index if not exists uq_aecv_idem on public.ai_enterprise_capacity_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aecv_res on public.ai_enterprise_capacity_reviews (capacity_resource_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Capacity 이벤트(31종) — Inventory/Capacity/Constraint/Dependency/
--    Utilization/Workload/Budget/Readiness/Bottleneck/Optimization/Timeline/
--    Scorecard/Recommendation/Review/Learning/Link 통합 Audit(자동 재배치
--    이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_capacity_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('capacity_resource_created','capacity_resource_reviewed','resource_inventory_reviewed','capacity_assessment_reviewed','constraint_analysis_reviewed','dependency_mapping_recorded','resource_utilization_reviewed','workload_analysis_reviewed','budget_capacity_reviewed','execution_readiness_reviewed','bottleneck_detection_reviewed','optimization_candidate_recorded','capacity_timeline_recorded','executive_resource_summary_recorded','executive_resource_scorecard_recorded','resource_recommendation_recorded','capacity_review_created','capacity_review_reviewed','resource_review_requested','executive_review_requested','human_review_requested','capacity_review_reference_recorded','capacity_revision_requested','resource_learning_recorded','scenario_reference_linked','program_reference_linked','organization_reference_linked','portfolio_reference_linked','mission_reference_linked','commitment_reference_linked','inventory_reference_linked')),
  capacity_resource_id      uuid,
  capacity_review_id        uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aece_evt on public.ai_enterprise_capacity_events (event_type, created_at desc);
create index if not exists idx_aece_res on public.ai_enterprise_capacity_events (capacity_resource_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Capacity Resource 생성 — 자동 재배치 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_capacity_resource_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_capacity_resources;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'resource_category','');
  -- 자동 재배치/인력 이동/Budget·Project·계약·조직 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_resource_reallocation','automatic_personnel_transfer','automatic_budget_change','automatic_project_start','automatic_project_termination','automatic_contract_change','automatic_organization_change') then
    raise exception '금지된 resource_category(자동 재배치 계열 비활성)';
  end if;
  if v_cat not in ('workforce','budget','infrastructure','technology','operations','ai','project','portfolio','vendor','executive','enterprise','custom') then
    raise exception '허용되지 않는 resource_category';
  end if;
  if coalesce(btrim(p_payload->>'resource_name'),'') = '' then raise exception 'resource_name 필수'; end if;
  if nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_capacity_resources where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'capacity_is_not_guaranteed_delivery', true); end if;
  end if;
  insert into public.ai_enterprise_capacity_resources (resource_code, resource_name, resource_category, resource_summary, decision_scenario_id, execution_program_id, organization_model_id, strategy_portfolio_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'resource_code',''), 'ECR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'resource_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'resource_summary',''), 2000),''),
    nullif(p_payload->>'decision_scenario_id','')::uuid, nullif(p_payload->>'execution_program_id','')::uuid,
    nullif(p_payload->>'organization_model_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, detail, payload, actor_id)
  values ('capacity_resource_created', v_id, left(v_cat, 80) || ' (Capacity 관측 Candidate — 자동 재배치 없음)', jsonb_build_object('resource_name', p_payload->>'resource_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'insufficient_data', 'capacity_is_not_guaranteed_delivery', true, 'resource_reallocated', false, 'personnel_moved', false, 'budget_changed', false, 'project_started', false, 'project_terminated', false, 'contract_changed', false, 'organization_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Capacity Resource 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_capacity_resource_review(p_resource_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_capacity_resources; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'capacity_resource_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_available','mark_constrained','mark_overloaded','mark_underutilized','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_capacity_resources where id = p_resource_id;
  if v_row.id is null then raise exception 'Capacity Resource 없음(실존 검증 실패)'; end if;
  if v_row.resource_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_available' then v_next := 'available'; v_note := ' (관측 상태 표시 ≠ 배치 변경)';
  elsif p_action = 'mark_constrained' then v_next := 'constrained'; v_note := ' (Constraint ≠ Failure)';
  elsif p_action = 'mark_overloaded' then v_next := 'overloaded'; v_note := ' (Overload 관측 ≠ 개인 평가)';
  elsif p_action = 'mark_underutilized' then v_next := 'underutilized'; v_note := ' (Underutilized 관측 ≠ 감축 지시)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Resource 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Capacity Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — Resource 변경은 사람)'; v_evt := 'capacity_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'resource_reallocated', false, 'budget_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_capacity_resources set review_reference = v_ref, resource_reviews = resource_reviews || jsonb_build_array(v_ref) where id = p_resource_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_capacity_resources set resource_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_resource_id;
  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, detail, payload, actor_id)
  values (v_evt, p_resource_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_resource_id, 'status', v_next, 'capacity_is_not_guaranteed_delivery', true, 'resource_reallocated', false, 'personnel_moved', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Capacity Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_capacity_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_res public.ai_enterprise_capacity_resources; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_capacity_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('resource_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'capacity_resource_id','') is null then raise exception 'capacity_resource_id 필수'; end if;
  select * into v_res from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid;
  if v_res.id is null then raise exception 'Capacity Resource 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_capacity_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_capacity_reviews (review_code, capacity_resource_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'ECV-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_res.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'resource_review' then 'resource_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, capacity_review_id, detail, payload, actor_id)
  values (v_evt, v_res.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — Resource 변경은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, capacity_review_id, detail, payload, actor_id)
  values ('capacity_review_created', v_res.id, v_id, 'Capacity Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'resource_reallocated', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_capacity_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_capacity_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_capacity_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Capacity Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'resource_reallocated', false, 'personnel_moved', false, 'budget_changed', false,
    'project_started', false, 'project_terminated', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Resource 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Capacity Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — Resource 변경은 사람)';
    update public.ai_enterprise_capacity_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_capacity_resources set
      resource_reviews = resource_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.capacity_resource_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_capacity_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, capacity_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'capacity_review_reference_recorded' when p_action = 'request_revision' then 'capacity_revision_requested' else 'capacity_review_reviewed' end,
    v_row.capacity_resource_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'resource_reallocated', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Capacity 이벤트 기록(통합) — 자동 재배치 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_capacity_event_record(p_kind text, p_reason text, p_payload jsonb, p_resource_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('resource_inventory_reviewed','capacity_assessment_reviewed','constraint_analysis_reviewed','dependency_mapping_recorded','resource_utilization_reviewed','workload_analysis_reviewed','budget_capacity_reviewed','execution_readiness_reviewed','bottleneck_detection_reviewed','optimization_candidate_recorded','capacity_timeline_recorded','executive_resource_summary_recorded','executive_resource_scorecard_recorded','resource_recommendation_recorded','resource_review_requested','executive_review_requested','human_review_requested','resource_learning_recorded','scenario_reference_linked','program_reference_linked','organization_reference_linked','portfolio_reference_linked','mission_reference_linked','commitment_reference_linked','inventory_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_resource_id is not null and not exists (select 1 from public.ai_enterprise_capacity_resources where id = p_resource_id) then raise exception 'Capacity Resource 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_capacity_reviews where id = p_review_id) then raise exception 'Capacity Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'resource_inventory_reviewed' and p_resource_id is not null then
    update public.ai_enterprise_capacity_resources set capacity_history = capacity_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id;
  end if;
  if p_kind = 'capacity_assessment_reviewed' then
    if coalesce(p_payload->>'capacity_dimension','') not in ('workforce_capacity','budget_capacity','infrastructure_capacity','technology_capacity','operational_capacity') then
      raise exception '허용되지 않는 capacity_dimension(§5 — 5종)';
    end if;
    if v_result not in ('sufficient_candidate','constrained_candidate','overloaded_candidate','unavailable_candidate','insufficient_data') then raise exception '허용되지 않는 capacity result(§5 — 5종)'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set capacity_status = v_result, capacity_result = coalesce(capacity_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'capacity_dimension', p_payload), capacity_history = capacity_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'constraint_analysis_reviewed' then
    if coalesce(p_payload->>'constraint_dimension','') not in ('budget_constraint','workforce_constraint','technology_constraint','dependency_constraint','schedule_constraint') then
      raise exception '허용되지 않는 constraint_dimension(§6 — 5종)';
    end if;
    if v_result not in ('critical_constraint_candidate','elevated_constraint_candidate','manageable_constraint_candidate','negligible_constraint_candidate','insufficient_data') then raise exception '허용되지 않는 constraint result(§6 — 5종)'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set constraint_status = v_result, constraint_result = coalesce(constraint_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'constraint_dimension', p_payload), capacity_history = capacity_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'dependency_mapping_recorded' and p_resource_id is not null then
    -- Dependency Graph 는 JSONB 통합(Dependency ≠ 자동 조정).
    update public.ai_enterprise_capacity_resources set dependency_result = p_payload, updated_at = now() where id = p_resource_id;
  end if;
  if p_kind = 'resource_utilization_reviewed' then
    if v_result not in ('efficient_utilization_candidate','underutilized_candidate','overutilized_candidate','utilization_unverified','insufficient_data') then raise exception '허용되지 않는 utilization result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set utilization_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'workload_analysis_reviewed' then
    if v_result not in ('balanced_workload_candidate','uneven_workload_candidate','overloaded_workload_candidate','workload_unverified','insufficient_data') then raise exception '허용되지 않는 workload result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set workload_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'budget_capacity_reviewed' then
    if v_result not in ('sufficient_candidate','constrained_candidate','overloaded_candidate','unavailable_candidate','insufficient_data') then raise exception '허용되지 않는 budget capacity result(§5 — 5종)'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set budget_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'execution_readiness_reviewed' then
    if coalesce(p_payload->>'readiness_dimension','') not in ('resource_availability','capacity','dependencies','risk','organizational_readiness') then
      raise exception '허용되지 않는 readiness_dimension(§7 — 5종)';
    end if;
    if v_result not in ('ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data') then raise exception '허용되지 않는 readiness result(§7 — 5종)'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set readiness_status = v_result, readiness_result = coalesce(readiness_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'readiness_dimension', p_payload), updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'bottleneck_detection_reviewed' then
    if v_result not in ('no_material_bottleneck_candidate','resource_bottleneck_candidate','dependency_bottleneck_candidate','schedule_bottleneck_candidate','bottleneck_unverified','insufficient_data') then raise exception '허용되지 않는 bottleneck result'; end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set bottleneck_result = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'optimization_candidate_recorded' then
    -- Optimization ≠ Automatic Improvement — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Optimization Candidate 기록 금지';
    end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set optimization_candidates = optimization_candidates || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'capacity_timeline_recorded' and p_resource_id is not null then
    update public.ai_enterprise_capacity_resources set capacity_history = capacity_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id;
  end if;
  if p_kind = 'executive_resource_scorecard_recorded' and p_resource_id is not null then
    update public.ai_enterprise_capacity_resources set scorecard_result = p_payload, updated_at = now() where id = p_resource_id;
  end if;
  if p_kind = 'resource_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_capacity_resource','review_resource_inventory','review_capacity_assessment','review_constraint_analysis','record_dependency_mapping','review_resource_utilization','review_workload_analysis','review_budget_capacity','review_execution_readiness','review_bottleneck_detection','record_optimization_candidate','record_capacity_timeline','build_executive_resource_summary','build_executive_resource_scorecard','request_resource_review','request_executive_review','request_human_review','record_resource_learning','link_scenario_reference','link_program_reference','link_inventory_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Resource Recommendation 금지';
    end if;
    if p_resource_id is not null then update public.ai_enterprise_capacity_resources set recommendation_candidate = p_payload, updated_at = now() where id = p_resource_id; end if;
  end if;
  if p_kind = 'resource_learning_recorded' and p_resource_id is not null then
    update public.ai_enterprise_capacity_resources set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_resource_id;
  end if;
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'organization_reference_linked' and nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'commitment_reference_linked' and nullif(p_payload->>'commitment_id','') is not null
     and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
    raise exception 'Execution Commitment 없음(실존 검증 실패)';
  end if;
  if p_kind = 'inventory_reference_linked' and nullif(p_payload->>'resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_resource_inventory where id = (p_payload->>'resource_id')::uuid) then
    raise exception 'Resource Inventory 없음(실존 검증 실패 — 0546)';
  end if;

  insert into public.ai_enterprise_capacity_events (event_type, capacity_resource_id, capacity_review_id, detail, payload, actor_id)
  values (p_kind, p_resource_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'resource_inventory_reviewed' then ' (Inventory 관측 ≠ 배치 확정)'
      when p_kind = 'capacity_assessment_reviewed' then ' (Capacity ≠ Guaranteed Delivery)'
      when p_kind = 'constraint_analysis_reviewed' then ' (Constraint ≠ Failure)'
      when p_kind = 'dependency_mapping_recorded' then ' (Dependency Mapping ≠ 자동 조정)'
      when p_kind = 'resource_utilization_reviewed' then ' (Utilization ≠ 생산성 평가)'
      when p_kind = 'workload_analysis_reviewed' then ' (Workload ≠ 개인 평가/재배치 신호)'
      when p_kind = 'budget_capacity_reviewed' then ' (Budget Capacity ≠ Budget 변경)'
      when p_kind = 'execution_readiness_reviewed' then ' (Readiness ≠ Success)'
      when p_kind = 'bottleneck_detection_reviewed' then ' (Bottleneck ≠ Root Cause)'
      when p_kind = 'optimization_candidate_recorded' then ' (Optimization ≠ Automatic Improvement)'
      when p_kind = 'capacity_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_resource_summary_recorded' then ' (Summary ≠ 자원 배분 확정)'
      when p_kind = 'executive_resource_scorecard_recorded' then ' (Scorecard ≠ 재배치 지시)'
      when p_kind = 'resource_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'resource_review_requested' then ' (Resource Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — Resource 변경은 사람)'
      when p_kind = 'resource_learning_recorded' then ' (Resource Learning ≠ 자동 재배치)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'organization_reference_linked' then ' (Organization Reference ≠ 조직 변경)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 변경)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ 실행 보장)'
      when p_kind = 'inventory_reference_linked' then ' (Inventory Reference ≠ 배치 변경 — 0546 참조만)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'resource_reallocated', false, 'personnel_moved', false, 'budget_changed', false, 'project_started', false, 'project_terminated', false, 'contract_changed', false, 'organization_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_capacity_resources_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_capacity_resources language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_capacity_resources
  where (p_status is null or resource_status = p_status)
    and (p_category is null or resource_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_capacity_reviews_list(p_resource_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_capacity_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_capacity_reviews
  where (p_resource_id is null or capacity_resource_id = p_resource_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_capacity_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'resources', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_capacity_resources),
      'available', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'available'),
      'constrained', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'constrained'),
      'overloaded', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'overloaded'),
      'underutilized', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'underutilized'),
      'review_reference', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_capacity_resources where resource_status = 'archived_reference'),
      'capacity_sufficient', (select count(*) from public.ai_enterprise_capacity_resources where capacity_status = 'sufficient_candidate'),
      'capacity_overloaded', (select count(*) from public.ai_enterprise_capacity_resources where capacity_status in ('overloaded_candidate','unavailable_candidate')),
      'critical_constraints', (select count(*) from public.ai_enterprise_capacity_resources where constraint_status in ('critical_constraint_candidate','elevated_constraint_candidate')),
      'ready', (select count(*) from public.ai_enterprise_capacity_resources where readiness_status in ('ready_candidate','mostly_ready_candidate')),
      'not_ready', (select count(*) from public.ai_enterprise_capacity_resources where readiness_status in ('partially_ready_candidate','not_ready_candidate')),
      'by_category', (select coalesce(jsonb_object_agg(resource_category, cnt), '{}'::jsonb) from (select resource_category, count(*) cnt from public.ai_enterprise_capacity_resources group by resource_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_capacity_reviews),
      'requested', (select count(*) from public.ai_enterprise_capacity_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_capacity_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_capacity_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_capacity_reviews where review_status = 'revision_requested')
    ),
    'capacity_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_capacity_events),
      'inventory_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'resource_inventory_reviewed'),
      'capacity_assessments', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'capacity_assessment_reviewed'),
      'constraint_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'constraint_analysis_reviewed'),
      'dependency_mappings', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'dependency_mapping_recorded'),
      'utilization_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'resource_utilization_reviewed'),
      'workload_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'workload_analysis_reviewed'),
      'budget_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'budget_capacity_reviewed'),
      'readiness_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'execution_readiness_reviewed'),
      'bottleneck_reviews', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'bottleneck_detection_reviewed'),
      'optimization_candidates', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'optimization_candidate_recorded'),
      'timelines', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'capacity_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'executive_resource_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'executive_resource_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'resource_recommendation_recorded'),
      'resource_review_requests', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'resource_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'capacity_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'resource_learning_recorded'),
      'scenario_links', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'scenario_reference_linked'),
      'program_links', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'program_reference_linked'),
      'inventory_links', (select count(*) from public.ai_enterprise_capacity_events where event_type = 'inventory_reference_linked')
    ),
    -- Capacity 원천 실측(전부 읽기 전용):
    'capacity_actuals', jsonb_build_object(
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'organization_models_0552', (select count(*) from public.ai_enterprise_organization_models),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules),
      'resource_inventory_0546', (select count(*) from public.ai_enterprise_resource_inventory)
    ),
    'capacity_unavailable', jsonb_build_array('hr_capacity_system','time_tracking_feed','erp_finance_ledger','resource_booking_system','project_management_tool_feed','cloud_cost_feed'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'capacity_is_not_guaranteed_delivery', true, 'bottleneck_is_not_root_cause', true,
    'constraint_is_not_failure', true, 'optimization_is_not_automatic_improvement', true,
    'recommendation_is_not_decision', true, 'readiness_is_not_success', true,
    'forecast_is_not_future_fact', true, 'pattern_is_not_causality', true, 'confidence_is_not_certainty', true,
    'no_auto_resource_reallocation', true, 'no_auto_personnel_transfer', true, 'no_auto_budget_change', true,
    'no_auto_project_start', true, 'no_auto_project_termination', true, 'no_auto_contract_change', true,
    'no_auto_organization_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_capacity_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_capacity_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_capacity_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_capacity_resources enable row level security;
alter table public.ai_enterprise_capacity_reviews enable row level security;
alter table public.ai_enterprise_capacity_events enable row level security;

comment on table public.ai_enterprise_capacity_resources is 'AI-OPS-54 — Capacity Resource(≠ 자원 배치 원장·Category 12종·자동 재배치 차단·Capacity ≠ Guaranteed Delivery·0546 Resource 계층과 별개).';
comment on table public.ai_enterprise_capacity_reviews is 'AI-OPS-54 — Capacity Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_capacity_events is 'AI-OPS-54 — Capacity 이벤트 31종(자동 재배치 이벤트 생성 금지·Bottleneck ≠ Root Cause).';
