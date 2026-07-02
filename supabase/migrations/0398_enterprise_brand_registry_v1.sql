-- 0398 — Enterprise Brand Registry + 자동 Onboarding (Phase 3-2)
--
-- 목적:
--   관리자가 브랜드를 사전 등록하고, Enterprise 회원이 브랜드명+코드로 매칭 가입하면
--   자동으로 enterprise_accounts + contract 를 생성하는 신규 flow.
--
-- 절대 원칙 (재확인):
--   • 기존 enterprise_accounts 스키마 무수정 (컬럼 2개 additive 만 추가)
--   • 기존 0363 invite code 시스템 (validate_enterprise_invite / claim_*) 무영향 — 병행 flow
--   • enterprise_monthly_settlements (0372+0390) / enterprise_billing_invoices (0382+0397) 무관
--   • Contract Snapshot 구조 무영향
--   • Cron / Dispatch / Policy / Player 무관
--   • 기존 UI (EnterpriseAccountsPanel / EnterpriseContractsPanel 등) 무영향
--
-- 신규:
--   Table:
--     enterprise_brand_registry               — 관리자 사전 등록 브랜드 템플릿
--   ALTER (additive):
--     enterprise_accounts.brand_registry_id   uuid nullable, FK
--     enterprise_accounts.auto_onboarded      boolean default false
--   Helpers:
--     _hangul_chosung_char(text)              — 한글 1자 → 초성 로마자
--     _generate_brand_code_from_name(text)    — 브랜드명 → BASE 3자
--     _next_brand_code_suffix(base)           — 001~999 순차 발번
--   RPCs (10):
--     admin_generate_brand_code(text)          — 브랜드명 → 최종 코드 (BASE+001)
--     admin_create_brand_registry(...)         — 등록
--     admin_update_brand_registry(...)         — 수정 (brand_code 변경 불가)
--     admin_toggle_brand_registry_active(uuid, bool)
--     admin_list_brand_registry(...)
--     admin_get_brand_registry(uuid)
--     validate_brand_registry_signup(brand_name, brand_code)   ← anon 허용
--     claim_brand_registry_enterprise(...)                     ← authenticated
--     admin_approve_brand_onboarding(uuid)                     ← super_admin
--     admin_reject_brand_onboarding(uuid, reason)              ← super_admin
--
-- 정책:
--   security definer + set search_path='public' + _is_super_admin() gate (일부는 anon/authenticated)
--   revoke public/anon, grant authenticated (validate 만 anon 유지, invite 패턴 재사용)

-- ============================================================
-- A) Table — enterprise_brand_registry
-- ============================================================
create table if not exists public.enterprise_brand_registry (
  id                          uuid primary key default gen_random_uuid(),
  brand_name                  text not null,
  brand_code                  text not null,
  business_name               text not null,
  business_registration_no    text,
  representative_name         text,
  manager_name                text not null,
  manager_email               text not null,
  manager_phone               text,
  business_address            text,
  -- 기본 계약값 (계약 자동 생성 시 사용)
  default_monthly_fee         integer not null default 0        check (default_monthly_fee >= 0),
  default_store_price         integer not null default 4900     check (default_store_price >= 0),
  default_commission_rate     numeric(5,2) not null default 0   check (default_commission_rate >= 0 and default_commission_rate <= 100),
  default_minimum_payout      integer not null default 0        check (default_minimum_payout >= 0),
  default_settlement_method   text not null default 'monthly'   check (default_settlement_method in ('monthly','weekly','manual')),
  default_auto_renew          boolean not null default true,
  is_active                   boolean not null default true,
  memo                        text,
  created_by                  uuid references auth.users(id) on delete set null,
  updated_by                  uuid references auth.users(id) on delete set null,
  deleted_at                  timestamptz,
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now(),
  constraint ebr_manager_email_regex check (manager_email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$')
);

-- unique brand_name / brand_code (soft-delete 제외)
create unique index if not exists ebr_brand_name_unique
  on public.enterprise_brand_registry (lower(btrim(brand_name)))
  where deleted_at is null;

create unique index if not exists ebr_brand_code_unique
  on public.enterprise_brand_registry (upper(btrim(brand_code)))
  where deleted_at is null;

create index if not exists idx_ebr_is_active on public.enterprise_brand_registry(is_active) where deleted_at is null;

-- updated_at trigger
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_ebr_updated_at') then
    create trigger trg_ebr_updated_at
      before update on public.enterprise_brand_registry
      for each row execute function public.set_updated_at();
  end if;
end$$;

-- ============================================================
-- B) enterprise_accounts additive columns
-- ============================================================
alter table public.enterprise_accounts
  add column if not exists brand_registry_id uuid references public.enterprise_brand_registry(id) on delete set null,
  add column if not exists auto_onboarded    boolean not null default false;

create index if not exists idx_ea_brand_registry_id on public.enterprise_accounts(brand_registry_id)
  where brand_registry_id is not null;

-- ============================================================
-- C) Helpers — 한글 초성 로마자 + 자동 코드 발번
-- ============================================================

-- 한글 1자 → 초성 로마자 (ㅇ 이면 모음 로마자로 대체)
create or replace function public._hangul_chosung_char(p_ch text)
returns text
language plpgsql immutable
as $$
declare
  v_code int;
  v_chosung int;
  v_jungsung int;
  chosung_map text[] := array['G','G','N','D','D','R','M','B','B','S','S','','J','J','C','K','T','P','H'];
  jungsung_map text[] := array['A','E','Y','Y','E','E','Y','Y','O','W','W','W','Y','U','W','W','W','Y','E','E','I'];
  v_out text;
begin
  if p_ch is null or length(p_ch) = 0 then return null; end if;
  v_code := ascii(substr(p_ch, 1, 1));
  -- 완성형 한글: 0xAC00 ~ 0xD7A3
  if v_code >= 44032 and v_code <= 55203 then
    v_chosung  := ((v_code - 44032) / (28 * 21)) % 19;
    v_jungsung := ((v_code - 44032) / 28) % 21;
    v_out := chosung_map[v_chosung + 1];
    if v_out is null or v_out = '' then
      v_out := jungsung_map[v_jungsung + 1];
    end if;
    return v_out;
  end if;
  -- 영문/숫자: 대문자 반환
  if p_ch ~ '^[A-Za-z0-9]$' then return upper(p_ch); end if;
  return null;   -- 특수문자/공백은 skip
end $$;

-- 브랜드명 → 3자 BASE (앞 3개 유효 문자, 부족하면 X 로 pad)
create or replace function public._generate_brand_code_from_name(p_name text)
returns text
language plpgsql immutable
as $$
declare
  v_i    int := 1;
  v_len  int;
  v_out  text := '';
  v_ch   text;
  v_map  text;
  v_norm text;
begin
  if p_name is null or btrim(p_name) = '' then return 'XXX'; end if;
  v_norm := btrim(p_name);
  v_len := length(v_norm);
  while v_i <= v_len and length(v_out) < 3 loop
    v_ch := substr(v_norm, v_i, 1);
    v_map := public._hangul_chosung_char(v_ch);
    if v_map is not null and v_map <> '' then
      v_out := v_out || v_map;
    end if;
    v_i := v_i + 1;
  end loop;
  while length(v_out) < 3 loop v_out := v_out || 'X'; end loop;
  return upper(v_out);
end $$;

-- BASE 에 대해 다음 001~999 순차 suffix 계산
create or replace function public._next_brand_code_suffix(p_base text)
returns text
language plpgsql stable
as $$
declare v_max int; v_next int;
begin
  select coalesce(max((substring(brand_code from '(\d+)$'))::int), 0)
    into v_max
  from public.enterprise_brand_registry
  where deleted_at is null
    and upper(brand_code) like upper(p_base) || '%'
    and brand_code ~ ('^' || p_base || '\d+$');
  v_next := v_max + 1;
  if v_next > 999 then raise exception 'brand code space full for base %', p_base; end if;
  return lpad(v_next::text, 3, '0');
end $$;

-- ============================================================
-- D-1) admin_generate_brand_code(text)
-- ============================================================
create or replace function public.admin_generate_brand_code(
  p_brand_name text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_base text; v_suffix text; v_code text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_brand_name is null or btrim(p_brand_name) = '' then raise exception 'p_brand_name required'; end if;
  v_base := public._generate_brand_code_from_name(p_brand_name);
  v_suffix := public._next_brand_code_suffix(v_base);
  v_code := v_base || v_suffix;
  return jsonb_build_object('success', true, 'brand_name', p_brand_name, 'base', v_base, 'suffix', v_suffix, 'brand_code', v_code);
end $$;
revoke execute on function public.admin_generate_brand_code(text) from public, anon;
grant   execute on function public.admin_generate_brand_code(text) to authenticated;

-- ============================================================
-- D-2) admin_create_brand_registry(...)
-- ============================================================
create or replace function public.admin_create_brand_registry(
  p_brand_name text,
  p_brand_code text,                             -- null 이면 자동 발번
  p_business_name text,
  p_manager_name text,
  p_manager_email text,
  p_business_registration_no text default null,
  p_representative_name text default null,
  p_manager_phone text default null,
  p_business_address text default null,
  p_default_monthly_fee int default 0,
  p_default_store_price int default 4900,
  p_default_commission_rate numeric default 0,
  p_default_minimum_payout int default 0,
  p_default_settlement_method text default 'monthly',
  p_default_auto_renew boolean default true,
  p_memo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_code text; v_id uuid; v_gen jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_brand_name is null or btrim(p_brand_name) = '' then raise exception 'p_brand_name required'; end if;
  if p_business_name is null or btrim(p_business_name) = '' then raise exception 'p_business_name required'; end if;
  if p_manager_name is null or btrim(p_manager_name) = '' then raise exception 'p_manager_name required'; end if;
  if p_manager_email is null or btrim(p_manager_email) = '' then raise exception 'p_manager_email required'; end if;

  if p_brand_code is null or btrim(p_brand_code) = '' then
    v_gen := public.admin_generate_brand_code(p_brand_name);
    v_code := v_gen->>'brand_code';
  else
    v_code := upper(btrim(p_brand_code));
  end if;

  insert into public.enterprise_brand_registry (
    brand_name, brand_code, business_name, business_registration_no, representative_name,
    manager_name, manager_email, manager_phone, business_address,
    default_monthly_fee, default_store_price, default_commission_rate,
    default_minimum_payout, default_settlement_method, default_auto_renew,
    memo, created_by, updated_by
  ) values (
    btrim(p_brand_name), v_code, btrim(p_business_name), p_business_registration_no, p_representative_name,
    btrim(p_manager_name), lower(btrim(p_manager_email)), p_manager_phone, p_business_address,
    p_default_monthly_fee, p_default_store_price, p_default_commission_rate,
    p_default_minimum_payout, p_default_settlement_method, p_default_auto_renew,
    p_memo, auth.uid(), auth.uid()
  )
  returning id into v_id;

  return jsonb_build_object('success', true, 'id', v_id, 'brand_code', v_code);
end $$;
revoke execute on function public.admin_create_brand_registry(text, text, text, text, text, text, text, text, text, int, int, numeric, int, text, boolean, text) from public, anon;
grant   execute on function public.admin_create_brand_registry(text, text, text, text, text, text, text, text, text, int, int, numeric, int, text, boolean, text) to authenticated;

-- ============================================================
-- D-3) admin_update_brand_registry(id, ...) — brand_code 변경 불가
-- ============================================================
create or replace function public.admin_update_brand_registry(
  p_id uuid,
  p_brand_name text default null,
  p_business_name text default null,
  p_business_registration_no text default null,
  p_representative_name text default null,
  p_manager_name text default null,
  p_manager_email text default null,
  p_manager_phone text default null,
  p_business_address text default null,
  p_default_monthly_fee int default null,
  p_default_store_price int default null,
  p_default_commission_rate numeric default null,
  p_default_minimum_payout int default null,
  p_default_settlement_method text default null,
  p_default_auto_renew boolean default null,
  p_memo text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_id is null then raise exception 'p_id required'; end if;

  update public.enterprise_brand_registry set
    brand_name                = coalesce(nullif(btrim(p_brand_name), ''), brand_name),
    business_name             = coalesce(nullif(btrim(p_business_name), ''), business_name),
    business_registration_no  = coalesce(nullif(btrim(p_business_registration_no), ''), business_registration_no),
    representative_name       = coalesce(nullif(btrim(p_representative_name), ''), representative_name),
    manager_name              = coalesce(nullif(btrim(p_manager_name), ''), manager_name),
    manager_email             = coalesce(nullif(lower(btrim(p_manager_email)), ''), manager_email),
    manager_phone             = coalesce(nullif(btrim(p_manager_phone), ''), manager_phone),
    business_address          = coalesce(nullif(btrim(p_business_address), ''), business_address),
    default_monthly_fee       = coalesce(p_default_monthly_fee, default_monthly_fee),
    default_store_price       = coalesce(p_default_store_price, default_store_price),
    default_commission_rate   = coalesce(p_default_commission_rate, default_commission_rate),
    default_minimum_payout    = coalesce(p_default_minimum_payout, default_minimum_payout),
    default_settlement_method = coalesce(p_default_settlement_method, default_settlement_method),
    default_auto_renew        = coalesce(p_default_auto_renew, default_auto_renew),
    memo                      = coalesce(p_memo, memo),
    updated_by                = auth.uid(),
    updated_at                = now()
  where id = p_id and deleted_at is null;

  if not found then raise exception 'brand not found or deleted: %', p_id; end if;
  return jsonb_build_object('success', true, 'id', p_id);
end $$;
revoke execute on function public.admin_update_brand_registry(uuid, text, text, text, text, text, text, text, text, int, int, numeric, int, text, boolean, text) from public, anon;
grant   execute on function public.admin_update_brand_registry(uuid, text, text, text, text, text, text, text, text, int, int, numeric, int, text, boolean, text) to authenticated;

-- ============================================================
-- D-4) admin_toggle_brand_registry_active(uuid, bool)
-- ============================================================
create or replace function public.admin_toggle_brand_registry_active(
  p_id uuid, p_is_active boolean
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_id is null then raise exception 'p_id required'; end if;
  update public.enterprise_brand_registry
    set is_active = p_is_active, updated_at = now(), updated_by = auth.uid()
    where id = p_id and deleted_at is null;
  if not found then raise exception 'brand not found: %', p_id; end if;
  return jsonb_build_object('success', true, 'id', p_id, 'is_active', p_is_active);
end $$;
revoke execute on function public.admin_toggle_brand_registry_active(uuid, boolean) from public, anon;
grant   execute on function public.admin_toggle_brand_registry_active(uuid, boolean) to authenticated;

-- ============================================================
-- D-5) admin_list_brand_registry(...)
-- ============================================================
create or replace function public.admin_list_brand_registry(
  p_search text default null,
  p_is_active boolean default null,
  p_limit int default 100,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb; v_total int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with matching as (
    select r.*
    from public.enterprise_brand_registry r
    where r.deleted_at is null
      and (p_search is null or (
        r.brand_name ilike '%' || p_search || '%' or
        r.brand_code ilike '%' || p_search || '%' or
        r.business_name ilike '%' || p_search || '%'
      ))
      and (p_is_active is null or r.is_active = p_is_active)
  )
  select
    coalesce(jsonb_agg(jsonb_build_object(
      'id', id, 'brand_name', brand_name, 'brand_code', brand_code,
      'business_name', business_name, 'business_registration_no', business_registration_no,
      'representative_name', representative_name, 'manager_name', manager_name,
      'manager_email', manager_email, 'manager_phone', manager_phone,
      'business_address', business_address,
      'default_monthly_fee', default_monthly_fee, 'default_store_price', default_store_price,
      'default_commission_rate', default_commission_rate,
      'default_minimum_payout', default_minimum_payout,
      'default_settlement_method', default_settlement_method,
      'default_auto_renew', default_auto_renew,
      'is_active', is_active, 'memo', memo,
      'created_at', created_at, 'updated_at', updated_at
    ) order by created_at desc), '[]'::jsonb),
    count(*)::int
    into v_rows, v_total
  from (select * from matching order by created_at desc offset p_offset limit p_limit) t;

  return jsonb_build_object('success', true, 'data', v_rows, 'total', v_total, 'limit', p_limit, 'offset', p_offset);
end $$;
revoke execute on function public.admin_list_brand_registry(text, boolean, int, int) from public, anon;
grant   execute on function public.admin_list_brand_registry(text, boolean, int, int) to authenticated;

-- ============================================================
-- D-6) admin_get_brand_registry(uuid)
-- ============================================================
create or replace function public.admin_get_brand_registry(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_row public.enterprise_brand_registry;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_row from public.enterprise_brand_registry where id = p_id and deleted_at is null;
  if not found then raise exception 'brand not found: %', p_id; end if;
  return jsonb_build_object('success', true, 'brand', to_jsonb(v_row));
end $$;
revoke execute on function public.admin_get_brand_registry(uuid) from public, anon;
grant   execute on function public.admin_get_brand_registry(uuid) to authenticated;

-- ============================================================
-- D-7) validate_brand_registry_signup(brand_name, brand_code)
--   anon 허용 — 0363 invite validate 패턴 재사용.
-- ============================================================
create or replace function public.validate_brand_registry_signup(
  p_brand_name text, p_brand_code text
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_row public.enterprise_brand_registry;
begin
  if p_brand_name is null or btrim(p_brand_name) = '' then
    return jsonb_build_object('success', false, 'reason', 'brand_name_required');
  end if;
  if p_brand_code is null or btrim(p_brand_code) = '' then
    return jsonb_build_object('success', false, 'reason', 'brand_code_required');
  end if;

  select * into v_row
  from public.enterprise_brand_registry
  where lower(btrim(brand_name)) = lower(btrim(p_brand_name))
    and upper(btrim(brand_code)) = upper(btrim(p_brand_code))
    and deleted_at is null
    and is_active = true;

  if not found then
    return jsonb_build_object('success', false, 'reason', 'brand_not_matched');
  end if;

  return jsonb_build_object('success', true, 'brand_id', v_row.id,
    'brand_name', v_row.brand_name, 'brand_code', v_row.brand_code,
    'business_name', v_row.business_name);
end $$;
revoke execute on function public.validate_brand_registry_signup(text, text) from public;
grant   execute on function public.validate_brand_registry_signup(text, text) to anon, authenticated;

-- ============================================================
-- D-8) claim_brand_registry_enterprise(brand_name, brand_code, ...)
--   authenticated 필요. 성공 시:
--     1) enterprise_accounts row 신규 생성 (auth_user_id = auth.uid()).
--        brand_registry_id, brand_code, enterprise_name, manager_email 등 자동 세팅.
--        status='invited' (관리자 승인 대기).
--        auto_onboarded=true.
--     2) 해당 registry 에 대해 ACTIVE contract 이 없으면 신규 계약 자동 생성 (status='draft').
--        기존 ACTIVE 있으면 재사용 (신규 생성 금지).
--        contract_no 자동 발번 = brand_code || '-' || to_char(now(), 'YYYYMMDD-HH24MISS')
-- ============================================================
create or replace function public.claim_brand_registry_enterprise(
  p_brand_name text, p_brand_code text,
  p_business_name text default null,
  p_manager_phone text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_reg public.enterprise_brand_registry;
  v_ea_id uuid;
  v_contract_id uuid;
  v_contract_no text;
  v_existing_ea uuid;
  v_existing_contract uuid;
  v_email text;
begin
  if v_uid is null then raise exception 'authenticated required'; end if;
  if p_brand_name is null or btrim(p_brand_name) = '' then raise exception 'p_brand_name required'; end if;
  if p_brand_code is null or btrim(p_brand_code) = '' then raise exception 'p_brand_code required'; end if;

  -- validate
  select * into v_reg
  from public.enterprise_brand_registry
  where lower(btrim(brand_name)) = lower(btrim(p_brand_name))
    and upper(btrim(brand_code)) = upper(btrim(p_brand_code))
    and deleted_at is null and is_active = true;
  if not found then raise exception 'brand_not_matched'; end if;

  -- 이미 이 auth_user_id 가 다른 enterprise_account 를 가진 경우 idempotent (같은 registry) or reject
  select id into v_existing_ea
  from public.enterprise_accounts
  where auth_user_id = v_uid and deleted_at is null;

  if v_existing_ea is not null then
    -- 다른 registry 라면 거절, 같은 registry 라면 idempotent 반환
    perform 1 from public.enterprise_accounts
     where id = v_existing_ea and brand_registry_id = v_reg.id;
    if not found then raise exception 'auth_user_id_already_bound_to_other_brand'; end if;
    v_ea_id := v_existing_ea;
  else
    select coalesce(u.email, v_reg.manager_email) into v_email
    from auth.users u where u.id = v_uid;

    insert into public.enterprise_accounts (
      enterprise_name, manager_name, manager_email, manager_phone,
      role, status, auth_user_id, brand_code, brand_registry_id,
      auto_onboarded, onboarding_enabled, notes
    ) values (
      v_reg.brand_name,
      v_reg.manager_name,
      coalesce(v_email, v_reg.manager_email),
      coalesce(nullif(btrim(p_manager_phone), ''), v_reg.manager_phone),
      'enterprise_manager',
      'invited',                                        -- 관리자 승인 대기
      v_uid,
      v_reg.brand_code,
      v_reg.id,
      true,
      true,
      case when p_business_name is not null and btrim(p_business_name) <> '' then 'auto-onboarded (business: ' || p_business_name || ')'
           else 'auto-onboarded via brand registry' end
    ) returning id into v_ea_id;
  end if;

  -- 계약 자동 생성 (이미 ACTIVE 있으면 재사용)
  select id into v_existing_contract
  from public.enterprise_contracts
  where enterprise_account_id = v_ea_id and deleted_at is null and status in ('active','draft')
  order by created_at desc limit 1;

  if v_existing_contract is not null then
    v_contract_id := v_existing_contract;
  else
    v_contract_no := v_reg.brand_code || '-' || to_char(now(), 'YYYYMMDD-HH24MISS');
    insert into public.enterprise_contracts (
      enterprise_account_id, contract_no, contract_name, contract_type,
      start_date, end_date, auto_renew, renewal_period_month, status,
      monthly_store_price, commission_rate, minimum_payout, settlement_method,
      memo, created_by, updated_by
    ) values (
      v_ea_id, v_contract_no, v_reg.brand_name || ' 자동 계약', 'standard',
      current_date, null, v_reg.default_auto_renew, 12, 'draft',
      v_reg.default_store_price, v_reg.default_commission_rate,
      v_reg.default_minimum_payout, v_reg.default_settlement_method,
      'auto-generated by brand registry onboarding', v_uid, v_uid
    ) returning id into v_contract_id;
  end if;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'contract_id', v_contract_id,
    'brand_registry_id', v_reg.id,
    'brand_code', v_reg.brand_code,
    'brand_name', v_reg.brand_name,
    'status', 'invited',
    'awaiting_admin_approval', true
  );
end $$;
revoke execute on function public.claim_brand_registry_enterprise(text, text, text, text) from public, anon;
grant   execute on function public.claim_brand_registry_enterprise(text, text, text, text) to authenticated;

-- ============================================================
-- D-9) admin_approve_brand_onboarding(uuid)
--   enterprise_account.status='invited' → 'active'
--   해당 registry 의 draft contract → 'active'
-- ============================================================
create or replace function public.admin_approve_brand_onboarding(p_ea_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_ea public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_ea_id is null then raise exception 'p_ea_id required'; end if;

  select * into v_ea from public.enterprise_accounts
   where id = p_ea_id and deleted_at is null and auto_onboarded = true;
  if not found then raise exception 'enterprise_account not found or not auto-onboarded: %', p_ea_id; end if;

  update public.enterprise_accounts
     set status = 'active', updated_at = now(), updated_by = auth.uid()
   where id = p_ea_id;

  update public.enterprise_contracts
     set status = 'active', updated_at = now(), updated_by = auth.uid()
   where enterprise_account_id = p_ea_id and status = 'draft' and deleted_at is null;

  return jsonb_build_object('success', true, 'enterprise_account_id', p_ea_id, 'status', 'active');
end $$;
revoke execute on function public.admin_approve_brand_onboarding(uuid) from public, anon;
grant   execute on function public.admin_approve_brand_onboarding(uuid) to authenticated;

-- ============================================================
-- D-10) admin_reject_brand_onboarding(uuid, text)
--   auto_onboarded=true 인 enterprise_account 를 soft-delete + auth_user_id 해제.
--   contract 는 status='terminated' 로 마킹.
-- ============================================================
create or replace function public.admin_reject_brand_onboarding(
  p_ea_id uuid, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_ea public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_ea_id is null then raise exception 'p_ea_id required'; end if;

  select * into v_ea from public.enterprise_accounts
   where id = p_ea_id and deleted_at is null and auto_onboarded = true;
  if not found then raise exception 'enterprise_account not found or not auto-onboarded: %', p_ea_id; end if;

  update public.enterprise_accounts
     set status = 'inactive',
         auth_user_id = null,
         notes = coalesce(notes, '') || E'\n[REJECTED] ' || coalesce(p_reason, '(no reason)'),
         deleted_at = now(),
         updated_at = now(), updated_by = auth.uid()
   where id = p_ea_id;

  update public.enterprise_contracts
     set status = 'terminated', updated_at = now(), updated_by = auth.uid()
   where enterprise_account_id = p_ea_id and status in ('draft','active') and deleted_at is null;

  return jsonb_build_object('success', true, 'enterprise_account_id', p_ea_id, 'rejected', true, 'reason', p_reason);
end $$;
revoke execute on function public.admin_reject_brand_onboarding(uuid, text) from public, anon;
grant   execute on function public.admin_reject_brand_onboarding(uuid, text) to authenticated;

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_t int; v_c int; v_r int;
begin
  select count(*) into v_t from information_schema.tables where table_schema='public' and table_name='enterprise_brand_registry';
  select count(*) into v_c from information_schema.columns where table_schema='public' and table_name='enterprise_accounts'
    and column_name in ('brand_registry_id','auto_onboarded');
  select count(*) into v_r from pg_proc where pronamespace = 'public'::regnamespace
    and proname in (
      'admin_generate_brand_code','admin_create_brand_registry','admin_update_brand_registry',
      'admin_toggle_brand_registry_active','admin_list_brand_registry','admin_get_brand_registry',
      'validate_brand_registry_signup','claim_brand_registry_enterprise',
      'admin_approve_brand_onboarding','admin_reject_brand_onboarding'
    );
  raise notice '====== 0398 Brand Registry + 자동 Onboarding ======';
  raise notice 'table               : % / 1', v_t;
  raise notice 'ea additive columns : % / 2', v_c;
  raise notice 'rpcs                : % / 10', v_r;
  if v_t = 1 and v_c = 2 and v_r = 10 then
    raise notice '0398 COMPLETE — additive only, existing 0363 invite system unaffected.';
  else
    raise warning '0398 CHECK — t=% c=% r=%', v_t, v_c, v_r;
  end if;
end$$;
