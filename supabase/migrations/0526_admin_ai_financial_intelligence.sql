-- 0526_admin_ai_financial_intelligence.sql
-- Phase AI-OPS-23 — Enterprise Financial Intelligence, Capital Performance &
-- Financial Decision Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Cash Inflow 원본: payment_orders(status='paid', amount — 0015 검증).
--   Cash Outflow(부분) 원본: artist_settlements(status='paid', final_payout_amount — 0060 검증).
--   수수료 실측: artist_settlements.company_fee_amount(0060).
--   비용 원본: ai_cost_snapshots(0508 — provider별 actual/estimated 구분).
--   MRR 원본: subscriptions.current_amount(0474/0511 검증).
--   회계 원장/EBITDA/Cash Position/투자·재무 현금흐름 원본 없음(실측)
--     → financial_unavailable 유지(임의 생성 금지).
--
-- Financial 정직성(전부 강제):
--   * 회계 자동 수정/예산 자동 변경/지출 자동 승인/투자 자동 결정 없음 — 사람 RPC 만.
--   * Revenue ≠ Profit. Cash Flow ≠ Liquidity Guarantee. Forecast ≠ Actual.
--   * ROI ≠ Investment Success. Margin ≠ Business Health. Risk ≠ Failure.
--   * Recommendation ≠ Financial Decision. Unknown 유지(null→0 금지).
--   * 표본 부족 sample_too_small. 근거 부족 financial_unverified.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(payment/settlement/cost) 미변경 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Financial Record — 사람 기록만(예산/투자/자본 배분/비용 항목 참조).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_financial_records (
  id                  uuid primary key default gen_random_uuid(),
  record_code         text not null unique,
  record_kind         text not null check (record_kind in ('budget_reference','investment_reference','capital_allocation_reference','cost_entry','licensing_cost_entry','revenue_note','cash_position_reference','external_reference')),
  title               text not null,
  description         text,
  amount              numeric,                                     -- null 유지(0 변환 금지)
  currency            text not null default 'KRW' check (currency in ('KRW','USD')),
  period_kind         text not null default 'monthly' check (period_kind in ('daily','weekly','monthly','quarterly','yearly','adhoc')),
  period_start        date,
  period_end          date,
  record_status       text not null default 'draft' check (record_status in ('draft','active_reference','under_review','superseded_reference','invalidated','financial_unavailable','financial_unverified','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["회계 장부 아님(참조 기록)","Recommendation ≠ Financial Decision"]'::jsonb,
  source_version      text not null default 'financial_v1(0526)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_fin_rec on public.ai_financial_records (record_kind, record_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Financial Snapshot — append-only 측정(Budget/Forecast ≠ Actual 분리).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_financial_snapshots (
  id                  uuid primary key default gen_random_uuid(),
  metric_source       text not null check (metric_source in ('mrr','revenue_paid_orders','cash_inflow','cash_outflow_settlements','company_fee','provider_costs_actual','provider_costs_estimated','net_cash_flow_partial','manual_entry','unsupported')),
  period_kind         text not null check (period_kind in ('daily','weekly','monthly','quarterly','yearly','adhoc')),
  period_start        date,
  period_end          date,
  actual_value        numeric,                                     -- null 유지(0 변환 금지)
  budget_value        numeric,
  forecast_value      numeric,                                     -- Forecast ≠ Actual
  source_kind         text not null check (source_kind in ('measured','human_entered','forecast_reference')),
  sample_size         int,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Forecast ≠ Actual","Cash Flow ≠ Liquidity Guarantee"]'::jsonb,
  source_version      text not null default 'financial_v1(0526)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_fin_snap on public.ai_financial_snapshots (metric_source, period_kind, created_at desc);

-- CashFlow/Capital/Cost/Variance/ROI/Risk/Trend/Briefing/권고/Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_financial_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('financial_record_created','financial_record_reviewed','financial_snapshot_recorded','financial_measured','cash_flow_analyzed','capital_analyzed','cost_analyzed','margin_analyzed','financial_variance_analyzed','roi_assessed','financial_risk_assessed','financial_trend_analyzed','financial_briefing_recorded','financial_recommendation_created','external_financial_reference','financial_record_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_fin_evt on public.ai_financial_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 요약 — 재무 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_financial_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v jsonb; v_mrr numeric; v_inflow numeric; v_paid bigint;
  v_outflow numeric; v_paid_settle bigint; v_fee numeric;
  v_cost_actual numeric; v_cost_actual_n bigint; v_cost_est numeric; v_cost_est_n bigint;
begin
  perform public._admin_growth_guard();
  select coalesce(sum(current_amount), 0) into v_mrr from public.subscriptions where status in ('active','cancel_scheduled');
  select coalesce(sum(amount), 0), count(*) into v_inflow, v_paid from public.payment_orders where status = 'paid' and created_at > now() - interval '30 days';
  select coalesce(sum(final_payout_amount), 0), count(*) into v_outflow, v_paid_settle from public.artist_settlements where status = 'paid' and paid_at > now() - interval '30 days';
  select coalesce(sum(company_fee_amount), 0) into v_fee from public.artist_settlements where settlement_month >= (now() - interval '90 days')::date;
  select sum(actual_cost), count(actual_cost) into v_cost_actual, v_cost_actual_n from public.ai_cost_snapshots where actual_cost is not null and period_end > now() - interval '90 days';
  select sum(estimated_cost), count(estimated_cost) into v_cost_est, v_cost_est_n from public.ai_cost_snapshots where estimated_cost is not null and period_end > now() - interval '90 days';
  select jsonb_build_object(
    'financial_actuals', jsonb_build_object(
      'mrr', v_mrr,
      'revenue_paid_orders_30d', v_inflow,                        -- Revenue ≠ Profit
      'paid_orders_30d', v_paid,
      'cash_inflow_30d', v_inflow,
      'cash_outflow_settlements_30d', v_outflow,                  -- 부분 Outflow(정산 지급만 — 회계 원장 아님)
      'settlements_paid_30d', v_paid_settle,
      'net_cash_flow_partial_30d', v_inflow - v_outflow,          -- 부분 계산(비용 원장 없음 — Liquidity 보장 아님)
      'company_fee_90d', v_fee,
      'provider_costs_actual_90d', case when v_cost_actual_n > 0 then round(v_cost_actual, 2) else null end,   -- 표본 0 → null 유지
      'provider_costs_actual_samples', v_cost_actual_n,
      'provider_costs_estimated_90d', case when v_cost_est_n > 0 then round(v_cost_est, 2) else null end,
      'provider_costs_estimated_samples', v_cost_est_n
    ),
    'cost_by_provider_90d', (select coalesce(jsonb_object_agg(provider, s), '{}'::jsonb) from (
      select provider, jsonb_build_object('actual', sum(actual_cost), 'estimated', sum(estimated_cost), 'rows', count(*)) s
      from public.ai_cost_snapshots where period_end > now() - interval '90 days' group by provider) x),
    'financial_unavailable', jsonb_build_array('ebitda','cash_position','investment_cash_flow','financing_cash_flow','accounting_ledger','licensing_cost_source','external_market_benchmark'),   -- 원본 없음(실측)
    'records_total', (select count(*) from public.ai_financial_records),
    'records_by_kind', (select coalesce(jsonb_object_agg(record_kind, n), '{}'::jsonb) from (select record_kind, count(*) n from public.ai_financial_records group by record_kind) x),
    'snapshots_total', (select count(*) from public.ai_financial_snapshots),
    'no_auto_accounting_change', true, 'no_auto_budget_change', true, 'no_auto_spend_approval', true, 'no_auto_investment_decision', true,
    'revenue_is_not_profit', true, 'cash_flow_is_not_liquidity_guarantee', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Financial Record 생성·검토 — 전부 사람 RPC(자동 승인 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_financial_record_create(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_description text default null, p_amount numeric default null, p_currency text default 'KRW',
  p_period_kind text default 'monthly', p_period_start date default null, p_period_end date default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 입력 — 자동 회계 기록 없음)'; end if;
  if p_kind not in ('budget_reference','investment_reference','capital_allocation_reference','cost_entry','licensing_cost_entry','revenue_note','cash_position_reference','external_reference') then raise exception '허용되지 않는 record_kind'; end if;
  if p_currency not in ('KRW','USD') then raise exception '허용되지 않는 currency'; end if;
  if p_period_kind not in ('daily','weekly','monthly','quarterly','yearly','adhoc') then raise exception '허용되지 않는 period_kind'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(financial_unverified 방지)'; end if;
  select id into v_id from public.ai_financial_records where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_financial_records (record_code, record_kind, title, description, amount, currency, period_kind, period_start, period_end, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_title, 200), p_description, p_amount, p_currency, p_period_kind, p_period_start, p_period_end, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_financial_events (event_type, ref_id, detail, actor_id) values ('financial_record_created', v_id, p_code || ' (' || p_kind || ') — 사람 기록(회계 장부 아님)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'accounting_modified', false, 'budget_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_financial_record_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active_reference','under_review','superseded_reference','invalidated','financial_unverified','insufficient_data') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(지출/투자 자동 승인 없음)'; end if;
  select record_status, created_by into v_cur, v_creator from public.ai_financial_records where id = p_id for update;
  if v_cur is null then raise exception 'record 없음'; end if;
  if v_cur in ('superseded_reference','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'active_reference' then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 판정자가 동일');
  end if;
  update public.ai_financial_records
     set record_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  v_evt := case when p_status = 'invalidated' then 'financial_record_invalidated' else 'financial_record_reviewed' end;
  insert into public.ai_financial_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (사람 검토 기록 — 승인 아님)', v_uid);
  return jsonb_build_object('ok', true, 'record_status', p_status, 'warnings', v_warnings, 'spend_approved', false, 'production_applied', false);
end $$;

create or replace function public.admin_financial_records(p_kind text default null, p_limit int default 100)
returns setof public.ai_financial_records language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_financial_records where (p_kind is null or record_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Snapshot 기록·실측 캡처 — append-only(수정/삭제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_financial_snapshot_record(
  p_key text, p_source text, p_period_kind text, p_source_kind text, p_evidence jsonb,
  p_actual numeric default null, p_budget numeric default null, p_forecast numeric default null,
  p_period_start date default null, p_period_end date default null, p_sample_size int default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_source not in ('mrr','revenue_paid_orders','cash_inflow','cash_outflow_settlements','company_fee','provider_costs_actual','provider_costs_estimated','net_cash_flow_partial','manual_entry','unsupported') then raise exception '허용되지 않는 metric_source'; end if;
  if p_period_kind not in ('daily','weekly','monthly','quarterly','yearly','adhoc') then raise exception '허용되지 않는 period_kind'; end if;
  if p_source_kind not in ('human_entered','forecast_reference') then raise exception 'measured 는 admin_financial_snapshot_capture 로만 기록'; end if;
  if p_actual is null and p_budget is null and p_forecast is null then raise exception 'actual/budget/forecast 중 1개 이상 필수(null→0 변환 금지)'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  select id into v_id from public.ai_financial_snapshots where idempotency_key = p_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_financial_snapshots (metric_source, period_kind, period_start, period_end, actual_value, budget_value, forecast_value, source_kind, sample_size, evidence, idempotency_key, created_by)
  values (p_source, p_period_kind, p_period_start, p_period_end, p_actual, p_budget, p_forecast, p_source_kind, p_sample_size, p_evidence, p_key, v_uid)
  returning id into v_id;
  insert into public.ai_financial_events (event_type, ref_id, detail, actor_id) values ('financial_snapshot_recorded', v_id, p_source || '/' || p_source_kind || ' — Forecast ≠ Actual', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'forecast_is_not_actual', true, 'production_applied', false);
end $$;

create or replace function public.admin_financial_snapshot_capture(p_key text, p_source text, p_period_kind text default 'monthly')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid; v_id uuid; v_days int; v_actual numeric; v_sample bigint := 0; v_note text;
  v_in numeric; v_out numeric;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_period_kind not in ('daily','weekly','monthly','quarterly','yearly','adhoc') then raise exception '허용되지 않는 period_kind'; end if;
  if p_source in ('manual_entry','unsupported') then raise exception 'financial_unavailable — 실측 캡처 미지원(%)', p_source; end if;
  if p_source not in ('mrr','revenue_paid_orders','cash_inflow','cash_outflow_settlements','company_fee','provider_costs_actual','provider_costs_estimated','net_cash_flow_partial') then raise exception '허용되지 않는 metric_source'; end if;
  select id into v_id from public.ai_financial_snapshots where idempotency_key = p_key;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  v_days := case p_period_kind when 'daily' then 1 when 'weekly' then 7 when 'monthly' then 30 when 'quarterly' then 90 when 'yearly' then 365 else 30 end;
  if p_source = 'mrr' then
    select coalesce(sum(current_amount), 0), count(*) into v_actual, v_sample from public.subscriptions where status in ('active','cancel_scheduled');
    v_note := 'subscriptions.current_amount 합(Revenue ≠ Profit)';
  elsif p_source in ('revenue_paid_orders','cash_inflow') then
    select coalesce(sum(amount), 0), count(*) into v_actual, v_sample from public.payment_orders where status = 'paid' and created_at > now() - (v_days || ' days')::interval;
    v_note := 'payment_orders paid 합(' || v_days || 'd — Revenue ≠ Profit)';
  elsif p_source = 'cash_outflow_settlements' then
    select coalesce(sum(final_payout_amount), 0), count(*) into v_actual, v_sample from public.artist_settlements where status = 'paid' and paid_at > now() - (v_days || ' days')::interval;
    v_note := '정산 지급 합(' || v_days || 'd — 부분 Outflow, 회계 원장 아님)';
  elsif p_source = 'company_fee' then
    select coalesce(sum(company_fee_amount), 0), count(*) into v_actual, v_sample from public.artist_settlements where settlement_month >= (now() - (v_days || ' days')::interval)::date;
    v_note := 'company_fee_amount 합(' || v_days || 'd)';
  elsif p_source = 'provider_costs_actual' then
    select sum(actual_cost), count(actual_cost) into v_actual, v_sample from public.ai_cost_snapshots where actual_cost is not null and period_end > now() - (v_days || ' days')::interval;
    if v_sample = 0 then v_actual := null; end if;                -- 표본 0 → null 유지(0 아님)
    v_note := 'ai_cost_snapshots actual 합(' || v_days || 'd)';
  elsif p_source = 'provider_costs_estimated' then
    select sum(estimated_cost), count(estimated_cost) into v_actual, v_sample from public.ai_cost_snapshots where estimated_cost is not null and period_end > now() - (v_days || ' days')::interval;
    if v_sample = 0 then v_actual := null; end if;
    v_note := 'ai_cost_snapshots estimated 합(' || v_days || 'd — 추정치, Actual 아님)';
  elsif p_source = 'net_cash_flow_partial' then
    select coalesce(sum(amount), 0) into v_in from public.payment_orders where status = 'paid' and created_at > now() - (v_days || ' days')::interval;
    select coalesce(sum(final_payout_amount), 0) into v_out from public.artist_settlements where status = 'paid' and paid_at > now() - (v_days || ' days')::interval;
    v_actual := v_in - v_out; v_sample := 2;
    v_note := 'Inflow-정산 Outflow 부분 계산(' || v_days || 'd — 비용 원장 없음, Liquidity 보장 아님)';
  end if;
  insert into public.ai_financial_snapshots (metric_source, period_kind, period_start, period_end, actual_value, source_kind, sample_size, evidence, unknown_factors, idempotency_key, created_by)
  values (p_source, p_period_kind, (now() - (v_days || ' days')::interval)::date, now()::date, v_actual,
          'measured', v_sample::int, jsonb_build_array(jsonb_build_object('source', p_source, 'note', v_note)),
          case when v_actual is null then jsonb_build_array('표본 0 — insufficient_data(null 유지)') else '[]'::jsonb end,
          p_key, v_uid)
  returning id into v_id;
  insert into public.ai_financial_events (event_type, ref_id, detail, actor_id) values ('financial_measured', v_id, p_source || ' 실측(' || p_period_kind || ') — Revenue ≠ Profit', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'actual_value', v_actual, 'sample_size', v_sample, 'revenue_is_not_profit', true, 'production_applied', false);
end $$;

create or replace function public.admin_financial_snapshots(p_source text default null, p_limit int default 100)
returns setof public.ai_financial_snapshots language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_financial_snapshots where (p_source is null or metric_source = p_source)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 일별 실측 시계열 — Financial Trend 분석용 원자료(분류는 클라이언트 순수 로직).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_financial_timeline(p_days int default 30)
returns table (day date, cash_inflow numeric, paid_orders bigint, failed_orders bigint, cash_outflow_settlements numeric, settlements_paid bigint)
language plpgsql security definer set search_path = public as $$
declare v_days int;
begin
  perform public._admin_growth_guard();
  v_days := least(greatest(coalesce(p_days, 30), 7), 120);
  return query
  with days as (select generate_series((now() - (v_days - 1 || ' days')::interval)::date, now()::date, '1 day')::date as d),
  orders as (
    select created_at::date d,
           coalesce(sum(amount) filter (where status = 'paid'), 0)::numeric inflow,
           count(*) filter (where status = 'paid') paid,
           count(*) filter (where status = 'failed') failed
    from public.payment_orders where created_at > now() - (v_days || ' days')::interval group by 1
  ),
  settles as (
    select paid_at::date d, coalesce(sum(final_payout_amount), 0)::numeric outflow, count(*) n
    from public.artist_settlements where status = 'paid' and paid_at > now() - (v_days || ' days')::interval group by 1
  )
  select days.d, coalesce(o.inflow, 0), coalesce(o.paid, 0), coalesce(o.failed, 0), coalesce(s.outflow, 0), coalesce(s.n, 0)
  from days left join orders o on o.d = days.d left join settles s on s.d = days.d
  order by days.d asc;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Governance Event / Audit — CashFlow/Capital/Cost/Margin/Variance/ROI/
--    Risk/Trend/Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_financial_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('cash_flow_analyzed','capital_analyzed','cost_analyzed','margin_analyzed','financial_variance_analyzed','roi_assessed','financial_risk_assessed','financial_trend_analyzed','financial_briefing_recorded','financial_recommendation_created','external_financial_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_financial_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'roi_assessed' then ' (ROI ≠ Investment Success)'
      when p_kind = 'financial_risk_assessed' then ' (Risk ≠ Failure)'
      when p_kind = 'financial_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'cash_flow_analyzed' then ' (Cash Flow ≠ Liquidity Guarantee)'
      when p_kind = 'margin_analyzed' then ' (Margin ≠ Business Health)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'budget_changed', false, 'spend_approved', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_financial_audit(p_limit int default 100)
returns setof public.ai_financial_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_financial_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_financial_records enable row level security;
alter table public.ai_financial_snapshots enable row level security;
alter table public.ai_financial_events enable row level security;

comment on table public.ai_financial_records is 'AI-OPS-23 — Financial Record(사람 기록만 — 회계 장부 아님·자동 예산 변경/지출 승인 없음).';
comment on table public.ai_financial_snapshots is 'AI-OPS-23 — Financial Snapshot(append-only·Budget/Forecast ≠ Actual·null 유지).';
comment on table public.ai_financial_events is 'AI-OPS-23 — Financial Audit(event_type whitelist 16종·CashFlow/Capital/Cost/Variance/ROI/Risk/Briefing 통합).';
