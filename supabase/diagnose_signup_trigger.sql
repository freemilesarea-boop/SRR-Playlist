-- ============================================
-- diagnose_signup_trigger.sql
--
-- 회원가입 흐름이 실제 DB 에서 어디까지 동작하는지 진단.
-- Supabase 대시보드 → SQL Editor 에서 그대로 실행하거나 psql 로:
--   psql "$SUPABASE_DB_URL" -f supabase/diagnose_signup_trigger.sql
--
-- 모든 쿼리 READ-ONLY. 데이터 변경 없음.
-- ============================================

\echo '== 1) handle_new_user 함수 본문 검증 =='
select
  p.proname,
  case
    when pg_get_functiondef(p.oid) ilike '%artist_profiles%'
      and pg_get_functiondef(p.oid) ilike '%signup_debug_events%'
        then 'OK — 0022 적용됨 (artist_profiles + debug 둘 다 있음)'
    when pg_get_functiondef(p.oid) ilike '%artist_profiles%'
        then 'PARTIAL — 0021 만 적용. 0022 적용 권장 (디버그 가시화)'
    else 'OLD — 마이그레이션 미적용. 0021 또는 0022 적용 필요'
  end as status,
  length(pg_get_functiondef(p.oid)) as fn_body_length
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'handle_new_user';

\echo ''
\echo '== 2) 트리거 바인딩 검증 =='
select
  tgname,
  case tgenabled
    when 'O' then 'enabled (local/origin)'
    when 'A' then 'enabled (always)'
    when 'D' then 'disabled'
    when 'R' then 'replica only'
  end as status,
  pg_get_triggerdef(oid) as definition
from pg_trigger
where tgname = 'on_auth_user_created'
  and tgrelid = 'auth.users'::regclass;

\echo ''
\echo '== 3) auth.users 의 최근 가입 5명 (메타데이터 확인) =='
select
  id,
  email,
  raw_user_meta_data->>'account_type' as account_type,
  raw_user_meta_data->>'artist_name'  as artist_name,
  raw_user_meta_data->>'full_name'    as full_name,
  created_at,
  email_confirmed_at is not null      as email_confirmed
from auth.users
order by created_at desc
limit 5;

\echo ''
\echo '== 4) public.users 의 최근 가입 5명 (트리거 결과) =='
select
  id,
  account_type,
  artist_approval_status,
  full_name,
  signup_completed,
  created_at
from public.users
order by created_at desc
limit 5;

\echo ''
\echo '== 5) artist_profiles 의 최근 행 5개 =='
select
  user_id,
  artist_name,
  approval_status,
  email,
  created_at
from public.artist_profiles
order by created_at desc
limit 5;

\echo ''
\echo '== 6) signup_debug_events (0022 적용 후만 존재) =='
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema='public' and table_name='signup_debug_events'
  ) then
    raise notice 'signup_debug_events 존재 — 아래 SELECT 결과 확인';
  else
    raise notice 'signup_debug_events 미존재 — 0022 마이그레이션 적용 필요';
  end if;
end$$;

select created_at, auth_user_id, email, account_type, artist_name,
       users_upserted, artist_profile_upserted, error_message
from public.signup_debug_events
order by created_at desc
limit 20;

\echo ''
\echo '== 7) auth ↔ public ↔ artist_profiles 카운트 비교 =='
select
  (select count(*) from auth.users) as auth_users,
  (select count(*) from public.users) as public_users,
  (select count(*) from public.users where account_type='artist') as public_artists,
  (select count(*) from public.users where artist_approval_status='pending') as pending_status,
  (select count(*) from public.artist_profiles) as artist_profiles_rows,
  (select count(*) from public.artist_profiles where approval_status='pending') as pending_artists;

\echo ''
\echo '== 8) list_pending_artists RPC smoke test =='
\echo '   주의: 이 함수는 admin only. anon/일반 user 로 실행 시 exception.'
\echo '   결과가 비어있으면 가입한 아티스트가 없거나, RPC 가 admin 요구로 실패.'
\echo ''
\echo '== 진단 종료 =='
