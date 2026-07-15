-- 0520_admin_ai_commitment_execution_assurance.sql
-- Phase AI-OPS-17 — Enterprise Commitment Intelligence, Strategic Execution
-- Assurance & Accountability Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0519 검증 완료):
--   Selection 원본: ai_executive_priority_candidates(accepted_reference)/
--     ai_executive_priority_portfolios(selected_reference)/ai_executive_decisions(0511)/
--     ai_policy_evolution·recommendation(0512·0515)/ai_capacity 권고(0519).
--   Ownership 원본: users.role='admin'(실측)/reviewer_id/approver_id/created_by.
--     Team/Department/HR 시스템 없음(실측) → Owner/Sponsor/Reviewer 는 Reference 기록,
--     실제 책임 수락은 Acknowledgement Reference(이벤트)로만 확인.
--   Execution 원본: external action 이벤트(0518/0519)/ai_decision_execution_refs(0514)/
--     rollout·deployment·contract·settlement·incident 참조 — 자동 수집 없음.
--   Schedule 원본: created_at/reviewed_at/deadline_at/portfolio period. Calendar/
--     Working Day 정의 없음(실측) → schedule_baseline_unverified 기본.
--   Progress 원본: 이벤트 로그/수동 Reference — 자기보고와 검증 분리 저장.
--   Outcome 원본: ai_decision_outcomes(0514)/ai_post_change_observations(0506).
--
-- Commitment 정직성(전부 강제):
--   * 선택 ≠ 실행 시작. Owner Reference ≠ 실제 책임 수락(Acknowledgement 필요).
--   * Reported Progress ≠ Verified Progress(컬럼 분리·복사 금지). 100% 보고 ≠ 완료 검증.
--   * 증거 없는 완료 보고 verified_complete 금지(서버 차단). 완료 ≠ Outcome.
--   * Success Criteria 없으면 성공 판정 금지. Deadline 경과 ≠ 실패 확정.
--   * Blocker/Ownership Gap/Accountability ≠ 인사 평가.
--   * Trigger 없음 · 삭제 RPC 없음 · 업무/Calendar/HR 실행 RPC 없음 · 원본 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Commitment — 실제 업무 지시/계약 의무 자동 생성 아님.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_commitments (
  id                  uuid primary key default gen_random_uuid(),
  commitment_code     text not null unique,
  commitment_domain   text not null check (commitment_domain in ('executive','operations','engineering','product','security','privacy','compliance','finance','contract','settlement','sales','marketing','content','playlist','infrastructure','policy','governance','strategy','organizational','incident','recovery','manual')),
  commitment_type     text not null check (commitment_type in ('priority_execution_reference','portfolio_execution_reference','strategic_initiative_reference','policy_action_reference','contract_review_reference','settlement_review_reference','security_remediation_reference','privacy_action_reference','compliance_action_reference','capacity_action_reference','incident_recovery_reference','deployment_reference','operational_improvement_reference','manual')),
  source_reference_type text,
  source_reference_id uuid,
  priority_candidate_id uuid references public.ai_executive_priority_candidates(id),
  priority_portfolio_id uuid references public.ai_executive_priority_portfolios(id),
  title               text not null,
  commitment_summary  text,
  scope_type          text not null default 'unverified',
  scope_id            text,
  owner_reference     text,                                    -- Reference — 실제 배정/인사 발령 아님
  sponsor_reference   text,
  reviewer_reference  text,
  backup_owner_reference text,
  owner_acknowledged  boolean not null default false,          -- Acknowledgement Reference 없으면 수락 아님
  sponsor_acknowledged boolean not null default false,
  reviewer_acknowledged boolean not null default false,
  start_reference_at  timestamptz,
  target_reference_at timestamptz,
  actual_start_reference_at timestamptz,
  actual_complete_reference_at timestamptz,
  success_criteria    jsonb not null default '[]'::jsonb,      -- 없으면 success_criteria_missing
  preconditions       jsonb not null default '[]'::jsonb,
  dependencies        jsonb not null default '[]'::jsonb,
  risks               jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["선택 ≠ 실행 시작","Owner Reference ≠ 실제 책임 수락","완료 보고 ≠ Outcome"]'::jsonb,
  commitment_status   text not null default 'draft' check (commitment_status in ('draft','pending_owner_acknowledgement','waiting_precondition','ready_reference','externally_started_reference','in_progress_reference','blocked_reference','at_risk_reference','completion_reported_reference','completion_review_pending','verified_complete_reference','outcome_observation_pending','cancelled_reference','invalidated','expired','insufficient_data')),
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_owner_acknowledgement','waiting_evidence','reviewed_reference','at_risk_reference','cancelled_reference','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  source_version      text not null default 'commitment_v1(0520)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (target_reference_at is null or start_reference_at is null or target_reference_at > start_reference_at)
);
create index if not exists idx_exec_commit on public.ai_execution_commitments (commitment_domain, commitment_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Milestone — 자동 작업 항목 아님.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_commitment_milestones (
  id                  uuid primary key default gen_random_uuid(),
  milestone_code      text not null unique,
  commitment_id       uuid not null references public.ai_execution_commitments(id),
  title               text not null,
  milestone_sequence  int not null check (milestone_sequence >= 1 and milestone_sequence <= 100),
  milestone_type      text not null check (milestone_type in ('review','approval','analysis','design','implementation_reference','validation','deployment_reference','observation','certification','handover','external_action','manual')),
  planned_start_reference_at timestamptz,
  planned_due_reference_at timestamptz,
  actual_start_reference_at timestamptz,
  actual_complete_reference_at timestamptz,
  milestone_status    text not null default 'draft' check (milestone_status in ('draft','waiting_precondition','ready_reference','externally_started_reference','in_progress_reference','blocked_reference','at_risk_reference','completion_reported_reference','verification_pending','verified_complete_reference','cancelled_reference','invalidated','insufficient_data')),
  completion_percentage_reference numeric check (completion_percentage_reference is null or (completion_percentage_reference >= 0 and completion_percentage_reference <= 100)),
  success_criteria    jsonb not null default '[]'::jsonb,
  evidence_required   jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  dependencies        jsonb not null default '[]'::jsonb,
  blockers            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Milestone 완료 표시 ≠ 실제 성과 달성","자동 작업 항목 아님"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_evidence','verified_reference','rejected','invalidated')),
  source_version      text not null default 'commitment_v1(0520)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_commit_ms on public.ai_commitment_milestones (commitment_id, milestone_sequence);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Progress Snapshot — reported/verified 분리 · 덮어쓰기 금지.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_commitment_progress_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  commitment_id       uuid not null references public.ai_execution_commitments(id),
  snapshot_at         timestamptz not null default now(),
  reported_progress_percentage numeric check (reported_progress_percentage is null or (reported_progress_percentage >= 0 and reported_progress_percentage <= 100)),
  verified_progress_percentage numeric check (verified_progress_percentage is null or (verified_progress_percentage >= 0 and verified_progress_percentage <= 100)),
  progress_status     text not null default 'insufficient_data' check (progress_status in ('not_started_reference','externally_started_reference','progressing_reference','stalled_candidate','blocked_reference','at_risk_reference','completion_reported_reference','completion_unverified','verified_complete_reference','insufficient_data')),
  completed_milestone_count int check (completed_milestone_count is null or completed_milestone_count >= 0),
  total_milestone_count int check (total_milestone_count is null or total_milestone_count >= 0),
  active_blocker_count int check (active_blocker_count is null or active_blocker_count >= 0),
  unresolved_dependency_count int check (unresolved_dependency_count is null or unresolved_dependency_count >= 0),
  schedule_variance_days numeric,
  scope_variance_status text,
  delivery_confidence numeric check (delivery_confidence is null or (delivery_confidence >= 0 and delivery_confidence <= 100)),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["자기보고 Progress ≠ 검증된 Progress","Progress 100% ≠ 완료 검증"]'::jsonb,
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_commit_prog on public.ai_commitment_progress_snapshots (commitment_id, snapshot_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Blocker — 자동 해결 없음 · 인사 평가 아님.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_commitment_blockers (
  id                  uuid primary key default gen_random_uuid(),
  blocker_code        text not null unique,
  commitment_id       uuid not null references public.ai_execution_commitments(id),
  milestone_id        uuid references public.ai_commitment_milestones(id),
  blocker_type        text not null check (blocker_type in ('dependency','capacity','resource','budget_reference','technical','security','privacy','compliance','contract','settlement','policy','approval','evidence','external_party','schedule','scope','data','manual')),
  blocker_summary     text not null,
  severity            text not null default 'severity_unverified' check (severity in ('critical','high','medium','low','severity_unverified','insufficient_data')),
  impact_status       text not null default 'blocker_impact_unverified' check (impact_status in ('negligible_candidate','low_candidate','moderate_candidate','high_candidate','critical_candidate','blocker_impact_unverified','insufficient_data')),
  blocking_domain     text,
  dependency_reference text,
  owner_reference     text,
  detected_at         timestamptz not null default now(),
  expected_resolution_reference_at timestamptz,
  resolved_reference_at timestamptz,
  blocker_status      text not null default 'detected' check (blocker_status in ('detected','pending_review','active_reference','resolution_reported_reference','resolution_verification_pending','resolved_reference','accepted_risk_reference','cancelled_reference','invalidated','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Blocker 수 ≠ 담당자 능력 평가","resolved_reference ≠ 위험 소멸 자동 보장"]'::jsonb,
  source_version      text not null default 'commitment_v1(0520)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_commit_blk on public.ai_commitment_blockers (commitment_id, blocker_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Completion Review — 증거 없는 verified_complete 금지 · 완료 ≠ Outcome.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_commitment_completion_reviews (
  id                  uuid primary key default gen_random_uuid(),
  review_code         text not null unique,
  commitment_id       uuid not null references public.ai_execution_commitments(id),
  completion_reported_at timestamptz not null default now(),
  reported_by_reference text,
  completion_summary  text not null,
  claimed_deliverables jsonb not null default '[]'::jsonb,
  completion_evidence jsonb not null default '[]'::jsonb,
  success_criteria_results jsonb not null default '[]'::jsonb,
  verification_status text not null default 'completion_reported_reference' check (verification_status in ('completion_reported_reference','evidence_partial','success_criteria_partial','verification_pending','completion_unverified','verified_complete_reference','rejected_completion_reference','insufficient_data')),
  reviewer_reference  text,
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  unresolved_items    jsonb not null default '[]'::jsonb,
  outcome_observation_required boolean not null default true,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["완료 보고 ≠ Outcome 달성","verified_complete_reference ≠ 성과 보장"]'::jsonb,
  source_version      text not null default 'commitment_v1(0520)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_commit_cr on public.ai_commitment_completion_reviews (commitment_id, verification_status, created_at desc);

-- Ownership Acknowledgement/External Action/Accountability/Outcome Readiness/Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_commitment_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('commitment_created','ownership_reference_added','owner_acknowledged_reference','success_criteria_defined','milestone_created','milestone_started_reference','milestone_completion_reported','milestone_verified_reference','progress_snapshot_created','blocker_detected','blocker_resolution_reported','blocker_resolved_reference','dependency_wait_detected','schedule_variance_detected','scope_drift_detected','delivery_confidence_calculated','commitment_risk_calculated','completion_reported','completion_review_started','completion_verified_reference','outcome_readiness_reviewed','accountability_reviewed','external_commitment_action_recorded','commitment_outcome_linked','commitment_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_commit_evt on public.ai_commitment_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 요약 — 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'commitments_total', (select count(*) from public.ai_execution_commitments),
    'commitments_by_status', (select coalesce(jsonb_object_agg(commitment_status, n), '{}'::jsonb) from (select commitment_status, count(*) n from public.ai_execution_commitments group by commitment_status) x),
    'waiting_owner_ack', (select count(*) from public.ai_execution_commitments where not owner_acknowledged and commitment_status not in ('cancelled_reference','invalidated','expired')),
    'owner_gaps', (select count(*) from public.ai_execution_commitments where owner_reference is null and commitment_status not in ('cancelled_reference','invalidated','expired')),
    'success_criteria_missing', (select count(*) from public.ai_execution_commitments where jsonb_array_length(success_criteria) = 0 and commitment_status not in ('cancelled_reference','invalidated','expired')),
    'milestones_total', (select count(*) from public.ai_commitment_milestones),
    'milestones_unverified', (select count(*) from public.ai_commitment_milestones where milestone_status = 'completion_reported_reference'),
    'progress_snapshots_total', (select count(*) from public.ai_commitment_progress_snapshots),
    'active_blockers', (select count(*) from public.ai_commitment_blockers where blocker_status in ('detected','pending_review','active_reference')),
    'completion_reviews_pending', (select count(*) from public.ai_commitment_completion_reviews where verification_status in ('completion_reported_reference','verification_pending','evidence_partial','success_criteria_partial')),
    'verified_complete', (select count(*) from public.ai_commitment_completion_reviews where verification_status = 'verified_complete_reference'),
    -- 원본 실측(참조만) + 미존재 정직 표기:
    'source_actuals', jsonb_build_object(
      'selected_priorities', (select count(*) from public.ai_executive_priority_candidates where priority_status = 'accepted_reference'),
      'selected_portfolios', (select count(*) from public.ai_executive_priority_portfolios where review_status = 'selected_reference'),
      'admin_count', (select count(*) from public.users where role = 'admin' and withdrawn_at is null),
      'decision_outcomes', (select count(*) from public.ai_decision_outcomes),
      'project_management_system', 'unsupported',
      'ticket_system', 'unsupported',
      'hr_system', 'unsupported',
      'calendar_integration', 'schedule_baseline_unverified',
      'working_day_definition', 'schedule_baseline_unverified'
    ),
    'no_auto_work_assignment', true, 'no_auto_schedule_change', true, 'no_auto_completion', true, 'no_personnel_evaluation', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Commitment 생성·검토·Ownership Reference.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_create(
  p_code text, p_domain text, p_type text, p_title text, p_evidence jsonb,
  p_summary text default null, p_priority_id uuid default null, p_portfolio_id uuid default null,
  p_source_type text default null, p_source_id uuid default null,
  p_owner text default null, p_sponsor text default null, p_reviewer text default null,
  p_backup text default null, p_start_at timestamptz default null, p_target_at timestamptz default null,
  p_success_criteria jsonb default '[]'::jsonb, p_preconditions jsonb default '[]'::jsonb,
  p_dependencies jsonb default '[]'::jsonb, p_risks jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_priority_id is not null and not exists (select 1 from public.ai_executive_priority_candidates where id = p_priority_id) then raise exception 'priority 실존 검증 실패'; end if;
  if p_portfolio_id is not null and not exists (select 1 from public.ai_executive_priority_portfolios where id = p_portfolio_id) then raise exception 'portfolio 실존 검증 실패'; end if;
  if jsonb_array_length(coalesce(p_dependencies, '[]'::jsonb)) > 30 or jsonb_array_length(coalesce(p_success_criteria, '[]'::jsonb)) > 20 then raise exception 'dependency 30/criteria 20 제한'; end if;
  if pg_column_size(coalesce(p_success_criteria, '[]'::jsonb)) + pg_column_size(coalesce(p_evidence, '[]'::jsonb)) > 32768 then raise exception 'JSON 32KB 제한'; end if;
  -- 선택 ≠ 실행: 생성 상태는 draft/pending_owner_acknowledgement 만 — 시작/진행 상태 지정 불가
  v_status := case when p_owner is not null then 'pending_owner_acknowledgement' else 'draft' end;
  select id into v_id from public.ai_execution_commitments where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_execution_commitments (commitment_code, commitment_domain, commitment_type, source_reference_type, source_reference_id, priority_candidate_id, priority_portfolio_id, title, commitment_summary, owner_reference, sponsor_reference, reviewer_reference, backup_owner_reference, start_reference_at, target_reference_at, success_criteria, preconditions, dependencies, risks, evidence, commitment_status, idempotency_key, created_by)
  values (p_code, p_domain, p_type, p_source_type, p_source_id, p_priority_id, p_portfolio_id, left(p_title, 200), p_summary, p_owner, p_sponsor, p_reviewer, p_backup, p_start_at, p_target_at, coalesce(p_success_criteria, '[]'::jsonb), coalesce(p_preconditions, '[]'::jsonb), coalesce(p_dependencies, '[]'::jsonb), coalesce(p_risks, '[]'::jsonb), p_evidence, v_status, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('commitment_created', v_id, p_code || ' (' || p_type || ') — 업무 지시 아님·실행 시작 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'execution_started', false, 'work_assigned', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_review(p_id uuid, p_status text, p_reason text, p_commitment_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb; v_criteria int; v_evidence_cnt int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_owner_acknowledgement','waiting_evidence','reviewed_reference','at_risk_reference','cancelled_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_commitment_status is not null and p_commitment_status not in ('pending_owner_acknowledgement','waiting_precondition','ready_reference','externally_started_reference','in_progress_reference','blocked_reference','at_risk_reference','completion_reported_reference','completion_review_pending','outcome_observation_pending','cancelled_reference','invalidated','expired') then raise exception '허용되지 않는 commitment_status'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  -- verified_complete_reference 는 이 RPC 로 지정 불가 — completion review 워크플로만
  select review_status, created_by, jsonb_array_length(success_criteria), jsonb_array_length(evidence) into v_cur, v_creator, v_criteria, v_evidence_cnt
    from public.ai_execution_commitments where id = p_id for update;
  if v_cur is null then raise exception 'commitment 없음'; end if;
  if v_cur in ('cancelled_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- Evidence 없는 in_progress 지정 차단(자기보고 방지)
  if p_commitment_status = 'in_progress_reference' and v_evidence_cnt = 0 then raise exception 'Evidence 없는 in_progress 지정 금지(execution_unverified)'; end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'reviewed_reference' then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 검토자가 동일');
  end if;
  update public.ai_execution_commitments
     set review_status = p_status, commitment_status = coalesce(p_commitment_status, commitment_status),
         warnings = warnings || v_warnings, reviewer_id = v_uid, reviewed_at = now(),
         review_reason = left(p_reason, 500), updated_at = now()
   where id = p_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('commitment_created', p_id, 'review: ' || v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'warnings', v_warnings, 'success_criteria_missing', v_criteria = 0, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_ownership_reference(p_id uuid, p_role text, p_reference text, p_reason text, p_acknowledged boolean default false, p_evidence jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_role not in ('owner','sponsor','reviewer','backup_owner') then raise exception '허용되지 않는 role'; end if;
  if p_reference is null or btrim(p_reference) = '' then raise exception 'reference 필수'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if coalesce(p_acknowledged, false) and (p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0) then raise exception 'Acknowledgement 는 Evidence 필수'; end if;
  select commitment_status into v_cur from public.ai_execution_commitments where id = p_id for update;
  if v_cur is null then raise exception 'commitment 없음'; end if;
  if v_cur in ('cancelled_reference','invalidated','expired') then raise exception '종결 상태(%)에서 변경 불가', v_cur; end if;
  update public.ai_execution_commitments
     set owner_reference = case when p_role = 'owner' then left(p_reference, 200) else owner_reference end,
         sponsor_reference = case when p_role = 'sponsor' then left(p_reference, 200) else sponsor_reference end,
         reviewer_reference = case when p_role = 'reviewer' then left(p_reference, 200) else reviewer_reference end,
         backup_owner_reference = case when p_role = 'backup_owner' then left(p_reference, 200) else backup_owner_reference end,
         owner_acknowledged = case when p_role = 'owner' and coalesce(p_acknowledged, false) then true else owner_acknowledged end,
         sponsor_acknowledged = case when p_role = 'sponsor' and coalesce(p_acknowledged, false) then true else sponsor_acknowledged end,
         reviewer_acknowledged = case when p_role = 'reviewer' and coalesce(p_acknowledged, false) then true else reviewer_acknowledged end,
         updated_at = now()
   where id = p_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, payload, actor_id)
  values (case when coalesce(p_acknowledged, false) then 'owner_acknowledged_reference' else 'ownership_reference_added' end, p_id,
          p_role || ': ' || left(p_reference, 100) || ' — ' || left(p_reason, 150) || ' (실제 배정/인사 발령 아님)', jsonb_build_object('evidence', coalesce(p_evidence, '[]'::jsonb)), v_uid);
  return jsonb_build_object('ok', true, 'role', p_role, 'acknowledged', coalesce(p_acknowledged, false), 'work_assigned', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitments(p_status text default null, p_limit int default 100)
returns setof public.ai_execution_commitments language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_commitments where (p_status is null or commitment_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Milestone 생성·검토.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_milestone_create(
  p_code text, p_commitment_id uuid, p_title text, p_sequence int, p_type text, p_evidence jsonb,
  p_planned_start timestamptz default null, p_planned_due timestamptz default null,
  p_success_criteria jsonb default '[]'::jsonb, p_evidence_required jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_execution_commitments where id = p_commitment_id) then raise exception 'commitment 실존 검증 실패'; end if;
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_sequence is null or p_sequence < 1 or p_sequence > 100 then raise exception 'sequence 1~100'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  select count(*) into v_cnt from public.ai_commitment_milestones where commitment_id = p_commitment_id;
  if v_cnt >= 30 then raise exception 'commitment 당 milestone 30개 제한'; end if;
  select id into v_id from public.ai_commitment_milestones where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_commitment_milestones (milestone_code, commitment_id, title, milestone_sequence, milestone_type, planned_start_reference_at, planned_due_reference_at, success_criteria, evidence_required, evidence, idempotency_key, created_by)
  values (p_code, p_commitment_id, left(p_title, 200), p_sequence, p_type, p_planned_start, p_planned_due, coalesce(p_success_criteria, '[]'::jsonb), coalesce(p_evidence_required, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('milestone_created', v_id, p_code || ' (seq ' || p_sequence || ') — 자동 작업 항목 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'task_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_milestone_review(p_id uuid, p_status text, p_reason text, p_evidence jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_required int; v_provided int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('waiting_precondition','ready_reference','externally_started_reference','in_progress_reference','blocked_reference','at_risk_reference','completion_reported_reference','verification_pending','verified_complete_reference','cancelled_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select milestone_status, jsonb_array_length(evidence_required), jsonb_array_length(evidence) + jsonb_array_length(coalesce(p_evidence, '[]'::jsonb))
    into v_cur, v_required, v_provided from public.ai_commitment_milestones where id = p_id for update;
  if v_cur is null then raise exception 'milestone 없음'; end if;
  if v_cur in ('cancelled_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- 증거 없는 verified_complete 금지(milestone_unverified 유지)
  if p_status = 'verified_complete_reference' and (v_provided = 0 or (v_required > 0 and v_provided < v_required)) then
    raise exception 'Milestone Evidence 부족 — verified_complete 금지(required %, provided %)', v_required, v_provided;
  end if;
  update public.ai_commitment_milestones
     set milestone_status = p_status, evidence = evidence || coalesce(p_evidence, '[]'::jsonb),
         review_status = case when p_status = 'verified_complete_reference' then 'verified_reference' else review_status end,
         actual_complete_reference_at = case when p_status = 'verified_complete_reference' then now() else actual_complete_reference_at end,
         updated_at = now()
   where id = p_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'verified_complete_reference' then 'milestone_verified_reference' when p_status = 'completion_reported_reference' then 'milestone_completion_reported' else 'milestone_started_reference' end,
          p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (완료 표시 ≠ 성과 달성)', v_uid);
  return jsonb_build_object('ok', true, 'milestone_status', p_status, 'outcome_achieved', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_milestones(p_commitment_id uuid default null, p_limit int default 100)
returns setof public.ai_commitment_milestones language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_commitment_milestones where (p_commitment_id is null or commitment_id = p_commitment_id)
    order by milestone_sequence asc, created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Progress Snapshot — reported/verified 분리 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_progress_snapshot_create(
  p_code text, p_commitment_id uuid, p_evidence jsonb,
  p_reported numeric default null, p_verified numeric default null,
  p_status text default 'insufficient_data', p_schedule_variance numeric default null,
  p_scope_variance text default null, p_delivery_confidence numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text; v_completed int; v_total int; v_blockers int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_execution_commitments where id = p_commitment_id) then raise exception 'commitment 실존 검증 실패'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_reported is not null and (p_reported < 0 or p_reported > 100) then raise exception 'reported 0~100'; end if;
  if p_verified is not null and (p_verified < 0 or p_verified > 100) then raise exception 'verified 0~100'; end if;
  -- verified 는 검증된 milestone 실측으로만 — reported 를 verified 로 복사 금지
  select count(*) filter (where milestone_status = 'verified_complete_reference'), count(*) into v_completed, v_total
    from public.ai_commitment_milestones where commitment_id = p_commitment_id;
  if p_verified is not null and v_total = 0 then raise exception '검증된 Milestone 없이 verified progress 지정 금지'; end if;
  select count(*) into v_blockers from public.ai_commitment_blockers where commitment_id = p_commitment_id and blocker_status in ('detected','pending_review','active_reference');
  v_status := coalesce(p_status, 'insufficient_data');
  -- reported 100% + verified 미달 → completion_unverified 강제
  if coalesce(p_reported, 0) >= 100 and (p_verified is null or p_verified < 100) then v_status := 'completion_unverified'; end if;
  if v_status = 'verified_complete_reference' and (p_verified is null or p_verified < 100) then raise exception 'verified 100% 없이 verified_complete 금지'; end if;
  select id into v_id from public.ai_commitment_progress_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_commitment_progress_snapshots (snapshot_code, commitment_id, reported_progress_percentage, verified_progress_percentage, progress_status, completed_milestone_count, total_milestone_count, active_blocker_count, schedule_variance_days, scope_variance_status, delivery_confidence, evidence, idempotency_key, created_by)
  values (p_code, p_commitment_id, p_reported, p_verified, v_status, v_completed, v_total, v_blockers, p_schedule_variance, p_scope_variance, p_delivery_confidence, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('progress_snapshot_created', v_id, p_code || ' (reported ' || coalesce(p_reported::text, 'null') || '% / verified ' || coalesce(p_verified::text, 'null') || '%) — 자기보고 ≠ 검증', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'progress_status', v_status, 'auto_progress_change', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_progress_snapshots(p_commitment_id uuid default null, p_limit int default 100)
returns setof public.ai_commitment_progress_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_commitment_progress_snapshots where (p_commitment_id is null or commitment_id = p_commitment_id)
    order by snapshot_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Blocker 생성·검토 — 자동 해제 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_blocker_create(
  p_code text, p_commitment_id uuid, p_type text, p_summary text, p_evidence jsonb,
  p_milestone_id uuid default null, p_severity text default 'severity_unverified',
  p_impact text default 'blocker_impact_unverified', p_domain text default null,
  p_owner text default null, p_expected_resolution timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_execution_commitments where id = p_commitment_id) then raise exception 'commitment 실존 검증 실패'; end if;
  if p_milestone_id is not null and not exists (select 1 from public.ai_commitment_milestones where id = p_milestone_id) then raise exception 'milestone 실존 검증 실패'; end if;
  if p_summary is null or btrim(p_summary) = '' then raise exception 'summary 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_severity not in ('critical','high','medium','low','severity_unverified','insufficient_data') then raise exception '허용되지 않는 severity'; end if;
  if p_impact not in ('negligible_candidate','low_candidate','moderate_candidate','high_candidate','critical_candidate','blocker_impact_unverified','insufficient_data') then raise exception '허용되지 않는 impact'; end if;
  select count(*) into v_cnt from public.ai_commitment_blockers where commitment_id = p_commitment_id;
  if v_cnt >= 50 then raise exception 'commitment 당 blocker 50개 제한'; end if;
  select id into v_id from public.ai_commitment_blockers where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_commitment_blockers (blocker_code, commitment_id, milestone_id, blocker_type, blocker_summary, severity, impact_status, blocking_domain, owner_reference, expected_resolution_reference_at, evidence, idempotency_key, created_by)
  values (p_code, p_commitment_id, p_milestone_id, p_type, left(p_summary, 1000), coalesce(p_severity, 'severity_unverified'), coalesce(p_impact, 'blocker_impact_unverified'), p_domain, p_owner, p_expected_resolution, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('blocker_detected', v_id, p_code || ' (' || p_type || ') — 능력 평가 아님·자동 해결 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_resolved', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_blocker_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','active_reference','resolution_reported_reference','resolution_verification_pending','resolved_reference','accepted_risk_reference','cancelled_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select blocker_status into v_cur from public.ai_commitment_blockers where id = p_id for update;
  if v_cur is null then raise exception 'blocker 없음'; end if;
  if v_cur in ('cancelled_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_commitment_blockers
     set blocker_status = p_status,
         resolved_reference_at = case when p_status = 'resolved_reference' then now() else resolved_reference_at end,
         updated_at = now()
   where id = p_id;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'resolved_reference' then 'blocker_resolved_reference' when p_status = 'resolution_reported_reference' then 'blocker_resolution_reported' else 'blocker_detected' end,
          p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (위험 소멸 자동 보장 아님)', v_uid);
  return jsonb_build_object('ok', true, 'blocker_status', p_status, 'risk_eliminated_guaranteed', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_blockers(p_commitment_id uuid default null, p_limit int default 100)
returns setof public.ai_commitment_blockers language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_commitment_blockers where (p_commitment_id is null or commitment_id = p_commitment_id)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Completion Report·Verification — 증거 없는 verified_complete 서버 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_completion_report(
  p_code text, p_commitment_id uuid, p_summary text, p_evidence jsonb,
  p_reported_by text default null, p_deliverables jsonb default '[]'::jsonb,
  p_criteria_results jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_execution_commitments where id = p_commitment_id) then raise exception 'commitment 실존 검증 실패'; end if;
  if p_summary is null or btrim(p_summary) = '' then raise exception 'summary 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  select id into v_id from public.ai_commitment_completion_reviews where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_commitment_completion_reviews (review_code, commitment_id, reported_by_reference, completion_summary, claimed_deliverables, completion_evidence, success_criteria_results, idempotency_key, created_by)
  values (p_code, p_commitment_id, p_reported_by, left(p_summary, 1000), coalesce(p_deliverables, '[]'::jsonb), p_evidence, coalesce(p_criteria_results, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  update public.ai_execution_commitments set commitment_status = 'completion_review_pending', updated_at = now()
   where id = p_commitment_id and commitment_status not in ('cancelled_reference','invalidated','expired','verified_complete_reference');
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id) values ('completion_reported', v_id, p_code || ' — 완료 보고 ≠ 완료 검증 ≠ Outcome', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'verified', false, 'outcome_achieved', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_completion_review(p_id uuid, p_status text, p_reason text, p_unresolved jsonb default '[]'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_commitment uuid; v_evidence int; v_criteria int; v_critical_blockers int; v_reporter uuid; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('evidence_partial','success_criteria_partial','verification_pending','completion_unverified','verified_complete_reference','rejected_completion_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select verification_status, commitment_id, jsonb_array_length(completion_evidence), jsonb_array_length(success_criteria_results), created_by
    into v_cur, v_commitment, v_evidence, v_criteria, v_reporter
    from public.ai_commitment_completion_reviews where id = p_id for update;
  if v_cur is null then raise exception 'completion review 없음'; end if;
  if v_cur in ('rejected_completion_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- verified_complete 조건 서버 강제: Evidence + Success Criteria 결과 + Critical Blocker 미해결 없음
  if p_status = 'verified_complete_reference' then
    if v_evidence = 0 then raise exception 'Completion Evidence 없음 — verified_complete 금지(completion_unverified)'; end if;
    if v_criteria = 0 then raise exception 'Success Criteria 결과 없음 — verified_complete 금지(success_criteria_missing)'; end if;
    select count(*) into v_critical_blockers from public.ai_commitment_blockers
     where commitment_id = v_commitment and severity = 'critical' and blocker_status in ('detected','pending_review','active_reference');
    if v_critical_blockers > 0 then raise exception '미해결 Critical Blocker % 건 — verified_complete 금지', v_critical_blockers; end if;
    if v_reporter is not null and v_reporter = v_uid then
      v_warnings := jsonb_build_array('self_review_warning: 보고자와 검증자가 동일');
    end if;
  end if;
  update public.ai_commitment_completion_reviews
     set verification_status = p_status, reviewer_id = v_uid, reviewed_at = now(),
         review_reason = left(p_reason, 500), unresolved_items = coalesce(p_unresolved, '[]'::jsonb)
   where id = p_id;
  if p_status = 'verified_complete_reference' then
    update public.ai_execution_commitments set commitment_status = 'outcome_observation_pending', actual_complete_reference_at = now(), warnings = warnings || v_warnings, updated_at = now() where id = v_commitment;
  end if;
  insert into public.ai_commitment_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'verified_complete_reference' then 'completion_verified_reference' else 'completion_review_started' end,
          p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (완료 검증 ≠ Outcome 달성)', v_uid);
  return jsonb_build_object('ok', true, 'verification_status', p_status, 'warnings', v_warnings, 'outcome_achieved', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_completion_reviews(p_commitment_id uuid default null, p_limit int default 100)
returns setof public.ai_commitment_completion_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_commitment_completion_reviews where (p_commitment_id is null or commitment_id = p_commitment_id)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 12) Outcome Readiness / Accountability / External Action / Audit — Event 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_commitment_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('outcome_readiness_reviewed','accountability_reviewed','dependency_wait_detected','schedule_variance_detected','scope_drift_detected','delivery_confidence_calculated','commitment_risk_calculated','commitment_outcome_linked','success_criteria_defined') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_commitment_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'accountability_reviewed' then ' (인사 평가 아님)' when p_kind = 'commitment_outcome_linked' then ' (인과 자동 연결 아님)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'personnel_evaluation', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_external_action(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('owner_acknowledged_reference','sponsor_acknowledged_reference','reviewer_acknowledged_reference','work_started_reference','milestone_started_reference','milestone_completed_reference','blocker_reported_reference','blocker_resolved_reference','deadline_changed_reference','scope_changed_reference','completion_reported_reference','completion_verified_reference','outcome_observation_started_reference','commitment_cancelled_reference','manual_commitment_action_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_commitment_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_commitment_action_recorded', p_ref_id, p_action_type || ' — ' || left(p_reason, 200) || ' (업무/일정/HR 미변경·진위 자동 보장 없음)', jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'work_changed', false, 'schedule_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_commitment_audit(p_limit int default 100)
returns setof public.ai_commitment_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_commitment_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_execution_commitments enable row level security;
alter table public.ai_commitment_milestones enable row level security;
alter table public.ai_commitment_progress_snapshots enable row level security;
alter table public.ai_commitment_blockers enable row level security;
alter table public.ai_commitment_completion_reviews enable row level security;
alter table public.ai_commitment_events enable row level security;

comment on table public.ai_execution_commitments is 'AI-OPS-17 — Commitment(선택 ≠ 실행·Owner Reference ≠ 책임 수락·업무 지시 아님).';
comment on table public.ai_commitment_milestones is 'AI-OPS-17 — Milestone(Evidence 없는 verified_complete 서버 차단·자동 Task 아님).';
comment on table public.ai_commitment_progress_snapshots is 'AI-OPS-17 — Progress(reported/verified 분리·100% 보고 ≠ 완료 검증·덮어쓰기 금지).';
comment on table public.ai_commitment_blockers is 'AI-OPS-17 — Blocker(자동 해결 없음·능력 평가 아님).';
comment on table public.ai_commitment_completion_reviews is 'AI-OPS-17 — Completion(Evidence+Criteria+Critical Blocker 검증 없이 verified 금지·완료 ≠ Outcome).';
comment on table public.ai_commitment_events is 'AI-OPS-17 — Commitment Audit(event_type whitelist 25종·Ack/External/Accountability/Readiness 통합).';
