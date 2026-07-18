-- 0548_admin_ai_enterprise_performance_intelligence.sql
-- AI-OPS-44 — Enterprise Performance Intelligence, KPI Governance &
-- Strategic Performance Management Center.
--
-- Enterprise Vision → Strategic Goal → Strategic KPI → Performance Target →
-- Baseline → Observed Performance(Snapshot) → Variance Analysis →
-- Business Impact → Cross-Domain Correlation → Strategic Scorecard →
-- Executive Performance Review → Performance Recommendation →
-- Observed Outcome → Performance Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * KPI Target ≠ Guaranteed Result. KPI Trend ≠ Future Trend.
--  * KPI Correlation ≠ Causality. KPI Improvement ≠ Strategy Success.
--    KPI Decline ≠ Strategy Failure. Business Impact ≠ Financial Fact.
--  * Performance Recommendation ≠ Decision. Executive Review ≠ Approval.
--  * Scorecard ≠ Executive Evaluation(개인 인사/성과/보상 평가에 사용 금지 —
--    개인 평가 계열 category 는 구조적 차단).
--  * Outcome Link ≠ Proven Causality. Forecast ≠ Future Fact. Confidence ≠ Certainty.
--  * Null → 0 변환 금지(observed_value 는 null 유지 가능). insufficient_data /
--    sample_too_small 유지.
--  * KPI 자동 수정/삭제/승인·자동 인사/성과평가·자동 보상/승진/해고·자동 Budget/
--    Strategy/Portfolio/Resource Allocation/Production/Payment/Settlement/
--    Contract/Incident/Rollout/Rollback/Merge/Deploy — 해당 RPC 자체가 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0513/0514/0520/0525/0543/0545/0546/0547
--    원본 무변경(참조만). 기존 0525 ai_kpi_definitions 계열과 별도 신규 계층
--    (이름 충돌 회피 위해 enterprise 접두 사용).
--  * Scorecard/Trend/Variance/Impact/Correlation 은 신규 테이블 대신 JSONB +
--    Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Strategic KPI(≠ 인사평가 지표·자동 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_kpis (
  id                        uuid primary key default gen_random_uuid(),
  kpi_code                  text not null,
  kpi_name                  text not null,
  kpi_category              text not null check (kpi_category in ('financial','customer','operational','platform','store','brand','artist','content','ai','security','compliance','reliability','growth','quality','custom')),
  kpi_status                text not null default 'draft' check (kpi_status in ('draft','active_reference','paused_reference','deprecated_reference','insufficient_data')),
  kpi_description           text,
  unit_type                 text,
  direction                 text not null default 'unspecified' check (direction in ('higher_is_better','lower_is_better','unspecified')),
  strategic_goal_id         uuid,
  strategy_portfolio_id     uuid,
  execution_program_id      uuid,
  baseline_value            numeric,
  baseline_recorded_at      timestamptz,
  baseline_source_reference text,
  target_value              numeric,
  target_horizon_reference  text,
  target_rationale          text,
  current_value_reference   numeric,
  current_observed_at       timestamptz,
  trend_status              text not null default 'insufficient_data' check (trend_status in ('strong_growth_candidate','moderate_growth_candidate','stable_candidate','moderate_decline_candidate','strong_decline_candidate','insufficient_data')),
  variance_status           text not null default 'insufficient_data' check (variance_status in ('on_target_candidate','slightly_off_target_candidate','materially_off_target_candidate','critical_variance_candidate','insufficient_data')),
  business_impact_status    text not null default 'insufficient_data' check (business_impact_status in ('high_positive_candidate','moderate_positive_candidate','neutral_candidate','moderate_negative_candidate','high_negative_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  trend_result              jsonb,
  variance_result           jsonb,
  forecast_comparison_result jsonb,
  drift_result              jsonb,
  correlation_result        jsonb,
  dependency_result         jsonb,
  impact_result             jsonb,
  scorecard_result          jsonb,
  recommendation_candidate  jsonb,
  performance_reviews       jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  outcome_reference         jsonb,
  learning_references       jsonb not null default '[]'::jsonb,
  goal_references           jsonb not null default '[]'::jsonb,
  program_references        jsonb not null default '[]'::jsonb,
  forecast_references       jsonb not null default '[]'::jsonb,
  outcome_links             jsonb not null default '[]'::jsonb,
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
create unique index if not exists uq_aek_idem on public.ai_enterprise_kpis (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aek_status on public.ai_enterprise_kpis (kpi_status, kpi_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Enterprise KPI Snapshot(Observed Performance — Null → 0 변환 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_kpi_snapshots (
  id                        uuid primary key default gen_random_uuid(),
  kpi_id                    uuid not null,
  snapshot_period_reference text,
  observed_value            numeric,
  observed_at               timestamptz,
  source_reference_type     text,
  source_reference_id       text,
  data_quality              text not null default 'quality_unverified' check (data_quality in ('verified_source_reference','proxy_candidate','manual_entry_reference','quality_unverified','insufficient_data')),
  sample_size               int check (sample_size is null or sample_size >= 0),
  variance_vs_target        numeric,
  variance_vs_baseline      numeric,
  notes                     text,
  evidence                  jsonb not null default '[]'::jsonb,
  created_by                uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeks_kpi on public.ai_enterprise_kpi_snapshots (kpi_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Performance 이벤트(32종) — Trend/Variance/Confidence/Forecast 비교/
--    Drift/Correlation/Dependency/Cross-Domain/Impact/Scorecard/Summary/
--    Recommendation/Review/Reference Link/Outcome/Learning 통합 Audit.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_performance_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('kpi_created','kpi_reviewed','kpi_baseline_recorded','kpi_target_recorded','kpi_snapshot_recorded','kpi_trend_reviewed','kpi_variance_reviewed','kpi_confidence_reviewed','kpi_forecast_comparison_reviewed','kpi_drift_reviewed','kpi_correlation_reviewed','kpi_dependency_reviewed','cross_domain_correlation_reviewed','business_impact_reviewed','strategic_scorecard_recorded','executive_scorecard_recorded','performance_summary_recorded','performance_recommendation_recorded','kpi_review_requested','executive_review_requested','performance_review_requested','performance_review_reference_recorded','performance_revision_requested','goal_reference_linked','portfolio_reference_linked','program_reference_linked','decision_outcome_linked','forecast_reference_linked','commitment_reference_linked','performance_outcome_linked','performance_learning_reference_recorded','kpi_invalidated')),
  kpi_id                    uuid,
  kpi_snapshot_id           uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aepe_evt on public.ai_enterprise_performance_events (event_type, created_at desc);
create index if not exists idx_aepe_kpi on public.ai_enterprise_performance_events (kpi_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) KPI 생성 — 개인 평가 계열 category 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_kpi_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_kpis;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'kpi_category','');
  -- 개인 인사/성과/보상 평가 계열 — 구조적 차단(Scorecard ≠ Executive Evaluation).
  if v_cat in ('personal_performance_evaluation','individual_performance_scoring','individual_compensation','promotion_decision','termination_decision','personal_ranking','employee_surveillance','credit_decision','medical_decision') then
    raise exception '금지된 kpi_category(개인 평가/보상/해고 계열 비활성)';
  end if;
  if v_cat not in ('financial','customer','operational','platform','store','brand','artist','content','ai','security','compliance','reliability','growth','quality','custom') then
    raise exception '허용되지 않는 kpi_category';
  end if;
  if coalesce(btrim(p_payload->>'kpi_name'),'') = '' then raise exception 'kpi_name 필수'; end if;
  if coalesce(nullif(p_payload->>'direction',''), 'unspecified') not in ('higher_is_better','lower_is_better','unspecified') then
    raise exception '허용되지 않는 direction';
  end if;
  if nullif(p_payload->>'strategic_goal_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategic_goals where id = (p_payload->>'strategic_goal_id')::uuid) then
    raise exception 'Strategic Goal 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_kpis where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'target_is_not_guaranteed_result', true); end if;
  end if;
  insert into public.ai_enterprise_kpis (kpi_code, kpi_name, kpi_category, kpi_description, unit_type, direction, strategic_goal_id, strategy_portfolio_id, execution_program_id, target_horizon_reference, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'kpi_code',''), 'EKP-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'kpi_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'kpi_description',''), 2000),''),
    nullif(left(coalesce(p_payload->>'unit_type',''), 40),''),
    coalesce(nullif(p_payload->>'direction',''), 'unspecified'),
    nullif(p_payload->>'strategic_goal_id','')::uuid, nullif(p_payload->>'strategy_portfolio_id','')::uuid,
    nullif(p_payload->>'execution_program_id','')::uuid,
    nullif(left(coalesce(p_payload->>'target_horizon_reference',''), 60),''),
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_performance_events (event_type, kpi_id, detail, payload, actor_id)
  values ('kpi_created', v_id, left(v_cat, 80) || ' (KPI ≠ 인사평가 지표 — draft·자동 변경 없음)', jsonb_build_object('kpi_name', p_payload->>'kpi_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'target_is_not_guaranteed_result', true, 'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'compensation_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) KPI 검토/Baseline/Target — deprecated 재결정 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_kpi_review(p_kpi_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_kpis; v_next text := null; v_evt text := 'kpi_reviewed'; v_note text := '';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('activate_reference','pause_reference','deprecate_reference','mark_insufficient_data','record_baseline','record_target','invalidate') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_kpis where id = p_kpi_id;
  if v_row.id is null then raise exception 'KPI 없음(실존 검증 실패)'; end if;
  if v_row.kpi_status = 'deprecated_reference' and p_action <> 'invalidate' then
    raise exception '종결 상태 재결정 차단(deprecated_reference)';
  end if;

  if p_action = 'activate_reference' then v_next := 'active_reference'; v_note := ' (Active Reference ≠ 검증된 지표 보증)';
  elsif p_action = 'pause_reference' then v_next := 'paused_reference';
  elsif p_action = 'deprecate_reference' then v_next := 'deprecated_reference';
  elsif p_action = 'mark_insufficient_data' then v_next := 'insufficient_data';
  elsif p_action = 'record_baseline' then
    -- Baseline 은 출처 없이 기록 차단(Null → 0 변환 금지).
    if nullif(p_payload->>'baseline_value','') is null then raise exception 'baseline_value 필수'; end if;
    if coalesce(nullif(p_payload->>'baseline_source_reference',''), '') = '' then
      raise exception '출처 없는 Baseline 기록 금지(baseline_source_reference 필수)';
    end if;
    v_evt := 'kpi_baseline_recorded'; v_note := ' (Baseline ≠ 보장된 기준 성과)';
    update public.ai_enterprise_kpis set
      baseline_value = (p_payload->>'baseline_value')::numeric,
      baseline_recorded_at = now(),
      baseline_source_reference = left(p_payload->>'baseline_source_reference', 200),
      reviewed_by = v_uid, updated_at = now()
    where id = p_kpi_id;
  elsif p_action = 'record_target' then
    if nullif(p_payload->>'target_value','') is null then raise exception 'target_value 필수'; end if;
    if coalesce(btrim(p_payload->>'target_rationale'),'') = '' then raise exception 'Rationale 없는 Target 기록 금지'; end if;
    v_evt := 'kpi_target_recorded'; v_note := ' (KPI Target ≠ Guaranteed Result)';
    update public.ai_enterprise_kpis set
      target_value = (p_payload->>'target_value')::numeric,
      target_horizon_reference = coalesce(nullif(left(coalesce(p_payload->>'target_horizon_reference',''), 60),''), target_horizon_reference),
      target_rationale = left(p_payload->>'target_rationale', 500),
      reviewed_by = v_uid, updated_at = now()
    where id = p_kpi_id;
  else v_next := 'insufficient_data'; v_evt := 'kpi_invalidated';
  end if;

  if v_next is not null then
    update public.ai_enterprise_kpis set kpi_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_kpi_id;
  end if;
  insert into public.ai_enterprise_performance_events (event_type, kpi_id, detail, payload, actor_id)
  values (v_evt, p_kpi_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', coalesce(v_next, v_row.kpi_status)), v_uid);
  return jsonb_build_object('ok', true, 'id', p_kpi_id, 'status', coalesce(v_next, v_row.kpi_status), 'target_is_not_guaranteed_result', true, 'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) KPI Snapshot 기록 — Observed Performance(관측 없으면 null 유지).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_kpi_snapshot_record(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_kpi public.ai_enterprise_kpis; v_val numeric; v_quality text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if nullif(p_payload->>'kpi_id','') is null then raise exception 'kpi_id 필수'; end if;
  select * into v_kpi from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid;
  if v_kpi.id is null then raise exception 'KPI 없음(실존 검증 실패)'; end if;
  v_quality := coalesce(nullif(p_payload->>'data_quality',''), 'quality_unverified');
  if v_quality not in ('verified_source_reference','proxy_candidate','manual_entry_reference','quality_unverified','insufficient_data') then
    raise exception '허용되지 않는 data_quality';
  end if;
  -- verified 표기는 실제 출처 참조 없이 기록 차단.
  if v_quality = 'verified_source_reference' and coalesce(nullif(p_payload->>'source_reference_id',''), '') = '' then
    raise exception '출처 없는 verified_source_reference 금지(quality_unverified 유지)';
  end if;
  v_val := nullif(p_payload->>'observed_value','')::numeric;   -- null 이면 null 유지(0 치환 금지).
  insert into public.ai_enterprise_kpi_snapshots (kpi_id, snapshot_period_reference, observed_value, observed_at, source_reference_type, source_reference_id, data_quality, sample_size, variance_vs_target, variance_vs_baseline, notes, evidence, created_by)
  values (v_kpi.id,
    nullif(left(coalesce(p_payload->>'snapshot_period_reference',''), 60),''),
    v_val,
    coalesce(nullif(p_payload->>'observed_at','')::timestamptz, now()),
    nullif(left(coalesce(p_payload->>'source_reference_type',''), 80),''), nullif(p_payload->>'source_reference_id',''),
    v_quality,
    case when nullif(p_payload->>'sample_size','') is null then null else greatest(0, (p_payload->>'sample_size')::int) end,
    case when v_val is null or v_kpi.target_value is null then null else v_val - v_kpi.target_value end,
    case when v_val is null or v_kpi.baseline_value is null then null else v_val - v_kpi.baseline_value end,
    nullif(left(coalesce(p_payload->>'notes',''), 500),''),
    coalesce(p_payload->'evidence', '[]'::jsonb), v_uid)
  returning id into v_id;
  if v_val is not null then
    update public.ai_enterprise_kpis set current_value_reference = v_val, current_observed_at = now(), updated_at = now() where id = v_kpi.id;
  end if;
  insert into public.ai_enterprise_performance_events (event_type, kpi_id, kpi_snapshot_id, detail, payload, actor_id)
  values ('kpi_snapshot_recorded', v_kpi.id, v_id, 'Observed Performance (관측값 없으면 null 유지 — 0 치환 금지)', jsonb_build_object('observed_value', v_val, 'data_quality', v_quality), v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'kpi_id', v_kpi.id, 'observed_value_present', v_val is not null, 'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Human Performance Review — 요청/Reference 기록만. Self-Review 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_performance_review(p_kpi_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_kpis; v_evt text; v_note text := ''; v_review jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('request_kpi_review','request_executive_review','request_performance_review','record_review_reference','request_revision') then
    raise exception '허용되지 않는 review action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_kpis where id = p_kpi_id;
  if v_row.id is null then raise exception 'KPI 없음(실존 검증 실패)'; end if;

  if p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Executive Review ≠ Approval).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Performance Review Reference 금지';
    end if;
    v_evt := 'performance_review_reference_recorded';
    v_note := ' (Review Reference ≠ Approval — 최종 평가는 사람·자동 평가/보상 없음)';
  elsif p_action = 'request_kpi_review' then v_evt := 'kpi_review_requested'; v_note := ' (KPI Review 요청 — 최종 평가는 사람)';
  elsif p_action = 'request_executive_review' then v_evt := 'executive_review_requested'; v_note := ' (Executive Review 요청 ≠ Approval)';
  elsif p_action = 'request_performance_review' then v_evt := 'performance_review_requested';
  else v_evt := 'performance_revision_requested';
  end if;

  v_review := jsonb_build_object(
    'review_action', p_action, 'review_reason', left(p_reason, 500),
    'required_followups', coalesce(p_payload->'required_followups', '[]'::jsonb),
    'required_evidence', coalesce(p_payload->'required_evidence', '[]'::jsonb),
    'reviewer_role', nullif(p_payload->>'reviewer_role',''),
    'reviewed_by', v_uid, 'reviewed_at', now(),
    'human_performance_decision_confirmed', p_action = 'record_review_reference',
    'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'compensation_changed', false,
    'budget_changed', false, 'strategy_changed', false, 'production_applied', false);
  update public.ai_enterprise_kpis set
    performance_reviews = performance_reviews || jsonb_build_array(v_review),
    review_reference = case when p_action = 'record_review_reference' then v_review else review_reference end,
    reviewed_by = v_uid, updated_at = now()
  where id = p_kpi_id;
  insert into public.ai_enterprise_performance_events (event_type, kpi_id, detail, payload, actor_id)
  values (v_evt, p_kpi_id, left(p_reason, 200) || v_note, v_review, v_uid);
  return jsonb_build_object('ok', true, 'id', p_kpi_id, 'review_action', p_action, 'review_is_not_approval', true, 'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'compensation_changed', false, 'budget_changed', false, 'strategy_changed', false, 'production_applied', false, 'human_evaluation_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Performance 이벤트 기록(통합) — 자동 평가 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_performance_event_record(p_kind text, p_reason text, p_payload jsonb, p_kpi_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('kpi_trend_reviewed','kpi_variance_reviewed','kpi_confidence_reviewed','kpi_forecast_comparison_reviewed','kpi_drift_reviewed','kpi_correlation_reviewed','kpi_dependency_reviewed','cross_domain_correlation_reviewed','business_impact_reviewed','strategic_scorecard_recorded','executive_scorecard_recorded','performance_summary_recorded','performance_recommendation_recorded','goal_reference_linked','portfolio_reference_linked','program_reference_linked','decision_outcome_linked','forecast_reference_linked','commitment_reference_linked','performance_outcome_linked','performance_learning_reference_recorded') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_kpi_id is not null and not exists (select 1 from public.ai_enterprise_kpis where id = p_kpi_id) then raise exception 'KPI 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'kpi_trend_reviewed' then
    if v_result not in ('strong_growth_candidate','moderate_growth_candidate','stable_candidate','moderate_decline_candidate','strong_decline_candidate','insufficient_data') then raise exception '허용되지 않는 trend result'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set trend_status = v_result, trend_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'kpi_variance_reviewed' then
    if v_result not in ('on_target_candidate','slightly_off_target_candidate','materially_off_target_candidate','critical_variance_candidate','insufficient_data') then raise exception '허용되지 않는 variance result'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set variance_status = v_result, variance_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'kpi_confidence_reviewed' then
    if nullif(p_payload->>'confidence','') is null then raise exception 'confidence 필수'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set confidence = least(100, greatest(0, (p_payload->>'confidence')::int)), updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'kpi_forecast_comparison_reviewed' then
    if v_result not in ('forecast_aligned_candidate','forecast_moderately_off_candidate','forecast_materially_off_candidate','forecast_comparison_unverified','insufficient_data') then raise exception '허용되지 않는 forecast comparison result'; end if;
    if nullif(p_payload->>'forecast_run_id','') is not null
       and not exists (select 1 from public.ai_enterprise_forecast_runs where id = (p_payload->>'forecast_run_id')::uuid) then
      raise exception 'Forecast Run 없음(실존 검증 실패)';
    end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set forecast_comparison_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'kpi_drift_reviewed' then
    if v_result not in ('no_material_kpi_drift_candidate','minor_kpi_drift_candidate','moderate_kpi_drift_candidate','severe_kpi_drift_candidate','kpi_drift_unverified','insufficient_data') then raise exception '허용되지 않는 kpi drift result'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set drift_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind in ('kpi_correlation_reviewed','cross_domain_correlation_reviewed') then
    if v_result not in ('strong_correlation_candidate','moderate_correlation_candidate','weak_correlation_candidate','no_material_correlation_candidate','sample_too_small','correlation_unverified','insufficient_data') then raise exception '허용되지 않는 correlation result'; end if;
    if p_kind = 'kpi_correlation_reviewed' and p_kpi_id is not null then update public.ai_enterprise_kpis set correlation_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'kpi_dependency_reviewed' then
    if v_result not in ('upstream_dependency_candidate','downstream_dependency_candidate','shared_driver_candidate','no_material_dependency_candidate','dependency_unverified','insufficient_data') then raise exception '허용되지 않는 dependency result'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set dependency_result = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'business_impact_reviewed' then
    if coalesce(p_payload->>'impact_domain','') not in ('revenue','cost','customer','store','brand','artist','operations','ai','platform','risk','compliance') then
      raise exception '허용되지 않는 impact_domain';
    end if;
    if v_result not in ('high_positive_candidate','moderate_positive_candidate','neutral_candidate','moderate_negative_candidate','high_negative_candidate','insufficient_data') then raise exception '허용되지 않는 impact result'; end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set business_impact_status = v_result, impact_result = coalesce(impact_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'impact_domain', p_payload), updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind in ('strategic_scorecard_recorded','executive_scorecard_recorded') and p_kpi_id is not null then
    update public.ai_enterprise_kpis set scorecard_result = p_payload, updated_at = now() where id = p_kpi_id;
  end if;
  if p_kind = 'performance_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_kpi','record_kpi_baseline','record_kpi_target','record_kpi_snapshot','review_kpi_trend','review_kpi_variance','review_kpi_confidence','compare_kpi_forecast','review_kpi_drift','review_kpi_correlation','review_kpi_dependency','review_cross_domain_correlation','review_business_impact','build_strategic_scorecard','build_executive_scorecard','request_kpi_review','request_executive_review','request_performance_review','link_decision_outcome','link_forecast_reference','link_performance_outcome','record_performance_learning_reference','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Performance Recommendation 금지';
    end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set recommendation_candidate = p_payload, updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'goal_reference_linked' then
    if nullif(p_payload->>'strategic_goal_id','') is not null
       and not exists (select 1 from public.ai_enterprise_strategic_goals where id = (p_payload->>'strategic_goal_id')::uuid) then
      raise exception 'Strategic Goal 없음(실존 검증 실패)';
    end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set goal_references = goal_references || jsonb_build_array(p_payload), updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' then
    if nullif(p_payload->>'execution_program_id','') is not null
       and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
      raise exception 'Execution Program 없음(실존 검증 실패)';
    end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set program_references = program_references || jsonb_build_array(p_payload), updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'decision_outcome_linked' and nullif(p_payload->>'decision_outcome_id','') is not null
     and not exists (select 1 from public.ai_decision_outcomes where id = (p_payload->>'decision_outcome_id')::uuid) then
    raise exception 'Decision Outcome 없음(실존 검증 실패)';
  end if;
  if p_kind = 'forecast_reference_linked' then
    if nullif(p_payload->>'forecast_run_id','') is not null
       and not exists (select 1 from public.ai_enterprise_forecast_runs where id = (p_payload->>'forecast_run_id')::uuid) then
      raise exception 'Forecast Run 없음(실존 검증 실패)';
    end if;
    if p_kpi_id is not null then update public.ai_enterprise_kpis set forecast_references = forecast_references || jsonb_build_array(p_payload), updated_at = now() where id = p_kpi_id; end if;
  end if;
  if p_kind = 'commitment_reference_linked' and nullif(p_payload->>'commitment_id','') is not null
     and not exists (select 1 from public.ai_execution_commitments where id = (p_payload->>'commitment_id')::uuid) then
    raise exception 'Commitment 없음(실존 검증 실패)';
  end if;
  if p_kind = 'performance_outcome_linked' and p_kpi_id is not null then
    update public.ai_enterprise_kpis set outcome_reference = p_payload, outcome_links = outcome_links || jsonb_build_array(p_payload), updated_at = now() where id = p_kpi_id;
  end if;
  if p_kind = 'performance_learning_reference_recorded' and p_kpi_id is not null then
    update public.ai_enterprise_kpis set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_kpi_id;
  end if;

  insert into public.ai_enterprise_performance_events (event_type, kpi_id, detail, payload, actor_id)
  values (p_kind, p_kpi_id,
    left(p_reason, 200) || case
      when p_kind = 'kpi_trend_reviewed' then ' (KPI Trend ≠ Future Trend)'
      when p_kind = 'kpi_variance_reviewed' then ' (Variance Candidate ≠ Strategy Failure/Success)'
      when p_kind = 'kpi_confidence_reviewed' then ' (Confidence ≠ Certainty)'
      when p_kind = 'kpi_forecast_comparison_reviewed' then ' (Forecast ≠ Future Fact)'
      when p_kind = 'kpi_drift_reviewed' then ' (KPI Drift ≠ 자동 KPI 변경 신호)'
      when p_kind = 'kpi_correlation_reviewed' then ' (KPI Correlation ≠ Causality)'
      when p_kind = 'kpi_dependency_reviewed' then ' (Dependency Candidate ≠ 확정 인과 구조)'
      when p_kind = 'cross_domain_correlation_reviewed' then ' (Cross-Domain Correlation ≠ Causality)'
      when p_kind = 'business_impact_reviewed' then ' (Business Impact ≠ Financial Fact)'
      when p_kind = 'strategic_scorecard_recorded' then ' (Scorecard ≠ Executive Evaluation)'
      when p_kind = 'executive_scorecard_recorded' then ' (Executive Scorecard ≠ 인사평가)'
      when p_kind = 'performance_summary_recorded' then ' (Summary ≠ 성과 확정)'
      when p_kind = 'performance_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'goal_reference_linked' then ' (Goal Reference ≠ Goal 달성)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 성공)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ Program ROI 확정)'
      when p_kind = 'decision_outcome_linked' then ' (Decision Outcome Link ≠ Proven Causality)'
      when p_kind = 'forecast_reference_linked' then ' (Forecast Reference ≠ Future Fact)'
      when p_kind = 'commitment_reference_linked' then ' (Commitment Reference ≠ Completed Commitment)'
      when p_kind = 'performance_outcome_linked' then ' (Outcome Link ≠ Proven Causality)'
      when p_kind = 'performance_learning_reference_recorded' then ' (Learning Reference ≠ 자동 KPI 변경)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'kpi_auto_modified', false, 'auto_evaluation_applied', false, 'compensation_changed', false, 'budget_changed', false, 'strategy_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_kpis_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_kpis language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_kpis
  where (p_status is null or kpi_status = p_status)
    and (p_category is null or kpi_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_kpi_snapshots_list(p_kpi_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_kpi_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_kpi_snapshots
  where (p_kpi_id is null or kpi_id = p_kpi_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_performance_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'kpis', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_kpis),
      'draft', (select count(*) from public.ai_enterprise_kpis where kpi_status = 'draft'),
      'active', (select count(*) from public.ai_enterprise_kpis where kpi_status = 'active_reference'),
      'paused', (select count(*) from public.ai_enterprise_kpis where kpi_status = 'paused_reference'),
      'deprecated', (select count(*) from public.ai_enterprise_kpis where kpi_status = 'deprecated_reference'),
      'with_baseline', (select count(*) from public.ai_enterprise_kpis where baseline_value is not null),
      'with_target', (select count(*) from public.ai_enterprise_kpis where target_value is not null),
      'with_observed', (select count(*) from public.ai_enterprise_kpis where current_value_reference is not null),
      'growth', (select count(*) from public.ai_enterprise_kpis where trend_status in ('strong_growth_candidate','moderate_growth_candidate')),
      'decline', (select count(*) from public.ai_enterprise_kpis where trend_status in ('moderate_decline_candidate','strong_decline_candidate')),
      'off_target', (select count(*) from public.ai_enterprise_kpis where variance_status in ('materially_off_target_candidate','critical_variance_candidate')),
      'critical_variance', (select count(*) from public.ai_enterprise_kpis where variance_status = 'critical_variance_candidate'),
      'negative_impact', (select count(*) from public.ai_enterprise_kpis where business_impact_status in ('moderate_negative_candidate','high_negative_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_kpis where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(kpi_category, cnt), '{}'::jsonb) from (select kpi_category, count(*) cnt from public.ai_enterprise_kpis group by kpi_category) t)
    ),
    'snapshots', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_kpi_snapshots),
      'with_observed_value', (select count(*) from public.ai_enterprise_kpi_snapshots where observed_value is not null),
      'null_observed', (select count(*) from public.ai_enterprise_kpi_snapshots where observed_value is null),
      'verified_source', (select count(*) from public.ai_enterprise_kpi_snapshots where data_quality = 'verified_source_reference'),
      'proxy', (select count(*) from public.ai_enterprise_kpi_snapshots where data_quality = 'proxy_candidate'),
      'quality_unverified', (select count(*) from public.ai_enterprise_kpi_snapshots where data_quality = 'quality_unverified')
    ),
    'performance_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_performance_events),
      'baselines', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_baseline_recorded'),
      'targets', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_target_recorded'),
      'snapshots', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_snapshot_recorded'),
      'trend_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_trend_reviewed'),
      'variance_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_variance_reviewed'),
      'confidence_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_confidence_reviewed'),
      'forecast_comparisons', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_forecast_comparison_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_drift_reviewed'),
      'correlation_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_correlation_reviewed'),
      'dependency_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_dependency_reviewed'),
      'cross_domain_correlations', (select count(*) from public.ai_enterprise_performance_events where event_type = 'cross_domain_correlation_reviewed'),
      'impact_reviews', (select count(*) from public.ai_enterprise_performance_events where event_type = 'business_impact_reviewed'),
      'strategic_scorecards', (select count(*) from public.ai_enterprise_performance_events where event_type = 'strategic_scorecard_recorded'),
      'executive_scorecards', (select count(*) from public.ai_enterprise_performance_events where event_type = 'executive_scorecard_recorded'),
      'summaries', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_summary_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_recommendation_recorded'),
      'kpi_review_requests', (select count(*) from public.ai_enterprise_performance_events where event_type = 'kpi_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_performance_events where event_type = 'executive_review_requested'),
      'performance_review_requests', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_review_reference_recorded'),
      'goal_links', (select count(*) from public.ai_enterprise_performance_events where event_type = 'goal_reference_linked'),
      'program_links', (select count(*) from public.ai_enterprise_performance_events where event_type = 'program_reference_linked'),
      'decision_outcome_links', (select count(*) from public.ai_enterprise_performance_events where event_type = 'decision_outcome_linked'),
      'forecast_links', (select count(*) from public.ai_enterprise_performance_events where event_type = 'forecast_reference_linked'),
      'outcome_links', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_outcome_linked'),
      'learning_references', (select count(*) from public.ai_enterprise_performance_events where event_type = 'performance_learning_reference_recorded')
    ),
    -- Performance 원천 실측(전부 읽기 전용):
    'performance_actuals', jsonb_build_object(
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'execution_plans_0547', (select count(*) from public.ai_enterprise_execution_plans),
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'strategic_goals_0545', (select count(*) from public.ai_enterprise_strategic_goals),
      'resource_inventory_0546', (select count(*) from public.ai_enterprise_resource_inventory),
      'forecast_runs_0543', (select count(*) from public.ai_enterprise_forecast_runs),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'commitments_0520', (select count(*) from public.ai_execution_commitments),
      'knowledge_entities_0513', (select count(*) from public.ai_knowledge_entities),
      'legacy_kpi_definitions_0525', (select count(*) from public.ai_kpi_definitions),
      'legacy_kpi_snapshots_0525', (select count(*) from public.ai_kpi_snapshots)
    ),
    'performance_unavailable', jsonb_build_array('accounting_system_feed','revenue_recognition_feed','crm_feed','payroll_hr_system','external_market_benchmark_feed','ab_test_platform_feed','bi_warehouse_feed'),   -- 원본 없음(실측)
    'target_is_not_guaranteed_result', true, 'trend_is_not_future_trend', true,
    'correlation_is_not_causality', true, 'improvement_is_not_strategy_success', true,
    'decline_is_not_strategy_failure', true, 'impact_is_not_financial_fact', true,
    'recommendation_is_not_decision', true, 'review_is_not_approval', true,
    'scorecard_is_not_executive_evaluation', true, 'outcome_link_is_not_proven_causality', true,
    'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_kpi_modification', true, 'no_auto_evaluation', true, 'no_auto_compensation', true,
    'no_auto_budget_change', true, 'no_auto_strategy_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_performance_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_performance_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_performance_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_kpis enable row level security;
alter table public.ai_enterprise_kpi_snapshots enable row level security;
alter table public.ai_enterprise_performance_events enable row level security;

comment on table public.ai_enterprise_kpis is 'AI-OPS-44 — Enterprise Strategic KPI(≠ 인사평가 지표·Category 15종·개인 평가 계열 차단·Target ≠ Guaranteed Result·자동 수정/삭제/승인 없음).';
comment on table public.ai_enterprise_kpi_snapshots is 'AI-OPS-44 — KPI Snapshot(Observed Performance·Null → 0 변환 금지·verified 표기는 출처 필수).';
comment on table public.ai_enterprise_performance_events is 'AI-OPS-44 — Performance 이벤트 32종(자동 평가 이벤트 생성 금지·Scorecard ≠ Executive Evaluation).';
