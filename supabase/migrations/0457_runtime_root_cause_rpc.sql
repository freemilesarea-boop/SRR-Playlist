-- 0457 — Phase WEB-OBS-4: Root Cause Analysis & Rollback Advisor — Root Cause RPC
--
-- 목적:
--   Incident의 "왜 발생했는가"를 규칙 기반으로 분석하기 위해, 후보(candidate)와 기준(baseline)
--   릴리스의 오류 프로파일(브라우저/타입/라우트 교차 집계 포함)과 최근 릴리스 타임라인을 한 번에
--   반환한다. Root Cause / Correlation / Rollback Advisor / Timeline / Explanation / Service Graph
--   판정은 모두 클라이언트 순수 로직(src/lib/observability/rootCause.ts, 단위 테스트)이 담당한다.
--   Commit 내용은 조회하지 않는다 — release(=build id) ↔ metric 변화만 상관한다.
--
-- 설계 원칙 (절대):
--   • Additive Only. CREATE FUNCTION 1종 뿐. 기존 테이블/RPC/뷰/인덱스/RLS 무변경(0454~0456 불변).
--   • Production Apply 금지. Preview/rollback-txn 검증 전용. SELECT only — 원본 데이터 변경 없음.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL 없음).
--   • window/environment allowlist. Breakdown/timeline 행 상한. Raw payload 전량 반환 금지(집계값만).
--   • sanitized route/message 기반 집계만 노출. Commit message/원문/토큰 노출 없음.

create or replace function public.admin_root_cause(
  p_window            text default '7d',
  p_release_candidate text default null,
  p_release_baseline  text default null,
  p_environment       text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since     timestamptz;
  v_env       text := nullif(btrim(coalesce(p_environment, '')), '');
  v_candidate text := nullif(btrim(coalesce(p_release_candidate, '')), '');
  v_baseline  text := nullif(btrim(coalesce(p_release_baseline, '')), '');
  v_result    jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then
    v_env := null;
  end if;
  v_since := now() - public._obs_window_interval(p_window);

  if v_candidate is null or v_baseline is null then
    with top as (
      select release, max(received_at) mx, count(*) c
      from public.runtime_telemetry_events
      where received_at >= v_since and (v_env is null or environment = v_env) and release <> 'unknown'
      group by release order by max(received_at) desc, count(*) desc limit 2
    ), ranked as (select release, row_number() over (order by mx desc) rn from top)
    select
      coalesce(v_candidate, (select release from ranked where rn = 1)),
      coalesce(v_baseline,  (select release from ranked where rn = 2))
    into v_candidate, v_baseline;
  end if;

  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'7d'), 'since', v_since,
    'candidate', v_candidate, 'baseline', v_baseline,
    'profiles', coalesce((
      select jsonb_object_agg(rel, prof) from (
        select r as rel, public._rc_release_profile(r, v_since, v_env) as prof
        from (select v_candidate as r where v_candidate is not null
              union select v_baseline where v_baseline is not null) rr
      ) p
    ), '{}'::jsonb),
    'timeline', coalesce((
      select jsonb_agg(t order by (t->>'first_seen') desc) from (
        select jsonb_build_object(
                 'release', release, 'first_seen', min(received_at), 'last_seen', max(received_at),
                 'sessions', count(distinct session_id), 'events', count(*),
                 'error_events', count(*) filter (where event_type='error'),
                 'chunk_sessions', count(distinct session_id) filter (where event_type='error' and payload->>'kind'='chunk-load')
               ) as t
        from public.runtime_telemetry_events e
        where e.received_at >= v_since and (v_env is null or e.environment = v_env) and release <> 'unknown'
        group by release order by max(received_at) desc limit 30
      ) tl
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- 릴리스별 오류 프로파일 헬퍼(security definer 함수 내부에서만 호출; 자체 게이트는 상위 RPC가 담당).
create or replace function public._rc_release_profile(p_release text, p_since timestamptz, p_env text)
returns jsonb
language sql
stable
set search_path = public
as $$
  with scope as (
    select * from public.runtime_telemetry_events e
    where e.received_at >= p_since and (p_env is null or e.environment = p_env) and e.release = p_release
  )
  select jsonb_build_object(
    'release', p_release,
    'sessions', (select count(distinct session_id) from scope),
    'events', (select count(*) from scope),
    'browsers', (select count(distinct browser_family) from scope),
    'error_sessions', (select count(distinct session_id) from scope where event_type='error'),
    'error_events', (select count(*) from scope where event_type='error'),
    'critical_events', (select count(*) from scope where event_type='error' and severity='critical'),
    'chunk_sessions', (select count(distinct session_id) from scope where event_type='error' and payload->>'kind'='chunk-load'),
    'hydration_sessions', (select count(distinct session_id) from scope where event_type='error' and payload->>'kind'='react' and (payload->>'message') ~* 'hydrat|did not match|does not match'),
    'memory_risk_sessions', (select count(distinct session_id) from scope where event_type='memory' and (payload->>'limitMb') ~ '^[0-9.]+$' and (payload->>'usedMb') ~ '^[0-9.]+$' and (payload->>'limitMb')::numeric>0 and (payload->>'usedMb')::numeric/(payload->>'limitMb')::numeric>=0.9),
    'long_task_events', (select count(*) from scope where event_type='longtask'),
    'api_p95', (select round(percentile_cont(0.95) within group (order by duration_ms)::numeric) from scope where event_type='api' and duration_ms is not null),
    'lcp_p75', (select round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric)::numeric,3) from scope where event_type='vital' and payload->>'name'='LCP' and (payload->>'value') ~ '^-?[0-9.]+$'),
    'by_browser', coalesce((select jsonb_agg(b order by (b->>'error_sessions')::int desc) from (
        select jsonb_build_object('browser', browser_family,
                 'error_sessions', count(distinct session_id) filter (where event_type='error'),
                 'total_sessions', count(distinct session_id)) as b
        from scope group by browser_family having count(distinct session_id) > 0 limit 10
      ) bb), '[]'::jsonb),
    'by_kind', coalesce((select jsonb_agg(k order by (k->>'sessions')::int desc) from (
        select jsonb_build_object('kind', payload->>'kind',
                 'sessions', count(distinct session_id), 'count', count(*)) as k
        from scope where event_type='error' group by payload->>'kind' limit 10
      ) kk), '[]'::jsonb),
    'by_route', coalesce((select jsonb_agg(r order by (r->>'sessions')::int desc) from (
        select jsonb_build_object('key', route,
                 'sessions', count(distinct session_id), 'count', count(*)) as r
        from scope where event_type='error' group by route order by count(distinct session_id) desc limit 20
      ) rr), '[]'::jsonb)
  );
$$;

revoke execute on function public.admin_root_cause(text,text,text,text) from public;
revoke execute on function public._rc_release_profile(text,timestamptz,text) from public;
do $$ begin
  begin grant execute on function public.admin_root_cause(text,text,text,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_root_cause(text,text,text,text) to service_role;
  exception when undefined_object then null; end;
  -- 헬퍼는 상위 RPC 내부에서만 호출되지만, security-definer 컨텍스트 실행을 위해 service_role/authenticated 에 실행권한 부여(자체 게이트는 상위 RPC).
  begin grant execute on function public._rc_release_profile(text,timestamptz,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public._rc_release_profile(text,timestamptz,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_root_cause(text,text,text,text);
--   drop function if exists public._rc_release_profile(text,timestamptz,text);
-- 신규(0457) SELECT 전용 함수 2개 — 롤백은 순수 DROP FUNCTION. 데이터/스키마/인덱스/RLS 영향 없음.
-- _obs_window_interval(text) 는 0455 에서 생성됨(여기서 재정의/삭제하지 않음).
