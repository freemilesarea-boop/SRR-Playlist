-- 0552_admin_ai_enterprise_organization_intelligence.sql
-- AI-OPS-48 — Enterprise Organizational Intelligence, Organizational Health &
-- Operating Model Center.
--
-- Enterprise Vision → Operating Model → Organization Structure → Role &
-- Responsibility → Decision Flow → Cross-Functional Collaboration →
-- Organizational Health → Operating Maturity → Bottleneck Detection →
-- Capability Gap → Improvement Candidate → Executive Organization Review →
-- Operating Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Organization Candidate ≠ Organization Change — 자동 조직 개편/팀 생성·
--    삭제/인사 이동/승진/해고/평가/보상 RPC 자체가 없음.
--  * Improvement Candidate ≠ Approved Improvement.
--  * Capability Gap ≠ Employee Performance(개인 성과 평가 사용 금지).
--  * Organizational Health ≠ HR Evaluation. Operating Maturity ≠ Organizational
--    Success. Bottleneck ≠ Root Cause. Collaboration Score ≠ Team Quality.
--  * Recommendation ≠ Decision. Review ≠ Approval. Forecast ≠ Future Fact.
--    Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 KPI/Budget/Strategy/Governance/Production 변경·자동 Merge/Deploy — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0512/0513/0514/0520/0545/0546/0547/
--    0549/0550/0551 원본 무변경(참조만).
--  * 실제 조직도/HR/Payroll 원장 테이블은 실측 부재 — 본 계층은 관측·분석용
--    Organization Model Candidate 이며 인사 시스템이 아님.
--  * Role Matrix/Collaboration Graph/Operating Health 는 신규 테이블 대신
--    JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Organization Model(≠ 조직 개편/인사 시스템).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_organization_models (
  id                        uuid primary key default gen_random_uuid(),
  organization_code         text not null,
  organization_name         text not null,
  organization_category     text not null check (organization_category in ('executive','product','engineering','operations','sales','marketing','finance','hr','legal','customer_success','platform','ai','security','compliance','enterprise','custom')),
  organization_status       text not null default 'draft' check (organization_status in ('draft','active_reference','review_reference','archived_reference','insufficient_data')),
  organization_description  text,
  strategy_portfolio_id     uuid,
  execution_program_id      uuid,
  health_status             text not null default 'insufficient_data' check (health_status in ('excellent_health_candidate','healthy_candidate','watch_candidate','unhealthy_candidate','insufficient_data')),
  maturity_status           text not null default 'insufficient_data' check (maturity_status in ('highly_mature_candidate','mature_candidate','developing_candidate','immature_candidate','insufficient_data')),
  capability_gap_status     text not null default 'insufficient_data' check (capability_gap_status in ('minimal_gap_candidate','manageable_gap_candidate','significant_gap_candidate','critical_gap_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  team_structure            jsonb,
  role_matrix               jsonb not null default '[]'::jsonb,
  responsibility_matrix     jsonb,
  decision_flow_result      jsonb,
  collaboration_result      jsonb,
  health_result             jsonb,
  maturity_result           jsonb,
  capability_gap_result     jsonb,
  bottleneck_result         jsonb,
  workload_result           jsonb,
  dependency_result         jsonb,
  spof_result               jsonb,
  scenario_result           jsonb,
  scorecard_result          jsonb,
  improvement_candidates    jsonb not null default '[]'::jsonb,
  recommendation_candidate  jsonb,
  organization_reviews      jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  governance_references     jsonb not null default '[]'::jsonb,
  resource_references       jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aeom_idem on public.ai_enterprise_organization_models (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeom_status on public.ai_enterprise_organization_models (organization_status, organization_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Operating Review(§9 — 요청/Reference 기록만, 최종 조직 변경은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_operating_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  organization_model_id     uuid not null,
  review_type               text not null check (review_type in ('organization_review','executive_review','operating_review')),
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
create unique index if not exists uq_aeor_idem on public.ai_enterprise_operating_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeor_org on public.ai_enterprise_operating_reviews (organization_model_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Organization 이벤트(31종) — Structure/Role/Responsibility/Decision Flow/
--    Collaboration/Health/Maturity/Bottleneck/Capability Gap/Workload/
--    Dependency/SPOF/Scenario/Improvement/Scorecard/Recommendation/Review/
--    Link/Learning 통합 Audit(자동 개편 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_organization_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('organization_model_created','organization_model_reviewed','team_structure_recorded','role_mapping_recorded','responsibility_matrix_recorded','decision_flow_reviewed','collaboration_network_reviewed','organizational_health_reviewed','operating_maturity_reviewed','bottleneck_reviewed','capability_gap_reviewed','workload_balance_reviewed','dependency_reviewed','single_point_of_failure_reviewed','organizational_scenario_recorded','improvement_candidate_recorded','executive_organization_summary_recorded','executive_organization_scorecard_recorded','organization_recommendation_recorded','operating_review_created','operating_review_reviewed','organization_review_requested','executive_review_requested','operating_review_requested','organization_review_reference_recorded','organization_revision_requested','portfolio_reference_linked','program_reference_linked','governance_reference_linked','resource_reference_linked','organizational_learning_reference_recorded')),
  organization_model_id     uuid,
  operating_review_id       uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeoe_evt on public.ai_enterprise_organization_events (event_type, created_at desc);
create index if not exists idx_aeoe_org on public.ai_enterprise_organization_events (organization_model_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Organization Model 생성 — 자동 개편/인사 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_organization_model_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_organization_models;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'organization_category','');
  -- 자동 개편/인사/개인 평가 계열 — 구조적 차단(Organization Candidate ≠ Organization Change).
  if v_cat in ('automatic_reorganization','automatic_team_creation','automatic_team_deletion','automatic_personnel_transfer','automatic_promotion','automatic_termination','automatic_evaluation','automatic_compensation','personal_performance_evaluation','individual_ranking') then
    raise exception '금지된 organization_category(자동 개편/인사 계열 비활성)';
  end if;
  if v_cat not in ('executive','product','engineering','operations','sales','marketing','finance','hr','legal','customer_success','platform','ai','security','compliance','enterprise','custom') then
    raise exception '허용되지 않는 organization_category';
  end if;
  if coalesce(btrim(p_payload->>'organization_name'),'') = '' then raise exception 'organization_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_organization_models where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'candidate_is_not_organization_change', true); end if;
  end if;
  insert into public.ai_enterprise_organization_models (organization_code, organization_name, organization_category, organization_description, strategy_portfolio_id, execution_program_id, team_structure, role_matrix, responsibility_matrix, governance_references, resource_references, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'organization_code',''), 'EOM-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'organization_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'organization_description',''), 2000),''),
    nullif(p_payload->>'strategy_portfolio_id','')::uuid, nullif(p_payload->>'execution_program_id','')::uuid,
    p_payload->'team_structure', coalesce(p_payload->'role_matrix', '[]'::jsonb), p_payload->'responsibility_matrix',
    coalesce(p_payload->'governance_references', '[]'::jsonb), coalesce(p_payload->'resource_references', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, detail, payload, actor_id)
  values ('organization_model_created', v_id, left(v_cat, 80) || ' (Organization Candidate ≠ Organization Change — draft·자동 개편 없음)', jsonb_build_object('organization_name', p_payload->>'organization_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'candidate_is_not_organization_change', true, 'organization_changed', false, 'personnel_changed', false, 'promotion_applied', false, 'termination_applied', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Organization Model 검토 — archived 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_organization_model_review(p_model_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_organization_models; v_next text := null;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('activate_reference','mark_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_organization_models where id = p_model_id;
  if v_row.id is null then raise exception 'Organization Model 없음(실존 검증 실패)'; end if;
  if v_row.organization_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'activate_reference' then v_next := 'active_reference';
  elsif p_action = 'mark_review_reference' then v_next := 'review_reference';
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_organization_models set organization_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_model_id;
  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, detail, payload, actor_id)
  values ('organization_model_reviewed', p_model_id, left(p_reason, 200) || ' (Active Reference ≠ 조직 변경 확정)', p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_model_id, 'status', v_next, 'candidate_is_not_organization_change', true, 'organization_changed', false, 'personnel_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Operating Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_operating_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_org public.ai_enterprise_organization_models; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_operating_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('organization_review','executive_review','operating_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'organization_model_id','') is null then raise exception 'organization_model_id 필수'; end if;
  select * into v_org from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid;
  if v_org.id is null then raise exception 'Organization Model 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_operating_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_operating_reviews (review_code, organization_model_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EOR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_org.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'organization_review' then 'organization_review_requested' when 'executive_review' then 'executive_review_requested' else 'operating_review_requested' end;
  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, operating_review_id, detail, payload, actor_id)
  values (v_evt, v_org.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 최종 조직 변경은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, operating_review_id, detail, payload, actor_id)
  values ('operating_review_created', v_org.id, v_id, 'Operating Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'organization_changed', false, 'personnel_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_operating_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_operating_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_operating_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Operating Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'organization_changed', false, 'personnel_changed', false, 'promotion_applied', false,
    'termination_applied', false, 'compensation_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 조직 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Organization Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 조직 변경은 사람)';
    update public.ai_enterprise_operating_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_organization_models set
      organization_reviews = organization_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.organization_model_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_operating_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, operating_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'organization_review_reference_recorded' when p_action = 'request_revision' then 'organization_revision_requested' else 'operating_review_reviewed' end,
    v_row.organization_model_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'organization_changed', false, 'personnel_changed', false, 'promotion_applied', false, 'termination_applied', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Organization 이벤트 기록(통합) — 자동 개편 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_organization_event_record(p_kind text, p_reason text, p_payload jsonb, p_model_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('team_structure_recorded','role_mapping_recorded','responsibility_matrix_recorded','decision_flow_reviewed','collaboration_network_reviewed','organizational_health_reviewed','operating_maturity_reviewed','bottleneck_reviewed','capability_gap_reviewed','workload_balance_reviewed','dependency_reviewed','single_point_of_failure_reviewed','organizational_scenario_recorded','improvement_candidate_recorded','executive_organization_summary_recorded','executive_organization_scorecard_recorded','organization_recommendation_recorded','portfolio_reference_linked','program_reference_linked','governance_reference_linked','resource_reference_linked','organizational_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_model_id is not null and not exists (select 1 from public.ai_enterprise_organization_models where id = p_model_id) then raise exception 'Organization Model 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_operating_reviews where id = p_review_id) then raise exception 'Operating Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'team_structure_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set team_structure = p_payload, updated_at = now() where id = p_model_id;
  end if;
  if p_kind = 'role_mapping_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set role_matrix = role_matrix || jsonb_build_array(p_payload), updated_at = now() where id = p_model_id;
  end if;
  if p_kind = 'responsibility_matrix_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set responsibility_matrix = p_payload, updated_at = now() where id = p_model_id;
  end if;
  if p_kind = 'decision_flow_reviewed' then
    if v_result not in ('fast_decision_flow_candidate','acceptable_decision_flow_candidate','slow_decision_flow_candidate','blocked_decision_flow_candidate','decision_flow_unverified','insufficient_data') then raise exception '허용되지 않는 decision flow result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set decision_flow_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'collaboration_network_reviewed' then
    if v_result not in ('strong_collaboration_candidate','adequate_collaboration_candidate','delayed_collaboration_candidate','siloed_collaboration_candidate','collaboration_unverified','insufficient_data') then raise exception '허용되지 않는 collaboration result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set collaboration_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'organizational_health_reviewed' then
    if v_result not in ('excellent_health_candidate','healthy_candidate','watch_candidate','unhealthy_candidate','insufficient_data') then raise exception '허용되지 않는 health result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set health_status = v_result, health_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'operating_maturity_reviewed' then
    if coalesce(p_payload->>'maturity_dimension','') not in ('process_consistency','decision_speed','collaboration','ownership_clarity','capability_coverage','governance_alignment') then
      raise exception '허용되지 않는 maturity_dimension';
    end if;
    if v_result not in ('highly_mature_candidate','mature_candidate','developing_candidate','immature_candidate','insufficient_data') then raise exception '허용되지 않는 maturity result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set maturity_status = v_result, maturity_result = coalesce(maturity_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'maturity_dimension', p_payload), updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'bottleneck_reviewed' then
    if v_result not in ('no_material_bottleneck_candidate','role_overload_candidate','decision_bottleneck_candidate','collaboration_bottleneck_candidate','capability_bottleneck_candidate','bottleneck_unverified','insufficient_data') then raise exception '허용되지 않는 bottleneck result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set bottleneck_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'capability_gap_reviewed' then
    if coalesce(p_payload->>'capability_domain','') not in ('leadership','technical','operational','business','ai','security','compliance') then
      raise exception '허용되지 않는 capability_domain';
    end if;
    if v_result not in ('minimal_gap_candidate','manageable_gap_candidate','significant_gap_candidate','critical_gap_candidate','insufficient_data') then raise exception '허용되지 않는 capability gap result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set capability_gap_status = v_result, capability_gap_result = coalesce(capability_gap_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'capability_domain', p_payload), updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'workload_balance_reviewed' then
    if v_result not in ('balanced_workload_candidate','uneven_workload_candidate','overloaded_role_candidate','workload_unverified','insufficient_data') then raise exception '허용되지 않는 workload result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set workload_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'dependency_reviewed' then
    if v_result not in ('no_material_dependency_candidate','cross_team_dependency_candidate','blocking_dependency_candidate','dependency_unverified','insufficient_data') then raise exception '허용되지 않는 dependency result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set dependency_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'single_point_of_failure_reviewed' then
    if v_result not in ('no_material_spof_candidate','potential_spof_candidate','critical_spof_candidate','spof_unverified','insufficient_data') then raise exception '허용되지 않는 spof result'; end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set spof_result = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'organizational_scenario_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set scenario_result = p_payload, updated_at = now() where id = p_model_id;
  end if;
  if p_kind = 'improvement_candidate_recorded' then
    -- Improvement Candidate ≠ Approved Improvement — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Improvement Candidate 기록 금지';
    end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set improvement_candidates = improvement_candidates || jsonb_build_array(p_payload), updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'executive_organization_scorecard_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set scorecard_result = p_payload, updated_at = now() where id = p_model_id;
  end if;
  if p_kind = 'organization_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_organization_model','record_team_structure','record_role_mapping','record_responsibility_matrix','review_decision_flow','review_collaboration_network','review_organizational_health','review_operating_maturity','review_bottleneck','review_capability_gap','review_workload_balance','review_dependency','review_single_point_of_failure','record_organizational_scenario','record_improvement_candidate','build_executive_organization_summary','build_executive_organization_scorecard','request_organization_review','request_executive_review','request_operating_review','record_organizational_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Organization Recommendation 금지';
    end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set recommendation_candidate = p_payload, updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_reference_linked' then
    if nullif(p_payload->>'governance_decision_id','') is not null
       and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
      raise exception 'Governance Decision 없음(실존 검증 실패)';
    end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set governance_references = governance_references || jsonb_build_array(p_payload), updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'resource_reference_linked' then
    if nullif(p_payload->>'resource_id','') is not null
       and not exists (select 1 from public.ai_enterprise_resource_inventory where id = (p_payload->>'resource_id')::uuid) then
      raise exception 'Resource 없음(실존 검증 실패)';
    end if;
    if p_model_id is not null then update public.ai_enterprise_organization_models set resource_references = resource_references || jsonb_build_array(p_payload), updated_at = now() where id = p_model_id; end if;
  end if;
  if p_kind = 'organizational_learning_reference_recorded' and p_model_id is not null then
    update public.ai_enterprise_organization_models set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_model_id;
  end if;

  insert into public.ai_enterprise_organization_events (event_type, organization_model_id, operating_review_id, detail, payload, actor_id)
  values (p_kind, p_model_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'team_structure_recorded' then ' (Structure Candidate ≠ 조직 개편)'
      when p_kind = 'role_mapping_recorded' then ' (Role Mapping — 개인 성과 평가에 사용하지 않음)'
      when p_kind = 'responsibility_matrix_recorded' then ' (Responsibility Matrix ≠ 인사 발령)'
      when p_kind = 'decision_flow_reviewed' then ' (Decision Flow Candidate ≠ 자동 프로세스 변경)'
      when p_kind = 'collaboration_network_reviewed' then ' (Collaboration Score ≠ Team Quality)'
      when p_kind = 'organizational_health_reviewed' then ' (Organizational Health ≠ HR Evaluation)'
      when p_kind = 'operating_maturity_reviewed' then ' (Operating Maturity ≠ Organizational Success)'
      when p_kind = 'bottleneck_reviewed' then ' (Bottleneck ≠ Root Cause)'
      when p_kind = 'capability_gap_reviewed' then ' (Capability Gap ≠ Employee Performance)'
      when p_kind = 'workload_balance_reviewed' then ' (Workload Candidate ≠ 개인 평가/재배치 신호)'
      when p_kind = 'dependency_reviewed' then ' (Dependency Candidate ≠ 자동 조정)'
      when p_kind = 'single_point_of_failure_reviewed' then ' (SPOF Candidate ≠ 개인 책임 추궁)'
      when p_kind = 'organizational_scenario_recorded' then ' (Scenario ≠ Organization Change)'
      when p_kind = 'improvement_candidate_recorded' then ' (Improvement Candidate ≠ Approved Improvement)'
      when p_kind = 'executive_organization_summary_recorded' then ' (Summary ≠ 조직 평가 확정)'
      when p_kind = 'executive_organization_scorecard_recorded' then ' (Scorecard ≠ HR 평가)'
      when p_kind = 'organization_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ 전략 실행 보장)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 승인)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인)'
      when p_kind = 'resource_reference_linked' then ' (Resource Reference ≠ 인력 배치)'
      when p_kind = 'organizational_learning_reference_recorded' then ' (Learning Reference ≠ 자동 조직 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'organization_changed', false, 'personnel_changed', false, 'promotion_applied', false, 'termination_applied', false, 'compensation_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_organization_models_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_organization_models language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_organization_models
  where (p_status is null or organization_status = p_status)
    and (p_category is null or organization_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_operating_reviews_list(p_model_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_operating_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_operating_reviews
  where (p_model_id is null or organization_model_id = p_model_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_organization_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'models', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_organization_models),
      'draft', (select count(*) from public.ai_enterprise_organization_models where organization_status = 'draft'),
      'active', (select count(*) from public.ai_enterprise_organization_models where organization_status = 'active_reference'),
      'in_review', (select count(*) from public.ai_enterprise_organization_models where organization_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_organization_models where organization_status = 'archived_reference'),
      'healthy', (select count(*) from public.ai_enterprise_organization_models where health_status in ('excellent_health_candidate','healthy_candidate')),
      'unhealthy', (select count(*) from public.ai_enterprise_organization_models where health_status in ('watch_candidate','unhealthy_candidate')),
      'mature', (select count(*) from public.ai_enterprise_organization_models where maturity_status in ('highly_mature_candidate','mature_candidate')),
      'critical_gap', (select count(*) from public.ai_enterprise_organization_models where capability_gap_status in ('significant_gap_candidate','critical_gap_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_organization_models where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(organization_category, cnt), '{}'::jsonb) from (select organization_category, count(*) cnt from public.ai_enterprise_organization_models group by organization_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_operating_reviews),
      'requested', (select count(*) from public.ai_enterprise_operating_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_operating_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_operating_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_operating_reviews where review_status = 'revision_requested')
    ),
    'organization_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_organization_events),
      'team_structures', (select count(*) from public.ai_enterprise_organization_events where event_type = 'team_structure_recorded'),
      'role_mappings', (select count(*) from public.ai_enterprise_organization_events where event_type = 'role_mapping_recorded'),
      'responsibility_matrices', (select count(*) from public.ai_enterprise_organization_events where event_type = 'responsibility_matrix_recorded'),
      'decision_flow_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'decision_flow_reviewed'),
      'collaboration_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'collaboration_network_reviewed'),
      'health_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organizational_health_reviewed'),
      'maturity_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'operating_maturity_reviewed'),
      'bottleneck_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'bottleneck_reviewed'),
      'capability_gap_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'capability_gap_reviewed'),
      'workload_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'workload_balance_reviewed'),
      'dependency_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'dependency_reviewed'),
      'spof_reviews', (select count(*) from public.ai_enterprise_organization_events where event_type = 'single_point_of_failure_reviewed'),
      'scenarios', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organizational_scenario_recorded'),
      'improvement_candidates', (select count(*) from public.ai_enterprise_organization_events where event_type = 'improvement_candidate_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_organization_events where event_type = 'executive_organization_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_organization_events where event_type = 'executive_organization_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organization_recommendation_recorded'),
      'organization_review_requests', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organization_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_organization_events where event_type = 'executive_review_requested'),
      'operating_review_requests', (select count(*) from public.ai_enterprise_organization_events where event_type = 'operating_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organization_review_reference_recorded'),
      'governance_links', (select count(*) from public.ai_enterprise_organization_events where event_type = 'governance_reference_linked'),
      'resource_links', (select count(*) from public.ai_enterprise_organization_events where event_type = 'resource_reference_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_organization_events where event_type = 'organizational_learning_reference_recorded')
    ),
    -- Organization 원천 실측(전부 읽기 전용):
    'organization_actuals', jsonb_build_object(
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'approval_workflows_0551', (select count(*) from public.ai_enterprise_approval_workflows),
      'investment_portfolios_0550', (select count(*) from public.ai_enterprise_investment_portfolios),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'resource_inventory_0546', (select count(*) from public.ai_enterprise_resource_inventory),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'organizational_learnings_0515', (select count(*) from public.ai_organizational_learnings)
    ),
    'organization_unavailable', jsonb_build_array('hr_system_feed','org_chart_ledger','payroll_system','time_tracking_system','collaboration_tool_feed','performance_review_system'),   -- 원본 없음(실측 — 본 계층은 관측·분석용이며 인사 시스템 아님)
    'candidate_is_not_organization_change', true, 'improvement_candidate_is_not_approved_improvement', true,
    'capability_gap_is_not_employee_performance', true, 'organizational_health_is_not_hr_evaluation', true,
    'operating_maturity_is_not_organizational_success', true, 'bottleneck_is_not_root_cause', true,
    'collaboration_score_is_not_team_quality', true, 'recommendation_is_not_decision', true,
    'review_is_not_approval', true, 'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_reorganization', true, 'no_auto_personnel_change', true, 'no_auto_promotion', true,
    'no_auto_termination', true, 'no_auto_evaluation', true, 'no_auto_compensation', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_organization_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_organization_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_organization_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_organization_models enable row level security;
alter table public.ai_enterprise_operating_reviews enable row level security;
alter table public.ai_enterprise_organization_events enable row level security;

comment on table public.ai_enterprise_organization_models is 'AI-OPS-48 — Organization Model(≠ 조직 개편/인사 시스템·Category 16종·자동 개편/인사 계열 차단·Capability Gap ≠ Employee Performance).';
comment on table public.ai_enterprise_operating_reviews is 'AI-OPS-48 — Operating Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_organization_events is 'AI-OPS-48 — Organization 이벤트 31종(자동 개편 이벤트 생성 금지·Organizational Health ≠ HR Evaluation).';
