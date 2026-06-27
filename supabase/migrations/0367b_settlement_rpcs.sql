-- 0367b — Enterprise Phase 1-8 (split B): 6 RPC
--
-- 의존: 0367a (enterprise_settlement_profiles + enterprise_business_profiles 3 cols)
-- 적용 전 0367a sanity (table=1, cols=3) 확인 필수.

-- ============================================================
-- 1) upsert_my_enterprise_business_profile_v2 — 신규 V2 (10 fields)
--    기존 V1 (0364) 그대로 유지 — backward compat
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
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_ea_id uuid;
  v_row public.enterprise_business_profiles;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
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
-- 2) get_my_enterprise_settlement — HQ (account_number 마스킹)
-- ============================================================
create or replace function public.get_my_enterprise_settlement()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_ea_id uuid;
  v_row public.enterprise_settlement_profiles; v_masked text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_row from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea_id;

  if v_row.id is null then
    return jsonb_build_object('success', true, 'settlement', null,
      'has_business_license', false, 'has_bankbook', false);
  end if;

  if v_row.account_number is null or length(v_row.account_number) <= 4 then
    v_masked := v_row.account_number;
  else
    v_masked := repeat('*', length(v_row.account_number) - 4) || right(v_row.account_number, 4);
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
-- 3) upsert_my_enterprise_settlement
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
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_ea_id uuid;
  v_existing public.enterprise_settlement_profiles;
  v_row public.enterprise_settlement_profiles;
  v_bank_changed boolean := false; v_files_changed boolean := false;
  v_new_status text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_settlement_method is not null and p_settlement_method not in ('monthly','weekly','manual') then
    raise exception 'invalid settlement_method: %', p_settlement_method;
  end if;
  if p_minimum_payout is not null and p_minimum_payout < 0 then
    raise exception 'minimum_payout must be >= 0';
  end if;

  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_existing from public.enterprise_settlement_profiles
   where enterprise_account_id = v_ea_id;

  if v_existing.id is null then
    v_bank_changed := (p_bank_name is not null or p_account_number is not null or p_account_holder is not null);
    v_files_changed := (p_business_license_path is not null or p_bankbook_path is not null);
  else
    v_bank_changed :=
      coalesce(v_existing.bank_name, '') <> coalesce(p_bank_name, v_existing.bank_name, '')
      or coalesce(v_existing.account_number, '') <> coalesce(p_account_number, v_existing.account_number, '')
      or coalesce(v_existing.account_holder, '') <> coalesce(p_account_holder, v_existing.account_holder, '');
    v_files_changed :=
      coalesce(v_existing.business_license_path, '') <> coalesce(p_business_license_path, v_existing.business_license_path, '')
      or coalesce(v_existing.bankbook_path, '') <> coalesce(p_bankbook_path, v_existing.bankbook_path, '');
  end if;

  v_new_status := coalesce(v_existing.settlement_status, 'unregistered');
  if v_bank_changed or v_files_changed then
    if v_new_status in ('unregistered','rejected','approved') then
      v_new_status := 'reviewing';
    end if;
  end if;

  insert into public.enterprise_settlement_profiles
    (enterprise_account_id, bank_name, account_number, account_holder,
     settlement_method, minimum_payout, business_license_path, bankbook_path,
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
-- 4) admin_get_enterprise_settlement (unmask)
-- ============================================================
create or replace function public.admin_get_enterprise_settlement(p_enterprise_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_row public.enterprise_settlement_profiles;
  v_business public.enterprise_business_profiles;
  v_ea public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_ea from public.enterprise_accounts where id = p_enterprise_account_id;
  if v_ea.id is null then raise exception 'enterprise not found'; end if;
  select * into v_row from public.enterprise_settlement_profiles where enterprise_account_id = p_enterprise_account_id;
  select * into v_business from public.enterprise_business_profiles where enterprise_account_id = p_enterprise_account_id;

  return jsonb_build_object(
    'success', true,
    'enterprise_account', jsonb_build_object(
      'id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
      'manager_name', v_ea.manager_name, 'manager_email', v_ea.manager_email,
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
-- 5) admin_get_enterprise_documents
-- ============================================================
create or replace function public.admin_get_enterprise_documents(p_enterprise_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_row public.enterprise_settlement_profiles;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_row from public.enterprise_settlement_profiles where enterprise_account_id = p_enterprise_account_id;
  if v_row.id is null then
    return jsonb_build_object('success', true, 'business_license_path', null, 'bankbook_path', null);
  end if;
  return jsonb_build_object('success', true,
    'business_license_path', v_row.business_license_path,
    'bankbook_path', v_row.bankbook_path);
end;
$$;
revoke execute on function public.admin_get_enterprise_documents(uuid) from public, anon;
grant execute on function public.admin_get_enterprise_documents(uuid) to authenticated;


-- ============================================================
-- 6) admin_update_enterprise_settlement_status
-- ============================================================
create or replace function public.admin_update_enterprise_settlement_status(
  p_enterprise_account_id uuid,
  p_status text,
  p_rejection_reason text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_row public.enterprise_settlement_profiles;
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
         rejection_reason = case when p_status='rejected' then btrim(p_rejection_reason) else null end,
         reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
   where enterprise_account_id = p_enterprise_account_id
  returning * into v_row;
  if v_row.id is null then
    raise exception 'settlement profile not found for enterprise %', p_enterprise_account_id;
  end if;

  perform public.admin_log_operation(
    'enterprise_settlement_profiles', 'admin', 'success', p_status,
    format('Enterprise settlement → %s (ea=%s)', p_status, p_enterprise_account_id),
    jsonb_build_object('action', 'enterprise_settlement.status_change',
      'target_id', p_enterprise_account_id, 'new_status', p_status,
      'rejection_reason', p_rejection_reason),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_status', v_row.settlement_status, 'reviewed_at', v_row.reviewed_at);
end;
$$;
revoke execute on function public.admin_update_enterprise_settlement_status(uuid, text, text) from public, anon;
grant execute on function public.admin_update_enterprise_settlement_status(uuid, text, text) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_rpcs int;
begin
  select count(*) into v_rpcs from pg_proc where proname in (
    'upsert_my_enterprise_business_profile_v2',
    'get_my_enterprise_settlement',
    'upsert_my_enterprise_settlement',
    'admin_get_enterprise_settlement',
    'admin_get_enterprise_documents',
    'admin_update_enterprise_settlement_status'
  );

  raise notice '====== 0367b RPC Diagnostics ======';
  raise notice 'new RPCs: % / 6', v_rpcs;
  raise notice '===================================';

  if v_rpcs = 6 then
    raise notice '0367b COMPLETE — 다음: 0367c (storage) 적용';
  else
    raise warning '0367b INCOMPLETE — % / 6', v_rpcs;
  end if;
end$$;
