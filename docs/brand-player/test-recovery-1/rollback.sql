-- BRAND-TEST-RECOVERY-1 — Rollback (TEST PROJECT ONLY). Do NOT run on Production.
-- Removes synthetic seed + the recovery RPCs/tables added by 0455. Preserves the 0454
-- Binding structures (brand_player_sessions + verify_brand_device_binding / revoke / list /
-- hardened brand_player_heartbeat) and existing Test settlement/recovery schema.

begin;

-- 1) Synthetic seed
delete from public.brand_media_assets    where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_music_policies   where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_signage_settings where brand_id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.brand_accounts         where id in ('b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b2');
delete from public.enterprise_accounts    where id in ('c0000000-0000-4000-8000-0000000000a1','c0000000-0000-4000-8000-0000000000b2');
delete from public.tracks                 where id::text like 'd0000000-0000-4000-8000-%';
delete from public.brand_store_code_attempts where user_id in
  ('a0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000000003');
-- Synthetic auth user (Test only)
delete from auth.users where id = 'a0000000-0000-4000-8000-000000000001';

-- 2) 0455 recovery RPCs (revert verify_store_code / get_brand_player_config to absent)
drop function if exists public.verify_store_code(text, text);
drop function if exists public.get_brand_player_config(uuid, text);
drop function if exists public._brand_generate_playlist(uuid, integer);
drop function if exists public._brand_signage_json(uuid);
drop function if exists public._brand_store_code_rate_limited();
drop function if exists public._brand_audit(uuid, text, jsonb);

-- 3) 0455 tables (drop only the ones 0455 introduced; keep 0454 sessions)
drop table if exists public.brand_store_code_attempts;
drop table if exists public.brand_media_assets;
drop table if exists public.brand_music_policies;
drop table if exists public.brand_signage_settings;
drop table if exists public.brand_audit_logs;

-- NOTE: brand_player_sessions, brand_accounts, enterprise_accounts (from 0454) and the
-- 0454 binding RPCs are intentionally preserved. Adjust if a full teardown is desired.

commit;
