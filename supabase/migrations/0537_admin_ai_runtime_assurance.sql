-- 0537_admin_ai_runtime_assurance.sql
-- Phase AI-OPS-34 — Enterprise Runtime Assurance, Connector Health Intelligence &
-- Human Escalation Control Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * Runtime Signal 실측(0536): ai_runtime_execution_sessions 타임스탬프 8종(started_at/
--     last_checkpoint_at/pause·cancel·completed·failed·timeout_at) + checkpoint_count +
--     ai_runtime_execution_events 30종(attempt/response/result/cleanup/observation/closure).
--   * Connector Health 실측(0536): connection/permission/scope/health_status +
--     last_verified_at. last_success_reference_at/last_failure_reference_at/
--     rate_limit_status 컬럼은 없음 → 해당 Signal 은 signal_unavailable 정직 표기.
--   * Infrastructure 실측: pg_cron/cron worker/webhook consumer/advisory lock/
--     idempotency 실존 · Sentry(@sentry/react captureError) Error Tracking 실존 ·
--     Heartbeat/Lease/Worker Queue/DLQ/Runtime Metrics/Alert 연동 없음.
--   본 Phase 는 0532~0536 원본 전부 읽기 전용 — 원본 미변경.
--   신규 테이블 3개(signals/incident_candidates/events) —
--   Assurance State 는 순수 로직 계산 + 평가 이벤트 snapshot 으로 통합(테이블 미생성),
--   Connector Health/Progress/Stall/Timeout/Duplicate/Evidence/Delay/Escalation/
--   Recovery/Resolution 검토도 전부 이벤트(payload jsonb)로 통합.
--
-- Runtime Assurance 정직성(전부 강제):
--   * Signal ≠ Fact. Missing Signal ≠ Failure. Candidate ≠ Confirmed Incident.
--   * Connector Health ≠ Action Success. Timeout ≠ Failed Execution.
--   * Duplicate Candidate ≠ Confirmed Duplicate. Evidence Gap ≠ Execution Failure.
--   * Pause/Cancel Recommendation ≠ 실행. Recovery Plan ≠ Recovery Success.
--   * Resolution ≠ Outcome. 자동 Runtime 제어/Connector 제어/Retry/Cleanup/Rollback/
--     Incident 해결/메시지 발송/Ticket·Issue 생성 없음. 기존 ai_incidents 자동 등록 없음.
--   * Unknown 유지(null→0 금지). SLA 원본 없으면 임의 SLA 판정 없음.
--   * Trigger 없음 · 삭제 RPC 금지 · 종결 재결정 차단.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Runtime Assurance Signal(장애/실행 결과 의미 아님 — 관측 기록).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_assurance_signals (
  id                    uuid primary key default gen_random_uuid(),
  signal_code           text,
  runtime_session_id    uuid not null,
  connector_instance_id uuid,
  signal_type           text not null check (signal_type in ('runtime_started_reference','runtime_checkpoint_reference','runtime_progress_reference','runtime_pause_reference','runtime_cancellation_reference','runtime_timeout_reference','connector_response_reference','connector_failure_reference','connector_rate_limit_reference','result_verification_reference','cleanup_reference','observation_reference','closure_reference','missing_checkpoint_candidate','stale_runtime_candidate','duplicate_action_candidate','evidence_gap_candidate','delayed_review_candidate','unexpected_effect_candidate')),
  signal_source         text not null default 'manual_review' check (signal_source in ('session_timestamps','runtime_events','connector_instance','gateway_events_0535','observation_0506','sentry_error_tracking','manual_review')),
  signal_status         text not null default 'available_reference' check (signal_status in ('available_reference','partial','stale_signal_candidate','signal_unavailable','signal_unverified','contradictory_signal','insufficient_data')),
  observed_value        text,
  expected_value        text,
  threshold_reference   text,
  severity              text not null default 'severity_unverified' check (severity in ('informational','low','moderate','high','critical','severity_unverified','insufficient_data')),
  confidence            int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence              jsonb not null default '[]'::jsonb,
  limitations           jsonb not null default '[]'::jsonb,
  observed_at           timestamptz,
  source_event_id       uuid,
  input_hash            text,
  idempotency_key       text,
  recorded_by           uuid,
  created_at            timestamptz not null default now()
);
create unique index if not exists uq_assur_sig_idem on public.ai_runtime_assurance_signals (idempotency_key) where idempotency_key is not null;
create index if not exists idx_assur_sig_sess on public.ai_runtime_assurance_signals (runtime_session_id, created_at desc);
create index if not exists idx_assur_sig_type on public.ai_runtime_assurance_signals (signal_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Runtime Incident Candidate(확정 Incident 아님 — ai_incidents 자동 등록 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_incident_candidates (
  id                    uuid primary key default gen_random_uuid(),
  incident_code         text not null,
  runtime_session_id    uuid not null,
  connector_instance_id uuid,
  incident_type         text not null check (incident_type in ('connector_unavailable_candidate','connector_degraded_candidate','permission_failure_candidate','scope_failure_candidate','runtime_stall_candidate','timeout_candidate','duplicate_action_candidate','duplicate_side_effect_candidate','evidence_gap_candidate','result_verification_delay_candidate','cleanup_delay_candidate','observation_delay_candidate','closure_delay_candidate','unexpected_runtime_effect_candidate','unknown_runtime_anomaly_candidate')),
  incident_status       text not null default 'detected_candidate' check (incident_status in ('detected_candidate','pending_review','acknowledged_reference','investigation_reference','monitoring_reference','false_positive_reference','escalated_reference','recovery_review_pending','resolution_pending','resolved_reference','resolved_with_limitation','invalidated','insufficient_data')),
  severity              text not null default 'severity_unverified' check (severity in ('informational','low','moderate','high','critical','severity_unverified','insufficient_data')),
  confidence            int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  detection_source      text,
  detected_signals      jsonb not null default '[]'::jsonb,
  suspected_scope       text,
  suspected_effect      text,
  evidence              jsonb not null default '[]'::jsonb,
  limitations           jsonb not null default '[]'::jsonb,
  escalation_status     text not null default 'escalation_not_required' check (escalation_status in ('escalation_not_required','escalation_recommended','escalation_pending','acknowledged_reference','investigation_in_progress_reference','specialist_review_required','executive_review_required','resolution_pending','resolved_reference','invalidated','insufficient_data')),
  resolution_status     text not null default 'resolution_pending' check (resolution_status in ('resolution_pending','resolved_reference','resolved_with_limitation','monitoring_required','recovery_review_required','observation_extension_required','result_unverified','rejected_resolution','invalidated','insufficient_data')),
  assigned_reviewer     uuid,
  first_detected_at     timestamptz not null default now(),
  last_detected_at      timestamptz not null default now(),
  idempotency_key       text,
  created_by            uuid,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index if not exists uq_assur_inc_idem on public.ai_runtime_incident_candidates (idempotency_key) where idempotency_key is not null;
create index if not exists idx_assur_inc_status on public.ai_runtime_incident_candidates (incident_status, severity);
create index if not exists idx_assur_inc_sess on public.ai_runtime_incident_candidates (runtime_session_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Assurance 이벤트(18종) — Health/Progress/Stall/Timeout/Duplicate/Evidence/
--    Delay/Escalation/Recovery/Resolution 검토 + State snapshot 통합.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_runtime_assurance_events (
  id                    uuid primary key default gen_random_uuid(),
  event_type            text not null check (event_type in ('assurance_evaluation_started','assurance_evaluation_completed_reference','connector_health_evaluated','runtime_progress_evaluated','stall_candidate_detected','timeout_candidate_detected','duplicate_candidate_detected','evidence_gap_detected','review_delay_detected','runtime_incident_candidate_created','runtime_incident_candidate_reviewed','escalation_requested','escalation_acknowledged_reference','investigation_started_reference','recovery_readiness_reviewed','runtime_resolution_reviewed','observation_extension_requested','assurance_invalidated')),
  runtime_session_id    uuid,
  connector_instance_id uuid,
  incident_candidate_id uuid,
  detail                text,
  payload               jsonb,
  actor_id              uuid,
  created_at            timestamptz not null default now()
);
create index if not exists idx_assur_evt on public.ai_runtime_assurance_events (event_type, created_at desc);
create index if not exists idx_assur_evt_sess on public.ai_runtime_assurance_events (runtime_session_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Signal 기록(사람) — Session 실존·Secret 차단·Unknown 유지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_signal_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_sess uuid; v_inst uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_runtime_assurance_signals; v_conf int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_sess := nullif(p_payload->>'runtime_session_id','')::uuid;
  if v_sess is null or not exists (select 1 from public.ai_runtime_execution_sessions where id = v_sess) then
    raise exception 'Runtime Session(0536) 없음(실존 검증 실패)';
  end if;
  v_inst := nullif(p_payload->>'connector_instance_id','')::uuid;
  if v_inst is not null and not exists (select 1 from public.ai_connector_instances where id = v_inst) then
    raise exception 'Connector Instance 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'observed_at','') is not null and (p_payload->>'observed_at')::timestamptz > now() + interval '1 hour' then
    raise exception 'observed_at 미래 시각(범위 검증 실패)';
  end if;
  v_conf := case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end;
  if v_idem is not null then
    select * into v_existing from public.ai_runtime_assurance_signals where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id); end if;
  end if;
  insert into public.ai_runtime_assurance_signals (signal_code, runtime_session_id, connector_instance_id, signal_type, signal_source, signal_status, observed_value, expected_value, threshold_reference, severity, confidence, evidence, limitations, observed_at, source_event_id, input_hash, idempotency_key, recorded_by)
  values (left(coalesce(p_payload->>'signal_code',''), 60), v_sess, v_inst,
    p_payload->>'signal_type', coalesce(nullif(p_payload->>'signal_source',''), 'manual_review'),
    coalesce(nullif(p_payload->>'signal_status',''), 'available_reference'),
    left(coalesce(p_payload->>'observed_value',''), 300), left(coalesce(p_payload->>'expected_value',''), 300), left(coalesce(p_payload->>'threshold_reference',''), 200),
    coalesce(nullif(p_payload->>'severity',''), 'severity_unverified'), v_conf,
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb),
    nullif(p_payload->>'observed_at','')::timestamptz, nullif(p_payload->>'source_event_id','')::uuid,
    nullif(p_payload->>'input_hash',''), v_idem, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'signal_is_not_fact', true, 'incident_confirmed', false, 'auto_action_taken', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Incident Candidate 생성/검토(확정 Incident 아님 — 자동 조치 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_incident_candidate_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_sess uuid; v_inst uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_runtime_incident_candidates; v_conf int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_sess := nullif(p_payload->>'runtime_session_id','')::uuid;
  if v_sess is null or not exists (select 1 from public.ai_runtime_execution_sessions where id = v_sess) then
    raise exception 'Runtime Session(0536) 없음(실존 검증 실패)';
  end if;
  v_inst := nullif(p_payload->>'connector_instance_id','')::uuid;
  if v_inst is not null and not exists (select 1 from public.ai_connector_instances where id = v_inst) then
    raise exception 'Connector Instance 없음(실존 검증 실패)';
  end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'Evidence 없는 Incident Candidate 생성 금지(insufficient_data)';
  end if;
  v_conf := case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end;
  if v_idem is not null then
    select * into v_existing from public.ai_runtime_incident_candidates where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'incident_confirmed', false); end if;
  end if;
  insert into public.ai_runtime_incident_candidates (incident_code, runtime_session_id, connector_instance_id, incident_type, severity, confidence, detection_source, detected_signals, suspected_scope, suspected_effect, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'incident_code',''), 'RIC-' || substr(gen_random_uuid()::text, 1, 8)), 40), v_sess, v_inst,
    p_payload->>'incident_type', coalesce(nullif(p_payload->>'severity',''), 'severity_unverified'), v_conf,
    left(coalesce(p_payload->>'detection_source',''), 120), coalesce(p_payload->'detected_signals', '[]'::jsonb),
    left(coalesce(p_payload->>'suspected_scope',''), 200), left(coalesce(p_payload->>'suspected_effect',''), 300),
    p_payload->'evidence', coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  -- 기존 ai_incidents(0502)에 자동 등록하지 않음 — 후보 기록만.
  insert into public.ai_runtime_assurance_events (event_type, runtime_session_id, connector_instance_id, incident_candidate_id, detail, payload, actor_id)
  values ('runtime_incident_candidate_created', v_sess, v_inst, v_id,
    left(coalesce(p_payload->>'incident_type',''), 80) || ' (Candidate ≠ Confirmed Incident·자동 조치 없음)', jsonb_build_object('severity', coalesce(nullif(p_payload->>'severity',''), 'severity_unverified')), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'detected_candidate', 'incident_confirmed', false, 'auto_registered_to_ai_incidents', false, 'auto_action_taken', false);
end $$;

create or replace function public.admin_runtime_incident_candidate_review(p_candidate_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_runtime_incident_candidates; v_next text; v_esc text := null; v_res text := null; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','acknowledge','investigate','monitor','false_positive','escalate','recovery_review','resolve','resolve_with_limitation','reject_resolution','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_runtime_incident_candidates where id = p_candidate_id;
  if v_row.id is null then raise exception 'Incident Candidate 없음(실존 검증 실패)'; end if;
  if v_row.incident_status in ('resolved_reference','resolved_with_limitation','false_positive_reference','invalidated') then
    raise exception '종결 상태 재결정 차단(%)', v_row.incident_status;
  end if;
  if v_row.created_by = v_uid then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'acknowledge' then v_next := 'acknowledged_reference'; v_esc := 'acknowledged_reference';
  elsif p_action = 'investigate' then v_next := 'investigation_reference'; v_esc := 'investigation_in_progress_reference';
  elsif p_action = 'monitor' then v_next := 'monitoring_reference';
  elsif p_action = 'false_positive' then v_next := 'false_positive_reference';
  elsif p_action = 'escalate' then v_next := 'escalated_reference'; v_esc := 'escalation_pending'; v_note := v_note || ' (Escalation 권고 ≠ 실행·자동 메시지 발송 없음)';
  elsif p_action = 'recovery_review' then v_next := 'recovery_review_pending'; v_res := 'recovery_review_required';
  elsif p_action = 'resolve' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Resolution 금지(result_unverified)';
    end if;
    v_next := 'resolved_reference'; v_esc := 'resolved_reference'; v_res := 'resolved_reference';
    v_note := v_note || ' (Resolution ≠ Outcome Success)';
  elsif p_action = 'resolve_with_limitation' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Resolution 금지';
    end if;
    v_next := 'resolved_with_limitation'; v_res := 'resolved_with_limitation';
  elsif p_action = 'reject_resolution' then v_next := 'resolution_pending'; v_res := 'rejected_resolution';
  else v_next := 'invalidated'; v_res := 'invalidated';
  end if;

  update public.ai_runtime_incident_candidates set incident_status = v_next,
    escalation_status = coalesce(v_esc, escalation_status),
    resolution_status = coalesce(v_res, resolution_status),
    assigned_reviewer = coalesce(nullif(p_payload->>'assigned_reviewer','')::uuid, assigned_reviewer),
    last_detected_at = now(), updated_at = now()
  where id = p_candidate_id;
  insert into public.ai_runtime_assurance_events (event_type, runtime_session_id, connector_instance_id, incident_candidate_id, detail, payload, actor_id)
  values (case when p_action = 'escalate' then 'escalation_requested'
    when p_action = 'acknowledge' then 'escalation_acknowledged_reference'
    when p_action = 'investigate' then 'investigation_started_reference'
    when p_action = 'recovery_review' then 'recovery_readiness_reviewed'
    when p_action in ('resolve','resolve_with_limitation','reject_resolution') then 'runtime_resolution_reviewed'
    when p_action = 'invalidate' then 'assurance_invalidated'
    else 'runtime_incident_candidate_reviewed' end,
    v_row.runtime_session_id, v_row.connector_instance_id, p_candidate_id,
    left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_candidate_id, 'status', v_next, 'incident_confirmed', false, 'auto_action_taken', false, 'auto_message_sent', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Assurance 이벤트 기록(18종) — 실제 Runtime/Connector 제어 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_assurance_event_record(p_kind text, p_reason text, p_payload jsonb, p_session_id uuid default null, p_incident_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_inst uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('assurance_evaluation_started','assurance_evaluation_completed_reference','connector_health_evaluated','runtime_progress_evaluated','stall_candidate_detected','timeout_candidate_detected','duplicate_candidate_detected','evidence_gap_detected','review_delay_detected','escalation_requested','escalation_acknowledged_reference','investigation_started_reference','recovery_readiness_reviewed','runtime_resolution_reviewed','observation_extension_requested','assurance_invalidated') then
    raise exception '허용되지 않는 kind(incident 생성/검토는 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_session_id is not null and not exists (select 1 from public.ai_runtime_execution_sessions where id = p_session_id) then
    raise exception 'Runtime Session 없음(실존 검증 실패)';
  end if;
  if p_incident_id is not null and not exists (select 1 from public.ai_runtime_incident_candidates where id = p_incident_id) then
    raise exception 'Incident Candidate 없음(실존 검증 실패)';
  end if;
  -- Escalation 요청은 escalation_type whitelist(자동 발송 없음 — 요청 기록만).
  if p_kind = 'escalation_requested' and coalesce(p_payload->>'escalation_type','') not in ('escalation_requested','pause_review_requested','cancellation_review_requested','connector_disable_review_requested','result_recheck_requested','cleanup_review_requested','rollback_review_requested','observation_extension_requested','executive_review_requested','security_review_requested','privacy_review_requested','compliance_review_requested') then
    raise exception '허용되지 않는 escalation_type';
  end if;
  v_inst := nullif(p_payload->>'connector_instance_id','')::uuid;
  if v_inst is not null and not exists (select 1 from public.ai_connector_instances where id = v_inst) then
    raise exception 'Connector Instance 없음(실존 검증 실패)';
  end if;
  insert into public.ai_runtime_assurance_events (event_type, runtime_session_id, connector_instance_id, incident_candidate_id, detail, payload, actor_id)
  values (p_kind, p_session_id, v_inst, p_incident_id,
    left(p_reason, 200) || case
      when p_kind = 'stall_candidate_detected' then ' (Stall Candidate ≠ Confirmed Stall)'
      when p_kind = 'timeout_candidate_detected' then ' (Timeout ≠ Failed Execution)'
      when p_kind = 'duplicate_candidate_detected' then ' (Duplicate Candidate ≠ Confirmed·자동 취소 없음)'
      when p_kind = 'evidence_gap_detected' then ' (Evidence Gap ≠ Execution Failure)'
      when p_kind = 'connector_health_evaluated' then ' (Connector Health ≠ Action Success)'
      when p_kind = 'escalation_requested' then ' (권고/요청 기록 — 자동 메시지 발송 없음)'
      when p_kind = 'recovery_readiness_reviewed' then ' (Recovery Plan ≠ Recovery Success·자동 Recovery 없음)'
      when p_kind = 'runtime_resolution_reviewed' then ' (Resolution ≠ Outcome Success)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'runtime_controlled', false, 'connector_controlled', false, 'auto_retry', false, 'auto_message_sent', false, 'production_applied', false, 'human_decision_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 목록/Summary/Audit(읽기 전용 — 0536/0535/0506/0502 원본 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_signals(p_session_id uuid default null, p_limit int default 100)
returns setof public.ai_runtime_assurance_signals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_assurance_signals s
    where (p_session_id is null or s.runtime_session_id = p_session_id)
    order by s.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_incident_candidates(p_status text default null, p_limit int default 100)
returns setof public.ai_runtime_incident_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_incident_candidates c
    where (p_status is null or c.incident_status = p_status)
    order by c.created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_runtime_assurance_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'signals', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_assurance_signals),
      'stale', (select count(*) from public.ai_runtime_assurance_signals where signal_status = 'stale_signal_candidate'),
      'unavailable', (select count(*) from public.ai_runtime_assurance_signals where signal_status = 'signal_unavailable'),
      'contradictory', (select count(*) from public.ai_runtime_assurance_signals where signal_status = 'contradictory_signal'),
      'stall_candidates', (select count(*) from public.ai_runtime_assurance_signals where signal_type in ('missing_checkpoint_candidate','stale_runtime_candidate')),
      'duplicate_candidates', (select count(*) from public.ai_runtime_assurance_signals where signal_type = 'duplicate_action_candidate'),
      'evidence_gaps', (select count(*) from public.ai_runtime_assurance_signals where signal_type = 'evidence_gap_candidate'),
      'delayed_reviews', (select count(*) from public.ai_runtime_assurance_signals where signal_type = 'delayed_review_candidate')
    ),
    'incidents', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_incident_candidates),
      'detected', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'detected_candidate'),
      'pending_review', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'pending_review'),
      'investigation', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'investigation_reference'),
      'monitoring', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'monitoring_reference'),
      'escalated', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'escalated_reference'),
      'recovery_review_pending', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'recovery_review_pending'),
      'resolution_pending', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'resolution_pending'),
      'resolved', (select count(*) from public.ai_runtime_incident_candidates where incident_status in ('resolved_reference','resolved_with_limitation')),
      'false_positive', (select count(*) from public.ai_runtime_incident_candidates where incident_status = 'false_positive_reference'),
      'high_severity', (select count(*) from public.ai_runtime_incident_candidates where severity = 'high' and incident_status not in ('resolved_reference','resolved_with_limitation','false_positive_reference','invalidated')),
      'critical_severity', (select count(*) from public.ai_runtime_incident_candidates where severity = 'critical' and incident_status not in ('resolved_reference','resolved_with_limitation','false_positive_reference','invalidated'))
    ),
    'assurance_events', jsonb_build_object(
      'total', (select count(*) from public.ai_runtime_assurance_events),
      'evaluations', (select count(*) from public.ai_runtime_assurance_events where event_type = 'assurance_evaluation_completed_reference'),
      'health_reviews', (select count(*) from public.ai_runtime_assurance_events where event_type = 'connector_health_evaluated'),
      'escalations_requested', (select count(*) from public.ai_runtime_assurance_events where event_type = 'escalation_requested'),
      'investigations', (select count(*) from public.ai_runtime_assurance_events where event_type = 'investigation_started_reference'),
      'recovery_reviews', (select count(*) from public.ai_runtime_assurance_events where event_type = 'recovery_readiness_reviewed'),
      'resolutions', (select count(*) from public.ai_runtime_assurance_events where event_type = 'runtime_resolution_reviewed'),
      'observation_extensions', (select count(*) from public.ai_runtime_assurance_events where event_type = 'observation_extension_requested')
    ),
    -- 원본 실측(전부 읽기 전용 — 0536/0535/0506/0502 미변경):
    'runtime_actuals', jsonb_build_object(
      'sessions_total_0536', (select count(*) from public.ai_runtime_execution_sessions),
      'sessions_active_0536', (select count(*) from public.ai_runtime_execution_sessions where session_status in ('started_reference','action_reported_reference','pause_requested','cancellation_requested','result_verification_pending','observation_pending')),
      'sessions_no_checkpoint_0536', (select count(*) from public.ai_runtime_execution_sessions where session_status = 'started_reference' and last_checkpoint_at is null),
      'connector_instances_0536', (select count(*) from public.ai_connector_instances),
      'connector_health_unverified_0536', (select count(*) from public.ai_connector_instances where health_status = 'health_unverified'),
      'connector_stale_0536', (select count(*) from public.ai_connector_instances where last_verified_at is null or last_verified_at < now() - interval '7 days'),
      'runtime_events_0536', (select count(*) from public.ai_runtime_execution_events),
      'gateway_requests_0535', (select count(*) from public.ai_execution_requests),
      'observations_0506', (select count(*) from public.ai_post_change_observations),
      'incidents_open_0502', (select count(*) from public.ai_incidents where status not in ('resolved','false_positive','closed'))
    ),
    'signal_unavailable', jsonb_build_array('runtime_heartbeat','runtime_metrics','worker_queue_depth','dead_letter_queue','lease_state','connector_last_success_reference_at','connector_last_failure_reference_at','connector_rate_limit_status_column','alert_integration'),   -- 원본 없음(실측 — 0536 컬럼/인프라 기준)
    'signal_available_reference', jsonb_build_array('session_timestamps_0536','runtime_events_0536','connector_instance_status_0536','gateway_events_0535','observations_0506','sentry_error_tracking'),   -- 실존
    'no_auto_runtime_control', true, 'no_auto_connector_control', true, 'no_auto_retry', true, 'no_auto_cleanup', true, 'no_auto_rollback', true,
    'no_auto_incident_resolution', true, 'no_auto_message_ticket_issue', true, 'no_auto_incident_registration_0502', true,
    'signal_is_not_fact', true, 'candidate_is_not_confirmed_incident', true, 'connector_health_is_not_action_success', true,
    'timeout_is_not_failure', true, 'resolution_is_not_outcome_success', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_runtime_assurance_audit(p_limit int default 100)
returns setof public.ai_runtime_assurance_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_runtime_assurance_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_runtime_assurance_signals enable row level security;
alter table public.ai_runtime_incident_candidates enable row level security;
alter table public.ai_runtime_assurance_events enable row level security;

comment on table public.ai_runtime_assurance_signals is 'AI-OPS-34 — Runtime Assurance Signal(19종 whitelist — Signal ≠ Fact·Missing Signal ≠ Failure·Secret/개인정보 Payload 저장 금지).';
comment on table public.ai_runtime_incident_candidates is 'AI-OPS-34 — Runtime Incident Candidate(15종 — 확정 Incident 아님·ai_incidents(0502) 자동 등록 없음·종결 재결정 차단).';
comment on table public.ai_runtime_assurance_events is 'AI-OPS-34 — Assurance Audit(18종 — Health/Progress/Stall/Timeout/Duplicate/Evidence/Delay/Escalation/Recovery/Resolution 통합·State snapshot 은 evaluation 이벤트 payload·실제 Runtime/Connector 제어 없음).';
