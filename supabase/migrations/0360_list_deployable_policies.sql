-- 0360 — Enterprise Phase 1-5 UX hotfix: admin_list_deployable_policies
--
-- 목적:
--   "정책 배포 생성" 모달에서 운영자가 UUID 를 손으로 입력하지 않도록,
--   배포 가능한 정책 목록을 latest_version_number + target_store_count + active_store_count
--   와 함께 한 번에 반환.
--
-- 원칙:
--   - 기존 admin_create_policy_deployment / RLS / franchise_music_policies / franchise_stores
--     스키마 절대 수정 X
--   - 신규 RPC 1개만 추가 (관측/조회용)
--   - users.business_name 같은 추측 컬럼 절대 사용 X
--   - super admin 전체 / enterprise 담당자는 자기 enterprise_accounts.auth_user_id 기준
--     franchise_admins 매핑된 franchise 정책만
--
-- 의존:
--   - 0349 (franchises, franchise_music_policies, franchise_policy_versions,
--           franchise_stores, franchise_admins, store_policy_sync_status,
--           _is_super_admin)
--   - 0351 (enterprise_accounts)

create or replace function public.admin_list_deployable_policies(
  p_search text default null,
  p_franchise_id uuid default null,
  p_enterprise_account_id uuid default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_uid uuid := auth.uid();
  v_is_admin boolean := public._is_super_admin();
  v_online_threshold timestamptz := now() - interval '3 minutes';
  v_ent_uid uuid;
  v_total bigint;
  v_rows jsonb;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if not v_is_admin then
    -- enterprise 담당자: auth_user_id 가 자신과 일치하는 enterprise_account 만 권한
    select ea.auth_user_id into v_ent_uid
      from public.enterprise_accounts ea
     where ea.auth_user_id = v_uid and ea.deleted_at is null
     limit 1;
    if v_ent_uid is null then
      raise exception 'forbidden: admin only';
    end if;
  end if;

  with base as (
    select
      p.id as policy_id,
      p.name as policy_name,
      p.description as policy_description,
      p.status as policy_status,
      p.is_default,
      p.effective_from,
      p.effective_until,
      p.updated_at,
      p.created_at,
      p.franchise_id,
      f.name as franchise_name,
      coalesce(
        (select max(v.version_number) from public.franchise_policy_versions v where v.policy_id = p.id),
        1
      ) as latest_version_number,
      (
        select count(*) from public.franchise_stores fs
         where fs.franchise_id = p.franchise_id and fs.status = 'active'
      )::int as target_store_count,
      (
        select count(*) from public.franchise_stores fs
          left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
         where fs.franchise_id = p.franchise_id and fs.status = 'active'
           and ss.last_seen_at is not null and ss.last_seen_at >= v_online_threshold
      )::int as active_store_count
    from public.franchise_music_policies p
    left join public.franchises f on f.id = p.franchise_id
    where p.status in ('active','draft')
      and (p_franchise_id is null or p.franchise_id = p_franchise_id)
      -- enterprise 담당자: auth_user_id 가 매칭되는 franchise_admins 의 franchise 만
      and (
        v_is_admin
        or exists (
          select 1 from public.franchise_admins fa
           where fa.franchise_id = p.franchise_id and fa.user_id = v_uid
        )
      )
      -- p_enterprise_account_id 가 주어지면, 해당 enterprise 의 auth_user_id 와
      -- franchise_admins 매핑된 franchise 만 (현재 enterprise↔franchise 직접 매핑 없음)
      and (
        p_enterprise_account_id is null
        or exists (
          select 1
            from public.enterprise_accounts ea
            join public.franchise_admins fa on fa.user_id = ea.auth_user_id
           where ea.id = p_enterprise_account_id
             and ea.deleted_at is null
             and fa.franchise_id = p.franchise_id
        )
      )
      and (
        v_search is null
        or p.name ilike '%' || v_search || '%'
        or coalesce(p.description, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
      )
  )
  select count(*) into v_total from base;

  with base as (
    select
      p.id as policy_id,
      p.name as policy_name,
      p.description as policy_description,
      p.status as policy_status,
      p.is_default,
      p.effective_from,
      p.effective_until,
      p.updated_at,
      p.created_at,
      p.franchise_id,
      f.name as franchise_name,
      coalesce(
        (select max(v.version_number) from public.franchise_policy_versions v where v.policy_id = p.id),
        1
      ) as latest_version_number,
      (
        select count(*) from public.franchise_stores fs
         where fs.franchise_id = p.franchise_id and fs.status = 'active'
      )::int as target_store_count,
      (
        select count(*) from public.franchise_stores fs
          left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
         where fs.franchise_id = p.franchise_id and fs.status = 'active'
           and ss.last_seen_at is not null and ss.last_seen_at >= v_online_threshold
      )::int as active_store_count
    from public.franchise_music_policies p
    left join public.franchises f on f.id = p.franchise_id
    where p.status in ('active','draft')
      and (p_franchise_id is null or p.franchise_id = p_franchise_id)
      and (
        v_is_admin
        or exists (
          select 1 from public.franchise_admins fa
           where fa.franchise_id = p.franchise_id and fa.user_id = v_uid
        )
      )
      and (
        p_enterprise_account_id is null
        or exists (
          select 1
            from public.enterprise_accounts ea
            join public.franchise_admins fa on fa.user_id = ea.auth_user_id
           where ea.id = p_enterprise_account_id
             and ea.deleted_at is null
             and fa.franchise_id = p.franchise_id
        )
      )
      and (
        v_search is null
        or p.name ilike '%' || v_search || '%'
        or coalesce(p.description, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
      )
    order by p.is_default desc, p.updated_at desc nulls last
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(base)), '[]'::jsonb) into v_rows from base;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total,
      'limit', v_limit,
      'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) from public, anon;
grant execute on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) to authenticated;

comment on function public.admin_list_deployable_policies(text, uuid, uuid, int, int) is
  'Phase 1-5 UX — 정책 배포 생성 모달 dropdown 공급용. latest_version + target/active store count 포함.';


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc int;
  v_test jsonb;
  v_data_count int;
begin
  select count(*) into v_rpc from pg_proc where proname = 'admin_list_deployable_policies';

  -- super admin context 가 없으면 raise exception 'unauthorized' 발생 → exception 처리
  begin
    select public.admin_list_deployable_policies(null, null, null, 5, 0) into v_test;
    v_data_count := coalesce(jsonb_array_length(v_test->'data'), 0);
  exception
    when others then
      v_test := jsonb_build_object('error', sqlerrm);
      v_data_count := -1;
  end;

  raise notice '====== Phase 1-5 UX — list_deployable_policies Diagnostics ======';
  raise notice 'RPC count: % / 1', v_rpc;
  raise notice 'self-test data length: % (NOTE: -1 면 unauthorized 정상, do block 은 auth.uid()=null 환경)', v_data_count;
  raise notice '================================================================';

  if v_rpc = 1 then
    raise notice 'Phase 1-5 UX RPC ready';
  else
    raise warning 'Phase 1-5 UX RPC INCOMPLETE';
  end if;
end$$;
