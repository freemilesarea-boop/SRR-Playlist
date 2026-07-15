-- 0518_admin_ai_corporate_intelligence_executive_command.sql
-- Phase AI-OPS-15 — Enterprise Corporate Intelligence, Executive Command &
-- Strategic Priority Orchestration Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0485/0486/0504~0517 검증 완료):
--   Corporate Signal 원본: subscriptions(MRR 실측)/payment_orders(paid)/users(business·artist)/
--     artist_contracts/artist_settlements/artist_payout_accounts/ai_incidents/ai_capacity_metrics/
--     ai_cost_snapshots/ai_security_events/ai_enterprise_policy_versions/ai_knowledge_relationships/
--     ai_decision_outcomes(0514)/ai_organizational_learning_patterns(0515)/
--     ai_strategic_scenarios·portfolios·allocations(0516)/ai_business_causal_candidates·
--     ai_confidence_calibration_snapshots(0517).
--   Briefing 저장: ai_executive_briefings(0511) 재사용 + 본 이벤트 테이블 통합 —
--     Board Reference/Decision Package/External Action/Audit 은 별도 테이블 없이 Event 로 최소화.
--   시장/경쟁사 데이터 소스 없음 → market_data_unavailable 정직 표기.
--   Calendar 연동 없음 → Agenda 는 기록일 뿐 캘린더 자동 생성 없음.
--
-- 경영 정직성(전부 강제):
--   * Priority Score ≠ 자동 실행 순서. P0 = 즉시 사람 검토(자동 실행 아님) — 서버가
--     P0 생성 시 상태를 pending_executive_review 로 강제.
--   * Hard Security/Privacy/Compliance Risk 는 평균으로 희석 금지 — hard risk 존재 시
--     P3_monitor 배정 서버 차단.
--   * Urgent 와 Important 는 별도 축으로 분리 기록.
--   * 비금전 Risk 를 0 으로 평가 금지 — 금액 미상은 null + materiality_unverified.
--   * Board Reference ≠ 법적 이사회 자료. Briefing/Reference 자동 발송 없음.
--   * selected/accepted_reference ≠ 실제 실행. 충돌은 보존(평균 숨김 금지).
--   * Trigger 없음 · 삭제 RPC 없음 · Calendar 생성/Report 발송 RPC 없음 · 원본 테이블 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Corporate Signal — 전사 관측 신호(원본 복제 아님). Materiality/Urgency 검토 대상.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_corporate_signals (
  id                  uuid primary key default gen_random_uuid(),
  signal_code         text not null unique,
  signal_domain       text not null check (signal_domain in ('revenue','growth','enterprise','store','artist','contract','settlement','payout','cost','capacity','reliability','security','privacy','compliance','operations','policy','governance','strategy','learning','causal','calibration','executive','external_environment','manual')),
  signal_type         text not null check (signal_type in ('mrr_change','revenue_change','store_growth_change','enterprise_growth_change','artist_growth_change','churn_risk_change','contract_expiry_approaching','settlement_anomaly_candidate','payout_risk_change','cost_change','capacity_risk_change','incident_change','security_risk_change','privacy_risk_change','compliance_risk_change','policy_conflict_reference','strategic_scenario_reference','portfolio_allocation_reference','decision_outcome_reference','learning_pattern_reference','causal_candidate_reference','calibration_reference','external_environment_reference','manual')),
  source_system       text not null,
  source_reference_id uuid,
  title               text not null,
  metric_name         text,
  metric_value        numeric,                                 -- 없으면 null(0 변환 금지)
  metric_unit         text check (metric_unit is null or metric_unit in ('krw','percent','count','hours','gb','ratio','days','manual')),
  baseline_value      numeric,
  observed_at         timestamptz not null,
  monetary_impact_krw numeric,                                 -- 비금전 Risk 를 0 으로 기록 금지 — 미상은 null
  materiality_score   numeric check (materiality_score is null or (materiality_score >= 0 and materiality_score <= 100)),
  materiality_status  text not null default 'materiality_unverified' check (materiality_status in ('material_candidate','possibly_material','not_material_candidate','materiality_unverified','insufficient_data')),
  urgency_score       numeric check (urgency_score is null or (urgency_score >= 0 and urgency_score <= 100)),
  urgency_status      text not null default 'urgency_unverified' check (urgency_status in ('urgent_candidate','possibly_urgent','not_urgent_candidate','urgency_unverified','insufficient_data')),
  deadline_at         timestamptz,
  blast_radius        jsonb not null default '[]'::jsonb,
  blast_radius_status text not null default 'blast_radius_unverified' check (blast_radius_status in ('estimated_reference','blast_radius_unverified','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["관측 신호 — 우선순위/실행 확정 아님"]'::jsonb,
  review_status       text not null default 'pending_review' check (review_status in ('pending_review','materiality_reviewed','urgency_reviewed','fully_reviewed','dismissed_reference','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  source_version      text not null default 'corp_intel_v1(0518)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_sig on public.ai_corporate_signals (signal_domain, materiality_status, urgency_status, observed_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Executive Priority Candidate — 후보만(확정·자동 실행 아님).
--    P0 = 즉시 사람 검토. Hard Risk 희석 금지.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_priority_candidates (
  id                  uuid primary key default gen_random_uuid(),
  priority_code       text not null unique,
  priority_type       text not null check (priority_type in ('revenue_protection','growth_opportunity','cost_control','security_risk_response','privacy_risk_response','compliance_risk_response','reliability_risk_response','capacity_planning','contract_renewal','settlement_integrity','artist_relations','enterprise_expansion','policy_update_review','strategic_investment_review','organizational_learning_adoption','manual')),
  title               text not null,
  summary             text,
  priority_domain     text not null,
  source_signal_ids   jsonb not null default '[]'::jsonb,      -- ai_corporate_signals 참조(실존 검증)
  materiality_score   numeric check (materiality_score is null or (materiality_score >= 0 and materiality_score <= 100)),
  materiality_status  text not null default 'materiality_unverified' check (materiality_status in ('material_candidate','possibly_material','not_material_candidate','materiality_unverified','insufficient_data')),
  urgency_score       numeric check (urgency_score is null or (urgency_score >= 0 and urgency_score <= 100)),
  urgency_status      text not null default 'urgency_unverified' check (urgency_status in ('urgent_candidate','possibly_urgent','not_urgent_candidate','urgency_unverified','insufficient_data')),
  urgent_vs_important text not null default 'insufficient_data' check (urgent_vs_important in ('urgent_and_important','important_not_urgent','urgent_not_important','neither_candidate','insufficient_data')),
  deadline_at         timestamptz,
  hard_risk_flags     jsonb not null default '[]'::jsonb,      -- ['security','privacy','compliance'] — 평균 희석 금지
  priority_score      numeric check (priority_score is null or (priority_score >= 0 and priority_score <= 100)),
  priority_tier       text not null default 'insufficient_data' check (priority_tier in ('P0_human_review_now','P1_executive_review','P2_planned_review','P3_monitor','insufficient_data')),
  mutually_exclusive_with jsonb not null default '[]'::jsonb,
  dependencies        jsonb not null default '[]'::jsonb,
  expected_impact     text,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  warnings            jsonb not null default '[]'::jsonb,      -- self-approval 등 경고 보존
  limitations         jsonb not null default '["Priority Score ≠ 자동 실행 순서","P0 = 즉시 사람 검토(자동 실행 아님)","accepted_reference ≠ 실제 실행"]'::jsonb,
  priority_status     text not null default 'draft' check (priority_status in ('draft','pending_materiality_review','pending_urgency_review','pending_executive_review','under_review','accepted_reference','deferred','monitoring','rejected','invalidated','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  source_version      text not null default 'corp_intel_v1(0518)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  -- Hard Risk 존재 시 P3_monitor 배정 금지(평균 희석 금지) — 서버 RPC 도 동일 차단
  check (jsonb_array_length(hard_risk_flags) = 0 or priority_tier <> 'P3_monitor')
);
create index if not exists idx_exec_prio on public.ai_executive_priority_candidates (priority_tier, priority_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Corporate Conflict — 충돌 보존(평균으로 숨기지 않음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_corporate_conflicts (
  id                  uuid primary key default gen_random_uuid(),
  conflict_code       text not null unique,
  conflict_type       text not null check (conflict_type in ('resource_conflict','budget_conflict','personnel_capacity_conflict','timeline_conflict','policy_conflict','strategy_conflict','priority_conflict','dependency_conflict','risk_appetite_conflict','compliance_vs_speed_conflict','cost_vs_reliability_conflict','growth_vs_margin_conflict','security_vs_convenience_conflict','short_term_vs_long_term_conflict','data_conflict','manual')),
  title               text not null,
  conflict_domain     text not null,
  side_a_ref_id       uuid,
  side_a_summary      text not null,                           -- 양쪽 입장 보존
  side_b_ref_id       uuid,
  side_b_summary      text not null,
  severity            text not null default 'severity_unverified' check (severity in ('critical','high','medium','low','severity_unverified','insufficient_data')),
  resolution_candidates jsonb not null default '[]'::jsonb,    -- 후보만 — 자동 해소 없음
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["충돌 보존 — 평균으로 숨기지 않음","Resolution Candidate ≠ 자동 해소"]'::jsonb,
  conflict_status     text not null default 'detected' check (conflict_status in ('detected','pending_review','under_review','resolution_candidate_proposed','resolved_reference','accepted_tradeoff','deferred','invalidated','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  source_version      text not null default 'corp_intel_v1(0518)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_conf on public.ai_corporate_conflicts (conflict_type, conflict_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Executive Agenda — 기록일 뿐 캘린더 자동 생성 없음. 확정 ≠ 실행.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_agendas (
  id                  uuid primary key default gen_random_uuid(),
  agenda_code         text not null unique,
  agenda_type         text not null check (agenda_type in ('daily_briefing_review','weekly_review','monthly_review','quarterly_review','p0_immediate_review','priority_review','conflict_resolution_review','risk_review','opportunity_review','board_preparation_reference','manual')),
  title               text not null,
  agenda_window       text not null default 'ad_hoc' check (agenda_window in ('daily','weekly','monthly','quarterly','ad_hoc')),
  scheduled_for       date,                                    -- 참고 날짜 — 캘린더 이벤트 생성 아님
  items               jsonb not null default '[]'::jsonb,      -- 30개 제한
  linked_priority_ids jsonb not null default '[]'::jsonb,
  decision_required_items jsonb not null default '[]'::jsonb,
  can_wait_items      jsonb not null default '[]'::jsonb,
  must_not_do_items   jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Agenda ≠ 캘린더 자동 생성","Agenda 확정 ≠ 실행","Board Preparation ≠ 법적 이사회 자료"]'::jsonb,
  agenda_status       text not null default 'draft' check (agenda_status in ('draft','proposed','pending_executive_review','confirmed_reference','completed_reference','cancelled','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  source_version      text not null default 'corp_intel_v1(0518)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_agenda on public.ai_executive_agendas (agenda_type, agenda_status, created_at desc);

-- Briefing/Board Reference/Decision Package/External Action/Audit 은 Event 로 통합(테이블 최소화).
create table if not exists public.ai_corporate_intelligence_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('signal_recorded','materiality_reviewed','urgency_reviewed','priority_candidate_created','priority_reviewed','conflict_detected','conflict_reviewed','bottleneck_detected','attention_candidate_created','agenda_created','agenda_reviewed','briefing_generated','board_reference_created','decision_package_created','priority_outcome_linked','external_executive_action_reference','human_review_recorded','corporate_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_intel_evt on public.ai_corporate_intelligence_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 요약 — 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'signals_total', (select count(*) from public.ai_corporate_signals),
    'signals_by_domain', (select coalesce(jsonb_object_agg(signal_domain, n), '{}'::jsonb) from (select signal_domain, count(*) n from public.ai_corporate_signals group by signal_domain) x),
    'materiality_unverified', (select count(*) from public.ai_corporate_signals where materiality_status = 'materiality_unverified'),
    'urgency_unverified', (select count(*) from public.ai_corporate_signals where urgency_status = 'urgency_unverified'),
    'priorities_by_tier', (select coalesce(jsonb_object_agg(priority_tier, n), '{}'::jsonb) from (select priority_tier, count(*) n from public.ai_executive_priority_candidates group by priority_tier) x),
    'priorities_by_status', (select coalesce(jsonb_object_agg(priority_status, n), '{}'::jsonb) from (select priority_status, count(*) n from public.ai_executive_priority_candidates group by priority_status) x),
    'p0_pending_human_review', (select count(*) from public.ai_executive_priority_candidates where priority_tier = 'P0_human_review_now' and priority_status not in ('accepted_reference','rejected','invalidated','deferred')),
    'conflicts_by_status', (select coalesce(jsonb_object_agg(conflict_status, n), '{}'::jsonb) from (select conflict_status, count(*) n from public.ai_corporate_conflicts group by conflict_status) x),
    'agendas_total', (select count(*) from public.ai_executive_agendas),
    'briefings_recorded', (select count(*) from public.ai_corporate_intelligence_events where event_type = 'briefing_generated'),
    -- 원본 실측(참조만) + 미존재 정직 표기:
    'source_actuals', jsonb_build_object(
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'active_stores', (select count(*) from public.users where account_type = 'business' and withdrawn_at is null),
      'active_artists', (select count(*) from public.users where account_type = 'artist' and withdrawn_at is null),
      'open_incidents', (select count(*) from public.ai_incidents where status not in ('resolved','closed')),
      'decision_outcomes', (select count(*) from public.ai_decision_outcomes),
      'strategic_portfolios', (select count(*) from public.ai_strategic_portfolios),
      'causal_candidates', (select count(*) from public.ai_business_causal_candidates),
      'market_data', 'market_data_unavailable',
      'competitor_data', 'market_data_unavailable',
      'calendar_integration', 'not_integrated',
      'board_report_delivery', 'not_sent'
    ),
    'no_auto_execution', true, 'no_auto_priority_confirmation', true, 'no_calendar_creation', true, 'no_report_sending', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Signal 생성 · Materiality/Urgency 검토 · 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_signal_create(
  p_code text, p_domain text, p_type text, p_source_system text, p_title text,
  p_observed_at timestamptz, p_evidence jsonb, p_metric_name text default null,
  p_metric_value numeric default null, p_unit text default null, p_baseline numeric default null,
  p_monetary_impact numeric default null, p_deadline timestamptz default null,
  p_blast_radius jsonb default '[]'::jsonb, p_source_reference_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if jsonb_array_length(coalesce(p_blast_radius, '[]'::jsonb)) > 30 then raise exception 'blast_radius 30개 제한'; end if;
  select id into v_id from public.ai_corporate_signals where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_corporate_signals (signal_code, signal_domain, signal_type, source_system, source_reference_id, title, metric_name, metric_value, metric_unit, baseline_value, observed_at, monetary_impact_krw, deadline_at, blast_radius, blast_radius_status, evidence, idempotency_key, created_by)
  values (p_code, p_domain, p_type, p_source_system, p_source_reference_id, left(p_title, 200), p_metric_name, p_metric_value, p_unit, p_baseline, p_observed_at, p_monetary_impact, p_deadline,
          coalesce(p_blast_radius, '[]'::jsonb),
          case when jsonb_array_length(coalesce(p_blast_radius, '[]'::jsonb)) > 0 then 'estimated_reference' else 'blast_radius_unverified' end,
          p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('signal_recorded', v_id, p_code || ' (' || p_type || ')', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'materiality_verified', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_signal_review(
  p_id uuid, p_reason text,
  p_materiality_status text default null, p_materiality_score numeric default null,
  p_urgency_status text default null, p_urgency_score numeric default null,
  p_review_status text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_impact numeric; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if p_materiality_status is not null and p_materiality_status not in ('material_candidate','possibly_material','not_material_candidate','materiality_unverified','insufficient_data') then raise exception '허용되지 않는 materiality_status'; end if;
  if p_urgency_status is not null and p_urgency_status not in ('urgent_candidate','possibly_urgent','not_urgent_candidate','urgency_unverified','insufficient_data') then raise exception '허용되지 않는 urgency_status'; end if;
  if p_review_status is not null and p_review_status not in ('materiality_reviewed','urgency_reviewed','fully_reviewed','dismissed_reference','invalidated') then raise exception '허용되지 않는 review_status'; end if;
  select review_status, monetary_impact_krw into v_cur, v_impact from public.ai_corporate_signals where id = p_id for update;
  if v_cur is null then raise exception 'signal 없음'; end if;
  if v_cur in ('dismissed_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- 비금전 Risk 를 materiality 0 으로 평가 금지: 금액 미상 + score 0 지정 차단
  if p_materiality_score is not null and p_materiality_score = 0 and v_impact is null then
    raise exception '금액 미상 신호를 materiality 0 으로 평가 금지 — not_material_candidate 는 근거 있는 score 필요';
  end if;
  update public.ai_corporate_signals
     set materiality_status = coalesce(p_materiality_status, materiality_status),
         materiality_score  = coalesce(p_materiality_score, materiality_score),
         urgency_status     = coalesce(p_urgency_status, urgency_status),
         urgency_score      = coalesce(p_urgency_score, urgency_score),
         review_status      = coalesce(p_review_status, review_status),
         reviewer_id = v_uid, reviewed_at = now()
   where id = p_id;
  v_evt := case when p_urgency_status is not null and p_materiality_status is null then 'urgency_reviewed' else 'materiality_reviewed' end;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_signals(p_domain text default null, p_limit int default 100)
returns setof public.ai_corporate_signals language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_signals where (p_domain is null or signal_domain = p_domain)
    order by observed_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Executive Priority 생성 · 검토(자동 실행 아님·self-approval 경고) · 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_priority_create(
  p_code text, p_type text, p_title text, p_domain text, p_evidence jsonb,
  p_summary text default null, p_source_signal_ids jsonb default '[]'::jsonb,
  p_materiality_score numeric default null, p_materiality_status text default 'materiality_unverified',
  p_urgency_score numeric default null, p_urgency_status text default 'urgency_unverified',
  p_urgent_vs_important text default 'insufficient_data', p_deadline timestamptz default null,
  p_hard_risk_flags jsonb default '[]'::jsonb, p_priority_score numeric default null,
  p_priority_tier text default 'insufficient_data', p_mutually_exclusive jsonb default '[]'::jsonb,
  p_dependencies jsonb default '[]'::jsonb, p_expected_impact text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text; v_sig_count int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_priority_tier not in ('P0_human_review_now','P1_executive_review','P2_planned_review','P3_monitor','insufficient_data') then raise exception '허용되지 않는 priority_tier'; end if;
  -- Hard Risk 희석 금지: hard risk 존재 시 P3_monitor 배정 차단
  if jsonb_array_length(coalesce(p_hard_risk_flags, '[]'::jsonb)) > 0 and p_priority_tier = 'P3_monitor' then
    raise exception 'Hard Security/Privacy/Compliance Risk 존재 — P3_monitor 배정 금지(평균 희석 금지)';
  end if;
  -- 출처 signal 실존 검증
  v_sig_count := jsonb_array_length(coalesce(p_source_signal_ids, '[]'::jsonb));
  if v_sig_count > 30 then raise exception 'source signal 30개 제한'; end if;
  if v_sig_count > 0 then
    select count(*) into v_found from public.ai_corporate_signals s
     where s.id in (select (jsonb_array_elements_text(p_source_signal_ids))::uuid);
    if v_found <> v_sig_count then raise exception 'source signal 실존 검증 실패'; end if;
  end if;
  -- P0 = 즉시 사람 검토(자동 실행/자동 확정 아님) — 상태 강제
  v_status := case when p_priority_tier = 'P0_human_review_now' then 'pending_executive_review' else 'draft' end;
  select id into v_id from public.ai_executive_priority_candidates where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_executive_priority_candidates (priority_code, priority_type, title, summary, priority_domain, source_signal_ids, materiality_score, materiality_status, urgency_score, urgency_status, urgent_vs_important, deadline_at, hard_risk_flags, priority_score, priority_tier, mutually_exclusive_with, dependencies, expected_impact, evidence, priority_status, idempotency_key, created_by)
  values (p_code, p_type, left(p_title, 200), p_summary, p_domain, coalesce(p_source_signal_ids, '[]'::jsonb), p_materiality_score, coalesce(p_materiality_status, 'materiality_unverified'), p_urgency_score, coalesce(p_urgency_status, 'urgency_unverified'), coalesce(p_urgent_vs_important, 'insufficient_data'), p_deadline, coalesce(p_hard_risk_flags, '[]'::jsonb), p_priority_score, p_priority_tier, coalesce(p_mutually_exclusive, '[]'::jsonb), coalesce(p_dependencies, '[]'::jsonb), p_expected_impact, p_evidence, v_status, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id)
  values ('priority_candidate_created', v_id, p_code || ' (' || p_priority_tier || ') — 자동 실행 순서 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_execution', false, 'priority_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_priority_review(p_id uuid, p_status text, p_reason text, p_tier text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_hard int; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_materiality_review','pending_urgency_review','pending_executive_review','under_review','accepted_reference','deferred','monitoring','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if p_tier is not null and p_tier not in ('P0_human_review_now','P1_executive_review','P2_planned_review','P3_monitor','insufficient_data') then raise exception '허용되지 않는 tier'; end if;
  select priority_status, created_by, jsonb_array_length(hard_risk_flags) into v_cur, v_creator, v_hard
    from public.ai_executive_priority_candidates where id = p_id for update;
  if v_cur is null then raise exception 'priority candidate 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_tier = 'P3_monitor' and v_hard > 0 then raise exception 'Hard Risk 존재 — P3_monitor 강등 금지(평균 희석 금지)'; end if;
  -- self-approval 경고(차단 아님 — 보존)
  if p_status = 'accepted_reference' and v_creator is not null and v_creator = v_uid then
    v_warnings := jsonb_build_array('self_approval_warning: 생성자와 승인자가 동일');
  end if;
  update public.ai_executive_priority_candidates
     set priority_status = p_status, priority_tier = coalesce(p_tier, priority_tier),
         warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id)
  values ('priority_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || case when jsonb_array_length(v_warnings) > 0 then ' [self_approval_warning]' else '' end || ' (accepted_reference ≠ 실제 실행)', v_uid);
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('human_review_recorded', p_id, 'priority: ' || p_status, v_uid);
  return jsonb_build_object('ok', true, 'priority_status', p_status, 'warnings', v_warnings, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_priorities(p_tier text default null, p_limit int default 100)
returns setof public.ai_executive_priority_candidates language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_priority_candidates where (p_tier is null or priority_tier = p_tier)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Conflict 생성 · 검토 · 조회 — 충돌 보존.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_conflict_create(
  p_code text, p_type text, p_title text, p_domain text,
  p_side_a text, p_side_b text, p_evidence jsonb,
  p_severity text default 'severity_unverified', p_side_a_ref uuid default null, p_side_b_ref uuid default null,
  p_resolution_candidates jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_side_a is null or btrim(p_side_a) = '' or p_side_b is null or btrim(p_side_b) = '' then raise exception '양쪽 입장(side_a/side_b) 모두 필수 — 충돌 보존'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_severity not in ('critical','high','medium','low','severity_unverified','insufficient_data') then raise exception '허용되지 않는 severity'; end if;
  if jsonb_array_length(coalesce(p_resolution_candidates, '[]'::jsonb)) > 20 then raise exception 'resolution candidate 20개 제한'; end if;
  select id into v_id from public.ai_corporate_conflicts where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_corporate_conflicts (conflict_code, conflict_type, title, conflict_domain, side_a_ref_id, side_a_summary, side_b_ref_id, side_b_summary, severity, resolution_candidates, evidence, idempotency_key, created_by)
  values (p_code, p_type, left(p_title, 200), p_domain, p_side_a_ref, left(p_side_a, 1000), p_side_b_ref, left(p_side_b, 1000), coalesce(p_severity, 'severity_unverified'), coalesce(p_resolution_candidates, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('conflict_detected', v_id, p_code || ' (' || p_type || ') — 자동 해소 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_resolved', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_conflict_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','under_review','resolution_candidate_proposed','resolved_reference','accepted_tradeoff','deferred','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select conflict_status into v_cur from public.ai_corporate_conflicts where id = p_id for update;
  if v_cur is null then raise exception 'conflict 없음'; end if;
  if v_cur in ('invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_corporate_conflicts
     set conflict_status = p_status, reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('conflict_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'conflict_status', p_status, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_conflicts(p_status text default null, p_limit int default 100)
returns setof public.ai_corporate_conflicts language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_conflicts where (p_status is null or conflict_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Agenda 생성 · 검토 · 조회 — 캘린더 자동 생성 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_agenda_create(
  p_code text, p_type text, p_title text, p_evidence jsonb,
  p_window text default 'ad_hoc', p_scheduled_for date default null,
  p_items jsonb default '[]'::jsonb, p_linked_priority_ids jsonb default '[]'::jsonb,
  p_decision_required jsonb default '[]'::jsonb, p_can_wait jsonb default '[]'::jsonb,
  p_must_not_do jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if jsonb_array_length(coalesce(p_items, '[]'::jsonb)) > 30 then raise exception 'agenda item 30개 제한'; end if;
  v_cnt := jsonb_array_length(coalesce(p_linked_priority_ids, '[]'::jsonb));
  if v_cnt > 30 then raise exception 'linked priority 30개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_executive_priority_candidates c
     where c.id in (select (jsonb_array_elements_text(p_linked_priority_ids))::uuid);
    if v_found <> v_cnt then raise exception 'linked priority 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_executive_agendas where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_executive_agendas (agenda_code, agenda_type, title, agenda_window, scheduled_for, items, linked_priority_ids, decision_required_items, can_wait_items, must_not_do_items, evidence, agenda_status, idempotency_key, created_by)
  values (p_code, p_type, left(p_title, 200), coalesce(p_window, 'ad_hoc'), p_scheduled_for, coalesce(p_items, '[]'::jsonb), coalesce(p_linked_priority_ids, '[]'::jsonb), coalesce(p_decision_required, '[]'::jsonb), coalesce(p_can_wait, '[]'::jsonb), coalesce(p_must_not_do, '[]'::jsonb), p_evidence, 'proposed', p_code, v_uid)
  returning id into v_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('agenda_created', v_id, p_code || ' (' || p_type || ') — 캘린더 자동 생성 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'calendar_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_agenda_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('proposed','pending_executive_review','confirmed_reference','completed_reference','cancelled','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select agenda_status into v_cur from public.ai_executive_agendas where id = p_id for update;
  if v_cur is null then raise exception 'agenda 없음'; end if;
  if v_cur in ('cancelled','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_executive_agendas
     set agenda_status = p_status, reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, actor_id) values ('agenda_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (확정 ≠ 실행)', v_uid);
  return jsonb_build_object('ok', true, 'agenda_status', p_status, 'calendar_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_agendas_list(p_type text default null, p_limit int default 50)
returns setof public.ai_executive_agendas language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_agendas where (p_type is null or agenda_type = p_type)
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Briefing / Board Reference / Decision Package / Outcome Link / External Action
--     — Event 통합 기록(발송·확정·실행 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_briefing_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('briefing_generated','board_reference_created','decision_package_created','bottleneck_detected','attention_candidate_created','priority_outcome_linked') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'board_reference_created' then ' (법적 이사회 자료 아님)' when p_kind = 'briefing_generated' then ' (자동 발송 없음)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'report_sent', false, 'legal_board_document', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_external_action(p_action_type text, p_reason text, p_evidence jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('executive_meeting_reference','board_meeting_reference','investor_communication_reference','partner_negotiation_reference','regulatory_response_reference','legal_consultation_reference','external_audit_reference','manual_executive_action_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  insert into public.ai_corporate_intelligence_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_executive_action_reference', p_ref_id, p_action_type || ' — ' || left(p_reason, 200) || ' (진위 자동 보장 없음)', jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'authenticity_guaranteed', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_intel_audit(p_limit int default 100)
returns setof public.ai_corporate_intelligence_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_intelligence_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_corporate_signals enable row level security;
alter table public.ai_executive_priority_candidates enable row level security;
alter table public.ai_corporate_conflicts enable row level security;
alter table public.ai_executive_agendas enable row level security;
alter table public.ai_corporate_intelligence_events enable row level security;

comment on table public.ai_corporate_signals is 'AI-OPS-15 — Corporate Signal(관측 신호 — materiality/urgency 미검증 시 unverified 유지·비금전 Risk 0 평가 금지).';
comment on table public.ai_executive_priority_candidates is 'AI-OPS-15 — Executive Priority 후보(Score ≠ 자동 실행 순서·P0 = 즉시 사람 검토·Hard Risk P3 강등 금지).';
comment on table public.ai_corporate_conflicts is 'AI-OPS-15 — Corporate Conflict(양쪽 입장 보존·평균 숨김 금지·자동 해소 없음).';
comment on table public.ai_executive_agendas is 'AI-OPS-15 — Executive Agenda(캘린더 자동 생성 없음·확정 ≠ 실행).';
comment on table public.ai_corporate_intelligence_events is 'AI-OPS-15 — Corporate Intelligence Audit(event_type whitelist 18종·Briefing/Board Reference/Decision Package 통합).';
