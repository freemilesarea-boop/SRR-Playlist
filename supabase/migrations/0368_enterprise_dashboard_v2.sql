-- 0368 — Enterprise Phase 1-9: HQ dashboard 본문 확장 (additive)
--
-- 목표:
--   /enterprise/me 의 1회 호출로 매장 현황 / 지역별 분포 / 최근 매장(개선) 모두 수령.
--
-- 절대 원칙:
--   - 신규 table / column 생성 0
--   - 기존 RPC 시그니처 동일 (단순 CREATE OR REPLACE FUNCTION)
--   - 반환 JSON 에 신규 필드만 추가 (기존 필드 모두 유지 — 회귀 0)
--   - artist / payout / settlement / playlist / store player / heartbeat / policy 무관
--
-- 의존: 0349 / 0351 / 0352 / 0363 / 0364

create or replace function public.get_my_enterprise_dashboard()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
  v_franchises jsonb;
  v_regions jsonb;
  v_store_count int;
  v_recent_stores jsonb;
  v_business_profile jsonb;
  -- Phase 1-9 additions
  v_store_stats jsonb;
  v_region_distribution jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select * into v_ea
    from public.enterprise_accounts
   where auth_user_id = v_uid
     and deleted_at is null
     and status in ('active','invited')
   limit 1;
  if v_ea.id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'slug', f.slug, 'status', f.status,
    'role', ef.role,
    'store_count', (
      select count(*) from public.franchise_stores fs
       where fs.franchise_id = f.id and fs.status = 'active'
    )
  ) order by ef.role, f.name), '[]'::jsonb)
    into v_franchises
    from public.enterprise_franchises ef
    join public.franchises f on f.id = ef.franchise_id
   where ef.enterprise_account_id = v_ea.id and ef.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
    'status', r.status
  ) order by r.region_name), '[]'::jsonb)
    into v_regions
    from public.enterprise_regions r
   where r.enterprise_account_id = v_ea.id and r.deleted_at is null;

  select count(*) into v_store_count
    from public.franchise_stores fs
    join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
      and ef.deleted_at is null
   where ef.enterprise_account_id = v_ea.id and fs.status = 'active';

  -- ============================================================
  -- Phase 1-9 — 매장 현황 카드 (전체 / 활성 / 정지 / inactive / 최근 7일 가입)
  -- enterprise_franchises join 으로 본사 산하 매장만 집계.
  -- ============================================================
  with my_stores as (
    select fs.*
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id
  )
  select jsonb_build_object(
    'total',     count(*),
    'active',    count(*) filter (where status = 'active'),
    'inactive',  count(*) filter (where status = 'inactive'),
    'suspended', count(*) filter (where status = 'suspended'),
    'joined_7d', count(*) filter (where joined_at is not null
                                    and joined_at >= now() - interval '7 days')
  ) into v_store_stats from my_stores;

  -- ============================================================
  -- Phase 1-9 — 지역별 매장 분포
  -- 등록된 enterprise_regions 각각 + 지역 미지정 (NULL) 별도 묶음
  -- ============================================================
  with my_stores as (
    select fs.*
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.id
  ),
  by_region as (
    -- 등록된 region 별
    select er.id as region_id,
           er.region_name,
           er.region_code,
           er.status as region_status,
           coalesce(count(ms.store_id) filter (where ms.status = 'active'), 0)::int as active_count,
           coalesce(count(ms.store_id), 0)::int as total_count
      from public.enterprise_regions er
      left join my_stores ms on ms.enterprise_region_id = er.id
     where er.enterprise_account_id = v_ea.id and er.deleted_at is null
     group by er.id, er.region_name, er.region_code, er.status
  ),
  unassigned as (
    -- 지역 미지정 매장
    select null::uuid as region_id,
           '(지역 미지정)'::text as region_name,
           null::text as region_code,
           'unassigned'::text as region_status,
           coalesce(count(*) filter (where status = 'active'), 0)::int as active_count,
           coalesce(count(*), 0)::int as total_count
      from my_stores
     where enterprise_region_id is null
     having count(*) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'region_id', region_id,
    'region_name', region_name,
    'region_code', region_code,
    'region_status', region_status,
    'active_count', active_count,
    'total_count', total_count
  ) order by total_count desc, region_name), '[]'::jsonb)
    into v_region_distribution
    from (
      select * from by_region
      union all
      select * from unassigned
    ) merged;

  -- ============================================================
  -- 최근 연결 매장 10개 — 개선: status 무관 모두 표시 (badge 로 구분)
  -- ============================================================
  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', fs.store_id,
    'store_name', fs.store_name,
    'franchise_name', f.name,
    'region_name', er.region_name,
    'joined_at', fs.joined_at,
    'status', fs.status
  ) order by fs.joined_at desc), '[]'::jsonb)
    into v_recent_stores
    from (
      select fs2.* from public.franchise_stores fs2
        join public.enterprise_franchises ef2 on ef2.franchise_id = fs2.franchise_id
          and ef2.deleted_at is null
       where ef2.enterprise_account_id = v_ea.id
       order by fs2.joined_at desc nulls last
       limit 10
    ) fs
    join public.franchises f on f.id = fs.franchise_id
    left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

  -- business profile (있으면 row, 없으면 null marker)
  select to_jsonb(ebp) into v_business_profile
    from public.enterprise_business_profiles ebp
   where ebp.enterprise_account_id = v_ea.id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account', jsonb_build_object(
      'id', v_ea.id,
      'enterprise_name', v_ea.enterprise_name,
      'brand_code', v_ea.brand_code,
      'manager_name', v_ea.manager_name,
      'manager_email', v_ea.manager_email,
      'manager_phone', v_ea.manager_phone,
      'role', v_ea.role,
      'status', v_ea.status,
      'onboarding_enabled', v_ea.onboarding_enabled,
      'allow_self_register_region', v_ea.allow_self_register_region,
      'hq_invite_code', v_ea.hq_invite_code,
      'store_invite_code', v_ea.store_invite_code,
      'invite_code_rotated_at', v_ea.invite_code_rotated_at,
      'last_login_at', v_ea.last_login_at
    ),
    'franchises', v_franchises,
    'regions', v_regions,
    'store_count', v_store_count,
    'store_stats', v_store_stats,                     -- Phase 1-9 신규
    'region_distribution', v_region_distribution,     -- Phase 1-9 신규
    'recent_stores', v_recent_stores,
    'business_profile', v_business_profile,
    'business_profile_present', v_business_profile is not null,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_dashboard() from public, anon;
grant execute on function public.get_my_enterprise_dashboard() to authenticated;

comment on function public.get_my_enterprise_dashboard() is
  'Phase 1-9 — HQ dashboard 확장: store_stats + region_distribution + recent_stores 개선 (additive).';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_rpc int;
begin
  select count(*) into v_rpc from pg_proc where proname='get_my_enterprise_dashboard';
  raise notice '====== 0368 HQ Dashboard v2 Diagnostics ======';
  raise notice 'get_my_enterprise_dashboard RPC: % / 1', v_rpc;
  raise notice '  신규 필드: store_stats / region_distribution / recent_stores (status 포함)';
  raise notice '==============================================';
  if v_rpc = 1 then
    raise notice '0368 COMPLETE — HQ dashboard v2 ready';
  else
    raise warning '0368 INCOMPLETE';
  end if;
end$$;
