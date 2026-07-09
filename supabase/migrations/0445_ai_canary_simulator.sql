-- 0445 — Phase ALGO-7D: AI Canary Readiness Simulator (Shadow) — Canary Simulation Layer
--
-- 목적:
--   ALGO-7C Release Governance 결과를 기반으로, 실제 운영에 적용하지 않고 Canary 배포(1/5/10/25/50/100%)를
--   완전히 Shadow 로 시뮬레이션한다. Traffic Planner · Impact Predictor · Safety Gate ·
--   Rollback Trigger Simulation · Canary Timeline · Certificate 생성.
--
-- 절대 원칙:
--   • Shadow Only. Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance
--     Runtime 무변경. Production Apply/Canary/Release/Rollback/Policy Apply 금지. Additive only.
--   • Self-contained: 선행 Migration(0430~0444) 미적용 환경에서도 단독 검증 가능하도록 base 테이블
--     (stream_ingest_v2/stream_sessions_v2/stream_events/eligible_settlement_tracks/stores/tracks)에서 trafic 을 도출.
--   • 모든 impact/gate/rollback 은 결정론적 shadow 추정치이며 실제 Runtime 에는 어떤 영향도 없다.
--   • ai_canary_timeline 은 append-only (BEFORE UPDATE/DELETE 차단).

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_table_exists(p_rel text)
returns boolean language sql stable set search_path to 'public' as $$
  select to_regclass(p_rel) is not null;
$$;

create or replace function public._cnr_stream_signal()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select i.track_id, coalesce(i.verified_seconds,0) m_vsec, coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, coalesce(i.visibility_state,'visible') vis, i.heartbeat_verified, s.player_type s_ptype, i.player_type,
      coalesce(i.player_volume,1) vol, coalesce(i.player_muted,false) muted, i.ineligible_reason, coalesce(i.fraud_score,0) fraud, coalesce(i.dispute_status,'none') disp
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= now() - interval '30 days'
  )
  select jsonb_build_object(
    'verified_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0),
    'eligible_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0 and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none'),
    'settlement_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0 and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none' and exists (select 1 from public.eligible_settlement_tracks est where est.track_id = base.track_id))
  ) from base;
$$;

create or replace function public._cnr_risk_grade(p_score numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_score is null then 'low' when p_score >= 0.75 then 'critical' when p_score >= 0.55 then 'high'
    when p_score >= 0.35 then 'medium' else 'low' end;
$$;

create or replace function public._cnr_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'append-only: % on % is forbidden (ALGO-7D)', TG_OP, TG_TABLE_NAME using errcode='0A000';
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_canary_plans (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  store_count integer, listener_count integer, track_count integer, expected_events bigint,
  stages jsonb, status text, headline text, notes text, created_by uuid
);
create index if not exists acp_run_idx on public.ai_canary_plans(run_at desc);

create table if not exists public.ai_canary_simulations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_canary_plans(id) on delete cascade,
  stage_pct integer not null, traffic_events bigint, traffic_stores integer, traffic_listeners integer, traffic_tracks integer,
  gate_result text, rollback_triggered boolean default false, note text, created_at timestamptz not null default now()
);
create index if not exists acs_run_idx on public.ai_canary_simulations(run_id, stage_pct);

create table if not exists public.ai_canary_impacts (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_canary_plans(id) on delete cascade,
  stage_pct integer not null, metric text not null, metric_kind text, baseline numeric, predicted numeric, delta numeric,
  direction text, note text, created_at timestamptz not null default now()
);
create index if not exists aci_run_idx on public.ai_canary_impacts(run_id, stage_pct, metric);

create table if not exists public.ai_canary_gate_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_canary_plans(id) on delete cascade,
  stage_pct integer not null, risk_gate boolean, drift_gate boolean, confidence_gate boolean, sla_gate boolean,
  governance_gate text, approval_gate text, policy_gate text, rollback_gate text, gate_state text,
  note text, created_at timestamptz not null default now()
);
create index if not exists acg_run_idx on public.ai_canary_gate_checks(run_id, stage_pct);

create table if not exists public.ai_canary_rollback_simulations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_canary_plans(id) on delete cascade,
  stage_pct integer not null, condition text not null, triggered boolean default false, threshold numeric, observed numeric,
  reason text, created_at timestamptz not null default now()
);
create index if not exists acrs_run_idx on public.ai_canary_rollback_simulations(run_id, stage_pct);

create table if not exists public.ai_canary_timeline (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_canary_plans(id) on delete cascade,
  ts timestamptz not null default now(), stage_pct integer, category text, event text, detail text,
  created_at timestamptz not null default now()
);
create index if not exists act7d_run_idx on public.ai_canary_timeline(run_id, ts desc);

create table if not exists public.ai_canary_certificates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_canary_plans(id) on delete cascade,
  max_safe_stage integer, overall_gate text, overall_risk text, rollback_conditions integer,
  gate_summary jsonb, impact_summary jsonb, certificate_hash text, note text, created_at timestamptz not null default now()
);
create index if not exists acc7d_run_idx on public.ai_canary_certificates(run_id);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only trigger (timeline)
-- ─────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ai_canary_timeline_append_only') then
    create trigger ai_canary_timeline_append_only before update or delete
      on public.ai_canary_timeline for each row execute function public._cnr_append_only();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_canary_plans','ai_canary_simulations','ai_canary_impacts','ai_canary_gate_checks',
    'ai_canary_rollback_simulations','ai_canary_timeline','ai_canary_certificates'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Traffic Planner — admin_generate_canary_plan (run 생성)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_canary_plan(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_events bigint; v_tracks integer; v_listeners integer; v_stores integer := 0; s integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select count(*) into v_events from public.stream_events;
  select count(distinct track_id) into v_tracks from public.stream_ingest_v2;
  select count(distinct session_token) into v_listeners from public.stream_sessions_v2;
  -- store 수 (store registry 테이블명이 환경마다 달라 우선순위 probe: 등록 registry 우선, 재생상태는 후순위)
  if public._ai_table_exists('public.franchise_stores') then execute 'select count(*) from public.franchise_stores' into v_stores;
  elsif public._ai_table_exists('public.ai_store_profiles') then execute 'select count(*) from public.ai_store_profiles' into v_stores;
  elsif public._ai_table_exists('public.store_now_playing') then execute 'select count(*) from public.store_now_playing' into v_stores;
  end if;

  insert into public.ai_canary_plans(window_days, store_count, listener_count, track_count, expected_events, stages, status, headline)
  values (greatest(coalesce(p_days,30),1), v_stores, v_listeners, v_tracks, v_events,
    jsonb_build_array(1,5,10,25,50,100), 'simulated',
    format('Canary Simulation — stores %s · listeners %s · tracks %s · events %s (Shadow)', v_stores, v_listeners, v_tracks, v_events))
  returning id into v_run;

  foreach s in array array[1,5,10,25,50,100] loop
    insert into public.ai_canary_simulations(run_id, stage_pct, traffic_events, traffic_stores, traffic_listeners, traffic_tracks, gate_result, note)
    values (v_run, s, (v_events * s / 100), (v_stores * s / 100), (v_listeners * s / 100), (v_tracks * s / 100), 'pending',
      format('%s%% shadow traffic', s));
    insert into public.ai_canary_timeline(run_id, ts, stage_pct, category, event, detail)
      values (v_run, now(), s, 'plan', 'stage '||s||'% planned', 'shadow traffic sized');
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,'stores',v_stores,'listeners',v_listeners,'tracks',v_tracks,'events',v_events,
    'stages',6,'note','Shadow canary plan — 실제 canary 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Impact Predictor — admin_generate_canary_impact
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_canary_impact(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_sig jsonb := public._cnr_stream_signal();
  v_vc int := coalesce((v_sig->>'verified_cal')::int,0); v_ec int := coalesce((v_sig->>'eligible_cal')::int,0); v_sc int := coalesce((v_sig->>'settlement_cal')::int,0);
  s integer; m record; v_p numeric; v_base numeric; v_pred numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_canary_plans order by run_at desc limit 1));
  if v_run is null then raise exception 'no canary plan — run admin_generate_canary_plan first'; end if;
  delete from public.ai_canary_impacts where run_id=v_run;

  foreach s in array array[1,5,10,25,50,100] loop
    v_p := s / 100.0;
    for m in
      select * from (values
        ('verified','volume', v_vc::numeric, 0::numeric),
        ('eligible','volume', v_ec::numeric, 0::numeric),
        ('settlement','volume', v_sc::numeric, 0::numeric),
        ('reward','quality', 0.50, 0.10),
        ('prediction','quality', 0.70, -0.05),
        ('risk','quality', 0.20, 0.50),
        ('confidence','quality', 0.80, -0.25),
        ('decision','quality', 0.60, -0.10),
        ('drift','quality', 0.05, 0.30)
      ) as x(metric, kind, base, slope)
    loop
      v_base := m.base;
      v_pred := case when m.kind='volume' then round(m.base * v_p) else round((m.base + m.slope * v_p)::numeric, 3) end;
      insert into public.ai_canary_impacts(run_id, stage_pct, metric, metric_kind, baseline, predicted, delta, direction, note)
      values (v_run, s, m.metric, m.kind, v_base, v_pred, round((v_pred - v_base)::numeric,3),
        case when v_pred > v_base then 'up' when v_pred < v_base then 'down' else 'flat' end,
        case when m.kind='volume' then 'canary 대상 후보(scaled)' else 'shadow 추정치' end);
    end loop;
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,'rows',(select count(*) from public.ai_canary_impacts where run_id=v_run),
    'note','Shadow impact prediction — 실제 반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Safety Gate + Rollback Trigger Simulation — admin_run_canary_simulation
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_canary_simulation(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; s integer; v_risk numeric; v_drift numeric; v_conf numeric; v_pred numeric;
  v_rg boolean; v_dg boolean; v_cg boolean; v_sg boolean; v_gate text; v_rb_any boolean;
  v_gov boolean := public._ai_table_exists('public.ai_governance_ledger');
  v_gov_g text; v_appr_g text; v_pol_g text; v_rbk_g text;
  c_risk numeric := 0.70; c_drift numeric := 0.30; c_conf numeric := 0.60; c_sla numeric := 0.95; v_sla numeric := 0.98;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_canary_plans order by run_at desc limit 1));
  if v_run is null then raise exception 'no canary plan'; end if;
  delete from public.ai_canary_gate_checks where run_id=v_run;
  delete from public.ai_canary_rollback_simulations where run_id=v_run;

  -- governance/approval/policy/rollback gate 는 stage 무관 (7C shadow 상태 반영: 미승인/미검토 → blocked/pending)
  v_gov_g  := case when v_gov then 'pass' else 'unavailable' end;
  v_appr_g := 'pending';       -- 자동 승인 금지 — human approval 미이행
  v_pol_g  := 'needs_review';  -- policy human review 미이행
  v_rbk_g  := 'ready';         -- rollback plan(sim) 준비됨

  foreach s in array array[1,5,10,25,50,100] loop
    select predicted into v_risk from public.ai_canary_impacts where run_id=v_run and stage_pct=s and metric='risk';
    select predicted into v_drift from public.ai_canary_impacts where run_id=v_run and stage_pct=s and metric='drift';
    select predicted into v_conf from public.ai_canary_impacts where run_id=v_run and stage_pct=s and metric='confidence';
    select predicted into v_pred from public.ai_canary_impacts where run_id=v_run and stage_pct=s and metric='prediction';
    v_risk := coalesce(v_risk,0); v_drift := coalesce(v_drift,0); v_conf := coalesce(v_conf,1); v_pred := coalesce(v_pred,1);

    v_rg := v_risk <= c_risk; v_dg := v_drift <= c_drift; v_cg := v_conf >= c_conf; v_sg := v_sla >= c_sla;
    -- overall gate: threshold gate 통과 + governance/approval/policy 모두 pass 여야 진행 가능
    v_gate := case when not (v_rg and v_dg and v_cg and v_sg) then 'threshold_blocked'
      when v_gov_g <> 'pass' or v_appr_g <> 'approved' or v_pol_g <> 'compliant' then 'governance_blocked'
      else 'pass' end;

    insert into public.ai_canary_gate_checks(run_id, stage_pct, risk_gate, drift_gate, confidence_gate, sla_gate,
      governance_gate, approval_gate, policy_gate, rollback_gate, gate_state, note)
    values (v_run, s, v_rg, v_dg, v_cg, v_sg, v_gov_g, v_appr_g, v_pol_g, v_rbk_g, v_gate,
      format('risk=%s drift=%s conf=%s', v_risk, v_drift, v_conf));

    -- Rollback trigger simulation (조건별)
    v_rb_any := false;
    insert into public.ai_canary_rollback_simulations(run_id, stage_pct, condition, triggered, threshold, observed, reason)
    values
      (v_run, s, 'risk_spike',         v_risk > 0.65,  0.65, v_risk,  case when v_risk>0.65 then 'risk 임계 초과' else 'ok' end),
      (v_run, s, 'critical_incident',  v_risk > 0.70,  0.70, v_risk,  case when v_risk>0.70 then 'critical risk' else 'ok' end),
      (v_run, s, 'prediction_collapse',v_pred < 0.60,  0.60, v_pred,  case when v_pred<0.60 then 'prediction 붕괴' else 'ok' end),
      (v_run, s, 'drift_explosion',    v_drift > 0.30, 0.30, v_drift, case when v_drift>0.30 then 'drift 폭발' else 'ok' end),
      (v_run, s, 'confidence_collapse',v_conf < 0.55,  0.55, v_conf,  case when v_conf<0.55 then 'confidence 붕괴' else 'ok' end);
    select bool_or(triggered) into v_rb_any from public.ai_canary_rollback_simulations where run_id=v_run and stage_pct=s;

    update public.ai_canary_simulations set gate_result=v_gate, rollback_triggered=coalesce(v_rb_any,false) where run_id=v_run and stage_pct=s;

    insert into public.ai_canary_timeline(run_id, ts, stage_pct, category, event, detail)
      values (v_run, now(), s, 'simulation', 'stage '||s||'% → '||v_gate, case when v_rb_any then 'rollback would trigger' else 'no rollback' end);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'gates',(select coalesce(jsonb_object_agg(gate_state,c),'{}'::jsonb) from (select gate_state, count(*) c from public.ai_canary_gate_checks where run_id=v_run group by 1) z),
    'rollback_stages',(select count(distinct stage_pct) from public.ai_canary_rollback_simulations where run_id=v_run and triggered),
    'note','Shadow safety gate + rollback simulation — 실제 실행 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Certificate — admin_generate_canary_certificate
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_canary_certificate(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_max_safe integer; v_overall text; v_risk100 numeric; v_orisk text; v_rbcond integer; v_hash text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_canary_plans order by run_at desc limit 1));
  if v_run is null then raise exception 'no canary plan'; end if;
  delete from public.ai_canary_certificates where run_id=v_run;

  -- threshold 기준 최대 안전 stage (risk/drift/confidence/sla 모두 통과하는 최고 %)
  select coalesce(max(stage_pct),0) into v_max_safe from public.ai_canary_gate_checks
    where run_id=v_run and risk_gate and drift_gate and confidence_gate and sla_gate;
  -- overall gate: 어느 stage 든 governance_blocked 이면 blocked
  select case when bool_or(gate_state='pass') and not bool_or(gate_state like '%blocked') then 'pass'
    when bool_or(gate_state='governance_blocked') then 'governance_blocked' else 'threshold_blocked' end
    into v_overall from public.ai_canary_gate_checks where run_id=v_run;
  select predicted into v_risk100 from public.ai_canary_impacts where run_id=v_run and stage_pct=100 and metric='risk';
  v_orisk := public._cnr_risk_grade(v_risk100);
  select count(distinct stage_pct) into v_rbcond from public.ai_canary_rollback_simulations where run_id=v_run and triggered;

  v_hash := md5(v_run::text||'|'||coalesce(v_max_safe,0)||'|'||coalesce(v_overall,'')||'|'||coalesce(v_orisk,''));

  insert into public.ai_canary_certificates(run_id, max_safe_stage, overall_gate, overall_risk, rollback_conditions,
    gate_summary, impact_summary, certificate_hash, note)
  values (v_run, v_max_safe, v_overall, v_orisk, coalesce(v_rbcond,0),
    (select coalesce(jsonb_object_agg(gate_state,c),'{}'::jsonb) from (select gate_state, count(*) c from public.ai_canary_gate_checks where run_id=v_run group by 1) z),
    (select coalesce(jsonb_agg(jsonb_build_object('stage',stage_pct,'risk',predicted) order by stage_pct),'[]'::jsonb) from public.ai_canary_impacts where run_id=v_run and metric='risk'),
    v_hash, 'AI Canary Shadow Certificate — 실제 배포 효력 없음');

  insert into public.ai_canary_timeline(run_id, ts, stage_pct, category, event, detail)
    values (v_run, now(), v_max_safe, 'certificate', 'canary certificate', 'max_safe='||v_max_safe||'% overall='||v_overall);

  update public.ai_canary_plans set status = case when v_overall='pass' then 'sim_pass' else 'sim_blocked' end where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'max_safe_stage',v_max_safe,'overall_gate',v_overall,
    'overall_risk',v_orisk,'rollback_conditions',v_rbcond,'certificate_hash',left(v_hash,12),
    'note','Shadow canary certificate — 실제 배포 효력 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview — admin_ai_canary_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_canary_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.ai_canary_plans order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'plan', (select to_jsonb(p) from (select run_at, window_days, store_count, listener_count, track_count, expected_events, stages, status, headline from public.ai_canary_plans where id=v_run) p),
    'simulations', (select coalesce(jsonb_agg(jsonb_build_object('stage',stage_pct,'events',traffic_events,'stores',traffic_stores,'listeners',traffic_listeners,'tracks',traffic_tracks,'gate',gate_result,'rollback',rollback_triggered) order by stage_pct),'[]'::jsonb) from public.ai_canary_simulations where run_id=v_run),
    'impacts', (select coalesce(jsonb_agg(jsonb_build_object('stage',stage_pct,'metric',metric,'kind',metric_kind,'baseline',baseline,'predicted',predicted,'delta',delta,'direction',direction) order by stage_pct, metric),'[]'::jsonb) from public.ai_canary_impacts where run_id=v_run),
    'gates', (select coalesce(jsonb_agg(jsonb_build_object('stage',stage_pct,'risk',risk_gate,'drift',drift_gate,'confidence',confidence_gate,'sla',sla_gate,'governance',governance_gate,'approval',approval_gate,'policy',policy_gate,'rollback',rollback_gate,'state',gate_state) order by stage_pct),'[]'::jsonb) from public.ai_canary_gate_checks where run_id=v_run),
    'rollback_sims', (select coalesce(jsonb_agg(jsonb_build_object('stage',stage_pct,'condition',condition,'triggered',triggered,'threshold',threshold,'observed',observed,'reason',reason) order by stage_pct, condition),'[]'::jsonb) from public.ai_canary_rollback_simulations where run_id=v_run),
    'certificate', (select to_jsonb(c) from (select max_safe_stage, overall_gate, overall_risk, rollback_conditions, gate_summary, impact_summary, left(certificate_hash,12) as hash from public.ai_canary_certificates where run_id=v_run order by created_at desc limit 1) c),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('ts',ts,'stage',stage_pct,'category',category,'event',event,'detail',detail) order by ts desc),'[]'::jsonb) from (select * from public.ai_canary_timeline where run_id=v_run order by ts desc limit 50) t)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_canary_summary as
select p.id run_id, p.run_at, p.store_count, p.listener_count, p.track_count, p.expected_events, p.status, p.headline
from public.ai_canary_plans p;

create or replace view public.v2_ai_canary_impact_summary as
select i.run_id, i.stage_pct, i.metric, i.metric_kind, i.baseline, i.predicted, i.delta, i.direction
from public.ai_canary_impacts i;

create or replace view public.v2_ai_canary_gate_summary as
select g.run_id, g.stage_pct, g.risk_gate, g.drift_gate, g.confidence_gate, g.sla_gate,
  g.governance_gate, g.approval_gate, g.policy_gate, g.rollback_gate, g.gate_state
from public.ai_canary_gate_checks g;

create or replace view public.v2_ai_canary_certificate_summary as
select c.run_id, c.max_safe_stage, c.overall_gate, c.overall_risk, c.rollback_conditions, c.certificate_hash
from public.ai_canary_certificates c;

-- ─────────────────────────────────────────────────────────────────────
-- J. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_table_exists(text)',
    'public._cnr_stream_signal()',
    'public._cnr_risk_grade(numeric)',
    'public.admin_generate_canary_plan(integer)',
    'public.admin_generate_canary_impact(uuid)',
    'public.admin_run_canary_simulation(uuid)',
    'public.admin_generate_canary_certificate(uuid)',
    'public.admin_ai_canary_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_canary_plan(integer) is
  'ALGO-7D — Canary Traffic Planner. base 테이블에서 stores/listeners/tracks/events 도출 후 1/5/10/25/50/100% shadow traffic 산출. 실제 canary 없음.';
comment on function public.admin_run_canary_simulation(uuid) is
  'ALGO-7D — Safety Gate + Rollback Trigger Simulation. stage별 risk/drift/confidence/sla + governance/approval/policy gate 계산. 실제 실행 없음.';
comment on function public.admin_ai_canary_overview() is
  'ALGO-7D — AI Canary Simulator overview. Plan/Simulation/Impact/Gate/Rollback/Timeline/Certificate 통합 조회. 읽기 전용.';
