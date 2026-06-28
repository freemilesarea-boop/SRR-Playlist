-- 0375 — Enterprise Regions v2: status maintenance + default_policy_id + list/kpi 확장
--
-- 목표 (Priority 1-2):
--   1) status check 확장 — 'maintenance' 추가 (suspended 유지, 호환)
--   2) default_policy_id 컬럼 — 지역별 기본 정책 연결 (향후 예약/이벤트/시즌 정책 확장 기반)
--   3) admin_list_enterprise_regions 본문 교체 (시그니처 동일) — 정책 join + online/offline count + 검색 정책명 확장
--   4) admin_enterprise_region_kpi 본문 교체 (시그니처 동일) — online_stores / offline_stores 추가
--   5) admin_update_enterprise_region 시그니처 확장 (+ p_default_policy_id uuid)
--      — 기존 시그니처 DROP + 신규 시그니처 CREATE. audit 에 정책 변경 before/after 포함.
--
-- 절대 원칙:
--   - 신규 table 0 (ALTER + RPC replace 만)
--   - 기존 RPC 시그니처 보존 (update 만 확장)
--   - store_policy_sync_status / franchise_music_policies / store/player 무수정
--   - artist/settlement/payment/AI/recommendation 무관
--   - idempotent
--
-- online 기준: store_policy_sync_status.last_seen_at >= now() - 5min
--             (기존 sync_status / heartbeat 패턴 그대로)

-- ============================================================
-- 1) status check 확장 — 'maintenance' 추가
-- ============================================================
do $$
declare v_con name;
begin
  select c.conname into v_con
    from pg_constraint c
    join pg_class t on t.oid = c.conrelid
   where t.relname = 'enterprise_regions'
     and c.contype = 'c'
     and pg_get_constraintdef(c.oid) ilike '%status%active%inactive%suspended%';
  if v_con is not null then
    execute format('alter table public.enterprise_regions drop constraint %I', v_con);
  end if;
end$$;

alter table public.enterprise_regions
  drop constraint if exists enterprise_regions_status_check;
alter table public.enterprise_regions
  add constraint enterprise_regions_status_check
  check (status in ('active','inactive','suspended','maintenance'));


-- ============================================================
-- 2) default_policy_id 컬럼 — 지역별 기본 정책 FK
-- ============================================================
alter table public.enterprise_regions
  add column if not exists default_policy_id uuid
  references public.franchise_music_policies(id) on delete set null;

create index if not exists idx_enterprise_regions_default_policy
  on public.enterprise_regions (default_policy_id)
  where default_policy_id is not null;

comment on column public.enterprise_regions.default_policy_id is
  'Priority 1-2 (0375) — 지역 기본 정책. 향후 예약/이벤트/시즌 정책 확장 기반.';


-- ============================================================
-- 3) admin_list_enterprise_regions 본문 교체 (시그니처 동일)
--    + 정책 join (franchise_music_policies 이름)
--    + online/offline count (store_policy_sync_status JOIN, 5min threshold)
--    + recent_24h_count
--    + search 에 정책명 추가
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
           ea.enterprise_name,
           ea.manager_email as enterprise_manager_email,
           p.name as default_policy_name,
           p.status as default_policy_status,
           coalesce(s.online_count, 0) as online_count,
           coalesce(s.recent_24h_count, 0) as recent_24h_count,
           greatest(coalesce(r.store_count, 0) - coalesce(s.online_count, 0), 0) as offline_count
      from public.enterprise_regions r
      left join public.enterprise_accounts ea on ea.id = r.enterprise_account_id
      left join public.franchise_music_policies p on p.id = r.default_policy_id
      left join lateral (
        select
          count(*) filter (
            where sps.last_seen_at is not null
              and sps.last_seen_at >= now() - interval '5 minutes'
          )::int as online_count,
          count(*) filter (
            where sps.last_seen_at is not null
              and sps.last_seen_at >= now() - interval '24 hours'
          )::int as recent_24h_count
        from public.store_policy_sync_status sps
        where sps.enterprise_region_id = r.id
      ) s on true
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
         or coalesce(p.name, '') ilike '%' || v_search || '%'
       )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select r.*,
           ea.enterprise_name,
           ea.manager_email as enterprise_manager_email,
           p.name as default_policy_name,
           p.status as default_policy_status,
           coalesce(s.online_count, 0) as online_count,
           coalesce(s.recent_24h_count, 0) as recent_24h_count,
           greatest(coalesce(r.store_count, 0) - coalesce(s.online_count, 0), 0) as offline_count
      from public.enterprise_regions r
      left join public.enterprise_accounts ea on ea.id = r.enterprise_account_id
      left join public.franchise_music_policies p on p.id = r.default_policy_id
      left join lateral (
        select
          count(*) filter (
            where sps.last_seen_at is not null
              and sps.last_seen_at >= now() - interval '5 minutes'
          )::int as online_count,
          count(*) filter (
            where sps.last_seen_at is not null
              and sps.last_seen_at >= now() - interval '24 hours'
          )::int as recent_24h_count
        from public.store_policy_sync_status sps
        where sps.enterprise_region_id = r.id
      ) s on true
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
         or coalesce(p.name, '') ilike '%' || v_search || '%'
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
-- 4) admin_enterprise_region_kpi 본문 교체 (시그니처 동일)
--    + online_stores / offline_stores 집계
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
    'maintenance_regions', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and status='maintenance'
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
    'online_stores', (
      select count(*)::bigint
        from public.store_policy_sync_status sps
        join public.enterprise_regions r on r.id = sps.enterprise_region_id
       where r.deleted_at is null
         and sps.last_seen_at is not null
         and sps.last_seen_at >= now() - interval '5 minutes'
         and (p_enterprise_account_id is null or r.enterprise_account_id = p_enterprise_account_id)
    ),
    'offline_stores', (
      select count(*)::bigint
        from public.store_policy_sync_status sps
        join public.enterprise_regions r on r.id = sps.enterprise_region_id
       where r.deleted_at is null
         and (sps.last_seen_at is null or sps.last_seen_at < now() - interval '5 minutes')
         and (p_enterprise_account_id is null or r.enterprise_account_id = p_enterprise_account_id)
    ),
    'regions_with_policy_applied', (
      select count(*) from public.enterprise_regions
       where deleted_at is null and (last_policy_applied_at is not null or default_policy_id is not null)
         and (p_enterprise_account_id is null or enterprise_account_id = p_enterprise_account_id)
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_region_kpi(uuid) from public, anon;
grant execute on function public.admin_enterprise_region_kpi(uuid) to authenticated;


-- ============================================================
-- 5) admin_update_enterprise_region 시그니처 확장
--    + p_default_policy_id uuid default null
--    기존 시그니처 DROP → 신규 시그니처 CREATE
-- ============================================================
drop function if exists public.admin_update_enterprise_region(uuid, text, text, text, text, text, text, text);

create or replace function public.admin_update_enterprise_region(
  p_id uuid,
  p_region_name text default null,
  p_region_code text default null,
  p_manager_name text default null,
  p_manager_email text default null,
  p_manager_phone text default null,
  p_status text default null,
  p_notes text default null,
  p_default_policy_id uuid default null
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

  if p_status is not null and p_status not in ('active','inactive','suspended','maintenance') then
    raise exception 'invalid status: %', p_status;
  end if;

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
      -- default_policy_id: 명시 null 또는 값 모두 처리하려면 sentinel 필요.
      -- 현 단계는 null=유지, 값=교체 (clear 는 별도 RPC 필요 시 추후 추가)
      default_policy_id = coalesce(p_default_policy_id, default_policy_id),
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
      'before', to_jsonb(v_before), 'after', to_jsonb(v_row),
      'default_policy_changed', (v_before.default_policy_id is distinct from v_row.default_policy_id)),
    auth.uid(), v_row.id::text, null, null, null
  );
  return v_row;
end;
$$;
revoke execute on function public.admin_update_enterprise_region(uuid, text, text, text, text, text, text, text, uuid) from public, anon;
grant execute on function public.admin_update_enterprise_region(uuid, text, text, text, text, text, text, text, uuid) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_col int;
  v_check_maintenance int;
  v_idx int;
  v_upd_sig int;
begin
  select count(*) into v_col from information_schema.columns
    where table_schema='public' and table_name='enterprise_regions' and column_name='default_policy_id';
  select count(*) into v_check_maintenance from pg_constraint
    where conname='enterprise_regions_status_check'
      and pg_get_constraintdef(oid) ilike '%maintenance%';
  select count(*) into v_idx from pg_indexes
    where schemaname='public' and indexname='idx_enterprise_regions_default_policy';
  select count(*) into v_upd_sig from pg_proc
    where proname='admin_update_enterprise_region'
      and pg_get_function_identity_arguments(oid) =
          'p_id uuid, p_region_name text, p_region_code text, p_manager_name text, p_manager_email text, p_manager_phone text, p_status text, p_notes text, p_default_policy_id uuid';

  raise notice '====== 0375 Region v2 Diagnostics ======';
  raise notice 'default_policy_id col: % / 1', v_col;
  raise notice 'status check includes maintenance: % / 1', v_check_maintenance;
  raise notice 'idx_default_policy: % / 1', v_idx;
  raise notice 'admin_update_enterprise_region (new 9-arg sig): % / 1', v_upd_sig;
  raise notice '========================================';

  if v_col=1 and v_check_maintenance=1 and v_idx=1 and v_upd_sig=1 then
    raise notice '0375 COMPLETE — Region Management v2 ready';
  else
    raise warning '0375 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
