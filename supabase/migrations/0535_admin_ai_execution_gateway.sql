-- 0535_admin_ai_execution_gateway.sql
-- Phase AI-OPS-32 — Enterprise AI Runtime Readiness, Controlled Execution Gateway &
-- Human-Approved Automation Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * Governance/Approval: ai_orchestration_events(0534 — oversight_approved 사람 승인 Reference),
--     ai_governance_events(0496 — approval/rejection), ai_constitution_rules(0496 — immutable).
--   * Execution: ai_execution_plans(0505 — ready_for_manual_execution·종결 차단),
--     ai_execution_commitments/ai_commitment_events(0520 — deployment_reference 등 15종 external action).
--   * Observation: ai_post_change_observations(0506)/ai_reliability_indicators(0507)/
--     ai_incidents·ai_recovery_candidates(0502)/ai_decision_outcomes(0514).
--   * Connector 실측(코드): Edge Function 20종 존재 — dispatch-*-emails(Resend)/dispatch-kakao-message/
--     send-push/PayApp 결제(create·cancel·sync)/PDF 생성/admin-apply-analytics-db 등.
--     Slack·Jira·Linear·GitHub 연동, 범용 Connector Registry, Runtime Scheduler, Worker Queue 는 없음.
--   본 Phase 는 위 원본을 전부 읽기 전용 참조 — 원본 미변경.
--   신규 테이블 3개(requests/capabilities/events)로 최소화 —
--   Permission/Scope/Risk/DryRun/Sandbox/Gate/ExternalAction/Result/Retry/Timeout/
--   Cancellation/Rollback/Observation/Closure 검토는 전부 이벤트(payload jsonb)로 통합.
--
-- 실행 정직성(전부 강제):
--   * Proposal ≠ Approval. Approval ≠ Execution. Execution Request ≠ Execution Success.
--   * Dry Run ≠ Real Execution. External Reference ≠ Verified Result.
--   * HTTP Success ≠ Business Success. Execution Completion ≠ Outcome. Closure ≠ Outcome Success.
--   * production mode 미지원(생성 자체 차단). 금지 도메인 13종 차단(결제/계약/권한/삭제 등).
--   * RPC 내부에서 실제 Connector 실행 없음 — 전부 Reference 기록만.
--   * Approval Reference(0534 oversight_approved) 실존 검증 없이 approved_reference 불가.
--   * 승인+Permission+Scope+(필요 시 DryRun) 없이 ready_for_controlled_execution 불가(서버 게이트).
--   * ready 상태가 아니면 external_action_recorded 기록 차단.
--   * 종결 상태(rejected/cancelled/invalidated/closed_reference) 재결정 차단.
--   * Unknown 유지(null→0 금지). Trigger 없음 · 삭제 RPC 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Execution Request(실제 실행이 아님 — 요청/검증/게이트 기록).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_requests (
  id                    uuid primary key default gen_random_uuid(),
  execution_code        text not null,
  request_type          text not null default 'manual' check (request_type in ('ai_proposal','governance_advisory','commitment_followup','incident_followup','manual')),
  execution_domain      text not null check (execution_domain in ('read_only_query','document_draft','email_draft','message_draft','ticket_draft','issue_draft','report_generation','evidence_collection','validation_check','sandbox_test','non_production_action_reference','manual_external_action_reference')),
  execution_mode        text not null check (execution_mode in ('reference_only','read_only','draft_only','dry_run','sandbox','non_production_controlled','manual_external_reference')),
  execution_status      text not null default 'draft' check (execution_status in ('draft','pending_review','approval_missing','approved_reference','permission_check_pending','permission_unverified','scope_check_pending','scope_unverified','dry_run_pending','dry_run_completed_reference','sandbox_pending','sandbox_completed_reference','ready_for_controlled_execution','execution_started_reference','execution_reported_reference','result_verification_pending','result_unverified','observation_pending','closure_pending','closed_reference','rejected','cancelled','invalidated','insufficient_data')),
  title                 text not null,
  execution_summary     text,
  requested_action      text,
  target_system         text,
  target_resource_type  text,
  target_resource_id    text,
  scope_type            text not null default 'global' check (scope_type in ('global','enterprise','brand','store','user')),
  scope_id              text,
  requested_parameters  jsonb not null default '{}'::jsonb,
  expected_result       text,
  expected_evidence     text,
  risk_level            text not null default 'risk_unverified' check (risk_level in ('negligible','low','moderate','high','critical','risk_unverified','insufficient_data')),
  reversibility_status  text not null default 'rollback_unverified' check (reversibility_status in ('rollback_ready_reference','partially_ready','rollback_unverified','rollback_unavailable','irreversible_action','insufficient_data')),
  dry_run_required      boolean not null default true,
  sandbox_required      boolean not null default false,
  observation_required  boolean not null default true,
  rollback_required     boolean not null default true,
  approval_reference_id uuid,   -- 0534 oversight_approved 이벤트 id(실존 검증)
  governance_reference_id uuid,
  source_agent_id       uuid,
  commitment_id         uuid,
  preconditions         jsonb not null default '[]'::jsonb,
  assumptions           jsonb not null default '[]'::jsonb,
  unknown_factors       jsonb not null default '[]'::jsonb,
  limitations           jsonb not null default '[]'::jsonb,
  idempotency_key       text,
  input_hash            text,
  requested_by          uuid,
  reviewed_by           uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_exec_req_idem on public.ai_execution_requests (idempotency_key) where idempotency_key is not null;
create index if not exists idx_exec_req_status on public.ai_execution_requests (execution_status, created_at desc);
create index if not exists idx_exec_req_domain on public.ai_execution_requests (execution_domain, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Capability Registry(사람 기록 — Connector 실존과 동일하지 않음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_capabilities (
  id                       uuid primary key default gen_random_uuid(),
  capability_code          text not null unique,
  capability_domain        text not null check (capability_domain in ('read_only_query','document_draft','email_draft','message_draft','ticket_draft','issue_draft','report_generation','evidence_collection','validation_check','sandbox_test','non_production_action_reference','manual_external_action_reference')),
  connector_type           text not null default 'none' check (connector_type in ('edge_function','email_dispatch','kakao_message','push_notification','payment_payapp','pdf_generation','db_admin_function','manual','none')),
  action_type              text,
  execution_mode           text not null check (execution_mode in ('reference_only','read_only','draft_only','dry_run','sandbox','non_production_controlled','manual_external_reference')),
  environment_scope        text not null default 'non_production' check (environment_scope in ('non_production','sandbox','reference_only')),
  supports_dry_run         boolean not null default false,
  supports_sandbox         boolean not null default false,
  supports_idempotency     boolean not null default false,
  supports_retry           boolean not null default false,
  supports_cancellation    boolean not null default false,
  supports_rollback_reference boolean not null default false,
  requires_human_approval  boolean not null default true,   -- 항상 true 강제(아래 RPC)
  requires_secondary_review boolean not null default false,
  max_payload_size         int not null default 32768,
  timeout_seconds          int not null default 60,
  retry_limit              int not null default 0,
  permission_requirements  jsonb not null default '[]'::jsonb,
  evidence_requirements    jsonb not null default '[]'::jsonb,
  status                   text not null default 'unknown' check (status in ('available_reference','partially_available','dry_run_only','sandbox_only','disabled','connector_unavailable','permission_unverified','deprecated','unknown','insufficient_data')),
  limitations              jsonb not null default '[]'::jsonb,
  idempotency_key          text,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists uq_exec_cap_idem on public.ai_execution_capabilities (idempotency_key) where idempotency_key is not null;
create index if not exists idx_exec_cap_status on public.ai_execution_capabilities (status, capability_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Gateway 이벤트(22종) — Permission/Scope/Risk/DryRun/Sandbox/Gate/
--    ExternalAction/Result/Retry/Cancellation/Rollback/Observation/Closure 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_gateway_events (
  id                   uuid primary key default gen_random_uuid(),
  event_type           text not null check (event_type in ('execution_request_created','execution_request_reviewed','approval_reference_linked','capability_checked','permission_validated','scope_validated','execution_risk_evaluated','dry_run_started_reference','dry_run_completed_reference','sandbox_validated','execution_gate_reviewed','external_action_recorded','execution_result_reported','result_evidence_reviewed','retry_reviewed','cancellation_recorded','rollback_readiness_reviewed','observation_started_reference','observation_completed_reference','unexpected_effect_detected','closure_reviewed','execution_invalidated')),
  execution_request_id uuid not null,
  capability_id        uuid,
  detail               text,
  payload              jsonb,
  actor_id             uuid,
  created_at           timestamptz not null default now()
);
create index if not exists idx_exec_gw_evt on public.ai_execution_gateway_events (event_type, created_at desc);
create index if not exists idx_exec_gw_evt_req on public.ai_execution_gateway_events (execution_request_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Execution Request 생성(요청 ≠ 실행 — draft 강제 시작·production 불가).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_request_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_execution_requests; v_approval uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'title 필수'; end if;
  if coalesce(p_payload->>'execution_mode','') = 'production' then raise exception 'production mode 미지원(초기 Phase 차단)'; end if;
  -- 금지 도메인 13종 명시 차단(테이블 CHECK 밖 값이지만 이유를 명확히 반환).
  if coalesce(p_payload->>'execution_domain','') in ('production_deploy','production_migration','merge','payment','refund','contract_mutation','pricing_mutation','role_mutation','policy_mutation','infrastructure_mutation','data_deletion','secret_rotation','account_deletion') then
    raise exception '금지된 execution domain(자동/통제 실행 대상 아님)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_execution_requests where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'executed', false); end if;
  end if;
  -- 생성 시점 approval reference 는 받지 않음 — 반드시 review RPC 로 사람 연결(자동 승인 금지).
  v_approval := null;
  insert into public.ai_execution_requests (execution_code, request_type, execution_domain, execution_mode, title, execution_summary, requested_action, target_system, target_resource_type, target_resource_id, scope_type, scope_id, requested_parameters, expected_result, expected_evidence, dry_run_required, sandbox_required, observation_required, rollback_required, governance_reference_id, source_agent_id, commitment_id, preconditions, assumptions, unknown_factors, limitations, idempotency_key, input_hash, approval_reference_id, requested_by)
  values (left(coalesce(nullif(p_payload->>'execution_code',''), 'EXEC-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    coalesce(nullif(p_payload->>'request_type',''), 'manual'),
    p_payload->>'execution_domain', p_payload->>'execution_mode',
    left(p_payload->>'title', 200), nullif(p_payload->>'execution_summary',''), nullif(p_payload->>'requested_action',''),
    nullif(p_payload->>'target_system',''), nullif(p_payload->>'target_resource_type',''), left(coalesce(p_payload->>'target_resource_id',''), 200),
    coalesce(nullif(p_payload->>'scope_type',''), 'global'), nullif(p_payload->>'scope_id',''),
    coalesce(p_payload->'requested_parameters', '{}'::jsonb), nullif(p_payload->>'expected_result',''), nullif(p_payload->>'expected_evidence',''),
    coalesce((p_payload->>'dry_run_required')::boolean, true), coalesce((p_payload->>'sandbox_required')::boolean, false),
    coalesce((p_payload->>'observation_required')::boolean, true), coalesce((p_payload->>'rollback_required')::boolean, true),
    nullif(p_payload->>'governance_reference_id','')::uuid, nullif(p_payload->>'source_agent_id','')::uuid, nullif(p_payload->>'commitment_id','')::uuid,
    coalesce(p_payload->'preconditions', '[]'::jsonb), coalesce(p_payload->'assumptions', '[]'::jsonb),
    coalesce(p_payload->'unknown_factors', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    v_idem, nullif(p_payload->>'input_hash',''), v_approval, v_uid)
  returning id into v_id;
  insert into public.ai_execution_gateway_events (event_type, execution_request_id, detail, payload, actor_id)
  values ('execution_request_created', v_id, left(p_payload->>'title', 200) || ' (Request ≠ Execution·draft 시작)', jsonb_build_object('domain', p_payload->>'execution_domain', 'mode', p_payload->>'execution_mode'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'request_is_not_execution', true, 'executed', false, 'auto_approved', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Execution Request 검토 — Approval 연결/게이트/기각(전부 사람).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_request_review(p_request_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_execution_requests; v_next text; v_approval uuid; v_perm int; v_scope int; v_dry int; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','link_approval','mark_ready','reject','cancel','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  select * into v_row from public.ai_execution_requests where id = p_request_id;
  if v_row.id is null then raise exception 'Execution Request 없음(실존 검증 실패)'; end if;
  if v_row.execution_status in ('rejected','cancelled','invalidated','closed_reference') then
    raise exception '종결 상태 재결정 차단(%)', v_row.execution_status;
  end if;
  if v_row.requested_by = v_uid then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'link_approval' then
    v_approval := nullif(p_payload->>'approval_reference_id','')::uuid;
    if v_approval is null then raise exception 'approval_reference_id 필수'; end if;
    -- 사람 승인 Reference 실존 검증(0534 oversight_approved 만 인정 — AI/타 이벤트 불인정).
    if not exists (select 1 from public.ai_orchestration_events where id = v_approval and event_type = 'oversight_approved') then
      raise exception 'approval_missing — 0534 oversight_approved 실존 승인만 인정';
    end if;
    update public.ai_execution_requests set approval_reference_id = v_approval where id = p_request_id;
    v_next := 'approved_reference';
    v_note := v_note || ' (Approval ≠ Execution)';
  elsif p_action = 'mark_ready' then
    -- Controlled Execution Gate(서버 강제): 승인 + Permission/Scope 검증 + 필요 시 Dry Run 선행.
    if v_row.approval_reference_id is null then raise exception 'gate_blocked: approval_missing'; end if;
    select count(*) into v_perm from public.ai_execution_gateway_events
      where execution_request_id = p_request_id and event_type = 'permission_validated' and payload->>'result' = 'permission_verified_reference';
    if v_perm = 0 then raise exception 'gate_blocked: permission_unverified'; end if;
    select count(*) into v_scope from public.ai_execution_gateway_events
      where execution_request_id = p_request_id and event_type = 'scope_validated' and payload->>'result' = 'scope_verified_reference';
    if v_scope = 0 then raise exception 'gate_blocked: scope_unverified'; end if;
    if v_row.dry_run_required then
      select count(*) into v_dry from public.ai_execution_gateway_events
        where execution_request_id = p_request_id and event_type = 'dry_run_completed_reference' and payload->>'dry_run_status' in ('passed_reference','warning_reference');
      if v_dry = 0 then raise exception 'gate_blocked: dry_run_missing'; end if;
    end if;
    if v_row.risk_level in ('high','critical') then raise exception 'gate_blocked: risk_too_high(Critical/High 는 Controlled Execution 대상 아님)'; end if;
    if v_row.risk_level in ('risk_unverified','insufficient_data') then
      -- Risk 평가 이벤트 없이 ready 금지.
      if not exists (select 1 from public.ai_execution_gateway_events where execution_request_id = p_request_id and event_type = 'execution_risk_evaluated') then
        raise exception 'gate_blocked: risk_unverified';
      end if;
    end if;
    v_next := 'ready_for_controlled_execution';
    v_note := v_note || ' (ready ≠ executed)';
  elsif p_action = 'reject' then v_next := 'rejected';
  elsif p_action = 'cancel' then v_next := 'cancelled';
  else v_next := 'invalidated';
  end if;

  update public.ai_execution_requests set execution_status = v_next, reviewed_by = v_uid,
    risk_level = case when p_action = 'mark_ready' and (p_payload->>'risk_level') in ('negligible','low','moderate') then p_payload->>'risk_level' else risk_level end,
    updated_at = now() where id = p_request_id;
  insert into public.ai_execution_gateway_events (event_type, execution_request_id, detail, payload, actor_id)
  values (case when p_action = 'link_approval' then 'approval_reference_linked' when p_action = 'invalidate' then 'execution_invalidated' when p_action = 'mark_ready' then 'execution_gate_reviewed' else 'execution_request_reviewed' end,
    p_request_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_request_id, 'status', v_next, 'executed', false, 'auto_approved', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Capability 기록(사람) — 금지 도메인 차단·사람 승인 필수 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_capability_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_execution_capabilities;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  if coalesce(p_payload->>'capability_code','') = '' then raise exception 'capability_code 필수'; end if;
  if coalesce(p_payload->>'capability_domain','') in ('production_deploy','production_migration','merge','payment','refund','contract_mutation','pricing_mutation','role_mutation','policy_mutation','infrastructure_mutation','data_deletion','secret_rotation','account_deletion') then
    raise exception '금지된 capability domain';
  end if;
  if coalesce(p_payload->>'execution_mode','') = 'production' then raise exception 'production mode capability 미지원'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_execution_capabilities where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id); end if;
  end if;
  insert into public.ai_execution_capabilities (capability_code, capability_domain, connector_type, action_type, execution_mode, environment_scope, supports_dry_run, supports_sandbox, supports_idempotency, supports_retry, supports_cancellation, supports_rollback_reference, requires_human_approval, requires_secondary_review, max_payload_size, timeout_seconds, retry_limit, permission_requirements, evidence_requirements, status, limitations, idempotency_key, created_by)
  values (left(p_payload->>'capability_code', 80), p_payload->>'capability_domain',
    coalesce(nullif(p_payload->>'connector_type',''), 'none'), nullif(p_payload->>'action_type',''),
    p_payload->>'execution_mode', coalesce(nullif(p_payload->>'environment_scope',''), 'non_production'),
    coalesce((p_payload->>'supports_dry_run')::boolean, false), coalesce((p_payload->>'supports_sandbox')::boolean, false),
    coalesce((p_payload->>'supports_idempotency')::boolean, false), coalesce((p_payload->>'supports_retry')::boolean, false),
    coalesce((p_payload->>'supports_cancellation')::boolean, false), coalesce((p_payload->>'supports_rollback_reference')::boolean, false),
    true,   -- requires_human_approval 항상 true(자동 승인 금지)
    coalesce((p_payload->>'requires_secondary_review')::boolean, false),
    least(greatest(coalesce((p_payload->>'max_payload_size')::int, 32768), 1024), 32768),
    least(greatest(coalesce((p_payload->>'timeout_seconds')::int, 60), 1), 600),
    least(greatest(coalesce((p_payload->>'retry_limit')::int, 0), 0), 5),
    coalesce(p_payload->'permission_requirements', '[]'::jsonb), coalesce(p_payload->'evidence_requirements', '[]'::jsonb),
    coalesce(nullif(p_payload->>'status',''), 'unknown'), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'requires_human_approval', true, 'connector_executed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Gateway 이벤트 기록(22종) — 실제 Connector 실행 없음(Reference 기록만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_event_record(p_kind text, p_request_id uuid, p_reason text, p_payload jsonb, p_capability_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_row public.ai_execution_requests; v_next text := null; v_results int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('capability_checked','permission_validated','scope_validated','execution_risk_evaluated','dry_run_started_reference','dry_run_completed_reference','sandbox_validated','execution_gate_reviewed','external_action_recorded','execution_result_reported','result_evidence_reviewed','retry_reviewed','cancellation_recorded','rollback_readiness_reviewed','observation_started_reference','observation_completed_reference','unexpected_effect_detected','closure_reviewed') then
    raise exception '허용되지 않는 kind(생성/검토/승인/무효화는 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  select * into v_row from public.ai_execution_requests where id = p_request_id;
  if v_row.id is null then raise exception 'Execution Request 없음(실존 검증 실패)'; end if;
  if v_row.execution_status in ('rejected','cancelled','invalidated','closed_reference') then raise exception '종결 상태 요청에 기록 불가'; end if;
  if p_capability_id is not null and not exists (select 1 from public.ai_execution_capabilities where id = p_capability_id) then
    raise exception 'Capability 없음(실존 검증 실패)';
  end if;

  -- 정직성 게이트 1: Permission/Scope 결과 whitelist.
  if p_kind = 'permission_validated' and coalesce(p_payload->>'result','') not in ('permission_verified_reference','partially_verified','permission_unverified','permission_denied_reference','secondary_approval_required','sensitive_scope_detected','secret_scope_detected','insufficient_data') then
    raise exception '허용되지 않는 permission result';
  end if;
  if p_kind = 'scope_validated' and coalesce(p_payload->>'result','') not in ('scope_verified_reference','partially_verified','scope_unverified','scope_mismatch','cross_enterprise_blocked','cross_brand_blocked','cross_store_blocked','production_scope_blocked','insufficient_data') then
    raise exception '허용되지 않는 scope result';
  end if;
  -- 정직성 게이트 2: Dry Run 상태 whitelist + 수행 없는 passed 금지(evidence 필수).
  if p_kind = 'dry_run_completed_reference' then
    if coalesce(p_payload->>'dry_run_status','') not in ('passed_reference','warning_reference','blocked_reference','failed_reference','dry_run_unverified','insufficient_data') then
      raise exception '허용되지 않는 dry_run_status';
    end if;
    if p_payload->>'dry_run_status' in ('passed_reference','warning_reference') and (p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0) then
      raise exception 'Evidence 없는 Dry Run passed 금지(실행하지 않은 Dry Run 을 passed 로 표시하지 않는다)';
    end if;
  end if;
  -- 정직성 게이트 3: External Action 은 ready 상태에서만(승인+검증 선행 — 자동 실행 없음).
  if p_kind = 'external_action_recorded' then
    if v_row.execution_status <> 'ready_for_controlled_execution' then
      raise exception 'gate_blocked: ready_for_controlled_execution 상태에서만 External Action Reference 기록 가능';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 External Action 기록 금지(execution_unverified)';
    end if;
    if length(coalesce(p_payload->>'external_reference_url','')) > 500 or length(coalesce(p_payload->>'external_reference_id','')) > 200 then
      raise exception 'External Reference 길이 초과';
    end if;
    v_next := 'execution_reported_reference';
  end if;
  -- 정직성 게이트 4: 결과/Closure 는 Evidence 필수 + 선행 이벤트 검증.
  if p_kind = 'execution_result_reported' and (p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0) then
    raise exception 'Evidence 없는 결과 보고 금지(result_unverified)';
  end if;
  if p_kind = 'closure_reviewed' then
    if coalesce(p_payload->>'closure','') not in ('closure_pending','closed_reference','closed_with_limitation','result_unverified','observation_pending','rollback_review_required','rejected_closure','insufficient_data') then
      raise exception '허용되지 않는 closure result';
    end if;
    if p_payload->>'closure' in ('closed_reference','closed_with_limitation') then
      select count(*) into v_results from public.ai_execution_gateway_events
        where execution_request_id = p_request_id and event_type = 'execution_result_reported';
      if v_results = 0 then raise exception '결과 보고 없는 Closure 금지(result_unverified)'; end if;
      if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
        raise exception 'Evidence 없는 Closure 금지';
      end if;
      v_next := 'closed_reference';
    end if;
  end if;
  if p_kind = 'retry_reviewed' and coalesce(p_payload->>'result','') not in ('retry_safe_reference','manual_retry_required','retry_blocked','idempotency_unverified','duplicate_side_effect_risk','retry_limit_reached','insufficient_data') then
    raise exception '허용되지 않는 retry result';
  end if;
  -- Risk 평가 이벤트는 request.risk_level 갱신(whitelist).
  if p_kind = 'execution_risk_evaluated' then
    if coalesce(p_payload->>'risk_level','') not in ('negligible','low','moderate','high','critical','risk_unverified','insufficient_data') then
      raise exception '허용되지 않는 risk_level';
    end if;
    update public.ai_execution_requests set risk_level = p_payload->>'risk_level', updated_at = now() where id = p_request_id;
  end if;
  if p_kind = 'rollback_readiness_reviewed' then
    if coalesce(p_payload->>'result','') not in ('rollback_ready_reference','partially_ready','rollback_unverified','rollback_unavailable','irreversible_action','insufficient_data') then
      raise exception '허용되지 않는 rollback result';
    end if;
    update public.ai_execution_requests set reversibility_status = p_payload->>'result', updated_at = now() where id = p_request_id;
  end if;
  if p_kind = 'observation_started_reference' then v_next := 'observation_pending'; end if;

  if v_next is not null then
    update public.ai_execution_requests set execution_status = v_next, updated_at = now() where id = p_request_id;
  end if;

  insert into public.ai_execution_gateway_events (event_type, execution_request_id, capability_id, detail, payload, actor_id)
  values (p_kind, p_request_id, p_capability_id,
    left(p_reason, 200) || case
      when p_kind = 'external_action_recorded' then ' (External Reference ≠ Verified Result·Connector 실행 아님)'
      when p_kind = 'execution_result_reported' then ' (HTTP Success ≠ Business Success)'
      when p_kind = 'dry_run_completed_reference' then ' (Dry Run ≠ Real Execution)'
      when p_kind = 'closure_reviewed' then ' (Closure ≠ Outcome Success)'
      when p_kind = 'observation_completed_reference' then ' (Observation ≠ Causality)'
      when p_kind = 'retry_reviewed' then ' (자동 재시도 없음)'
      when p_kind = 'rollback_readiness_reviewed' then ' (Rollback Plan ≠ Rollback Success·자동 Rollback 없음)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'connector_executed', false, 'auto_retry', false, 'auto_rollback', false, 'production_applied', false, 'human_closure_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_requests(p_status text default null, p_limit int default 100)
returns setof public.ai_execution_requests language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_requests r
    where (p_status is null or r.execution_status = p_status)
    order by r.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_execution_capabilities(p_limit int default 100)
returns setof public.ai_execution_capabilities language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_capabilities order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_execution_gateway_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'requests', jsonb_build_object(
      'total', (select count(*) from public.ai_execution_requests),
      'draft', (select count(*) from public.ai_execution_requests where execution_status = 'draft'),
      'pending_review', (select count(*) from public.ai_execution_requests where execution_status = 'pending_review'),
      'approval_missing', (select count(*) from public.ai_execution_requests where approval_reference_id is null and execution_status not in ('rejected','cancelled','invalidated','closed_reference')),
      'approved_reference', (select count(*) from public.ai_execution_requests where execution_status = 'approved_reference'),
      'ready', (select count(*) from public.ai_execution_requests where execution_status = 'ready_for_controlled_execution'),
      'execution_reported', (select count(*) from public.ai_execution_requests where execution_status = 'execution_reported_reference'),
      'observation_pending', (select count(*) from public.ai_execution_requests where execution_status = 'observation_pending'),
      'closed_reference', (select count(*) from public.ai_execution_requests where execution_status = 'closed_reference'),
      'rejected', (select count(*) from public.ai_execution_requests where execution_status = 'rejected'),
      'risk_unverified', (select count(*) from public.ai_execution_requests where risk_level in ('risk_unverified','insufficient_data')),
      'rollback_unverified', (select count(*) from public.ai_execution_requests where reversibility_status = 'rollback_unverified')
    ),
    'capabilities', jsonb_build_object(
      'total', (select count(*) from public.ai_execution_capabilities),
      'available_reference', (select count(*) from public.ai_execution_capabilities where status = 'available_reference'),
      'dry_run_only', (select count(*) from public.ai_execution_capabilities where status = 'dry_run_only'),
      'disabled', (select count(*) from public.ai_execution_capabilities where status = 'disabled'),
      'connector_unavailable', (select count(*) from public.ai_execution_capabilities where status = 'connector_unavailable'),
      'unknown', (select count(*) from public.ai_execution_capabilities where status = 'unknown')
    ),
    'gateway_events', jsonb_build_object(
      'total', (select count(*) from public.ai_execution_gateway_events),
      'permission_validated', (select count(*) from public.ai_execution_gateway_events where event_type = 'permission_validated'),
      'scope_validated', (select count(*) from public.ai_execution_gateway_events where event_type = 'scope_validated'),
      'dry_runs_completed', (select count(*) from public.ai_execution_gateway_events where event_type = 'dry_run_completed_reference'),
      'external_actions', (select count(*) from public.ai_execution_gateway_events where event_type = 'external_action_recorded'),
      'results_reported', (select count(*) from public.ai_execution_gateway_events where event_type = 'execution_result_reported'),
      'unexpected_effects', (select count(*) from public.ai_execution_gateway_events where event_type = 'unexpected_effect_detected'),
      'closures', (select count(*) from public.ai_execution_gateway_events where event_type = 'closure_reviewed')
    ),
    -- 기존 원본 실측(전부 읽기 전용 — 원본 미변경):
    'execution_actuals', jsonb_build_object(
      'execution_plans_0505', (select count(*) from public.ai_execution_plans),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'commitment_events_0520', (select count(*) from public.ai_commitment_events),
      'observations_0506', (select count(*) from public.ai_post_change_observations),
      'reliability_indicators_0507', (select count(*) from public.ai_reliability_indicators),
      'incidents_open_0502', (select count(*) from public.ai_incidents where status not in ('resolved','false_positive','closed')),
      'recovery_candidates_0502', (select count(*) from public.ai_recovery_candidates),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'oversight_approvals_0534', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_approved'),
      'governance_approvals_0496', (select count(*) from public.ai_governance_events where event_type = 'approval')
    ),
    'runtime_unavailable', jsonb_build_array('agent_runtime','runtime_scheduler','worker_queue','generic_connector_registry','slack_connector','jira_connector','linear_connector','github_connector','sandbox_environment'),   -- 원본 없음(실측)
    'no_auto_execution', true, 'no_auto_approval', true, 'no_auto_connector_call', true, 'no_auto_retry', true, 'no_auto_rollback', true,
    'no_production_mode', true, 'no_auto_merge_deploy_migration', true,
    'approval_is_not_execution', true, 'dry_run_is_not_real_execution', true, 'external_reference_is_not_verified_result', true,
    'http_success_is_not_business_success', true, 'closure_is_not_outcome_success', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- 이름 주의: admin_execution_audit(uuid,int)는 0505 가 이미 사용 — gateway 전용 이름 사용.
create or replace function public.admin_execution_gateway_audit(p_limit int default 100)
returns setof public.ai_execution_gateway_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_execution_gateway_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_execution_requests enable row level security;
alter table public.ai_execution_capabilities enable row level security;
alter table public.ai_execution_gateway_events enable row level security;

comment on table public.ai_execution_requests is 'AI-OPS-32 — Execution Request(요청 ≠ 실행·draft 강제 시작·production mode 차단·금지 도메인 13종 차단·종결 재결정 차단).';
comment on table public.ai_execution_capabilities is 'AI-OPS-32 — Capability Registry(사람 기록 — Connector 실존과 동일하지 않음·requires_human_approval 항상 true).';
comment on table public.ai_execution_gateway_events is 'AI-OPS-32 — Gateway Audit(22종 whitelist — Permission/Scope/Risk/DryRun/Sandbox/Gate/ExternalAction/Result/Retry/Cancellation/Rollback/Observation/Closure 통합·RPC 내부 Connector 실행 없음).';
