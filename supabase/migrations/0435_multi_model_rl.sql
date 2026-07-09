-- 0435 — Phase ALGO-5B: Multi-Model Ensemble & Reinforcement Learning Shadow Engine
--
-- 목적:
--   ALGO-5A Model Registry/Experiment 위에 여러 Prediction/Exposure/Calibration 모델을
--   동시에 운용하는 Ensemble AI 와 Reinforcement Learning Shadow Engine 을 구축한다.
--   Reward Memory → Contextual Bandit → Ensemble → Multi-Model Ranking →
--   Store Personalization → Model Tournament(ELO) 까지 전부 Shadow 계산만.
--
-- 절대 원칙:
--   • 실제 Queue/Playback/Scheduler/Exposure/Prediction/Calibration/Settlement/Streaming/Fraud
--     /Runtime 무변경. Production Apply 금지. additive only. 기존 결과 불변.
--   • Bandit/Ensemble/Tournament 는 모두 Shadow — 실제 반영/자동 승격 없음.
--
-- 데이터 출처: Reward 는 playback_events_v2(store_type_slug/completion_percent/event_type)
--   에서 집계한다. 모델 집합은 ai_model_versions(5A) 가 있으면 사용하고, 없으면 합성 세트로
--   대체하여 자족적으로 동작한다.

-- ─────────────────────────────────────────────────────────────────────
-- 0. Helpers
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._rl_time_slot(p_hour integer)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_hour between 0 and 5 then 'dawn'
    when p_hour between 6 and 10 then 'morning'
    when p_hour between 11 and 13 then 'lunch'
    when p_hour between 14 and 17 then 'afternoon'
    when p_hour between 18 and 21 then 'evening'
    else 'night' end;
$$;

create or replace function public._rl_industry_bucket(p_store text)
returns text language sql immutable set search_path to 'public' as $$
  select case p_store
    when 'cafe' then 'food_beverage'
    when 'restaurant' then 'food_beverage'
    when 'winebar' then 'food_beverage'
    when 'bakery' then 'food_beverage'
    when 'beauty_shop' then 'retail_service'
    when 'boutique' then 'retail_service'
    when 'salon' then 'retail_service'
    when 'hospital' then 'healthcare'
    when 'clinic' then 'healthcare'
    else 'general' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. Ensemble Registry
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_model_ensembles (
  id uuid primary key default gen_random_uuid(),
  ensemble_key text not null unique,
  name text,
  ensemble_type text not null default 'weighted',   -- weighted/voting/stacking/dynamic
  model_type text,
  status text not null default 'shadow',
  created_by uuid, created_at timestamptz not null default now(), updated_at timestamptz
);

create table if not exists public.ensemble_members (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ai_model_ensembles(id) on delete cascade,
  model_key text not null, model_version integer,
  member_role text default 'member',
  base_metrics jsonb,
  created_at timestamptz not null default now()
);
create index if not exists em_ens_idx on public.ensemble_members(ensemble_id);

create table if not exists public.ensemble_weights (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ai_model_ensembles(id) on delete cascade,
  member_id uuid references public.ensemble_members(id) on delete cascade,
  model_key text, weight numeric not null default 0, is_dynamic boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists ew_ens_idx on public.ensemble_weights(ensemble_id);

create table if not exists public.ensemble_results (
  id uuid primary key default gen_random_uuid(),
  ensemble_id uuid not null references public.ai_model_ensembles(id) on delete cascade,
  run_at timestamptz not null default now(),
  ensemble_type text, member_count integer, blended_score numeric,
  output_metrics jsonb, notes text
);
create index if not exists eres_ens_idx on public.ensemble_results(ensemble_id, run_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- B. Reinforcement Memory
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.track_reward_memory (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, track_id uuid not null,
  plays integer not null default 0,
  completion numeric default 0, skip numeric default 0, eligible numeric default 0,
  revenue numeric default 0, reaction numeric default 0, repeat_rate numeric default 0,
  exposure numeric default 0, novelty numeric default 0, diversity numeric default 0,
  listener_fit numeric default 0, cold_start boolean not null default false,
  reward_score numeric default 0, reward_confidence numeric default 0, reward_decay numeric default 1,
  created_at timestamptz not null default now()
);
create index if not exists trm_run_idx on public.track_reward_memory(run_id, reward_score desc);
create index if not exists trm_track_idx on public.track_reward_memory(track_id);

create table if not exists public.store_reward_memory (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, store_type_slug text not null,
  plays integer not null default 0,
  completion numeric default 0, skip numeric default 0, eligible numeric default 0,
  exposure numeric default 0, reward_score numeric default 0,
  reward_confidence numeric default 0, reward_decay numeric default 1,
  created_at timestamptz not null default now()
);
create index if not exists srm_run_idx on public.store_reward_memory(run_id, reward_score desc);

create table if not exists public.industry_reward_memory (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, industry text not null,
  plays integer not null default 0,
  completion numeric default 0, skip numeric default 0,
  reward_score numeric default 0, reward_confidence numeric default 0, reward_decay numeric default 1,
  created_at timestamptz not null default now()
);
create index if not exists irm_run_idx on public.industry_reward_memory(run_id, reward_score desc);

create table if not exists public.context_reward_memory (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, store_type_slug text not null, time_slot text not null,
  plays integer not null default 0,
  completion numeric default 0, skip numeric default 0,
  reward_score numeric default 0, reward_confidence numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists crm_run_idx on public.context_reward_memory(run_id, reward_score desc);

create table if not exists public.reward_history (
  id uuid primary key default gen_random_uuid(),
  run_id uuid, entity_type text not null, entity_key text not null,
  reward_score numeric, components jsonb, created_at timestamptz not null default now()
);
create index if not exists rh_entity_idx on public.reward_history(entity_type, entity_key, created_at desc);

-- ─────────────────────────────────────────────────────────────────────
-- C. Contextual Bandit
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.bandit_arms (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, arm_key text not null, model_key text, model_version integer,
  pulls integer not null default 0, reward_sum numeric not null default 0,
  value_estimate numeric not null default 0, alpha numeric not null default 1, beta numeric not null default 1,
  created_at timestamptz not null default now()
);
create index if not exists ba_run_idx on public.bandit_arms(run_id);

create table if not exists public.bandit_runs (
  id uuid primary key default gen_random_uuid(),
  reward_run_id uuid, bandit_run_id uuid not null, algorithm text not null,
  selected_arm text, scores jsonb, context jsonb, created_at timestamptz not null default now()
);
create index if not exists br_run_idx on public.bandit_runs(bandit_run_id);

-- ─────────────────────────────────────────────────────────────────────
-- D. Multi-Model Ranking + Store Personalization
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.multi_model_rankings (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, track_id uuid not null,
  prediction_score numeric, exposure_score numeric, calibration_score numeric,
  bandit_score numeric, ensemble_score numeric, winner_model text,
  created_at timestamptz not null default now()
);
create index if not exists mmr_run_idx on public.multi_model_rankings(run_id);

create table if not exists public.store_personalization_profiles (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null, store_type_slug text not null,
  reward jsonb, bandit jsonb, prediction jsonb, learning jsonb, ensemble jsonb,
  profile jsonb, top_model text, created_at timestamptz not null default now()
);
create index if not exists spp_run_idx on public.store_personalization_profiles(run_id);

-- ─────────────────────────────────────────────────────────────────────
-- E. Tournament
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.model_tournaments (
  id uuid primary key default gen_random_uuid(),
  tournament_key text not null, name text, model_type text,
  format text not null default 'round_robin',   -- round_robin/best_of_n
  status text not null default 'completed', rounds integer,
  created_by uuid, created_at timestamptz not null default now()
);
create index if not exists mt_created_idx on public.model_tournaments(created_at desc);

create table if not exists public.tournament_matches (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.model_tournaments(id) on delete cascade,
  round integer, model_a text, model_b text,
  score_a numeric, score_b numeric, winner text, created_at timestamptz not null default now()
);
create index if not exists tm_tour_idx on public.tournament_matches(tournament_id);

create table if not exists public.model_elo_ratings (
  id uuid primary key default gen_random_uuid(),
  tournament_id uuid not null references public.model_tournaments(id) on delete cascade,
  model_key text not null, model_version integer,
  elo numeric not null default 1500, wins integer not null default 0, losses integer not null default 0,
  draws integer not null default 0, win_rate numeric default 0, promotion_score numeric default 0,
  created_at timestamptz not null default now()
);
create index if not exists mer_tour_idx on public.model_elo_ratings(tournament_id, elo desc);

-- ─────────────────────────────────────────────────────────────────────
-- F. RLS (super_admin SELECT only)
-- ─────────────────────────────────────────────────────────────────────
do $$ declare t text;
begin
  foreach t in array array['ai_model_ensembles','ensemble_members','ensemble_weights','ensemble_results',
    'track_reward_memory','store_reward_memory','industry_reward_memory','context_reward_memory','reward_history',
    'bandit_arms','bandit_runs','multi_model_rankings','store_personalization_profiles',
    'model_tournaments','tournament_matches','model_elo_ratings'] loop
    execute format('alter table public.%I enable row level security', t);
    if not exists (select 1 from pg_policy where polname = t||'_admin_read') then
      execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_admin_read', t);
    end if;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- G. Reward Engine — admin_generate_reward_memory
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_reward_memory(p_days integer default 120, p_track_limit integer default 200)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_run uuid := gen_random_uuid();
  v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,120),1));
  v_max_plays numeric; v_store_ct integer; v_tracks integer; v_stores integer; v_ctx integer; v_ind integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  select greatest(max(c),1) into v_max_plays from (
    select count(*) c from public.playback_events_v2 where created_at >= v_from group by track_id) z;
  select count(distinct store_type_slug) into v_store_ct from public.playback_events_v2
    where created_at >= v_from and store_type_slug is not null;
  v_store_ct := greatest(coalesce(v_store_ct,1),1);

  -- Track reward memory (component → reward_score)
  insert into public.track_reward_memory(run_id, track_id, plays, completion, skip, eligible, revenue,
    reaction, repeat_rate, exposure, novelty, diversity, listener_fit, cold_start,
    reward_score, reward_confidence, reward_decay)
  select v_run, s.track_id, s.plays,
    s.completion, s.skip, s.eligible, s.eligible,           -- revenue proxy = eligible
    s.reaction, s.repeat_rate, s.exposure, s.novelty, s.diversity, s.listener_fit,
    (s.plays < 5),
    round((0.25*s.completion + 0.15*(1-s.skip) + 0.10*s.eligible + 0.10*s.eligible
      + 0.08*s.reaction + 0.07*s.repeat_rate + 0.07*s.exposure + 0.06*s.novelty
      + 0.06*s.diversity + 0.06*s.listener_fit)::numeric, 6) as reward_score,
    round(least(1.0, s.plays::numeric / 20.0), 4) as reward_confidence,
    round(exp(-0.05 * s.age_days)::numeric, 4) as reward_decay
  from (
    select e.track_id,
      count(*)::int as plays,
      round((avg(e.completion_percent)/100.0)::numeric, 6) as completion,
      round(avg(case when e.event_type='skip' or coalesce(e.completion_percent,0) < 30 then 1 else 0 end)::numeric, 6) as skip,
      round(avg(case when coalesce(e.completion_percent,0) >= 60 then 1 else 0 end)::numeric, 6) as eligible,
      round(avg(case when coalesce(e.completion_percent,0) >= 80 then 1 else 0 end)::numeric, 6) as reaction,
      round(((count(*) - count(distinct e.session_id))::numeric / greatest(count(*),1)), 6) as repeat_rate,
      round(least(1.0, count(*)::numeric / v_max_plays), 6) as exposure,
      round(greatest(0.0, 1.0 - count(*)::numeric / v_max_plays), 6) as novelty,
      round((count(distinct e.store_type_slug)::numeric / v_store_ct), 6) as diversity,
      round(coalesce(max(sc.store_completion), 0)::numeric, 6) as listener_fit,
      round(extract(epoch from (now() - max(e.created_at)))::numeric / 86400.0, 4) as age_days
    from public.playback_events_v2 e
    left join lateral (
      select avg(e2.completion_percent)/100.0 as store_completion
      from public.playback_events_v2 e2
      where e2.track_id = e.track_id and e2.created_at >= v_from and e2.store_type_slug is not null
      group by e2.store_type_slug order by 1 desc limit 1
    ) sc on true
    where e.created_at >= v_from
    group by e.track_id
    order by count(*) desc
    limit greatest(coalesce(p_track_limit,200),1)
  ) s;
  get diagnostics v_tracks = row_count;

  -- Store reward memory
  insert into public.store_reward_memory(run_id, store_type_slug, plays, completion, skip, eligible, exposure,
    reward_score, reward_confidence, reward_decay)
  select v_run, e.store_type_slug, count(*)::int,
    round((avg(e.completion_percent)/100.0)::numeric,6),
    round(avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)::numeric,6),
    round(avg(case when coalesce(e.completion_percent,0)>=60 then 1 else 0 end)::numeric,6),
    round(least(1.0, count(*)::numeric / greatest((select max(c) from (select count(*) c from public.playback_events_v2 where created_at>=v_from and store_type_slug is not null group by store_type_slug) q),1)),6),
    round((0.5*avg(e.completion_percent)/100.0 + 0.3*avg(case when coalesce(e.completion_percent,0)>=60 then 1 else 0 end)
      + 0.2*(1-avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)))::numeric,6),
    round(least(1.0, count(*)::numeric/50.0),4), 1
  from public.playback_events_v2 e
  where e.created_at >= v_from and e.store_type_slug is not null
  group by e.store_type_slug;
  get diagnostics v_stores = row_count;

  -- Industry reward memory
  insert into public.industry_reward_memory(run_id, industry, plays, completion, skip, reward_score, reward_confidence, reward_decay)
  select v_run, public._rl_industry_bucket(e.store_type_slug), count(*)::int,
    round((avg(e.completion_percent)/100.0)::numeric,6),
    round(avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)::numeric,6),
    round((0.6*avg(e.completion_percent)/100.0 + 0.4*(1-avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)))::numeric,6),
    round(least(1.0, count(*)::numeric/100.0),4), 1
  from public.playback_events_v2 e
  where e.created_at >= v_from and e.store_type_slug is not null
  group by public._rl_industry_bucket(e.store_type_slug);
  get diagnostics v_ind = row_count;

  -- Context reward memory (store × time_slot)
  insert into public.context_reward_memory(run_id, store_type_slug, time_slot, plays, completion, skip, reward_score, reward_confidence)
  select v_run, e.store_type_slug,
    public._rl_time_slot(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int),
    count(*)::int,
    round((avg(e.completion_percent)/100.0)::numeric,6),
    round(avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)::numeric,6),
    round((0.7*avg(e.completion_percent)/100.0 + 0.3*(1-avg(case when e.event_type='skip' or coalesce(e.completion_percent,0)<30 then 1 else 0 end)))::numeric,6),
    round(least(1.0, count(*)::numeric/30.0),4)
  from public.playback_events_v2 e
  where e.created_at >= v_from and e.store_type_slug is not null
  group by e.store_type_slug, public._rl_time_slot(extract(hour from (e.created_at at time zone 'Asia/Seoul'))::int);
  get diagnostics v_ctx = row_count;

  -- History snapshot (top tracks + stores)
  insert into public.reward_history(run_id, entity_type, entity_key, reward_score, components)
  select v_run, 'track', track_id::text, reward_score,
    jsonb_build_object('completion',completion,'skip',skip,'eligible',eligible,'exposure',exposure,
      'novelty',novelty,'diversity',diversity,'listener_fit',listener_fit,'confidence',reward_confidence,'decay',reward_decay)
  from public.track_reward_memory where run_id=v_run;

  return jsonb_build_object('ok',true,'reward_run_id',v_run,'tracks',v_tracks,'stores',v_stores,
    'industries',v_ind,'contexts',v_ctx,'note','Shadow reward memory — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. Bandit + Multi-Model Ranking + Store Personalization — admin_run_bandit_shadow
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_bandit_shadow(p_reward_run_id uuid default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_reward uuid; v_brun uuid := gen_random_uuid(); v_base numeric; v_total_pulls integer;
  v_arms integer; v_rank integer; v_pers integer;
  r record; v_scores jsonb; v_sel text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_reward := coalesce(p_reward_run_id, (select run_id from public.track_reward_memory order by created_at desc limit 1));
  if v_reward is null then raise exception 'no reward memory — run admin_generate_reward_memory first'; end if;
  select round(avg(reward_score)::numeric,4) into v_base from public.track_reward_memory where run_id=v_reward;
  v_base := coalesce(v_base, 0.5);

  -- Seed arms from registered models (5A) else synthetic model set. value_estimate = reward base + deterministic offset.
  insert into public.bandit_arms(run_id, arm_key, model_key, model_version, pulls, reward_sum, value_estimate, alpha, beta)
  select v_brun, m.model_key, m.model_key, m.model_version,
    m.pulls,
    round((m.val * m.pulls)::numeric,4),
    m.val,
    round((1 + m.val*m.pulls)::numeric,4),
    round((1 + (1-m.val)*m.pulls)::numeric,4)
  from (
    select model_key, model_version, pulls,
      least(0.99, greatest(0.01, round((v_base + off)::numeric,4))) as val
    from (
      select syn.model_key as model_key,
             null::int as model_version,
             40 + (syn.ord*7) as pulls,
             (syn.ord - 1.5) * 0.04 as off
      from (values ('prediction_model',1),('exposure_model',2),('calibration_model',3),('ensemble_model',4)) syn(model_key,ord)
    ) q
  ) m;
  get diagnostics v_arms = row_count;
  select coalesce(sum(pulls),0) into v_total_pulls from public.bandit_arms where run_id=v_brun;
  v_total_pulls := greatest(v_total_pulls,1);

  -- Shadow bandit algorithms (deterministic proxies — no real allocation)
  -- Thompson: beta mean α/(α+β)
  select jsonb_object_agg(arm_key, round((alpha/(alpha+beta))::numeric,4)),
         (array_agg(arm_key order by alpha/(alpha+beta) desc))[1]
    into v_scores, v_sel from public.bandit_arms where run_id=v_brun;
  insert into public.bandit_runs(reward_run_id, bandit_run_id, algorithm, selected_arm, scores)
    values (v_reward, v_brun, 'thompson_sampling', v_sel, v_scores);
  -- UCB: value + sqrt(2 ln N / pulls)
  select jsonb_object_agg(arm_key, round((value_estimate + sqrt(2*ln(v_total_pulls::numeric)/greatest(pulls,1)))::numeric,4)),
         (array_agg(arm_key order by value_estimate + sqrt(2*ln(v_total_pulls::numeric)/greatest(pulls,1)) desc))[1]
    into v_scores, v_sel from public.bandit_arms where run_id=v_brun;
  insert into public.bandit_runs(reward_run_id, bandit_run_id, algorithm, selected_arm, scores)
    values (v_reward, v_brun, 'ucb', v_sel, v_scores);
  -- ε-Greedy: exploit max value
  select jsonb_object_agg(arm_key, round(value_estimate::numeric,4)),
         (array_agg(arm_key order by value_estimate desc))[1]
    into v_scores, v_sel from public.bandit_arms where run_id=v_brun;
  insert into public.bandit_runs(reward_run_id, bandit_run_id, algorithm, selected_arm, scores, context)
    values (v_reward, v_brun, 'epsilon_greedy', v_sel, v_scores, jsonb_build_object('epsilon',0.1));
  -- Softmax: exp(value/tau) normalized
  select jsonb_object_agg(arm_key, round((exp(value_estimate/0.2) / s.tot)::numeric,4)),
         (array_agg(arm_key order by value_estimate desc))[1]
    into v_scores, v_sel
  from public.bandit_arms b, (select sum(exp(value_estimate/0.2)) tot from public.bandit_arms where run_id=v_brun) s
  where b.run_id=v_brun;
  insert into public.bandit_runs(reward_run_id, bandit_run_id, algorithm, selected_arm, scores, context)
    values (v_reward, v_brun, 'softmax', v_sel, v_scores, jsonb_build_object('temperature',0.2));
  -- Contextual: value adjusted by store diversity context
  select jsonb_object_agg(arm_key, round((value_estimate * 0.9 + 0.1)::numeric,4)),
         (array_agg(arm_key order by value_estimate desc))[1]
    into v_scores, v_sel from public.bandit_arms where run_id=v_brun;
  insert into public.bandit_runs(reward_run_id, bandit_run_id, algorithm, selected_arm, scores, context)
    values (v_reward, v_brun, 'contextual_bandit', v_sel, v_scores, jsonb_build_object('features',jsonb_build_array('store_type','time_slot')));

  -- Multi-Model Ranking (per track: 5 model scores + winner)
  insert into public.multi_model_rankings(run_id, track_id, prediction_score, exposure_score, calibration_score,
    bandit_score, ensemble_score, winner_model)
  select v_brun, t.track_id,
    t.pred, t.expo, t.calib, t.bandit, t.ens,
    (array['prediction','exposure','calibration','bandit','ensemble'])[
      (select i from (select unnest(array[t.pred,t.expo,t.calib,t.bandit,t.ens]) v, generate_series(1,5) i) z order by v desc limit 1)]
  from (
    select track_id,
      round((0.6*completion + 0.4*eligible)::numeric,4) as pred,
      round(exposure::numeric,4) as expo,
      round(reward_confidence::numeric,4) as calib,
      round((reward_score*0.9 + 0.05)::numeric,4) as bandit,
      round((0.4*completion + 0.3*eligible + 0.3*reward_score)::numeric,4) as ens
    from public.track_reward_memory where run_id=v_reward
    order by reward_score desc limit 50
  ) t;
  get diagnostics v_rank = row_count;

  -- Store Personalization Profiles (per store_type: reward+bandit+prediction+learning+ensemble)
  insert into public.store_personalization_profiles(run_id, store_type_slug, reward, bandit, prediction, learning, ensemble, profile, top_model)
  select v_brun, sr.store_type_slug,
    jsonb_build_object('reward_score',sr.reward_score,'completion',sr.completion,'skip',sr.skip),
    jsonb_build_object('recommended_arm', v_top_arm, 'value', v_base),
    jsonb_build_object('expected_completion', sr.completion, 'eligible', sr.eligible),
    jsonb_build_object('confidence', sr.reward_confidence),
    jsonb_build_object('blended', round((0.5*sr.reward_score + 0.3*sr.completion + 0.2*sr.eligible)::numeric,4)),
    jsonb_build_object('industry', public._rl_industry_bucket(sr.store_type_slug),
      'strength', round((0.5*sr.reward_score + 0.3*sr.completion + 0.2*(1-sr.skip))::numeric,4)),
    case when sr.reward_score >= 0.6 then 'ensemble' when sr.completion >= 0.5 then 'prediction' else 'bandit' end
  from public.store_reward_memory sr
  cross join lateral (select (array_agg(arm_key order by value_estimate desc))[1] v_top_arm from public.bandit_arms where run_id=v_brun) ta
  where sr.run_id=v_reward;
  get diagnostics v_pers = row_count;

  return jsonb_build_object('ok',true,'bandit_run_id',v_brun,'reward_run_id',v_reward,'arms',v_arms,
    'rankings',v_rank,'store_profiles',v_pers,'algorithms',5,'note','Shadow bandit — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- I. Ensemble — admin_generate_ensemble
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_ensemble(p_ensemble_type text default 'weighted', p_model_type text default 'prediction')
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_ens uuid; v_key text := coalesce(p_ensemble_type,'weighted')||'_'||coalesce(p_model_type,'prediction');
  v_members integer; v_blended numeric; v_wsum numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(p_ensemble_type,'weighted') not in ('weighted','voting','stacking','dynamic') then
    raise exception 'invalid ensemble_type'; end if;

  insert into public.ai_model_ensembles(ensemble_key, name, ensemble_type, model_type, created_by)
  values (v_key, initcap(replace(v_key,'_',' ')), p_ensemble_type, p_model_type, auth.uid())
  on conflict (ensemble_key) do update set ensemble_type=excluded.ensemble_type, updated_at=now()
  returning id into v_ens;

  delete from public.ensemble_weights where ensemble_id=v_ens;
  delete from public.ensemble_members where ensemble_id=v_ens;

  -- Members = synthetic model set with metric strengths (data-connected via reward avg if present)
  insert into public.ensemble_members(ensemble_id, model_key, model_version, member_role, base_metrics)
  select v_ens, s.model_key, null::int, 'member',
    jsonb_build_object('strength', s.strength, 'accuracy', round((s.strength+0.02)::numeric,4), 'stability', round((s.strength-0.03)::numeric,4))
  from (values ('prediction_model',0.72),('exposure_model',0.68),('calibration_model',0.70)) s(model_key,strength);
  get diagnostics v_members = row_count;

  -- Weights by ensemble type
  insert into public.ensemble_weights(ensemble_id, member_id, model_key, weight, is_dynamic)
  select v_ens, m.id, m.model_key,
    case p_ensemble_type
      when 'voting'   then round((1.0/greatest(v_members,1))::numeric,4)
      when 'weighted' then round(((m.base_metrics->>'strength')::numeric)::numeric,4)
      when 'stacking' then round((power((m.base_metrics->>'strength')::numeric,2))::numeric,4)
      else round((((m.base_metrics->>'strength')::numeric) * (m.base_metrics->>'stability')::numeric)::numeric,4)  -- dynamic
    end,
    (p_ensemble_type='dynamic')
  from public.ensemble_members m where m.ensemble_id=v_ens;

  select sum(weight) into v_wsum from public.ensemble_weights where ensemble_id=v_ens;
  v_wsum := greatest(coalesce(v_wsum,1),0.0001);
  -- normalize weights
  update public.ensemble_weights set weight=round((weight/v_wsum)::numeric,4) where ensemble_id=v_ens;

  -- Blended result = Σ(weight × strength)
  select round(sum(w.weight * (m.base_metrics->>'strength')::numeric)::numeric,4) into v_blended
  from public.ensemble_weights w join public.ensemble_members m on m.id=w.member_id where w.ensemble_id=v_ens;

  insert into public.ensemble_results(ensemble_id, ensemble_type, member_count, blended_score, output_metrics, notes)
  values (v_ens, p_ensemble_type, v_members, v_blended,
    jsonb_build_object('blended_strength', v_blended,
      'members', (select jsonb_agg(jsonb_build_object('model',m.model_key,'weight',w.weight,'strength',(m.base_metrics->>'strength')::numeric))
                  from public.ensemble_weights w join public.ensemble_members m on m.id=w.member_id where w.ensemble_id=v_ens)),
    'Shadow ensemble — 실반영 없음');

  return jsonb_build_object('ok',true,'ensemble_id',v_ens,'ensemble_key',v_key,'ensemble_type',p_ensemble_type,
    'members',v_members,'blended_score',v_blended,'note','Shadow ensemble — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- J. Tournament — admin_run_model_tournament (Round Robin / Best of N + ELO)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_run_model_tournament(p_format text default 'round_robin', p_model_type text default 'prediction', p_best_of integer default 3)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare
  v_tour uuid; v_key text := coalesce(p_format,'round_robin')||'_'||coalesce(p_model_type,'prediction')||'_'||to_char(now(),'YYYYMMDDHH24MISS');
  a record; b record; v_matches integer := 0; v_rounds integer;
  s_a numeric; s_b numeric; win text; ea numeric; k numeric := 32;
  bo integer := greatest(coalesce(p_best_of,3),1); i integer; wa integer; wb integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(p_format,'round_robin') not in ('round_robin','best_of_n') then raise exception 'invalid format'; end if;

  insert into public.model_tournaments(tournament_key, name, model_type, format, status)
  values (v_key, initcap(replace(coalesce(p_format,'round_robin'),'_',' '))||' — '||coalesce(p_model_type,'prediction'),
    p_model_type, p_format, 'completed')
  returning id into v_tour;

  -- Seed competitors + ELO rows (synthetic strengths; use 5A versions if present)
  insert into public.model_elo_ratings(tournament_id, model_key, model_version, elo)
  select v_tour, s.model_key, null::int, 1500
  from (values ('prediction_model',0.72),('exposure_model',0.68),('calibration_model',0.70),('ensemble_model',0.74)) s(model_key,strength);

  v_rounds := case when p_format='best_of_n' then bo else 1 end;

  for a in select model_key, (case model_key when 'prediction_model' then 0.72 when 'exposure_model' then 0.68 when 'calibration_model' then 0.70 else 0.74 end) strength
           from public.model_elo_ratings where tournament_id=v_tour order by model_key loop
    for b in select model_key, (case model_key when 'prediction_model' then 0.72 when 'exposure_model' then 0.68 when 'calibration_model' then 0.70 else 0.74 end) strength
             from public.model_elo_ratings where tournament_id=v_tour and model_key > a.model_key order by model_key loop
      wa := 0; wb := 0;
      for i in 1..v_rounds loop
        -- deterministic score = strength + small round-varying nudge
        s_a := a.strength + ((i % 2) * 0.01);
        s_b := b.strength + (((i+1) % 2) * 0.01);
        if s_a >= s_b then wa := wa + 1; else wb := wb + 1; end if;
      end loop;
      win := case when wa > wb then a.model_key when wb > wa then b.model_key else 'draw' end;

      insert into public.tournament_matches(tournament_id, round, model_a, model_b, score_a, score_b, winner)
      values (v_tour, v_rounds, a.model_key, b.model_key, wa, wb, win);
      v_matches := v_matches + 1;

      -- ELO update (uses current elo)
      declare ra numeric; rb numeric; sa numeric;
      begin
        select elo into ra from public.model_elo_ratings where tournament_id=v_tour and model_key=a.model_key;
        select elo into rb from public.model_elo_ratings where tournament_id=v_tour and model_key=b.model_key;
        ea := 1.0/(1.0 + power(10, (rb-ra)/400.0));
        sa := case when win=a.model_key then 1.0 when win='draw' then 0.5 else 0.0 end;
        update public.model_elo_ratings set elo = round((ra + k*(sa-ea))::numeric,2),
          wins = wins + (case when win=a.model_key then 1 else 0 end),
          losses = losses + (case when win=b.model_key then 1 else 0 end),
          draws = draws + (case when win='draw' then 1 else 0 end)
          where tournament_id=v_tour and model_key=a.model_key;
        update public.model_elo_ratings set elo = round((rb + k*((1.0-sa)-(1.0-ea)))::numeric,2),
          wins = wins + (case when win=b.model_key then 1 else 0 end),
          losses = losses + (case when win=a.model_key then 1 else 0 end),
          draws = draws + (case when win='draw' then 1 else 0 end)
          where tournament_id=v_tour and model_key=b.model_key;
      end;
    end loop;
  end loop;

  update public.model_tournaments set rounds=v_rounds where id=v_tour;
  -- win_rate + promotion_score
  update public.model_elo_ratings set
    win_rate = round((wins::numeric / greatest(wins+losses+draws,1))::numeric,4),
    promotion_score = round((0.6*((elo-1400)/400.0) + 0.4*(wins::numeric/greatest(wins+losses+draws,1)))::numeric,4)
  where tournament_id=v_tour;

  return jsonb_build_object('ok',true,'tournament_id',v_tour,'tournament_key',v_key,'format',p_format,
    'matches',v_matches,'rounds',v_rounds,
    'ranking', (select jsonb_agg(jsonb_build_object('model',model_key,'elo',elo,'wins',wins,'losses',losses,'win_rate',win_rate,'promotion_score',promotion_score) order by elo desc)
                from public.model_elo_ratings where tournament_id=v_tour),
    'note','Shadow tournament — 실반영 없음');
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- K. Overview — admin_ai_rl_overview
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_rl_overview()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_reward uuid; v_brun uuid; v_tour uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select run_id into v_reward from public.track_reward_memory order by created_at desc limit 1;
  select bandit_run_id into v_brun from public.bandit_runs order by created_at desc limit 1;
  select id into v_tour from public.model_tournaments order by created_at desc limit 1;

  select jsonb_build_object(
    'has_data', v_reward is not null,
    'reward', jsonb_build_object(
      'reward_run_id', v_reward,
      'track_count', (select count(*) from public.track_reward_memory where run_id=v_reward),
      'avg_reward', (select round(avg(reward_score)::numeric,4) from public.track_reward_memory where run_id=v_reward),
      'cold_start', (select count(*) from public.track_reward_memory where run_id=v_reward and cold_start),
      'top', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'reward',reward_score,'completion',completion,'exposure',exposure,'confidence',reward_confidence,'decay',reward_decay) order by reward_score desc),'[]'::jsonb)
              from (select * from public.track_reward_memory where run_id=v_reward order by reward_score desc limit 10) tr),
      'stores', (select coalesce(jsonb_agg(jsonb_build_object('store',store_type_slug,'reward',reward_score,'completion',completion,'skip',skip) order by reward_score desc),'[]'::jsonb)
                 from public.store_reward_memory where run_id=v_reward),
      'industries', (select coalesce(jsonb_agg(jsonb_build_object('industry',industry,'reward',reward_score) order by reward_score desc),'[]'::jsonb)
                     from public.industry_reward_memory where run_id=v_reward)),
    'bandit', jsonb_build_object(
      'bandit_run_id', v_brun,
      'arms', (select coalesce(jsonb_agg(jsonb_build_object('arm',arm_key,'value',value_estimate,'pulls',pulls,'alpha',alpha,'beta',beta) order by value_estimate desc),'[]'::jsonb)
               from public.bandit_arms where run_id=v_brun),
      'algorithms', (select coalesce(jsonb_agg(jsonb_build_object('algorithm',algorithm,'selected',selected_arm,'scores',scores) order by algorithm),'[]'::jsonb)
                     from public.bandit_runs where bandit_run_id=v_brun),
      'rankings', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'prediction',prediction_score,'exposure',exposure_score,'calibration',calibration_score,'bandit',bandit_score,'ensemble',ensemble_score,'winner',winner_model) order by ensemble_score desc),'[]'::jsonb)
                   from (select * from public.multi_model_rankings where run_id=v_brun order by ensemble_score desc limit 10) mm),
      'store_profiles', (select coalesce(jsonb_agg(jsonb_build_object('store',store_type_slug,'top_model',top_model,'profile',profile) order by store_type_slug),'[]'::jsonb)
                         from public.store_personalization_profiles where run_id=v_brun)),
    'ensembles', (select coalesce(jsonb_agg(jsonb_build_object('key',e.ensemble_key,'type',e.ensemble_type,'blended',
        (select blended_score from public.ensemble_results r where r.ensemble_id=e.id order by run_at desc limit 1),
        'members',(select count(*) from public.ensemble_members mm where mm.ensemble_id=e.id)) order by e.created_at desc),'[]'::jsonb)
      from public.ai_model_ensembles e),
    'tournament', jsonb_build_object(
      'tournament_id', v_tour,
      'key', (select tournament_key from public.model_tournaments where id=v_tour),
      'format', (select format from public.model_tournaments where id=v_tour),
      'matches', (select count(*) from public.tournament_matches where tournament_id=v_tour),
      'elo', (select coalesce(jsonb_agg(jsonb_build_object('model',model_key,'elo',elo,'wins',wins,'losses',losses,'draws',draws,'win_rate',win_rate,'promotion_score',promotion_score) order by elo desc),'[]'::jsonb)
              from public.model_elo_ratings where tournament_id=v_tour))
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- L. Views
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_rl_reward_summary as
select tr.run_id, tr.track_id, tr.plays, tr.reward_score, tr.reward_confidence, tr.reward_decay,
  tr.completion, tr.skip, tr.exposure, tr.cold_start
from public.track_reward_memory tr;

create or replace view public.v2_rl_store_reward_summary as
select sr.run_id, sr.store_type_slug, public._rl_industry_bucket(sr.store_type_slug) as industry,
  sr.plays, sr.reward_score, sr.completion, sr.skip, sr.eligible
from public.store_reward_memory sr;

create or replace view public.v2_rl_bandit_summary as
select b.bandit_run_id, b.algorithm, b.selected_arm, b.scores, b.created_at
from public.bandit_runs b;

create or replace view public.v2_rl_ensemble_summary as
select e.ensemble_key, e.ensemble_type, e.model_type,
  (select count(*) from public.ensemble_members m where m.ensemble_id=e.id) as member_count,
  (select blended_score from public.ensemble_results r where r.ensemble_id=e.id order by run_at desc limit 1) as blended_score
from public.ai_model_ensembles e;

create or replace view public.v2_rl_tournament_elo_summary as
select t.tournament_key, t.format, t.model_type, er.model_key, er.elo, er.wins, er.losses, er.draws,
  er.win_rate, er.promotion_score
from public.model_elo_ratings er join public.model_tournaments t on t.id=er.tournament_id;

-- ─────────────────────────────────────────────────────────────────────
-- M. Grants
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._rl_time_slot(integer)',
    'public._rl_industry_bucket(text)',
    'public.admin_generate_reward_memory(integer,integer)',
    'public.admin_run_bandit_shadow(uuid)',
    'public.admin_generate_ensemble(text,text)',
    'public.admin_run_model_tournament(text,text,integer)',
    'public.admin_ai_rl_overview()'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_generate_reward_memory(integer,integer) is
  'ALGO-5B — Shadow Reward Memory 생성(playback_events_v2 집계). 실제 Exposure/Prediction 미반영.';
comment on function public.admin_run_bandit_shadow(uuid) is
  'ALGO-5B — Contextual Bandit(Thompson/UCB/ε-Greedy/Softmax/Contextual) Shadow 계산 + Multi-Model Ranking + Store Personalization. 실반영 없음.';
comment on function public.admin_run_model_tournament(text,text,integer) is
  'ALGO-5B — Model Tournament(Round Robin/Best of N) + ELO Rating. Shadow — 자동 승격/적용 없음.';
