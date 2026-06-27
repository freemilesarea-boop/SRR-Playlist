-- 0367 — Enterprise Phase 1-8: HQ 정산 정보 + 증빙서류 + 지급 설정
--
-- 목표:
--   본사 담당자가 가입 → 사업자 등록 → 정산 등록 → 관리자 승인까지 진행 가능.
--
-- 절대 원칙:
--   - additive only (DROP / 컬럼 제거 / 기존 RPC 변경 0)
--   - 기존 RPC (upsert_my_enterprise_business_profile / get_my_enterprise_dashboard
--     / get_my_enterprise_role / get_my_enterprise_store_info) 시그니처/본문 변경 0
--   - 기존 enterprise_business_profiles / enterprise_accounts / franchise_stores
--     스키마 변경 (컬럼 추가 외) 0
--   - 매장 플레이어 / heartbeat / now-playing / policy deployment / artist / settlement
--     (artist) / payout / playlist 변경 0
--
-- 의존: 0364 (enterprise_business_profiles), 0349 (_is_super_admin), 0041 (admin_log_operation)


-- ============================================================
-- 1) enterprise_business_profiles ALTER — 정산 담당자 3 fields (additive)
-- ============================================================
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_name text;
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_phone text;
alter table public.enterprise_business_profiles
  add column if not exists settlement_contact_email text;


-- ============================================================
-- 2) enterprise_settlement_profiles — 정산/은행/증빙/지급 1:1 with enterprise_account
-- ============================================================
create table if not exists public.enterprise_settlement_profiles (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null unique
    references public.enterprise_accounts(id) on delete cascade,
  bank_name text,
  account_number text,
  account_holder text,
  business_license_path text,
  bankbook_path text,
  settlement_status text not null default 'unregistered'
    check (settlement_status in ('unregistered','reviewing','approved','rejected')),
  settlement_method text not null default 'monthly'
    check (settlement_method in ('monthly','weekly','manual')),
  minimum_payout integer not null default 0 check (minimum_payout >= 0),
  rejection_reason text,
  reviewed_by uuid references public.users(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_esp_enterprise
  on public.enterprise_settlement_profiles (enterprise_account_id);
create index if not exists idx_esp_status
  on public.enterprise_settlement_profiles (settlement_status);

drop trigger if exists trg_esp_updated_at on public.enterprise_settlement_profiles;
create trigger trg_esp_updated_at before update on public.enterprise_settlement_profiles
  for each row execute function public._touch_updated_at();

alter table public.enterprise_settlement_profiles enable row level security;

-- HQ 본인 select / super_admin 전체 / 직접 mutation 차단
drop policy if exists esp_select on public.enterprise_settlement_profiles;
create policy esp_select on public.enterprise_settlement_profiles
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_settlement_profiles.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke all on public.enterprise_settlement_profiles from anon;
revoke all on public.enterprise_settlement_profiles from authenticated;
-- 0365/0366 의 ACL 잔존 이슈와 무관하게 PostgREST 가 차단 (RPC 만 grant)


-- ============================================================
-- 3) Storage bucket — enterprise-documents (private)
--    file_size_limit 20MB, MIME pdf/jpg/png/webp
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('enterprise-documents', 'enterprise-documents', false, 20971520,
        array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS — HQ 본인 folder 만 / super_admin 전체
-- 폴더 구조: <enterprise_account_id>/business-license.* / <enterprise_account_id>/bankbook.*
drop policy if exists "ed_hq_manage" on storage.objects;
create policy "ed_hq_manage" on storage.objects
  for all
  using (
    bucket_id = 'enterprise-documents'
    and (
      public._is_super_admin()
      or exists (
        select 1 from public.enterprise_accounts ea
         where ea.id::text = (storage.foldername(name))[1]
           and ea.auth_user_id is not null
           and ea.auth_user_id = auth.uid()
           and ea.deleted_at is null
      )
    )
  )
  with check (
    bucket_id = 'enterprise-documents'
    and (
      public._is_super_admin()
      or exists (
        select 1 from public.enterprise_accounts ea
         where ea.id::text = (storage.foldername(name))[1]
           and ea.auth_user_id is not null
           and ea.auth_user_id = auth.uid()
           and ea.deleted_at is null
      )
    )
  );


-- ============================================================
-- 4) upsert_my_enterprise_business_profile_v2 — 신규 V2 (10 fields)
--    기존 V1 (7 fields) 그대로 유지 — backward compat
-- ============================================================
create or replace function public.upsert_my_enterprise_business_profile_v2(
  p_company_name text default null,
  p_business_number text default null,
  p_representative_name text default null,
  p_business_address text default null,
  p_contact_phone text default null,
  p_tax_invoice_email text default null,
  p_notes text default null,
  p_settlement_contact_name text default null,
  p_settlement_contact_phone text default null,
  p_settlement_contact_email text default null
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
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  insert into public.enterprise_business_profiles
    (enterprise_account_id, company_name, business_number, representative_name,
     business_address, contact_phone, tax_invoice_email, notes,
     settlement_contact_name, settlement_contact_phone, settlement_contact_email)
  values
    (v_ea_id,
     nullif(btrim(coalesce(p_company_name, '')), ''),
     nullif(btrim(coalesce(p_business_number, '')), ''),
     nullif(btrim(coalesce(p_representative_name, '')), ''),
     nullif(btrim(coalesce(p_business_address, '')), ''),
     nullif(btrim(coalesce(p_contact_phone, '')), ''),
     nullif(btrim(coalesce(p_tax_invoice_email, '')), ''),
     nullif(btrim(coalesce(p_notes, '')), ''),
     nullif(btrim(coalesce(p_settlement_contact_name, '')), ''),
     nullif(btrim(coalesce(p_settlement_contact_phone, '')), ''),
     nullif(btrim(coalesce(p_settlement_contact_email, '')), ''))
  on conflict (enterprise_account_id) do update set
    company_name = excluded.company_name,
    business_number = excluded.business_number,
    representative_name = excluded.representative_name,
    business_address = excluded.business_address,
    contact_phone = excluded.contact_phone,
    tax_invoice_email = excluded.tax_invoice_email,
    notes = excluded.notes,
    settlement_contact_name = excluded.settlement_contact_name,
    settlement_contact_phone = excluded.settlement_contact_phone,
    settlement_contact_email = excluded.settlement_contact_email,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object('success', true, 'profile', to_jsonb(v_row));
end;
$$;
revoke execute on function public.upsert_my_enterprise_business_profile_v2(text,text,text,text,text,text,text,text,text,text) from public, anon;
grant execute on function public.upsert_my_enterprise_business_profile_v2(text,text,text,text,text,text,text,text,text,text) to authenticated;


-- ============================================================
-- 5) get_my_enterprise_settlement — HQ 본인 (account_number 마스킹)
-- ============================================================
create or replace function public.get_my_enterprise_settlement()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_row public.enterprise_settlement_profiles;
  v_masked text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id
    from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_row from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea_id;

  if v_row.id is null then
    return jsonb_build_object('success', true, 'settlement', null,
                              'has_business_license', false,
                              'has_bankbook', false);
  end if;

  -- account_number 마스킹: 마지막 4글자 외 모두 * 처리
  if v_row.account_number is null or length(v_row.account_number) <= 4 then
    v_masked := v_row.account_number;
  else
    v_masked := repeat('*', length(v_row.account_number) - 4)
                || right(v_row.account_number, 4);
  end if;

  return jsonb_build_object(
    'success', true,
    'settlement', jsonb_build_object(
      'id', v_row.id,
      'bank_name', v_row.bank_name,
      'account_number_masked', v_masked,
      'account_holder', v_row.account_holder,
      'settlement_status', v_row.settlement_status,
      'settlement_method', v_row.settlement_method,
      'minimum_payout', v_row.minimum_payout,
      'rejection_reason', v_row.rejection_reason,
      'submitted_at', v_row.submitted_at,
      'reviewed_at', v_row.reviewed_at,
      'created_at', v_row.created_at,
      'updated_at', v_row.updated_at
    ),
    'has_business_license', v_row.business_license_path is not null,
    'has_bankbook', v_row.bankbook_path is not null
  );
end;
$$;
revoke execute on function public.get_my_enterprise_settlement() from public, anon;
grant execute on function public.get_my_enterprise_settlement() to authenticated;


-- ============================================================
-- 6) upsert_my_enterprise_settlement — HQ 본인 정산 정보 저장
--    bank/account/holder/files 변경 시 status='reviewing' 자동 (re-review)
--    settlement_method/minimum_payout 변경은 status 영향 X (운영 설정)
-- ============================================================
create or replace function public.upsert_my_enterprise_settlement(
  p_bank_name text default null,
  p_account_number text default null,
  p_account_holder text default null,
  p_settlement_method text default null,
  p_minimum_payout int default null,
  p_business_license_path text default null,
  p_bankbook_path text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_existing public.enterprise_settlement_profiles;
  v_row public.enterprise_settlement_profiles;
  v_bank_changed boolean := false;
  v_files_changed boolean := false;
  v_new_status text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_settlement_method is not null
     and p_settlement_method not in ('monthly','weekly','manual') then
    raise exception 'invalid settlement_method: %', p_settlement_method;
  end if;
  if p_minimum_payout is not null and p_minimum_payout < 0 then
    raise exception 'minimum_payout must be >= 0';
  end if;

  select id into v_ea_id
    from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_existing
    from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea_id;

  -- bank/account/holder 변경 감지
  if v_existing.id is null then
    v_bank_changed := (p_bank_name is not null or p_account_number is not null
                       or p_account_holder is not null);
    v_files_changed := (p_business_license_path is not null
                        or p_bankbook_path is not null);
  else
    v_bank_changed :=
      coalesce(v_existing.bank_name, '') <> coalesce(p_bank_name, v_existing.bank_name, '')
      or coalesce(v_existing.account_number, '') <> coalesce(p_account_number, v_existing.account_number, '')
      or coalesce(v_existing.account_holder, '') <> coalesce(p_account_holder, v_existing.account_holder, '');
    v_files_changed :=
      coalesce(v_existing.business_license_path, '') <> coalesce(p_business_license_path, v_existing.business_license_path, '')
      or coalesce(v_existing.bankbook_path, '') <> coalesce(p_bankbook_path, v_existing.bankbook_path, '');
  end if;

  -- status 결정
  v_new_status := coalesce(v_existing.settlement_status, 'unregistered');
  if v_bank_changed or v_files_changed then
    -- 핵심 정보 변경 → 재검토 필요
    if v_new_status in ('unregistered','rejected','approved') then
      v_new_status := 'reviewing';
    end if;
  end if;

  insert into public.enterprise_settlement_profiles
    (enterprise_account_id, bank_name, account_number, account_holder,
     settlement_method, minimum_payout,
     business_license_path, bankbook_path,
     settlement_status, submitted_at)
  values
    (v_ea_id,
     nullif(btrim(coalesce(p_bank_name, '')), ''),
     nullif(btrim(coalesce(p_account_number, '')), ''),
     nullif(btrim(coalesce(p_account_holder, '')), ''),
     coalesce(p_settlement_method, 'monthly'),
     coalesce(p_minimum_payout, 0),
     nullif(btrim(coalesce(p_business_license_path, '')), ''),
     nullif(btrim(coalesce(p_bankbook_path, '')), ''),
     v_new_status,
     case when v_bank_changed or v_files_changed then now() else null end)
  on conflict (enterprise_account_id) do update set
    bank_name = coalesce(nullif(btrim(coalesce(p_bank_name, '')), ''), enterprise_settlement_profiles.bank_name),
    account_number = coalesce(nullif(btrim(coalesce(p_account_number, '')), ''), enterprise_settlement_profiles.account_number),
    account_holder = coalesce(nullif(btrim(coalesce(p_account_holder, '')), ''), enterprise_settlement_profiles.account_holder),
    settlement_method = coalesce(p_settlement_method, enterprise_settlement_profiles.settlement_method),
    minimum_payout = coalesce(p_minimum_payout, enterprise_settlement_profiles.minimum_payout),
    business_license_path = coalesce(nullif(btrim(coalesce(p_business_license_path, '')), ''), enterprise_settlement_profiles.business_license_path),
    bankbook_path = coalesce(nullif(btrim(coalesce(p_bankbook_path, '')), ''), enterprise_settlement_profiles.bankbook_path),
    settlement_status = v_new_status,
    -- 재검토 시 rejection_reason / reviewed_by / reviewed_at 초기화
    rejection_reason = case when v_new_status = 'reviewing' then null else enterprise_settlement_profiles.rejection_reason end,
    reviewed_by = case when v_new_status = 'reviewing' then null else enterprise_settlement_profiles.reviewed_by end,
    reviewed_at = case when v_new_status = 'reviewing' then null else enterprise_settlement_profiles.reviewed_at end,
    submitted_at = case when v_bank_changed or v_files_changed then now() else enterprise_settlement_profiles.submitted_at end,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'success', true,
    'settlement_status', v_row.settlement_status,
    'settlement_method', v_row.settlement_method,
    'submitted_at', v_row.submitted_at
  );
end;
$$;
revoke execute on function public.upsert_my_enterprise_settlement(text,text,text,text,int,text,text) from public, anon;
grant execute on function public.upsert_my_enterprise_settlement(text,text,text,text,int,text,text) to authenticated;


-- ============================================================
-- 7) admin_get_enterprise_settlement — admin 전체 정산 정보 (마스킹 X)
-- ============================================================
create or replace function public.admin_get_enterprise_settlement(p_enterprise_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_row public.enterprise_settlement_profiles;
  v_business public.enterprise_business_profiles;
  v_ea public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_account_id;
  if v_ea.id is null then raise exception 'enterprise not found'; end if;

  select * into v_row from public.enterprise_settlement_profiles
   where enterprise_account_id = p_enterprise_account_id;
  select * into v_business from public.enterprise_business_profiles
   where enterprise_account_id = p_enterprise_account_id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account', jsonb_build_object(
      'id', v_ea.id,
      'enterprise_name', v_ea.enterprise_name,
      'manager_name', v_ea.manager_name,
      'manager_email', v_ea.manager_email,
      'brand_code', v_ea.brand_code
    ),
    'business_profile', to_jsonb(v_business),
    'settlement', to_jsonb(v_row),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_settlement(uuid) from public, anon;
grant execute on function public.admin_get_enterprise_settlement(uuid) to authenticated;


-- ============================================================
-- 8) admin_get_enterprise_documents — 파일 경로 반환 (signed URL 은 client 에서)
-- ============================================================
create or replace function public.admin_get_enterprise_documents(p_enterprise_account_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v_row public.enterprise_settlement_profiles;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_row from public.enterprise_settlement_profiles
   where enterprise_account_id = p_enterprise_account_id;
  if v_row.id is null then
    return jsonb_build_object('success', true,
      'business_license_path', null, 'bankbook_path', null);
  end if;
  return jsonb_build_object(
    'success', true,
    'business_license_path', v_row.business_license_path,
    'bankbook_path', v_row.bankbook_path
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_documents(uuid) from public, anon;
grant execute on function public.admin_get_enterprise_documents(uuid) to authenticated;


-- ============================================================
-- 9) admin_update_enterprise_settlement_status — admin 승인/반려
-- ============================================================
create or replace function public.admin_update_enterprise_settlement_status(
  p_enterprise_account_id uuid,
  p_status text,
  p_rejection_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_settlement_profiles;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('reviewing','approved','rejected','unregistered') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_status = 'rejected' and coalesce(btrim(p_rejection_reason), '') = '' then
    raise exception 'rejection_reason required when status=rejected';
  end if;

  update public.enterprise_settlement_profiles
     set settlement_status = p_status,
         rejection_reason = case when p_status = 'rejected' then btrim(p_rejection_reason) else null end,
         reviewed_by = v_uid,
         reviewed_at = now(),
         updated_at = now()
   where enterprise_account_id = p_enterprise_account_id
  returning * into v_row;

  if v_row.id is null then
    raise exception 'settlement profile not found for enterprise %', p_enterprise_account_id;
  end if;

  perform public.admin_log_operation(
    'enterprise_settlement_profiles', 'admin', 'success', p_status,
    format('Enterprise settlement status → %s (ea=%s)', p_status, p_enterprise_account_id),
    jsonb_build_object('action', 'enterprise_settlement.status_change',
      'target_id', p_enterprise_account_id, 'new_status', p_status,
      'rejection_reason', p_rejection_reason),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'settlement_status', v_row.settlement_status,
    'reviewed_at', v_row.reviewed_at
  );
end;
$$;
revoke execute on function public.admin_update_enterprise_settlement_status(uuid, text, text) from public, anon;
grant execute on function public.admin_update_enterprise_settlement_status(uuid, text, text) to authenticated;


-- ============================================================
-- 10) Diagnostics
-- ============================================================
do $$
declare
  v_business_cols int;
  v_table int;
  v_rpcs int;
  v_bucket int;
begin
  select count(*) into v_business_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_business_profiles'
     and column_name in ('settlement_contact_name','settlement_contact_phone','settlement_contact_email');

  select count(*) into v_table from information_schema.tables
   where table_schema='public' and table_name='enterprise_settlement_profiles';

  select count(*) into v_rpcs from pg_proc where proname in (
    'upsert_my_enterprise_business_profile_v2',
    'get_my_enterprise_settlement',
    'upsert_my_enterprise_settlement',
    'admin_get_enterprise_settlement',
    'admin_get_enterprise_documents',
    'admin_update_enterprise_settlement_status'
  );

  select count(*) into v_bucket from storage.buckets where id = 'enterprise-documents';

  raise notice '====== 0367 Enterprise HQ Settlement Diagnostics ======';
  raise notice 'enterprise_business_profiles settlement_contact cols: % / 3', v_business_cols;
  raise notice 'enterprise_settlement_profiles table: % / 1', v_table;
  raise notice 'new RPCs: % / 6', v_rpcs;
  raise notice 'storage bucket enterprise-documents: % / 1', v_bucket;
  raise notice '=======================================================';

  if v_business_cols = 3 and v_table = 1 and v_rpcs = 6 and v_bucket = 1 then
    raise notice '0367 COMPLETE — Enterprise HQ Settlement ready';
  else
    raise warning '0367 INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;

comment on table public.enterprise_settlement_profiles is
  'Phase 1-8 — HQ 정산/은행/증빙/지급 1:1 with enterprise_account. account_number 마스킹은 RPC level. 직접 접근은 anon/authenticated 차단.';
