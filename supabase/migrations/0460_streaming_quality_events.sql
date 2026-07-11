-- 0460 — Phase WEB-OBS-7: Streaming Quality Intelligence — Player quality events
--
-- 목적:
--   실제 재생 경험 품질(TTFA_APPROX / crossfade outcome / preload / media·decoder error / recovery)
--   을 관측·분석하기 위한 저빈도 outcome-중심 event 채널. 기존 playback_events_v2(0253) 의미는
--   변경하지 않는다(그 테이블은 READ-ONLY 로만 참조 — start funnel 파생용).
--
-- 설계 원칙 (절대):
--   • Additive Only. 신규 테이블 1 + 신규 RPC 5. 기존 테이블/RPC/뷰/RLS 무변경. 0454~0459 불변.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용. 원본 데이터 변경 없음.
--   • Security Definer + auth.uid() 기반 store attribution(스푸핑 차단) + _is_super_admin() 관리자 게이트
--     + search_path 고정 + 파라미터 바인딩(동적 SQL 없음) + allowlist + row/batch 상한.
--   • Raw stack / Audio URL / Track 제목 / Artist / UA 저장 금지. track 은 비가역 hash. duration 은 bounded int.
--   • 고빈도 progress event 저장 안 함 — outcome 중심 저빈도 event 만.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 이벤트 테이블 (신규, additive)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.streaming_quality_events (
  event_id            text primary key,
  store_id            uuid not null,                     -- 서버가 auth.uid() 로 stamp (FK 미설정: purgeable)
  event_type          text not null check (event_type in (
                        'first_progress','crossfade_completed','crossfade_fallback','crossfade_aborted',
                        'preload_ready','preload_failed','media_error',
                        'recovery_attempted','recovery_succeeded','recovery_failed')),
  event_version       int not null default 1,
  player_session_id   text not null check (length(player_session_id) <= 64),
  sequence            int not null default 0,
  occurred_at         bigint not null default 0,
  received_at         timestamptz not null default now(),
  release             text not null default 'unknown' check (length(release) <= 64),
  environment         text not null default 'unknown' check (environment in ('production','preview','development','unknown')),
  route               text not null default 'individual' check (length(route) <= 16),
  browser             text not null default 'other' check (length(browser) <= 16),
  os                  text not null default 'other' check (length(os) <= 16),
  device_class        text not null default 'unknown' check (device_class in ('mobile','tablet','desktop','unknown')),
  visibility_state    text not null default 'unknown' check (visibility_state in ('visible','hidden','unknown')),
  business_mode       boolean not null default false,
  current_track_hash  text check (current_track_hash is null or length(current_track_hash) <= 16),
  duration_ms         int check (duration_ms is null or (duration_ms >= 0 and duration_ms <= 3600000)),
  outcome             text check (outcome is null or outcome in ('success','failed','fallback','aborted','progress')),
  reason              text check (reason is null or length(reason) <= 24),
  media_code          smallint check (media_code is null or (media_code between 0 and 4)),
  network_state       smallint check (network_state is null or (network_state between 0 and 3)),
  ready_state         smallint check (ready_state is null or (ready_state between 0 and 4))
);

comment on table public.streaming_quality_events is
  'WEB-OBS-7 재생 품질 outcome event(time-series). store_id=auth.uid() 서버 검증. playback_events_v2와 분리. purge 대상. 원문 PII/트랙/URL/토큰 미저장.';

create index if not exists sqe_received_idx     on public.streaming_quality_events (received_at);
create index if not exists sqe_store_time_idx   on public.streaming_quality_events (store_id, received_at desc);
create index if not exists sqe_session_seq_idx  on public.streaming_quality_events (player_session_id, sequence);
create index if not exists sqe_type_time_idx    on public.streaming_quality_events (event_type, received_at);
create index if not exists sqe_release_time_idx on public.streaming_quality_events (release, received_at);
create index if not exists sqe_error_idx        on public.streaming_quality_events (media_code, received_at) where event_type = 'media_error';

alter table public.streaming_quality_events enable row level security;
alter table public.streaming_quality_events force row level security;

drop policy if exists sqe_super_admin_read on public.streaming_quality_events;
create policy sqe_super_admin_read on public.streaming_quality_events
  for select using (public._is_super_admin());

revoke insert, update, delete on public.streaming_quality_events from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Ingestion RPC — 인증 세션. store_id = auth.uid() 서버 검증(스푸핑 차단).
--    (개인/매장 사용자 모두 quality event 를 남길 수 있음 — 매장 여부는 조회 시 판별)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.ingest_streaming_quality_events(
  p_events jsonb,
  p_store_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_store    uuid := coalesce(p_store_id, auth.uid());
  v_is_admin boolean := public._is_super_admin();
  v_accepted int := 0;
begin
  if v_store is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  if v_store <> auth.uid() and not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'forbidden: store mismatch');
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'events_required');
  end if;

  with incoming as (
    select e, ord from jsonb_array_elements(p_events) with ordinality as t(e, ord) where ord <= 40
  ),
  clean as (
    select
      left(coalesce(e->>'event_id',''), 64)                      as event_id,
      lower(coalesce(e->>'event_type',''))                       as event_type,
      left(coalesce(e->>'player_session_id',''), 64)             as player_session_id,
      coalesce((e->>'sequence')::int, 0)                         as sequence,
      coalesce((e->>'occurred_at')::bigint, 0)                   as occurred_at,
      left(coalesce(e->>'release','unknown'), 64)                as release,
      lower(coalesce(e->>'environment','unknown'))               as environment,
      left(lower(coalesce(e->>'route','individual')), 16)        as route,
      left(lower(coalesce(e->>'browser','other')), 16)           as browser,
      left(lower(coalesce(e->>'os','other')), 16)                as os,
      lower(coalesce(e->>'device_class','unknown'))              as device_class,
      lower(coalesce(e->>'visibility_state','unknown'))          as visibility_state,
      coalesce((e->>'business_mode')::boolean, false)            as business_mode,
      nullif(left(coalesce(e->>'current_track_hash',''), 16), '') as current_track_hash,
      least(greatest(coalesce((e->>'duration_ms')::int, 0), 0), 3600000) as duration_ms,
      nullif(lower(coalesce(e->>'outcome','')), '')              as outcome,
      left(lower(coalesce(e->>'reason','')), 24)                 as reason,
      (e->>'media_code')::int                                    as media_code,
      (e->>'network_state')::int                                 as network_state,
      (e->>'ready_state')::int                                   as ready_state
    from incoming
  ),
  ins as (
    insert into public.streaming_quality_events (
      event_id, store_id, event_type, event_version, player_session_id, sequence, occurred_at,
      release, environment, route, browser, os, device_class, visibility_state, business_mode,
      current_track_hash, duration_ms, outcome, reason, media_code, network_state, ready_state)
    select
      c.event_id, v_store, c.event_type, 1, c.player_session_id, c.sequence, c.occurred_at,
      c.release,
      case when c.environment in ('production','preview','development','unknown') then c.environment else 'unknown' end,
      c.route, c.browser, c.os,
      case when c.device_class in ('mobile','tablet','desktop','unknown') then c.device_class else 'unknown' end,
      case when c.visibility_state in ('visible','hidden','unknown') then c.visibility_state else 'unknown' end,
      c.business_mode, c.current_track_hash, c.duration_ms,
      case when c.outcome in ('success','failed','fallback','aborted','progress') then c.outcome else null end,
      nullif(c.reason, ''),
      case when c.media_code between 0 and 4 then c.media_code::smallint else null end,
      case when c.network_state between 0 and 3 then c.network_state::smallint else null end,
      case when c.ready_state between 0 and 4 then c.ready_state::smallint else null end
    from clean c
    where c.event_id <> '' and c.player_session_id <> ''
      and c.event_type in ('first_progress','crossfade_completed','crossfade_fallback','crossfade_aborted',
                           'preload_ready','preload_failed','media_error',
                           'recovery_attempted','recovery_succeeded','recovery_failed')
    on conflict (event_id) do nothing
    returning 1
  )
  select count(*) into v_accepted from ins;

  return jsonb_build_object('ok', true, 'accepted', v_accepted);
end;
$$;

revoke execute on function public.ingest_streaming_quality_events(jsonb, uuid) from public;
do $$ begin
  begin grant execute on function public.ingest_streaming_quality_events(jsonb, uuid) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.ingest_streaming_quality_events(jsonb, uuid) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) 내부 helper — 필터된 event 집합 → QualityAggregate-shaped jsonb (SELECT only)
--    scope 라벨과 event 조건만 다르게 재사용. 판정(score/regression/incident)은 클라이언트 engine.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._sqe_aggregate(p_scope text, p_since timestamptz, p_env text, p_release text, p_store uuid)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  with scope as (
    select * from public.streaming_quality_events e
    where e.received_at >= p_since
      and (p_env is null or e.environment = p_env)
      and (p_release is null or e.release = p_release)
      and (p_store is null or e.store_id = p_store)
  )
  select jsonb_build_object(
    'scope', p_scope,
    'sessions', (select count(distinct player_session_id) from scope),
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
revoke execute on function public._sqe_aggregate(text,timestamptz,text,text,uuid) from public, authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Admin overview — overall + per-release aggregates + pev2 start funnel(window, read-only).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_overview(
  p_window      text default '24h',
  p_environment text default null,
  p_release     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz;
  v_env   text := nullif(btrim(coalesce(p_environment,'')),'');
  v_rel   text := nullif(btrim(coalesce(p_release,'')),'');
  v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := now() - public._obs_window_interval(p_window);

  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'24h'), 'now', now(),
    'overall', public._sqe_aggregate('FLEET', v_since, v_env, v_rel, null),
    'by_release', coalesce((
      select jsonb_agg(public._sqe_aggregate(rel, v_since, v_env, rel, null) order by rel)
      from (select distinct release rel from public.streaming_quality_events
            where received_at >= v_since and (v_env is null or environment = v_env) limit 50) r
    ), '[]'::jsonb),
    -- pev2 start funnel (window-level, read-only; release 미보유이므로 fleet 단위로만 제공)
    'pev2_start_funnel', (
      with pv as (
        select session_id, track_id,
          bool_or(event_type='play_start') as started,
          bool_or(event_type in ('play_25','play_50','play_75','play_complete')) as progressed,
          bool_or(event_type='player_error') as errored
        from public.playback_events_v2
        where created_at >= v_since group by session_id, track_id
      )
      select jsonb_build_object(
        'requests', (select count(*) from pv where started),
        'success', (select count(*) from pv where started and progressed),
        'failed', (select count(*) from pv where started and errored and not progressed),
        'abandoned', (select count(*) from pv where started and not progressed and not errored)
      )
    )
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_overview(text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_overview(text,text,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Admin per-store aggregates (business account 한정 표시는 클라이언트/조인에서).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_stores(
  p_window text default '24h', p_environment text default null, p_limit int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_limit int := least(greatest(coalesce(p_limit,200),1),500); v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := now() - public._obs_window_interval(p_window);
  select jsonb_build_object(
    'ok', true,
    'stores', coalesce((
      select jsonb_agg(public._sqe_aggregate(s.store_id::text, v_since, v_env, null, s.store_id))
      from (
        select store_id from public.streaming_quality_events
        where received_at >= v_since and (v_env is null or environment = v_env)
        group by store_id order by count(*) desc limit v_limit
      ) s
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_stores(text,text,int) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_stores(text,text,int) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Admin media-error breakdown (code × browser × device × release).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_streaming_quality_errors(
  p_window text default '24h', p_environment text default null, p_limit int default 200
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_env text := nullif(btrim(coalesce(p_environment,'')),'');
  v_limit int := least(greatest(coalesce(p_limit,200),1),500); v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := now() - public._obs_window_interval(p_window);
  select jsonb_build_object(
    'ok', true,
    'by_code', coalesce((select jsonb_object_agg(coalesce(media_code::text,'0'), c) from (select media_code, count(*) c from public.streaming_quality_events where received_at >= v_since and event_type='media_error' and (v_env is null or environment=v_env) group by media_code) t), '{}'::jsonb),
    'by_browser', coalesce((select jsonb_object_agg(browser, c) from (select browser, count(*) c from public.streaming_quality_events where received_at >= v_since and event_type='media_error' and (v_env is null or environment=v_env) group by browser) t), '{}'::jsonb),
    'by_release', coalesce((select jsonb_object_agg(release, c) from (select release, count(*) c from public.streaming_quality_events where received_at >= v_since and event_type='media_error' and (v_env is null or environment=v_env) group by release) t), '{}'::jsonb),
    'total', (select count(*) from public.streaming_quality_events where received_at >= v_since and event_type='media_error' and (v_env is null or environment=v_env)),
    'limit', v_limit
  ) into v_result;
  return v_result;
end;
$$;
revoke execute on function public.admin_streaming_quality_errors(text,text,int) from public;
do $$ begin
  begin grant execute on function public.admin_streaming_quality_errors(text,text,int) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) Retention purge — outcome event 단기 보존(기본 30일). service_role 전용.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.purge_streaming_quality_events(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_days int := greatest(coalesce(p_days, 30), 1); v_deleted bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  delete from public.streaming_quality_events where received_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'retain_days', v_days);
end;
$$;
revoke execute on function public.purge_streaming_quality_events(int) from public, authenticated, anon;
do $$ begin
  begin grant execute on function public.purge_streaming_quality_events(int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.purge_streaming_quality_events(int);
--   drop function if exists public.admin_streaming_quality_errors(text,text,int);
--   drop function if exists public.admin_streaming_quality_stores(text,text,int);
--   drop function if exists public.admin_streaming_quality_overview(text,text,text);
--   drop function if exists public._sqe_aggregate(text,timestamptz,text,text,uuid);
--   drop function if exists public.ingest_streaming_quality_events(jsonb,uuid);
--   drop table if exists public.streaming_quality_events;
-- 신규(0460) 테이블 1 + 함수 6. 롤백은 순수 DROP. 기존 데이터/스키마/인덱스/RLS 영향 없음.
-- playback_events_v2 는 READ-ONLY 참조만(의미 변경 없음). _obs_window_interval(0455)/_is_super_admin(0349/0391) 재정의 안 함.
