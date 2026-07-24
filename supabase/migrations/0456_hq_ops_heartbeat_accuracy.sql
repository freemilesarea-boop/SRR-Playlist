-- 0456 — ENTERPRISE-HQ-OPS-1: Heartbeat 정확성 결함 수정 (Self-contained · Idempotent)
--
-- ─────────────────────────────────────────────────────────────────
-- 확정된 원인 (코드/DB 실측 — 추측 아님)
-- ─────────────────────────────────────────────────────────────────
--   1) public.store_policy_sync_status 에는 last_heartbeat_at 컬럼이 실제로 존재하지 않는다.
--      (원본 0349:176 정의 + 0353/0355 추가 컬럼 어디에도 없음)
--      timestamp 계열 실제 컬럼: last_synced_at, last_seen_at, last_policy_sync_at,
--      current_track_started_at, created_at, updated_at.
--
--   2) store_now_playing view (0356/0357) 가 `ss.updated_at as last_heartbeat_at` 로 **alias** 한다.
--      그러나 updated_at 은 _touch_updated_at 트리거로 **모든 UPDATE 에서 갱신**된다.
--      admin_force_store_resync / hq_force_store_resync 는
--        `set last_policy_sync_at = null, updated_at = now()` 로 heartbeat 없이 updated_at 을 올린다.
--      → store_now_playing.last_heartbeat_at 가 heartbeat 수신 없이 최신값으로 튄다 (정확성 결함).
--
--   3) _noc_store_health_score (0385:103) 는
--        `select ... last_heartbeat_at ... from public.store_policy_sync_status`
--      로 **존재하지 않는 테이블 컬럼**을 직접 조회한다 (latent 결함 — 컬럼 부재 참조).
--
--   정리: last_seen_at 자체는 store_heartbeat 만 갱신하므로 정확했다. 결함은 오직
--         (2) view alias 오염 + (3) 없는 컬럼 참조. 근본 해결 = 전용 실제 컬럼 도입.
--
-- ─────────────────────────────────────────────────────────────────
-- 수정 원칙 (절대 조건 준수)
-- ─────────────────────────────────────────────────────────────────
--   - Production 직접 적용/변경 없음 (migration 파일만 추가)
--   - 기존 Playback / Queue / Scheduler / Crossfade / 정산 / Invoice 로직 무변경
--   - 기존 RPC 보안(SECURITY DEFINER + search_path 고정 + revoke/grant) 유지·강화만
--   - idempotent (여러 번 실행 안전)
--   - heartbeat 수신 시각은 서버 now() 로만 기록 (client timestamp 미신뢰 → 미래/역행 원천 차단)

-- ============================================================
-- 1) 전용 실제 컬럼 last_heartbeat_at 추가 + 백필 + 인덱스
-- ============================================================
alter table public.store_policy_sync_status
  add column if not exists last_heartbeat_at timestamptz;

-- 백필: 과거 행은 last_seen_at(정확) → 없으면 updated_at 로 1회 채움.
update public.store_policy_sync_status
   set last_heartbeat_at = coalesce(last_seen_at, updated_at)
 where last_heartbeat_at is null;

create index if not exists idx_sync_status_last_heartbeat
  on public.store_policy_sync_status (last_heartbeat_at desc);


-- ============================================================
-- 2) 표준 heartbeat 상태 판정 (단일 진실 소스)
--    ONLINE(≤5m) · DEGRADED(≤15m) · STALE(≤24h) · OFFLINE(>24h) · UNKNOWN(null)
-- ============================================================
create or replace function public._store_heartbeat_state(p_last_heartbeat_at timestamptz)
returns text
language sql
stable          -- now() 사용 → immutable 아님 (stable)
as $$
  select case
    when p_last_heartbeat_at is null then 'UNKNOWN'
    when p_last_heartbeat_at >= now() - interval '5 minutes'  then 'ONLINE'
    when p_last_heartbeat_at >= now() - interval '15 minutes' then 'DEGRADED'
    when p_last_heartbeat_at >= now() - interval '24 hours'   then 'STALE'
    else 'OFFLINE'
  end;
$$;
comment on function public._store_heartbeat_state(timestamptz) is
  'ENTERPRISE-HQ-OPS-1 — heartbeat 신선도 표준 판정. 모든 컴포넌트가 이 함수만 사용 (임의 재계산 금지).';


-- ============================================================
-- 3) store_heartbeat RPC — last_heartbeat_at = now() 기록 + 미래 timestamp 차단
--    (0355 정의와 동일 · 시그니처/보안 불변. last_heartbeat_at 기록 + track 시작시각 클램프만 추가)
-- ============================================================
create or replace function public.store_heartbeat(
  p_store_id uuid default null,
  p_app_version text default null,
  p_battery_level int default null,
  p_volume int default null,
  p_current_track_id uuid default null,
  p_current_track_started_at timestamptz default null,
  p_device_model text default null,
  p_device_os text default null,
  p_wifi_ssid text default null,
  p_connection_type text default null,
  p_player_status text default 'playing',
  p_playback_error text default null,
  p_device_identifier text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_store uuid := coalesce(p_store_id, auth.uid());
  v_franchise_id uuid;
  -- 미래 timestamp 차단: client 가 보낸 재생 시작시각이 서버 now() 보다 미래면 now() 로 클램프.
  v_track_started timestamptz := case
    when p_current_track_started_at is not null and p_current_track_started_at > now() then now()
    else p_current_track_started_at
  end;
begin
  if v_store is null then raise exception 'unauthorized'; end if;
  if v_store <> auth.uid() and not public._is_super_admin() then
    raise exception 'forbidden: can only heartbeat own store';
  end if;
  if p_player_status is not null and p_player_status not in ('playing','paused','stopped','offline','unknown') then
    raise exception 'invalid player_status: %', p_player_status;
  end if;

  select fs.franchise_id into v_franchise_id
    from public.franchise_stores fs
   where fs.store_id = v_store and fs.status = 'active'
   limit 1;

  insert into public.store_policy_sync_status (
    store_id, franchise_id,
    player_status, current_track_id, current_track_started_at,
    last_seen_at, last_synced_at, last_heartbeat_at,
    app_version, battery_level, volume,
    device_model, device_os, device_identifier,
    wifi_ssid, connection_type, playback_error,
    last_player_version
  ) values (
    v_store, v_franchise_id,
    coalesce(p_player_status, 'unknown'),
    p_current_track_id, v_track_started,
    now(), now(), now(),
    p_app_version, p_battery_level, p_volume,
    p_device_model, p_device_os, p_device_identifier,
    p_wifi_ssid, p_connection_type, p_playback_error,
    p_app_version
  )
  on conflict (store_id) do update set
    franchise_id = coalesce(excluded.franchise_id, public.store_policy_sync_status.franchise_id),
    player_status = coalesce(excluded.player_status, public.store_policy_sync_status.player_status),
    current_track_id = excluded.current_track_id,
    current_track_started_at = coalesce(excluded.current_track_started_at, public.store_policy_sync_status.current_track_started_at),
    last_seen_at = now(),
    last_synced_at = now(),
    -- heartbeat 수신 시각은 서버 now() 로만 전진. 역행 불가(과거 now() < 현재 now()).
    last_heartbeat_at = greatest(public.store_policy_sync_status.last_heartbeat_at, now()),
    app_version = coalesce(excluded.app_version, public.store_policy_sync_status.app_version),
    battery_level = coalesce(excluded.battery_level, public.store_policy_sync_status.battery_level),
    volume = coalesce(excluded.volume, public.store_policy_sync_status.volume),
    device_model = coalesce(excluded.device_model, public.store_policy_sync_status.device_model),
    device_os = coalesce(excluded.device_os, public.store_policy_sync_status.device_os),
    device_identifier = coalesce(excluded.device_identifier, public.store_policy_sync_status.device_identifier),
    wifi_ssid = coalesce(excluded.wifi_ssid, public.store_policy_sync_status.wifi_ssid),
    connection_type = coalesce(excluded.connection_type, public.store_policy_sync_status.connection_type),
    playback_error = excluded.playback_error,
    last_player_version = coalesce(excluded.last_player_version, public.store_policy_sync_status.last_player_version),
    updated_at = now();

  return jsonb_build_object(
    'success', true, 'store_id', v_store, 'recorded_at', now(),
    'heartbeat_state', 'ONLINE'
  );
end;
$$;
revoke execute on function public.store_heartbeat(uuid, text, int, int, uuid, timestamptz, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.store_heartbeat(uuid, text, int, int, uuid, timestamptz, text, text, text, text, text, text, text) to authenticated;


-- ============================================================
-- 4) store_monitoring_status view 재정의
--    - last_heartbeat_at 실제 컬럼 노출 (ss.* 포함) + heartbeat_state 표준 컬럼 추가
--    - 기존 flag(is_online 등)는 last_seen_at 기준 유지 (회귀 0; last_seen_at==last_heartbeat_at 보장)
--    ss.* 확장 순서 변경 대비 DROP 후 CREATE (다른 view 의존 없음 — plpgsql RPC 는 런타임 참조).
-- ============================================================
drop view if exists public.store_monitoring_status;
create view public.store_monitoring_status as
  select
    ss.*,
    public._store_heartbeat_state(ss.last_heartbeat_at) as heartbeat_state,
    case when ss.last_seen_at is null then true
         when ss.last_seen_at < now() - interval '24 hours' then true
         else false end as is_offline_24h,
    case when ss.last_seen_at is not null
              and ss.last_seen_at < now() - interval '1 hour'
              and ss.last_seen_at >= now() - interval '24 hours' then true
         else false end as is_idle_1h_to_24h,
    case when ss.last_seen_at is not null
              and ss.last_seen_at < now() - interval '5 minutes'
              and ss.last_seen_at >= now() - interval '1 hour' then true
         else false end as is_idle_5m_to_1h,
    case when ss.last_seen_at is not null and ss.last_seen_at >= now() - interval '5 minutes' then true
         else false end as is_online,
    case when ss.last_policy_sync_at is null then false
         when ss.last_policy_sync_at < now() - interval '24 hours' then true
         else false end as has_policy_outdated,
    case when ss.playback_error is not null and length(btrim(ss.playback_error)) > 0 then true
         else false end as has_playback_error,
    case when ss.volume = 0 or ss.volume >= 95 then true
         else false end as has_volume_error,
    case when ss.device_identifier is null then true else false end as has_device_missing,
    case when ss.app_version is not null
              and (select value::text from public.system_settings where key='store_player_min_version') is not null
              and ss.app_version < trim(both '"' from (select value::text from public.system_settings where key='store_player_min_version'))
         then true else false end as has_update_required
  from public.store_policy_sync_status ss;

comment on view public.store_monitoring_status is
  'ENTERPRISE-HQ-OPS-1 — last_heartbeat_at 실제 컬럼 + heartbeat_state 표준 노출. flag 는 last_seen_at 기준 유지(회귀 0).';


-- ============================================================
-- 5) store_now_playing view 재정의
--    - last_heartbeat_at 소스: ss.updated_at(오염) → ss.last_heartbeat_at(실제)
--    - is_online: last_heartbeat_at 기준으로 통일 (Store Health 와 동일 기준)
--    - heartbeat_state 표준 컬럼 추가
--    joins/컬럼은 0357 정의를 그대로 재현.
-- ============================================================
drop view if exists public.store_now_playing;
create view public.store_now_playing as
  select
    ss.store_id,
    coalesce(
      bp.store_name,
      bvp.store_name,
      bvp.business_name,
      u.full_name,
      u.nickname,
      '(매장명 없음)'
    ) as store_name,
    au.email as store_email,
    ss.franchise_id,
    f.name as franchise_name,
    ss.enterprise_region_id,
    er.region_name,
    er.region_code,
    er.enterprise_account_id,
    ea.enterprise_name,
    ss.current_track_id as track_id,
    t.title as track_title,
    t.artist as artist_name,
    t.cover_url as album_art_url,
    t.duration,
    ss.current_track_started_at as started_at,
    case
      when ss.current_track_started_at is null then null
      when ss.current_track_started_at > now() then 0
      else greatest(0, extract(epoch from (now() - ss.current_track_started_at)))::int
    end as elapsed_seconds,
    case
      when t.duration is null or ss.current_track_started_at is null then null
      else greatest(0, t.duration - extract(epoch from (now() - ss.current_track_started_at)))::int
    end as remaining_seconds,
    ss.player_status,
    ss.last_seen_at,
    ss.volume,
    ss.app_version,
    ss.playback_error,
    case when ss.last_heartbeat_at is null then false
         when ss.last_heartbeat_at >= now() - interval '5 minutes' then true
         else false end as is_online,
    ss.last_heartbeat_at,
    public._store_heartbeat_state(ss.last_heartbeat_at) as heartbeat_state
  from public.store_policy_sync_status ss
  join public.users u on u.id = ss.store_id
  left join auth.users au on au.id = u.id
  left join public.business_profiles bp on bp.user_id = u.id
  left join public.business_verification_profiles bvp on bvp.user_id = u.id
  left join public.franchises f on f.id = ss.franchise_id
  left join public.enterprise_regions er on er.id = ss.enterprise_region_id
  left join public.enterprise_accounts ea on ea.id = er.enterprise_account_id
  left join public.tracks t on t.id = ss.current_track_id
  where coalesce(u.account_type, 'individual') = 'business'
    and u.withdrawn_at is null;

comment on view public.store_now_playing is
  'ENTERPRISE-HQ-OPS-1 — last_heartbeat_at 를 실제 컬럼으로 교체(resync 오염 제거). is_online/heartbeat_state 통일.';


-- ============================================================
-- 6) _noc_store_health_score 재정의
--    - last_heartbeat_at 를 실제 컬럼에서 조회(존재 컬럼 참조로 정정)
--    - heartbeat_stale 판정을 last_heartbeat_at 기준으로 통일 (Online 과 동일 소스)
--    - 점수 규칙/가중치 무변경 (회귀 0; last_heartbeat_at==last_seen_at 보장)
-- ============================================================
create or replace function public._noc_store_health_score(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_now          timestamptz := now();
  v_score        int := 100;
  v_breakdown    jsonb := '{}'::jsonb;
  v_sync         record;
  v_now_playing  record;
  v_recent_fail_emerg int := 0;
  v_recent_fail_ann   int := 0;
begin
  select last_seen_at, last_heartbeat_at, battery_level, volume,
         playback_error, app_version, last_synced_at
    into v_sync from public.store_policy_sync_status where store_id = p_store_id;

  select is_online, player_status, started_at, duration
    into v_now_playing from public.store_now_playing where store_id = p_store_id;

  -- offline (-30)
  if v_now_playing.is_online is not true then
    v_score := v_score - 30;
    v_breakdown := v_breakdown || jsonb_build_object('offline', -30);
  end if;

  -- heartbeat older than 10min (-20) — last_heartbeat_at 기준 (Online 과 동일 소스)
  if v_sync.last_heartbeat_at is null or v_sync.last_heartbeat_at < (v_now - interval '10 minutes') then
    v_score := v_score - 20;
    v_breakdown := v_breakdown || jsonb_build_object('heartbeat_stale', -20);
  end if;

  -- playback_error (-15)
  if v_sync.playback_error is not null and length(btrim(v_sync.playback_error)) > 0 then
    v_score := v_score - 15;
    v_breakdown := v_breakdown || jsonb_build_object('playback_error', -15);
  end if;

  -- battery < 20 (-5)
  if v_sync.battery_level is not null and v_sync.battery_level < 20 then
    v_score := v_score - 5;
    v_breakdown := v_breakdown || jsonb_build_object('battery_low', -5);
  end if;

  -- volume = 0 (-5)
  if v_sync.volume is not null and v_sync.volume = 0 then
    v_score := v_score - 5;
    v_breakdown := v_breakdown || jsonb_build_object('volume_zero', -5);
  end if;

  -- app_version null (-3)
  if v_sync.app_version is null then
    v_score := v_score - 3;
    v_breakdown := v_breakdown || jsonb_build_object('app_version_unknown', -3);
  end if;

  -- 최근 1시간 emergency 실패 (-10/건, max -20)
  select count(*) into v_recent_fail_emerg
    from public.enterprise_emergency_broadcast_targets
   where store_id = p_store_id and status = 'failed'
     and failed_at >= (v_now - interval '1 hour');
  if v_recent_fail_emerg > 0 then
    v_score := v_score - least(v_recent_fail_emerg * 10, 20);
    v_breakdown := v_breakdown || jsonb_build_object('emergency_failed_1h', v_recent_fail_emerg);
  end if;

  -- 최근 24h announcement 실패 (-3/건, max -10)
  select count(*) into v_recent_fail_ann
    from public.enterprise_announcement_play_logs
   where store_id = p_store_id and status = 'failed'
     and created_at >= (v_now - interval '24 hours');
  if v_recent_fail_ann > 0 then
    v_score := v_score - least(v_recent_fail_ann * 3, 10);
    v_breakdown := v_breakdown || jsonb_build_object('announcement_failed_24h', v_recent_fail_ann);
  end if;

  v_score := greatest(0, v_score);
  return jsonb_build_object('score', v_score, 'breakdown', v_breakdown);
end;
$$;


-- ============================================================
-- 7) 진단 NOTICE (적용 검증)
-- ============================================================
do $$
declare
  v_has_col boolean;
  v_null_cnt int;
begin
  select exists (
    select 1 from information_schema.columns
     where table_schema='public' and table_name='store_policy_sync_status'
       and column_name='last_heartbeat_at'
  ) into v_has_col;
  select count(*) into v_null_cnt
    from public.store_policy_sync_status where last_heartbeat_at is null;
  raise notice '[0456] last_heartbeat_at column present=% · rows still null=%', v_has_col, v_null_cnt;
end$$;
