-- 0354 — Phase 1-3 Hotfix
--
-- 문제:
--   0353 의 ALTER TABLE store_policy_sync_status (복합 다중 ADD COLUMN, 13개)
--   가 Supabase Dashboard SQL Editor 에서 적용되지 않음. RPC/view/system_settings
--   는 정상 생성됨. 원인: 단일 ALTER + 콤마 다중 ADD COLUMN + FK + CHECK
--   조합의 silent failure 추정.
--
-- 수정:
--   각 ADD COLUMN 을 **개별 ALTER TABLE 문**으로 분리. idempotent (IF NOT EXISTS).
--   기존에 어떤 컬럼이 일부 적용됐어도 안전. 정상 적용된 컬럼은 skip.
--
-- 절대 안전:
--   - 모두 nullable
--   - 기존 컬럼 무수정
--   - FK / CHECK 조건은 0353 과 동일

alter table public.store_policy_sync_status
  add column if not exists enterprise_region_id uuid references public.enterprise_regions(id) on delete set null;

alter table public.store_policy_sync_status
  add column if not exists last_policy_sync_at timestamptz;

alter table public.store_policy_sync_status
  add column if not exists last_player_version text;

alter table public.store_policy_sync_status
  add column if not exists device_model text;

alter table public.store_policy_sync_status
  add column if not exists device_os text;

alter table public.store_policy_sync_status
  add column if not exists battery_level integer;

-- 기존 컬럼에 CHECK 추가 (idempotent — DO block 으로 중복 방지)
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_policy_sync_status_battery_level_check'
  ) then
    alter table public.store_policy_sync_status
      add constraint store_policy_sync_status_battery_level_check
      check (battery_level is null or (battery_level between 0 and 100));
  end if;
end$$;

alter table public.store_policy_sync_status
  add column if not exists volume integer;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'store_policy_sync_status_volume_check'
  ) then
    alter table public.store_policy_sync_status
      add constraint store_policy_sync_status_volume_check
      check (volume is null or (volume between 0 and 100));
  end if;
end$$;

alter table public.store_policy_sync_status
  add column if not exists current_track_started_at timestamptz;

alter table public.store_policy_sync_status
  add column if not exists playback_error text;

alter table public.store_policy_sync_status
  add column if not exists connection_type text;

alter table public.store_policy_sync_status
  add column if not exists wifi_ssid text;

alter table public.store_policy_sync_status
  add column if not exists app_version text;

alter table public.store_policy_sync_status
  add column if not exists device_identifier text;

-- 인덱스 재시도 (0353 에서 누락됐을 수 있음)
create index if not exists idx_sync_status_enterprise_region
  on public.store_policy_sync_status (enterprise_region_id) where enterprise_region_id is not null;
create index if not exists idx_sync_status_playback_error
  on public.store_policy_sync_status (store_id) where playback_error is not null;
create index if not exists idx_sync_status_policy_sync
  on public.store_policy_sync_status (last_policy_sync_at);

-- view 재정의 (신규 컬럼 의존 — 0353 에서 컬럼 누락 시 view 도 옛 컬럼 기준일 수 있음)
create or replace view public.store_monitoring_status as
  select
    ss.*,
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

-- 진단 출력 — 적용 후 즉시 확인용
do $$
declare v_count int;
begin
  select count(*) into v_count
    from information_schema.columns
   where table_schema='public' and table_name='store_policy_sync_status'
     and column_name in (
       'enterprise_region_id','last_policy_sync_at','battery_level','volume','app_version',
       'playback_error','device_identifier','device_model','device_os','wifi_ssid',
       'connection_type','last_player_version','current_track_started_at'
     );
  raise notice 'Phase 1-3 hotfix: store_policy_sync_status 신규 컬럼 % / 13 적용', v_count;
  if v_count <> 13 then
    raise warning 'Phase 1-3 hotfix: 일부 컬럼 누락 — 운영자 확인 필요';
  end if;
end$$;
