-- 0563_admin_ai_enterprise_foresight_intelligence.sql
-- AI-OPS-59 — Enterprise Foresight Intelligence, Strategic Foresight &
-- Long-Term Future Planning Center.
--
-- Enterprise Vision → Mission → Strategy → Innovation → Strategic Foresight →
-- Weak Signal Detection → Future Scenario Modeling → Long-Term Opportunity
-- Analysis → Strategic Option Generation → Executive Foresight Review →
-- Foresight Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Weak Signal ≠ Future Fact — 장기 전략 자동 변경/투자 자동 승인/사업
--    자동 시작/Budget 자동 변경/조직 자동 변경/계약 자동 체결 RPC 자체가 없음.
--  * Trend ≠ Certainty. Scenario ≠ Prediction. Possibility ≠ Probability.
--    Opportunity ≠ Success. Risk ≠ Outcome. Recommendation ≠ Decision.
--  * Confidence ≠ Certainty. Correlation ≠ Causation. Null → 0 변환 금지.
--    insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0549/0551/0555/0556/0557/0559/
--    0560/0561/0562 원본 무변경(참조만).
--  * 이름 실측: ai_enterprise_foresight / foresight_reviews /
--    foresight_events · admin_enterprise_foresight_* 전부 미사용 확인 —
--    스펙 권장명 그대로 사용(충돌 없음).
--  * 미래학 연구/트렌드 DB/전문가 패널/호라이즌 스캐닝 도구/거시경제/
--    포사이트 플랫폼 피드는 실측 부재 — insufficient_data 로 유지(분석은
--    수동 기록 기반).
--  * Weak Signal Timeline/Scenario·Opportunity·Risk Evolution·Strategic
--    Learning History 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Foresight(≠ 예측 원장 — 미래 가능성 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_foresight (
  id                        uuid primary key default gen_random_uuid(),
  foresight_code            text not null,
  foresight_name            text not null,
  foresight_category        text not null check (foresight_category in ('technology','market','society','regulation','competition','customer','product','executive','enterprise','global','custom')),
  foresight_status          text not null default 'observed' check (foresight_status in ('observed','candidate','review_reference','archived_reference','insufficient_data')),
  foresight_summary         text,
  signal_status             text not null default 'insufficient_data' check (signal_status in ('highly_significant_candidate','significant_candidate','emerging_candidate','speculative_candidate','insufficient_data')),
  scenario_status           text not null default 'insufficient_data' check (scenario_status in ('highly_plausible_candidate','plausible_candidate','exploratory_candidate','speculative_candidate','insufficient_data')),
  opportunity_status        text not null default 'insufficient_data' check (opportunity_status in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  innovation_id             uuid,
  decision_scenario_id      uuid,
  environment_observation_id uuid,
  mission_id                uuid,
  signal_result             jsonb,
  scenario_result           jsonb,
  opportunity_result        jsonb,
  risk_result               jsonb,
  option_result             jsonb,
  trend_result              jsonb,
  readiness_result          jsonb,
  horizon_result            jsonb,
  uncertainty_result        jsonb,
  scorecard_result          jsonb,
  foresight_history         jsonb not null default '[]'::jsonb,   -- Weak Signal Timeline/Scenario·Opportunity·Risk Evolution·Strategic Learning History 통합 append
  recommendation_candidate  jsonb,
  foresight_reviews         jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aefs_idem on public.ai_enterprise_foresight (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aefs_status on public.ai_enterprise_foresight (foresight_status, foresight_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Foresight Review(§9 — 요청/Reference 기록만, 장기 전략 결정은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_foresight_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  foresight_id              uuid not null,
  review_type               text not null check (review_type in ('foresight_review','executive_review','human_review')),
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
create unique index if not exists uq_aefr_idem on public.ai_enterprise_foresight_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aefr_fs on public.ai_enterprise_foresight_reviews (foresight_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Foresight 이벤트(31종) — Signal/Scenario/Opportunity/Risk/Option/Trend/
--    Readiness/Horizon/Uncertainty/Timeline/Scorecard/Recommendation/Review/
--    Learning/Link 통합 Audit(자동 전략 변경 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_foresight_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('foresight_observed','foresight_reviewed','weak_signal_reviewed','future_scenario_reviewed','long_term_opportunity_reviewed','long_term_risk_reviewed','strategic_option_recorded','trend_evolution_reviewed','scenario_readiness_reviewed','opportunity_horizon_reviewed','uncertainty_reviewed','foresight_timeline_recorded','executive_foresight_summary_recorded','executive_foresight_scorecard_recorded','foresight_recommendation_recorded','foresight_review_created','foresight_review_reviewed','foresight_review_requested','executive_review_requested','human_review_requested','foresight_review_reference_recorded','foresight_revision_requested','foresight_learning_recorded','innovation_reference_linked','improvement_reference_linked','transformation_reference_linked','value_reference_linked','scenario_reference_linked','environment_reference_linked','mission_reference_linked','governance_reference_linked')),
  foresight_id              uuid,
  foresight_review_id       uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aefse_evt on public.ai_enterprise_foresight_events (event_type, created_at desc);
create index if not exists idx_aefse_fs on public.ai_enterprise_foresight_events (foresight_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Foresight 생성 — 자동 장기 전략 변경 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_foresight_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_foresight;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'foresight_category','');
  -- 자동 장기 전략 변경/투자 승인/사업 시작/Budget·조직 변경/계약 체결 계열 — 구조적 차단.
  if v_cat in ('automatic_long_term_strategy_change','automatic_investment_approval','automatic_business_launch','automatic_budget_change','automatic_organization_change','automatic_contract_signing') then
    raise exception '금지된 foresight_category(자동 장기 전략 변경 계열 비활성)';
  end if;
  if v_cat not in ('technology','market','society','regulation','competition','customer','product','executive','enterprise','global','custom') then
    raise exception '허용되지 않는 foresight_category';
  end if;
  if coalesce(btrim(p_payload->>'foresight_name'),'') = '' then raise exception 'foresight_name 필수'; end if;
  if nullif(p_payload->>'innovation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_innovations where id = (p_payload->>'innovation_id')::uuid) then
    raise exception 'Innovation 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_foresight where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'weak_signal_is_not_future_fact', true); end if;
  end if;
  insert into public.ai_enterprise_foresight (foresight_code, foresight_name, foresight_category, foresight_summary, innovation_id, decision_scenario_id, environment_observation_id, mission_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'foresight_code',''), 'EFS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'foresight_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'foresight_summary',''), 2000),''),
    nullif(p_payload->>'innovation_id','')::uuid, nullif(p_payload->>'decision_scenario_id','')::uuid,
    nullif(p_payload->>'environment_observation_id','')::uuid, nullif(p_payload->>'mission_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, detail, payload, actor_id)
  values ('foresight_observed', v_id, left(v_cat, 80) || ' (미래 가능성 관측 Candidate — 자동 전략 변경 없음)', jsonb_build_object('foresight_name', p_payload->>'foresight_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'observed', 'weak_signal_is_not_future_fact', true, 'long_term_strategy_changed', false, 'investment_approved', false, 'business_launched', false, 'budget_changed', false, 'organization_changed', false, 'contract_signed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Foresight 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_foresight_review(p_foresight_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_foresight; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'foresight_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_observed','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_foresight where id = p_foresight_id;
  if v_row.id is null then raise exception 'Foresight 없음(실존 검증 실패)'; end if;
  if v_row.foresight_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_observed' then v_next := 'observed'; v_note := ' (관측 상태 표시 ≠ 전략 결정)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 장기 전략 결정은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Foresight Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 장기 전략 결정은 사람)'; v_evt := 'foresight_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'long_term_strategy_changed', false, 'investment_approved', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_foresight set review_reference = v_ref, foresight_reviews = foresight_reviews || jsonb_build_array(v_ref) where id = p_foresight_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_foresight set foresight_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_foresight_id;
  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, detail, payload, actor_id)
  values (v_evt, p_foresight_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_foresight_id, 'status', v_next, 'weak_signal_is_not_future_fact', true, 'long_term_strategy_changed', false, 'investment_approved', false, 'business_launched', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Foresight Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_foresight_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_fs public.ai_enterprise_foresight; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_foresight_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('foresight_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'foresight_id','') is null then raise exception 'foresight_id 필수'; end if;
  select * into v_fs from public.ai_enterprise_foresight where id = (p_payload->>'foresight_id')::uuid;
  if v_fs.id is null then raise exception 'Foresight 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_foresight_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_foresight_reviews (review_code, foresight_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EFR-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_fs.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'foresight_review' then 'foresight_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, foresight_review_id, detail, payload, actor_id)
  values (v_evt, v_fs.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 장기 전략 결정은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, foresight_review_id, detail, payload, actor_id)
  values ('foresight_review_created', v_fs.id, v_id, 'Foresight Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'long_term_strategy_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_foresight_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_foresight_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_foresight_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Foresight Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'long_term_strategy_changed', false, 'investment_approved', false, 'business_launched', false,
    'budget_changed', false, 'organization_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 장기 전략 결정은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Foresight Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 장기 전략 결정은 사람)';
    update public.ai_enterprise_foresight_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_foresight set
      foresight_reviews = foresight_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.foresight_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_foresight_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, foresight_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'foresight_review_reference_recorded' when p_action = 'request_revision' then 'foresight_revision_requested' else 'foresight_review_reviewed' end,
    v_row.foresight_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'long_term_strategy_changed', false, 'investment_approved', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Foresight 이벤트 기록(통합) — 자동 전략 변경 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_foresight_event_record(p_kind text, p_reason text, p_payload jsonb, p_foresight_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('weak_signal_reviewed','future_scenario_reviewed','long_term_opportunity_reviewed','long_term_risk_reviewed','strategic_option_recorded','trend_evolution_reviewed','scenario_readiness_reviewed','opportunity_horizon_reviewed','uncertainty_reviewed','foresight_timeline_recorded','executive_foresight_summary_recorded','executive_foresight_scorecard_recorded','foresight_recommendation_recorded','foresight_review_requested','executive_review_requested','human_review_requested','foresight_learning_recorded','innovation_reference_linked','improvement_reference_linked','transformation_reference_linked','value_reference_linked','scenario_reference_linked','environment_reference_linked','mission_reference_linked','governance_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_foresight_id is not null and not exists (select 1 from public.ai_enterprise_foresight where id = p_foresight_id) then raise exception 'Foresight 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_foresight_reviews where id = p_review_id) then raise exception 'Foresight Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'weak_signal_reviewed' then
    if coalesce(p_payload->>'signal_dimension','') not in ('signal_strength','evidence','consistency','relevance','strategic_importance') then
      raise exception '허용되지 않는 signal_dimension(§5 — 5종)';
    end if;
    if v_result not in ('highly_significant_candidate','significant_candidate','emerging_candidate','speculative_candidate','insufficient_data') then raise exception '허용되지 않는 signal result(§5 — 5종)'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set signal_status = v_result, signal_result = coalesce(signal_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'signal_dimension', p_payload), foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'future_scenario_reviewed' then
    if coalesce(p_payload->>'scenario_dimension','') not in ('plausibility','strategic_impact','resource_readiness','business_alignment','uncertainty') then
      raise exception '허용되지 않는 scenario_dimension(§6 — 5종)';
    end if;
    if v_result not in ('highly_plausible_candidate','plausible_candidate','exploratory_candidate','speculative_candidate','insufficient_data') then raise exception '허용되지 않는 scenario result(§6 — 5종)'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set scenario_status = v_result, scenario_result = coalesce(scenario_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'scenario_dimension', p_payload), foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'long_term_opportunity_reviewed' then
    if coalesce(p_payload->>'opportunity_dimension','') not in ('growth_potential','sustainability','strategic_value','competitive_advantage','innovation_potential') then
      raise exception '허용되지 않는 opportunity_dimension(§7 — 5종)';
    end if;
    if v_result not in ('exceptional_candidate','strong_candidate','acceptable_candidate','weak_candidate','insufficient_data') then raise exception '허용되지 않는 opportunity result(§7 — 5종)'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set opportunity_status = v_result, opportunity_result = coalesce(opportunity_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'opportunity_dimension', p_payload), foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'long_term_risk_reviewed' then
    if v_result not in ('critical_future_risk_candidate','elevated_future_risk_candidate','manageable_future_risk_candidate','negligible_future_risk_candidate','insufficient_data') then raise exception '허용되지 않는 long term risk result'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set risk_result = p_payload, foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'strategic_option_recorded' then
    -- Recommendation ≠ Decision — Evidence 없이 전략 옵션 기록 차단.
    if v_result not in ('robust_option_candidate','conditional_option_candidate','exploratory_option_candidate','option_unverified','insufficient_data') then raise exception '허용되지 않는 strategic option result'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Strategic Option 기록 금지';
    end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set option_result = p_payload, foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'trend_evolution_reviewed' then
    if v_result not in ('accelerating_trend_candidate','stable_trend_candidate','declining_trend_candidate','trend_unverified','insufficient_data') then raise exception '허용되지 않는 trend result'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set trend_result = p_payload, updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'scenario_readiness_reviewed' then
    if v_result not in ('highly_ready_candidate','mostly_ready_candidate','partially_ready_candidate','not_ready_candidate','insufficient_data') then raise exception '허용되지 않는 readiness result'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set readiness_result = p_payload, updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'opportunity_horizon_reviewed' then
    if v_result not in ('near_horizon_candidate','mid_horizon_candidate','long_horizon_candidate','horizon_unverified','insufficient_data') then raise exception '허용되지 않는 horizon result'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set horizon_result = p_payload, updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'uncertainty_reviewed' then
    if v_result not in ('low_uncertainty_candidate','moderate_uncertainty_candidate','high_uncertainty_candidate','critical_uncertainty_candidate','insufficient_data') then raise exception '허용되지 않는 uncertainty result'; end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set uncertainty_result = p_payload, updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'foresight_timeline_recorded' and p_foresight_id is not null then
    update public.ai_enterprise_foresight set foresight_history = foresight_history || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id;
  end if;
  if p_kind = 'executive_foresight_scorecard_recorded' and p_foresight_id is not null then
    update public.ai_enterprise_foresight set scorecard_result = p_payload, updated_at = now() where id = p_foresight_id;
  end if;
  if p_kind = 'foresight_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_foresight_candidate','review_weak_signal','review_future_scenario','review_long_term_opportunity','review_long_term_risk','record_strategic_option','review_trend_evolution','review_scenario_readiness','review_opportunity_horizon','review_uncertainty','record_foresight_timeline','build_executive_foresight_summary','build_executive_foresight_scorecard','request_foresight_review','request_executive_review','request_human_review','record_foresight_learning','link_innovation_reference','link_scenario_reference','link_environment_reference','monitor_signal_candidate','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Foresight Recommendation 금지';
    end if;
    if p_foresight_id is not null then update public.ai_enterprise_foresight set recommendation_candidate = p_payload, updated_at = now() where id = p_foresight_id; end if;
  end if;
  if p_kind = 'foresight_learning_recorded' and p_foresight_id is not null then
    update public.ai_enterprise_foresight set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_foresight_id;
  end if;
  if p_kind = 'innovation_reference_linked' and nullif(p_payload->>'innovation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_innovations where id = (p_payload->>'innovation_id')::uuid) then
    raise exception 'Innovation 없음(실존 검증 실패 — 0562)';
  end if;
  if p_kind = 'improvement_reference_linked' and nullif(p_payload->>'improvement_id','') is not null
     and not exists (select 1 from public.ai_enterprise_improvements where id = (p_payload->>'improvement_id')::uuid) then
    raise exception 'Improvement 없음(실존 검증 실패 — 0561)';
  end if;
  if p_kind = 'transformation_reference_linked' and nullif(p_payload->>'transformation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid) then
    raise exception 'Transformation 없음(실존 검증 실패 — 0560)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'value_realization_id','') is not null
     and not exists (select 1 from public.ai_enterprise_value_realizations where id = (p_payload->>'value_realization_id')::uuid) then
    raise exception 'Value Realization 없음(실존 검증 실패 — 0559)';
  end if;
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;
  if p_kind = 'environment_reference_linked' and nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_foresight_events (event_type, foresight_id, foresight_review_id, detail, payload, actor_id)
  values (p_kind, p_foresight_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'weak_signal_reviewed' then ' (Weak Signal ≠ Future Fact)'
      when p_kind = 'future_scenario_reviewed' then ' (Scenario ≠ Prediction)'
      when p_kind = 'long_term_opportunity_reviewed' then ' (Opportunity ≠ Success)'
      when p_kind = 'long_term_risk_reviewed' then ' (Risk ≠ Outcome)'
      when p_kind = 'strategic_option_recorded' then ' (Strategic Option ≠ 전략 결정)'
      when p_kind = 'trend_evolution_reviewed' then ' (Trend ≠ Certainty)'
      when p_kind = 'scenario_readiness_reviewed' then ' (Readiness ≠ Success)'
      when p_kind = 'opportunity_horizon_reviewed' then ' (Horizon 관측 ≠ 시점 확정)'
      when p_kind = 'uncertainty_reviewed' then ' (Unknown 은 Unknown 으로 유지)'
      when p_kind = 'foresight_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_foresight_summary_recorded' then ' (Summary ≠ 전략 확정)'
      when p_kind = 'executive_foresight_scorecard_recorded' then ' (Scorecard ≠ 전략 지시)'
      when p_kind = 'foresight_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'foresight_review_requested' then ' (Foresight Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — 장기 전략 결정은 사람)'
      when p_kind = 'foresight_learning_recorded' then ' (Foresight Learning ≠ 자동 전략 변경)'
      when p_kind = 'innovation_reference_linked' then ' (Innovation Reference ≠ 사업 시작 — 0562 참조만)'
      when p_kind = 'improvement_reference_linked' then ' (Improvement Reference ≠ 개선 적용 — 0561 참조만)'
      when p_kind = 'transformation_reference_linked' then ' (Transformation Reference ≠ 조직 변경 — 0560 참조만)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 투자 결정 — 0559 참조만)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      when p_kind = 'environment_reference_linked' then ' (Environment Reference ≠ 전략 변경 — 0556 참조만)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인 — 0551 참조만)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'long_term_strategy_changed', false, 'investment_approved', false, 'business_launched', false, 'budget_changed', false, 'organization_changed', false, 'contract_signed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_foresight_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_foresight language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_foresight
  where (p_status is null or foresight_status = p_status)
    and (p_category is null or foresight_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_foresight_reviews_list(p_foresight_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_foresight_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_foresight_reviews
  where (p_foresight_id is null or foresight_id = p_foresight_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_foresight_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'foresights', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_foresight),
      'observed', (select count(*) from public.ai_enterprise_foresight where foresight_status = 'observed'),
      'candidate', (select count(*) from public.ai_enterprise_foresight where foresight_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_foresight where foresight_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_foresight where foresight_status = 'archived_reference'),
      'highly_significant', (select count(*) from public.ai_enterprise_foresight where signal_status = 'highly_significant_candidate'),
      'speculative_signals', (select count(*) from public.ai_enterprise_foresight where signal_status = 'speculative_candidate'),
      'highly_plausible', (select count(*) from public.ai_enterprise_foresight where scenario_status = 'highly_plausible_candidate'),
      'exploratory_scenarios', (select count(*) from public.ai_enterprise_foresight where scenario_status in ('exploratory_candidate','speculative_candidate')),
      'exceptional_opportunities', (select count(*) from public.ai_enterprise_foresight where opportunity_status in ('exceptional_candidate','strong_candidate')),
      'weak_opportunities', (select count(*) from public.ai_enterprise_foresight where opportunity_status = 'weak_candidate'),
      'by_category', (select coalesce(jsonb_object_agg(foresight_category, cnt), '{}'::jsonb) from (select foresight_category, count(*) cnt from public.ai_enterprise_foresight group by foresight_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_foresight_reviews),
      'requested', (select count(*) from public.ai_enterprise_foresight_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_foresight_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_foresight_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_foresight_reviews where review_status = 'revision_requested')
    ),
    'foresight_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_foresight_events),
      'signal_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'weak_signal_reviewed'),
      'scenario_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'future_scenario_reviewed'),
      'opportunity_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'long_term_opportunity_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'long_term_risk_reviewed'),
      'strategic_options', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'strategic_option_recorded'),
      'trend_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'trend_evolution_reviewed'),
      'readiness_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'scenario_readiness_reviewed'),
      'horizon_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'opportunity_horizon_reviewed'),
      'uncertainty_reviews', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'uncertainty_reviewed'),
      'timelines', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'foresight_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'executive_foresight_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'executive_foresight_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'foresight_recommendation_recorded'),
      'foresight_review_requests', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'foresight_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'foresight_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'foresight_learning_recorded'),
      'innovation_links', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'innovation_reference_linked'),
      'scenario_links', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'scenario_reference_linked'),
      'environment_links', (select count(*) from public.ai_enterprise_foresight_events where event_type = 'environment_reference_linked')
    ),
    -- Foresight 원천 실측(전부 읽기 전용):
    'foresight_actuals', jsonb_build_object(
      'innovations_0562', (select count(*) from public.ai_enterprise_innovations),
      'improvements_0561', (select count(*) from public.ai_enterprise_improvements),
      'transformations_0560', (select count(*) from public.ai_enterprise_transformations),
      'value_realizations_0559', (select count(*) from public.ai_enterprise_value_realizations),
      'decision_scenarios_0557', (select count(*) from public.ai_enterprise_decision_scenarios),
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'foresight_unavailable', jsonb_build_array('futures_research_feed','trend_database_feed','expert_panel_feed','horizon_scanning_tool','macroeconomic_feed','foresight_platform_feed'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'weak_signal_is_not_future_fact', true, 'trend_is_not_certainty', true,
    'scenario_is_not_prediction', true, 'possibility_is_not_probability', true,
    'opportunity_is_not_success', true, 'risk_is_not_outcome', true,
    'recommendation_is_not_decision', true, 'confidence_is_not_certainty', true,
    'correlation_is_not_causation', true,
    'no_auto_long_term_strategy_change', true, 'no_auto_investment_approval', true, 'no_auto_business_launch', true,
    'no_auto_budget_change', true, 'no_auto_organization_change', true, 'no_auto_contract_signing', true,
    'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_foresight_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_foresight_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_foresight_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_foresight enable row level security;
alter table public.ai_enterprise_foresight_reviews enable row level security;
alter table public.ai_enterprise_foresight_events enable row level security;

comment on table public.ai_enterprise_foresight is 'AI-OPS-59 — Foresight(≠ 예측 원장·Category 11종·자동 전략 변경 차단·Weak Signal ≠ Future Fact·Scenario ≠ Prediction).';
comment on table public.ai_enterprise_foresight_reviews is 'AI-OPS-59 — Foresight Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_foresight_events is 'AI-OPS-59 — Foresight 이벤트 31종(자동 전략 변경 이벤트 생성 금지·Possibility ≠ Probability).';
