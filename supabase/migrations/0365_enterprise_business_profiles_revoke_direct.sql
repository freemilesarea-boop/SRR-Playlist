-- 0365 — Hotfix (Phase 1-7 §2 boost): enterprise_business_profiles 직접 table 접근 차단
--
-- 원인:
--   0364 가 INSERT/UPDATE/DELETE 만 revoke. Supabase 의 default privileges
--   (ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated)
--   에 의해 anon 과 authenticated 둘 다 SELECT/TRUNCATE/REFERENCES/TRIGGER 권한 보유.
--   RLS 가 있으나 defense-in-depth 부족.
--
-- 결정 (사용자 요청):
--   - anon: 전체 revoke (어떤 접근도 불가)
--   - authenticated: 전체 revoke — 직접 table 접근 전면 차단
--   - 모든 SELECT/upsert 는 SECURITY DEFINER RPC 만 경유
--     (get_my_enterprise_dashboard / upsert_my_enterprise_business_profile)
--   - RLS policy 는 그대로 유지 (defense-in-depth, 직접 grant 재발 방지)
--   - service_role 은 default 유지 (admin 도구 / 진단 SQL)
--   - 신규 RPC execute 권한 변경 0 (이미 anon revoke + authenticated grant)
--
-- 영향:
--   - 프론트엔드: 직접 table .from('enterprise_business_profiles') 호출 0건
--     (모든 접근이 supabase.rpc(...) 경유). PR #180 코드 영향 없음.

revoke all on public.enterprise_business_profiles from anon;
revoke all on public.enterprise_business_profiles from authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_anon_count int;
  v_auth_count int;
  v_policy_count int;
  v_rpc_anon_count int;
  v_rpc_auth_count int;
begin
  -- 직접 table 권한 (둘 다 0 이어야 함)
  select count(*) into v_anon_count
    from information_schema.table_privileges
   where table_schema='public'
     and table_name='enterprise_business_profiles'
     and grantee='anon';
  select count(*) into v_auth_count
    from information_schema.table_privileges
   where table_schema='public'
     and table_name='enterprise_business_profiles'
     and grantee='authenticated';

  -- RLS policy 유지 (1건)
  select count(*) into v_policy_count
    from pg_policy
   where polrelid = 'public.enterprise_business_profiles'::regclass;

  -- RPC execute 권한 — anon=0 / authenticated=4 유지
  select
    count(*) filter (where has_function_privilege('anon', oid, 'EXECUTE')),
    count(*) filter (where has_function_privilege('authenticated', oid, 'EXECUTE'))
    into v_rpc_anon_count, v_rpc_auth_count
    from pg_proc
   where proname in (
     'get_my_enterprise_role',
     'get_my_enterprise_store_info',
     'get_my_enterprise_dashboard',
     'upsert_my_enterprise_business_profile'
   );

  raise notice '====== 0365 Enterprise Business Profiles Privilege Hotfix ======';
  raise notice 'anon table privileges: % (expect 0)', v_anon_count;
  raise notice 'authenticated table privileges: % (expect 0)', v_auth_count;
  raise notice 'RLS policies: % (expect 1)', v_policy_count;
  raise notice 'RPC execute anon: % (expect 0)', v_rpc_anon_count;
  raise notice 'RPC execute authenticated: % (expect 4)', v_rpc_auth_count;
  raise notice '================================================================';

  if v_anon_count = 0
     and v_auth_count = 0
     and v_policy_count = 1
     and v_rpc_anon_count = 0
     and v_rpc_auth_count = 4
  then
    raise notice '0365 HOTFIX COMPLETE — table direct access blocked, RPC-only';
  else
    raise warning '0365 HOTFIX INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;

comment on table public.enterprise_business_profiles is
  'Phase 1-7 (0365 hotfix) — HQ 본사 사업자 정보. 직접 table 접근 차단 (anon/authenticated all revoked). 접근은 RPC 만 (get_my_enterprise_dashboard / upsert_my_enterprise_business_profile).';
