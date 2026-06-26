-- 0353 — Enterprise Phase 1-3: 매장 상태 모니터링 (Store Operations Monitoring)
--
-- 목표:
--   모든 매장의 실시간 상태(online/offline/error/policy_sync 등) 운영 관제.
--   향후 현재 재생곡 / 정책 배포 / 긴급 방송 / AI 추천의 기반.
--
-- 설계 결정:
--   - 기존 store_policy_sync_status (X6.89) 가 이미 heartbeat 인프라 보유 → 확장
--   - 중복 heartbeat 인프라 만들지 않음 (사용자 spec "중복 heartbeat 구현 금지")
--   - stores 테이블은 DEUDDA 에 없음 (= users.id 기반). 신규 컬럼은 sync_status 에.
--   - enterprise_region_id (Phase 1-2 FK) 추가 — 향후 매장 ↔ 지역 매핑
--   - status 는 계산식 (last_seen + playback_error 등) 으로 RPC 에서 동적 산출
--
-- 절대 금지:
--   - 기존 update_store_player_heartbeat 제거 X (backward compat)
--   - 기존 useFranchisePolicySync hook 제거 X (수정만)
--   - users / playlists / stores 무수정
--   - hard delete 미사용

-- ============================================================
-- 1) system_settings 테이블 (앱 운영 버전 등 전역 설정)
-- ============================================================
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id) on delete set null
);

-- 초기 데이터: 현재 운영 app_version (없으면)
insert into public.system_settings (key, value, description)
values ('store_player_min_version', '"0.1.0"'::jsonb, '매장 플레이어 최소 권장 버전 — 이보다 낮으면 update_required')
on conflict (key) do nothing;

alter table public.system_settings enable row level security;

drop policy if exists system_settings_admin_read on public.system_settings;
create policy system_settings_admin_read on public.system_settings
  for select using (public._is_super_admin() or true);  -- 읽기는 인증 사용자 모두 (앱 버전 체크용)

revoke insert, update, delete on public.system_settings from authenticated, anon;


-- ============================================================
-- 2) store_policy_sync_status ALTER — Phase 1-3 신규 컬럼
-- ============================================================
alter table public.store_policy_sync_status
  add column if not exists enterprise_region_id uuid references public.enterprise_regions(id) on delete set null,
  add column if not exists last_policy_sync_at timestamptz,
  add column if not exists last_player_version text,
  add column if not exists device_model text,
  add column if not exists device_os text,
  add column if not exists battery_level integer check (battery_level is null or (battery_level between 0 and 100)),
  add column if not exists volume integer check (volume is null or (volume between 0 and 100)),
  add column if not exists current_track_started_at timestamptz,
  add column if not exists playback_error text,
  add column if not exists connection_type text,
  add column if not exists wifi_ssid text,
  add column if not exists app_version text,
  add column if not exists device_identifier text;

create index if not exists idx_sync_status_enterprise_region
  on public.store_policy_sync_status (enterprise_region_id) where enterprise_region_id is not null;
create index if not exists idx_sync_status_playback_error
  on public.store_policy_sync_status (store_id) where playback_error is not null;
create index if not exists idx_sync_status_policy_sync
  on public.store_policy_sync_status (last_policy_sync_at);


-- ============================================================
-- 3) store_heartbeat RPC — 신규 (확장 heartbeat)
--    기존 update_store_player_heartbeat 는 보존 (backward compat)
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
  v_region_id uuid;
begin
  if v_store is null then raise exception 'unauthorized'; end if;
  if v_store <> auth.uid() and not public._is_super_admin() then
    raise exception 'forbidden: can only heartbeat own store';
  end if;
  if p_player_status is not null and p_player_status not in ('playing','paused','stopped','offline','unknown') then
    raise exception 'invalid player_status: %', p_player_status;
  end if;

  -- franchise_id / enterprise_region_id 자동 추론 (있을 경우)
  select fs.franchise_id, fs.region_id into v_franchise_id, v_region_id
    from public.franchise_stores fs
   where fs.store_id = v_store and fs.status = 'active'
   limit 1;
  -- region_id 는 franchise_regions 기반 (X6.89). enterprise_regions 와 별개라
  -- 이 hook 에서는 자동 연결 안 함 (운영자가 수동 매핑 시 enterprise_region_id 설정).

  insert into public.store_policy_sync_status (
    store_id, franchise_id,
    player_status, current_track_id, current_track_started_at,
    last_seen_at, last_synced_at,
    app_version, battery_level, volume,
    device_model, device_os, device_identifier,
    wifi_ssid, connection_type, playback_error,
    last_player_version
  ) values (
    v_store, v_franchise_id,
    coalesce(p_player_status, 'unknown'),
    p_current_track_id, p_current_track_started_at,
    now(), now(),
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
    app_version = coalesce(excluded.app_version, public.store_policy_sync_status.app_version),
    battery_level = coalesce(excluded.battery_level, public.store_policy_sync_status.battery_level),
    volume = coalesce(excluded.volume, public.store_policy_sync_status.volume),
    device_model = coalesce(excluded.device_model, public.store_policy_sync_status.device_model),
    device_os = coalesce(excluded.device_os, public.store_policy_sync_status.device_os),
    device_identifier = coalesce(excluded.device_identifier, public.store_policy_sync_status.device_identifier),
    wifi_ssid = coalesce(excluded.wifi_ssid, public.store_policy_sync_status.wifi_ssid),
    connection_type = coalesce(excluded.connection_type, public.store_policy_sync_status.connection_type),
    playback_error = excluded.playback_error,  -- 명시적 null 가능 (에러 해제 신호)
    last_player_version = coalesce(excluded.last_player_version, public.store_policy_sync_status.last_player_version),
    updated_at = now();

  return jsonb_build_object('success', true, 'store_id', v_store, 'recorded_at', now());
end;
$$;
revoke execute on function public.store_heartbeat(uuid, text, int, int, uuid, timestamptz, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.store_heartbeat(uuid, text, int, int, uuid, timestamptz, text, text, text, text, text, text, text) to authenticated;


-- ============================================================
-- 4) Status 계산 view — 단일 source of truth
--    여러 issue 가 있으면 최상위만 status 로 표시.
--    issue_flags 는 모든 issue 를 array 로 노출 (KPI 카운트용).
-- ============================================================
create or replace view public.store_monitoring_status as
  select
    ss.*,
    -- 컴포넌트별 flag
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
  'Phase 1-3 — 매장 상태 계산 view. 모든 issue flag 를 RPC/UI 에서 재사용.';


-- ============================================================
-- 5) admin_store_monitoring_kpi
-- ============================================================
create or replace function public.admin_store_monitoring_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  return jsonb_build_object(
    'total', (select count(*) from public.store_monitoring_status),
    'online', (select count(*) from public.store_monitoring_status where is_online),
    'idle_1h', (select count(*) from public.store_monitoring_status where is_idle_5m_to_1h),
    'idle_24h', (select count(*) from public.store_monitoring_status where is_idle_1h_to_24h),
    'offline', (select count(*) from public.store_monitoring_status where is_offline_24h),
    'policy_outdated', (select count(*) from public.store_monitoring_status where has_policy_outdated),
    'playback_errors', (select count(*) from public.store_monitoring_status where has_playback_error),
    'volume_errors', (select count(*) from public.store_monitoring_status where has_volume_error),
    'device_missing', (select count(*) from public.store_monitoring_status where has_device_missing),
    'update_required', (select count(*) from public.store_monitoring_status where has_update_required),
    'computed_at', now(),
    'thresholds', jsonb_build_object(
      'online_seconds', 300,
      'idle_1h_seconds', 3600,
      'offline_seconds', 86400,
      'policy_outdated_seconds', 86400
    )
  );
end;
$$;
revoke execute on function public.admin_store_monitoring_kpi() from public, anon;
grant execute on function public.admin_store_monitoring_kpi() to authenticated;


-- ============================================================
-- 6) admin_list_store_monitoring (검색 + 필터 + 정렬 + 페이지네이션)
-- ============================================================
create or replace function public.admin_list_store_monitoring(
  p_search text default null,
  p_status text default null,                    -- online|idle_1h|idle_24h|offline
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_sort text default 'last_seen',               -- last_seen | name | status
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select
      sms.*,
      u.email as store_email,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(u.business_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
      )
  )
  select count(*) into v_total from base;

  with base as (
    select
      sms.*,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      u.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(u.business_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
      )
    order by
      case when p_sort = 'name' then store_name end asc nulls last,
      case when p_sort = 'status' then
        case
          when has_playback_error then 0
          when is_offline_24h then 1
          when is_idle_1h_to_24h then 2
          when has_policy_outdated then 3
          when is_idle_5m_to_1h then 4
          when is_online then 5
          else 6
        end
      end asc nulls last,
      coalesce(last_seen_at, '1970-01-01'::timestamptz) desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(base)), '[]'::jsonb) into v_rows from base;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.admin_list_store_monitoring(text, text, uuid, uuid, text, int, int) from public, anon;
grant execute on function public.admin_list_store_monitoring(text, text, uuid, uuid, text, int, int) to authenticated;


-- ============================================================
-- 7) admin_assign_store_to_enterprise_region
--    매장 ↔ 지역 매핑 (수동 — Phase 1-3 단순화).
--    Phase 1-4 또는 별도 PR 에서 batch / 자동 매핑 추가 가능.
-- ============================================================
create or replace function public.admin_assign_store_to_enterprise_region(
  p_store_id uuid, p_enterprise_region_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  -- store_id 는 반드시 business 사용자
  if not exists (
    select 1 from public.users where id = p_store_id and account_type = 'business' and withdrawn_at is null
  ) then raise exception 'store user not found or not business: %', p_store_id; end if;
  -- region 존재 확인 (null 은 unassign 허용)
  if p_enterprise_region_id is not null then
    if not exists (select 1 from public.enterprise_regions where id = p_enterprise_region_id and deleted_at is null) then
      raise exception 'enterprise_region not found: %', p_enterprise_region_id;
    end if;
  end if;

  insert into public.store_policy_sync_status (store_id, enterprise_region_id)
  values (p_store_id, p_enterprise_region_id)
  on conflict (store_id) do update set
    enterprise_region_id = excluded.enterprise_region_id,
    updated_at = now();

  perform public.admin_log_operation(
    'store_policy_sync_status', 'admin', 'success', 'region_assigned',
    format('Assigned store %s to region %s', p_store_id, coalesce(p_enterprise_region_id::text, '(unassigned)')),
    jsonb_build_object('action', 'store_monitoring.assign_region',
      'store_id', p_store_id, 'enterprise_region_id', p_enterprise_region_id),
    auth.uid(), p_store_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'store_id', p_store_id, 'enterprise_region_id', p_enterprise_region_id);
end;
$$;
revoke execute on function public.admin_assign_store_to_enterprise_region(uuid, uuid) from public, anon;
grant execute on function public.admin_assign_store_to_enterprise_region(uuid, uuid) to authenticated;


-- ============================================================
-- 8) admin_force_store_resync — 강제 정책 재동기화 (next poll 에서 적용)
-- ============================================================
create or replace function public.admin_force_store_resync(p_store_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.store_policy_sync_status
     set last_policy_sync_at = null, updated_at = now()
   where store_id = p_store_id;
  if not found then raise exception 'store not found in monitoring: %', p_store_id; end if;

  perform public.admin_log_operation(
    'store_policy_sync_status', 'admin', 'info', 'force_resync',
    format('Forced policy resync for store %s', p_store_id),
    jsonb_build_object('action', 'store_monitoring.force_resync', 'store_id', p_store_id),
    auth.uid(), p_store_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'store_id', p_store_id);
end;
$$;
revoke execute on function public.admin_force_store_resync(uuid) from public, anon;
grant execute on function public.admin_force_store_resync(uuid) to authenticated;


comment on column public.store_policy_sync_status.enterprise_region_id is
  'Phase 1-3 — 본사 지역 매핑 (nullable, 운영자 수동 또는 향후 자동 매핑)';
