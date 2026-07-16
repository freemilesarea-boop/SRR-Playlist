-- 0534_admin_ai_governance_orchestration.sql
-- Phase AI-OPS-31 — Enterprise Autonomous Governance, AI Orchestration &
-- Human Oversight Center.
--
-- 실제 구조 분석 결과(추측 없음):
--   * ai_agents(0497) — 음악 도메인 Agent 8종 실존(reputation/decisions/wins/losses).
--   * ai_agent_collaboration(0497) — opinions/consensus_type(5종)/consensus_score/conflicts 실존.
--   * ai_governance_events(0496) — approval/rejection/human_override/violation_detected 실존.
--   * ai_constitution_rules(0496) — HUMAN_APPROVAL_REQUIRED 등 immutable rule 실존.
--   * ai_decision_memory(0514)/ai_enterprise_policies(0512)/ai_executive_os_events(0533) 실존.
--   본 Phase 는 위 원본을 전부 읽기 전용으로 참조하며 원본을 변경하지 않는다.
--   신규는 Enterprise 계층 Orchestration Agent 레지스트리 + 이벤트 2개 테이블만.
--   (테이블명 충돌 방지 — ai_governance_events(0496)와 별개인 ai_orchestration_events.)
--
-- AI Governance 정직성(전부 강제):
--   * 자동 승인/자동 Agent 생성·삭제/자동 조직·전략 변경/자동 Production·Merge·Deploy 없음.
--   * AI Consensus ≠ Truth. Recommendation ≠ Approval. Agent Agreement ≠ Correctness.
--   * Confidence ≠ Accuracy. Conflict ≠ Error(충돌은 오류가 아니라 검토 대상).
--   * Approval 은 항상 사람 — approval 없는 workflow execution 기록 차단(서버 게이트).
--   * oversight 승인/반려는 Evidence 필수. Unknown 유지(null→0 금지).
--   * 근거 부족 governance_unverified. Trigger 없음 · 삭제 RPC 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Orchestration Agent 레지스트리(7종 kind·4종 status).
--    등록/상태 변경은 전부 사람 RPC — 자동 생성/삭제 없음(삭제 RPC 자체가 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_orchestration_agents (
  id              uuid primary key default gen_random_uuid(),
  agent_kind      text not null check (agent_kind in ('executive','strategy','finance','market','risk','resource','knowledge')),
  agent_name      text not null,
  agent_status    text not null default 'unknown' check (agent_status in ('active','paused','disabled','unknown')),
  note            text,
  linked_source   text,   -- 읽기 전용 참조(예: '0533 summary' · '0497 ai_agents') — 실행 권한 아님
  idempotency_key text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (agent_kind, agent_name)
);
create unique index if not exists uq_orch_agent_idem on public.ai_orchestration_agents (idempotency_key) where idempotency_key is not null;
create index if not exists idx_orch_agent_status on public.ai_orchestration_agents (agent_status, agent_kind);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Orchestration/Governance 이벤트(16종 whitelist) — Oversight/Workflow 상태 포함.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_orchestration_events (
  id               uuid primary key default gen_random_uuid(),
  event_type       text not null check (event_type in ('agent_registered','agent_status_changed','task_routed','agent_assigned','dependency_tracked','result_aggregated','conflict_detected','consensus_analyzed','oversight_requested','oversight_approved','oversight_rejected','oversight_escalated','workflow_stage_advanced','orchestration_advisory_created','external_governance_reference','governance_os_noted')),
  agent_id         uuid,
  workflow_key     text,
  workflow_stage   text check (workflow_stage is null or workflow_stage in ('proposal','review','discussion','approval','execution')),
  oversight_status text check (oversight_status is null or oversight_status in ('pending_review','approved','rejected','escalated')),
  detail           text,
  payload          jsonb,
  actor_id         uuid,
  created_at       timestamptz not null default now()
);
create index if not exists idx_orch_evt on public.ai_orchestration_events (event_type, created_at desc);
create index if not exists idx_orch_evt_wf on public.ai_orchestration_events (workflow_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Agent 등록(사람 전용 — 자동 생성 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_orchestration_agent_register(p_kind text, p_name text, p_note text default null, p_linked_source text default null, p_idempotency_key text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_existing public.ai_orchestration_agents;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('executive','strategy','finance','market','risk','resource','knowledge') then raise exception '허용되지 않는 agent kind'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'Agent 이름 필수'; end if;
  if p_idempotency_key is not null then
    select * into v_existing from public.ai_orchestration_agents where idempotency_key = p_idempotency_key;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'auto_created', false); end if;
  end if;
  insert into public.ai_orchestration_agents (agent_kind, agent_name, agent_status, note, linked_source, idempotency_key, created_by)
  values (p_kind, left(btrim(p_name), 120), 'unknown', nullif(btrim(coalesce(p_note,'')),''), nullif(btrim(coalesce(p_linked_source,'')),''), p_idempotency_key, v_uid)
  returning id into v_id;
  -- 신규 Agent 는 실측 전이므로 unknown 으로 시작(active 강제 시작 금지).
  insert into public.ai_orchestration_events (event_type, agent_id, detail, payload, actor_id)
  values ('agent_registered', v_id, left(p_kind || ' agent 등록(사람) — unknown 시작', 200), jsonb_build_object('kind', p_kind), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'auto_created', false, 'initial_status', 'unknown', 'agent_executed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Agent 상태 변경(사람 전용·Reason 필수 — 자동 삭제 없음, disabled 도 기록 유지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_orchestration_agent_set_status(p_agent_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_agent public.ai_orchestration_agents; v_before text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active','paused','disabled','unknown') then raise exception '허용되지 않는 status'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Oversight)'; end if;
  select * into v_agent from public.ai_orchestration_agents where id = p_agent_id;
  if v_agent.id is null then raise exception 'Agent 없음(실존 검증 실패)'; end if;
  v_before := v_agent.agent_status;
  update public.ai_orchestration_agents set agent_status = p_status, updated_at = now() where id = p_agent_id;
  insert into public.ai_orchestration_events (event_type, agent_id, detail, payload, actor_id)
  values ('agent_status_changed', p_agent_id, left(p_reason, 200) || format(' (%s→%s·사람 결정)', v_before, p_status), jsonb_build_object('before', v_before, 'after', p_status), v_uid);
  return jsonb_build_object('ok', true, 'id', p_agent_id, 'before', v_before, 'after', p_status, 'auto_approved', false, 'agent_deleted', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 이벤트 기록(16종) — Oversight/Workflow 정직성 서버 게이트.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_orchestration_event_record(p_kind text, p_reason text, p_payload jsonb, p_agent_id uuid default null, p_workflow_key text default null, p_workflow_stage text default null, p_oversight_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_conflict_type text; v_approvals int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('agent_registered','agent_status_changed','task_routed','agent_assigned','dependency_tracked','result_aggregated','conflict_detected','consensus_analyzed','oversight_requested','oversight_approved','oversight_rejected','oversight_escalated','workflow_stage_advanced','orchestration_advisory_created','external_governance_reference','governance_os_noted') then raise exception '허용되지 않는 kind'; end if;
  if p_kind in ('agent_registered','agent_status_changed') then raise exception '등록/상태 변경은 전용 RPC 로만 기록'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  if p_workflow_stage is not null and p_workflow_stage not in ('proposal','review','discussion','approval','execution') then raise exception '허용되지 않는 workflow stage'; end if;
  if p_oversight_status is not null and p_oversight_status not in ('pending_review','approved','rejected','escalated') then raise exception '허용되지 않는 oversight status'; end if;
  if p_agent_id is not null and not exists (select 1 from public.ai_orchestration_agents where id = p_agent_id) then raise exception 'Agent 없음(실존 검증 실패)'; end if;

  -- 정직성 게이트 1: oversight 승인/반려는 Evidence 필수(사람 근거 없는 판정 금지).
  if p_kind in ('oversight_approved','oversight_rejected') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인/반려 금지(governance_unverified)';
    end if;
  end if;
  -- 정직성 게이트 2: conflict 는 4종 whitelist — 자동 해결 없음(기록만).
  if p_kind = 'conflict_detected' then
    v_conflict_type := nullif(p_payload->>'conflict_type','');
    if v_conflict_type is null or v_conflict_type not in ('recommendation_conflict','evidence_conflict','policy_conflict','strategy_conflict') then
      raise exception '허용되지 않는 conflict_type';
    end if;
  end if;
  -- 정직성 게이트 3: workflow execution 은 같은 workflow_key 의 사람 approval 기록 없이는 금지.
  if p_kind = 'workflow_stage_advanced' then
    if p_workflow_stage is null then raise exception 'workflow_stage 필수'; end if;
    if p_workflow_key is null or btrim(p_workflow_key) = '' then raise exception 'workflow_key 필수'; end if;
    if p_workflow_stage = 'approval' then
      if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
        raise exception 'Evidence 없는 Approval 기록 금지(Approval 은 항상 사람)';
      end if;
    end if;
    if p_workflow_stage = 'execution' then
      select count(*) into v_approvals from public.ai_orchestration_events
      where event_type = 'workflow_stage_advanced' and workflow_key = p_workflow_key and workflow_stage = 'approval';
      if v_approvals = 0 then raise exception 'Approval 없는 Execution 기록 금지(사람 승인 선행 필수)'; end if;
    end if;
  end if;

  insert into public.ai_orchestration_events (event_type, agent_id, workflow_key, workflow_stage, oversight_status, detail, payload, actor_id)
  values (p_kind, p_agent_id, nullif(btrim(coalesce(p_workflow_key,'')),''), p_workflow_stage, p_oversight_status,
    left(p_reason, 200) || case
      when p_kind = 'consensus_analyzed' then ' (AI Consensus ≠ Truth·Agreement ≠ Correctness)'
      when p_kind = 'conflict_detected' then ' (Conflict ≠ Error·자동 해결 없음)'
      when p_kind = 'orchestration_advisory_created' then ' (Recommendation ≠ Approval)'
      when p_kind = 'oversight_escalated' then ' (Escalation — 사람 결정 대기)'
      when p_kind = 'result_aggregated' then ' (Result ≠ Decision·자동 적용 없음)'
      when p_kind = 'task_routed' then ' (Routing 계획 기록 — 자동 실행 없음)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_approved', false, 'auto_resolved', false, 'agent_executed', false, 'human_decision_required', true, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Agent 목록 / 통합 Summary / Audit(전부 읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_orchestration_agents(p_limit int default 100)
returns setof public.ai_orchestration_agents language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_orchestration_agents order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_orchestration_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    -- 신규 레지스트리 실측:
    'orchestration_agents', jsonb_build_object(
      'total', (select count(*) from public.ai_orchestration_agents),
      'active', (select count(*) from public.ai_orchestration_agents where agent_status = 'active'),
      'paused', (select count(*) from public.ai_orchestration_agents where agent_status = 'paused'),
      'disabled', (select count(*) from public.ai_orchestration_agents where agent_status = 'disabled'),
      'unknown', (select count(*) from public.ai_orchestration_agents where agent_status = 'unknown')
    ),
    'oversight', jsonb_build_object(
      'requested', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_requested'),
      'approved', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_approved'),
      'rejected', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_rejected'),
      'escalated', (select count(*) from public.ai_orchestration_events where event_type = 'oversight_escalated'),
      'conflicts_detected', (select count(*) from public.ai_orchestration_events where event_type = 'conflict_detected')
    ),
    -- 기존 Multi-Agent 실측(0497 — 읽기 전용, 원본 미변경):
    'music_agents_0497', jsonb_build_object(
      'total', (select count(*) from public.ai_agents),
      'active', (select count(*) from public.ai_agents where is_active),
      'decisions_sum', (select coalesce(sum(decisions), 0) from public.ai_agents),
      'collaborations', (select count(*) from public.ai_agent_collaboration),
      'collaborations_with_conflicts', (select count(*) from public.ai_agent_collaboration where jsonb_array_length(conflicts) > 0),
      'consensus_distribution', (select coalesce(jsonb_object_agg(consensus_type, cnt), '{}'::jsonb) from (select consensus_type, count(*) as cnt from public.ai_agent_collaboration where consensus_type is not null group by consensus_type) t)
    ),
    -- 기존 Governance 실측(0496/0512/0514/0533 — 읽기 전용):
    'governance_actuals', jsonb_build_object(
      'governance_events_0496', (select count(*) from public.ai_governance_events),
      'approvals_0496', (select count(*) from public.ai_governance_events where event_type = 'approval'),
      'rejections_0496', (select count(*) from public.ai_governance_events where event_type = 'rejection'),
      'human_overrides_0496', (select count(*) from public.ai_governance_events where event_type = 'human_override'),
      'violations_0496', (select count(*) from public.ai_governance_events where event_type = 'violation_detected'),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules where is_active),
      'constitution_immutable_0496', (select count(*) from public.ai_constitution_rules where immutable),
      'decisions_0514', (select count(*) from public.ai_decision_memory),
      'policies_0512', (select count(*) from public.ai_enterprise_policies),
      'executive_os_events_0533', (select count(*) from public.ai_executive_os_events)
    ),
    'governance_unavailable', jsonb_build_array('agent_runtime_scheduler','external_workflow_engine','realtime_agent_telemetry','hr_org_system'),   -- 원본 없음(실측)
    'no_auto_approval', true, 'no_auto_agent_create_delete', true, 'no_auto_org_change', true, 'no_auto_strategy_change', true, 'no_auto_production_change', true,
    'consensus_is_not_truth', true, 'recommendation_is_not_approval', true, 'agreement_is_not_correctness', true, 'confidence_is_not_accuracy', true, 'conflict_is_not_error', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_orchestration_audit(p_limit int default 100)
returns setof public.ai_orchestration_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_orchestration_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_orchestration_agents enable row level security;
alter table public.ai_orchestration_events enable row level security;

comment on table public.ai_orchestration_agents is 'AI-OPS-31 — Enterprise Orchestration Agent 레지스트리(7종 kind·4종 status — 사람 등록/상태 변경만, 자동 생성·삭제 없음).';
comment on table public.ai_orchestration_events is 'AI-OPS-31 — Orchestration/Governance Audit(event_type whitelist 16종·Approval 은 항상 사람 — approval 없는 execution 기록 차단).';
