-- 0509_admin_ai_operational_command.sql
-- Phase AI-OPS-6 — Operational Command Center, Workload Intelligence,
-- Escalation Governance & Business Continuity Operations.
--
-- 실제 조직/업무 구조 분석 결과(추측 없음):
--   Role: users.role='admin'(_internal_is_admin_caller/_admin_growth_guard) 단일 관리자 Role —
--     approval/reviewer/executor 세분 Role·조직/팀/직원 테이블·연락처·근무시간/Shift 구조 없음
--   업무 Source(실존): ai_operations(0504)/ai_execution_plans(0505)/ai_post_change_observations
--     (0506)/ai_reliability_decisions(0507)/ai_capacity_plans(0508)/ai_incidents·
--     ai_recovery_candidates(0502)/ai_governance_events·ai_production_change_candidates(0496)
--   settlement/contract/content review 전용 큐·support ticket 구조: 미확인 → unsupported
--   알림: 자동 발송 엔진 없음(Edge Function 은 별도 수동 트리거) → 외부 알림은 Reference 만
--
-- 원칙:
--   * 자동 배정/자동 승인/자동 완료/자동 Escalation/자동 메시지 발송/자동 Emergency 없음
--   * Owner 는 실존+활성(users, withdrawn_at null) 계정만 — 없는 담당자를 배정 완료로 표시 금지
--   * SLA 기준 없으면 위반 계산 금지(sla_not_defined) · 초기 SLA Policy 임의 생성 없음(seed 0건)
--   * source_type+source_id 중복 등록 차단 · Source 내용 복제 없이 참조만
--   * AI 가 SLA/Escalation Policy·Role 을 직접 수정 불가 — 관리자 승인 + change_reason + Audit
--   * Trigger 없음 · 삭제 RPC 없음 · 외부 메시지/Calendar API 호출 없음

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 통합 Work Item — Source 참조 기반(복제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_work_items (
  id                  uuid primary key default gen_random_uuid(),
  work_item_code      text not null unique,
  source_type         text not null check (source_type in ('ai_operation','execution_plan','post_change_observation','reliability_decision','capacity_plan','incident','recovery_candidate','governance_event','production_change_candidate','manual_task')),
  source_id           text,
  work_type           text not null check (work_type in ('review','approval','investigation','incident_response','recovery_review','execution_preparation','observation','certification','reliability_review','capacity_review','cost_review','continuity_review','governance_review','manual_follow_up')),
  title               text not null,
  description         text,
  priority            text not null default 'normal' check (priority in ('low','normal','high','urgent','critical')),
  severity            text,
  work_status         text not null default 'new' check (work_status in ('new','triage','assigned','acknowledged','in_progress','waiting_evidence','waiting_approval','waiting_external','blocked','escalated','resolved','completed_reference','rejected','cancelled','expired','invalidated')),
  scope_type          text not null default 'global',
  scope_id            text,
  assigned_to         uuid references public.users(id),
  backup_assignee     uuid references public.users(id),
  reviewer_id         uuid references public.users(id),
  approver_id         uuid references public.users(id),
  sla_policy_id       uuid,
  due_at              timestamptz,
  response_due_at     timestamptz,
  resolution_due_at   timestamptz,
  sla_paused_at       timestamptz,
  sla_pause_reason    text check (sla_pause_reason is null or sla_pause_reason in ('waiting_evidence','waiting_external','waiting_approval','maintenance_window','legal_hold','customer_response')),
  acknowledged_at     timestamptz,
  started_at          timestamptz,
  completed_at        timestamptz,
  cancelled_at        timestamptz,
  source_version      text not null default 'opscmd_v1(0509)',
  input_hash          text not null,
  idempotency_key     text not null unique,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (source_type, source_id)
);
create index if not exists idx_ops_work on public.ai_operational_work_items (work_status, priority, created_at desc);
create index if not exists idx_ops_work_owner on public.ai_operational_work_items (assigned_to, work_status);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 운영 Policy — SLA / Escalation / Emergency Plan 통합(버전 관리).
--    초기 seed 없음 — 실제 운영 기준 없이 Policy 임의 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_policies (
  id                  uuid primary key default gen_random_uuid(),
  policy_code         text not null,
  policy_type         text not null check (policy_type in ('sla','escalation','emergency_plan')),
  work_type           text,
  priority            text check (priority is null or priority in ('low','normal','high','urgent','critical')),
  config              jsonb not null default '{}'::jsonb,   -- sla: response/resolution/escalation_after(minutes)·business_hours·timezone / escalation: trigger·levels·targets·cooldown / emergency: plan 전체
  lifecycle_status    text not null default 'draft' check (lifecycle_status in ('draft','pending_approval','active','superseded','archived','blocked')),
  version             int not null default 1 check (version >= 1),
  change_reason       text not null,
  checksum            text not null,
  previous_version_id uuid references public.ai_operational_policies(id),
  approved_by         uuid,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (policy_code, version)
);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Escalation 기록 — 권고/요청/확인만(메시지 발송 상태 없음).
--    외부 연락은 notification_references(jsonb) 참고 기록만.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_escalations (
  id                  uuid primary key default gen_random_uuid(),
  work_item_id        uuid not null references public.ai_operational_work_items(id),
  escalation_level    int not null default 1 check (escalation_level >= 1 and escalation_level <= 5),
  trigger_type        text not null check (trigger_type in ('sla_warning','sla_breach','critical_priority','active_critical_incident','no_owner','owner_inactive','approval_timeout','repeated_rejection','evidence_gap','rollback_recommendation','freeze_recommendation','capacity_critical','continuity_critical','unacknowledged_work','manual')),
  escalation_status   text not null default 'recommended' check (escalation_status in ('recommended','requested','acknowledged','declined','resolved_reference','cancelled','expired')),
  recommended_target  text,
  assigned_target     uuid references public.users(id),
  reason              text not null,
  notification_references jsonb not null default '[]'::jsonb,  -- 외부 연락 참고 기록(발송 API 호출 없음)
  acknowledged_by     uuid,
  acknowledged_at     timestamptz,
  resolved_at         timestamptz,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["자동 연락 발송 없음 — 실제 연락은 외부 수동 절차"]'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ops_esc on public.ai_operational_escalations (work_item_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Shift / Handover — 수동 등록(실제 Shift 데이터 없음 → provisional).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_shifts (
  id                  uuid primary key default gen_random_uuid(),
  shift_code          text not null unique,
  shift_date          date not null,
  timezone            text not null default 'Asia/Seoul',
  shift_start         timestamptz not null,
  shift_end           timestamptz not null check (shift_end > shift_start),
  primary_operator    uuid not null references public.users(id),
  backup_operator     uuid references public.users(id),
  escalation_operator uuid references public.users(id),
  scope               text not null default 'global',
  status              text not null default 'planned' check (status in ('planned','active_reference','completed_reference','cancelled')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["수동 등록 Shift — 근무시간 시스템 연동 없음(provisional)"]'::jsonb,
  created_by          uuid,
  approved_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create table if not exists public.ai_shift_handovers (
  id                  uuid primary key default gen_random_uuid(),
  from_shift_id       uuid references public.ai_operational_shifts(id),
  to_shift_id         uuid references public.ai_operational_shifts(id),
  snapshot            jsonb not null default '{}'::jsonb,   -- open work/incidents/pending approvals/rollback·freeze 권고 등
  handover_summary    text not null,
  unresolved_questions jsonb not null default '[]'::jsonb,
  status              text not null default 'pending_acceptance' check (status in ('pending_acceptance','accepted','declined','needs_evidence','cancelled')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  accepted_by         uuid,
  accepted_at         timestamptz,
  decline_reason      text,
  created_by          uuid,
  created_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Emergency Operating Mode Reference — 참고 기록만(실제 모드 실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_emergency_references (
  id                  uuid primary key default gen_random_uuid(),
  reference_code      text not null unique,
  mode_status         text not null check (mode_status in ('normal','heightened_monitoring','restricted_changes','emergency_operations_requested','emergency_reference_active','recovery_transition','invalidated')),
  scope               text not null,
  activation_trigger  text not null,
  decision_authority  text not null,                        -- 사람 결정 권한 필수
  plan_policy_id      uuid references public.ai_operational_policies(id),
  expires_at          timestamptz,
  reason              text not null,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["시스템이 Emergency Mode 를 실행하지 않음 — 외부 운영 정책 적용 참고 기록"]'::jsonb,
  created_by          uuid,
  created_at          timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 운영 Event(Audit) — 배정 이력/Priority Override/상태 변경 포함.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operational_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('work_enrolled','work_status_changed','priority_overridden','owner_assigned','owner_unassigned','policy_saved','escalation_recommended','escalation_requested','escalation_decided','notification_reference_recorded','shift_saved','handover_created','handover_accepted','handover_declined','emergency_reference_recorded','recommendation_generated')),
  work_item_id        uuid,
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_ops_evt on public.ai_operational_events (event_type, created_at desc);
create index if not exists idx_ops_evt_work on public.ai_operational_events (work_item_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Work Item 등록 — Source 실존 검증 + 중복/Idempotency 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_work_enroll(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_source_type text := p_payload->>'source_type'; v_source_id text := nullif(p_payload->>'source_id',''); v_exists boolean := false;
        v_existing public.ai_operational_work_items; v_row public.ai_operational_work_items;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'work_item_code','') = '' or coalesce(p_payload->>'title','') = '' or coalesce(p_payload->>'idempotency_key','') = '' then
    raise exception 'work_item_code/title/idempotency_key 필수' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;

  -- Source 실존 검증(참조만 — 복제 없음). manual_task 는 source_id 불필요.
  if v_source_type = 'manual_task' then v_exists := true;
  elsif v_source_id is null then raise exception 'source_id required' using errcode='22023';
  elsif v_source_type = 'ai_operation' then select exists(select 1 from public.ai_operations where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'execution_plan' then select exists(select 1 from public.ai_execution_plans where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'post_change_observation' then select exists(select 1 from public.ai_post_change_observations where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'reliability_decision' then select exists(select 1 from public.ai_reliability_decisions where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'capacity_plan' then select exists(select 1 from public.ai_capacity_plans where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'incident' then select exists(select 1 from public.ai_incidents where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'recovery_candidate' then select exists(select 1 from public.ai_recovery_candidates where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'governance_event' then select exists(select 1 from public.ai_governance_events where id = v_source_id::uuid) into v_exists;
  elsif v_source_type = 'production_change_candidate' then select exists(select 1 from public.ai_production_change_candidates where id = v_source_id::uuid) into v_exists;
  else raise exception 'source_type % 미지원', coalesce(v_source_type,'null') using errcode='22023';
  end if;
  if not v_exists then raise exception 'source 미존재 — 존재하지 않는 업무 등록 금지' using errcode='P0002'; end if;

  select * into v_existing from public.ai_operational_work_items where idempotency_key = p_payload->>'idempotency_key';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'work_item', to_jsonb(v_existing)); end if;
  if v_source_id is not null then
    select * into v_existing from public.ai_operational_work_items where source_type = v_source_type and source_id = v_source_id;
    if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'work_item', to_jsonb(v_existing)); end if;
  end if;

  insert into public.ai_operational_work_items (work_item_code, source_type, source_id, work_type, title, description, priority, severity, scope_type, scope_id, due_at, input_hash, idempotency_key, evidence, limitations, created_by)
  values (p_payload->>'work_item_code', v_source_type, v_source_id, coalesce(nullif(p_payload->>'work_type',''),'review'),
    p_payload->>'title', nullif(p_payload->>'description',''),
    coalesce(nullif(p_payload->>'priority',''),'normal'), nullif(p_payload->>'severity',''),
    coalesce(nullif(p_payload->>'scope_type',''),'global'), nullif(p_payload->>'scope_id',''),
    nullif(p_payload->>'due_at','')::timestamptz,
    md5(coalesce(v_source_type,'') || '|' || coalesce(v_source_id,'') || '|' || coalesce(p_payload->>'work_item_code','')),
    p_payload->>'idempotency_key', p_payload->'evidence',
    coalesce(p_payload->'limitations','["Source 원본은 기존 엔진에서 관리 — 여기서는 참조/추적만"]'::jsonb), auth.uid())
  returning * into v_row;
  insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_enrolled', v_row.id, v_row.title, auth.uid());
  return jsonb_build_object('idempotent', false, 'work_item', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ops_work_enroll(jsonb) to authenticated;

create or replace function public.admin_ops_work_items(p_status text default null, p_priority text default null, p_assigned uuid default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select w.* from public.ai_operational_work_items w
    where (p_status is null or w.work_status = p_status) and (p_priority is null or w.priority = p_priority)
      and (p_assigned is null or w.assigned_to = p_assigned)
    order by w.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_work_items(text, text, uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 상태 변경 / Priority Override / SLA Pause — 사유 필수, 금지 상태 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_work_update(p_id uuid, p_section text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operational_work_items; v_new_status text; v_new_priority text;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required (사유 없는 변경 금지)' using errcode='22023'; end if;
  if p_section is null or p_section not in ('status','priority_override','acknowledge','sla_pause','sla_resume','sla_policy') then raise exception 'invalid section' using errcode='22023'; end if;
  select * into v_row from public.ai_operational_work_items where id = p_id;
  if v_row.id is null then raise exception 'work item not found' using errcode='P0002'; end if;
  if v_row.work_status in ('cancelled','expired','invalidated') then raise exception 'work item finalized' using errcode='22023'; end if;

  if p_section = 'status' then
    v_new_status := p_value->>'status';
    if v_new_status is null or v_new_status not in ('new','triage','assigned','acknowledged','in_progress','waiting_evidence','waiting_approval','waiting_external','blocked','escalated','resolved','completed_reference','rejected','cancelled','expired','invalidated') then
      raise exception 'invalid status(자동 완료/자동 승인 상태 없음)' using errcode='22023';
    end if;
    update public.ai_operational_work_items set work_status = v_new_status,
      completed_at = case when v_new_status in ('resolved','completed_reference') then now() else completed_at end,
      cancelled_at = case when v_new_status = 'cancelled' then now() else cancelled_at end,
      updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_status_changed', p_id, format('%s → %s — %s', v_row.work_status, v_new_status, p_reason), auth.uid());
  elsif p_section = 'priority_override' then
    v_new_priority := p_value->>'priority';
    if v_new_priority is null or v_new_priority not in ('low','normal','high','urgent','critical') then raise exception 'invalid priority' using errcode='22023'; end if;
    update public.ai_operational_work_items set priority = v_new_priority, updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, payload, actor_id)
    values ('priority_overridden', p_id, p_reason, jsonb_build_object('previous', v_row.priority, 'new', v_new_priority), auth.uid());
  elsif p_section = 'acknowledge' then
    update public.ai_operational_work_items set acknowledged_at = now(), work_status = case when work_status in ('new','triage','assigned') then 'acknowledged' else work_status end, updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_status_changed', p_id, format('acknowledged — %s', p_reason), auth.uid());
  elsif p_section = 'sla_pause' then
    if coalesce(p_value->>'pause_reason','') not in ('waiting_evidence','waiting_external','waiting_approval','maintenance_window','legal_hold','customer_response') then raise exception 'invalid pause reason' using errcode='22023'; end if;
    if v_row.sla_paused_at is not null then raise exception '이미 pause 상태 — 무제한 중첩 pause 금지' using errcode='22023'; end if;
    update public.ai_operational_work_items set sla_paused_at = now(), sla_pause_reason = p_value->>'pause_reason', updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_status_changed', p_id, format('SLA pause(%s) — %s', p_value->>'pause_reason', p_reason), auth.uid());
  elsif p_section = 'sla_resume' then
    update public.ai_operational_work_items set sla_paused_at = null, sla_pause_reason = null, updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_status_changed', p_id, format('SLA resume — %s', p_reason), auth.uid());
  else
    update public.ai_operational_work_items set sla_policy_id = nullif(p_value->>'sla_policy_id','')::uuid,
      response_due_at = nullif(p_value->>'response_due_at','')::timestamptz,
      resolution_due_at = nullif(p_value->>'resolution_due_at','')::timestamptz, updated_at = now() where id = p_id;
    insert into public.ai_operational_events(event_type, work_item_id, detail, actor_id) values ('work_status_changed', p_id, format('SLA policy 연결 — %s', p_reason), auth.uid());
  end if;
  select * into v_row from public.ai_operational_work_items where id = p_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_work_update(uuid, text, jsonb, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 담당자 배정 — 실존+활성 계정만, 자동 배정 없음(사람 지정만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_assign(p_id uuid, p_role text, p_user_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operational_work_items; v_active boolean;
begin
  perform public._admin_growth_guard();
  if p_role is null or p_role not in ('owner','backup','reviewer','approver') then raise exception 'invalid role' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (사유 없는 배정 변경 금지)' using errcode='22023'; end if;
  select * into v_row from public.ai_operational_work_items where id = p_id;
  if v_row.id is null then raise exception 'work item not found' using errcode='P0002'; end if;
  if p_user_id is not null then
    select (withdrawn_at is null) into v_active from public.users where id = p_user_id;
    if v_active is null then raise exception '담당자 계정 미존재 — 없는 담당자 배정 금지' using errcode='P0002'; end if;
    if not v_active then raise exception '비활성(탈퇴) 계정 배정 금지' using errcode='22023'; end if;
  end if;
  update public.ai_operational_work_items set
    assigned_to = case when p_role = 'owner' then p_user_id else assigned_to end,
    backup_assignee = case when p_role = 'backup' then p_user_id else backup_assignee end,
    reviewer_id = case when p_role = 'reviewer' then p_user_id else reviewer_id end,
    approver_id = case when p_role = 'approver' then p_user_id else approver_id end,
    work_status = case when p_role = 'owner' and p_user_id is not null and work_status in ('new','triage') then 'assigned' else work_status end,
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_operational_events(event_type, work_item_id, detail, payload, actor_id)
  values (case when p_user_id is null then 'owner_unassigned' else 'owner_assigned' end, p_id, format('%s — %s', p_role, p_reason), jsonb_build_object('role', p_role, 'user_id', p_user_id), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_assign(uuid, text, uuid, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Policy 저장(SLA/Escalation/Emergency Plan — 버전 관리, AI 수정 불가).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_policy_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_prev public.ai_operational_policies; v_row public.ai_operational_policies; v_version int := 1;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'policy_code','') = '' then raise exception 'policy_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'policy_type','') not in ('sla','escalation','emergency_plan') then raise exception 'invalid policy_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'change_reason','') = '' then raise exception 'change_reason required (사람 승인 없는 Policy 변경 금지)' using errcode='22023'; end if;
  select * into v_prev from public.ai_operational_policies where policy_code = p_payload->>'policy_code' order by version desc limit 1;
  if v_prev.id is not null then
    v_version := v_prev.version + 1;
    update public.ai_operational_policies set lifecycle_status = 'superseded', updated_at = now() where id = v_prev.id and lifecycle_status in ('draft','pending_approval','active');
  end if;
  insert into public.ai_operational_policies (policy_code, policy_type, work_type, priority, config, lifecycle_status, version, change_reason, checksum, previous_version_id, approved_by, created_by)
  values (p_payload->>'policy_code', p_payload->>'policy_type', nullif(p_payload->>'work_type',''), nullif(p_payload->>'priority',''),
    coalesce(p_payload->'config','{}'::jsonb), coalesce(nullif(p_payload->>'lifecycle_status',''),'draft'), v_version,
    p_payload->>'change_reason', md5(coalesce(p_payload->>'policy_code','') || '|' || v_version::text || '|' || coalesce(p_payload->'config','{}'::jsonb)::text),
    v_prev.id, case when coalesce(nullif(p_payload->>'lifecycle_status',''),'draft') = 'active' then auth.uid() end, auth.uid())
  returning * into v_row;
  insert into public.ai_operational_events(event_type, ref_id, detail, actor_id) values ('policy_saved', v_row.id, format('%s %s v%s', v_row.policy_type, v_row.policy_code, v_version), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_policy_save(jsonb) to authenticated;

create or replace function public.admin_ops_policies(p_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_operational_policies p where (p_type is null or p.policy_type = p_type)
    order by p.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_policies(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Escalation — 요청/결정/외부 연락 Reference(발송 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_escalation_request(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operational_escalations;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'reason','') = '' then raise exception 'reason required' using errcode='22023'; end if;
  if not exists (select 1 from public.ai_operational_work_items where id = (p_payload->>'work_item_id')::uuid) then raise exception 'work item not found' using errcode='P0002'; end if;
  insert into public.ai_operational_escalations (work_item_id, escalation_level, trigger_type, escalation_status, recommended_target, reason, evidence, created_by)
  values ((p_payload->>'work_item_id')::uuid, greatest(1, least(coalesce((p_payload->>'escalation_level')::int, 1), 5)),
    coalesce(nullif(p_payload->>'trigger_type',''),'manual'), coalesce(nullif(p_payload->>'escalation_status',''),'requested'),
    nullif(p_payload->>'recommended_target',''), p_payload->>'reason', coalesce(p_payload->'evidence','[]'::jsonb), auth.uid())
  returning * into v_row;
  update public.ai_operational_work_items set work_status = 'escalated', updated_at = now()
  where id = v_row.work_item_id and work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated');
  insert into public.ai_operational_events(event_type, work_item_id, ref_id, detail, actor_id) values ('escalation_requested', v_row.work_item_id, v_row.id, p_payload->>'reason', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_escalation_request(jsonb) to authenticated;

create or replace function public.admin_ops_escalation_decision(p_id uuid, p_section text, p_value jsonb, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operational_escalations;
begin
  perform public._admin_growth_guard();
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  if p_section is null or p_section not in ('decision','notification_reference') then raise exception 'invalid section' using errcode='22023'; end if;
  select * into v_row from public.ai_operational_escalations where id = p_id;
  if v_row.id is null then raise exception 'escalation not found' using errcode='P0002'; end if;

  if p_section = 'decision' then
    if coalesce(p_value->>'status','') not in ('requested','acknowledged','declined','resolved_reference','cancelled','expired') then raise exception 'invalid decision status' using errcode='22023'; end if;
    update public.ai_operational_escalations set escalation_status = p_value->>'status',
      assigned_target = coalesce(nullif(p_value->>'assigned_target','')::uuid, assigned_target),
      acknowledged_by = case when p_value->>'status' = 'acknowledged' then auth.uid() else acknowledged_by end,
      acknowledged_at = case when p_value->>'status' = 'acknowledged' then now() else acknowledged_at end,
      resolved_at = case when p_value->>'status' = 'resolved_reference' then now() else resolved_at end
    where id = p_id returning * into v_row;
    insert into public.ai_operational_events(event_type, work_item_id, ref_id, detail, actor_id) values ('escalation_decided', v_row.work_item_id, p_id, format('%s — %s', p_value->>'status', p_reason), auth.uid());
  else
    -- 외부 연락 참고 기록만(발송 API 호출 없음). channel whitelist.
    if coalesce(p_value->>'channel','') not in ('email_reference','slack_reference','sms_reference','phone_reference','messenger_reference','in_app_reference') then raise exception 'invalid channel(참고 기록 전용)' using errcode='22023'; end if;
    if coalesce(p_value->>'sent_by','') = '' or coalesce(p_value->>'sent_at','') = '' then raise exception 'sent_by/sent_at 필수(외부 수행 기록)' using errcode='22023'; end if;
    update public.ai_operational_escalations set notification_references = notification_references || jsonb_build_array(p_value) where id = p_id returning * into v_row;
    insert into public.ai_operational_events(event_type, work_item_id, ref_id, detail, actor_id) values ('notification_reference_recorded', v_row.work_item_id, p_id, format('%s — %s', p_value->>'channel', p_reason), auth.uid());
  end if;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_escalation_decision(uuid, text, jsonb, text) to authenticated;

create or replace function public.admin_ops_escalations(p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select e.*, w.work_item_code, w.title from public.ai_operational_escalations e
    join public.ai_operational_work_items w on w.id = e.work_item_id
    where (p_status is null or e.escalation_status = p_status)
    order by e.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_escalations(text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 12) Shift / Handover — 수동 생성, 수신자 확인 필수(자동 수락 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_shift_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_operational_shifts; v_active boolean;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'shift_code','') = '' then raise exception 'shift_code required' using errcode='22023'; end if;
  select (withdrawn_at is null) into v_active from public.users where id = (p_payload->>'primary_operator')::uuid;
  if v_active is null or not v_active then raise exception 'primary operator 실존·활성 계정 필수' using errcode='22023'; end if;
  insert into public.ai_operational_shifts (shift_code, shift_date, timezone, shift_start, shift_end, primary_operator, backup_operator, escalation_operator, scope, evidence, created_by, approved_by)
  values (p_payload->>'shift_code', (p_payload->>'shift_date')::date, coalesce(nullif(p_payload->>'timezone',''),'Asia/Seoul'),
    (p_payload->>'shift_start')::timestamptz, (p_payload->>'shift_end')::timestamptz,
    (p_payload->>'primary_operator')::uuid, nullif(p_payload->>'backup_operator','')::uuid, nullif(p_payload->>'escalation_operator','')::uuid,
    coalesce(nullif(p_payload->>'scope',''),'global'), coalesce(p_payload->'evidence','[]'::jsonb), auth.uid(), auth.uid())
  on conflict (shift_code) do update set backup_operator = excluded.backup_operator, escalation_operator = excluded.escalation_operator, updated_at = now()
  returning * into v_row;
  insert into public.ai_operational_events(event_type, ref_id, detail, actor_id) values ('shift_saved', v_row.id, v_row.shift_code, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_shift_save(jsonb) to authenticated;

create or replace function public.admin_ops_shifts(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.shift_date desc, t.shift_start desc), '[]'::jsonb) into v_items from (
    select * from public.ai_operational_shifts order by shift_date desc, shift_start desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_shifts(int) to authenticated;

create or replace function public.admin_ops_handover_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_shift_handovers; v_snapshot jsonb;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 131072 then raise exception 'payload too large (128KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'handover_summary','') = '' then raise exception 'handover_summary required' using errcode='22023'; end if;
  -- Handover snapshot: 미처리 Critical/Incident/승인 대기 실측 집계(참조).
  select jsonb_build_object(
    'open_work_items', (select count(*) from public.ai_operational_work_items where work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'critical_open', (select count(*) from public.ai_operational_work_items where priority = 'critical' and work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'waiting_approval', (select count(*) from public.ai_operational_work_items where work_status = 'waiting_approval'),
    'waiting_evidence', (select count(*) from public.ai_operational_work_items where work_status = 'waiting_evidence'),
    'active_incidents', (select count(*) from public.ai_incidents where resolved_at is null),
    'rollback_recommendations', (select count(*) from public.ai_post_change_observations where certification_result = 'rollback_recommended'),
    'freeze_recommendations', (select count(*) from public.ai_reliability_decisions where decision_type = 'freeze_decision' and decision = 'temporary_freeze_requested'),
    'open_escalations', (select count(*) from public.ai_operational_escalations where escalation_status in ('recommended','requested'))
  ) into v_snapshot;
  insert into public.ai_shift_handovers (from_shift_id, to_shift_id, snapshot, handover_summary, unresolved_questions, evidence, created_by)
  values (nullif(p_payload->>'from_shift_id','')::uuid, nullif(p_payload->>'to_shift_id','')::uuid, v_snapshot,
    p_payload->>'handover_summary', coalesce(p_payload->'unresolved_questions','[]'::jsonb), coalesce(p_payload->'evidence','[]'::jsonb), auth.uid())
  returning * into v_row;
  insert into public.ai_operational_events(event_type, ref_id, detail, actor_id) values ('handover_created', v_row.id, p_payload->>'handover_summary', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_handover_create(jsonb) to authenticated;

create or replace function public.admin_ops_handover_accept(p_id uuid, p_action text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_shift_handovers;
begin
  perform public._admin_growth_guard();
  if p_action is null or p_action not in ('accepted','declined','needs_evidence','cancelled') then raise exception 'invalid action' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (수신자 확인 없이 인수 완료 처리 금지)' using errcode='22023'; end if;
  select * into v_row from public.ai_shift_handovers where id = p_id;
  if v_row.id is null then raise exception 'handover not found' using errcode='P0002'; end if;
  if v_row.status not in ('pending_acceptance','needs_evidence') then raise exception 'handover finalized' using errcode='22023'; end if;
  update public.ai_shift_handovers set status = p_action,
    accepted_by = case when p_action = 'accepted' then auth.uid() else accepted_by end,
    accepted_at = case when p_action = 'accepted' then now() else accepted_at end,
    decline_reason = case when p_action in ('declined','needs_evidence') then p_reason else decline_reason end
  where id = p_id returning * into v_row;
  insert into public.ai_operational_events(event_type, ref_id, detail, actor_id)
  values (case when p_action = 'accepted' then 'handover_accepted' else 'handover_declined' end, p_id, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_handover_accept(uuid, text, text) to authenticated;

create or replace function public.admin_ops_handovers(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_shift_handovers order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_handovers(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 13) Emergency Reference — 참고 기록만(실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_emergency_reference(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_emergency_references;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'reference_code','') = '' or coalesce(p_payload->>'scope','') = '' or coalesce(p_payload->>'activation_trigger','') = ''
     or coalesce(p_payload->>'decision_authority','') = '' or coalesce(p_payload->>'reason','') = '' then
    raise exception 'reference_code/scope/activation_trigger/decision_authority/reason 필수' using errcode='22023';
  end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  insert into public.ai_emergency_references (reference_code, mode_status, scope, activation_trigger, decision_authority, plan_policy_id, expires_at, reason, evidence, created_by)
  values (p_payload->>'reference_code', coalesce(nullif(p_payload->>'mode_status',''),'heightened_monitoring'),
    p_payload->>'scope', p_payload->>'activation_trigger', p_payload->>'decision_authority',
    nullif(p_payload->>'plan_policy_id','')::uuid, nullif(p_payload->>'expires_at','')::timestamptz,
    p_payload->>'reason', p_payload->'evidence', auth.uid())
  on conflict (reference_code) do update set mode_status = excluded.mode_status, expires_at = excluded.expires_at, reason = excluded.reason
  returning * into v_row;
  insert into public.ai_operational_events(event_type, ref_id, detail, actor_id) values ('emergency_reference_recorded', v_row.id, format('%s — %s', v_row.mode_status, v_row.reason), auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ops_emergency_reference(jsonb) to authenticated;

create or replace function public.admin_ops_emergency_references(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,50), 200)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_emergency_references order by created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_emergency_references(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 14) 요약 / 운영자 현황 / Audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ops_command_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'open_total', count(*) filter (where work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'unassigned', count(*) filter (where assigned_to is null and work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'critical_open', count(*) filter (where priority = 'critical' and work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'urgent_open', count(*) filter (where priority = 'urgent' and work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')),
    'waiting_approval', count(*) filter (where work_status = 'waiting_approval'),
    'waiting_evidence', count(*) filter (where work_status = 'waiting_evidence'),
    'escalated', count(*) filter (where work_status = 'escalated'),
    'by_status', (select coalesce(jsonb_object_agg(work_status, n), '{}'::jsonb) from (select work_status, count(*) n from public.ai_operational_work_items group by work_status) x),
    'active_admins', (select count(*) from public.users where role = 'admin' and withdrawn_at is null),
    'open_escalations', (select count(*) from public.ai_operational_escalations where escalation_status in ('recommended','requested')),
    'pending_handovers', (select count(*) from public.ai_shift_handovers where status = 'pending_acceptance'),
    'emergency_references_active', (select count(*) from public.ai_emergency_references where mode_status in ('emergency_operations_requested','emergency_reference_active','restricted_changes') and (expires_at is null or expires_at > now())),
    'generated_at', now()
  ) into v from public.ai_operational_work_items;
  return v;
end; $$;
grant execute on function public.admin_ops_command_summary() to authenticated;

create or replace function public.admin_ops_operators()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  perform public._admin_growth_guard();
  -- 운영자(admin) 목록 + 담당 업무량 실측. 근무시간/휴가 연동 없음 → availability 'unknown'.
  select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) into v_items from (
    select u.id, u.email, (u.withdrawn_at is null) as is_active, 'unknown' as availability,
      (select count(*) from public.ai_operational_work_items w where w.assigned_to = u.id and w.work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')) as open_assigned,
      (select count(*) from public.ai_operational_work_items w where w.assigned_to = u.id and w.priority in ('urgent','critical') and w.work_status not in ('resolved','completed_reference','rejected','cancelled','expired','invalidated')) as urgent_assigned
    from public.users u where u.role = 'admin'
  ) t;
  return jsonb_build_object('items', v_items, 'note', '근무시간/휴가 연동 없음 — availability 는 unknown(임의 판단 금지)', 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_operators() to authenticated;

create or replace function public.admin_ops_audit(p_work_item_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_operational_events e where (p_work_item_id is null or e.work_item_id = p_work_item_id)
    order by e.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ops_audit(uuid, int) to authenticated;
