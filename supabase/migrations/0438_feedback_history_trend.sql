-- 0438 — Phase ALGO-6C: Feedback History & Longitudinal Trend Engine (Shadow Observability)
--
-- 목적:
--   ALGO-6B Decision Feedback 를 Run 단위로 장기 누적하여 Accuracy/Risk/Drift/Confidence/
--   Promotion 변화를 장기간 추적한다. Feedback History · Longitudinal Trend · Rolling Statistics ·
--   Stability Timeline · Promotion History · Model Evolution · Regression Detection · Forecast.
--   전부 Shadow — 운영 시스템에 어떠한 영향도 없다.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming/Decision/Runtime 무변경.
--   • Production Apply 금지. additive only. 자동 승인/자동 Canary 금지. Regression 은 기록만(차단 없음).
--
-- 자족적: 장기 시계열은 playback_events_v2 의 as-of 시점을 슬라이딩하여 스냅샷을 생성한다.
--   각 스냅샷 = 예상(before window) vs 실제(after window) 비교. (ALGO-6A/6B 테이블 유무와 무관)

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._lt_status(p_accuracy numeric, p_risk numeric, p_drift numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_accuracy is null then 'insufficient_data'
    when coalesce(p_drift,1) >= 0.30 or coalesce(p_risk,1) >= 0.40 or coalesce(p_accuracy,0) < 0.55 then 'critical'
    when coalesce(p_drift,1) >= 0.18 or coalesce(p_risk,1) >= 0.28 or coalesce(p_accuracy,0) < 0.70 then 'warning'
    else 'stable' end;
$$;

create or replace function public._lt_trend_dir(p_slope numeric, p_higher_better boolean)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_slope is null or abs(p_slope) < 0.0005 then 'stable'
    when (p_slope > 0) = p_higher_better then 'improving'
    else 'degrading' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.decision_feedback_history (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid not null, feedback_timestamp timestamptz not null,
  run_version integer, model_version text,
  decision_accuracy numeric, decision_error numeric, confidence_error numeric, risk_error numeric,
  reward_gap numeric, outcome_gap numeric, drift numeric, confidence numeric, risk numeric,
  promotion_score numeric, promotion_state text, item_count integer,
  created_at timestamptz not null default now()
);
create index if not exists dfh_batch_idx on public.decision_feedback_history(snapshot_batch, feedback_timestamp);

create table if not exists public.decision_trend_history (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, run_at timestamptz not null default now(),
  trend_name text not null, slope_per_day numeric, direction text,
  start_value numeric, end_value numeric, delta numeric, points integer
);
create index if not exists dth_batch_idx on public.decision_trend_history(snapshot_batch);

create table if not exists public.decision_window_statistics (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, run_at timestamptz not null default now(),
  window_label text not null, window_days integer, metric text not null,
  rolling_mean numeric, rolling_std numeric, rolling_variance numeric, rolling_percentile numeric,
  rolling_best numeric, rolling_worst numeric, sample_n integer
);
create index if not exists dws_batch_idx on public.decision_window_statistics(snapshot_batch, window_days);

create table if not exists public.decision_stability_timeline (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, snapshot_at timestamptz not null,
  status text, transition text, accuracy numeric, drift numeric, risk numeric,
  created_at timestamptz not null default now()
);
create index if not exists dst_batch_idx on public.decision_stability_timeline(snapshot_batch, snapshot_at);

create table if not exists public.decision_model_evolution (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, run_at timestamptz not null default now(),
  model_version text not null, epoch_from timestamptz, epoch_to timestamptz, snapshots integer,
  accuracy numeric, risk numeric, reward numeric, confidence numeric, drift numeric,
  accuracy_delta numeric, risk_delta numeric
);
create index if not exists dme_batch_idx on public.decision_model_evolution(snapshot_batch);

create table if not exists public.decision_forecasts (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, run_at timestamptz not null default now(),
  horizon_days integer not null, metric text not null,
  last_value numeric, forecast_value numeric, trend text, method text default 'linear', based_on_points integer
);
create index if not exists dfc_batch_idx on public.decision_forecasts(snapshot_batch, horizon_days);

create table if not exists public.decision_regressions (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, detected_at timestamptz not null default now(),
  metric text not null, regression_type text not null, severity text default 'warning',
  from_value numeric, to_value numeric, delta numeric, note text
);
create index if not exists drg_batch_idx on public.decision_regressions(snapshot_batch);

create table if not exists public.promotion_history (
  id uuid primary key default gen_random_uuid(),
  snapshot_batch uuid, snapshot_at timestamptz not null,
  promotion_score numeric, promotion_state text,
  candidate_flag boolean default false, approval_flag boolean default false, shadow_flag boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists ph_batch_idx on public.promotion_history(snapshot_batch, snapshot_at);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['decision_feedback_history','decision_trend_history','decision_window_statistics',
    'decision_stability_timeline','decision_model_evolution','decision_forecasts','decision_regressions','promotion_history'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Feedback History Engine — admin_generate_feedback_history
--    as-of 시점을 슬라이딩하여 스냅샷 시계열 생성 (+ promotion_history + stability_timeline)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_feedback_history(
  p_points integer default 10, p_step_days integer default 3, p_window integer default 21, p_lag integer default 5)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_batch uuid := gen_random_uuid(); v_max timestamptz; i integer; v_asof timestamptz; v_n integer; v_total integer := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select max(created_at) into v_max from public.playback_events_v2;
  if v_max is null then raise exception 'no playback data'; end if;

  for i in 0 .. greatest(coalesce(p_points,10),1)-1 loop
    v_asof := v_max - make_interval(days => i*greatest(coalesce(p_step_days,3),1));
    insert into public.decision_feedback_history(snapshot_batch, feedback_timestamp, run_version, model_version,
      decision_accuracy, decision_error, confidence_error, risk_error, reward_gap, outcome_gap, drift, confidence, risk,
      promotion_score, promotion_state, item_count)
    select v_batch, v_asof, (greatest(coalesce(p_points,10),1)-1-i),
      'v'||(1 + floor((greatest(coalesce(p_points,10),1)-1-i)::numeric * 3 / greatest(coalesce(p_points,10),1))::int),
      round(m.accuracy::numeric,4), round(m.score_error::numeric,4), round(m.confidence_error::numeric,4), round(m.risk_error::numeric,4),
      round(m.reward_gap::numeric,4), round(m.outcome_gap::numeric,4), round(m.drift::numeric,4), round(m.confidence::numeric,4), round(m.risk::numeric,4),
      round((m.accuracy * (1-m.risk) * (1-least(1,m.drift)))::numeric,4),
      public._lt_status(round(m.accuracy::numeric,4), round(m.risk::numeric,4), round(m.drift::numeric,4)),
      m.n
    from (
      with bef as (
        select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
          avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
          avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
        from public.playback_events_v2
        where created_at >= v_asof - make_interval(days => greatest(coalesce(p_window,21),1))
          and created_at < v_asof - make_interval(days => greatest(coalesce(p_lag,5),1))
        group by track_id),
      aft as (
        select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
          avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
          avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
        from public.playback_events_v2
        where created_at >= v_asof - make_interval(days => greatest(coalesce(p_lag,5),1)) and created_at < v_asof
        group by track_id),
      j as (select b.comp bc, b.skip bs, b.elig be, b.conf bconf, a.comp ac, a.skip as_, a.elig ae, a.conf aconf
            from bef b join aft a on a.track_id=b.track_id)
      select
        avg(1 - least(1, abs((0.5*bc+0.3*be+0.2*(1-bs)) - (0.5*ac+0.3*ae+0.2*(1-as_))))) accuracy,
        avg(abs((0.6*bc+0.4*be) - ac)) score_error,
        avg(abs(bconf - aconf)) confidence_error,
        avg(abs(least(1,0.25*bs+0.25*(1-bconf)) - least(1,0.5*as_+0.5*(1-aconf)))) risk_error,
        avg((0.5*ac+0.3*ae+0.2*(1-as_)) - (0.5*bc+0.3*be+0.2*(1-bs))) reward_gap,
        avg(ac - (0.6*bc+0.4*be)) outcome_gap,
        avg(abs(ac-bc)) drift, avg(aconf) confidence,
        avg(least(1,0.5*as_+0.5*(1-aconf))) risk, count(*)::int n
      from j
    ) m
    where m.n > 0;
    get diagnostics v_n = row_count;
    v_total := v_total + v_n;
  end loop;

  -- Promotion History (스냅샷별 promotion 상태 누적)
  insert into public.promotion_history(snapshot_batch, snapshot_at, promotion_score, promotion_state, candidate_flag, approval_flag, shadow_flag)
  select v_batch, feedback_timestamp, promotion_score, promotion_state,
    (promotion_score >= 0.55 and risk <= 0.20), false, true
  from public.decision_feedback_history where snapshot_batch=v_batch;

  -- Stability Timeline (전 스냅샷 대비 transition)
  insert into public.decision_stability_timeline(snapshot_batch, snapshot_at, status, transition, accuracy, drift, risk)
  select v_batch, feedback_timestamp,
    public._lt_status(decision_accuracy, risk, drift),
    case
      when prev_status is null then 'baseline'
      when prev_status in ('critical','warning') and public._lt_status(decision_accuracy, risk, drift)='stable' then 'recovery'
      when decision_accuracy > prev_acc + 0.02 then 'improving'
      when decision_accuracy < prev_acc - 0.02 then 'degrading'
      else 'steady' end,
    decision_accuracy, drift, risk
  from (
    select feedback_timestamp, decision_accuracy, drift, risk,
      lag(decision_accuracy) over (order by feedback_timestamp) prev_acc,
      lag(public._lt_status(decision_accuracy, risk, drift)) over (order by feedback_timestamp) prev_status
    from public.decision_feedback_history where snapshot_batch=v_batch
  ) t;

  return jsonb_build_object('ok',true,'snapshot_batch',v_batch,'snapshots',v_total,
    'timespan', jsonb_build_object('newest',v_max,'points_requested',greatest(coalesce(p_points,10),1)),
    'note','Shadow feedback history — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Longitudinal Trend + Regression Detection — admin_generate_longitudinal_trend
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_longitudinal_trend(p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_batch uuid; m record; v_n integer; v_reg integer := 0;
  v_metrics jsonb := '[{"name":"accuracy","col":"decision_accuracy","hb":true},
    {"name":"risk","col":"risk","hb":false},{"name":"confidence","col":"confidence","hb":true},
    {"name":"drift","col":"drift","hb":false},{"name":"reward","col":"reward_gap","hb":true},
    {"name":"outcome","col":"outcome_gap","hb":true},{"name":"promotion","col":"promotion_score","hb":true}]'::jsonb;
  e jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_batch := coalesce(p_batch, (select snapshot_batch from public.decision_feedback_history order by created_at desc limit 1));
  if v_batch is null then raise exception 'no feedback history — run admin_generate_feedback_history first'; end if;
  select count(*) into v_n from public.decision_feedback_history where snapshot_batch=v_batch;

  for e in select * from jsonb_array_elements(v_metrics) loop
    execute format($f$
      insert into public.decision_trend_history(snapshot_batch, trend_name, slope_per_day, direction, start_value, end_value, delta, points)
      select $1, $2,
        round(regr_slope(%1$s, extract(epoch from feedback_timestamp)/86400.0)::numeric,6),
        public._lt_trend_dir(round(regr_slope(%1$s, extract(epoch from feedback_timestamp)/86400.0)::numeric,6), $3),
        round((array_agg(%1$s order by feedback_timestamp))[1]::numeric,4),
        round((array_agg(%1$s order by feedback_timestamp desc))[1]::numeric,4),
        round(((array_agg(%1$s order by feedback_timestamp desc))[1] - (array_agg(%1$s order by feedback_timestamp))[1])::numeric,4),
        count(*)::int
      from public.decision_feedback_history where snapshot_batch=$1
    $f$, e->>'col') using v_batch, e->>'name', (e->>'hb')::boolean;
  end loop;

  -- Regression Detection (기록만 — 차단 없음): 최근 절반 vs 이전 절반 악화 감지
  for e in select * from jsonb_array_elements(v_metrics) loop
    declare v_old numeric; v_new numeric; v_hb boolean := (e->>'hb')::boolean; v_delta numeric; v_worse boolean;
    begin
      execute format('select round(avg(%1$s) filter (where feedback_timestamp < mid)::numeric,4), round(avg(%1$s) filter (where feedback_timestamp >= mid)::numeric,4)
        from public.decision_feedback_history, (select (min(feedback_timestamp) + (max(feedback_timestamp)-min(feedback_timestamp))/2) mid from public.decision_feedback_history where snapshot_batch=$1) mm
        where snapshot_batch=$1', e->>'col') into v_old, v_new using v_batch;
      if v_old is not null and v_new is not null then
        v_delta := round((v_new - v_old)::numeric,4);
        v_worse := case when v_hb then v_new < v_old - 0.05 else v_new > v_old + 0.05 end;
        if v_worse then
          insert into public.decision_regressions(snapshot_batch, metric, regression_type, severity, from_value, to_value, delta, note)
          values (v_batch, e->>'name', (e->>'name')||'_regression',
            case when abs(v_delta) >= 0.12 then 'critical' else 'warning' end, v_old, v_new, v_delta,
            'recent half vs earlier half 악화 감지 — 기록만, 실제 차단 없음');
          v_reg := v_reg + 1;
        end if;
      end if;
    end;
  end loop;

  return jsonb_build_object('ok',true,'snapshot_batch',v_batch,'trends',7,'points',v_n,'regressions',v_reg,
    'summary',(select coalesce(jsonb_agg(jsonb_build_object('trend',trend_name,'direction',direction,'slope',slope_per_day,'delta',delta) order by trend_name),'[]'::jsonb)
               from public.decision_trend_history where snapshot_batch=v_batch),
    'note','Shadow trend/regression — 기록만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Rolling Window Statistics — admin_generate_window_statistics
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_window_statistics(p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_batch uuid; w integer; v_now timestamptz; v_n integer := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_batch := coalesce(p_batch, (select snapshot_batch from public.decision_feedback_history order by created_at desc limit 1));
  if v_batch is null then raise exception 'no feedback history'; end if;
  select max(feedback_timestamp) into v_now from public.decision_feedback_history where snapshot_batch=v_batch;

  foreach w in array array[7,14,30,60,90,180,365] loop
    with mx as (
      select feedback_timestamp,
        unnest(array['accuracy','risk','drift','confidence','promotion']) metric,
        unnest(array[decision_accuracy, risk, drift, confidence, promotion_score]) val
      from public.decision_feedback_history
      where snapshot_batch=v_batch and feedback_timestamp >= v_now - make_interval(days => w))
    insert into public.decision_window_statistics(snapshot_batch, window_label, window_days, metric,
      rolling_mean, rolling_std, rolling_variance, rolling_percentile, rolling_best, rolling_worst, sample_n)
    select v_batch, w||'d', w, metric,
      round(avg(val)::numeric,4), round(coalesce(stddev_samp(val),0)::numeric,4), round(coalesce(var_samp(val),0)::numeric,4),
      round(percentile_cont(0.5) within group (order by val)::numeric,4),
      round((case when metric in ('risk','drift') then min(val) else max(val) end)::numeric,4),
      round((case when metric in ('risk','drift') then max(val) else min(val) end)::numeric,4),
      count(*)::int
    from mx group by metric;
    get diagnostics v_n = row_count;
  end loop;

  return jsonb_build_object('ok',true,'snapshot_batch',v_batch,'windows',7,
    'rows',(select count(*) from public.decision_window_statistics where snapshot_batch=v_batch),
    'note','Shadow rolling stats');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Model Evolution — admin_generate_model_evolution
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_model_evolution(p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_batch uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_batch := coalesce(p_batch, (select snapshot_batch from public.decision_feedback_history order by created_at desc limit 1));
  if v_batch is null then raise exception 'no feedback history'; end if;

  insert into public.decision_model_evolution(snapshot_batch, model_version, epoch_from, epoch_to, snapshots,
    accuracy, risk, reward, confidence, drift, accuracy_delta, risk_delta)
  select v_batch, model_version, epoch_from, epoch_to, snapshots, accuracy, risk, reward, confidence, drift,
    round((accuracy - lag(accuracy) over (order by epoch_from))::numeric,4),
    round((risk - lag(risk) over (order by epoch_from))::numeric,4)
  from (
    select model_version, min(feedback_timestamp) epoch_from, max(feedback_timestamp) epoch_to, count(*)::int snapshots,
      round(avg(decision_accuracy)::numeric,4) accuracy, round(avg(risk)::numeric,4) risk,
      round(avg(reward_gap)::numeric,4) reward, round(avg(confidence)::numeric,4) confidence, round(avg(drift)::numeric,4) drift
    from public.decision_feedback_history where snapshot_batch=v_batch group by model_version
  ) e;

  return jsonb_build_object('ok',true,'snapshot_batch',v_batch,
    'evolution',(select coalesce(jsonb_agg(jsonb_build_object('version',model_version,'accuracy',accuracy,'risk',risk,'reward',reward,'confidence',confidence,'drift',drift,'accuracy_delta',accuracy_delta) order by epoch_from),'[]'::jsonb)
                 from public.decision_model_evolution where snapshot_batch=v_batch),
    'note','Shadow model evolution');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Forecast Engine — admin_generate_decision_forecast (linear extrapolation)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_decision_forecast(p_batch uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_batch uuid; h integer; mr record; v_last numeric; v_slope numeric; v_dir text; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_batch := coalesce(p_batch, (select snapshot_batch from public.decision_feedback_history order by created_at desc limit 1));
  if v_batch is null then raise exception 'no feedback history'; end if;
  select count(*) into v_n from public.decision_feedback_history where snapshot_batch=v_batch;

  foreach h in array array[7,30,90] loop
    for mr in select trend_name, slope_per_day, direction from public.decision_trend_history where snapshot_batch=v_batch
              and trend_name in ('accuracy','risk','promotion','confidence') loop
      select case mr.trend_name
               when 'accuracy' then decision_accuracy when 'risk' then risk
               when 'promotion' then promotion_score else confidence end
        into v_last from public.decision_feedback_history where snapshot_batch=v_batch order by feedback_timestamp desc limit 1;
      v_slope := coalesce(mr.slope_per_day,0); v_dir := mr.direction;
      insert into public.decision_forecasts(snapshot_batch, horizon_days, metric, last_value, forecast_value, trend, method, based_on_points)
      values (v_batch, h, mr.trend_name, round(v_last::numeric,4),
        round(least(1.0, greatest(0.0, v_last + v_slope*h))::numeric,4), v_dir, 'linear', v_n);
    end loop;
  end loop;

  return jsonb_build_object('ok',true,'snapshot_batch',v_batch,'horizons',3,
    'forecasts',(select coalesce(jsonb_agg(jsonb_build_object('horizon',horizon_days,'metric',metric,'last',last_value,'forecast',forecast_value,'trend',trend) order by horizon_days, metric),'[]'::jsonb)
                 from public.decision_forecasts where snapshot_batch=v_batch),
    'note','Shadow forecast — linear, 관측용');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview — admin_ai_feedback_history_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_feedback_history_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_batch uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select snapshot_batch into v_batch from public.decision_feedback_history order by created_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_batch is not null,
    'snapshot_batch', v_batch,
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('at',feedback_timestamp,'version',model_version,'accuracy',decision_accuracy,
        'risk',risk,'confidence',confidence,'drift',drift,'promotion',promotion_score,'state',promotion_state) order by feedback_timestamp),'[]'::jsonb)
      from public.decision_feedback_history where snapshot_batch=v_batch),
    'trends', (select coalesce(jsonb_agg(jsonb_build_object('trend',trend_name,'direction',direction,'slope',slope_per_day,'delta',delta,'start',start_value,'end',end_value) order by trend_name),'[]'::jsonb)
      from public.decision_trend_history where snapshot_batch=v_batch),
    'window_stats', (select coalesce(jsonb_agg(jsonb_build_object('window',window_label,'metric',metric,'mean',rolling_mean,'std',rolling_std,'best',rolling_best,'worst',rolling_worst,'n',sample_n) order by window_days, metric),'[]'::jsonb)
      from public.decision_window_statistics where snapshot_batch=v_batch and metric in ('accuracy','risk')),
    'stability_timeline', (select coalesce(jsonb_agg(jsonb_build_object('at',snapshot_at,'status',status,'transition',transition,'accuracy',accuracy) order by snapshot_at),'[]'::jsonb)
      from public.decision_stability_timeline where snapshot_batch=v_batch),
    'model_evolution', (select coalesce(jsonb_agg(jsonb_build_object('version',model_version,'accuracy',accuracy,'risk',risk,'reward',reward,'confidence',confidence,'drift',drift,'accuracy_delta',accuracy_delta) order by epoch_from),'[]'::jsonb)
      from public.decision_model_evolution where snapshot_batch=v_batch),
    'forecasts', (select coalesce(jsonb_agg(jsonb_build_object('horizon',horizon_days,'metric',metric,'last',last_value,'forecast',forecast_value,'trend',trend) order by horizon_days, metric),'[]'::jsonb)
      from public.decision_forecasts where snapshot_batch=v_batch),
    'regressions', (select coalesce(jsonb_agg(jsonb_build_object('metric',metric,'type',regression_type,'severity',severity,'from',from_value,'to',to_value,'delta',delta) order by detected_at desc),'[]'::jsonb)
      from public.decision_regressions where snapshot_batch=v_batch),
    'promotion_history', (select coalesce(jsonb_agg(jsonb_build_object('at',snapshot_at,'score',promotion_score,'state',promotion_state,'candidate',candidate_flag) order by snapshot_at),'[]'::jsonb)
      from public.promotion_history where snapshot_batch=v_batch)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_feedback_history_summary as
select h.snapshot_batch, h.feedback_timestamp, h.model_version, h.run_version, h.decision_accuracy, h.decision_error,
  h.confidence_error, h.risk_error, h.reward_gap, h.outcome_gap, h.drift, h.confidence, h.risk, h.promotion_score, h.promotion_state
from public.decision_feedback_history h;

create or replace view public.v2_longitudinal_trend_summary as
select t.snapshot_batch, t.trend_name, t.slope_per_day, t.direction, t.start_value, t.end_value, t.delta, t.points
from public.decision_trend_history t;

create or replace view public.v2_window_statistics_summary as
select w.snapshot_batch, w.window_label, w.window_days, w.metric, w.rolling_mean, w.rolling_std, w.rolling_variance,
  w.rolling_percentile, w.rolling_best, w.rolling_worst, w.sample_n
from public.decision_window_statistics w;

create or replace view public.v2_model_evolution_summary as
select e.snapshot_batch, e.model_version, e.epoch_from, e.epoch_to, e.snapshots, e.accuracy, e.risk, e.reward,
  e.confidence, e.drift, e.accuracy_delta, e.risk_delta
from public.decision_model_evolution e;

create or replace view public.v2_decision_forecast_summary as
select f.snapshot_batch, f.horizon_days, f.metric, f.last_value, f.forecast_value, f.trend, f.method, f.based_on_points
from public.decision_forecasts f;

-- ─────────────────────────────────────────────────────────────────────
-- J. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._lt_status(numeric,numeric,numeric)',
    'public._lt_trend_dir(numeric,boolean)',
    'public.admin_generate_feedback_history(integer,integer,integer,integer)',
    'public.admin_generate_longitudinal_trend(uuid)',
    'public.admin_generate_window_statistics(uuid)',
    'public.admin_generate_model_evolution(uuid)',
    'public.admin_generate_decision_forecast(uuid)',
    'public.admin_ai_feedback_history_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_feedback_history(integer,integer,integer,integer) is
  'ALGO-6C — as-of 슬라이딩으로 Feedback 시계열 스냅샷 생성 + promotion/stability timeline. Shadow only.';
comment on function public.admin_generate_decision_forecast(uuid) is
  'ALGO-6C — accuracy/risk/promotion/confidence 선형 예측(7/30/90d). 관측용, 운영 미반영.';
