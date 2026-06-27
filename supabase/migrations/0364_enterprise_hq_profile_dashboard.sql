-- 0364 — Enterprise Phase 1-7: HQ 본사 사업자 정보 + 셀프 dashboard RPC
--
-- 목표:
--   Phase 1-6 invite-code 가입으로 본사 담당자가 된 사용자 (enterprise_accounts.auth_user_id
--   매칭) 가 자기 본사 정보 + 사업자 정보를 입력하고, 자기 enterprise dashboard 를
--   조회할 수 있도록 함.
--
-- 절대 원칙:
--   - additive only (DROP / 컬럼 제거 / RLS 약화 0)
--   - 기존 enterprise_accounts / franchises / franchise_stores 변경 0
--   - 기존 get_my_franchise_hq_dashboard (X6.90 franchise_admins 용) 변경 0
--   - 매장 플레이어 / heartbeat / now-playing / policy deployment 변경 0
--
-- 의존:
--   - 0351 (enterprise_accounts, auth_user_id 필드)
--   - 0349 (franchises, franchise_stores)
--   - 0352 (enterprise_regions)
--   - 0363 (enterprise_franchises mapping, invite codes)
--   - 0041 (admin_log_operation)

-- ============================================================
-- 1) enterprise_business_profiles — 1:1 with enterprise_accounts
-- ============================================================
create table if not exists public.enterprise_business_profiles (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null unique
    references public.enterprise_accounts(id) on delete cascade,
  company_name text,
  business_number text,
  representative_name text,
  business_address text,
  contact_phone text,
  tax_invoice_email text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ebp_enterprise
  on public.enterprise_business_profiles (enterprise_account_id);

drop trigger if exists trg_ebp_updated_at on public.enterprise_business_profiles;
create trigger trg_ebp_updated_at before update on public.enterprise_business_profiles
  for each row execute function public._touch_updated_at();

alter table public.enterprise_business_profiles enable row level security;

-- super admin: 전체 / HQ 본인 (auth_user_id 매칭): 본인 enterprise 만
drop policy if exists ebp_select on public.enterprise_business_profiles;
create policy ebp_select on public.enterprise_business_profiles
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_business_profiles.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_business_profiles from authenticated, anon;


-- ============================================================
-- 2) get_my_enterprise_role — 빠른 권한 체크
--    ProfilePage 가 mount 시 1회 호출해 분기 사용.
-- ============================================================
create or replace function public.get_my_enterprise_role()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
begin
  if v_uid is null then
    return jsonb_build_object('is_hq', false);
  end if;

  select * into v_ea
    from public.enterprise_accounts
   where auth_user_id = v_uid
     and deleted_at is null
     and status in ('active','invited')
   limit 1;

  if v_ea.id is null then
    return jsonb_build_object('is_hq', false);
  end if;

  return jsonb_build_object(
    'is_hq', true,
    'enterprise_account_id', v_ea.id,
    'enterprise_name', v_ea.enterprise_name,
    'brand_code', v_ea.brand_code,
    'status', v_ea.status
  );
end;
$$;
revoke execute on function public.get_my_enterprise_role() from public, anon;
grant execute on function public.get_my_enterprise_role() to authenticated;


-- ============================================================
-- 3) get_my_enterprise_store_info — 매장 사용자 정보
--    account_type='business' + franchise_stores.store_id = auth.uid() +
--    enterprise_franchises 매핑 존재 시 enterprise 정보 반환.
-- ============================================================
create or replace function public.get_my_enterprise_store_info()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row record;
begin
  if v_uid is null then
    return jsonb_build_object('is_store', false);
  end if;

  -- 본인이 business + active franchise_store + enterprise_franchises 매핑 가진 매장
  select
    fs.store_name,
    fs.status as store_status,
    fs.enterprise_region_id,
    f.id as franchise_id,
    f.name as franchise_name,
    er.region_name,
    er.region_code,
    ea.id as enterprise_account_id,
    ea.enterprise_name,
    ea.brand_code
  into v_row
  from public.users u
  join public.franchise_stores fs on fs.store_id = u.id
  join public.franchises f on f.id = fs.franchise_id
  left join public.enterprise_regions er on er.id = fs.enterprise_region_id
  left join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
    and ef.deleted_at is null
  left join public.enterprise_accounts ea on ea.id = ef.enterprise_account_id
    and ea.deleted_at is null
  where u.id = v_uid
    and coalesce(u.account_type, 'individual') = 'business'
    and u.withdrawn_at is null
    and fs.status = 'active'
  order by case ef.role when 'primary' then 0 else 1 end nulls last
  limit 1;

  if v_row.franchise_id is null then
    return jsonb_build_object('is_store', false);
  end if;

  return jsonb_build_object(
    'is_store', true,
    'store_name', v_row.store_name,
    'store_status', v_row.store_status,
    'franchise_id', v_row.franchise_id,
    'franchise_name', v_row.franchise_name,
    'region_name', v_row.region_name,
    'region_code', v_row.region_code,
    'enterprise_account_id', v_row.enterprise_account_id,
    'enterprise_name', v_row.enterprise_name,
    'brand_code', v_row.brand_code
  );
end;
$$;
revoke execute on function public.get_my_enterprise_store_info() from public, anon;
grant execute on function public.get_my_enterprise_store_info() to authenticated;


-- ============================================================
-- 4) get_my_enterprise_dashboard — HQ 전용 dashboard
--    super admin 도 호출 가능하지만 enterprise_accounts.auth_user_id 매칭이 필수.
-- ============================================================
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

  -- 최근 연결 매장 10개 (joined_at 최신순)
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
         and fs2.status = 'active'
       order by fs2.joined_at desc
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
    'recent_stores', v_recent_stores,
    'business_profile', v_business_profile,
    'business_profile_present', v_business_profile is not null,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_dashboard() from public, anon;
grant execute on function public.get_my_enterprise_dashboard() to authenticated;


-- ============================================================
-- 5) upsert_my_enterprise_business_profile — HQ 본인이 사업자 정보 저장
-- ============================================================
create or replace function public.upsert_my_enterprise_business_profile(
  p_company_name text default null,
  p_business_number text default null,
  p_representative_name text default null,
  p_business_address text default null,
  p_contact_phone text default null,
  p_tax_invoice_email text default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_row public.enterprise_business_profiles;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select id into v_ea_id
    from public.enterprise_accounts
   where auth_user_id = v_uid
     and deleted_at is null
     and status in ('active','invited')
   limit 1;
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  insert into public.enterprise_business_profiles
    (enterprise_account_id, company_name, business_number, representative_name,
     business_address, contact_phone, tax_invoice_email, notes)
  values
    (v_ea_id,
     nullif(btrim(coalesce(p_company_name, '')), ''),
     nullif(btrim(coalesce(p_business_number, '')), ''),
     nullif(btrim(coalesce(p_representative_name, '')), ''),
     nullif(btrim(coalesce(p_business_address, '')), ''),
     nullif(btrim(coalesce(p_contact_phone, '')), ''),
     nullif(btrim(coalesce(p_tax_invoice_email, '')), ''),
     nullif(btrim(coalesce(p_notes, '')), ''))
  on conflict (enterprise_account_id) do update set
    company_name = excluded.company_name,
    business_number = excluded.business_number,
    representative_name = excluded.representative_name,
    business_address = excluded.business_address,
    contact_phone = excluded.contact_phone,
    tax_invoice_email = excluded.tax_invoice_email,
    notes = excluded.notes,
    updated_at = now()
  returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_business_profiles', 'enterprise', 'success', 'upserted',
    format('HQ user upserted business profile for enterprise %s', v_ea_id),
    jsonb_build_object('action', 'enterprise_business_profile.upsert',
      'target_id', v_ea_id),
    v_uid, v_ea_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke execute on function public.upsert_my_enterprise_business_profile(text, text, text, text, text, text, text) from public, anon;
grant execute on function public.upsert_my_enterprise_business_profile(text, text, text, text, text, text, text) to authenticated;


-- ============================================================
-- 6) Diagnostics
-- ============================================================
do $$
declare
  v_table int;
  v_rpcs int;
begin
  select count(*) into v_table from information_schema.tables
   where table_schema='public' and table_name='enterprise_business_profiles';
  select count(*) into v_rpcs from pg_proc where proname in (
    'get_my_enterprise_role',
    'get_my_enterprise_store_info',
    'get_my_enterprise_dashboard',
    'upsert_my_enterprise_business_profile'
  );

  raise notice '====== 0364 Enterprise HQ Profile Dashboard Diagnostics ======';
  raise notice 'enterprise_business_profiles table: % / 1', v_table;
  raise notice 'new RPCs: % / 4', v_rpcs;
  raise notice '==============================================================';

  if v_table = 1 and v_rpcs = 4 then
    raise notice '0364 COMPLETE — Enterprise HQ profile + dashboard ready';
  else
    raise warning '0364 INCOMPLETE';
  end if;
end$$;

comment on table public.enterprise_business_profiles is
  'Phase 1-7 — HQ 본사 사업자/세금/연락 정보. 1:1 with enterprise_accounts.';
comment on function public.get_my_enterprise_role() is
  'Phase 1-7 — 로그인 사용자가 enterprise HQ 인지 빠른 체크. ProfilePage 분기용.';
comment on function public.get_my_enterprise_store_info() is
  'Phase 1-7 — 로그인 사용자가 enterprise 매장인지 + 매장 요약 정보.';
comment on function public.get_my_enterprise_dashboard() is
  'Phase 1-7 — HQ 셀프 대시보드 (브랜드/매장수/지역/최근 매장/초대코드/사업자 정보).';
