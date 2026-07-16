-- 0536_admin_ai_connector_runtime_control.sql
-- Phase AI-OPS-33 — Enterprise Connector Governance, Approved Automation Lifecycle &
-- Supervised Runtime Control Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * Connector 실측(코드): Resend 이메일 dispatch / Kakao 메시지 / Push / PayApp 결제(웹훅
--     payapp-feedback + payapp_webhook_events.event_key UNIQUE 멱등성) / PDF 생성 /
--     admin DB Edge Function. Gmail·Slack·GitHub·Jira·Linear·Calendar·Drive·Vercel·
--     Supabase Mgmt API·Toss·Stripe 연동 없음.
--   * Runtime 실측: pg_cron(0337/0338/0340) · cron worker(process-scheduled-releases,
--     x-cron-secret) · inbound webhook consumer(payapp-feedback) · advisory lock(0058/0060/
--     0064) · idempotency 저장 광범위(05xx 29파일). 범용 Worker/Queue/DLQ/Heartbeat/Lease/
--     Cancellation Token/Durable Execution 없음.
--   * Governance 실측: ai_execution_requests/capabilities/gateway_events(0535 —
--     ready_for_controlled_execution 게이트), ai_orchestration_events(0534 —
--     oversight_approved 사람 승인). 전부 읽기 전용 참조 — 원본 미변경.
--   신규 테이블 5개(definitions/instances/automations/sessions/events) —
--   Checkpoint/Pause/Cancellation/Timeout/Action Attempt/Response/Idempotency/Retry/
--   Cleanup/Observation/Closure 검토는 전부 이벤트(payload jsonb)로 통합(별도 테이블 없음).
--
-- 실행 정직성(전부 강제):
--   * Connector Registry ≠ Availability ≠ Permission. Approval ≠ Runtime Start.
--   * Runtime Start ≠ Action Completion ≠ Result Verification. HTTP 2xx ≠ Business Success.
--   * Draft Created ≠ Message Sent. Pause/Cancel Requested ≠ Paused/Cancelled.
--   * Timeout ≠ 실패 확정. Retry ≠ Recovery. Closure ≠ Outcome.
--   * Credential/Secret/Token 원문 저장·반환 금지(Reference 만).
--   * RPC 내부 실제 Connector 호출/발송/생성 없음 — 전부 Reference 기록.
--   * 자동 이메일/Slack/Ticket/Issue/PR/재시도/Rollback/무인 장기 실행 없음.
--   * Unknown 유지(null→0 금지). Trigger 없음 · 삭제 RPC 금지 · 종결 재결정 차단.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Connector Definition(정의 ≠ 실제 연결 성공·Credential 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_connector_definitions (
  id                       uuid primary key default gen_random_uuid(),
  connector_code           text not null unique,
  connector_name           text not null,
  connector_domain         text not null check (connector_domain in ('email','messaging','source_control','issue_tracking','calendar','document_storage','deployment_read','database_read','analytics_read','monitoring_read','notification_draft','report_export','document_generation','webhook_reference','custom_reference')),
  provider                 text not null default 'none' check (provider in ('resend','kakao','push_fcm','payapp_webhook','pdf_internal','supabase_edge','manual','none')),
  supported_action_types   jsonb not null default '[]'::jsonb,
  supported_execution_modes jsonb not null default '[]'::jsonb,
  supports_read            boolean not null default false,
  supports_draft           boolean not null default false,
  supports_write           boolean not null default false,   -- write 도 draft/reference 계열만(금지 도메인은 테이블 CHECK 밖)
  supports_dry_run         boolean not null default false,
  supports_sandbox         boolean not null default false,
  supports_idempotency     boolean not null default false,
  supports_retry           boolean not null default false,
  supports_pause           boolean not null default false,
  supports_cancellation    boolean not null default false,
  supports_cleanup         boolean not null default false,
  supports_rollback_reference boolean not null default false,
  requires_human_approval  boolean not null default true,    -- 항상 true 강제(RPC)
  requires_secondary_approval boolean not null default false,
  requires_sensitive_data_access boolean not null default false,
  requires_secret_access   boolean not null default false,
  max_payload_size         int not null default 32768,
  timeout_seconds          int not null default 60,
  retry_limit              int not null default 0,
  status                   text not null default 'unknown' check (status in ('available_reference','partially_available','read_only','draft_only','dry_run_only','sandbox_only','supervised_only','disabled','connector_unavailable','permission_unverified','scope_unverified','credential_unverified','health_unverified','rate_limited','deprecated','unknown','insufficient_data')),
  limitations              jsonb not null default '[]'::jsonb,
  metadata                 jsonb not null default '{}'::jsonb,
  idempotency_key          text,
  created_by               uuid,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create unique index if not exists uq_conn_def_idem on public.ai_connector_definitions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_conn_def_status on public.ai_connector_definitions (status, connector_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Connector Instance(Credential 원문 저장 금지 — Reference 만).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_connector_instances (
  id                        uuid primary key default gen_random_uuid(),
  connector_definition_id   uuid not null,
  instance_code             text not null unique,
  environment_scope         text not null default 'non_production' check (environment_scope in ('non_production','sandbox','reference_only')),
  scope_type                text not null default 'global' check (scope_type in ('global','enterprise','brand','store','user')),
  scope_id                  text,
  connection_status         text not null default 'connector_status_unknown' check (connection_status in ('available_reference','partially_available','connector_unavailable','connector_status_unknown','rate_limited','disabled')),
  permission_status         text not null default 'connector_permission_unverified' check (permission_status in ('permission_verified_reference','partially_verified','connector_permission_unverified','permission_denied_reference')),
  scope_status              text not null default 'connector_scope_unverified' check (scope_status in ('scope_verified_reference','partially_verified','connector_scope_unverified','scope_mismatch')),
  credential_reference_type text not null default 'none' check (credential_reference_type in ('env_reference','vault_reference','none')),
  credential_reference_id   text,   -- Reference 만 — Secret/Token 원문 금지(RPC 에서 차단)
  health_status             text not null default 'health_unverified' check (health_status in ('healthy_reference','degraded_reference','health_unverified','unknown')),
  last_verified_at          timestamptz,
  disabled_reason           text,
  limitations               jsonb not null default '[]'::jsonb,
  metadata                  jsonb not null default '{}'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_conn_inst_idem on public.ai_connector_instances (idempotency_key) where idempotency_key is not null;
create index if not exists idx_conn_inst_def on public.ai_connector_instances (connector_definition_id, connection_status);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Automation Definition(정의 ≠ 실행 요청 ≠ 승인 ≠ 실행 권한).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_automation_definitions (
  id                        uuid primary key default gen_random_uuid(),
  automation_code           text not null unique,
  title                     text not null,
  description               text,
  execution_domain          text not null check (execution_domain in ('read_only_query','evidence_collection','report_generation','document_draft','email_draft','message_draft','ticket_draft','issue_draft','calendar_draft','non_production_validation','sandbox_test_reference','manual_external_action_reference','supervised_non_production_action_reference')),
  connector_definition_id   uuid,
  capability_id             uuid,   -- 0535 ai_execution_capabilities 참조(실존 검증)
  action_type               text,
  execution_mode            text not null check (execution_mode in ('reference_only','read_only','draft_only','dry_run','sandbox','non_production_controlled','manual_external_reference')),
  allowed_scope_types       jsonb not null default '["global"]'::jsonb,
  allowed_environment_scopes jsonb not null default '["non_production"]'::jsonb,
  dry_run_required          boolean not null default true,
  sandbox_required          boolean not null default false,
  observation_required      boolean not null default true,
  rollback_reference_required boolean not null default true,
  cleanup_required          boolean not null default false,
  max_execution_duration_seconds int not null default 60,
  max_retry_count           int not null default 0,
  evidence_requirements     jsonb not null default '[]'::jsonb,
  preconditions             jsonb not null default '[]'::jsonb,
  blocked_conditions        jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  status                    text not null default 'draft' check (status in ('draft','pending_review','approved_reference','partially_supported','dry_run_only','sandbox_only','supervised_only','disabled','invalidated','deprecated','unsupported','insufficient_data')),
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_auto_def_idem on public.ai_automation_definitions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_auto_def_status on public.ai_automation_definitions (status, execution_domain);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Supervised Runtime Session(외부 실행 성공 의미 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_execution_sessions (
  id                        uuid primary key default gen_random_uuid(),
  runtime_session_code      text not null,
  execution_request_id      uuid not null,   -- 0535 실존 + ready 검증
  automation_definition_id  uuid not null,
  connector_instance_id     uuid,
  capability_id             uuid,
  approval_reference_id     uuid not null,   -- 0534 oversight_approved 실존 검증
  gate_reference_id         uuid,            -- 0535 execution_gate_reviewed 이벤트 실존 검증
  session_status            text not null default 'draft' check (session_status in ('draft','pending_review','approval_missing','gate_missing','connector_unavailable','permission_unverified','scope_unverified','precondition_missing','ready_reference','start_requested_reference','started_reference','checkpoint_reference','pause_requested','paused_reference','cancellation_requested','cancelled_reference','timeout_reference','action_reported_reference','result_verification_pending','result_unverified','observation_pending','closure_pending','completed_reference','failed_reference','invalidated','insufficient_data')),
  execution_mode            text not null check (execution_mode in ('reference_only','read_only','draft_only','dry_run','sandbox','non_production_controlled','manual_external_reference')),
  environment_scope         text not null default 'non_production' check (environment_scope in ('non_production','sandbox','reference_only')),
  target_resource_type      text,
  target_resource_id        text,
  input_hash                text,
  idempotency_key           text,
  runtime_preconditions     jsonb not null default '{}'::jsonb,
  checkpoint_count          int not null default 0,
  supervised_by             uuid,   -- Human Supervisor 필수(preconditions review 에서 지정)
  started_by                uuid,
  started_at                timestamptz,
  last_checkpoint_at        timestamptz,
  pause_requested_at        timestamptz,
  paused_at                 timestamptz,
  cancellation_requested_at timestamptz,
  cancelled_at              timestamptz,
  completed_reference_at    timestamptz,
  failed_reference_at       timestamptz,
  timeout_reference_at      timestamptz,
  cleanup_status            text not null default 'cleanup_not_required' check (cleanup_status in ('cleanup_not_required','cleanup_ready_reference','cleanup_pending','cleanup_unverified','cleanup_permission_missing','orphan_resource_candidate','insufficient_data')),
  result_verification_status text not null default 'result_verification_pending' check (result_verification_status in ('result_verification_pending','evidence_partial','response_only','action_unverified','result_unverified','verified_reference')),
  observation_status        text not null default 'runtime_observation_pending' check (observation_status in ('runtime_observation_pending','runtime_observation_ready_reference','runtime_observation_in_progress_reference','runtime_observation_completed_reference','unexpected_runtime_effect_candidate')),
  closure_status            text not null default 'closure_pending' check (closure_status in ('closure_pending','observation_pending','cleanup_pending','rollback_review_required','closed_reference','closed_with_limitation','rejected')),
  limitations               jsonb not null default '[]'::jsonb,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_runtime_sess_idem on public.ai_runtime_execution_sessions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_runtime_sess_status on public.ai_runtime_execution_sessions (session_status, created_at desc);
create index if not exists idx_runtime_sess_req on public.ai_runtime_execution_sessions (execution_request_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Runtime 이벤트(30종) — Checkpoint/Pause/Cancel/Timeout/Attempt/Response/
--    Idempotency/Retry/Cleanup/Observation/Closure 검토 전부 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_execution_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('connector_definition_created','connector_definition_reviewed','connector_instance_registered','connector_instance_reviewed','connector_permission_reviewed','connector_scope_reviewed','connector_health_reviewed','automation_definition_created','automation_definition_reviewed','runtime_session_created','runtime_preconditions_reviewed','runtime_start_requested_reference','runtime_started_reference','runtime_checkpoint_recorded','pause_requested','pause_confirmed_reference','cancellation_requested','cancellation_confirmed_reference','timeout_recorded','connector_action_attempt_recorded','connector_response_recorded','action_result_reviewed','idempotency_reviewed','retry_reviewed','cleanup_reviewed','runtime_observation_started_reference','runtime_observation_completed_reference','unexpected_runtime_effect_detected','runtime_closure_reviewed','runtime_session_invalidated')),
  runtime_session_id  uuid,
  connector_definition_id uuid,
  connector_instance_id uuid,
  automation_definition_id uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_runtime_evt on public.ai_runtime_execution_events (event_type, created_at desc);
create index if not exists idx_runtime_evt_sess on public.ai_runtime_execution_events (runtime_session_id, created_at desc);

-- Credential/Secret/Token 원문 차단 공용 검사.
create or replace function public._runtime_reject_secret_payload(p jsonb)
returns void language plpgsql immutable as $$
begin
  if p ? 'secret' or p ? 'token' or p ? 'api_key' or p ? 'apikey' or p ? 'password' or p ? 'credential' or p ? 'private_key' then
    raise exception 'Credential/Secret/Token 원문 저장 금지(Reference 만 허용)';
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Connector Definition/Instance 기록(사람 — Registry ≠ Availability).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_connector_definition_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_connector_definitions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(p_payload->>'connector_code','') = '' then raise exception 'connector_code 필수'; end if;
  if coalesce(p_payload->>'connector_domain','') in ('payment_write','contract_write','pricing_write','settlement_write','production_deployment_write','production_database_write','infrastructure_write','identity_write','secret_write','policy_write','destructive_storage_write') then
    raise exception '금지된 connector domain(Write 계열 비활성)';
  end if;
  if coalesce((p_payload->>'requires_secret_access')::boolean, false) then
    raise exception 'Secret 접근 요구 Connector 등록 차단(secret_scope 차단)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_connector_definitions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id); end if;
  end if;
  insert into public.ai_connector_definitions (connector_code, connector_name, connector_domain, provider, supported_action_types, supported_execution_modes, supports_read, supports_draft, supports_write, supports_dry_run, supports_sandbox, supports_idempotency, supports_retry, supports_pause, supports_cancellation, supports_cleanup, supports_rollback_reference, requires_human_approval, requires_secondary_approval, requires_sensitive_data_access, requires_secret_access, max_payload_size, timeout_seconds, retry_limit, status, limitations, metadata, idempotency_key, created_by)
  values (left(p_payload->>'connector_code', 80), left(coalesce(nullif(p_payload->>'connector_name',''), p_payload->>'connector_code'), 120),
    p_payload->>'connector_domain', coalesce(nullif(p_payload->>'provider',''), 'none'),
    coalesce(p_payload->'supported_action_types', '[]'::jsonb), coalesce(p_payload->'supported_execution_modes', '[]'::jsonb),
    coalesce((p_payload->>'supports_read')::boolean, false), coalesce((p_payload->>'supports_draft')::boolean, false), coalesce((p_payload->>'supports_write')::boolean, false),
    coalesce((p_payload->>'supports_dry_run')::boolean, false), coalesce((p_payload->>'supports_sandbox')::boolean, false), coalesce((p_payload->>'supports_idempotency')::boolean, false),
    coalesce((p_payload->>'supports_retry')::boolean, false), coalesce((p_payload->>'supports_pause')::boolean, false), coalesce((p_payload->>'supports_cancellation')::boolean, false),
    coalesce((p_payload->>'supports_cleanup')::boolean, false), coalesce((p_payload->>'supports_rollback_reference')::boolean, false),
    true, coalesce((p_payload->>'requires_secondary_approval')::boolean, false), coalesce((p_payload->>'requires_sensitive_data_access')::boolean, false), false,
    least(greatest(coalesce((p_payload->>'max_payload_size')::int, 32768), 1024), 32768),
    least(greatest(coalesce((p_payload->>'timeout_seconds')::int, 60), 1), 600),
    least(greatest(coalesce((p_payload->>'retry_limit')::int, 0), 0), 5),
    coalesce(nullif(p_payload->>'status',''), 'unknown'), coalesce(p_payload->'limitations', '[]'::jsonb), coalesce(p_payload->'metadata', '{}'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_runtime_execution_events (event_type, connector_definition_id, detail, payload, actor_id)
  values ('connector_definition_created', v_id, left(p_payload->>'connector_code', 80) || ' (Definition ≠ Availability ≠ Permission)', jsonb_build_object('domain', p_payload->>'connector_domain'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'definition_is_not_availability', true, 'connector_executed', false);
end $$;

create or replace function public.admin_connector_instance_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_def uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_connector_instances;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_def := nullif(p_payload->>'connector_definition_id','')::uuid;
  if v_def is null or not exists (select 1 from public.ai_connector_definitions where id = v_def) then
    raise exception 'Connector Definition 없음(실존 검증 실패)';
  end if;
  if coalesce(p_payload->>'instance_code','') = '' then raise exception 'instance_code 필수'; end if;
  if coalesce(p_payload->>'environment_scope','') = 'production' then raise exception 'production environment 차단'; end if;
  if length(coalesce(p_payload->>'credential_reference_id','')) > 120 then raise exception 'credential reference 길이 초과'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_connector_instances where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id); end if;
  end if;
  insert into public.ai_connector_instances (connector_definition_id, instance_code, environment_scope, scope_type, scope_id, credential_reference_type, credential_reference_id, limitations, metadata, idempotency_key, created_by)
  values (v_def, left(p_payload->>'instance_code', 80),
    coalesce(nullif(p_payload->>'environment_scope',''), 'non_production'),
    coalesce(nullif(p_payload->>'scope_type',''), 'global'), nullif(p_payload->>'scope_id',''),
    coalesce(nullif(p_payload->>'credential_reference_type',''), 'none'), nullif(p_payload->>'credential_reference_id',''),
    coalesce(p_payload->'limitations', '[]'::jsonb), coalesce(p_payload->'metadata', '{}'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_runtime_execution_events (event_type, connector_definition_id, connector_instance_id, detail, payload, actor_id)
  values ('connector_instance_registered', v_def, v_id, left(p_payload->>'instance_code', 80) || ' (연결/권한/자격증명 전부 unverified 시작)', jsonb_build_object('scope_type', coalesce(nullif(p_payload->>'scope_type',''), 'global')), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'connection_status', 'connector_status_unknown', 'permission_status', 'connector_permission_unverified', 'credential_stored', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Automation Definition 기록(정의 ≠ 실행 요청 ≠ 승인).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_automation_definition_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_conn uuid; v_cap uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_automation_definitions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if coalesce(p_payload->>'automation_code','') = '' or coalesce(p_payload->>'title','') = '' then raise exception 'automation_code/title 필수'; end if;
  if coalesce(p_payload->>'execution_mode','') = 'production' then raise exception 'production mode 미지원'; end if;
  if coalesce(p_payload->>'execution_domain','') in ('production_deploy','production_migration','merge','payment','refund','contract_mutation','pricing_mutation','settlement_mutation','role_mutation','policy_mutation','infrastructure_mutation','data_deletion','secret_rotation','account_deletion','account_creation','hr_action') then
    raise exception '금지된 execution domain';
  end if;
  v_conn := nullif(p_payload->>'connector_definition_id','')::uuid;
  if v_conn is not null and not exists (select 1 from public.ai_connector_definitions where id = v_conn) then raise exception 'Connector Definition 없음(실존 검증 실패)'; end if;
  v_cap := nullif(p_payload->>'capability_id','')::uuid;
  if v_cap is not null and not exists (select 1 from public.ai_execution_capabilities where id = v_cap) then raise exception 'Capability(0535) 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_automation_definitions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id); end if;
  end if;
  insert into public.ai_automation_definitions (automation_code, title, description, execution_domain, connector_definition_id, capability_id, action_type, execution_mode, allowed_scope_types, allowed_environment_scopes, dry_run_required, sandbox_required, observation_required, rollback_reference_required, cleanup_required, max_execution_duration_seconds, max_retry_count, evidence_requirements, preconditions, blocked_conditions, limitations, idempotency_key, created_by)
  values (left(p_payload->>'automation_code', 80), left(p_payload->>'title', 200), nullif(p_payload->>'description',''),
    p_payload->>'execution_domain', v_conn, v_cap, nullif(p_payload->>'action_type',''), p_payload->>'execution_mode',
    coalesce(p_payload->'allowed_scope_types', '["global"]'::jsonb), coalesce(p_payload->'allowed_environment_scopes', '["non_production"]'::jsonb),
    coalesce((p_payload->>'dry_run_required')::boolean, true), coalesce((p_payload->>'sandbox_required')::boolean, false),
    coalesce((p_payload->>'observation_required')::boolean, true), coalesce((p_payload->>'rollback_reference_required')::boolean, true),
    coalesce((p_payload->>'cleanup_required')::boolean, false),
    least(greatest(coalesce((p_payload->>'max_execution_duration_seconds')::int, 60), 1), 600),
    least(greatest(coalesce((p_payload->>'max_retry_count')::int, 0), 0), 5),
    coalesce(p_payload->'evidence_requirements', '[]'::jsonb), coalesce(p_payload->'preconditions', '[]'::jsonb),
    coalesce(p_payload->'blocked_conditions', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_runtime_execution_events (event_type, automation_definition_id, connector_definition_id, detail, payload, actor_id)
  values ('automation_definition_created', v_id, v_conn, left(p_payload->>'title', 200) || ' (Definition ≠ Execution Request ≠ 승인 — draft 시작)', jsonb_build_object('domain', p_payload->>'execution_domain'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'definition_is_not_execution_request', true, 'approved_is_not_runtime_approval', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Runtime Session 생성 — 0535 gate ready + 0534 승인 실존 없이는 생성 불가.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_session_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_req public.ai_execution_requests; v_auto public.ai_automation_definitions; v_inst uuid; v_approval uuid; v_gate uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_runtime_execution_sessions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_req from public.ai_execution_requests where id = nullif(p_payload->>'execution_request_id','')::uuid;
  if v_req.id is null then raise exception 'Execution Request(0535) 없음(실존 검증 실패)'; end if;
  if v_req.execution_status <> 'ready_for_controlled_execution' then
    raise exception 'gate_missing: Execution Request 가 ready_for_controlled_execution 상태가 아님';
  end if;
  v_approval := nullif(p_payload->>'approval_reference_id','')::uuid;
  if v_approval is null or not exists (select 1 from public.ai_orchestration_events where id = v_approval and event_type = 'oversight_approved') then
    raise exception 'approval_missing: 0534 oversight_approved 실존 승인 필수';
  end if;
  select * into v_auto from public.ai_automation_definitions where id = nullif(p_payload->>'automation_definition_id','')::uuid;
  if v_auto.id is null then raise exception 'Automation Definition 없음(실존 검증 실패)'; end if;
  if v_auto.status in ('disabled','invalidated','deprecated','unsupported') then raise exception 'Automation Definition 비활성 상태'; end if;
  v_inst := nullif(p_payload->>'connector_instance_id','')::uuid;
  if v_inst is not null and not exists (select 1 from public.ai_connector_instances where id = v_inst) then raise exception 'Connector Instance 없음(실존 검증 실패)'; end if;
  v_gate := nullif(p_payload->>'gate_reference_id','')::uuid;
  if v_gate is not null and not exists (select 1 from public.ai_execution_gateway_events where id = v_gate and event_type = 'execution_gate_reviewed') then
    raise exception 'Gate Reference(0535 execution_gate_reviewed) 없음(실존 검증 실패)';
  end if;
  if coalesce(p_payload->>'execution_mode','') = 'production' or coalesce(p_payload->>'environment_scope','') = 'production' then
    raise exception 'production mode/scope 차단';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_runtime_execution_sessions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'runtime_started', false); end if;
  end if;
  insert into public.ai_runtime_execution_sessions (runtime_session_code, execution_request_id, automation_definition_id, connector_instance_id, capability_id, approval_reference_id, gate_reference_id, execution_mode, environment_scope, target_resource_type, target_resource_id, input_hash, idempotency_key, runtime_preconditions)
  values (left(coalesce(nullif(p_payload->>'runtime_session_code',''), 'RUN-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_req.id, v_auto.id, v_inst, v_auto.capability_id, v_approval, v_gate,
    coalesce(nullif(p_payload->>'execution_mode',''), v_auto.execution_mode),
    coalesce(nullif(p_payload->>'environment_scope',''), 'non_production'),
    nullif(p_payload->>'target_resource_type',''), left(coalesce(p_payload->>'target_resource_id',''), 200),
    nullif(p_payload->>'input_hash',''), v_idem, coalesce(p_payload->'runtime_preconditions', '{}'::jsonb))
  returning id into v_id;
  insert into public.ai_runtime_execution_events (event_type, runtime_session_id, automation_definition_id, connector_instance_id, detail, payload, actor_id)
  values ('runtime_session_created', v_id, v_auto.id, v_inst, 'Session 생성 (draft — Runtime Start 아님·자동 시작 없음)', jsonb_build_object('execution_request_id', v_req.id), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'runtime_started', false, 'auto_started', false, 'connector_executed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Runtime Session 검토(사람) — Start Reference 는 검증 완료 후에만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_session_review(p_session_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_runtime_execution_sessions; v_next text; v_supervisor uuid; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','preconditions_review','request_start','record_start_reference','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_runtime_execution_sessions where id = p_session_id;
  if v_row.id is null then raise exception 'Runtime Session 없음(실존 검증 실패)'; end if;
  if v_row.session_status in ('completed_reference','failed_reference','cancelled_reference','invalidated') then
    raise exception '종결 상태 재결정 차단(%)', v_row.session_status;
  end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'preconditions_review' then
    -- Runtime Preconditions: Human Supervisor 지정 + 정책 정의 확인 없이는 ready 불가.
    v_supervisor := nullif(p_payload->>'supervised_by','')::uuid;
    if v_supervisor is null then raise exception 'precondition_missing: supervisor_missing(Human Supervisor 필수)'; end if;
    if not coalesce((p_payload->>'timeout_policy_defined')::boolean, false) then raise exception 'precondition_missing: timeout_policy_missing'; end if;
    if not coalesce((p_payload->>'cancellation_policy_defined')::boolean, false) then raise exception 'precondition_missing: cancellation_policy_missing'; end if;
    if not coalesce((p_payload->>'cleanup_policy_defined')::boolean, false) then raise exception 'precondition_missing: cleanup_policy_missing'; end if;
    if not coalesce((p_payload->>'evidence_requirements_defined')::boolean, false) then raise exception 'precondition_missing: evidence_requirement_missing'; end if;
    if not coalesce((p_payload->>'observation_plan_defined')::boolean, false) then raise exception 'precondition_missing: observation_plan_missing'; end if;
    update public.ai_runtime_execution_sessions set supervised_by = v_supervisor, runtime_preconditions = p_payload where id = p_session_id;
    v_next := 'ready_reference';
    v_note := ' (ready_reference ≠ started·자동 시작 없음)';
  elsif p_action = 'request_start' then
    if v_row.session_status <> 'ready_reference' then raise exception 'ready_reference 상태에서만 시작 요청 가능'; end if;
    v_next := 'start_requested_reference';
  elsif p_action = 'record_start_reference' then
    if v_row.session_status <> 'start_requested_reference' then raise exception 'start_requested 상태에서만 시작 Reference 기록 가능'; end if;
    if v_row.supervised_by is null then raise exception 'supervisor_missing'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Start Reference 금지(runtime_start_unverified)';
    end if;
    update public.ai_runtime_execution_sessions set started_by = v_uid, started_at = now() where id = p_session_id;
    v_next := 'started_reference';
    v_note := ' (Runtime Start ≠ Action Completion)';
  elsif p_action = 'reject' then v_next := 'failed_reference';
  else v_next := 'invalidated';
  end if;

  update public.ai_runtime_execution_sessions set session_status = v_next, updated_at = now(),
    failed_reference_at = case when p_action = 'reject' then now() else failed_reference_at end
  where id = p_session_id;
  insert into public.ai_runtime_execution_events (event_type, runtime_session_id, detail, payload, actor_id)
  values (case when p_action = 'preconditions_review' then 'runtime_preconditions_reviewed'
    when p_action = 'request_start' then 'runtime_start_requested_reference'
    when p_action = 'record_start_reference' then 'runtime_started_reference'
    when p_action = 'invalidate' then 'runtime_session_invalidated'
    else 'runtime_session_created' end,
    p_session_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_session_id, 'status', v_next, 'auto_started', false, 'action_success_claimed', false, 'human_supervision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Runtime 이벤트 기록(통합) — 실제 Connector 호출 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_event_record(p_kind text, p_session_id uuid, p_reason text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_row public.ai_runtime_execution_sessions; v_next text := null; v_responses int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('connector_permission_reviewed','connector_scope_reviewed','connector_health_reviewed','connector_definition_reviewed','connector_instance_reviewed','automation_definition_reviewed','runtime_checkpoint_recorded','pause_requested','pause_confirmed_reference','cancellation_requested','cancellation_confirmed_reference','timeout_recorded','connector_action_attempt_recorded','connector_response_recorded','action_result_reviewed','idempotency_reviewed','retry_reviewed','cleanup_reviewed','runtime_observation_started_reference','runtime_observation_completed_reference','unexpected_runtime_effect_detected','runtime_closure_reviewed') then
    raise exception '허용되지 않는 kind(생성/시작/무효화는 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_runtime_execution_sessions where id = p_session_id;
  if v_row.id is null then raise exception 'Runtime Session 없음(실존 검증 실패)'; end if;
  if v_row.session_status in ('completed_reference','failed_reference','cancelled_reference','invalidated') and p_kind <> 'runtime_closure_reviewed' then
    raise exception '종결 상태 Session 에 기록 불가';
  end if;

  -- 정직성 게이트: Action Attempt/Response 는 started 이후에만 + Evidence 필수.
  if p_kind in ('connector_action_attempt_recorded','connector_response_recorded') then
    if v_row.session_status not in ('started_reference','checkpoint_reference','action_reported_reference','pause_requested','cancellation_requested','timeout_reference','result_verification_pending') then
      raise exception 'runtime_start_unverified: started_reference 이후에만 Action/Response 기록 가능';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Action/Response 기록 금지(action_unverified)';
    end if;
    if length(coalesce(p_payload->>'external_reference_url','')) > 500 or length(coalesce(p_payload->>'external_reference_id','')) > 200 then
      raise exception 'External Reference 길이 초과';
    end if;
    if p_kind = 'connector_response_recorded' then v_next := 'result_verification_pending'; else v_next := 'action_reported_reference'; end if;
  end if;
  -- Pause/Cancel: 확정(confirmed)은 Evidence 필수 — Request ≠ Success.
  if p_kind = 'pause_requested' then
    update public.ai_runtime_execution_sessions set pause_requested_at = now() where id = p_session_id;
    v_next := 'pause_requested';
  end if;
  if p_kind = 'pause_confirmed_reference' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Pause 확정 금지(runtime_pause_unverified)';
    end if;
    update public.ai_runtime_execution_sessions set paused_at = now() where id = p_session_id;
    v_next := 'paused_reference';
  end if;
  if p_kind = 'cancellation_requested' then
    update public.ai_runtime_execution_sessions set cancellation_requested_at = now() where id = p_session_id;
    v_next := 'cancellation_requested';
  end if;
  if p_kind = 'cancellation_confirmed_reference' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Cancellation 확정 금지(runtime_cancel_unverified)';
    end if;
    update public.ai_runtime_execution_sessions set cancelled_at = now() where id = p_session_id;
    v_next := 'cancelled_reference';
  end if;
  if p_kind = 'timeout_recorded' then
    update public.ai_runtime_execution_sessions set timeout_reference_at = now() where id = p_session_id;
    v_next := 'timeout_reference';   -- Timeout ≠ 실패 확정(외부 Action 계속 가능)
  end if;
  if p_kind = 'runtime_checkpoint_recorded' then
    update public.ai_runtime_execution_sessions set checkpoint_count = checkpoint_count + 1, last_checkpoint_at = now() where id = p_session_id;
  end if;
  if p_kind = 'action_result_reviewed' then
    if coalesce(p_payload->>'result','') not in ('result_verification_pending','evidence_partial','response_only','action_unverified','result_unverified','verified_reference') then
      raise exception '허용되지 않는 result verification status';
    end if;
    update public.ai_runtime_execution_sessions set result_verification_status = p_payload->>'result', updated_at = now() where id = p_session_id;
  end if;
  if p_kind = 'idempotency_reviewed' and coalesce(p_payload->>'result','') not in ('idempotency_verified_reference','idempotency_partially_supported','idempotency_unverified','duplicate_request_candidate','duplicate_action_candidate','duplicate_side_effect_risk','execution_blocked','insufficient_data') then
    raise exception '허용되지 않는 idempotency result';
  end if;
  if p_kind = 'retry_reviewed' and coalesce(p_payload->>'result','') not in ('retry_not_required','retry_safe_reference','manual_retry_required','result_recheck_required','retry_blocked','idempotency_unverified','duplicate_side_effect_risk','retry_limit_reached','insufficient_data') then
    raise exception '허용되지 않는 retry result';
  end if;
  if p_kind = 'cleanup_reviewed' then
    if coalesce(p_payload->>'result','') not in ('cleanup_not_required','cleanup_ready_reference','cleanup_pending','cleanup_unverified','cleanup_permission_missing','orphan_resource_candidate','insufficient_data') then
      raise exception '허용되지 않는 cleanup result';
    end if;
    update public.ai_runtime_execution_sessions set cleanup_status = p_payload->>'result', updated_at = now() where id = p_session_id;
  end if;
  if p_kind = 'runtime_observation_started_reference' then
    update public.ai_runtime_execution_sessions set observation_status = 'runtime_observation_in_progress_reference' where id = p_session_id;
    v_next := 'observation_pending';
  end if;
  if p_kind = 'runtime_observation_completed_reference' then
    update public.ai_runtime_execution_sessions set observation_status = 'runtime_observation_completed_reference' where id = p_session_id;
  end if;
  if p_kind = 'unexpected_runtime_effect_detected' then
    update public.ai_runtime_execution_sessions set observation_status = 'unexpected_runtime_effect_candidate' where id = p_session_id;
  end if;
  -- Closure: 응답 기록 + verified/limitation Evidence 없이 closed 금지.
  if p_kind = 'runtime_closure_reviewed' then
    if coalesce(p_payload->>'closure','') not in ('closure_pending','observation_pending','cleanup_pending','rollback_review_required','closed_reference','closed_with_limitation','rejected') then
      raise exception '허용되지 않는 closure result';
    end if;
    if p_payload->>'closure' in ('closed_reference','closed_with_limitation') then
      select count(*) into v_responses from public.ai_runtime_execution_events
        where runtime_session_id = p_session_id and event_type = 'connector_response_recorded';
      if v_responses = 0 then raise exception 'Connector Response 기록 없는 Closure 금지(result_unverified)'; end if;
      if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
        raise exception 'Evidence 없는 Closure 금지';
      end if;
      update public.ai_runtime_execution_sessions set closure_status = p_payload->>'closure', completed_reference_at = now() where id = p_session_id;
      v_next := 'completed_reference';
    else
      update public.ai_runtime_execution_sessions set closure_status = p_payload->>'closure' where id = p_session_id;
    end if;
  end if;

  if v_next is not null then
    update public.ai_runtime_execution_sessions set session_status = v_next, updated_at = now() where id = p_session_id;
  end if;

  insert into public.ai_runtime_execution_events (event_type, runtime_session_id, connector_instance_id, detail, payload, actor_id)
  values (p_kind, p_session_id, v_row.connector_instance_id,
    left(p_reason, 200) || case
      when p_kind = 'connector_response_recorded' then ' (HTTP 2xx ≠ Business Success·Response ≠ Trusted Evidence)'
      when p_kind = 'connector_action_attempt_recorded' then ' (Attempt ≠ Success·Connector 자동 호출 아님)'
      when p_kind = 'pause_requested' then ' (Pause Requested ≠ Paused)'
      when p_kind = 'cancellation_requested' then ' (Cancel Requested ≠ Cancelled)'
      when p_kind = 'timeout_recorded' then ' (Timeout ≠ 실패 확정 — 외부 Action 계속 가능)'
      when p_kind = 'retry_reviewed' then ' (자동 Retry 없음·Retry ≠ Recovery)'
      when p_kind = 'cleanup_reviewed' then ' (자동 Cleanup 없음)'
      when p_kind = 'runtime_closure_reviewed' then ' (Closure ≠ Outcome Achievement)'
      when p_kind = 'runtime_observation_completed_reference' then ' (Observation ≠ Causality)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'connector_executed', false, 'auto_retry', false, 'auto_cleanup', false, 'auto_rollback', false, 'production_applied', false, 'human_supervision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_connector_definitions(p_limit int default 100)
returns setof public.ai_connector_definitions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_connector_definitions order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_connector_instances(p_limit int default 100)
returns setof public.ai_connector_instances language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_connector_instances order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_automation_definitions(p_limit int default 100)
returns setof public.ai_automation_definitions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_automation_definitions order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_sessions(p_status text default null, p_limit int default 100)
returns setof public.ai_runtime_execution_sessions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_execution_sessions s
    where (p_status is null or s.session_status = p_status)
    order by s.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_control_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'connectors', jsonb_build_object(
      'definitions', (select count(*) from public.ai_connector_definitions),
      'instances', (select count(*) from public.ai_connector_instances),
      'available_reference', (select count(*) from public.ai_connector_instances where connection_status = 'available_reference'),
      'connector_unavailable', (select count(*) from public.ai_connector_instances where connection_status in ('connector_unavailable','connector_status_unknown')),
      'permission_unverified', (select count(*) from public.ai_connector_instances where permission_status = 'connector_permission_unverified'),
      'scope_unverified', (select count(*) from public.ai_connector_instances where scope_status = 'connector_scope_unverified'),
      'credential_unverified', (select count(*) from public.ai_connector_instances where credential_reference_type = 'none' or last_verified_at is null),
      'health_unverified', (select count(*) from public.ai_connector_instances where health_status = 'health_unverified')
    ),
    'automations', jsonb_build_object(
      'total', (select count(*) from public.ai_automation_definitions),
      'draft', (select count(*) from public.ai_automation_definitions where status = 'draft'),
      'pending_review', (select count(*) from public.ai_automation_definitions where status = 'pending_review'),
      'approved_reference', (select count(*) from public.ai_automation_definitions where status = 'approved_reference'),
      'disabled', (select count(*) from public.ai_automation_definitions where status = 'disabled')
    ),
    'sessions', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_execution_sessions),
      'draft', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'draft'),
      'ready_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'ready_reference'),
      'start_requested', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'start_requested_reference'),
      'started_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'started_reference'),
      'action_reported', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'action_reported_reference'),
      'pause_requested', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'pause_requested'),
      'paused_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'paused_reference'),
      'cancellation_requested', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'cancellation_requested'),
      'cancelled_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'cancelled_reference'),
      'timeout_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'timeout_reference'),
      'result_verification_pending', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'result_verification_pending'),
      'observation_pending', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'observation_pending'),
      'completed_reference', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'completed_reference'),
      'invalidated', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'invalidated')
    ),
    'runtime_events', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_execution_events),
      'checkpoints', (select count(*) from public.ai_runtime_execution_events where event_type = 'runtime_checkpoint_recorded'),
      'action_attempts', (select count(*) from public.ai_runtime_execution_events where event_type = 'connector_action_attempt_recorded'),
      'connector_responses', (select count(*) from public.ai_runtime_execution_events where event_type = 'connector_response_recorded'),
      'timeouts', (select count(*) from public.ai_runtime_execution_events where event_type = 'timeout_recorded'),
      'retry_reviews', (select count(*) from public.ai_runtime_execution_events where event_type = 'retry_reviewed'),
      'cleanup_reviews', (select count(*) from public.ai_runtime_execution_events where event_type = 'cleanup_reviewed'),
      'unexpected_effects', (select count(*) from public.ai_runtime_execution_events where event_type = 'unexpected_runtime_effect_detected'),
      'closures', (select count(*) from public.ai_runtime_execution_events where event_type = 'runtime_closure_reviewed')
    ),
    -- 기존 원본 실측(읽기 전용):
    'gateway_actuals', jsonb_build_object(
      'execution_requests_0535', (select count(*) from public.ai_execution_requests),
      'gate_ready_0535', (select count(*) from public.ai_execution_requests where execution_status = 'ready_for_controlled_execution'),
      'capabilities_0535', (select count(*) from public.ai_execution_capabilities),
      'oversight_approvals_0534', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_approved'),
      'observations_0506', (select count(*) from public.ai_post_change_observations),
      'incidents_open_0502', (select count(*) from public.ai_incidents where status not in ('resolved','false_positive','closed'))
    ),
    'runtime_unavailable', jsonb_build_array('generic_agent_runtime','generic_worker_queue','dead_letter_queue','heartbeat_lease','cancellation_token','durable_execution','slack_jira_linear_github_connectors','toss_stripe_connectors'),   -- 원본 없음(실측)
    'runtime_available_reference', jsonb_build_array('pg_cron_0337','cron_worker_process_scheduled_releases','payapp_webhook_consumer','advisory_locks','idempotency_storage'),   -- 코드/Migration 실측
    'no_auto_connector_execution', true, 'no_auto_email_slack_ticket_issue', true, 'no_auto_retry', true, 'no_auto_cleanup', true, 'no_auto_rollback', true,
    'no_unattended_long_running', true, 'no_production_mode', true,
    'draft_created_is_not_message_sent', true, 'http_2xx_is_not_business_success', true, 'closure_is_not_outcome', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_runtime_audit(p_limit int default 100)
returns setof public.ai_runtime_execution_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_execution_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_connector_definitions enable row level security;
alter table public.ai_connector_instances enable row level security;
alter table public.ai_automation_definitions enable row level security;
alter table public.ai_runtime_execution_sessions enable row level security;
alter table public.ai_runtime_execution_events enable row level security;

comment on table public.ai_connector_definitions is 'AI-OPS-33 — Connector Definition(정의 ≠ Availability ≠ Permission·Write 도메인 11종 차단·Secret 접근 Connector 등록 차단).';
comment on table public.ai_connector_instances is 'AI-OPS-33 — Connector Instance(Credential 원문 저장 금지 — Reference 만·연결/권한/자격증명 unverified 시작).';
comment on table public.ai_automation_definitions is 'AI-OPS-33 — Automation Definition(정의 ≠ 실행 요청 ≠ 승인 ≠ 실행 권한·금지 도메인 차단·draft 시작).';
comment on table public.ai_runtime_execution_sessions is 'AI-OPS-33 — Supervised Runtime Session(0535 gate ready + 0534 승인 실존 필수·Supervisor 필수·자동 시작 없음·종결 재결정 차단).';
comment on table public.ai_runtime_execution_events is 'AI-OPS-33 — Runtime Audit(30종 whitelist — Checkpoint/Pause/Cancel/Timeout/Attempt/Response/Retry/Cleanup/Observation/Closure 통합·RPC 내부 Connector 호출 없음).';
