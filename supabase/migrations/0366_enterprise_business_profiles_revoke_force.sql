-- 0366 — Hotfix: enterprise_business_profiles 권한 강화 REVOKE + 진단
--
-- 배경:
--   0365 의 `revoke all from anon/authenticated` 가 적용 후에도 ACL 에 r/D/x/t/m
--   (SELECT/TRUNCATE/REFERENCES/TRIGGER/MAINTAIN) 가 남음.
--   ACL: anon=rDxtm/postgres, authenticated=rDxtm/postgres
--   (a/w/d 가 빠진 것은 0364 의 INSERT/UPDATE/DELETE revoke 가 정상 적용된 증거)
--
--   원인 가설:
--     - 0365 의 REVOKE 가 다른 session role 로 실행되어 grantor mismatch 로 silent no-op
--     - 또는 PG17 의 MAINTAIN 권한이 REVOKE ALL 에서 누락됨
--
-- 전략:
--   - SET ROLE postgres 로 grantor 일치 보장
--   - REVOKE ALL + 개별 권한 명시 (belt-and-suspenders)
--   - PUBLIC 도 동시 revoke (defense-in-depth)
--   - 각 단계 NOTICE 로 진단 출력 (current_user / pre relacl / post relacl)
--
-- 영향:
--   - DB schema / RLS / RPC 변경 0
--   - service_role 권한 유지 (admin 도구)
--   - 프론트엔드 코드 영향 0 (모든 접근이 RPC 경유)

-- ============================================================
-- §0. PRE 진단 — current_user / session_user / ACL snapshot
-- ============================================================
do $$
declare v_acl text;
begin
  raise notice '====== 0366 PRE diagnostics ======';
  raise notice 'current_user: %', current_user;
  raise notice 'session_user: %', session_user;
  raise notice 'pg_has_role(current_user, postgres, MEMBER): %',
    pg_has_role(current_user, 'postgres', 'MEMBER');
  select c.relacl::text into v_acl
    from pg_class c
   where c.relname='enterprise_business_profiles'
     and c.relnamespace='public'::regnamespace;
  raise notice 'PRE relacl: %', coalesce(v_acl, '(null)');
end$$;


-- ============================================================
-- §1. 강제 REVOKE — postgres role 로 명시 + PUBLIC/anon/authenticated 모두
-- ============================================================
-- SET ROLE postgres 가 가능하면 grantor 일치 보장 (실패 시 superuser 권한으로 강제)
do $$
begin
  begin
    execute 'set role postgres';
    raise notice 'set role postgres: OK';
  exception when others then
    raise notice 'set role postgres failed: % (계속 진행)', sqlerrm;
  end;
end$$;

-- belt-and-suspenders REVOKE — 4가지 변형
revoke all privileges on public.enterprise_business_profiles from public;
revoke all privileges on public.enterprise_business_profiles from anon;
revoke all privileges on public.enterprise_business_profiles from authenticated;

-- 개별 권한 명시 — REVOKE ALL 이 일부 누락하는 경우 대비
revoke select, insert, update, delete, truncate, references, trigger
  on public.enterprise_business_profiles from public;
revoke select, insert, update, delete, truncate, references, trigger
  on public.enterprise_business_profiles from anon;
revoke select, insert, update, delete, truncate, references, trigger
  on public.enterprise_business_profiles from authenticated;

-- PG17 MAINTAIN — 별도 처리 (REVOKE ALL 에 포함되어야 하나 명시 보강)
do $$
begin
  begin
    execute 'revoke maintain on public.enterprise_business_profiles from public';
    execute 'revoke maintain on public.enterprise_business_profiles from anon';
    execute 'revoke maintain on public.enterprise_business_profiles from authenticated';
    raise notice 'MAINTAIN revoke: OK';
  exception when others then
    raise notice 'MAINTAIN revoke failed: % (PG16 이하 정상)', sqlerrm;
  end;
end$$;

reset role;


-- ============================================================
-- §2. POST 진단 — ACL + has_table_privilege 검증
-- ============================================================
do $$
declare
  v_acl text;
  v_anon_select boolean;
  v_anon_truncate boolean;
  v_anon_references boolean;
  v_anon_trigger boolean;
  v_auth_select boolean;
  v_auth_truncate boolean;
  v_auth_references boolean;
  v_auth_trigger boolean;
begin
  select c.relacl::text into v_acl
    from pg_class c
   where c.relname='enterprise_business_profiles'
     and c.relnamespace='public'::regnamespace;

  v_anon_select     := has_table_privilege('anon', 'public.enterprise_business_profiles', 'SELECT');
  v_anon_truncate   := has_table_privilege('anon', 'public.enterprise_business_profiles', 'TRUNCATE');
  v_anon_references := has_table_privilege('anon', 'public.enterprise_business_profiles', 'REFERENCES');
  v_anon_trigger    := has_table_privilege('anon', 'public.enterprise_business_profiles', 'TRIGGER');

  v_auth_select     := has_table_privilege('authenticated', 'public.enterprise_business_profiles', 'SELECT');
  v_auth_truncate   := has_table_privilege('authenticated', 'public.enterprise_business_profiles', 'TRUNCATE');
  v_auth_references := has_table_privilege('authenticated', 'public.enterprise_business_profiles', 'REFERENCES');
  v_auth_trigger    := has_table_privilege('authenticated', 'public.enterprise_business_profiles', 'TRIGGER');

  raise notice '====== 0366 POST diagnostics ======';
  raise notice 'POST relacl: %', coalesce(v_acl, '(null)');
  raise notice 'anon  SELECT/TRUNCATE/REFERENCES/TRIGGER: % / % / % / %',
    v_anon_select, v_anon_truncate, v_anon_references, v_anon_trigger;
  raise notice 'auth  SELECT/TRUNCATE/REFERENCES/TRIGGER: % / % / % / %',
    v_auth_select, v_auth_truncate, v_auth_references, v_auth_trigger;
  raise notice '===================================';

  if not (v_anon_select or v_anon_truncate or v_anon_references or v_anon_trigger
          or v_auth_select or v_auth_truncate or v_auth_references or v_auth_trigger) then
    raise notice '0366 COMPLETE — anon/authenticated 모든 권한 제거 완료';
  else
    raise warning '0366 INCOMPLETE — 권한 일부 잔존. relacl 확인 + grantor mismatch 추가 조사 필요';
  end if;
end$$;


-- ============================================================
-- §3. RPC execute 권한 재확인 (회귀 없음 확인)
-- ============================================================
do $$
declare v_rpc_anon int; v_rpc_auth int;
begin
  select
    count(*) filter (where has_function_privilege('anon', oid, 'EXECUTE')),
    count(*) filter (where has_function_privilege('authenticated', oid, 'EXECUTE'))
    into v_rpc_anon, v_rpc_auth
    from pg_proc
   where proname in (
     'get_my_enterprise_role',
     'get_my_enterprise_store_info',
     'get_my_enterprise_dashboard',
     'upsert_my_enterprise_business_profile'
   );

  raise notice '====== 0366 RPC permission ======';
  raise notice 'RPC execute anon: % (expect 0)', v_rpc_anon;
  raise notice 'RPC execute authenticated: % (expect 4)', v_rpc_auth;
end$$;

comment on table public.enterprise_business_profiles is
  'Phase 1-7 (0366 hotfix) — HQ 본사 사업자 정보. 직접 table 접근 차단 강화 (SET ROLE postgres + 개별 권한 + PG17 MAINTAIN 별도 처리).';
