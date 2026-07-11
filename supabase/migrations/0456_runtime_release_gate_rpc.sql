-- 0456 — Phase WEB-OBS-3: Predictive Regression Engine — Release Gate RPC
--
-- 목적:
--   배포 전 "이번 Release는 위험한가?"를 판단하는 Release Gate 를 위해, 후보(candidate)와 기준
--   (baseline) 두 릴리스의 gate-focused metric bundle + 최근 릴리스 목록을 한 번에 반환하는 조회
--   RPC 1종을 추가한다. Release Quality Score / Deployment Readiness / Performance Budget /
--   Regression Budget / Release Gate 판정은 모두 클라이언트 순수 로직(src/lib/observability/
--   releaseQuality.ts, 단위 테스트)이 담당한다 → RPC는 얇게 유지, 규칙은 TS 상수 단일 진실원천.
--
-- 설계 원칙 (절대):
--   • Additive Only. CREATE FUNCTION 1종 뿐. 기존 테이블/RPC/뷰/인덱스/RLS 무변경(0454/0455 불변).
--   • Production Apply 금지. Preview/rollback-txn 검증 전용. SELECT only — 원본 데이터 변경 없음.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL 없음).
--   • window/environment allowlist. Release 목록 상한 30. Raw payload 전량 반환 금지(집계값만).
--   • 0454 인덱스(received_at / release+time / …)만 사용. 신규 인덱스 없음.

create or replace function public.admin_release_gate(
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

  -- 자동 선택: 최근 window 내 트래픽 상위(최근성 우선) 2개 release.
  --   candidate = 가장 최근, baseline = 그 다음.
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

  with base as (
    select * from public.runtime_telemetry_events e
    where e.received_at >= v_since and (v_env is null or e.environment = v_env)
      and e.release in (coalesce(v_candidate, '\x00'), coalesce(v_baseline, '\x00'))
  ),
  per_release as (
    select
      release,
      count(*)                                                    as events,
      count(distinct session_id)                                  as sessions,
      count(distinct browser_family)                              as browsers,
      min(received_at)                                            as first_seen,
      max(received_at)                                            as last_seen,
      count(*) filter (where event_type='error')                  as error_count,
      count(*) filter (where event_type='error' and severity='critical') as critical_count,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='chunk-load') as chunk_sessions,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='react' and (payload->>'message') ~* 'hydrat|did not match|does not match') as hydration_sessions,
      count(*) filter (where event_type='api')                    as api_count,
      count(*) filter (where event_type='api' and duration_ms>=1000) as slow_api_count,
      round(percentile_cont(0.95) within group (order by duration_ms) filter (where event_type='api' and duration_ms is not null)::numeric) as api_p95,
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
  ),
  release_list as (
    select coalesce(jsonb_agg(r order by (r->>'last_seen') desc), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'release', release, 'events', count(*), 'sessions', count(distinct session_id),
               'first_seen', min(received_at), 'last_seen', max(received_at)
             ) as r
      from public.runtime_telemetry_events e
      where e.received_at >= v_since and (v_env is null or e.environment = v_env) and release <> 'unknown'
      group by release order by max(received_at) desc limit 30
    ) t
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window, '7d'), 'since', v_since,
    'candidate', v_candidate, 'baseline', v_baseline,
    'releases', coalesce((select jsonb_object_agg(release, to_jsonb(per_release)) from per_release), '{}'::jsonb),
    'list', (select v from release_list)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_release_gate(text,text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_release_gate(text,text,text,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_release_gate(text,text,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_release_gate(text,text,text,text);
-- 신규(0456) SELECT 전용 함수 1개 — 롤백은 순수 DROP FUNCTION. 데이터/스키마/인덱스/RLS 영향 없음.
-- _obs_window_interval(text) 는 0455 에서 생성됨(여기서 재정의/삭제하지 않음).
