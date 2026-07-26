-- ENTERPRISE-HQ-OPS-1-PREVIEW — cleanup (Test DB only). Idempotent & re-runnable.
-- Removes ONLY: (a) harness objects created by this QA (tables/views/functions that did NOT
-- pre-exist in Test), (b) synthetic rows marked with the 'da7a' id prefix, (c) the enterprise_accounts
-- columns this QA added. It NEVER deletes pre-existing rows (they have non-'da7a' ids) and NEVER drops
-- pre-existing objects (users, tracks, business_profiles, business_verification_profiles,
-- admin_operation_logs, enterprise_accounts, functions _touch_updated_at / admin_log_operation).

-- Pre-count (for the verification block at the end)
do $$
declare
  v_ea_pre int; v_users_pre int; v_tracks_pre int;
begin
  select count(*) into v_ea_pre from public.enterprise_accounts where id::text not like 'da7a%';
  select count(*) into v_users_pre from public.users where id::text not like 'da7a%';
  select count(*) into v_tracks_pre from public.tracks where id::text not like 'da7a%';
  raise notice '[cleanup] pre-existing (kept): enterprise_accounts=% users=% tracks=%', v_ea_pre, v_users_pre, v_tracks_pre;
end $$;

-- 1) Drop harness objects (created by QA; did not pre-exist). All synthetic rows inside vanish with them.
drop function if exists public.get_my_enterprise_dashboard();
drop function if exists public.get_my_enterprise_store_info();
drop function if exists public.get_my_enterprise_role();
drop function if exists public.get_my_enterprise_ops_store_detail(uuid);
drop function if exists public.get_my_enterprise_ops_fleet(text,text,uuid,uuid,text,text,int,int);
drop function if exists public._store_operational_status(text,int,boolean,boolean,int,boolean,int,boolean,boolean);
drop function if exists public._store_heartbeat_state(timestamptz);
drop function if exists public.store_heartbeat(uuid,text,int,int,uuid,timestamptz,text,text,text,text,text,text,text);
drop function if exists public._noc_store_health_score(uuid);
drop function if exists public._hq_owns_store(uuid,uuid);
drop function if exists public._hq_current_enterprise_account_id();
drop function if exists public.admin_force_store_resync(uuid);
drop function if exists public._is_super_admin();

drop view if exists public.store_now_playing;
drop view if exists public.store_monitoring_status;

drop table if exists public.enterprise_emergency_broadcast_targets cascade;
drop table if exists public.enterprise_emergency_broadcasts cascade;
drop table if exists public.enterprise_announcement_play_logs cascade;
drop table if exists public.enterprise_announcement_schedules cascade;
drop table if exists public.enterprise_announcement_assets cascade;
drop table if exists public.enterprise_settlement_profiles cascade;
drop table if exists public.enterprise_business_profiles cascade;
drop table if exists public.enterprise_monthly_settlements cascade;
drop table if exists public.enterprise_contracts cascade;
drop table if exists public.enterprise_billing_invoices cascade;
drop table if exists public.store_policy_sync_status cascade;
drop table if exists public.franchise_stores cascade;
drop table if exists public.franchise_music_policies cascade;
drop table if exists public.franchise_regions cascade;
drop table if exists public.enterprise_franchises cascade;
drop table if exists public.enterprise_regions cascade;
drop table if exists public.franchises cascade;
drop table if exists public.system_settings cascade;

-- 2) Delete synthetic rows from PRE-EXISTING tables (marker-guarded; non-'da7a' rows untouched)
delete from public.enterprise_accounts where id::text like 'da7a%';
delete from public.tracks where id::text like 'da7a%';
delete from auth.users where id::text like 'da7a%';  -- cascades to public.users (FK on delete cascade)

-- 3) Drop columns this QA added to the pre-existing enterprise_accounts (originals kept:
--    id, enterprise_name, store_invite_code, status, auth_user_id, deleted_at, created_at)
alter table public.enterprise_accounts drop column if exists manager_name;
alter table public.enterprise_accounts drop column if exists manager_email;
alter table public.enterprise_accounts drop column if exists manager_phone;
alter table public.enterprise_accounts drop column if exists role;
alter table public.enterprise_accounts drop column if exists last_login_at;
alter table public.enterprise_accounts drop column if exists notes;
alter table public.enterprise_accounts drop column if exists updated_at;
alter table public.enterprise_accounts drop column if exists brand_code;
alter table public.enterprise_accounts drop column if exists hq_invite_code;
alter table public.enterprise_accounts drop column if exists invite_code_rotated_at;
alter table public.enterprise_accounts drop column if exists onboarding_enabled;
alter table public.enterprise_accounts drop column if exists allow_self_register_region;

-- 4) Verify: no synthetic residue, pre-existing data intact
select
  (select count(*) from public.enterprise_accounts where id::text like 'da7a%') as ea_synthetic_left,
  (select count(*) from auth.users where id::text like 'da7a%') as auth_synthetic_left,
  (select count(*) from public.tracks where id::text like 'da7a%') as tracks_synthetic_left,
  to_regclass('public.store_policy_sync_status') as harness_tbl_left,
  to_regprocedure('public.get_my_enterprise_ops_fleet(text,text,uuid,uuid,text,text,int,int)') as harness_fn_left,
  (select count(*) from public.enterprise_accounts) as ea_total_now,
  (select count(*) from public.users) as users_total_now,
  (select count(*) from public.tracks) as tracks_total_now;
