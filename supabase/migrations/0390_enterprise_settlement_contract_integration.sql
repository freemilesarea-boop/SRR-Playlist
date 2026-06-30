-- 0390 — Enterprise 월 정산에 계약값 반영 (0383 V2 deferral 완료)
--
-- 배경:
--   0383 이 계약(enterprise_contracts)에 monthly_store_price / commission_rate /
--   minimum_payout / settlement_method 를 저장하고, contract-aware 헬퍼
--   (_enterprise_monthly_store_price, _enterprise_effective_commission_rate,
--    _enterprise_effective_minimum_payout, _enterprise_effective_settlement_method)
--   까지 만들었으나, 0372 admin_generate_enterprise_monthly_settlement 은
--   여전히 enterprise_settlement_profiles(esp) 값만 직접 읽어 계약값이
--   정산에 반영되지 않았음 (0383 주석: "Settlement 의 contract 통합은 V2 deferred").
--
-- 목표:
--   월 정산 생성 시 "활성 계약" 의 값을 우선 적용(contract > profile > default)하고,
--   당시 계약을 snapshot 으로 영구 보존한다.
--
-- Snapshot 원칙 (기존 0372/0348 구조 유지):
--   - enterprise_monthly_settlements 는 이미 생성 시점 값을 고정 저장하는 snapshot 테이블.
--   - 계약 수정 → "다음 달 생성되는 정산부터" 적용. 이미 생성된 정산 row 는 절대 변경 안 함.
--   - paid immutable / partial-unique(cancelled 제외) versioning 그대로 유지.
--   - 본 migration 은 신규 컬럼 추가(전부 nullable) + generate RPC 로직 + read RPC 출력만 변경.
--     기존 row 데이터/계산값/상태머신 무수정.
--
-- 실제 스키마 확인 결과 (추측 아님):
--   enterprise_contracts 의 금액/조건 컬럼 = monthly_store_price, commission_rate,
--   minimum_payout, settlement_method, contract_type 뿐.
--   (요청서의 billing_cycle / fixed_fee / revenue_share_rate / settlement_day /
--    tax_type / vat_included 컬럼은 스키마에 존재하지 않음 → 본 migration 범위 밖.
--    실재하는 위 4개 조건값만 반영.)
--
-- 절대 무수정:
--   - 안내방송/광고 (announcement), 매장 플레이어, artist settlement, payment/payapp.
--   - enterprise_monthly_settlement_items 스키마 (price/rate 컬럼 그대로 — 값만 effective 로).
--   - 0372 RPC 시그니처(파라미터) 100% 보존 — 출력 JSON 에 필드만 additive 추가.
--   - 계산식: per_store_commission = floor(price * rate / 100), total = active * per_store (동일).
--     minimum_payout / settlement_method 는 snapshot/표시용으로만 기록 (금액 산식 불변 —
--     지급 보류 임계 적용은 명시적 업무규칙 필요하므로 본 버전 범위 밖).

-- ============================================================
-- 1) enterprise_monthly_settlements — snapshot 컬럼 추가 (additive, nullable)
-- ============================================================
alter table public.enterprise_monthly_settlements
  add column if not exists contract_id        uuid references public.enterprise_contracts(id) on delete set null,
  add column if not exists contract_no         text,
  add column if not exists minimum_payout      integer check (minimum_payout is null or minimum_payout >= 0),
  add column if not exists settlement_method   text,
  add column if not exists rate_source         text check (rate_source is null or rate_source in ('contract','profile','default'));

create index if not exists idx_ems_contract on public.enterprise_monthly_settlements(contract_id)
  where contract_id is not null;

-- 기존 row 는 전부 profile 기반으로 생성됐음 → rate_source 만 보정 (금액/상태 무변경).
update public.enterprise_monthly_settlements
   set rate_source = 'profile'
 where rate_source is null;

-- items 에도 계약 추적 컬럼(선택) — store 근거에 "당시 계약" 연결 (nullable, additive).
alter table public.enterprise_monthly_settlement_items
  add column if not exists contract_id uuid references public.enterprise_contracts(id) on delete set null;

-- ============================================================
-- 2) admin_generate_enterprise_monthly_settlement — 계약값 우선 적용 + snapshot
-- ============================================================
-- 변경점:
--   (a) 대상 본사: profile 보유 OR 활성 계약 보유 (둘 중 하나라도) — 계약만 있는 본사도 정산.
--   (b) 단가/수수료/최소정산/정산방법 = contract-aware effective 헬퍼 결과 (contract > profile > default).
--   (c) rate_source + contract_id/contract_no + minimum_payout + settlement_method snapshot.
--   (d) 나머지(active=0 skip / already_exists skip / items 근거 / audit) 동작 동일.
create or replace function public.admin_generate_enterprise_monthly_settlement(
  p_month date default current_date
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_ea record;
  v_contract record;
  v_active_count int;
  v_price int;
  v_rate numeric;
  v_min int;
  v_method text;
  v_rate_source text;
  v_per_store int;
  v_total int;
  v_settlement_id uuid;
  v_existing_id uuid;
  v_has_profile boolean;
  v_created int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  for v_ea in
    select ea.id as ea_id, ea.enterprise_name
      from public.enterprise_accounts ea
     where ea.deleted_at is null
       and ea.status in ('active','invited')
       and (
         exists (select 1 from public.enterprise_settlement_profiles esp
                  where esp.enterprise_account_id = ea.id)
         or exists (select 1 from public._enterprise_active_contract(ea.id))
       )
     order by ea.enterprise_name
  loop
    -- active 매장 수 (동일)
    select count(*) into v_active_count
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.ea_id
       and fs.status = 'active';

    if v_active_count = 0 then
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'no_active_stores');
      continue;
    end if;

    -- 이미 있는지 (cancelled 제외) — versioning 유지
    select id into v_existing_id
      from public.enterprise_monthly_settlements
     where enterprise_account_id = v_ea.ea_id
       and settlement_month = v_month
       and status <> 'cancelled'
     limit 1;
    if v_existing_id is not null then
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'already_exists', 'existing_settlement_id', v_existing_id);
      continue;
    end if;

    -- 활성 계약 snapshot + effective 값 (contract > profile > default)
    select * into v_contract from public._enterprise_active_contract(v_ea.ea_id) limit 1;
    v_price  := public._enterprise_monthly_store_price(v_ea.ea_id);
    v_rate   := public._enterprise_effective_commission_rate(v_ea.ea_id);
    v_min    := public._enterprise_effective_minimum_payout(v_ea.ea_id);
    v_method := public._enterprise_effective_settlement_method(v_ea.ea_id);

    select exists(select 1 from public.enterprise_settlement_profiles esp
                   where esp.enterprise_account_id = v_ea.ea_id) into v_has_profile;
    v_rate_source := case
      when v_contract.id is not null then 'contract'
      when v_has_profile             then 'profile'
      else 'default' end;

    v_per_store := floor(v_price * v_rate / 100)::int;
    v_total     := v_active_count * v_per_store;

    insert into public.enterprise_monthly_settlements
      (enterprise_account_id, settlement_month,
       active_store_count, monthly_store_price, commission_rate,
       per_store_commission, total_commission,
       contract_id, contract_no, minimum_payout, settlement_method, rate_source,
       status, generated_by)
    values
      (v_ea.ea_id, v_month,
       v_active_count, v_price, v_rate,
       v_per_store, v_total,
       v_contract.id, v_contract.contract_no, v_min, v_method, v_rate_source,
       'pending', v_uid)
    returning id into v_settlement_id;

    -- items: 모든 매장 근거 (effective price/rate snapshot + contract_id)
    insert into public.enterprise_monthly_settlement_items
      (settlement_id, store_id, store_name, franchise_id, franchise_name,
       region_id, region_name, monthly_store_price, commission_rate,
       per_store_commission, status, reason, contract_id)
    select
      v_settlement_id, fs.store_id, fs.store_name, fs.franchise_id, f.name,
      fs.enterprise_region_id, er.region_name, v_price, v_rate,
      case when fs.status = 'active' then v_per_store else 0 end,
      case when fs.status = 'active' then 'included' else 'excluded' end,
      case fs.status
        when 'active'    then null
        when 'inactive'  then '비활성 매장'
        when 'suspended' then '정지 매장'
        else fs.status end,
      v_contract.id
      from public.franchise_stores fs
      join public.enterprise_franchises ef
        on ef.franchise_id = fs.franchise_id
       and ef.deleted_at is null
       and ef.enterprise_account_id = v_ea.ea_id
      join public.franchises f on f.id = fs.franchise_id
      left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

    v_created := v_created + 1;
    v_details := v_details || jsonb_build_object(
      'enterprise_account_id', v_ea.ea_id, 'enterprise_name', v_ea.enterprise_name,
      'result', 'created', 'settlement_id', v_settlement_id,
      'active_store_count', v_active_count, 'total_commission', v_total,
      'rate_source', v_rate_source, 'contract_no', v_contract.contract_no);
  end loop;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.generate',
    format('Enterprise monthly settlement generate (%s) — created=%s skipped=%s',
      to_char(v_month, 'YYYY-MM'), v_created, v_skipped),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.generate',
      'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
      'created', v_created, 'skipped', v_skipped, 'details', v_details),
    v_uid, to_char(v_month, 'YYYY-MM'), null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
    'created', v_created, 'skipped', v_skipped, 'details', v_details);
end;
$$;
revoke execute on function public.admin_generate_enterprise_monthly_settlement(date) from public, anon;
grant   execute on function public.admin_generate_enterprise_monthly_settlement(date) to authenticated;

-- ============================================================
-- 3) admin_list_enterprise_monthly_settlements — 출력에 계약 필드 추가
-- ============================================================
create or replace function public.admin_list_enterprise_monthly_settlements(
  p_month date default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb; v_total int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status is not null and p_status not in ('pending','approved','paid','cancelled') then
    raise exception 'invalid status: %', p_status;
  end if;

  select count(*) into v_total
    from public.enterprise_monthly_settlements ems
   where (p_month is null or ems.settlement_month = date_trunc('month', p_month)::date)
     and (p_status is null or ems.status = p_status);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ems.id,
    'enterprise_account_id', ems.enterprise_account_id,
    'enterprise_name', ea.enterprise_name,
    'brand_code', ea.brand_code,
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
    'contract_id', ems.contract_id,
    'contract_no', ems.contract_no,
    'minimum_payout', ems.minimum_payout,
    'settlement_method', ems.settlement_method,
    'rate_source', ems.rate_source,
    'status', ems.status,
    'generated_at', ems.generated_at,
    'approved_at', ems.approved_at,
    'paid_at', ems.paid_at,
    'payment_reference', ems.payment_reference,
    'admin_note', ems.admin_note
  ) order by ems.settlement_month desc, ea.enterprise_name), '[]'::jsonb)
    into v_rows
    from (
      select ems2.* from public.enterprise_monthly_settlements ems2
       where (p_month is null or ems2.settlement_month = date_trunc('month', p_month)::date)
         and (p_status is null or ems2.status = p_status)
       order by ems2.settlement_month desc, ems2.created_at desc
       limit greatest(p_limit, 0) offset greatest(p_offset, 0)
    ) ems
    join public.enterprise_accounts ea on ea.id = ems.enterprise_account_id;

  return jsonb_build_object('success', true, 'total', v_total, 'rows', v_rows);
end;
$$;
revoke execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) from public, anon;
grant   execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) to authenticated;

-- ============================================================
-- 4) admin_get_enterprise_monthly_settlement — 상세 출력에 계약 필드 추가
-- ============================================================
create or replace function public.admin_get_enterprise_monthly_settlement(
  p_settlement_id uuid
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_settlement public.enterprise_monthly_settlements;
  v_ea public.enterprise_accounts;
  v_items jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_settlement from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_settlement.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  select * into v_ea from public.enterprise_accounts where id = v_settlement.enterprise_account_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'store_id', i.store_id, 'store_name', i.store_name,
    'franchise_id', i.franchise_id, 'franchise_name', i.franchise_name,
    'region_id', i.region_id, 'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price, 'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission, 'status', i.status, 'reason', i.reason
  ) order by i.status, i.store_name nulls last), '[]'::jsonb)
    into v_items
    from public.enterprise_monthly_settlement_items i
   where i.settlement_id = p_settlement_id;

  return jsonb_build_object(
    'success', true,
    'settlement', jsonb_build_object(
      'id', v_settlement.id,
      'enterprise_account_id', v_settlement.enterprise_account_id,
      'enterprise_name', v_ea.enterprise_name,
      'brand_code', v_ea.brand_code,
      'manager_name', v_ea.manager_name,
      'manager_email', v_ea.manager_email,
      'settlement_month', to_char(v_settlement.settlement_month, 'YYYY-MM-DD'),
      'active_store_count', v_settlement.active_store_count,
      'monthly_store_price', v_settlement.monthly_store_price,
      'commission_rate', v_settlement.commission_rate,
      'per_store_commission', v_settlement.per_store_commission,
      'total_commission', v_settlement.total_commission,
      'contract_id', v_settlement.contract_id,
      'contract_no', v_settlement.contract_no,
      'minimum_payout', v_settlement.minimum_payout,
      'settlement_method', v_settlement.settlement_method,
      'rate_source', v_settlement.rate_source,
      'status', v_settlement.status,
      'generated_at', v_settlement.generated_at,
      'approved_at', v_settlement.approved_at,
      'paid_at', v_settlement.paid_at,
      'payment_reference', v_settlement.payment_reference,
      'admin_note', v_settlement.admin_note
    ),
    'items', v_items
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_monthly_settlement(uuid) from public, anon;
grant   execute on function public.admin_get_enterprise_monthly_settlement(uuid) to authenticated;

-- ============================================================
-- 5) get_my_enterprise_monthly_settlements (HQ) — 출력에 계약 필드 추가
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlements(
  p_limit int default 12
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_ea_id uuid; v_rows jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ems.id,
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
    'contract_id', ems.contract_id,
    'contract_no', ems.contract_no,
    'minimum_payout', ems.minimum_payout,
    'settlement_method', ems.settlement_method,
    'rate_source', ems.rate_source,
    'status', ems.status,
    'generated_at', ems.generated_at,
    'approved_at', ems.approved_at,
    'paid_at', ems.paid_at,
    'payment_reference', ems.payment_reference
  ) order by ems.settlement_month desc), '[]'::jsonb)
    into v_rows
    from (
      select * from public.enterprise_monthly_settlements
       where enterprise_account_id = v_ea_id
       order by settlement_month desc, created_at desc
       limit greatest(p_limit, 1)
    ) ems;

  return jsonb_build_object('success', true, 'rows', v_rows);
end;
$$;
revoke execute on function public.get_my_enterprise_monthly_settlements(int) from public, anon;
grant   execute on function public.get_my_enterprise_monthly_settlements(int) to authenticated;

-- ============================================================
-- 6) get_my_enterprise_monthly_settlement_items (HQ) — settlement 출력에 계약 필드 추가
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlement_items(
  p_settlement_id uuid
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid(); v_ea_id uuid;
  v_settlement public.enterprise_monthly_settlements; v_items jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited') limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_settlement from public.enterprise_monthly_settlements
   where id = p_settlement_id and enterprise_account_id = v_ea_id;
  if v_settlement.id is null then
    raise exception 'settlement not found or not owned by current HQ';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id, 'store_id', i.store_id, 'store_name', i.store_name,
    'franchise_name', i.franchise_name, 'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price, 'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission, 'status', i.status, 'reason', i.reason
  ) order by i.status, i.store_name nulls last), '[]'::jsonb)
    into v_items
    from public.enterprise_monthly_settlement_items i
   where i.settlement_id = p_settlement_id;

  return jsonb_build_object(
    'success', true,
    'settlement', jsonb_build_object(
      'id', v_settlement.id,
      'settlement_month', to_char(v_settlement.settlement_month, 'YYYY-MM-DD'),
      'active_store_count', v_settlement.active_store_count,
      'monthly_store_price', v_settlement.monthly_store_price,
      'commission_rate', v_settlement.commission_rate,
      'per_store_commission', v_settlement.per_store_commission,
      'total_commission', v_settlement.total_commission,
      'contract_id', v_settlement.contract_id,
      'contract_no', v_settlement.contract_no,
      'minimum_payout', v_settlement.minimum_payout,
      'settlement_method', v_settlement.settlement_method,
      'rate_source', v_settlement.rate_source,
      'status', v_settlement.status,
      'paid_at', v_settlement.paid_at,
      'payment_reference', v_settlement.payment_reference
    ),
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_my_enterprise_monthly_settlement_items(uuid) from public, anon;
grant   execute on function public.get_my_enterprise_monthly_settlement_items(uuid) to authenticated;

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_cols int; v_gen_ok boolean;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='enterprise_monthly_settlements'
     and column_name in ('contract_id','contract_no','minimum_payout','settlement_method','rate_source');
  raise notice '====== 0390 Enterprise settlement contract integration ======';
  raise notice 'ems snapshot columns: % / 5', v_cols;
  if v_cols = 5 then
    raise notice '0390 COMPLETE — generate uses contract-aware effective helpers + snapshots active contract';
  else
    raise warning '0390 INCOMPLETE — expected 5 new columns, found %', v_cols;
  end if;
end$$;
