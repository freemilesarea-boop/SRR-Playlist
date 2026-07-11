-- 0459 — Phase WEB-OBS-6: Store Fleet Monitoring — Player Health Events
--
-- 목적:
--   매장 단위 플레이어 운영 상태(liveness/playback/queue/network/repetition)를 관측하기 위한
--   저비용 time-series 이벤트 채널. 익명 runtime_telemetry_events(0454)와 완전히 분리 — 그 테이블은
--   store 귀속이 없다(익명 session_id). 이 채널은 store_id = auth.uid() (business user == 매장) 로
--   서버가 귀속을 검증한다(클라이언트 store_id 신뢰 안 함).
--
-- 설계 원칙 (절대):
--   • Additive Only. 신규 테이블 1 + 신규 RPC 5. 기존 운영 테이블/뷰/RPC/RLS 무변경.
--     store_policy_sync_status / store_monitoring_status / users / franchise_stores 등 ALTER 없음.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용. 원본 운영 데이터 변경 없음(SELECT only
--     except INSERT into THIS new table via the ingest RPC).
--   • Security Definer + auth.uid() 귀속 + _is_super_admin() 관리자 게이트 + search_path 고정 +
--     파라미터 바인딩(동적 SQL 없음) + allowlist + row/batch 상한.
--   • Store 이름/원문 트랙/URL/UA/토큰 저장 금지. current_track_hash 는 비가역. 값은 bucket.
--   • Cascade delete 금지. store_id FK 미설정(telemetry 는 purge 대상 — user 삭제를 막으면 안 됨).
--     귀속은 insert 시 auth.uid() 로 검증하고, 조회는 super_admin 만 가능.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 이벤트 테이블 (신규, additive)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.store_player_health_events (
  event_id            text primary key,
  store_id            uuid not null,                    -- 서버가 auth.uid() 로 stamp (FK 미설정: purgeable)
  event_type          text not null check (event_type in (
                        'player_heartbeat','playback_stalled','silence_suspected','queue_empty',
                        'track_transition','network_disconnected','network_reconnected',
                        'duplicate_track_detected','session_started','session_ended')),
  event_version       int not null default 1,
  player_session_id   text not null check (length(player_session_id) <= 64),
  sequence            int not null default 0,
  occurred_at         bigint not null default 0,
  received_at         timestamptz not null default now(),
  release             text not null default 'unknown' check (length(release) <= 64),
  environment         text not null default 'unknown' check (environment in ('production','preview','development','unknown')),
  route               text not null default 'other' check (length(route) <= 32),
  browser_family      text not null default 'Other' check (length(browser_family) <= 16),
  os_family           text not null default 'Other' check (length(os_family) <= 16),
  device_class        text not null default 'unknown' check (device_class in ('mobile','tablet','desktop','unknown')),
  visibility_state    text not null default 'unknown' check (visibility_state in ('visible','hidden','unknown')),
  playback_state      text not null default 'unknown' check (playback_state in ('playing','paused','stopped','unknown')),
  current_track_hash  text check (current_track_hash is null or length(current_track_hash) <= 16),
  position_bucket     text not null default 'unknown' check (position_bucket in ('start','early','mid','late','end','unknown')),
  queue_length_bucket text not null default 'unknown' check (queue_length_bucket in ('empty','low','some','many','unknown')),
  has_next            boolean not null default false,
  scheduler_age_bucket text not null default 'unknown' check (scheduler_age_bucket in ('fresh','recent','aging','stale','unknown')),
  reconnect_bucket    text not null default 'unknown' check (reconnect_bucket in ('none','few','several','loop','unknown')),
  online              boolean not null default true
);

comment on table public.store_player_health_events is
  'WEB-OBS-6 매장 플레이어 헬스 이벤트(time-series). store_id=auth.uid() 서버 검증. 익명 RUM과 분리. purge 대상. 원문 PII/트랙/URL/토큰 미저장.';

create index if not exists sphe_received_idx      on public.store_player_health_events (received_at);
create index if not exists sphe_store_time_idx    on public.store_player_health_events (store_id, received_at desc);
create index if not exists sphe_session_seq_idx   on public.store_player_health_events (player_session_id, sequence);
create index if not exists sphe_type_time_idx     on public.store_player_health_events (event_type, received_at);
create index if not exists sphe_release_time_idx  on public.store_player_health_events (release, received_at);

alter table public.store_player_health_events enable row level security;
alter table public.store_player_health_events force row level security;

-- 읽기: super_admin 만. INSERT/UPDATE/DELETE 정책 없음 → authenticated/anon 직접 접근 전면 차단.
-- 삽입은 security-definer ingest RPC(아래) 만 수행(RLS bypass). 매장 클라이언트는 RPC 로만 기록.
drop policy if exists sphe_super_admin_read on public.store_player_health_events;
create policy sphe_super_admin_read on public.store_player_health_events
  for select using (public._is_super_admin());

revoke insert, update, delete on public.store_player_health_events from authenticated, anon;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Ingestion RPC — 인증된 매장 세션만. store_id = auth.uid() 서버 검증(스푸핑 차단).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.ingest_store_player_health(
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
  v_acct     text;
  v_accepted int := 0;
begin
  if v_store is null then
    return jsonb_build_object('ok', false, 'error', 'unauthorized');
  end if;
  -- 스푸핑 차단: 본인 매장(auth.uid())만. super_admin 은 합성 테스트용으로 임의 store 허용.
  if v_store <> auth.uid() and not v_is_admin then
    return jsonb_build_object('ok', false, 'error', 'forbidden: store mismatch');
  end if;
  -- 비-매장(business 아님) 계정 거부(super_admin 예외 — 합성 검증용).
  if not v_is_admin then
    select account_type into v_acct from public.users where id = v_store;
    if coalesce(v_acct, 'individual') <> 'business' then
      return jsonb_build_object('ok', false, 'error', 'forbidden: not a store account');
    end if;
  end if;
  if p_events is null or jsonb_typeof(p_events) <> 'array' then
    return jsonb_build_object('ok', false, 'error', 'events_required');
  end if;

  -- 배치 상한 40. allowlist coercion 은 CHECK 제약이 담당(위반 event 는 insert 실패 대신 필터).
  with incoming as (
    select e, ord from jsonb_array_elements(p_events) with ordinality as t(e, ord)
    where ord <= 40
  ),
  clean as (
    select
      left(coalesce(e->>'event_id',''), 64)            as event_id,
      lower(coalesce(e->>'event_type',''))             as event_type,
      left(coalesce(e->>'player_session_id',''), 64)   as player_session_id,
      coalesce((e->>'sequence')::int, 0)               as sequence,
      coalesce((e->>'occurred_at')::bigint, 0)         as occurred_at,
      left(coalesce(e->>'release','unknown'), 64)      as release,
      lower(coalesce(e->>'environment','unknown'))     as environment,
      left(coalesce(e->>'route','other'), 32)          as route,
      left(coalesce(e->>'browser_family','Other'), 16) as browser_family,
      left(coalesce(e->>'os_family','Other'), 16)      as os_family,
      lower(coalesce(e->>'device_class','unknown'))    as device_class,
      lower(coalesce(e->>'visibility_state','unknown')) as visibility_state,
      lower(coalesce(e->>'playback_state','unknown'))  as playback_state,
      nullif(left(coalesce(e->>'current_track_hash',''), 16), '') as current_track_hash,
      lower(coalesce(e->>'position_bucket','unknown')) as position_bucket,
      lower(coalesce(e->>'queue_length_bucket','unknown')) as queue_length_bucket,
      coalesce((e->>'has_next')::boolean, false)       as has_next,
      lower(coalesce(e->>'scheduler_age_bucket','unknown')) as scheduler_age_bucket,
      lower(coalesce(e->>'reconnect_bucket','unknown')) as reconnect_bucket,
      coalesce((e->>'online')::boolean, true)          as online
    from incoming
  ),
  ins as (
    insert into public.store_player_health_events (
      event_id, store_id, event_type, event_version, player_session_id, sequence, occurred_at,
      release, environment, route, browser_family, os_family, device_class, visibility_state,
      playback_state, current_track_hash, position_bucket, queue_length_bucket, has_next,
      scheduler_age_bucket, reconnect_bucket, online)
    select
      c.event_id, v_store, c.event_type, 1, c.player_session_id, c.sequence, c.occurred_at,
      c.release,
      case when c.environment in ('production','preview','development','unknown') then c.environment else 'unknown' end,
      c.route, c.browser_family, c.os_family,
      case when c.device_class in ('mobile','tablet','desktop','unknown') then c.device_class else 'unknown' end,
      case when c.visibility_state in ('visible','hidden','unknown') then c.visibility_state else 'unknown' end,
      case when c.playback_state in ('playing','paused','stopped','unknown') then c.playback_state else 'unknown' end,
      c.current_track_hash,
      case when c.position_bucket in ('start','early','mid','late','end','unknown') then c.position_bucket else 'unknown' end,
      case when c.queue_length_bucket in ('empty','low','some','many','unknown') then c.queue_length_bucket else 'unknown' end,
      c.has_next,
      case when c.scheduler_age_bucket in ('fresh','recent','aging','stale','unknown') then c.scheduler_age_bucket else 'unknown' end,
      case when c.reconnect_bucket in ('none','few','several','loop','unknown') then c.reconnect_bucket else 'unknown' end,
      c.online
    from clean c
    where c.event_id <> '' and c.player_session_id <> ''
      and c.event_type in ('player_heartbeat','playback_stalled','silence_suspected','queue_empty',
                           'track_transition','network_disconnected','network_reconnected',
                           'duplicate_track_detected','session_started','session_ended')
    on conflict (event_id) do nothing
    returning 1
  )
  select count(*) into v_accepted from ins;

  return jsonb_build_object('ok', true, 'accepted', v_accepted);
end;
$$;

revoke execute on function public.ingest_store_player_health(jsonb, uuid) from public;
do $$ begin
  begin grant execute on function public.ingest_store_player_health(jsonb, uuid) to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public.ingest_store_player_health(jsonb, uuid) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Admin fleet overview — 매장별 window 집계(super_admin only). 판정은 클라이언트 engine 담당.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_store_fleet_overview(
  p_window      text default '24h',
  p_environment text default null,
  p_release     text default null,
  p_brand       uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since    timestamptz;
  v_split    timestamptz;
  v_interval interval;
  v_env      text := nullif(btrim(coalesce(p_environment,'')),'');
  v_release  text := nullif(btrim(coalesce(p_release,'')),'');
  v_result   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_interval := public._obs_window_interval(p_window);
  v_since := now() - v_interval;
  v_split := now() - (v_interval / 3);

  with scope as (
    select * from public.store_player_health_events e
    where e.received_at >= v_since
      and (v_env is null or e.environment = v_env)
      and (v_release is null or e.release = v_release)
  ),
  latest as (  -- 매장별 최신 heartbeat 스냅샷
    select distinct on (store_id)
      store_id, visibility_state, playback_state, queue_length_bucket, has_next,
      scheduler_age_bucket, release, browser_family, device_class, online, received_at
    from scope
    where event_type = 'player_heartbeat'
    order by store_id, received_at desc
  ),
  repeats as (  -- 매장별 최대 동일 트랙 반복 / distinct
    select store_id, max(cnt) as max_track_repeat, count(*) as distinct_tracks
    from (
      select store_id, current_track_hash, count(*) as cnt
      from scope where current_track_hash is not null
      group by store_id, current_track_hash
    ) t group by store_id
  ),
  agg as (
    select
      s.store_id,
      round(extract(epoch from (now() - max(s.received_at)))::numeric) as last_seen_age_sec,
      count(*) filter (where s.event_type='player_heartbeat')          as heartbeats,
      count(*) filter (where s.event_type='playback_stalled' and s.received_at >= v_split)   as stalled_recent,
      count(*) filter (where s.event_type='silence_suspected' and s.received_at >= v_split)  as silence_recent,
      count(*) filter (where s.event_type='playback_stalled')          as stalled_events,
      count(*) filter (where s.event_type='silence_suspected')         as silence_events,
      count(*) filter (where s.event_type='queue_empty' and s.received_at >= v_split) as queue_empty_recent,
      count(*) filter (where s.event_type='network_disconnected')      as disconnect_events,
      count(*) filter (where s.event_type='network_reconnected')       as reconnect_events,
      count(*) filter (where s.event_type='track_transition')          as transitions
    from scope s group by s.store_id
  ),
  stores as (
    select
      a.store_id,
      a.last_seen_age_sec, a.heartbeats, a.stalled_recent, a.silence_recent, a.stalled_events,
      a.silence_events, a.queue_empty_recent, a.disconnect_events, a.reconnect_events, a.transitions,
      coalesce(l.visibility_state,'unknown')  as last_visibility,
      coalesce(l.playback_state,'unknown')    as last_playback_state,
      coalesce(l.queue_length_bucket,'unknown') as last_queue_bucket,
      coalesce(l.has_next,false)              as has_next,
      coalesce(l.scheduler_age_bucket,'unknown') as scheduler_age_bucket,
      coalesce(l.release,'unknown')           as release,
      coalesce(l.browser_family,'Other')      as browser_family,
      coalesce(l.device_class,'unknown')      as device_class,
      coalesce(l.online,true)                 as online,
      coalesce(r.max_track_repeat,0)          as max_track_repeat,
      coalesce(r.distinct_tracks,0)           as distinct_tracks,
      -- 귀속(표시용, super_admin 조회 한정). users.business_name 은 실제 스키마에 없음 →
      -- franchise_stores.store_name / business_profiles.store_name / users.nickname 순으로 사용.
      coalesce(fs.store_name, bp.store_name, u.nickname) as store_name,
      fs.franchise_id                         as brand_id,
      f.name                                  as brand_name,
      ss.enterprise_region_id                 as enterprise_region_id,
      er.region_name                          as region_name
    from agg a
    left join latest l on l.store_id = a.store_id
    left join repeats r on r.store_id = a.store_id
    left join public.users u on u.id = a.store_id
    left join public.business_profiles bp on bp.user_id = a.store_id
    left join public.store_policy_sync_status ss on ss.store_id = a.store_id
    left join public.franchise_stores fs on fs.store_id = a.store_id and fs.status = 'active'
    left join public.franchises f on f.id = fs.franchise_id
    left join public.enterprise_regions er on er.id = ss.enterprise_region_id
    where (p_brand is null or fs.franchise_id = p_brand)
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'24h'), 'now', now(),
    'observation_window_minutes', round((extract(epoch from v_interval)/60.0)::numeric),
    'total_stores', (select count(*) from stores),
    'stores', coalesce((select jsonb_agg(to_jsonb(stores)) from stores), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.admin_store_fleet_overview(text,text,text,uuid) from public;
do $$ begin
  begin grant execute on function public.admin_store_fleet_overview(text,text,text,uuid) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Admin store detail — 단일 매장 recovery(earlier vs recent) + 최근 이벤트 카운트.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_store_player_health(
  p_store_id uuid,
  p_window   text default '24h'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_split timestamptz; v_interval interval; v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store_id is null then return jsonb_build_object('ok', false, 'error', 'store_required'); end if;
  v_interval := public._obs_window_interval(p_window);
  v_since := now() - v_interval;
  v_split := now() - (v_interval / 3);

  with scope as (
    select * from public.store_player_health_events e
    where e.received_at >= v_since and e.store_id = p_store_id
  ),
  hb as (  -- heartbeat 를 healthy/unhealthy 로 라벨(정체/오프라인/큐empty 를 unhealthy 로 간주)
    select received_at,
      case when playback_state='playing' and queue_length_bucket <> 'empty' and online then 0 else 1 end as unhealthy
    from scope where event_type='player_heartbeat'
  ),
  earlier as (
    select count(*) filter (where unhealthy=0) as healthy, count(*) filter (where unhealthy=1) as unhealthy
    from hb where received_at < v_split
  ),
  recent as (
    select count(*) filter (where unhealthy=0) as healthy, count(*) filter (where unhealthy=1) as unhealthy
    from hb where received_at >= v_split
  ),
  series as (
    select coalesce(jsonb_agg(unhealthy order by received_at), '[]'::jsonb) as v
    from hb where received_at >= v_split
  )
  select jsonb_build_object(
    'ok', true, 'store_id', p_store_id, 'window', coalesce(p_window,'24h'),
    'observation_window_minutes', round((extract(epoch from (now() - v_split))/60.0)::numeric),
    'earlier', (select to_jsonb(earlier) from earlier),
    'recent', (select to_jsonb(recent) from recent),
    'recent_series', (select v from series),
    'event_counts', (select jsonb_object_agg(event_type, c) from (select event_type, count(*) c from scope group by event_type) t)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.admin_store_player_health(uuid,text) from public;
do $$ begin
  begin grant execute on function public.admin_store_player_health(uuid,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Admin release compare — release 별 매장/불안정 집계(release-specific 장애 근거).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_store_fleet_release_compare(
  p_window      text default '24h',
  p_environment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_since timestamptz; v_env text := nullif(btrim(coalesce(p_environment,'')),''); v_result jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_env is not null and v_env not in ('production','preview','development','unknown') then v_env := null; end if;
  v_since := now() - public._obs_window_interval(p_window);

  with scope as (
    select * from public.store_player_health_events e
    where e.received_at >= v_since and (v_env is null or e.environment = v_env)
  ),
  by_release as (
    select release,
      count(distinct store_id) as stores,
      count(distinct store_id) filter (where event_type in ('playback_stalled','silence_suspected','network_disconnected')) as unhealthy_stores,
      count(*) filter (where event_type='player_heartbeat') as heartbeats
    from scope group by release
  )
  select jsonb_build_object(
    'ok', true, 'window', coalesce(p_window,'24h'),
    'releases', coalesce((select jsonb_agg(to_jsonb(by_release) order by (by_release.stores) desc) from by_release), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke execute on function public.admin_store_fleet_release_compare(text,text) from public;
do $$ begin
  begin grant execute on function public.admin_store_fleet_release_compare(text,text) to authenticated;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Retention purge — raw heartbeat 단기 보존(기본 14일). 서버 운영자/cron 용.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.purge_store_player_health(p_days int default 14)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_days int := greatest(coalesce(p_days, 14), 1); v_deleted bigint;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  delete from public.store_player_health_events where received_at < now() - make_interval(days => v_days);
  get diagnostics v_deleted = row_count;
  return jsonb_build_object('ok', true, 'deleted', v_deleted, 'retain_days', v_days);
end;
$$;

revoke execute on function public.purge_store_player_health(int) from public, authenticated, anon;
do $$ begin
  begin grant execute on function public.purge_store_player_health(int) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.purge_store_player_health(int);
--   drop function if exists public.admin_store_fleet_release_compare(text,text);
--   drop function if exists public.admin_store_player_health(uuid,text);
--   drop function if exists public.admin_store_fleet_overview(text,text,text,uuid);
--   drop function if exists public.ingest_store_player_health(jsonb,uuid);
--   drop table if exists public.store_player_health_events;
-- 신규(0459) 테이블 1 + 함수 5. 롤백은 순수 DROP. 기존 데이터/스키마/인덱스/RLS 영향 없음.
-- _obs_window_interval(text) 는 0455, _is_super_admin() 는 0349/0391 에서 생성됨(여기서 재정의/삭제 안 함).
