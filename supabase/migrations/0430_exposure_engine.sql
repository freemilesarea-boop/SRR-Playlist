-- 0430 — Phase ALGO-4A: AI Exposure Engine Foundation (Shadow)
--
-- 목적:
--   Streaming v2 + Settlement v2 를 기반으로 "가장 적합한 곡을 가장 적절한 순간에 노출"하는
--   AI Exposure Engine 의 기반(genome → exposure score → shadow queue → explain)을 구축.
--   재생 순서/Queue/Scheduler/Playback/Settlement 는 절대 변경하지 않는다. Shadow 계산만.
--
-- 절대 원칙:
--   • 기존 Queue / Scheduler / Playback / Settlement / Chart / 추천 무변경.
--   • additive only — 신규 테이블 6 + 신규 RPC 6 + 신규 view 1. drop/rename/alter 없음.
--   • Exposure 는 재생을 늘리는 엔진이 아니라 적합·적시 노출 엔진(shadow only).
--   • 초기 계수 Learning=Settlement=TrackQuality=StoreFit=1 (구조 우선).
--
-- 순환: Streaming → Learning → Exposure → Queue → Settlement → Learning (shadow 관측).

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.exposure_generation_runs (
  id              uuid primary key default gen_random_uuid(),
  run_at          timestamptz not null default now(),
  run_by          uuid,
  store_scope     uuid,                 -- null = 전체 store
  track_count     integer,
  store_count     integer,
  score_count     integer,
  formula_version integer not null default 1,
  params          jsonb,
  notes           text
);
create index if not exists exp_runs_at_idx on public.exposure_generation_runs(run_at desc);

create table if not exists public.track_genomes (
  track_id        uuid primary key,
  genre           text,
  main_genre      text,
  sub_genre       text,
  mood            text,
  mood_tags       jsonb,
  energy          numeric,
  tempo           text,
  bpm             integer,
  music_key       text,
  danceability    numeric,
  acoustic        numeric,
  instrumental    boolean,
  vocal_type      text,
  vocal_presence  numeric,
  language        text,
  season_tags     jsonb,
  weather_tags    jsonb,
  holiday_tags    jsonb,
  industry_fit    jsonb,
  emotion         text,
  release_age_days integer,
  duration        integer,
  explicit        boolean,
  popularity      numeric,             -- 0~1 정규화 재생 인기
  embedding       jsonb,               -- placeholder (ALGO-4C+)
  genome_version  integer not null default 1,
  computed_at     timestamptz not null default now()
);

create table if not exists public.store_genomes (
  store_id        uuid primary key,
  store_kind      text,                -- 'business' | 'enterprise'
  store_name      text,
  industry        text,
  store_size      text,
  customer_age    text,
  visit_duration  integer,
  peak_time       text,
  preferred_genre jsonb,
  preferred_mood  jsonb,
  preferred_energy numeric,
  season_weight   numeric default 1,
  weather_weight  numeric default 1,
  holiday_weight  numeric default 1,
  avg_completion  numeric,
  avg_skip        numeric,
  revenue_weight  numeric default 1,
  health_score    numeric default 100,
  genome_version  integer not null default 1,
  computed_at     timestamptz not null default now()
);

create table if not exists public.track_exposure_scores (
  id                 uuid primary key default gen_random_uuid(),
  run_id             uuid not null references public.exposure_generation_runs(id) on delete cascade,
  store_id           uuid,
  track_id           uuid not null,
  store_fit          numeric not null default 1,
  genre_fit          numeric not null default 1,
  mood_fit           numeric not null default 1,
  freshness          numeric not null default 1,
  completion_rate    numeric not null default 0.5,
  skip_rate          numeric not null default 0.3,
  settlement_quality numeric not null default 1,
  track_quality      numeric not null default 1,
  learning_score     numeric not null default 1,
  base_score         numeric not null default 0,
  penalty            numeric not null default 0,
  exposure_score     numeric not null default 0,
  recent_plays       integer not null default 0,
  settlement_eligible boolean not null default false,
  explain_payload    jsonb,
  created_at         timestamptz not null default now()
);
create unique index if not exists tes_run_store_track_uidx on public.track_exposure_scores(run_id, store_id, track_id);
create index if not exists tes_run_store_score_idx on public.track_exposure_scores(run_id, store_id, exposure_score desc);

create table if not exists public.store_exposure_profiles (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references public.exposure_generation_runs(id) on delete cascade,
  store_id        uuid,
  candidate_count integer,
  avg_exposure    numeric,
  max_exposure    numeric,
  min_exposure    numeric,
  top_track_id    uuid,
  health_score    numeric,
  created_at      timestamptz not null default now()
);
create index if not exists sep_run_idx on public.store_exposure_profiles(run_id);

create table if not exists public.exposure_shadow_queue (
  id             uuid primary key default gen_random_uuid(),
  run_id         uuid not null references public.exposure_generation_runs(id) on delete cascade,
  store_id       uuid,
  position       integer not null,
  track_id       uuid not null,
  exposure_score numeric not null,
  created_at     timestamptz not null default now()
);
create unique index if not exists esq_run_store_pos_uidx on public.exposure_shadow_queue(run_id, store_id, position);

alter table public.exposure_generation_runs enable row level security;
alter table public.track_genomes enable row level security;
alter table public.store_genomes enable row level security;
alter table public.track_exposure_scores enable row level security;
alter table public.store_exposure_profiles enable row level security;
alter table public.exposure_shadow_queue enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname='exp_runs_admin_read') then create policy exp_runs_admin_read on public.exposure_generation_runs for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='tg_admin_read') then create policy tg_admin_read on public.track_genomes for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='sg_admin_read') then create policy sg_admin_read on public.store_genomes for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='tes_admin_read') then create policy tes_admin_read on public.track_exposure_scores for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='sep_admin_read') then create policy sep_admin_read on public.store_exposure_profiles for select using (public._is_super_admin()); end if;
  if not exists (select 1 from pg_policy where polname='esq_admin_read') then create policy esq_admin_read on public.exposure_shadow_queue for select using (public._is_super_admin()); end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Exposure Score 엔진 (product 형; 초기 계수 1)
--    score = store_fit × genre_fit × mood_fit × freshness × completion × (1-skip)
--            × settlement_quality × track_quality × learning
--    exposure_score = score × (1 - penalty)   -- penalty = 과노출 억제
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._exposure_clamp01(p numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select greatest(0, least(1, coalesce(p, 1)));
$$;

create or replace function public._exposure_base_score(
  p_store_fit numeric, p_genre_fit numeric, p_mood_fit numeric, p_freshness numeric,
  p_completion numeric, p_skip numeric, p_settlement numeric, p_track_quality numeric, p_learning numeric)
returns numeric language sql immutable set search_path to 'public' as $$
  select round(
    public._exposure_clamp01(p_store_fit) * public._exposure_clamp01(p_genre_fit)
    * public._exposure_clamp01(p_mood_fit) * public._exposure_clamp01(p_freshness)
    * public._exposure_clamp01(p_completion) * (1 - public._exposure_clamp01(p_skip))
    * public._exposure_clamp01(p_settlement) * public._exposure_clamp01(p_track_quality)
    * public._exposure_clamp01(p_learning)
  , 6);
$$;

-- release_age → freshness (신곡 우대, 하한 0.4)
create or replace function public._exposure_freshness(p_age_days integer)
returns numeric language sql immutable set search_path to 'public' as $$
  select case
    when p_age_days is null then 0.7
    when p_age_days <= 30 then 1.0
    when p_age_days >= 365 then 0.4
    else round(1.0 - (p_age_days - 30)::numeric / 335 * 0.6, 4) end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. Store universe (business users ∪ enterprise_accounts) — read-only
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._exposure_store_universe()
returns table(store_id uuid, store_kind text, store_name text, industry text)
language sql stable security definer set search_path to 'public' as $$
  select u.id, 'business'::text, u.nickname, u.business_category
    from public.users u where u.account_type = 'business'
  union all
  select e.id, 'enterprise'::text, e.enterprise_name, null::text
    from public.enterprise_accounts e where e.deleted_at is null;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Generator — genome refresh + exposure score (shadow, persist)
--    p_store_id: 특정 store 만(null=전체). p_track_limit: 후보 트랙 상한.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_exposure_scores(
  p_store_id uuid default null, p_track_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_run_id uuid; v_track_count int; v_store_count int; v_score_count int := 0; v_max_plays numeric;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;

  insert into public.exposure_generation_runs(run_by, store_scope, formula_version, params, notes)
  values (auth.uid(), p_store_id, 1, jsonb_build_object('track_limit', p_track_limit),
          'ALGO-4A shadow exposure. NOT used for real queue/playback.')
  returning id into v_run_id;

  -- 후보 트랙 (recommendable & released)
  create temp table _cand on commit drop as
    select t.id as track_id, t.main_genre, t.sub_genre, t.mood, t.mood_tags, t.duration,
           t.vocal_type, t.vocal_presence, t.language, t.explicit_content, t.instrumental,
           t.brightness_level, t.emotional_intensity, t.business_type_tags, t.season_tags,
           t.recommended_dayparts, t.audio_health_status,
           extract(day from (now() - coalesce(t.released_at, t.release_date::timestamptz, t.created_at)))::int as release_age_days
    from public.tracks t
    where t.source_type = 'artist_upload' and t.release_status = 'released'
      and coalesce(t.is_recommendable, true) = true
    order by coalesce(t.released_at, t.created_at) desc
    limit greatest(coalesce(p_track_limit,100), 1);
  select count(*) into v_track_count from _cand;

  -- 트랙 재생 통계(v1 stream_events 90d, read-only) → completion/skip/popularity
  create temp table _stats on commit drop as
    select c.track_id,
      count(se.id) as plays,
      count(se.id) filter (where se.completed) as completes,
      count(se.id) filter (where coalesce(se.listened_seconds,0) < 10) as skips,
      count(se.id) filter (where se.created_at >= now() - interval '7 days') as recent_plays
    from _cand c
    left join public.stream_events se on se.track_id = c.track_id and se.created_at >= now() - interval '90 days'
    group by c.track_id;
  select coalesce(max(plays),0) into v_max_plays from _stats;

  -- Track Genome upsert
  insert into public.track_genomes as g (track_id, genre, main_genre, sub_genre, mood, mood_tags,
    energy, tempo, bpm, music_key, danceability, acoustic, instrumental, vocal_type, vocal_presence,
    language, season_tags, weather_tags, holiday_tags, industry_fit, emotion, release_age_days,
    duration, explicit, popularity, embedding, genome_version, computed_at)
  select c.track_id, c.main_genre, c.main_genre, c.sub_genre, c.mood, to_jsonb(c.mood_tags),
    c.emotional_intensity, null, null, null, null, null, c.instrumental, c.vocal_type, c.vocal_presence,
    c.language, to_jsonb(c.season_tags), null, null, to_jsonb(c.business_type_tags), c.mood, c.release_age_days,
    c.duration, c.explicit_content,
    case when v_max_plays > 0 then round(coalesce(s.plays,0)::numeric / v_max_plays, 4) else 0 end,
    null, 1, now()
  from _cand c left join _stats s on s.track_id = c.track_id
  on conflict (track_id) do update set
    main_genre=excluded.main_genre, sub_genre=excluded.sub_genre, mood=excluded.mood, mood_tags=excluded.mood_tags,
    energy=excluded.energy, instrumental=excluded.instrumental, vocal_type=excluded.vocal_type,
    vocal_presence=excluded.vocal_presence, language=excluded.language, season_tags=excluded.season_tags,
    industry_fit=excluded.industry_fit, release_age_days=excluded.release_age_days, duration=excluded.duration,
    explicit=excluded.explicit, popularity=excluded.popularity, genome_version=g.genome_version+1, computed_at=now();

  -- Store universe (+ scope filter)
  create temp table _stores on commit drop as
    select * from public._exposure_store_universe()
    where p_store_id is null or store_id = p_store_id;
  select count(*) into v_store_count from _stores;

  -- Store Genome upsert (foundation 기본값; avg_completion/skip 은 전체 트랙 평균)
  insert into public.store_genomes as sg (store_id, store_kind, store_name, industry, store_size,
    customer_age, visit_duration, peak_time, preferred_genre, preferred_mood, preferred_energy,
    season_weight, weather_weight, holiday_weight, avg_completion, avg_skip, revenue_weight,
    health_score, genome_version, computed_at)
  select st.store_id, st.store_kind, st.store_name, st.industry, null, null, null, null,
    null, null, null, 1, 1, 1,
    (select case when sum(plays)>0 then round(sum(completes)::numeric/sum(plays),4) else 0.5 end from _stats),
    (select case when sum(plays)>0 then round(sum(skips)::numeric/sum(plays),4) else 0.3 end from _stats),
    1, 100, 1, now()
  from _stores st
  on conflict (store_id) do update set store_kind=excluded.store_kind, store_name=excluded.store_name,
    industry=excluded.industry, avg_completion=excluded.avg_completion, avg_skip=excluded.avg_skip,
    genome_version=sg.genome_version+1, computed_at=now();

  -- Exposure Score: store × track
  insert into public.track_exposure_scores (run_id, store_id, track_id, store_fit, genre_fit, mood_fit,
    freshness, completion_rate, skip_rate, settlement_quality, track_quality, learning_score,
    base_score, penalty, exposure_score, recent_plays, settlement_eligible, explain_payload)
  select v_run_id, st.store_id, c.track_id,
    1.0 as store_fit,
    case when sg.preferred_genre is null then 1.0
         when sg.preferred_genre ? coalesce(c.main_genre,'') then 1.0 else 0.7 end as genre_fit,
    case when sg.preferred_mood is null then 1.0
         when sg.preferred_mood ? coalesce(c.mood,'') then 1.0 else 0.8 end as mood_fit,
    public._exposure_freshness(c.release_age_days) as freshness,
    case when coalesce(s.plays,0) > 0 then round(s.completes::numeric/s.plays,4) else 0.5 end as completion_rate,
    case when coalesce(s.plays,0) > 0 then round(s.skips::numeric/s.plays,4) else 0.3 end as skip_rate,
    case when exists(select 1 from public.eligible_settlement_tracks est where est.track_id=c.track_id) then 1.0 else 0.8 end as settlement_quality,
    case when c.audio_health_status = 'healthy' then 1.0 else 0.9 end as track_quality,
    1.0 as learning_score,
    0::numeric, 0::numeric, 0::numeric,   -- base/penalty/exposure 아래 update 로 계산
    coalesce(s.recent_plays,0),
    exists(select 1 from public.eligible_settlement_tracks est where est.track_id=c.track_id),
    null::jsonb
  from _stores st
  cross join _cand c
  left join _stats s on s.track_id = c.track_id
  left join public.store_genomes sg on sg.store_id = st.store_id;

  -- base/penalty/exposure + explain 채우기
  update public.track_exposure_scores tes set
    base_score = public._exposure_base_score(store_fit, genre_fit, mood_fit, freshness, completion_rate, skip_rate, settlement_quality, track_quality, learning_score),
    penalty = least(0.5, recent_plays * 0.02),
    exposure_score = round(public._exposure_base_score(store_fit, genre_fit, mood_fit, freshness, completion_rate, skip_rate, settlement_quality, track_quality, learning_score) * (1 - least(0.5, recent_plays * 0.02)), 6),
    explain_payload = jsonb_build_object(
      'store_fit', store_fit, 'genre_fit', genre_fit, 'mood_fit', mood_fit, 'freshness', freshness,
      'completion_rate', completion_rate, 'skip_rate', skip_rate, 'skip_factor', round(1-skip_rate,4),
      'settlement_quality', settlement_quality, 'track_quality', track_quality, 'learning_score', learning_score,
      'base_score', public._exposure_base_score(store_fit, genre_fit, mood_fit, freshness, completion_rate, skip_rate, settlement_quality, track_quality, learning_score),
      'penalty', least(0.5, recent_plays * 0.02), 'penalty_reason', case when recent_plays>0 then 'recent_over_exposure' else 'none' end,
      'final_score', round(public._exposure_base_score(store_fit, genre_fit, mood_fit, freshness, completion_rate, skip_rate, settlement_quality, track_quality, learning_score) * (1 - least(0.5, recent_plays * 0.02)), 6),
      'formula', 'store_fit×genre_fit×mood_fit×freshness×completion×(1-skip)×settlement×track_quality×learning ×(1-penalty)')
  where tes.run_id = v_run_id;
  get diagnostics v_score_count = row_count;

  -- Store profile 집계
  insert into public.store_exposure_profiles (run_id, store_id, candidate_count, avg_exposure, max_exposure, min_exposure, top_track_id, health_score)
  select v_run_id, store_id, count(*), round(avg(exposure_score),6), max(exposure_score), min(exposure_score),
    (array_agg(track_id order by exposure_score desc))[1], 100
  from public.track_exposure_scores where run_id = v_run_id group by store_id;

  update public.exposure_generation_runs set track_count=v_track_count, store_count=v_store_count, score_count=v_score_count where id=v_run_id;

  return jsonb_build_object('ok', true, 'run_id', v_run_id, 'track_count', v_track_count,
    'store_count', v_store_count, 'score_count', v_score_count,
    'note', 'SHADOW ONLY — 실제 Queue/Playback 미반영');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Shadow Queue 생성 (실제 Queue 무관, 별도 저장)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_generate_shadow_queue(
  p_store_id uuid, p_size integer default 20, p_run_id uuid default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_run uuid; v_cnt int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.exposure_generation_runs order by run_at desc limit 1));
  if v_run is null then raise exception 'no exposure run — admin_generate_exposure_scores 먼저 실행'; end if;

  delete from public.exposure_shadow_queue where run_id=v_run and store_id=p_store_id;
  insert into public.exposure_shadow_queue (run_id, store_id, position, track_id, exposure_score)
  select v_run, p_store_id, row_number() over (order by exposure_score desc, track_id), track_id, exposure_score
  from public.track_exposure_scores
  where run_id=v_run and store_id=p_store_id
  order by exposure_score desc, track_id
  limit greatest(coalesce(p_size,20),1);
  get diagnostics v_cnt = row_count;

  return jsonb_build_object('ok', true, 'run_id', v_run, 'store_id', p_store_id, 'queue_size', v_cnt,
    'note', 'SHADOW QUEUE — 실제 재생 순서와 무관');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. View: v2_exposure_candidates (track × store 후보)
-- ─────────────────────────────────────────────────────────────────────
create or replace view public.v2_exposure_candidates as
select
  tes.id as exposure_id, tes.run_id, tes.store_id, tes.track_id,
  t.title as track_title, tg.main_genre, tg.mood,
  tes.exposure_score, tes.base_score, tes.penalty,
  tes.learning_score, tes.freshness, tes.completion_rate, tes.skip_rate,
  tes.recent_plays, tes.settlement_eligible,
  sg.store_name, sg.health_score,
  row_number() over (partition by tes.run_id, tes.store_id order by tes.exposure_score desc) as rank
from public.track_exposure_scores tes
left join public.tracks t on t.id = tes.track_id
left join public.track_genomes tg on tg.track_id = tes.track_id
left join public.store_genomes sg on sg.store_id = tes.store_id;

-- ─────────────────────────────────────────────────────────────────────
-- G. 조회 RPC
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_exposure_candidates(p_store_id uuid default null, p_limit integer default 50, p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  v_run := coalesce(p_run_id, (select id from public.exposure_generation_runs order by run_at desc limit 1));
  select jsonb_build_object('run_id', v_run, 'store_id', p_store_id,
    'candidates', (select coalesce(jsonb_agg(row order by (row->>'exposure_score')::numeric desc), '[]'::jsonb)
      from (select to_jsonb(c) as row from public.v2_exposure_candidates c
            where c.run_id=v_run and (p_store_id is null or c.store_id=p_store_id)
            order by c.exposure_score desc limit greatest(coalesce(p_limit,50),1)) z)) into v;
  return v;
end; $$;

create or replace function public.admin_get_track_genome(p_track_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select to_jsonb(g) into v from public.track_genomes g where g.track_id=p_track_id;
  return coalesce(v, jsonb_build_object('has_data', false, 'track_id', p_track_id));
end; $$;

create or replace function public.admin_get_store_genome(p_store_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select to_jsonb(g) into v from public.store_genomes g where g.store_id=p_store_id;
  return coalesce(v, jsonb_build_object('has_data', false, 'store_id', p_store_id));
end; $$;

create or replace function public.admin_get_exposure_explain(p_exposure_score_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select jsonb_build_object('id', tes.id, 'run_id', tes.run_id, 'store_id', tes.store_id, 'track_id', tes.track_id,
      'track_title', t.title, 'store_name', sg.store_name,
      'exposure_score', tes.exposure_score, 'explain', tes.explain_payload,
      'genome', to_jsonb(tg))
    into v from public.track_exposure_scores tes
    left join public.tracks t on t.id=tes.track_id
    left join public.track_genomes tg on tg.track_id=tes.track_id
    left join public.store_genomes sg on sg.store_id=tes.store_id
    where tes.id=p_exposure_score_id;
  if v is null then raise exception 'exposure score not found'; end if;
  return v;
end; $$;

-- overview (dashboard 편의)
create or replace function public.admin_exposure_overview(p_run_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_run public.exposure_generation_runs%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_run from public.exposure_generation_runs where (p_run_id is null or id=p_run_id) order by run_at desc limit 1;
  if not found then return jsonb_build_object('has_data', false); end if;
  select jsonb_build_object('has_data', true, 'run', to_jsonb(v_run),
    'stores', (select coalesce(jsonb_agg(jsonb_build_object('store_id',store_id,'store_name',sg.store_name,'candidate_count',candidate_count,'avg_exposure',avg_exposure,'max_exposure',max_exposure,'top_track_id',top_track_id) order by avg_exposure desc nulls last), '[]'::jsonb)
      from public.store_exposure_profiles p left join public.store_genomes sg on sg.store_id=p.store_id where p.run_id=v_run.id),
    'top_candidates', (select coalesce(jsonb_agg(row order by (row->>'exposure_score')::numeric desc), '[]'::jsonb)
      from (select to_jsonb(c) row from public.v2_exposure_candidates c where c.run_id=v_run.id order by c.exposure_score desc limit 20) z),
    'low_exposure', (select coalesce(jsonb_agg(row order by (row->>'exposure_score')::numeric asc), '[]'::jsonb)
      from (select to_jsonb(c) row from public.v2_exposure_candidates c where c.run_id=v_run.id order by c.exposure_score asc limit 10) z2)
  ) into v;
  return v;
end; $$;

-- ─────────────────────────────────────────────────────────────────────
-- H. 권한 (전부 super_admin 전용)
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public._exposure_clamp01(numeric)',
    'public._exposure_base_score(numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric)',
    'public._exposure_freshness(integer)',
    'public._exposure_store_universe()',
    'public.admin_generate_exposure_scores(uuid,integer)',
    'public.admin_generate_shadow_queue(uuid,integer,uuid)',
    'public.admin_get_exposure_candidates(uuid,integer,uuid)',
    'public.admin_get_track_genome(uuid)',
    'public.admin_get_store_genome(uuid)',
    'public.admin_get_exposure_explain(uuid)',
    'public.admin_exposure_overview(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.track_exposure_scores is
  'ALGO-4A — Shadow Exposure Score. store×track 적합·적시 노출 점수(관측). 실제 Queue/Playback 미반영.';
comment on function public.admin_generate_exposure_scores(uuid,integer) is
  'ALGO-4A — Shadow Exposure 생성기(genome refresh + score). 실제 재생/Queue 무관.';
