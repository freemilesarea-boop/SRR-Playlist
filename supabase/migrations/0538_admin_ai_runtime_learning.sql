-- 0538_admin_ai_runtime_learning.sql
-- Phase AI-OPS-35 — Enterprise Runtime Learning, Incident Postmortem Intelligence &
-- Assurance Policy Evolution Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * Runtime History 실측: ai_runtime_execution_sessions/events(0536),
--     ai_runtime_assurance_signals/incident_candidates/events(0537 — Human Resolution/
--     Recovery/Escalation Reference 포함), ai_execution_requests/gateway_events(0535).
--   * 기존 Runtime Postmortem 전용 구조 없음(0482 는 추천 Root Cause Snapshot,
--     0502 는 Self-Healing Incident — Runtime 세션용 아님) → 신규 생성 근거.
--   * Policy Versioning 실존(읽기 전용 참조): ai_enterprise_policies.current_version +
--     ai_enterprise_policy_versions(0512 — policy_id+version unique·previous_version·
--     checksum), ai_operational_policies(0509 version), ai_data_retention_policies
--     (0510 version), franchise_policy_versions(0349).
--   * Learning 실측: ai_organizational_learnings/patterns/evidence(0515),
--     ai_decision_memory/outcomes(0514), ai_knowledge_nodes(0498).
--   신규 테이블 3개(postmortems/policy_proposals/learning_events) —
--   Root Cause/Contributing Factor/Control Gap/Recurrence/Corrective/Preventive/
--   Version Reference/Effectiveness/Learning Reference 는 이벤트(payload jsonb)와
--   postmortem/proposal JSONB 필드로 통합(별도 테이블 없음).
--
-- Runtime Learning 정직성(전부 강제):
--   * Correlation ≠ Causality. Pattern ≠ Root Cause. Candidate ≠ Confirmed.
--   * Postmortem Draft ≠ Approved. approved_reference ≠ Policy 적용.
--   * Policy Proposal ≠ Approval ≠ Application ≠ Effectiveness.
--   * Root Cause 자동 확정/책임자 확정/인사 평가 없음.
--   * 실제 Policy/Threshold/Connector/Automation/Runtime Rule 변경 없음 —
--     0512/0509/0510 원본 Policy 테이블 미변경(Reference 만).
--   * 원본 Decision Memory/Knowledge Graph 자동 변경 없음.
--   * Unknown 유지(null→0 금지). Trigger 없음 · 삭제 RPC 금지 · 종결 재결정 차단.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Runtime Postmortem(AI 생성분은 초안 — 확정 Root Cause 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_postmortems (
  id                          uuid primary key default gen_random_uuid(),
  postmortem_code             text not null,
  runtime_session_id          uuid not null,
  runtime_incident_candidate_id uuid,
  connector_instance_id       uuid,
  automation_definition_id    uuid,
  execution_request_id        uuid,
  postmortem_status           text not null default 'draft' check (postmortem_status in ('draft','pending_evidence','pending_review','reviewed_reference','approved_reference','approved_with_limitation','rejected','invalidated','insufficient_data')),
  incident_summary            text not null,
  observed_effect             text,
  affected_scope              text,
  timeline_summary            text,
  detection_summary           text,
  escalation_summary          text,
  recovery_summary            text,
  resolution_summary          text,
  evidence_summary            jsonb not null default '[]'::jsonb,
  known_facts                 jsonb not null default '[]'::jsonb,
  unknown_factors             jsonb not null default '[]'::jsonb,
  assumptions                 jsonb not null default '[]'::jsonb,
  limitations                 jsonb not null default '[]'::jsonb,
  root_cause_candidates       jsonb not null default '[]'::jsonb,   -- [{type,summary,evidence,counter_evidence,status}] — Candidate ≠ Confirmed
  contributing_factors        jsonb not null default '[]'::jsonb,
  control_gaps                jsonb not null default '[]'::jsonb,
  idempotency_key             text,
  drafted_by                  uuid,
  reviewed_by                 uuid,
  approved_by                 uuid,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create unique index if not exists uq_rt_pm_idem on public.ai_runtime_postmortems (idempotency_key) where idempotency_key is not null;
create index if not exists idx_rt_pm_status on public.ai_runtime_postmortems (postmortem_status, created_at desc);
create index if not exists idx_rt_pm_sess on public.ai_runtime_postmortems (runtime_session_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Assurance Policy Proposal(적용된 Policy 아님 — 원본 Policy 테이블 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_policy_proposals (
  id                        uuid primary key default gen_random_uuid(),
  proposal_code             text not null,
  source_postmortem_id      uuid,
  source_incident_candidate_id uuid,
  policy_domain             text not null check (policy_domain in ('connector_governance','automation_governance','execution_gateway','runtime_preconditions','runtime_assurance','permission_validation','scope_validation','risk_evaluation','dry_run_requirement','sandbox_requirement','idempotency_requirement','timeout_policy','retry_policy','checkpoint_policy','evidence_policy','cleanup_policy','observation_policy','escalation_policy','recovery_policy','closure_policy')),
  policy_type               text,
  title                     text not null,
  proposal_summary          text,
  current_policy_reference  text,   -- 0512/0509/0510 실존 버전 Reference(읽기 전용)
  proposed_policy           jsonb not null default '{}'::jsonb,
  affected_execution_domains jsonb not null default '[]'::jsonb,
  affected_environment_scopes jsonb not null default '["non_production"]'::jsonb,
  expected_benefit          text,
  potential_side_effects    jsonb not null default '[]'::jsonb,
  risk_level                text not null default 'risk_unverified' check (risk_level in ('negligible','low','moderate','high','critical','risk_unverified','insufficient_data')),
  rollback_reference_required boolean not null default true,
  observation_required      boolean not null default true,
  evidence                  jsonb not null default '[]'::jsonb,
  alternatives              jsonb not null default '[]'::jsonb,
  preconditions             jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  proposal_status           text not null default 'draft' check (proposal_status in ('draft','pending_evidence','pending_review','approval_missing','approved_reference','approved_with_limitation','rejected','cancelled','invalidated','application_pending','application_unverified','observation_pending','effectiveness_unverified','insufficient_data')),
  application_status        text not null default 'not_requested' check (application_status in ('not_requested','approval_missing','application_pending','application_reference_recorded','application_unverified','partially_verified','verified_reference','rollback_review_required','invalidated','insufficient_data')),
  effectiveness_status      text not null default 'observation_not_started' check (effectiveness_status in ('observation_not_started','observation_ready_reference','observation_in_progress_reference','effectiveness_candidate','ineffectiveness_candidate','adverse_effect_candidate','no_material_change_candidate','causality_unverified','sample_too_small','stale_input_candidate','insufficient_data')),
  idempotency_key           text,
  proposed_by               uuid,
  reviewed_by               uuid,
  approved_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_rt_pp_idem on public.ai_runtime_policy_proposals (idempotency_key) where idempotency_key is not null;
create index if not exists idx_rt_pp_status on public.ai_runtime_policy_proposals (proposal_status, policy_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Learning 이벤트(23종) — Root Cause/Factor/Gap/Pattern/Action/Version/
--    Effectiveness/Learning Reference 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_learning_events (
  id                    uuid primary key default gen_random_uuid(),
  event_type            text not null check (event_type in ('postmortem_created','postmortem_reviewed','postmortem_approved_reference','root_cause_candidate_recorded','root_cause_candidate_reviewed','root_cause_confirmed_reference','contributing_factor_recorded','control_gap_recorded','recurrence_pattern_detected','corrective_action_proposed','corrective_action_reviewed','preventive_action_proposed','preventive_action_reviewed','policy_proposal_created','policy_proposal_reviewed','policy_approval_reference_recorded','policy_application_reference_recorded','policy_application_verified_reference','policy_effectiveness_observation_started','policy_effectiveness_observation_completed_reference','adverse_effect_candidate_detected','organizational_learning_reference_recorded','runtime_learning_invalidated')),
  runtime_postmortem_id uuid,
  policy_proposal_id    uuid,
  runtime_session_id    uuid,
  detail                text,
  payload               jsonb,
  actor_id              uuid,
  created_at            timestamptz not null default now()
);
create index if not exists idx_rt_learn_evt on public.ai_runtime_learning_events (event_type, created_at desc);
create index if not exists idx_rt_learn_evt_pm on public.ai_runtime_learning_events (runtime_postmortem_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Postmortem 생성(초안 강제 — Draft ≠ Approved·확정 Root Cause 아님).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_postmortem_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_sess uuid; v_inc uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_runtime_postmortems;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_sess := nullif(p_payload->>'runtime_session_id','')::uuid;
  if v_sess is null or not exists (select 1 from public.ai_runtime_execution_sessions where id = v_sess) then
    raise exception 'Runtime Session(0536) 없음(실존 검증 실패)';
  end if;
  v_inc := nullif(p_payload->>'runtime_incident_candidate_id','')::uuid;
  if v_inc is not null and not exists (select 1 from public.ai_runtime_incident_candidates where id = v_inc) then
    raise exception 'Incident Candidate(0537) 없음(실존 검증 실패)';
  end if;
  if coalesce(p_payload->>'incident_summary','') = '' then raise exception 'incident_summary 필수'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_runtime_postmortems where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'root_cause_confirmed', false); end if;
  end if;
  insert into public.ai_runtime_postmortems (postmortem_code, runtime_session_id, runtime_incident_candidate_id, connector_instance_id, automation_definition_id, execution_request_id, incident_summary, observed_effect, affected_scope, timeline_summary, detection_summary, escalation_summary, recovery_summary, resolution_summary, evidence_summary, known_facts, unknown_factors, assumptions, limitations, root_cause_candidates, contributing_factors, control_gaps, idempotency_key, drafted_by)
  values (left(coalesce(nullif(p_payload->>'postmortem_code',''), 'PM-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_sess, v_inc, nullif(p_payload->>'connector_instance_id','')::uuid, nullif(p_payload->>'automation_definition_id','')::uuid, nullif(p_payload->>'execution_request_id','')::uuid,
    left(p_payload->>'incident_summary', 500), left(coalesce(p_payload->>'observed_effect',''), 500), left(coalesce(p_payload->>'affected_scope',''), 200),
    left(coalesce(p_payload->>'timeline_summary',''), 1000), left(coalesce(p_payload->>'detection_summary',''), 500), left(coalesce(p_payload->>'escalation_summary',''), 500),
    left(coalesce(p_payload->>'recovery_summary',''), 500), left(coalesce(p_payload->>'resolution_summary',''), 500),
    coalesce(p_payload->'evidence_summary', '[]'::jsonb), coalesce(p_payload->'known_facts', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    coalesce(p_payload->'root_cause_candidates', '[]'::jsonb), coalesce(p_payload->'contributing_factors', '[]'::jsonb), coalesce(p_payload->'control_gaps', '[]'::jsonb),
    v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_runtime_learning_events (event_type, runtime_postmortem_id, runtime_session_id, detail, payload, actor_id)
  values ('postmortem_created', v_id, v_sess, left(p_payload->>'incident_summary', 200) || ' (Draft ≠ Approved·Postmortem ≠ Root Cause 확정)', jsonb_build_object('incident_candidate_id', v_inc), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'draft_is_not_approved', true, 'root_cause_confirmed', false, 'blame_assigned', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Postmortem 검토(사람) — 승인 ≠ Policy 적용·종결 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_postmortem_review(p_postmortem_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_runtime_postmortems; v_next text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','mark_reviewed','approve','approve_with_limitation','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_runtime_postmortems where id = p_postmortem_id;
  if v_row.id is null then raise exception 'Postmortem 없음(실존 검증 실패)'; end if;
  if v_row.postmortem_status in ('approved_reference','approved_with_limitation','rejected','invalidated') then
    raise exception '종결 상태 재결정 차단(%)', v_row.postmortem_status;
  end if;
  if v_row.drafted_by = v_uid then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'mark_reviewed' then v_next := 'reviewed_reference';
  elsif p_action in ('approve','approve_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인 금지(evidence_incomplete)';
    end if;
    v_next := case when p_action = 'approve' then 'approved_reference' else 'approved_with_limitation' end;
    v_note := v_note || ' (승인 Reference ≠ Policy 적용·Root Cause 확정 아님)';
    update public.ai_runtime_postmortems set approved_by = v_uid where id = p_postmortem_id;
  elsif p_action = 'reject' then v_next := 'rejected';
  else v_next := 'invalidated';
  end if;

  update public.ai_runtime_postmortems set postmortem_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_postmortem_id;
  insert into public.ai_runtime_learning_events (event_type, runtime_postmortem_id, runtime_session_id, detail, payload, actor_id)
  values (case when p_action in ('approve','approve_with_limitation') then 'postmortem_approved_reference'
    when p_action = 'invalidate' then 'runtime_learning_invalidated' else 'postmortem_reviewed' end,
    p_postmortem_id, v_row.runtime_session_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_postmortem_id, 'status', v_next, 'root_cause_confirmed', false, 'policy_applied', false, 'blame_assigned', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Policy Proposal 생성/검토 — Proposal ≠ Approval ≠ Application.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_policy_proposal_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_pm uuid; v_inc uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_runtime_policy_proposals;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(p_payload->>'title','') = '' then raise exception 'title 필수'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'Evidence 없는 Policy Proposal 금지(insufficient_data)';
  end if;
  v_pm := nullif(p_payload->>'source_postmortem_id','')::uuid;
  if v_pm is not null and not exists (select 1 from public.ai_runtime_postmortems where id = v_pm) then raise exception 'Postmortem 없음(실존 검증 실패)'; end if;
  v_inc := nullif(p_payload->>'source_incident_candidate_id','')::uuid;
  if v_inc is not null and not exists (select 1 from public.ai_runtime_incident_candidates where id = v_inc) then raise exception 'Incident Candidate 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_runtime_policy_proposals where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'policy_applied', false); end if;
  end if;
  insert into public.ai_runtime_policy_proposals (proposal_code, source_postmortem_id, source_incident_candidate_id, policy_domain, policy_type, title, proposal_summary, current_policy_reference, proposed_policy, affected_execution_domains, affected_environment_scopes, expected_benefit, potential_side_effects, risk_level, rollback_reference_required, observation_required, evidence, alternatives, preconditions, limitations, idempotency_key, proposed_by)
  values (left(coalesce(nullif(p_payload->>'proposal_code',''), 'APP-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_pm, v_inc, p_payload->>'policy_domain', nullif(p_payload->>'policy_type',''), left(p_payload->>'title', 200), left(coalesce(p_payload->>'proposal_summary',''), 1000),
    left(coalesce(p_payload->>'current_policy_reference',''), 200), coalesce(p_payload->'proposed_policy', '{}'::jsonb),
    coalesce(p_payload->'affected_execution_domains', '[]'::jsonb), coalesce(p_payload->'affected_environment_scopes', '["non_production"]'::jsonb),
    left(coalesce(p_payload->>'expected_benefit',''), 500), coalesce(p_payload->'potential_side_effects', '[]'::jsonb),
    coalesce(nullif(p_payload->>'risk_level',''), 'risk_unverified'), coalesce((p_payload->>'rollback_reference_required')::boolean, true), coalesce((p_payload->>'observation_required')::boolean, true),
    p_payload->'evidence', coalesce(p_payload->'alternatives', '[]'::jsonb), coalesce(p_payload->'preconditions', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_runtime_learning_events (event_type, policy_proposal_id, runtime_postmortem_id, detail, payload, actor_id)
  values ('policy_proposal_created', v_id, v_pm, left(p_payload->>'title', 200) || ' (Proposal ≠ Approval ≠ Application — 원본 Policy 미변경)', jsonb_build_object('domain', p_payload->>'policy_domain'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'proposal_is_not_approval', true, 'policy_applied', false, 'threshold_changed', false);
end $$;

create or replace function public.admin_runtime_policy_review(p_proposal_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_runtime_policy_proposals; v_next text := null; v_app text := null; v_eff text := null; v_evt text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','approve','approve_with_limitation','reject','cancel','invalidate','record_application_reference','verify_application','start_effectiveness_observation','complete_effectiveness_observation','record_adverse_effect') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_runtime_policy_proposals where id = p_proposal_id;
  if v_row.id is null then raise exception 'Policy Proposal 없음(실존 검증 실패)'; end if;
  if v_row.proposal_status in ('rejected','cancelled','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.proposal_status; end if;
  if v_row.proposed_by = v_uid and p_action in ('approve','approve_with_limitation') then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review'; v_evt := 'policy_proposal_reviewed';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence'; v_evt := 'policy_proposal_reviewed';
  elsif p_action in ('approve','approve_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Policy 승인 금지';
    end if;
    v_next := case when p_action = 'approve' then 'approved_reference' else 'approved_with_limitation' end;
    v_app := 'application_pending';
    v_evt := 'policy_approval_reference_recorded';
    v_note := v_note || ' (approved_reference ≠ applied — 실제 Policy 원본 미변경)';
    update public.ai_runtime_policy_proposals set approved_by = v_uid where id = p_proposal_id;
  elsif p_action = 'reject' then v_next := 'rejected'; v_evt := 'policy_proposal_reviewed';
  elsif p_action = 'cancel' then v_next := 'cancelled'; v_evt := 'policy_proposal_reviewed';
  elsif p_action = 'invalidate' then v_next := 'invalidated'; v_app := 'invalidated'; v_evt := 'runtime_learning_invalidated';
  elsif p_action = 'record_application_reference' then
    -- Application Reference 는 승인 선행 필수 — 자동 적용 아님(사람이 별도 채널로 적용한 Reference).
    if v_row.proposal_status not in ('approved_reference','approved_with_limitation','application_pending','application_unverified') then
      raise exception 'policy_approval_missing: 승인 Reference 없이 Application 기록 불가';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Application Reference 금지(application_unverified)';
    end if;
    v_next := 'application_unverified'; v_app := 'application_reference_recorded';
    v_evt := 'policy_application_reference_recorded';
    v_note := ' (Application Reference ≠ 실제 적용 성공)';
  elsif p_action = 'verify_application' then
    if v_row.application_status <> 'application_reference_recorded' and v_row.application_status <> 'partially_verified' then
      raise exception 'Application Reference 기록 없이 검증 불가';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Application 검증 금지';
    end if;
    v_app := 'verified_reference'; v_next := 'observation_pending';
    v_evt := 'policy_application_verified_reference';
    v_note := ' (Applied ≠ Effective — 효과성 별도 관측)';
  elsif p_action = 'start_effectiveness_observation' then
    if v_row.application_status not in ('application_reference_recorded','partially_verified','verified_reference') then
      raise exception 'Application 기록 없이 효과성 관측 불가';
    end if;
    v_eff := 'observation_in_progress_reference';
    v_evt := 'policy_effectiveness_observation_started';
  elsif p_action = 'complete_effectiveness_observation' then
    if coalesce(p_payload->>'effectiveness','') not in ('effectiveness_candidate','ineffectiveness_candidate','adverse_effect_candidate','no_material_change_candidate','causality_unverified','sample_too_small','insufficient_data') then
      raise exception '허용되지 않는 effectiveness 결과';
    end if;
    v_eff := p_payload->>'effectiveness';
    v_evt := 'policy_effectiveness_observation_completed_reference';
    v_note := ' (효과성 후보 — 인과 자동 확정 없음)';
  else
    v_eff := 'adverse_effect_candidate';
    v_evt := 'adverse_effect_candidate_detected';
    v_note := ' (Adverse Effect 후보 — 사람 검토 필요)';
  end if;

  update public.ai_runtime_policy_proposals set
    proposal_status = coalesce(v_next, proposal_status),
    application_status = coalesce(v_app, application_status),
    effectiveness_status = coalesce(v_eff, effectiveness_status),
    reviewed_by = v_uid, updated_at = now()
  where id = p_proposal_id;
  insert into public.ai_runtime_learning_events (event_type, policy_proposal_id, runtime_postmortem_id, detail, payload, actor_id)
  values (v_evt, p_proposal_id, v_row.source_postmortem_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.proposal_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_proposal_id, 'proposal_status', coalesce(v_next, v_row.proposal_status), 'application_status', coalesce(v_app, v_row.application_status), 'effectiveness_status', coalesce(v_eff, v_row.effectiveness_status), 'policy_applied', false, 'threshold_changed', false, 'causality_confirmed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Learning 이벤트 기록(통합) — Root Cause 확정은 사람 검토 Reference 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_learning_event_record(p_kind text, p_reason text, p_payload jsonb, p_postmortem_id uuid default null, p_proposal_id uuid default null, p_session_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_pm public.ai_runtime_postmortems;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('root_cause_candidate_recorded','root_cause_candidate_reviewed','root_cause_confirmed_reference','contributing_factor_recorded','control_gap_recorded','recurrence_pattern_detected','corrective_action_proposed','corrective_action_reviewed','preventive_action_proposed','preventive_action_reviewed','adverse_effect_candidate_detected','organizational_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(Postmortem/Proposal 생성·검토는 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_postmortem_id is not null then
    select * into v_pm from public.ai_runtime_postmortems where id = p_postmortem_id;
    if v_pm.id is null then raise exception 'Postmortem 없음(실존 검증 실패)'; end if;
  end if;
  if p_proposal_id is not null and not exists (select 1 from public.ai_runtime_policy_proposals where id = p_proposal_id) then
    raise exception 'Policy Proposal 없음(실존 검증 실패)';
  end if;
  if p_session_id is not null and not exists (select 1 from public.ai_runtime_execution_sessions where id = p_session_id) then
    raise exception 'Runtime Session 없음(실존 검증 실패)';
  end if;
  -- Root Cause Candidate: type whitelist(18종).
  if p_kind in ('root_cause_candidate_recorded','root_cause_candidate_reviewed','root_cause_confirmed_reference') then
    if coalesce(p_payload->>'candidate_type','') not in ('connector_failure_candidate','connector_permission_candidate','connector_scope_candidate','credential_reference_candidate','runtime_precondition_candidate','automation_definition_candidate','timeout_policy_candidate','retry_policy_candidate','idempotency_candidate','evidence_collection_candidate','review_delay_candidate','cleanup_candidate','observation_candidate','external_provider_candidate','human_process_candidate','data_quality_candidate','configuration_candidate','unknown_candidate') then
      raise exception '허용되지 않는 root cause candidate_type';
    end if;
  end if;
  -- 정직성 게이트: Root Cause 확정은 사람 명시 검토 Reference(Evidence)와 선행 후보 기록 없이는 불가.
  if p_kind = 'root_cause_confirmed_reference' then
    if p_postmortem_id is null then raise exception 'Postmortem 필수'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Root Cause 확정 금지(root_cause_unverified)';
    end if;
    if not exists (select 1 from public.ai_runtime_learning_events where runtime_postmortem_id = p_postmortem_id and event_type = 'root_cause_candidate_reviewed') then
      raise exception '후보 검토 없는 Root Cause 확정 금지(사람 검토 Reference 선행 필수)';
    end if;
  end if;
  -- Corrective/Preventive Action: type whitelist.
  if p_kind in ('corrective_action_proposed','corrective_action_reviewed') and coalesce(p_payload->>'action_type','') not in ('gather_missing_evidence','verify_connector_permission','verify_connector_scope','revalidate_credential_reference','revise_automation_definition','revise_runtime_precondition','revise_timeout_policy','revise_retry_policy','revise_idempotency_requirement','revise_checkpoint_policy','revise_cleanup_policy','revise_observation_plan','improve_human_review_process','disable_reference_review','manual_investigation','insufficient_data') then
    raise exception '허용되지 않는 corrective action_type';
  end if;
  if p_kind in ('preventive_action_proposed','preventive_action_reviewed') and coalesce(p_payload->>'action_type','') not in ('add_validation_proposal','strengthen_scope_guard_proposal','strengthen_permission_guard_proposal','require_secondary_approval_proposal','require_dry_run_proposal','require_sandbox_proposal','require_idempotency_proposal','reduce_timeout_proposal','increase_timeout_proposal','require_checkpoint_proposal','improve_evidence_requirement_proposal','improve_cleanup_requirement_proposal','extend_observation_proposal','add_escalation_rule_proposal','add_connector_health_review_proposal','add_runtime_readiness_check_proposal','disable_automation_review_proposal','disable_connector_review_proposal','insufficient_data') then
    raise exception '허용되지 않는 preventive action_type';
  end if;
  -- Organizational Learning Reference: 승인된 Postmortem 없이는 불가(learning_reference_ready 게이트).
  if p_kind = 'organizational_learning_reference_recorded' then
    if p_postmortem_id is null or v_pm.postmortem_status not in ('approved_reference','approved_with_limitation') then
      raise exception 'postmortem_approval_missing: 승인된 Postmortem 없이 Learning Reference 기록 불가';
    end if;
    -- 원본 Decision Memory/Knowledge Graph 는 변경하지 않음 — Reference 기록만.
  end if;

  insert into public.ai_runtime_learning_events (event_type, runtime_postmortem_id, policy_proposal_id, runtime_session_id, detail, payload, actor_id)
  values (p_kind, p_postmortem_id, p_proposal_id, p_session_id,
    left(p_reason, 200) || case
      when p_kind = 'root_cause_candidate_recorded' then ' (Candidate ≠ Confirmed Root Cause·Correlation ≠ Causality)'
      when p_kind = 'root_cause_confirmed_reference' then ' (사람 검토 Reference — 책임자 지정 아님)'
      when p_kind = 'recurrence_pattern_detected' then ' (Pattern ≠ Root Cause·자동 확정 없음)'
      when p_kind = 'corrective_action_proposed' then ' (Proposal ≠ Applied Action)'
      when p_kind = 'preventive_action_proposed' then ' (Preventive Action ≠ Policy 변경)'
      when p_kind = 'organizational_learning_reference_recorded' then ' (원본 Decision Memory/Knowledge Graph 미변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'root_cause_confirmed_automatically', false, 'policy_applied', false, 'blame_assigned', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용 — 0536/0537/0512/0515 원본 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_postmortems(p_status text default null, p_limit int default 100)
returns setof public.ai_runtime_postmortems language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_postmortems m
    where (p_status is null or m.postmortem_status = p_status)
    order by m.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_policy_proposals(p_status text default null, p_limit int default 100)
returns setof public.ai_runtime_policy_proposals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_policy_proposals p
    where (p_status is null or p.proposal_status = p_status)
    order by p.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_learning_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'postmortems', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_postmortems),
      'draft', (select count(*) from public.ai_runtime_postmortems where postmortem_status = 'draft'),
      'pending_evidence', (select count(*) from public.ai_runtime_postmortems where postmortem_status = 'pending_evidence'),
      'pending_review', (select count(*) from public.ai_runtime_postmortems where postmortem_status = 'pending_review'),
      'approved', (select count(*) from public.ai_runtime_postmortems where postmortem_status in ('approved_reference','approved_with_limitation')),
      'rejected', (select count(*) from public.ai_runtime_postmortems where postmortem_status = 'rejected')
    ),
    'proposals', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_policy_proposals),
      'draft', (select count(*) from public.ai_runtime_policy_proposals where proposal_status = 'draft'),
      'pending_review', (select count(*) from public.ai_runtime_policy_proposals where proposal_status = 'pending_review'),
      'approved', (select count(*) from public.ai_runtime_policy_proposals where proposal_status in ('approved_reference','approved_with_limitation')),
      'approval_missing', (select count(*) from public.ai_runtime_policy_proposals where proposal_status in ('draft','pending_evidence','pending_review','approval_missing')),
      'application_pending', (select count(*) from public.ai_runtime_policy_proposals where application_status = 'application_pending'),
      'application_recorded', (select count(*) from public.ai_runtime_policy_proposals where application_status = 'application_reference_recorded'),
      'application_unverified', (select count(*) from public.ai_runtime_policy_proposals where application_status in ('application_reference_recorded','application_unverified')),
      'application_verified', (select count(*) from public.ai_runtime_policy_proposals where application_status = 'verified_reference'),
      'observation_in_progress', (select count(*) from public.ai_runtime_policy_proposals where effectiveness_status = 'observation_in_progress_reference'),
      'effectiveness_candidates', (select count(*) from public.ai_runtime_policy_proposals where effectiveness_status = 'effectiveness_candidate'),
      'ineffectiveness_candidates', (select count(*) from public.ai_runtime_policy_proposals where effectiveness_status = 'ineffectiveness_candidate'),
      'adverse_candidates', (select count(*) from public.ai_runtime_policy_proposals where effectiveness_status = 'adverse_effect_candidate')
    ),
    'learning_events', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_learning_events),
      'root_cause_candidates', (select count(*) from public.ai_runtime_learning_events where event_type = 'root_cause_candidate_recorded'),
      'root_cause_confirmed', (select count(*) from public.ai_runtime_learning_events where event_type = 'root_cause_confirmed_reference'),
      'contributing_factors', (select count(*) from public.ai_runtime_learning_events where event_type = 'contributing_factor_recorded'),
      'control_gaps', (select count(*) from public.ai_runtime_learning_events where event_type = 'control_gap_recorded'),
      'recurrence_patterns', (select count(*) from public.ai_runtime_learning_events where event_type = 'recurrence_pattern_detected'),
      'corrective_actions', (select count(*) from public.ai_runtime_learning_events where event_type = 'corrective_action_proposed'),
      'preventive_actions', (select count(*) from public.ai_runtime_learning_events where event_type = 'preventive_action_proposed'),
      'org_learning_refs', (select count(*) from public.ai_runtime_learning_events where event_type = 'organizational_learning_reference_recorded')
    ),
    -- 원본 실측(전부 읽기 전용):
    'history_actuals', jsonb_build_object(
      'sessions_0536', (select count(*) from public.ai_runtime_execution_sessions),
      'sessions_terminal_0536', (select count(*) from public.ai_runtime_execution_sessions where session_status in ('completed_reference','failed_reference','cancelled_reference','invalidated')),
      'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates),
      'incidents_resolved_0537', (select count(*) from public.ai_runtime_incident_candidates where incident_status in ('resolved_reference','resolved_with_limitation')),
      'assurance_signals_0537', (select count(*) from public.ai_runtime_assurance_signals),
      'policy_versions_0512', (select count(*) from public.ai_enterprise_policy_versions),
      'enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies),
      'org_learnings_0515', (select count(*) from public.ai_organizational_learnings),
      'decision_memory_0514', (select count(*) from public.ai_decision_memory),
      'outcomes_0514', (select count(*) from public.ai_decision_outcomes)
    ),
    'learning_unavailable', jsonb_build_array('runtime_postmortem_history_before_0538','automatic_policy_version_registry_for_runtime_rules','threshold_versioning_for_assurance','provider_outage_feed','external_incident_feed'),   -- 원본 없음(실측)
    'no_auto_root_cause_confirmation', true, 'no_auto_policy_change', true, 'no_auto_threshold_change', true,
    'no_auto_connector_automation_disable', true, 'no_auto_runtime_rule_apply', true, 'no_employee_evaluation', true, 'no_blame_assignment', true,
    'correlation_is_not_causality', true, 'pattern_is_not_root_cause', true, 'proposal_is_not_approval', true,
    'approval_is_not_application', true, 'application_is_not_effectiveness', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_runtime_learning_audit(p_limit int default 100)
returns setof public.ai_runtime_learning_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_learning_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_runtime_postmortems enable row level security;
alter table public.ai_runtime_policy_proposals enable row level security;
alter table public.ai_runtime_learning_events enable row level security;

comment on table public.ai_runtime_postmortems is 'AI-OPS-35 — Runtime Postmortem(AI 생성분은 초안 — Draft ≠ Approved·확정 Root Cause 아님·책임자 지정 없음·종결 재결정 차단).';
comment on table public.ai_runtime_policy_proposals is 'AI-OPS-35 — Assurance Policy Proposal(Proposal ≠ Approval ≠ Application ≠ Effectiveness — 0512/0509/0510 원본 Policy 미변경·Reference 만).';
comment on table public.ai_runtime_learning_events is 'AI-OPS-35 — Learning Audit(23종 — Root Cause/Factor/Gap/Pattern/Action/Version/Effectiveness/Learning Reference 통합·Root Cause 확정은 후보 검토+Evidence 선행 필수).';
