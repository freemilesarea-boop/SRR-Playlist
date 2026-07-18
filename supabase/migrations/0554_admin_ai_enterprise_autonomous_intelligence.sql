-- 0554_admin_ai_enterprise_autonomous_intelligence.sql
-- AI-OPS-50 — Enterprise Autonomous Intelligence, Meta-Reasoning &
-- Self-Improvement Governance Center.
--
-- Enterprise Vision → AI Observation → AI Reasoning → Meta Reasoning →
-- Decision Quality → Recommendation Accuracy → Confidence Calibration →
-- Failure Analysis → Self Improvement Candidate → Human Oversight →
-- Executive AI Review → AI Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Improvement Candidate ≠ Applied Improvement — 모델 자동 교체/학습·Prompt/
--    Rule/Strategy/Governance/Policy/Budget 자동 변경·Code/DB 자동 수정 RPC
--    자체가 없음.
--  * Recommendation Accuracy ≠ Future Accuracy. Confidence ≠ Correctness.
--  * Failure Pattern ≠ Root Cause. Blind Spot ≠ Missing Knowledge.
--  * Meta Reasoning ≠ Truth. AI Review ≠ Human Approval.
--  * Recommendation ≠ Decision. Pattern ≠ Causality. Forecast ≠ Future Fact.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0513/0514/0515/0520/0531/0549/0551/
--    0553 원본 무변경(참조만).
--  * 모델 레지스트리/Prompt 버전 원장/추론 텔레메트리 로그/평가 하네스는
--    실측 부재 — insufficient_data 로 유지.
--  * Meta Reasoning/Accuracy History/Confidence History/Failure History 는
--    신규 테이블 대신 JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise AI Review(≠ 사람의 승인 — AI 분석 품질 관측 원장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_ai_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  review_title              text not null,
  review_category           text not null check (review_category in ('strategy','execution','performance','business_value','portfolio','governance','organization','knowledge','recommendation','prompt','rule','ai','executive','enterprise','custom')),
  review_status             text not null default 'draft' check (review_status in ('draft','candidate','review_reference','archived_reference','insufficient_data')),
  review_summary            text,
  accuracy_status           text not null default 'insufficient_data' check (accuracy_status in ('highly_reliable_candidate','reliable_candidate','uncertain_candidate','unreliable_candidate','insufficient_data')),
  calibration_status        text not null default 'insufficient_data' check (calibration_status in ('well_calibrated_candidate','acceptable_candidate','overconfident_candidate','underconfident_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  knowledge_memory_id       uuid,
  governance_decision_id    uuid,
  decision_outcome_id       uuid,
  observation_result        jsonb,
  reasoning_result          jsonb,
  meta_reasoning_result     jsonb,
  accuracy_result           jsonb,
  calibration_result        jsonb,
  decision_quality_result   jsonb,
  failure_result            jsonb,
  hallucination_result      jsonb,
  blind_spot_result         jsonb,
  coverage_result           jsonb,
  oversight_result          jsonb,
  scorecard_result          jsonb,
  accuracy_history          jsonb not null default '[]'::jsonb,
  confidence_history        jsonb not null default '[]'::jsonb,
  failure_history           jsonb not null default '[]'::jsonb,
  learning_history          jsonb not null default '[]'::jsonb,
  recommendation_candidate  jsonb,
  review_reference          jsonb,
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
create unique index if not exists uq_aear_idem on public.ai_enterprise_ai_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aear_status on public.ai_enterprise_ai_reviews (review_status, review_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Improvement Candidate(§7 — Candidate ≠ Applied Improvement).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_improvement_candidates (
  id                        uuid primary key default gen_random_uuid(),
  candidate_code            text not null,
  ai_review_id              uuid,
  improvement_area          text not null check (improvement_area in ('rule','prompt','workflow','knowledge','validation','review')),
  priority_status           text not null default 'unverified_candidate' check (priority_status in ('highly_recommended_candidate','recommended_candidate','optional_candidate','unverified_candidate','insufficient_data')),
  improvement_status        text not null default 'proposed' check (improvement_status in ('proposed','under_review','review_reference_recorded','revision_requested','insufficient_data')),
  description               text,
  expected_effect           text,
  evidence                  jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aeic_idem on public.ai_enterprise_improvement_candidates (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeic_review on public.ai_enterprise_improvement_candidates (ai_review_id, improvement_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) AI 이벤트(31종) — Observation/Reasoning/Meta/Accuracy/Calibration/
--    Quality/Failure/Hallucination/Blind Spot/Coverage/Correction/
--    Improvement/Scorecard/Recommendation/Review/Oversight/Learning/Link
--    통합 Audit(자동 모델·Prompt·Rule 변경 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_ai_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('ai_review_created','ai_review_reviewed','ai_observation_recorded','ai_reasoning_recorded','meta_reasoning_recorded','recommendation_accuracy_reviewed','confidence_calibration_reviewed','decision_quality_reviewed','failure_pattern_reviewed','hallucination_risk_reviewed','blind_spot_reviewed','knowledge_coverage_reviewed','human_correction_recorded','improvement_candidate_created','improvement_candidate_reviewed','improvement_review_reference_recorded','rule_refinement_candidate_recorded','prompt_improvement_candidate_recorded','executive_ai_summary_recorded','executive_ai_scorecard_recorded','ai_recommendation_recorded','ai_review_requested','executive_review_requested','human_oversight_review_requested','ai_review_reference_recorded','human_oversight_recorded','ai_learning_recorded','knowledge_reference_linked','governance_reference_linked','decision_outcome_linked','commitment_reference_linked')),
  ai_review_id              uuid,
  improvement_candidate_id  uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeae_evt on public.ai_enterprise_ai_events (event_type, created_at desc);
create index if not exists idx_aeae_rev on public.ai_enterprise_ai_events (ai_review_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) AI Review 생성 — 자동 모델/Prompt/Rule 변경 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_ai_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_ai_reviews;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'review_category','');
  -- 자동 모델 교체/학습·Prompt/Rule 자동 변경·자기 수정 계열 — 구조적 차단.
  if v_cat in ('automatic_model_replacement','automatic_model_training','automatic_prompt_change','automatic_rule_change','self_modification','automatic_code_change','automatic_database_change') then
    raise exception '금지된 review_category(자동 모델/Prompt/Rule 변경 계열 비활성)';
  end if;
  if v_cat not in ('strategy','execution','performance','business_value','portfolio','governance','organization','knowledge','recommendation','prompt','rule','ai','executive','enterprise','custom') then
    raise exception '허용되지 않는 review_category';
  end if;
  if coalesce(btrim(p_payload->>'review_title'),'') = '' then raise exception 'review_title 필수'; end if;
  if nullif(p_payload->>'knowledge_memory_id','') is not null
     and not exists (select 1 from public.ai_enterprise_knowledge_memories where id = (p_payload->>'knowledge_memory_id')::uuid) then
    raise exception 'Knowledge Memory 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'decision_outcome_id','') is not null
     and not exists (select 1 from public.ai_decision_outcomes where id = (p_payload->>'decision_outcome_id')::uuid) then
    raise exception 'Decision Outcome 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_ai_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'ai_review_is_not_human_approval', true); end if;
  end if;
  insert into public.ai_enterprise_ai_reviews (review_code, review_title, review_category, review_summary, knowledge_memory_id, governance_decision_id, decision_outcome_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EAR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'review_title', 200), v_cat,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    nullif(p_payload->>'knowledge_memory_id','')::uuid, nullif(p_payload->>'governance_decision_id','')::uuid,
    nullif(p_payload->>'decision_outcome_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_ai_events (event_type, ai_review_id, detail, payload, actor_id)
  values ('ai_review_created', v_id, left(v_cat, 80) || ' (AI Review ≠ Human Approval — draft·자동 모델 변경 없음)', jsonb_build_object('review_title', p_payload->>'review_title'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'ai_review_is_not_human_approval', true, 'model_changed', false, 'model_trained', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) AI Review 검토 — review_reference 는 Self 차단 + Evidence 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_ai_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_ai_reviews; v_next text := null; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_ai_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'AI Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_candidate' then v_next := 'candidate';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(사람의 검토 기록 — AI 개선 적용은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 AI Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — AI 개선 적용은 사람)';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'ai_review_is_not_human_approval', true, 'model_changed', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_ai_reviews set review_reference = v_ref where id = p_review_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_ai_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_ai_events (event_type, ai_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'ai_review_reference_recorded' else 'ai_review_reviewed' end,
    p_review_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'ai_review_is_not_human_approval', true, 'model_changed', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Improvement Candidate 생성/검토(§7 — Candidate ≠ Applied Improvement).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_improvement_candidate_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_area text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_improvement_candidates;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_area := coalesce(p_payload->>'improvement_area','');
  if v_area not in ('rule','prompt','workflow','knowledge','validation','review') then
    raise exception '허용되지 않는 improvement_area(§7 — 6종)';
  end if;
  -- Improvement Candidate ≠ Applied Improvement — Evidence 없이 생성 차단.
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'Evidence 없는 Improvement Candidate 금지';
  end if;
  if nullif(p_payload->>'ai_review_id','') is not null
     and not exists (select 1 from public.ai_enterprise_ai_reviews where id = (p_payload->>'ai_review_id')::uuid) then
    raise exception 'AI Review 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_improvement_candidates where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'candidate_is_not_applied_improvement', true); end if;
  end if;
  insert into public.ai_enterprise_improvement_candidates (candidate_code, ai_review_id, improvement_area, description, expected_effect, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'candidate_code',''), 'EIC-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    nullif(p_payload->>'ai_review_id','')::uuid, v_area,
    nullif(left(coalesce(p_payload->>'description',''), 2000),''),
    nullif(left(coalesce(p_payload->>'expected_effect',''), 2000),''),
    p_payload->'evidence', coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_ai_events (event_type, ai_review_id, improvement_candidate_id, detail, payload, actor_id)
  values ('improvement_candidate_created', nullif(p_payload->>'ai_review_id','')::uuid, v_id, left(v_area, 80) || ' (Improvement Candidate ≠ Applied Improvement — 적용은 사람)', jsonb_build_object('description', p_payload->>'description'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'proposed', 'candidate_is_not_applied_improvement', true, 'improvement_applied', false, 'model_changed', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_improvement_candidate_review(p_candidate_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_improvement_candidates; v_next text; v_note text := ''; v_ref jsonb; v_priority text := nullif(p_payload->>'priority','');
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_under_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_improvement_candidates where id = p_candidate_id;
  if v_row.id is null then raise exception 'Improvement Candidate 없음(실존 검증 실패)'; end if;
  if v_row.improvement_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;
  if v_priority is not null and v_priority not in ('highly_recommended_candidate','recommended_candidate','optional_candidate','unverified_candidate','insufficient_data') then
    raise exception '허용되지 않는 priority(§7 — 5종)';
  end if;

  if p_action = 'mark_under_review' then v_next := 'under_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(우선순위 후보 기록 — 적용은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Improvement Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ 적용 승인 — AI 개선 적용은 사람)';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'candidate_is_not_applied_improvement', true, 'improvement_applied', false, 'model_changed', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_improvement_candidates set review_reference = v_ref, priority_status = coalesce(v_priority, priority_status) where id = p_candidate_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_improvement_candidates set improvement_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_candidate_id;
  insert into public.ai_enterprise_ai_events (event_type, ai_review_id, improvement_candidate_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'improvement_review_reference_recorded' else 'improvement_candidate_reviewed' end,
    v_row.ai_review_id, p_candidate_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_candidate_id, 'status', v_next, 'candidate_is_not_applied_improvement', true, 'improvement_applied', false, 'model_changed', false, 'prompt_changed', false, 'rule_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) AI 이벤트 기록(통합) — 자동 모델/Prompt/Rule 변경 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_ai_event_record(p_kind text, p_reason text, p_payload jsonb, p_review_id uuid default null, p_candidate_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('ai_observation_recorded','ai_reasoning_recorded','meta_reasoning_recorded','recommendation_accuracy_reviewed','confidence_calibration_reviewed','decision_quality_reviewed','failure_pattern_reviewed','hallucination_risk_reviewed','blind_spot_reviewed','knowledge_coverage_reviewed','human_correction_recorded','rule_refinement_candidate_recorded','prompt_improvement_candidate_recorded','executive_ai_summary_recorded','executive_ai_scorecard_recorded','ai_recommendation_recorded','ai_review_requested','executive_review_requested','human_oversight_review_requested','human_oversight_recorded','ai_learning_recorded','knowledge_reference_linked','governance_reference_linked','decision_outcome_linked','commitment_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_ai_reviews where id = p_review_id) then raise exception 'AI Review 없음(실존 검증 실패)'; end if;
  if p_candidate_id is not null and not exists (select 1 from public.ai_enterprise_improvement_candidates where id = p_candidate_id) then raise exception 'Improvement Candidate 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'ai_observation_recorded' and p_review_id is not null then
    update public.ai_enterprise_ai_reviews set observation_result = p_payload, updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'ai_reasoning_recorded' and p_review_id is not null then
    update public.ai_enterprise_ai_reviews set reasoning_result = p_payload, updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'meta_reasoning_recorded' and p_review_id is not null then
    -- Meta Reasoning ≠ Truth.
    update public.ai_enterprise_ai_reviews set meta_reasoning_result = p_payload, updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'recommendation_accuracy_reviewed' then
    if v_result not in ('highly_reliable_candidate','reliable_candidate','uncertain_candidate','unreliable_candidate','insufficient_data') then raise exception '허용되지 않는 accuracy result(§5)'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set accuracy_status = v_result, accuracy_result = p_payload, accuracy_history = accuracy_history || jsonb_build_array(p_payload), updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'confidence_calibration_reviewed' then
    if v_result not in ('well_calibrated_candidate','acceptable_candidate','overconfident_candidate','underconfident_candidate','insufficient_data') then raise exception '허용되지 않는 calibration result(§6)'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set calibration_status = v_result, calibration_result = p_payload, confidence_history = confidence_history || jsonb_build_array(p_payload), updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'decision_quality_reviewed' then
    if v_result not in ('high_quality_candidate','acceptable_quality_candidate','low_quality_candidate','quality_unverified','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set decision_quality_result = p_payload, updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'failure_pattern_reviewed' then
    if v_result not in ('recurring_failure_candidate','isolated_failure_candidate','no_material_failure_candidate','failure_unverified','insufficient_data') then raise exception '허용되지 않는 failure result'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set failure_result = p_payload, failure_history = failure_history || jsonb_build_array(p_payload), updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'hallucination_risk_reviewed' then
    if v_result not in ('low_hallucination_risk_candidate','moderate_hallucination_risk_candidate','high_hallucination_risk_candidate','hallucination_unverified','insufficient_data') then raise exception '허용되지 않는 hallucination result'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set hallucination_result = p_payload, updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'blind_spot_reviewed' then
    if v_result not in ('no_material_blind_spot_candidate','potential_blind_spot_candidate','critical_blind_spot_candidate','blind_spot_unverified','insufficient_data') then raise exception '허용되지 않는 blind spot result'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set blind_spot_result = p_payload, updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'knowledge_coverage_reviewed' then
    if v_result not in ('broad_coverage_candidate','adequate_coverage_candidate','narrow_coverage_candidate','coverage_unverified','insufficient_data') then raise exception '허용되지 않는 coverage result'; end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set coverage_result = p_payload, updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'human_correction_recorded' and p_review_id is not null then
    -- 사람의 수정 기록 — AI 학습 소재이며 자동 반영 없음.
    update public.ai_enterprise_ai_reviews set learning_history = learning_history || jsonb_build_array(p_payload), updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'rule_refinement_candidate_recorded' or p_kind = 'prompt_improvement_candidate_recorded' then
    -- Rule/Prompt 후보 ≠ 자동 변경 — Evidence 없이 기록 차단.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Rule/Prompt 개선 후보 기록 금지';
    end if;
  end if;
  if p_kind = 'executive_ai_scorecard_recorded' and p_review_id is not null then
    update public.ai_enterprise_ai_reviews set scorecard_result = p_payload, updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'ai_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_ai_review','record_ai_observation','record_ai_reasoning','record_meta_reasoning','review_recommendation_accuracy','review_confidence_calibration','review_decision_quality','review_failure_pattern','review_hallucination_risk','review_blind_spot','review_knowledge_coverage','record_human_correction','create_improvement_candidate','record_rule_refinement_candidate','record_prompt_improvement_candidate','build_executive_ai_summary','build_executive_ai_scorecard','request_ai_review','request_executive_review','request_human_oversight_review','record_ai_learning','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 AI Recommendation 금지';
    end if;
    if p_review_id is not null then update public.ai_enterprise_ai_reviews set recommendation_candidate = p_payload, updated_at = now() where id = p_review_id; end if;
  end if;
  if p_kind = 'human_oversight_recorded' and p_review_id is not null then
    update public.ai_enterprise_ai_reviews set oversight_result = p_payload, updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'ai_learning_recorded' and p_review_id is not null then
    update public.ai_enterprise_ai_reviews set learning_history = learning_history || jsonb_build_array(p_payload), updated_at = now() where id = p_review_id;
  end if;
  if p_kind = 'knowledge_reference_linked' and nullif(p_payload->>'knowledge_memory_id','') is not null
     and not exists (select 1 from public.ai_enterprise_knowledge_memories where id = (p_payload->>'knowledge_memory_id')::uuid) then
    raise exception 'Knowledge Memory 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if p_kind = 'decision_outcome_linked' and nullif(p_payload->>'decision_outcome_id','') is not null
     and not exists (select 1 from public.ai_decision_outcomes where id = (p_payload->>'decision_outcome_id')::uuid) then
    raise exception 'Decision Outcome 없음(실존 검증 실패)';
  end if;
  if p_kind = 'commitment_reference_linked' and nullif(p_payload->>'commitment_id','') is not null
     and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
    raise exception 'Execution Commitment 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_ai_events (event_type, ai_review_id, improvement_candidate_id, detail, payload, actor_id)
  values (p_kind, p_review_id, p_candidate_id,
    left(p_reason, 200) || case
      when p_kind = 'ai_observation_recorded' then ' (Observation ≠ 사실 확정)'
      when p_kind = 'ai_reasoning_recorded' then ' (Reasoning 기록 ≠ 결론 확정)'
      when p_kind = 'meta_reasoning_recorded' then ' (Meta Reasoning ≠ Truth)'
      when p_kind = 'recommendation_accuracy_reviewed' then ' (Recommendation Accuracy ≠ Future Accuracy)'
      when p_kind = 'confidence_calibration_reviewed' then ' (Confidence ≠ Correctness)'
      when p_kind = 'decision_quality_reviewed' then ' (Decision Quality Candidate ≠ 품질 확정)'
      when p_kind = 'failure_pattern_reviewed' then ' (Failure Pattern ≠ Root Cause)'
      when p_kind = 'hallucination_risk_reviewed' then ' (Hallucination Risk 후보 ≠ 판정 확정)'
      when p_kind = 'blind_spot_reviewed' then ' (Blind Spot ≠ Missing Knowledge)'
      when p_kind = 'knowledge_coverage_reviewed' then ' (Coverage Candidate ≠ 지식 충분 확정)'
      when p_kind = 'human_correction_recorded' then ' (사람의 수정 기록 — 자동 반영 없음)'
      when p_kind = 'rule_refinement_candidate_recorded' then ' (Rule 후보 ≠ 자동 Rule 변경)'
      when p_kind = 'prompt_improvement_candidate_recorded' then ' (Prompt 후보 ≠ 자동 Prompt 변경)'
      when p_kind = 'executive_ai_summary_recorded' then ' (Summary ≠ AI 품질 확정)'
      when p_kind = 'executive_ai_scorecard_recorded' then ' (Scorecard ≠ 모델 변경 지시)'
      when p_kind = 'ai_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'ai_review_requested' then ' (AI Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_oversight_review_requested' then ' (Human Oversight Review 요청 — 최종 개선 적용은 사람)'
      when p_kind = 'human_oversight_recorded' then ' (Human Oversight ≠ 자동 개선 적용)'
      when p_kind = 'ai_learning_recorded' then ' (AI Learning 기록 ≠ 자동 모델 학습)'
      when p_kind = 'knowledge_reference_linked' then ' (Knowledge Reference ≠ 사실 확정)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인)'
      when p_kind = 'decision_outcome_linked' then ' (Outcome Link ≠ Proven Causality)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ 실행 보장)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'model_changed', false, 'model_trained', false, 'prompt_changed', false, 'rule_changed', false, 'policy_changed', false, 'code_changed', false, 'database_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_ai_reviews_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_ai_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_ai_reviews
  where (p_status is null or review_status = p_status)
    and (p_category is null or review_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_improvement_candidates_list(p_review_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_improvement_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_improvement_candidates
  where (p_review_id is null or ai_review_id = p_review_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_ai_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'ai_reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_ai_reviews),
      'draft', (select count(*) from public.ai_enterprise_ai_reviews where review_status = 'draft'),
      'candidate', (select count(*) from public.ai_enterprise_ai_reviews where review_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_ai_reviews where review_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_ai_reviews where review_status = 'archived_reference'),
      'reliable', (select count(*) from public.ai_enterprise_ai_reviews where accuracy_status in ('highly_reliable_candidate','reliable_candidate')),
      'unreliable', (select count(*) from public.ai_enterprise_ai_reviews where accuracy_status in ('uncertain_candidate','unreliable_candidate')),
      'well_calibrated', (select count(*) from public.ai_enterprise_ai_reviews where calibration_status = 'well_calibrated_candidate'),
      'miscalibrated', (select count(*) from public.ai_enterprise_ai_reviews where calibration_status in ('overconfident_candidate','underconfident_candidate')),
      'by_category', (select coalesce(jsonb_object_agg(review_category, cnt), '{}'::jsonb) from (select review_category, count(*) cnt from public.ai_enterprise_ai_reviews group by review_category) t)
    ),
    'improvements', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_improvement_candidates),
      'proposed', (select count(*) from public.ai_enterprise_improvement_candidates where improvement_status = 'proposed'),
      'under_review', (select count(*) from public.ai_enterprise_improvement_candidates where improvement_status = 'under_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_improvement_candidates where improvement_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_improvement_candidates where improvement_status = 'revision_requested'),
      'highly_recommended', (select count(*) from public.ai_enterprise_improvement_candidates where priority_status = 'highly_recommended_candidate'),
      'by_area', (select coalesce(jsonb_object_agg(improvement_area, cnt), '{}'::jsonb) from (select improvement_area, count(*) cnt from public.ai_enterprise_improvement_candidates group by improvement_area) t)
    ),
    'ai_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_ai_events),
      'observations', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_observation_recorded'),
      'reasonings', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_reasoning_recorded'),
      'meta_reasonings', (select count(*) from public.ai_enterprise_ai_events where event_type = 'meta_reasoning_recorded'),
      'accuracy_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'recommendation_accuracy_reviewed'),
      'calibration_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'confidence_calibration_reviewed'),
      'quality_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'decision_quality_reviewed'),
      'failure_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'failure_pattern_reviewed'),
      'hallucination_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'hallucination_risk_reviewed'),
      'blind_spot_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'blind_spot_reviewed'),
      'coverage_reviews', (select count(*) from public.ai_enterprise_ai_events where event_type = 'knowledge_coverage_reviewed'),
      'human_corrections', (select count(*) from public.ai_enterprise_ai_events where event_type = 'human_correction_recorded'),
      'rule_candidates', (select count(*) from public.ai_enterprise_ai_events where event_type = 'rule_refinement_candidate_recorded'),
      'prompt_candidates', (select count(*) from public.ai_enterprise_ai_events where event_type = 'prompt_improvement_candidate_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_ai_events where event_type = 'executive_ai_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_ai_events where event_type = 'executive_ai_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_recommendation_recorded'),
      'ai_review_requests', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_ai_events where event_type = 'executive_review_requested'),
      'oversight_review_requests', (select count(*) from public.ai_enterprise_ai_events where event_type = 'human_oversight_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_review_reference_recorded'),
      'oversights', (select count(*) from public.ai_enterprise_ai_events where event_type = 'human_oversight_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_ai_events where event_type = 'ai_learning_recorded'),
      'knowledge_links', (select count(*) from public.ai_enterprise_ai_events where event_type = 'knowledge_reference_linked'),
      'governance_links', (select count(*) from public.ai_enterprise_ai_events where event_type = 'governance_reference_linked')
    ),
    -- Autonomous 원천 실측(전부 읽기 전용):
    'ai_actuals', jsonb_build_object(
      'knowledge_memories_0553', (select count(*) from public.ai_enterprise_knowledge_memories),
      'knowledge_reviews_0553', (select count(*) from public.ai_enterprise_knowledge_reviews),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'knowledge_relationships_0513', (select count(*) from public.ai_knowledge_relationships),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'org_memory_0531', (select count(*) from public.ai_org_memory),
      'organizational_learnings_0515', (select count(*) from public.ai_organizational_learnings)
    ),
    'ai_unavailable', jsonb_build_array('model_registry_feed','prompt_version_ledger','inference_telemetry_log','evaluation_harness_feed','training_pipeline_feed','human_feedback_labeling_system'),   -- 원본 없음(실측)
    'improvement_candidate_is_not_applied_improvement', true, 'recommendation_accuracy_is_not_future_accuracy', true,
    'confidence_is_not_correctness', true, 'failure_pattern_is_not_root_cause', true,
    'blind_spot_is_not_missing_knowledge', true, 'meta_reasoning_is_not_truth', true,
    'ai_review_is_not_human_approval', true, 'recommendation_is_not_decision', true,
    'pattern_is_not_causality', true, 'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_model_change', true, 'no_auto_model_training', true, 'no_auto_prompt_change', true,
    'no_auto_rule_change', true, 'no_auto_policy_change', true, 'no_auto_code_change', true,
    'no_auto_database_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_ai_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_ai_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_ai_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_ai_reviews enable row level security;
alter table public.ai_enterprise_improvement_candidates enable row level security;
alter table public.ai_enterprise_ai_events enable row level security;

comment on table public.ai_enterprise_ai_reviews is 'AI-OPS-50 — AI Review(≠ Human Approval·Category 15종·자동 모델/Prompt/Rule 변경 차단·Confidence ≠ Correctness).';
comment on table public.ai_enterprise_improvement_candidates is 'AI-OPS-50 — Improvement Candidate(§7 6영역·Evidence 필수·Candidate ≠ Applied Improvement·적용은 사람).';
comment on table public.ai_enterprise_ai_events is 'AI-OPS-50 — AI 이벤트 31종(자동 모델/Prompt/Rule 변경 이벤트 생성 금지·Failure Pattern ≠ Root Cause).';
