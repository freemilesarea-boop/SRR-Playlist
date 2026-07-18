-- 0561_admin_ai_enterprise_continuous_improvement_intelligence.sql
-- AI-OPS-57 — Enterprise Continuous Improvement Intelligence, Continuous
-- Optimization & Operational Excellence Center.
--
-- Enterprise Vision → Mission → Strategy → Execution → Transformation →
-- Continuous Observation → Improvement Opportunity Detection → Root Cause
-- Review → Continuous Optimization → Operational Excellence → Executive
-- Improvement Review → Continuous Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Improvement ≠ Guaranteed Success — Process 자동 변경/Workflow 자동
--    변경/Strategy 자동 변경/KPI 자동 변경/Budget 자동 변경/조직 자동 변경
--    RPC 자체가 없음.
--  * Best Practice ≠ Universal Practice. Pattern ≠ Root Cause.
--    Correlation ≠ Causation. Recommendation ≠ Decision.
--    Optimization ≠ Automatic Improvement. Trend ≠ Prediction.
--  * Confidence ≠ Certainty. Null → 0 변환 금지.
--    insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0547/0549/0551/0554/0555/0556/
--    0557/0558/0559/0560 원본 무변경(참조만).
--  * 이름 충돌 실측: 0554(AI-OPS-50)가 ai_enterprise_improvement_candidates ·
--    admin_enterprise_improvement_candidate_* 를 이미 사용(별개 계층 —
--    AI 자기개선 후보 원장). 본 계층의 ai_enterprise_improvements /
--    improvement_reviews / improvement_events · admin_enterprise_improvement_
--    create/review/event_record/... 는 미사용 확인 — 스펙 권장명 그대로
--    사용(원본 무변경).
--  * 프로세스 마이닝/인시던트 관리/품질 관리 시스템/워크플로 분석/티켓팅/
--    운영 메트릭 웨어하우스 피드는 실측 부재 — insufficient_data 로 유지
--    (분석은 수동 기록 기반).
--  * Improvement Timeline/Optimization·Root Cause·Best Practice·Continuous
--    Learning History 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Improvement(≠ 개선 실행 원장 — 개선 기회 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_improvements (
  id                        uuid primary key default gen_random_uuid(),
  improvement_code          text not null,
  improvement_name          text not null,
  improvement_category      text not null check (improvement_category in ('process','organization','technology','product','operations','resource','governance','quality','executive','enterprise','custom')),
  improvement_status        text not null default 'identified' check (improvement_status in ('identified','candidate','review_reference','archived_reference','insufficient_data')),
  improvement_summary       text,
  assessment_status         text not null default 'insufficient_data' check (assessment_status in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data')),
  root_cause_status         text not null default 'insufficient_data' check (root_cause_status in ('highly_supported_candidate','moderately_supported_candidate','weakly_supported_candidate','speculative_candidate','insufficient_data')),
  excellence_status         text not null default 'insufficient_data' check (excellence_status in ('excellence_candidate','mature_candidate','developing_candidate','immature_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  transformation_id         uuid,
  value_realization_id      uuid,
  capacity_resource_id      uuid,
  execution_program_id      uuid,
  assessment_result         jsonb,
  root_cause_result         jsonb,
  excellence_result         jsonb,
  trend_result              jsonb,
  efficiency_result         jsonb,
  best_practice_result      jsonb,
  recurrence_result         jsonb,
  priority_result           jsonb,
  scorecard_result          jsonb,
  improvement_history       jsonb not null default '[]'::jsonb,   -- Improvement Timeline/Optimization·Root Cause·Best Practice·Continuous Learning History 통합 append
  recommendation_candidate  jsonb,
  improvement_reviews       jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aeci_idem on public.ai_enterprise_improvements (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeci_status on public.ai_enterprise_improvements (improvement_status, improvement_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Improvement Review(§9 — 요청/Reference 기록만, 개선 적용은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_improvement_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  improvement_id            uuid not null,
  review_type               text not null check (review_type in ('improvement_review','executive_review','human_review')),
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
create unique index if not exists uq_aeir_idem on public.ai_enterprise_improvement_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeir_imp on public.ai_enterprise_improvement_reviews (improvement_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Improvement 이벤트(31종) — Observation/Opportunity/Root Cause/Trend/
--    Efficiency/Excellence/Best Practice/Recurrence/Priority/Timeline/
--    Scorecard/Recommendation/Review/Learning/Link 통합 Audit(자동 프로세스
--    변경 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_improvement_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('improvement_identified','improvement_reviewed','continuous_observation_recorded','improvement_opportunity_reviewed','root_cause_reviewed','trend_analysis_reviewed','process_efficiency_reviewed','operational_excellence_reviewed','best_practice_reviewed','recurrence_pattern_reviewed','improvement_priority_reviewed','improvement_timeline_recorded','executive_improvement_summary_recorded','executive_improvement_scorecard_recorded','improvement_recommendation_recorded','improvement_review_created','improvement_review_reviewed','improvement_review_requested','executive_review_requested','human_review_requested','improvement_review_reference_recorded','improvement_revision_requested','continuous_learning_recorded','transformation_reference_linked','value_reference_linked','capacity_reference_linked','program_reference_linked','scenario_reference_linked','mission_reference_linked','governance_reference_linked','business_value_reference_linked')),
  improvement_id            uuid,
  improvement_review_id     uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aecie_evt on public.ai_enterprise_improvement_events (event_type, created_at desc);
create index if not exists idx_aecie_imp on public.ai_enterprise_improvement_events (improvement_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Improvement 생성 — 자동 프로세스 변경 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvement_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_improvements;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'improvement_category','');
  -- 자동 프로세스/워크플로/전략/KPI/Budget/조직 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_process_change','automatic_workflow_change','automatic_strategy_change','automatic_kpi_change','automatic_budget_change','automatic_organization_change') then
    raise exception '금지된 improvement_category(자동 프로세스 변경 계열 비활성)';
  end if;
  if v_cat not in ('process','organization','technology','product','operations','resource','governance','quality','executive','enterprise','custom') then
    raise exception '허용되지 않는 improvement_category';
  end if;
  if coalesce(btrim(p_payload->>'improvement_name'),'') = '' then raise exception 'improvement_name 필수'; end if;
  if nullif(p_payload->>'transformation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid) then
    raise exception 'Transformation 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'value_realization_id','') is not null
     and not exists (select 1 from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid) then
    raise exception 'Value Realization 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_improvements where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'improvement_is_not_guaranteed_success', true); end if;
  end if;
  insert into public.ai_enterprise_improvements (improvement_code, improvement_name, improvement_category, improvement_summary, transformation_id, value_realization_id, capacity_resource_id, execution_program_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'improvement_code',''), 'ECI-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'improvement_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'improvement_summary',''), 2000),''),
    nullif(p_payload->>'transformation_id','')::uuid, nullif(p_payload->>'value_realization_id','')::uuid,
    nullif(p_payload->>'capacity_resource_id','')::uuid, nullif(p_payload->>'execution_program_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, detail, payload, actor_id)
  values ('improvement_identified', v_id, left(v_cat, 80) || ' (개선 기회 관측 Candidate — 자동 프로세스 변경 없음)', jsonb_build_object('improvement_name', p_payload->>'improvement_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'identified', 'improvement_is_not_guaranteed_success', true, 'process_changed', false, 'workflow_changed', false, 'strategy_changed', false, 'kpi_changed', false, 'budget_changed', false, 'organization_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Improvement 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvement_review(p_improvement_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_improvements; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'improvement_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_identified','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_improvements where id = p_improvement_id;
  if v_row.id is null then raise exception 'Improvement 없음(실존 검증 실패)'; end if;
  if v_row.improvement_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_identified' then v_next := 'identified'; v_note := ' (식별 상태 표시 ≠ 개선 적용)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 개선 적용은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Improvement Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 개선 적용은 사람)'; v_evt := 'improvement_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'process_changed', false, 'strategy_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_improvements set review_reference = v_ref, improvement_reviews = improvement_reviews || jsonb_build_array(v_ref) where id = p_improvement_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_improvements set improvement_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_improvement_id;
  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, detail, payload, actor_id)
  values (v_evt, p_improvement_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_improvement_id, 'status', v_next, 'improvement_is_not_guaranteed_success', true, 'process_changed', false, 'workflow_changed', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Improvement Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvement_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_imp public.ai_enterprise_improvements; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_improvement_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('improvement_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'improvement_id','') is null then raise exception 'improvement_id 필수'; end if;
  select * into v_imp from public.ai_enterprise_improvements where id = (p_payload->>'improvement_id')::uuid;
  if v_imp.id is null then raise exception 'Improvement 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_improvement_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_improvement_reviews (review_code, improvement_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EIR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_imp.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'improvement_review' then 'improvement_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, improvement_review_id, detail, payload, actor_id)
  values (v_evt, v_imp.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 개선 적용은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, improvement_review_id, detail, payload, actor_id)
  values ('improvement_review_created', v_imp.id, v_id, 'Improvement Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'process_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_improvement_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_improvement_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_improvement_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Improvement Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'process_changed', false, 'workflow_changed', false, 'strategy_changed', false,
    'kpi_changed', false, 'budget_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 개선 적용은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Improvement Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 개선 적용은 사람)';
    update public.ai_enterprise_improvement_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_improvements set
      improvement_reviews = improvement_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.improvement_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_improvement_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, improvement_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'improvement_review_reference_recorded' when p_action = 'request_revision' then 'improvement_revision_requested' else 'improvement_review_reviewed' end,
    v_row.improvement_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'process_changed', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Improvement 이벤트 기록(통합) — 자동 프로세스 변경 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvement_event_record(p_kind text, p_reason text, p_payload jsonb, p_improvement_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('continuous_observation_recorded','improvement_opportunity_reviewed','root_cause_reviewed','trend_analysis_reviewed','process_efficiency_reviewed','operational_excellence_reviewed','best_practice_reviewed','recurrence_pattern_reviewed','improvement_priority_reviewed','improvement_timeline_recorded','executive_improvement_summary_recorded','executive_improvement_scorecard_recorded','improvement_recommendation_recorded','improvement_review_requested','executive_review_requested','human_review_requested','continuous_learning_recorded','transformation_reference_linked','value_reference_linked','capacity_reference_linked','program_reference_linked','scenario_reference_linked','mission_reference_linked','governance_reference_linked','business_value_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_improvement_id is not null and not exists (select 1 from public.ai_enterprise_improvements where id = p_improvement_id) then raise exception 'Improvement 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_improvement_reviews where id = p_review_id) then raise exception 'Improvement Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'continuous_observation_recorded' and p_improvement_id is not null then
    update public.ai_enterprise_improvements set improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id;
  end if;
  if p_kind = 'improvement_opportunity_reviewed' then
    if coalesce(p_payload->>'improvement_dimension','') not in ('business_impact','operational_impact','cost_reduction','quality_improvement','sustainability') then
      raise exception '허용되지 않는 improvement_dimension(§5 — 5종)';
    end if;
    if v_result not in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data') then raise exception '허용되지 않는 improvement result(§5 — 5종)'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set assessment_status = v_result, assessment_result = coalesce(assessment_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'improvement_dimension', p_payload), improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'root_cause_reviewed' then
    if coalesce(p_payload->>'root_cause_dimension','') not in ('evidence','frequency','severity','scope','confidence') then
      raise exception '허용되지 않는 root_cause_dimension(§6 — 5종)';
    end if;
    if v_result not in ('highly_supported_candidate','moderately_supported_candidate','weakly_supported_candidate','speculative_candidate','insufficient_data') then raise exception '허용되지 않는 root cause result(§6 — 5종)'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set root_cause_status = v_result, root_cause_result = coalesce(root_cause_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'root_cause_dimension', p_payload), improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'trend_analysis_reviewed' then
    if v_result not in ('improving_trend_candidate','stable_trend_candidate','deteriorating_trend_candidate','trend_unverified','insufficient_data') then raise exception '허용되지 않는 trend result'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set trend_result = p_payload, updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'process_efficiency_reviewed' then
    if v_result not in ('efficient_process_candidate','acceptable_efficiency_candidate','inefficient_process_candidate','efficiency_unverified','insufficient_data') then raise exception '허용되지 않는 efficiency result'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set efficiency_result = p_payload, updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'operational_excellence_reviewed' then
    if coalesce(p_payload->>'excellence_dimension','') not in ('process_stability','quality_consistency','resource_efficiency','continuous_learning','improvement_adoption') then
      raise exception '허용되지 않는 excellence_dimension(§7 — 5종)';
    end if;
    if v_result not in ('excellence_candidate','mature_candidate','developing_candidate','immature_candidate','insufficient_data') then raise exception '허용되지 않는 excellence result(§7 — 5종)'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set excellence_status = v_result, excellence_result = coalesce(excellence_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'excellence_dimension', p_payload), improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'best_practice_reviewed' then
    -- Best Practice ≠ Universal Practice — Evidence 없이 확산 후보 기록 차단.
    if v_result not in ('proven_practice_candidate','promising_practice_candidate','context_specific_candidate','practice_unverified','insufficient_data') then raise exception '허용되지 않는 best practice result'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Best Practice 기록 금지';
    end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set best_practice_result = p_payload, improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'recurrence_pattern_reviewed' then
    if v_result not in ('frequent_recurrence_candidate','occasional_recurrence_candidate','isolated_incident_candidate','recurrence_unverified','insufficient_data') then raise exception '허용되지 않는 recurrence result'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set recurrence_result = p_payload, updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'improvement_priority_reviewed' then
    if v_result not in ('high_priority_candidate','medium_priority_candidate','low_priority_candidate','priority_unverified','insufficient_data') then raise exception '허용되지 않는 priority result'; end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set priority_result = p_payload, updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'improvement_timeline_recorded' and p_improvement_id is not null then
    update public.ai_enterprise_improvements set improvement_history = improvement_history || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id;
  end if;
  if p_kind = 'executive_improvement_scorecard_recorded' and p_improvement_id is not null then
    update public.ai_enterprise_improvements set scorecard_result = p_payload, updated_at = now() where id = p_improvement_id;
  end if;
  if p_kind = 'improvement_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_improvement_candidate','record_continuous_observation','review_improvement_opportunity','review_root_cause','review_trend_analysis','review_process_efficiency','review_operational_excellence','review_best_practice','review_recurrence_pattern','review_improvement_priority','record_improvement_timeline','build_executive_improvement_summary','build_executive_improvement_scorecard','request_improvement_review','request_executive_review','request_human_review','record_continuous_learning','link_transformation_reference','link_value_reference','link_capacity_reference','spread_best_practice_review_candidate','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Improvement Recommendation 금지';
    end if;
    if p_improvement_id is not null then update public.ai_enterprise_improvements set recommendation_candidate = p_payload, updated_at = now() where id = p_improvement_id; end if;
  end if;
  if p_kind = 'continuous_learning_recorded' and p_improvement_id is not null then
    update public.ai_enterprise_improvements set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_improvement_id;
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
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if p_kind = 'business_value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_improvement_events (event_type, improvement_id, improvement_review_id, detail, payload, actor_id)
  values (p_kind, p_improvement_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'continuous_observation_recorded' then ' (관측 기록 ≠ 문제 확정)'
      when p_kind = 'improvement_opportunity_reviewed' then ' (Improvement ≠ Guaranteed Success)'
      when p_kind = 'root_cause_reviewed' then ' (Pattern ≠ Root Cause)'
      when p_kind = 'trend_analysis_reviewed' then ' (Trend ≠ Prediction)'
      when p_kind = 'process_efficiency_reviewed' then ' (Efficiency 관측 ≠ 프로세스 변경)'
      when p_kind = 'operational_excellence_reviewed' then ' (Excellence 관측 후보 ≠ 조직 평가)'
      when p_kind = 'best_practice_reviewed' then ' (Best Practice ≠ Universal Practice)'
      when p_kind = 'recurrence_pattern_reviewed' then ' (Correlation ≠ Causation)'
      when p_kind = 'improvement_priority_reviewed' then ' (Priority ≠ Mandatory Order)'
      when p_kind = 'improvement_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_improvement_summary_recorded' then ' (Summary ≠ 개선 적용 확정)'
      when p_kind = 'executive_improvement_scorecard_recorded' then ' (Scorecard ≠ 개선 지시)'
      when p_kind = 'improvement_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'improvement_review_requested' then ' (Improvement Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — 개선 적용은 사람)'
      when p_kind = 'continuous_learning_recorded' then ' (Continuous Learning ≠ 자동 프로세스 변경)'
      when p_kind = 'transformation_reference_linked' then ' (Transformation Reference ≠ 조직 변경 — 0560 참조만)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 투자 결정 — 0559 참조만)'
      when p_kind = 'capacity_reference_linked' then ' (Capacity Reference ≠ 자원 재배치 — 0558 참조만)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인 — 0551 참조만)'
      when p_kind = 'business_value_reference_linked' then ' (Business Value Reference ≠ 회계 반영 — 0549 참조만)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'process_changed', false, 'workflow_changed', false, 'strategy_changed', false, 'kpi_changed', false, 'budget_changed', false, 'organization_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvements_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_improvements language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_improvements
  where (p_status is null or improvement_status = p_status)
    and (p_category is null or improvement_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_improvement_reviews_list(p_improvement_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_improvement_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_improvement_reviews
  where (p_improvement_id is null or improvement_id = p_improvement_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_improvement_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'improvements', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_improvements),
      'identified', (select count(*) from public.ai_enterprise_improvements where improvement_status = 'identified'),
      'candidate', (select count(*) from public.ai_enterprise_improvements where improvement_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_improvements where improvement_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_improvements where improvement_status = 'archived_reference'),
      'exceptional', (select count(*) from public.ai_enterprise_improvements where assessment_status = 'exceptional_candidate'),
      'strong', (select count(*) from public.ai_enterprise_improvements where assessment_status = 'strong_candidate'),
      'weak', (select count(*) from public.ai_enterprise_improvements where assessment_status = 'weak_candidate'),
      'highly_supported_root_causes', (select count(*) from public.ai_enterprise_improvements where root_cause_status = 'highly_supported_candidate'),
      'speculative_root_causes', (select count(*) from public.ai_enterprise_improvements where root_cause_status = 'speculative_candidate'),
      'excellence', (select count(*) from public.ai_enterprise_improvements where excellence_status in ('excellence_candidate','mature_candidate')),
      'immature', (select count(*) from public.ai_enterprise_improvements where excellence_status in ('developing_candidate','immature_candidate')),
      'by_category', (select coalesce(jsonb_object_agg(improvement_category, cnt), '{}'::jsonb) from (select improvement_category, count(*) cnt from public.ai_enterprise_improvements group by improvement_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_improvement_reviews),
      'requested', (select count(*) from public.ai_enterprise_improvement_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_improvement_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_improvement_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_improvement_reviews where review_status = 'revision_requested')
    ),
    'improvement_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_improvement_events),
      'observations', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'continuous_observation_recorded'),
      'opportunity_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_opportunity_reviewed'),
      'root_cause_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'root_cause_reviewed'),
      'trend_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'trend_analysis_reviewed'),
      'efficiency_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'process_efficiency_reviewed'),
      'excellence_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'operational_excellence_reviewed'),
      'best_practice_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'best_practice_reviewed'),
      'recurrence_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'recurrence_pattern_reviewed'),
      'priority_reviews', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_priority_reviewed'),
      'timelines', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'executive_improvement_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'executive_improvement_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_recommendation_recorded'),
      'improvement_review_requests', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'improvement_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'continuous_learning_recorded'),
      'transformation_links', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'transformation_reference_linked'),
      'value_links', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'value_reference_linked'),
      'capacity_links', (select count(*) from public.ai_enterprise_improvement_events where event_type = 'capacity_reference_linked')
    ),
    -- Improvement 원천 실측(전부 읽기 전용):
    'improvement_actuals', jsonb_build_object(
      'transformations_0560', (select count(*) from public.ai_enterprise_transformations),
      'value_realizations_0559', (select count(*) from public.ai_enterprise_value_realizations),
      'capacity_resources_0558', (select count(*) from public.ai_enterprise_capacity_resources),
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'improvement_unavailable', jsonb_build_array('process_mining_tool','incident_management_feed','quality_management_system','workflow_analytics_feed','ticketing_system_feed','ops_metrics_warehouse'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'improvement_is_not_guaranteed_success', true, 'best_practice_is_not_universal_practice', true,
    'pattern_is_not_root_cause', true, 'correlation_is_not_causation', true,
    'recommendation_is_not_decision', true, 'optimization_is_not_automatic_improvement', true,
    'trend_is_not_prediction', true, 'confidence_is_not_certainty', true,
    'no_auto_process_change', true, 'no_auto_workflow_change', true, 'no_auto_strategy_change', true,
    'no_auto_kpi_change', true, 'no_auto_budget_change', true, 'no_auto_organization_change', true,
    'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_improvement_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_improvement_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_improvement_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_improvements enable row level security;
alter table public.ai_enterprise_improvement_reviews enable row level security;
alter table public.ai_enterprise_improvement_events enable row level security;

comment on table public.ai_enterprise_improvements is 'AI-OPS-57 — Improvement(≠ 개선 실행 원장·Category 11종·자동 프로세스 변경 차단·Improvement ≠ Guaranteed Success·0554 improvement_candidates 계층과 별개).';
comment on table public.ai_enterprise_improvement_reviews is 'AI-OPS-57 — Improvement Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_improvement_events is 'AI-OPS-57 — Improvement 이벤트 31종(자동 프로세스 변경 이벤트 생성 금지·Pattern ≠ Root Cause).';
