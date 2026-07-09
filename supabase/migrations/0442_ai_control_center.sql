-- 0442 — Phase ALGO-7A: AI Control Center (Unified AI Operations Dashboard, Shadow)
--
-- 목적:
--   ALGO-1 ~ ALGO-6 에서 구축된 모든 AI Engine(Streaming/Settlement/Learning/Prediction/Exposure/
--   Calibration/RL/Bandit/Ensemble/Decision/Observability/Governance)을 하나의 Control Center 에서
--   통합 관찰·분석한다. Engine Registry · Health · Pipeline Map · Incident · Metrics · Timeline 생성.
--
-- 절대 원칙:
--   • Shadow Only. Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance
--     Runtime 무변경. Production Apply/Canary 금지. Additive only. 모든 소스 테이블은 읽기 전용.
--   • Self-contained: 선행 Migration(0430~0441)이 적용되지 않은 환경에서도 단독 검증 가능해야 하므로
--     각 Engine 의 shadow 테이블 존재 여부를 to_regclass 로 방어적으로 probe 한다(present=false → UNKNOWN).
--   • Streaming/Settlement/Calibration 은 prod 에 실재하는 base 테이블에서 실 신호를 계산한다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers — 존재 probe / health band / incident priority / metric band
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_table_exists(p_rel text)
returns boolean language sql stable set search_path to 'public' as $$
  select to_regclass(p_rel) is not null;
$$;

create or replace function public._ai_health_band(p_score numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_score is null then 'UNKNOWN'
    when p_score >= 80 then 'READY'
    when p_score >= 50 then 'WARNING'
    else 'BLOCKED' end;
$$;

create or replace function public._ai_incident_priority(p_type text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_type
    when 'critical_events' then 'Critical'
    when 'regression'      then 'Critical'
    when 'sla_fail'        then 'High'
    when 'verification_delay' then 'High'
    when 'risk'            then 'High'
    when 'drift'           then 'Medium'
    when 'identity_mismatch' then 'Medium'
    when 'shadow_alert'    then 'Low'
    else 'Low' end;
$$;

create or replace function public._ai_metric_band(p_score numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_score is null then 'unknown'
    when p_score >= 0.75 then 'good'
    when p_score >= 0.4  then 'fair'
    else 'poor' end;
$$;

-- Streaming funnel 실 신호(선행 Migration 불요, base 테이블만 사용) — Health/Metrics/Incident 공용
create or replace function public._ai_stream_funnel(p_days integer default 30)
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select i.id, i.session_token, i.track_id, i.player_type,
      coalesce(i.verified_seconds,0) m_vsec,
      coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, coalesce(i.visibility_state,'visible') vis,
      i.heartbeat_verified, s.player_type s_ptype,
      coalesce(i.player_volume,1) vol, coalesce(i.player_muted,false) muted,
      i.ineligible_reason, coalesce(i.fraud_score,0) fraud, coalesce(i.dispute_status,'none') disp
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s'
      and i.created_at >= now() - make_interval(days => greatest(coalesce(p_days,30),1))
  ), f as (
    select
      count(*) play30s,
      count(*) filter (where heartbeat_verified is true and m_vsec>=30 and vis='visible') verified_actual,
      count(*) filter (where s_vsec>=30 and vis='visible' and hb>0) verified_cal,
      count(*) filter (where s_vsec>=30 and vis='visible' and hb>0
        and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM'])
        and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none') eligible_cal,
      count(*) filter (where s_vsec>=30 and vis='visible' and hb>0
        and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM'])
        and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none'
        and exists (select 1 from public.eligible_settlement_tracks est where est.track_id = base.track_id)) settlement_cal,
      count(*) filter (where s_vsec>=30 and m_vsec<30) verification_delay,
      count(*) filter (where s_ptype='USER' and player_type is distinct from 'USER') identity_mismatch
    from base
  )
  select to_jsonb(f) from f;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_control_center (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  overall_health numeric, overall_score numeric,
  engines_total integer, engines_ready integer, engines_warning integer,
  engines_blocked integer, engines_shadow integer, engines_unknown integer,
  incidents_total integer, incidents_critical integer,
  headline text, notes text, created_by uuid
);
create index if not exists acc_run_idx on public.ai_control_center(run_at desc);

create table if not exists public.ai_engine_registry (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  engine_key text not null, engine_name text, category text, layer text,
  probe_relation text, present boolean default false, status text, health_score numeric,
  row_count integer, note text, created_at timestamptz not null default now()
);
create index if not exists aer_run_idx on public.ai_engine_registry(run_id);

create table if not exists public.ai_engine_health (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  engine_key text not null, health_score numeric, latency_ms integer, status text,
  signal jsonb, note text, created_at timestamptz not null default now()
);
create index if not exists aeh_run_idx on public.ai_engine_health(run_id);

create table if not exists public.ai_pipeline_status (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  stage_order integer not null, stage_key text not null, stage_name text, engine_key text,
  health numeric, latency_ms integer, status text, throughput integer, note text,
  created_at timestamptz not null default now()
);
create index if not exists aps_run_idx on public.ai_pipeline_status(run_id, stage_order);

create table if not exists public.ai_incidents (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  incident_type text not null, engine_key text, priority text, severity_score numeric,
  cnt integer default 0, summary text, recommendation text, created_at timestamptz not null default now()
);
create index if not exists ain_run_idx on public.ai_incidents(run_id, priority);

create table if not exists public.ai_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  metric_key text not null, metric_label text, value numeric, unit text, band text,
  source text, note text, created_at timestamptz not null default now()
);
create index if not exists ams_run_idx on public.ai_metric_snapshots(run_id);

create table if not exists public.ai_control_timeline (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_control_center(id) on delete cascade,
  ts timestamptz not null default now(), category text, engine_key text, event text, detail text,
  created_at timestamptz not null default now()
);
create index if not exists act_run_idx on public.ai_control_timeline(run_id, ts desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_control_center','ai_engine_registry','ai_engine_health',
    'ai_pipeline_status','ai_incidents','ai_metric_snapshots','ai_control_timeline'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Health Engine + Registry — admin_generate_ai_health (run 생성)
--    12 Engine 을 probe 하여 Registry 등록 + Health Score 산출 + Control Center 헤더 집계
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_ai_health(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run uuid; v_f jsonb := public._ai_stream_funnel(p_days);
  r record; v_present boolean; v_cnt integer; v_status text; v_score numeric; v_note text; v_lat integer;
  v_va int := coalesce((v_f->>'verified_actual')::int,0); v_vc int := coalesce((v_f->>'verified_cal')::int,0);
  v_ec int := coalesce((v_f->>'eligible_cal')::int,0);  v_sc int := coalesce((v_f->>'settlement_cal')::int,0);
  v_p30 int := coalesce((v_f->>'play30s')::int,0);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  insert into public.ai_control_center(window_days) values (greatest(coalesce(p_days,30),1)) returning id into v_run;

  for r in
    select * from (values
      (1,'streaming','Streaming Engine','ingest','shadow','public.stream_ingest_v2'),
      (2,'settlement','Settlement Engine','settlement','shadow','public.eligible_settlement_tracks'),
      (3,'learning','Learning Memory','learning','shadow','public.learning_memory'),
      (4,'prediction','Prediction Engine','prediction','shadow','public.prediction_shadow_queue'),
      (5,'exposure','Exposure Engine','exposure','shadow','public.exposure_scores'),
      (6,'calibration','Calibration Engine','calibration','shadow','public.stream_shadow_calibration_runs'),
      (7,'rl','Reinforcement Learning','rl','shadow','public.reward_memory'),
      (8,'bandit','Contextual Bandit','rl','shadow','public.bandit_arms'),
      (9,'ensemble','Model Ensemble','rl','shadow','public.ensemble_registry'),
      (10,'decision','Decision Engine','decision','shadow','public.unified_decisions'),
      (11,'observability','Observability Scheduler','observability','shadow','public.observation_runs'),
      (12,'governance','AI Governance','governance','shadow','public.ai_governance_ledger')
    ) as e(ord, ekey, ename, cat, layer, probe)
  loop
    v_present := public._ai_table_exists(r.probe);
    v_cnt := 0;
    if v_present then execute format('select count(*) from %s', r.probe) into v_cnt; end if;
    v_lat := 8 + r.ord * 3;  -- shadow nominal latency (synthetic, 관찰용)

    if r.ekey = 'streaming' then
      if v_p30 = 0 then v_status:='SHADOW'; v_score:=null; v_note:='play_30s 이벤트 없음(window)';
      elsif v_va = 0 and v_vc > 0 then v_status:='WARNING'; v_score:=40;
        v_note:=format('verified_actual 0 → calibration 후보 %s (Verification Delay 병목)', v_vc);
      else v_score := round(100.0 * v_va / nullif(v_vc,0)); v_status := public._ai_health_band(v_score);
        v_note := format('verified_actual %s / calibrated %s', v_va, v_vc); end if;
    elsif r.ekey = 'settlement' then
      if v_ec = 0 then v_status:='SHADOW'; v_score:=null; v_note:='eligible 후보 없음 — settlement 평가 보류';
      else v_score := round(100.0 * v_sc / nullif(v_ec,0)); v_status := public._ai_health_band(v_score);
        v_note := format('settlement 후보 %s / eligible %s', v_sc, v_ec); end if;
    elsif v_present and v_cnt > 0 then
      v_status:='READY'; v_score:=85; v_note:=format('shadow materialized · rows=%s', v_cnt);
    elsif v_present then
      v_status:='SHADOW'; v_score:=60; v_note:='shadow layer 존재 · run 없음';
    else
      v_status:='UNKNOWN'; v_score:=null; v_note:=format('%s 미배포(this env)', r.probe);
    end if;

    insert into public.ai_engine_registry(run_id, engine_key, engine_name, category, layer, probe_relation, present, status, health_score, row_count, note)
      values (v_run, r.ekey, r.ename, r.cat, r.layer, r.probe, v_present, v_status, v_score, v_cnt, v_note);
    insert into public.ai_engine_health(run_id, engine_key, health_score, latency_ms, status, signal, note)
      values (v_run, r.ekey, v_score, v_lat, v_status,
        case r.ekey when 'streaming' then v_f when 'settlement' then v_f else jsonb_build_object('present',v_present,'rows',v_cnt) end, v_note);
  end loop;

  update public.ai_control_center set
    engines_total   = (select count(*) from public.ai_engine_registry where run_id=v_run),
    engines_ready   = (select count(*) from public.ai_engine_registry where run_id=v_run and status='READY'),
    engines_warning = (select count(*) from public.ai_engine_registry where run_id=v_run and status='WARNING'),
    engines_blocked = (select count(*) from public.ai_engine_registry where run_id=v_run and status='BLOCKED'),
    engines_shadow  = (select count(*) from public.ai_engine_registry where run_id=v_run and status='SHADOW'),
    engines_unknown = (select count(*) from public.ai_engine_registry where run_id=v_run and status='UNKNOWN'),
    overall_health  = (select round(avg(health_score),1) from public.ai_engine_registry where run_id=v_run and health_score is not null),
    overall_score   = (select round(avg(health_score),1) from public.ai_engine_registry where run_id=v_run and health_score is not null),
    headline = format('AI Music OS — %s engines / %s ready / verified %s→%s(cal)',
      (select count(*) from public.ai_engine_registry where run_id=v_run),
      (select count(*) from public.ai_engine_registry where run_id=v_run and status='READY'), v_va, v_vc)
  where id=v_run;

  insert into public.ai_control_timeline(run_id, ts, category, engine_key, event, detail)
  select v_run, now() - make_interval(secs => (12 - ord) * 30), 'engine', ekey,
    ename || ' ' || st, note from (
    select reg.engine_key ekey, reg.engine_name ename, reg.status st, reg.note,
      row_number() over (order by reg.created_at) ord
    from public.ai_engine_registry reg where reg.run_id=v_run) z;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'engines_total',(select count(*) from public.ai_engine_registry where run_id=v_run),
    'overall_health',(select overall_health from public.ai_control_center where id=v_run),
    'ready',(select count(*) from public.ai_engine_registry where run_id=v_run and status='READY'),
    'warning',(select count(*) from public.ai_engine_registry where run_id=v_run and status='WARNING'),
    'shadow',(select count(*) from public.ai_engine_registry where run_id=v_run and status='SHADOW'),
    'unknown',(select count(*) from public.ai_engine_registry where run_id=v_run and status='UNKNOWN'),
    'note','Shadow AI health — 실제 Runtime 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Pipeline Map — admin_generate_pipeline_status
--    Playback → Streaming → Verified → Settlement → Learning → Prediction → RL → Decision → Governance → Ready
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_pipeline_status(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_f jsonb; v_health numeric; v_status text; v_thru integer; v_ekey text; v_playback int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_control_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no control-center run — run admin_generate_ai_health first'; end if;
  delete from public.ai_pipeline_status where run_id=v_run;

  select h.signal into v_f from public.ai_engine_health h where h.run_id=v_run and h.engine_key='streaming' limit 1;
  select count(*) into v_playback from public.playback_events_v2;

  for r in
    select * from (values
      (1,'playback','Playback',   null::text),
      (2,'streaming','Streaming', 'streaming'),
      (3,'verified','Verified',   'streaming'),
      (4,'settlement','Settlement','settlement'),
      (5,'learning','Learning',   'learning'),
      (6,'prediction','Prediction','prediction'),
      (7,'rl','Reinforcement',    'rl'),
      (8,'decision','Decision',   'decision'),
      (9,'governance','Governance','governance'),
      (10,'ready','Ready',        null::text)
    ) as s(ord, skey, sname, ekey)
  loop
    v_ekey := r.ekey;
    if r.skey = 'playback' then
      v_thru := v_playback; v_health := case when v_playback>0 then 100 else null end;
      v_status := case when v_playback>0 then 'READY' else 'UNKNOWN' end;
    elsif r.skey = 'verified' then
      v_thru := coalesce((v_f->>'verified_cal')::int,0);
      v_health := case when coalesce((v_f->>'verified_cal')::int,0) > 0 then
        round(100.0 * coalesce((v_f->>'verified_actual')::int,0) / nullif((v_f->>'verified_cal')::int,0)) else null end;
      v_status := case when coalesce((v_f->>'verified_actual')::int,0)=0 and coalesce((v_f->>'verified_cal')::int,0)>0
        then 'WARNING' else public._ai_health_band(v_health) end;
    elsif r.skey = 'ready' then
      -- 종단 준비도: 모든 assessable engine 이 READY/SHADOW 이면 통과
      v_health := (select round(avg(health_score),1) from public.ai_engine_health where run_id=v_run and health_score is not null);
      v_status := case when exists(select 1 from public.ai_engine_registry where run_id=v_run and status='BLOCKED')
        then 'BLOCKED' when exists(select 1 from public.ai_engine_registry where run_id=v_run and status='WARNING')
        then 'WARNING' else 'SHADOW' end;
      v_thru := (select count(*) from public.ai_engine_registry where run_id=v_run and status in ('READY','SHADOW'));
    else
      select health_score, status into v_health, v_status from public.ai_engine_health where run_id=v_run and engine_key=v_ekey limit 1;
      v_status := coalesce(v_status,'UNKNOWN'); v_thru := null;
    end if;

    insert into public.ai_pipeline_status(run_id, stage_order, stage_key, stage_name, engine_key, health, latency_ms, status, throughput, note)
      values (v_run, r.ord, r.skey, r.sname, v_ekey, v_health, 6 + r.ord*4, coalesce(v_status,'UNKNOWN'), v_thru,
        format('stage %s · %s', r.ord, coalesce(v_ekey,'base')));
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'stages',(select count(*) from public.ai_pipeline_status where run_id=v_run),
    'blocked',(select count(*) from public.ai_pipeline_status where run_id=v_run and status='BLOCKED'),
    'warning',(select count(*) from public.ai_pipeline_status where run_id=v_run and status='WARNING'),
    'note','Shadow pipeline map — 실 Runtime 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Incident Center — admin_generate_ai_incidents
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_ai_incidents(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_f jsonb; v_vd int; v_im int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_control_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no control-center run'; end if;
  delete from public.ai_incidents where run_id=v_run;

  select h.signal into v_f from public.ai_engine_health h where h.run_id=v_run and h.engine_key='streaming' limit 1;
  v_vd := coalesce((v_f->>'verification_delay')::int,0);
  v_im := coalesce((v_f->>'identity_mismatch')::int,0);

  -- Verification Delay / Identity Mismatch (Streaming 실 신호)
  if v_vd > 0 then
    insert into public.ai_incidents(run_id, incident_type, engine_key, priority, severity_score, cnt, summary, recommendation)
    values (v_run, 'verification_delay','streaming', public._ai_incident_priority('verification_delay'), round(least(1.0, v_vd/10.0)::numeric,2), v_vd,
      format('%s play_30s milestone 가 session 확정 verified_seconds 대비 조기 동결', v_vd),
      'milestone verified_seconds 를 session heartbeat 확정값으로 back-fill');
  end if;
  if v_im > 0 then
    insert into public.ai_incidents(run_id, incident_type, engine_key, priority, severity_score, cnt, summary, recommendation)
    values (v_run, 'identity_mismatch','streaming', public._ai_incident_priority('identity_mismatch'), round(least(1.0, v_im/10.0)::numeric,2), v_im,
      format('%s 세션이 session=USER ↔ milestone=preview 로 라벨 불일치', v_im),
      'ingest milestone player_type 를 session.player_type 로 정규화');
  end if;

  -- Engine 상태 기반 incident (WARNING → shadow_alert, BLOCKED → critical/regression)
  insert into public.ai_incidents(run_id, incident_type, engine_key, priority, severity_score, cnt, summary, recommendation)
  select v_run, case when status='BLOCKED' then 'critical_events' else 'shadow_alert' end, engine_key,
    public._ai_incident_priority(case when status='BLOCKED' then 'critical_events' else 'shadow_alert' end),
    case when status='BLOCKED' then 0.9 else 0.3 end, 1,
    format('%s engine %s', engine_name, status),
    case when status='BLOCKED' then '즉시 점검 필요' else 'shadow 관찰 지속' end
  from public.ai_engine_registry where run_id=v_run and status in ('WARNING','BLOCKED');

  -- Governance/Observability 부재 시 SLA/Drift 관측 불가 표기
  if not public._ai_table_exists('public.ai_governance_ledger') then
    insert into public.ai_incidents(run_id, incident_type, engine_key, priority, severity_score, cnt, summary, recommendation)
    values (v_run, 'sla_fail','governance', public._ai_incident_priority('sla_fail'), 0.2, 0,
      'Governance ledger 미배포 — SLA/certificate 관측 보류(this env)', '선행 Migration 적용 시 SLA 관측 활성');
  end if;

  update public.ai_control_center set
    incidents_total    = (select count(*) from public.ai_incidents where run_id=v_run),
    incidents_critical = (select count(*) from public.ai_incidents where run_id=v_run and priority='Critical')
  where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'total',(select count(*) from public.ai_incidents where run_id=v_run),
    'critical',(select count(*) from public.ai_incidents where run_id=v_run and priority='Critical'),
    'high',(select count(*) from public.ai_incidents where run_id=v_run and priority='High'),
    'by_type',(select coalesce(jsonb_object_agg(incident_type, c),'{}'::jsonb) from (select incident_type, count(*) c from public.ai_incidents where run_id=v_run group by 1) z),
    'note','Shadow incidents — 실 Runtime 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. AI Metrics + Timeline — admin_generate_ai_metrics
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_ai_metrics(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_f jsonb; v_overall numeric;
  v_va int; v_vc int; v_ec int; v_sc int; v_p30 int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_control_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no control-center run'; end if;
  delete from public.ai_metric_snapshots where run_id=v_run;

  select h.signal into v_f from public.ai_engine_health h where h.run_id=v_run and h.engine_key='streaming' limit 1;
  v_p30:=coalesce((v_f->>'play30s')::int,0); v_va:=coalesce((v_f->>'verified_actual')::int,0);
  v_vc:=coalesce((v_f->>'verified_cal')::int,0); v_ec:=coalesce((v_f->>'eligible_cal')::int,0); v_sc:=coalesce((v_f->>'settlement_cal')::int,0);
  select overall_score into v_overall from public.ai_control_center where id=v_run;

  insert into public.ai_metric_snapshots(run_id, metric_key, metric_label, value, unit, band, source, note)
  values
    (v_run,'verified_rate','Verified Rate', round((v_vc::numeric)/nullif(v_p30,0),4),'ratio', public._ai_metric_band(round((v_vc::numeric)/nullif(v_p30,0),4)),'stream_ingest_v2','calibrated verified / play_30s'),
    (v_run,'eligible_rate','Eligible Rate', round((v_ec::numeric)/nullif(v_vc,0),4),'ratio', public._ai_metric_band(round((v_ec::numeric)/nullif(v_vc,0),4)),'stream_ingest_v2','eligible / verified(cal)'),
    (v_run,'settlement_rate','Settlement Rate', round((v_sc::numeric)/nullif(v_ec,0),4),'ratio', public._ai_metric_band(round((v_sc::numeric)/nullif(v_ec,0),4)),'eligible_settlement_tracks','settlement / eligible(cal)'),
    (v_run,'overall_score','Overall Score', round(coalesce(v_overall,0)/100.0,4),'ratio', public._ai_metric_band(round(coalesce(v_overall,0)/100.0,4)),'ai_control_center','engine health 평균');

  -- source 테이블 부재 시 null 로 정직하게 표기하는 shadow metric (Prediction/Reward/Risk/Confidence/Decision/RL/Bandit)
  insert into public.ai_metric_snapshots(run_id, metric_key, metric_label, value, unit, band, source, note)
  select v_run, m.mkey, m.mlabel, null, 'ratio', 'unknown', m.src,
    case when public._ai_table_exists(m.src) then 'source materialized — snapshot 계산은 후속 Phase' else m.src||' 미배포(this env)' end
  from (values
    ('prediction_accuracy','Prediction Accuracy','public.prediction_shadow_queue'),
    ('reward','Reward','public.reward_memory'),
    ('rl_reward','RL Reward','public.reward_memory'),
    ('bandit_score','Bandit Score','public.bandit_arms'),
    ('risk','Risk','public.unified_decisions'),
    ('confidence','Confidence','public.unified_decisions'),
    ('decision_score','Decision Score','public.unified_decisions')
  ) as m(mkey, mlabel, src);

  -- Timeline: metric/incident 이벤트 추가
  insert into public.ai_control_timeline(run_id, ts, category, engine_key, event, detail)
  select v_run, now() - make_interval(secs => 5*rn), 'metric', 'control',
    metric_label || ' = ' || coalesce(value::text,'n/a'), 'band='||band
  from (select metric_label, value, band, row_number() over (order by created_at) rn from public.ai_metric_snapshots where run_id=v_run and value is not null) z;

  insert into public.ai_control_timeline(run_id, ts, category, engine_key, event, detail)
  select v_run, now() - make_interval(secs => 3*rn), 'incident', engine_key,
    priority || ' · ' || incident_type, summary
  from (select engine_key, priority, incident_type, summary, row_number() over (order by created_at) rn from public.ai_incidents where run_id=v_run) z;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'metrics',(select count(*) from public.ai_metric_snapshots where run_id=v_run),
    'computed',(select count(*) from public.ai_metric_snapshots where run_id=v_run and value is not null),
    'timeline',(select count(*) from public.ai_control_timeline where run_id=v_run),
    'note','Shadow metrics/timeline — 실 Runtime 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Overview — admin_ai_control_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_control_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.ai_control_center order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'summary', (select to_jsonb(c) from (select run_at, window_days, overall_health, overall_score, engines_total, engines_ready, engines_warning, engines_blocked, engines_shadow, engines_unknown, incidents_total, incidents_critical, headline from public.ai_control_center where id=v_run) c),
    'engines', (select coalesce(jsonb_agg(jsonb_build_object('key',engine_key,'name',engine_name,'category',category,'present',present,'status',status,'health',health_score,'rows',row_count,'note',note) order by created_at),'[]'::jsonb) from public.ai_engine_registry where run_id=v_run),
    'health', (select coalesce(jsonb_agg(jsonb_build_object('key',engine_key,'score',health_score,'latency',latency_ms,'status',status,'note',note) order by health_score desc nulls last),'[]'::jsonb) from public.ai_engine_health where run_id=v_run),
    'pipeline', (select coalesce(jsonb_agg(jsonb_build_object('order',stage_order,'key',stage_key,'name',stage_name,'engine',engine_key,'health',health,'latency',latency_ms,'status',status,'throughput',throughput) order by stage_order),'[]'::jsonb) from public.ai_pipeline_status where run_id=v_run),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('type',incident_type,'engine',engine_key,'priority',priority,'severity',severity_score,'count',cnt,'summary',summary,'recommendation',recommendation) order by case priority when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end, cnt desc),'[]'::jsonb) from public.ai_incidents where run_id=v_run),
    'metrics', (select coalesce(jsonb_agg(jsonb_build_object('key',metric_key,'label',metric_label,'value',value,'unit',unit,'band',band,'source',source,'note',note) order by created_at),'[]'::jsonb) from public.ai_metric_snapshots where run_id=v_run),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('ts',ts,'category',category,'engine',engine_key,'event',event,'detail',detail) order by ts desc),'[]'::jsonb) from (select * from public.ai_control_timeline where run_id=v_run order by ts desc limit 40) t)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_control_summary as
select c.id run_id, c.run_at, c.overall_health, c.overall_score, c.engines_total, c.engines_ready,
  c.engines_warning, c.engines_blocked, c.engines_shadow, c.engines_unknown, c.incidents_total, c.incidents_critical, c.headline
from public.ai_control_center c;

create or replace view public.v2_ai_health_summary as
select h.run_id, h.engine_key, r.engine_name, r.category, h.health_score, h.latency_ms, h.status, r.present
from public.ai_engine_health h
left join public.ai_engine_registry r on r.run_id=h.run_id and r.engine_key=h.engine_key;

create or replace view public.v2_ai_pipeline_summary as
select p.run_id, p.stage_order, p.stage_key, p.stage_name, p.engine_key, p.health, p.latency_ms, p.status, p.throughput
from public.ai_pipeline_status p;

create or replace view public.v2_ai_incident_summary as
select i.run_id, i.incident_type, i.engine_key, i.priority, i.severity_score, i.cnt, i.summary, i.recommendation
from public.ai_incidents i;

create or replace view public.v2_ai_metric_summary as
select m.run_id, m.metric_key, m.metric_label, m.value, m.unit, m.band, m.source
from public.ai_metric_snapshots m;

-- ─────────────────────────────────────────────────────────────────────
-- I. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_table_exists(text)',
    'public._ai_health_band(numeric)',
    'public._ai_incident_priority(text)',
    'public._ai_metric_band(numeric)',
    'public._ai_stream_funnel(integer)',
    'public.admin_generate_ai_health(integer)',
    'public.admin_generate_pipeline_status(uuid)',
    'public.admin_generate_ai_incidents(uuid)',
    'public.admin_generate_ai_metrics(uuid)',
    'public.admin_ai_control_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_ai_health(integer) is
  'ALGO-7A — AI Control Center Health. 12 Engine probe + health/registry + run 생성. Shadow only — 실 Runtime 미반영.';
comment on function public.admin_ai_control_overview() is
  'ALGO-7A — AI Control Center overview. Registry/Health/Pipeline/Incident/Metrics/Timeline 통합 조회. 읽기 전용.';
