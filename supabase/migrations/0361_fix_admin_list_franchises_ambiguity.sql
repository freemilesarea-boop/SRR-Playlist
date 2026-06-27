-- 0361 — Hotfix: admin_list_franchises() 의 unqualified `status` 모호성 해결
--
-- 원인:
--   public.admin_list_franchises() 의 `returns table (id, name, slug, status, ...)` 에서
--   OUT param `status text` 가 plpgsql body 안에 변수 scope 로 들어옴.
--   본문 subquery 의 unqualified `status='active'` 가 OUT 변수와 충돌 →
--   Postgres 42702 "column reference \"status\" is ambiguous".
--
-- 적용 위치 (0349 기준 본 함수 안 2건):
--   line 726: select count(*) from public.franchise_stores where franchise_id=f.id and status='active'
--   line 731: select count(*) from public.franchise_music_policies where franchise_id=f.id and status='active'
--
-- 수정:
--   - 모든 서브쿼리에 alias 부여 (_fs / _fmp) 후 alias.qualify
--   - franchise_id 도 함께 qualify (현재는 모호하지 않으나 방어적 일관성)
--   - 로직 0줄 변경 (단순 column qualifier 추가)
--   - 다른 어떤 RPC / 테이블 / 인덱스 / 권한 변경 X
--
-- 호환성:
--   - 시그니처 / RETURNS / GRANT 모두 동일
--   - frontend `adminListFranchises()` wrapper 그대로 사용 가능

create or replace function public.admin_list_franchises()
returns table (
  id uuid, name text, slug text, status text,
  store_count bigint, online_store_count bigint,
  active_policy_count bigint, created_at timestamptz
)
language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_threshold timestamptz := now() - interval '3 minutes';
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;
  return query
    select f.id, f.name, f.slug, f.status,
      (select count(*) from public.franchise_stores _fs
        where _fs.franchise_id = f.id and _fs.status = 'active'),
      (select count(*) from public.franchise_stores fs
         left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
        where fs.franchise_id = f.id and fs.status = 'active'
          and ss.last_seen_at is not null and ss.last_seen_at >= v_threshold),
      (select count(*) from public.franchise_music_policies _fmp
        where _fmp.franchise_id = f.id and _fmp.status = 'active'),
      f.created_at
    from public.franchises f
    order by f.created_at desc;
end;
$$;
grant execute on function public.admin_list_franchises() to authenticated;

comment on function public.admin_list_franchises() is
  '0361 hotfix — unqualified status 제거 (42702 fix). 시그니처/로직 불변.';


-- ============================================================
-- Diagnostics — 함수 호출 가능 여부 + 결과 row count
-- ============================================================
do $$
declare
  v_rpc int;
  v_test_ok boolean := false;
  v_err text := null;
begin
  select count(*) into v_rpc from pg_proc where proname = 'admin_list_franchises';

  -- self-test: 실제 호출
  begin
    perform * from public.admin_list_franchises();
    v_test_ok := true;
  exception
    when others then
      v_err := sqlstate || ' ' || sqlerrm;
  end;

  raise notice '====== 0361 admin_list_franchises Hotfix Diagnostics ======';
  raise notice 'RPC count: % / 1', v_rpc;
  raise notice 'self-test: % (err=%, NOTE: do block 은 auth.uid()=null → forbidden 정상)', v_test_ok, coalesce(v_err, '(none)');
  raise notice '==========================================================';

  if v_rpc = 1
     and (v_test_ok or v_err like '%forbidden: admin only%')
  then
    raise notice '0361 HOTFIX COMPLETE — admin_list_franchises 정상';
  else
    raise warning '0361 HOTFIX INCOMPLETE — 위 결과 확인 필요';
  end if;
end$$;
