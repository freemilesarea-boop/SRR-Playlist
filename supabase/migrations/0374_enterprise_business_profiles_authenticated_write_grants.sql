-- 0374 — enterprise_business_profiles authenticated INSERT/UPDATE grants
--
-- 원인 (사용자 측 진단 확정):
--   upsert_my_enterprise_business_profile (SECURITY DEFINER, owner=postgres, rolbypassrls=true)
--   호출 시 42501 permission denied 발생.
--
--   확인 결과:
--     - 함수 owner = postgres + BYPASSRLS = true → RLS 우회 정상
--     - 그러나 enterprise_business_profiles 의 table-level grants 가
--       authenticated 에는 SELECT 만 부여, INSERT/UPDATE 부재
--     - 0364 의 `revoke insert, update, delete from authenticated, anon` (line 62)
--       이 INSERT/UPDATE 권한을 명시 차단
--
--   SECURITY DEFINER 함수가 owner 권한으로 INSERT/UPDATE 를 시도하지만,
--   해당 환경에서는 table-level GRANT 체크가 추가로 발생하여 차단됨.
--
-- Fix:
--   authenticated 에 INSERT, UPDATE 만 부여. DELETE / anon 은 그대로 차단.
--   RLS policy 변경 0 (ebp_select 만 유지) — SECURITY DEFINER 가 RLS bypass.
--
-- 절대 원칙:
--   - anon INSERT/UPDATE/DELETE 부여 금지
--   - authenticated DELETE 부여 금지 (명시적 삭제 RPC 없음)
--   - RLS policy 변경 0
--   - SECURITY DEFINER 함수 본문 변경 0
--   - 다른 enterprise / artist / store / player 도메인 무관
--   - idempotent (재실행 안전 — GRANT 는 누적 X)

grant insert, update on public.enterprise_business_profiles to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_grants_auth int;
  v_grants_anon int;
  v_grant_delete int;
begin
  select count(*) into v_grants_auth
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name='enterprise_business_profiles'
     and grantee='authenticated'
     and privilege_type in ('INSERT','UPDATE');

  select count(*) into v_grants_anon
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name='enterprise_business_profiles'
     and grantee='anon'
     and privilege_type in ('INSERT','UPDATE','DELETE');

  select count(*) into v_grant_delete
    from information_schema.role_table_grants
   where table_schema='public'
     and table_name='enterprise_business_profiles'
     and grantee='authenticated'
     and privilege_type='DELETE';

  raise notice '====== 0374 grants Diagnostics ======';
  raise notice 'authenticated INSERT+UPDATE grants: % / 2', v_grants_auth;
  raise notice 'anon INSERT/UPDATE/DELETE grants (must be 0): %', v_grants_anon;
  raise notice 'authenticated DELETE grant (must be 0): %', v_grant_delete;
  raise notice '=====================================';

  if v_grants_auth = 2 and v_grants_anon = 0 and v_grant_delete = 0 then
    raise notice '0374 COMPLETE — upsert_my_enterprise_business_profile 42501 fix ready';
  else
    raise warning '0374 INCOMPLETE — 권한 카운트 확인';
  end if;
end$$;
