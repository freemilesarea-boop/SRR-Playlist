-- 0523_admin_ai_strategic_advisory_center.sql
-- Phase AI-OPS-20 — Executive Strategic Intelligence, Scenario Optimization &
-- Decision Advisory Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0522 검증 완료):
--   Advisory 입력 원본: ai_execution_forecasts/ai_executive_simulations(0522),
--     ai_execution_delivery_snapshots(0521), ai_execution_commitments(0520),
--     ai_executive_priority_candidates·portfolios(0518/0519),
--     ai_strategic_scenarios(0516), ai_enterprise_policies(0512).
--   KPI 원본: subscriptions(MRR)/users 실측. 시장·CSAT 없음 → projection_unavailable.
--
-- Advisory 정직성(전부 강제):
--   * Recommendation ≠ Decision — 최종 의사결정은 항상 사람.
--   * Scenario ≠ Reality. Projection ≠ Outcome. Forecast ≠ Guarantee.
--   * Confidence ≠ Correctness. Trade-off 분석 ≠ 최적화 보장.
--   * 근거(설명 체인) 없는 추천 금지(서버 차단). Unknown 은 Unknown 유지(null→0 금지).
--   * 표본<5 sample_too_small. 근거 부족 advisory_unverified.
--   * Trigger 없음 · 삭제 RPC 없음 · 자동 전략 선택/Priority·Portfolio·Budget 변경 없음 · 원본 미변경.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Scenario Comparison — 전략 비교 기록(자동 선택 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategy_scenario_comparisons (
  id                  uuid primary key default gen_random_uuid(),
  comparison_code     text not null unique,
  title               text not null,
  scenarios           jsonb not null default '[]'::jsonb,       -- [{name, posture, delivery, risk, cost, impact, timeline, confidence}] ≤10
  comparison_axes     jsonb not null default '[]'::jsonb,
  tradeoffs           jsonb not null default '[]'::jsonb,       -- Trade-off 체인 보존
  decision_matrix     jsonb not null default '[]'::jsonb,
  selected_scenario_reference text,                             -- 사람 선택 Reference 만(자동 선택 없음)
  comparison_status   text not null default 'advisory_unverified' check (comparison_status in ('compared_reference','sample_too_small','advisory_unverified','superseded_reference','invalidated','insufficient_data')),
  review_status       text not null default 'draft' check (review_status in ('draft','pending_executive_review','reviewed_reference','human_selected_reference','rejected','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  unknown_factors     jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Scenario ≠ Reality","비교 결과 ≠ 자동 선택","Trade-off 분석 ≠ 최적화 보장"]'::jsonb,
  source_version      text not null default 'advisory_v1(0523)',
  input_hash          text not null,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_scenario_cmp on public.ai_strategy_scenario_comparisons (comparison_status, review_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Executive Advisory — 설명 체인 필수(근거 없는 추천 서버 차단).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_advisories (
  id                  uuid primary key default gen_random_uuid(),
  advisory_code       text not null unique,
  advisory_type       text not null check (advisory_type in ('consider_scenario','review_scenario','delay_scenario','gather_more_evidence','reduce_dependency','validate_assumptions','rebalance_portfolio_candidate','review_tradeoff','review_alignment_gap','update_briefing','manual')),
  title               text not null,
  recommendation_summary text not null,
  reasoning_chain     jsonb not null default '[]'::jsonb,       -- [step1, step2, ...] — 비어 있으면 생성 불가
  evidence            jsonb not null default '[]'::jsonb,
  advisory_confidence numeric check (advisory_confidence is null or (advisory_confidence >= 0 and advisory_confidence <= 100)),
  evidence_coverage   numeric check (evidence_coverage is null or (evidence_coverage >= 0 and evidence_coverage <= 100)),
  alternatives        jsonb not null default '[]'::jsonb,
  assumptions         jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  input_freshness     text,
  target_reference_type text,
  target_reference_id uuid,
  advisory_status     text not null default 'pending_executive_review' check (advisory_status in ('pending_executive_review','under_review','accepted_reference','deferred_reference','rejected','superseded_reference','advisory_unverified','invalidated','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Recommendation ≠ Decision(최종 결정은 사람)","Confidence ≠ Correctness","accepted_reference ≠ 실행"]'::jsonb,
  source_version      text not null default 'advisory_v1(0523)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_exec_advisory on public.ai_executive_advisories (advisory_type, advisory_status, created_at desc);

-- Briefing/Alignment/Trade-off/Matrix/Cockpit 검토·외부 참조·Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_advisory_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('scenario_comparison_created','scenario_comparison_reviewed','human_scenario_selected_reference','advisory_created','advisory_reviewed','tradeoff_analyzed','decision_matrix_built','portfolio_advisory_calculated','strategic_alignment_evaluated','decision_impact_projected','executive_briefing_generated','cockpit_reviewed','external_advisory_reference','advisory_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_advisory_evt on public.ai_advisory_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — 실측 입력 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_advisory_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'comparisons_total', (select count(*) from public.ai_strategy_scenario_comparisons),
    'comparisons_by_status', (select coalesce(jsonb_object_agg(review_status, n), '{}'::jsonb) from (select review_status, count(*) n from public.ai_strategy_scenario_comparisons group by review_status) x),
    'human_selected', (select count(*) from public.ai_strategy_scenario_comparisons where review_status = 'human_selected_reference'),
    'advisories_total', (select count(*) from public.ai_executive_advisories),
    'advisories_by_type', (select coalesce(jsonb_object_agg(advisory_type, n), '{}'::jsonb) from (select advisory_type, count(*) n from public.ai_executive_advisories group by advisory_type) x),
    'advisories_pending', (select count(*) from public.ai_executive_advisories where advisory_status = 'pending_executive_review'),
    -- Advisory 입력 실측(참조만):
    'input_actuals', jsonb_build_object(
      'forecasts', (select count(*) from public.ai_execution_forecasts),
      'simulations', (select count(*) from public.ai_executive_simulations),
      'priorities', (select count(*) from public.ai_executive_priority_candidates),
      'portfolios', (select count(*) from public.ai_executive_priority_portfolios),
      'strategic_scenarios', (select count(*) from public.ai_strategic_scenarios),
      'enterprise_policies', (select count(*) from public.ai_enterprise_policies),
      'mrr_actual', (select coalesce(sum(current_amount), 0) from public.subscriptions where status in ('active','cancel_scheduled')),
      'market_data', 'projection_unavailable',
      'customer_satisfaction', 'projection_unavailable'
    ),
    'recommendation_is_not_decision', true, 'no_auto_strategy_selection', true, 'no_auto_portfolio_change', true, 'confidence_is_not_correctness', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Scenario Comparison 생성·검토 — 자동 선택 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_scenario_comparison_create(
  p_code text, p_title text, p_scenarios jsonb, p_evidence jsonb,
  p_axes jsonb default '[]'::jsonb, p_tradeoffs jsonb default '[]'::jsonb,
  p_matrix jsonb default '[]'::jsonb, p_unknown jsonb default '[]'::jsonb,
  p_assumptions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_scenarios is null or jsonb_typeof(p_scenarios) <> 'array' or jsonb_array_length(p_scenarios) < 2 then raise exception 'Scenario 2개 이상 필수(비교)'; end if;
  if jsonb_array_length(p_scenarios) > 10 then raise exception 'Scenario 10개 제한'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if pg_column_size(p_scenarios) + pg_column_size(coalesce(p_matrix, '[]'::jsonb)) > 32768 then raise exception 'payload 32KB 제한'; end if;
  v_status := case when jsonb_array_length(p_scenarios) < 2 then 'insufficient_data' else 'compared_reference' end;
  select id into v_id from public.ai_strategy_scenario_comparisons where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategy_scenario_comparisons (comparison_code, title, scenarios, comparison_axes, tradeoffs, decision_matrix, comparison_status, unknown_factors, assumptions, evidence, input_hash, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_scenarios, coalesce(p_axes, '[]'::jsonb), coalesce(p_tradeoffs, '[]'::jsonb), coalesce(p_matrix, '[]'::jsonb), v_status, coalesce(p_unknown, '[]'::jsonb), coalesce(p_assumptions, '[]'::jsonb), p_evidence, md5(p_scenarios::text), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_advisory_events (event_type, ref_id, detail, actor_id) values ('scenario_comparison_created', v_id, p_code || ' (' || jsonb_array_length(p_scenarios) || ' scenarios) — 자동 선택 없음', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'auto_selected', false, 'production_applied', false);
end $$;

create or replace function public.admin_scenario_comparison_review(p_id uuid, p_status text, p_reason text, p_selected text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_executive_review','reviewed_reference','human_selected_reference','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if p_status = 'human_selected_reference' and (p_selected is null or btrim(p_selected) = '') then raise exception '사람 선택 시 선택 Scenario 명시 필수'; end if;
  select review_status, created_by into v_cur, v_creator from public.ai_strategy_scenario_comparisons where id = p_id for update;
  if v_cur is null then raise exception 'comparison 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_status = 'human_selected_reference' and v_creator is not null and v_creator = v_uid then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 선택자가 동일');
  end if;
  update public.ai_strategy_scenario_comparisons
     set review_status = p_status, selected_scenario_reference = coalesce(p_selected, selected_scenario_reference),
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_advisory_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'human_selected_reference' then 'human_scenario_selected_reference' else 'scenario_comparison_reviewed' end,
          p_id, v_cur || ' → ' || p_status || coalesce(' [' || p_selected || ']', '') || ' — ' || left(p_reason, 200) || ' (선택 Reference ≠ 실행)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'warnings', v_warnings, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_scenario_comparisons(p_status text default null, p_limit int default 50)
returns setof public.ai_strategy_scenario_comparisons language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategy_scenario_comparisons where (p_status is null or review_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Advisory 생성·검토 — 설명 체인 없는 추천 서버 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_advisory_create(
  p_code text, p_type text, p_title text, p_summary text, p_reasoning jsonb, p_evidence jsonb,
  p_confidence numeric default null, p_coverage numeric default null,
  p_alternatives jsonb default '[]'::jsonb, p_assumptions jsonb default '[]'::jsonb,
  p_unknown jsonb default '[]'::jsonb, p_freshness text default null,
  p_target_type text default null, p_target_id uuid default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' or p_summary is null or btrim(p_summary) = '' then raise exception 'title/summary 필수'; end if;
  -- Explainable Strategy: 근거(설명 체인) 없는 추천 금지
  if p_reasoning is null or jsonb_typeof(p_reasoning) <> 'array' or jsonb_array_length(p_reasoning) < 2 then raise exception '설명 체인(reasoning_chain) 2단계 이상 필수 — 근거 없는 추천 금지'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if jsonb_array_length(p_reasoning) > 20 or jsonb_array_length(coalesce(p_alternatives, '[]'::jsonb)) > 10 then raise exception 'reasoning 20/alternatives 10 제한'; end if;
  if pg_column_size(p_reasoning) + pg_column_size(p_evidence) > 32768 then raise exception 'payload 32KB 제한'; end if;
  select id into v_id from public.ai_executive_advisories where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_executive_advisories (advisory_code, advisory_type, title, recommendation_summary, reasoning_chain, evidence, advisory_confidence, evidence_coverage, alternatives, assumptions, unknown_factors, input_freshness, target_reference_type, target_reference_id, idempotency_key, created_by)
  values (p_code, p_type, left(p_title, 200), left(p_summary, 1000), p_reasoning, p_evidence, p_confidence, p_coverage, coalesce(p_alternatives, '[]'::jsonb), coalesce(p_assumptions, '[]'::jsonb), coalesce(p_unknown, '[]'::jsonb), p_freshness, p_target_type, p_target_id, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_advisory_events (event_type, ref_id, detail, actor_id) values ('advisory_created', v_id, p_code || ' (' || p_type || ') — Recommendation ≠ Decision', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'decision_made', false, 'human_approval_required', true, 'production_applied', false);
end $$;

create or replace function public.admin_executive_advisory_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('under_review','accepted_reference','deferred_reference','rejected','superseded_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select advisory_status, created_by into v_cur, v_creator from public.ai_executive_advisories where id = p_id for update;
  if v_cur is null then raise exception 'advisory 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_status = 'accepted_reference' and v_creator is not null and v_creator = v_uid then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 승인자가 동일');
  end if;
  update public.ai_executive_advisories
     set advisory_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_advisory_events (event_type, ref_id, detail, actor_id) values ('advisory_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (accepted_reference ≠ 실행/결정)', v_uid);
  return jsonb_build_object('ok', true, 'advisory_status', p_status, 'warnings', v_warnings, 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_executive_advisories(p_type text default null, p_limit int default 100)
returns setof public.ai_executive_advisories language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_executive_advisories where (p_type is null or advisory_type = p_type)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Governance Event / Audit — Briefing/Alignment/Matrix/Cockpit 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_advisory_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('tradeoff_analyzed','decision_matrix_built','portfolio_advisory_calculated','strategic_alignment_evaluated','decision_impact_projected','executive_briefing_generated','cockpit_reviewed','external_advisory_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_advisory_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'decision_impact_projected' then ' (Projection ≠ 실제 결과)' when p_kind = 'executive_briefing_generated' then ' (자동 발송 없음)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'decision_made', false, 'production_applied', false);
end $$;

create or replace function public.admin_advisory_audit(p_limit int default 100)
returns setof public.ai_advisory_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_advisory_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_strategy_scenario_comparisons enable row level security;
alter table public.ai_executive_advisories enable row level security;
alter table public.ai_advisory_events enable row level security;

comment on table public.ai_strategy_scenario_comparisons is 'AI-OPS-20 — Scenario Comparison(자동 선택 없음·사람 선택 Reference 만·Scenario ≠ Reality).';
comment on table public.ai_executive_advisories is 'AI-OPS-20 — Executive Advisory(설명 체인 2단계 이상 필수·Recommendation ≠ Decision·Confidence ≠ Correctness).';
comment on table public.ai_advisory_events is 'AI-OPS-20 — Advisory Audit(event_type whitelist 14종·Briefing/Alignment/Matrix/Cockpit 통합).';
