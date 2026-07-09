-- 0436 — Phase ALGO-6A: Unified AI Decision Layer (Shadow)
--
-- 목적:
--   ALGO-4~5B 의 모든 AI 결과(Prediction/Exposure/Reward/Bandit/Calibration/Ensemble)를
--   하나의 Unified Decision Score 로 통합하고, Decision Explanation · Risk · Candidate ·
--   Canary Plan · Human Approval Gate 까지 산출하는 통합 의사결정 레이어. 전부 Shadow.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/RL/Settlement/Streaming/Runtime 무변경.
--   • Production Apply 금지. additive only. 기존 결과 불변. Canary/Approval 은 계획·요청만(자동 적용 없음).
--
-- 자족적: 6개 sub-score 는 playback_events_v2(completion_percent/event_type/store_type_slug)
--   집계로 결정론적으로 산출한다(기저 ALGO-4/5 테이블 유무와 무관). Unified Decision 은 이를
--   가중 합성한다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helper — risk_level / candidate_state 분류
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._decision_risk_level(p_risk numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case when coalesce(p_risk,1) >= 0.5 then 'high'
              when coalesce(p_risk,1) >= 0.25 then 'medium'
              else 'low' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Decision Engine tables
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_runs (
  id uuid primary key default gen_random_uuid(),
  run_at timestamptz not null default now(),
  track_count integer, window_days integer, notes text, created_by uuid
);
create index if not exists adr_run_idx on public.ai_decision_runs(run_at desc);

create table if not exists public.ai_unified_decisions (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_decision_runs(id) on delete cascade,
  track_id uuid not null,
  decision_prediction_score numeric default 0,
  decision_exposure_score numeric default 0,
  decision_reward_score numeric default 0,
  decision_bandit_score numeric default 0,
  decision_calibration_score numeric default 0,
  decision_ensemble_score numeric default 0,
  decision_confidence numeric default 0,
  decision_risk numeric default 0,
  decision_score numeric default 0,             -- Unified Decision Score
  decision_state text,                          -- ranked band label
  rank integer,
  created_at timestamptz not null default now()
);
create index if not exists aud_run_idx on public.ai_unified_decisions(run_id, decision_score desc);
create index if not exists aud_track_idx on public.ai_unified_decisions(track_id);

-- ─────────────────────────────────────────────────────────────────────
-- B. Decision Explanation
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_explanations (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_decision_runs(id) on delete cascade,
  track_id uuid not null,
  prediction_contrib numeric, reward_contrib numeric, exposure_contrib numeric,
  bandit_contrib numeric, ensemble_contrib numeric, calibration_contrib numeric,
  confidence_impact numeric, risk_impact numeric,
  top_factor text, factors jsonb, explanation text,
  created_at timestamptz not null default now()
);
create index if not exists ade_run_idx on public.ai_decision_explanations(run_id);
create index if not exists ade_track_idx on public.ai_decision_explanations(track_id);

-- ─────────────────────────────────────────────────────────────────────
-- C. Decision Risk Engine
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_risk (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_decision_runs(id) on delete cascade,
  track_id uuid not null,
  risk_level text, uncertainty numeric, confidence numeric, cold_start boolean not null default false,
  sample_size integer, bias numeric, drift numeric, risk_score numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists adrisk_run_idx on public.ai_decision_risk(run_id, risk_score desc);

-- ─────────────────────────────────────────────────────────────────────
-- D. Decision Candidate
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_candidates (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.ai_decision_runs(id) on delete cascade,
  track_id uuid not null,
  candidate_state text not null,                -- approved/shadow/blocked/needs_review
  decision_score numeric, risk_level text, confidence numeric, reason text,
  created_at timestamptz not null default now()
);
create index if not exists adc_run_idx on public.ai_decision_candidates(run_id, candidate_state);

-- ─────────────────────────────────────────────────────────────────────
-- E. Canary Planner (계획만 — 실제 적용 없음)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_canary_plans (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_decision_runs(id) on delete cascade,
  candidate_id uuid references public.ai_decision_candidates(id) on delete cascade,
  track_id uuid, plan_state text not null default 'planned',
  applied boolean not null default false,       -- 항상 false (Shadow)
  traffic_plan jsonb, notes text, created_by uuid, created_at timestamptz not null default now()
);
create index if not exists acp_run_idx on public.ai_canary_plans(run_id);

create table if not exists public.ai_canary_stages (
  id uuid primary key default gen_random_uuid(),
  canary_plan_id uuid not null references public.ai_canary_plans(id) on delete cascade,
  stage_order integer not null, traffic_pct integer not null,   -- 10/25/50/100
  gate_criteria jsonb, status text not null default 'pending',
  created_at timestamptz not null default now()
);
create index if not exists acs_plan_idx on public.ai_canary_stages(canary_plan_id, stage_order);

-- ─────────────────────────────────────────────────────────────────────
-- F. Human Approval Gate (요청만 — 자동 적용 금지)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_approvals (
  id uuid primary key default gen_random_uuid(),
  run_id uuid references public.ai_decision_runs(id) on delete cascade,
  candidate_id uuid references public.ai_decision_candidates(id) on delete cascade,
  canary_plan_id uuid references public.ai_canary_plans(id) on delete cascade,
  track_id uuid, request_state text not null default 'requested',  -- requested/pending/approved/rejected
  auto_apply boolean not null default false,    -- 항상 false
  requested_by uuid, decided_by uuid, note text,
  created_at timestamptz not null default now(), decided_at timestamptz
);
create index if not exists ada_run_idx on public.ai_decision_approvals(run_id, request_state);

-- ─────────────────────────────────────────────────────────────────────
-- G. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_decision_runs','ai_unified_decisions','ai_decision_explanations','ai_decision_risk',
    'ai_decision_candidates','ai_canary_plans','ai_canary_stages','ai_decision_approvals'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Unified Decision Engine — admin_generate_unified_decision
--    6 sub-score + confidence + risk → Unified Decision Score + Explanation + Risk
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_unified_decision(p_days integer default 120, p_track_limit integer default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run uuid; v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,120),1));
  v_max_plays numeric; v_store_ct integer; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select greatest(max(c),1) into v_max_plays from (select count(*) c from public.playback_events_v2 where created_at>=v_from group by track_id) z;
  select greatest(count(distinct store_type_slug),1) into v_store_ct from public.playback_events_v2 where created_at>=v_from and store_type_slug is not null;

  insert into public.ai_decision_runs(run_at, window_days) values (now(), greatest(coalesce(p_days,120),1)) returning id into v_run;

  -- base aggregates → 6 sub-scores + confidence + risk + unified score (all deterministic, shadow)
  create temp table _dec on commit drop as
  select b.track_id,
    -- sub-scores
    round((0.6*b.completion + 0.4*b.eligible)::numeric,4) as s_prediction,
    round(b.exposure::numeric,4) as s_exposure,
    round((0.5*b.completion + 0.3*b.eligible + 0.2*(1-b.skip))::numeric,4) as s_reward,
    round((0.5*b.completion + 0.3*b.eligible + 0.2*(1-b.skip))*0.9::numeric + 0.05,4) as s_bandit,
    round(b.confidence::numeric,4) as s_calibration,
    round(((0.6*b.completion+0.4*b.eligible) + (0.5*b.completion+0.3*b.eligible+0.2*(1-b.skip)) + b.confidence)/3.0::numeric,4) as s_ensemble,
    -- confidence + risk
    round(b.confidence::numeric,4) as confidence,
    (b.plays < 5) as cold_start, b.plays as sample_size,
    round(abs(b.completion - b.eligible)::numeric,4) as bias,
    round(b.drift::numeric,4) as drift,
    round(least(1.0, 0.30*(case when b.plays<5 then 1 else 0 end) + 0.25*(1-b.confidence) + 0.25*b.skip + 0.20*b.drift)::numeric,4) as risk_score
  from (
    select e.track_id, count(*)::int as plays,
      round((avg(e.completion_percent)/100.0)::numeric,6) as completion,
      round(avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)::numeric,6) as skip,
      round(avg(case when coalesce(e.completion_percent,0)>=60 then 1 else 0 end)::numeric,6) as eligible,
      round(least(1.0, count(*)::numeric / v_max_plays),6) as exposure,
      round(least(1.0, count(*)::numeric / 20.0),6) as confidence,
      round(coalesce(abs(
        (avg(e.completion_percent) filter (where e.created_at >= now() - interval '30 days'))
        - avg(e.completion_percent))/100.0, 0)::numeric,6) as drift
    from public.playback_events_v2 e
    where e.created_at >= v_from
    group by e.track_id
    order by count(*) desc
    limit greatest(coalesce(p_track_limit,200),1)
  ) b;

  -- Unified Decision Score = Σ(weight×sub) × confidence-gate × (1 − risk-penalty)
  insert into public.ai_unified_decisions(run_id, track_id, decision_prediction_score, decision_exposure_score,
    decision_reward_score, decision_bandit_score, decision_calibration_score, decision_ensemble_score,
    decision_confidence, decision_risk, decision_score, decision_state, rank)
  select v_run, d.track_id, d.s_prediction, d.s_exposure, d.s_reward, d.s_bandit, d.s_calibration, d.s_ensemble,
    d.confidence, d.risk_score,
    round(((0.22*d.s_prediction + 0.20*d.s_reward + 0.16*d.s_exposure + 0.14*d.s_bandit
      + 0.16*d.s_ensemble + 0.12*d.s_calibration) * (0.5 + 0.5*d.confidence) * (1 - 0.4*d.risk_score))::numeric,4),
    null,
    row_number() over (order by ((0.22*d.s_prediction + 0.20*d.s_reward + 0.16*d.s_exposure + 0.14*d.s_bandit
      + 0.16*d.s_ensemble + 0.12*d.s_calibration) * (0.5 + 0.5*d.confidence) * (1 - 0.4*d.risk_score)) desc)
  from _dec d;
  get diagnostics v_n = row_count;

  update public.ai_unified_decisions set decision_state = case
    when decision_score >= 0.55 then 'strong' when decision_score >= 0.40 then 'moderate'
    when decision_score >= 0.25 then 'weak' else 'poor' end
  where run_id=v_run;

  -- Explanation: 각 요인 기여 = weight × sub-score, top_factor = argmax
  insert into public.ai_decision_explanations(run_id, track_id, prediction_contrib, reward_contrib, exposure_contrib,
    bandit_contrib, ensemble_contrib, calibration_contrib, confidence_impact, risk_impact, top_factor, factors, explanation)
  select v_run, d.track_id,
    round((0.22*d.s_prediction)::numeric,4), round((0.20*d.s_reward)::numeric,4), round((0.16*d.s_exposure)::numeric,4),
    round((0.14*d.s_bandit)::numeric,4), round((0.16*d.s_ensemble)::numeric,4), round((0.12*d.s_calibration)::numeric,4),
    round((0.5 + 0.5*d.confidence)::numeric,4), round((1 - 0.4*d.risk_score)::numeric,4),
    (array['prediction','reward','exposure','bandit','ensemble','calibration'])[
      (select i from (select unnest(array[0.22*d.s_prediction,0.20*d.s_reward,0.16*d.s_exposure,0.14*d.s_bandit,0.16*d.s_ensemble,0.12*d.s_calibration]) v, generate_series(1,6) i) z order by v desc limit 1)],
    jsonb_build_object('prediction',0.22*d.s_prediction,'reward',0.20*d.s_reward,'exposure',0.16*d.s_exposure,
      'bandit',0.14*d.s_bandit,'ensemble',0.16*d.s_ensemble,'calibration',0.12*d.s_calibration),
    'Prediction/Reward/Exposure/Bandit/Ensemble 가중 합성 후 confidence('||round(d.confidence,3)||') 게이트와 risk('||round(d.risk_score,3)||') 페널티 적용 (shadow).'
  from _dec d;

  -- Risk rows
  insert into public.ai_decision_risk(run_id, track_id, risk_level, uncertainty, confidence, cold_start, sample_size, bias, drift, risk_score)
  select v_run, d.track_id, public._decision_risk_level(d.risk_score), round((1-d.confidence)::numeric,4), d.confidence,
    d.cold_start, d.sample_size, d.bias, d.drift, d.risk_score
  from _dec d;

  update public.ai_decision_runs set track_count=v_n where id=v_run;

  return jsonb_build_object('ok',true,'decision_run_id',v_run,'tracks',v_n,
    'avg_score',(select round(avg(decision_score)::numeric,4) from public.ai_unified_decisions where run_id=v_run),
    'note','Unified Decision — shadow only, 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Decision Candidates — admin_generate_decision_candidates
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_decision_candidates(p_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_n integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_decision_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no decision run — run admin_generate_unified_decision first'; end if;
  delete from public.ai_decision_candidates where run_id=v_run;

  insert into public.ai_decision_candidates(run_id, track_id, candidate_state, decision_score, risk_level, confidence, reason)
  select v_run, u.track_id,
    case
      when r.risk_score > 0.5 or r.cold_start then 'blocked'
      when u.decision_score >= 0.45 and r.risk_score <= 0.2 and u.decision_confidence >= 0.5 then 'approved'
      when u.decision_score >= 0.35 and r.risk_score <= 0.35 then 'shadow'
      else 'needs_review' end,
    u.decision_score, r.risk_level, u.decision_confidence,
    case
      when r.risk_score > 0.5 or r.cold_start then 'risk/cold_start 로 차단 — 승격 불가'
      when u.decision_score >= 0.45 and r.risk_score <= 0.2 and u.decision_confidence >= 0.5 then 'high score·low risk·high confidence → 승인 후보'
      when u.decision_score >= 0.35 and r.risk_score <= 0.35 then 'moderate → shadow 확대 후보'
      else '표본/점수 부족 → 검토 필요' end
  from public.ai_unified_decisions u
  join public.ai_decision_risk r on r.run_id=u.run_id and r.track_id=u.track_id
  where u.run_id=v_run;
  get diagnostics v_n = row_count;

  return jsonb_build_object('ok',true,'decision_run_id',v_run,'candidates',v_n,
    'breakdown', (select coalesce(jsonb_object_agg(candidate_state, c),'{}'::jsonb) from (select candidate_state, count(*) c from public.ai_decision_candidates where run_id=v_run group by 1) z),
    'note','상태 분류만 — 자동 적용 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Canary Planner + Approval Gate — admin_generate_canary_plan
--    approved 후보에 대해 10/25/50/100 traffic plan + approval 요청 생성(적용 없음)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_canary_plan(p_run_id uuid default null, p_top integer default 20)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; c record; v_plan uuid; v_plans integer := 0; v_appr integer := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.ai_decision_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no decision run'; end if;
  if not exists (select 1 from public.ai_decision_candidates where run_id=v_run) then
    perform public.admin_generate_decision_candidates(v_run);
  end if;

  -- clear previous plans/approvals for this run (idempotent)
  delete from public.ai_decision_approvals where run_id=v_run;
  delete from public.ai_canary_plans where run_id=v_run;

  for c in select * from public.ai_decision_candidates where run_id=v_run and candidate_state='approved'
           order by decision_score desc limit greatest(coalesce(p_top,20),1) loop
    insert into public.ai_canary_plans(run_id, candidate_id, track_id, plan_state, applied, traffic_plan, notes)
    values (v_run, c.id, c.track_id, 'planned', false,
      jsonb_build_object('stages', jsonb_build_array(10,25,50,100), 'score', c.decision_score, 'risk', c.risk_level),
      'Shadow canary plan — 실제 트래픽 분배 없음')
    returning id into v_plan;
    v_plans := v_plans + 1;

    -- 4 stages (10/25/50/100) with gate criteria
    insert into public.ai_canary_stages(canary_plan_id, stage_order, traffic_pct, gate_criteria, status)
    select v_plan, ord, pct,
      jsonb_build_object('min_decision_score', 0.45, 'max_risk', 0.2, 'min_confidence', 0.5, 'min_observations', pct*5),
      'pending'
    from (values (1,10),(2,25),(3,50),(4,100)) s(ord,pct);

    -- Human approval request (요청만 · auto_apply=false)
    insert into public.ai_decision_approvals(run_id, candidate_id, canary_plan_id, track_id, request_state, auto_apply, note)
    values (v_run, c.id, v_plan, c.track_id, 'requested', false, '운영 반영 전 인간 승인 필요 — 자동 적용 없음');
    v_appr := v_appr + 1;
  end loop;

  return jsonb_build_object('ok',true,'decision_run_id',v_run,'canary_plans',v_plans,'approval_requests',v_appr,
    'note','Canary 계획·승인요청만 생성 — 자동 적용/트래픽 분배 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- K. Overview — admin_ai_decision_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_decision_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select id into v_run from public.ai_decision_runs order by run_at desc limit 1;
  select jsonb_build_object(
    'has_data', v_run is not null,
    'decision_run_id', v_run,
    'summary', jsonb_build_object(
      'tracks', (select count(*) from public.ai_unified_decisions where run_id=v_run),
      'avg_score', (select round(avg(decision_score)::numeric,4) from public.ai_unified_decisions where run_id=v_run),
      'avg_risk', (select round(avg(decision_risk)::numeric,4) from public.ai_unified_decisions where run_id=v_run),
      'avg_confidence', (select round(avg(decision_confidence)::numeric,4) from public.ai_unified_decisions where run_id=v_run)),
    'top', (select coalesce(jsonb_agg(jsonb_build_object('track_id',u.track_id,'score',u.decision_score,'state',u.decision_state,
        'prediction',u.decision_prediction_score,'reward',u.decision_reward_score,'exposure',u.decision_exposure_score,
        'bandit',u.decision_bandit_score,'ensemble',u.decision_ensemble_score,'calibration',u.decision_calibration_score,
        'confidence',u.decision_confidence,'risk',u.decision_risk,
        'top_factor',(select top_factor from public.ai_decision_explanations e where e.run_id=u.run_id and e.track_id=u.track_id)) order by u.decision_score desc),'[]'::jsonb)
      from (select * from public.ai_unified_decisions where run_id=v_run order by decision_score desc limit 15) u),
    'candidates', (select coalesce(jsonb_object_agg(candidate_state, c),'{}'::jsonb) from (select candidate_state, count(*) c from public.ai_decision_candidates where run_id=v_run group by 1) z),
    'risk_levels', (select coalesce(jsonb_object_agg(risk_level, c),'{}'::jsonb) from (select risk_level, count(*) c from public.ai_decision_risk where run_id=v_run group by 1) z),
    'canary', jsonb_build_object(
      'plans', (select count(*) from public.ai_canary_plans where run_id=v_run),
      'stages', (select count(*) from public.ai_canary_stages s join public.ai_canary_plans p on p.id=s.canary_plan_id where p.run_id=v_run),
      'applied', (select count(*) from public.ai_canary_plans where run_id=v_run and applied),
      'list', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'state',plan_state,'plan',traffic_plan) order by created_at),'[]'::jsonb)
               from (select * from public.ai_canary_plans where run_id=v_run limit 10) cp)),
    'approvals', jsonb_build_object(
      'requested', (select count(*) from public.ai_decision_approvals where run_id=v_run and request_state='requested'),
      'auto_apply', (select count(*) from public.ai_decision_approvals where run_id=v_run and auto_apply))
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- L. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_ai_decision_summary as
select u.run_id, u.track_id, u.decision_score, u.decision_state, u.decision_confidence, u.decision_risk, u.rank,
  u.decision_prediction_score, u.decision_reward_score, u.decision_exposure_score,
  u.decision_bandit_score, u.decision_ensemble_score, u.decision_calibration_score
from public.ai_unified_decisions u;

create or replace view public.v2_ai_decision_candidate_summary as
select c.run_id, c.track_id, c.candidate_state, c.decision_score, c.risk_level, c.confidence, c.reason
from public.ai_decision_candidates c;

create or replace view public.v2_ai_decision_risk_summary as
select r.run_id, r.track_id, r.risk_level, r.risk_score, r.uncertainty, r.confidence, r.cold_start, r.sample_size, r.bias, r.drift
from public.ai_decision_risk r;

create or replace view public.v2_ai_canary_plan_summary as
select p.run_id, p.track_id, p.plan_state, p.applied, p.traffic_plan,
  (select count(*) from public.ai_canary_stages s where s.canary_plan_id=p.id) as stage_count,
  (select count(*) from public.ai_decision_approvals a where a.canary_plan_id=p.id and a.request_state='requested') as approval_requests
from public.ai_canary_plans p;

-- ─────────────────────────────────────────────────────────────────────
-- M. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._decision_risk_level(numeric)',
    'public.admin_generate_unified_decision(integer,integer)',
    'public.admin_generate_decision_candidates(uuid)',
    'public.admin_generate_canary_plan(uuid,integer)',
    'public.admin_ai_decision_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_unified_decision(integer,integer) is
  'ALGO-6A — 6 sub-score(Prediction/Exposure/Reward/Bandit/Calibration/Ensemble) 통합 Unified Decision Score + Explanation + Risk. Shadow only.';
comment on function public.admin_generate_canary_plan(uuid,integer) is
  'ALGO-6A — approved 후보의 10/25/50/100 Canary 계획 + Human Approval 요청 생성. 자동 적용/트래픽 분배 없음(applied=false).';
