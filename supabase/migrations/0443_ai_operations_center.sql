-- 0443 — Phase ALGO-7B: AI Operations Center (Shadow)
--
-- 목적:
--   ALGO-7A AI Control Center 위에서 AI Music OS 의 운영·배포·승인·Rollback·Policy 를 통합 관리하는
--   운영 관제센터를 구축한다. Release Manager · Rollback Center · Maintenance · Incident Manager ·
--   Policy Manager · Approval Queue · Operation Timeline(append-only).
--
-- 절대 원칙:
--   • Shadow Only. Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance
--     Runtime 무변경. Production Apply/Canary/실제 Release/실제 Rollback/Policy Apply 금지. Additive only.
--   • Self-contained: 선행 Migration(0430~0442) 미적용 환경에서도 단독 검증 가능하도록 to_regclass 로
--     component 존재를 방어적으로 probe 한다.
--   • Release/Rollback/Policy/Approval 은 전부 Shadow 상태로만 기록한다. 실제 운영 변경은 수행하지 않는다.
--   • *_history / operation_timeline 은 append-only (BEFORE UPDATE/DELETE 차단).

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_table_exists(p_rel text)
returns boolean language sql stable set search_path to 'public' as $$
  select to_regclass(p_rel) is not null;
$$;

-- Streaming 실 신호(base 테이블) — self-contained
create or replace function public._ops_stream_signal()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select coalesce(i.verified_seconds,0) m_vsec, coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, coalesce(i.visibility_state,'visible') vis, i.heartbeat_verified
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= now() - interval '30 days'
  )
  select jsonb_build_object(
    'play30s', count(*),
    'verified_actual', count(*) filter (where heartbeat_verified is true and m_vsec>=30 and vis='visible'),
    'verified_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0)
  ) from base;
$$;

create or replace function public._ops_release_stage(p_present boolean, p_status text)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when not p_present then 'Rejected'
    when p_status = 'BLOCKED' then 'Blocked'
    when p_status = 'WARNING' then 'Ready for Review'
    when p_status = 'READY' then 'Ready for Canary'
    when p_status = 'SHADOW' then 'Shadow Candidate'
    else 'Release Candidate' end;
$$;

create or replace function public._ops_release_readiness(p_stage text)
returns integer language sql immutable set search_path to 'public' as $$
  select case p_stage
    when 'Ready for Canary' then 90 when 'Ready for Review' then 65 when 'Release Candidate' then 75
    when 'Shadow Candidate' then 50 when 'Blocked' then 30 when 'Rejected' then 0 else 40 end;
$$;

create or replace function public._ops_incident_priority(p_type text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_type
    when 'blocked_component' then 'Critical' when 'verification_delay' then 'High'
    when 'identity_mismatch' then 'Medium' when 'shadow_alert' then 'Low' else 'Low' end;
$$;

-- Append-only 차단 트리거
create or replace function public._ops_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'append-only: % on % is forbidden (ALGO-7B ledger)', TG_OP, TG_TABLE_NAME using errcode='0A000';
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_operations_center (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  release_total integer, release_ready integer, release_blocked integer,
  rollback_plans integer, policies_total integer, incidents_total integer, incidents_critical integer,
  approvals_pending integer, maintenance_windows integer, headline text, notes text, created_by uuid
);
create index if not exists aoc_run_idx on public.ai_operations_center(run_at desc);

create table if not exists public.ai_release_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  component text not null, version_tag text, present boolean default false, engine_status text,
  stage text, readiness_score integer, blockers jsonb, note text, created_at timestamptz not null default now()
);
create index if not exists arc_run_idx on public.ai_release_candidates(run_id);

create table if not exists public.ai_release_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_operations_center(id) on delete cascade,
  component text, action text, stage text, actor text, shadow boolean default true,
  detail text, created_at timestamptz not null default now()
);
create index if not exists arh_run_idx on public.ai_release_history(run_id, created_at desc);

create table if not exists public.ai_rollback_plans (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  component text not null, target_version text, reason text, risk text, simulation_only boolean default true,
  steps jsonb, dependencies jsonb, checklist jsonb, note text, created_at timestamptz not null default now()
);
create index if not exists arp_run_idx on public.ai_rollback_plans(run_id);

create table if not exists public.ai_rollback_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_operations_center(id) on delete cascade,
  component text, action text, simulated boolean default true, result text,
  detail text, created_at timestamptz not null default now()
);
create index if not exists arhh_run_idx on public.ai_rollback_history(run_id, created_at desc);

create table if not exists public.ai_maintenance_windows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  window_type text not null, status text, scope text, executed boolean default false,
  note text, created_at timestamptz not null default now()
);
create index if not exists amw_run_idx on public.ai_maintenance_windows(run_id);

create table if not exists public.ai_incident_center (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  incident_type text not null, component text, priority text, state text default 'Open',
  cnt integer default 1, summary text, recommendation text, created_at timestamptz not null default now()
);
create index if not exists aic_run_idx on public.ai_incident_center(run_id, priority);

create table if not exists public.ai_policy_registry (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  policy_key text not null, domain text, current_version integer, checksum text, note text,
  created_at timestamptz not null default now()
);
create index if not exists apr_run_idx on public.ai_policy_registry(run_id);

create table if not exists public.ai_policy_versions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  policy_key text not null, version integer not null, params jsonb, checksum text, applied boolean default false,
  created_at timestamptz not null default now()
);
create index if not exists apv_run_idx on public.ai_policy_versions(run_id, policy_key, version);

create table if not exists public.ai_policy_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_operations_center(id) on delete cascade,
  policy_key text, from_version integer, to_version integer, diff jsonb, actor text, shadow boolean default true,
  note text, created_at timestamptz not null default now()
);
create index if not exists aph_run_idx on public.ai_policy_history(run_id, created_at desc);

create table if not exists public.ai_approval_queue (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_operations_center(id) on delete cascade,
  subject text not null, kind text, state text default 'Pending', priority text, shadow boolean default true,
  note text, created_at timestamptz not null default now()
);
create index if not exists aaq_run_idx on public.ai_approval_queue(run_id, state);

create table if not exists public.ai_operation_timeline (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_operations_center(id) on delete cascade,
  ts timestamptz not null default now(), category text, component text, event text, detail text,
  created_at timestamptz not null default now()
);
create index if not exists aot_run_idx on public.ai_operation_timeline(run_id, ts desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only triggers (history + timeline)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_release_history','ai_rollback_history','ai_policy_history','ai_operation_timeline'] loop
    if not exists (select 1 from pg_trigger where tgname = t||'_append_only') then
      execute format('create trigger %I before update or delete on public.%I for each row execute function public._ops_append_only()', t||'_append_only', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_operations_center','ai_release_candidates','ai_release_history','ai_rollback_plans',
    'ai_rollback_history','ai_maintenance_windows','ai_incident_center','ai_policy_registry','ai_policy_versions',
    'ai_policy_history','ai_approval_queue','ai_operation_timeline'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Release Manager — admin_generate_release_candidates (run 생성)
--    12 component probe → release stage/readiness + Approval Queue(Pending) + release_history(shadow)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_release_candidates(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_present boolean; v_cnt integer; v_status text; v_stage text; v_score integer;
  v_sig jsonb := public._ops_stream_signal(); v_va int := coalesce((v_sig->>'verified_actual')::int,0); v_vc int := coalesce((v_sig->>'verified_cal')::int,0);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  insert into public.ai_operations_center(window_days) values (greatest(coalesce(p_days,30),1)) returning id into v_run;

  for r in
    select * from (values
      (1,'streaming','public.stream_ingest_v2'),(2,'settlement','public.eligible_settlement_tracks'),
      (3,'learning','public.learning_memory'),(4,'prediction','public.prediction_shadow_queue'),
      (5,'exposure','public.exposure_scores'),(6,'calibration','public.stream_shadow_calibration_runs'),
      (7,'rl','public.reward_memory'),(8,'bandit','public.bandit_arms'),(9,'ensemble','public.ensemble_registry'),
      (10,'decision','public.unified_decisions'),(11,'observability','public.observation_runs'),(12,'governance','public.ai_governance_ledger')
    ) as c(ord, comp, probe)
  loop
    v_present := public._ai_table_exists(r.probe); v_cnt := 0;
    if v_present then execute format('select count(*) from %s', r.probe) into v_cnt; end if;
    -- component status (7A registry 규칙과 동일)
    if r.comp='streaming' then v_status := case when v_va=0 and v_vc>0 then 'WARNING' when v_vc=0 then 'SHADOW' else 'READY' end;
    elsif not v_present then v_status := 'UNKNOWN';
    elsif v_cnt>0 then v_status := 'READY'; else v_status := 'SHADOW'; end if;
    v_stage := public._ops_release_stage(v_present, v_status);
    v_score := public._ops_release_readiness(v_stage);

    insert into public.ai_release_candidates(run_id, component, version_tag, present, engine_status, stage, readiness_score, blockers, note)
      values (v_run, r.comp, 'shadow-'||to_char(now(),'YYYYMMDD'), v_present, v_status, v_stage, v_score,
        case when v_stage in ('Blocked','Rejected') then jsonb_build_array(case when not v_present then 'component 미배포' else 'open incident / bottleneck' end) else '[]'::jsonb end,
        format('%s · rows=%s · %s', v_status, v_cnt, v_stage));

    insert into public.ai_release_history(run_id, component, action, stage, actor, shadow, detail)
      values (v_run, r.comp, 'register_candidate', v_stage, 'system', true, 'shadow release candidate 등록 — 실제 release 없음');

    -- Approval Queue: review/canary 준비 후보만 Pending
    if v_stage in ('Ready for Review','Ready for Canary','Release Candidate') then
      insert into public.ai_approval_queue(run_id, subject, kind, state, priority, shadow, note)
        values (v_run, r.comp||' release ('||v_stage||')', 'release', 'Pending', case when v_stage='Ready for Canary' then 'High' else 'Medium' end, true, 'shadow approval — 실제 승인/release 없음');
    end if;

    insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'release', r.comp, r.comp||' → '||v_stage, 'shadow candidate');
  end loop;

  update public.ai_operations_center set
    release_total   = (select count(*) from public.ai_release_candidates where run_id=v_run),
    release_ready   = (select count(*) from public.ai_release_candidates where run_id=v_run and stage in ('Ready for Canary','Ready for Review','Release Candidate')),
    release_blocked = (select count(*) from public.ai_release_candidates where run_id=v_run and stage in ('Blocked','Rejected')),
    approvals_pending = (select count(*) from public.ai_approval_queue where run_id=v_run and state='Pending'),
    headline = format('AI Operations — %s candidates / %s ready / %s pending approval',
      (select count(*) from public.ai_release_candidates where run_id=v_run),
      (select count(*) from public.ai_release_candidates where run_id=v_run and stage in ('Ready for Canary','Ready for Review','Release Candidate')),
      (select count(*) from public.ai_approval_queue where run_id=v_run and state='Pending'))
  where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'candidates',(select count(*) from public.ai_release_candidates where run_id=v_run),
    'ready',(select count(*) from public.ai_release_candidates where run_id=v_run and stage in ('Ready for Canary','Ready for Review','Release Candidate')),
    'blocked',(select count(*) from public.ai_release_candidates where run_id=v_run and stage in ('Blocked','Rejected')),
    'approvals_pending',(select count(*) from public.ai_approval_queue where run_id=v_run and state='Pending'),
    'note','Shadow release manager — 실제 release/approval 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Rollback Center — admin_generate_rollback_plan (Simulation Only)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_rollback_plan(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_operations_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no operations run — run admin_generate_release_candidates first'; end if;
  delete from public.ai_rollback_plans where run_id=v_run;  -- working table (append-only 아님)

  for r in select component, present, engine_status, stage from public.ai_release_candidates where run_id=v_run
  loop
    insert into public.ai_rollback_plans(run_id, component, target_version, reason, risk, simulation_only, steps, dependencies, checklist, note)
    values (v_run, r.component, 'prev-shadow',
      case when r.stage in ('Blocked','Rejected') then 'component 미준비 — rollback 대비만' else 'shadow readiness 확보 — 표준 rollback 절차' end,
      case when r.engine_status='BLOCKED' then 'high' when r.engine_status='WARNING' then 'medium' else 'low' end, true,
      jsonb_build_array('freeze '||r.component||' shadow queue','snapshot 현재 shadow 상태','이전 shadow 버전으로 포인터 복원(simulation)','verify health','unfreeze'),
      jsonb_build_array(case when r.component in ('settlement','decision','governance') then 'streaming/verified 선행' else 'none' end),
      jsonb_build_object('health_checked', r.present, 'dependency_mapped', true, 'approval_required', true, 'executed', false),
      'Simulation Only — 실제 rollback 미실행');

    insert into public.ai_rollback_history(run_id, component, action, simulated, result, detail)
      values (v_run, r.component, 'simulate_rollback', true, 'ok', 'shadow rollback simulation — 실제 변경 없음');
    insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'rollback', r.component, r.component||' rollback plan (sim)', 'simulation only');
  end loop;

  update public.ai_operations_center set rollback_plans=(select count(*) from public.ai_rollback_plans where run_id=v_run) where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'plans',(select count(*) from public.ai_rollback_plans where run_id=v_run),
    'high_risk',(select count(*) from public.ai_rollback_plans where run_id=v_run and risk='high'),'note','Rollback simulation only — 실제 rollback 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Policy Manager — admin_generate_policy_snapshot (Version + Diff)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_policy_snapshot(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_prev jsonb; v_ver integer; v_chk text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_operations_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no operations run'; end if;
  delete from public.ai_policy_registry where run_id=v_run;
  delete from public.ai_policy_versions where run_id=v_run;

  for r in
    select * from (values
      ('streaming_policy','streaming', jsonb_build_object('verified_seconds_min',30,'heartbeat_required',true,'visibility','visible')),
      ('settlement_policy','settlement', jsonb_build_object('preview_excluded',true,'min_volume',0.1,'fraud_max',60)),
      ('prediction_policy','prediction', jsonb_build_object('shadow_only',true,'confidence_min',0.5)),
      ('rl_policy','rl', jsonb_build_object('reward_clip',1.0,'explore_rate',0.1)),
      ('decision_policy','decision', jsonb_build_object('risk_max',0.7,'human_gate',true)),
      ('governance_policy','governance', jsonb_build_object('append_only',true,'sla_streak_min',3))
    ) as p(pkey, domain, params)
  loop
    v_chk := md5(r.params::text);
    -- 이전 최신 버전(과거 run 포함)과 비교 → diff
    select params, version into v_prev, v_ver from public.ai_policy_versions where policy_key=r.pkey order by version desc limit 1;
    v_ver := coalesce(v_ver,0) + 1;
    insert into public.ai_policy_versions(run_id, policy_key, version, params, checksum, applied)
      values (v_run, r.pkey, v_ver, r.params, v_chk, false);
    insert into public.ai_policy_registry(run_id, policy_key, domain, current_version, checksum, note)
      values (v_run, r.pkey, r.domain, v_ver, v_chk, 'shadow policy — 실제 적용 없음');
    insert into public.ai_policy_history(run_id, policy_key, from_version, to_version, diff, actor, shadow, note)
      values (v_run, r.pkey, coalesce(v_ver-1,0), v_ver,
        case when v_prev is null then jsonb_build_object('change','initial','params',r.params)
             else jsonb_build_object('change','snapshot','prev_checksum',md5(v_prev::text),'new_checksum',v_chk,'changed', (v_prev is distinct from r.params)) end,
        'system', true, 'shadow policy snapshot');
    insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'policy', r.domain, r.pkey||' v'||v_ver, 'shadow snapshot');
  end loop;

  update public.ai_operations_center set policies_total=(select count(*) from public.ai_policy_registry where run_id=v_run) where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'policies',(select count(*) from public.ai_policy_registry where run_id=v_run),
    'versions',(select count(*) from public.ai_policy_versions where run_id=v_run),'note','Shadow policy snapshot — 실제 적용 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Incident Manager + Maintenance — admin_generate_incident_summary
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_incident_summary(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_operations_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no operations run'; end if;
  delete from public.ai_incident_center where run_id=v_run;
  delete from public.ai_maintenance_windows where run_id=v_run;

  -- Blocked/Rejected component → incident
  insert into public.ai_incident_center(run_id, incident_type, component, priority, state, cnt, summary, recommendation)
  select v_run, case when stage='Blocked' then 'blocked_component' else 'shadow_alert' end, component,
    public._ops_incident_priority(case when stage='Blocked' then 'blocked_component' else 'shadow_alert' end),
    case when stage='Blocked' then 'Investigating' else 'Open' end, 1,
    format('%s release stage=%s (status=%s)', component, stage, engine_status),
    case when stage='Blocked' then '원인 해소 후 재평가' else 'shadow 관찰 지속' end
  from public.ai_release_candidates where run_id=v_run and stage in ('Blocked','Rejected');

  -- Maintenance / Freeze / Observation / Emergency Stop (전부 미실행)
  insert into public.ai_maintenance_windows(run_id, window_type, status, scope, executed, note) values
    (v_run,'observation_mode','active','all-engines',false,'shadow 관찰 모드 — 실제 정지 없음'),
    (v_run,'freeze_window','planned','release-pipeline',false,'배포 freeze 계획(shadow) — 미적용'),
    (v_run,'shadow_maintenance','prepared','operations',false,'shadow 유지보수 절차 준비'),
    (v_run,'emergency_stop_plan','prepared','all-engines',false,'비상 정지 절차 문서화 — 실행 금지');

  update public.ai_operations_center set
    incidents_total=(select count(*) from public.ai_incident_center where run_id=v_run),
    incidents_critical=(select count(*) from public.ai_incident_center where run_id=v_run and priority='Critical'),
    maintenance_windows=(select count(*) from public.ai_maintenance_windows where run_id=v_run)
  where id=v_run;

  insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
  select v_run, now(), 'incident', component, priority||' · '||incident_type, summary from public.ai_incident_center where run_id=v_run;
  insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
  select v_run, now(), 'maintenance', scope, window_type||' ('||status||')', note from public.ai_maintenance_windows where run_id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'incidents',(select count(*) from public.ai_incident_center where run_id=v_run),
    'by_state',(select coalesce(jsonb_object_agg(state,c),'{}'::jsonb) from (select state,count(*) c from public.ai_incident_center where run_id=v_run group by 1) z),
    'maintenance',(select count(*) from public.ai_maintenance_windows where run_id=v_run),'note','Shadow incidents/maintenance — 실행 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Operation Timeline — admin_generate_operation_timeline (집계/헤더 finalize)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_operation_timeline(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_operations_center order by run_at desc limit 1));
  if v_run is null then raise exception 'no operations run'; end if;

  insert into public.ai_operation_timeline(run_id, ts, category, component, event, detail)
    values (v_run, now(), 'operation', 'control', 'operation snapshot finalized',
      format('release %s · rollback %s · policy %s · approval %s · incident %s',
        (select count(*) from public.ai_release_candidates where run_id=v_run),
        (select count(*) from public.ai_rollback_plans where run_id=v_run),
        (select count(*) from public.ai_policy_registry where run_id=v_run),
        (select count(*) from public.ai_approval_queue where run_id=v_run and state='Pending'),
        (select count(*) from public.ai_incident_center where run_id=v_run)));

  return jsonb_build_object('ok',true,'run_id',v_run,
    'timeline',(select count(*) from public.ai_operation_timeline where run_id=v_run),
    'by_category',(select coalesce(jsonb_object_agg(category,c),'{}'::jsonb) from (select category,count(*) c from public.ai_operation_timeline where run_id=v_run group by 1) z),
    'note','Append-only operation timeline');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Overview — admin_ai_operations_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_operations_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.ai_operations_center order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'summary', (select to_jsonb(c) from (select run_at, window_days, release_total, release_ready, release_blocked, rollback_plans, policies_total, incidents_total, incidents_critical, approvals_pending, maintenance_windows, headline from public.ai_operations_center where id=v_run) c),
    'releases', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'stage',stage,'readiness',readiness_score,'status',engine_status,'present',present,'blockers',blockers,'note',note) order by readiness_score desc, component),'[]'::jsonb) from public.ai_release_candidates where run_id=v_run),
    'rollbacks', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'risk',risk,'reason',reason,'steps',steps,'dependencies',dependencies,'checklist',checklist) order by component),'[]'::jsonb) from public.ai_rollback_plans where run_id=v_run),
    'policies', (select coalesce(jsonb_agg(jsonb_build_object('key',policy_key,'domain',domain,'version',current_version,'checksum',left(checksum,8)) order by domain),'[]'::jsonb) from public.ai_policy_registry where run_id=v_run),
    'policy_history', (select coalesce(jsonb_agg(jsonb_build_object('key',policy_key,'from',from_version,'to',to_version,'diff',diff) order by created_at desc),'[]'::jsonb) from (select * from public.ai_policy_history where run_id=v_run order by created_at desc limit 12) ph),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('subject',subject,'kind',kind,'state',state,'priority',priority) order by created_at),'[]'::jsonb) from public.ai_approval_queue where run_id=v_run),
    'maintenance', (select coalesce(jsonb_agg(jsonb_build_object('type',window_type,'status',status,'scope',scope,'executed',executed,'note',note) order by created_at),'[]'::jsonb) from public.ai_maintenance_windows where run_id=v_run),
    'incidents', (select coalesce(jsonb_agg(jsonb_build_object('type',incident_type,'component',component,'priority',priority,'state',state,'count',cnt,'summary',summary) order by case priority when 'Critical' then 0 when 'High' then 1 when 'Medium' then 2 else 3 end),'[]'::jsonb) from public.ai_incident_center where run_id=v_run),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('ts',ts,'category',category,'component',component,'event',event,'detail',detail) order by ts desc),'[]'::jsonb) from (select * from public.ai_operation_timeline where run_id=v_run order by ts desc limit 50) t)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_operations_summary as
select o.id run_id, o.run_at, o.release_total, o.release_ready, o.release_blocked, o.rollback_plans,
  o.policies_total, o.incidents_total, o.incidents_critical, o.approvals_pending, o.maintenance_windows, o.headline
from public.ai_operations_center o;

create or replace view public.v2_ai_release_summary as
select c.run_id, c.component, c.present, c.engine_status, c.stage, c.readiness_score, c.version_tag
from public.ai_release_candidates c;

create or replace view public.v2_ai_policy_summary as
select p.run_id, p.policy_key, p.domain, p.current_version, p.checksum
from public.ai_policy_registry p;

create or replace view public.v2_ai_ops_incident_summary as
select i.run_id, i.incident_type, i.component, i.priority, i.state, i.cnt, i.summary
from public.ai_incident_center i;

create or replace view public.v2_ai_timeline_summary as
select t.run_id, t.ts, t.category, t.component, t.event, t.detail
from public.ai_operation_timeline t;

-- ─────────────────────────────────────────────────────────────────────
-- K. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_table_exists(text)',
    'public._ops_stream_signal()',
    'public._ops_release_stage(boolean,text)',
    'public._ops_release_readiness(text)',
    'public._ops_incident_priority(text)',
    'public.admin_generate_release_candidates(integer)',
    'public.admin_generate_rollback_plan(uuid)',
    'public.admin_generate_policy_snapshot(uuid)',
    'public.admin_generate_incident_summary(uuid)',
    'public.admin_generate_operation_timeline(uuid)',
    'public.admin_ai_operations_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_release_candidates(integer) is
  'ALGO-7B — Shadow Release Manager. 12 component probe → release stage/readiness + approval queue. 실제 release/approval 없음.';
comment on function public.admin_generate_rollback_plan(uuid) is
  'ALGO-7B — Rollback Center (Simulation Only). component별 rollback plan/dependency/checklist. 실제 rollback 없음.';
comment on function public.admin_ai_operations_overview() is
  'ALGO-7B — AI Operations Center overview. Release/Rollback/Policy/Approval/Maintenance/Incident/Timeline 통합 조회. 읽기 전용.';
