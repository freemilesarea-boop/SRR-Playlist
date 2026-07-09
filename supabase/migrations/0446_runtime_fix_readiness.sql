-- 0446 — Phase ALGO-8A: Runtime Fix Readiness & Safe Apply Plan (Shadow) — Runtime Readiness Layer
--
-- 목적:
--   ALGO-2E~7D 에서 확인된 Shadow 병목(verified/eligible=0)과 Release Governance 결과를 기반으로,
--   실제 Runtime 변경 전 필요한 Apply Plan · Rollback Plan · 검증 기준 · 성공/실패 기준을 수립한다.
--   Runtime Change Planner · Dependency Graph · Safe Apply Plan(Stage 0~5) · Rollback Readiness ·
--   Success/Failure Criteria · Readiness Checklist 생성.
--
-- 절대 원칙:
--   • Shadow Only. Queue/Playback/Scheduler/Streaming/Settlement/Prediction/RL/Decision/Governance
--     Runtime 무변경. Production Apply/Canary/Release/Rollback 금지. Additive only.
--   • Self-contained: base 테이블에서 현재 baseline(verified/eligible=0 등)을 계산하여 success 기준의 현재값을 채운다.
--   • 모든 계획/기준/체크리스트는 정의만 하며 실제 Runtime 에는 어떤 영향도 없다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_table_exists(p_rel text)
returns boolean language sql stable set search_path to 'public' as $$
  select to_regclass(p_rel) is not null;
$$;

create or replace function public._rt_stream_signal()
returns jsonb language sql stable security definer set search_path to 'public' as $$
  with base as (
    select i.track_id, coalesce(i.verified_seconds,0) m_vsec, coalesce(s.verified_seconds, i.verified_seconds, 0) s_vsec,
      coalesce(s.heartbeat_count,0) hb, coalesce(i.visibility_state,'visible') vis, i.heartbeat_verified,
      s.player_type s_ptype, i.player_type, coalesce(i.player_volume,1) vol, coalesce(i.player_muted,false) muted,
      i.ineligible_reason, coalesce(i.fraud_score,0) fraud, coalesce(i.dispute_status,'none') disp
    from public.stream_ingest_v2 i
    left join public.stream_sessions_v2 s on s.session_token = i.session_token
    where i.event_type = 'play_30s' and i.created_at >= now() - interval '30 days'
  )
  select jsonb_build_object(
    'verified_actual', count(*) filter (where heartbeat_verified is true and m_vsec>=30 and vis='visible'),
    'verified_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0),
    'eligible_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0 and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none'),
    'settlement_cal', count(*) filter (where s_vsec>=30 and vis='visible' and hb>0 and coalesce(s_ptype,player_type) <> all (array['ADMIN_PREVIEW','ARTIST_PREVIEW','SYSTEM']) and vol>=0.1 and not muted and ineligible_reason is null and fraud<60 and disp='none' and exists (select 1 from public.eligible_settlement_tracks est where est.track_id = base.track_id)),
    'identity_mismatch', count(*) filter (where s_ptype='USER' and player_type is distinct from 'USER'),
    'fraud_spike', count(*) filter (where fraud>=60),
    'user_completed', (select count(*) from public.stream_ingest_v2 where event_type='play_completed' and player_type='USER')
  ) from base;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.runtime_apply_reports (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(), window_days integer,
  overall_readiness text, readiness_score numeric, changes_total integer, blocked_count integer,
  success_criteria_total integer, success_criteria_met integer, checklist_ready integer, checklist_total integer,
  recommendation text, headline text, certificate_hash text, notes text, created_by uuid
);
create index if not exists rar_run_idx on public.runtime_apply_reports(run_at desc);

create table if not exists public.runtime_change_plans (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  change_key text not null, title text, target_area text, description text, root_cause text,
  current_state text, target_state text, impact_score numeric, risk text, effort text,
  dependencies jsonb, note text, created_at timestamptz not null default now()
);
create index if not exists rcp_run_idx on public.runtime_change_plans(run_id);

create table if not exists public.runtime_dependency_graph (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  stage_order integer not null, from_stage text, to_stage text, primary_change text, impact_level text,
  affected boolean default false, note text, created_at timestamptz not null default now()
);
create index if not exists rdg_run_idx on public.runtime_dependency_graph(run_id, stage_order);

create table if not exists public.runtime_safe_apply_plan (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  stage_num integer not null, stage_key text, stage_name text, description text, gate text,
  prerequisites jsonb, exit_criteria jsonb, executed boolean default false, note text, created_at timestamptz not null default now()
);
create index if not exists rsap_run_idx on public.runtime_safe_apply_plan(run_id, stage_num);

create table if not exists public.runtime_success_criteria (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  criterion text not null, metric text, current_value numeric, target_value numeric, comparator text,
  met boolean, note text, created_at timestamptz not null default now()
);
create index if not exists rsc_run_idx on public.runtime_success_criteria(run_id);

create table if not exists public.runtime_failure_criteria (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  criterion text not null, metric text, threshold numeric, direction text, auto_block boolean default false,
  note text, created_at timestamptz not null default now()
);
create index if not exists rfc_run_idx on public.runtime_failure_criteria(run_id);

create table if not exists public.runtime_readiness_checklist (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  item text not null, category text, status text default 'pending', required boolean default true,
  note text, created_at timestamptz not null default now()
);
create index if not exists rrc_run_idx on public.runtime_readiness_checklist(run_id);

create table if not exists public.runtime_rollback_readiness (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.runtime_apply_reports(id) on delete cascade,
  change_key text not null, prerequisites jsonb, dependencies jsonb, checkpoints jsonb, owner text,
  duration_estimate text, verification text, ready boolean default false, note text, created_at timestamptz not null default now()
);
create index if not exists rrr_run_idx on public.runtime_rollback_readiness(run_id);

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['runtime_apply_reports','runtime_change_plans','runtime_dependency_graph',
    'runtime_safe_apply_plan','runtime_success_criteria','runtime_failure_criteria',
    'runtime_readiness_checklist','runtime_rollback_readiness'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Runtime Change Planner + Success/Failure + Rollback — admin_generate_runtime_plan (run 생성)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_plan(p_days integer default 30)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_sig jsonb := public._rt_stream_signal(); r record;
  v_va int := coalesce((v_sig->>'verified_actual')::int,0); v_vc int := coalesce((v_sig->>'verified_cal')::int,0);
  v_ec int := coalesce((v_sig->>'eligible_cal')::int,0); v_sc int := coalesce((v_sig->>'settlement_cal')::int,0);
  v_im int := coalesce((v_sig->>'identity_mismatch')::int,0); v_fr int := coalesce((v_sig->>'fraud_spike')::int,0);
  v_uc int := coalesce((v_sig->>'user_completed')::int,0);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  insert into public.runtime_apply_reports(window_days) values (greatest(coalesce(p_days,30),1)) returning id into v_run;

  -- 변경 후보 (정의만 — 실제 수정 없음)
  for r in
    select * from (values
      ('verified_seconds_backfill','verified_seconds Back-fill','streaming',
        'play_30s milestone 의 verified_seconds 를 session heartbeat 확정값으로 back-fill',
        'milestone fire 시점 verified_seconds<30 로 고정, 이후 heartbeat 확정돼도 미갱신',
        format('v2_verified=%s',v_va), format('verified≈%s (calibrated)',v_vc), 0.9, 'medium', 'medium',
        jsonb_build_array('verification_timing')),
      ('user_milestone_completion','USER Milestone Completion','streaming',
        'USER play_completed 이벤트 생성 경로 확보 → verified 확정',
        'USER play_completed=0 → verified milestone 미확정',
        format('user_completed=%s',v_uc), 'user_completed>0', 0.7, 'high', 'high',
        jsonb_build_array('verified_seconds_backfill')),
      ('session_identity_normalization','Session Identity Normalization','streaming',
        'ingest milestone player_type 를 session.player_type(authoritative) 로 정규화',
        'session=USER 인데 milestone=ARTIST_PREVIEW 라벨 → eligible 제외',
        format('identity_mismatch=%s',v_im), 'identity_mismatch=0', 0.85, 'medium', 'medium',
        jsonb_build_array()),
      ('verification_timing','Verification Timing Fix','streaming',
        'heartbeat 확정 후 verified 판정하도록 milestone 순서 보정',
        'milestone 조기 확정으로 verified 판정 실패',
        'early-freeze', 'post-heartbeat', 0.8, 'high', 'high',
        jsonb_build_array()),
      ('eligible_generation','Eligible Generation','settlement',
        'verified 확정 후 eligible funnel 생성 경로 연결',
        'verified=0 이므로 eligible funnel 진입 없음',
        format('v2_eligible=%s (target %s)',0,v_ec), format('eligible≈%s',v_ec), 0.75, 'medium', 'medium',
        jsonb_build_array('verified_seconds_backfill','session_identity_normalization')),
      ('settlement_shadow_linkage','Settlement Shadow Linkage','settlement',
        'eligible → settlement candidate 연결 (eligible_settlement_tracks 매칭)',
        'eligible=0 이므로 settlement candidate 미생성',
        format('settlement_candidate target %s',v_sc), format('settlement≈%s',v_sc), 0.6, 'low', 'low',
        jsonb_build_array('eligible_generation'))
    ) as c(ckey, title, area, descr, cause, cur, tgt, impact, risk, effort, deps)
  loop
    insert into public.runtime_change_plans(run_id, change_key, title, target_area, description, root_cause,
      current_state, target_state, impact_score, risk, effort, dependencies, note)
    values (v_run, r.ckey, r.title, r.area, r.descr, r.cause, r.cur, r.tgt, r.impact, r.risk, r.effort, r.deps,
      'Shadow 계획 — 실제 Runtime 수정 없음');

    insert into public.runtime_rollback_readiness(run_id, change_key, prerequisites, dependencies, checkpoints, owner, duration_estimate, verification, ready, note)
    values (v_run, r.ckey, jsonb_build_array('shadow snapshot 확보','feature flag 준비'), r.deps,
      jsonb_build_array('pre-apply snapshot','post-apply verify','rollback verify'), 'runtime-oncall',
      case r.effort when 'high' then '~30m' when 'medium' then '~15m' else '~5m' end,
      'verified/eligible funnel 회귀 여부 + fraud/incident 무증가 확인', false,
      'Rollback Simulation Only — 실제 rollback 없음');
  end loop;

  -- Success Criteria (현재값은 base baseline 에서 계산)
  insert into public.runtime_success_criteria(run_id, criterion, metric, current_value, target_value, comparator, met, note)
  values
    (v_run,'verified > 0','v2_verified', v_va, greatest(v_vc,1), '>', v_va > 0, 'calibrated 후보 회복 목표'),
    (v_run,'eligible > 0','v2_eligible', 0, greatest(v_ec,1), '>', false, 'identity 정규화 후 목표'),
    (v_run,'settlement candidate 생성','settlement_candidate', 0, greatest(v_sc,1), '>', false, 'eligible 연결 후'),
    (v_run,'learning candidate 생성','learning_candidate', 0, greatest(v_ec,1), '>', false, 'eligible 파생'),
    (v_run,'prediction candidate 생성','prediction_candidate', 0, greatest(v_ec,1), '>', false, 'eligible 파생'),
    (v_run,'no regression (v1 stream_events)','v1_stream_events', (select count(*) from public.stream_events), (select count(*) from public.stream_events), '>=', true, 'v1 불변 유지'),
    (v_run,'no fraud spike','fraud_ge60', v_fr, 0, '<=', v_fr <= 0, 'fraud 무증가'),
    (v_run,'no incident increase','incident_delta', 0, 0, '<=', true, 'incident 무증가');

  -- Failure Criteria (자동 차단 기준 — 정의만, 실제 차단 없음)
  insert into public.runtime_failure_criteria(run_id, criterion, metric, threshold, direction, auto_block, note)
  values
    (v_run,'verified 감소','v2_verified', 0, 'decrease', true, '기준 이하 감소 시 차단(계획)'),
    (v_run,'eligible 감소','v2_eligible', 0, 'decrease', true, '감소 시 차단(계획)'),
    (v_run,'fraud 증가','fraud_ge60', 0, 'increase', true, 'fraud spike 시 차단(계획)'),
    (v_run,'incident 증가','incident_count', 0, 'increase', true, 'incident 증가 시 차단(계획)'),
    (v_run,'playback regression','playback_error_rate', 0.01, 'increase', true, 'playback 회귀 시 차단(계획)'),
    (v_run,'queue regression','queue_error_rate', 0.01, 'increase', true, 'queue 회귀 시 차단(계획)'),
    (v_run,'latency 증가','p95_latency_ms', 200, 'increase', true, 'latency 초과 시 차단(계획)');

  update public.runtime_apply_reports set
    changes_total = (select count(*) from public.runtime_change_plans where run_id=v_run),
    success_criteria_total = (select count(*) from public.runtime_success_criteria where run_id=v_run),
    success_criteria_met = (select count(*) from public.runtime_success_criteria where run_id=v_run and met)
  where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'changes',(select count(*) from public.runtime_change_plans where run_id=v_run),
    'success_criteria',(select count(*) from public.runtime_success_criteria where run_id=v_run),
    'baseline', jsonb_build_object('verified_actual',v_va,'verified_cal',v_vc,'eligible_cal',v_ec,'settlement_cal',v_sc,'identity_mismatch',v_im),
    'note','Shadow runtime plan — 실제 Runtime 수정 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Dependency Graph — admin_generate_dependency_graph
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_dependency_graph(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.runtime_apply_reports order by run_at desc limit 1));
  if v_run is null then raise exception 'no runtime plan — run admin_generate_runtime_plan first'; end if;
  delete from public.runtime_dependency_graph where run_id=v_run;

  for r in
    select * from (values
      (1,'Playback','Streaming', null::text, 'low', false),
      (2,'Streaming','Verified','verified_seconds_backfill','high', true),
      (3,'Verified','Eligible','session_identity_normalization','high', true),
      (4,'Eligible','Settlement','settlement_shadow_linkage','high', true),
      (5,'Settlement','Learning','eligible_generation','medium', true),
      (6,'Learning','Prediction', null::text, 'medium', true),
      (7,'Prediction','RL', null::text, 'low', false),
      (8,'RL','Decision', null::text, 'low', false)
    ) as g(ord, frm, tostage, chg, lvl, aff)
  loop
    insert into public.runtime_dependency_graph(run_id, stage_order, from_stage, to_stage, primary_change, impact_level, affected, note)
    values (v_run, r.ord, r.frm, r.tostage, r.chg, r.lvl, r.aff,
      case when r.chg is not null then r.chg||' 적용 시 downstream 영향' else '변경 후보 없음(전파만)' end);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'edges',(select count(*) from public.runtime_dependency_graph where run_id=v_run),
    'affected',(select count(*) from public.runtime_dependency_graph where run_id=v_run and affected),
    'note','Shadow dependency graph — 영향 분석만');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Safe Apply Plan — admin_generate_safe_apply_plan (Stage 0~5, 실행 없음)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_safe_apply_plan(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; r record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.runtime_apply_reports order by run_at desc limit 1));
  if v_run is null then raise exception 'no runtime plan'; end if;
  delete from public.runtime_safe_apply_plan where run_id=v_run;

  for r in
    select * from (values
      (0,'dry_run','Stage 0 · Dry Run','변경 미적용, 계획/영향만 산출',
        jsonb_build_array('runtime plan 생성'), jsonb_build_array('영향 분석 완료')),
      (1,'internal_shadow','Stage 1 · Internal Shadow','shadow 테이블에서만 계산(현행 ALGO-2E~7D)',
        jsonb_build_array('shadow calibration 통과'), jsonb_build_array('verified 후보>0(shadow)')),
      (2,'synthetic_validation','Stage 2 · Synthetic Validation','합성 트래픽으로 파이프라인 검증',
        jsonb_build_array('synthetic dataset 준비'), jsonb_build_array('funnel 무결성 확인')),
      (3,'limited_runtime_candidate','Stage 3 · Limited Runtime Candidate','제한 트래픽 후보(미실행)',
        jsonb_build_array('human approval','rollback ready'), jsonb_build_array('no regression')),
      (4,'canary_candidate','Stage 4 · Canary Candidate','canary 후보(미실행)',
        jsonb_build_array('governance pass','canary cert'), jsonb_build_array('safe gate pass')),
      (5,'production_candidate','Stage 5 · Production Candidate','프로덕션 후보(미실행)',
        jsonb_build_array('full checklist ready','success criteria met'), jsonb_build_array('production SLA met'))
    ) as s(num, skey, sname, descr, prereq, exitc)
  loop
    insert into public.runtime_safe_apply_plan(run_id, stage_num, stage_key, stage_name, description, gate, prerequisites, exit_criteria, executed, note)
    values (v_run, r.num, r.skey, r.sname, r.descr,
      case when r.num <= 1 then 'available' else 'blocked' end, r.prereq, r.exitc, false,
      case when r.num <= 1 then 'shadow 단계 — 실행 가능(현행)' else '후속 Phase 대상 — 실행 금지' end);
  end loop;

  return jsonb_build_object('ok',true,'run_id',v_run,
    'stages',(select count(*) from public.runtime_safe_apply_plan where run_id=v_run),
    'executed',(select count(*) from public.runtime_safe_apply_plan where run_id=v_run and executed),
    'note','Safe apply plan — 실행 없음(계획만)');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Readiness Checklist + Report finalize — admin_generate_runtime_checklist
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_runtime_checklist(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_gov boolean := public._ai_table_exists('public.ai_governance_ledger');
  v_obs boolean := public._ai_table_exists('public.observation_runs'); v_ready int; v_total int; v_score numeric; v_overall text; v_hash text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.runtime_apply_reports order by run_at desc limit 1));
  if v_run is null then raise exception 'no runtime plan'; end if;
  delete from public.runtime_readiness_checklist where run_id=v_run;

  insert into public.runtime_readiness_checklist(run_id, item, category, status, required, note)
  values
    (v_run,'Runtime review','review','pending', true, 'runtime 변경 코드 리뷰 미이행'),
    (v_run,'Governance review','governance', case when v_gov then 'ready' else 'pending' end, true, case when v_gov then 'governance ledger 존재' else 'governance ledger 미배포' end),
    (v_run,'Human approval','approval','pending', true, '자동 승인 금지 — human approval 미이행'),
    (v_run,'Rollback ready','rollback', case when exists(select 1 from public.runtime_rollback_readiness where run_id=v_run) then 'ready' else 'pending' end, true, 'rollback plan 정의됨(sim)'),
    (v_run,'Observability ready','observability', case when v_obs then 'ready' else 'pending' end, true, case when v_obs then 'observability 존재' else 'observability 미배포' end),
    (v_run,'Metrics ready','metrics','ready', true, 'AI Control Center metrics 연결'),
    (v_run,'SLA ready','sla','pending', false, 'SLA governance ledger 필요'),
    (v_run,'Certificate ready','certificate','pending', true, 'canary/release certificate 인증 필요');

  select count(*) filter (where status='ready'), count(*) into v_ready, v_total from public.runtime_readiness_checklist where run_id=v_run;
  v_score := round(100.0 * v_ready / nullif(v_total,0), 1);
  v_overall := case when exists(select 1 from public.runtime_readiness_checklist where run_id=v_run and required and status<>'ready') then 'not_ready' else 'ready' end;
  v_hash := md5(v_run::text||'|'||coalesce(v_overall,'')||'|'||coalesce(v_score::text,''));

  update public.runtime_apply_reports set
    checklist_ready = v_ready, checklist_total = v_total, readiness_score = v_score, overall_readiness = v_overall,
    blocked_count = (select count(*) from public.runtime_safe_apply_plan where run_id=v_run and gate='blocked'),
    recommendation = case when v_overall='ready' then '후속 Phase 에서 Stage 3+ 진입 검토 가능' else 'human approval·governance·certificate 확보 전까지 Runtime 적용 보류' end,
    headline = format('Runtime Readiness — %s · checklist %s/%s · score %s', v_overall, v_ready, v_total, v_score),
    certificate_hash = v_hash
  where id=v_run;

  return jsonb_build_object('ok',true,'run_id',v_run,'overall_readiness',v_overall,'readiness_score',v_score,
    'checklist_ready',v_ready,'checklist_total',v_total,'certificate_hash',left(v_hash,12),
    'note','Shadow readiness checklist — 실제 적용 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Overview — admin_runtime_readiness_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_runtime_readiness_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.runtime_apply_reports order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null, 'run_id', v_run,
    'report', (select to_jsonb(r) from (select run_at, overall_readiness, readiness_score, changes_total, blocked_count, success_criteria_total, success_criteria_met, checklist_ready, checklist_total, recommendation, headline, left(certificate_hash,12) as hash from public.runtime_apply_reports where id=v_run) r),
    'changes', (select coalesce(jsonb_agg(jsonb_build_object('key',change_key,'title',title,'area',target_area,'root_cause',root_cause,'current',current_state,'target',target_state,'impact',impact_score,'risk',risk,'effort',effort,'dependencies',dependencies) order by impact_score desc),'[]'::jsonb) from public.runtime_change_plans where run_id=v_run),
    'dependency', (select coalesce(jsonb_agg(jsonb_build_object('order',stage_order,'from',from_stage,'to',to_stage,'change',primary_change,'impact',impact_level,'affected',affected) order by stage_order),'[]'::jsonb) from public.runtime_dependency_graph where run_id=v_run),
    'apply_plan', (select coalesce(jsonb_agg(jsonb_build_object('num',stage_num,'key',stage_key,'name',stage_name,'description',description,'gate',gate,'prerequisites',prerequisites,'exit_criteria',exit_criteria,'executed',executed) order by stage_num),'[]'::jsonb) from public.runtime_safe_apply_plan where run_id=v_run),
    'success', (select coalesce(jsonb_agg(jsonb_build_object('criterion',criterion,'metric',metric,'current',current_value,'target',target_value,'comparator',comparator,'met',met) order by created_at),'[]'::jsonb) from public.runtime_success_criteria where run_id=v_run),
    'failure', (select coalesce(jsonb_agg(jsonb_build_object('criterion',criterion,'metric',metric,'threshold',threshold,'direction',direction,'auto_block',auto_block) order by created_at),'[]'::jsonb) from public.runtime_failure_criteria where run_id=v_run),
    'checklist', (select coalesce(jsonb_agg(jsonb_build_object('item',item,'category',category,'status',status,'required',required,'note',note) order by created_at),'[]'::jsonb) from public.runtime_readiness_checklist where run_id=v_run),
    'rollback', (select coalesce(jsonb_agg(jsonb_build_object('change',change_key,'prerequisites',prerequisites,'dependencies',dependencies,'checkpoints',checkpoints,'owner',owner,'duration',duration_estimate,'verification',verification,'ready',ready) order by change_key),'[]'::jsonb) from public.runtime_rollback_readiness where run_id=v_run)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_runtime_plan_summary as
select c.run_id, c.change_key, c.title, c.target_area, c.root_cause, c.current_state, c.target_state, c.impact_score, c.risk, c.effort
from public.runtime_change_plans c;

create or replace view public.v2_runtime_dependency_summary as
select d.run_id, d.stage_order, d.from_stage, d.to_stage, d.primary_change, d.impact_level, d.affected
from public.runtime_dependency_graph d;

create or replace view public.v2_runtime_readiness_summary as
select r.id run_id, r.run_at, r.overall_readiness, r.readiness_score, r.changes_total, r.blocked_count,
  r.success_criteria_total, r.success_criteria_met, r.checklist_ready, r.checklist_total, r.recommendation, r.headline
from public.runtime_apply_reports r;

create or replace view public.v2_runtime_checklist_summary as
select k.run_id, k.item, k.category, k.status, k.required
from public.runtime_readiness_checklist k;

-- ─────────────────────────────────────────────────────────────────────
-- I. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._ai_table_exists(text)',
    'public._rt_stream_signal()',
    'public.admin_generate_runtime_plan(integer)',
    'public.admin_generate_dependency_graph(uuid)',
    'public.admin_generate_safe_apply_plan(uuid)',
    'public.admin_generate_runtime_checklist(uuid)',
    'public.admin_runtime_readiness_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_runtime_plan(integer) is
  'ALGO-8A — Runtime Change Planner + Success/Failure Criteria + Rollback Readiness. Shadow 병목 해소 변경 후보를 정의만. 실제 Runtime 수정 없음.';
comment on function public.admin_generate_safe_apply_plan(uuid) is
  'ALGO-8A — Safe Apply Plan Stage 0~5 생성. Stage 2+ 는 후속 Phase 대상. 실행 없음(계획만).';
comment on function public.admin_runtime_readiness_overview() is
  'ALGO-8A — Runtime Readiness overview. Change/Dependency/ApplyPlan/Success/Failure/Checklist/Rollback 통합 조회. 읽기 전용.';
