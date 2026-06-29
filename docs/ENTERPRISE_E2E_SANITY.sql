-- ============================================================================
-- Enterprise E2E Sanity SQL  (run as super admin in Supabase SQL Editor)
-- ============================================================================
-- 최근 8개 migration (0378-0385) 적용 상태 + 핵심 데이터 존재 확인 + 시나리오 검증.
-- 모든 쿼리는 read-only. 운영 데이터 변경 없음.
--
-- 실행 방법:
--   1) 각 섹션을 순서대로 Supabase SQL Editor 에 붙여넣고 실행
--   2) 결과를 ENTERPRISE_E2E_CHECKLIST.md 에 기록
-- ============================================================================


-- ============================================================================
-- §1. Migration 적용 여부
-- ============================================================================

-- 0378 — Policy Automation
select 'rules table'        as obj, count(*) as ok from pg_class where relname='enterprise_policy_automation_rules'
union all select 'runs table',         count(*) from pg_class where relname='enterprise_policy_automation_runs'
union all select 'list rules RPC',     count(*) from pg_proc where proname='admin_list_policy_automation_rules'
union all select 'evaluate RPC',       count(*) from pg_proc where proname='admin_evaluate_policy_automation_rules'
union all select 'run_now RPC',        count(*) from pg_proc where proname='admin_run_policy_automation_rule_now'
union all select 'compute_next_run helper', count(*) from pg_proc where proname='_policy_automation_compute_next_run';

-- 0379 — Deployable Playlist from Source
select 'fmp.source_playlist_id col' as obj,
       count(*) as ok
  from information_schema.columns
 where table_schema='public' and table_name='franchise_music_policies' and column_name='source_playlist_id'
union all select 'fmp.source_type col',
       count(*) from information_schema.columns
 where table_schema='public' and table_name='franchise_music_policies' and column_name='source_type'
union all select 'admin_list_available_playlists_for_deployment',
       count(*) from pg_proc where proname='admin_list_available_playlists_for_deployment'
union all select 'admin_create_franchise_music_policy_from_playlist',
       count(*) from pg_proc where proname='admin_create_franchise_music_policy_from_playlist';

-- 0380 — CTE scope hotfix (signature 보존 — proname 동일, 본문만 교체)
select 'admin_list_deployable_policies (post-0380)' as obj,
       count(*) as ok from pg_proc where proname='admin_list_deployable_policies';
-- 본문 안에 'total_cte' 가 있으면 0380 적용된 상태
select 'admin_list_deployable_policies body has total_cte' as obj,
       case when exists (
         select 1 from pg_proc
          where proname='admin_list_deployable_policies'
            and prosrc ilike '%total_cte%'
       ) then 1 else 0 end as ok;

-- 0381 — Announcement Audio Scheduler
select 'assets table'      as obj, count(*) as ok from pg_class where relname='enterprise_announcement_assets'
union all select 'schedules table',    count(*) from pg_class where relname='enterprise_announcement_schedules'
union all select 'play_logs table',    count(*) from pg_class where relname='enterprise_announcement_play_logs'
union all select '_announcement_is_due_now', count(*) from pg_proc where proname='_announcement_is_due_now'
union all select 'admin_create_announcement_asset', count(*) from pg_proc where proname='admin_create_announcement_asset'
union all select 'store_get_due_announcements', count(*) from pg_proc where proname='store_get_due_announcements'
union all select 'store_mark_announcement_played', count(*) from pg_proc where proname='store_mark_announcement_played'
union all select 'enterprise-announcements bucket', count(*) from storage.buckets where id='enterprise-announcements';

-- 0382 — Billing Invoices
select 'invoices table'    as obj, count(*) as ok from pg_class where relname='enterprise_billing_invoices'
union all select 'items table',           count(*) from pg_class where relname='enterprise_billing_invoice_items'
union all select '_enterprise_active_store_count', count(*) from pg_proc where proname='_enterprise_active_store_count'
union all select '_enterprise_monthly_store_price', count(*) from pg_proc where proname='_enterprise_monthly_store_price'
union all select 'admin_generate_enterprise_billing_invoice', count(*) from pg_proc where proname='admin_generate_enterprise_billing_invoice'
union all select 'admin_list_enterprise_billing_invoices', count(*) from pg_proc where proname='admin_list_enterprise_billing_invoices'
union all select 'get_my_enterprise_billing_summary', count(*) from pg_proc where proname='get_my_enterprise_billing_summary';

-- 0383 — Contracts
select 'contracts table'   as obj, count(*) as ok from pg_class where relname='enterprise_contracts'
union all select 'contract_files table',  count(*) from pg_class where relname='enterprise_contract_files'
union all select '_enterprise_active_contract', count(*) from pg_proc where proname='_enterprise_active_contract'
union all select '_enterprise_effective_commission_rate', count(*) from pg_proc where proname='_enterprise_effective_commission_rate'
union all select 'admin_create_enterprise_contract', count(*) from pg_proc where proname='admin_create_enterprise_contract'
union all select 'admin_contract_kpi', count(*) from pg_proc where proname='admin_contract_kpi'
union all select 'get_my_enterprise_contract', count(*) from pg_proc where proname='get_my_enterprise_contract'
union all select 'enterprise-contracts bucket', count(*) from storage.buckets where id='enterprise-contracts';

-- 확인: 0383 가 0382 helper 를 contract-aware 로 교체했는지
select '_enterprise_monthly_store_price uses contract (post-0383)' as obj,
       case when exists (
         select 1 from pg_proc
          where proname='_enterprise_monthly_store_price'
            and prosrc ilike '%_enterprise_active_contract%'
       ) then 1 else 0 end as ok;

-- 0384 — Emergency Broadcast
select 'broadcasts table'  as obj, count(*) as ok from pg_class where relname='enterprise_emergency_broadcasts'
union all select 'targets table',         count(*) from pg_class where relname='enterprise_emergency_broadcast_targets'
union all select '_emergency_resolve_target_stores', count(*) from pg_proc where proname='_emergency_resolve_target_stores'
union all select 'admin_create_emergency_broadcast', count(*) from pg_proc where proname='admin_create_emergency_broadcast'
union all select 'admin_activate_emergency_broadcast', count(*) from pg_proc where proname='admin_activate_emergency_broadcast'
union all select 'store_get_active_emergency_broadcasts', count(*) from pg_proc where proname='store_get_active_emergency_broadcasts'
union all select 'store_mark_emergency_broadcast_status', count(*) from pg_proc where proname='store_mark_emergency_broadcast_status';

-- 0385 — NOC
select 'noc_settings table' as obj, count(*) as ok from pg_class where relname='noc_settings'
union all select 'noc_notification_channels table', count(*) from pg_class where relname='noc_notification_channels'
union all select '_noc_store_health_score', count(*) from pg_proc where proname='_noc_store_health_score'
union all select 'admin_noc_kpi', count(*) from pg_proc where proname='admin_noc_kpi'
union all select 'admin_noc_active_alerts', count(*) from pg_proc where proname='admin_noc_active_alerts'
union all select 'admin_noc_store_detail', count(*) from pg_proc where proname='admin_noc_store_detail';


-- ============================================================================
-- §2. RLS 활성화 확인
-- ============================================================================
select tablename, rowsecurity
  from pg_tables
 where schemaname='public'
   and tablename in (
     'enterprise_policy_automation_rules', 'enterprise_policy_automation_runs',
     'enterprise_announcement_assets', 'enterprise_announcement_schedules',
     'enterprise_announcement_play_logs',
     'enterprise_billing_invoices', 'enterprise_billing_invoice_items',
     'enterprise_contracts', 'enterprise_contract_files',
     'enterprise_emergency_broadcasts', 'enterprise_emergency_broadcast_targets',
     'noc_settings', 'noc_notification_channels'
   )
 order by tablename;
-- 모든 row 의 rowsecurity = true 여야 함.


-- ============================================================================
-- §3. RPC grant 확인
-- ============================================================================
select p.proname,
       pg_get_function_identity_arguments(p.oid) as args,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_can_execute
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'admin_list_policy_automation_rules', 'admin_policy_automation_kpi',
     'admin_evaluate_policy_automation_rules', 'admin_run_policy_automation_rule_now',
     'admin_list_available_playlists_for_deployment',
     'admin_create_franchise_music_policy_from_playlist',
     'admin_list_deployable_policies',
     'admin_list_announcement_assets', 'admin_create_announcement_asset',
     'admin_list_announcement_schedules', 'admin_create_announcement_schedule',
     'store_get_due_announcements', 'store_mark_announcement_played',
     'admin_generate_enterprise_billing_invoice',
     'admin_list_enterprise_billing_invoices',
     'admin_get_enterprise_billing_invoice_detail',
     'admin_issue_enterprise_billing_invoice',
     'admin_mark_enterprise_billing_invoice_paid',
     'admin_cancel_enterprise_billing_invoice',
     'admin_mark_enterprise_billing_overdue',
     'admin_update_enterprise_billing_invoice_adjustments',
     'get_my_enterprise_billing_summary',
     'admin_list_enterprise_contracts', 'admin_create_enterprise_contract',
     'admin_update_enterprise_contract', 'admin_set_enterprise_contract_status',
     'admin_soft_delete_enterprise_contract',
     'admin_upload_contract_file', 'admin_delete_contract_file',
     'admin_contract_kpi', 'get_my_enterprise_contract',
     'admin_list_emergency_broadcasts', 'admin_get_emergency_broadcast_detail',
     'admin_create_emergency_broadcast', 'admin_activate_emergency_broadcast',
     'admin_cancel_emergency_broadcast', 'admin_complete_emergency_broadcast',
     'admin_emergency_broadcast_kpi',
     'store_get_active_emergency_broadcasts', 'store_mark_emergency_broadcast_status',
     'admin_noc_kpi', 'admin_noc_region_summary', 'admin_noc_active_alerts',
     'admin_noc_recent_events', 'admin_noc_store_health_list', 'admin_noc_store_detail',
     'admin_noc_get_settings', 'admin_noc_set_setting',
     'admin_noc_list_notification_channels',
     'admin_noc_upsert_notification_channel',
     'admin_noc_delete_notification_channel'
   )
 order by p.proname;
-- authenticated_can_execute 가 true 가 아닌 RPC 가 있으면 hotfix 필요.


-- ============================================================================
-- §4. 테스트 데이터 점검
-- ============================================================================
select 'enterprise_accounts (active)' as kind, count(*) as cnt
  from public.enterprise_accounts where deleted_at is null and status in ('active','invited')
union all select 'active franchise_stores',
       count(*) from public.franchise_stores where status = 'active'
union all select 'playlists (any)',
       count(*) from public.playlists
union all select 'franchise_music_policies (deployable)',
       count(*) from public.franchise_music_policies where status in ('active','draft')
union all select 'franchise_music_policies linked to playlist (post-0379)',
       count(*) from public.franchise_music_policies where source_playlist_id is not null
union all select 'enterprise_announcement_assets (active)',
       count(*) from public.enterprise_announcement_assets where deleted_at is null and status = 'active'
union all select 'enterprise_announcement_schedules (active)',
       count(*) from public.enterprise_announcement_schedules where deleted_at is null and status = 'active'
union all select 'enterprise_contracts (any)',
       count(*) from public.enterprise_contracts where deleted_at is null
union all select 'enterprise_billing_invoices (any)',
       count(*) from public.enterprise_billing_invoices where deleted_at is null
union all select 'enterprise_emergency_broadcasts (any)',
       count(*) from public.enterprise_emergency_broadcasts where deleted_at is null
union all select 'enterprise_policy_automation_rules (any)',
       count(*) from public.enterprise_policy_automation_rules where deleted_at is null;


-- ============================================================================
-- §5. 시나리오 sanity (read-only smoke tests)
-- ============================================================================

-- A. 배포 플레이리스트 풀 조회
select jsonb_pretty(public.admin_list_available_playlists_for_deployment(null, null, 5, 0)) as available_playlists;

-- A. deployable_policies dropdown (post-0380 CTE scope fix)
select jsonb_pretty(public.admin_list_deployable_policies(null, null, null, 5, 0)) as deployable_policies;

-- B. Policy Automation KPI
select jsonb_pretty(public.admin_policy_automation_kpi()) as automation_kpi;
-- evaluate dry run (실제 실행 X)
select jsonb_pretty(public.admin_evaluate_policy_automation_rules(true, now())) as evaluate_dry_run;

-- C. 음악 배포 현황 overview + failed stores
select jsonb_pretty(public.admin_policy_deployment_overview()) as deployment_overview;
select jsonb_pretty(public.admin_policy_deployment_failed_stores(null, null, null, null, null, null, null, 5, 0)) as failed_stores;

-- D. 안내음원 due check (특정 store_id 로 호출 시 admin 만 가능)
-- 매장 본인이 호출: select jsonb_pretty(public.store_get_due_announcements());
-- 관리자 점검:     select jsonb_pretty(public.store_get_due_announcements('<store_id>'));

-- E. Emergency KPI
select jsonb_pretty(public.admin_emergency_broadcast_kpi()) as emergency_kpi;

-- F. Contract KPI + HQ summary
select jsonb_pretty(public.admin_contract_kpi()) as contract_kpi;
-- HQ 본인이 호출: select jsonb_pretty(public.get_my_enterprise_contract());

-- G. Billing KPI / summary
-- (Billing 은 list/detail/kpi 별도 RPC 없이 list 가 모든 상태 반환)
select jsonb_pretty(public.admin_list_enterprise_billing_invoices(null, null, null, null, false, 10, 0)) as billing_list;
-- HQ 본인이 호출: select jsonb_pretty(public.get_my_enterprise_billing_summary());

-- H. NOC mega-bundle
select jsonb_pretty(public.admin_noc_kpi()) as noc_kpi;
select jsonb_pretty(public.admin_noc_region_summary()) as noc_regions;
select jsonb_pretty(public.admin_noc_active_alerts(20, null)) as noc_alerts;
select jsonb_pretty(public.admin_noc_store_health_list(20, null, null, null)) as noc_health;
select jsonb_pretty(public.admin_noc_recent_events(20, null)) as noc_events;
select jsonb_pretty(public.admin_noc_get_settings()) as noc_settings;
select jsonb_pretty(public.admin_noc_list_notification_channels()) as noc_channels;


-- ============================================================================
-- §6. 정합성 (cross-table)
-- ============================================================================

-- 0384 broadcast target 의 store_id 가 모두 users 에 존재해야 함
select count(*) as orphan_broadcast_targets
  from public.enterprise_emergency_broadcast_targets t
  left join public.users u on u.id = t.store_id
 where u.id is null;

-- 0382 invoice 의 active_store_count 가 음수면 안됨
select count(*) as negative_count_invoices
  from public.enterprise_billing_invoices
 where active_store_count < 0 or subtotal_amount < 0 or total_amount < 0;

-- 0383 contract 의 종료일이 시작일보다 빠르면 안됨
select count(*) as bad_date_contracts
  from public.enterprise_contracts
 where end_date is not null and start_date is not null and end_date < start_date;

-- 0381 schedule 의 max_plays_per_day 가 0 이거나 음수면 안됨
select count(*) as bad_max_plays
  from public.enterprise_announcement_schedules
 where max_plays_per_day < 1 or max_plays_per_day > 100;


-- ============================================================================
-- §7. Health Score 분포 (NOC)
-- ============================================================================
with health as (
  select np.store_id,
         ((public._noc_store_health_score(np.store_id))->>'score')::int as score
    from public.store_now_playing np
)
select
  count(*) as total_stores,
  count(*) filter (where score >= 90) as green,
  count(*) filter (where score >= 70 and score < 90) as yellow,
  count(*) filter (where score >= 50 and score < 70) as orange,
  count(*) filter (where score < 50) as red,
  avg(score)::int as avg_score
from health;


-- ============================================================================
-- §8. Storage bucket 확인
-- ============================================================================
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets
 where id in ('enterprise-announcements', 'enterprise-contracts')
 order by id;


-- ============================================================================
-- §9. 최근 audit 로그 (24h)
-- ============================================================================
select source, category, level, count(*) as cnt
  from public.admin_operation_logs
 where created_at >= now() - interval '24 hours'
   and (source like 'enterprise_%' or source in ('policy_automation','emergency_broadcast','noc','enterprise_billing','enterprise_contract','franchise_music_policy','enterprise_announcement'))
 group by 1, 2, 3
 order by cnt desc
 limit 50;


-- ============================================================================
-- END — 결과를 ENTERPRISE_E2E_CHECKLIST.md 에 기록
-- ============================================================================
