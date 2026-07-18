-- 0547_admin_ai_enterprise_execution_intelligence.sql
-- AI-OPS-43 — Enterprise Execution Intelligence, Program Management &
-- Initiative Delivery Center.
--
-- Strategic Portfolio → Execution Program → Execution Plan(Wave JSONB) →
-- Initiative Delivery → Milestone Tracking(JSONB 통합) → Execution Dependency →
-- Critical Path → Execution Health → Execution Risk → Planned/Actual/Forecast
-- Progress → Progress/Schedule Drift → Velocity/Stability → Delay Candidate →
-- Delay Root Cause Candidate → Bottleneck → Delivery Forecast →
-- Execution Quality → Delivery Recommendation → Human Delivery Review →
-- Delivery Approval Reference → Observed Delivery Outcome → Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Execution Plan ≠ Execution. Program Status ≠ Project Completion.
--  * Progress Candidate ≠ Actual Completion — actual_progress 는 Evidence 없이 기록 차단.
--  * Milestone Candidate ≠ Completed Milestone — milestone completed_reference 는
--    Evidence + 외부 completion reference 없으면 기록 차단(자동 Milestone 완료 없음).
--  * executing_reference 는 외부 Execution Reference 없으면 기록 차단.
--  * completed_reference 는 Evidence + 외부 Completion Reference 없으면 기록 차단
--    (실행하지 않은 작업 Completed 표시 금지).
--  * Planned ≠ Actual Progress. Forecast ≠ Future Fact. Delay Candidate ≠ Confirmed Delay.
--  * Root Cause Candidate ≠ Proven Cause. Recommendation ≠ Decision.
--  * Human Review ≠ Approval 자동화 — Self-Approval 차단, Approval Reference 의
--    auto_started/auto_completed/milestone_auto_completed/schedule_changed/
--    budget_changed/production_applied 전부 false.
--  * Outcome Link ≠ Causality. Quality ≠ Verified Quality. Velocity ≠ Productivity.
--  * Health ≠ Guaranteed Success. Stable ≠ Risk Free. Unknown 유지·Null→0 금지.
--  * 자동 프로젝트 시작/종료·자동 Milestone 완료·자동 승인/Rollout/Rollback/Merge/
--    Deploy/Budget/Resource Allocation/일정 변경/계약/Payment/Settlement/Provider/
--    Email/Slack/Ticket/Incident/Production 변경 — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0520/0535/0544/0545/0546 원본 무변경(참조만).
--  * Wave/Milestone/Deliverable/Outcome/Learning 은 신규 테이블 대신 JSONB + Events
--    통합(후보 다수 → 3 테이블 최소화). ai_execution_events 테이블은 실측 부재 —
--    실제 이벤트 원장은 ai_execution_gateway_events(0535)/ai_commitment_events(0520).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Execution Program(실제 프로젝트 실행 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_execution_programs (
  id                        uuid primary key default gen_random_uuid(),
  program_code              text not null,
  program_name              text not null,
  program_type              text not null check (program_type in ('initiative_delivery_program','platform_program','operations_program','content_program','music_quality_program','playlist_operations_program','store_operations_program','connector_program','automation_reference_program','compliance_program','infrastructure_reference_program','custom_reference')),
  program_status            text not null default 'draft' check (program_status in ('draft','pending_review','planned','ready_candidate','executing_reference','delayed_candidate','blocked_candidate','partially_completed_candidate','completed_reference','cancelled_reference','insufficient_data')),
  strategy_portfolio_id     uuid,
  decision_context_reference text,
  program_summary           text,
  program_owner_role_reference text,
  planned_start_reference   timestamptz,
  planned_end_reference     timestamptz,
  actual_start_reference    timestamptz,
  actual_end_reference      timestamptz,
  planned_progress_candidate int check (planned_progress_candidate is null or (planned_progress_candidate >= 0 and planned_progress_candidate <= 100)),
  actual_progress_reference int check (actual_progress_reference is null or (actual_progress_reference >= 0 and actual_progress_reference <= 100)),
  forecast_progress_candidate int check (forecast_progress_candidate is null or (forecast_progress_candidate >= 0 and forecast_progress_candidate <= 100)),
  delivery_health           text not null default 'insufficient_data' check (delivery_health in ('excellent','healthy','watch','degraded','critical','insufficient_data')),
  delivery_risk             text not null default 'insufficient_data' check (delivery_risk in ('low','moderate','high','critical','insufficient_data')),
  progress_drift_status     text not null default 'insufficient_data' check (progress_drift_status in ('on_track','minor_drift_candidate','major_drift_candidate','severe_drift_candidate','insufficient_data')),
  delivery_quality          text not null default 'insufficient_data' check (delivery_quality in ('excellent','acceptable','degraded','poor','insufficient_data')),
  milestones                jsonb not null default '[]'::jsonb,
  initiative_references     jsonb not null default '[]'::jsonb,
  allocation_references     jsonb not null default '[]'::jsonb,
  commitment_references     jsonb not null default '[]'::jsonb,
  execution_request_references jsonb not null default '[]'::jsonb,
  execution_reference       jsonb,
  completion_reference      jsonb,
  timeline_result           jsonb,
  dependency_result         jsonb,
  critical_path_result      jsonb,
  health_result             jsonb,
  risk_result               jsonb,
  drift_result              jsonb,
  schedule_drift_result     jsonb,
  quality_result            jsonb,
  velocity_result           jsonb,
  stability_result          jsonb,
  forecast_result           jsonb,
  delay_result              jsonb,
  delay_root_cause_result   jsonb,
  bottleneck_result         jsonb,
  recommendation_candidate  jsonb,
  delivery_reviews          jsonb not null default '[]'::jsonb,
  approval_reference        jsonb,
  outcome_reference         jsonb,
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
create unique index if not exists uq_aeep_idem on public.ai_enterprise_execution_programs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeep_status on public.ai_enterprise_execution_programs (program_status, program_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Enterprise Execution Plan(Wave/Deliverable JSONB 통합 — Plan ≠ Execution).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_execution_plans (
  id                        uuid primary key default gen_random_uuid(),
  plan_code                 text not null,
  plan_name                 text not null,
  execution_program_id      uuid not null,
  strategic_initiative_id   uuid,
  plan_status               text not null default 'draft' check (plan_status in ('draft','pending_review','planned','ready_candidate','executing_reference','delayed_candidate','blocked_candidate','partially_completed_candidate','completed_reference','cancelled_reference','insufficient_data')),
  plan_summary              text,
  wave_references           jsonb not null default '[]'::jsonb,
  milestones                jsonb not null default '[]'::jsonb,
  deliverable_references    jsonb not null default '[]'::jsonb,
  dependency_references     jsonb not null default '[]'::jsonb,
  planned_start_reference   timestamptz,
  planned_end_reference     timestamptz,
  actual_start_reference    timestamptz,
  actual_end_reference      timestamptz,
  planned_progress_candidate int check (planned_progress_candidate is null or (planned_progress_candidate >= 0 and planned_progress_candidate <= 100)),
  actual_progress_reference int check (actual_progress_reference is null or (actual_progress_reference >= 0 and actual_progress_reference <= 100)),
  forecast_progress_candidate int check (forecast_progress_candidate is null or (forecast_progress_candidate >= 0 and forecast_progress_candidate <= 100)),
  delivery_health           text not null default 'insufficient_data' check (delivery_health in ('excellent','healthy','watch','degraded','critical','insufficient_data')),
  delivery_risk             text not null default 'insufficient_data' check (delivery_risk in ('low','moderate','high','critical','insufficient_data')),
  progress_drift_status     text not null default 'insufficient_data' check (progress_drift_status in ('on_track','minor_drift_candidate','major_drift_candidate','severe_drift_candidate','insufficient_data')),
  delivery_quality          text not null default 'insufficient_data' check (delivery_quality in ('excellent','acceptable','degraded','poor','insufficient_data')),
  execution_reference       jsonb,
  completion_reference      jsonb,
  dependency_result         jsonb,
  health_result             jsonb,
  risk_result               jsonb,
  drift_result              jsonb,
  quality_result            jsonb,
  velocity_result           jsonb,
  forecast_result           jsonb,
  delay_result              jsonb,
  bottleneck_result         jsonb,
  delivery_reviews          jsonb not null default '[]'::jsonb,
  approval_reference        jsonb,
  outcome_reference         jsonb,
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
create unique index if not exists uq_aeepl_idem on public.ai_enterprise_execution_plans (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeepl_status on public.ai_enterprise_execution_plans (plan_status, execution_program_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Execution 이벤트(41종) — Timeline/Milestone/Dependency/Critical Path/
--    Health/Risk/Progress/Drift/Velocity/Stability/Delay/Root Cause/
--    Bottleneck/Forecast/Quality/Recommendation/Review/Approval/Outcome/
--    Learning 통합 Audit(자동 완료 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_execution_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('execution_program_created','execution_program_reviewed','execution_plan_created','execution_plan_reviewed','execution_timeline_reviewed','milestone_candidate_recorded','milestone_progress_reviewed','execution_dependency_reviewed','critical_path_reviewed','execution_health_reviewed','execution_risk_reviewed','progress_planned_recorded','progress_actual_reference_recorded','progress_drift_reviewed','schedule_drift_reviewed','velocity_reviewed','stability_reviewed','delay_candidate_recorded','delay_root_cause_candidate_recorded','bottleneck_reviewed','delivery_forecast_reviewed','execution_quality_reviewed','regression_reference_recorded','rollback_reference_recorded','delivery_recommendation_recorded','human_delivery_review_started','executive_review_requested','resource_review_requested','delivery_approval_reference_recorded','delivery_rejection_reference_recorded','delivery_defer_reference_recorded','delivery_revision_requested','initiative_reference_linked','portfolio_reference_linked','allocation_reference_linked','commitment_reference_linked','decision_reference_linked','execution_request_reference_linked','delivery_outcome_linked','execution_learning_reference_recorded','execution_invalidated')),
  execution_program_id      uuid,
  execution_plan_id         uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeee_evt on public.ai_enterprise_execution_events (event_type, created_at desc);
create index if not exists idx_aeee_prog on public.ai_enterprise_execution_events (execution_program_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Execution Program 생성 — 자동 실행/시작 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_execution_program_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_execution_programs;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'program_type','');
  -- 초기 Phase 금지 Program Type(자동 실행/집행 계열) — 구조적 차단.
  if v_type in ('automatic_project_start','automatic_project_completion','automatic_milestone_completion','automatic_deployment_program','automatic_rollout_program','automatic_rollback_program','automatic_merge_program','automatic_budget_change_program','automatic_resource_allocation_program','automatic_schedule_change_program','automatic_contract_execution_program','automatic_payment_execution_program','automatic_incident_response_program','automatic_production_change_program') then
    raise exception '금지된 program_type(초기 Phase 비활성)';
  end if;
  if v_type not in ('initiative_delivery_program','platform_program','operations_program','content_program','music_quality_program','playlist_operations_program','store_operations_program','connector_program','automation_reference_program','compliance_program','infrastructure_reference_program','custom_reference') then
    raise exception '허용되지 않는 program_type';
  end if;
  if coalesce(btrim(p_payload->>'program_name'),'') = '' then raise exception 'program_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'planned_start_reference','') is not null and nullif(p_payload->>'planned_end_reference','') is not null
     and (p_payload->>'planned_end_reference')::timestamptz <= (p_payload->>'planned_start_reference')::timestamptz then
    raise exception 'planned 기간 범위 오류(Date Abuse 차단)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_execution_programs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'program_is_not_execution', true); end if;
  end if;
  insert into public.ai_enterprise_execution_programs (program_code, program_name, program_type, strategy_portfolio_id, decision_context_reference, program_summary, program_owner_role_reference, planned_start_reference, planned_end_reference, milestones, initiative_references, allocation_references, commitment_references, execution_request_references, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'program_code',''), 'EXP-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'program_name', 200), v_type,
    nullif(p_payload->>'strategy_portfolio_id','')::uuid, nullif(p_payload->>'decision_context_reference',''),
    nullif(left(coalesce(p_payload->>'program_summary',''), 2000),''),
    nullif(left(coalesce(p_payload->>'program_owner_role_reference',''), 80),''),
    nullif(p_payload->>'planned_start_reference','')::timestamptz, nullif(p_payload->>'planned_end_reference','')::timestamptz,
    coalesce(p_payload->'milestones', '[]'::jsonb), coalesce(p_payload->'initiative_references', '[]'::jsonb),
    coalesce(p_payload->'allocation_references', '[]'::jsonb), coalesce(p_payload->'commitment_references', '[]'::jsonb),
    coalesce(p_payload->'execution_request_references', '[]'::jsonb),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, detail, payload, actor_id)
  values ('execution_program_created', v_id, left(v_type, 80) || ' (Program ≠ Execution — draft·자동 시작 없음)', jsonb_build_object('program_name', p_payload->>'program_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'program_is_not_execution', true, 'auto_started', false, 'auto_completed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Execution Program 검토 — executing/completed 는 외부 Reference·Evidence 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_execution_program_review(p_program_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_execution_programs; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','mark_planned','mark_ready','mark_executing_reference','mark_delayed','mark_blocked','mark_partially_completed','mark_completed_reference','cancel_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_execution_programs where id = p_program_id;
  if v_row.id is null then raise exception 'Execution Program 없음(실존 검증 실패)'; end if;
  if v_row.program_status in ('completed_reference','cancelled_reference') then raise exception '종결 상태 재결정 차단(%)', v_row.program_status; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_planned' then v_next := 'planned'; v_note := ' (Planned ≠ Executing)';
  elsif p_action = 'mark_ready' then v_next := 'ready_candidate'; v_note := ' (Ready Candidate ≠ 실행 시작)';
  elsif p_action = 'mark_executing_reference' then
    -- 실제 실행 근거 없는 executing 표시 차단.
    if coalesce(nullif(p_payload->>'external_execution_reference',''), '') = '' then
      raise exception '외부 Execution Reference 없는 executing 기록 금지(Plan ≠ Execution)';
    end if;
    v_next := 'executing_reference'; v_note := ' (Executing Reference — 실행 주체는 사람/외부 시스템)';
    update public.ai_enterprise_execution_programs set execution_reference = p_payload, actual_start_reference = coalesce(actual_start_reference, now()) where id = p_program_id;
  elsif p_action = 'mark_delayed' then v_next := 'delayed_candidate'; v_note := ' (Delay Candidate ≠ Confirmed Delay)';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate';
  elsif p_action = 'mark_partially_completed' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 partially_completed 금지';
    end if;
    v_next := 'partially_completed_candidate'; v_note := ' (Partial ≠ Completed)';
  elsif p_action = 'mark_completed_reference' then
    -- 실행하지 않은 작업 Completed 표시 금지 — Evidence + 외부 Completion Reference 필수.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed_reference 금지(미실행 Completed 차단)';
    end if;
    if coalesce(nullif(p_payload->>'external_completion_reference',''), '') = '' then
      raise exception '외부 Completion Reference 없는 completed_reference 금지';
    end if;
    v_next := 'completed_reference'; v_note := ' (Completed Reference ≠ Verified Project Completion)';
    update public.ai_enterprise_execution_programs set completion_reference = p_payload, actual_end_reference = coalesce(actual_end_reference, now()) where id = p_program_id;
  elsif p_action = 'cancel_reference' then v_next := 'cancelled_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_execution_programs set program_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_program_id;
  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, detail, payload, actor_id)
  values ('execution_program_reviewed', p_program_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_program_id, 'status', v_next, 'program_is_not_execution', true, 'auto_started', false, 'auto_completed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Execution Plan 생성/검토 — Program 실존 필수·동일 정직 게이트.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_execution_plan_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_execution_plans;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(btrim(p_payload->>'plan_name'),'') = '' then raise exception 'plan_name 필수'; end if;
  if nullif(p_payload->>'execution_program_id','') is null
     or not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategic_initiative_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
    raise exception 'Strategic Initiative 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'planned_start_reference','') is not null and nullif(p_payload->>'planned_end_reference','') is not null
     and (p_payload->>'planned_end_reference')::timestamptz <= (p_payload->>'planned_start_reference')::timestamptz then
    raise exception 'planned 기간 범위 오류(Date Abuse 차단)';
  end if;
  if jsonb_array_length(coalesce(p_payload->'wave_references', '[]'::jsonb)) > 100 then raise exception 'wave reference 100개 초과'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_execution_plans where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'plan_is_not_execution', true); end if;
  end if;
  insert into public.ai_enterprise_execution_plans (plan_code, plan_name, execution_program_id, strategic_initiative_id, plan_summary, wave_references, milestones, deliverable_references, dependency_references, planned_start_reference, planned_end_reference, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'plan_code',''), 'EXL-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'plan_name', 200),
    (p_payload->>'execution_program_id')::uuid, nullif(p_payload->>'strategic_initiative_id','')::uuid,
    nullif(left(coalesce(p_payload->>'plan_summary',''), 2000),''),
    coalesce(p_payload->'wave_references', '[]'::jsonb), coalesce(p_payload->'milestones', '[]'::jsonb),
    coalesce(p_payload->'deliverable_references', '[]'::jsonb), coalesce(p_payload->'dependency_references', '[]'::jsonb),
    nullif(p_payload->>'planned_start_reference','')::timestamptz, nullif(p_payload->>'planned_end_reference','')::timestamptz,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, execution_plan_id, detail, payload, actor_id)
  values ('execution_plan_created', (p_payload->>'execution_program_id')::uuid, v_id, 'Execution Plan (Plan ≠ Execution — draft·자동 실행 없음)', jsonb_build_object('plan_name', p_payload->>'plan_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'plan_is_not_execution', true, 'auto_started', false, 'auto_completed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_execution_plan_review(p_plan_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_execution_plans; v_next text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','mark_planned','mark_ready','mark_executing_reference','mark_delayed','mark_blocked','mark_partially_completed','mark_completed_reference','cancel_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_execution_plans where id = p_plan_id;
  if v_row.id is null then raise exception 'Execution Plan 없음(실존 검증 실패)'; end if;
  if v_row.plan_status in ('completed_reference','cancelled_reference') then raise exception '종결 상태 재결정 차단(%)', v_row.plan_status; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'mark_planned' then v_next := 'planned'; v_note := ' (Planned ≠ Executing)';
  elsif p_action = 'mark_ready' then v_next := 'ready_candidate';
  elsif p_action = 'mark_executing_reference' then
    if coalesce(nullif(p_payload->>'external_execution_reference',''), '') = '' then
      raise exception '외부 Execution Reference 없는 executing 기록 금지(Plan ≠ Execution)';
    end if;
    v_next := 'executing_reference';
    update public.ai_enterprise_execution_plans set execution_reference = p_payload, actual_start_reference = coalesce(actual_start_reference, now()) where id = p_plan_id;
  elsif p_action = 'mark_delayed' then v_next := 'delayed_candidate'; v_note := ' (Delay Candidate ≠ Confirmed Delay)';
  elsif p_action = 'mark_blocked' then v_next := 'blocked_candidate';
  elsif p_action = 'mark_partially_completed' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 partially_completed 금지';
    end if;
    v_next := 'partially_completed_candidate';
  elsif p_action = 'mark_completed_reference' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed_reference 금지(미실행 Completed 차단)';
    end if;
    if coalesce(nullif(p_payload->>'external_completion_reference',''), '') = '' then
      raise exception '외부 Completion Reference 없는 completed_reference 금지';
    end if;
    v_next := 'completed_reference'; v_note := ' (Completed Reference ≠ Verified Completion)';
    update public.ai_enterprise_execution_plans set completion_reference = p_payload, actual_end_reference = coalesce(actual_end_reference, now()) where id = p_plan_id;
  elsif p_action = 'cancel_reference' then v_next := 'cancelled_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_execution_plans set plan_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_plan_id;
  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, execution_plan_id, detail, payload, actor_id)
  values ('execution_plan_reviewed', v_row.execution_program_id, p_plan_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_plan_id, 'status', v_next, 'plan_is_not_execution', true, 'auto_started', false, 'auto_completed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Human Delivery Review — 요청/승인 Reference 만. Self-Approval 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_delivery_review(p_target_type text, p_target_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_created_by uuid; v_program_id uuid; v_plan_id uuid; v_evt text := 'human_delivery_review_started'; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_target_type not in ('program','plan') then raise exception '허용되지 않는 target_type'; end if;
  if p_action not in ('start_review','request_revision','request_executive_review','request_resource_review','approve_delivery_reference','approve_with_conditions_reference','reject_delivery_reference','defer_delivery_reference') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(승인/거절/보류/수정 전부)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_target_type = 'program' then
    select created_by into v_created_by from public.ai_enterprise_execution_programs where id = p_target_id;
    if v_created_by is null and not exists (select 1 from public.ai_enterprise_execution_programs where id = p_target_id) then
      raise exception 'Execution Program 없음(실존 검증 실패)';
    end if;
    v_program_id := p_target_id;
  else
    select created_by, execution_program_id into v_created_by, v_program_id from public.ai_enterprise_execution_plans where id = p_target_id;
    if not exists (select 1 from public.ai_enterprise_execution_plans where id = p_target_id) then
      raise exception 'Execution Plan 없음(실존 검증 실패)';
    end if;
    v_plan_id := p_target_id;
  end if;
  if p_action in ('approve_delivery_reference','approve_with_conditions_reference') then
    -- Self-Approval 차단 + Evidence 필수(Approval Reference ≠ Execution Approval).
    if v_created_by = v_uid then raise exception 'Self-Approval 차단(작성자 ≠ 승인자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Delivery Approval Reference 금지';
    end if;
    v_evt := 'delivery_approval_reference_recorded';
    v_note := ' (Approval Reference ≠ Execution Approval — 자동 시작/완료/배포 없음)';
  elsif p_action = 'reject_delivery_reference' then v_evt := 'delivery_rejection_reference_recorded';
  elsif p_action = 'defer_delivery_reference' then v_evt := 'delivery_defer_reference_recorded';
  elsif p_action = 'request_revision' then v_evt := 'delivery_revision_requested';
  elsif p_action = 'request_executive_review' then v_evt := 'executive_review_requested'; v_note := ' (Executive Review 요청 — 최종 결정은 사람)';
  elsif p_action = 'request_resource_review' then v_evt := 'resource_review_requested'; v_note := ' (Resource Review 요청 — 최종 배정은 사람)';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'conditions', coalesce(p_payload->'conditions', '[]'::jsonb),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_delivery_decision_confirmed', true,
    'auto_started', false, 'auto_completed', false, 'milestone_auto_completed', false,
    'schedule_changed', false, 'budget_changed', false, 'production_applied', false);
  if p_target_type = 'program' then
    update public.ai_enterprise_execution_programs set
      delivery_reviews = delivery_reviews || jsonb_build_array(v_review),
      approval_reference = case when p_action in ('approve_delivery_reference','approve_with_conditions_reference') then v_review else approval_reference end,
      reviewed_by = v_uid, updated_at = now()
    where id = p_target_id;
  else
    update public.ai_enterprise_execution_plans set
      delivery_reviews = delivery_reviews || jsonb_build_array(v_review),
      approval_reference = case when p_action in ('approve_delivery_reference','approve_with_conditions_reference') then v_review else approval_reference end,
      reviewed_by = v_uid, updated_at = now()
    where id = p_target_id;
  end if;
  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, execution_plan_id, detail, payload, actor_id)
  values (v_evt, v_program_id, v_plan_id, left(p_reason, 200) || v_note, v_review || jsonb_build_object('target_type', p_target_type), v_uid);
  return jsonb_build_object('ok', true, 'id', p_target_id, 'review_action', p_action, 'human_delivery_decision_confirmed', true, 'approval_is_not_execution', true, 'auto_started', false, 'auto_completed', false, 'milestone_auto_completed', false, 'schedule_changed', false, 'budget_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Execution 이벤트 기록(통합) — 자동 완료 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_execution_event_record(p_kind text, p_reason text, p_payload jsonb, p_program_id uuid default null, p_plan_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text; v_prog int; v_ms_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('execution_timeline_reviewed','milestone_candidate_recorded','milestone_progress_reviewed','execution_dependency_reviewed','critical_path_reviewed','execution_health_reviewed','execution_risk_reviewed','progress_planned_recorded','progress_actual_reference_recorded','progress_drift_reviewed','schedule_drift_reviewed','velocity_reviewed','stability_reviewed','delay_candidate_recorded','delay_root_cause_candidate_recorded','bottleneck_reviewed','delivery_forecast_reviewed','execution_quality_reviewed','regression_reference_recorded','rollback_reference_recorded','delivery_recommendation_recorded','initiative_reference_linked','portfolio_reference_linked','allocation_reference_linked','commitment_reference_linked','decision_reference_linked','execution_request_reference_linked','delivery_outcome_linked','execution_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_program_id is not null and not exists (select 1 from public.ai_enterprise_execution_programs where id = p_program_id) then raise exception 'Execution Program 없음(실존 검증 실패)'; end if;
  if p_plan_id is not null and not exists (select 1 from public.ai_enterprise_execution_plans where id = p_plan_id) then raise exception 'Execution Plan 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'execution_timeline_reviewed' then
    if v_result not in ('timeline_ready_candidate','timeline_partial_candidate','timeline_conflict_candidate','timeline_unverified','insufficient_data') then raise exception '허용되지 않는 timeline result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set timeline_result = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'milestone_candidate_recorded' then
    v_ms_status := coalesce(p_payload->>'milestone_status','');
    if v_ms_status not in ('proposed_candidate','planned_candidate','in_progress_reference','at_risk_candidate','delayed_candidate','completed_reference','cancelled_reference','insufficient_data') then
      raise exception '허용되지 않는 milestone_status';
    end if;
    -- Milestone Candidate ≠ Completed Milestone — 자동/무근거 완료 기록 차단.
    if v_ms_status = 'completed_reference' then
      if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
        raise exception 'Evidence 없는 milestone completed_reference 금지(자동 Milestone 완료 없음)';
      end if;
      if coalesce(nullif(p_payload->>'external_completion_reference',''), '') = '' then
        raise exception '외부 Completion Reference 없는 milestone completed_reference 금지';
      end if;
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set milestones = milestones || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set milestones = milestones || jsonb_build_array(p_payload), updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'milestone_progress_reviewed' and v_result not in ('milestone_on_track_candidate','milestone_at_risk_candidate','milestone_delayed_candidate','milestone_blocked_candidate','milestone_progress_unverified','insufficient_data') then
    raise exception '허용되지 않는 milestone progress result';
  end if;
  if p_kind = 'execution_dependency_reviewed' then
    if v_result not in ('no_material_dependency_risk_candidate','upstream_dependency_candidate','cross_program_dependency_candidate','circular_dependency_candidate','blocking_dependency_candidate','external_dependency_candidate','dependency_unverified','insufficient_data') then raise exception '허용되지 않는 dependency result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set dependency_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set dependency_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'critical_path_reviewed' then
    if v_result not in ('critical_path_identified_candidate','critical_path_shift_candidate','no_critical_path_candidate','critical_path_unverified','insufficient_data') then raise exception '허용되지 않는 critical path result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set critical_path_result = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'execution_health_reviewed' then
    if v_result not in ('excellent','healthy','watch','degraded','critical','insufficient_data') then raise exception '허용되지 않는 health result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set delivery_health = v_result, health_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set delivery_health = v_result, health_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'execution_risk_reviewed' then
    if coalesce(p_payload->>'risk_dimension','') not in ('schedule_risk','resource_risk','dependency_risk','provider_risk','approval_risk','technical_risk','operational_risk','external_risk') then
      raise exception '허용되지 않는 risk_dimension';
    end if;
    if v_result not in ('low','moderate','high','critical','insufficient_data') then raise exception '허용되지 않는 risk result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set delivery_risk = v_result, risk_result = coalesce(risk_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'risk_dimension', p_payload), updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set delivery_risk = v_result, risk_result = coalesce(risk_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'risk_dimension', p_payload), updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'progress_planned_recorded' then
    if nullif(p_payload->>'planned_progress','') is null then raise exception 'planned_progress 필수'; end if;
    v_prog := least(100, greatest(0, (p_payload->>'planned_progress')::int));
    if p_program_id is not null then update public.ai_enterprise_execution_programs set planned_progress_candidate = v_prog, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set planned_progress_candidate = v_prog, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'progress_actual_reference_recorded' then
    -- 미검증 Progress 를 Actual 로 표시 금지 — Evidence 필수.
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 actual progress 기록 금지(Progress Candidate ≠ Actual Completion)';
    end if;
    if nullif(p_payload->>'actual_progress','') is null then raise exception 'actual_progress 필수'; end if;
    v_prog := least(100, greatest(0, (p_payload->>'actual_progress')::int));
    if p_program_id is not null then update public.ai_enterprise_execution_programs set actual_progress_reference = v_prog, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set actual_progress_reference = v_prog, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'progress_drift_reviewed' then
    if v_result not in ('on_track','minor_drift_candidate','major_drift_candidate','severe_drift_candidate','insufficient_data') then raise exception '허용되지 않는 drift result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set progress_drift_status = v_result, drift_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set progress_drift_status = v_result, drift_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'schedule_drift_reviewed' then
    if v_result not in ('no_material_schedule_drift_candidate','minor_schedule_drift_candidate','major_schedule_drift_candidate','severe_schedule_drift_candidate','schedule_drift_unverified','insufficient_data') then raise exception '허용되지 않는 schedule drift result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set schedule_drift_result = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'velocity_reviewed' then
    if v_result not in ('stable_velocity_candidate','improving_velocity_candidate','declining_velocity_candidate','volatile_velocity_candidate','velocity_unverified','insufficient_data') then raise exception '허용되지 않는 velocity result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set velocity_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set velocity_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'stability_reviewed' then
    if v_result not in ('stable_execution_candidate','moderately_stable_candidate','unstable_execution_candidate','stability_unverified','insufficient_data') then raise exception '허용되지 않는 stability result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set stability_result = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'delay_candidate_recorded' then
    if v_result not in ('no_delay_candidate','minor_delay_candidate','major_delay_candidate','severe_delay_candidate','delay_unverified','insufficient_data') then raise exception '허용되지 않는 delay result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set delay_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set delay_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'delay_root_cause_candidate_recorded' then
    if coalesce(p_payload->>'cause_category','') not in ('dependency_cause_candidate','resource_cause_candidate','approval_cause_candidate','scope_cause_candidate','technical_cause_candidate','provider_cause_candidate','external_cause_candidate','unknown_cause','insufficient_data') then
      raise exception '허용되지 않는 cause_category';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set delay_root_cause_result = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'bottleneck_reviewed' then
    if v_result not in ('no_material_bottleneck_candidate','review_bottleneck_candidate','approval_bottleneck_candidate','resource_bottleneck_candidate','dependency_bottleneck_candidate','technical_bottleneck_candidate','bottleneck_unverified','insufficient_data') then raise exception '허용되지 않는 bottleneck result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set bottleneck_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set bottleneck_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'delivery_forecast_reviewed' then
    if v_result not in ('on_schedule_forecast_candidate','at_risk_forecast_candidate','delayed_forecast_candidate','highly_uncertain_forecast_candidate','forecast_unverified','insufficient_data') then raise exception '허용되지 않는 forecast result'; end if;
    if p_program_id is not null then
      update public.ai_enterprise_execution_programs set forecast_result = p_payload,
        forecast_progress_candidate = case when nullif(p_payload->>'forecast_progress','') is null then forecast_progress_candidate else least(100, greatest(0, (p_payload->>'forecast_progress')::int)) end,
        updated_at = now() where id = p_program_id;
    end if;
    if p_plan_id is not null then
      update public.ai_enterprise_execution_plans set forecast_result = p_payload,
        forecast_progress_candidate = case when nullif(p_payload->>'forecast_progress','') is null then forecast_progress_candidate else least(100, greatest(0, (p_payload->>'forecast_progress')::int)) end,
        updated_at = now() where id = p_plan_id;
    end if;
  end if;
  if p_kind = 'execution_quality_reviewed' then
    if v_result not in ('excellent','acceptable','degraded','poor','insufficient_data') then raise exception '허용되지 않는 quality result'; end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set delivery_quality = v_result, quality_result = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set delivery_quality = v_result, quality_result = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'delivery_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_execution_program','create_execution_plan','review_execution_timeline','record_milestone_candidate','review_milestone_progress','review_execution_dependency','review_critical_path','review_execution_health','review_execution_risk','record_planned_progress','request_actual_progress_evidence','review_progress_drift','review_schedule_drift','review_velocity','review_stability','record_delay_candidate','review_delay_root_cause','review_bottleneck','review_delivery_forecast','review_execution_quality','request_delivery_review','request_executive_review','request_resource_review','record_delivery_approval_reference','link_execution_reference','link_delivery_outcome','record_execution_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Delivery Recommendation 금지';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set recommendation_candidate = p_payload, updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'initiative_reference_linked' then
    if nullif(p_payload->>'strategic_initiative_id','') is not null
       and not exists (select 1 from public.ai_enterprise_strategic_initiatives where id = (p_payload->>'strategic_initiative_id')::uuid) then
      raise exception 'Strategic Initiative 없음(실존 검증 실패)';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set initiative_references = initiative_references || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'allocation_reference_linked' then
    if nullif(p_payload->>'allocation_option_id','') is not null
       and not exists (select 1 from public.ai_enterprise_resource_allocation_options where id = (p_payload->>'allocation_option_id')::uuid) then
      raise exception 'Allocation Option 없음(실존 검증 실패)';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set allocation_references = allocation_references || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'commitment_reference_linked' then
    if nullif(p_payload->>'commitment_id','') is not null
       and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
      raise exception 'Commitment 없음(실존 검증 실패)';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set commitment_references = commitment_references || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'decision_reference_linked' and nullif(p_payload->>'decision_context_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_contexts where id = (p_payload->>'decision_context_id')::uuid) then
    raise exception 'Decision Context 없음(실존 검증 실패)';
  end if;
  if p_kind = 'execution_request_reference_linked' then
    if nullif(p_payload->>'execution_request_id','') is not null
       and not exists (select 1 from public.ai_execution_requests where id = (p_payload->>'execution_request_id')::uuid) then
      raise exception 'Execution Request 없음(실존 검증 실패)';
    end if;
    if p_program_id is not null then update public.ai_enterprise_execution_programs set execution_request_references = execution_request_references || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id; end if;
  end if;
  if p_kind = 'delivery_outcome_linked' then
    if p_program_id is not null then update public.ai_enterprise_execution_programs set outcome_reference = p_payload, updated_at = now() where id = p_program_id; end if;
    if p_plan_id is not null then update public.ai_enterprise_execution_plans set outcome_reference = p_payload, updated_at = now() where id = p_plan_id; end if;
  end if;
  if p_kind = 'execution_learning_reference_recorded' and p_program_id is not null then
    update public.ai_enterprise_execution_programs set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_program_id;
  end if;

  insert into public.ai_enterprise_execution_events (event_type, execution_program_id, execution_plan_id, detail, payload, actor_id)
  values (p_kind, p_program_id, p_plan_id,
    left(p_reason, 200) || case
      when p_kind = 'execution_timeline_reviewed' then ' (Timeline Candidate ≠ 확정 일정)'
      when p_kind = 'milestone_candidate_recorded' then ' (Milestone Candidate ≠ Completed Milestone)'
      when p_kind = 'milestone_progress_reviewed' then ' (Milestone Progress ≠ Actual Completion)'
      when p_kind = 'execution_dependency_reviewed' then ' (Dependency Candidate ≠ 자동 차단/해제)'
      when p_kind = 'critical_path_reviewed' then ' (Critical Path Candidate ≠ 확정 경로)'
      when p_kind = 'execution_health_reviewed' then ' (Health ≠ Guaranteed Success)'
      when p_kind = 'execution_risk_reviewed' then ' (Risk Candidate ≠ Confirmed Failure)'
      when p_kind = 'progress_planned_recorded' then ' (Planned ≠ Actual Progress)'
      when p_kind = 'progress_actual_reference_recorded' then ' (Actual Reference — Evidence 기반 기록)'
      when p_kind = 'progress_drift_reviewed' then ' (Drift Candidate ≠ Confirmed Delay)'
      when p_kind = 'schedule_drift_reviewed' then ' (Schedule Drift ≠ 자동 일정 변경 신호)'
      when p_kind = 'velocity_reviewed' then ' (Velocity ≠ Productivity)'
      when p_kind = 'stability_reviewed' then ' (Stable ≠ Risk Free)'
      when p_kind = 'delay_candidate_recorded' then ' (Delay Candidate ≠ Confirmed Delay)'
      when p_kind = 'delay_root_cause_candidate_recorded' then ' (Root Cause Candidate ≠ Proven Cause)'
      when p_kind = 'bottleneck_reviewed' then ' (Bottleneck Candidate ≠ 자동 재배치 신호)'
      when p_kind = 'delivery_forecast_reviewed' then ' (Forecast ≠ Future Fact)'
      when p_kind = 'execution_quality_reviewed' then ' (Quality ≠ Verified Quality)'
      when p_kind = 'regression_reference_recorded' then ' (Regression Reference ≠ 자동 Rollback)'
      when p_kind = 'rollback_reference_recorded' then ' (Rollback Reference — 실행은 외부/사람)'
      when p_kind = 'delivery_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'initiative_reference_linked' then ' (Initiative Reference ≠ Initiative 완료)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 실행)'
      when p_kind = 'allocation_reference_linked' then ' (Allocation Reference ≠ 배정 집행)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ Completed Commitment)'
      when p_kind = 'decision_reference_linked' then ' (Decision Reference ≠ Execution)'
      when p_kind = 'execution_request_reference_linked' then ' (Request Reference ≠ 실행 완료)'
      when p_kind = 'delivery_outcome_linked' then ' (Outcome Link ≠ Causality)'
      when p_kind = 'execution_learning_reference_recorded' then ' (Learning Reference ≠ 자동 재계획)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_started', false, 'auto_completed', false, 'milestone_auto_completed', false, 'schedule_changed', false, 'budget_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_execution_programs_list(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_execution_programs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_execution_programs
  where (p_status is null or program_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_execution_plans_list(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_execution_plans language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_execution_plans
  where (p_status is null or plan_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_execution_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'programs', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_execution_programs),
      'pending_review', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'pending_review'),
      'planned', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'planned'),
      'ready', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'ready_candidate'),
      'executing', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'executing_reference'),
      'delayed', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'delayed_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'blocked_candidate'),
      'partially_completed', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'partially_completed_candidate'),
      'completed', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'completed_reference'),
      'cancelled', (select count(*) from public.ai_enterprise_execution_programs where program_status = 'cancelled_reference'),
      'health_watch_or_worse', (select count(*) from public.ai_enterprise_execution_programs where delivery_health in ('watch','degraded','critical')),
      'risk_high_or_critical', (select count(*) from public.ai_enterprise_execution_programs where delivery_risk in ('high','critical')),
      'drift_major_or_severe', (select count(*) from public.ai_enterprise_execution_programs where progress_drift_status in ('major_drift_candidate','severe_drift_candidate')),
      'approved_references', (select count(*) from public.ai_enterprise_execution_programs where approval_reference is not null)
    ),
    'plans', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_execution_plans),
      'pending_review', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'pending_review'),
      'planned', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'planned'),
      'executing', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'executing_reference'),
      'delayed', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'delayed_candidate'),
      'blocked', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'blocked_candidate'),
      'completed', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'completed_reference'),
      'cancelled', (select count(*) from public.ai_enterprise_execution_plans where plan_status = 'cancelled_reference')
    ),
    'execution_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_execution_events),
      'timeline_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_timeline_reviewed'),
      'milestone_candidates', (select count(*) from public.ai_enterprise_execution_events where event_type = 'milestone_candidate_recorded'),
      'milestone_progress_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'milestone_progress_reviewed'),
      'dependency_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_dependency_reviewed'),
      'critical_path_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'critical_path_reviewed'),
      'health_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_health_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_risk_reviewed'),
      'planned_progress_records', (select count(*) from public.ai_enterprise_execution_events where event_type = 'progress_planned_recorded'),
      'actual_progress_records', (select count(*) from public.ai_enterprise_execution_events where event_type = 'progress_actual_reference_recorded'),
      'drift_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'progress_drift_reviewed'),
      'schedule_drift_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'schedule_drift_reviewed'),
      'velocity_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'velocity_reviewed'),
      'stability_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'stability_reviewed'),
      'delay_candidates', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delay_candidate_recorded'),
      'root_cause_candidates', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delay_root_cause_candidate_recorded'),
      'bottleneck_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'bottleneck_reviewed'),
      'forecast_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_forecast_reviewed'),
      'quality_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_quality_reviewed'),
      'regression_references', (select count(*) from public.ai_enterprise_execution_events where event_type = 'regression_reference_recorded'),
      'rollback_references', (select count(*) from public.ai_enterprise_execution_events where event_type = 'rollback_reference_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_recommendation_recorded'),
      'delivery_reviews', (select count(*) from public.ai_enterprise_execution_events where event_type = 'human_delivery_review_started'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_execution_events where event_type = 'executive_review_requested'),
      'resource_review_requests', (select count(*) from public.ai_enterprise_execution_events where event_type = 'resource_review_requested'),
      'delivery_approvals', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_approval_reference_recorded'),
      'delivery_rejections', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_rejection_reference_recorded'),
      'delivery_defers', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_defer_reference_recorded'),
      'revision_requests', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_revision_requested'),
      'initiative_links', (select count(*) from public.ai_enterprise_execution_events where event_type = 'initiative_reference_linked'),
      'allocation_links', (select count(*) from public.ai_enterprise_execution_events where event_type = 'allocation_reference_linked'),
      'commitment_links', (select count(*) from public.ai_enterprise_execution_events where event_type = 'commitment_reference_linked'),
      'execution_request_links', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_request_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_execution_events where event_type = 'delivery_outcome_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_execution_events where event_type = 'execution_learning_reference_recorded')
    ),
    -- Execution 원천 실측(전부 읽기 전용):
    'execution_actuals', jsonb_build_object(
      'strategic_initiatives_0545', (select count(*) from public.ai_enterprise_strategic_initiatives),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'allocation_options_0546', (select count(*) from public.ai_enterprise_resource_allocation_options),
      'decision_contexts_0544', (select count(*) from public.ai_enterprise_decision_contexts),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'commitment_milestones_0520', (select count(*) from public.ai_commitment_milestones),
      'execution_requests_0535', (select count(*) from public.ai_execution_requests),
      'agents_0497', (select count(*) from public.ai_agents),
      'connector_definitions_0536', (select count(*) from public.ai_connector_definitions)
    ),
    'execution_unavailable', jsonb_build_array('project_management_system','issue_tracker_feed','ci_cd_pipeline_feed','deployment_history_feed','sprint_velocity_feed','time_tracking_system','ai_execution_events_table'),   -- 원본 없음(실측 — 실제 이벤트 원장은 ai_execution_gateway_events/ai_commitment_events)
    'plan_is_not_execution', true, 'program_status_is_not_project_completion', true,
    'progress_candidate_is_not_actual_completion', true, 'milestone_candidate_is_not_completed_milestone', true,
    'forecast_is_not_future_fact', true, 'delay_candidate_is_not_confirmed_delay', true,
    'root_cause_candidate_is_not_proven_cause', true, 'recommendation_is_not_decision', true,
    'approval_reference_is_not_execution_approval', true, 'outcome_link_is_not_causality', true,
    'quality_is_not_verified_quality', true, 'velocity_is_not_productivity', true,
    'health_is_not_guaranteed_success', true, 'stable_is_not_risk_free', true,
    'no_auto_project_start', true, 'no_auto_project_completion', true, 'no_auto_milestone_completion', true,
    'no_auto_approval', true, 'no_auto_rollout', true, 'no_auto_schedule_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_execution_audit(p_limit int default 100)
returns setof public.ai_enterprise_execution_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_execution_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_execution_programs enable row level security;
alter table public.ai_enterprise_execution_plans enable row level security;
alter table public.ai_enterprise_execution_events enable row level security;

comment on table public.ai_enterprise_execution_programs is 'AI-OPS-43 — Execution Program(≠ 실제 프로젝트 실행·Status 11종·executing/completed 는 외부 Reference+Evidence 필수·자동 시작/완료 없음).';
comment on table public.ai_enterprise_execution_plans is 'AI-OPS-43 — Execution Plan(≠ Execution·Wave/Milestone/Deliverable JSONB 통합·Program/Initiative 실존 검증).';
comment on table public.ai_enterprise_execution_events is 'AI-OPS-43 — Execution 이벤트 41종(자동 완료 이벤트 생성 금지·Approval Reference ≠ Execution Approval).';
