-- 0540_admin_ai_enterprise_twin.sql
-- AI-OPS-37 — Enterprise Digital Twin, Scenario Intelligence & Future State Prediction Center.
--
-- Current Enterprise State → Enterprise Digital Twin → Scenario Injection →
-- Multi-Agent Simulation → Future State Prediction → Risk/Opportunity/Capacity Projection →
-- Human Scenario Review → Decision Option Comparison → Executive Recommendation →
-- Knowledge Graph Reference.
--
-- 정직성(전부 서버 강제):
--  * Digital Twin ≠ Production — Twin 은 읽기 전용 복제 Reference. 원본 테이블 미변경.
--  * Prediction ≠ Future Fact. Projection ≠ Observation. Scenario ≠ Reality.
--  * Confidence ≠ Correctness. Correlation ≠ Causality. Simulation ≠ Execution.
--  * Recommendation ≠ Decision — 실행은 항상 사람.
--  * 실행하지 않은 Scenario/Run 을 completed 로 표시하지 않음(Evidence+started_at 필수).
--  * Production/Runtime/Connector/Automation/Rollout/Deploy/Merge/Migration/Notification/
--    비용 청구/인프라/권한/정책 변경 없음 — 해당 RPC 자체가 없음.
--  * 0499 ai_digital_twins(음악 도메인 Twin)와 별개 계층 — 이름 충돌 없음(ai_enterprise_twin_*).
--  * Snapshot 은 실제 테이블 read-only count 집계만 수행(원본 미변경).
--  * 0 과 Unknown 구분 — 데이터 부족 시 insufficient_data.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise State Snapshot(읽기 전용 집계 — Live 상태 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_state_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  snapshot_code             text not null,
  snapshot_status           text not null default 'captured_reference' check (snapshot_status in ('captured_reference','partial_reference','stale_candidate','invalidated','insufficient_data')),
  organization_state        jsonb not null default '{}'::jsonb,
  runtime_state             jsonb not null default '{}'::jsonb,
  connector_state           jsonb not null default '{}'::jsonb,
  agent_state               jsonb not null default '{}'::jsonb,
  policy_state              jsonb not null default '{}'::jsonb,
  decision_state            jsonb not null default '{}'::jsonb,
  knowledge_state           jsonb not null default '{}'::jsonb,
  capacity_state            jsonb not null default '{}'::jsonb,
  cost_state                jsonb not null default '{}'::jsonb,
  incident_state            jsonb not null default '{}'::jsonb,
  approval_state            jsonb not null default '{}'::jsonb,
  source_coverage           jsonb not null default '[]'::jsonb,
  missing_sources           jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  captured_by               uuid,
  captured_at               timestamptz not null default now(),
  created_at                timestamptz not null default now()
);
create unique index if not exists uq_aess_idem on public.ai_enterprise_state_snapshots (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aess_at on public.ai_enterprise_state_snapshots (captured_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Twin Scenario(Scenario ≠ Reality — 주입 파라미터 정의만).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_twin_scenarios (
  id                        uuid primary key default gen_random_uuid(),
  scenario_code             text not null,
  scenario_type             text not null check (scenario_type in ('provider_down','connector_timeout','queue_explosion','approval_delay','region_failure','resource_shortage','human_absence','agent_failure','policy_conflict','cost_spike','scale_x2','scale_x10','new_connector','new_enterprise','multiple_policy_apply','massive_incident','recovery_failure','custom_scenario')),
  title                     text not null,
  description               text,
  scenario_status           text not null default 'draft' check (scenario_status in ('draft','pending_evidence','pending_review','approved_for_twin_reference','blocked_reference','rejected','invalidated','insufficient_data')),
  support_status            text not null default 'support_unverified' check (support_status in ('supported_reference','partially_supported','support_unverified','unsupported')),
  injection_parameters      jsonb not null default '{}'::jsonb,
  target_twin_layers        jsonb not null default '[]'::jsonb,
  horizon_days              int check (horizon_days is null or (horizon_days >= 1 and horizon_days <= 365)),
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aets_idem on public.ai_enterprise_twin_scenarios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aets_status on public.ai_enterprise_twin_scenarios (scenario_status, scenario_type);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Twin Run(Prediction ≠ Future Fact — 미실행 completed 차단).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_twin_runs (
  id                        uuid primary key default gen_random_uuid(),
  run_code                  text not null,
  snapshot_id               uuid not null,
  scenario_id               uuid not null,
  run_status                text not null default 'draft' check (run_status in ('draft','pending_review','running_reference','completed_reference','completed_with_limitation','failed_reference','blocked_reference','prediction_unverified','sample_too_small','insufficient_data')),
  simulation_mode           text not null default 'twin_reference_only' check (simulation_mode in ('twin_reference_only','multi_agent_reference')),
  sample_size               int check (sample_size is null or sample_size >= 0),
  future_timeline           jsonb,
  risk_projection           jsonb,
  opportunity_projection    jsonb,
  cost_projection           jsonb,
  capacity_projection       jsonb,
  throughput_projection     jsonb,
  queue_projection          jsonb,
  incident_projection       jsonb,
  approval_queue_projection jsonb,
  kpi_projection            jsonb,
  human_workload_projection jsonb,
  best_case                 jsonb,
  worst_case                jsonb,
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  simulated_by              uuid,
  reviewed_by               uuid,
  started_at                timestamptz,
  completed_at              timestamptz,
  created_at                timestamptz not null default now()
);
create unique index if not exists uq_aetr_idem on public.ai_enterprise_twin_runs (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aetr_scenario on public.ai_enterprise_twin_runs (scenario_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Twin 이벤트(21종) — Snapshot/Twin Graph/Injection/Prediction/Projection
--    검토/Comparison/Recommendation/Human Review/Knowledge Reference 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_twin_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('state_snapshot_captured','state_snapshot_reviewed','twin_graph_built_reference','twin_scenario_created','twin_scenario_reviewed','scenario_injection_recorded_reference','twin_run_recorded','future_prediction_recorded_reference','risk_projection_reviewed','cost_projection_reviewed','capacity_projection_reviewed','throughput_projection_reviewed','queue_projection_reviewed','incident_projection_reviewed','approval_queue_projection_reviewed','kpi_projection_reviewed','scenario_comparison_recorded','executive_twin_recommendation_recorded','human_review_requested','knowledge_reference_recorded','twin_invalidated')),
  snapshot_id               uuid,
  scenario_id               uuid,
  run_id                    uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aete_evt on public.ai_enterprise_twin_events (event_type, created_at desc);
create index if not exists idx_aete_run on public.ai_enterprise_twin_events (run_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Snapshot 캡처 — 실제 테이블 read-only count 집계(원본 미변경).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_state_snapshot_capture(p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_state_snapshots;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_state_snapshots where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'twin_is_not_production', true); end if;
  end if;
  -- 아래 집계는 전부 count(*) 읽기 전용 — 어떤 원본 행도 변경하지 않음.
  insert into public.ai_enterprise_state_snapshots (snapshot_code, organization_state, runtime_state, connector_state, agent_state, policy_state, decision_state, knowledge_state, capacity_state, cost_state, incident_state, approval_state, source_coverage, missing_sources, assumptions, limitations, idempotency_key, captured_by)
  values (left(coalesce(nullif(p_payload->>'snapshot_code',''), 'ESS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    jsonb_build_object('franchises', (select count(*) from public.franchises), 'regions', (select count(*) from public.franchise_regions), 'stores', (select count(*) from public.franchise_stores), 'admins', (select count(*) from public.franchise_admins)),
    jsonb_build_object('runtime_sessions_0536', (select count(*) from public.ai_runtime_execution_sessions), 'runtime_events_0536', (select count(*) from public.ai_runtime_execution_events), 'automation_definitions_0536', (select count(*) from public.ai_automation_definitions)),
    jsonb_build_object('connector_definitions_0536', (select count(*) from public.ai_connector_definitions), 'connector_instances_0536', (select count(*) from public.ai_connector_instances)),
    jsonb_build_object('agents_total_0497', (select count(*) from public.ai_agents), 'agents_active_0497', (select count(*) from public.ai_agents where is_active), 'collaborations_0497', (select count(*) from public.ai_agent_collaboration)),
    jsonb_build_object('enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies), 'policy_versions_0512', (select count(*) from public.ai_enterprise_policy_versions), 'change_specifications_0539', (select count(*) from public.ai_policy_change_specifications), 'constitution_rules_0496', (select count(*) from public.ai_constitution_rules where is_active)),
    jsonb_build_object('decision_memory_0514', (select count(*) from public.ai_decision_memory), 'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes)),
    jsonb_build_object('knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities), 'knowledge_relationships_0513', (select count(*) from public.ai_knowledge_relationships)),
    jsonb_build_object('capacity_snapshots_0508', (select count(*) from public.ai_capacity_snapshots), 'capacity_metrics_0508', (select count(*) from public.ai_capacity_metrics)),
    jsonb_build_object('cost_models_0508', (select count(*) from public.ai_cost_models), 'cost_snapshots_0508', (select count(*) from public.ai_cost_snapshots)),
    jsonb_build_object('incidents_0502', (select count(*) from public.ai_incidents), 'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates)),
    jsonb_build_object('execution_requests_pending_0535', (select count(*) from public.ai_execution_requests where execution_status in ('draft','pending_review','approval_missing')), 'rollout_plans_pending_0539', (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('draft','pending_review','approval_missing')), 'twin_scenarios_pending', (select count(*) from public.ai_enterprise_twin_scenarios where scenario_status in ('pending_review','pending_evidence'))),
    '["organization","runtime","connector","agent","policy","decision","knowledge","capacity","cost","incident","approval"]'::jsonb,
    '["gpu_cost_feed","region_outage_feed","generic_queue_worker","provider_state_feed","human_absence_calendar"]'::jsonb,   -- 원본 없음(실측) — Snapshot 에 포함 불가
    coalesce(p_payload->'assumptions', '[]'::jsonb),
    coalesce(p_payload->'limitations', '["snapshot_is_not_live_state","counts_only_reference"]'::jsonb),
    v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_twin_events (event_type, snapshot_id, detail, payload, actor_id)
  values ('state_snapshot_captured', v_id, 'Enterprise State Snapshot (읽기 전용 count 집계 — Live 상태 아님·원본 미변경)', jsonb_build_object('sources', 11), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'snapshot_status', 'captured_reference', 'twin_is_not_production', true, 'snapshot_is_not_live_state', true, 'production_changed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Scenario 생성/검토 — 실행 아님·자동 주입 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_twin_scenario_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_type text; v_support text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_twin_scenarios;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'scenario_type','');
  if v_type not in ('provider_down','connector_timeout','queue_explosion','approval_delay','region_failure','resource_shortage','human_absence','agent_failure','policy_conflict','cost_spike','scale_x2','scale_x10','new_connector','new_enterprise','multiple_policy_apply','massive_incident','recovery_failure','custom_scenario') then
    raise exception '허용되지 않는 scenario_type';
  end if;
  if coalesce(btrim(p_payload->>'title'),'') = '' then raise exception 'title 필수'; end if;
  -- 실측 기반 support 판정(추측 없음): 원본 데이터 없는 시나리오는 partially/unsupported 명시.
  v_support := case v_type
    when 'connector_timeout' then 'supported_reference'        -- 0536 timeout_seconds 실존
    when 'approval_delay' then 'supported_reference'           -- pending 상태 실존(0535/0539)
    when 'agent_failure' then 'supported_reference'            -- ai_agents(0497) 실존
    when 'policy_conflict' then 'supported_reference'          -- 0539 conflict 구조 실존
    when 'scale_x2' then 'supported_reference'                 -- 조직 counts 실존(선형 추정만)
    when 'scale_x10' then 'supported_reference'
    when 'new_connector' then 'supported_reference'            -- 0536 정의 구조 실존
    when 'new_enterprise' then 'supported_reference'           -- franchises(0349) 실존
    when 'multiple_policy_apply' then 'supported_reference'    -- 0539 Specification 실존
    when 'massive_incident' then 'supported_reference'         -- 0502/0537 실존
    when 'recovery_failure' then 'supported_reference'         -- 0502 recovery candidates 실존
    when 'provider_down' then 'partially_supported'            -- Provider 상태 피드 없음
    when 'queue_explosion' then 'partially_supported'          -- 범용 Queue/Worker 없음(승인 대기 counts 만)
    when 'region_failure' then 'partially_supported'           -- franchise_regions 실존·장애 피드 없음
    when 'resource_shortage' then 'partially_supported'        -- 0508 스냅샷 실존·실시간 리소스 피드 없음
    when 'human_absence' then 'partially_supported'            -- 휴가/캘린더 데이터 없음
    when 'cost_spike' then 'partially_supported'               -- 0508 비용 스냅샷 실존·GPU 비용 피드 없음
    else 'support_unverified' end;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_twin_scenarios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'scenario_is_not_reality', true); end if;
  end if;
  insert into public.ai_enterprise_twin_scenarios (scenario_code, scenario_type, title, description, support_status, injection_parameters, target_twin_layers, horizon_days, assumptions, unknown_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'scenario_code',''), 'ETS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_type, left(p_payload->>'title', 200), left(coalesce(p_payload->>'description',''), 1000), v_support,
    coalesce(p_payload->'injection_parameters', '{}'::jsonb), coalesce(p_payload->'target_twin_layers', '[]'::jsonb),
    nullif(p_payload->>'horizon_days','')::int,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_twin_events (event_type, scenario_id, detail, payload, actor_id)
  values ('twin_scenario_created', v_id, left(v_type, 80) || ' (Scenario ≠ Reality — draft·자동 주입/실행 없음)', jsonb_build_object('support_status', v_support), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'support_status', v_support, 'scenario_is_not_reality', true, 'auto_executed', false, 'production_changed', false);
end $$;

create or replace function public.admin_enterprise_twin_scenario_review(p_scenario_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_twin_scenarios; v_next text; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('start_review','request_evidence','approve_for_twin','block','reject','invalidate') then raise exception '허용되지 않는 action'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_twin_scenarios where id = p_scenario_id;
  if v_row.id is null then raise exception 'Scenario 없음(실존 검증 실패)'; end if;
  if v_row.scenario_status in ('rejected','invalidated') then raise exception '종결 상태 재결정 차단(%)', v_row.scenario_status; end if;
  if v_row.created_by = v_uid and p_action = 'approve_for_twin' then v_note := ' (self-review 경고)'; end if;

  if p_action = 'start_review' then v_next := 'pending_review';
  elsif p_action = 'request_evidence' then v_next := 'pending_evidence';
  elsif p_action = 'approve_for_twin' then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 승인 금지';
    end if;
    v_next := 'approved_for_twin_reference';
    v_note := v_note || ' (Twin 주입 승인 ≠ 실행 — Twin ≠ Production)';
  elsif p_action = 'block' then v_next := 'blocked_reference';
  elsif p_action = 'reject' then v_next := 'rejected';
  else v_next := 'invalidated';
  end if;

  update public.ai_enterprise_twin_scenarios set scenario_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_scenario_id;
  insert into public.ai_enterprise_twin_events (event_type, scenario_id, detail, payload, actor_id)
  values (case when p_action = 'invalidate' then 'twin_invalidated' else 'twin_scenario_reviewed' end,
    p_scenario_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_scenario_id, 'status', v_next, 'production_changed', false, 'auto_executed', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Twin Run 기록 — 미실행 completed 차단·Scenario 승인 선행.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_twin_run_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_snap public.ai_enterprise_state_snapshots; v_scn public.ai_enterprise_twin_scenarios; v_status text; v_conf int; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_twin_runs;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_snap from public.ai_enterprise_state_snapshots where id = nullif(p_payload->>'snapshot_id','')::uuid;
  if v_snap.id is null then raise exception 'State Snapshot 없음(실존 검증 실패)'; end if;
  if v_snap.snapshot_status = 'invalidated' then raise exception '무효화된 Snapshot 으로 Run 기록 불가'; end if;
  select * into v_scn from public.ai_enterprise_twin_scenarios where id = nullif(p_payload->>'scenario_id','')::uuid;
  if v_scn.id is null then raise exception 'Scenario 없음(실존 검증 실패)'; end if;
  if v_scn.scenario_status <> 'approved_for_twin_reference' then
    raise exception 'scenario_unreviewed: approved_for_twin_reference 상태에서만 Run 기록 가능';
  end if;
  v_status := coalesce(nullif(p_payload->>'run_status',''), 'draft');
  -- 실행하지 않은 Run 을 completed 로 표시하지 않음 — Evidence + started_at 필수.
  if v_status in ('completed_reference','completed_with_limitation') then
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 completed Run 금지(prediction_unverified)';
    end if;
    if nullif(p_payload->>'started_at','') is null then raise exception 'started_at 없는 completed Run 금지'; end if;
  end if;
  if coalesce((p_payload->>'sample_size')::int, 0) < 0 then raise exception '음수 sample_size 차단'; end if;
  v_conf := case when nullif(p_payload->>'confidence','') is null then null else least(100, greatest(0, (p_payload->>'confidence')::int)) end;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_twin_runs where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'prediction_is_not_future_fact', true); end if;
  end if;
  insert into public.ai_enterprise_twin_runs (run_code, snapshot_id, scenario_id, run_status, simulation_mode, sample_size, future_timeline, risk_projection, opportunity_projection, cost_projection, capacity_projection, throughput_projection, queue_projection, incident_projection, approval_queue_projection, kpi_projection, human_workload_projection, best_case, worst_case, confidence, assumptions, unknown_factors, evidence, limitations, idempotency_key, simulated_by, started_at, completed_at)
  values (left(coalesce(nullif(p_payload->>'run_code',''), 'ETR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_snap.id, v_scn.id, v_status,
    coalesce(nullif(p_payload->>'simulation_mode',''), 'twin_reference_only'),
    nullif(p_payload->>'sample_size','')::int,
    p_payload->'future_timeline', p_payload->'risk_projection', p_payload->'opportunity_projection', p_payload->'cost_projection',
    p_payload->'capacity_projection', p_payload->'throughput_projection', p_payload->'queue_projection', p_payload->'incident_projection',
    p_payload->'approval_queue_projection', p_payload->'kpi_projection', p_payload->'human_workload_projection',
    p_payload->'best_case', p_payload->'worst_case', v_conf,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid,
    nullif(p_payload->>'started_at','')::timestamptz, nullif(p_payload->>'completed_at','')::timestamptz)
  returning id into v_id;
  insert into public.ai_enterprise_twin_events (event_type, snapshot_id, scenario_id, run_id, detail, payload, actor_id)
  values ('twin_run_recorded', v_snap.id, v_scn.id, v_id, left(v_scn.scenario_type, 80) || ' (Prediction ≠ Future Fact·Projection ≠ Observation·Twin ≠ Production)', jsonb_build_object('status', v_status), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'run_status', v_status, 'prediction_is_not_future_fact', true, 'projection_is_not_observation', true, 'twin_is_not_production', true, 'production_changed', false, 'auto_executed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Twin 이벤트 기록(검토/비교/추천) — 생성/승인은 전용 RPC.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_twin_event_record(p_kind text, p_reason text, p_payload jsonb, p_snapshot_id uuid default null, p_scenario_id uuid default null, p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('state_snapshot_reviewed','twin_graph_built_reference','scenario_injection_recorded_reference','future_prediction_recorded_reference','risk_projection_reviewed','cost_projection_reviewed','capacity_projection_reviewed','throughput_projection_reviewed','queue_projection_reviewed','incident_projection_reviewed','approval_queue_projection_reviewed','kpi_projection_reviewed','scenario_comparison_recorded','executive_twin_recommendation_recorded','human_review_requested','knowledge_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/승인/Run 기록은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_snapshot_id is not null and not exists (select 1 from public.ai_enterprise_state_snapshots where id = p_snapshot_id) then raise exception 'Snapshot 없음(실존 검증 실패)'; end if;
  if p_scenario_id is not null and not exists (select 1 from public.ai_enterprise_twin_scenarios where id = p_scenario_id) then raise exception 'Scenario 없음(실존 검증 실패)'; end if;
  if p_run_id is not null and not exists (select 1 from public.ai_enterprise_twin_runs where id = p_run_id) then raise exception 'Run 없음(실존 검증 실패)'; end if;
  if p_kind = 'scenario_comparison_recorded' then
    if p_payload->'run_ids' is null or jsonb_typeof(p_payload->'run_ids') <> 'array' or jsonb_array_length(p_payload->'run_ids') < 2 then
      raise exception 'Comparison 은 Run 2개 이상 필요';
    end if;
  end if;
  if p_kind = 'executive_twin_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation','') not in ('best_option_candidate','lowest_risk_candidate','lowest_cost_candidate','highest_capacity_candidate','human_approval_recommendation','insufficient_data') then
      raise exception '허용되지 않는 recommendation(실행 제안 아님·후보만)';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Recommendation 금지';
    end if;
  end if;
  insert into public.ai_enterprise_twin_events (event_type, snapshot_id, scenario_id, run_id, detail, payload, actor_id)
  values (p_kind, p_snapshot_id, p_scenario_id, p_run_id,
    left(p_reason, 200) || case
      when p_kind = 'twin_graph_built_reference' then ' (Twin ≠ Production — 읽기 전용 복제 Reference)'
      when p_kind = 'scenario_injection_recorded_reference' then ' (Injection 은 Twin 내부 Reference — 실제 시스템 미변경)'
      when p_kind = 'future_prediction_recorded_reference' then ' (Prediction ≠ Future Fact)'
      when p_kind = 'scenario_comparison_recorded' then ' (비교 후보 — 자동 선택 없음)'
      when p_kind = 'executive_twin_recommendation_recorded' then ' (Recommendation ≠ Decision — 실행은 사람)'
      when p_kind like '%projection_reviewed' then ' (Projection ≠ Observation)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'production_changed', false, 'auto_executed', false, 'recommendation_is_not_decision', true, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_state_snapshots(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_state_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_state_snapshots
  where (p_status is null or snapshot_status = p_status)
  order by captured_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_twin_scenarios(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_twin_scenarios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_twin_scenarios
  where (p_status is null or scenario_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_twin_runs(p_status text default null, p_limit int default 100)
returns setof public.ai_enterprise_twin_runs language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_twin_runs
  where (p_status is null or run_status = p_status)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_twin_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'snapshots', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_state_snapshots),
      'captured', (select count(*) from public.ai_enterprise_state_snapshots where snapshot_status = 'captured_reference'),
      'invalidated', (select count(*) from public.ai_enterprise_state_snapshots where snapshot_status = 'invalidated')
    ),
    'scenarios', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_twin_scenarios),
      'draft', (select count(*) from public.ai_enterprise_twin_scenarios where scenario_status = 'draft'),
      'pending_review', (select count(*) from public.ai_enterprise_twin_scenarios where scenario_status = 'pending_review'),
      'approved_for_twin', (select count(*) from public.ai_enterprise_twin_scenarios where scenario_status = 'approved_for_twin_reference'),
      'blocked', (select count(*) from public.ai_enterprise_twin_scenarios where scenario_status = 'blocked_reference'),
      'partially_supported', (select count(*) from public.ai_enterprise_twin_scenarios where support_status = 'partially_supported'),
      'unsupported', (select count(*) from public.ai_enterprise_twin_scenarios where support_status in ('unsupported','support_unverified'))
    ),
    'runs', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_twin_runs),
      'completed', (select count(*) from public.ai_enterprise_twin_runs where run_status in ('completed_reference','completed_with_limitation')),
      'failed', (select count(*) from public.ai_enterprise_twin_runs where run_status = 'failed_reference'),
      'unverified', (select count(*) from public.ai_enterprise_twin_runs where run_status = 'prediction_unverified'),
      'sample_too_small', (select count(*) from public.ai_enterprise_twin_runs where run_status = 'sample_too_small')
    ),
    'twin_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_twin_events),
      'comparisons', (select count(*) from public.ai_enterprise_twin_events where event_type = 'scenario_comparison_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_twin_events where event_type = 'executive_twin_recommendation_recorded'),
      'human_reviews', (select count(*) from public.ai_enterprise_twin_events where event_type = 'human_review_requested'),
      'knowledge_references', (select count(*) from public.ai_enterprise_twin_events where event_type = 'knowledge_reference_recorded')
    ),
    -- 원본 실측(전부 읽기 전용):
    'twin_actuals', jsonb_build_object(
      'franchises_0349', (select count(*) from public.franchises),
      'regions_0349', (select count(*) from public.franchise_regions),
      'stores_0349', (select count(*) from public.franchise_stores),
      'agents_active_0497', (select count(*) from public.ai_agents where is_active),
      'connector_definitions_0536', (select count(*) from public.ai_connector_definitions),
      'connector_instances_0536', (select count(*) from public.ai_connector_instances),
      'runtime_sessions_0536', (select count(*) from public.ai_runtime_execution_sessions),
      'policy_versions_0512', (select count(*) from public.ai_enterprise_policy_versions),
      'incidents_0502', (select count(*) from public.ai_incidents),
      'incident_candidates_0537', (select count(*) from public.ai_runtime_incident_candidates),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'decision_memory_0514', (select count(*) from public.ai_decision_memory),
      'pending_approvals_0535_0539', (select (select count(*) from public.ai_execution_requests where execution_status in ('draft','pending_review','approval_missing')) + (select count(*) from public.ai_policy_rollout_plans where rollout_status in ('draft','pending_review','approval_missing')))
    ),
    'twin_unavailable', jsonb_build_array('gpu_cost_feed','region_outage_feed','generic_queue_worker','provider_state_feed','human_absence_calendar','load_test_infrastructure','real_notification_dispatch'),   -- 원본 없음(실측)
    'twin_available_reference', jsonb_build_array('organization_0349','runtime_0536','connectors_0536','agents_0497','policies_0512_0539','decisions_0514','knowledge_graph_0513','capacity_cost_0508','incidents_0502_0537'),
    'twin_is_not_production', true, 'prediction_is_not_future_fact', true, 'projection_is_not_observation', true,
    'scenario_is_not_reality', true, 'confidence_is_not_correctness', true, 'simulation_is_not_execution', true,
    'recommendation_is_not_decision', true, 'no_auto_execution', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_twin_audit(p_limit int default 100)
returns setof public.ai_enterprise_twin_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_twin_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_state_snapshots enable row level security;
alter table public.ai_enterprise_twin_scenarios enable row level security;
alter table public.ai_enterprise_twin_runs enable row level security;
alter table public.ai_enterprise_twin_events enable row level security;

comment on table public.ai_enterprise_state_snapshots is 'AI-OPS-37 — Enterprise State Snapshot(읽기 전용 count 집계·Live 상태 아님·원본 미변경).';
comment on table public.ai_enterprise_twin_scenarios is 'AI-OPS-37 — Twin Scenario 17종+custom(Scenario ≠ Reality·support 실측 판정·자동 실행 없음).';
comment on table public.ai_enterprise_twin_runs is 'AI-OPS-37 — Twin Run(Prediction ≠ Future Fact·미실행 completed 차단·Twin ≠ Production).';
comment on table public.ai_enterprise_twin_events is 'AI-OPS-37 — Twin 이벤트 21종(Recommendation ≠ Decision·실행은 사람).';
