-- 0352 — Enterprise Phase 1-2: 지역 관리 (enterprise_regions)
--
-- 전제: 0351 enterprise_accounts 적용됨.
--
-- 절대 금지:
--   - stores / franchises / franchise_regions / payment / artist_settlement /
--     store player / users 무수정
--   - 매장 ↔ 지역 매핑은 이 PR 에서 추가 안 함 (Phase 1-3 또는 별도 PR)
--   - hard delete 금지 (RPC 가 soft delete 만 노출)
--
-- 설계 결정:
--   기존 franchise_regions (0349) 는 franchises FK 기반.
--   enterprise_regions 는 enterprise_accounts FK 기반 (별개 도메인).
--   두 구조는 후속 PR 에서 통합 가능하나 이번 단계는 독립 운영.

-- ============================================================
-- 1) enterprise_regions 테이블
-- ============================================================
create table if not exists public.enterprise_regions (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  region_name text not null,
  region_code text not null,
  manager_name text,
  manager_email text,
  manager_phone text,
  status text not null default 'active'
    check (status in ('active','inactive','suspended')),
  store_count integer not null default 0 check (store_count >= 0),
  last_policy_applied_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  constraint enterprise_region_email_format
    check (
      manager_email is null
      or manager_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    ),
  constraint enterprise_region_phone_length
    check (manager_phone is null or (char_length(btrim(manager_phone)) between 8 and 20))
);

-- 같은 본사 내 region_name 중복 차단 (soft delete 무시)
create unique index if not exists enterprise_regions_account_name_unique
  on public.enterprise_regions (enterprise_account_id, lower(btrim(region_name)))
  where deleted_at is null;

-- 같은 본사 내 region_code 중복 차단 (소문자 변환 후 비교)
create unique index if not exists enterprise_regions_account_code_unique
  on public.enterprise_regions (enterprise_account_id, upper(btrim(region_code)))
  where deleted_at is null;

create index if not exists idx_enterprise_regions_account
  on public.enterprise_regions (enterprise_account_id) where deleted_at is null;
create index if not exists idx_enterprise_regions_status
  on public.enterprise_regions (status) where deleted_at is null;
create index if not exists idx_enterprise_regions_name
  on public.enterprise_regions (region_name) where deleted_at is null;
create index if not exists idx_enterprise_regions_code
  on public.enterprise_regions (region_code) where deleted_at is null;
create index if not exists idx_enterprise_regions_active
  on public.enterprise_regions (created_at desc) where deleted_at is null;

drop trigger if exists trg_enterprise_regions_updated_at on public.enterprise_regions;
create trigger trg_enterprise_regions_updated_at
  before update on public.enterprise_regions
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_regions enable row level security;

drop policy if exists enterprise_regions_select on public.enterprise_regions;
create policy enterprise_regions_select on public.enterprise_regions
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_regions.enterprise_account_id
         and ea.auth_user_id is not null and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_regions from authenticated, anon;


-- ============================================================
-- 3) admin_list_enterprise_regions
-- ============================================================
create or replace function public.admin_list_enterprise_regions(
  p_enterprise_account_id uuid default null,
  p_search text default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0,
  p_include_deleted boolean default false
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
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  with filtered as (
    select r.*,
           ea.enterprise_name as enterprise_name,
           ea.manager_email as enterprise_manager_email
      from public.enterprise_regions r
      left join public.enterprise_accounts ea on ea.id = r.enterprise_account_id
     where (p_include_deleted or r.deleted_at is null)
       and (p_enterprise_account_id is null or r.enterprise_account_id = p_enterprise_account_id)
       and (p_status is null or r.status = p_status)
       and (
         v_search is null
         or r.region_name ilike '%' || v_search || '%'
         or r.region_code ilike '%' || v_search || '%'
         or coalesce(r.manager_name, '') ilike '%' || v_search || '%'
         or lower(coalesce(r.manager_email, '')) like '%' || lower(v_search) || '%'
         or coalesce(ea.enterprise_name, '') ilike '%' || v_search || '%'
       )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select r.*,
           ea.enterprise_name as enterprise_name,
           ea.manager_email as enterprise_manager_email
      from public.enterprise_regions r
      left join public.enterprise_accounts ea on ea.id = r.enterprise_account_id
     where (p_include_deleted or r.deleted_at is null)
       and (p_enterprise_account_id is null or r.enterprise_account_id = p_enterprise_account_id)
       and (p_status is null or r.status = p_status)
       and (
         v_search is null
         or r.region_name ilike '%' || v_search || '%'
         or r.region_code ilike '%' || v_search || '%'
         or coalesce(r.manager_name, '') ilike '%' || v_search || '%'
         or lower(coalesce(r.manager_email, '')) like '%' || lower(v_search) || '%'
         or coalesce(ea.enterprise_name, '') ilike '%' || v_search || '%'
       )
     order by r.created_at desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(filtered)), '[]'::jsonb) into v_rows from filtered;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.admin_list_enterprise_regions(uuid, text, text, int, int, boolean) from public, anon;
grant execute on function public.admin_list_enterprise_regions(uuid, text, text, int, int, boolean) to authenticated;


-- ============================================================
-- 4) admin_create_enterprise_region
-- ============================================================
create or replace function public.admin_create_enterprise_region(
  p_enterprise_account_id uuid,
  p_region_name text,
  p_region_code text,
  p_manager_name text default null,
  p_manager_email text default null,
  p_manager_phone text default null,
  p_status text default 'active',
  p_notes text default null
)
returns public.enterprise_regions
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_row public.enterprise_regions;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_enterprise_account_id is null then raise exception 'enterprise_account_id required'; end if;
  if coalesce(btrim(p_region_name), '') = '' then raise exception 'region_name required'; end if;
  if coalesce(btrim(p_region_code), '') = '' then raise exception 'region_code required'; end if;
  if not exists (select 1 from public.enterprise_accounts where id = p_enterprise_account_id and deleted_at is null) then
    raise exception 'enterprise_account not found or deleted: %', p_enterprise_account_id;
  end if;

  begin
    insert into public.enterprise_regions
      (enterprise_account_id, region_name, region_code, manager_name, manager_email,
       manager_phone, status, notes, created_by, updated_by)
    values
      (p_enterprise_account_id,
       btrim(p_region_name),
       upper(btrim(p_region_code)),
       nullif(btrim(coalesce(p_manager_name, '')), ''),
       nullif(lower(btrim(coalesce(p_manager_email, ''))), ''),
       nullif(btrim(coalesce(p_manager_phone, '')), ''),
       coalesce(p_status, 'active'),
       nullif(btrim(coalesce(p_notes, '')), ''),
       auth.uid(), auth.uid())
    returning * into v_row;
  exception when unique_violation then
    raise exception '같은 본사 내 이미 등록된 지역명 또는 지역코드입니다';
  end;

  perform public.admin_log_operation(
    'enterprise_regions', 'admin', 'success', 'created',
    format('Created region: %s (%s) for enterprise %s', v_row.region_name, v_row.region_code, v_row.enterprise_account_id),
    jsonb_build_object('action', 'enterprise_region.create',
      'target_table', 'enterprise_regions', 'target_id', v_row.id,
      'after', to_jsonb(v_row)),
    auth.uid(), v_row.id::text, null, null, null
  );

  return v_row;
end;
$$;
revoke execute on function public.admin_create_enterprise_region(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_create_enterprise_region(uuid, text, text, text, text, text, text, text) to authenticated;


-- ============================================================
-- 5) admin_update_enterprise_region
-- ============================================================
create or replace function public.admin_update_enterprise_region(
  p_id uuid,
  p_region_name text default null,
  p_region_code text default null,
  p_manager_name text default null,
  p_manager_email text default null,
  p_manager_phone text default null,
  p_status text default null,
  p_notes text default null
)
returns public.enterprise_regions
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_before public.enterprise_regions;
  v_row public.enterprise_regions;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select * into v_before from public.enterprise_regions where id = p_id;
  if v_before.id is null then raise exception 'region not found: %', p_id; end if;
  if v_before.deleted_at is not null then raise exception 'cannot modify deleted region'; end if;

  begin
    update public.enterprise_regions set
      region_name = coalesce(nullif(btrim(p_region_name), ''), region_name),
      region_code = coalesce(nullif(upper(btrim(p_region_code)), ''), region_code),
      manager_name = case
        when p_manager_name is null then manager_name
        when btrim(p_manager_name) = '' then null
        else btrim(p_manager_name)
      end,
      manager_email = case
        when p_manager_email is null then manager_email
        when btrim(p_manager_email) = '' then null
        else lower(btrim(p_manager_email))
      end,
      manager_phone = case
        when p_manager_phone is null then manager_phone
        when btrim(p_manager_phone) = '' then null
        else btrim(p_manager_phone)
      end,
      status = coalesce(p_status, status),
      notes = case
        when p_notes is null then notes
        when btrim(p_notes) = '' then null
        else btrim(p_notes)
      end,
      updated_by = auth.uid()
    where id = p_id returning * into v_row;
  exception when unique_violation then
    raise exception '같은 본사 내 이미 등록된 지역명 또는 지역코드입니다';
  end;

  perform public.admin_log_operation(
    'enterprise_regions', 'admin', 'success', 'updated',
    format('Updated region: %s (%s)', v_row.region_name, v_row.region_code),
    jsonb_build_object('action', 'enterprise_region.update',
      'target_table', 'enterprise_regions', 'target_id', v_row.id,
      'before', to_jsonb(v_before), 'after', to_jsonb(v_row)),
    auth.uid(), v_row.id::text, null, null, null
  );
  return v_row;
end;
$$;
revoke execute on function public.admin_update_enterprise_region(uuid, text, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_update_enterprise_region(uuid, text, text, text, text, text, text, text) to authenticated;


-- ============================================================
-- 6) admin_set_enterprise_region_status
-- ============================================================
create or replace function public.admin_set_enterprise_region_status(
  p_id uuid, p_status text
)
returns public.enterprise_regions
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_before public.enterprise_regions; v_row public.enterprise_regions;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('active','inactive','suspended') then
    raise exception 'invalid status: %', p_status;
  end if;

  select * into v_before from public.enterprise_regions where id = p_id and deleted_at is null;
  if v_before.id is null then raise exception 'region not found or deleted'; end if;

  update public.enterprise_regions
     set status = p_status, updated_by = auth.uid()
   where id = p_id returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_regions', 'admin', 'success', 'status_changed',
    format('Status %s → %s for region %s', v_before.status, p_status, v_row.region_name),
    jsonb_build_object('action', 'enterprise_region.status_change',
      'target_table', 'enterprise_regions', 'target_id', v_row.id,
      'before', jsonb_build_object('status', v_before.status),
      'after', jsonb_build_object('status', p_status)),
    auth.uid(), v_row.id::text, null, null, null
  );
  return v_row;
end;
$$;
revoke execute on function public.admin_set_enterprise_region_status(uuid, text) from public, anon;
grant execute on function public.admin_set_enterprise_region_status(uuid, text) to authenticated;


-- ============================================================
-- 7) admin_soft_delete_enterprise_region
-- ============================================================
create or replace function public.admin_soft_delete_enterprise_region(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_before public.enterprise_regions;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_before from public.enterprise_regions where id = p_id and deleted_at is null;
  if v_before.id is null then raise exception 'region not found or already deleted'; end if;

  update public.enterprise_regions
     set deleted_at = now(), status = 'inactive', updated_by = auth.uid()
   where id = p_id;

  perform public.admin_log_operation(
    'enterprise_regions', 'admin', 'warning', 'soft_deleted',
    format('Soft-deleted region: %s (%s)', v_before.region_name, v_before.region_code),
    jsonb_build_object('action', 'enterprise_region.soft_delete',
      'target_table', 'enterprise_regions', 'target_id', p_id,
      'before', to_jsonb(v_before)),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'id', p_id);
end;
$$;
revoke execute on function public.admin_soft_delete_enterprise_region(uuid) from public, anon;
grant execute on function public.admin_soft_delete_enterprise_region(uuid) to authenticated;


-- ============================================================
-- 8) admin_enterprise_region_kpi
-- ============================================================
create or replace function public.admin_enterprise_region_kpi(
  p_enterprise_account_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total_regions', (
      select count(*) from public.enterprise_regions
       where deleted_at is null
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'active_regions', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and status='active'
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'inactive_regions', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and status='inactive'
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'suspended_regions', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and status='suspended'
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'total_stores', (
      select coalesce(sum(store_count), 0)::bigint from public.enterprise_regions
       where deleted_at is null
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'regions_with_policy_applied', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and last_policy_applied_at is not null
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_region_kpi(uuid) from public, anon;
grant execute on function public.admin_enterprise_region_kpi(uuid) to authenticated;


-- ============================================================
-- 9) admin_recount_enterprise_region_stores
--    MVP: 매장 ↔ 지역 매핑 컬럼 없음 (stores 무수정).
--    이번 단계는 store_count 를 0 으로 reset (수동 입력 또는 향후 매핑 PR 후 재계산).
--    Phase 1-3 매장 모니터링 PR 에서 실제 join 추가 가능.
-- ============================================================
create or replace function public.admin_recount_enterprise_region_stores(
  p_id uuid default null  -- null 이면 전체
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_updated int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  -- 현재는 매장 ↔ 지역 매핑이 없으므로 0 으로 reset.
  -- 매핑이 생기면 이 함수 본문만 교체하면 됨 (시그니처 유지).
  update public.enterprise_regions
     set store_count = 0, updated_by = auth.uid()
   where deleted_at is null
     and (p_id is null or id = p_id);
  get diagnostics v_updated = row_count;

  perform public.admin_log_operation(
    'enterprise_regions', 'admin', 'info', 'recounted',
    format('Recounted store_count for %s regions (mapping not yet wired)', v_updated),
    jsonb_build_object('action', 'enterprise_region.recount_stores',
      'updated_count', v_updated, 'target_id', p_id),
    auth.uid(), coalesce(p_id::text, 'all'), null, null, null
  );
  return jsonb_build_object('success', true, 'updated_count', v_updated,
    'note', 'store ↔ region 매핑은 Phase 1-3 이후 추가됩니다. 현재 store_count 는 수동 또는 0 유지.');
end;
$$;
revoke execute on function public.admin_recount_enterprise_region_stores(uuid) from public, anon;
grant execute on function public.admin_recount_enterprise_region_stores(uuid) to authenticated;


comment on table public.enterprise_regions is
  'Enterprise Phase 1-2 — 본사별 지역 (서울/경기 등). store_count 는 Phase 1-3 매장 매핑 후 자동 계산 예정.';
