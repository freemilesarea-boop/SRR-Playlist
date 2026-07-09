-- 0432 — Phase ALGO-4B: Prediction Engine & Shadow Queue Validation (Digital Twin)
--
-- 목적:
--   Learning Memory(0431) + Exposure Engine(0430) 기반으로 재생 전에 곡 성과를 예측하고,
--   Digital Twin Queue(예측 기반 shadow queue)를 실제/기존 shadow queue 와 비교 검증한다.
--   실제 Queue/Playback/Scheduler 는 절대 변경하지 않는다. Prediction/Twin 계산만.
--
-- 절대 원칙:
--   • 실제 Queue / Playback / Scheduler / Store·Brand Runtime / Settlement / Streaming 무변경.
--   • Exposure Score 실반영 없음. additive only — 신규 테이블 6 + RPC + view.
--   • Shadow/Digital Twin 만. fraud 자동 차단 없음.
--
-- 데이터 소스(read-only): track_exposure_scores/exposure_shadow_queue(0430),
--   track/context/industry/exposure_learning_memory(0431), playback_events_v2, stream_events,
--   eligible_settlement_tracks, tracks.

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.prediction_generation_runs (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  run_by          uuid,
  store_scope     uuid,
  track_count     integer,
  learning_run_id uuid,
  exposure_run_id uuid,
  formula_version integer not null default 1,
  params          jsonb,
  notes           text
);
create index if not exists pgr_at_idx on public.prediction_generation_runs(run_at desc);

create table if not exists public.track_predictions (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.prediction_generation_runs(id) on delete cascade,
  track_id            uuid not null,
  store_scope         uuid,
  expected_completion_rate numeric not null default 0,
  expected_skip_rate  numeric not null default 0,
  expected_eligible_rate numeric not null default 0,
  expected_revenue_weight numeric not null default 1,
  expected_settlement_quality numeric not null default 1,
  expected_listener_fit numeric not null default 1,
  prediction_confidence numeric not null default 0,
  prediction_score    numeric not null default 0,
  data_source         text not null default 'historical_fallback',
  explain_payload     jsonb,
  created_at          timestamptz not null default now()
);
create unique index if not exists tp_run_track_uidx on public.track_predictions(run_id, track_id);
create index if not exists tp_run_score_idx on public.track_predictions(run_id, prediction_score desc);

create table if not exists public.shadow_queue_predictions (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid not null references public.prediction_generation_runs(id) on delete cascade,
  store_id            uuid,
  position            integer not null,
  track_id            uuid not null,
  exposure_score      numeric,
  prediction_score    numeric,
  expected_completion numeric,
  expected_skip       numeric,
  created_at          timestamptz not null default now()
);
create unique index if not exists sqp_run_store_pos_uidx on public.shadow_queue_predictions(run_id, store_id, position);

create table if not exists public.queue_validation_runs (
  id                  uuid primary key default gen_random_uuid(),
  run_at              timestamptz not null default now(),
  run_by              uuid,
  prediction_run_id   uuid,
  store_id            uuid,
  baseline_source     text,
  twin_size           integer,
  baseline_size       integer,
  overlap_count       integer,
  overlap_rate        numeric,
  expected_completion_delta numeric,
  expected_skip_delta numeric,
  expected_revenue_delta numeric,
  diversity_delta     numeric,
  freshness_delta     numeric,
  notes               text
);
create index if not exists qvr_at_idx on public.queue_validation_runs(run_at desc);

create table if not exists public.queue_validation_items (
  id                  uuid primary key default gen_random_uuid(),
  validation_run_id   uuid not null references public.queue_validation_runs(id) on delete cascade,
  track_id            uuid not null,
  in_twin             boolean not null default false,
  in_baseline         boolean not null default false,
  twin_position       integer,
  baseline_position   integer,
  position_delta      integer,
  prediction_score    numeric,
  exposure_score      numeric
);
create index if not exists qvi_run_idx on public.queue_validation_items(validation_run_id);

create table if not exists public.counterfactual_explanations (
  id                  uuid primary key default gen_random_uuid(),
  run_id              uuid,
  track_a             uuid not null,
  track_b             uuid not null,
  completion_diff     numeric,
  skip_diff           numeric,
  eligible_diff       numeric,
  revenue_weight_diff numeric,
  exposure_score_diff numeric,
  final_score_diff    numeric,
  reason_summary      text,
  created_at          timestamptz not null default now()
);
create index if not exists ce_run_idx on public.counterfactual_explanations(run_id);

alter table public.prediction_generation_runs enable row level security;
alter table public.track_predictions enable row level security;
alter table public.shadow_queue_predictions enable row level security;
alter table public.queue_validation_runs enable row level security;
alter table public.queue_validation_items enable row level security;
alter table public.counterfactual_explanations enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='pgr_admin_read') then create policy pgr_admin_read on public.prediction_generation_runs for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='tp_admin_read') then create policy tp_admin_read on public.track_predictions for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='sqp_admin_read') then create policy sqp_admin_read on public.shadow_queue_predictions for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='qvr_admin_read') then create policy qvr_admin_read on public.queue_validation_runs for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='qvi_admin_read') then create policy qvi_admin_read on public.queue_validation_items for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='ce_admin_read') then create policy ce_admin_read on public.counterfactual_explanations for select using (public._is_super_admin()); end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Prediction Score 엔진 (초기 공식)
--    PS = completion*0.35 + (1-skip)*0.25 + eligible*0.20 + revenue_weight*0.10 + confidence*0.10
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._prediction_score(
  p_completion numeric, p_skip numeric, p_eligible numeric, p_revenue_weight numeric, p_confidence numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select round(
    greatest(0,least(1,coalesce(p_completion,0)))*0.35
    + (1 - greatest(0,least(1,coalesce(p_skip,0))))*0.25
    + greatest(0,least(1,coalesce(p_eligible,0)))*0.20
    + greatest(0,least(1,coalesce(p_revenue_weight,1)))*0.10
    + greatest(0,least(1,coalesce(p_confidence,0)))*0.10
  , 6);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Prediction 생성 (learning memory 우선, 없으면 historical fallback)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_track_predictions(
  p_store_scope uuid default null, p_track_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_run uuid; v_lm_run uuid; v_exp_run uuid; v_from timestamptz := now() - interval '90 days'; v_cnt int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  -- 최신 learning / exposure run 참조 (있으면)
  if to_regclass('public.learning_memory_runs') is not null then
    select id into v_lm_run from public.learning_memory_runs order by run_at desc limit 1;
  end if;
  if to_regclass('public.exposure_generation_runs') is not null then
    select id into v_exp_run from public.exposure_generation_runs order by run_at desc limit 1;
  end if;

  insert into public.prediction_generation_runs(run_by, store_scope, learning_run_id, exposure_run_id, params, notes)
  values (auth.uid(), p_store_scope, v_lm_run, v_exp_run, jsonb_build_object('track_limit', p_track_limit),
          'ALGO-4B prediction. NOT reflected into real queue.')
  returning id into v_run;

  -- 후보: learning memory 있으면 그 트랙, 없으면 playback 상위
  create temp table _pcand on commit drop as
    select track_id from (
      select tlm.track_id, tlm.learning_score as ord
        from public.track_learning_memory tlm where v_lm_run is not null and tlm.run_id=v_lm_run
      union all
      select p.track_id, count(*)::numeric as ord
        from public.playback_events_v2 p
        where v_lm_run is null and p.created_at>=v_from and p.track_id is not null
        group by p.track_id
    ) q group by track_id, ord order by ord desc limit greatest(coalesce(p_track_limit,100),1);
  select count(*) into v_cnt from _pcand;

  insert into public.track_predictions (run_id, track_id, store_scope, expected_completion_rate, expected_skip_rate,
    expected_eligible_rate, expected_revenue_weight, expected_settlement_quality, expected_listener_fit,
    prediction_confidence, prediction_score, data_source, explain_payload)
  select v_run, c.track_id, p_store_scope,
    coalesce(lm.completion_rate, hist.completion_rate, 0.5),
    coalesce(lm.skip_rate, hist.skip_rate, 0.3),
    coalesce(lm.eligible_rate, hist.eligible_rate, case when exists(select 1 from public.eligible_settlement_tracks est where est.track_id=c.track_id) then 0.5 else 0.2 end),
    coalesce(lm.revenue_weight, 1.0),
    case when exists(select 1 from public.eligible_settlement_tracks est where est.track_id=c.track_id) then 1.0 else 0.8 end,
    coalesce(ind.completion_rate, 1.0),
    coalesce(lm.confidence_score, hist.confidence, 0.1),
    public._prediction_score(
      coalesce(lm.completion_rate, hist.completion_rate, 0.5),
      coalesce(lm.skip_rate, hist.skip_rate, 0.3),
      coalesce(lm.eligible_rate, hist.eligible_rate, 0.3),
      coalesce(lm.revenue_weight, 1.0),
      coalesce(lm.confidence_score, hist.confidence, 0.1)),
    case when lm.track_id is not null then 'learning' else 'historical_fallback' end,
    jsonb_build_object('source', case when lm.track_id is not null then 'learning' else 'historical_fallback' end,
      'expected_completion', coalesce(lm.completion_rate, hist.completion_rate, 0.5),
      'expected_skip', coalesce(lm.skip_rate, hist.skip_rate, 0.3),
      'expected_eligible', coalesce(lm.eligible_rate, hist.eligible_rate, 0.3),
      'expected_revenue_weight', coalesce(lm.revenue_weight, 1.0),
      'expected_listener_fit', coalesce(ind.completion_rate, 1.0),
      'confidence', coalesce(lm.confidence_score, hist.confidence, 0.1),
      'formula', 'completion*0.35+(1-skip)*0.25+eligible*0.20+revenue_weight*0.10+confidence*0.10')
  from _pcand c
  left join lateral (
    select tlm.track_id, tlm.completion_rate, tlm.skip_rate, tlm.revenue_weight, tlm.confidence_score, tlm.best_store_type,
      least(1.0, tlm.eligible_streams::numeric / nullif(tlm.total_plays,0)) as eligible_rate
    from public.track_learning_memory tlm where v_lm_run is not null and tlm.run_id=v_lm_run and tlm.track_id=c.track_id
  ) lm on true
  left join lateral (
    select avg(p.completion_percent)/100.0 as completion_rate,
      count(*) filter (where coalesce(p.completion_percent,0)<30)::numeric/nullif(count(*),0) as skip_rate,
      least(1.0, (select count(*) from public.stream_events se where se.track_id=c.track_id and se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout and se.created_at>=v_from)::numeric / nullif(count(*),0)) as eligible_rate,
      least(1.0, count(*)::numeric/30.0) as confidence
    from public.playback_events_v2 p where p.track_id=c.track_id and p.created_at>=v_from
  ) hist on true
  left join lateral (
    select ilm.completion_rate from public.industry_learning_memory ilm
    where v_lm_run is not null and ilm.run_id=v_lm_run and ilm.industry=lm.best_store_type limit 1
  ) ind on true;

  update public.prediction_generation_runs set track_count=v_cnt where id=v_run;
  return jsonb_build_object('ok', true, 'run_id', v_run, 'track_count', v_cnt,
    'learning_run_id', v_lm_run, 'exposure_run_id', v_exp_run, 'note', 'PREDICTION SHADOW — 실제 Queue 미반영');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Digital Twin Queue (prediction 기준 shadow queue; 실제 Queue 무관)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_digital_twin_queue(
  p_store_id uuid, p_size integer default 20, p_prediction_run_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_run uuid; v_exp_run uuid; v_cnt int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_prediction_run_id, (select id from public.prediction_generation_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no prediction run — admin_generate_track_predictions 먼저 실행'; end if;
  if to_regclass('public.exposure_generation_runs') is not null then
    select id into v_exp_run from public.exposure_generation_runs order by run_at desc limit 1;
  end if;

  delete from public.shadow_queue_predictions where run_id=v_run and store_id=p_store_id;
  insert into public.shadow_queue_predictions (run_id, store_id, position, track_id, exposure_score, prediction_score, expected_completion, expected_skip)
  select v_run, p_store_id, row_number() over (order by tp.prediction_score desc, tp.track_id),
    tp.track_id,
    (select avg(tes.exposure_score) from public.track_exposure_scores tes where tes.track_id=tp.track_id and (v_exp_run is null or tes.run_id=v_exp_run)),
    tp.prediction_score, tp.expected_completion_rate, tp.expected_skip_rate
  from public.track_predictions tp
  where tp.run_id=v_run
  order by tp.prediction_score desc, tp.track_id
  limit greatest(coalesce(p_size,20),1);
  get diagnostics v_cnt = row_count;

  return jsonb_build_object('ok', true, 'run_id', v_run, 'store_id', p_store_id, 'queue_size', v_cnt,
    'note', 'DIGITAL TWIN QUEUE — 실제 재생 순서와 무관');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Queue Validation (Digital Twin vs exposure_shadow_queue baseline)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_validate_shadow_queue(
  p_store_id uuid, p_prediction_run_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_prun uuid; v_vrun uuid; v_baseline text := 'exposure_shadow_queue';
  v_twin int; v_base int; v_overlap int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_prun := coalesce(p_prediction_run_id, (select id from public.prediction_generation_runs order by run_at desc limit 1));

  -- twin queue rows
  create temp table _twin on commit drop as
    select position, track_id, prediction_score, exposure_score, expected_completion, expected_skip
    from public.shadow_queue_predictions where run_id=v_prun and store_id=p_store_id;
  select count(*) into v_twin from _twin;

  -- baseline: 최신 exposure_shadow_queue (해당 store); 없으면 빈 baseline
  create temp table _base on commit drop as
    select esq.position, esq.track_id, esq.exposure_score
    from public.exposure_shadow_queue esq
    where esq.store_id=p_store_id
      and esq.run_id = (select run_id from public.exposure_shadow_queue where store_id=p_store_id order by created_at desc limit 1);
  select count(*) into v_base from _base;
  select count(*) into v_overlap from _twin t join _base b on b.track_id=t.track_id;

  insert into public.queue_validation_runs(run_by, prediction_run_id, store_id, baseline_source, twin_size, baseline_size,
    overlap_count, overlap_rate, expected_completion_delta, expected_skip_delta, expected_revenue_delta,
    diversity_delta, freshness_delta, notes)
  select auth.uid(), v_prun, p_store_id, v_baseline, v_twin, v_base, v_overlap,
    case when greatest(v_twin,1)=0 then 0 else round(v_overlap::numeric/greatest(v_twin,1),4) end,
    -- expected completion delta: twin 평균 expected_completion vs baseline 트랙들의 prediction expected_completion
    round(coalesce((select avg(expected_completion) from _twin),0) - coalesce((select avg(tp.expected_completion_rate) from _base b join public.track_predictions tp on tp.track_id=b.track_id and tp.run_id=v_prun),0), 4),
    round(coalesce((select avg(expected_skip) from _twin),0) - coalesce((select avg(tp.expected_skip_rate) from _base b join public.track_predictions tp on tp.track_id=b.track_id and tp.run_id=v_prun),0), 4),
    round(coalesce((select avg(tp.expected_revenue_weight) from _twin t join public.track_predictions tp on tp.track_id=t.track_id and tp.run_id=v_prun),0)
        - coalesce((select avg(tp.expected_revenue_weight) from _base b join public.track_predictions tp on tp.track_id=b.track_id and tp.run_id=v_prun),0), 4),
    -- diversity: distinct main_genre in twin - baseline
    coalesce((select count(distinct t2.main_genre) from _twin tw join public.tracks t2 on t2.id=tw.track_id),0)
      - coalesce((select count(distinct t3.main_genre) from _base ba join public.tracks t3 on t3.id=ba.track_id),0),
    -- freshness: avg (1/(1+age_days/30)) proxy
    round(coalesce((select avg(1.0/(1+ greatest(extract(day from (now()-coalesce(t4.released_at,t4.created_at)))::numeric,0)/30)) from _twin tw join public.tracks t4 on t4.id=tw.track_id),0)
        - coalesce((select avg(1.0/(1+ greatest(extract(day from (now()-coalesce(t5.released_at,t5.created_at)))::numeric,0)/30)) from _base ba join public.tracks t5 on t5.id=ba.track_id),0), 4),
    'ALGO-4B twin vs exposure_shadow_queue'
  returning id into v_vrun;

  -- items (union of twin + baseline tracks)
  insert into public.queue_validation_items(validation_run_id, track_id, in_twin, in_baseline, twin_position, baseline_position, position_delta, prediction_score, exposure_score)
  select v_vrun, coalesce(t.track_id,b.track_id),
    t.track_id is not null, b.track_id is not null, t.position, b.position,
    case when t.position is not null and b.position is not null then t.position - b.position else null end,
    t.prediction_score, coalesce(t.exposure_score, b.exposure_score)
  from _twin t full outer join _base b on b.track_id=t.track_id;

  return jsonb_build_object('ok', true, 'validation_run_id', v_vrun, 'prediction_run_id', v_prun, 'store_id', p_store_id,
    'baseline_source', v_baseline, 'twin_size', v_twin, 'baseline_size', v_base, 'overlap_count', v_overlap,
    'overlap_rate', case when greatest(v_twin,1)=0 then 0 else round(v_overlap::numeric/greatest(v_twin,1),4) end,
    'note', 'baseline 이 비어있으면 twin 단독 관측(실제 Queue 무변경)');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Counterfactual Engine — 왜 A가 B보다 위인가
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_counterfactual_explanation(
  p_track_a uuid, p_track_b uuid, p_run_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run uuid; a public.track_predictions%rowtype; b public.track_predictions%rowtype;
  v_ea numeric; v_eb numeric; v_reason text; v_top text; v_topval numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.prediction_generation_runs order by run_at desc limit 1));
  select * into a from public.track_predictions where run_id=v_run and track_id=p_track_a;
  select * into b from public.track_predictions where run_id=v_run and track_id=p_track_b;
  if a.id is null or b.id is null then raise exception 'prediction not found for one of the tracks'; end if;
  select avg(exposure_score) into v_ea from public.track_exposure_scores where track_id=p_track_a;
  select avg(exposure_score) into v_eb from public.track_exposure_scores where track_id=p_track_b;

  -- 가장 크게 기여한 요소
  select reason, val into v_top, v_topval from (values
    ('completion', (a.expected_completion_rate-b.expected_completion_rate)*0.35),
    ('skip', ((1-a.expected_skip_rate)-(1-b.expected_skip_rate))*0.25),
    ('eligible', (a.expected_eligible_rate-b.expected_eligible_rate)*0.20),
    ('revenue_weight', (a.expected_revenue_weight-b.expected_revenue_weight)*0.10),
    ('confidence', (a.prediction_confidence-b.prediction_confidence)*0.10)
  ) t(reason,val) order by abs(val) desc limit 1;
  v_reason := format('%s 이(가) %s 에서 우위 — 주 기여 요소: %s (%s점).',
    left(p_track_a::text,8), left(p_track_b::text,8), v_top, round(coalesce(v_topval,0),4));

  return jsonb_build_object(
    'track_a', p_track_a, 'track_b', p_track_b, 'run_id', v_run,
    'a_prediction', a.prediction_score, 'b_prediction', b.prediction_score,
    'completion_diff', round(a.expected_completion_rate-b.expected_completion_rate,4),
    'skip_diff', round(a.expected_skip_rate-b.expected_skip_rate,4),
    'eligible_diff', round(a.expected_eligible_rate-b.expected_eligible_rate,4),
    'revenue_weight_diff', round(a.expected_revenue_weight-b.expected_revenue_weight,4),
    'exposure_score_diff', round(coalesce(v_ea,0)-coalesce(v_eb,0),6),
    'final_score_diff', round(a.prediction_score-b.prediction_score,6),
    'top_factor', v_top, 'reason_summary', v_reason);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_prediction_candidates as
select tp.run_id, tp.track_id, t.title as track_title, t.main_genre,
  tp.prediction_score, tp.expected_completion_rate, tp.expected_skip_rate, tp.expected_eligible_rate,
  tp.expected_revenue_weight, tp.expected_listener_fit, tp.prediction_confidence, tp.data_source,
  row_number() over (partition by tp.run_id order by tp.prediction_score desc) as rank
from public.track_predictions tp
left join public.tracks t on t.id = tp.track_id;

create or replace view public.v2_queue_validation_summary as
select qvr.id as validation_run_id, qvr.run_at, qvr.store_id, qvr.baseline_source,
  qvr.twin_size, qvr.baseline_size, qvr.overlap_count, qvr.overlap_rate,
  qvr.expected_completion_delta, qvr.expected_skip_delta, qvr.expected_revenue_delta,
  qvr.diversity_delta, qvr.freshness_delta
from public.queue_validation_runs qvr;

create or replace view public.v2_prediction_gap_summary as
select elm.run_id, elm.track_id, elm.exposure_score as predicted_exposure,
  elm.actual_completion, elm.predicted_vs_actual_gap,
  case when elm.predicted_vs_actual_gap > 0.05 then 'overestimated'
       when elm.predicted_vs_actual_gap < -0.05 then 'underestimated'
       else 'accurate' end as gap_class,
  elm.result_quality
from public.exposure_learning_memory elm;

-- ─────────────────────────────────────────────────────────────────────
-- H. Overview RPC (dashboard 편의)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_prediction_overview(p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run public.prediction_generation_runs%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_run from public.prediction_generation_runs where (p_run_id is null or id=p_run_id) order by run_at desc limit 1;
  if not found then return jsonb_build_object('has_data', false); end if;
  select jsonb_build_object('has_data', true, 'run', to_jsonb(v_run),
    'top', (select coalesce(jsonb_agg(row order by (row->>'prediction_score')::numeric desc), '[]'::jsonb)
      from (select to_jsonb(c) row from public.v2_prediction_candidates c where c.run_id=v_run.id order by c.prediction_score desc limit 20) x),
    'source_breakdown', (select coalesce(jsonb_object_agg(data_source, c),'{}'::jsonb) from (select data_source, count(*) c from public.track_predictions where run_id=v_run.id group by 1) y),
    'validations', (select coalesce(jsonb_agg(to_jsonb(s) order by s.run_at desc), '[]'::jsonb) from (select * from public.v2_queue_validation_summary order by run_at desc limit 10) z),
    'gap', (select coalesce(jsonb_build_object('count',count(*),'over',count(*) filter (where gap_class='overestimated'),'under',count(*) filter (where gap_class='underestimated'),'accurate',count(*) filter (where gap_class='accurate')),'{}'::jsonb) from public.v2_prediction_gap_summary)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. 권한 (전부 super_admin 전용)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._prediction_score(numeric,numeric,numeric,numeric,numeric)',
    'public.admin_generate_track_predictions(uuid,integer)',
    'public.admin_generate_digital_twin_queue(uuid,integer,uuid)',
    'public.admin_validate_shadow_queue(uuid,uuid)',
    'public.admin_get_counterfactual_explanation(uuid,uuid,uuid)',
    'public.admin_prediction_overview(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.track_predictions is
  'ALGO-4B — 재생 전 곡 성과 예측(Prediction). 실제 Queue 미반영. Digital Twin 전용.';
comment on function public.admin_generate_digital_twin_queue(uuid,integer,uuid) is
  'ALGO-4B — Digital Twin Queue(prediction 기반 shadow). 실제 Queue/Playback 무관.';
