-- 0395 — Enterprise Operations Center (Phase 2-1)
--
-- 목적:
--   관리자가 "운영 관제" 탭 하나만 열어도 전체 Enterprise 상태를 10초 안에
--   파악하도록 하는 read-only 관제 대시보드. 기존 자동화/알림/NOC/정산 로직은
--   그대로 두고, 요약 read-only RPC 4개만 신규 추가.
--
-- 절대 무수정:
--   • cron 실행 로직 (api/cron/enterprise-ops.ts) 무관
--   • NOC 탐지/생성 로직 (0385/0393) 무관
--   • Notification dispatch 로직 (0392, dispatch-admin-notifications) 무관
--   • 정책 자동화 계산 (0378) 무관
--   • 정산/청구/계약/안내방송 계산 로직 무관
--   • 기존 admin_* RPC 시그니처 무관
--
-- 재사용 (호출만, 수정 X):
--   admin_noc_kpi, admin_noc_active_alerts, admin_noc_store_health_list (0385)
--   admin_policy_automation_kpi, admin_list_policy_automation_runs (0378)
--   admin_now_playing_kpi (0376)
--
-- 신규 read-only RPC 4개 (전부 security definer + _is_super_admin 게이트):
--   §1 admin_enterprise_ops_overview            — 상단 KPI 통합
--   §2 admin_enterprise_ops_cron_status         — cron 로그 요약
--   §3 admin_enterprise_ops_notifications_summary — 알림 dispatch 요약
--   §4 admin_enterprise_ops_activity_feed       — 최근 이벤트 union 피드
--
-- 정책:
--   grant execute to authenticated (RPC 내부 _is_super_admin() 재검증)
--   revoke from public, anon
--   신규 table / view / index / trigger 없음 — 신규 스케줄러도 없음
--   기존 컬럼 alter 없음 — additive read-only 만.

-- ============================================================
-- §1. admin_enterprise_ops_overview — 상단 KPI 통합
-- ============================================================
-- 반환 예:
--   {
--     enterprise_accounts, hq_users, total_stores,
--     online_stores, offline_stores, drift_stores, failed_sync_stores,
--     noc: {critical, major, minor, ...},
--     now_playing: {total, online, offline, ...},
--     last_cron_run_at,
--     overall_status: 'healthy' | 'warning' | 'critical',
--     computed_at
--   }
create or replace function public.admin_enterprise_ops_overview()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_noc jsonb;
  v_np  jsonb;
  v_critical int;
  v_major    int;
  v_status   text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  -- 재사용 — 기존 admin RPC 를 호출만
  begin
    v_noc := public.admin_noc_kpi();
  exception when others then
    v_noc := '{}'::jsonb;
  end;
  begin
    v_np  := public.admin_now_playing_kpi();
  exception when others then
    v_np := '{}'::jsonb;
  end;

  v_critical := coalesce(nullif(v_noc->>'critical','')::int, 0);
  v_major    := coalesce(nullif(v_noc->>'major','')::int, 0);

  v_status := case
    when v_critical > 0 then 'critical'
    when v_major    > 0 then 'warning'
    else 'healthy'
  end;

  return jsonb_build_object(
    'enterprise_accounts', (
      select count(*) from public.enterprise_accounts
       where deleted_at is null
    ),
    'hq_users', (
      select count(distinct auth_user_id) from public.enterprise_accounts
       where auth_user_id is not null and deleted_at is null
    ),
    'total_stores', (
      select count(*) from public.franchise_stores
       where status = 'active'
    ),
    'online_stores', (
      select count(*) from public.store_policy_sync_status
       where last_seen_at is not null and last_seen_at >= now() - interval '5 minutes'
    ),
    'offline_stores', (
      select count(*) from public.store_policy_sync_status
       where last_seen_at is null or last_seen_at < now() - interval '5 minutes'
    ),
    'drift_stores', (
      -- policy_deployment (0359) 기준 미동기 매장 근사치.
      -- store_policy_sync_status 에 last_policy_sync_at 이 24h 이상 지난 것.
      select count(*) from public.store_policy_sync_status
       where last_policy_sync_at is null or last_policy_sync_at < now() - interval '24 hours'
    ),
    'failed_sync_stores', (
      -- 최근 24h 내 실패한 sync 이벤트 있는 매장 근사치
      -- (실제 실패 컬럼은 별도 없음 — heartbeat 이 오래된 매장으로 대체)
      select count(*) from public.store_policy_sync_status
       where last_seen_at < now() - interval '24 hours'
    ),
    'noc', v_noc,
    'now_playing', v_np,
    'last_cron_run_at', (
      select max(created_at) from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
    ),
    'overall_status', v_status,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_ops_overview() from public, anon;
grant   execute on function public.admin_enterprise_ops_overview() to authenticated;


-- ============================================================
-- §2. admin_enterprise_ops_cron_status — cron 요약
-- ============================================================
-- 반환 예:
--   {
--     last_run_at, runs_1h, runs_24h, failed_24h, last_error,
--     recent_runs: [ {created_at, level, status, message, details}, ...10 ]
--   }
create or replace function public.admin_enterprise_ops_cron_status()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_recent jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select coalesce(jsonb_agg(row) filter (where row is not null), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
      'id',         id,
      'created_at', created_at,
      'level',      level,
      'status',     status,
      'message',    left(message, 200),
      'details',    details
    ) as row
    from public.admin_operation_logs
    where source='cron' and category='enterprise_ops'
    order by created_at desc
    limit 10
  ) t;

  return jsonb_build_object(
    'last_run_at', (
      select max(created_at) from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
    ),
    'runs_1h', (
      select count(*) from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
         and created_at >= now() - interval '1 hour'
    ),
    'runs_24h', (
      select count(*) from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
         and created_at >= now() - interval '24 hours'
    ),
    'failed_24h', (
      select count(*) from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
         and created_at >= now() - interval '24 hours'
         and (status = 'failed' or level = 'error')
    ),
    'last_error', (
      select left(message, 300)
        from public.admin_operation_logs
       where source='cron' and category='enterprise_ops'
         and (status='failed' or level='error')
       order by created_at desc
       limit 1
    ),
    'recent_runs', v_recent,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_ops_cron_status() from public, anon;
grant   execute on function public.admin_enterprise_ops_cron_status() to authenticated;


-- ============================================================
-- §3. admin_enterprise_ops_notifications_summary — 알림 요약
-- ============================================================
create or replace function public.admin_enterprise_ops_notifications_summary()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_recent jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select coalesce(jsonb_agg(row) filter (where row is not null), '[]'::jsonb) into v_recent
  from (
    select jsonb_build_object(
      'id',                id,
      'kind',              kind,
      'severity',          severity,
      'title',             left(title, 120),
      'created_at',        created_at,
      'dispatched_at',     dispatched_at,
      'dispatch_slack_at', dispatch_slack_at,
      'dispatch_email_at', dispatch_email_at,
      'dispatch_attempts', dispatch_attempts,
      'dispatch_error',    left(dispatch_error, 200)
    ) as row
    from public.admin_notifications
    order by created_at desc
    limit 10
  ) t;

  return jsonb_build_object(
    'pending',    (select count(*) from public.admin_notifications where dispatched_at is null),
    'dispatched', (select count(*) from public.admin_notifications where dispatched_at is not null),
    'failed',     (select count(*) from public.admin_notifications where dispatch_error is not null),
    'slack_sent', (select count(*) from public.admin_notifications where dispatch_slack_at is not null),
    'email_sent', (select count(*) from public.admin_notifications where dispatch_email_at is not null),
    'noc_alert_count',      (select count(*) from public.admin_notifications where kind='noc_alert'),
    'dispatch_error_count', (select count(*) from public.admin_notifications where dispatch_error is not null),
    'recent',     v_recent,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_ops_notifications_summary() from public, anon;
grant   execute on function public.admin_enterprise_ops_notifications_summary() to authenticated;


-- ============================================================
-- §4. admin_enterprise_ops_activity_feed — 통합 이벤트 피드
-- ============================================================
-- 최근 이벤트를 5개 소스에서 union 하여 시간순 정렬.
--   admin_operation_logs        (source='cron' 만) → type='cron_run'
--   admin_notifications         → type='notification'
--   enterprise_policy_automation_runs → type='policy_automation'
--   enterprise_announcement_play_logs → type='announcement_play'
--   enterprise_monthly_settlements    → type='settlement_snapshot'
create or replace function public.admin_enterprise_ops_activity_feed(
  p_limit int default 20
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 20), 100));
  v_events jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with unified as (
    -- 1) cron 실행
    select 'cron_run'::text  as event_type,
           id::text          as event_id,
           created_at        as event_at,
           coalesce(nullif(message,''), 'cron run')::text as title,
           coalesce(level, 'info')::text as severity,
           jsonb_build_object('status', status) as meta
      from public.admin_operation_logs
     where source='cron' and category='enterprise_ops'
       and created_at >= now() - interval '7 days'
    union all
    -- 2) 알림
    select 'notification'::text,
           id::text,
           created_at,
           coalesce(nullif(title,''), kind)::text,
           coalesce(severity, 'info')::text,
           jsonb_build_object('kind', kind, 'dispatched', dispatched_at is not null)
      from public.admin_notifications
     where created_at >= now() - interval '7 days'
    union all
    -- 3) 정책 자동화 실행
    select 'policy_automation'::text,
           id::text,
           started_at,
           ('policy_automation ' || coalesce(status, ''))::text,
           case when status='failed' then 'error'
                when status='completed' then 'success'
                else 'info' end,
           jsonb_build_object('status', status)
      from public.enterprise_policy_automation_runs
     where started_at >= now() - interval '7 days'
    union all
    -- 4) 안내방송 재생
    select 'announcement_play'::text,
           id::text,
           coalesce(played_at, created_at),
           ('announcement ' || coalesce(status,''))::text,
           case when status='failed' then 'error'
                when status='played' then 'success'
                else 'info' end,
           jsonb_build_object('status', status, 'schedule_id', schedule_id::text)
      from public.enterprise_announcement_play_logs
     where coalesce(played_at, created_at) >= now() - interval '7 days'
    union all
    -- 5) 정산 스냅샷 생성 (Phase 1-11)
    select 'settlement_snapshot'::text,
           id::text,
           created_at,
           ('monthly settlement snapshot')::text,
           coalesce(status, 'info')::text,
           jsonb_build_object('status', status)
      from public.enterprise_monthly_settlements
     where created_at >= now() - interval '7 days'
  )
  select coalesce(jsonb_agg(row order by (row->>'event_at') desc), '[]'::jsonb) into v_events
    from (
      select jsonb_build_object(
        'type',     event_type,
        'id',       event_id,
        'at',       event_at,
        'title',    title,
        'severity', severity,
        'meta',     meta
      ) as row
      from unified
      order by event_at desc
      limit v_limit
    ) t;

  return jsonb_build_object(
    'events', v_events,
    'limit',  v_limit,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_ops_activity_feed(int) from public, anon;
grant   execute on function public.admin_enterprise_ops_activity_feed(int) to authenticated;


-- ============================================================
-- §5. Diagnostics
-- ============================================================
do $$
declare v_test jsonb;
begin
  raise notice '0395 — admin_enterprise_ops_overview compiled OK';
  raise notice '0395 — admin_enterprise_ops_cron_status compiled OK';
  raise notice '0395 — admin_enterprise_ops_notifications_summary compiled OK';
  raise notice '0395 — admin_enterprise_ops_activity_feed compiled OK';
  raise notice '0395 — 신규 table/view/index/trigger/scheduler 없음. read-only RPC 4개만 추가.';
end$$;
