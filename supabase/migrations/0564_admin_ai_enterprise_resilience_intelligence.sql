-- 0564_admin_ai_enterprise_resilience_intelligence.sql
-- AI-OPS-60 — Enterprise Resilience Intelligence, Adaptive Response &
-- Business Continuity Center.
--
-- Enterprise Vision → Mission → Strategy → Innovation → Strategic Foresight →
-- Risk Signal Detection → Enterprise Resilience Assessment → Adaptive
-- Response Planning → Business Continuity Analysis → Recovery Readiness →
-- Executive Resilience Review → Resilience Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Resilience ≠ Guaranteed Survival — 자동 복구 실행/자동 장애 조치/자동
--    전략 변경/자동 조직 변경/자동 Budget 변경 RPC 자체가 없음.
--  * Recovery Plan ≠ Successful Recovery. Preparedness ≠ Readiness.
--    Scenario ≠ Reality. Recommendation ≠ Decision.
--    Recovery Score ≠ Recovery Success.
--  * Confidence ≠ Certainty. Correlation ≠ Causation. Null → 0 변환 금지.
--    insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0547/0551/0555/0556/0558/0560/
--    0561/0562/0563 원본 무변경(참조만).
--  * 이름 실측: ai_enterprise_resilience / resilience_reviews /
--    resilience_events · admin_enterprise_resilience_* 전부 미사용 확인 —
--    스펙 권장명 그대로 사용. 기존 riskResilience(0528)/selfHealing(0502)/
--    CapacityContinuity(0508) 계층과 별개(원본 무변경).
--  * 스펙 §1 의 ai_enterprise_resource_capacity 테이블은 실측 부재 —
--    실제 자원/용량 원장은 ai_enterprise_capacity_resources(0558)로 참조.
--  * 인시던트 관리/모니터링 알림/재해복구 시스템/백업 검증/공급망/BCP 훈련
--    기록 피드는 실측 부재 — insufficient_data 로 유지(분석은 수동 기록 기반).
--  * Recovery Timeline/Resilience·Risk Response·Business Continuity·Learning
--    History 는 신규 테이블 대신 JSONB + Events 통합(3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Resilience(≠ 복구 실행 원장 — 회복력 관측용).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resilience (
  id                        uuid primary key default gen_random_uuid(),
  resilience_code           text not null,
  resilience_name           text not null,
  resilience_category       text not null check (resilience_category in ('infrastructure','operations','technology','workforce','supply_chain','finance','governance','security','executive','enterprise','custom')),
  resilience_status         text not null default 'observed' check (resilience_status in ('observed','candidate','review_reference','archived_reference','insufficient_data')),
  resilience_summary        text,
  assessment_status         text not null default 'insufficient_data' check (assessment_status in ('highly_resilient','resilient','partially_resilient','vulnerable','insufficient_data')),
  recovery_status           text not null default 'insufficient_data' check (recovery_status in ('fully_ready','mostly_ready','partially_ready','not_ready','insufficient_data')),
  adaptive_status           text not null default 'insufficient_data' check (adaptive_status in ('highly_adaptive','adaptive','partially_adaptive','rigid','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  foresight_id              uuid,
  transformation_id         uuid,
  capacity_resource_id      uuid,
  environment_observation_id uuid,
  assessment_result         jsonb,
  recovery_result           jsonb,
  adaptive_result           jsonb,
  continuity_result         jsonb,
  stability_result          jsonb,
  risk_signal_result        jsonb,
  spof_result               jsonb,
  priority_risk_result      jsonb,
  scorecard_result          jsonb,
  resilience_history        jsonb not null default '[]'::jsonb,   -- Recovery Timeline/Resilience·Risk Response·Business Continuity·Learning History 통합 append
  recommendation_candidate  jsonb,
  resilience_reviews        jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aers_idem on public.ai_enterprise_resilience (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aers_status on public.ai_enterprise_resilience (resilience_status, resilience_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Resilience Review(§9 — 요청/Reference 기록만, Recovery 실행은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resilience_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  resilience_id             uuid not null,
  review_type               text not null check (review_type in ('resilience_review','executive_review','human_review')),
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
create unique index if not exists uq_aerv_idem on public.ai_enterprise_resilience_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aerv_rs on public.ai_enterprise_resilience_reviews (resilience_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Resilience 이벤트(31종) — Assessment/Recovery/Adaptive/Continuity/
--    Stability/Risk Signal/SPOF/Priority Risk/Timeline/Scorecard/
--    Recommendation/Review/Learning/Link 통합 Audit(자동 복구 이벤트 생성
--    금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_resilience_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('resilience_observed','resilience_reviewed','resilience_assessment_reviewed','recovery_readiness_reviewed','adaptive_response_reviewed','business_continuity_reviewed','operational_stability_reviewed','risk_signal_reviewed','spof_reviewed','priority_risk_reviewed','recovery_recommendation_recorded','recovery_timeline_recorded','executive_resilience_summary_recorded','executive_resilience_scorecard_recorded','resilience_review_created','resilience_review_reviewed','resilience_review_requested','executive_review_requested','human_review_requested','resilience_review_reference_recorded','resilience_revision_requested','resilience_learning_recorded','foresight_reference_linked','innovation_reference_linked','improvement_reference_linked','transformation_reference_linked','capacity_reference_linked','environment_reference_linked','mission_reference_linked','governance_reference_linked','scenario_reference_linked')),
  resilience_id             uuid,
  resilience_review_id      uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aerse_evt on public.ai_enterprise_resilience_events (event_type, created_at desc);
create index if not exists idx_aerse_rs on public.ai_enterprise_resilience_events (resilience_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Resilience 생성 — 자동 복구 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resilience_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_resilience;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'resilience_category','');
  -- 자동 복구 실행/장애 조치/전략·조직·Budget 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_recovery_execution','automatic_failover','automatic_strategy_change','automatic_organization_change','automatic_budget_change') then
    raise exception '금지된 resilience_category(자동 복구 계열 비활성)';
  end if;
  if v_cat not in ('infrastructure','operations','technology','workforce','supply_chain','finance','governance','security','executive','enterprise','custom') then
    raise exception '허용되지 않는 resilience_category';
  end if;
  if coalesce(btrim(p_payload->>'resilience_name'),'') = '' then raise exception 'resilience_name 필수'; end if;
  if nullif(p_payload->>'foresight_id','') is not null
     and not exists (select 1 from public.ai_enterprise_foresight where id = (p_payload->>'foresight_id')::uuid) then
    raise exception 'Foresight 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'transformation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_transformations where id = (p_payload->>'transformation_id')::uuid) then
    raise exception 'Transformation 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패 — 0558)';
  end if;
  if nullif(p_payload->>'environment_observation_id','') is not null
     and not exists (select 1 from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid) then
    raise exception 'Environment Observation 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_resilience where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'resilience_is_not_guaranteed_survival', true); end if;
  end if;
  insert into public.ai_enterprise_resilience (resilience_code, resilience_name, resilience_category, resilience_summary, foresight_id, transformation_id, capacity_resource_id, environment_observation_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'resilience_code',''), 'ERS-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'resilience_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'resilience_summary',''), 2000),''),
    nullif(p_payload->>'foresight_id','')::uuid, nullif(p_payload->>'transformation_id','')::uuid,
    nullif(p_payload->>'capacity_resource_id','')::uuid, nullif(p_payload->>'environment_observation_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, detail, payload, actor_id)
  values ('resilience_observed', v_id, left(v_cat, 80) || ' (회복력 관측 Candidate — 자동 복구 없음)', jsonb_build_object('resilience_name', p_payload->>'resilience_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'observed', 'resilience_is_not_guaranteed_survival', true, 'recovery_executed', false, 'failover_applied', false, 'strategy_changed', false, 'organization_changed', false, 'budget_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Resilience 검토 — 관측 상태 표시 + Reference(Self 차단·Evidence).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resilience_review(p_resilience_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_resilience; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'resilience_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_observed','mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_resilience where id = p_resilience_id;
  if v_row.id is null then raise exception 'Resilience 없음(실존 검증 실패)'; end if;
  if v_row.resilience_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_observed' then v_next := 'observed'; v_note := ' (관측 상태 표시 ≠ 복구 실행)';
  elsif p_action = 'mark_candidate' then v_next := 'candidate'; v_note := ' (Candidate ≠ 승인 — Recommendation ≠ Decision)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Recovery 실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Resilience Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — Recovery 실행은 사람)'; v_evt := 'resilience_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'recovery_executed', false, 'failover_applied', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_resilience set review_reference = v_ref, resilience_reviews = resilience_reviews || jsonb_build_array(v_ref) where id = p_resilience_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_resilience set resilience_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_resilience_id;
  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, detail, payload, actor_id)
  values (v_evt, p_resilience_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_resilience_id, 'status', v_next, 'resilience_is_not_guaranteed_survival', true, 'recovery_executed', false, 'failover_applied', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Resilience Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resilience_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_rs public.ai_enterprise_resilience; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_resilience_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('resilience_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'resilience_id','') is null then raise exception 'resilience_id 필수'; end if;
  select * into v_rs from public.ai_enterprise_resilience where id = (p_payload->>'resilience_id')::uuid;
  if v_rs.id is null then raise exception 'Resilience 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_resilience_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_resilience_reviews (review_code, resilience_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'ERV-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_rs.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'resilience_review' then 'resilience_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, resilience_review_id, detail, payload, actor_id)
  values (v_evt, v_rs.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — Recovery 실행은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, resilience_review_id, detail, payload, actor_id)
  values ('resilience_review_created', v_rs.id, v_id, 'Resilience Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'recovery_executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_resilience_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_resilience_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_resilience_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Resilience Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'recovery_executed', false, 'failover_applied', false, 'strategy_changed', false,
    'organization_changed', false, 'budget_changed', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Recovery 실행은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Resilience Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — Recovery 실행은 사람)';
    update public.ai_enterprise_resilience_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_resilience set
      resilience_reviews = resilience_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.resilience_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_resilience_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, resilience_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'resilience_review_reference_recorded' when p_action = 'request_revision' then 'resilience_revision_requested' else 'resilience_review_reviewed' end,
    v_row.resilience_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'recovery_executed', false, 'failover_applied', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Resilience 이벤트 기록(통합) — 자동 복구 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resilience_event_record(p_kind text, p_reason text, p_payload jsonb, p_resilience_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('resilience_assessment_reviewed','recovery_readiness_reviewed','adaptive_response_reviewed','business_continuity_reviewed','operational_stability_reviewed','risk_signal_reviewed','spof_reviewed','priority_risk_reviewed','recovery_recommendation_recorded','recovery_timeline_recorded','executive_resilience_summary_recorded','executive_resilience_scorecard_recorded','resilience_review_requested','executive_review_requested','human_review_requested','resilience_learning_recorded','foresight_reference_linked','innovation_reference_linked','improvement_reference_linked','transformation_reference_linked','capacity_reference_linked','environment_reference_linked','mission_reference_linked','governance_reference_linked','scenario_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_resilience_id is not null and not exists (select 1 from public.ai_enterprise_resilience where id = p_resilience_id) then raise exception 'Resilience 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_resilience_reviews where id = p_review_id) then raise exception 'Resilience Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'resilience_assessment_reviewed' then
    if coalesce(p_payload->>'resilience_dimension','') not in ('operational_stability','recovery_capability','adaptive_capacity','resource_redundancy','business_continuity') then
      raise exception '허용되지 않는 resilience_dimension(§5 — 5종)';
    end if;
    if v_result not in ('highly_resilient','resilient','partially_resilient','vulnerable','insufficient_data') then raise exception '허용되지 않는 resilience result(§5 — 5종)'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set assessment_status = v_result, assessment_result = coalesce(assessment_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'resilience_dimension', p_payload), resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'recovery_readiness_reviewed' then
    if coalesce(p_payload->>'recovery_dimension','') not in ('recovery_time','recovery_resources','recovery_dependencies','recovery_procedures','recovery_confidence') then
      raise exception '허용되지 않는 recovery_dimension(§6 — 5종)';
    end if;
    if v_result not in ('fully_ready','mostly_ready','partially_ready','not_ready','insufficient_data') then raise exception '허용되지 않는 recovery result(§6 — 5종)'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set recovery_status = v_result, recovery_result = coalesce(recovery_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'recovery_dimension', p_payload), resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'adaptive_response_reviewed' then
    if coalesce(p_payload->>'adaptive_dimension','') not in ('response_speed','decision_agility','organizational_flexibility','resource_adaptability','learning_capability') then
      raise exception '허용되지 않는 adaptive_dimension(§7 — 5종)';
    end if;
    if v_result not in ('highly_adaptive','adaptive','partially_adaptive','rigid','insufficient_data') then raise exception '허용되지 않는 adaptive result(§7 — 5종)'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set adaptive_status = v_result, adaptive_result = coalesce(adaptive_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'adaptive_dimension', p_payload), resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'business_continuity_reviewed' then
    if v_result not in ('continuity_assured_candidate','continuity_gap_candidate','continuity_critical_gap_candidate','continuity_unverified','insufficient_data') then raise exception '허용되지 않는 continuity result'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set continuity_result = p_payload, resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'operational_stability_reviewed' then
    if v_result not in ('stable_candidate','minor_instability_candidate','unstable_candidate','stability_unverified','insufficient_data') then raise exception '허용되지 않는 stability result'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set stability_result = p_payload, updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'risk_signal_reviewed' then
    if v_result not in ('critical_risk_signal_candidate','elevated_risk_signal_candidate','moderate_risk_signal_candidate','low_risk_signal_candidate','insufficient_data') then raise exception '허용되지 않는 risk signal result'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set risk_signal_result = p_payload, resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'spof_reviewed' then
    -- SPOF 지목은 Evidence 필수(단일 장애점 ≠ 실패 확정).
    if v_result not in ('confirmed_spof_candidate','suspected_spof_candidate','redundant_candidate','spof_unverified','insufficient_data') then raise exception '허용되지 않는 spof result'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 SPOF 기록 금지';
    end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set spof_result = p_payload, updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'priority_risk_reviewed' then
    if v_result not in ('top_priority_candidate','high_priority_candidate','medium_priority_candidate','low_priority_candidate','insufficient_data') then raise exception '허용되지 않는 priority risk result'; end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set priority_risk_result = p_payload, updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'recovery_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_resilience_candidate','review_resilience_assessment','review_recovery_readiness','review_adaptive_response','review_business_continuity','review_operational_stability','review_risk_signal','review_spof','review_priority_risk','record_recovery_timeline','build_executive_resilience_summary','build_executive_resilience_scorecard','request_resilience_review','request_executive_review','request_human_review','record_resilience_learning','link_foresight_reference','link_capacity_reference','link_environment_reference','redundancy_review_candidate','continuity_drill_review_candidate','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Recovery Recommendation 금지';
    end if;
    if p_resilience_id is not null then update public.ai_enterprise_resilience set recommendation_candidate = p_payload, updated_at = now() where id = p_resilience_id; end if;
  end if;
  if p_kind = 'recovery_timeline_recorded' and p_resilience_id is not null then
    update public.ai_enterprise_resilience set resilience_history = resilience_history || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id;
  end if;
  if p_kind = 'executive_resilience_scorecard_recorded' and p_resilience_id is not null then
    update public.ai_enterprise_resilience set scorecard_result = p_payload, updated_at = now() where id = p_resilience_id;
  end if;
  if p_kind = 'resilience_learning_recorded' and p_resilience_id is not null then
    update public.ai_enterprise_resilience set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_resilience_id;
  end if;
  if p_kind = 'foresight_reference_linked' and nullif(p_payload->>'foresight_id','') is not null
     and not exists (select 1 from public.ai_enterprise_foresight where id = (p_payload->>'foresight_id')::uuid) then
    raise exception 'Foresight 없음(실존 검증 실패 — 0563)';
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
  if p_kind = 'capacity_reference_linked' and nullif(p_payload->>'capacity_resource_id','') is not null
     and not exists (select 1 from public.ai_enterprise_capacity_resources where id = (p_payload->>'capacity_resource_id')::uuid) then
    raise exception 'Capacity Resource 없음(실존 검증 실패 — 0558)';
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
  if p_kind = 'scenario_reference_linked' and nullif(p_payload->>'decision_scenario_id','') is not null
     and not exists (select 1 from public.ai_enterprise_decision_scenarios where id = (p_payload->>'decision_scenario_id')::uuid) then
    raise exception 'Decision Scenario 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_resilience_events (event_type, resilience_id, resilience_review_id, detail, payload, actor_id)
  values (p_kind, p_resilience_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'resilience_assessment_reviewed' then ' (Resilience ≠ Guaranteed Survival)'
      when p_kind = 'recovery_readiness_reviewed' then ' (Recovery Score ≠ Recovery Success)'
      when p_kind = 'adaptive_response_reviewed' then ' (Preparedness ≠ Readiness)'
      when p_kind = 'business_continuity_reviewed' then ' (Recovery Plan ≠ Successful Recovery)'
      when p_kind = 'operational_stability_reviewed' then ' (Stability 관측 ≠ 무장애 보장)'
      when p_kind = 'risk_signal_reviewed' then ' (Risk Signal ≠ 사고 확정)'
      when p_kind = 'spof_reviewed' then ' (SPOF 관측 후보 ≠ 실패 확정)'
      when p_kind = 'priority_risk_reviewed' then ' (Priority ≠ Mandatory Order)'
      when p_kind = 'recovery_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'recovery_timeline_recorded' then ' (Timeline 관측 기록 ≠ 복구 확정)'
      when p_kind = 'executive_resilience_summary_recorded' then ' (Summary ≠ 복구 실행 확정)'
      when p_kind = 'executive_resilience_scorecard_recorded' then ' (Scorecard ≠ 복구 지시)'
      when p_kind = 'resilience_review_requested' then ' (Resilience Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'human_review_requested' then ' (Human Review 요청 — Recovery 실행은 사람)'
      when p_kind = 'resilience_learning_recorded' then ' (Resilience Learning ≠ 자동 복구)'
      when p_kind = 'foresight_reference_linked' then ' (Foresight Reference ≠ 전략 변경 — 0563 참조만)'
      when p_kind = 'innovation_reference_linked' then ' (Innovation Reference ≠ 사업 시작 — 0562 참조만)'
      when p_kind = 'improvement_reference_linked' then ' (Improvement Reference ≠ 개선 적용 — 0561 참조만)'
      when p_kind = 'transformation_reference_linked' then ' (Transformation Reference ≠ 조직 변경 — 0560 참조만)'
      when p_kind = 'capacity_reference_linked' then ' (Capacity Reference ≠ 자원 재배치 — 0558 참조만)'
      when p_kind = 'environment_reference_linked' then ' (Environment Reference ≠ 전략 변경 — 0556 참조만)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인 — 0551 참조만)'
      when p_kind = 'scenario_reference_linked' then ' (Scenario Reference ≠ 실행 확정)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'recovery_executed', false, 'failover_applied', false, 'strategy_changed', false, 'organization_changed', false, 'budget_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_resilience_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_resilience language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resilience
  where (p_status is null or resilience_status = p_status)
    and (p_category is null or resilience_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_resilience_reviews_list(p_resilience_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_resilience_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resilience_reviews
  where (p_resilience_id is null or resilience_id = p_resilience_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_resilience_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'resiliences', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resilience),
      'observed', (select count(*) from public.ai_enterprise_resilience where resilience_status = 'observed'),
      'candidate', (select count(*) from public.ai_enterprise_resilience where resilience_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_resilience where resilience_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_resilience where resilience_status = 'archived_reference'),
      'highly_resilient', (select count(*) from public.ai_enterprise_resilience where assessment_status = 'highly_resilient'),
      'vulnerable', (select count(*) from public.ai_enterprise_resilience where assessment_status = 'vulnerable'),
      'fully_ready', (select count(*) from public.ai_enterprise_resilience where recovery_status = 'fully_ready'),
      'not_ready', (select count(*) from public.ai_enterprise_resilience where recovery_status in ('partially_ready','not_ready')),
      'highly_adaptive', (select count(*) from public.ai_enterprise_resilience where adaptive_status in ('highly_adaptive','adaptive')),
      'rigid', (select count(*) from public.ai_enterprise_resilience where adaptive_status in ('partially_adaptive','rigid')),
      'by_category', (select coalesce(jsonb_object_agg(resilience_category, cnt), '{}'::jsonb) from (select resilience_category, count(*) cnt from public.ai_enterprise_resilience group by resilience_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resilience_reviews),
      'requested', (select count(*) from public.ai_enterprise_resilience_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_resilience_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_resilience_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_resilience_reviews where review_status = 'revision_requested')
    ),
    'resilience_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_resilience_events),
      'assessment_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'resilience_assessment_reviewed'),
      'recovery_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'recovery_readiness_reviewed'),
      'adaptive_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'adaptive_response_reviewed'),
      'continuity_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'business_continuity_reviewed'),
      'stability_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'operational_stability_reviewed'),
      'risk_signal_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'risk_signal_reviewed'),
      'spof_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'spof_reviewed'),
      'priority_risk_reviews', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'priority_risk_reviewed'),
      'recommendations', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'recovery_recommendation_recorded'),
      'timelines', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'recovery_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'executive_resilience_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'executive_resilience_scorecard_recorded'),
      'resilience_review_requests', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'resilience_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'resilience_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'resilience_learning_recorded'),
      'foresight_links', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'foresight_reference_linked'),
      'capacity_links', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'capacity_reference_linked'),
      'environment_links', (select count(*) from public.ai_enterprise_resilience_events where event_type = 'environment_reference_linked')
    ),
    -- Resilience 원천 실측(전부 읽기 전용):
    'resilience_actuals', jsonb_build_object(
      'foresights_0563', (select count(*) from public.ai_enterprise_foresight),
      'innovations_0562', (select count(*) from public.ai_enterprise_innovations),
      'improvements_0561', (select count(*) from public.ai_enterprise_improvements),
      'transformations_0560', (select count(*) from public.ai_enterprise_transformations),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'capacity_resources_0558', (select count(*) from public.ai_enterprise_capacity_resources),   -- 스펙 표기 ai_enterprise_resource_capacity 는 부재 — 실제 원장으로 참조
      'environment_observations_0556', (select count(*) from public.ai_enterprise_environment_observations),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'resilience_unavailable', jsonb_build_array('incident_management_feed','monitoring_alert_feed','disaster_recovery_system','backup_verification_feed','supply_chain_feed','bcp_drill_records'),   -- 원본 없음(실측 — 분석은 수동 기록 기반)
    'resilience_is_not_guaranteed_survival', true, 'recovery_plan_is_not_successful_recovery', true,
    'preparedness_is_not_readiness', true, 'scenario_is_not_reality', true,
    'recommendation_is_not_decision', true, 'confidence_is_not_certainty', true,
    'correlation_is_not_causation', true, 'recovery_score_is_not_recovery_success', true,
    'no_auto_recovery_execution', true, 'no_auto_failover', true, 'no_auto_strategy_change', true,
    'no_auto_organization_change', true, 'no_auto_budget_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_resilience_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_resilience_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_resilience_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_resilience enable row level security;
alter table public.ai_enterprise_resilience_reviews enable row level security;
alter table public.ai_enterprise_resilience_events enable row level security;

comment on table public.ai_enterprise_resilience is 'AI-OPS-60 — Resilience(≠ 복구 실행 원장·Category 11종·자동 복구 차단·Resilience ≠ Guaranteed Survival·0502/0508/0528 계층과 별개).';
comment on table public.ai_enterprise_resilience_reviews is 'AI-OPS-60 — Resilience Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_resilience_events is 'AI-OPS-60 — Resilience 이벤트 31종(자동 복구 이벤트 생성 금지·Recovery Score ≠ Recovery Success).';
