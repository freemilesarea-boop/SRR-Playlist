-- ============================================
-- 0505_admin_ai_execution_readiness.sql
--
-- Phase AI-OPS-2 — Controlled Execution Planning, Change Management & Release Readiness.
--
-- Operations Center(0504)에서 **승인된** Operation 을 실제 Production 에 바로 적용하지 않고
--   Approved Operation → Execution Eligibility → Change Plan → Dependency Validation
--   → Preflight Checklist → Change Window → Rollback Readiness → Observation Readiness
--   → Go/No-Go Review → Execution Package → **별도 사람 실행 대기**
-- 로 관리한다.
--
-- ⚠️ 절대: 실제 Production Apply/Merge/Deploy/Publish/Rollout/Migration Apply 없음.
--   실행 상태(executing/deployed/applied/live/running) 표현 금지 — ready_for_manual_execution
--   은 "사람이 별도 절차로 실행할 준비 완료"이지 실행 완료가 아니다. 승인되지 않은
--   Operation 의 계획 생성 금지(서버 게이트). Rollback/Observation Plan 없이 준비 완료 금지.
--   자동 예약 실행/실행 버튼/Apply SQL 자동 생성 없음. Trigger 없음. 삭제 RPC 없음.
--
-- 재사용: Operation 승인 상태는 ai_operations(0504) 참조. Preflight/Rollback/Observation/
--   Change Window/Manual Reference 는 plan 행 jsonb 내장(별도 테이블 최소화 — audit 만 분리).
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Execution Plan(실행 준비 문서 — 실행 엔진 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_plans (
  id                  uuid primary key default gen_random_uuid(),
  plan_code           text not null unique,
  operation_id        uuid not null references public.ai_operations(id) unique,   -- Duplicate Plan 차단
  source_type         text not null,
  source_id           uuid not null,
  execution_type      text not null check (execution_type in ('configuration_change','playlist_change','rotation_change','rollout_change','scheduler_change','recovery_action','migration_change','infrastructure_change','policy_change','observation_only')),
  plan_status         text not null default 'draft' check (plan_status in ('draft','pending_review','waiting_evidence','preflight_ready','go_review','ready_for_manual_execution','no_go','rejected','cancelled','expired','completed_reference')),
  risk_tier           text not null check (risk_tier in ('low','medium','high','critical')),
  change_summary      text not null,
  business_objective  text,
  scope               jsonb not null default '{}'::jsonb,
  dependencies        jsonb not null default '[]'::jsonb,   -- [{type, ref, status}] — 임의 생성 금지(실존 참조만)
  preconditions       jsonb not null default '[]'::jsonb,
  execution_steps     jsonb not null default '[]'::jsonb,   -- 사람이 읽는 절차(자동 실행 명령 아님)
  validation_steps    jsonb not null default '[]'::jsonb,
  preflight           jsonb not null default '[]'::jsonb,   -- [{key, label, required, status, evidence, checked_at, failure_reason}]
  rollback_plan       jsonb,                                 -- {trigger, steps[], owner, recovery_time_min, snapshot_ref, validation, irreversible}
  observation_plan    jsonb,                                 -- {period_hours, kpis[], thresholds, alert_condition, monitoring_source, owner, success, failure, escalation}
  go_criteria         jsonb not null default '[]'::jsonb,
  no_go_criteria      jsonb not null default '[]'::jsonb,
  go_decision         text check (go_decision is null or go_decision in ('go','conditional_go','no_go','review_required','insufficient_data')),
  go_reason           text,
  change_window_start timestamptz,
  change_window_end   timestamptz,
  change_window_meta  jsonb,                                 -- {timezone, freeze, peak, approver}
  execution_owner     text,
  rollback_owner      text,
  observation_owner   text,
  evidence            jsonb not null default '[]'::jsonb,
  source_versions     jsonb not null default '{}'::jsonb,
  input_hash          text not null,
  idempotency_key     text not null unique,
  manual_reference    jsonb,                                 -- {external_change_id, executed_by, executed_at, execution_result, validation_result, rollback_used, observation_result, evidence}
  limitations         jsonb not null default '[]'::jsonb,
  created_by          uuid,
  reviewed_by         uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  expired_at          timestamptz,
  updated_at          timestamptz not null default now(),
  check (change_window_start is null or change_window_end is null or change_window_start < change_window_end)
);
comment on table public.ai_execution_plans is
  'AI-OPS-2 — Execution Readiness Plan(사람 실행 대기 문서). executing/deployed/live 상태 없음 · 자동 실행/Apply 없음.';
create index if not exists idx_exec_plan_status on public.ai_execution_plans (plan_status, created_at desc);
create index if not exists idx_exec_plan_risk on public.ai_execution_plans (risk_tier);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Execution Audit(실제 Production 실행 로그 아님 — 계획/검토 이력).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_execution_audit (
  id            uuid primary key default gen_random_uuid(),
  plan_id       uuid not null references public.ai_execution_plans(id),
  event_type    text not null check (event_type in ('plan_created','eligibility_checked','evidence_requested','dependency_checked','preflight_updated','rollback_reviewed','observation_reviewed','go_review_started','go_approved','conditional_go_decided','no_go_decided','plan_cancelled','plan_expired','manual_execution_reference_recorded')),
  detail        text,
  evidence      jsonb not null default '[]'::jsonb,
  actor_id      uuid,
  created_at    timestamptz not null default now()
);
comment on table public.ai_execution_audit is
  'AI-OPS-2 — Execution Plan 검토 이력(Production 실행 로그와 무관).';
create index if not exists idx_exec_audit on public.ai_execution_audit (plan_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Plan 생성 — Eligibility 서버 게이트(승인된 Operation 만 · 중복/Idempotency).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_plan_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_op public.ai_operations; v_existing public.ai_execution_plans; v_row public.ai_execution_plans; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 131072 then raise exception 'payload too large (128KB limit)' using errcode='22023'; end if;
  select * into v_op from public.ai_operations where id = (p_payload->>'operation_id')::uuid;
  if v_op.id is null then raise exception 'operation not found' using errcode='P0002'; end if;
  -- Eligibility: 승인된 Operation 만(승인되지 않은 Operation 의 실행 계획 생성 금지).
  if v_op.status <> 'approved' then raise exception 'operation not approved (status=%) — 승인 전 실행 계획 생성 금지', v_op.status using errcode='22023'; end if;
  if coalesce(p_payload->>'plan_code','') = '' or coalesce(p_payload->>'change_summary','') = '' then raise exception 'plan_code/change_summary required' using errcode='22023'; end if;
  if coalesce(p_payload->>'execution_type','') not in ('configuration_change','playlist_change','rotation_change','rollout_change','scheduler_change','recovery_action','migration_change','infrastructure_change','policy_change','observation_only') then raise exception 'invalid execution_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'risk_tier','') not in ('low','medium','high','critical') then raise exception 'invalid risk_tier' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'input_hash','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then raise exception 'input_hash/idempotency_key required' using errcode='22023'; end if;

  select * into v_existing from public.ai_execution_plans where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'eligibility', 'duplicate', 'plan', to_jsonb(v_existing)); end if;
  select * into v_existing from public.ai_execution_plans where operation_id = v_op.id;
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'eligibility', 'duplicate', 'plan', to_jsonb(v_existing)); end if;

  insert into public.ai_execution_plans(plan_code, operation_id, source_type, source_id, execution_type, risk_tier,
    change_summary, business_objective, scope, dependencies, preconditions, execution_steps, validation_steps, preflight,
    go_criteria, no_go_criteria, evidence, source_versions, input_hash, idempotency_key, limitations, created_by)
  values (p_payload->>'plan_code', v_op.id, v_op.source_type, v_op.source_id, p_payload->>'execution_type', p_payload->>'risk_tier',
    p_payload->>'change_summary', nullif(p_payload->>'business_objective',''), coalesce(p_payload->'scope','{}'::jsonb),
    coalesce(p_payload->'dependencies','[]'::jsonb), coalesce(p_payload->'preconditions','[]'::jsonb),
    coalesce(p_payload->'execution_steps','[]'::jsonb), coalesce(p_payload->'validation_steps','[]'::jsonb),
    coalesce(p_payload->'preflight','[]'::jsonb), coalesce(p_payload->'go_criteria','[]'::jsonb), coalesce(p_payload->'no_go_criteria','[]'::jsonb),
    p_payload->'evidence', coalesce(p_payload->'source_versions','{}'::jsonb), p_payload->>'input_hash', p_payload->>'idempotency_key',
    coalesce(p_payload->'limitations','["자동 실행 없음 — 사람 실행 대기 문서"]'::jsonb), auth.uid())
  returning id into v_id;
  insert into public.ai_execution_audit(plan_id, event_type, detail, evidence, actor_id)
  values (v_id, 'plan_created', v_op.title, p_payload->'evidence', auth.uid()),
         (v_id, 'eligibility_checked', 'eligible (operation approved)', '[]'::jsonb, auth.uid());
  select * into v_row from public.ai_execution_plans where id = v_id;
  return jsonb_build_object('idempotent', false, 'eligibility', 'eligible', 'plan', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_execution_plan_create(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 목록/상세/요약.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_plans(p_status text default null, p_risk text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_execution_plans p
    where (p_status is null or p.plan_status = p_status) and (p_risk is null or p.risk_tier = p_risk)
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_execution_plans(text, text, int) to authenticated;

create or replace function public.admin_execution_plan_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_execution_plans; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_execution_plans where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit from (
    select event_type, detail, actor_id, created_at from public.ai_execution_audit where plan_id = p_id order by created_at desc limit 100
  ) a;
  return jsonb_build_object('found', true, 'plan', to_jsonb(v_row), 'audit', v_audit);
end; $$;
grant execute on function public.admin_execution_plan_detail(uuid) to authenticated;

create or replace function public.admin_execution_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'by_status', (select coalesce(jsonb_object_agg(plan_status, n), '{}'::jsonb) from (select plan_status, count(*) n from public.ai_execution_plans group by plan_status) x),
    'ready_for_manual_execution', count(*) filter (where plan_status = 'ready_for_manual_execution'),
    'no_go', count(*) filter (where plan_status = 'no_go'),
    'missing_rollback', count(*) filter (where rollback_plan is null and plan_status not in ('no_go','rejected','cancelled','expired')),
    'missing_observation', count(*) filter (where observation_plan is null and plan_status not in ('no_go','rejected','cancelled','expired')),
    'critical_risk', count(*) filter (where risk_tier = 'critical'),
    'approved_operations', (select count(*) from public.ai_operations where status = 'approved'),
    'last_review_at', max(reviewed_at)
  ) into v from public.ai_execution_plans;
  return v || jsonb_build_object('generated_at', now());
end; $$;
grant execute on function public.admin_execution_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 섹션 업데이트(dependencies/preflight/rollback/observation/change_window)
--    — 섹션 whitelist · finalized plan 수정 차단 · Audit 기록. 일괄 자동 PASS 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_plan_update(p_id uuid, p_section text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_execution_plans; v_event text;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_value) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if p_section is null or p_section not in ('dependencies','preflight','rollback_plan','observation_plan','change_window','evidence','execution_steps','owners') then raise exception 'invalid section' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_execution_plans where id = p_id;
  if v_row.id is null then raise exception 'plan not found' using errcode='P0002'; end if;
  if v_row.plan_status in ('ready_for_manual_execution','no_go','rejected','cancelled','expired','completed_reference') then
    raise exception 'plan finalized — 수정 불가(status=%)', v_row.plan_status using errcode='22023';
  end if;

  if p_section = 'dependencies' then update public.ai_execution_plans set dependencies = coalesce(p_value,'[]'::jsonb), updated_at = now() where id = p_id; v_event := 'dependency_checked';
  elsif p_section = 'preflight' then update public.ai_execution_plans set preflight = coalesce(p_value,'[]'::jsonb), updated_at = now() where id = p_id; v_event := 'preflight_updated';
  elsif p_section = 'rollback_plan' then update public.ai_execution_plans set rollback_plan = p_value, updated_at = now() where id = p_id; v_event := 'rollback_reviewed';
  elsif p_section = 'observation_plan' then update public.ai_execution_plans set observation_plan = p_value, updated_at = now() where id = p_id; v_event := 'observation_reviewed';
  elsif p_section = 'change_window' then
    update public.ai_execution_plans set
      change_window_start = nullif(p_value->>'start','')::timestamptz,
      change_window_end = nullif(p_value->>'end','')::timestamptz,
      change_window_meta = p_value->'meta', updated_at = now() where id = p_id;
    v_event := 'preflight_updated';
  elsif p_section = 'owners' then
    update public.ai_execution_plans set
      execution_owner = nullif(p_value->>'execution_owner',''),
      rollback_owner = nullif(p_value->>'rollback_owner',''),
      observation_owner = nullif(p_value->>'observation_owner',''), updated_at = now() where id = p_id;
    v_event := 'preflight_updated';
  elsif p_section = 'evidence' then update public.ai_execution_plans set evidence = coalesce(p_value,'[]'::jsonb), updated_at = now() where id = p_id; v_event := 'evidence_requested';
  else update public.ai_execution_plans set execution_steps = coalesce(p_value,'[]'::jsonb), updated_at = now() where id = p_id; v_event := 'preflight_updated';
  end if;

  insert into public.ai_execution_audit(plan_id, event_type, detail, actor_id) values (p_id, v_event, p_reason, auth.uid());
  select * into v_row from public.ai_execution_plans where id = p_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_execution_plan_update(uuid, text, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Go/No-Go Review — 서버 게이트(Rollback/Observation/Preflight/Owner/Window/
--    Critical Risk/Evidence). conditional_go 도 자동 실행 권한 아님.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_go_review(p_id uuid, p_decision text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_execution_plans; v_fail int; v_pending_required int;
begin
  perform public._admin_growth_guard();
  if p_decision is null or p_decision not in ('go','conditional_go','no_go','review_required') then raise exception 'invalid decision' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (Evidence 없는 Go 판정 금지)' using errcode='22023'; end if;
  select * into v_row from public.ai_execution_plans where id = p_id;
  if v_row.id is null then raise exception 'plan not found' using errcode='P0002'; end if;
  if v_row.plan_status in ('ready_for_manual_execution','no_go','rejected','cancelled','expired','completed_reference') then
    raise exception 'plan finalized' using errcode='22023';
  end if;

  if p_decision in ('go','conditional_go') then
    -- 준비 완료 게이트(Rollback/Observation 없는 실행 준비 완료 금지 등).
    if v_row.risk_tier = 'critical' then raise exception 'critical risk — 실행 준비 완료 금지' using errcode='22023'; end if;
    if v_row.rollback_plan is null then raise exception 'rollback plan required (Rollback Plan 없는 준비 완료 금지)' using errcode='22023'; end if;
    if v_row.observation_plan is null then raise exception 'observation plan required (Observation Plan 없는 준비 완료 금지)' using errcode='22023'; end if;
    if coalesce(v_row.execution_owner,'') = '' or coalesce(v_row.rollback_owner,'') = '' or coalesce(v_row.observation_owner,'') = '' then
      raise exception 'owners required (execution/rollback/observation)' using errcode='22023';
    end if;
    if v_row.change_window_start is null or v_row.change_window_end is null then raise exception 'change window required' using errcode='22023'; end if;
    if jsonb_array_length(v_row.evidence) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
    select count(*) into v_fail from jsonb_array_elements(v_row.preflight) i where i->>'status' = 'failed' and coalesce((i->>'required')::boolean, false);
    if v_fail > 0 then raise exception 'required preflight failed (% items)', v_fail using errcode='22023'; end if;
    select count(*) into v_pending_required from jsonb_array_elements(v_row.preflight) i where i->>'status' = 'pending' and coalesce((i->>'required')::boolean, false);
    if p_decision = 'go' and v_pending_required > 0 then raise exception 'required preflight pending (% items) — go 불가(conditional_go 검토)', v_pending_required using errcode='22023'; end if;
  end if;

  update public.ai_execution_plans set
    go_decision = p_decision, go_reason = p_reason,
    plan_status = case p_decision when 'go' then 'ready_for_manual_execution'
                                  when 'conditional_go' then 'go_review'
                                  when 'no_go' then 'no_go'
                                  else 'waiting_evidence' end,
    reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_execution_audit(plan_id, event_type, detail, actor_id)
  values (p_id, case p_decision when 'go' then 'go_approved' when 'conditional_go' then 'conditional_go_decided'
                                when 'no_go' then 'no_go_decided' else 'go_review_started' end, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_execution_go_review(uuid, text, text) to authenticated;

create or replace function public.admin_execution_cancel(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_execution_plans;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_execution_plans where id = p_id;
  if v_row.id is null then raise exception 'plan not found' using errcode='P0002'; end if;
  update public.ai_execution_plans set plan_status = 'cancelled', updated_at = now() where id = p_id returning * into v_row;
  insert into public.ai_execution_audit(plan_id, event_type, detail, actor_id) values (p_id, 'plan_cancelled', p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_execution_cancel(uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Manual Execution Reference — 외부/별도 절차 실행의 참고 기록만
--    (실행 버튼/Production API 호출 아님 · ready_for_manual_execution 에서만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_execution_manual_reference(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_execution_plans;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'external_change_id','') = '' or coalesce(p_payload->>'executed_by','') = '' then raise exception 'external_change_id/executed_by required' using errcode='22023'; end if;
  if coalesce(p_payload->>'execution_result','') not in ('succeeded','failed','partially','rolled_back') then raise exception 'invalid execution_result' using errcode='22023'; end if;
  select * into v_row from public.ai_execution_plans where id = p_id;
  if v_row.id is null then raise exception 'plan not found' using errcode='P0002'; end if;
  if v_row.plan_status <> 'ready_for_manual_execution' then raise exception 'plan not ready_for_manual_execution — 참고 기록 불가' using errcode='22023'; end if;
  update public.ai_execution_plans set manual_reference = p_payload, plan_status = 'completed_reference', updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_execution_audit(plan_id, event_type, detail, evidence, actor_id)
  values (p_id, 'manual_execution_reference_recorded', p_payload->>'external_change_id', coalesce(p_payload->'evidence','[]'::jsonb), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_execution_manual_reference(uuid, jsonb) to authenticated;

create or replace function public.admin_execution_audit(p_plan_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_execution_audit a where (p_plan_id is null or a.plan_id = p_plan_id)
    order by a.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_execution_audit(uuid, int) to authenticated;
