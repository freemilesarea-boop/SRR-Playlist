-- 0556_admin_ai_enterprise_environment_intelligence.sql
-- AI-OPS-52 — Enterprise Ecosystem Intelligence, External Intelligence &
-- Strategic Environment Center.
--
-- Enterprise Vision → Enterprise Mission → Internal Intelligence → External
-- Environment → Market/Competitive/Partner/Customer/Technology/Regulatory/
-- Macroeconomic Intelligence → Risk Signal Detection → Strategic Environment
-- Assessment → Executive Environment Review → Environment Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Market Trend ≠ Future Market — Strategy/Mission 자동 변경·계약 자동
--    체결/해지·Partner 자동 승인·Vendor/Budget/Pricing/Product 자동 변경 RPC
--    자체가 없음.
--  * Competitor Analysis ≠ Competitor Intent. Technology Trend ≠ Guaranteed
--    Adoption. Regulation Change ≠ Legal Advice. Customer Trend ≠ Customer
--    Demand. Risk Signal ≠ Actual Risk.
--  * Recommendation ≠ Decision. Pattern ≠ Causality. Forecast ≠ Future Fact.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0496/0514/0520/0545/0547/0549/0551/
--    0553/0554/0555 원본 무변경(참조만).
--  * 외부 시장 데이터/경쟁사 인텔리전스/뉴스/규제 공보/거시경제/고객 서베이
--    피드는 실측 부재 — insufficient_data 로 유지(관측은 수동 기록 기반).
--  * Market/Competitor/Technology/Regulatory Timeline·Environment History 는
--    신규 테이블 대신 JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Environment Observation(≠ 사실 확정 — 외부 환경 관측 원장).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_environment_observations (
  id                        uuid primary key default gen_random_uuid(),
  observation_code          text not null,
  observation_title         text not null,
  environment_category      text not null check (environment_category in ('market','customer','competitor','partner','vendor','technology','regulation','economy','finance','security','ai','esg','global','executive','custom')),
  observation_status        text not null default 'observed' check (observation_status in ('observed','candidate','review_reference','archived_reference','insufficient_data')),
  observation_summary       text,
  signal_status             text not null default 'insufficient_data' check (signal_status in ('strong_signal_candidate','moderate_signal_candidate','weak_signal_candidate','unsupported_candidate','insufficient_data')),
  impact_status             text not null default 'insufficient_data' check (impact_status in ('high_impact_candidate','medium_impact_candidate','low_impact_candidate','impact_unknown','insufficient_data')),
  risk_status               text not null default 'insufficient_data' check (risk_status in ('critical_candidate','elevated_candidate','normal_candidate','unverified_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  mission_id                uuid,
  strategy_portfolio_id     uuid,
  market_result             jsonb,
  competitive_result        jsonb,
  partner_result            jsonb,
  customer_result           jsonb,
  technology_result         jsonb,
  regulatory_result         jsonb,
  economic_result           jsonb,
  risk_result               jsonb,
  impact_result             jsonb,
  mapping_result            jsonb,
  relationship_result       jsonb,
  scorecard_result          jsonb,
  environment_history       jsonb not null default '[]'::jsonb,   -- Market/Competitor/Technology/Regulatory Timeline 통합 append
  recommendation_candidate  jsonb,
  environment_reviews       jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aeeo_idem on public.ai_enterprise_environment_observations (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeeo_status on public.ai_enterprise_environment_observations (observation_status, environment_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Environment Review(§9 — 요청/Reference 기록만, 전략·계약 변경은 사람).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_environment_reviews (
  id                        uuid primary key default gen_random_uuid(),
  review_code               text not null,
  environment_observation_id uuid not null,
  review_type               text not null check (review_type in ('environment_review','executive_review','human_review')),
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
create unique index if not exists uq_aeer_idem on public.ai_enterprise_environment_reviews (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeer_obs on public.ai_enterprise_environment_reviews (environment_observation_id, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Environment 이벤트(31종) — Market/Competitive/Partner/Customer/
--    Technology/Regulatory/Economic/Risk/Impact/Mapping/Relationship/
--    Timeline/Scorecard/Recommendation/Review/Learning/Link 통합 Audit
--    (자동 전략 변경 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_environment_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('environment_observation_created','environment_observation_reviewed','market_trend_reviewed','competitive_landscape_reviewed','partner_relationship_reviewed','customer_trend_reviewed','technology_trend_reviewed','regulatory_change_reviewed','economic_signal_reviewed','risk_signal_reviewed','environment_impact_reviewed','environment_mapping_recorded','ecosystem_relationship_recorded','environment_timeline_recorded','executive_environment_summary_recorded','executive_environment_scorecard_recorded','environment_recommendation_recorded','environment_review_created','environment_review_reviewed','environment_review_requested','executive_review_requested','human_review_requested','environment_review_reference_recorded','environment_revision_requested','environment_learning_recorded','mission_reference_linked','portfolio_reference_linked','program_reference_linked','value_reference_linked','governance_reference_linked','knowledge_reference_linked')),
  environment_observation_id uuid,
  environment_review_id     uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeee_evt on public.ai_enterprise_environment_events (event_type, created_at desc);
create index if not exists idx_aeee_obs on public.ai_enterprise_environment_events (environment_observation_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Environment Observation 생성 — 자동 전략/계약 변경 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_environment_observation_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_environment_observations;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'environment_category','');
  -- 자동 전략/계약/Partner/Pricing 변경 계열 — 구조적 차단.
  if v_cat in ('automatic_strategy_change','automatic_mission_change','automatic_contract_signing','automatic_contract_termination','automatic_partner_approval','automatic_vendor_change','automatic_pricing_change','automatic_product_change') then
    raise exception '금지된 environment_category(자동 전략/계약 변경 계열 비활성)';
  end if;
  if v_cat not in ('market','customer','competitor','partner','vendor','technology','regulation','economy','finance','security','ai','esg','global','executive','custom') then
    raise exception '허용되지 않는 environment_category';
  end if;
  if coalesce(btrim(p_payload->>'observation_title'),'') = '' then raise exception 'observation_title 필수'; end if;
  if nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_environment_observations where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'risk_signal_is_not_actual_risk', true); end if;
  end if;
  insert into public.ai_enterprise_environment_observations (observation_code, observation_title, environment_category, observation_summary, mission_id, strategy_portfolio_id, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'observation_code',''), 'EEO-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'observation_title', 200), v_cat,
    nullif(left(coalesce(p_payload->>'observation_summary',''), 2000),''),
    nullif(p_payload->>'mission_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, detail, payload, actor_id)
  values ('environment_observation_created', v_id, left(v_cat, 80) || ' (Environment Observation ≠ 사실 확정 — observed·자동 전략 변경 없음)', jsonb_build_object('observation_title', p_payload->>'observation_title'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'observed', 'risk_signal_is_not_actual_risk', true, 'strategy_changed', false, 'mission_changed', false, 'contract_signed', false, 'contract_terminated', false, 'partner_approved', false, 'pricing_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Environment Observation 검토 — review_reference 는 Self 차단 + Evidence.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_environment_observation_review(p_observation_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_environment_observations; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'environment_observation_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_candidate','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_environment_observations where id = p_observation_id;
  if v_row.id is null then raise exception 'Environment Observation 없음(실존 검증 실패)'; end if;
  if v_row.observation_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_candidate' then v_next := 'candidate';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 전략·계약 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Environment Review Reference 금지';
    end if;
    v_next := 'review_reference'; v_note := ' (Review Reference ≠ Approval — 전략·계약 변경은 사람)'; v_evt := 'environment_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'strategy_changed', false, 'mission_changed', false, 'contract_signed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_environment_observations set review_reference = v_ref, environment_reviews = environment_reviews || jsonb_build_array(v_ref) where id = p_observation_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_environment_observations set observation_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_observation_id;
  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, detail, payload, actor_id)
  values (v_evt, p_observation_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_observation_id, 'status', v_next, 'risk_signal_is_not_actual_risk', true, 'strategy_changed', false, 'mission_changed', false, 'contract_signed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Environment Review 생성/검토(§9 — Self-Review 차단·Review ≠ Approval).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_environment_review_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_obs public.ai_enterprise_environment_observations; v_type text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_environment_reviews; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_type := coalesce(p_payload->>'review_type','');
  if v_type not in ('environment_review','executive_review','human_review') then
    raise exception '허용되지 않는 review_type(§9 — 3종만 요청 가능)';
  end if;
  if nullif(p_payload->>'environment_observation_id','') is null then raise exception 'environment_observation_id 필수'; end if;
  select * into v_obs from public.ai_enterprise_environment_observations where id = (p_payload->>'environment_observation_id')::uuid;
  if v_obs.id is null then raise exception 'Environment Observation 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_environment_reviews where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'review_is_not_approval', true); end if;
  end if;
  insert into public.ai_enterprise_environment_reviews (review_code, environment_observation_id, review_type, review_summary, findings, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'review_code',''), 'EER-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_obs.id, v_type,
    nullif(left(coalesce(p_payload->>'review_summary',''), 2000),''),
    coalesce(p_payload->'findings', '[]'::jsonb),
    coalesce(p_payload->'evidence', '[]'::jsonb), coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  v_evt := case v_type when 'environment_review' then 'environment_review_requested' when 'executive_review' then 'executive_review_requested' else 'human_review_requested' end;
  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, environment_review_id, detail, payload, actor_id)
  values (v_evt, v_obs.id, v_id, left(v_type, 80) || ' 요청 (Review ≠ Approval — 전략·계약 변경은 사람)', jsonb_build_object('review_code', p_payload->>'review_code'), v_uid);
  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, environment_review_id, detail, payload, actor_id)
  values ('environment_review_created', v_obs.id, v_id, 'Environment Review 생성 (requested)', jsonb_build_object('review_type', v_type), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'requested', 'review_is_not_approval', true, 'strategy_changed', false, 'mission_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_environment_review_review(p_review_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_environment_reviews; v_next text; v_note text := ''; v_ref jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_in_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_environment_reviews where id = p_review_id;
  if v_row.id is null then raise exception 'Environment Review 없음(실존 검증 실패)'; end if;
  if v_row.review_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;

  v_ref := jsonb_build_object(
    'action', p_action, 'reason', left(p_reason, 500),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'review_is_not_approval', true,
    'strategy_changed', false, 'mission_changed', false, 'contract_signed', false,
    'contract_terminated', false, 'partner_approved', false, 'production_applied', false);

  if p_action = 'mark_in_review' then v_next := 'in_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — 전략·계약 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Environment Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ Approval — 전략·계약 변경은 사람)';
    update public.ai_enterprise_environment_reviews set review_reference = v_ref || jsonb_build_object('evidence', p_payload->'evidence') where id = p_review_id;
    update public.ai_enterprise_environment_observations set
      environment_reviews = environment_reviews || jsonb_build_array(v_ref),
      review_reference = v_ref,
      reviewed_by = v_uid, updated_at = now()
    where id = v_row.environment_observation_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_environment_reviews set review_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_review_id;
  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, environment_review_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'environment_review_reference_recorded' when p_action = 'request_revision' then 'environment_revision_requested' else 'environment_review_reviewed' end,
    v_row.environment_observation_id, p_review_id, left(p_reason, 200) || v_note, v_ref || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_review_id, 'status', v_next, 'review_is_not_approval', true, 'strategy_changed', false, 'mission_changed', false, 'contract_signed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Environment 이벤트 기록(통합) — 자동 전략 변경 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_environment_event_record(p_kind text, p_reason text, p_payload jsonb, p_observation_id uuid default null, p_review_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('market_trend_reviewed','competitive_landscape_reviewed','partner_relationship_reviewed','customer_trend_reviewed','technology_trend_reviewed','regulatory_change_reviewed','economic_signal_reviewed','risk_signal_reviewed','environment_impact_reviewed','environment_mapping_recorded','ecosystem_relationship_recorded','environment_timeline_recorded','executive_environment_summary_recorded','executive_environment_scorecard_recorded','environment_recommendation_recorded','environment_learning_recorded','mission_reference_linked','portfolio_reference_linked','program_reference_linked','value_reference_linked','governance_reference_linked','knowledge_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_observation_id is not null and not exists (select 1 from public.ai_enterprise_environment_observations where id = p_observation_id) then raise exception 'Environment Observation 없음(실존 검증 실패)'; end if;
  if p_review_id is not null and not exists (select 1 from public.ai_enterprise_environment_reviews where id = p_review_id) then raise exception 'Environment Review 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind in ('market_trend_reviewed','competitive_landscape_reviewed','partner_relationship_reviewed','customer_trend_reviewed','technology_trend_reviewed','regulatory_change_reviewed','economic_signal_reviewed') then
    if v_result not in ('strong_signal_candidate','moderate_signal_candidate','weak_signal_candidate','unsupported_candidate','insufficient_data') then raise exception '허용되지 않는 signal result(§5 — 5종)'; end if;
    if p_observation_id is not null then
      if p_kind = 'market_trend_reviewed' then update public.ai_enterprise_environment_observations set signal_status = v_result, market_result = p_payload, environment_history = environment_history || jsonb_build_array(p_payload), updated_at = now() where id = p_observation_id;
      elsif p_kind = 'competitive_landscape_reviewed' then update public.ai_enterprise_environment_observations set competitive_result = p_payload, updated_at = now() where id = p_observation_id;
      elsif p_kind = 'partner_relationship_reviewed' then update public.ai_enterprise_environment_observations set partner_result = p_payload, updated_at = now() where id = p_observation_id;
      elsif p_kind = 'customer_trend_reviewed' then update public.ai_enterprise_environment_observations set customer_result = p_payload, updated_at = now() where id = p_observation_id;
      elsif p_kind = 'technology_trend_reviewed' then update public.ai_enterprise_environment_observations set technology_result = p_payload, updated_at = now() where id = p_observation_id;
      elsif p_kind = 'regulatory_change_reviewed' then update public.ai_enterprise_environment_observations set regulatory_result = p_payload, updated_at = now() where id = p_observation_id;
      else update public.ai_enterprise_environment_observations set economic_result = p_payload, updated_at = now() where id = p_observation_id;
      end if;
    end if;
  end if;
  if p_kind = 'risk_signal_reviewed' then
    if coalesce(p_payload->>'risk_dimension','') not in ('regulatory','technology','competitive','supply_chain','financial','reputation') then
      raise exception '허용되지 않는 risk_dimension(§7 — 6종)';
    end if;
    if v_result not in ('critical_candidate','elevated_candidate','normal_candidate','unverified_candidate','insufficient_data') then raise exception '허용되지 않는 risk result(§7 — 5종)'; end if;
    if p_observation_id is not null then update public.ai_enterprise_environment_observations set risk_status = v_result, risk_result = coalesce(risk_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'risk_dimension', p_payload), updated_at = now() where id = p_observation_id; end if;
  end if;
  if p_kind = 'environment_impact_reviewed' then
    if coalesce(p_payload->>'impact_dimension','') not in ('mission_impact','strategy_impact','portfolio_impact','financial_impact','operational_impact') then
      raise exception '허용되지 않는 impact_dimension(§6 — 5종)';
    end if;
    if v_result not in ('high_impact_candidate','medium_impact_candidate','low_impact_candidate','impact_unknown','insufficient_data') then raise exception '허용되지 않는 impact result(§6 — 5종)'; end if;
    if p_observation_id is not null then update public.ai_enterprise_environment_observations set impact_status = v_result, impact_result = coalesce(impact_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'impact_dimension', p_payload), updated_at = now() where id = p_observation_id; end if;
  end if;
  if p_kind = 'environment_mapping_recorded' and p_observation_id is not null then
    update public.ai_enterprise_environment_observations set mapping_result = p_payload, updated_at = now() where id = p_observation_id;
  end if;
  if p_kind = 'ecosystem_relationship_recorded' and p_observation_id is not null then
    update public.ai_enterprise_environment_observations set relationship_result = p_payload, updated_at = now() where id = p_observation_id;
  end if;
  if p_kind = 'environment_timeline_recorded' and p_observation_id is not null then
    -- Market/Competitor/Technology/Regulatory Timeline 통합 append.
    update public.ai_enterprise_environment_observations set environment_history = environment_history || jsonb_build_array(p_payload), updated_at = now() where id = p_observation_id;
  end if;
  if p_kind = 'executive_environment_scorecard_recorded' and p_observation_id is not null then
    update public.ai_enterprise_environment_observations set scorecard_result = p_payload, updated_at = now() where id = p_observation_id;
  end if;
  if p_kind = 'environment_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_environment_observation','review_market_trend','review_competitive_landscape','review_partner_relationship','review_customer_trend','review_technology_trend','review_regulatory_change','review_economic_signal','review_risk_signal','review_environment_impact','record_environment_mapping','record_ecosystem_relationship','record_environment_timeline','build_executive_environment_summary','build_executive_environment_scorecard','request_environment_review','request_executive_review','request_human_review','record_environment_learning','link_mission_reference','link_strategy_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Environment Recommendation 금지';
    end if;
    if p_observation_id is not null then update public.ai_enterprise_environment_observations set recommendation_candidate = p_payload, updated_at = now() where id = p_observation_id; end if;
  end if;
  if p_kind = 'environment_learning_recorded' and p_observation_id is not null then
    update public.ai_enterprise_environment_observations set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_observation_id;
  end if;
  if p_kind = 'mission_reference_linked' and nullif(p_payload->>'mission_id','') is not null
     and not exists (select 1 from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid) then
    raise exception 'Mission 없음(실존 검증 실패)';
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;
  if p_kind = 'governance_reference_linked' and nullif(p_payload->>'governance_decision_id','') is not null
     and not exists (select 1 from public.ai_enterprise_governance_decisions where id = (p_payload->>'governance_decision_id')::uuid) then
    raise exception 'Governance Decision 없음(실존 검증 실패)';
  end if;
  if p_kind = 'knowledge_reference_linked' and nullif(p_payload->>'knowledge_memory_id','') is not null
     and not exists (select 1 from public.ai_enterprise_knowledge_memories where id = (p_payload->>'knowledge_memory_id')::uuid) then
    raise exception 'Knowledge Memory 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_environment_events (event_type, environment_observation_id, environment_review_id, detail, payload, actor_id)
  values (p_kind, p_observation_id, p_review_id,
    left(p_reason, 200) || case
      when p_kind = 'market_trend_reviewed' then ' (Market Trend ≠ Future Market)'
      when p_kind = 'competitive_landscape_reviewed' then ' (Competitor Analysis ≠ Competitor Intent)'
      when p_kind = 'partner_relationship_reviewed' then ' (Partner 분석 ≠ Partner 자동 승인)'
      when p_kind = 'customer_trend_reviewed' then ' (Customer Trend ≠ Customer Demand)'
      when p_kind = 'technology_trend_reviewed' then ' (Technology Trend ≠ Guaranteed Adoption)'
      when p_kind = 'regulatory_change_reviewed' then ' (Regulation Change ≠ Legal Advice)'
      when p_kind = 'economic_signal_reviewed' then ' (Economic Signal ≠ 확정 전망)'
      when p_kind = 'risk_signal_reviewed' then ' (Risk Signal ≠ Actual Risk)'
      when p_kind = 'environment_impact_reviewed' then ' (Impact Candidate ≠ 전략 변경 지시)'
      when p_kind = 'environment_mapping_recorded' then ' (Environment Mapping ≠ 전략 확정)'
      when p_kind = 'ecosystem_relationship_recorded' then ' (Ecosystem Relationship ≠ 계약 관계 확정)'
      when p_kind = 'environment_timeline_recorded' then ' (Timeline 관측 기록 ≠ Forecast 확정)'
      when p_kind = 'executive_environment_summary_recorded' then ' (Summary ≠ 환경 판단 확정)'
      when p_kind = 'executive_environment_scorecard_recorded' then ' (Scorecard ≠ 전략 변경 지시)'
      when p_kind = 'environment_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'environment_learning_recorded' then ' (Environment Learning ≠ 자동 전략 변경)'
      when p_kind = 'mission_reference_linked' then ' (Mission Reference ≠ Mission 변경)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 변경)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 지시)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 가치 확정)'
      when p_kind = 'governance_reference_linked' then ' (Governance Reference ≠ 승인)'
      when p_kind = 'knowledge_reference_linked' then ' (Knowledge Reference ≠ 사실 확정)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'strategy_changed', false, 'mission_changed', false, 'contract_signed', false, 'contract_terminated', false, 'partner_approved', false, 'vendor_changed', false, 'budget_changed', false, 'pricing_changed', false, 'product_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_environment_observations_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_environment_observations language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_environment_observations
  where (p_status is null or observation_status = p_status)
    and (p_category is null or environment_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_environment_reviews_list(p_observation_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_environment_reviews language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_environment_reviews
  where (p_observation_id is null or environment_observation_id = p_observation_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_environment_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'observations', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_environment_observations),
      'observed', (select count(*) from public.ai_enterprise_environment_observations where observation_status = 'observed'),
      'candidate', (select count(*) from public.ai_enterprise_environment_observations where observation_status = 'candidate'),
      'review_reference', (select count(*) from public.ai_enterprise_environment_observations where observation_status = 'review_reference'),
      'archived', (select count(*) from public.ai_enterprise_environment_observations where observation_status = 'archived_reference'),
      'strong_signals', (select count(*) from public.ai_enterprise_environment_observations where signal_status = 'strong_signal_candidate'),
      'high_impact', (select count(*) from public.ai_enterprise_environment_observations where impact_status = 'high_impact_candidate'),
      'critical_risk', (select count(*) from public.ai_enterprise_environment_observations where risk_status in ('critical_candidate','elevated_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_environment_observations where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(environment_category, cnt), '{}'::jsonb) from (select environment_category, count(*) cnt from public.ai_enterprise_environment_observations group by environment_category) t)
    ),
    'reviews', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_environment_reviews),
      'requested', (select count(*) from public.ai_enterprise_environment_reviews where review_status = 'requested'),
      'in_review', (select count(*) from public.ai_enterprise_environment_reviews where review_status = 'in_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_environment_reviews where review_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_environment_reviews where review_status = 'revision_requested')
    ),
    'environment_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_environment_events),
      'market_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'market_trend_reviewed'),
      'competitive_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'competitive_landscape_reviewed'),
      'partner_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'partner_relationship_reviewed'),
      'customer_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'customer_trend_reviewed'),
      'technology_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'technology_trend_reviewed'),
      'regulatory_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'regulatory_change_reviewed'),
      'economic_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'economic_signal_reviewed'),
      'risk_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'risk_signal_reviewed'),
      'impact_reviews', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_impact_reviewed'),
      'mappings', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_mapping_recorded'),
      'relationships', (select count(*) from public.ai_enterprise_environment_events where event_type = 'ecosystem_relationship_recorded'),
      'timelines', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_timeline_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_environment_events where event_type = 'executive_environment_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_environment_events where event_type = 'executive_environment_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_recommendation_recorded'),
      'environment_review_requests', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_environment_events where event_type = 'executive_review_requested'),
      'human_review_requests', (select count(*) from public.ai_enterprise_environment_events where event_type = 'human_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_environment_events where event_type = 'environment_learning_recorded'),
      'mission_links', (select count(*) from public.ai_enterprise_environment_events where event_type = 'mission_reference_linked'),
      'portfolio_links', (select count(*) from public.ai_enterprise_environment_events where event_type = 'portfolio_reference_linked'),
      'governance_links', (select count(*) from public.ai_enterprise_environment_events where event_type = 'governance_reference_linked'),
      'knowledge_links', (select count(*) from public.ai_enterprise_environment_events where event_type = 'knowledge_reference_linked')
    ),
    -- Environment 원천 실측(전부 읽기 전용):
    'environment_actuals', jsonb_build_object(
      'missions_0555', (select count(*) from public.ai_enterprise_missions),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'knowledge_memories_0553', (select count(*) from public.ai_enterprise_knowledge_memories),
      'ai_reviews_0554', (select count(*) from public.ai_enterprise_ai_reviews),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'constitution_rules_0496', (select count(*) from public.ai_constitution_rules)
    ),
    'environment_unavailable', jsonb_build_array('market_data_feed','competitor_intelligence_feed','news_media_feed','regulatory_bulletin_feed','macroeconomic_data_feed','customer_survey_feed'),   -- 원본 없음(실측 — 관측은 수동 기록 기반)
    'market_trend_is_not_future_market', true, 'competitor_analysis_is_not_competitor_intent', true,
    'technology_trend_is_not_guaranteed_adoption', true, 'regulation_change_is_not_legal_advice', true,
    'customer_trend_is_not_customer_demand', true, 'risk_signal_is_not_actual_risk', true,
    'recommendation_is_not_decision', true, 'pattern_is_not_causality', true,
    'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_strategy_change', true, 'no_auto_mission_change', true, 'no_auto_contract_signing', true,
    'no_auto_contract_termination', true, 'no_auto_partner_approval', true, 'no_auto_vendor_change', true,
    'no_auto_budget_change', true, 'no_auto_pricing_change', true, 'no_auto_product_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_environment_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_environment_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_environment_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_environment_observations enable row level security;
alter table public.ai_enterprise_environment_reviews enable row level security;
alter table public.ai_enterprise_environment_events enable row level security;

comment on table public.ai_enterprise_environment_observations is 'AI-OPS-52 — Environment Observation(≠ 사실 확정·Category 15종·자동 전략/계약 변경 차단·Risk Signal ≠ Actual Risk).';
comment on table public.ai_enterprise_environment_reviews is 'AI-OPS-52 — Environment Review(§9 3종 요청만·Review Reference 는 Self-Review 차단+Evidence 필수·Review ≠ Approval).';
comment on table public.ai_enterprise_environment_events is 'AI-OPS-52 — Environment 이벤트 31종(자동 전략 변경 이벤트 생성 금지·Market Trend ≠ Future Market).';
