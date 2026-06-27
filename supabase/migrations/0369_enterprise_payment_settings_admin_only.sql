-- 0369 — Phase 1-9 §3: 지급 설정(payment settings) admin-only
--
-- 정책 변경:
--   settlement_method / minimum_payout 는 계약 조건이므로 HQ 가 직접 수정 불가.
--   admin/super admin 만 본사별로 설정 가능.
--
-- 변경 사항:
--   1) upsert_my_enterprise_settlement — 시그니처 유지 (deploy 된 클라이언트 호환),
--      p_settlement_method / p_minimum_payout 입력이 들어와도 무시 (NOTICE 만).
--      → 컬럼은 default('monthly', 0) 또는 기존 값 유지.
--   2) admin_update_enterprise_payment_settings — 신규 admin RPC.
--      → audit 기록: admin_log_operation 호출.
--
-- 절대 원칙:
--   - additive only (DROP 금지, 컬럼 제거 금지, 기존 RPC 시그니처 변경 금지)
--   - 매장 플레이어 / heartbeat / now-playing / policy / artist 변경 0
--   - HQ 의 사업자 정보 / 정산 계좌 / 증빙 업로드 기능은 그대로 유지

-- ============================================================
-- 1) upsert_my_enterprise_settlement — payment settings 무시
--    (계좌/예금주/증빙 경로만 HQ 가 변경 가능)
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

  -- Phase 1-9 §3 — 계약 조건이므로 HQ 자체 변경 차단. 입력 무시.
  if p_settlement_method is not null or p_minimum_payout is not null then
    raise notice 'payment_settings (method/min_payout) are admin-only — ignored';
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
     business_license_path, bankbook_path,
     settlement_status, submitted_at)
  values
    (v_ea_id,
     nullif(btrim(coalesce(p_bank_name, '')), ''),
     nullif(btrim(coalesce(p_account_number, '')), ''),
     nullif(btrim(coalesce(p_account_holder, '')), ''),
     -- settlement_method / minimum_payout 미지정 → 컬럼 default 사용
     nullif(btrim(coalesce(p_business_license_path, '')), ''),
     nullif(btrim(coalesce(p_bankbook_path, '')), ''),
     v_new_status,
     case when v_bank_changed or v_files_changed then now() else null end)
  on conflict (enterprise_account_id) do update set
    bank_name = coalesce(nullif(btrim(coalesce(p_bank_name, '')), ''), enterprise_settlement_profiles.bank_name),
    account_number = coalesce(nullif(btrim(coalesce(p_account_number, '')), ''), enterprise_settlement_profiles.account_number),
    account_holder = coalesce(nullif(btrim(coalesce(p_account_holder, '')), ''), enterprise_settlement_profiles.account_holder),
    -- settlement_method / minimum_payout: 의도적으로 미포함 (admin RPC 만 변경)
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
-- 2) admin_update_enterprise_payment_settings — admin 전용
-- ============================================================
create or replace function public.admin_update_enterprise_payment_settings(
  p_enterprise_account_id uuid,
  p_settlement_method text,
  p_minimum_payout int
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_existing public.enterprise_settlement_profiles;
  v_row public.enterprise_settlement_profiles;
  v_ea public.enterprise_accounts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_settlement_method is null or p_settlement_method not in ('monthly','weekly','manual') then
    raise exception 'invalid settlement_method: %', p_settlement_method;
  end if;
  if p_minimum_payout is null or p_minimum_payout < 0 then
    raise exception 'minimum_payout must be >= 0';
  end if;

  select * into v_ea from public.enterprise_accounts where id = p_enterprise_account_id;
  if v_ea.id is null then
    raise exception 'enterprise not found: %', p_enterprise_account_id;
  end if;

  select * into v_existing from public.enterprise_settlement_profiles
    where enterprise_account_id = p_enterprise_account_id;

  if v_existing.id is null then
    -- profile 이 아직 없으면 계약 조건만으로 row 생성 (HQ 가 나중에 계좌/증빙 채움)
    insert into public.enterprise_settlement_profiles
      (enterprise_account_id, settlement_method, minimum_payout)
    values
      (p_enterprise_account_id, p_settlement_method, p_minimum_payout)
    returning * into v_row;
  else
    update public.enterprise_settlement_profiles
       set settlement_method = p_settlement_method,
           minimum_payout = p_minimum_payout,
           updated_at = now()
     where enterprise_account_id = p_enterprise_account_id
    returning * into v_row;
  end if;

  perform public.admin_log_operation(
    'enterprise_settlement_profiles', 'admin', 'success', 'payment_settings_update',
    format('Enterprise payment settings → method=%s min=%s (ea=%s)',
      p_settlement_method, p_minimum_payout, p_enterprise_account_id),
    jsonb_build_object(
      'action', 'enterprise_settlement.payment_settings_update',
      'target_id', p_enterprise_account_id,
      'settlement_method', p_settlement_method,
      'minimum_payout', p_minimum_payout
    ),
    v_uid, p_enterprise_account_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_row.enterprise_account_id,
    'settlement_method', v_row.settlement_method,
    'minimum_payout', v_row.minimum_payout,
    'updated_at', v_row.updated_at
  );
end;
$$;
revoke execute on function public.admin_update_enterprise_payment_settings(uuid, text, int) from public, anon;
grant execute on function public.admin_update_enterprise_payment_settings(uuid, text, int) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc_admin int;
  v_rpc_hq int;
begin
  select count(*) into v_rpc_admin from pg_proc
    where proname = 'admin_update_enterprise_payment_settings';
  select count(*) into v_rpc_hq from pg_proc
    where proname = 'upsert_my_enterprise_settlement';

  raise notice '====== 0369 Payment Settings Admin-Only ======';
  raise notice 'admin_update_enterprise_payment_settings: % / 1', v_rpc_admin;
  raise notice 'upsert_my_enterprise_settlement (replaced): % / 1', v_rpc_hq;
  raise notice '==============================================';

  if v_rpc_admin = 1 and v_rpc_hq = 1 then
    raise notice '0369 COMPLETE — HQ 입력 무시 + admin RPC 신설';
  else
    raise warning '0369 INCOMPLETE — RPC counts off';
  end if;
end$$;
