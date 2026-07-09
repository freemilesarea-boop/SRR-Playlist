-- 0431 — Phase ALGO-4A.5: Learning Memory Engine (Shadow)
--
-- 목적:
--   AI Exposure Engine 이 매장/곡/상황별 성과를 "기억"하고 다음 Exposure Score 에
--   반영할 수 있도록 Learning Memory 기반을 구축. 이번 Phase 는 계산·기억만 하고
--   Exposure Score 에 실반영하지 않는다(별도 view 로 연결 준비만).
--
-- 절대 원칙:
--   • 실제 Queue / Playback / Exposure Score 실반영 / Settlement / Streaming v1·v2 무변경.
--   • additive only — 신규 테이블 6 + 신규 RPC + view. drop/rename/기존 수정 없음.
--   • Shadow Memory 만. fraud 자동 차단 없음.
--
-- 데이터 소스(read-only): playback_events_v2(completion_percent/store_type_slug),
--   track_play_events(completion_ratio/skip), stream_events(eligible), store_track_reactions,
--   eligible_settlement_tracks, track_exposure_scores(0430, 있으면), tracks(genome).

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.learning_memory_runs (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  run_by          uuid,
  window_days     integer,
  track_count     integer,
  store_count     integer,
  context_count   integer,
  industry_count  integer,
  exposure_count  integer,
  formula_version integer not null default 1,
  notes           text
);
create index if not exists lmr_at_idx on public.learning_memory_runs(run_at desc);

create table if not exists public.track_learning_memory (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.learning_memory_runs(id) on delete cascade,
  track_id           uuid not null,
  total_exposures    integer not null default 0,
  total_plays        integer not null default 0,
  eligible_streams   integer not null default 0,
  completion_rate    numeric not null default 0,
  skip_rate          numeric not null default 0,
  avg_verified_seconds numeric,
  best_store_type    text,
  worst_store_type   text,
  best_time_slot     text,
  best_context       text,
  reaction_score     numeric not null default 0.5,
  revenue_weight     numeric not null default 1,
  confidence_score   numeric not null default 0,
  learning_score     numeric not null default 0,
  memory_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
create unique index if not exists tlm_run_track_uidx on public.track_learning_memory(run_id, track_id);
create index if not exists tlm_run_score_idx on public.track_learning_memory(run_id, learning_score desc);

create table if not exists public.store_learning_memory (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.learning_memory_runs(id) on delete cascade,
  store_id           uuid,
  preferred_genres   jsonb,
  preferred_moods    jsonb,
  avg_completion_rate numeric,
  avg_skip_rate      numeric,
  avg_health_score   numeric,
  peak_hours         jsonb,
  low_performance_hours jsonb,
  best_tracks        jsonb,
  worst_tracks       jsonb,
  revenue_efficiency numeric,
  learning_score     numeric,
  memory_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
create index if not exists slm_run_idx on public.store_learning_memory(run_id);

create table if not exists public.context_learning_memory (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.learning_memory_runs(id) on delete cascade,
  context_key        text not null,
  time_slot          text,
  season             text,
  weather            text,
  holiday            text,
  industry           text,
  genre_performance  jsonb,
  mood_performance   jsonb,
  completion_rate    numeric,
  skip_rate          numeric,
  exposure_score_avg numeric,
  sample_size        integer,
  memory_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
create index if not exists clm_run_idx on public.context_learning_memory(run_id, context_key);

create table if not exists public.industry_learning_memory (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.learning_memory_runs(id) on delete cascade,
  industry           text not null,
  total_plays        integer not null default 0,
  completion_rate    numeric,
  skip_rate          numeric,
  top_genres         jsonb,
  top_moods          jsonb,
  best_time_slot     text,
  avg_completion     numeric,
  learning_score     numeric,
  memory_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
create unique index if not exists ilm_run_industry_uidx on public.industry_learning_memory(run_id, industry);

create table if not exists public.exposure_learning_memory (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.learning_memory_runs(id) on delete cascade,
  track_id           uuid not null,
  exposure_score     numeric,          -- predicted (0430)
  actual_completion  numeric,
  actual_skip        numeric,
  actual_eligible    integer,
  predicted_vs_actual_gap numeric,
  shadow_queue_position integer,
  result_quality     text,
  memory_version     integer not null default 1,
  computed_at        timestamptz not null default now()
);
create index if not exists elm_run_idx on public.exposure_learning_memory(run_id);

alter table public.learning_memory_runs enable row level security;
alter table public.track_learning_memory enable row level security;
alter table public.store_learning_memory enable row level security;
alter table public.context_learning_memory enable row level security;
alter table public.industry_learning_memory enable row level security;
alter table public.exposure_learning_memory enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='lmr_admin_read') then create policy lmr_admin_read on public.learning_memory_runs for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='tlm_admin_read') then create policy tlm_admin_read on public.track_learning_memory for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='slm_admin_read') then create policy slm_admin_read on public.store_learning_memory for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='clm_admin_read') then create policy clm_admin_read on public.context_learning_memory for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='ilm_admin_read') then create policy ilm_admin_read on public.industry_learning_memory for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='elm_admin_read') then create policy elm_admin_read on public.exposure_learning_memory for select using (public._is_super_admin()); end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Learning Score 엔진 + time-slot helper (초기 공식)
--    LS = completion*0.35 + (1-skip)*0.25 + eligible*0.20 + reaction*0.10 + confidence*0.10
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._learning_score(
  p_completion numeric, p_skip numeric, p_eligible numeric, p_reaction numeric, p_confidence numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select round(
    greatest(0,least(1,coalesce(p_completion,0)))*0.35
    + (1 - greatest(0,least(1,coalesce(p_skip,0))))*0.25
    + greatest(0,least(1,coalesce(p_eligible,0)))*0.20
    + greatest(0,least(1,coalesce(p_reaction,0.5)))*0.10
    + greatest(0,least(1,coalesce(p_confidence,0)))*0.10
  , 6);
$$;

create or replace function public._learning_time_slot(p_hour integer)
returns text language sql immutable set search_path to 'public' as $$
  select case
    when p_hour is null then 'unknown'
    when p_hour between 6 and 11 then 'morning'
    when p_hour between 12 and 17 then 'afternoon'
    when p_hour between 18 and 22 then 'evening'
    else 'night' end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Generator — Track/Store/Context/Industry/Exposure Memory (shadow, persist)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_learning_memory(
  p_days integer default 90, p_track_limit integer default 200)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_run uuid; v_from timestamptz := now() - make_interval(days => greatest(coalesce(p_days,90),1));
  v_season text; v_tracks int; v_stores int; v_ctx int; v_ind int; v_exp int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_season := case extract(month from now())::int
    when 12 then 'winter' when 1 then 'winter' when 2 then 'winter'
    when 3 then 'spring' when 4 then 'spring' when 5 then 'spring'
    when 6 then 'summer' when 7 then 'summer' when 8 then 'summer'
    else 'autumn' end;

  insert into public.learning_memory_runs(run_by, window_days, formula_version, notes)
  values (auth.uid(), greatest(coalesce(p_days,90),1), 1, 'ALGO-4A.5 shadow learning memory. NOT reflected into exposure.')
  returning id into v_run;

  -- 트랙 단위 playback 집계 (playback_events_v2 primary)
  create temp table _lm_tp on commit drop as
    select p.track_id,
      count(*) as plays,
      avg(p.completion_percent)/100.0 as completion_rate,
      count(*) filter (where coalesce(p.completion_percent,0) < 30)::numeric / nullif(count(*),0) as skip_rate,
      avg(p.listened_seconds) as avg_sec
    from public.playback_events_v2 p
    where p.created_at >= v_from and p.track_id is not null
    group by p.track_id;

  -- 후보 트랙 (playback 있는 트랙 우선, limit)
  create temp table _lm_cand on commit drop as
    select tp.track_id from _lm_tp tp order by tp.plays desc limit greatest(coalesce(p_track_limit,200),1);
  select count(*) into v_tracks from _lm_cand;

  -- 트랙별 best store_type / best time_slot
  create temp table _lm_tbest on commit drop as
    select c.track_id,
      (select p.store_type_slug from public.playback_events_v2 p where p.track_id=c.track_id and p.created_at>=v_from and p.store_type_slug is not null group by p.store_type_slug order by avg(p.completion_percent) desc nulls last limit 1) as best_store,
      (select p.store_type_slug from public.playback_events_v2 p where p.track_id=c.track_id and p.created_at>=v_from and p.store_type_slug is not null group by p.store_type_slug order by avg(p.completion_percent) asc nulls last limit 1) as worst_store,
      (select public._learning_time_slot(extract(hour from (p.created_at at time zone 'Asia/Seoul'))::int) from public.playback_events_v2 p where p.track_id=c.track_id and p.created_at>=v_from group by 1 order by count(*) desc limit 1) as best_slot
    from _lm_cand c;

  -- 트랙별 eligible streams (stream_events v1, read-only)
  create temp table _lm_telig on commit drop as
    select c.track_id, count(se.id) as eligible_streams
    from _lm_cand c left join public.stream_events se on se.track_id=c.track_id
      and se.event_type='milestone_30s' and se.is_effective and se.eligible_for_payout and se.created_at>=v_from
    group by c.track_id;

  -- Track Memory insert
  insert into public.track_learning_memory (run_id, track_id, total_exposures, total_plays, eligible_streams,
    completion_rate, skip_rate, avg_verified_seconds, best_store_type, worst_store_type, best_time_slot, best_context,
    reaction_score, revenue_weight, confidence_score, learning_score)
  select v_run, tp.track_id,
    0, tp.plays::int, coalesce(te.eligible_streams,0)::int,
    round(coalesce(tp.completion_rate,0),4), round(coalesce(tp.skip_rate,0),4), round(tp.avg_sec,2),
    tb.best_store, tb.worst_store, tb.best_slot, tb.best_store,
    0.5,
    case when exists(select 1 from public.eligible_settlement_tracks est where est.track_id=tp.track_id) then 1.0 else 0.8 end,
    least(1.0, tp.plays::numeric/30.0),
    public._learning_score(coalesce(tp.completion_rate,0), coalesce(tp.skip_rate,0),
      least(1.0, coalesce(te.eligible_streams,0)::numeric / nullif(tp.plays,0)), 0.5, least(1.0, tp.plays::numeric/30.0))
  from _lm_tp tp
  join _lm_cand c on c.track_id=tp.track_id
  left join _lm_tbest tb on tb.track_id=tp.track_id
  left join _lm_telig te on te.track_id=tp.track_id;

  -- Industry Memory (store_type_slug)
  insert into public.industry_learning_memory (run_id, industry, total_plays, completion_rate, skip_rate,
    top_genres, top_moods, best_time_slot, avg_completion, learning_score)
  select v_run, p.store_type_slug, count(*)::int,
    round(avg(p.completion_percent)/100.0,4),
    round(count(*) filter (where coalesce(p.completion_percent,0)<30)::numeric/nullif(count(*),0),4),
    (select coalesce(jsonb_agg(g order by cnt desc),'[]'::jsonb) from (select coalesce(t.main_genre,'unknown') g, count(*) cnt from public.playback_events_v2 p2 left join public.tracks t on t.id=p2.track_id where p2.store_type_slug=p.store_type_slug and p2.created_at>=v_from group by 1 order by 2 desc limit 5) gg),
    (select coalesce(jsonb_agg(m order by cnt desc),'[]'::jsonb) from (select coalesce(t.mood,'unknown') m, count(*) cnt from public.playback_events_v2 p3 left join public.tracks t on t.id=p3.track_id where p3.store_type_slug=p.store_type_slug and p3.created_at>=v_from group by 1 order by 2 desc limit 5) mm),
    (select public._learning_time_slot(extract(hour from (p4.created_at at time zone 'Asia/Seoul'))::int) from public.playback_events_v2 p4 where p4.store_type_slug=p.store_type_slug and p4.created_at>=v_from group by 1 order by count(*) desc limit 1),
    round(avg(p.completion_percent)/100.0,4),
    public._learning_score(avg(p.completion_percent)/100.0, count(*) filter (where coalesce(p.completion_percent,0)<30)::numeric/nullif(count(*),0), 0.5, 0.5, least(1.0, count(*)::numeric/100.0))
  from public.playback_events_v2 p
  where p.created_at>=v_from and p.store_type_slug is not null
  group by p.store_type_slug;
  select count(*) into v_ind from public.industry_learning_memory where run_id=v_run;

  -- Context Memory (time_slot × industry)
  insert into public.context_learning_memory (run_id, context_key, time_slot, season, industry,
    genre_performance, mood_performance, completion_rate, skip_rate, exposure_score_avg, sample_size)
  select v_run, slot||'|'||ind, slot, v_season, ind,
    (select coalesce(jsonb_object_agg(g, cr),'{}'::jsonb) from (select coalesce(t.main_genre,'unknown') g, round(avg(p2.completion_percent)/100.0,3) cr from public.playback_events_v2 p2 left join public.tracks t on t.id=p2.track_id where p2.store_type_slug=ind and public._learning_time_slot(extract(hour from (p2.created_at at time zone 'Asia/Seoul'))::int)=slot and p2.created_at>=v_from group by 1 order by 2 desc limit 5) gg),
    (select coalesce(jsonb_object_agg(m, cr),'{}'::jsonb) from (select coalesce(t.mood,'unknown') m, round(avg(p3.completion_percent)/100.0,3) cr from public.playback_events_v2 p3 left join public.tracks t on t.id=p3.track_id where p3.store_type_slug=ind and public._learning_time_slot(extract(hour from (p3.created_at at time zone 'Asia/Seoul'))::int)=slot and p3.created_at>=v_from group by 1 order by 2 desc limit 5) mm),
    round(avg(completion_percent)/100.0,4),
    round(count(*) filter (where coalesce(completion_percent,0)<30)::numeric/nullif(count(*),0),4),
    null, count(*)::int
  from (
    select p.completion_percent, p.store_type_slug as ind,
      public._learning_time_slot(extract(hour from (p.created_at at time zone 'Asia/Seoul'))::int) as slot
    from public.playback_events_v2 p where p.created_at>=v_from and p.store_type_slug is not null
  ) q group by slot, ind;
  select count(*) into v_ctx from public.context_learning_memory where run_id=v_run;

  -- Store Memory (business_id 있는 경우만; 없으면 store universe 기본 구조)
  insert into public.store_learning_memory (run_id, store_id, avg_completion_rate, avg_skip_rate, avg_health_score,
    peak_hours, best_tracks, revenue_efficiency, learning_score, memory_version)
  select v_run, p.business_id,
    round(avg(p.completion_percent)/100.0,4),
    round(count(*) filter (where coalesce(p.completion_percent,0)<30)::numeric/nullif(count(*),0),4),
    100,
    (select coalesce(jsonb_agg(h order by cnt desc),'[]'::jsonb) from (select extract(hour from (p2.created_at at time zone 'Asia/Seoul'))::int h, count(*) cnt from public.playback_events_v2 p2 where p2.business_id=p.business_id and p2.created_at>=v_from group by 1 order by 2 desc limit 3) hh),
    (select coalesce(jsonb_agg(tid order by cnt desc),'[]'::jsonb) from (select p3.track_id tid, count(*) cnt from public.playback_events_v2 p3 where p3.business_id=p.business_id and p3.created_at>=v_from group by 1 order by 2 desc limit 5) tt),
    1, public._learning_score(avg(p.completion_percent)/100.0, count(*) filter (where coalesce(p.completion_percent,0)<30)::numeric/nullif(count(*),0), 0.5, 0.5, least(1.0,count(*)::numeric/50.0)), 1
  from public.playback_events_v2 p where p.created_at>=v_from and p.business_id is not null
  group by p.business_id;
  select count(*) into v_stores from public.store_learning_memory where run_id=v_run;

  -- Exposure Memory (0430 있을 때만: predicted exposure vs actual completion)
  if to_regclass('public.track_exposure_scores') is not null then
    insert into public.exposure_learning_memory (run_id, track_id, exposure_score, actual_completion, actual_skip,
      actual_eligible, predicted_vs_actual_gap, shadow_queue_position, result_quality)
    select v_run, tlm.track_id,
      round(pe.avg_exposure,6), tlm.completion_rate, tlm.skip_rate, tlm.eligible_streams,
      round(pe.avg_exposure - tlm.completion_rate, 6),
      null,
      case when tlm.completion_rate >= 0.7 then 'high' when tlm.completion_rate >= 0.4 then 'mid' else 'low' end
    from public.track_learning_memory tlm
    join (select track_id, avg(exposure_score) avg_exposure from public.track_exposure_scores group by track_id) pe on pe.track_id=tlm.track_id
    where tlm.run_id=v_run;
    select count(*) into v_exp from public.exposure_learning_memory where run_id=v_run;
  end if;

  update public.learning_memory_runs set track_count=v_tracks, store_count=v_stores, context_count=v_ctx,
    industry_count=v_ind, exposure_count=v_exp where id=v_run;

  return jsonb_build_object('ok', true, 'run_id', v_run, 'track_count', v_tracks, 'store_count', v_stores,
    'context_count', v_ctx, 'industry_count', v_ind, 'exposure_count', v_exp,
    'note', 'SHADOW MEMORY — Exposure Score 미반영');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. View: v2_learning_score_candidates (Exposure 연결 준비 — 실반영 아님)
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_learning_score_candidates as
select tlm.run_id, tlm.track_id, t.title as track_title, tg_genre.main_genre,
  tlm.learning_score, tlm.completion_rate, tlm.skip_rate, tlm.confidence_score,
  tlm.eligible_streams, tlm.total_plays, tlm.best_store_type, tlm.best_time_slot
from public.track_learning_memory tlm
left join public.tracks t on t.id = tlm.track_id
left join lateral (select main_genre from public.tracks tt where tt.id=tlm.track_id) tg_genre on true;

-- ─────────────────────────────────────────────────────────────────────
-- E. 조회 RPC
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_memory_overview(p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run public.learning_memory_runs%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_run from public.learning_memory_runs where (p_run_id is null or id=p_run_id) order by run_at desc limit 1;
  if not found then return jsonb_build_object('has_data', false); end if;
  select jsonb_build_object('has_data', true, 'run', to_jsonb(v_run),
    'track_top', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'learning_score',learning_score,'completion',completion_rate,'skip',skip_rate,'plays',total_plays,'best_store',best_store_type,'best_slot',best_time_slot) order by learning_score desc), '[]'::jsonb)
      from (select * from public.track_learning_memory where run_id=v_run.id order by learning_score desc limit 20) x),
    'industries', (select coalesce(jsonb_agg(jsonb_build_object('industry',industry,'plays',total_plays,'completion',completion_rate,'skip',skip_rate,'best_slot',best_time_slot,'top_genres',top_genres,'learning_score',learning_score) order by total_plays desc), '[]'::jsonb)
      from public.industry_learning_memory where run_id=v_run.id),
    'contexts', (select coalesce(jsonb_agg(jsonb_build_object('context',context_key,'slot',time_slot,'industry',industry,'completion',completion_rate,'skip',skip_rate,'sample',sample_size,'genre_perf',genre_performance) order by sample_size desc), '[]'::jsonb)
      from (select * from public.context_learning_memory where run_id=v_run.id order by sample_size desc limit 30) y),
    'exposure_gap', (select coalesce(jsonb_build_object('count',count(*),'avg_gap',round(avg(predicted_vs_actual_gap),4),'high',count(*) filter (where result_quality='high'),'mid',count(*) filter (where result_quality='mid'),'low',count(*) filter (where result_quality='low')), '{}'::jsonb)
      from public.exposure_learning_memory where run_id=v_run.id)
  ) into v;
  return v;
end; $$;

create or replace function public.admin_get_track_memory(p_track_id uuid, p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.learning_memory_runs order by run_at desc limit 1));
  select to_jsonb(m) into v from public.track_learning_memory m where m.track_id=p_track_id and m.run_id=v_run;
  return coalesce(v, jsonb_build_object('has_data', false, 'track_id', p_track_id));
end; $$;

create or replace function public.admin_get_store_memory(p_store_id uuid, p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.learning_memory_runs order by run_at desc limit 1));
  select to_jsonb(m) into v from public.store_learning_memory m where m.store_id=p_store_id and m.run_id=v_run;
  return coalesce(v, jsonb_build_object('has_data', false, 'store_id', p_store_id));
end; $$;

create or replace function public.admin_get_context_memory(p_run_id uuid default null, p_industry text default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.learning_memory_runs order by run_at desc limit 1));
  select coalesce(jsonb_agg(to_jsonb(m) order by m.sample_size desc), '[]'::jsonb) into v
    from public.context_learning_memory m where m.run_id=v_run and (p_industry is null or m.industry=p_industry);
  return jsonb_build_object('run_id', v_run, 'industry', p_industry, 'contexts', v);
end; $$;

create or replace function public.admin_compare_exposure_prediction(p_run_id uuid default null, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.learning_memory_runs order by run_at desc limit 1));
  select jsonb_build_object('run_id', v_run,
    'summary', (select coalesce(jsonb_build_object('count',count(*),'avg_gap',round(avg(predicted_vs_actual_gap),4),'avg_abs_gap',round(avg(abs(predicted_vs_actual_gap)),4),'high',count(*) filter (where result_quality='high'),'mid',count(*) filter (where result_quality='mid'),'low',count(*) filter (where result_quality='low')),'{}'::jsonb) from public.exposure_learning_memory where run_id=v_run),
    'rows', (select coalesce(jsonb_agg(jsonb_build_object('track_id',track_id,'exposure_score',exposure_score,'actual_completion',actual_completion,'actual_skip',actual_skip,'gap',predicted_vs_actual_gap,'quality',result_quality) order by abs(predicted_vs_actual_gap) desc), '[]'::jsonb)
      from (select * from public.exposure_learning_memory where run_id=v_run order by abs(predicted_vs_actual_gap) desc limit greatest(coalesce(p_limit,50),1)) z)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- F. 권한 (전부 super_admin 전용)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._learning_score(numeric,numeric,numeric,numeric,numeric)',
    'public._learning_time_slot(integer)',
    'public.admin_generate_learning_memory(integer,integer)',
    'public.admin_learning_memory_overview(uuid)',
    'public.admin_get_track_memory(uuid,uuid)',
    'public.admin_get_store_memory(uuid,uuid)',
    'public.admin_get_context_memory(uuid,text)',
    'public.admin_compare_exposure_prediction(uuid,integer)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.track_learning_memory is
  'ALGO-4A.5 — Shadow Learning Memory(track). 성과 기억. Exposure Score 미반영(v2_learning_score_candidates 로 연결 준비만).';
comment on function public.admin_generate_learning_memory(integer,integer) is
  'ALGO-4A.5 — Learning Memory 생성기(track/store/context/industry/exposure). Shadow only, 실반영 없음.';
