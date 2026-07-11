-- 0461 — Phase WEB-OBS-8: Intelligent Operations & Predictive Streaming Analytics
--
-- 목적:
--   WEB-OBS-7(0460) 의 streaming_quality_events(+ playback_events_v2 READ-ONLY) 위에
--   운영 인텔리전스 조회 계층을 추가한다: browser/device matrix, release/enterprise heatmap,
--   time-series(예측·추세용), store/fleet replay, root-cause 근거 조회, 그리고 장기 보존을 위한
--   cost-aware rollup 창고. 판정(score/regression/incident/predict/reliability)은 전부 클라이언트
--   engine(src/lib/streamingOps)에서 규칙 기반으로 수행 — 여기서는 집계/조회만 제공한다.
--
-- 설계 원칙 (절대):
--   • Additive Only. 신규 테이블 1(rollup) + 신규 RPC 다수. 기존 테이블/RPC/뷰/RLS/데이터 무변경.
--     0460 의 streaming_quality_events / _sqe_aggregate / ingest 등은 재정의하지 않는다(READ만).
--   • Production Apply 금지. Preview / rollback-txn 검증 전용.
--   • Player/Queue/Playback/Crossfade/Recovery/Scheduler/Audio 변경 없음 — 순수 조회.
--   • Security Definer + _is_super_admin() 관리자 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL
--     없음) + allowlist + row/bucket 상한. store 원문/URL/트랙 제목/UA/토큰 미노출(hash·code만).
--   • rollup 은 raw 고빈도 event 를 시간 bucket 으로 접어 장기 보존 비용을 낮춘다(cost-aware).

-- ─────────────────────────────────────────────────────────────────────
-- 1) 장기 보존 rollup 창고 (신규 · 유일한 쓰기 대상). raw→hour/day rollup.
--    prior art 없음(신규 패턴): 기존 고빈도 테이블은 purge_* 만 있었다 — 여기서 rollup 을 신설.
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.streaming_quality_rollup (
  granularity   text not null check (granularity in ('hour','day')),
  bucket_start  timestamptz not null,
  store_id      uuid not null,
  release       text not null default 'unknown',
  environment   text not null default 'unknown',
  browser       text not null default 'other',
  os            text not null default 'other',
  device_class  text not null default 'unknown',
  sessions              int not null default 0,
  start_success         int not null default 0,
  start_failed          int not null default 0,
  ttfa_p75              int,
  ttfa_samples          int not null default 0,
  crossfade_completed   int not null default 0,
  crossfade_fallback    int not null default 0,
  crossfade_aborted     int not null default 0,
  stall_sessions        int not null default 0,
  media_error_sessions  int not null default 0,
  media_error_events    int not null default 0,
  preload_ready         int not null default 0,
  preload_failed        int not null default 0,
  recovery_attempted    int not null default 0,
  recovery_succeeded    int not null default 0,
  recovery_failed       int not null default 0,
  rolled_at     timestamptz not null default now(),
  primary key (granularity, bucket_start, store_id, release, environment, browser, os, device_class)
);
comment on table public.streaming_quality_rollup is
  'WEB-OBS-8 raw streaming_quality_events 의 hour/day rollup(cost-aware 장기 보존). 파생·집계 전용. 원문 PII 미저장. purge 대상.';
create index if not exists sqr_gran_bucket_idx on public.streaming_quality_rollup (granularity, bucket_start);
create index if not exists sqr_release_idx     on public.streaming_quality_rollup (release, bucket_start);

alter table public.streaming_quality_rollup enable row level security;
alter table public.streaming_quality_rollup force row level security;
drop policy if exists sqr_super_admin_read on public.streaming_quality_rollup;
create policy sqr_super_admin_read on public.streaming_quality_rollup
  for select using (public._is_super_admin());
revoke insert, update, delete on public.streaming_quality_rollup from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2) 일반화된 집계 helper — 임의 필터(env/release/store/browser/os/device) + 시간범위 →
--    0460 _sqe_aggregate 와 동일한 JSON shape 반환(클라이언트 rowToAggregate 재사용). SELECT only.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._sqe_agg_scope(
  p_scope text, p_since timestamptz, p_until timestamptz,
  p_env text, p_release text, p_store uuid, p_browser text, p_os text, p_device text
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with scope as (
    select * from public.streaming_quality_events e
    where e.received_at >= p_since and e.received_at < p_until
      and (p_env is null or e.environment = p_env)
      and (p_release is null or e.release = p_release)
      and (p_store is null or e.store_id = p_store)
      and (p_browser is null or e.browser = p_browser)
      and (p_os is null or e.os = p_os)
      and (p_device is null or e.device_class = p_device)
  )
  select jsonb_build_object(
    'scope', p_scope,
    'sessions', (select count(distinct player_session_id) from scope),
    'stores', (select count(distinct store_id) from scope),
    'startSuccess', (select count(distinct player_session_id) from scope where event_type='first_progress'),
    'startFailed',  (select count(distinct player_session_id) from scope where event_type='media_error'),
    'startAbandoned', 0,
    'startRequests', (select count(distinct player_session_id) from scope where event_type in ('first_progress','media_error')),
    'ttfaP50', (select round(percentile_cont(0.50) within group (order by duration_ms) filter (where event_type='first_progress' and duration_ms is not null)) from scope),
    'ttfaP75', (select round(percentile_cont(0.75) within group (order by duration_ms) filter (where event_type='first_progress' and duration_ms is not null)) from scope),
    'ttfaP95', (select round(percentile_cont(0.95) within group (order by duration_ms) filter (where event_type='first_progress' and duration_ms is not null)) from scope),
    'ttfaSamples', (select count(*) from scope where event_type='first_progress' and duration_ms is not null),
    'crossfadeCompleted', (select count(*) from scope where event_type='crossfade_completed'),
    'crossfadeFallback', (select count(*) from scope where event_type='crossfade_fallback'),
    'crossfadeAborted', (select count(*) from scope where event_type='crossfade_aborted'),
    'crossfadeApplicable', (select count(*) > 0 from scope where event_type like 'crossfade_%'),
    'stallSessions', (select count(distinct player_session_id) from scope where event_type in ('recovery_attempted','recovery_failed') and reason in ('stalled','neither-playing','crossfade-stuck')),
    'mediaErrorSessions', (select count(distinct player_session_id) from scope where event_type='media_error'),
    'mediaErrorEvents', (select count(*) from scope where event_type='media_error'),
    'mediaErrorByCode', coalesce((select jsonb_object_agg(coalesce(media_code::text,'0'), c) from (select media_code, count(*) c from scope where event_type='media_error' group by media_code) t), '{}'::jsonb),
    'preloadReady', (select count(*) from scope where event_type='preload_ready'),
    'preloadFailed', (select count(*) from scope where event_type='preload_failed'),
    'recoveryAttempted', (select count(*) from scope where event_type='recovery_attempted'),
    'recoverySucceeded', (select count(*) from scope where event_type='recovery_succeeded'),
    'recoveryFailed', (select count(*) from scope where event_type='recovery_failed')
  );
$$;
revoke execute on function public._sqe_agg_scope(text,timestamptz,timestamptz,text,text,uuid,text,text,text) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Cost-aware rollup — raw event → hour/day bucket 집계 저장(upsert). service_role 전용.
--    (Preview/rollback-txn 에서만 실행. 스케줄러 없음 — 수동/배치 호출 가정.)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.rollup_streaming_quality(p_granularity text default 'hour', p_since_days int default 2)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_gran text := case when p_granularity = 'day' then 'day' else 'hour' end;
  v_since timestamptz := now() - make_interval(days => greatest(coalesce(p_since_days,2),1));
  v_rows bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  insert into public.streaming_quality_rollup as r (
    granularity, bucket_start, store_id, release, environment, browser, os, device_class,
    sessions, start_success, start_failed, ttfa_p75, ttfa_samples,
    crossfade_completed, crossfade_fallback, crossfade_aborted, stall_sessions,
    media_error_sessions, media_error_events, preload_ready, preload_failed,
    recovery_attempted, recovery_succeeded, recovery_failed)
  select
    v_gran, date_trunc(v_gran, e.received_at), e.store_id, e.release, e.environment, e.browser, e.os, e.device_class,
    count(distinct e.player_session_id),
    count(distinct e.player_session_id) filter (where e.event_type='first_progress'),
    count(distinct e.player_session_id) filter (where e.event_type='media_error'),
    round(percentile_cont(0.75) within group (order by e.duration_ms) filter (where e.event_type='first_progress' and e.duration_ms is not null))::int,
    count(*) filter (where e.event_type='first_progress' and e.duration_ms is not null),
    count(*) filter (where e.event_type='crossfade_completed'),
    count(*) filter (where e.event_type='crossfade_fallback'),
    count(*) filter (where e.event_type='crossfade_aborted'),
    count(distinct e.player_session_id) filter (where e.event_type in ('recovery_attempted','recovery_failed') and e.reason in ('stalled','neither-playing','crossfade-stuck')),
    count(distinct e.player_session_id) filter (where e.event_type='media_error'),
    count(*) filter (where e.event_type='media_error'),
    count(*) filter (where e.event_type='preload_ready'),
    count(*) filter (where e.event_type='preload_failed'),
    count(*) filter (where e.event_type='recovery_attempted'),
    count(*) filter (where e.event_type='recovery_succeeded'),
    count(*) filter (where e.event_type='recovery_failed')
  from public.streaming_quality_events e
  where e.received_at >= v_since
  group by 1,2,3,4,5,6,7,8
  on conflict (granularity, bucket_start, store_id, release, environment, browser, os, device_class)
  do update set
    sessions = excluded.sessions, start_success = excluded.start_success, start_failed = excluded.start_failed,
    ttfa_p75 = excluded.ttfa_p75, ttfa_samples = excluded.ttfa_samples,
    crossfade_completed = excluded.crossfade_completed, crossfade_fallback = excluded.crossfade_fallback,
    crossfade_aborted = excluded.crossfade_aborted, stall_sessions = excluded.stall_sessions,
    media_error_sessions = excluded.media_error_sessions, media_error_events = excluded.media_error_events,
    preload_ready = excluded.preload_ready, preload_failed = excluded.preload_failed,
    recovery_attempted = excluded.recovery_attempted, recovery_succeeded = excluded.recovery_succeeded,
    recovery_failed = excluded.recovery_failed, rolled_at = now();

  get diagnostics v_rows = row_count;
  return jsonb_build_object('ok', true, 'granularity', v_gran, 'rolled', v_rows, 'since', v_since);
end;
$$;
revoke execute on function public.rollup_streaming_quality(text,int) from public, authenticated, anon;
do $$ begin
  begin grant execute on function public.rollup_streaming_quality(text,int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- Tiered retention purge for the rollup warehouse (raw purge lives in 0460). service_role only.
create or replace function public.purge_streaming_quality_rollup(p_hour_days int default 90, p_day_days int default 365)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_h bigint; v_d bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  delete from public.streaming_quality_rollup where granularity='hour' and bucket_start < now() - make_interval(days => greatest(coalesce(p_hour_days,90),1));
  get diagnostics v_h = row_count;
  delete from public.streaming_quality_rollup where granularity='day' and bucket_start < now() - make_interval(days => greatest(coalesce(p_day_days,365),1));
  get diagnostics v_d = row_count;
  return jsonb_build_object('ok', true, 'hour_deleted', v_h, 'day_deleted', v_d);
end;
$$;
revoke execute on function public.purge_streaming_quality_rollup(int,int) from public, authenticated, anon;
do $$ begin
  begin grant execute on function public.purge_streaming_quality_rollup(int,int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Matrix — browser / device / os 별 aggregate(각 cell = _sqe_agg_scope). 판정은 클라이언트.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_matrix(
  p_dimension text, p_window text default '24h', p_environment text default null, p_release text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_now timestamptz := now();
  v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_rel text := nullif(btrim(coalesce(p_release,'')),'');
  v_dim text := lower(coalesce(p_dimension,'browser'));
  v_col text; v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_dim not in ('browser','device','os') then raise exception 'invalid dimension'; end if;
  v_col := case v_dim when 'device' then 'device_class' else v_dim end;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := v_now - public._obs_window_interval(p_window);

  select jsonb_build_object('ok', true, 'dimension', v_dim,
    'cells', coalesce((
      select jsonb_agg(
        public._sqe_agg_scope(dv.val, v_since, v_now, v_env, v_rel, null,
          case when v_col='browser' then dv.val else null end,
          case when v_col='os' then dv.val else null end,
          case when v_col='device_class' then dv.val else null end)
        order by dv.val)
      from (
        select distinct (case v_col when 'browser' then browser when 'os' then os else device_class end) as val
        from public.streaming_quality_events
        where received_at >= v_since and (v_env is null or environment=v_env) and (v_rel is null or release=v_rel)
        limit 12
      ) dv
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_matrix(text,text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_matrix(text,text,text,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Time-series — 시간 bucket 별 aggregate(예측·추세용). bucket 수 상한. 판정은 클라이언트.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_timeseries(
  p_window text default '24h', p_bucket_minutes int default 60,
  p_environment text default null, p_release text default null, p_store uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_now timestamptz := now();
  v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_rel text := nullif(btrim(coalesce(p_release,'')),'');
  v_step int := least(greatest(coalesce(p_bucket_minutes,60),5),1440);
  v_result jsonb; v_count int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := v_now - public._obs_window_interval(p_window);
  -- bucket 수 상한(≤300): step 을 필요시 확대
  v_count := ceil(extract(epoch from (v_now - v_since)) / (v_step*60))::int;
  if v_count > 300 then v_step := ceil(extract(epoch from (v_now - v_since)) / (300*60) / 60)*60; end if;

  select jsonb_build_object('ok', true, 'bucket_minutes', v_step,
    'buckets', coalesce((
      select jsonb_agg(
        public._sqe_agg_scope(to_char(gs, 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), gs, gs + make_interval(mins => v_step),
          v_env, v_rel, p_store, null, null, null)
        order by gs)
      from generate_series(date_trunc('minute', v_since), v_now, make_interval(mins => v_step)) gs
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_timeseries(text,int,text,text,uuid) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_timeseries(text,int,text,text,uuid) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Replay — store(또는 session) 별 PII-free event 행 시간순. root-cause 도 동일 소스.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_replay(
  p_store uuid, p_session text default null, p_window text default '24h', p_limit int default 300
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._obs_window_interval(p_window);
  v_limit int := least(greatest(coalesce(p_limit,300),1),500);
  v_sess text := nullif(btrim(coalesce(p_session,'')),'');
  v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store is null then raise exception 'store required'; end if;
  select jsonb_build_object('ok', true, 'store', p_store,
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'eventType', e.event_type, 'occurredAt', e.occurred_at,
        'receivedAt', to_char(e.received_at,'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'sessionId', e.player_session_id, 'trackHash', e.current_track_hash,
        'durationMs', e.duration_ms, 'outcome', e.outcome, 'reason', e.reason,
        'mediaCode', e.media_code, 'networkState', e.network_state, 'readyState', e.ready_state,
        'browser', e.browser, 'release', e.release) order by e.received_at, e.sequence)
      from (
        select * from public.streaming_quality_events
        where store_id = p_store and received_at >= v_since and (v_sess is null or player_session_id = v_sess)
        order by received_at desc, sequence desc limit v_limit
      ) e
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_replay(uuid,text,text,int) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_replay(uuid,text,text,int) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) Fleet replay — 시간 bucket 별 store 상태(healthy/waiting/recovering/error) 카운트.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_fleet_replay(
  p_window text default '24h', p_bucket_minutes int default 5, p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._obs_window_interval(p_window);
  v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_step int := least(greatest(coalesce(p_bucket_minutes,5),5),60);
  v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;

  with e as (
    select store_id, date_trunc('minute', received_at)
             - make_interval(mins => (extract(minute from received_at)::int % v_step)) as bkt,
           event_type, reason
    from public.streaming_quality_events
    where received_at >= v_since and (v_env is null or environment = v_env)
  ),
  per_store as (
    select bkt, store_id,
      bool_or(event_type='media_error') as has_error,
      bool_or(event_type in ('recovery_attempted','recovery_failed')) as has_recovery,
      bool_or(event_type in ('recovery_attempted','recovery_failed') and reason in ('stalled','neither-playing','crossfade-stuck')) as has_wait
    from e group by bkt, store_id
  ),
  per_bucket as (
    select bkt,
      count(*) as total,
      count(*) filter (where has_error) as err,
      count(*) filter (where not has_error and has_recovery) as recovering,
      count(*) filter (where not has_error and not has_recovery and has_wait) as waiting,
      count(*) filter (where not has_error and not has_recovery and not has_wait) as healthy
    from per_store group by bkt
  )
  select jsonb_build_object('ok', true, 'bucket_minutes', v_step,
    'snapshots', coalesce((
      select jsonb_agg(jsonb_build_object(
        'bucketStart', to_char(bkt,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
        'total', total, 'healthy', healthy, 'waiting', waiting, 'recovering', recovering, 'error', err)
        order by bkt)
      from (select * from per_bucket order by bkt desc limit 288) s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_fleet_replay(text,int,text) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_fleet_replay(text,int,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 8) Enterprise heatmap — store_id → franchise_stores → franchises 로 브랜드별 aggregate.
--    매핑(franchise_stores) 이 없는 store 는 제외. 매핑 0건이면 rows=[] → 클라이언트가 NOT_AVAILABLE.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_enterprise(
  p_window text default '24h', p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz := now() - public._obs_window_interval(p_window);
  v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;

  select jsonb_build_object('ok', true,
    'brands', coalesce((
      select jsonb_agg(jsonb_build_object(
        'brand', b.name,
        'stores', b.store_cnt,
        'aggregate', public._sqe_agg_scope(b.name, v_since, now(), v_env, null, null, null, null, null)
      ) order by b.name)
      from (
        select f.name, count(distinct fs.store_id) as store_cnt
        from public.franchise_stores fs
        join public.franchises f on f.id = fs.franchise_id
        where fs.status = 'active'
          and exists (
            select 1 from public.streaming_quality_events e
            where e.store_id = fs.store_id and e.received_at >= v_since and (v_env is null or e.environment = v_env)
          )
        group by f.name
        limit 200
      ) b
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_enterprise(text,text) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_enterprise(text,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_streaming_quality_enterprise(text,text);
--   drop function if exists public.admin_streaming_quality_fleet_replay(text,int,text);
--   drop function if exists public.admin_streaming_quality_replay(uuid,text,text,int);
--   drop function if exists public.admin_streaming_quality_timeseries(text,int,text,text,uuid);
--   drop function if exists public.admin_streaming_quality_matrix(text,text,text,text);
--   drop function if exists public.purge_streaming_quality_rollup(int,int);
--   drop function if exists public.rollup_streaming_quality(text,int);
--   drop function if exists public._sqe_agg_scope(text,timestamptz,timestamptz,text,text,uuid,text,text,text);
--   drop table if exists public.streaming_quality_rollup;
-- 신규(0461) 테이블 1(rollup) + 함수 8. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/0460 영향 없음.
-- streaming_quality_events / playback_events_v2 / franchise_stores / franchises 는 READ-ONLY 참조만.
