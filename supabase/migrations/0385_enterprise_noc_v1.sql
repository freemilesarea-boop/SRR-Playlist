-- 0385 — Enterprise Network Operations Center V1 (Phase 8)
--
-- 실시간 운영 관제센터 — aggregation layer only.
-- 기존 도메인 (Player / Billing / Settlement / Emergency / Announcement /
-- Automation / Contracts / Deployment / Playlist / AI / Recommendation /
-- Heartbeat / Now Playing) 모두 무수정. 데이터는 기존 테이블에서 읽기만.
--
-- 추가:
--   tables (2):
--     noc_settings                — key/value (auto_recovery 등)
--     noc_notification_channels    — Slack/Discord/Email/Webhook config (V1 dummy)
--   helpers (2):
--     _noc_store_health_score(store_id)  → jsonb {score, breakdown}
--     _noc_classify_severity(...)        → text (critical|major|minor|info)
--   RPCs (9):
--     admin_noc_kpi
--     admin_noc_region_summary
--     admin_noc_active_alerts
--     admin_noc_recent_events
--     admin_noc_store_health_list
--     admin_noc_store_detail
--     admin_noc_get_settings
--     admin_noc_set_setting
--     admin_noc_list_notification_channels  (+ upsert + delete)
--
-- 절대 무수정: Player / Billing / Settlement / Emergency / Announcement /
-- Automation / Contracts / Deployment / Playlist / AI / Recommendation /
-- Heartbeat / Now Playing 모든 테이블/RPC.

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.noc_settings (
  key        text primary key,
  value      jsonb not null default '{}'::jsonb,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

create table if not exists public.noc_notification_channels (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  channel_type text not null check (channel_type in ('slack','discord','email','webhook')),
  config      jsonb not null default '{}'::jsonb,
  enabled     boolean not null default true,
  severity_filter text not null default 'critical' check (severity_filter in ('critical','major','minor','info','all')),
  created_by  uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists idx_noc_chan_enabled on public.noc_notification_channels(enabled);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_noc_chan_updated_at') then
    create trigger trg_noc_chan_updated_at before update on public.noc_notification_channels
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.noc_settings              enable row level security;
alter table public.noc_notification_channels enable row level security;

drop policy if exists noc_settings_select on public.noc_settings;
create policy noc_settings_select on public.noc_settings
  for select to authenticated using (public._is_super_admin());

drop policy if exists noc_chan_select on public.noc_notification_channels;
create policy noc_chan_select on public.noc_notification_channels
  for select to authenticated using (public._is_super_admin());

revoke insert, update, delete on public.noc_settings              from authenticated, anon;
revoke insert, update, delete on public.noc_notification_channels from authenticated, anon;

-- 기본 설정 시드
insert into public.noc_settings(key, value) values
  ('auto_recovery_enabled', 'false'::jsonb)
  on conflict (key) do nothing;

-- ============================================================
-- 3) Helper — Store Health Score (0~100)
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
  -- sync_status (heartbeat / battery / volume / playback_error)
  select last_seen_at, last_heartbeat_at, battery_level, volume,
         playback_error, app_version, last_synced_at
    into v_sync from public.store_policy_sync_status where store_id = p_store_id;

  -- now playing (album / progress / online flag)
  select is_online, player_status, started_at, duration
    into v_now_playing from public.store_now_playing where store_id = p_store_id;

  -- offline (-30)
  if v_now_playing.is_online is not true then
    v_score := v_score - 30;
    v_breakdown := v_breakdown || jsonb_build_object('offline', -30);
  end if;

  -- heartbeat older than 10min (-20)
  if v_sync.last_seen_at is null or v_sync.last_seen_at < (v_now - interval '10 minutes') then
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
-- 4) Helper — severity classifier
-- ============================================================
create or replace function public._noc_classify_severity(p_category text, p_level text)
returns text
language sql immutable as $$
  select case
    when p_category in ('emergency_broadcast.store.failed',
                        'emergency_broadcast.cancel',
                        'enterprise_policy_deployment.failed') then 'critical'
    when p_level = 'error' then 'critical'
    when p_level = 'warning' then 'major'
    when p_category like 'policy_automation.run.failed' then 'major'
    when p_category like 'announcement.%failed%' then 'major'
    when p_level = 'success' then 'info'
    else 'minor'
  end;
$$;

-- ============================================================
-- 5) RPCs — KPI + region + alerts + events + health + detail
-- ============================================================
create or replace function public.admin_noc_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_now        timestamptz := now();
  v_today_kst  timestamptz := (v_now at time zone 'Asia/Seoul')::date::timestamp at time zone 'Asia/Seoul';
  v_total      int;
  v_online     int;
  v_offline    int;
  v_emerg_active int;
  v_ann_due    int;
  v_pol_active int;
  v_pol_failed int;
  v_idle_24h   int;
  v_hb_err     int;
  v_player_err int;
  v_recent_err int;
  v_recent_ok  int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select count(*),
         count(*) filter (where is_online),
         count(*) filter (where not is_online),
         count(*) filter (where last_seen_at is not null and last_seen_at < (v_now - interval '24 hours')),
         count(*) filter (where playback_error is not null and length(btrim(playback_error)) > 0)
    into v_total, v_online, v_offline, v_idle_24h, v_player_err
    from public.store_now_playing;

  v_hb_err := (select count(*) from public.store_policy_sync_status
                where last_seen_at is not null and last_seen_at < (v_now - interval '15 minutes'));

  v_emerg_active := (select count(*) from public.enterprise_emergency_broadcasts
                      where deleted_at is null and status = 'active');
  v_ann_due := (select count(*) from public.enterprise_announcement_schedules
                 where deleted_at is null and status = 'active');
  v_pol_active := (select count(*) from public.enterprise_policy_deployments
                    where deleted_at is null and status in ('running','partial_failed'));
  v_pol_failed := (select count(*) from public.enterprise_policy_deployments
                    where deleted_at is null and status = 'failed');

  v_recent_err := (select count(*) from public.admin_operation_logs
                    where created_at >= v_today_kst and level = 'error');
  v_recent_ok  := (select count(*) from public.admin_operation_logs
                    where created_at >= v_today_kst and level = 'success'
                      and category like 'policy_automation.run.completed%');

  return jsonb_build_object(
    'total_stores',      v_total,
    'online_stores',     v_online,
    'offline_stores',    v_offline,
    'emergency_active',  v_emerg_active,
    'announcement_active', v_ann_due,
    'policy_active',     v_pol_active,
    'policy_failed',     v_pol_failed,
    'idle_24h',          v_idle_24h,
    'heartbeat_errors',  v_hb_err,
    'player_errors',     v_player_err,
    'today_incidents',   v_recent_err,
    'today_recovered',   v_recent_ok,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_noc_kpi() from public, anon;
grant   execute on function public.admin_noc_kpi() to authenticated;

create or replace function public.admin_noc_region_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with region_stats as (
    select coalesce(np.region_name, '미분류') as region_name,
           coalesce(np.region_code, '—')      as region_code,
           count(*)::int as total,
           count(*) filter (where np.is_online)::int as online,
           count(*) filter (where not np.is_online)::int as offline,
           count(*) filter (where np.playback_error is not null and length(btrim(np.playback_error)) > 0)::int as errors,
           count(*) filter (where np.last_heartbeat_at is null or np.last_heartbeat_at < now() - interval '15 minutes')::int as warnings
      from public.store_now_playing np
     group by 1, 2
     order by 1
  )
  select coalesce(jsonb_agg(to_jsonb(r) order by r.region_name), '[]'::jsonb) into v_rows from region_stats r;

  return jsonb_build_object('success', true, 'data', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_region_summary() from public, anon;
grant   execute on function public.admin_noc_region_summary() to authenticated;

create or replace function public.admin_noc_active_alerts(
  p_limit int default 50,
  p_severity text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows  jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with raw as (
    -- emergency failed (1h)
    select 'critical'::text as severity,
           'emergency_broadcast.store.failed'::text as category,
           format('긴급방송 실패 — %s', coalesce(b.title, '—')) as message,
           t.store_id, t.broadcast_id::text as ref_id,
           t.failed_at as event_at, t.error_message
      from public.enterprise_emergency_broadcast_targets t
      join public.enterprise_emergency_broadcasts b on b.id = t.broadcast_id and b.deleted_at is null
     where t.status = 'failed' and t.failed_at >= now() - interval '1 hour'
    union all
    -- heartbeat 끊김 (15min+, 어제까지)
    select 'critical', 'heartbeat_missing',
           'Heartbeat 없음 (15분 초과)',
           sps.store_id, null,
           sps.last_seen_at,
           format('last_seen=%s', coalesce(sps.last_seen_at::text, 'never'))
      from public.store_policy_sync_status sps
     where sps.last_seen_at is not null
       and sps.last_seen_at < now() - interval '15 minutes'
       and sps.last_seen_at >= now() - interval '24 hours'
    union all
    -- playback_error
    select 'critical', 'player_error',
           format('Player 오류: %s', sps.playback_error),
           sps.store_id, null,
           sps.updated_at, sps.playback_error
      from public.store_policy_sync_status sps
     where sps.playback_error is not null and length(btrim(sps.playback_error)) > 0
    union all
    -- policy deployment failed
    select 'major', 'policy_deployment_failed',
           format('정책 배포 실패 — %s', coalesce(d.deployment_name, '—')),
           t.store_id, d.id::text,
           t.failed_at, t.failure_reason
      from public.enterprise_policy_deployment_targets t
      join public.enterprise_policy_deployments d on d.id = t.deployment_id and d.deleted_at is null
     where t.status = 'failed' and t.failed_at >= now() - interval '24 hours'
    union all
    -- announcement failed (24h)
    select 'major', 'announcement_failed',
           format('안내음원 재생 실패 — %s', coalesce(a.title, '—')),
           pl.store_id, pl.schedule_id::text,
           pl.created_at, pl.error_message
      from public.enterprise_announcement_play_logs pl
      left join public.enterprise_announcement_assets a on a.id = pl.asset_id
     where pl.status = 'failed' and pl.created_at >= now() - interval '24 hours'
    union all
    -- battery low / volume zero (minor)
    select 'minor', 'battery_low',
           format('배터리 부족 (%s%%)', sps.battery_level),
           sps.store_id, null, sps.updated_at, null
      from public.store_policy_sync_status sps
     where sps.battery_level is not null and sps.battery_level < 20
    union all
    select 'minor', 'volume_zero', 'Volume 0',
           sps.store_id, null, sps.updated_at, null
      from public.store_policy_sync_status sps
     where sps.volume is not null and sps.volume = 0
  ),
  classified as (
    select r.severity, r.category, r.message, r.store_id, r.ref_id, r.event_at, r.error_message,
           np.store_name, np.franchise_name, np.region_name
      from raw r
      left join public.store_now_playing np on np.store_id = r.store_id
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'severity', c.severity, 'category', c.category, 'message', c.message,
      'store_id', c.store_id, 'store_name', c.store_name,
      'franchise_name', c.franchise_name, 'region_name', c.region_name,
      'ref_id', c.ref_id, 'event_at', c.event_at, 'error_message', c.error_message
    ) order by
      case c.severity when 'critical' then 0 when 'major' then 1 when 'minor' then 2 else 3 end,
      c.event_at desc nulls last
  ), '[]'::jsonb) into v_rows
  from (
    select * from classified
     where p_severity is null or severity = p_severity
     order by case severity when 'critical' then 0 when 'major' then 1 when 'minor' then 2 else 3 end,
              event_at desc nulls last
     limit v_limit
  ) c;

  return jsonb_build_object('success', true, 'data', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_active_alerts(int, text) from public, anon;
grant   execute on function public.admin_noc_active_alerts(int, text) to authenticated;

create or replace function public.admin_noc_recent_events(
  p_limit  int default 100,
  p_source text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rows  jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id', l.id, 'source', l.source, 'category', l.category,
      'level', l.level, 'status', l.status, 'message', l.message,
      'details', l.details, 'related_id', l.related_id,
      'created_at', l.created_at,
      'severity', public._noc_classify_severity(l.category, l.level)
    ) order by l.created_at desc
  ), '[]'::jsonb) into v_rows
  from (
    select * from public.admin_operation_logs
     where created_at >= now() - interval '24 hours'
       and (p_source is null or source = p_source)
     order by created_at desc
     limit v_limit
  ) l;

  return jsonb_build_object('success', true, 'data', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_recent_events(int, text) from public, anon;
grant   execute on function public.admin_noc_recent_events(int, text) to authenticated;

create or replace function public.admin_noc_store_health_list(
  p_limit          int default 100,
  p_min_score      int default null,
  p_max_score      int default null,
  p_franchise_id   uuid default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit int := least(greatest(coalesce(p_limit, 100), 1), 500);
  v_rows  jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with health as (
    select np.store_id, np.store_name, np.franchise_id, np.franchise_name,
           np.region_name, np.is_online, np.player_status,
           np.last_heartbeat_at,
           (public._noc_store_health_score(np.store_id))->>'score'   as score_text,
           (public._noc_store_health_score(np.store_id))->'breakdown' as breakdown
      from public.store_now_playing np
     where (p_franchise_id is null or np.franchise_id = p_franchise_id)
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'store_id', h.store_id, 'store_name', h.store_name,
      'franchise_id', h.franchise_id, 'franchise_name', h.franchise_name,
      'region_name', h.region_name, 'is_online', h.is_online,
      'player_status', h.player_status, 'last_heartbeat_at', h.last_heartbeat_at,
      'score', (h.score_text)::int, 'breakdown', h.breakdown,
      'health_tone', case
        when (h.score_text)::int >= 90 then 'green'
        when (h.score_text)::int >= 70 then 'yellow'
        when (h.score_text)::int >= 50 then 'orange'
        else 'red'
      end
    ) order by (h.score_text)::int asc
  ), '[]'::jsonb) into v_rows
  from (
    select * from health
     where (p_min_score is null or (score_text)::int >= p_min_score)
       and (p_max_score is null or (score_text)::int <= p_max_score)
     order by (score_text)::int asc
     limit v_limit
  ) h;

  return jsonb_build_object('success', true, 'data', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_store_health_list(int, int, int, uuid) from public, anon;
grant   execute on function public.admin_noc_store_health_list(int, int, int, uuid) to authenticated;

create or replace function public.admin_noc_store_detail(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_np     jsonb;
  v_sync   jsonb;
  v_health jsonb;
  v_emerg  jsonb;
  v_ann    jsonb;
  v_pol    jsonb;
  v_logs   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store_id is null then raise exception 'store_id required'; end if;

  select to_jsonb(t) into v_np from public.store_now_playing t where t.store_id = p_store_id;
  select to_jsonb(t) into v_sync from public.store_policy_sync_status t where t.store_id = p_store_id;
  v_health := public._noc_store_health_score(p_store_id);

  -- 최근 emergency targets
  select coalesce(jsonb_agg(jsonb_build_object(
    'broadcast_id', t.broadcast_id, 'title', b.title, 'status', t.status,
    'played_at', t.played_at, 'failed_at', t.failed_at, 'error', t.error_message,
    'attempts', t.attempt_count
  ) order by t.updated_at desc), '[]'::jsonb)
    into v_emerg
    from public.enterprise_emergency_broadcast_targets t
    join public.enterprise_emergency_broadcasts b on b.id = t.broadcast_id and b.deleted_at is null
   where t.store_id = p_store_id
   order by t.updated_at desc
   limit 10;

  -- 최근 announcement play logs
  select coalesce(jsonb_agg(jsonb_build_object(
    'schedule_id', pl.schedule_id, 'asset_id', pl.asset_id, 'status', pl.status,
    'played_at', pl.played_at, 'error', pl.error_message, 'created_at', pl.created_at
  ) order by pl.created_at desc), '[]'::jsonb)
    into v_ann
    from public.enterprise_announcement_play_logs pl
   where pl.store_id = p_store_id
   order by pl.created_at desc
   limit 10;

  -- 최근 policy deployment targets
  select coalesce(jsonb_agg(jsonb_build_object(
    'deployment_id', t.deployment_id, 'status', t.status,
    'failure_reason', t.failure_reason,
    'expected_version', t.expected_version_number, 'applied_version', t.applied_version_number,
    'updated_at', t.updated_at
  ) order by t.updated_at desc), '[]'::jsonb)
    into v_pol
    from public.enterprise_policy_deployment_targets t
   where t.store_id = p_store_id
   order by t.updated_at desc
   limit 10;

  -- 최근 audit logs (related_id = store)
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'source', l.source, 'category', l.category, 'level', l.level,
    'message', l.message, 'created_at', l.created_at
  ) order by l.created_at desc), '[]'::jsonb)
    into v_logs
    from public.admin_operation_logs l
   where l.related_id = p_store_id::text or l.user_id = p_store_id
   order by l.created_at desc
   limit 20;

  return jsonb_build_object(
    'success', true,
    'store_id', p_store_id,
    'now_playing', v_np,
    'sync_status', v_sync,
    'health', v_health,
    'recent_emergency', v_emerg,
    'recent_announcement', v_ann,
    'recent_policy', v_pol,
    'recent_logs', v_logs,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_noc_store_detail(uuid) from public, anon;
grant   execute on function public.admin_noc_store_detail(uuid) to authenticated;

-- ============================================================
-- 6) Settings + Notification channels
-- ============================================================
create or replace function public.admin_noc_get_settings()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_rows from public.noc_settings;
  return jsonb_build_object('success', true, 'settings', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_get_settings() from public, anon;
grant   execute on function public.admin_noc_get_settings() to authenticated;

create or replace function public.admin_noc_set_setting(p_key text, p_value jsonb)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_before jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if nullif(btrim(coalesce(p_key, '')), '') is null then raise exception 'key required'; end if;
  select value into v_before from public.noc_settings where key = p_key;
  insert into public.noc_settings(key, value, updated_by, updated_at)
    values (p_key, coalesce(p_value, '{}'::jsonb), auth.uid(), now())
    on conflict (key) do update set
      value = excluded.value,
      updated_by = excluded.updated_by,
      updated_at = now();
  perform public.admin_log_operation(
    'noc', 'noc.setting.update', 'info', 'updated',
    format('NOC setting updated — %s', p_key),
    jsonb_build_object('key', p_key, 'before', v_before, 'after', p_value),
    auth.uid(), p_key, null, null, null
  );
  return jsonb_build_object('success', true, 'key', p_key, 'value', p_value);
end;
$$;
revoke execute on function public.admin_noc_set_setting(text, jsonb) from public, anon;
grant   execute on function public.admin_noc_set_setting(text, jsonb) to authenticated;

create or replace function public.admin_noc_list_notification_channels()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb)
    into v_rows from public.noc_notification_channels c;
  return jsonb_build_object('success', true, 'data', v_rows, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_noc_list_notification_channels() from public, anon;
grant   execute on function public.admin_noc_list_notification_channels() to authenticated;

create or replace function public.admin_noc_upsert_notification_channel(
  p_id              uuid    default null,
  p_name            text    default null,
  p_channel_type    text    default null,
  p_config          jsonb   default '{}'::jsonb,
  p_enabled         boolean default true,
  p_severity_filter text    default 'critical'
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_channel_type not in ('slack','discord','email','webhook') then
    raise exception 'invalid channel_type: %', p_channel_type;
  end if;
  if p_severity_filter not in ('critical','major','minor','info','all') then
    raise exception 'invalid severity_filter: %', p_severity_filter;
  end if;
  if p_id is null then
    insert into public.noc_notification_channels(name, channel_type, config, enabled, severity_filter, created_by)
      values (p_name, p_channel_type, p_config, p_enabled, p_severity_filter, auth.uid())
      returning id into v_id;
  else
    update public.noc_notification_channels
       set name = coalesce(p_name, name),
           channel_type = coalesce(p_channel_type, channel_type),
           config = coalesce(p_config, config),
           enabled = coalesce(p_enabled, enabled),
           severity_filter = coalesce(p_severity_filter, severity_filter),
           updated_at = now()
     where id = p_id returning id into v_id;
    if v_id is null then raise exception 'channel not found: %', p_id; end if;
  end if;
  perform public.admin_log_operation(
    'noc', 'noc.channel.upsert', 'info', 'saved',
    format('NOC notification channel saved — %s [%s]', p_name, p_channel_type),
    jsonb_build_object('channel_id', v_id, 'name', p_name, 'type', p_channel_type, 'enabled', p_enabled),
    auth.uid(), v_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'channel_id', v_id);
end;
$$;
revoke execute on function public.admin_noc_upsert_notification_channel(uuid, text, text, jsonb, boolean, text) from public, anon;
grant   execute on function public.admin_noc_upsert_notification_channel(uuid, text, text, jsonb, boolean, text) to authenticated;

create or replace function public.admin_noc_delete_notification_channel(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  delete from public.noc_notification_channels where id = p_id;
  if not found then raise exception 'channel not found: %', p_id; end if;
  perform public.admin_log_operation(
    'noc', 'noc.channel.delete', 'warning', 'deleted',
    format('NOC notification channel deleted — id=%s', p_id),
    jsonb_build_object('channel_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'channel_id', p_id);
end;
$$;
revoke execute on function public.admin_noc_delete_notification_channel(uuid) from public, anon;
grant   execute on function public.admin_noc_delete_notification_channel(uuid) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_t int; v_rpc int;
begin
  select count(*) into v_t from pg_class where relname in ('noc_settings','noc_notification_channels');
  select count(*) into v_rpc from pg_proc where pronamespace='public'::regnamespace and proname in (
    '_noc_store_health_score','_noc_classify_severity',
    'admin_noc_kpi','admin_noc_region_summary','admin_noc_active_alerts',
    'admin_noc_recent_events','admin_noc_store_health_list','admin_noc_store_detail',
    'admin_noc_get_settings','admin_noc_set_setting',
    'admin_noc_list_notification_channels','admin_noc_upsert_notification_channel',
    'admin_noc_delete_notification_channel'
  );
  raise notice '====== 0385 Enterprise NOC V1 ======';
  raise notice 'tables: % / 2', v_t;
  raise notice 'rpcs + helpers: % / 13', v_rpc;
  if v_t = 2 and v_rpc >= 13 then
    raise notice '0385 COMPLETE — NOC aggregation layer ready';
    raise notice 'NOTE: aggregation only. No domain table modifications.';
  else
    raise warning '0385 INCOMPLETE';
  end if;
end$$;
