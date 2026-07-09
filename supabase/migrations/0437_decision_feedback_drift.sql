-- 0437 — Phase ALGO-6B: Decision Feedback & Drift Monitor (Shadow Observability)
--
-- 목적:
--   ALGO-6A Unified Decision 이 실제 이후 성과와 얼마나 일치하는지 Shadow 로 검증한다.
--   Decision Feedback(예상 vs 실제) · Drift Monitor · Stability Window · Promotion Readiness ·
--   Shadow Alert 를 산출하여 "운영 전환 가능성" 판단 근거만 만든다. 실제 적용/승인/canary 없음.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming/Runtime 무변경.
--   • Production Apply 금지. additive only. 자동 승인/자동 Canary 금지. 기존 결과 불변.
--
-- 자족적: 예상(decision basis)과 실제(actual)는 playback_events_v2 의 시점 분할(median created_at)로
--   산출한다. before window = 예상 근거, after window = 실제 성과. (ALGO-6A 테이블 유무와 무관)

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._drift_status(p_mag numeric, p_insufficient boolean default false)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_insufficient then 'insufficient_data'
              when coalesce(p_mag,1) < 0.10 then 'stable'
              when coalesce(p_mag,1) < 0.20 then 'warning'
              when coalesce(p_mag,1) < 0.35 then 'drifting'
              else 'critical' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Feedback tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.decision_feedback_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  decision_run_id uuid, window_days integer, split_at timestamptz, item_count integer,
  avg_accuracy numeric, avg_score_error numeric, avg_confidence_error numeric, avg_risk_error numeric,
  notes text, created_by uuid
);
create index if not exists dfr_run_idx on public.decision_feedback_runs(run_at desc);

create table if not exists public.decision_feedback_items (
  id uuid primary key default gen_random_uuid(),
  feedback_run_id uuid not null references public.decision_feedback_runs(id) on delete cascade,
  track_id uuid not null,
  decision_score numeric, decision_prediction_score numeric, decision_reward_score numeric,
  decision_ensemble_score numeric, decision_confidence numeric, decision_risk numeric,
  actual_completion_rate numeric, actual_skip_rate numeric, actual_eligible_rate numeric,
  actual_revenue_weight numeric, actual_reaction_score numeric, actual_repeat_score numeric,
  decision_accuracy numeric, score_error numeric, confidence_error numeric, risk_error numeric,
  reward_gap numeric, outcome_gap numeric, created_at timestamptz not null default now()
);
create index if not exists dfi_run_idx on public.decision_feedback_items(feedback_run_id, decision_accuracy);
create index if not exists dfi_track_idx on public.decision_feedback_items(track_id);

create table if not exists public.decision_feedback_memory (
  id uuid primary key default gen_random_uuid(),
  track_id uuid not null unique,
  feedback_count integer not null default 0, avg_accuracy numeric, avg_score_error numeric,
  last_accuracy numeric, trend text, last_run_at timestamptz, updated_at timestamptz not null default now()
);

-- ─────────────────────────────────────────────────────────────────────
-- B. Drift tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.decision_drift_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  feedback_run_id uuid, window_days integer, split_at timestamptz, item_count integer,
  drift_status text, avg_drift numeric, notes text
);
create index if not exists ddr_run_idx on public.decision_drift_runs(run_at desc);

create table if not exists public.decision_drift_items (
  id uuid primary key default gen_random_uuid(),
  drift_run_id uuid not null references public.decision_drift_runs(id) on delete cascade,
  track_id uuid not null,
  completion_drift numeric, skip_drift numeric, eligible_drift numeric, reward_drift numeric,
  confidence_drift numeric, risk_drift numeric, sample_drift numeric, store_type_drift numeric, context_drift numeric,
  drift_magnitude numeric, drift_status text, created_at timestamptz not null default now()
);
create index if not exists ddi_run_idx on public.decision_drift_items(drift_run_id, drift_magnitude desc);

-- ─────────────────────────────────────────────────────────────────────
-- C. Stability + Promotion Readiness + Alerts
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.decision_stability_windows (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  window_label text not null, window_days integer,
  stable_days integer default 0, warning_days integer default 0, critical_days integer default 0,
  insufficient_days integer default 0, total_days integer default 0,
  consecutive_stable_windows integer default 0, promotion_readiness_score numeric, status text,
  created_at timestamptz not null default now()
);
create index if not exists dsw_run_idx on public.decision_stability_windows(run_at desc);

create table if not exists public.decision_promotion_readiness (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  decision_accuracy numeric, avg_risk numeric, drift_status text, sample_size integer,
  min_sample_size integer default 30, consecutive_stable_windows integer,
  readiness_state text not null, reasons jsonb, created_by uuid
);
create index if not exists dpr_run_idx on public.decision_promotion_readiness(run_at desc);

create table if not exists public.decision_shadow_alerts (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  alert_type text not null, severity text not null default 'warning',
  scope text, metric text, value numeric, threshold numeric, track_id uuid, message text,
  created_at timestamptz not null default now()
);
create index if not exists dsa_run_idx on public.decision_shadow_alerts(run_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- D. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['decision_feedback_runs','decision_feedback_items','decision_feedback_memory',
    'decision_drift_runs','decision_drift_items','decision_stability_windows','decision_promotion_readiness','decision_shadow_alerts'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Feedback Engine — admin_run_decision_feedback
--    예상(before window) vs 실제(after window) 비교 → accuracy/error/gap
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_decision_feedback(p_decision_run_id uuid default null, p_days integer default 120)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,120),1));
  v_split timestamptz; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select percentile_disc(0.5) within group (order by created_at) into v_split
    from public.playback_events_v2 where created_at >= v_from;
  if v_split is null then raise exception 'no playback data in window'; end if;

  insert into public.decision_feedback_runs(decision_run_id, window_days, split_at)
    values (p_decision_run_id, greatest(coalesce(p_days,120),1), v_split) returning id into v_run;

  create temp table _fb on commit drop as
  with bef as (
    select track_id, count(*)::int plays,
      avg(completion_percent)/100.0 completion,
      avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
      avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) eligible,
      least(1.0, count(*)::numeric/20.0) confidence
    from public.playback_events_v2 where created_at >= v_from and created_at < v_split group by track_id),
  aft as (
    select track_id, count(*)::int plays, count(distinct session_id)::int sessions,
      count(distinct store_type_slug)::int stores,
      avg(completion_percent)/100.0 completion,
      avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
      avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) eligible,
      avg(case when coalesce(completion_percent,0)>=80 then 1 else 0 end) reaction,
      least(1.0, count(*)::numeric/20.0) confidence
    from public.playback_events_v2 where created_at >= v_split group by track_id)
  select b.track_id,
    -- decision basis (예상)
    round((0.6*b.completion + 0.4*b.eligible)::numeric,4) as d_prediction,
    round((0.5*b.completion + 0.3*b.eligible + 0.2*(1-b.skip))::numeric,4) as d_reward,
    round((((0.6*b.completion+0.4*b.eligible)+(0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip))+b.confidence)/3.0)::numeric,4) as d_ensemble,
    round(b.confidence::numeric,4) as d_confidence,
    round(least(1.0, 0.30*(case when b.plays<5 then 1 else 0 end) + 0.25*(1-b.confidence) + 0.25*b.skip)::numeric,4) as d_risk,
    round(((0.22*(0.6*b.completion+0.4*b.eligible) + 0.20*(0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip))
      + 0.16*least(1.0,b.plays::numeric/20.0) + 0.14*((0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip))*0.9+0.05)
      + 0.16*(((0.6*b.completion+0.4*b.eligible)+(0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip))+b.confidence)/3.0)
      + 0.12*b.confidence) * (0.5+0.5*b.confidence))::numeric,4) as d_score,
    -- actual (실제)
    round(a.completion::numeric,4) as a_completion, round(a.skip::numeric,4) as a_skip, round(a.eligible::numeric,4) as a_eligible,
    round(a.eligible::numeric,4) as a_revenue, round(a.reaction::numeric,4) as a_reaction,
    round(((a.plays - a.sessions)::numeric/greatest(a.plays,1))::numeric,4) as a_repeat,
    round(a.confidence::numeric,4) as a_confidence,
    round((0.5*a.completion + 0.3*a.eligible + 0.2*(1-a.skip))::numeric,4) as a_reward,
    round(least(1.0, 0.5*a.skip + 0.5*(1-a.confidence))::numeric,4) as a_risk,
    b.completion as b_completion, b.skip as b_skip, b.eligible as b_eligible, b.confidence as b_confidence, b.plays as b_plays,
    a.plays as a_plays, a.stores as a_stores
  from bef b join aft a on a.track_id=b.track_id;

  insert into public.decision_feedback_items(feedback_run_id, track_id, decision_score, decision_prediction_score,
    decision_reward_score, decision_ensemble_score, decision_confidence, decision_risk,
    actual_completion_rate, actual_skip_rate, actual_eligible_rate, actual_revenue_weight, actual_reaction_score, actual_repeat_score,
    decision_accuracy, score_error, confidence_error, risk_error, reward_gap, outcome_gap)
  select v_run, f.track_id, f.d_score, f.d_prediction, f.d_reward, f.d_ensemble, f.d_confidence, f.d_risk,
    f.a_completion, f.a_skip, f.a_eligible, f.a_revenue, f.a_reaction, f.a_repeat,
    round((1 - least(1, abs(f.d_reward - f.a_reward)))::numeric,4),
    round(abs(f.d_prediction - f.a_completion)::numeric,4),
    round(abs(f.d_confidence - f.a_confidence)::numeric,4),
    round(abs(f.d_risk - f.a_risk)::numeric,4),
    round((f.a_reward - f.d_reward)::numeric,4),
    round((f.a_completion - f.d_prediction)::numeric,4)
  from _fb f;
  get diagnostics v_n = row_count;

  update public.decision_feedback_runs set item_count=v_n,
    avg_accuracy=(select round(avg(decision_accuracy)::numeric,4) from public.decision_feedback_items where feedback_run_id=v_run),
    avg_score_error=(select round(avg(score_error)::numeric,4) from public.decision_feedback_items where feedback_run_id=v_run),
    avg_confidence_error=(select round(avg(confidence_error)::numeric,4) from public.decision_feedback_items where feedback_run_id=v_run),
    avg_risk_error=(select round(avg(risk_error)::numeric,4) from public.decision_feedback_items where feedback_run_id=v_run)
  where id=v_run;

  -- feedback memory (per-track 누적)
  insert into public.decision_feedback_memory(track_id, feedback_count, avg_accuracy, avg_score_error, last_accuracy, trend, last_run_at)
  select i.track_id, 1, i.decision_accuracy, i.score_error, i.decision_accuracy,
    case when i.decision_accuracy >= 0.75 then 'good' when i.decision_accuracy >= 0.5 then 'fair' else 'poor' end, now()
  from public.decision_feedback_items i where i.feedback_run_id=v_run
  on conflict (track_id) do update set
    feedback_count = public.decision_feedback_memory.feedback_count + 1,
    avg_accuracy = round(((public.decision_feedback_memory.avg_accuracy * public.decision_feedback_memory.feedback_count) + excluded.last_accuracy) / (public.decision_feedback_memory.feedback_count + 1), 4),
    avg_score_error = round(((public.decision_feedback_memory.avg_score_error * public.decision_feedback_memory.feedback_count) + excluded.avg_score_error) / (public.decision_feedback_memory.feedback_count + 1), 4),
    last_accuracy = excluded.last_accuracy,
    trend = case when excluded.last_accuracy > public.decision_feedback_memory.last_accuracy then 'up'
                 when excluded.last_accuracy < public.decision_feedback_memory.last_accuracy then 'down' else 'flat' end,
    last_run_at = now(), updated_at = now();

  return jsonb_build_object('ok',true,'feedback_run_id',v_run,'items',v_n,'split_at',v_split,
    'avg_accuracy',(select avg_accuracy from public.decision_feedback_runs where id=v_run),
    'note','Shadow feedback — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Drift Monitor — admin_run_decision_drift_monitor (+ Shadow Alerts)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_decision_drift_monitor(p_feedback_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_fb uuid; v_run uuid; v_from timestamptz; v_split timestamptz; v_days integer; v_n integer;
  v_avg_drift numeric; v_status text; v_acc numeric; v_conf_err numeric; v_risk numeric; v_crit integer; v_insuf integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_fb := coalesce(p_feedback_run_id, (select id from public.decision_feedback_runs order by run_at desc limit 1));
  if v_fb is null then raise exception 'no feedback run — run admin_run_decision_feedback first'; end if;
  select split_at, window_days into v_split, v_days from public.decision_feedback_runs where id=v_fb;
  v_from := now() - make_interval(days => greatest(coalesce(v_days,120),1));

  insert into public.decision_drift_runs(feedback_run_id, window_days, split_at) values (v_fb, v_days, v_split) returning id into v_run;

  create temp table _dr on commit drop as
  with bef as (
    select track_id, count(*)::int plays, count(distinct store_type_slug)::int stores,
      avg(completion_percent)/100.0 completion,
      avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
      avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) eligible,
      least(1.0, count(*)::numeric/20.0) confidence
    from public.playback_events_v2 where created_at >= v_from and created_at < v_split group by track_id),
  aft as (
    select track_id, count(*)::int plays, count(distinct store_type_slug)::int stores,
      avg(completion_percent)/100.0 completion,
      avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
      avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) eligible,
      least(1.0, count(*)::numeric/20.0) confidence
    from public.playback_events_v2 where created_at >= v_split group by track_id)
  select b.track_id,
    round((a.completion-b.completion)::numeric,4) completion_drift,
    round((a.skip-b.skip)::numeric,4) skip_drift,
    round((a.eligible-b.eligible)::numeric,4) eligible_drift,
    round(((0.5*a.completion+0.3*a.eligible+0.2*(1-a.skip))-(0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip)))::numeric,4) reward_drift,
    round((a.confidence-b.confidence)::numeric,4) confidence_drift,
    round((least(1.0,0.5*a.skip+0.5*(1-a.confidence)) - least(1.0,0.5*b.skip+0.5*(1-b.confidence)))::numeric,4) risk_drift,
    round(((a.plays-b.plays)::numeric/greatest(b.plays,1))::numeric,4) sample_drift,
    round((abs(a.stores-b.stores)::numeric/greatest(b.stores,1))::numeric,4) store_type_drift,
    round(((abs(a.completion-b.completion)+abs(a.skip-b.skip))/2.0)::numeric,4) context_drift,
    (b.plays < 3 or a.plays < 3) insufficient
  from bef b join aft a on a.track_id=b.track_id;

  insert into public.decision_drift_items(drift_run_id, track_id, completion_drift, skip_drift, eligible_drift,
    reward_drift, confidence_drift, risk_drift, sample_drift, store_type_drift, context_drift, drift_magnitude, drift_status)
  select v_run, d.track_id, d.completion_drift, d.skip_drift, d.eligible_drift, d.reward_drift, d.confidence_drift,
    d.risk_drift, d.sample_drift, d.store_type_drift, d.context_drift,
    round(((abs(d.completion_drift)+abs(d.skip_drift)+abs(d.eligible_drift)+abs(d.reward_drift)+abs(d.confidence_drift)+abs(d.risk_drift))/6.0)::numeric,4),
    public._drift_status(((abs(d.completion_drift)+abs(d.skip_drift)+abs(d.eligible_drift)+abs(d.reward_drift)+abs(d.confidence_drift)+abs(d.risk_drift))/6.0), d.insufficient)
  from _dr d;
  get diagnostics v_n = row_count;

  select round(avg(drift_magnitude)::numeric,4), count(*) filter (where drift_status='critical'), count(*) filter (where drift_status='insufficient_data')
    into v_avg_drift, v_crit, v_insuf from public.decision_drift_items where drift_run_id=v_run;
  v_status := case when v_crit >= greatest(v_n/5,1) then 'critical'
                   when v_avg_drift >= 0.20 then 'drifting'
                   when v_avg_drift >= 0.10 then 'warning' else 'stable' end;
  update public.decision_drift_runs set item_count=v_n, drift_status=v_status, avg_drift=v_avg_drift where id=v_run;

  -- Shadow Alerts (경고만 생성)
  select avg_accuracy, avg_confidence_error into v_acc, v_conf_err from public.decision_feedback_runs where id=v_fb;
  select round(avg(decision_risk)::numeric,4) into v_risk from public.decision_feedback_items where feedback_run_id=v_fb;

  if v_status in ('drifting','critical') then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('high_drift', case when v_status='critical' then 'critical' else 'warning' end, 'run', 'avg_drift', v_avg_drift, 0.20,
      'Decision 분포 drift 감지 — '||v_status||' (avg_drift '||v_avg_drift||'). Shadow 관찰만.');
  end if;
  if coalesce(v_acc,1) < 0.70 then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('accuracy_drop', case when v_acc < 0.5 then 'critical' else 'warning' end, 'run', 'avg_accuracy', v_acc, 0.70,
      'Decision accuracy 저하 (avg_accuracy '||coalesce(v_acc,0)||'). 운영 전환 부적합.');
  end if;
  if coalesce(v_conf_err,0) >= 0.20 then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('confidence_collapse', 'warning', 'run', 'avg_confidence_error', v_conf_err, 0.20,
      'Confidence 예측 오차 확대 (confidence_error '||v_conf_err||').');
  end if;
  if coalesce(v_risk,0) >= 0.30 then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('risk_spike', 'warning', 'run', 'avg_decision_risk', v_risk, 0.30,
      'Decision risk 상승 (avg_risk '||v_risk||').');
  end if;
  if v_insuf >= greatest(v_n/2,1) then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('insufficient_samples', 'warning', 'run', 'insufficient_items', v_insuf, greatest(v_n/2,1),
      '표본 부족 항목 다수 ('||v_insuf||'/'||v_n||').');
  end if;
  if v_crit >= greatest(v_n/3,1) then
    insert into public.decision_shadow_alerts(alert_type, severity, scope, metric, value, threshold, message)
    values ('model_instability', 'critical', 'run', 'critical_items', v_crit, greatest(v_n/3,1),
      '모델 불안정 — critical drift 항목 다수 ('||v_crit||'/'||v_n||').');
  end if;

  return jsonb_build_object('ok',true,'drift_run_id',v_run,'feedback_run_id',v_fb,'items',v_n,
    'drift_status',v_status,'avg_drift',v_avg_drift,
    'alerts',(select count(*) from public.decision_shadow_alerts where run_at >= now() - interval '1 minute'),
    'note','Shadow drift/alert — 실제 차단/변경 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Stability Window — admin_calculate_decision_stability
--    일자별 completion 변동을 window(7/14/30/60/90d) 별로 집계
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_calculate_decision_stability(p_days integer default 90)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare w integer; v_consec integer := 0; v_broke boolean := false; wl text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  foreach w in array array[7,14,30,60,90] loop
    wl := w||'d';
    with days as (
      select gs::date d from generate_series(current_date - (w-1), current_date, interval '1 day') gs),
    daily as (
      select d.d,
        (select avg(completion_percent)/100.0 from public.playback_events_v2 e where e.created_at::date = d.d) comp,
        (select count(*) from public.playback_events_v2 e where e.created_at::date = d.d) cnt
      from days d),
    wmean as (select avg(comp) m from daily where comp is not null),
    classed as (
      select d,
        case when cnt = 0 or comp is null then 'insufficient'
             when abs(comp - (select m from wmean)) < 0.08 then 'stable'
             when abs(comp - (select m from wmean)) < 0.15 then 'warning'
             else 'critical' end st
      from daily)
    insert into public.decision_stability_windows(window_label, window_days, stable_days, warning_days, critical_days,
      insufficient_days, total_days, promotion_readiness_score, status)
    select wl, w,
      count(*) filter (where st='stable'), count(*) filter (where st='warning'), count(*) filter (where st='critical'),
      count(*) filter (where st='insufficient'), count(*),
      round((count(*) filter (where st='stable')::numeric / greatest(count(*) filter (where st <> 'insufficient'),1))::numeric,4),
      case when count(*) filter (where st='critical') > count(*)/5 then 'critical'
           when count(*) filter (where st='stable') >= count(*) filter (where st <> 'insufficient')*0.7 then 'stable'
           else 'warning' end
    from classed;
  end loop;

  -- consecutive stable windows (7d→90d 순서, 최초 non-stable 에서 중단)
  for wl in select window_label from public.decision_stability_windows
            where run_at >= now() - interval '1 minute'
            order by window_days loop
    if not v_broke and (select status from public.decision_stability_windows
        where window_label=wl and run_at >= now() - interval '1 minute' order by run_at desc limit 1) = 'stable' then
      v_consec := v_consec + 1;
    else
      v_broke := true;
    end if;
  end loop;
  update public.decision_stability_windows set consecutive_stable_windows = v_consec
    where run_at >= now() - interval '1 minute';

  return jsonb_build_object('ok',true,'windows',5,'consecutive_stable_windows',v_consec,
    'summary',(select coalesce(jsonb_agg(jsonb_build_object('window',window_label,'status',status,'stable_days',stable_days,'score',promotion_readiness_score) order by window_days) ,'[]'::jsonb)
               from public.decision_stability_windows where run_at >= now() - interval '1 minute'),
    'note','Shadow stability — 관찰만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Promotion Readiness — admin_generate_promotion_readiness (상태만)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_promotion_readiness(p_min_sample integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_acc numeric; v_risk numeric; v_drift text; v_sample integer; v_consec integer; v_state text; v_reasons jsonb;
  c_acc boolean; c_risk boolean; c_drift boolean; c_sample boolean; c_consec boolean; c_stab boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select avg_accuracy, item_count into v_acc, v_sample from public.decision_feedback_runs order by run_at desc limit 1;
  select round(avg(decision_risk)::numeric,4) into v_risk from public.decision_feedback_items
    where feedback_run_id = (select id from public.decision_feedback_runs order by run_at desc limit 1);
  select drift_status into v_drift from public.decision_drift_runs order by run_at desc limit 1;
  select max(consecutive_stable_windows) into v_consec from public.decision_stability_windows
    where run_at >= (select max(run_at) from public.decision_stability_windows) - interval '1 minute';

  c_acc := coalesce(v_acc,0) >= 0.75;
  c_risk := coalesce(v_risk,1) <= 0.20;
  c_drift := coalesce(v_drift,'critical') not in ('critical','drifting');
  c_sample := coalesce(v_sample,0) >= coalesce(p_min_sample,30);
  c_consec := coalesce(v_consec,0) >= 3;
  c_stab := coalesce(v_drift,'critical') <> 'critical';

  v_state := case
    when v_acc is null or coalesce(v_drift,'critical')='critical' then 'not_ready'
    when not c_sample then 'needs_more_data'
    when c_acc and c_risk and c_drift and c_sample and c_consec then 'ready_for_limited_canary'
    when c_acc and c_risk and c_stab and coalesce(v_consec,0) >= 2 then 'ready_for_review'
    when coalesce(v_acc,0) >= 0.6 and c_stab then 'stable_shadow'
    else 'needs_more_data' end;

  v_reasons := jsonb_build_object(
    'accuracy_ge_0.75', c_acc, 'risk_le_0.20', c_risk, 'drift_ok', c_drift,
    'sample_ge_min', c_sample, 'consecutive_stable_ge_3', c_consec,
    'values', jsonb_build_object('accuracy',v_acc,'avg_risk',v_risk,'drift_status',v_drift,'sample_size',v_sample,'consecutive_stable_windows',v_consec));

  insert into public.decision_promotion_readiness(decision_accuracy, avg_risk, drift_status, sample_size, min_sample_size, consecutive_stable_windows, readiness_state, reasons)
  values (v_acc, v_risk, v_drift, v_sample, coalesce(p_min_sample,30), v_consec, v_state, v_reasons);

  return jsonb_build_object('ok',true,'readiness_state',v_state,'reasons',v_reasons,
    'note','상태 판정만 — 자동 승인/자동 canary 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Overview — admin_ai_decision_feedback_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_decision_feedback_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_fb uuid; v_dr uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_fb from public.decision_feedback_runs order by run_at desc limit 1;
  select id into v_dr from public.decision_drift_runs order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_fb is not null,
    'feedback', jsonb_build_object('feedback_run_id', v_fb,
      'items',(select item_count from public.decision_feedback_runs where id=v_fb),
      'avg_accuracy',(select avg_accuracy from public.decision_feedback_runs where id=v_fb),
      'avg_score_error',(select avg_score_error from public.decision_feedback_runs where id=v_fb),
      'avg_confidence_error',(select avg_confidence_error from public.decision_feedback_runs where id=v_fb),
      'avg_risk_error',(select avg_risk_error from public.decision_feedback_runs where id=v_fb),
      'low_confidence_items',(select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'confidence',decision_confidence,'conf_err',confidence_error,'accuracy',decision_accuracy) order by confidence_error desc),'[]'::jsonb)
        from (select * from public.decision_feedback_items where feedback_run_id=v_fb order by confidence_error desc limit 8) l)),
    'drift', jsonb_build_object('drift_run_id', v_dr,
      'status',(select drift_status from public.decision_drift_runs where id=v_dr),
      'avg_drift',(select avg_drift from public.decision_drift_runs where id=v_dr),
      'worst_items',(select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'magnitude',drift_magnitude,'status',drift_status,'completion_drift',completion_drift,'reward_drift',reward_drift) order by drift_magnitude desc),'[]'::jsonb)
        from (select * from public.decision_drift_items where drift_run_id=v_dr order by drift_magnitude desc limit 8) w)),
    'stability', (select coalesce(jsonb_agg(jsonb_build_object('window',window_label,'status',status,'stable_days',stable_days,'warning_days',warning_days,'critical_days',critical_days,'score',promotion_readiness_score,'consecutive',consecutive_stable_windows) order by window_days),'[]'::jsonb)
      from public.decision_stability_windows where run_at >= (select max(run_at) from public.decision_stability_windows) - interval '2 minutes'),
    'readiness', (select to_jsonb(r) from (select readiness_state, decision_accuracy, avg_risk, drift_status, sample_size, consecutive_stable_windows, reasons from public.decision_promotion_readiness order by run_at desc limit 1) r),
    'alerts', (select coalesce(jsonb_agg(jsonb_build_object('type',alert_type,'severity',severity,'metric',metric,'value',value,'message',message) order by run_at desc),'[]'::jsonb)
      from (select * from public.decision_shadow_alerts order by run_at desc limit 12) a)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_decision_feedback_summary as
select f.feedback_run_id, f.track_id, f.decision_score, f.decision_prediction_score, f.decision_reward_score,
  f.decision_confidence, f.decision_risk, f.actual_completion_rate, f.actual_skip_rate, f.actual_eligible_rate,
  f.decision_accuracy, f.score_error, f.confidence_error, f.risk_error, f.reward_gap, f.outcome_gap
from public.decision_feedback_items f;

create or replace view public.v2_decision_drift_summary as
select d.drift_run_id, d.track_id, d.completion_drift, d.skip_drift, d.eligible_drift, d.reward_drift,
  d.confidence_drift, d.risk_drift, d.sample_drift, d.store_type_drift, d.context_drift, d.drift_magnitude, d.drift_status
from public.decision_drift_items d;

create or replace view public.v2_decision_stability_summary as
select s.window_label, s.window_days, s.stable_days, s.warning_days, s.critical_days, s.insufficient_days,
  s.total_days, s.consecutive_stable_windows, s.promotion_readiness_score, s.status, s.run_at
from public.decision_stability_windows s;

create or replace view public.v2_decision_promotion_readiness_summary as
select r.run_at, r.readiness_state, r.decision_accuracy, r.avg_risk, r.drift_status, r.sample_size,
  r.min_sample_size, r.consecutive_stable_windows, r.reasons
from public.decision_promotion_readiness r;

create or replace view public.v2_decision_shadow_alert_summary as
select a.run_at, a.alert_type, a.severity, a.scope, a.metric, a.value, a.threshold, a.track_id, a.message
from public.decision_shadow_alerts a;

-- ─────────────────────────────────────────────────────────────────────
-- K. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._drift_status(numeric,boolean)',
    'public.admin_run_decision_feedback(uuid,integer)',
    'public.admin_run_decision_drift_monitor(uuid)',
    'public.admin_calculate_decision_stability(integer)',
    'public.admin_generate_promotion_readiness(integer)',
    'public.admin_ai_decision_feedback_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_run_decision_feedback(uuid,integer) is
  'ALGO-6B — Decision 예상(before) vs 실제(after) 비교 → accuracy/score_error/gap. Shadow only.';
comment on function public.admin_generate_promotion_readiness(integer) is
  'ALGO-6B — 운영 전환 가능성 판정(상태만). 자동 승인/자동 canary 없음.';
