-- 0454 — Phase WEB-OBS-1: Server Runtime Telemetry Pipeline & Persistent RUM Storage
--
-- 목적:
--   WEB-OPT-11 클라이언트 RUM(세션 내 ring buffer)을 서버로 영속화해 릴리스/브라우저/라우트별
--   비교 분석을 가능케 한다. 이 마이그레이션은 "수집·저장 기반"만 신설한다(신규 테이블 1개 +
--   선택적 일별 롤업 + 조회 RPC). 어떤 기존 테이블/컬럼/RPC 도 변경하지 않는다.
--
-- 설계 원칙 (절대):
--   • Additive Only. 신규 객체만 CREATE. 기존 스키마 무변경 → 롤백은 신규 객체 DROP 뿐(하단 참조).
--   • Production Apply 금지. 이 파일은 Preview/rollback-txn 검증 전용 — 원본 데이터 변경 없음.
--   • PII 저장 금지: 토큰/이메일/전화/원본 쿼리스트링/요청·응답 body/유저 입력 원문/식별자 금지.
--     엔벨로프는 저카디널리티 버킷 차원 + sanitized route/message + payload(jsonb) 만 저장한다.
--     (1차 sanitize=클라이언트 transport, 2차 sanitize=Edge ingestion. 이 테이블은 3차 방어선.)
--   • RLS: 기본 deny-all. 서비스롤(Edge ingestion)만 insert, super_admin 만 select. 클라이언트
--     직접 insert/select 불가.
--   • 무한 성장 방지: event_id UNIQUE(dedup) + 30일 보존 정리 함수(cron 은 별도, 여기선 정의만).

-- ─────────────────────────────────────────────────────────────────────
-- A. Events table
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.runtime_telemetry_events (
  event_id                    text        primary key,               -- 클라이언트 생성 dedup 키
  event_type                  text        not null
    check (event_type in ('vital','longtask','api','route','interaction','error','memory')),
  event_version               integer     not null default 1,
  session_id                  text        not null,                  -- 익명 세션 id (유저 id 아님)
  sequence                    integer     not null default 0,
  occurred_at                 bigint      not null default 0,        -- 클라이언트 epoch ms
  received_at                 timestamptz not null default now(),    -- 서버 수신 시각
  release                     text        not null default 'unknown',
  environment                 text        not null default 'unknown'
    check (environment in ('production','preview','development','unknown')),
  route                       text        not null default '/',
  previous_route              text,
  duration_ms                 integer,
  severity                    text        not null default 'info'
    check (severity in ('info','warn','critical')),
  browser_family              text        not null default 'Other',
  browser_major               integer,
  os_family                   text        not null default 'Other',
  device_class                text        not null default 'unknown'
    check (device_class in ('mobile','tablet','desktop','unknown')),
  viewport_bucket             text        not null default 'unknown',
  network_type                text,
  hardware_concurrency_bucket text,
  device_memory_bucket        text,
  sample_rate                 numeric(6,4) not null default 1
    check (sample_rate > 0 and sample_rate <= 1),
  payload                     jsonb       not null default '{}'::jsonb,
  -- 방어: payload 크기 상한(서버 검증과 이중화). 4KB.
  constraint runtime_telemetry_payload_size check (pg_column_size(payload) <= 8192)
);

comment on table public.runtime_telemetry_events is
  'WEB-OBS-1 persistent RUM. Bucketed, PII-free runtime telemetry envelopes. RLS deny-all; service_role ingest, super_admin read only. 30d retention.';

-- 조회 패턴별 인덱스 (시간 역순 + 릴리스/라우트/브라우저/타입 비교 + 세션 재구성).
create index if not exists rte_received_at_idx      on public.runtime_telemetry_events (received_at desc);
create index if not exists rte_release_time_idx     on public.runtime_telemetry_events (release, received_at desc);
create index if not exists rte_route_time_idx       on public.runtime_telemetry_events (route, received_at desc);
create index if not exists rte_browser_time_idx     on public.runtime_telemetry_events (browser_family, received_at desc);
create index if not exists rte_type_time_idx        on public.runtime_telemetry_events (event_type, received_at desc);
create index if not exists rte_session_seq_idx      on public.runtime_telemetry_events (session_id, sequence);
-- vital 값 분석 가속 (event_type='vital' 행만).
create index if not exists rte_vital_name_idx
  on public.runtime_telemetry_events ((payload->>'name'), received_at desc)
  where event_type = 'vital';

-- ─────────────────────────────────────────────────────────────────────
-- B. RLS — deny-all 기본. super_admin 만 select. (insert 는 service_role 이 RLS 우회.)
-- ─────────────────────────────────────────────────────────────────────
alter table public.runtime_telemetry_events enable row level security;
-- 방어적: 강제 RLS 로 테이블 owner 도 정책을 우회하지 못하게(단, service_role 은 bypassrls 롤이라 계속 가능).
alter table public.runtime_telemetry_events force row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'rte_super_admin_read') then
    create policy rte_super_admin_read
      on public.runtime_telemetry_events
      for select
      using (public._is_super_admin());
  end if;
end $$;
-- 의도적으로 insert/update/delete 정책 없음 → authenticated/anon 은 전면 차단.
-- 클라이언트는 오직 same-origin Edge 함수(/api/telemetry/runtime, service_role)를 통해서만 기록.

-- ─────────────────────────────────────────────────────────────────────
-- C. Ingestion RPC — service_role 전용. dedup(on conflict) + 삽입 건수 반환.
--    Edge 함수가 parseEnvelope 로 검증·sanitize 한 "정제된" 이벤트 배열을 넘긴다.
--    이 RPC 는 화이트리스트 컬럼만 추출해 삽입한다(추가 필드 무시 = 3차 방어).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.ingest_runtime_telemetry(p_events jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total    int := 0;
  v_inserted int := 0;
begin
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'events_not_array');
  end if;
  v_total := jsonb_array_length(p_events);
  if v_total = 0 then
    return jsonb_build_object('ok', true, 'total', 0, 'inserted', 0, 'duplicate', 0);
  end if;
  if v_total > 200 then
    -- 방어: RPC 한 번에 과도한 배열 차단(Edge 도 50개 상한이지만 이중화).
    return jsonb_build_object('ok', false, 'error', 'too_many_events');
  end if;

  with incoming as (
    select
      e->>'event_id'                                   as event_id,
      e->>'event_type'                                 as event_type,
      coalesce((e->>'event_version')::int, 1)          as event_version,
      e->>'session_id'                                 as session_id,
      coalesce((e->>'sequence')::int, 0)               as sequence,
      coalesce((e->>'occurred_at')::bigint, 0)         as occurred_at,
      coalesce(e->>'release', 'unknown')               as release,
      coalesce(e->>'environment', 'unknown')           as environment,
      coalesce(e->>'route', '/')                       as route,
      e->>'previous_route'                             as previous_route,
      nullif(e->>'duration_ms', '')::int               as duration_ms,
      coalesce(e->>'severity', 'info')                 as severity,
      coalesce(e->>'browser_family', 'Other')          as browser_family,
      nullif(e->>'browser_major', '')::int             as browser_major,
      coalesce(e->>'os_family', 'Other')               as os_family,
      coalesce(e->>'device_class', 'unknown')          as device_class,
      coalesce(e->>'viewport_bucket', 'unknown')       as viewport_bucket,
      e->>'network_type'                               as network_type,
      e->>'hardware_concurrency_bucket'                as hardware_concurrency_bucket,
      e->>'device_memory_bucket'                       as device_memory_bucket,
      coalesce(nullif(e->>'sample_rate','')::numeric, 1) as sample_rate,
      coalesce(e->'payload', '{}'::jsonb)              as payload
    from jsonb_array_elements(p_events) as e
    where e->>'event_id' is not null
      and e->>'event_type' in ('vital','longtask','api','route','interaction','error','memory')
  ),
  ins as (
    insert into public.runtime_telemetry_events (
      event_id, event_type, event_version, session_id, sequence, occurred_at,
      release, environment, route, previous_route, duration_ms, severity,
      browser_family, browser_major, os_family, device_class, viewport_bucket,
      network_type, hardware_concurrency_bucket, device_memory_bucket, sample_rate, payload
    )
    select
      event_id, event_type, event_version, session_id, sequence, occurred_at,
      release, environment, route, previous_route, duration_ms,
      case when severity in ('info','warn','critical') then severity else 'info' end,
      browser_family, browser_major, os_family,
      case when device_class in ('mobile','tablet','desktop','unknown') then device_class else 'unknown' end,
      viewport_bucket, network_type, hardware_concurrency_bucket, device_memory_bucket,
      least(greatest(sample_rate, 0.0001), 1), payload
    from incoming
    on conflict (event_id) do nothing          -- dedup: 동일 event_id 재전송 무시(무한 retry 안전)
    returning 1
  )
  select count(*) into v_inserted from ins;

  return jsonb_build_object(
    'ok', true,
    'total', v_total,
    'inserted', v_inserted,
    'duplicate', v_total - v_inserted
  );
end;
$$;

revoke execute on function public.ingest_runtime_telemetry(jsonb) from public;
do $$ begin
  begin grant execute on function public.ingest_runtime_telemetry(jsonb) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Aggregate query RPC — super_admin 전용. 파라미터 바인딩만(동적 SQL 문자열 없음).
--    화이트리스트 필터(window/release/route/browser/event_type) + 페이지네이션.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_query_runtime_telemetry(
  p_window       text default '24h',   -- '1h' | '24h' | '7d' | '30d'
  p_release      text default null,
  p_route        text default null,
  p_browser      text default null,
  p_event_type   text default null,
  p_limit        int  default 100,
  p_offset       int  default 0
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since   timestamptz;
  v_limit   int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_release text := nullif(btrim(coalesce(p_release, '')), '');
  v_route   text := nullif(btrim(coalesce(p_route, '')), '');
  v_browser text := nullif(btrim(coalesce(p_browser, '')), '');
  v_type    text := nullif(btrim(coalesce(p_event_type, '')), '');
  v_total   bigint;
  v_summary jsonb;
  v_vitals  jsonb;
  v_routes  jsonb;
  v_errors  jsonb;
  v_releases jsonb;
  v_apis    jsonb;
  v_longtasks jsonb;
  v_browsers jsonb;
  v_devices jsonb;
  v_interactions jsonb;
  v_rows    jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  v_since := now() - case coalesce(p_window, '24h')
    when '1h'  then interval '1 hour'
    when '24h' then interval '24 hours'
    when '7d'  then interval '7 days'
    when '30d' then interval '30 days'
    else interval '24 hours'
  end;

  -- event_type 화이트리스트(임의 값 차단).
  if v_type is not null and v_type not in ('vital','longtask','api','route','interaction','error','memory') then
    v_type := null;
  end if;

  -- 공통 필터 CTE (모두 파라미터 바인딩 — 동적 SQL 문자열 없음).
  with scope as (
    select *
    from public.runtime_telemetry_events e
    where e.received_at >= v_since
      and (v_release is null or e.release = v_release)
      and (v_route   is null or e.route = v_route)
      and (v_browser is null or e.browser_family = v_browser)
      and (v_type    is null or e.event_type = v_type)
  )
  select
    count(*),
    -- 이벤트 타입 분포
    (select jsonb_object_agg(event_type, c) from (
       select event_type, count(*) c from scope group by event_type
     ) t),
    -- vital 별 p50/p75/p95 (event_type='vital')
    (select jsonb_object_agg(name, stats) from (
       select payload->>'name' as name,
              jsonb_build_object(
                'count', count(*),
                'p50', round(percentile_cont(0.5) within group (order by (payload->>'value')::numeric)::numeric, 3),
                'p75', round(percentile_cont(0.75) within group (order by (payload->>'value')::numeric)::numeric, 3),
                'p95', round(percentile_cont(0.95) within group (order by (payload->>'value')::numeric)::numeric, 3),
                'poor', count(*) filter (where payload->>'rating' = 'poor')
              ) as stats
       from scope where event_type = 'vital' and (payload->>'value') ~ '^-?[0-9.]+$'
       group by payload->>'name'
     ) v),
    -- route 별 방문/평균 dwell
    (select jsonb_agg(r) from (
       select jsonb_build_object(
                'route', route,
                'count', count(*),
                'avg_duration', round(avg(duration_ms) filter (where duration_ms is not null))
              ) r
       from scope where event_type = 'route'
       group by route order by count(*) desc limit 20
     ) rr),
    -- 에러 상위(sanitized message 기준)
    (select jsonb_agg(er) from (
       select jsonb_build_object(
                'kind', payload->>'kind',
                'message', payload->>'message',
                'route', route,
                'count', count(*)
              ) er
       from scope where event_type = 'error'
       group by payload->>'kind', payload->>'message', route
       order by count(*) desc limit 20
     ) ee),
    -- 릴리스 분포
    (select jsonb_object_agg(release, c) from (
       select release, count(*) c from scope group by release order by count(*) desc limit 20
     ) rl),
    -- Slow APIs 상위 20 (event_type='api'): worst/p95/avg duration + 호출수
    (select jsonb_agg(a) from (
       select jsonb_build_object(
                'name', payload->>'name',
                'kind', payload->>'kind',
                'count', count(*),
                'worst', max(duration_ms),
                'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric),
                'avg', round(avg(duration_ms))
              ) a
       from scope where event_type = 'api' and duration_ms is not null
       group by payload->>'name', payload->>'kind'
       order by max(duration_ms) desc limit 20
     ) aa),
    -- Long Tasks 상위 20 (route 별): worst/p95/count
    (select jsonb_agg(l) from (
       select jsonb_build_object(
                'route', route,
                'count', count(*),
                'worst', max(duration_ms),
                'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric)
              ) l
       from scope where event_type = 'longtask' and duration_ms is not null
       group by route order by max(duration_ms) desc limit 20
     ) ll),
    -- Browser 분포
    (select jsonb_object_agg(browser_family, c) from (
       select browser_family, count(*) c from scope group by browser_family order by count(*) desc limit 20
     ) bb),
    -- Device class 분포
    (select jsonb_object_agg(device_class, c) from (
       select device_class, count(*) c from scope group by device_class
     ) dd),
    -- Interaction 지연 요약 (p75/p95/worst)
    (select jsonb_build_object(
              'count', count(*),
              'p75', round(percentile_cont(0.75) within group (order by duration_ms)::numeric),
              'p95', round(percentile_cont(0.95) within group (order by duration_ms)::numeric),
              'worst', max(duration_ms)
            )
     from scope where event_type = 'interaction' and duration_ms is not null)
  into v_total, v_summary, v_vitals, v_routes, v_errors, v_releases,
       v_apis, v_longtasks, v_browsers, v_devices, v_interactions;

  -- 최근 이벤트 페이지(진단용, sanitized 필드만 노출).
  select jsonb_agg(row_to_json(t))
  into v_rows
  from (
    select event_id, event_type, session_id, sequence, occurred_at, received_at,
           release, environment, route, previous_route, duration_ms, severity,
           browser_family, browser_major, os_family, device_class, viewport_bucket,
           network_type, sample_rate, payload
    from public.runtime_telemetry_events e
    where e.received_at >= v_since
      and (v_release is null or e.release = v_release)
      and (v_route   is null or e.route = v_route)
      and (v_browser is null or e.browser_family = v_browser)
      and (v_type    is null or e.event_type = v_type)
    order by e.received_at desc
    limit v_limit offset v_offset
  ) t;

  return jsonb_build_object(
    'ok', true,
    'window', coalesce(p_window, '24h'),
    'since', v_since,
    'total', coalesce(v_total, 0),
    'summary', jsonb_build_object(
      'by_type', coalesce(v_summary, '{}'::jsonb),
      'vitals',  coalesce(v_vitals, '{}'::jsonb),
      'routes',  coalesce(v_routes, '[]'::jsonb),
      'errors',  coalesce(v_errors, '[]'::jsonb),
      'releases', coalesce(v_releases, '{}'::jsonb),
      'apis',    coalesce(v_apis, '[]'::jsonb),
      'long_tasks', coalesce(v_longtasks, '[]'::jsonb),
      'browsers', coalesce(v_browsers, '{}'::jsonb),
      'devices', coalesce(v_devices, '{}'::jsonb),
      'interactions', coalesce(v_interactions, '{}'::jsonb)
    ),
    'page', jsonb_build_object('limit', v_limit, 'offset', v_offset, 'rows', coalesce(v_rows, '[]'::jsonb))
  );
end;
$$;

revoke execute on function public.admin_query_runtime_telemetry(text,text,text,text,text,int,int) from public;
do $$ begin
  begin grant execute on function public.admin_query_runtime_telemetry(text,text,text,text,text,int,int) to service_role;
  exception when undefined_object then null; end;
  -- authenticated super_admin 이 직접 호출해도 내부 _is_super_admin() 가드가 재검증.
  begin grant execute on function public.admin_query_runtime_telemetry(text,text,text,text,text,int,int) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Retention — 30일 초과 이벤트 정리. cron 은 별도(여기선 함수만 정의).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.purge_runtime_telemetry(p_days int default 30)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_deleted bigint;
begin
  if not (public._is_super_admin() or (auth.jwt() ->> 'role') = 'service_role') then
    raise exception 'forbidden: admin only';
  end if;
  delete from public.runtime_telemetry_events
   where received_at < now() - make_interval(days => greatest(coalesce(p_days, 30), 1));
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'older_than_days', greatest(coalesce(p_days,30),1));
end;
$$;

revoke execute on function public.purge_runtime_telemetry(int) from public;
do $$ begin
  begin grant execute on function public.purge_runtime_telemetry(int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증에서 사용. Production apply 금지):
--   drop function if exists public.purge_runtime_telemetry(int);
--   drop function if exists public.admin_query_runtime_telemetry(text,text,text,text,text,int,int);
--   drop function if exists public.ingest_runtime_telemetry(jsonb);
--   drop table if exists public.runtime_telemetry_events;   -- 신규 테이블이므로 데이터 손실 없음
-- 모든 객체가 신규(0454)라 롤백은 순수 DROP 이며 기존 스키마/데이터에 영향 없음.
