-- 0433 — Phase ALGO-4C: Prediction Calibration & Adaptive Exposure Learning (Shadow)
--
-- 목적:
--   ALGO-4A(Exposure)+4A.5(Learning)+4B(Prediction) 기반으로 AI 가 Prediction Gap 을
--   지속 학습하여 Prediction Score/Exposure Weight 를 자동 보정하는 Calibration Layer.
--   실제 Queue/Playback/Scheduler/Exposure/Prediction/Settlement 에 절대 반영하지 않는다.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure Score/Prediction Score/Settlement/Streaming/
--     Fraud/Runtime 무변경. Production apply 금지. additive only.
--   • Calibration/Adaptive Learning/Shadow Evaluation 만. 기존 prediction 수정 없음.
--
-- 데이터 소스(read-only): track_predictions(4B expected), track_learning_memory(4A.5 actual),
--   track_exposure_scores/exposure_shadow_queue(4A), shadow_queue_predictions(4B),
--   playback_events_v2, industry_learning_memory.

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블 (11)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.prediction_calibration_runs (
  id uuid primary key default gen_random_uuid(), run_at timestamptz not null default now(), run_by uuid,
  prediction_run_id uuid, learning_run_id uuid, item_count integer,
  avg_absolute_error numeric, avg_calibration_score numeric, avg_bias_score numeric,
  stable_count integer, overestimated_count integer, underestimated_count integer,
  needs_samples_count integer, cold_start_count integer,
  overall_status text, formula_version integer not null default 1, notes text
);
create index if not exists pcr_at_idx on public.prediction_calibration_runs(run_at desc);

create table if not exists public.prediction_calibration_items (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references public.prediction_calibration_runs(id) on delete cascade,
  track_id uuid not null,
  expected_completion numeric, actual_completion numeric, completion_gap numeric,
  expected_skip numeric, actual_skip numeric, skip_gap numeric,
  expected_eligible numeric, actual_eligible numeric, eligible_gap numeric,
  expected_revenue numeric, actual_revenue numeric, revenue_gap numeric,
  expected_listener_fit numeric, actual_listener_fit numeric, listener_fit_gap numeric,
  prediction_error numeric, absolute_error numeric, weighted_error numeric,
  bias_score numeric, confidence_decay numeric, calibration_score numeric,
  sample_size integer, status text, created_at timestamptz not null default now()
);
create unique index if not exists pci_run_track_uidx on public.prediction_calibration_items(run_id, track_id);

create table if not exists public.adaptive_prediction_weights (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid not null references public.prediction_calibration_runs(id) on delete cascade,
  adaptive_completion_weight numeric, adaptive_skip_weight numeric, adaptive_revenue_weight numeric,
  adaptive_confidence_weight numeric, adaptive_learning_weight numeric,
  err_completion numeric, err_skip numeric, err_eligible numeric, err_revenue numeric,
  notes text, created_at timestamptz not null default now()
);
create index if not exists apw_run_idx on public.adaptive_prediction_weights(calibration_run_id);

create table if not exists public.adaptive_exposure_simulations (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid not null references public.prediction_calibration_runs(id) on delete cascade,
  track_id uuid not null,
  current_exposure_score numeric, adaptive_exposure_score numeric, delta numeric, improvement boolean,
  calibration_score numeric, created_at timestamptz not null default now()
);
create index if not exists aes_run_idx on public.adaptive_exposure_simulations(calibration_run_id);

create table if not exists public.queue_calibration_runs (
  id uuid primary key default gen_random_uuid(), run_at timestamptz not null default now(), run_by uuid,
  prediction_run_id uuid, store_id uuid, twin_size integer, baseline_size integer, overlap_count integer,
  ranking_error numeric, position_error numeric, queue_distance numeric,
  kendall_tau numeric, spearman_rank numeric, top10_overlap numeric, top20_overlap numeric,
  mrr numeric, ndcg numeric, notes text
);
create index if not exists qcr_at_idx on public.queue_calibration_runs(run_at desc);

create table if not exists public.queue_calibration_items (
  id uuid primary key default gen_random_uuid(),
  queue_calibration_run_id uuid not null references public.queue_calibration_runs(id) on delete cascade,
  track_id uuid not null, twin_position integer, baseline_position integer, position_error integer,
  in_top10_twin boolean, in_top10_baseline boolean
);
create index if not exists qci_run_idx on public.queue_calibration_items(queue_calibration_run_id);

create table if not exists public.counterfactual_simulations (
  id uuid primary key default gen_random_uuid(),
  calibration_run_id uuid, track_id uuid not null, scenario text not null,
  base_prediction numeric, simulated_prediction numeric, delta numeric, note text,
  created_at timestamptz not null default now()
);
create index if not exists cs_run_idx on public.counterfactual_simulations(calibration_run_id);

create table if not exists public.track_calibration_memory (
  id uuid primary key default gen_random_uuid(), track_id uuid not null,
  latest_run_id uuid, avg_error numeric, avg_bias numeric, avg_confidence numeric, avg_calibration numeric,
  latest_status text, error_history jsonb, bias_history jsonb, confidence_history jsonb, calibration_history jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists tcm_track_uidx on public.track_calibration_memory(track_id);

create table if not exists public.store_calibration_memory (
  id uuid primary key default gen_random_uuid(), store_id uuid,
  latest_run_id uuid, avg_error numeric, avg_bias numeric, avg_confidence numeric, avg_calibration numeric,
  latest_status text, error_history jsonb, bias_history jsonb, updated_at timestamptz not null default now()
);

create table if not exists public.industry_calibration_memory (
  id uuid primary key default gen_random_uuid(), industry text not null,
  latest_run_id uuid, avg_error numeric, avg_bias numeric, avg_confidence numeric, avg_calibration numeric,
  latest_status text, error_history jsonb, bias_history jsonb, updated_at timestamptz not null default now()
);
create unique index if not exists icm_industry_uidx on public.industry_calibration_memory(industry);

create table if not exists public.context_calibration_memory (
  id uuid primary key default gen_random_uuid(), context_key text not null,
  latest_run_id uuid, avg_error numeric, avg_bias numeric, avg_confidence numeric, avg_calibration numeric,
  latest_status text, error_history jsonb, bias_history jsonb, updated_at timestamptz not null default now()
);
create unique index if not exists ccm_ctx_uidx on public.context_calibration_memory(context_key);

do $$ declare t text;
begin
  foreach t in array array['prediction_calibration_runs','prediction_calibration_items','adaptive_prediction_weights',
    'adaptive_exposure_simulations','queue_calibration_runs','queue_calibration_items','counterfactual_simulations',
    'track_calibration_memory','store_calibration_memory','industry_calibration_memory','context_calibration_memory'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. helpers: calibration score + self-classification
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._calibration_score(p_abs_error numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select round(greatest(0, least(1, 1 - coalesce(p_abs_error,0))), 6);
$$;

create or replace function public._calibration_status(p_sample integer, p_confidence numeric, p_bias numeric)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when coalesce(p_sample,0) < 5 then 'cold_start'
    when coalesce(p_confidence,0) < 0.3 then 'needs_more_samples'
    when coalesce(p_bias,0) > 0.1 then 'overestimated'
    when coalesce(p_bias,0) < -0.1 then 'underestimated'
    else 'stable' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Prediction Calibration (expected vs actual → gap/error/bias/status + memory)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_prediction_calibration(p_prediction_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_run uuid; v_prun uuid; v_lrun uuid; v_cnt int; v_status text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_prun := coalesce(p_prediction_run_id, (select id from public.prediction_generation_runs order by run_at desc limit 1));
  if v_prun is null then raise exception 'no prediction run — admin_generate_track_predictions 먼저'; end if;
  select learning_run_id into v_lrun from public.prediction_generation_runs where id=v_prun;

  insert into public.prediction_calibration_runs(run_by, prediction_run_id, learning_run_id, formula_version, notes)
  values (auth.uid(), v_prun, v_lrun, 1, 'ALGO-4C calibration. shadow only.') returning id into v_run;

  -- 아이템: prediction expected vs learning-memory actual
  insert into public.prediction_calibration_items(run_id, track_id, expected_completion, actual_completion, completion_gap,
    expected_skip, actual_skip, skip_gap, expected_eligible, actual_eligible, eligible_gap,
    expected_revenue, actual_revenue, revenue_gap, expected_listener_fit, actual_listener_fit, listener_fit_gap,
    prediction_error, absolute_error, weighted_error, bias_score, confidence_decay, calibration_score, sample_size, status)
  select v_run, tp.track_id,
    tp.expected_completion_rate, lm.completion_rate, round(tp.expected_completion_rate - lm.completion_rate,6),
    tp.expected_skip_rate, lm.skip_rate, round(tp.expected_skip_rate - lm.skip_rate,6),
    tp.expected_eligible_rate, coalesce(le.eligible_rate,tp.expected_eligible_rate), round(tp.expected_eligible_rate - coalesce(le.eligible_rate,tp.expected_eligible_rate),6),
    tp.expected_revenue_weight, 1.0, round(tp.expected_revenue_weight - 1.0,6),
    tp.expected_listener_fit, coalesce(ind.completion_rate, tp.expected_listener_fit), round(tp.expected_listener_fit - coalesce(ind.completion_rate, tp.expected_listener_fit),6),
    round(abs(tp.expected_completion_rate - lm.completion_rate),6),
    round((abs(tp.expected_completion_rate-lm.completion_rate)+abs(tp.expected_skip_rate-lm.skip_rate)+abs(tp.expected_eligible_rate-coalesce(le.eligible_rate,tp.expected_eligible_rate)))/3.0,6),
    round((abs(tp.expected_completion_rate-lm.completion_rate)*0.5+abs(tp.expected_skip_rate-lm.skip_rate)*0.3+abs(tp.expected_eligible_rate-coalesce(le.eligible_rate,tp.expected_eligible_rate))*0.2),6),
    -- bias: overestimate(+) = expected performance > actual. completion+, skip inverted, eligible+
    round(((tp.expected_completion_rate-lm.completion_rate) - (tp.expected_skip_rate-lm.skip_rate) + (tp.expected_eligible_rate-coalesce(le.eligible_rate,tp.expected_eligible_rate)))/3.0,6),
    round(1 - coalesce(lm.confidence_score,0),6),
    public._calibration_score((abs(tp.expected_completion_rate-lm.completion_rate)+abs(tp.expected_skip_rate-lm.skip_rate)+abs(tp.expected_eligible_rate-coalesce(le.eligible_rate,tp.expected_eligible_rate)))/3.0),
    coalesce(lm.total_plays,0),
    public._calibration_status(coalesce(lm.total_plays,0), coalesce(lm.confidence_score,0),
      ((tp.expected_completion_rate-lm.completion_rate) - (tp.expected_skip_rate-lm.skip_rate) + (tp.expected_eligible_rate-coalesce(le.eligible_rate,tp.expected_eligible_rate)))/3.0)
  from public.track_predictions tp
  join public.track_learning_memory lm on lm.track_id=tp.track_id and (v_lrun is null or lm.run_id=v_lrun)
  left join lateral (select least(1.0, lm.eligible_streams::numeric/nullif(lm.total_plays,0)) as eligible_rate) le on true
  left join lateral (select ilm.completion_rate from public.industry_learning_memory ilm where (v_lrun is null or ilm.run_id=v_lrun) and ilm.industry=lm.best_store_type limit 1) ind on true
  where tp.run_id=v_prun;
  get diagnostics v_cnt = row_count;

  -- run 요약
  update public.prediction_calibration_runs r set
    item_count=v_cnt,
    avg_absolute_error=(select round(avg(absolute_error),6) from public.prediction_calibration_items where run_id=v_run),
    avg_calibration_score=(select round(avg(calibration_score),6) from public.prediction_calibration_items where run_id=v_run),
    avg_bias_score=(select round(avg(bias_score),6) from public.prediction_calibration_items where run_id=v_run),
    stable_count=(select count(*) from public.prediction_calibration_items where run_id=v_run and status='stable'),
    overestimated_count=(select count(*) from public.prediction_calibration_items where run_id=v_run and status='overestimated'),
    underestimated_count=(select count(*) from public.prediction_calibration_items where run_id=v_run and status='underestimated'),
    needs_samples_count=(select count(*) from public.prediction_calibration_items where run_id=v_run and status='needs_more_samples'),
    cold_start_count=(select count(*) from public.prediction_calibration_items where run_id=v_run and status='cold_start')
  where r.id=v_run;
  select case when avg_bias_score > 0.1 then 'overestimated' when avg_bias_score < -0.1 then 'underestimated'
    when avg_calibration_score >= 0.8 then 'stable' else 'unstable' end into v_status
  from public.prediction_calibration_runs where id=v_run;
  update public.prediction_calibration_runs set overall_status=v_status where id=v_run;

  -- Calibration Memory upsert (track / industry / context)
  insert into public.track_calibration_memory as m (track_id, latest_run_id, avg_error, avg_bias, avg_confidence, avg_calibration, latest_status, error_history, bias_history, confidence_history, calibration_history, updated_at)
  select ci.track_id, v_run, ci.absolute_error, ci.bias_score, 1-ci.confidence_decay, ci.calibration_score, ci.status,
    jsonb_build_array(ci.absolute_error), jsonb_build_array(ci.bias_score), jsonb_build_array(1-ci.confidence_decay), jsonb_build_array(ci.calibration_score), now()
  from public.prediction_calibration_items ci where ci.run_id=v_run
  on conflict (track_id) do update set latest_run_id=v_run, avg_error=excluded.avg_error, avg_bias=excluded.avg_bias,
    avg_confidence=excluded.avg_confidence, avg_calibration=excluded.avg_calibration, latest_status=excluded.latest_status,
    error_history=(coalesce(m.error_history,'[]'::jsonb) || excluded.error_history),
    bias_history=(coalesce(m.bias_history,'[]'::jsonb) || excluded.bias_history),
    confidence_history=(coalesce(m.confidence_history,'[]'::jsonb) || excluded.confidence_history),
    calibration_history=(coalesce(m.calibration_history,'[]'::jsonb) || excluded.calibration_history), updated_at=now();

  insert into public.industry_calibration_memory as m (industry, latest_run_id, avg_error, avg_bias, avg_confidence, avg_calibration, latest_status, error_history, bias_history, updated_at)
  select coalesce(lm.best_store_type,'unknown'), v_run, round(avg(ci.absolute_error),6), round(avg(ci.bias_score),6), round(avg(1-ci.confidence_decay),6), round(avg(ci.calibration_score),6),
    (case when avg(ci.bias_score)>0.1 then 'overestimated' when avg(ci.bias_score)<-0.1 then 'underestimated' when avg(ci.calibration_score)>=0.8 then 'stable' else 'unstable' end),
    jsonb_build_array(round(avg(ci.absolute_error),6)), jsonb_build_array(round(avg(ci.bias_score),6)), now()
  from public.prediction_calibration_items ci join public.track_learning_memory lm on lm.track_id=ci.track_id and (v_lrun is null or lm.run_id=v_lrun)
  where ci.run_id=v_run group by coalesce(lm.best_store_type,'unknown')
  on conflict (industry) do update set latest_run_id=v_run, avg_error=excluded.avg_error, avg_bias=excluded.avg_bias,
    avg_confidence=excluded.avg_confidence, avg_calibration=excluded.avg_calibration, latest_status=excluded.latest_status,
    error_history=(coalesce(m.error_history,'[]'::jsonb) || excluded.error_history),
    bias_history=(coalesce(m.bias_history,'[]'::jsonb) || excluded.bias_history), updated_at=now();

  return jsonb_build_object('ok',true,'run_id',v_run,'prediction_run_id',v_prun,'item_count',v_cnt,'overall_status',v_status,
    'note','CALIBRATION SHADOW — prediction/exposure 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Adaptive Prediction Weights (component error → 재가중, 정규화)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_adaptive_weights(p_calibration_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_crun uuid; v jsonb;
  e_c numeric; e_s numeric; e_e numeric; e_r numeric; c_avg numeric;
  w_c numeric; w_s numeric; w_e numeric; w_r numeric; w_f numeric; w_sum numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_crun := coalesce(p_calibration_run_id, (select id from public.prediction_calibration_runs order by run_at desc limit 1));
  if v_crun is null then raise exception 'no calibration run'; end if;

  select round(avg(abs(completion_gap)),6), round(avg(abs(skip_gap)),6), round(avg(abs(eligible_gap)),6),
    round(avg(abs(revenue_gap)),6), round(avg(1-confidence_decay),6)
  into e_c, e_s, e_e, e_r, c_avg from public.prediction_calibration_items where run_id=v_crun;

  -- base(prediction) weights: completion .35, skip .25, eligible/learning .20, revenue .10, confidence .10
  -- 오차 큰 요소 신뢰↓ → 가중치↓, confidence 는 표본 신뢰도로 가중
  w_c := 0.35 * (1 - least(coalesce(e_c,0),1));
  w_s := 0.25 * (1 - least(coalesce(e_s,0),1));
  w_e := 0.20 * (1 - least(coalesce(e_e,0),1));
  w_r := 0.10 * (1 - least(coalesce(e_r,0),1));
  w_f := 0.10 * coalesce(c_avg,0.5);
  w_sum := greatest(w_c+w_s+w_e+w_r+w_f, 0.000001);

  insert into public.adaptive_prediction_weights(calibration_run_id, adaptive_completion_weight, adaptive_skip_weight,
    adaptive_revenue_weight, adaptive_confidence_weight, adaptive_learning_weight, err_completion, err_skip, err_eligible, err_revenue, notes)
  values (v_crun, round(w_c/w_sum,6), round(w_s/w_sum,6), round(w_r/w_sum,6), round(w_f/w_sum,6), round(w_e/w_sum,6),
    e_c, e_s, e_e, e_r, 'ALGO-4C adaptive weights — 계산만, prediction 실반영 없음')
  returning to_jsonb(adaptive_prediction_weights) into v;
  return jsonb_build_object('ok',true,'calibration_run_id',v_crun,'weights',v);
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Adaptive Exposure Simulation (current vs adaptive; shadow)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_simulate_adaptive_exposure(p_calibration_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_crun uuid; v_cnt int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_crun := coalesce(p_calibration_run_id, (select id from public.prediction_calibration_runs order by run_at desc limit 1));
  if v_crun is null then raise exception 'no calibration run'; end if;
  delete from public.adaptive_exposure_simulations where calibration_run_id=v_crun;

  insert into public.adaptive_exposure_simulations(calibration_run_id, track_id, current_exposure_score, adaptive_exposure_score, delta, improvement, calibration_score)
  select v_crun, ci.track_id, round(cur.exp,6),
    round(cur.exp * (1 + (ci.calibration_score - 0.5) * 0.5), 6),
    round(cur.exp * (1 + (ci.calibration_score - 0.5) * 0.5) - cur.exp, 6),
    (ci.calibration_score >= 0.5), ci.calibration_score
  from public.prediction_calibration_items ci
  join lateral (select avg(exposure_score) exp from public.track_exposure_scores tes where tes.track_id=ci.track_id) cur on cur.exp is not null
  where ci.run_id=v_crun;
  get diagnostics v_cnt = row_count;
  return jsonb_build_object('ok',true,'calibration_run_id',v_crun,'simulated',v_cnt,
    'note','ADAPTIVE EXPOSURE SIMULATION — 실제 exposure 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Queue Calibration (twin vs exposure_shadow_queue: ranking metrics)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_validate_queue_calibration(p_store_id uuid, p_prediction_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_prun uuid; v_run uuid; v_twin int; v_base int; v_overlap int; v_spear numeric; v_ndcg numeric; v_mrr numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_prun := coalesce(p_prediction_run_id, (select id from public.prediction_generation_runs order by run_at desc limit 1));

  create temp table _qt on commit drop as
    select position as twin_pos, track_id from public.shadow_queue_predictions where run_id=v_prun and store_id=p_store_id;
  create temp table _qb on commit drop as
    select position as base_pos, track_id from public.exposure_shadow_queue
    where store_id=p_store_id and run_id=(select run_id from public.exposure_shadow_queue where store_id=p_store_id order by created_at desc limit 1);
  select count(*) into v_twin from _qt; select count(*) into v_base from _qb;
  create temp table _qj on commit drop as
    select coalesce(t.track_id,b.track_id) track_id, t.twin_pos, b.base_pos,
      (t.twin_pos is not null and b.base_pos is not null) as overlap
    from _qt t full outer join _qb b on b.track_id=t.track_id;
  select count(*) into v_overlap from _qj where overlap;

  -- spearman over overlap (corr of ranks); null if <2
  select case when count(*)>=2 then round(corr(twin_pos::numeric, base_pos::numeric)::numeric,6) else null end into v_spear
    from _qj where overlap;
  -- MRR: for each twin track present in baseline, 1/base_pos, averaged over twin size
  select round(coalesce(avg(1.0/nullif(base_pos,0)) filter (where overlap),0),6) into v_mrr from _qj where twin_pos is not null;
  -- NDCG@k: relevance = 1 if track in baseline else 0, DCG over twin order / ideal
  select round((
    coalesce(sum(case when base_pos is not null then 1.0/log(2::numeric, (twin_pos+1)::numeric) else 0 end),0)
    / nullif((select sum(1.0/log(2::numeric, (generate_series+1)::numeric)) from generate_series(1, greatest(v_overlap,1))),0))::numeric, 6)
    into v_ndcg from _qj where twin_pos is not null;

  insert into public.queue_calibration_runs(run_by, prediction_run_id, store_id, twin_size, baseline_size, overlap_count,
    ranking_error, position_error, queue_distance, kendall_tau, spearman_rank, top10_overlap, top20_overlap, mrr, ndcg, notes)
  select auth.uid(), v_prun, p_store_id, v_twin, v_base, v_overlap,
    round(coalesce((select avg(abs(twin_pos-base_pos)) from _qj where overlap),0),4),
    round(coalesce((select avg(abs(twin_pos-base_pos)) from _qj where overlap),0),4),
    coalesce((select sum(abs(twin_pos-base_pos)) from _qj where overlap),0),
    v_spear, v_spear,
    round(coalesce((select count(*) from _qj where twin_pos<=10 and base_pos<=10)::numeric/10,0),4),
    round(coalesce((select count(*) from _qj where twin_pos<=20 and base_pos<=20)::numeric/20,0),4),
    v_mrr, v_ndcg, 'ALGO-4C queue calibration (twin vs exposure_shadow_queue)'
  returning id into v_run;

  insert into public.queue_calibration_items(queue_calibration_run_id, track_id, twin_position, baseline_position, position_error, in_top10_twin, in_top10_baseline)
  select v_run, track_id, twin_pos, base_pos, case when overlap then abs(twin_pos-base_pos) else null end,
    coalesce(twin_pos<=10,false), coalesce(base_pos<=10,false) from _qj;

  return jsonb_build_object('ok',true,'queue_calibration_run_id',v_run,'store_id',p_store_id,'twin_size',v_twin,
    'baseline_size',v_base,'overlap_count',v_overlap,'spearman_rank',v_spear,'mrr',v_mrr,'ndcg',v_ndcg,
    'note','QUEUE CALIBRATION — 실제 Queue 미반영');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Counterfactual Simulations (what-if; shadow)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_counterfactual_simulations(p_calibration_run_id uuid default null, p_track_limit integer default 20)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_crun uuid; v_prun uuid; v_cnt int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_crun := coalesce(p_calibration_run_id, (select id from public.prediction_calibration_runs order by run_at desc limit 1));
  select prediction_run_id into v_prun from public.prediction_calibration_runs where id=v_crun;
  delete from public.counterfactual_simulations where calibration_run_id=v_crun;

  create temp table _cf on commit drop as
    select tp.* from public.track_predictions tp where tp.run_id=v_prun order by tp.prediction_score desc limit greatest(coalesce(p_track_limit,20),1);

  -- 시나리오별 재계산 (기존 _prediction_score 사용)
  insert into public.counterfactual_simulations(calibration_run_id, track_id, scenario, base_prediction, simulated_prediction, delta, note)
  select v_crun, track_id, s.scenario, prediction_score, s.newscore, round(s.newscore-prediction_score,6), s.note
  from _cf, lateral (values
    ('completion_+5%', public._prediction_score(expected_completion_rate+0.05, expected_skip_rate, expected_eligible_rate, expected_revenue_weight, prediction_confidence), 'completion +5%p'),
    ('skip_-3%', public._prediction_score(expected_completion_rate, greatest(expected_skip_rate-0.03,0), expected_eligible_rate, expected_revenue_weight, prediction_confidence), 'skip -3%p'),
    ('confidence_high', public._prediction_score(expected_completion_rate, expected_skip_rate, expected_eligible_rate, expected_revenue_weight, 1.0), 'confidence=1'),
    ('revenue_+10%', public._prediction_score(expected_completion_rate, expected_skip_rate, expected_eligible_rate, least(expected_revenue_weight+0.1,1), prediction_confidence), 'revenue_weight +0.1')
  ) s(scenario, newscore, note);
  get diagnostics v_cnt = row_count;
  return jsonb_build_object('ok',true,'calibration_run_id',v_crun,'simulations',v_cnt,
    'note','COUNTERFACTUAL SIMULATION — shadow only');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview RPC
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_prediction_calibration_overview(p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run public.prediction_calibration_runs%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_run from public.prediction_calibration_runs where (p_run_id is null or id=p_run_id) order by run_at desc limit 1;
  if not found then return jsonb_build_object('has_data', false); end if;
  select jsonb_build_object('has_data', true, 'run', to_jsonb(v_run),
    'adaptive_weights', (select to_jsonb(w) from public.adaptive_prediction_weights w where w.calibration_run_id=v_run.id order by created_at desc limit 1),
    'status_breakdown', jsonb_build_object('stable',v_run.stable_count,'overestimated',v_run.overestimated_count,'underestimated',v_run.underestimated_count,'needs_more_samples',v_run.needs_samples_count,'cold_start',v_run.cold_start_count),
    'worst_items', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'abs_error',absolute_error,'bias',bias_score,'calibration',calibration_score,'status',status) order by absolute_error desc), '[]'::jsonb)
      from (select * from public.prediction_calibration_items where run_id=v_run.id order by absolute_error desc limit 15) x),
    'exposure_sim', (select coalesce(jsonb_build_object('count',count(*),'improved',count(*) filter (where improvement),'avg_delta',round(avg(delta),6)),'{}'::jsonb) from public.adaptive_exposure_simulations where calibration_run_id=v_run.id),
    'queue_calibration', (select coalesce(jsonb_agg(to_jsonb(q) order by q.run_at desc), '[]'::jsonb) from (select * from public.queue_calibration_runs order by run_at desc limit 5) q),
    'counterfactuals', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'scenario',scenario,'base',base_prediction,'sim',simulated_prediction,'delta',delta) order by abs(delta) desc), '[]'::jsonb)
      from (select * from public.counterfactual_simulations where calibration_run_id=v_run.id order by abs(delta) desc limit 20) c)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_prediction_calibration_summary as
select r.id as calibration_run_id, r.run_at, r.prediction_run_id, r.item_count,
  r.avg_absolute_error, r.avg_calibration_score, r.avg_bias_score, r.overall_status,
  r.stable_count, r.overestimated_count, r.underestimated_count, r.needs_samples_count, r.cold_start_count
from public.prediction_calibration_runs r;

create or replace view public.v2_prediction_bias_summary as
select ci.run_id, ci.track_id, ci.bias_score, ci.calibration_score, ci.absolute_error, ci.confidence_decay, ci.status,
  case when ci.bias_score > 0.1 then 'overestimated' when ci.bias_score < -0.1 then 'underestimated' else 'balanced' end as bias_class
from public.prediction_calibration_items ci;

create or replace view public.v2_queue_calibration_summary as
select q.id as queue_calibration_run_id, q.run_at, q.store_id, q.twin_size, q.baseline_size, q.overlap_count,
  q.position_error, q.spearman_rank, q.kendall_tau, q.top10_overlap, q.top20_overlap, q.mrr, q.ndcg
from public.queue_calibration_runs q;

create or replace view public.v2_adaptive_weight_summary as
select w.calibration_run_id, w.adaptive_completion_weight, w.adaptive_skip_weight, w.adaptive_revenue_weight,
  w.adaptive_confidence_weight, w.adaptive_learning_weight, w.err_completion, w.err_skip, w.err_eligible, w.err_revenue, w.created_at
from public.adaptive_prediction_weights w;

-- ─────────────────────────────────────────────────────────────────────
-- J. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._calibration_score(numeric)',
    'public._calibration_status(integer,numeric,numeric)',
    'public.admin_run_prediction_calibration(uuid)',
    'public.admin_generate_adaptive_weights(uuid)',
    'public.admin_simulate_adaptive_exposure(uuid)',
    'public.admin_validate_queue_calibration(uuid,uuid)',
    'public.admin_generate_counterfactual_simulations(uuid,integer)',
    'public.admin_prediction_calibration_overview(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.prediction_calibration_items is
  'ALGO-4C — Prediction Calibration(expected vs actual gap/error/bias/status). Shadow only, prediction/exposure 미반영.';
comment on function public.admin_run_prediction_calibration(uuid) is
  'ALGO-4C — Prediction Gap 학습(calibration). adaptive weight/exposure simulation 은 별도 RPC. 실반영 없음.';
