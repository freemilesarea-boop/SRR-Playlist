-- 0557_admin_ai_enterprise_decision_scenario_intelligence.sql
-- AI-OPS-53 — Enterprise Scenario Intelligence, Predictive Simulation &
-- Executive Decision Laboratory.
--
-- Enterprise Vision → Mission → Current State → Scenario Generation →
-- Alternative Strategies → Trade-off Analysis → Impact/Resource/Financial/
-- Operational/Risk Simulation → Scenario Comparison → Executive Decision
-- Laboratory → Human Decision → Scenario Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Scenario ≠ Future Reality — 전략 자동 실행/프로젝트 자동 생성/Budget
--    자동 변경/계약 자동 체결/조직·KPI 자동 변경 RPC 자체가 없음.
--  * Simulation ≠ Prediction. Recommendation ≠ Decision. Ranking ≠ Executive
--    Priority. Trade-off ≠ Optimal Solution. Cost Estimate ≠ Actual Cost.
--    Risk Estimate ≠ Actual Risk. Forecast ≠ Future Fact.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0514/0520/0545/0547/0549/0553/
--    0554/0555/0556 원본 무변경(참조만).
--  * 이름 충돌 실측: 0542(AI-OPS-38)가 ai_enterprise_scenario_events ·
--    admin_enterprise_scenario_* 를 이미 사용 → 본 계층은
--    ai_enterprise_decision_scenario* / admin_enterprise_decision_scenario_*
--    로 명명(별개 계층·원본 무변경).
--  * 재무 계획 시스템/ERP/프로젝트 관리 피드/Monte Carlo 엔진은 실측 부재 —
--    insufficient_data 로 유지(Simulation 은 수동 입력 기반 후보 계산).
--  * Scenario Timeline/Simulation·Trade-off·Impact History/Decision
--    Alternatives 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Decision Scenario(≠ 실행 계획 — Executive Decision Laboratory 원장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_decision_scenarios (
  id                        uuid primary key default gen_random_uuid(),
  scenario_code             text not null,
  scenario_title            text not null,
  scenario_category         text not null check (scenario_category in ('strategy','portfolio','investment','organization','product','technology','market','finance','operations','risk','ai','executive','enterprise','custom')),
  scenario_status           text not null default 'draft' check (scenario_status in ('draft','candidate','review_reference','archived_reference','insufficient_data')),
  scenario_summary          text,
  impact_status             text not null default 'insufficient_data' check (impact_status in ('high_positive_candidate','moderate_positive_candidate','neutral_candidate','high_negative_candidate','insufficient_data')),
  tradeoff_status           text not null default 'insufficient_data' check (tradeoff_status in ('highly_balanced_candidate','balanced_candidate','acceptable_candidate','poor_tradeoff_candidate','insufficient_data')),
  confidence_status         text not null default 'insufficient_data' check (confidence_status in ('high_confidence_candidate','moderate_confidence_candidate','low_confidence_candidate','speculative_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  mission_id                uuid,
  strategy_portfolio_id     uuid,
  environment_observation_id uuid,
  current_state             jsonb,
  alternatives              jsonb not null default '[]'::jsonb,   -- Decision Alternatives append(≠ 실행)
  whatif_result             jsonb,
  resource_result           jsonb,
  financial_result          jsonb,
  operational_result        jsonb,
  risk_result               jsonb,
  impact_result             jsonb,
  tradeoff_result           jsonb,
  confidence_result         jsonb,
  cost_benefit_result       jsonb,
  ranking_result            jsonb,
  comparison_result         jsonb,
  scorecard_result          jsonb,
  simulation_history        jsonb not null default '[]'::jsonb,   -- Simulation/Trade-off/Impact Timeline 통합 append
  recommendation_candidate  jsonb,
  scenario_reviews          jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
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
create unique index if not exists uq_aeds_idem on public.ai_enterprise_decision_scenarios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeds_status on public.ai_enterprise_decision_scenarios (scenario_status, scenario_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Scenario Review(§9 — 요청/Reference 기록만, 채택·실행은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_decision_scenario_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  decision_scenario_id      uuid not null,
  review_type               text not null check (review_type in ('scenario_review','executive_review','human_review')),
  review_status             text not null default 'requested' check (review_status in ('requested','in_review','review_reference_recorded','revision_requested','insufficient_data')),
  review_summary            text,
  findings                  jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aedsr_idem on public.ai_enterprise_decision_scenario_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aedsr_scn on public.ai_enterprise_decision_scenario_reviews (decision_scenario_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Decision Scenario 이벤트(31종) — Alternative/Simulation/Trade-off/
--    Confidence/Cost-Benefit/Ranking/Comparison/Scorecard/Recommendation/
--    Review/Human Decision/Learning/Link 통합 Audit(자동 실행 이벤트 생성
--    금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_decision_scenario_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('decision_scenario_created','decision_scenario_reviewed','alternative_strategy_recorded','whatif_simulation_recorded','resource_simulation_recorded','financial_simulation_recorded','operational_simulation_recorded','risk_simulation_recorded','impact_simulation_reviewed','tradeoff_analysis_reviewed','scenario_confidence_reviewed','cost_benefit_recorded','scenario_ranking_recorded','scenario_comparison_recorded','executive_decision_summary_recorded','executive_decision_scorecard_recorded','scenario_recommendation_recorded','scenario_review_created','scenario_review_reviewed','scenario_review_requested','executive_review_requested','human_review_requested','scenario_review_reference_recorded','scenario_revision_requested','human_decision_recorded','scenario_learning_recorded','mission_reference_linked','portfolio_reference_linked','environment_reference_linked','program_reference_linked','value_reference_linked')),
  decision_scenario_id      uuid,
  scenario_review_id        uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aedse_evt on public.ai_enterprise_decision_scenario_events (event_type, created_at desc);
create index if not exists idx_aedse_scn on public.ai_enterprise_decision_scenario_events (decision_scenario_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Decision Scenario 생성 — 자동 실행 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_scenario_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_decision_scenarios;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'scenario_category','');
  -- 자동 실행/프로젝트 생성/Budget·계약·조직·KPI 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_strategy_execution','automatic_project_creation','automatic_budget_change','automatic_contract_signing','automatic_organization_change','automatic_kpi_change') then
    raise exception '금지된 scenario_category(자동 실행 계열 비활성)';
  end if;
  if v_cat not in ('strategy','portfolio','investment','organization','product','technology','market','finance','operations','risk','ai','executive','enterprise','custom') then
    raise exception '허용되지 않는 scenario_category';
  end if;
  if coalesce(btrim(p_payload->>'scenario_title'),'') = '' then raise exception 'scenario_title 필수'; end if;
  if nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_decision_scenarios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'scenario_is_not_future_reality', true); end if;
  end if;
  insert into public.ai_enterprise_decision_scenarios (scenario_code, scenario_title, scenario_category, scenario_summary, mission_id, strategy_portfolio_id, environment_observation_id, current_state, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'scenario_code',''), 'EDS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'scenario_title', 200), v_cat,
    nullif(left(coalesce(p_payload->>'scenario_summary',''), 2000),''),
    nullif(p_payload->>'mission_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    nullif(p_payload->>'environment_observation_id','')::uuid, p_payload->'current_state',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, detail, payload, actor_id)
  values ('decision_scenario_created', v_id, left(v_cat, 80) || ' (Scenario ≠ Future Reality — draft·자동 실행 없음)', jsonb_build_object('scenario_title', p_payload->>'scenario_title'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'scenario_is_not_future_reality', true, 'strategy_executed', false, 'project_created', false, 'budget_changed', false, 'contract_signed', false, 'organization_changed', false, 'kpi_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Decision Scenario 검토 — review_reference 는 Self 차단 + Evidence 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_scenario_review(p_scenario_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_decision_scenarios; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'decision_scenario_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_decision_scenarios where id = p_scenario_id;
  if v_row.id is null then raise exception 'Decision Scenario 없음(실존 검증 실패)'; end if;
  if v_row.scenario_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_candidate' then v_next := 'candidate';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 채택·실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Scenario Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 채택·실행은 사람)'; v_evt := 'scenario_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'strategy_executed', false, 'budget_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_decision_scenarios set review_reference = v_ref, scenario_reviews = scenario_reviews || jsonb_build_array(v_ref) where id = p_scenario_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_decision_scenarios set scenario_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_scenario_id;
  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, detail, payload, actor_id)
  values (v_evt, p_scenario_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_scenario_id, 'status', v_next, 'scenario_is_not_future_reality', true, 'strategy_executed', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Scenario Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_scenario_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_scn public.ai_enterprise_decision_scenarios; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_decision_scenario_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('scenario_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'decision_scenario_id','') is null then raise exception 'decision_scenario_id 필수'; end if;
  select * into v_scn from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid;
  if v_scn.id is null then raise exception 'Decision Scenario 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_decision_scenario_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_decision_scenario_reviews (review_code, decision_scenario_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EDR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_scn.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'scenario_review' then 'scenario_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, scenario_review_id, detail, payload, actor_id)
  values (v_evt, v_scn.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 채택·실행은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, scenario_review_id, detail, payload, actor_id)
  values ('scenario_review_created', v_scn.id, v_id, 'Scenario Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'strategy_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_decision_scenario_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_decision_scenario_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_decision_scenario_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Scenario Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'strategy_executed', false, 'project_created', false, 'budget_changed', false,
    'contract_signed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 채택·실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Scenario Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 채택·실행은 사람)';
    update public.ai_enterprise_decision_scenario_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_decision_scenarios set
      scenario_reviews = scenario_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.decision_scenario_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_decision_scenario_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, scenario_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'scenario_review_reference_recorded' when p_action = 'request_revision' then 'scenario_revision_requested' else 'scenario_review_reviewed' end,
    v_row.decision_scenario_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'strategy_executed', false, 'budget_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Decision Scenario 이벤트 기록(통합) — 자동 실행 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_scenario_event_record(p_kind text, p_reason text, p_payload jsonb, p_scenario_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('alternative_strategy_recorded','whatif_simulation_recorded','resource_simulation_recorded','financial_simulation_recorded','operational_simulation_recorded','risk_simulation_recorded','impact_simulation_reviewed','tradeoff_analysis_reviewed','scenario_confidence_reviewed','cost_benefit_recorded','scenario_ranking_recorded','scenario_comparison_recorded','executive_decision_summary_recorded','executive_decision_scorecard_recorded','scenario_recommendation_recorded','scenario_review_requested','executive_review_requested','human_review_requested','human_decision_recorded','scenario_learning_recorded','mission_reference_linked','portfolio_reference_linked','environment_reference_linked','program_reference_linked','value_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_scenario_id is not null and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = p_scenario_id) then raise exception 'Decision Scenario 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_decision_scenario_reviews where id = p_review_id) then raise exception 'Scenario Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'alternative_strategy_recorded' and p_scenario_id is not null then
    -- Decision Alternatives append(Alternative ≠ 실행).
    update public.ai_enterprise_decision_scenarios set alternatives = alternatives || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind in ('whatif_simulation_recorded','resource_simulation_recorded','financial_simulation_recorded','operational_simulation_recorded','risk_simulation_recorded') then
    if p_scenario_id is not null then
      if p_kind = 'whatif_simulation_recorded' then update public.ai_enterprise_decision_scenarios set whatif_result = p_payload, simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
      elsif p_kind = 'resource_simulation_recorded' then update public.ai_enterprise_decision_scenarios set resource_result = p_payload, simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
      elsif p_kind = 'financial_simulation_recorded' then update public.ai_enterprise_decision_scenarios set financial_result = p_payload, simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
      elsif p_kind = 'operational_simulation_recorded' then update public.ai_enterprise_decision_scenarios set operational_result = p_payload, simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
      else update public.ai_enterprise_decision_scenarios set risk_result = p_payload, simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
      end if;
    end if;
  end if;
  if p_kind = 'impact_simulation_reviewed' then
    if coalesce(p_payload->>'impact_dimension','') not in ('financial_impact','operational_impact','mission_impact','resource_impact','risk_impact') then
      raise exception '허용되지 않는 impact_dimension(§5 — 5종)';
    end if;
    if v_result not in ('high_positive_candidate','moderate_positive_candidate','neutral_candidate','high_negative_candidate','insufficient_data') then raise exception '허용되지 않는 impact result(§5 — 5종)'; end if;
    if p_scenario_id is not null then update public.ai_enterprise_decision_scenarios set impact_status = v_result, impact_result = coalesce(impact_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'impact_dimension', p_payload), simulation_history = simulation_history || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'tradeoff_analysis_reviewed' then
    if coalesce(p_payload->>'tradeoff_dimension','') not in ('cost','benefit','complexity','time','risk') then
      raise exception '허용되지 않는 tradeoff_dimension(§6 — 5종)';
    end if;
    if v_result not in ('highly_balanced_candidate','balanced_candidate','acceptable_candidate','poor_tradeoff_candidate','insufficient_data') then raise exception '허용되지 않는 tradeoff result(§6 — 5종)'; end if;
    if p_scenario_id is not null then update public.ai_enterprise_decision_scenarios set tradeoff_status = v_result, tradeoff_result = coalesce(tradeoff_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'tradeoff_dimension', p_payload), updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'scenario_confidence_reviewed' then
    if v_result not in ('high_confidence_candidate','moderate_confidence_candidate','low_confidence_candidate','speculative_candidate','insufficient_data') then raise exception '허용되지 않는 confidence result(§7 — 5종)'; end if;
    if p_scenario_id is not null then update public.ai_enterprise_decision_scenarios set confidence_status = v_result, confidence_result = p_payload, updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'cost_benefit_recorded' and p_scenario_id is not null then
    -- Cost Estimate ≠ Actual Cost.
    update public.ai_enterprise_decision_scenarios set cost_benefit_result = p_payload, updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind = 'scenario_ranking_recorded' and p_scenario_id is not null then
    -- Ranking ≠ Executive Priority.
    update public.ai_enterprise_decision_scenarios set ranking_result = p_payload, updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind = 'scenario_comparison_recorded' and p_scenario_id is not null then
    update public.ai_enterprise_decision_scenarios set comparison_result = p_payload, updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind = 'executive_decision_scorecard_recorded' and p_scenario_id is not null then
    update public.ai_enterprise_decision_scenarios set scorecard_result = p_payload, updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind = 'scenario_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_decision_scenario','record_alternative_strategy','run_whatif_simulation','run_resource_simulation','run_financial_simulation','run_operational_simulation','run_risk_simulation','review_impact_simulation','review_tradeoff_analysis','review_scenario_confidence','record_cost_benefit','record_scenario_ranking','record_scenario_comparison','build_executive_decision_summary','build_executive_decision_scorecard','request_scenario_review','request_executive_review','request_human_review','record_human_decision','record_scenario_learning','link_mission_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Scenario Recommendation 금지';
    end if;
    if p_scenario_id is not null then update public.ai_enterprise_decision_scenarios set recommendation_candidate = p_payload, updated_at = now() where id = p_scenario_id; end if;
  end if;
  if p_kind = 'scenario_learning_recorded' and p_scenario_id is not null then
    update public.ai_enterprise_decision_scenarios set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_scenario_id;
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'environment_reference_linked' and nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_decision_scenario_events (event_type, decision_scenario_id, scenario_review_id, detail, payload, actor_id)
  values (p_kind, p_scenario_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'alternative_strategy_recorded' then ' (Alternative ≠ 실행)'
      when p_kind = 'whatif_simulation_recorded' then ' (Simulation ≠ Prediction)'
      when p_kind = 'resource_simulation_recorded' then ' (Resource Simulation ≠ 배치 확정)'
      when p_kind = 'financial_simulation_recorded' then ' (Cost Estimate ≠ Actual Cost)'
      when p_kind = 'operational_simulation_recorded' then ' (Operational Simulation ≠ 운영 변경)'
      when p_kind = 'risk_simulation_recorded' then ' (Risk Estimate ≠ Actual Risk)'
      when p_kind = 'impact_simulation_reviewed' then ' (Impact Candidate ≠ 확정 영향)'
      when p_kind = 'tradeoff_analysis_reviewed' then ' (Trade-off ≠ Optimal Solution)'
      when p_kind = 'scenario_confidence_reviewed' then ' (Confidence ≠ Certainty)'
      when p_kind = 'cost_benefit_recorded' then ' (Cost/Benefit 후보 ≠ 확정 수치)'
      when p_kind = 'scenario_ranking_recorded' then ' (Ranking ≠ Executive Priority)'
      when p_kind = 'scenario_comparison_recorded' then ' (Comparison ≠ 자동 선택)'
      when p_kind = 'executive_decision_summary_recorded' then ' (Summary ≠ 결정 확정)'
      when p_kind = 'executive_decision_scorecard_recorded' then ' (Scorecard ≠ Decision)'
      when p_kind = 'scenario_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'scenario_review_requested' then ' (Scenario Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — 채택·실행은 사람)'
      when p_kind = 'human_decision_recorded' then ' (사람의 결정 기록 — 자동 실행 아님)'
      when p_kind = 'scenario_learning_recorded' then ' (Scenario Learning ≠ 자동 전략 실행)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 변경)'
      when p_kind = 'environment_reference_linked' then ' (Environment Reference ≠ 사실 확정)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 가치 확정)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'strategy_executed', false, 'project_created', false, 'budget_changed', false, 'contract_signed', false, 'organization_changed', false, 'kpi_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_decision_scenarios_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_decision_scenarios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_decision_scenarios
  where (p_status is null or scenario_status = p_status)
    and (p_category is null or scenario_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_decision_scenario_reviews_list(p_scenario_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_decision_scenario_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_decision_scenario_reviews
  where (p_scenario_id is null or decision_scenario_id = p_scenario_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_decision_lab_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'scenarios', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_decision_scenarios),
      'draft', (select count(*) from public.ai_enterprise_decision_scenarios where scenario_status = 'draft'),
      'candidate', (select count(*) from public.ai_enterprise_decision_scenarios where scenario_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_decision_scenarios where scenario_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_decision_scenarios where scenario_status = 'archived_reference'),
      'high_positive', (select count(*) from public.ai_enterprise_decision_scenarios where impact_status = 'high_positive_candidate'),
      'high_negative', (select count(*) from public.ai_enterprise_decision_scenarios where impact_status = 'high_negative_candidate'),
      'well_balanced', (select count(*) from public.ai_enterprise_decision_scenarios where tradeoff_status in ('highly_balanced_candidate','balanced_candidate')),
      'poor_tradeoff', (select count(*) from public.ai_enterprise_decision_scenarios where tradeoff_status = 'poor_tradeoff_candidate'),
      'speculative', (select count(*) from public.ai_enterprise_decision_scenarios where confidence_status in ('low_confidence_candidate','speculative_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_decision_scenarios where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(scenario_category, cnt), '{}'::jsonb) from (select scenario_category, count(*) cnt from public.ai_enterprise_decision_scenarios group by scenario_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_decision_scenario_reviews),
      'requested', (select count(*) from public.ai_enterprise_decision_scenario_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_decision_scenario_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_decision_scenario_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_decision_scenario_reviews where review_status = 'revision_requested')
    ),
    'scenario_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_decision_scenario_events),
      'alternatives', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'alternative_strategy_recorded'),
      'whatif_simulations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'whatif_simulation_recorded'),
      'resource_simulations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'resource_simulation_recorded'),
      'financial_simulations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'financial_simulation_recorded'),
      'operational_simulations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'operational_simulation_recorded'),
      'risk_simulations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'risk_simulation_recorded'),
      'impact_reviews', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'impact_simulation_reviewed'),
      'tradeoff_reviews', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'tradeoff_analysis_reviewed'),
      'confidence_reviews', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_confidence_reviewed'),
      'cost_benefits', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'cost_benefit_recorded'),
      'rankings', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_ranking_recorded'),
      'comparisons', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_comparison_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'executive_decision_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'executive_decision_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_recommendation_recorded'),
      'scenario_review_requests', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_review_reference_recorded'),
      'human_decisions', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'human_decision_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'scenario_learning_recorded'),
      'mission_links', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'mission_reference_linked'),
      'portfolio_links', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'portfolio_reference_linked'),
      'environment_links', (select count(*) from public.ai_enterprise_decision_scenario_events where event_type = 'environment_reference_linked')
    ),
    -- Scenario 원천 실측(전부 읽기 전용):
    'scenario_actuals', jsonb_build_object(
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'ai_reviews_0554', (select count(*) from public.ai_enterprise_ai_reviews),
      'knowledge_memories_0553', (select count(*) from public.ai_enterprise_knowledge_memories),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules),
      'scenario_runs_0542', (select count(*) from public.ai_enterprise_scenario_runs)
    ),
    'scenario_unavailable', jsonb_build_array('financial_planning_system','erp_feed','project_management_feed','hr_capacity_feed','external_forecast_feed','monte_carlo_engine'),   -- 원본 없음(실측 — Simulation 은 수동 입력 기반 후보 계산)
    'scenario_is_not_future_reality', true, 'simulation_is_not_prediction', true,
    'recommendation_is_not_decision', true, 'ranking_is_not_executive_priority', true,
    'tradeoff_is_not_optimal_solution', true, 'cost_estimate_is_not_actual_cost', true,
    'risk_estimate_is_not_actual_risk', true, 'forecast_is_not_future_fact', true,
    'pattern_is_not_causality', true, 'confidence_is_not_certainty', true,
    'no_auto_strategy_execution', true, 'no_auto_project_creation', true, 'no_auto_budget_change', true,
    'no_auto_contract_signing', true, 'no_auto_organization_change', true, 'no_auto_kpi_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_decision_lab_audit(p_limit int default 100)
returns setof public.ai_enterprise_decision_scenario_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_decision_scenario_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_decision_scenarios enable row level security;
alter table public.ai_enterprise_decision_scenario_reviews enable row level security;
alter table public.ai_enterprise_decision_scenario_events enable row level security;

comment on table public.ai_enterprise_decision_scenarios is 'AI-OPS-53 — Decision Scenario(≠ Future Reality·Category 14종·자동 실행 차단·Simulation ≠ Prediction·0542 Scenario 계층과 별개).';
comment on table public.ai_enterprise_decision_scenario_reviews is 'AI-OPS-53 — Scenario Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_decision_scenario_events is 'AI-OPS-53 — Decision Scenario 이벤트 31종(자동 실행 이벤트 생성 금지·Ranking ≠ Executive Priority).';
