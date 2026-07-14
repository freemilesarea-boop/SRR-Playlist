-- 0515_admin_ai_organizational_learning_policy_evolution.sql
-- Phase AI-OPS-12 — Enterprise Organizational Learning, Policy Evolution & Adaptive Governance.
--
-- 실제 Learning/Policy 구조 분석 결과(추측 없음 — 0512/0514 에서 검증 완료):
--   Decision Learning 원본: ai_decision_memory/execution_references/observation_windows/
--     outcomes(인과·재현성·품질·lesson)/memory_events(0514).
--   Policy 원본: ai_enterprise_policies/policy_versions/policy_recommendations(0512),
--     settlement_policies(0059)/subscription_plans(0015)/franchise_music_policies(0349)/
--     ai_data_retention_policies(0510)/ai_operational_policies(0509)/automation_rules(0378).
--   Scope 실체: Enterprise=franchises·enterprise_accounts / Store=users(business) /
--     business_category(users) — Brand/Region/Team 구조 미존재(scope_unverified 정직 표기).
--
-- 학습 정직성(전부 강제):
--   * 1회 성공 ≠ Best Practice, 1회 실패 ≠ 폐기 근거. Context 다르면 통합 금지.
--   * Outcome 미관측 Decision 은 학습 증거 제외(exclusion_reason 기록 — 삭제 안 함).
--   * 인과 미확인 근거는 strong 상한 제한. 충돌 근거는 평균으로 숨기지 않음(보존).
--   * Policy Reference ≠ 실제 운영 적용(policy_application_unverified).
--   * Evolution Candidate ≠ 승인 정책. approved_reference ≠ 실제 적용 완료.
--   * Learning Maturity/Decision Quality 는 인사·조직 평가 용도 아님.
--   * 자동 정책 변경/승인/폐기/적용·모델 학습·Weight/Prompt/Trust/Constitution 변경 없음.
--   * Policy Version 생성 RPC 없음 · Trigger 없음 · 삭제 RPC 없음 · 원본 테이블 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Learning Evidence Pool — 요약+참조(원본 Outcome 복제 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_organizational_learning_evidence (
  id                  uuid primary key default gen_random_uuid(),
  evidence_code       text not null unique,
  learning_domain     text not null check (learning_domain in ('operations','execution','reliability','release','capacity','cost','continuity','security','privacy','compliance','executive','strategy','policy','knowledge_graph','incident','recovery','governance','manual')),
  source_decision_id  uuid references public.ai_decision_memory(id),
  source_outcome_id   uuid references public.ai_decision_outcomes(id),
  source_policy_id    uuid references public.ai_enterprise_policies(id),
  scope_type          text not null default 'unverified' check (scope_type in ('enterprise','store','artist','playlist','contract','policy','domain','business_category','global_candidate','unverified')),
  scope_id            text,
  context_signature   text not null,                          -- 실존 필드 기반 서명(다르면 통합 금지)
  outcome_status      text not null check (outcome_status in ('positive','mixed','neutral','negative','inconclusive','insufficient_data')),
  causality_status    text not null default 'causality_unverified' check (causality_status in ('not_evaluated','temporally_correlated','scope_correlated','plausible_contribution','causality_unverified','confounded','unrelated','insufficient_data')),
  repeatability_status text not null default 'not_evaluated' check (repeatability_status in ('not_evaluated','single_observation','partially_repeated','consistently_observed','inconsistent','repeatability_unverified','insufficient_data')),
  evidence_strength   text not null check (evidence_strength in ('strong','moderate','weak','unverified','conflicting','insufficient_data')),
  applicability_status text not null default 'applicability_unverified' check (applicability_status in ('enterprise_specific','brand_specific','store_specific','business_category_specific','policy_specific','context_specific','cross_scope_candidate','broadly_applicable_candidate','applicability_unverified','not_applicable','insufficient_data')),
  eligibility         text not null default 'eligible' check (eligibility in ('eligible','excluded')),
  exclusion_reason    text,                                   -- 제외해도 삭제하지 않음
  evidence_summary    text not null,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["상관 ≠ 인과","단일 근거 일반화 금지"]'::jsonb,
  observed_at         timestamptz,
  source_version      text not null default 'olearn_v1(0515)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
-- 인과 미확인이면 strong 금지(서버 강제)
alter table public.ai_organizational_learning_evidence
  add constraint olearn_ev_causality_strong_cap
  check (evidence_strength <> 'strong' or causality_status in ('plausible_contribution','scope_correlated','temporally_correlated'));
create index if not exists idx_olearn_ev on public.ai_organizational_learning_evidence (learning_domain, eligibility, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Learning Pattern — 근거 집합의 경향(Best Practice 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_organizational_learning_patterns (
  id                  uuid primary key default gen_random_uuid(),
  pattern_code        text not null unique,
  learning_domain     text not null,
  pattern_type        text not null check (pattern_type in ('repeated_success_candidate','repeated_failure_candidate','conditional_success','conditional_failure','regression_pattern','no_material_effect','mixed_outcome_pattern','inconclusive_pattern','confidence_misalignment','approval_bias_candidate','rejection_bias_candidate','execution_gap_pattern','observation_gap_pattern','policy_outcome_mismatch','scope_specific_pattern','stale_policy_candidate','governance_gap_candidate','insufficient_data')),
  scope_type          text not null default 'unverified',
  scope_id            text,
  context_signature   text not null,
  supporting_evidence_ids jsonb not null default '[]'::jsonb,
  contradicting_evidence_ids jsonb not null default '[]'::jsonb,
  sample_size         int not null default 0 check (sample_size >= 0),
  positive_count      int not null default 0 check (positive_count >= 0),
  negative_count      int not null default 0 check (negative_count >= 0),
  mixed_count         int not null default 0 check (mixed_count >= 0),
  inconclusive_count  int not null default 0 check (inconclusive_count >= 0),
  pattern_strength    text not null default 'insufficient_data' check (pattern_strength in ('strong','moderate','weak','unverified','conflicting','insufficient_data')),
  repeatability_status text not null default 'sample_too_small' check (repeatability_status in ('single_observation','partially_repeated','consistently_observed','context_limited','inconsistent','repeatability_unverified','sample_too_small','insufficient_data')),
  applicability_status text not null default 'applicability_unverified',
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  pattern_summary     text not null,
  reusable_insight    text,
  non_reusable_conditions jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["경향 — Best Practice/전사 표준 아님","원인 단정 없음"]'::jsonb,
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','provisional','validated_reference','conflicting','stale_candidate','rejected','invalidated','insufficient_data')),
  reviewed_by         uuid,
  reviewed_at         timestamptz,
  source_version      text not null default 'olearn_v1(0515)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_olearn_pat on public.ai_organizational_learning_patterns (pattern_type, lifecycle_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Organizational Learning — 사람 검토된 조직 지식 Reference(자동 적용 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_organizational_learnings (
  id                  uuid primary key default gen_random_uuid(),
  learning_code       text not null unique,
  title               text not null,
  learning_domain     text not null,
  scope_type          text not null default 'unverified',
  scope_id            text,
  supporting_pattern_ids jsonb not null default '[]'::jsonb,
  contradicting_pattern_ids jsonb not null default '[]'::jsonb,
  learning_summary    text not null,
  what_worked         jsonb not null default '[]'::jsonb,
  what_did_not_work   jsonb not null default '[]'::jsonb,
  applicability_status text not null default 'applicability_unverified',
  repeatability_status text not null default 'repeatability_unverified',
  evidence_strength   text not null default 'insufficient_data',
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  operational_implication text,
  policy_implication  text,
  strategy_implication text,
  governance_implication text,
  limitations         jsonb not null default '["AI 초안 ≠ 검증된 조직 지식 — 사람 검토 필수","인사 평가 용도 아님"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','validated_reference','rejected','invalidated','stale_candidate','insufficient_data')),
  reviewed_by         uuid,
  approved_by         uuid,
  reviewed_at         timestamptz,
  source_version      text not null default 'olearn_v1(0515)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_olearn_learn on public.ai_organizational_learnings (review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Policy Evolution Candidate — 후보만(실제 Policy Version 생성/적용 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_policy_evolution_candidates (
  id                  uuid primary key default gen_random_uuid(),
  candidate_code      text not null unique,
  policy_id           uuid not null references public.ai_enterprise_policies(id),
  current_policy_version int,
  candidate_type      text not null check (candidate_type in ('retain_current_policy','clarify_policy','narrow_policy_scope','expand_policy_scope_candidate','revise_threshold_candidate','revise_process_candidate','add_exception_candidate','remove_exception_candidate','split_policy_candidate','merge_policy_candidate','deprecate_policy_candidate','replace_policy_candidate','request_more_evidence','insufficient_data')),
  target_scope_type   text not null default 'unverified',
  target_scope_id     text,
  proposed_change_summary text not null,
  reason              text not null,
  supporting_learning_ids jsonb not null default '[]'::jsonb,
  contradicting_learning_ids jsonb not null default '[]'::jsonb,
  expected_benefit    text not null,
  expected_risk       text not null,
  alternatives        jsonb not null default '[]'::jsonb,
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence_strength   text not null default 'insufficient_data',
  repeatability_status text not null default 'repeatability_unverified',
  applicability_status text not null default 'applicability_unverified',
  safety_gate         jsonb,                                  -- 순수 로직 평가 결과(ready/waiting/…)
  preconditions       jsonb not null default '["Human Approval","현재 정책 실제 적용 여부 확인(policy_application_unverified 가능)"]'::jsonb,
  limitations         jsonb not null default '["후보만 — 실제 Policy Version 생성/적용 없음","approved_reference ≠ 적용 완료"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','validated_reference','approved_reference','rejected','cancelled','expired','invalidated')),
  reviewer_id         uuid,
  approver_id         uuid,
  self_approval_warning boolean not null default false,
  decision_reason     text,
  source_version      text not null default 'olearn_v1(0515)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz
);
create index if not exists idx_olearn_evo on public.ai_policy_evolution_candidates (review_status, created_at desc);

create table if not exists public.ai_organizational_learning_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('learning_evidence_created','learning_evidence_excluded','pattern_detected','conflicting_evidence_detected','repeated_failure_detected','repeated_success_detected','organizational_learning_drafted','organizational_learning_validated_reference','learning_marked_stale_candidate','policy_outcome_mapping_generated','policy_evolution_candidate_created','policy_evolution_review_started','policy_evolution_approved_reference','policy_evolution_rejected','governance_adaptation_recommended','practice_candidate_created','external_policy_action_reference','learning_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_olearn_evt on public.ai_organizational_learning_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 요약.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_organizational_learning_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'evidence_total', (select count(*) from public.ai_organizational_learning_evidence),
    'evidence_eligible', (select count(*) from public.ai_organizational_learning_evidence where eligibility = 'eligible'),
    'evidence_excluded', (select count(*) from public.ai_organizational_learning_evidence where eligibility = 'excluded'),
    'evidence_by_strength', (select coalesce(jsonb_object_agg(evidence_strength, n), '{}'::jsonb) from (select evidence_strength, count(*) n from public.ai_organizational_learning_evidence group by evidence_strength) x),
    'patterns_by_status', (select coalesce(jsonb_object_agg(lifecycle_status, n), '{}'::jsonb) from (select lifecycle_status, count(*) n from public.ai_organizational_learning_patterns group by lifecycle_status) x),
    'patterns_by_type', (select coalesce(jsonb_object_agg(pattern_type, n), '{}'::jsonb) from (select pattern_type, count(*) n from public.ai_organizational_learning_patterns group by pattern_type) x),
    'learnings_by_status', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from (select review_status, count(*) n from public.ai_organizational_learnings group by review_status) x),
    'evolution_by_status', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from (select review_status, count(*) n from public.ai_policy_evolution_candidates group by review_status) x),
    -- 원본 실측(참조만):
    'source_counts', jsonb_build_object(
      'decisions', (select count(*) from public.ai_decision_memory),
      'outcomes', (select count(*) from public.ai_decision_outcomes),
      'outcomes_evaluable', (select count(*) from public.ai_decision_outcomes where outcome_status in ('positive','mixed','neutral','negative')),
      'lessons_validated', (select count(*) from public.ai_decision_outcomes where lesson_status = 'validated_reference'),
      'policies', (select count(*) from public.ai_enterprise_policies),
      'policy_versions', (select count(*) from public.ai_enterprise_policy_versions),
      'policy_recommendations', (select count(*) from public.ai_policy_recommendations)
    ),
    'no_auto_policy_change', true, 'no_auto_training', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Evidence 생성/조회 — Decision/Outcome 실존 검증, 제외 사유 보존.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_evidence_create(
  p_code text, p_domain text, p_summary text, p_context_signature text,
  p_outcome_status text, p_evidence_strength text,
  p_source_decision_id uuid default null, p_source_outcome_id uuid default null, p_source_policy_id uuid default null,
  p_scope_type text default 'unverified', p_scope_id text default null,
  p_causality text default 'causality_unverified', p_repeatability text default 'not_evaluated',
  p_applicability text default 'applicability_unverified',
  p_eligibility text default 'eligible', p_exclusion_reason text default null,
  p_assumptions jsonb default '[]'::jsonb, p_unknown_factors jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_summary is null or btrim(p_summary) = '' then raise exception 'evidence_summary 필수'; end if;
  if p_context_signature is null or btrim(p_context_signature) = '' then raise exception 'context_signature 필수'; end if;
  if p_eligibility = 'excluded' and (p_exclusion_reason is null or btrim(p_exclusion_reason) = '') then raise exception '제외 시 exclusion_reason 필수(삭제 아님)'; end if;
  if p_source_decision_id is not null and not exists (select 1 from public.ai_decision_memory where id = p_source_decision_id) then raise exception 'decision 실존 검증 실패'; end if;
  if p_source_outcome_id is not null and not exists (select 1 from public.ai_decision_outcomes where id = p_source_outcome_id) then raise exception 'outcome 실존 검증 실패'; end if;
  if p_source_policy_id is not null and not exists (select 1 from public.ai_enterprise_policies where id = p_source_policy_id) then raise exception 'policy 실존 검증 실패'; end if;
  if pg_column_size(coalesce(p_assumptions, '[]'::jsonb)) > 16384 or pg_column_size(coalesce(p_unknown_factors, '[]'::jsonb)) > 16384 then raise exception 'payload 크기 초과'; end if;
  select id into v_id from public.ai_organizational_learning_evidence where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_organizational_learning_evidence (evidence_code, learning_domain, source_decision_id, source_outcome_id, source_policy_id, scope_type, scope_id, context_signature, outcome_status, causality_status, repeatability_status, evidence_strength, applicability_status, eligibility, exclusion_reason, evidence_summary, assumptions, unknown_factors, idempotency_key, created_by)
  values (p_code, p_domain, p_source_decision_id, p_source_outcome_id, p_source_policy_id, coalesce(p_scope_type, 'unverified'), p_scope_id, p_context_signature, p_outcome_status, coalesce(p_causality, 'causality_unverified'), coalesce(p_repeatability, 'not_evaluated'), p_evidence_strength, coalesce(p_applicability, 'applicability_unverified'), coalesce(p_eligibility, 'eligible'), p_exclusion_reason, left(p_summary, 2000), coalesce(p_assumptions, '[]'::jsonb), coalesce(p_unknown_factors, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id)
  values (case when p_eligibility = 'excluded' then 'learning_evidence_excluded' else 'learning_evidence_created' end, v_id, p_code || ' (' || p_domain || ')' || coalesce(' — ' || p_exclusion_reason, ''), v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_learning_evidence(p_domain text default null, p_eligibility text default null, p_limit int default 100)
returns setof public.ai_organizational_learning_evidence language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_organizational_learning_evidence
    where (p_domain is null or learning_domain = p_domain) and (p_eligibility is null or eligibility = p_eligibility)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Pattern 생성/조회 — 연결 evidence 수 제한, 카운트 정합 검증.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_pattern_create(
  p_code text, p_domain text, p_pattern_type text, p_summary text, p_context_signature text,
  p_supporting jsonb, p_contradicting jsonb default '[]'::jsonb,
  p_sample_size int default 0, p_positive int default 0, p_negative int default 0, p_mixed int default 0, p_inconclusive int default 0,
  p_strength text default 'insufficient_data', p_repeatability text default 'sample_too_small',
  p_applicability text default 'applicability_unverified', p_confidence numeric default null,
  p_reusable_insight text default null, p_non_reusable jsonb default '[]'::jsonb, p_scope_type text default 'unverified', p_scope_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_summary is null or btrim(p_summary) = '' then raise exception 'pattern_summary 필수'; end if;
  if p_supporting is null or jsonb_typeof(p_supporting) <> 'array' or jsonb_array_length(p_supporting) = 0 then raise exception 'supporting evidence 필수'; end if;
  if jsonb_array_length(p_supporting) > 100 or jsonb_array_length(coalesce(p_contradicting, '[]'::jsonb)) > 100 then raise exception 'evidence 연결 100개 제한'; end if;
  if p_sample_size < 0 or p_positive < 0 or p_negative < 0 or p_mixed < 0 or p_inconclusive < 0 then raise exception '음수 count 금지'; end if;
  if p_positive + p_negative + p_mixed + p_inconclusive > p_sample_size then raise exception 'count 합이 sample_size 초과'; end if;
  select id into v_id from public.ai_organizational_learning_patterns where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_organizational_learning_patterns (pattern_code, learning_domain, pattern_type, scope_type, scope_id, context_signature, supporting_evidence_ids, contradicting_evidence_ids, sample_size, positive_count, negative_count, mixed_count, inconclusive_count, pattern_strength, repeatability_status, applicability_status, confidence, pattern_summary, reusable_insight, non_reusable_conditions, idempotency_key, created_by)
  values (p_code, p_domain, p_pattern_type, coalesce(p_scope_type, 'unverified'), p_scope_id, p_context_signature, p_supporting, coalesce(p_contradicting, '[]'::jsonb), p_sample_size, p_positive, p_negative, p_mixed, p_inconclusive, p_strength, p_repeatability, p_applicability, p_confidence, left(p_summary, 2000), p_reusable_insight, coalesce(p_non_reusable, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id)
  values (case when p_pattern_type = 'repeated_failure_candidate' then 'repeated_failure_detected'
               when p_pattern_type = 'repeated_success_candidate' then 'repeated_success_detected'
               when jsonb_array_length(coalesce(p_contradicting, '[]'::jsonb)) > 0 then 'conflicting_evidence_detected'
               else 'pattern_detected' end, v_id, p_code || ' (' || p_pattern_type || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'best_practice', false, 'production_applied', false);
end $$;

create or replace function public.admin_learning_patterns(p_type text default null, p_status text default null, p_limit int default 100)
returns setof public.ai_organizational_learning_patterns language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_organizational_learning_patterns
    where (p_type is null or pattern_type = p_type) and (p_status is null or lifecycle_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Organizational Learning 저장/검토 — validated_reference ≠ 자동 적용.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_organizational_learning_save(
  p_code text, p_title text, p_domain text, p_summary text,
  p_supporting_patterns jsonb, p_what_worked jsonb default '[]'::jsonb, p_what_did_not jsonb default '[]'::jsonb,
  p_applicability text default 'applicability_unverified', p_repeatability text default 'repeatability_unverified',
  p_strength text default 'insufficient_data', p_confidence numeric default null,
  p_policy_implication text default null, p_governance_implication text default null,
  p_scope_type text default 'unverified', p_scope_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' or p_summary is null or btrim(p_summary) = '' then raise exception 'title/summary 필수'; end if;
  if p_supporting_patterns is null or jsonb_typeof(p_supporting_patterns) <> 'array' or jsonb_array_length(p_supporting_patterns) = 0 then raise exception 'supporting pattern 필수'; end if;
  if jsonb_array_length(p_supporting_patterns) > 50 then raise exception 'pattern 연결 50개 제한'; end if;
  select id into v_id from public.ai_organizational_learnings where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_organizational_learnings (learning_code, title, learning_domain, scope_type, scope_id, supporting_pattern_ids, learning_summary, what_worked, what_did_not_work, applicability_status, repeatability_status, evidence_strength, confidence, policy_implication, governance_implication, review_status, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_domain, coalesce(p_scope_type, 'unverified'), p_scope_id, p_supporting_patterns, left(p_summary, 2000), coalesce(p_what_worked, '[]'::jsonb), coalesce(p_what_did_not, '[]'::jsonb), p_applicability, p_repeatability, p_strength, p_confidence, p_policy_implication, p_governance_implication, 'pending_review', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id) values ('organizational_learning_drafted', v_id, p_code || ' — AI 초안 ≠ 검증 지식', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'validated', false, 'production_applied', false);
end $$;

create or replace function public.admin_organizational_learning_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','validated_reference','rejected','invalidated','stale_candidate') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select review_status into v_cur from public.ai_organizational_learnings where id = p_id for update;
  if v_cur is null then raise exception 'learning 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_organizational_learnings
     set review_status = p_status, reviewed_by = v_uid, approved_by = case when p_status = 'validated_reference' then v_uid else approved_by end, reviewed_at = now(), updated_at = now()
   where id = p_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'validated_reference' then 'organizational_learning_validated_reference' when p_status = 'stale_candidate' then 'learning_marked_stale_candidate' when p_status = 'invalidated' then 'learning_invalidated' else 'organizational_learning_drafted' end, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'auto_applied', false, 'production_applied', false);
end $$;

create or replace function public.admin_organizational_learnings(p_status text default null, p_limit int default 100)
returns setof public.ai_organizational_learnings language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_organizational_learnings
    where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Policy Evolution Candidate — 후보만(Policy Version 생성/적용 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_policy_evolution_candidate_create(
  p_code text, p_policy_id uuid, p_candidate_type text, p_change_summary text, p_reason text,
  p_expected_benefit text, p_expected_risk text, p_supporting_learnings jsonb default '[]'::jsonb,
  p_alternatives jsonb default '[]'::jsonb, p_confidence numeric default null,
  p_strength text default 'insufficient_data', p_repeatability text default 'repeatability_unverified',
  p_applicability text default 'applicability_unverified', p_safety_gate jsonb default null,
  p_target_scope_type text default 'unverified', p_target_scope_id text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_ver int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  select current_version into v_ver from public.ai_enterprise_policies where id = p_policy_id;
  if v_ver is null then raise exception 'policy 실존 검증 실패'; end if;
  if p_change_summary is null or btrim(p_change_summary) = '' or p_reason is null or btrim(p_reason) = '' then raise exception 'change_summary/reason 필수'; end if;
  if p_expected_benefit is null or btrim(p_expected_benefit) = '' or p_expected_risk is null or btrim(p_expected_risk) = '' then raise exception 'expected_benefit/risk 필수'; end if;
  if jsonb_array_length(coalesce(p_supporting_learnings, '[]'::jsonb)) > 50 then raise exception 'learning 연결 50개 제한'; end if;
  if pg_column_size(coalesce(p_safety_gate, '{}'::jsonb)) > 16384 then raise exception 'safety_gate 크기 초과'; end if;
  select id into v_id from public.ai_policy_evolution_candidates where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_policy_evolution_candidates (candidate_code, policy_id, current_policy_version, candidate_type, target_scope_type, target_scope_id, proposed_change_summary, reason, supporting_learning_ids, expected_benefit, expected_risk, alternatives, confidence, evidence_strength, repeatability_status, applicability_status, safety_gate, review_status, idempotency_key, created_by)
  values (p_code, p_policy_id, v_ver, p_candidate_type, coalesce(p_target_scope_type, 'unverified'), p_target_scope_id, left(p_change_summary, 2000), left(p_reason, 2000), coalesce(p_supporting_learnings, '[]'::jsonb), left(p_expected_benefit, 1000), left(p_expected_risk, 1000), coalesce(p_alternatives, '[]'::jsonb), p_confidence, p_strength, p_repeatability, p_applicability, p_safety_gate, 'pending_review', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id) values ('policy_evolution_candidate_created', v_id, p_code || ' (' || p_candidate_type || ') — 실제 Policy Version 생성 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'policy_version_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_policy_evolution_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_maker uuid; v_warn boolean := false;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','validated_reference','approved_reference','rejected','cancelled','expired','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select review_status, created_by into v_cur, v_maker from public.ai_policy_evolution_candidates where id = p_id for update;
  if v_cur is null then raise exception 'candidate 없음'; end if;
  if v_cur in ('approved_reference','rejected','cancelled','expired','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_status = 'approved_reference' and v_maker = v_uid then v_warn := true; end if;
  update public.ai_policy_evolution_candidates
     set review_status = p_status, decision_reason = p_reason, reviewer_id = v_uid,
         approver_id = case when p_status = 'approved_reference' then v_uid else approver_id end,
         self_approval_warning = self_approval_warning or v_warn, reviewed_at = now()
   where id = p_id;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'approved_reference' then 'policy_evolution_approved_reference' when p_status = 'rejected' then 'policy_evolution_rejected' else 'policy_evolution_review_started' end, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (approved_reference ≠ 실제 적용)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'self_approval_warning', v_warn, 'policy_applied', false, 'production_applied', false);
end $$;

create or replace function public.admin_policy_evolution_candidates(p_status text default null, p_limit int default 100)
returns setof public.ai_policy_evolution_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_policy_evolution_candidates
    where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) External Policy Action Reference + Audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_external_policy_action(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('policy_version_created_reference','policy_scope_changed_reference','policy_threshold_changed_reference','policy_exception_added_reference','policy_exception_removed_reference','policy_deprecated_reference','policy_replaced_reference','governance_rule_changed_reference','training_process_changed_reference','manual_policy_action_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_organizational_learning_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_policy_action_reference', p_ref_id, p_action_type || ' — ' || left(p_reason, 200), jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'production_applied', false);
end $$;

create or replace function public.admin_learning_audit(p_limit int default 100)
returns setof public.ai_organizational_learning_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_organizational_learning_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_organizational_learning_evidence enable row level security;
alter table public.ai_organizational_learning_patterns enable row level security;
alter table public.ai_organizational_learnings enable row level security;
alter table public.ai_policy_evolution_candidates enable row level security;
alter table public.ai_organizational_learning_events enable row level security;

comment on table public.ai_organizational_learning_evidence is 'AI-OPS-12 — Learning Evidence Pool(요약+참조·인과 미확인 strong 금지 CHECK·제외 사유 보존).';
comment on table public.ai_organizational_learning_patterns is 'AI-OPS-12 — Learning Pattern(경향 — Best Practice/전사 표준 아님·충돌 근거 보존).';
comment on table public.ai_organizational_learnings is 'AI-OPS-12 — Organizational Learning(validated_reference = 사람 검토 Reference — 자동 적용 아님·인사 평가 아님).';
comment on table public.ai_policy_evolution_candidates is 'AI-OPS-12 — Policy Evolution Candidate(후보만 — Policy Version 생성/적용 없음·approved_reference ≠ 적용 완료).';
comment on table public.ai_organizational_learning_events is 'AI-OPS-12 — Learning Audit(event_type whitelist 18종 — 실제 정책 변경/학습 완료 이벤트 아님).';
