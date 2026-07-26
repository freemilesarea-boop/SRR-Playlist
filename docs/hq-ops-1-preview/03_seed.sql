-- ENTERPRISE-HQ-OPS-1-PREVIEW — synthetic QA seed (Test DB only).
-- ALL synthetic ids are prefixed 'da7a' for marker-based cleanup. No Production data used.
-- Login: auth users are created WITHOUT a password (email_confirmed set). Set a password per user
--        in Supabase Dashboard → Authentication → Users before logging in (no secret is stored here).
-- Idempotent: re-runnable (on conflict do nothing/update).

-- min player version raised so a store on an older version flags update_required
insert into public.system_settings (key, value, description)
values ('store_player_min_version', '"2.0.0"'::jsonb, 'QA min version')
on conflict (key) do update set value = '"2.0.0"'::jsonb;

-- ---- HQ login users (account_type individual — HQ status from enterprise_accounts) ----
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('da7a0001-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-hq-a@test.invalid', now(), '{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a0002-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-hq-b@test.invalid', now(), '{"provider":"email","providers":["email"]}','{}', now(), now())
on conflict (id) do nothing;

insert into public.users (id, nickname, role, account_type, full_name)
values
  ('da7a0001-0000-0000-0000-000000000001','QA본사A','user','individual','QA 본사 A 담당'),
  ('da7a0002-0000-0000-0000-000000000001','QA본사B','user','individual','QA 본사 B 담당')
on conflict (id) do update set account_type='individual', full_name=excluded.full_name, nickname=excluded.nickname;

-- ---- Enterprise A (clean: no unpaid/overdue/expiring → distinct per-store operational states) ----
insert into public.enterprise_accounts (id, enterprise_name, manager_name, manager_email, manager_phone, role, status, brand_code, store_invite_code, onboarding_enabled, auth_user_id, created_at, updated_at)
values ('da7a00a0-0000-0000-0000-000000000001','QA 브랜드 A','QA 본사 A 담당','qa-hq-a@test.invalid','01000000001','owner','active','QAA','QA-STORE-AAA', true,'da7a0001-0000-0000-0000-000000000001', now(), now())
on conflict (id) do nothing;

insert into public.enterprise_accounts (id, enterprise_name, manager_name, manager_email, manager_phone, role, status, brand_code, store_invite_code, onboarding_enabled, auth_user_id, created_at, updated_at)
values ('da7a00b0-0000-0000-0000-000000000001','QA 브랜드 B','QA 본사 B 담당','qa-hq-b@test.invalid','01000000002','owner','active','QAB','QA-STORE-BBB', true,'da7a0002-0000-0000-0000-000000000001', now(), now())
on conflict (id) do nothing;

insert into public.franchises (id, name, status) values
  ('da7a0f00-0000-0000-0000-000000000001','QA 프랜차이즈 A','active'),
  ('da7a0f00-0000-0000-0000-000000000002','QA 프랜차이즈 B','active')
on conflict (id) do nothing;

insert into public.enterprise_franchises (id, enterprise_account_id, franchise_id, role, status) values
  ('da7a0c00-0000-0000-0000-000000000001','da7a00a0-0000-0000-0000-000000000001','da7a0f00-0000-0000-0000-000000000001','primary','active'),
  ('da7a0c00-0000-0000-0000-000000000002','da7a00b0-0000-0000-0000-000000000001','da7a0f00-0000-0000-0000-000000000002','primary','active')
on conflict (id) do nothing;

insert into public.enterprise_regions (id, enterprise_account_id, region_name, region_code) values
  ('da7a0e00-0000-0000-0000-000000000001','da7a00a0-0000-0000-0000-000000000001','서울','QA-A-SEOUL'),
  ('da7a0e00-0000-0000-0000-000000000002','da7a00b0-0000-0000-0000-000000000001','부산','QA-B-BUSAN')
on conflict (id) do nothing;

insert into public.enterprise_business_profiles (enterprise_account_id, company_name, representative_name, business_address, contact_phone)
values ('da7a00a0-0000-0000-0000-000000000001','QA 브랜드 A 주식회사','QA 대표A','서울시 테스트구','01000000001')
on conflict (enterprise_account_id) do nothing;
insert into public.enterprise_settlement_profiles (enterprise_account_id, settlement_status, monthly_store_price, commission_rate)
values ('da7a00a0-0000-0000-0000-000000000001','approved',4900,20.00)
on conflict (enterprise_account_id) do nothing;

insert into public.tracks (id, title, artist, audio_url, cover_url, duration)
values ('da7a3000-0000-0000-0000-000000000001','QA 테스트곡','QA 아티스트','http://x.invalid/a.mp3','http://x.invalid/a.jpg',200)
on conflict (id) do nothing;

-- ---- Enterprise A: 30 HEALTHY stores (pagination: PAGE_SIZE 30 → page 2) ----
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('da7a1000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'qa-a-store'||g||'@test.invalid', now(), '{"provider":"email","providers":["email"]}','{}', now(), now()
from generate_series(1,30) g on conflict (id) do nothing;
insert into public.users (id, nickname, role, account_type, full_name, business_category)
select ('da7a1000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'A매장'||g,'user','business','QA A 매장 '||g,
  (array['카페','베이커리','레스토랑','편의점'])[1+(g%4)]
from generate_series(1,30) g
on conflict (id) do update set account_type='business', full_name=excluded.full_name, business_category=excluded.business_category, nickname=excluded.nickname;
insert into public.franchise_stores (id, franchise_id, enterprise_region_id, store_id, store_name, status, joined_at)
select ('da7a2000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001',
  ('da7a1000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'A매장'||g,'active', now()-interval '10 days'
from generate_series(1,30) g on conflict (id) do nothing;
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, device_model, device_os, volume, connection_type, last_policy_sync_at)
select ('da7a1000-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001',
  'playing','da7a3000-0000-0000-0000-000000000001', now()-interval '20 seconds', now()-interval '20 seconds', now()-interval '20 seconds', now()-interval '20 seconds',
  '2.0.0','devA'||g,'TestPad','TestOS',50,'wifi', now()
from generate_series(1,30) g on conflict (store_id) do nothing;

-- ---- Enterprise A: 6 special-state stores (WARNING x3, CRITICAL incident, OFFLINE, UNKNOWN/no-data) ----
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
values
  ('da7a1100-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-upd@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a1100-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-idle@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a1100-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-policy@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a1100-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-play@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a1100-0000-0000-0000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-off@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()),
  ('da7a1100-0000-0000-0000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','qa-a-nodata@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now())
on conflict (id) do nothing;
insert into public.users (id, nickname, role, account_type, full_name, business_category) values
  ('da7a1100-0000-0000-0000-000000000001','A업데이트','user','business','QA A 업데이트필요','카페'),
  ('da7a1100-0000-0000-0000-000000000002','A유휴','user','business','QA A 유휴','베이커리'),
  ('da7a1100-0000-0000-0000-000000000003','A정책지연','user','business','QA A 정책지연','레스토랑'),
  ('da7a1100-0000-0000-0000-000000000004','A재생오류','user','business','QA A 재생오류','편의점'),
  ('da7a1100-0000-0000-0000-000000000005','A오프라인','user','business','QA A 오프라인','카페'),
  ('da7a1100-0000-0000-0000-000000000006','A수집전','user','business','QA A 수집전','카페')
on conflict (id) do update set account_type='business', full_name=excluded.full_name, business_category=excluded.business_category, nickname=excluded.nickname;
insert into public.franchise_stores (id, franchise_id, enterprise_region_id, store_id, store_name, status, joined_at)
select ('da7a2100-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001',
  ('da7a1100-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,
  (array['A업데이트필요','A유휴','A정책지연','A재생오류','A오프라인','A수집전'])[g],'active', now()-interval '5 days'
from generate_series(1,6) g on conflict (id) do nothing;
-- WARNING: update_required (old app_version < min 2.0.0)
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000001','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','playing','da7a3000-0000-0000-0000-000000000001', now()-interval '30 seconds', now()-interval '30 seconds', now()-interval '30 seconds', now()-interval '30 seconds','1.9.0','devUpd',50, now())
on conflict (store_id) do nothing;
-- WARNING: idle 5m-1h (heartbeat DEGRADED)
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000002','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','paused','da7a3000-0000-0000-0000-000000000001', now()-interval '25 minutes', now()-interval '25 minutes', now()-interval '25 minutes', now()-interval '25 minutes','2.0.0','devIdle',50, now())
on conflict (store_id) do nothing;
-- WARNING: policy outdated (>24h)
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000003','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','playing','da7a3000-0000-0000-0000-000000000001', now()-interval '30 seconds', now()-interval '30 seconds', now()-interval '30 seconds', now()-interval '30 seconds','2.0.0','devPolicy',50, now()-interval '2 days')
on conflict (store_id) do nothing;
-- CRITICAL: playback error (incident)
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, playback_error, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000004','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','stopped','da7a3000-0000-0000-0000-000000000001', now()-interval '40 seconds', now()-interval '40 seconds', now()-interval '40 seconds', now()-interval '40 seconds','2.0.0','devPlay',50,'AUDIO_DECODE_ERROR', now())
on conflict (store_id) do nothing;
-- OFFLINE: >24h
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000005','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','offline', null, null, now()-interval '30 hours', now()-interval '30 hours', now()-interval '30 hours','2.0.0','devOff',50, now()-interval '30 hours')
on conflict (store_id) do nothing;
-- UNKNOWN / no-data: last_seen & last_heartbeat null
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
values ('da7a1100-0000-0000-0000-000000000006','da7a0f00-0000-0000-0000-000000000001','da7a0e00-0000-0000-0000-000000000001','unknown', null, null, null, null, null, null, null, null, null)
on conflict (store_id) do nothing;

-- Enterprise A billing/contract: PAID invoice + active non-expiring contract (clean)
insert into public.enterprise_billing_invoices (id, enterprise_account_id, billing_month, active_store_count, total_amount, status, due_date, paid_at)
values ('da7ab100-0000-0000-0000-000000000001','da7a00a0-0000-0000-0000-000000000001', date_trunc('month', now())::date, 36, 176400, 'paid', (now()-interval '5 days')::date, now()-interval '3 days')
on conflict (id) do nothing;
insert into public.enterprise_contracts (id, enterprise_account_id, contract_no, contract_name, start_date, end_date, status)
values ('da7ac100-0000-0000-0000-000000000001','da7a00a0-0000-0000-0000-000000000001','QA-A-CONTRACT','QA A 표준계약', (now()-interval '6 months')::date, (now()+interval '300 days')::date, 'active')
on conflict (id) do nothing;

-- ---- Enterprise B (billing-troubled): overdue + unpaid + expiring contract ----
insert into public.enterprise_business_profiles (enterprise_account_id, company_name, representative_name, business_address, contact_phone)
values ('da7a00b0-0000-0000-0000-000000000001','QA 브랜드 B 주식회사','QA 대표B','부산시 테스트구','01000000002')
on conflict (enterprise_account_id) do nothing;
insert into public.enterprise_settlement_profiles (enterprise_account_id, settlement_status, monthly_store_price, commission_rate)
values ('da7a00b0-0000-0000-0000-000000000001','approved',4900,20.00)
on conflict (enterprise_account_id) do nothing;
insert into auth.users (id, instance_id, aud, role, email, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
select ('da7a1200-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',
  'qa-b-store'||g||'@test.invalid', now(),'{"provider":"email","providers":["email"]}','{}', now(), now()
from generate_series(1,3) g on conflict (id) do nothing;
insert into public.users (id, nickname, role, account_type, full_name, business_category)
select ('da7a1200-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'B매장'||g,'user','business','QA B 매장 '||g,'카페'
from generate_series(1,3) g on conflict (id) do update set account_type='business', full_name=excluded.full_name;
insert into public.franchise_stores (id, franchise_id, enterprise_region_id, store_id, store_name, status, joined_at)
select ('da7a2200-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'da7a0f00-0000-0000-0000-000000000002','da7a0e00-0000-0000-0000-000000000002',
  ('da7a1200-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'B매장'||g,'active', now()-interval '20 days'
from generate_series(1,3) g on conflict (id) do nothing;
insert into public.store_policy_sync_status (store_id, franchise_id, enterprise_region_id, player_status, current_track_id, current_track_started_at, last_seen_at, last_synced_at, last_heartbeat_at, app_version, device_identifier, volume, last_policy_sync_at)
select ('da7a1200-0000-0000-0000-'||lpad(g::text,12,'0'))::uuid,'da7a0f00-0000-0000-0000-000000000002','da7a0e00-0000-0000-0000-000000000002',
  'playing','da7a3000-0000-0000-0000-000000000001', now()-interval '15 seconds', now()-interval '15 seconds', now()-interval '15 seconds', now()-interval '15 seconds','2.0.0','devB'||g,50, now()
from generate_series(1,3) g on conflict (store_id) do nothing;
-- overdue + unpaid invoices, expiring contract (D-15)
insert into public.enterprise_billing_invoices (id, enterprise_account_id, billing_month, active_store_count, total_amount, status, due_date) values
  ('da7ab200-0000-0000-0000-000000000001','da7a00b0-0000-0000-0000-000000000001', date_trunc('month', now())::date, 3, 14700, 'overdue', (now()-interval '7 days')::date),
  ('da7ab200-0000-0000-0000-000000000002','da7a00b0-0000-0000-0000-000000000001', (date_trunc('month', now())-interval '1 month')::date, 3, 14700, 'issued', (now()+interval '3 days')::date)
on conflict (id) do nothing;
insert into public.enterprise_contracts (id, enterprise_account_id, contract_no, contract_name, start_date, end_date, status)
values ('da7ac200-0000-0000-0000-000000000001','da7a00b0-0000-0000-0000-000000000001','QA-B-CONTRACT','QA B 표준계약', (now()-interval '350 days')::date, (now()+interval '15 days')::date, 'active')
on conflict (id) do nothing;

-- diagnostic counts
select
  (select count(*) from public.franchise_stores where id::text like 'da7a%') as fs_rows,
  (select count(*) from public.store_policy_sync_status where store_id::text like 'da7a%') as sync_rows,
  (select count(*) from public.enterprise_accounts where id::text like 'da7a%') as ea_rows,
  (select count(*) from auth.users where id::text like 'da7a%') as auth_rows;
