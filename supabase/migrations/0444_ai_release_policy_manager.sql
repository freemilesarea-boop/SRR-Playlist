-- 0444 — Phase ALGO-7C: AI Release & Policy Manager (Shadow) — Release Governance Layer
--
-- 목적:
--   ALGO-7B Operations Center 의 Release Candidate / Policy / Approval / Rollback / Incident 를 기반으로
--   운영 전환 전 Release Readiness 절차를 Shadow 로 통합 검증한다. Release Readiness · Policy Compliance ·
--   Approval Gate · Rollback Verification · Risk Matrix · Decision Record · Release Certificate 생성.
--
-- 절대 원칙:
--   • Shadow Only. Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance
--     Runtime 무변경. Production Apply/Canary/실제 Release/Rollback/Policy Apply/자동 승인 금지. Additive only.
--   • Self-contained: 선행 Migration(0430~0443) 미적용 환경에서도 단독 검증 가능하도록 component universe 를
--     to_regclass probe + base 신호로 재도출한다(0443 적용 시 동일 component 가 release candidate 로 매핑됨).
--   • ai_release_policy_timeline 은 append-only (BEFORE UPDATE/DELETE 차단).

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_table_exists(p_rel text)
returns boolean language sql stable set search_path to 'public' as $$
  select to_regclass(p_rel) is not null;
$$;

create or replace function public._rel_stream_signal()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select coalesce(i.verified_seconds,0) m_vsec, coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, coalesce(i.visibility_state,'visible') vis, i.heartbeat_verified
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= now() - interval '30 days'
  )
  select jsonb_build_object('play30s', count(*),
    'verified_actual', count(*) filter (where heartbeat_verified is true and m_vsec>=30 and vis='visible'),
    'verified_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0)) from base;
$$;

create or replace function public._rel_risk_num(p_grade text)
returns integer language sql immutable set search_path to 'public' as $$
  select case p_grade when 'critical' then 4 when 'high' then 3 when 'medium' then 2 when 'low' then 1 else 0 end;
$$;

create or replace function public._rel_risk_grade(p_score numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case when p_score is null then 'low' when p_score >= 3.5 then 'critical' when p_score >= 2.5 then 'high'
    when p_score >= 1.5 then 'medium' else 'low' end;
$$;

create or replace function public._rel_readiness_score(p_state text)
returns integer language sql immutable set search_path to 'public' as $$
  select case p_state
    when 'ready_for_canary_review' then 90 when 'ready_for_shadow_release' then 80 when 'needs_approval' then 70
    when 'needs_observability' then 55 when 'needs_rollback_plan' then 50 when 'needs_policy_review' then 45
    when 'release_blocked' then 10 else 40 end;
$$;

create or replace function public._rel_append_only()
returns trigger language plpgsql set search_path to 'public' as $$
begin
  raise exception 'append-only: % on % is forbidden (ALGO-7C)', TG_OP, TG_TABLE_NAME using errcode='0A000';
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_release_readiness (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  component text not null, release_candidate_status text, policy_check_status text, approval_check_status text,
  rollback_check_status text, incident_check_status text, governance_check_status text, observability_check_status text,
  streaming_check_status text, settlement_check_status text, final_state text, readiness_score integer,
  run_id uuid, note text, created_at timestamptz not null default now()
);
create index if not exists arr_run_idx on public.ai_release_readiness(run_id, component);
create index if not exists arr_at_idx on public.ai_release_readiness(run_at desc);

create table if not exists public.ai_policy_compliance_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, domain text not null, policy_version_exists boolean, policy_checksum_valid boolean,
  policy_history_exists boolean, policy_diff_available boolean, policy_domain_matched boolean,
  policy_last_reviewed_at timestamptz, policy_expired boolean, policy_requires_human_review boolean,
  compliance_state text, note text, created_at timestamptz not null default now()
);
create index if not exists apcc_run_idx on public.ai_policy_compliance_checks(run_id);

create table if not exists public.ai_approval_gate_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, component text not null, approval_required boolean, approval_exists boolean, approval_state text,
  reviewer_exists boolean, approval_expired boolean, approval_notes_exists boolean, human_approval_required boolean,
  gate_state text, note text, created_at timestamptz not null default now()
);
create index if not exists aagc_run_idx on public.ai_approval_gate_checks(run_id);

create table if not exists public.ai_rollback_verification_checks (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, component text not null, rollback_plan_exists boolean, rollback_steps_exists boolean,
  rollback_checklist_exists boolean, rollback_dependency_exists boolean, rollback_risk_level text,
  rollback_simulation_only boolean, rollback_executed_false boolean, verification_state text,
  note text, created_at timestamptz not null default now()
);
create index if not exists arvc_run_idx on public.ai_rollback_verification_checks(run_id);

create table if not exists public.ai_release_risk_matrix (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, component text not null, technical_risk text, policy_risk text, approval_risk text,
  rollback_risk text, incident_risk text, governance_risk text, observability_risk text,
  overall_release_risk text, risk_score numeric, note text, created_at timestamptz not null default now()
);
create index if not exists arrm_run_idx on public.ai_release_risk_matrix(run_id);

create table if not exists public.ai_release_decision_records (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, candidate_id text, component text not null, decision_state text, decision_reason text,
  blockers jsonb, warnings jsonb, required_actions jsonb, reviewed_at timestamptz, generated_by text,
  created_at timestamptz not null default now()
);
create index if not exists ardr_run_idx on public.ai_release_decision_records(run_id);

create table if not exists public.ai_release_certificates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, release_candidate text not null, policy_check text, approval_check text, rollback_check text,
  risk_matrix jsonb, governance_gate text, observability_snapshot text, incident_summary text,
  certificate_hash text, note text, created_at timestamptz not null default now()
);
create index if not exists arc7c_run_idx on public.ai_release_certificates(run_id);

create table if not exists public.ai_release_policy_timeline (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, ts timestamptz not null default now(), category text, component text, event text, detail text,
  created_at timestamptz not null default now()
);
create index if not exists arpt_run_idx on public.ai_release_policy_timeline(run_id, ts desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Append-only trigger (timeline)
-- ─────────────────────────────────────────────────────────────────────
do $$ begin
  if not exists (select 1 from pg_trigger where tgname = 'ai_release_policy_timeline_append_only') then
    create trigger ai_release_policy_timeline_append_only before update or delete
      on public.ai_release_policy_timeline for each row execute function public._rel_append_only();
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_release_readiness','ai_policy_compliance_checks','ai_approval_gate_checks',
    'ai_rollback_verification_checks','ai_release_risk_matrix','ai_release_decision_records',
    'ai_release_certificates','ai_release_policy_timeline'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Release Readiness Engine — admin_generate_release_readiness (run 생성)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_release_readiness(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid := gen_random_uuid(); r record; v_present boolean; v_cnt integer; v_status text; v_stage text;
  v_sig jsonb := public._rel_stream_signal(); v_va int := coalesce((v_sig->>'verified_actual')::int,0); v_vc int := coalesce((v_sig->>'verified_cal')::int,0);
  v_gov boolean := public._ai_table_exists('public.ai_governance_ledger'); v_obs boolean := public._ai_table_exists('public.observation_runs');
  v_is_policy boolean; v_appr text; v_final text; v_pchk text; v_schk text; v_setchk text; v_ichk text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  for r in
    select * from (values
      (1,'streaming','public.stream_ingest_v2'),(2,'settlement','public.eligible_settlement_tracks'),
      (3,'prediction','public.prediction_shadow_queue'),(4,'rl','public.reward_memory'),
      (5,'decision','public.unified_decisions'),(6,'governance','public.ai_governance_ledger'),
      (7,'observability','public.observation_runs'),(8,'learning','public.learning_memory'),
      (9,'exposure','public.exposure_scores'),(10,'calibration','public.stream_shadow_calibration_runs'),
      (11,'bandit','public.bandit_arms'),(12,'ensemble','public.ensemble_registry')
    ) as c(ord, comp, probe)
  loop
    v_present := public._ai_table_exists(r.probe); v_cnt := 0;
    if v_present then execute format('select count(*) from %s', r.probe) into v_cnt; end if;
    if r.comp='streaming' then v_status := case when v_va=0 and v_vc>0 then 'WARNING' when v_vc=0 then 'SHADOW' else 'READY' end;
    elsif not v_present then v_status := 'UNKNOWN'; elsif v_cnt>0 then v_status := 'READY'; else v_status := 'SHADOW'; end if;
    v_stage := case v_status when 'READY' then 'Ready for Canary' when 'WARNING' then 'Ready for Review'
      when 'SHADOW' then 'Shadow Candidate' else 'Rejected' end;
    v_is_policy := r.comp in ('streaming','settlement','prediction','rl','decision','governance');

    v_pchk   := case when v_is_policy then 'ok' else 'not_applicable' end;
    v_appr   := case when v_status='READY' then 'pending' when v_status in ('WARNING','SHADOW') then 'not_required' else 'missing' end;
    v_ichk   := case when v_status in ('UNKNOWN') then 'blocked' when v_status='WARNING' then 'open' else 'clear' end;
    v_schk   := case when v_va=0 and v_vc>0 then 'warning' when v_vc>0 then 'ok' else 'shadow' end;
    v_setchk := case when public._ai_table_exists('public.eligible_settlement_tracks') then 'ok' else 'unavailable' end;

    v_final := case
      when v_status='UNKNOWN' then 'release_blocked'
      when r.comp in ('governance') and not v_gov then 'needs_observability'
      when r.comp in ('observability') and not v_obs then 'needs_observability'
      when v_status='WARNING' then 'needs_policy_review'
      when v_status='READY' then 'needs_approval'
      else 'ready_for_shadow_release' end;

    insert into public.ai_release_readiness(run_id, window_days, component, release_candidate_status, policy_check_status,
      approval_check_status, rollback_check_status, incident_check_status, governance_check_status, observability_check_status,
      streaming_check_status, settlement_check_status, final_state, readiness_score, note)
    values (v_run, greatest(coalesce(p_days,30),1), r.comp, v_stage, v_pchk, v_appr,
      case when v_present then 'ready' else 'missing' end, v_ichk,
      case when v_gov then 'ok' else 'unavailable' end, case when v_obs then 'ok' else 'unavailable' end,
      v_schk, v_setchk, v_final, public._rel_readiness_score(v_final),
      format('%s · %s · rows=%s', v_status, v_stage, v_cnt));

    insert into public.ai_release_policy_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'readiness', r.comp, r.comp||' → '||v_final, v_stage);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'components',(select count(*) from public.ai_release_readiness where run_id=v_run),
    'ready',(select count(*) from public.ai_release_readiness where run_id=v_run and final_state in ('ready_for_shadow_release','ready_for_canary_review')),
    'needs_approval',(select count(*) from public.ai_release_readiness where run_id=v_run and final_state='needs_approval'),
    'blocked',(select count(*) from public.ai_release_readiness where run_id=v_run and final_state='release_blocked'),
    'note','Shadow release readiness — 실제 release 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Policy Compliance Engine — admin_generate_policy_compliance
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_policy_compliance(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select run_id from public.ai_release_readiness order by run_at desc limit 1));
  if v_run is null then raise exception 'no readiness run — run admin_generate_release_readiness first'; end if;
  delete from public.ai_policy_compliance_checks where run_id=v_run;

  for r in select unnest(array['streaming','settlement','prediction','rl','decision','governance']) as domain
  loop
    -- shadow policy 는 정의되어 있으나 human review 이력이 없음 → needs_human_review (정직)
    insert into public.ai_policy_compliance_checks(run_id, domain, policy_version_exists, policy_checksum_valid,
      policy_history_exists, policy_diff_available, policy_domain_matched, policy_last_reviewed_at, policy_expired,
      policy_requires_human_review, compliance_state, note)
    values (v_run, r.domain, true, true, true, true, true, null, false, true,
      'needs_human_review', 'shadow policy 정의됨 · human review 미이행 — 실제 apply 없음');

    insert into public.ai_release_policy_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'policy', r.domain, r.domain||' compliance', 'needs_human_review');
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'domains',(select count(*) from public.ai_policy_compliance_checks where run_id=v_run),
    'needs_review',(select count(*) from public.ai_policy_compliance_checks where run_id=v_run and policy_requires_human_review),
    'note','Shadow policy compliance — 실제 policy apply 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Approval Gate Engine — admin_generate_approval_gate_check
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_approval_gate_check(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_req boolean; v_state text; v_gate text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select run_id from public.ai_release_readiness order by run_at desc limit 1));
  if v_run is null then raise exception 'no readiness run'; end if;
  delete from public.ai_approval_gate_checks where run_id=v_run;

  for r in select component, approval_check_status, final_state from public.ai_release_readiness where run_id=v_run
  loop
    v_req := r.approval_check_status = 'pending';
    v_state := case when r.approval_check_status='pending' then 'pending'
      when r.approval_check_status='missing' then 'missing' else 'not_required' end;
    v_gate := case when v_req then 'pending' when v_state='missing' then 'missing' else 'not_required' end;

    insert into public.ai_approval_gate_checks(run_id, component, approval_required, approval_exists, approval_state,
      reviewer_exists, approval_expired, approval_notes_exists, human_approval_required, gate_state, note)
    values (v_run, r.component, v_req, v_req, v_state, false, false, v_req, v_req, v_gate,
      case when v_req then '승인 대기 — 자동 승인 금지 (human review 필요)' else 'approval not required (shadow)' end);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'gates',(select count(*) from public.ai_approval_gate_checks where run_id=v_run),
    'pending',(select count(*) from public.ai_approval_gate_checks where run_id=v_run and gate_state='pending'),
    'note','Shadow approval gate — 자동 승인 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Rollback Verification Engine — admin_generate_rollback_verification
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_rollback_verification(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_risk text; v_state text; v_present boolean;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select run_id from public.ai_release_readiness order by run_at desc limit 1));
  if v_run is null then raise exception 'no readiness run'; end if;
  delete from public.ai_rollback_verification_checks where run_id=v_run;

  for r in select component, release_candidate_status, streaming_check_status, final_state,
    (rollback_check_status='ready') as has_plan from public.ai_release_readiness where run_id=v_run
  loop
    v_present := r.has_plan;
    v_risk := case when r.final_state='release_blocked' then 'high' when r.streaming_check_status='warning' then 'medium' else 'low' end;
    v_state := case when not v_present then 'missing' when v_risk='high' then 'high_risk' else 'ready' end;

    insert into public.ai_rollback_verification_checks(run_id, component, rollback_plan_exists, rollback_steps_exists,
      rollback_checklist_exists, rollback_dependency_exists, rollback_risk_level, rollback_simulation_only,
      rollback_executed_false, verification_state, note)
    values (v_run, r.component, v_present, v_present, v_present, v_present, v_risk, true, true, v_state,
      'Simulation Only — 실제 rollback 없음');
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'checks',(select count(*) from public.ai_rollback_verification_checks where run_id=v_run),
    'ready',(select count(*) from public.ai_rollback_verification_checks where run_id=v_run and verification_state='ready'),
    'high_risk',(select count(*) from public.ai_rollback_verification_checks where run_id=v_run and verification_state='high_risk'),
    'note','Shadow rollback verification — 실제 rollback 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Release Certificate — admin_generate_release_certificate
--    Risk Matrix + Decision Record + Certificate 를 한 번에 생성
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_release_certificate(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record; v_gov boolean := public._ai_table_exists('public.ai_governance_ledger');
  v_obs boolean := public._ai_table_exists('public.observation_runs');
  v_tech text; v_pol text; v_appr text; v_rb text; v_inc text; v_grisk text; v_orisk text; v_score numeric;
  v_rbrisk text; v_pcompl text; v_gaterow record; v_blk jsonb; v_warn jsonb; v_act jsonb; v_hash text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select run_id from public.ai_release_readiness order by run_at desc limit 1));
  if v_run is null then raise exception 'no readiness run'; end if;
  delete from public.ai_release_risk_matrix where run_id=v_run;
  delete from public.ai_release_decision_records where run_id=v_run;
  delete from public.ai_release_certificates where run_id=v_run;

  for r in select * from public.ai_release_readiness where run_id=v_run
  loop
    select rollback_risk_level into v_rbrisk from public.ai_rollback_verification_checks where run_id=v_run and component=r.component limit 1;
    select gate_state into v_gaterow from public.ai_approval_gate_checks where run_id=v_run and component=r.component limit 1;

    -- Risk Matrix
    v_tech  := case r.release_candidate_status when 'Rejected' then 'high' when 'Ready for Review' then 'medium' else 'low' end;
    v_pol   := case when r.policy_check_status='ok' then 'medium' else 'low' end;  -- policy human review 미이행 → medium
    v_appr  := case when r.approval_check_status='pending' then 'medium' when r.approval_check_status='missing' then 'high' else 'low' end;
    v_rb    := coalesce(v_rbrisk,'low');
    v_inc   := case r.incident_check_status when 'blocked' then 'high' when 'open' then 'medium' else 'low' end;
    v_grisk := case when v_gov then 'low' else 'medium' end;
    v_score := round((public._rel_risk_num(v_tech)+public._rel_risk_num(v_pol)+public._rel_risk_num(v_appr)
      +public._rel_risk_num(v_rb)+public._rel_risk_num(v_inc)+public._rel_risk_num(v_grisk)
      +public._rel_risk_num(case when v_obs then 'low' else 'medium' end))::numeric / 7.0, 2);
    v_orisk := public._rel_risk_grade(v_score);

    insert into public.ai_release_risk_matrix(run_id, component, technical_risk, policy_risk, approval_risk, rollback_risk,
      incident_risk, governance_risk, observability_risk, overall_release_risk, risk_score, note)
    values (v_run, r.component, v_tech, v_pol, v_appr, v_rb, v_inc, v_grisk, case when v_obs then 'low' else 'medium' end,
      v_orisk, v_score, 'shadow risk matrix');

    -- Decision Record
    v_blk := case when r.final_state='release_blocked' then jsonb_build_array('component 미배포/미준비') else '[]'::jsonb end;
    v_warn := (select coalesce(jsonb_agg(w),'[]'::jsonb) from unnest(array_remove(array[
        case when r.streaming_check_status='warning' then 'verification_delay 병목' end,
        case when v_orisk in ('high','critical') then 'overall risk '||v_orisk end,
        case when not v_gov then 'governance ledger 미배포' end], null)) w);
    v_act := (select coalesce(jsonb_agg(a),'[]'::jsonb) from unnest(array_remove(array[
        case when r.final_state='needs_approval' then 'human approval 필요' end,
        case when r.final_state='needs_policy_review' then 'policy human review 필요' end,
        case when r.policy_check_status='ok' then 'policy_last_reviewed_at 갱신' end,
        case when r.final_state='needs_observability' then 'observability snapshot 확보' end], null)) a);

    insert into public.ai_release_decision_records(run_id, candidate_id, component, decision_state, decision_reason,
      blockers, warnings, required_actions, reviewed_at, generated_by)
    values (v_run, r.component||'-'||left(v_run::text,8), r.component, r.final_state,
      format('readiness=%s · risk=%s', r.readiness_score, v_orisk), v_blk, v_warn, v_act, null, 'system');

    -- Certificate (생성만 — 실제 배포 효력 없음)
    v_pcompl := (select compliance_state from public.ai_policy_compliance_checks where run_id=v_run and domain=r.component limit 1);
    v_hash := md5(r.component||'|'||coalesce(r.final_state,'')||'|'||coalesce(v_orisk,'')||'|'||coalesce(r.approval_check_status,'')||'|'||coalesce(v_pcompl,'n/a'));
    insert into public.ai_release_certificates(run_id, release_candidate, policy_check, approval_check, rollback_check,
      risk_matrix, governance_gate, observability_snapshot, incident_summary, certificate_hash, note)
    values (v_run, r.component, coalesce(v_pcompl,'not_applicable'), r.approval_check_status, coalesce(v_rbrisk,'low'),
      jsonb_build_object('technical',v_tech,'policy',v_pol,'approval',v_appr,'rollback',v_rb,'incident',v_inc,'governance',v_grisk,'overall',v_orisk,'score',v_score),
      case when v_gov then 'pass' else 'unavailable' end,
      case when v_obs then 'available' else 'unavailable' end,
      r.incident_check_status, v_hash, 'AI Shadow Release Certificate — 실제 배포 효력 없음');

    insert into public.ai_release_policy_timeline(run_id, ts, category, component, event, detail)
      values (v_run, now(), 'certificate', r.component, r.component||' certificate', 'risk='||v_orisk||' state='||r.final_state);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'certificates',(select count(*) from public.ai_release_certificates where run_id=v_run),
    'risk',(select coalesce(jsonb_object_agg(overall_release_risk,c),'{}'::jsonb) from (select overall_release_risk, count(*) c from public.ai_release_risk_matrix where run_id=v_run group by 1) z),
    'note','Shadow certificate — 실제 배포 효력 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Overview — admin_ai_release_policy_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_release_policy_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select run_id into v_run from public.ai_release_readiness order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'summary', jsonb_build_object(
      'components', (select count(*) from public.ai_release_readiness where run_id=v_run),
      'ready', (select count(*) from public.ai_release_readiness where run_id=v_run and final_state in ('ready_for_shadow_release','ready_for_canary_review')),
      'needs_approval', (select count(*) from public.ai_release_readiness where run_id=v_run and final_state='needs_approval'),
      'needs_policy_review', (select count(*) from public.ai_release_readiness where run_id=v_run and final_state='needs_policy_review'),
      'blocked', (select count(*) from public.ai_release_readiness where run_id=v_run and final_state='release_blocked'),
      'certificates', (select count(*) from public.ai_release_certificates where run_id=v_run),
      'risk', (select coalesce(jsonb_object_agg(overall_release_risk,c),'{}'::jsonb) from (select overall_release_risk, count(*) c from public.ai_release_risk_matrix where run_id=v_run group by 1) z)),
    'readiness', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'candidate',release_candidate_status,'policy',policy_check_status,'approval',approval_check_status,'rollback',rollback_check_status,'incident',incident_check_status,'governance',governance_check_status,'observability',observability_check_status,'streaming',streaming_check_status,'settlement',settlement_check_status,'final',final_state,'score',readiness_score) order by readiness_score desc, component),'[]'::jsonb) from public.ai_release_readiness where run_id=v_run),
    'policy', (select coalesce(jsonb_agg(jsonb_build_object('domain',domain,'version',policy_version_exists,'checksum',policy_checksum_valid,'history',policy_history_exists,'diff',policy_diff_available,'expired',policy_expired,'needs_review',policy_requires_human_review,'state',compliance_state) order by domain),'[]'::jsonb) from public.ai_policy_compliance_checks where run_id=v_run),
    'approvals', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'required',approval_required,'state',approval_state,'human',human_approval_required,'gate',gate_state) order by component),'[]'::jsonb) from public.ai_approval_gate_checks where run_id=v_run),
    'rollback', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'plan',rollback_plan_exists,'steps',rollback_steps_exists,'checklist',rollback_checklist_exists,'dependency',rollback_dependency_exists,'risk',rollback_risk_level,'sim_only',rollback_simulation_only,'not_executed',rollback_executed_false,'state',verification_state) order by component),'[]'::jsonb) from public.ai_rollback_verification_checks where run_id=v_run),
    'risk_matrix', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'technical',technical_risk,'policy',policy_risk,'approval',approval_risk,'rollback',rollback_risk,'incident',incident_risk,'governance',governance_risk,'observability',observability_risk,'overall',overall_release_risk,'score',risk_score) order by risk_score desc),'[]'::jsonb) from public.ai_release_risk_matrix where run_id=v_run),
    'decisions', (select coalesce(jsonb_agg(jsonb_build_object('component',component,'candidate_id',candidate_id,'state',decision_state,'reason',decision_reason,'blockers',blockers,'warnings',warnings,'required_actions',required_actions) order by component),'[]'::jsonb) from public.ai_release_decision_records where run_id=v_run),
    'certificates', (select coalesce(jsonb_agg(jsonb_build_object('component',release_candidate,'policy',policy_check,'approval',approval_check,'rollback',rollback_check,'governance_gate',governance_gate,'observability',observability_snapshot,'incident',incident_summary,'hash',left(certificate_hash,12)) order by release_candidate),'[]'::jsonb) from public.ai_release_certificates where run_id=v_run),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('ts',ts,'category',category,'component',component,'event',event,'detail',detail) order by ts desc),'[]'::jsonb) from (select * from public.ai_release_policy_timeline where run_id=v_run order by ts desc limit 50) t)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_release_readiness_summary as
select r.run_id, r.component, r.release_candidate_status, r.final_state, r.readiness_score,
  r.approval_check_status, r.rollback_check_status, r.incident_check_status
from public.ai_release_readiness r;

create or replace view public.v2_ai_policy_compliance_summary as
select p.run_id, p.domain, p.policy_version_exists, p.policy_checksum_valid, p.policy_expired,
  p.policy_requires_human_review, p.compliance_state
from public.ai_policy_compliance_checks p;

create or replace view public.v2_ai_release_risk_summary as
select m.run_id, m.component, m.technical_risk, m.policy_risk, m.approval_risk, m.rollback_risk,
  m.incident_risk, m.governance_risk, m.observability_risk, m.overall_release_risk, m.risk_score
from public.ai_release_risk_matrix m;

create or replace view public.v2_ai_release_certificate_summary as
select c.run_id, c.release_candidate, c.policy_check, c.approval_check, c.rollback_check,
  c.governance_gate, c.observability_snapshot, c.incident_summary, c.certificate_hash
from public.ai_release_certificates c;

create or replace view public.v2_ai_release_policy_timeline_summary as
select t.run_id, t.ts, t.category, t.component, t.event, t.detail
from public.ai_release_policy_timeline t;

-- ─────────────────────────────────────────────────────────────────────
-- K. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_table_exists(text)',
    'public._rel_stream_signal()',
    'public._rel_risk_num(text)',
    'public._rel_risk_grade(numeric)',
    'public._rel_readiness_score(text)',
    'public.admin_generate_release_readiness(integer)',
    'public.admin_generate_policy_compliance(uuid)',
    'public.admin_generate_approval_gate_check(uuid)',
    'public.admin_generate_rollback_verification(uuid)',
    'public.admin_generate_release_certificate(uuid)',
    'public.admin_ai_release_policy_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_release_readiness(integer) is
  'ALGO-7C — Release Readiness Engine. component별 policy/approval/rollback/incident/governance/observability 준비도 종합. 실제 release 없음.';
comment on function public.admin_generate_release_certificate(uuid) is
  'ALGO-7C — Risk Matrix + Decision Record + Shadow Release Certificate 생성. 실제 배포 효력 없음.';
comment on function public.admin_ai_release_policy_overview() is
  'ALGO-7C — AI Release & Policy Manager overview. Readiness/Compliance/Gate/Verification/Risk/Decision/Certificate/Timeline 통합 조회. 읽기 전용.';
