-- 0455 — Phase WEB-OBS-2: Runtime Observability RPCs (analysis layer over WEB-OBS-1 events)
--
-- 목적:
--   WEB-OBS-1(0454)이 적재한 public.runtime_telemetry_events 위에 "운영 판단용" 집계 RPC 3종을
--   추가한다. 새 테이블/컬럼/인덱스/뷰를 만들지 않고(0454 인덱스로 충분), 기존 스키마를 일절
--   변경하지 않는다. 서버는 저비용 집계값(카운트·세션수·percentile·release별 지표)만 반환하고,
--   Health Score / Regression 분류 / Fingerprint 그룹핑 / Incident 규칙은 클라이언트 순수 로직
--   (src/lib/observability/*)이 담당한다 → RPC는 얇게 유지, 규칙은 단위 테스트로 검증.
--
-- 설계 원칙 (절대):
--   • Additive Only. CREATE FUNCTION 3종 뿐. 기존 테이블/RPC/뷰/인덱스/RLS 무변경.
--   • Production Apply 금지. Preview/rollback-txn 검증 전용. 원본 데이터 변경 없음(SELECT only).
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL 없음).
--   • Filter allowlist(window/release/environment/browser/event_type). Row limit 고정.
--   • Raw payload 전량 반환 금지 — 집계값과 sanitized 대표 필드만.
--   • 0454 인덱스(received_at / release+time / route+time / browser+time / type+time)만 사용.
--
-- 반환 계약: 모든 RPC 는 jsonb 오브젝트. 표본이 적은 경우에도 서버는 "원시 수치+표본수"만 주고,
--   INSUFFICIENT_DATA/NO DATA 판정은 클라이언트가 threshold 로 결정한다(단일 진실원천 = TS 상수).

-- ─────────────────────────────────────────────────────────────────────
-- 공통: window → interval 매핑 헬퍼 (immutable, 문자열 allowlist)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._obs_window_interval(p_window text)
returns interval
language sql
immutable
set search_path = public
as $$
  select case coalesce(p_window, '24h')
    when '1h'  then interval '1 hour'
    when '24h' then interval '24 hours'
    when '7d'  then interval '7 days'
    when '30d' then interval '30 days'
    else interval '24 hours'
  end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- A. admin_observability_overview — Overview 카드용 원시 집계
--    Health Score 입력(총이벤트/세션/오류/critical/chunk세션/hydration세션/slow api·route/
--    long task/vital p75/memory risk 세션) + slow route/api/error 상위 목록.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_observability_overview(
  p_window      text default '24h',
  p_release     text default null,
  p_environment text default null,
  p_browser     text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since   timestamptz;
  v_release text := nullif(btrim(coalesce(p_release, '')), '');
  v_env     text := nullif(btrim(coalesce(p_environment, '')), '');
  v_browser text := nullif(btrim(coalesce(p_browser, '')), '');
  v_result  jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then
    v_env := null;
  end if;
  v_since := now() - public._obs_window_interval(p_window);

  with scope as (
    select *
    from public.runtime_telemetry_events e
    where e.received_at >= v_since
      and (v_release is null or e.release = v_release)
      and (v_env     is null or e.environment = v_env)
      and (v_browser is null or e.browser_family = v_browser)
  ),
  agg as (
    select
      count(*)                                                        as total_events,
      count(distinct session_id)                                      as sessions,
      count(*) filter (where event_type = 'error')                    as error_count,
      count(*) filter (where event_type = 'error' and severity = 'critical') as critical_error_count,
      count(distinct session_id) filter (where event_type = 'error' and payload->>'kind' = 'chunk-load') as chunk_error_sessions,
      count(distinct session_id) filter (
        where event_type = 'error'
          and (payload->>'kind') = 'react'
          and (payload->>'message') ~* 'hydrat|did not match|does not match|react error #(418|423|425)'
      )                                                               as hydration_error_sessions,
      count(*) filter (where event_type = 'api')                      as api_count,
      count(*) filter (where event_type = 'api' and duration_ms >= 1000) as slow_api_count,
      count(*) filter (where event_type = 'route')                   as route_count,
      count(*) filter (where event_type = 'route' and duration_ms >= 3000) as slow_route_count,
      count(*) filter (where event_type = 'longtask')                as long_task_count,
      count(distinct session_id) filter (
        where event_type = 'memory'
          and (payload->>'limitMb') ~ '^[0-9.]+$' and (payload->>'usedMb') ~ '^[0-9.]+$'
          and (payload->>'limitMb')::numeric > 0
          and (payload->>'usedMb')::numeric / (payload->>'limitMb')::numeric >= 0.9
      )                                                               as memory_risk_sessions
    from scope
  ),
  vitals as (
    select jsonb_object_agg(name, stat) as v from (
      select payload->>'name' as name,
             jsonb_build_object(
               'count', count(*),
               'p50', round(percentile_cont(0.5)  within group (order by (payload->>'value')::numeric)::numeric, 3),
               'p75', round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric)::numeric, 3),
               'p95', round(percentile_cont(0.95) within group (order by (payload->>'value')::numeric)::numeric, 3),
               'poor', count(*) filter (where payload->>'rating' = 'poor')
             ) as stat
      from scope
      where event_type = 'vital' and (payload->>'value') ~ '^-?[0-9.]+$'
      group by payload->>'name'
    ) t
  ),
  slow_routes as (
    select coalesce(jsonb_agg(r order by (r->>'p95')::numeric desc nulls last), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'route', route,
               'count', count(*),
               'sessions', count(distinct session_id),
               'p50', round(percentile_cont(0.5)  within group (order by duration_ms)::numeric),
               'p75', round(percentile_cont(0.75) within group (order by duration_ms)::numeric),
               'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric),
               'worst', max(duration_ms)
             ) as r
      from scope where event_type = 'route' and duration_ms is not null
      group by route order by max(duration_ms) desc limit 20
    ) t
  ),
  slow_apis as (
    select coalesce(jsonb_agg(a order by (a->>'p95')::numeric desc nulls last), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'name', payload->>'name', 'kind', payload->>'kind',
               'count', count(*), 'sessions', count(distinct session_id),
               'p50', round(percentile_cont(0.5)  within group (order by duration_ms)::numeric),
               'p75', round(percentile_cont(0.75) within group (order by duration_ms)::numeric),
               'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric),
               'worst', max(duration_ms)
             ) as a
      from scope where event_type = 'api' and duration_ms is not null
      group by payload->>'name', payload->>'kind' order by max(duration_ms) desc limit 20
    ) t
  ),
  long_tasks as (
    select coalesce(jsonb_agg(l order by (l->>'worst')::numeric desc nulls last), '[]'::jsonb) as v from (
      select jsonb_build_object('route', route, 'count', count(*), 'sessions', count(distinct session_id),
                                'worst', max(duration_ms),
                                'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric)) as l
      from scope where event_type = 'longtask' and duration_ms is not null
      group by route order by max(duration_ms) desc limit 20
    ) t
  ),
  releases as (
    select coalesce(jsonb_object_agg(release, c), '{}'::jsonb) as v from (
      select release, count(*) c from scope group by release order by count(*) desc limit 30
    ) t
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window, '24h'), 'since', v_since,
    'totals', (select to_jsonb(agg) from agg),
    'vitals', coalesce((select v from vitals), '{}'::jsonb),
    'slow_routes', (select v from slow_routes),
    'slow_apis', (select v from slow_apis),
    'long_tasks', (select v from long_tasks),
    'releases', (select v from releases)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_observability_overview(text,text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_observability_overview(text,text,text,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_observability_overview(text,text,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. admin_observability_release_compare — 두 릴리스의 metric bundle
--    (릴리스별 sessions/events + rate/percentile). 분류/신뢰도는 클라이언트.
--    release 인자가 없으면 최근 이벤트 기준 상위 2개 release 를 자동 선택.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_observability_release_compare(
  p_window    text default '7d',
  p_release_a text default null,
  p_release_b text default null,
  p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since   timestamptz;
  v_env     text := nullif(btrim(coalesce(p_environment, '')), '');
  v_a       text := nullif(btrim(coalesce(p_release_a, '')), '');
  v_b       text := nullif(btrim(coalesce(p_release_b, '')), '');
  v_result  jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then
    v_env := null;
  end if;
  v_since := now() - public._obs_window_interval(p_window);

  -- 자동 선택: 최근 window 내 이벤트 수 상위 2개 release (b=최신 트래픽, a=그 다음).
  if v_a is null or v_b is null then
    with top as (
      select release, count(*) c, max(received_at) mx
      from public.runtime_telemetry_events
      where received_at >= v_since and (v_env is null or environment = v_env) and release <> 'unknown'
      group by release order by max(received_at) desc, count(*) desc limit 2
    ), ranked as (select release, row_number() over (order by mx desc) rn from top)
    select
      coalesce(v_b, (select release from ranked where rn = 1)),
      coalesce(v_a, (select release from ranked where rn = 2))
    into v_b, v_a;
  end if;

  with base as (
    select * from public.runtime_telemetry_events e
    where e.received_at >= v_since and (v_env is null or e.environment = v_env)
      and e.release in (coalesce(v_a,'\x00'), coalesce(v_b,'\x00'))
  ),
  per_release as (
    select
      release,
      count(*)                                                    as events,
      count(distinct session_id)                                  as sessions,
      count(*) filter (where event_type='error')                  as error_count,
      count(*) filter (where event_type='error' and severity='critical') as critical_count,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='chunk-load') as chunk_sessions,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='react' and (payload->>'message') ~* 'hydrat|did not match|does not match') as hydration_sessions,
      count(*) filter (where event_type='api')                    as api_count,
      count(*) filter (where event_type='api' and duration_ms>=1000) as slow_api_count,
      count(*) filter (where event_type='route')                  as route_count,
      count(*) filter (where event_type='route' and duration_ms>=3000) as slow_route_count,
      count(*) filter (where event_type='longtask')               as long_task_count,
      count(distinct session_id) filter (where event_type='memory' and (payload->>'limitMb') ~ '^[0-9.]+$' and (payload->>'usedMb') ~ '^[0-9.]+$' and (payload->>'limitMb')::numeric>0 and (payload->>'usedMb')::numeric/(payload->>'limitMb')::numeric>=0.9) as memory_risk_sessions,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='LCP' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric, 3) as lcp_p75,
      count(*) filter (where event_type='vital' and payload->>'name'='LCP') as lcp_n,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='INP' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric, 3) as inp_p75,
      count(*) filter (where event_type='vital' and payload->>'name'='INP') as inp_n,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='CLS' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric, 4) as cls_p75,
      count(*) filter (where event_type='vital' and payload->>'name'='CLS') as cls_n,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='TTFB' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric, 3) as ttfb_p75,
      count(*) filter (where event_type='vital' and payload->>'name'='TTFB') as ttfb_n
    from base group by release
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'7d'), 'release_a', v_a, 'release_b', v_b,
    'releases', coalesce((select jsonb_object_agg(release, to_jsonb(per_release)) from per_release), '{}'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_observability_release_compare(text,text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_observability_release_compare(text,text,text,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_observability_release_compare(text,text,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- C. admin_observability_errors — 오류 occurrence 집계(그룹핑은 클라이언트 fingerprint).
--    kind + sanitized message + route + release + browser 별 count/sessions/first·last seen.
--    브라우저별 오류율(전체 대비) 편중 감지를 위한 by_browser 요약 포함.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_observability_errors(
  p_window      text default '24h',
  p_release     text default null,
  p_environment text default null,
  p_browser     text default null,
  p_limit       int  default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since   timestamptz;
  v_release text := nullif(btrim(coalesce(p_release, '')), '');
  v_env     text := nullif(btrim(coalesce(p_environment, '')), '');
  v_browser text := nullif(btrim(coalesce(p_browser, '')), '');
  v_limit   int  := least(greatest(coalesce(p_limit, 100), 1), 300);
  v_result  jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then
    v_env := null;
  end if;
  v_since := now() - public._obs_window_interval(p_window);

  with scope as (
    select * from public.runtime_telemetry_events e
    where e.received_at >= v_since and e.event_type = 'error'
      and (v_release is null or e.release = v_release)
      and (v_env     is null or e.environment = v_env)
      and (v_browser is null or e.browser_family = v_browser)
  ),
  occ as (
    select coalesce(jsonb_agg(o order by (o->>'count')::int desc), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'kind', payload->>'kind',
               'message', payload->>'message',
               'route', route, 'release', release, 'browser', browser_family,
               'severity', severity,
               'count', count(*), 'sessions', count(distinct session_id),
               'first_seen', min(received_at), 'last_seen', max(received_at)
             ) as o
      from scope
      group by payload->>'kind', payload->>'message', route, release, browser_family, severity
      order by count(*) desc limit v_limit
    ) t
  ),
  -- 전체 이벤트 대비 브라우저별 오류율(표본 게이트는 클라이언트). 분모=브라우저 전체 이벤트.
  by_browser as (
    select coalesce(jsonb_agg(b order by (b->>'error_sessions')::int desc), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'browser', t.browser_family,
               'error_events', t.error_events,
               'error_sessions', t.error_sessions,
               'total_events', t.total_events,
               'total_sessions', t.total_sessions
             ) as b
      from (
        select browser_family,
               count(*) filter (where event_type='error') as error_events,
               count(distinct session_id) filter (where event_type='error') as error_sessions,
               count(*) as total_events,
               count(distinct session_id) as total_sessions
        from public.runtime_telemetry_events e
        where e.received_at >= v_since
          and (v_release is null or e.release = v_release)
          and (v_env is null or e.environment = v_env)
        group by browser_family
      ) t
      where t.total_events > 0
    ) s
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'24h'), 'since', v_since,
    'occurrences', (select v from occ),
    'by_browser', (select v from by_browser)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_observability_errors(text,text,text,text,int) from public;
do $$ begin
  begin grant execute on function public.admin_observability_errors(text,text,text,text,int) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_observability_errors(text,text,text,text,int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_observability_errors(text,text,text,text,int);
--   drop function if exists public.admin_observability_release_compare(text,text,text,text);
--   drop function if exists public.admin_observability_overview(text,text,text,text);
--   drop function if exists public._obs_window_interval(text);
-- 모든 객체가 신규(0455)이며 SELECT 전용 — 롤백은 순수 DROP FUNCTION, 데이터/스키마 영향 없음.
-- 신규 인덱스/테이블/RLS 변경 없음(0454 인덱스만 사용).
