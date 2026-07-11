-- 0458 — Phase WEB-OBS-5: Operational Advisor — Incident Recovery RPC
--
-- 목적:
--   Recovery Tracking("실제로 복구되었는가? 재발하는가?")과 Blast Radius denominator를 위해, 한
--   release/incident 를 window 내 EARLIER vs RECENT 하위 구간으로 나눈 지표 + 재발 감지용 버킷
--   시리즈 + window 전체 세션/이벤트(분모)를 한 번에 반환한다. Recovery 판정(NOT_STARTED/IMPROVING/
--   STABLE/RECOVERED/REGRESSED/INSUFFICIENT_DATA)·Blast Radius·Operational Advisor 판정은 모두
--   클라이언트 순수 로직(src/lib/observability/*, 단위 테스트)이 담당한다.
--
-- 설계 원칙 (절대):
--   • Additive Only. CREATE FUNCTION 1종 뿐. 기존 테이블/RPC/뷰/인덱스/RLS 무변경(0454~0457 불변).
--   • Production Apply 금지. Preview/rollback-txn 검증 전용. SELECT only — 원본 데이터 변경 없음.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩(동적 SQL 없음).
--   • window/environment allowlist. 버킷 수 상한. Raw payload 반환 금지(집계값만).
--   • Incident 상태 테이블은 만들지 않는다(운영자 상태/메모 영속화는 다음 Phase로 이연) — read-only.

create or replace function public.admin_incident_recovery(
  p_release     text,
  p_window      text default '24h',
  p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since      timestamptz;
  v_interval   interval;
  v_split      timestamptz;
  v_env        text := nullif(btrim(coalesce(p_environment, '')), '');
  v_release    text := nullif(btrim(coalesce(p_release, '')), '');
  v_bucket_sec double precision;
  v_result     jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  if v_release is null then
    return jsonb_build_object('ok', false, 'error', 'release_required');
  end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then
    v_env := null;
  end if;
  v_interval := public._obs_window_interval(p_window);
  v_since := now() - v_interval;
  v_split := now() - (v_interval / 3);                    -- recent = last third of the window
  v_bucket_sec := greatest(extract(epoch from v_interval) / 6.0, 1);  -- 6 buckets for the series

  with scope as (
    select * from public.runtime_telemetry_events e
    where e.received_at >= v_since and e.release = v_release and (v_env is null or e.environment = v_env)
  ),
  window_totals as (
    select count(distinct session_id) as total_sessions, count(*) as total_events
    from public.runtime_telemetry_events e
    where e.received_at >= v_since and (v_env is null or e.environment = v_env)
  ),
  earlier as (
    select
      count(distinct session_id) as sessions, count(*) as events,
      count(*) filter (where event_type='error') as error_events,
      count(*) filter (where event_type='error' and severity='critical') as critical_events,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='chunk-load') as chunk_sessions,
      round(percentile_cont(0.95) within group (order by duration_ms) filter (where event_type='api' and duration_ms is not null)::numeric) as api_p95,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='LCP' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric,3) as lcp_p75
    from scope where received_at < v_split
  ),
  recent as (
    select
      count(distinct session_id) as sessions, count(*) as events,
      count(*) filter (where event_type='error') as error_events,
      count(*) filter (where event_type='error' and severity='critical') as critical_events,
      count(distinct session_id) filter (where event_type='error' and payload->>'kind'='chunk-load') as chunk_sessions,
      round(percentile_cont(0.95) within group (order by duration_ms) filter (where event_type='api' and duration_ms is not null)::numeric) as api_p95,
      round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric) filter (where event_type='vital' and payload->>'name'='LCP' and (payload->>'value') ~ '^-?[0-9.]+$')::numeric,3) as lcp_p75
    from scope where received_at >= v_split
  ),
  series as (
    select coalesce(jsonb_agg(s order by (s->>'bucket')::int), '[]'::jsonb) as v from (
      select jsonb_build_object(
               'bucket', b.bucket_idx,
               'events', count(sc.*),
               'error_events', count(sc.*) filter (where sc.event_type='error'),
               'error_rate', round(case when count(sc.*) > 0 then count(sc.*) filter (where sc.event_type='error')::numeric / count(sc.*) else 0 end, 4)
             ) as s
      from generate_series(0, 5) as b(bucket_idx)
      left join scope sc
        on floor(extract(epoch from (sc.received_at - v_since)) / v_bucket_sec) = b.bucket_idx
      group by b.bucket_idx
    ) t
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'24h'), 'release', v_release, 'since', v_since, 'split', v_split,
    'observation_window_minutes', round((extract(epoch from (now() - v_split)) / 60.0)::numeric),
    'window_totals', (select to_jsonb(window_totals) from window_totals),
    'earlier', (select to_jsonb(earlier) from earlier),
    'recent', (select to_jsonb(recent) from recent),
    'recent_series', (select v from series)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_incident_recovery(text,text,text) from public;
do $$ begin
  begin grant execute on function public.admin_incident_recovery(text,text,text) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.admin_incident_recovery(text,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.admin_incident_recovery(text,text,text);
-- 신규(0458) SELECT 전용 함수 1개 — 롤백은 순수 DROP FUNCTION. 데이터/스키마/인덱스/RLS 영향 없음.
-- _obs_window_interval(text) 는 0455 에서 생성됨(여기서 재정의/삭제하지 않음). Incident 상태 테이블 없음.
