-- 0439 — Phase ALGO-6D: Continuous Observability Scheduler (Shadow)
--
-- 목적:
--   ALGO-6B/6C 의 Feedback·Drift·Trend 결과를 실제 시간축으로 지속 누적할 수 있는
--   Shadow Observability Scheduler 를 구축한다. Schedule 정의 · Run Chain(계획) · Snapshot ·
--   Stability Streak · Shadow SLA · Alert Digest · Backfill Planner. 전부 Shadow.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler-Runtime/Exposure/Prediction/RL/Settlement/Streaming/Decision 무변경.
--   • Production Apply 금지. additive only. 자동 Canary/자동 승인 금지. 실제 cron 활성화 금지(enabled=false).
--   • 신규 RPC 는 shadow orchestration 결과만 저장하며 기존 RPC 를 변경/직접 호출하지 않는다.
--
-- 자족적: Snapshot metric 은 playback_events_v2(median split, 예상 vs 실제)로 산출한다.
--   Stability 는 일자별 completion 변동 분류로 계산한다. (ALGO-6A~6C 테이블 유무와 무관)

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.observability_schedules (
  id uuid primary key default gen_random_uuid(),
  schedule_key text not null unique,
  schedule_type text not null,                 -- daily/weekly/monthly/manual/backfill _shadow_observability
  enabled boolean not null default false,      -- 실제 cron 비활성 (항상 false)
  chain_steps jsonb, description text, created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz
);

create table if not exists public.observability_runs (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.observability_schedules(id) on delete set null,
  run_type text not null, triggered_by text not null default 'manual_shadow',
  status text not null default 'completed', snapshot_id uuid,
  started_at timestamptz not null default now(), finished_at timestamptz, notes text
);
create index if not exists obr_sched_idx on public.observability_runs(schedule_id, started_at desc);

create table if not exists public.observability_run_steps (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.observability_runs(id) on delete cascade,
  step_order integer not null, step_name text not null,
  planned boolean not null default true, status text not null default 'planned', result jsonb,
  created_at timestamptz not null default now()
);
create index if not exists ors_run_idx on public.observability_run_steps(run_id, step_order);

create table if not exists public.observability_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.observability_runs(id) on delete cascade, snapshot_at timestamptz not null default now(),
  accuracy numeric, risk numeric, drift numeric, confidence numeric, promotion_score numeric,
  readiness_state text, alert_count integer default 0, regression_count integer default 0,
  stable_window_count integer default 0, critical_window_count integer default 0, sample_size integer default 0,
  created_at timestamptz not null default now()
);
create index if not exists obs_run_idx on public.observability_snapshots(run_id);

create table if not exists public.observability_stability_streaks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.observability_runs(id) on delete cascade, computed_at timestamptz not null default now(),
  consecutive_stable_days integer default 0, consecutive_stable_weeks integer default 0, consecutive_stable_months integer default 0,
  stable_7d_count integer default 0, stable_30d_count integer default 0, stable_90d_count integer default 0,
  last_critical_at timestamptz, last_warning_at timestamptz, readiness_streak integer default 0
);
create index if not exists oss_run_idx on public.observability_stability_streaks(run_id);

create table if not exists public.observability_sla_policies (
  id uuid primary key default gen_random_uuid(),
  policy_key text not null unique, enabled boolean not null default true,
  min_accuracy numeric default 0.75, max_risk numeric default 0.20, max_drift numeric default 0.15,
  min_sample_size integer default 100, min_consecutive_stable_days integer default 30,
  min_consecutive_stable_months integer default 3, max_critical_alerts integer default 0,
  description text, created_at timestamptz not null default now()
);

create table if not exists public.observability_sla_results (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.observability_runs(id) on delete cascade,
  policy_id uuid references public.observability_sla_policies(id) on delete set null,
  sla_status text not null,                    -- sla_pass/sla_warning/sla_fail/insufficient_data
  checks jsonb, evaluated_at timestamptz not null default now()
);
create index if not exists osr_run_idx on public.observability_sla_results(run_id);

create table if not exists public.observability_alert_digests (
  id uuid primary key default gen_random_uuid(),
  digest_type text not null,                    -- daily/weekly/monthly/incident _digest
  run_id uuid references public.observability_runs(id) on delete set null,
  alert_count integer default 0, regression_count integer default 0, sla_fail_count integer default 0,
  items jsonb, message text, generated_at timestamptz not null default now()
);
create index if not exists oad_type_idx on public.observability_alert_digests(digest_type, generated_at desc);

create table if not exists public.observability_backfill_plans (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid references public.observability_schedules(id) on delete set null,
  from_date date, to_date date, cadence text, planned_runs integer, plan jsonb,
  status text not null default 'planned', created_by uuid, created_at timestamptz not null default now()
);
create index if not exists obp_created_idx on public.observability_backfill_plans(created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['observability_schedules','observability_runs','observability_run_steps','observability_snapshots',
    'observability_stability_streaks','observability_sla_policies','observability_sla_results','observability_alert_digests','observability_backfill_plans'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Schedule 정의 (+ backfill plan) — admin_create_observability_schedule
--    실제 cron 미활성(enabled=false). Run Chain 9단계 계획만 정의.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_create_observability_schedule(
  p_schedule_key text, p_schedule_type text default 'manual_shadow_observability', p_description text default null,
  p_backfill_from date default null, p_backfill_to date default null, p_cadence text default 'daily')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_sched uuid; v_chain jsonb; v_plan uuid; v_runs integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(p_schedule_type,'') not in ('daily_shadow_observability','weekly_shadow_observability','monthly_shadow_observability','manual_shadow_observability','backfill_shadow_observability') then
    raise exception 'invalid schedule_type'; end if;

  v_chain := jsonb_build_array(
    jsonb_build_object('order',1,'step','decision_feedback'), jsonb_build_object('order',2,'step','drift_monitor'),
    jsonb_build_object('order',3,'step','stability_window'), jsonb_build_object('order',4,'step','promotion_readiness'),
    jsonb_build_object('order',5,'step','feedback_history'), jsonb_build_object('order',6,'step','trend'),
    jsonb_build_object('order',7,'step','window_statistics'), jsonb_build_object('order',8,'step','forecast'),
    jsonb_build_object('order',9,'step','alert_summary'));

  insert into public.observability_schedules(schedule_key, schedule_type, enabled, chain_steps, description, created_by)
  values (p_schedule_key, p_schedule_type, false, v_chain, coalesce(p_description, initcap(replace(p_schedule_type,'_',' '))), auth.uid())
  on conflict (schedule_key) do update set schedule_type=excluded.schedule_type, chain_steps=excluded.chain_steps, updated_at=now()
  returning id into v_sched;

  -- Backfill plan (계획만 — 실제 데이터 수정 없음)
  if p_schedule_type='backfill_shadow_observability' and p_backfill_from is not null and p_backfill_to is not null then
    v_runs := greatest((p_backfill_to - p_backfill_from) / (case coalesce(p_cadence,'daily') when 'weekly' then 7 when 'monthly' then 30 else 1 end), 0) + 1;
    insert into public.observability_backfill_plans(schedule_id, from_date, to_date, cadence, planned_runs, plan, status, created_by)
    values (v_sched, p_backfill_from, p_backfill_to, coalesce(p_cadence,'daily'), v_runs,
      jsonb_build_object('from',p_backfill_from,'to',p_backfill_to,'cadence',coalesce(p_cadence,'daily'),'planned_runs',v_runs,'note','shadow backfill 계획 — 실제 실행/데이터 수정 없음'),
      'planned', auth.uid()) returning id into v_plan;
  end if;

  return jsonb_build_object('ok',true,'schedule_id',v_sched,'schedule_key',p_schedule_key,'schedule_type',p_schedule_type,
    'enabled',false,'chain_steps',9,'backfill_plan_id',v_plan,'note','스케줄 정의만 — 실제 cron 미활성');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Observability Snapshot Run — admin_run_observability_snapshot
--    Run + 9-step chain(계획) + Snapshot(playback_events_v2 self-contained)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_observability_snapshot(
  p_schedule_id uuid default null, p_run_type text default 'manual_shadow_observability', p_days integer default 120)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_snap uuid; v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,120),1));
  v_split timestamptz; m record; s record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select percentile_disc(0.5) within group (order by created_at) into v_split from public.playback_events_v2 where created_at >= v_from;
  if v_split is null then raise exception 'no playback data'; end if;

  insert into public.observability_runs(schedule_id, run_type, triggered_by, status)
    values (p_schedule_id, coalesce(p_run_type,'manual_shadow_observability'), 'manual_shadow', 'completed') returning id into v_run;

  -- Run Chain (9단계 계획 — 실제 기존 RPC 미호출)
  insert into public.observability_run_steps(run_id, step_order, step_name, planned, status, result)
  select v_run, ord, step, true, 'planned', jsonb_build_object('note','shadow orchestration plan — 기존 RPC 미변경')
  from (values (1,'decision_feedback'),(2,'drift_monitor'),(3,'stability_window'),(4,'promotion_readiness'),
    (5,'feedback_history'),(6,'trend'),(7,'window_statistics'),(8,'forecast'),(9,'alert_summary')) c(ord,step);

  -- Snapshot metrics (예상 vs 실제)
  select * into m from (
    with bef as (
      select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
        avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
        avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
      from public.playback_events_v2 where created_at >= v_from and created_at < v_split group by track_id),
    aft as (
      select track_id, count(*) plays, avg(completion_percent)/100.0 comp,
        avg(case when event_type='skip' or coalesce(completion_percent,0)<30 then 1 else 0 end) skip,
        avg(case when coalesce(completion_percent,0)>=60 then 1 else 0 end) elig, least(1.0,count(*)::numeric/20.0) conf
      from public.playback_events_v2 where created_at >= v_split group by track_id),
    j as (select b.comp bc, b.skip bs, b.elig be, b.conf bconf, a.comp ac, a.skip as_, a.elig ae, a.conf aconf
          from bef b join aft a on a.track_id=b.track_id)
    select round(avg(1 - least(1, abs((0.5*bc+0.3*be+0.2*(1-bs)) - (0.5*ac+0.3*ae+0.2*(1-as_)))))::numeric,4) accuracy,
      round(avg(least(1,0.5*as_+0.5*(1-aconf)))::numeric,4) risk, round(avg(abs(ac-bc))::numeric,4) drift,
      round(avg(aconf)::numeric,4) confidence, count(*)::int n from j
  ) m;

  -- 일자별 90d 안정성 → stable/critical window count
  select * into s from (
    with days as (select gs::date d from generate_series(current_date - 89, current_date, interval '1 day') gs),
    daily as (select d.d, (select avg(completion_percent)/100.0 from public.playback_events_v2 e where e.created_at::date=d.d) comp,
        (select count(*) from public.playback_events_v2 e where e.created_at::date=d.d) cnt from days d),
    wmean as (select avg(comp) mm from daily where comp is not null),
    classed as (select case when cnt=0 or comp is null then 'insufficient'
        when abs(comp-(select mm from wmean)) < 0.08 then 'stable'
        when abs(comp-(select mm from wmean)) < 0.15 then 'warning' else 'critical' end st from daily)
    select count(*) filter (where st='stable')::int stable_c, count(*) filter (where st='critical')::int crit_c from classed
  ) s;

  insert into public.observability_snapshots(run_id, accuracy, risk, drift, confidence, promotion_score, readiness_state,
    alert_count, regression_count, stable_window_count, critical_window_count, sample_size)
  values (v_run, m.accuracy, m.risk, m.drift, m.confidence,
    round((coalesce(m.accuracy,0) * (1-coalesce(m.risk,1)) * (1-least(1,coalesce(m.drift,1))))::numeric,4),
    case when m.n < 30 then 'needs_more_data'
         when m.accuracy >= 0.75 and m.risk <= 0.20 and m.drift <= 0.15 then 'ready_for_limited_canary'
         when m.accuracy >= 0.75 and m.risk <= 0.25 then 'ready_for_review'
         when m.accuracy >= 0.60 then 'stable_shadow' else 'not_ready' end,
    (case when coalesce(m.risk,0) >= 0.30 then 1 else 0 end) + (case when coalesce(m.drift,0) >= 0.20 then 1 else 0 end) + (case when coalesce(m.accuracy,1) < 0.70 then 1 else 0 end),
    (case when coalesce(m.accuracy,1) < 0.55 then 1 else 0 end),
    s.stable_c, s.crit_c, m.n)
  returning id into v_snap;

  update public.observability_runs set snapshot_id=v_snap, finished_at=now() where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'snapshot_id',v_snap,'run_type',coalesce(p_run_type,'manual_shadow_observability'),
    'accuracy',m.accuracy,'risk',m.risk,'drift',m.drift,'sample_size',m.n,'chain_steps',9,
    'note','Shadow snapshot — 실반영/기존 RPC 미변경');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Consecutive Stability Tracker — admin_calculate_stability_streak
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_calculate_stability_streak(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.observability_runs order by started_at desc limit 1));

  select * into r from (
    with days as (select gs::date d from generate_series(current_date - 89, current_date, interval '1 day') gs),
    daily as (select d.d, (select avg(completion_percent)/100.0 from public.playback_events_v2 e where e.created_at::date=d.d) comp,
        (select count(*) from public.playback_events_v2 e where e.created_at::date=d.d) cnt from days d),
    wmean as (select avg(comp) mm from daily where comp is not null),
    classed as (select d, case when cnt=0 or comp is null then 'insufficient'
        when abs(comp-(select mm from wmean)) < 0.08 then 'stable'
        when abs(comp-(select mm from wmean)) < 0.15 then 'warning' else 'critical' end st from daily),
    -- 최신일부터 연속 stable 카운트 (첫 non-stable 에서 중단, insufficient 도 중단)
    ranked as (select d, st, row_number() over (order by d desc) rn from classed),
    streak as (select (coalesce((select min(rn) from ranked where st <> 'stable'), (select count(*)+1 from ranked)) - 1) c)
    select (select c from streak) consec_days,
      (select count(*) from classed where st='stable' and d >= current_date - 6) stable_7d,
      (select count(*) from classed where st='stable' and d >= current_date - 29) stable_30d,
      (select count(*) from classed where st='stable') stable_90d,
      (select max(d) from classed where st='critical') last_crit,
      (select max(d) from classed where st='warning') last_warn
  ) r;

  insert into public.observability_stability_streaks(run_id, consecutive_stable_days, consecutive_stable_weeks, consecutive_stable_months,
    stable_7d_count, stable_30d_count, stable_90d_count, last_critical_at, last_warning_at, readiness_streak)
  values (v_run, coalesce(r.consec_days,0), floor(coalesce(r.consec_days,0)/7.0)::int, floor(coalesce(r.consec_days,0)/30.0)::int,
    coalesce(r.stable_7d,0), coalesce(r.stable_30d,0), coalesce(r.stable_90d,0), r.last_crit, r.last_warn, coalesce(r.consec_days,0));

  return jsonb_build_object('ok',true,'run_id',v_run,'consecutive_stable_days',coalesce(r.consec_days,0),
    'consecutive_stable_months',floor(coalesce(r.consec_days,0)/30.0)::int,
    'stable_7d',coalesce(r.stable_7d,0),'stable_30d',coalesce(r.stable_30d,0),'stable_90d',coalesce(r.stable_90d,0),
    'note','실제 시간축 안정성 누적 — 관측만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Shadow SLA 평가 — admin_evaluate_observability_sla (상태만)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_evaluate_observability_sla(p_run_id uuid default null, p_policy_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_pol uuid; pol public.observability_sla_policies%rowtype; snap public.observability_snapshots%rowtype;
  strk public.observability_stability_streaks%rowtype; v_status text; v_checks jsonb;
  c_acc boolean; c_risk boolean; c_drift boolean; c_sample boolean; c_days boolean; c_months boolean; c_crit boolean; v_pass int; v_total int := 7;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.observability_runs order by started_at desc limit 1));

  -- default policy 자동 생성(없으면)
  v_pol := coalesce(p_policy_id, (select id from public.observability_sla_policies where policy_key='default_shadow_sla'));
  if v_pol is null then
    insert into public.observability_sla_policies(policy_key, description) values ('default_shadow_sla','기본 Shadow SLA — 운영 전환 요구 조건(적용 없음)') returning id into v_pol;
  end if;
  select * into pol from public.observability_sla_policies where id=v_pol;
  select * into snap from public.observability_snapshots where run_id=v_run order by created_at desc limit 1;
  select * into strk from public.observability_stability_streaks where run_id=v_run order by computed_at desc limit 1;

  if snap.id is null or coalesce(snap.sample_size,0) < 10 then
    v_status := 'insufficient_data';
    v_checks := jsonb_build_object('reason','snapshot 없음 또는 표본 부족');
  else
    c_acc := coalesce(snap.accuracy,0) >= pol.min_accuracy;
    c_risk := coalesce(snap.risk,1) <= pol.max_risk;
    c_drift := coalesce(snap.drift,1) <= pol.max_drift;
    c_sample := coalesce(snap.sample_size,0) >= pol.min_sample_size;
    c_days := coalesce(strk.consecutive_stable_days,0) >= pol.min_consecutive_stable_days;
    c_months := coalesce(strk.consecutive_stable_months,0) >= pol.min_consecutive_stable_months;
    c_crit := coalesce(snap.critical_window_count,0) <= pol.max_critical_alerts;
    v_pass := c_acc::int + c_risk::int + c_drift::int + c_sample::int + c_days::int + c_months::int + c_crit::int;
    v_status := case when v_pass = v_total then 'sla_pass' when v_pass >= v_total - 2 then 'sla_warning' else 'sla_fail' end;
    v_checks := jsonb_build_object(
      'min_accuracy', jsonb_build_object('req',pol.min_accuracy,'val',snap.accuracy,'pass',c_acc),
      'max_risk', jsonb_build_object('req',pol.max_risk,'val',snap.risk,'pass',c_risk),
      'max_drift', jsonb_build_object('req',pol.max_drift,'val',snap.drift,'pass',c_drift),
      'min_sample_size', jsonb_build_object('req',pol.min_sample_size,'val',snap.sample_size,'pass',c_sample),
      'min_consecutive_stable_days', jsonb_build_object('req',pol.min_consecutive_stable_days,'val',coalesce(strk.consecutive_stable_days,0),'pass',c_days),
      'min_consecutive_stable_months', jsonb_build_object('req',pol.min_consecutive_stable_months,'val',coalesce(strk.consecutive_stable_months,0),'pass',c_months),
      'critical_alerts_zero', jsonb_build_object('req',pol.max_critical_alerts,'val',coalesce(snap.critical_window_count,0),'pass',c_crit),
      'passed', v_pass, 'total', v_total);
  end if;

  insert into public.observability_sla_results(run_id, policy_id, sla_status, checks) values (v_run, v_pol, v_status, v_checks);

  return jsonb_build_object('ok',true,'run_id',v_run,'policy_id',v_pol,'sla_status',v_status,'checks',v_checks,
    'note','SLA 판정만 — 실제 적용/전환 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Alert Digest 생성 — admin_generate_observability_digest (생성만)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_observability_digest(p_digest_type text default 'daily_digest', p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_win interval; v_alerts integer; v_reg integer; v_slafail integer; v_items jsonb; v_msg text; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(p_digest_type,'') not in ('daily_digest','weekly_digest','monthly_digest','incident_digest') then raise exception 'invalid digest_type'; end if;
  v_run := coalesce(p_run_id, (select id from public.observability_runs order by started_at desc limit 1));
  v_win := case p_digest_type when 'weekly_digest' then interval '7 days' when 'monthly_digest' then interval '30 days' else interval '1 day' end;

  select coalesce(sum(alert_count),0), coalesce(sum(regression_count),0)
    into v_alerts, v_reg from public.observability_snapshots where created_at >= now() - v_win;
  select count(*) into v_slafail from public.observability_sla_results where evaluated_at >= now() - v_win and sla_status in ('sla_fail','sla_warning');

  v_items := jsonb_build_object(
    'window', p_digest_type,
    'snapshots', (select coalesce(jsonb_agg(jsonb_build_object('at',snapshot_at,'accuracy',accuracy,'risk',risk,'drift',drift,'readiness',readiness_state,'alerts',alert_count) order by snapshot_at desc),'[]'::jsonb)
                  from (select * from public.observability_snapshots where created_at >= now() - v_win order by created_at desc limit 10) sn),
    'sla_results', (select coalesce(jsonb_agg(jsonb_build_object('status',sla_status,'at',evaluated_at) order by evaluated_at desc),'[]'::jsonb)
                    from (select * from public.observability_sla_results where evaluated_at >= now() - v_win order by evaluated_at desc limit 10) sr));
  v_msg := format('%s: alerts %s · regressions %s · sla_fail/warn %s (shadow, 발송/자동조치 없음)', p_digest_type, v_alerts, v_reg, v_slafail);

  insert into public.observability_alert_digests(digest_type, run_id, alert_count, regression_count, sla_fail_count, items, message)
  values (p_digest_type, v_run, v_alerts, v_reg, v_slafail, v_items, v_msg) returning id into v_id;

  return jsonb_build_object('ok',true,'digest_id',v_id,'digest_type',p_digest_type,'alert_count',v_alerts,'regression_count',v_reg,
    'sla_fail_count',v_slafail,'message',v_msg,'note','Digest 생성만 — 발송/푸시/자동조치 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview — admin_ai_observability_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_observability_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.observability_runs order by started_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null,
    'latest_run_id', v_run,
    'schedules', (select coalesce(jsonb_agg(jsonb_build_object('key',schedule_key,'type',schedule_type,'enabled',enabled,'steps',jsonb_array_length(coalesce(chain_steps,'[]'::jsonb))) order by created_at),'[]'::jsonb) from public.observability_schedules),
    'run_steps', (select coalesce(jsonb_agg(jsonb_build_object('order',step_order,'step',step_name,'status',status) order by step_order),'[]'::jsonb) from public.observability_run_steps where run_id=v_run),
    'snapshot', (select to_jsonb(sn) from (select accuracy, risk, drift, confidence, promotion_score, readiness_state, alert_count, regression_count, stable_window_count, critical_window_count, sample_size, snapshot_at from public.observability_snapshots where run_id=v_run order by created_at desc limit 1) sn),
    'streak', (select to_jsonb(st) from (select consecutive_stable_days, consecutive_stable_weeks, consecutive_stable_months, stable_7d_count, stable_30d_count, stable_90d_count, last_critical_at, last_warning_at, readiness_streak from public.observability_stability_streaks where run_id=v_run order by computed_at desc limit 1) st),
    'sla_policies', (select coalesce(jsonb_agg(jsonb_build_object('key',policy_key,'min_accuracy',min_accuracy,'max_risk',max_risk,'max_drift',max_drift,'min_days',min_consecutive_stable_days,'min_months',min_consecutive_stable_months) order by created_at),'[]'::jsonb) from public.observability_sla_policies),
    'sla_result', (select to_jsonb(sr) from (select sla_status, checks, evaluated_at from public.observability_sla_results where run_id=v_run order by evaluated_at desc limit 1) sr),
    'digests', (select coalesce(jsonb_agg(jsonb_build_object('type',digest_type,'alerts',alert_count,'regressions',regression_count,'sla_fail',sla_fail_count,'message',message,'at',generated_at) order by generated_at desc),'[]'::jsonb)
                from (select * from public.observability_alert_digests order by generated_at desc limit 6) dg),
    'backfill_plans', (select coalesce(jsonb_agg(jsonb_build_object('from',from_date,'to',to_date,'cadence',cadence,'planned_runs',planned_runs,'status',status) order by created_at desc),'[]'::jsonb) from public.observability_backfill_plans)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_observability_schedule_summary as
select s.schedule_key, s.schedule_type, s.enabled, jsonb_array_length(coalesce(s.chain_steps,'[]'::jsonb)) as chain_steps, s.description, s.created_at
from public.observability_schedules s;

create or replace view public.v2_observability_run_summary as
select r.id as run_id, r.run_type, r.triggered_by, r.status, r.started_at, r.finished_at,
  (select count(*) from public.observability_run_steps st where st.run_id=r.id) as step_count
from public.observability_runs r;

create or replace view public.v2_observability_snapshot_summary as
select o.run_id, o.snapshot_at, o.accuracy, o.risk, o.drift, o.confidence, o.promotion_score, o.readiness_state,
  o.alert_count, o.regression_count, o.stable_window_count, o.critical_window_count, o.sample_size
from public.observability_snapshots o;

create or replace view public.v2_observability_sla_summary as
select r.run_id, p.policy_key, r.sla_status, r.checks, r.evaluated_at
from public.observability_sla_results r left join public.observability_sla_policies p on p.id=r.policy_id;

create or replace view public.v2_observability_digest_summary as
select d.digest_type, d.alert_count, d.regression_count, d.sla_fail_count, d.message, d.generated_at
from public.observability_alert_digests d;

-- ─────────────────────────────────────────────────────────────────────
-- J. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_create_observability_schedule(text,text,text,date,date,text)',
    'public.admin_run_observability_snapshot(uuid,text,integer)',
    'public.admin_calculate_stability_streak(uuid)',
    'public.admin_evaluate_observability_sla(uuid,uuid)',
    'public.admin_generate_observability_digest(text,uuid)',
    'public.admin_ai_observability_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_run_observability_snapshot(uuid,text,integer) is
  'ALGO-6D — Shadow 관측 run + 9-step chain(계획) + Snapshot 저장. 기존 RPC 미변경, 실제 cron/운영 미반영.';
comment on function public.admin_evaluate_observability_sla(uuid,uuid) is
  'ALGO-6D — Shadow SLA 판정(sla_pass/warning/fail/insufficient_data). 실제 적용/전환 없음.';
