-- 0363 — Enterprise Phase 1-6: 초대코드 기반 본사/매장 자동 온보딩
--
-- 목표:
--   관리자가 사전 등록한 브랜드의 hq/store 초대코드로 본사 담당자/매장이
--   셀프 가입하면 enterprise_account / franchise / franchise_stores 가
--   자동 연결되도록 함.
--
-- 절대 원칙:
--   - DB schema 변경은 additive only (DROP 없음)
--   - 기존 admin_create_enterprise_account / admin_link_franchise_store /
--     apply_franchise_policy / store_heartbeat 등 모두 유지 (fallback)
--   - 매장 플레이어 / heartbeat / now-playing / policy deployment 무관
--   - 다중 ALTER 금지 — 각 컬럼 add column if not exists 개별 문장
--   - users.business_name 같은 추측 컬럼 사용 금지
--   - 코드/이름 정규화: 코드는 UPPER+trim, 이름은 lower(trim) 비교
--
-- 의존:
--   - 0349 (franchises, franchise_stores, _is_super_admin, _touch_updated_at)
--   - 0351 (enterprise_accounts), 0352 (enterprise_regions)
--   - 0041 (admin_log_operation)
--   - 0362 (admin_link_franchise_store 정합화)


-- ============================================================
-- 1) enterprise_accounts ALTER (개별 문장 — 다중 ALTER 금지)
-- ============================================================
alter table public.enterprise_accounts add column if not exists brand_code text;
alter table public.enterprise_accounts add column if not exists hq_invite_code text;
alter table public.enterprise_accounts add column if not exists store_invite_code text;
alter table public.enterprise_accounts add column if not exists invite_code_rotated_at timestamptz;
alter table public.enterprise_accounts add column if not exists onboarding_enabled boolean not null default true;
alter table public.enterprise_accounts add column if not exists allow_self_register_region boolean not null default false;

-- Unique partial indexes (대소문자/공백 정규화 후 비교)
create unique index if not exists enterprise_accounts_brand_code_active_unique
  on public.enterprise_accounts (upper(btrim(brand_code)))
  where deleted_at is null and brand_code is not null;

create unique index if not exists enterprise_accounts_hq_invite_code_unique
  on public.enterprise_accounts (upper(btrim(hq_invite_code)))
  where hq_invite_code is not null;

create unique index if not exists enterprise_accounts_store_invite_code_unique
  on public.enterprise_accounts (upper(btrim(store_invite_code)))
  where store_invite_code is not null;

create index if not exists idx_enterprise_accounts_onboarding
  on public.enterprise_accounts (onboarding_enabled) where deleted_at is null;


-- ============================================================
-- 2) franchise_stores ALTER — enterprise_region_id (Q1 권장안 A)
--    매장 1개 = 1 franchise region(legacy) + 1 enterprise region 둘 다 보유 가능
-- ============================================================
alter table public.franchise_stores
  add column if not exists enterprise_region_id uuid
  references public.enterprise_regions(id) on delete set null;

create index if not exists idx_franchise_stores_enterprise_region
  on public.franchise_stores (enterprise_region_id)
  where enterprise_region_id is not null;


-- ============================================================
-- 3) enterprise_franchises — mapping table (Q2 권장안 A)
--    한 enterprise 가 여러 franchise 보유 가능, primary 는 1개만
-- ============================================================
create table if not exists public.enterprise_franchises (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  franchise_id uuid not null references public.franchises(id) on delete cascade,
  role text not null default 'primary' check (role in ('primary','secondary')),
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create unique index if not exists enterprise_franchises_pair_unique
  on public.enterprise_franchises (enterprise_account_id, franchise_id)
  where deleted_at is null;

-- primary 1개만 per enterprise (soft delete 무시)
create unique index if not exists enterprise_franchises_primary_unique
  on public.enterprise_franchises (enterprise_account_id)
  where role = 'primary' and deleted_at is null;

create index if not exists idx_enterprise_franchises_enterprise
  on public.enterprise_franchises (enterprise_account_id) where deleted_at is null;
create index if not exists idx_enterprise_franchises_franchise
  on public.enterprise_franchises (franchise_id) where deleted_at is null;

drop trigger if exists trg_enterprise_franchises_updated_at on public.enterprise_franchises;
create trigger trg_enterprise_franchises_updated_at before update on public.enterprise_franchises
  for each row execute function public._touch_updated_at();

alter table public.enterprise_franchises enable row level security;

drop policy if exists ef_select on public.enterprise_franchises;
create policy ef_select on public.enterprise_franchises
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_franchises.enterprise_account_id
         and ea.auth_user_id is not null and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_franchises from authenticated, anon;


-- ============================================================
-- 4) enterprise_invite_claims — audit (Q3 권장안 A — last4 만 저장)
-- ============================================================
create table if not exists public.enterprise_invite_claims (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  franchise_id uuid references public.franchises(id) on delete set null,
  user_id uuid,
  claim_type text not null check (claim_type in ('hq_admin','store')),
  invite_code_last4 text,
  brand_name_input text,
  brand_code_input text,
  store_name_input text,
  region_name_input text,
  status text not null default 'pending' check (status in ('success','failed','pending')),
  failure_reason text,
  user_agent text,
  created_at timestamptz not null default now()
);

create index if not exists idx_eic_enterprise
  on public.enterprise_invite_claims (enterprise_account_id, created_at desc);
create index if not exists idx_eic_claim_type
  on public.enterprise_invite_claims (claim_type, status, created_at desc);
create index if not exists idx_eic_user
  on public.enterprise_invite_claims (user_id) where user_id is not null;

alter table public.enterprise_invite_claims enable row level security;

drop policy if exists eic_select on public.enterprise_invite_claims;
create policy eic_select on public.enterprise_invite_claims
  for select using (
    public._is_super_admin()
    or (user_id is not null and user_id = auth.uid())
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_invite_claims.enterprise_account_id
         and ea.auth_user_id is not null and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_invite_claims from authenticated, anon;


-- ============================================================
-- 5) _generate_enterprise_invite_code helper
--    충돌 시 최대 10회 재시도, 실패하면 예외.
--    글자 집합에서 O/0/I/1 같이 헷갈리는 문자 제외.
-- ============================================================
create or replace function public._generate_enterprise_invite_code(
  p_brand_prefix text default null,
  p_code_kind text default 'GEN'    -- 'HQ' | 'ST' | 'GEN'
)
returns text
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_prefix text := nullif(upper(btrim(coalesce(p_brand_prefix, ''))), '');
  v_kind text := upper(coalesce(nullif(btrim(p_code_kind), ''), 'GEN'));
  v_chars text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- O/0/I/1 제외
  v_len int := length(v_chars);
  v_tries int := 0;
  v_max_tries int := 10;
  v_suffix text;
  v_code text;
  i int;
begin
  loop
    v_tries := v_tries + 1;
    v_suffix := '';
    for i in 1..6 loop
      v_suffix := v_suffix || substr(v_chars, 1 + (floor(random() * v_len))::int, 1);
    end loop;
    if v_prefix is null then
      v_code := case v_kind
        when 'HQ' then 'ENT-' || v_suffix
        when 'ST' then 'STORE-' || v_suffix
        else 'CODE-' || v_suffix
      end;
    else
      v_code := v_prefix || '-' || v_kind || '-' || v_suffix;
    end if;
    if not exists (
      select 1 from public.enterprise_accounts
       where upper(btrim(hq_invite_code)) = upper(v_code)
          or upper(btrim(store_invite_code)) = upper(v_code)
    ) then
      return v_code;
    end if;
    if v_tries >= v_max_tries then
      raise exception 'invite code generation failed after % tries (prefix=%, kind=%)',
        v_max_tries, coalesce(v_prefix, '-'), v_kind;
    end if;
  end loop;
end;
$$;
revoke execute on function public._generate_enterprise_invite_code(text, text) from public, anon, authenticated;


-- ============================================================
-- 6) admin_create_enterprise_account_v2
--    기존 admin_create_enterprise_account 는 그대로 유지.
-- ============================================================
create or replace function public.admin_create_enterprise_account_v2(
  p_enterprise_name text,
  p_manager_name text,
  p_manager_email text,
  p_manager_phone text default null,
  p_brand_code text default null,
  p_hq_invite_code text default null,
  p_store_invite_code text default null,
  p_franchise_name text default null,
  p_franchise_slug text default null,
  p_role text default 'enterprise_manager',
  p_status text default 'active'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea public.enterprise_accounts;
  v_franchise_id uuid;
  v_brand_code text;
  v_hq_code text;
  v_store_code text;
  v_email text := lower(btrim(coalesce(p_manager_email, '')));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_enterprise_name), '') = '' then raise exception 'enterprise_name required'; end if;
  if coalesce(btrim(p_manager_name), '') = '' then raise exception 'manager_name required'; end if;
  if v_email = '' then raise exception 'manager_email required'; end if;

  v_brand_code := nullif(upper(btrim(coalesce(p_brand_code, ''))), '');
  v_hq_code    := nullif(upper(btrim(coalesce(p_hq_invite_code, ''))), '');
  v_store_code := nullif(upper(btrim(coalesce(p_store_invite_code, ''))), '');

  if v_hq_code is null then
    v_hq_code := public._generate_enterprise_invite_code(v_brand_code, 'HQ');
  end if;
  if v_store_code is null then
    v_store_code := public._generate_enterprise_invite_code(v_brand_code, 'ST');
  end if;
  if v_hq_code = v_store_code then
    raise exception 'hq_invite_code and store_invite_code must differ';
  end if;

  begin
    insert into public.enterprise_accounts
      (enterprise_name, manager_name, manager_email, manager_phone,
       role, status, brand_code, hq_invite_code, store_invite_code,
       invite_code_rotated_at, onboarding_enabled,
       created_by, updated_by)
    values
      (btrim(p_enterprise_name), btrim(p_manager_name), v_email,
       nullif(btrim(coalesce(p_manager_phone, '')), ''),
       coalesce(p_role, 'enterprise_manager'),
       coalesce(p_status, 'active'),
       v_brand_code, v_hq_code, v_store_code,
       now(), true,
       v_uid, v_uid)
    returning * into v_ea;
  exception when unique_violation then
    raise exception '이미 등록된 이메일 / 브랜드 코드 / 초대코드입니다';
  end;

  -- franchise 자동 생성/연결 (옵션)
  if coalesce(btrim(p_franchise_name), '') <> '' then
    select id into v_franchise_id
      from public.franchises
     where name = btrim(p_franchise_name) and status = 'active'
     limit 1;
    if v_franchise_id is null then
      insert into public.franchises (name, slug, status, created_by)
      values (btrim(p_franchise_name),
              nullif(btrim(coalesce(p_franchise_slug, '')), ''),
              'active', v_uid)
      returning id into v_franchise_id;
    end if;
    insert into public.enterprise_franchises
      (enterprise_account_id, franchise_id, role, status)
    values (v_ea.id, v_franchise_id, 'primary', 'active')
    on conflict do nothing;
  end if;

  perform public.admin_log_operation(
    'enterprise_accounts', 'admin', 'success', 'created_v2',
    format('Created enterprise (v2): %s — hq=%s store=%s brand=%s franchise=%s',
           v_ea.enterprise_name, v_hq_code, v_store_code,
           coalesce(v_brand_code, '-'),
           coalesce(v_franchise_id::text, '-')),
    jsonb_build_object('action', 'enterprise_account.create_v2',
      'target_table', 'enterprise_accounts',
      'target_id', v_ea.id,
      'franchise_id', v_franchise_id),
    v_uid, v_ea.id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'enterprise_account', to_jsonb(v_ea),
    'franchise_id', v_franchise_id,
    'codes', jsonb_build_object(
      'brand_code', v_brand_code,
      'hq_invite_code', v_hq_code,
      'store_invite_code', v_store_code
    )
  );
end;
$$;
revoke execute on function public.admin_create_enterprise_account_v2(text,text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.admin_create_enterprise_account_v2(text,text,text,text,text,text,text,text,text,text,text) to authenticated;


-- ============================================================
-- 7) admin_rotate_enterprise_invite_code
-- ============================================================
create or replace function public.admin_rotate_enterprise_invite_code(
  p_enterprise_account_id uuid,
  p_code_type text,                 -- 'hq' | 'store' | 'both'
  p_custom_code text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts;
  v_new_hq text := null;
  v_new_store text := null;
  v_brand text;
  v_custom text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_code_type not in ('hq','store','both') then
    raise exception 'invalid code_type: %', p_code_type;
  end if;
  select * into v_ea from public.enterprise_accounts
   where id = p_enterprise_account_id and deleted_at is null;
  if v_ea.id is null then raise exception 'enterprise_account not found or deleted'; end if;

  v_brand := nullif(upper(btrim(coalesce(v_ea.brand_code, ''))), '');
  v_custom := nullif(upper(btrim(coalesce(p_custom_code, ''))), '');

  if p_code_type = 'both' and v_custom is not null then
    raise exception 'custom_code 은 code_type=both 와 함께 사용할 수 없습니다';
  end if;

  if p_code_type in ('hq','both') then
    v_new_hq := coalesce(
      case when p_code_type = 'both' then null else v_custom end,
      public._generate_enterprise_invite_code(v_brand, 'HQ')
    );
  end if;
  if p_code_type in ('store','both') then
    v_new_store := coalesce(
      case when p_code_type = 'both' then null else v_custom end,
      public._generate_enterprise_invite_code(v_brand, 'ST')
    );
  end if;

  begin
    update public.enterprise_accounts
       set hq_invite_code = coalesce(v_new_hq, hq_invite_code),
           store_invite_code = coalesce(v_new_store, store_invite_code),
           invite_code_rotated_at = now(),
           updated_by = auth.uid()
     where id = p_enterprise_account_id;
  exception when unique_violation then
    raise exception '이미 사용 중인 초대코드입니다';
  end;

  perform public.admin_log_operation(
    'enterprise_accounts', 'admin', 'warning', 'invite_code_rotated',
    format('Rotated invite code (%s) for enterprise %s',
           p_code_type, v_ea.enterprise_name),
    jsonb_build_object('action', 'enterprise_account.rotate_invite',
      'target_id', p_enterprise_account_id, 'code_type', p_code_type,
      'new_hq', v_new_hq, 'new_store', v_new_store),
    auth.uid(), p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'codes', jsonb_build_object(
      'hq_invite_code', coalesce(v_new_hq, v_ea.hq_invite_code),
      'store_invite_code', coalesce(v_new_store, v_ea.store_invite_code)
    ),
    'rotated_at', now()
  );
end;
$$;
revoke execute on function public.admin_rotate_enterprise_invite_code(uuid, text, text) from public, anon;
grant execute on function public.admin_rotate_enterprise_invite_code(uuid, text, text) to authenticated;


-- ============================================================
-- 8) admin_get_enterprise_invite_summary
-- ============================================================
create or replace function public.admin_get_enterprise_invite_summary(p_enterprise_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts;
  v_franchises jsonb;
  v_regions jsonb;
  v_store_count int;
  v_claims jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_ea from public.enterprise_accounts
   where id = p_enterprise_account_id and deleted_at is null;
  if v_ea.id is null then raise exception 'enterprise_account not found or deleted'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', f.id, 'name', f.name, 'slug', f.slug, 'status', f.status,
    'role', ef.role
  ) order by ef.role, f.name), '[]'::jsonb)
    into v_franchises
    from public.enterprise_franchises ef
    join public.franchises f on f.id = ef.franchise_id
   where ef.enterprise_account_id = p_enterprise_account_id and ef.deleted_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code,
    'status', r.status
  ) order by r.region_name), '[]'::jsonb)
    into v_regions
    from public.enterprise_regions r
   where r.enterprise_account_id = p_enterprise_account_id and r.deleted_at is null;

  select count(*) into v_store_count
    from public.franchise_stores fs
    join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
   where ef.enterprise_account_id = p_enterprise_account_id and fs.status = 'active';

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', c.id, 'claim_type', c.claim_type, 'status', c.status,
    'brand_name_input', c.brand_name_input,
    'store_name_input', c.store_name_input,
    'region_name_input', c.region_name_input,
    'failure_reason', c.failure_reason,
    'invite_code_last4', c.invite_code_last4,
    'user_id', c.user_id,
    'created_at', c.created_at
  ) order by c.created_at desc), '[]'::jsonb)
    into v_claims
    from (
      select * from public.enterprise_invite_claims
       where enterprise_account_id = p_enterprise_account_id
       order by created_at desc limit 20
    ) c;

  return jsonb_build_object(
    'success', true,
    'enterprise_account', to_jsonb(v_ea),
    'franchises', v_franchises,
    'regions', v_regions,
    'store_count', v_store_count,
    'recent_claims', v_claims,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_invite_summary(uuid) from public, anon;
grant execute on function public.admin_get_enterprise_invite_summary(uuid) to authenticated;


-- ============================================================
-- 9) validate_enterprise_invite — anon 허용 (가입 전 검증)
--    실패 시 generic 메시지 (브랜드/코드 구분 누설 X).
--    audit 는 실제 claim 시점에만 (validate 빈번 호출 보호).
-- ============================================================
create or replace function public.validate_enterprise_invite(
  p_brand_name text,
  p_invite_code text,
  p_claim_type text                 -- 'hq_admin' | 'store'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts;
  v_norm_name text := lower(btrim(coalesce(p_brand_name, '')));
  v_norm_code text := upper(btrim(coalesce(p_invite_code, '')));
  v_regions jsonb;
begin
  if p_claim_type not in ('hq_admin','store') then
    raise exception 'invalid claim_type';
  end if;
  if v_norm_name = '' or v_norm_code = '' then
    return jsonb_build_object('success', false,
                              'reason', '브랜드명 또는 초대코드가 올바르지 않습니다.');
  end if;

  if p_claim_type = 'hq_admin' then
    select * into v_ea from public.enterprise_accounts
     where lower(btrim(enterprise_name)) = v_norm_name
       and upper(btrim(hq_invite_code)) = v_norm_code
       and deleted_at is null
       and onboarding_enabled = true
       and status in ('active','invited')
     limit 1;
  else
    select * into v_ea from public.enterprise_accounts
     where lower(btrim(enterprise_name)) = v_norm_name
       and upper(btrim(store_invite_code)) = v_norm_code
       and deleted_at is null
       and onboarding_enabled = true
       and status in ('active','invited')
     limit 1;
  end if;

  if v_ea.id is null then
    return jsonb_build_object('success', false,
                              'reason', '브랜드명 또는 초대코드가 올바르지 않습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code
  ) order by r.region_name), '[]'::jsonb)
    into v_regions
    from public.enterprise_regions r
   where r.enterprise_account_id = v_ea.id
     and r.deleted_at is null
     and r.status = 'active';

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea.id,
    'enterprise_name', v_ea.enterprise_name,
    'brand_code', v_ea.brand_code,
    'claim_type', p_claim_type,
    'allow_self_register_region', v_ea.allow_self_register_region,
    'allowed_regions', v_regions
  );
end;
$$;
revoke execute on function public.validate_enterprise_invite(text, text, text) from public;
grant execute on function public.validate_enterprise_invite(text, text, text) to anon, authenticated;


-- ============================================================
-- 10) claim_enterprise_hq_account — authenticated
-- ============================================================
create or replace function public.claim_enterprise_hq_account(
  p_brand_name text,
  p_invite_code text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_existing_uid uuid;
  v_ea_id uuid;
  v_validate jsonb;
  v_claim_id uuid;
  v_last4 text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  v_validate := public.validate_enterprise_invite(p_brand_name, p_invite_code, 'hq_admin');

  if not coalesce((v_validate->>'success')::boolean, false) then
    return jsonb_build_object('success', false,
                              'reason', coalesce(v_validate->>'reason', '검증 실패'));
  end if;

  v_ea_id := (v_validate->>'enterprise_account_id')::uuid;
  v_last4 := right(upper(btrim(coalesce(p_invite_code, ''))), 4);

  select auth_user_id into v_existing_uid
    from public.enterprise_accounts where id = v_ea_id;

  if v_existing_uid is not null and v_existing_uid <> v_uid then
    insert into public.enterprise_invite_claims
      (enterprise_account_id, user_id, claim_type, invite_code_last4,
       brand_name_input, status, failure_reason, user_agent)
    values
      (v_ea_id, v_uid, 'hq_admin', v_last4, btrim(p_brand_name),
       'failed', '이미 다른 사용자가 연결된 본사 계정', p_user_agent);
    raise exception '이미 연결된 본사 계정입니다.';
  end if;

  -- idempotent: 이미 본인 claim 이면 그대로 success
  update public.enterprise_accounts
     set auth_user_id = v_uid,
         last_login_at = now(),
         updated_by = v_uid
   where id = v_ea_id
     and (auth_user_id is null or auth_user_id = v_uid);

  insert into public.enterprise_invite_claims
    (enterprise_account_id, user_id, claim_type, invite_code_last4,
     brand_name_input, status, user_agent)
  values
    (v_ea_id, v_uid, 'hq_admin', v_last4, btrim(p_brand_name),
     'success', p_user_agent)
  returning id into v_claim_id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'claim_id', v_claim_id
  );
end;
$$;
revoke execute on function public.claim_enterprise_hq_account(text, text, text) from public, anon;
grant execute on function public.claim_enterprise_hq_account(text, text, text) to authenticated;


-- ============================================================
-- 11) claim_enterprise_store_account — authenticated business user
--     Q4 권장안 A: allow_self_register_region=true 일 때만 신규 지역 자동 생성
-- ============================================================
create or replace function public.claim_enterprise_store_account(
  p_brand_name text,
  p_invite_code text,
  p_store_name text,
  p_region_name text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.users;
  v_validate jsonb;
  v_ea_id uuid;
  v_ea public.enterprise_accounts;
  v_allow_self_region boolean;
  v_region public.enterprise_regions;
  v_franchise_id uuid;
  v_store public.franchise_stores;
  v_claim_id uuid;
  v_last4 text;
  v_brand text := btrim(coalesce(p_brand_name, ''));
  v_store_name text := btrim(coalesce(p_store_name, ''));
  v_region_name text := btrim(coalesce(p_region_name, ''));
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_store_name = '' then raise exception 'store_name required'; end if;
  if v_region_name = '' then raise exception 'region_name required'; end if;

  -- users.account_type='business' AND withdrawn_at IS NULL (0362 일관 기준)
  select * into v_user from public.users where id = v_uid;
  if v_user.id is null then
    raise exception 'users row not found — 가입 직후 동기화 지연 가능 (잠시 후 재시도)';
  end if;
  if v_user.withdrawn_at is not null then raise exception 'user withdrawn'; end if;
  if coalesce(v_user.account_type, 'individual') <> 'business' then
    raise exception 'business 계정만 매장 가입이 가능합니다.';
  end if;

  v_validate := public.validate_enterprise_invite(p_brand_name, p_invite_code, 'store');
  if not coalesce((v_validate->>'success')::boolean, false) then
    return jsonb_build_object('success', false,
                              'reason', coalesce(v_validate->>'reason', '검증 실패'));
  end if;

  v_ea_id := (v_validate->>'enterprise_account_id')::uuid;
  v_allow_self_region := coalesce((v_validate->>'allow_self_register_region')::boolean, false);
  v_last4 := right(upper(btrim(coalesce(p_invite_code, ''))), 4);
  select * into v_ea from public.enterprise_accounts where id = v_ea_id;

  -- region 매칭
  select * into v_region
    from public.enterprise_regions
   where enterprise_account_id = v_ea_id
     and lower(btrim(region_name)) = lower(v_region_name)
     and deleted_at is null
   limit 1;

  if v_region.id is null then
    if v_allow_self_region then
      insert into public.enterprise_regions
        (enterprise_account_id, region_name, region_code, status, created_by, updated_by)
      values
        (v_ea_id, v_region_name,
         upper(substr(regexp_replace(v_region_name, '\s+', '', 'g'), 1, 12)),
         'active', v_uid, v_uid)
      returning * into v_region;
    else
      insert into public.enterprise_invite_claims
        (enterprise_account_id, user_id, claim_type, invite_code_last4,
         brand_name_input, store_name_input, region_name_input,
         status, failure_reason, user_agent)
      values
        (v_ea_id, v_uid, 'store', v_last4, v_brand, v_store_name, v_region_name,
         'failed', '등록되지 않은 지역', p_user_agent);
      raise exception '등록되지 않은 지역입니다. 본사 관리자에게 문의하세요.';
    end if;
  end if;

  -- enterprise → primary franchise
  select franchise_id into v_franchise_id
    from public.enterprise_franchises
   where enterprise_account_id = v_ea_id
     and role = 'primary'
     and status = 'active'
     and deleted_at is null
   limit 1;

  if v_franchise_id is null then
    insert into public.enterprise_invite_claims
      (enterprise_account_id, user_id, claim_type, invite_code_last4,
       brand_name_input, store_name_input, region_name_input,
       status, failure_reason, user_agent)
    values
      (v_ea_id, v_uid, 'store', v_last4, v_brand, v_store_name, v_region_name,
       'failed', 'primary franchise not configured', p_user_agent);
    raise exception '본사 프랜차이즈 설정이 완료되지 않았습니다. 관리자에게 문의하세요.';
  end if;

  -- franchise_stores upsert (franchise_id, store_id) unique 활용
  insert into public.franchise_stores
    (franchise_id, region_id, store_id, store_name, status, enterprise_region_id)
  values
    (v_franchise_id, null, v_uid, v_store_name, 'active', v_region.id)
  on conflict (franchise_id, store_id) do update set
    store_name = coalesce(excluded.store_name, public.franchise_stores.store_name),
    enterprise_region_id = coalesce(excluded.enterprise_region_id, public.franchise_stores.enterprise_region_id),
    status = 'active'
  returning * into v_store;

  insert into public.enterprise_invite_claims
    (enterprise_account_id, franchise_id, user_id, claim_type, invite_code_last4,
     brand_name_input, store_name_input, region_name_input,
     status, user_agent)
  values
    (v_ea_id, v_franchise_id, v_uid, 'store', v_last4,
     v_brand, v_store_name, v_region_name,
     'success', p_user_agent)
  returning id into v_claim_id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'franchise_id', v_franchise_id,
    'enterprise_region_id', v_region.id,
    'franchise_store_id', v_store.id,
    'claim_id', v_claim_id
  );
end;
$$;
revoke execute on function public.claim_enterprise_store_account(text, text, text, text, text) from public, anon;
grant execute on function public.claim_enterprise_store_account(text, text, text, text, text) to authenticated;


-- ============================================================
-- 12) Diagnostics
-- ============================================================
do $$
declare
  v_cols int;
  v_tables int;
  v_rpcs int;
  v_fn_helper int;
  v_fs_col int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_accounts'
     and column_name in ('brand_code','hq_invite_code','store_invite_code',
                         'invite_code_rotated_at','onboarding_enabled','allow_self_register_region');

  select count(*) into v_tables from information_schema.tables
   where table_schema='public'
     and table_name in ('enterprise_franchises','enterprise_invite_claims');

  select count(*) into v_fs_col from information_schema.columns
   where table_schema='public' and table_name='franchise_stores'
     and column_name = 'enterprise_region_id';

  select count(*) into v_fn_helper from pg_proc
   where proname = '_generate_enterprise_invite_code';

  select count(*) into v_rpcs from pg_proc where proname in (
    'admin_create_enterprise_account_v2',
    'admin_rotate_enterprise_invite_code',
    'admin_get_enterprise_invite_summary',
    'validate_enterprise_invite',
    'claim_enterprise_hq_account',
    'claim_enterprise_store_account'
  );

  raise notice '====== 0363 Enterprise Invite Onboarding Diagnostics ======';
  raise notice 'enterprise_accounts new columns: % / 6', v_cols;
  raise notice 'new tables: % / 2 (enterprise_franchises, enterprise_invite_claims)', v_tables;
  raise notice 'franchise_stores.enterprise_region_id col: % / 1', v_fs_col;
  raise notice 'helper fn _generate_enterprise_invite_code: % / 1', v_fn_helper;
  raise notice 'new RPCs: % / 6', v_rpcs;
  raise notice '==========================================================';

  if v_cols = 6 and v_tables = 2 and v_fs_col = 1
     and v_fn_helper = 1 and v_rpcs = 6 then
    raise notice '0363 COMPLETE — Enterprise Invite Onboarding ready';
  else
    raise warning '0363 INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;


comment on table public.enterprise_franchises is
  'Phase 1-6 — enterprise_account ↔ franchise mapping. primary 1개 per enterprise.';
comment on table public.enterprise_invite_claims is
  'Phase 1-6 — 초대코드 가입/연결 audit. invite_code_last4 만 저장 (원본 X).';
comment on function public.validate_enterprise_invite(text, text, text) is
  'Phase 1-6 — 가입 전 anon 호출 가능. 실패 시 generic 메시지로 정보 누설 방지.';
