-- 0519_admin_ai_executive_capacity_priority_portfolio.sql
-- Phase AI-OPS-16 — Enterprise Executive Capacity Intelligence,
-- Priority Portfolio Optimization & Financial Exposure Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0518 검증 완료):
--   Priority 원본: ai_executive_priority_candidates(0518 — tier/hard_risk_flags/
--     dependencies/mutually_exclusive_with 존재, effort/expected_cost 필드 없음
--     → Effort 는 신규 estimate 테이블에서 수동/Reference 기반으로만 기록).
--   Executive Role 원본: users.role='admin'(실측 — CEO/CFO/CTO 분리 테이블 없음),
--     조직도/Team/Working Hours/Calendar 테이블 없음 → available_hours 임의 생성 금지,
--     시간 자료 부재 시 executive_capacity_unknown 서버 강제.
--   Financial 원본: subscriptions.current_amount/payment_orders(paid)/
--     artist_settlements/ai_cost_models·snapshots(0508). Budget/Cash Flow/
--     회계원장 테이블 없음 → financial_exposure_unknown 정직 표기.
--   Confidence 원본: 0518 priority 는 confidence 컬럼이 없어 snapshot 별도 기록,
--     0517 calibration 재사용. Aging 원본: created_at/reviewed_at/deadline_at(0518).
--
-- Capacity 정직성(전부 강제):
--   * 경영진 시간·집중력 무한 가정 없음. 시간 자료 없으면 available_hours 임의 생성 금지.
--   * Effort null 을 0 으로 합산하지 않음. 비용 자료 없으면 Delay Cost 생성 금지.
--   * Financial Exposure ≠ 실제 회계 손실. ROI Reference ≠ 실제 투자수익률.
--   * Aging 자동 승격 없음. Confidence Drift 자동 Confidence 수정 없음.
--   * Portfolio ≠ 실제 업무 계획. 전 조합 미검토 시 optimal 표현 없음(상태에 optimal 없음).
--   * Hard Risk 를 조용히 제외한 Portfolio 는 feasible_reference 금지(서버 검증).
--   * Trigger 없음 · 삭제 RPC 없음 · Calendar/HR/Budget 실행 RPC 없음 · 원본 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Executive Capacity Snapshot — 시간 자료 없으면 unknown(임의 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_capacity_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  capacity_scope      text not null check (capacity_scope in ('company','executive_team','role','domain','team_reference','person_reference','manual')),
  scope_id            text,
  capacity_domain     text not null check (capacity_domain in ('executive','operations','engineering','product','security','privacy','compliance','finance','contract','settlement','sales','marketing','content','support','infrastructure','governance','strategy','organizational','manual')),
  role_reference      text,
  period_start        timestamptz,
  period_end          timestamptz,
  available_hours     numeric check (available_hours is null or available_hours >= 0),   -- 임의 생성 금지 — null 허용
  reserved_hours      numeric check (reserved_hours is null or reserved_hours >= 0),
  review_capacity_count int check (review_capacity_count is null or review_capacity_count >= 0),
  decision_capacity_count int check (decision_capacity_count is null or decision_capacity_count >= 0),
  concurrent_priority_limit int check (concurrent_priority_limit is null or concurrent_priority_limit >= 0),
  current_priority_count int check (current_priority_count is null or current_priority_count >= 0),
  current_review_count int check (current_review_count is null or current_review_count >= 0),
  current_decision_count int check (current_decision_count is null or current_decision_count >= 0),
  capacity_status     text not null default 'executive_capacity_unknown' check (capacity_status in ('available_reference','constrained_candidate','overloaded_candidate','critical_overload_candidate','executive_capacity_unknown','workforce_capacity_unknown','stale_candidate','insufficient_data')),
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_data','reviewed_reference','stale_candidate','rejected','invalidated')),
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Capacity Status ≠ 사람 성과 평가","실제 Calendar/Working Hours 데이터 없음(실측)"]'::jsonb,
  source_version      text not null default 'exec_capacity_v1(0519)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  generated_at        timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  check (reserved_hours is null or available_hours is null or reserved_hours <= available_hours),
  check (period_end is null or period_start is null or period_end > period_start)
);
create index if not exists idx_exec_cap on public.ai_executive_capacity_snapshots (capacity_domain, capacity_status, generated_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Priority Effort Estimate — 검토 시간과 실행 시간 분리. null→0 합산 금지.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_priority_effort_estimates (
  id                  uuid primary key default gen_random_uuid(),
  estimate_code       text not null unique,
  priority_candidate_id uuid not null references public.ai_executive_priority_candidates(id),
  effort_domain       text not null,
  review_hours        numeric check (review_hours is null or review_hours >= 0),
  decision_hours      numeric check (decision_hours is null or decision_hours >= 0),
  meeting_hours       numeric check (meeting_hours is null or meeting_hours >= 0),
  analysis_hours      numeric check (analysis_hours is null or analysis_hours >= 0),
  execution_reference_hours numeric check (execution_reference_hours is null or execution_reference_hours >= 0),
  observation_hours   numeric check (observation_hours is null or observation_hours >= 0),
  required_roles      jsonb not null default '[]'::jsonb,
  required_participants jsonb not null default '[]'::jsonb,
  required_resources  jsonb not null default '[]'::jsonb,
  dependency_wait_days numeric check (dependency_wait_days is null or dependency_wait_days >= 0),
  expected_duration_days numeric check (expected_duration_days is null or expected_duration_days >= 0),
  estimate_confidence numeric check (estimate_confidence is null or (estimate_confidence >= 0 and estimate_confidence <= 100)),
  effort_status       text not null default 'effort_unverified' check (effort_status in ('measured_reference','partially_estimated','manually_estimated','effort_unverified','stale_candidate','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["검토 시간 ≠ 실행 시간(분리 기록)","null 항목은 0 으로 합산하지 않음"]'::jsonb,
  source_version      text not null default 'exec_capacity_v1(0519)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_prio_effort on public.ai_priority_effort_estimates (priority_candidate_id, effort_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Priority Aging Snapshot — 덮어쓰기 금지 · 자동 승격 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_priority_aging_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  priority_candidate_id uuid not null references public.ai_executive_priority_candidates(id),
  snapshot_at         timestamptz not null default now(),
  age_days            numeric not null check (age_days >= 0),
  status_age_days     numeric check (status_age_days is null or status_age_days >= 0),
  days_to_deadline    numeric,
  days_past_deadline  numeric check (days_past_deadline is null or days_past_deadline >= 0),
  waiting_evidence_days numeric check (waiting_evidence_days is null or waiting_evidence_days >= 0),
  executive_review_days numeric check (executive_review_days is null or executive_review_days >= 0),
  deferred_days       numeric check (deferred_days is null or deferred_days >= 0),
  aging_status        text not null default 'aging_threshold_unverified' check (aging_status in ('fresh_reference','aging_candidate','stale_priority_candidate','deadline_approaching','overdue_candidate','critical_overdue_candidate','aging_threshold_unverified','insufficient_data')),
  escalation_candidate boolean not null default false,          -- 후보 표시일 뿐 자동 승격 없음
  delay_risk          text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Aging ≠ 잘못된 의사결정 단정","자동 Priority 승격 없음"]'::jsonb,
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_prio_aging on public.ai_priority_aging_snapshots (priority_candidate_id, snapshot_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Financial Exposure — 실제 회계 손실/확정 매출 아님.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_priority_financial_exposures (
  id                  uuid primary key default gen_random_uuid(),
  exposure_code       text not null unique,
  priority_candidate_id uuid not null references public.ai_executive_priority_candidates(id),
  exposure_type       text not null check (exposure_type in ('revenue_at_risk','cost_increase_candidate','contract_value_at_risk','renewal_value_at_risk','settlement_exposure','infrastructure_cost_exposure','incident_cost_candidate','opportunity_value_at_risk','regulatory_penalty_reference','reputational_exposure_qualitative','manual')),
  currency            text not null default 'KRW' check (currency in ('KRW','USD','manual')),
  baseline_amount     numeric,
  low_estimate        numeric,
  expected_estimate   numeric,
  high_estimate       numeric,
  time_horizon        text,
  exposure_direction  text check (exposure_direction is null or exposure_direction in ('loss_candidate','gain_at_risk','cost_increase','mixed','unknown')),
  probability_reference numeric check (probability_reference is null or (probability_reference >= 0 and probability_reference <= 100)),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  calculation_method  text,
  source_references   jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["실제 회계 손실/확정 매출 아님(추정 Reference)","비금전 Risk 를 금액 0 으로 표시하지 않음"]'::jsonb,
  verification_status text not null default 'financial_exposure_unknown' check (verification_status in ('internally_measured_reference','partially_supported','assumption_based','external_reference_only','financial_exposure_unknown','causality_unverified','unsupported','insufficient_data')),
  review_status       text not null default 'draft' check (review_status in ('draft','pending_review','waiting_financial_data','reviewed_reference','rejected','invalidated')),
  source_version      text not null default 'exec_capacity_v1(0519)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (low_estimate is null or high_estimate is null or low_estimate <= high_estimate)
);
create index if not exists idx_prio_finexp on public.ai_priority_financial_exposures (priority_candidate_id, exposure_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Priority Confidence Snapshot — 덮어쓰기 금지 · 자동 Confidence 수정 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_priority_confidence_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  snapshot_code       text not null unique,
  priority_candidate_id uuid not null references public.ai_executive_priority_candidates(id),
  snapshot_at         timestamptz not null default now(),
  confidence_value    numeric not null check (confidence_value >= 0 and confidence_value <= 100),
  confidence_source   text not null,
  evidence_count      int check (evidence_count is null or evidence_count >= 0),
  counter_evidence_count int check (counter_evidence_count is null or counter_evidence_count >= 0),
  input_freshness     text,
  drift_from_previous numeric,
  drift_from_initial  numeric,
  drift_status        text not null default 'confidence_drift_unverified' check (drift_status in ('stable_reference','increasing_candidate','decreasing_candidate','volatile_candidate','confidence_drift_unverified','sample_too_small','insufficient_data')),
  reason_summary      text,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Confidence 감소 ≠ Priority 실패/폐기","자동 Confidence 수정 없음"]'::jsonb,
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_prio_conf on public.ai_priority_confidence_snapshots (priority_candidate_id, snapshot_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Priority Portfolio — 실제 업무 계획/실행 일정 아님. optimal 상태 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_priority_portfolios (
  id                  uuid primary key default gen_random_uuid(),
  portfolio_code      text not null unique,
  title               text not null,
  portfolio_period_start timestamptz,
  portfolio_period_end timestamptz,
  portfolio_type      text not null check (portfolio_type in ('daily_executive','weekly_executive','risk_focused','opportunity_focused','balanced','capacity_constrained','resilience_focused','financial_exposure_focused','custom')),
  priority_candidate_ids jsonb not null default '[]'::jsonb,
  excluded_priority_ids jsonb not null default '[]'::jsonb,
  hard_risk_exclusion_reasons jsonb not null default '[]'::jsonb,  -- Hard Risk 제외 시 명시 사유(조용한 제외 금지)
  capacity_snapshot_ids jsonb not null default '[]'::jsonb,
  effort_estimate_ids jsonb not null default '[]'::jsonb,
  total_review_hours  numeric check (total_review_hours is null or total_review_hours >= 0),
  total_decision_hours numeric check (total_decision_hours is null or total_decision_hours >= 0),
  total_meeting_hours numeric check (total_meeting_hours is null or total_meeting_hours >= 0),
  total_required_budget numeric,
  total_financial_exposure numeric,
  expected_value_reference text,
  risk_summary        jsonb not null default '[]'::jsonb,
  opportunity_summary jsonb not null default '[]'::jsonb,
  conflict_summary    jsonb not null default '[]'::jsonb,
  dependency_summary  jsonb not null default '[]'::jsonb,
  aging_summary       jsonb not null default '[]'::jsonb,
  feasibility_status  text not null default 'feasibility_unverified' check (feasibility_status in ('feasible_reference','partially_feasible','executive_capacity_unknown','workforce_capacity_unknown','over_capacity','resource_conflict','schedule_conflict','mutually_exclusive_conflict','blocking_dependency','hard_risk_uncovered','infeasible','feasibility_unverified','insufficient_data')),
  confidence          numeric check (confidence is null or (confidence >= 0 and confidence <= 100)),
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["실제 업무 계획/실행 일정 아님","전 조합 미검토 — optimal 단정 없음","selected_reference ≠ 실행 확정"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_executive_review','waiting_capacity','waiting_evidence','selected_reference','deferred_reference','rejected','invalidated')),
  reviewer_id         uuid,
  approver_id         uuid,
  decision            text,
  decision_reason     text,
  warnings            jsonb not null default '[]'::jsonb,
  source_version      text not null default 'exec_capacity_v1(0519)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  reviewed_at         timestamptz,
  check (portfolio_period_end is null or portfolio_period_start is null or portfolio_period_end > portfolio_period_start)
);
create index if not exists idx_exec_portfolio on public.ai_executive_priority_portfolios (portfolio_type, review_status, feasibility_status, created_at desc);

-- Organizational Dependency / External Action / Audit / Review 이력은 Event 로 통합(테이블 최소화).
create table if not exists public.ai_executive_capacity_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('capacity_snapshot_created','effort_estimate_created','priority_aging_snapshot_created','financial_exposure_created','confidence_snapshot_created','organizational_dependency_detected','portfolio_candidate_created','portfolio_review_started','portfolio_selected_reference','portfolio_deferred_reference','over_capacity_detected','resource_conflict_detected','schedule_conflict_detected','hard_risk_uncovered','external_capacity_action_recorded','portfolio_outcome_linked','capacity_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_cap_evt on public.ai_executive_capacity_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 7) 요약 — 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_capacity_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'capacity_snapshots_total', (select count(*) from public.ai_executive_capacity_snapshots),
    'capacity_by_status', (select coalesce(jsonb_object_agg(capacity_status, n), '{}'::jsonb) from (select capacity_status, count(*) n from public.ai_executive_capacity_snapshots group by capacity_status) x),
    'effort_estimates_total', (select count(*) from public.ai_priority_effort_estimates),
    'effort_unverified', (select count(*) from public.ai_priority_effort_estimates where effort_status = 'effort_unverified'),
    'aging_snapshots_total', (select count(*) from public.ai_priority_aging_snapshots),
    'overdue_candidates', (select count(*) from public.ai_priority_aging_snapshots where aging_status in ('overdue_candidate','critical_overdue_candidate')),
    'financial_exposures_total', (select count(*) from public.ai_priority_financial_exposures),
    'exposure_unknown', (select count(*) from public.ai_priority_financial_exposures where verification_status = 'financial_exposure_unknown'),
    'confidence_snapshots_total', (select count(*) from public.ai_priority_confidence_snapshots),
    'portfolios_by_status', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from (select review_status, count(*) n from public.ai_executive_priority_portfolios group by review_status) x),
    'portfolios_by_feasibility', (select coalesce(jsonb_object_agg(feasibility_status, n), '{}'::jsonb) from (select feasibility_status, count(*) n from public.ai_executive_priority_portfolios group by feasibility_status) x),
    -- 원본 실측(참조만) + 미존재 정직 표기:
    'source_actuals', jsonb_build_object(
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'admin_count', (select count(*) from public.users where role = 'admin' and withdrawn_at is null),
      'pending_priorities', (select count(*) from public.ai_executive_priority_candidates where priority_status in ('draft','pending_materiality_review','pending_urgency_review','pending_executive_review','under_review')),
      'p0_pending', (select count(*) from public.ai_executive_priority_candidates where priority_tier = 'P0_human_review_now' and priority_status not in ('accepted_reference','rejected','invalidated','deferred')),
      'calendar_data', 'executive_capacity_unknown',
      'working_hours_data', 'executive_capacity_unknown',
      'team_capacity_data', 'workforce_capacity_unknown',
      'budget_system', 'financial_exposure_unknown',
      'cash_flow_data', 'financial_exposure_unknown',
      'org_chart', 'organizational_dependency_unverified'
    ),
    'no_auto_priority_selection', true, 'no_calendar_creation', true, 'no_work_assignment', true, 'no_budget_allocation', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Capacity Snapshot 생성·조회 — 시간 자료 없으면 unknown 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_capacity_snapshot_create(
  p_code text, p_scope text, p_domain text, p_evidence jsonb,
  p_scope_id text default null, p_role text default null,
  p_period_start timestamptz default null, p_period_end timestamptz default null,
  p_available_hours numeric default null, p_reserved_hours numeric default null,
  p_review_capacity int default null, p_decision_capacity int default null,
  p_concurrent_limit int default null, p_current_priorities int default null,
  p_current_reviews int default null, p_current_decisions int default null,
  p_status text default 'executive_capacity_unknown', p_assumptions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_available_hours is not null and p_available_hours < 0 then raise exception 'available_hours 음수 금지'; end if;
  if p_reserved_hours is not null and p_reserved_hours < 0 then raise exception 'reserved_hours 음수 금지'; end if;
  if p_available_hours is not null and p_reserved_hours is not null and p_reserved_hours > p_available_hours then raise exception 'reserved > available 금지'; end if;
  -- 시간 자료 없으면 available/constrained 상태 지정 금지(임의 Capacity 생성 방지)
  v_status := coalesce(p_status, 'executive_capacity_unknown');
  if p_available_hours is null and v_status in ('available_reference','constrained_candidate','overloaded_candidate','critical_overload_candidate') then
    v_status := 'executive_capacity_unknown';
  end if;
  select id into v_id from public.ai_executive_capacity_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_executive_capacity_snapshots (snapshot_code, capacity_scope, scope_id, capacity_domain, role_reference, period_start, period_end, available_hours, reserved_hours, review_capacity_count, decision_capacity_count, concurrent_priority_limit, current_priority_count, current_review_count, current_decision_count, capacity_status, evidence, assumptions, idempotency_key, created_by)
  values (p_code, p_scope, p_scope_id, p_domain, p_role, p_period_start, p_period_end, p_available_hours, p_reserved_hours, p_review_capacity, p_decision_capacity, p_concurrent_limit, p_current_priorities, p_current_reviews, p_current_decisions, v_status, p_evidence, coalesce(p_assumptions, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('capacity_snapshot_created', v_id, p_code || ' (' || v_status || ') — 성과 평가 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'capacity_status', v_status, 'production_applied', false);
end $$;

create or replace function public.admin_executive_capacity_snapshots(p_domain text default null, p_limit int default 50)
returns setof public.ai_executive_capacity_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_capacity_snapshots where (p_domain is null or capacity_domain = p_domain)
    order by generated_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Effort Estimate 생성·조회 — 전 항목 null 이면 effort_unverified 강제.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_priority_effort_create(
  p_code text, p_priority_id uuid, p_domain text, p_evidence jsonb,
  p_review_hours numeric default null, p_decision_hours numeric default null,
  p_meeting_hours numeric default null, p_analysis_hours numeric default null,
  p_execution_hours numeric default null, p_observation_hours numeric default null,
  p_required_roles jsonb default '[]'::jsonb, p_dependency_wait_days numeric default null,
  p_duration_days numeric default null, p_confidence numeric default null,
  p_status text default 'manually_estimated', p_assumptions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_executive_priority_candidates where id = p_priority_id) then raise exception 'priority 실존 검증 실패'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if least(coalesce(p_review_hours, 0), coalesce(p_decision_hours, 0), coalesce(p_meeting_hours, 0), coalesce(p_analysis_hours, 0), coalesce(p_execution_hours, 0), coalesce(p_observation_hours, 0), coalesce(p_dependency_wait_days, 0), coalesce(p_duration_days, 0)) < 0 then raise exception 'Effort 음수 금지'; end if;
  if jsonb_array_length(coalesce(p_required_roles, '[]'::jsonb)) > 20 then raise exception 'required roles 20개 제한'; end if;
  -- 시간 항목이 전부 null 이면 measured/estimated 상태 지정 금지
  v_status := coalesce(p_status, 'effort_unverified');
  if p_review_hours is null and p_decision_hours is null and p_meeting_hours is null and p_analysis_hours is null and p_execution_hours is null and p_observation_hours is null then
    v_status := 'effort_unverified';
  end if;
  select id into v_id from public.ai_priority_effort_estimates where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_priority_effort_estimates (estimate_code, priority_candidate_id, effort_domain, review_hours, decision_hours, meeting_hours, analysis_hours, execution_reference_hours, observation_hours, required_roles, dependency_wait_days, expected_duration_days, estimate_confidence, effort_status, evidence, assumptions, idempotency_key, created_by)
  values (p_code, p_priority_id, p_domain, p_review_hours, p_decision_hours, p_meeting_hours, p_analysis_hours, p_execution_hours, p_observation_hours, coalesce(p_required_roles, '[]'::jsonb), p_dependency_wait_days, p_duration_days, p_confidence, v_status, p_evidence, coalesce(p_assumptions, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('effort_estimate_created', v_id, p_code || ' (' || v_status || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'effort_status', v_status, 'production_applied', false);
end $$;

create or replace function public.admin_priority_effort_estimates(p_priority_id uuid default null, p_limit int default 100)
returns setof public.ai_priority_effort_estimates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_priority_effort_estimates where (p_priority_id is null or priority_candidate_id = p_priority_id)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Aging Snapshot 생성·조회 — 자동 승격 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_priority_aging_snapshot_create(
  p_code text, p_priority_id uuid, p_evidence jsonb,
  p_status text default 'aging_threshold_unverified', p_days_to_deadline numeric default null,
  p_waiting_evidence_days numeric default null, p_deferred_days numeric default null,
  p_delay_risk text default null, p_escalation_candidate boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_created timestamptz; v_reviewed timestamptz; v_age numeric; v_status_age numeric;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  select created_at, reviewed_at into v_created, v_reviewed from public.ai_executive_priority_candidates where id = p_priority_id;
  if v_created is null then raise exception 'priority 실존 검증 실패'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_status not in ('fresh_reference','aging_candidate','stale_priority_candidate','deadline_approaching','overdue_candidate','critical_overdue_candidate','aging_threshold_unverified','insufficient_data') then raise exception '허용되지 않는 aging_status'; end if;
  v_age := greatest(0, extract(epoch from (now() - v_created)) / 86400.0);   -- created_at 실측 기반
  v_status_age := case when v_reviewed is null then null else greatest(0, extract(epoch from (now() - v_reviewed)) / 86400.0) end;
  select id into v_id from public.ai_priority_aging_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_priority_aging_snapshots (snapshot_code, priority_candidate_id, age_days, status_age_days, days_to_deadline, days_past_deadline, waiting_evidence_days, deferred_days, aging_status, escalation_candidate, delay_risk, evidence, idempotency_key, created_by)
  values (p_code, p_priority_id, round(v_age, 2), round(v_status_age, 2), p_days_to_deadline,
          case when p_days_to_deadline is not null and p_days_to_deadline < 0 then abs(p_days_to_deadline) else null end,
          p_waiting_evidence_days, p_deferred_days, p_status, coalesce(p_escalation_candidate, false), p_delay_risk, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('priority_aging_snapshot_created', v_id, p_code || ' (' || p_status || ') — 자동 승격 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_escalated', false, 'production_applied', false);
end $$;

create or replace function public.admin_priority_aging_snapshots(p_priority_id uuid default null, p_limit int default 100)
returns setof public.ai_priority_aging_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_priority_aging_snapshots where (p_priority_id is null or priority_candidate_id = p_priority_id)
    order by snapshot_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Financial Exposure 생성·조회 — 실제 회계 손실 아님.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_priority_financial_exposure_create(
  p_code text, p_priority_id uuid, p_type text, p_evidence jsonb,
  p_currency text default 'KRW', p_baseline numeric default null,
  p_low numeric default null, p_expected numeric default null, p_high numeric default null,
  p_horizon text default null, p_direction text default null, p_probability numeric default null,
  p_confidence numeric default null, p_method text default null,
  p_verification text default 'financial_exposure_unknown', p_assumptions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_verification text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_executive_priority_candidates where id = p_priority_id) then raise exception 'priority 실존 검증 실패'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_currency not in ('KRW','USD','manual') then raise exception '허용되지 않는 currency'; end if;
  if p_low is not null and p_high is not null and p_low > p_high then raise exception 'low > high 금지'; end if;
  -- 금액이 전부 null 이면 measured 상태 지정 금지(가짜 숫자·0 변환 방지)
  v_verification := coalesce(p_verification, 'financial_exposure_unknown');
  if p_baseline is null and p_low is null and p_expected is null and p_high is null and v_verification = 'internally_measured_reference' then
    v_verification := 'financial_exposure_unknown';
  end if;
  select id into v_id from public.ai_priority_financial_exposures where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_priority_financial_exposures (exposure_code, priority_candidate_id, exposure_type, currency, baseline_amount, low_estimate, expected_estimate, high_estimate, time_horizon, exposure_direction, probability_reference, confidence, calculation_method, verification_status, evidence, assumptions, idempotency_key, created_by)
  values (p_code, p_priority_id, p_type, p_currency, p_baseline, p_low, p_expected, p_high, p_horizon, p_direction, p_probability, p_confidence, p_method, v_verification, p_evidence, coalesce(p_assumptions, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('financial_exposure_created', v_id, p_code || ' (' || p_type || ') — 실제 회계 손실 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'accounting_loss', false, 'production_applied', false);
end $$;

create or replace function public.admin_priority_financial_exposures(p_priority_id uuid default null, p_limit int default 100)
returns setof public.ai_priority_financial_exposures language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_priority_financial_exposures where (p_priority_id is null or priority_candidate_id = p_priority_id)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 12) Confidence Snapshot 생성·조회 — 이전 Snapshot 없으면 drift 판정 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_priority_confidence_snapshot_create(
  p_code text, p_priority_id uuid, p_confidence numeric, p_source text, p_evidence jsonb,
  p_evidence_count int default null, p_counter_count int default null,
  p_freshness text default null, p_status text default 'confidence_drift_unverified',
  p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_prev numeric; v_initial numeric; v_prev_count int; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_executive_priority_candidates where id = p_priority_id) then raise exception 'priority 실존 검증 실패'; end if;
  if p_confidence is null or p_confidence < 0 or p_confidence > 100 then raise exception 'confidence 0~100 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_status not in ('stable_reference','increasing_candidate','decreasing_candidate','volatile_candidate','confidence_drift_unverified','sample_too_small','insufficient_data') then raise exception '허용되지 않는 drift_status'; end if;
  select count(*) into v_prev_count from public.ai_priority_confidence_snapshots where priority_candidate_id = p_priority_id;
  select confidence_value into v_prev from public.ai_priority_confidence_snapshots where priority_candidate_id = p_priority_id order by snapshot_at desc limit 1;
  select confidence_value into v_initial from public.ai_priority_confidence_snapshots where priority_candidate_id = p_priority_id order by snapshot_at asc limit 1;
  -- 표본 부족(이전 snapshot < 2) 시 stable/increasing/decreasing/volatile 판정 금지
  v_status := coalesce(p_status, 'confidence_drift_unverified');
  if v_prev_count < 2 and v_status in ('stable_reference','increasing_candidate','decreasing_candidate','volatile_candidate') then
    v_status := 'sample_too_small';
  end if;
  select id into v_id from public.ai_priority_confidence_snapshots where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_priority_confidence_snapshots (snapshot_code, priority_candidate_id, confidence_value, confidence_source, evidence_count, counter_evidence_count, input_freshness, drift_from_previous, drift_from_initial, drift_status, reason_summary, evidence, idempotency_key, created_by)
  values (p_code, p_priority_id, p_confidence, p_source, p_evidence_count, p_counter_count, p_freshness,
          case when v_prev is null then null else p_confidence - v_prev end,
          case when v_initial is null then null else p_confidence - v_initial end,
          v_status, p_reason, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('confidence_snapshot_created', v_id, p_code || ' (' || v_status || ') — 자동 Confidence 수정 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'confidence_auto_adjusted', false, 'production_applied', false);
end $$;

create or replace function public.admin_priority_confidence_snapshots(p_priority_id uuid default null, p_limit int default 100)
returns setof public.ai_priority_confidence_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_priority_confidence_snapshots where (p_priority_id is null or priority_candidate_id = p_priority_id)
    order by snapshot_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 13) Portfolio 생성·검토·조회 — Hard Risk 조용한 제외 금지 · 자동 선택 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_priority_portfolio_create(
  p_code text, p_title text, p_type text, p_evidence jsonb,
  p_priority_ids jsonb default '[]'::jsonb, p_excluded_ids jsonb default '[]'::jsonb,
  p_hard_risk_exclusion_reasons jsonb default '[]'::jsonb,
  p_period_start timestamptz default null, p_period_end timestamptz default null,
  p_review_hours numeric default null, p_decision_hours numeric default null,
  p_meeting_hours numeric default null, p_total_exposure numeric default null,
  p_risk_summary jsonb default '[]'::jsonb, p_conflict_summary jsonb default '[]'::jsonb,
  p_confidence numeric default null, p_assumptions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  v_cnt := jsonb_array_length(coalesce(p_priority_ids, '[]'::jsonb));
  if v_cnt > 30 or jsonb_array_length(coalesce(p_excluded_ids, '[]'::jsonb)) > 30 then raise exception 'priority 30개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_executive_priority_candidates c
     where c.id in (select (jsonb_array_elements_text(p_priority_ids))::uuid);
    if v_found <> v_cnt then raise exception 'priority 실존 검증 실패'; end if;
  end if;
  if jsonb_array_length(coalesce(p_excluded_ids, '[]'::jsonb)) > 0 then
    select count(*) into v_found from public.ai_executive_priority_candidates c
     where c.id in (select (jsonb_array_elements_text(p_excluded_ids))::uuid);
    if v_found <> jsonb_array_length(coalesce(p_excluded_ids, '[]'::jsonb)) then raise exception 'excluded priority 실존 검증 실패'; end if;
  end if;
  if least(coalesce(p_review_hours, 0), coalesce(p_decision_hours, 0), coalesce(p_meeting_hours, 0)) < 0 then raise exception 'hours 음수 금지'; end if;
  if pg_column_size(coalesce(p_risk_summary, '[]'::jsonb)) + pg_column_size(coalesce(p_conflict_summary, '[]'::jsonb)) > 32768 then raise exception 'summary 32KB 제한'; end if;
  select id into v_id from public.ai_executive_priority_portfolios where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  -- 생성 시 feasible_reference 지정 불가 — feasibility 는 검토 워크플로만
  insert into public.ai_executive_priority_portfolios (portfolio_code, title, portfolio_period_start, portfolio_period_end, portfolio_type, priority_candidate_ids, excluded_priority_ids, hard_risk_exclusion_reasons, total_review_hours, total_decision_hours, total_meeting_hours, total_financial_exposure, risk_summary, conflict_summary, confidence, evidence, assumptions, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_period_start, p_period_end, p_type, coalesce(p_priority_ids, '[]'::jsonb), coalesce(p_excluded_ids, '[]'::jsonb), coalesce(p_hard_risk_exclusion_reasons, '[]'::jsonb), p_review_hours, p_decision_hours, p_meeting_hours, p_total_exposure, coalesce(p_risk_summary, '[]'::jsonb), coalesce(p_conflict_summary, '[]'::jsonb), p_confidence, p_evidence, coalesce(p_assumptions, '[]'::jsonb), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id) values ('portfolio_candidate_created', v_id, p_code || ' (' || p_type || ') — 실행 계획 아님·자동 선택 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_selected', false, 'optimal_claimed', false, 'production_applied', false);
end $$;

create or replace function public.admin_priority_portfolio_review(p_id uuid, p_status text, p_reason text, p_feasibility text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_excluded jsonb; v_reasons jsonb; v_hard_excluded int; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_executive_review','waiting_capacity','waiting_evidence','selected_reference','deferred_reference','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if p_feasibility is not null and p_feasibility not in ('feasible_reference','partially_feasible','executive_capacity_unknown','workforce_capacity_unknown','over_capacity','resource_conflict','schedule_conflict','mutually_exclusive_conflict','blocking_dependency','hard_risk_uncovered','infeasible','feasibility_unverified','insufficient_data') then raise exception '허용되지 않는 feasibility'; end if;
  select review_status, created_by, excluded_priority_ids, hard_risk_exclusion_reasons into v_cur, v_creator, v_excluded, v_reasons
    from public.ai_executive_priority_portfolios where id = p_id for update;
  if v_cur is null then raise exception 'portfolio 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- Hard Risk 조용한 제외 금지: 제외된 Hard Risk priority 수 > 명시 사유 수 → feasible 금지
  if p_feasibility = 'feasible_reference' then
    select count(*) into v_hard_excluded from public.ai_executive_priority_candidates c
     where c.id in (select (jsonb_array_elements_text(v_excluded))::uuid) and jsonb_array_length(c.hard_risk_flags) > 0;
    if v_hard_excluded > jsonb_array_length(coalesce(v_reasons, '[]'::jsonb)) then
      raise exception 'Hard Risk Priority % 건이 사유 없이 제외됨 — feasible_reference 금지(조용한 제외 금지)', v_hard_excluded;
    end if;
  end if;
  if p_status = 'selected_reference' and v_creator is not null and v_creator = v_uid then
    v_warnings := jsonb_build_array('self_approval_warning: 생성자와 선택자가 동일');
  end if;
  update public.ai_executive_priority_portfolios
     set review_status = p_status, feasibility_status = coalesce(p_feasibility, feasibility_status),
         warnings = warnings || v_warnings, reviewer_id = v_uid, decision = p_status,
         decision_reason = left(p_reason, 500), reviewed_at = now()
   where id = p_id;
  v_evt := case when p_status = 'selected_reference' then 'portfolio_selected_reference'
                when p_status = 'deferred_reference' then 'portfolio_deferred_reference'
                else 'portfolio_review_started' end;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, actor_id)
  values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (selected_reference ≠ 실행 확정)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'warnings', v_warnings, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_priority_portfolios(p_status text default null, p_limit int default 50)
returns setof public.ai_executive_priority_portfolios language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_priority_portfolios where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 14) External Action / Audit — 참조 기록만(Calendar/HR/Budget 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_capacity_external_action(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('executive_time_reserved_reference','meeting_scheduled_reference','reviewer_assigned_reference','approver_assigned_reference','backup_owner_assigned_reference','priority_started_reference','priority_deferred_reference','budget_reserved_reference','team_capacity_added_reference','deadline_changed_reference','portfolio_review_completed_reference','manual_capacity_action_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_executive_capacity_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_capacity_action_recorded', p_ref_id, p_action_type || ' — ' || left(p_reason, 200) || ' (Calendar/인력/예산 미변경·진위 자동 보장 없음)', jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'calendar_changed', false, 'budget_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_capacity_audit(p_limit int default 100)
returns setof public.ai_executive_capacity_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_capacity_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_executive_capacity_snapshots enable row level security;
alter table public.ai_priority_effort_estimates enable row level security;
alter table public.ai_priority_aging_snapshots enable row level security;
alter table public.ai_priority_financial_exposures enable row level security;
alter table public.ai_priority_confidence_snapshots enable row level security;
alter table public.ai_executive_priority_portfolios enable row level security;
alter table public.ai_executive_capacity_events enable row level security;

comment on table public.ai_executive_capacity_snapshots is 'AI-OPS-16 — Executive Capacity Snapshot(시간 자료 없으면 unknown 강제·성과 평가 아님).';
comment on table public.ai_priority_effort_estimates is 'AI-OPS-16 — Priority Effort(검토/실행 시간 분리·null→0 합산 금지).';
comment on table public.ai_priority_aging_snapshots is 'AI-OPS-16 — Priority Aging(덮어쓰기 금지·자동 승격 없음).';
comment on table public.ai_priority_financial_exposures is 'AI-OPS-16 — Financial Exposure(실제 회계 손실 아님·비금전 0 표시 금지).';
comment on table public.ai_priority_confidence_snapshots is 'AI-OPS-16 — Confidence Drift(표본<2 판정 금지·자동 수정 없음).';
comment on table public.ai_executive_priority_portfolios is 'AI-OPS-16 — Priority Portfolio(실행 계획 아님·Hard Risk 조용한 제외 시 feasible 금지·optimal 상태 없음).';
comment on table public.ai_executive_capacity_events is 'AI-OPS-16 — Capacity Audit(event_type whitelist 17종·의존성/외부활동/검토 통합).';
