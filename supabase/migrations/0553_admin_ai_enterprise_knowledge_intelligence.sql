-- 0553_admin_ai_enterprise_knowledge_intelligence.sql
-- AI-OPS-49 — Enterprise Knowledge Intelligence, Organizational Memory &
-- Continuous Learning Center.
--
-- Enterprise Vision → Enterprise Knowledge → Knowledge Source → Knowledge
-- Validation → Evidence → Knowledge Relationship → Organizational Memory →
-- Experience Pattern → Lesson Learned → Knowledge Quality → Continuous
-- Learning → Executive Knowledge Review → Knowledge Audit.
--
-- 정직성(전부 서버 강제):
--  * Knowledge Candidate ≠ Verified Knowledge — 자동 사실 확정/정책 승격/법적
--    판단/Compliance 확정 RPC 자체가 없음.
--  * Lesson Learned ≠ Universal Truth. Best Practice ≠ Mandatory Practice.
--  * Similar Case ≠ Same Outcome. Pattern ≠ Causality.
--  * Knowledge Graph ≠ Proven Relationship. Evidence ≠ Absolute Truth.
--  * Recommendation ≠ Decision. Review ≠ Approval. Confidence ≠ Certainty.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Strategy/Governance/조직/KPI/Budget 변경·자동 Merge/Deploy/Production
--    변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0512/0513/0514/0515/0531/0547/
--    0549/0551/0552 원본 무변경(참조만).
--  * Wiki/문서 관리/외부 지식 베이스/검색 인덱스/회의록/고객 피드백 피드는
--    실측 부재 — insufficient_data 로 유지.
--  * Knowledge Graph/Evidence Chain/Learning History 는 신규 테이블 대신
--    JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Knowledge Memory(≠ 사실 확정 원장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_knowledge_memories (
  id                        uuid primary key default gen_random_uuid(),
  knowledge_code            text not null,
  knowledge_title           text not null,
  knowledge_category        text not null check (knowledge_category in ('strategy','product','engineering','operations','customer','finance','ai','security','compliance','incident','best_practice','lesson_learned','organizational_memory','executive','enterprise','custom')),
  knowledge_status          text not null default 'draft' check (knowledge_status in ('draft','candidate','verified_reference','archived_reference','insufficient_data')),
  knowledge_summary         text,
  quality_status            text not null default 'insufficient_data' check (quality_status in ('excellent_candidate','high_quality_candidate','acceptable_candidate','low_quality_candidate','insufficient_data')),
  evidence_coverage_status  text not null default 'insufficient_data' check (evidence_coverage_status in ('strongly_supported_candidate','adequately_supported_candidate','weakly_supported_candidate','unsupported_candidate','insufficient_data')),
  relationship_status       text not null default 'insufficient_data' check (relationship_status in ('highly_connected_candidate','moderately_connected_candidate','weakly_connected_candidate','relationship_unverified','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  governance_decision_id    uuid,
  business_value_id         uuid,
  execution_program_id      uuid,
  organization_model_id     uuid,
  knowledge_sources         jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  knowledge_graph           jsonb not null default '[]'::jsonb,   -- Relationship append(Graph ≠ Proven Relationship)
  validation_result         jsonb,
  coverage_result           jsonb,
  relationship_result       jsonb,
  memory_result             jsonb,
  pattern_result            jsonb,
  lesson_result             jsonb,
  best_practice_result      jsonb,
  similar_case_result       jsonb,
  quality_result            jsonb,
  freshness_result          jsonb,
  scorecard_result          jsonb,
  learning_history          jsonb not null default '[]'::jsonb,   -- Continuous Learning append
  recommendation_candidate  jsonb,
  knowledge_reviews         jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  learning_references       jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aekm_idem on public.ai_enterprise_knowledge_memories (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aekm_status on public.ai_enterprise_knowledge_memories (knowledge_status, knowledge_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Knowledge Review(§9 — 요청/Reference 기록만, 채택·정책 반영은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_knowledge_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  knowledge_memory_id       uuid not null,
  review_type               text not null check (review_type in ('knowledge_review','executive_review','evidence_review')),
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
create unique index if not exists uq_aekr_idem on public.ai_enterprise_knowledge_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aekr_mem on public.ai_enterprise_knowledge_reviews (knowledge_memory_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Knowledge 이벤트(31종) — Source/Validation/Evidence/Relationship/Graph/
--    Memory/Pattern/Lesson/Best Practice/Similar Case/Quality/Freshness/
--    Learning/Scorecard/Recommendation/Review/Link 통합 Audit(자동 사실 확정
--    이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_knowledge_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('knowledge_memory_created','knowledge_memory_reviewed','knowledge_source_recorded','knowledge_validation_reviewed','evidence_recorded','evidence_coverage_reviewed','knowledge_relationship_recorded','knowledge_graph_reviewed','organizational_memory_recorded','experience_pattern_reviewed','lesson_learned_recorded','best_practice_candidate_recorded','similar_case_search_recorded','knowledge_quality_reviewed','knowledge_freshness_reviewed','continuous_learning_recorded','executive_knowledge_summary_recorded','executive_knowledge_scorecard_recorded','knowledge_recommendation_recorded','knowledge_review_created','knowledge_review_reviewed','knowledge_review_requested','executive_review_requested','evidence_review_requested','knowledge_review_reference_recorded','knowledge_revision_requested','governance_reference_linked','value_reference_linked','program_reference_linked','organization_reference_linked','learning_reference_recorded')),
  knowledge_memory_id       uuid,
  knowledge_review_id       uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeke_evt on public.ai_enterprise_knowledge_events (event_type, created_at desc);
create index if not exists idx_aeke_mem on public.ai_enterprise_knowledge_events (knowledge_memory_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Knowledge Memory 생성 — 자동 사실 확정/정책 승격 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_knowledge_memory_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_knowledge_memories;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'knowledge_category','');
  -- 자동 사실 확정/정책 승격/법적·Compliance 확정 계열 — 구조적 차단.
  if v_cat in ('automatic_fact_confirmation','automatic_policy_promotion','automatic_legal_judgment','automatic_compliance_confirmation','verified_truth','absolute_fact','universal_truth','mandatory_practice') then
    raise exception '금지된 knowledge_category(자동 사실 확정/정책 승격 계열 비활성)';
  end if;
  if v_cat not in ('strategy','product','engineering','operations','customer','finance','ai','security','compliance','incident','best_practice','lesson_learned','organizational_memory','executive','enterprise','custom') then
    raise exception '허용되지 않는 knowledge_category';
  end if;
  if coalesce(btrim(p_payload->>'knowledge_title'),'') = '' then raise exception 'knowledge_title 필수'; end if;
  if nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_knowledge_memories where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'candidate_is_not_verified_knowledge', true); end if;
  end if;
  insert into public.ai_enterprise_knowledge_memories (knowledge_code, knowledge_title, knowledge_category, knowledge_summary, governance_decision_id, business_value_id, execution_program_id, organization_model_id, knowledge_sources, evidence, assumptions, unknown_factors, external_factors, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'knowledge_code',''), 'EKM-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'knowledge_title', 200), v_cat,
    nullif(left(coalesce(p_payload->>'knowledge_summary',''), 2000),''),
    nullif(p_payload->>'governance_decision_id','')::uuid, nullif(p_payload->>'business_value_id','')::uuid,
    nullif(p_payload->>'execution_program_id','')::uuid, nullif(p_payload->>'organization_model_id','')::uuid,
    coalesce(p_payload->'knowledge_sources', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, detail, payload, actor_id)
  values ('knowledge_memory_created', v_id, left(v_cat, 80) || ' (Knowledge Candidate ≠ Verified Knowledge — draft·자동 사실 확정 없음)', jsonb_build_object('knowledge_title', p_payload->>'knowledge_title'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'candidate_is_not_verified_knowledge', true, 'fact_confirmed', false, 'policy_promoted', false, 'strategy_changed', false, 'governance_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Knowledge Memory 검토 — verified_reference 는 Self 차단 + Evidence 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_knowledge_memory_review(p_memory_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_knowledge_memories; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_candidate','record_verified_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_knowledge_memories where id = p_memory_id;
  if v_row.id is null then raise exception 'Knowledge Memory 없음(실존 검증 실패)'; end if;
  if v_row.knowledge_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_candidate' then v_next := 'candidate';
  elsif p_action = 'record_verified_reference' then
    -- 사람의 검증 기록(자동 사실 확정 아님) — Self 차단 + Evidence 필수.
    if v_row.created_by = v_uid then raise exception 'Self-Verification 차단(작성자 ≠ 검증자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Verified Reference 금지';
    end if;
    v_next := 'verified_reference'; v_note := ' (Verified Reference — 사람의 검증 기록이며 Universal Truth 아님)';
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_knowledge_memories set knowledge_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_memory_id;
  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, detail, payload, actor_id)
  values ('knowledge_memory_reviewed', p_memory_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_memory_id, 'status', v_next, 'candidate_is_not_verified_knowledge', true, 'fact_confirmed', false, 'policy_promoted', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Knowledge Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_knowledge_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_mem public.ai_enterprise_knowledge_memories; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_knowledge_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('knowledge_review','executive_review','evidence_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'knowledge_memory_id','') is null then raise exception 'knowledge_memory_id 필수'; end if;
  select * into v_mem from public.ai_enterprise_knowledge_memories where id = (p_payload->>'knowledge_memory_id')::uuid;
  if v_mem.id is null then raise exception 'Knowledge Memory 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_knowledge_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_knowledge_reviews (review_code, knowledge_memory_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EKR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_mem.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'knowledge_review' then 'knowledge_review_requested' when 'executive_review' then 'executive_review_requested' else 'evidence_review_requested' end;
  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, knowledge_review_id, detail, payload, actor_id)
  values (v_evt, v_mem.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 채택·정책 반영은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, knowledge_review_id, detail, payload, actor_id)
  values ('knowledge_review_created', v_mem.id, v_id, 'Knowledge Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'fact_confirmed', false, 'policy_promoted', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_knowledge_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_knowledge_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_knowledge_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Knowledge Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'fact_confirmed', false, 'policy_promoted', false, 'strategy_changed', false,
    'governance_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 채택은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Knowledge Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 채택·정책 반영은 사람)';
    update public.ai_enterprise_knowledge_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_knowledge_memories set
      knowledge_reviews = knowledge_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.knowledge_memory_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_knowledge_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, knowledge_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'knowledge_review_reference_recorded' when p_action = 'request_revision' then 'knowledge_revision_requested' else 'knowledge_review_reviewed' end,
    v_row.knowledge_memory_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'fact_confirmed', false, 'policy_promoted', false, 'strategy_changed', false, 'governance_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Knowledge 이벤트 기록(통합) — 자동 사실 확정 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_knowledge_event_record(p_kind text, p_reason text, p_payload jsonb, p_memory_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('knowledge_source_recorded','knowledge_validation_reviewed','evidence_recorded','evidence_coverage_reviewed','knowledge_relationship_recorded','knowledge_graph_reviewed','organizational_memory_recorded','experience_pattern_reviewed','lesson_learned_recorded','best_practice_candidate_recorded','similar_case_search_recorded','knowledge_quality_reviewed','knowledge_freshness_reviewed','continuous_learning_recorded','executive_knowledge_summary_recorded','executive_knowledge_scorecard_recorded','knowledge_recommendation_recorded','governance_reference_linked','value_reference_linked','program_reference_linked','organization_reference_linked','learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_memory_id is not null and not exists (select 1 from public.ai_enterprise_knowledge_memories where id = p_memory_id) then raise exception 'Knowledge Memory 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_knowledge_reviews where id = p_review_id) then raise exception 'Knowledge Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'knowledge_source_recorded' and p_memory_id is not null then
    update public.ai_enterprise_knowledge_memories set knowledge_sources = knowledge_sources || jsonb_build_array(p_payload), updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'knowledge_validation_reviewed' then
    if v_result not in ('validated_candidate','partially_validated_candidate','validation_failed_candidate','validation_unverified','insufficient_data') then raise exception '허용되지 않는 validation result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set validation_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'evidence_recorded' and p_memory_id is not null then
    -- Evidence Chain 은 evidence[] append(Evidence ≠ Absolute Truth).
    update public.ai_enterprise_knowledge_memories set evidence = evidence || jsonb_build_array(p_payload), updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'evidence_coverage_reviewed' then
    if v_result not in ('strongly_supported_candidate','adequately_supported_candidate','weakly_supported_candidate','unsupported_candidate','insufficient_data') then raise exception '허용되지 않는 coverage result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set evidence_coverage_status = v_result, coverage_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'knowledge_relationship_recorded' then
    if coalesce(p_payload->>'relationship_type','') not in ('related','depends_on','derived_from','similar_to','contradicts','reinforces') then
      raise exception '허용되지 않는 relationship_type(§7 — 6종)';
    end if;
    if nullif(p_payload->>'target_memory_id','') is not null
       and not exists (select 1 from public.ai_enterprise_knowledge_memories where id = (p_payload->>'target_memory_id')::uuid) then
      raise exception 'Target Knowledge Memory 없음(실존 검증 실패)';
    end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set knowledge_graph = knowledge_graph || jsonb_build_array(p_payload), updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'knowledge_graph_reviewed' then
    if v_result not in ('highly_connected_candidate','moderately_connected_candidate','weakly_connected_candidate','relationship_unverified','insufficient_data') then raise exception '허용되지 않는 graph result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set relationship_status = v_result, relationship_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'organizational_memory_recorded' and p_memory_id is not null then
    update public.ai_enterprise_knowledge_memories set memory_result = p_payload, updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'experience_pattern_reviewed' then
    if v_result not in ('recurring_pattern_candidate','emerging_pattern_candidate','no_material_pattern_candidate','pattern_unverified','insufficient_data') then raise exception '허용되지 않는 pattern result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set pattern_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'lesson_learned_recorded' then
    -- Lesson Learned ≠ Universal Truth — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Lesson Learned 기록 금지';
    end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set lesson_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'best_practice_candidate_recorded' then
    -- Best Practice ≠ Mandatory Practice — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Best Practice 후보 기록 금지';
    end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set best_practice_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'similar_case_search_recorded' and p_memory_id is not null then
    update public.ai_enterprise_knowledge_memories set similar_case_result = p_payload, updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'knowledge_quality_reviewed' then
    if v_result not in ('excellent_candidate','high_quality_candidate','acceptable_candidate','low_quality_candidate','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set quality_status = v_result, quality_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'knowledge_freshness_reviewed' then
    if v_result not in ('fresh_candidate','aging_candidate','stale_candidate','freshness_unverified','insufficient_data') then raise exception '허용되지 않는 freshness result'; end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set freshness_result = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'continuous_learning_recorded' and p_memory_id is not null then
    -- Learning History append(자동 정책 반영 없음).
    update public.ai_enterprise_knowledge_memories set learning_history = learning_history || jsonb_build_array(p_payload), updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'executive_knowledge_scorecard_recorded' and p_memory_id is not null then
    update public.ai_enterprise_knowledge_memories set scorecard_result = p_payload, updated_at = now() where id = p_memory_id;
  end if;
  if p_kind = 'knowledge_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_knowledge_memory','record_knowledge_source','record_evidence','review_knowledge_validation','review_evidence_coverage','record_knowledge_relationship','review_knowledge_graph','record_organizational_memory','review_experience_pattern','record_lesson_learned','record_best_practice_candidate','search_similar_cases','review_knowledge_quality','review_knowledge_freshness','record_continuous_learning','build_executive_knowledge_summary','build_executive_knowledge_scorecard','request_knowledge_review','request_executive_review','request_evidence_review','record_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Knowledge Recommendation 금지';
    end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set recommendation_candidate = p_payload, updated_at = now() where id = p_memory_id; end if;
  end if;
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'organization_reference_linked' and nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if p_kind = 'learning_reference_recorded' then
    if nullif(p_payload->>'organizational_learning_id','') is not null
       and not exists (select 1 from public.ai_organizational_learnings where id = (p_payload->>'organizational_learning_id')::uuid) then
      raise exception 'Organizational Learning 없음(실존 검증 실패)';
    end if;
    if p_memory_id is not null then update public.ai_enterprise_knowledge_memories set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_memory_id; end if;
  end if;

  insert into public.ai_enterprise_knowledge_events (event_type, knowledge_memory_id, knowledge_review_id, detail, payload, actor_id)
  values (p_kind, p_memory_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'knowledge_source_recorded' then ' (Source 기록 ≠ 출처 신뢰 확정)'
      when p_kind = 'knowledge_validation_reviewed' then ' (Validation Candidate ≠ 사실 확정)'
      when p_kind = 'evidence_recorded' then ' (Evidence ≠ Absolute Truth)'
      when p_kind = 'evidence_coverage_reviewed' then ' (Coverage Candidate ≠ 근거 충분 확정)'
      when p_kind = 'knowledge_relationship_recorded' then ' (Knowledge Graph ≠ Proven Relationship)'
      when p_kind = 'knowledge_graph_reviewed' then ' (Graph Candidate ≠ 관계 확정)'
      when p_kind = 'organizational_memory_recorded' then ' (Organizational Memory ≠ 공식 기록 확정)'
      when p_kind = 'experience_pattern_reviewed' then ' (Pattern ≠ Causality)'
      when p_kind = 'lesson_learned_recorded' then ' (Lesson Learned ≠ Universal Truth)'
      when p_kind = 'best_practice_candidate_recorded' then ' (Best Practice ≠ Mandatory Practice)'
      when p_kind = 'similar_case_search_recorded' then ' (Similar Case ≠ Same Outcome)'
      when p_kind = 'knowledge_quality_reviewed' then ' (Quality Candidate ≠ Verified Knowledge)'
      when p_kind = 'knowledge_freshness_reviewed' then ' (Freshness ≠ 정확성 판단)'
      when p_kind = 'continuous_learning_recorded' then ' (Learning 기록 ≠ 자동 정책 반영)'
      when p_kind = 'executive_knowledge_summary_recorded' then ' (Summary ≠ 지식 확정)'
      when p_kind = 'executive_knowledge_scorecard_recorded' then ' (Scorecard ≠ 사실 확정)'
      when p_kind = 'knowledge_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 가치 확정)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 보장)'
      when p_kind = 'organization_reference_linked' then ' (Organization Reference ≠ 조직 변경)'
      when p_kind = 'learning_reference_recorded' then ' (Learning Reference ≠ 자동 정책 승격)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'fact_confirmed', false, 'policy_promoted', false, 'legal_judgment_made', false, 'compliance_confirmed', false, 'strategy_changed', false, 'governance_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_knowledge_memories_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_knowledge_memories language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_knowledge_memories
  where (p_status is null or knowledge_status = p_status)
    and (p_category is null or knowledge_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_knowledge_reviews_list(p_memory_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_knowledge_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_knowledge_reviews
  where (p_memory_id is null or knowledge_memory_id = p_memory_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_knowledge_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'memories', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_knowledge_memories),
      'draft', (select count(*) from public.ai_enterprise_knowledge_memories where knowledge_status = 'draft'),
      'candidate', (select count(*) from public.ai_enterprise_knowledge_memories where knowledge_status = 'candidate'),
      'verified', (select count(*) from public.ai_enterprise_knowledge_memories where knowledge_status = 'verified_reference'),
      'archived', (select count(*) from public.ai_enterprise_knowledge_memories where knowledge_status = 'archived_reference'),
      'high_quality', (select count(*) from public.ai_enterprise_knowledge_memories where quality_status in ('excellent_candidate','high_quality_candidate')),
      'low_quality', (select count(*) from public.ai_enterprise_knowledge_memories where quality_status = 'low_quality_candidate'),
      'strongly_supported', (select count(*) from public.ai_enterprise_knowledge_memories where evidence_coverage_status = 'strongly_supported_candidate'),
      'unsupported', (select count(*) from public.ai_enterprise_knowledge_memories where evidence_coverage_status in ('weakly_supported_candidate','unsupported_candidate')),
      'highly_connected', (select count(*) from public.ai_enterprise_knowledge_memories where relationship_status = 'highly_connected_candidate'),
      'reviewed_references', (select count(*) from public.ai_enterprise_knowledge_memories where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(knowledge_category, cnt), '{}'::jsonb) from (select knowledge_category, count(*) cnt from public.ai_enterprise_knowledge_memories group by knowledge_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_knowledge_reviews),
      'requested', (select count(*) from public.ai_enterprise_knowledge_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_knowledge_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_knowledge_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_knowledge_reviews where review_status = 'revision_requested')
    ),
    'knowledge_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_knowledge_events),
      'sources', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_source_recorded'),
      'validations', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_validation_reviewed'),
      'evidence_records', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'evidence_recorded'),
      'coverage_reviews', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'evidence_coverage_reviewed'),
      'relationships', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_relationship_recorded'),
      'graph_reviews', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_graph_reviewed'),
      'org_memories', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'organizational_memory_recorded'),
      'pattern_reviews', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'experience_pattern_reviewed'),
      'lessons', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'lesson_learned_recorded'),
      'best_practices', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'best_practice_candidate_recorded'),
      'similar_searches', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'similar_case_search_recorded'),
      'quality_reviews', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_quality_reviewed'),
      'freshness_reviews', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_freshness_reviewed'),
      'learnings', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'continuous_learning_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'executive_knowledge_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'executive_knowledge_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_recommendation_recorded'),
      'knowledge_review_requests', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'executive_review_requested'),
      'evidence_review_requests', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'evidence_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'knowledge_review_reference_recorded'),
      'governance_links', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'governance_reference_linked'),
      'organization_links', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'organization_reference_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_knowledge_events where event_type = 'learning_reference_recorded')
    ),
    -- Knowledge 원천 실측(전부 읽기 전용):
    'knowledge_actuals', jsonb_build_object(
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'knowledge_relationships_0513', (select count(*) from public.ai_knowledge_relationships),
      'org_memory_0531', (select count(*) from public.ai_org_memory),
      'organizational_learnings_0515', (select count(*) from public.ai_organizational_learnings),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules),
      'organization_models_0552', (select count(*) from public.ai_enterprise_organization_models)
    ),
    'knowledge_unavailable', jsonb_build_array('wiki_system_feed','document_management_system','external_knowledge_base_feed','search_index_feed','meeting_notes_feed','customer_feedback_feed'),   -- 원본 없음(실측)
    'candidate_is_not_verified_knowledge', true, 'lesson_learned_is_not_universal_truth', true,
    'best_practice_is_not_mandatory_practice', true, 'similar_case_is_not_same_outcome', true,
    'pattern_is_not_causality', true, 'knowledge_graph_is_not_proven_relationship', true,
    'recommendation_is_not_decision', true, 'review_is_not_approval', true,
    'evidence_is_not_absolute_truth', true, 'confidence_is_not_certainty', true, 'forecast_is_not_future_fact', true,
    'no_auto_fact_confirmation', true, 'no_auto_policy_promotion', true, 'no_auto_legal_judgment', true,
    'no_auto_compliance_confirmation', true, 'no_auto_strategy_change', true, 'no_auto_governance_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_knowledge_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_knowledge_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_knowledge_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_knowledge_memories enable row level security;
alter table public.ai_enterprise_knowledge_reviews enable row level security;
alter table public.ai_enterprise_knowledge_events enable row level security;

comment on table public.ai_enterprise_knowledge_memories is 'AI-OPS-49 — Knowledge Memory(≠ 사실 확정 원장·Category 16종·자동 사실 확정/정책 승격 차단·Lesson ≠ Universal Truth).';
comment on table public.ai_enterprise_knowledge_reviews is 'AI-OPS-49 — Knowledge Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_knowledge_events is 'AI-OPS-49 — Knowledge 이벤트 31종(자동 사실 확정 이벤트 생성 금지·Pattern ≠ Causality).';
