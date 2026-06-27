-- 0372 — Phase 1-11: Enterprise 월 정산 엔진
--
-- 목표:
--   매월 본사별 정산 스냅샷 생성 + 관리자 지급 워크플로우 (pending → approved → paid).
--   매장당 근거(included/excluded) 영구 보관.
--
-- 결정 (Phase 1-11 §1):
--   Q1=B: enterprise_settlement_profiles 있는 본사만 생성 (단가/수수료/계좌 설정된 본사만)
--   Q2=B: active_store_count == 0 본사는 skip
--   Q3=A: cancelled 무시 재생성 가능 (partial unique)
--   Q4=A: settlement_month date 타입 (월 첫째 날)
--   Q5=A: paid 는 immutable (cancel 불가)
--
-- 절대 원칙:
--   - 신규 table 2개 / RPC 8개 만 추가
--   - 기존 enterprise / franchise_stores / claim / settlement_profiles 스키마 변경 0
--   - artist settlement / payout 무관, store/player/heartbeat/policy/business subs 무관
--   - 자동 스케줄러 없음 (다음 Phase) — admin 가 수동 generate 호출

-- ============================================================
-- 1) enterprise_monthly_settlements (월 정산 스냅샷)
-- ============================================================
create table if not exists public.enterprise_monthly_settlements (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null
    references public.enterprise_accounts(id) on delete cascade,
  settlement_month date not null,
  -- 생성 당시 스냅샷 (실시간 재계산 금지)
  active_store_count int not null check (active_store_count >= 0),
  monthly_store_price int not null check (monthly_store_price >= 0),
  commission_rate numeric(5,2) not null check (commission_rate >= 0 and commission_rate <= 100),
  per_store_commission int not null check (per_store_commission >= 0),
  total_commission int not null check (total_commission >= 0),
  status text not null default 'pending'
    check (status in ('pending','approved','paid','cancelled')),
  generated_at timestamptz not null default now(),
  generated_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references public.users(id) on delete set null,
  paid_at timestamptz,
  paid_by uuid references public.users(id) on delete set null,
  payment_reference text,
  admin_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_ems_enterprise_month
  on public.enterprise_monthly_settlements (enterprise_account_id, settlement_month desc);
create index if not exists idx_ems_status_month
  on public.enterprise_monthly_settlements (status, settlement_month desc);

-- partial unique — cancelled 무시하고 재생성 허용 (Q3=A)
create unique index if not exists uniq_ems_ea_month_active
  on public.enterprise_monthly_settlements (enterprise_account_id, settlement_month)
  where status <> 'cancelled';

-- settlement_month 가 월 첫째 날인지 보장 (date_trunc 정규화)
alter table public.enterprise_monthly_settlements
  drop constraint if exists ems_month_is_first_of_month;
alter table public.enterprise_monthly_settlements
  add constraint ems_month_is_first_of_month
  check (settlement_month = date_trunc('month', settlement_month)::date);

drop trigger if exists trg_ems_updated_at on public.enterprise_monthly_settlements;
create trigger trg_ems_updated_at before update on public.enterprise_monthly_settlements
  for each row execute function public._touch_updated_at();

alter table public.enterprise_monthly_settlements enable row level security;

drop policy if exists ems_select on public.enterprise_monthly_settlements;
create policy ems_select on public.enterprise_monthly_settlements
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_monthly_settlements.enterprise_account_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke all on public.enterprise_monthly_settlements from anon;
revoke all on public.enterprise_monthly_settlements from authenticated;

comment on table public.enterprise_monthly_settlements is
  'Phase 1-11 (0372) — 본사별 월 정산 스냅샷. 실시간 재계산 X. RPC 만 접근.';


-- ============================================================
-- 2) enterprise_monthly_settlement_items (매장 단위 근거 — 영구)
-- ============================================================
create table if not exists public.enterprise_monthly_settlement_items (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null
    references public.enterprise_monthly_settlements(id) on delete cascade,
  store_id uuid not null,                                    -- 스냅샷 (FK 무)
  store_name text,                                           -- 스냅샷
  franchise_id uuid,
  franchise_name text,
  region_id uuid,
  region_name text,
  monthly_store_price int not null check (monthly_store_price >= 0),
  commission_rate numeric(5,2) not null check (commission_rate >= 0 and commission_rate <= 100),
  per_store_commission int not null check (per_store_commission >= 0),
  status text not null check (status in ('included','excluded')),
  reason text,
  created_at timestamptz not null default now()
);

create index if not exists idx_emsi_settlement
  on public.enterprise_monthly_settlement_items (settlement_id);

alter table public.enterprise_monthly_settlement_items enable row level security;

drop policy if exists emsi_select on public.enterprise_monthly_settlement_items;
create policy emsi_select on public.enterprise_monthly_settlement_items
  for select using (
    public._is_super_admin()
    or exists (
      select 1
        from public.enterprise_monthly_settlements ems
        join public.enterprise_accounts ea on ea.id = ems.enterprise_account_id
       where ems.id = enterprise_monthly_settlement_items.settlement_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke all on public.enterprise_monthly_settlement_items from anon;
revoke all on public.enterprise_monthly_settlement_items from authenticated;

comment on table public.enterprise_monthly_settlement_items is
  'Phase 1-11 (0372) — 정산 매장 근거 (included/excluded + reason). 영구 보관.';


-- ============================================================
-- 3) admin_generate_enterprise_monthly_settlement (admin)
--    동작:
--      - p_month 정규화 (월 첫째 날)
--      - profile 존재 + active>=1 본사 순회
--      - 이미 (ea, month, status<>cancelled) 있으면 skip
--      - settlement row + items row (all stores) insert
--      - audit log
-- ============================================================
create or replace function public.admin_generate_enterprise_monthly_settlement(
  p_month date default current_date
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_ea record;
  v_active_count int;
  v_per_store int;
  v_total int;
  v_settlement_id uuid;
  v_existing_id uuid;
  v_created int := 0;
  v_skipped int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  for v_ea in
    select ea.id as ea_id,
           ea.enterprise_name,
           esp.monthly_store_price,
           esp.commission_rate
      from public.enterprise_accounts ea
      join public.enterprise_settlement_profiles esp
        on esp.enterprise_account_id = ea.id   -- Q1=B: profile 있는 본사만
     where ea.deleted_at is null
       and ea.status in ('active','invited')
     order by ea.enterprise_name
  loop
    -- active 매장 수
    select count(*) into v_active_count
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        and ef.deleted_at is null
     where ef.enterprise_account_id = v_ea.ea_id
       and fs.status = 'active';

    if v_active_count = 0 then
      -- Q2=B: active=0 skip
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id,
        'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'no_active_stores'
      );
      continue;
    end if;

    -- 이미 있는지 (cancelled 제외) — Q3=A
    select id into v_existing_id
      from public.enterprise_monthly_settlements
     where enterprise_account_id = v_ea.ea_id
       and settlement_month = v_month
       and status <> 'cancelled'
     limit 1;
    if v_existing_id is not null then
      v_skipped := v_skipped + 1;
      v_details := v_details || jsonb_build_object(
        'enterprise_account_id', v_ea.ea_id,
        'enterprise_name', v_ea.enterprise_name,
        'result', 'skipped', 'reason', 'already_exists',
        'existing_settlement_id', v_existing_id
      );
      continue;
    end if;

    v_per_store := floor(v_ea.monthly_store_price * v_ea.commission_rate / 100)::int;
    v_total     := v_active_count * v_per_store;

    insert into public.enterprise_monthly_settlements
      (enterprise_account_id, settlement_month,
       active_store_count, monthly_store_price, commission_rate,
       per_store_commission, total_commission,
       status, generated_by)
    values
      (v_ea.ea_id, v_month,
       v_active_count, v_ea.monthly_store_price, v_ea.commission_rate,
       v_per_store, v_total,
       'pending', v_uid)
    returning id into v_settlement_id;

    -- items: 모든 매장 (status 무관) — 근거 보존
    insert into public.enterprise_monthly_settlement_items
      (settlement_id, store_id, store_name, franchise_id, franchise_name,
       region_id, region_name, monthly_store_price, commission_rate,
       per_store_commission, status, reason)
    select
      v_settlement_id,
      fs.store_id,
      fs.store_name,
      fs.franchise_id,
      f.name,
      fs.enterprise_region_id,
      er.region_name,
      v_ea.monthly_store_price,
      v_ea.commission_rate,
      case when fs.status = 'active' then v_per_store else 0 end,
      case when fs.status = 'active' then 'included' else 'excluded' end,
      case fs.status
        when 'active'    then null
        when 'inactive'  then '비활성 매장'
        when 'suspended' then '정지 매장'
        else fs.status
      end
      from public.franchise_stores fs
      join public.enterprise_franchises ef
        on ef.franchise_id = fs.franchise_id
       and ef.deleted_at is null
       and ef.enterprise_account_id = v_ea.ea_id
      join public.franchises f on f.id = fs.franchise_id
      left join public.enterprise_regions er on er.id = fs.enterprise_region_id;

    v_created := v_created + 1;
    v_details := v_details || jsonb_build_object(
      'enterprise_account_id', v_ea.ea_id,
      'enterprise_name', v_ea.enterprise_name,
      'result', 'created',
      'settlement_id', v_settlement_id,
      'active_store_count', v_active_count,
      'total_commission', v_total
    );
  end loop;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.generate',
    format('Enterprise monthly settlement generate (%s) — created=%s skipped=%s',
      to_char(v_month, 'YYYY-MM'), v_created, v_skipped),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.generate',
      'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
      'created', v_created,
      'skipped', v_skipped,
      'details', v_details
    ),
    v_uid, to_char(v_month, 'YYYY-MM'), null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'settlement_month', to_char(v_month, 'YYYY-MM-DD'),
    'created', v_created,
    'skipped', v_skipped,
    'details', v_details
  );
end;
$$;
revoke execute on function public.admin_generate_enterprise_monthly_settlement(date) from public, anon;
grant execute on function public.admin_generate_enterprise_monthly_settlement(date) to authenticated;


-- ============================================================
-- 4) admin_list_enterprise_monthly_settlements
-- ============================================================
create or replace function public.admin_list_enterprise_monthly_settlements(
  p_month date default null,
  p_status text default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_rows jsonb;
  v_total int;
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
       limit greatest(p_limit, 0)
       offset greatest(p_offset, 0)
    ) ems
    join public.enterprise_accounts ea on ea.id = ems.enterprise_account_id;

  return jsonb_build_object('success', true, 'total', v_total, 'rows', v_rows);
end;
$$;
revoke execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) from public, anon;
grant execute on function public.admin_list_enterprise_monthly_settlements(date, text, int, int) to authenticated;


-- ============================================================
-- 5) admin_get_enterprise_monthly_settlement (단일 + items)
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
    'id', i.id,
    'store_id', i.store_id,
    'store_name', i.store_name,
    'franchise_id', i.franchise_id,
    'franchise_name', i.franchise_name,
    'region_id', i.region_id,
    'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price,
    'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission,
    'status', i.status,
    'reason', i.reason
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
grant execute on function public.admin_get_enterprise_monthly_settlement(uuid) to authenticated;


-- ============================================================
-- 6) admin_approve_enterprise_monthly_settlement
--    pending → approved
-- ============================================================
create or replace function public.admin_approve_enterprise_monthly_settlement(
  p_settlement_id uuid,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_monthly_settlements;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select * into v_row from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_row.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  if v_row.status <> 'pending' then
    raise exception 'invalid transition: status=% (only pending can be approved)', v_row.status;
  end if;

  update public.enterprise_monthly_settlements
     set status = 'approved',
         approved_at = now(),
         approved_by = v_uid,
         admin_note = coalesce(nullif(btrim(p_admin_note), ''), admin_note),
         updated_at = now()
   where id = p_settlement_id
  returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.approve',
    format('Enterprise monthly settlement approve (%s, ea=%s, total=%s)',
      to_char(v_row.settlement_month, 'YYYY-MM'),
      v_row.enterprise_account_id, v_row.total_commission),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.approve',
      'settlement_id', v_row.id,
      'enterprise_account_id', v_row.enterprise_account_id,
      'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
      'total_commission', v_row.total_commission,
      'admin_note', p_admin_note
    ),
    v_uid, v_row.id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_id', v_row.id, 'status', v_row.status, 'approved_at', v_row.approved_at);
end;
$$;
revoke execute on function public.admin_approve_enterprise_monthly_settlement(uuid, text) from public, anon;
grant execute on function public.admin_approve_enterprise_monthly_settlement(uuid, text) to authenticated;


-- ============================================================
-- 7) admin_mark_paid_enterprise_monthly_settlement
--    approved → paid (immutable after)
-- ============================================================
create or replace function public.admin_mark_paid_enterprise_monthly_settlement(
  p_settlement_id uuid,
  p_payment_reference text,
  p_admin_note text default null
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_monthly_settlements;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_payment_reference), '') = '' then
    raise exception 'payment_reference required';
  end if;

  select * into v_row from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_row.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  if v_row.status <> 'approved' then
    raise exception 'invalid transition: status=% (only approved can be marked paid)', v_row.status;
  end if;

  update public.enterprise_monthly_settlements
     set status = 'paid',
         paid_at = now(),
         paid_by = v_uid,
         payment_reference = btrim(p_payment_reference),
         admin_note = coalesce(nullif(btrim(p_admin_note), ''), admin_note),
         updated_at = now()
   where id = p_settlement_id
  returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.paid',
    format('Enterprise monthly settlement paid (%s, ea=%s, total=%s, ref=%s)',
      to_char(v_row.settlement_month, 'YYYY-MM'),
      v_row.enterprise_account_id, v_row.total_commission, btrim(p_payment_reference)),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.paid',
      'settlement_id', v_row.id,
      'enterprise_account_id', v_row.enterprise_account_id,
      'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
      'total_commission', v_row.total_commission,
      'payment_reference', btrim(p_payment_reference),
      'admin_note', p_admin_note
    ),
    v_uid, v_row.id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_id', v_row.id, 'status', v_row.status, 'paid_at', v_row.paid_at);
end;
$$;
revoke execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) from public, anon;
grant execute on function public.admin_mark_paid_enterprise_monthly_settlement(uuid, text, text) to authenticated;


-- ============================================================
-- 8) admin_cancel_enterprise_monthly_settlement
--    pending/approved → cancelled. paid 는 immutable (Q5=A)
-- ============================================================
create or replace function public.admin_cancel_enterprise_monthly_settlement(
  p_settlement_id uuid,
  p_admin_note text
)
returns jsonb language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_row public.enterprise_monthly_settlements;
  v_prev_status text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_admin_note), '') = '' then
    raise exception 'admin_note required for cancel';
  end if;

  select * into v_row from public.enterprise_monthly_settlements where id = p_settlement_id;
  if v_row.id is null then raise exception 'settlement not found: %', p_settlement_id; end if;
  if v_row.status not in ('pending','approved') then
    raise exception 'invalid transition: status=% (only pending/approved can be cancelled; paid is immutable)', v_row.status;
  end if;
  v_prev_status := v_row.status;

  update public.enterprise_monthly_settlements
     set status = 'cancelled',
         admin_note = btrim(p_admin_note),
         updated_at = now()
   where id = p_settlement_id
  returning * into v_row;

  perform public.admin_log_operation(
    'enterprise_monthly_settlements', 'admin', 'success',
    'enterprise_monthly_settlement.cancel',
    format('Enterprise monthly settlement cancel (%s, ea=%s, prev=%s)',
      to_char(v_row.settlement_month, 'YYYY-MM'),
      v_row.enterprise_account_id, v_prev_status),
    jsonb_build_object(
      'action', 'enterprise_monthly_settlement.cancel',
      'settlement_id', v_row.id,
      'enterprise_account_id', v_row.enterprise_account_id,
      'settlement_month', to_char(v_row.settlement_month, 'YYYY-MM-DD'),
      'prev_status', v_prev_status,
      'admin_note', btrim(p_admin_note)
    ),
    v_uid, v_row.id::text, null, null, null
  );

  return jsonb_build_object('success', true,
    'settlement_id', v_row.id, 'status', v_row.status);
end;
$$;
revoke execute on function public.admin_cancel_enterprise_monthly_settlement(uuid, text) from public, anon;
grant execute on function public.admin_cancel_enterprise_monthly_settlement(uuid, text) to authenticated;


-- ============================================================
-- 9) get_my_enterprise_monthly_settlements (HQ — read-only)
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlements(
  p_limit int default 12
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_rows jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', ems.id,
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
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
grant execute on function public.get_my_enterprise_monthly_settlements(int) to authenticated;


-- ============================================================
-- 10) get_my_enterprise_monthly_settlement_items (HQ — read-only)
-- ============================================================
create or replace function public.get_my_enterprise_monthly_settlement_items(
  p_settlement_id uuid
)
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_settlement public.enterprise_monthly_settlements;
  v_items jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null and status in ('active','invited')
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: not an enterprise HQ admin'; end if;

  select * into v_settlement from public.enterprise_monthly_settlements
   where id = p_settlement_id and enterprise_account_id = v_ea_id;
  if v_settlement.id is null then
    raise exception 'settlement not found or not owned by current HQ';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'store_id', i.store_id,
    'store_name', i.store_name,
    'franchise_name', i.franchise_name,
    'region_name', i.region_name,
    'monthly_store_price', i.monthly_store_price,
    'commission_rate', i.commission_rate,
    'per_store_commission', i.per_store_commission,
    'status', i.status,
    'reason', i.reason
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
      'status', v_settlement.status,
      'paid_at', v_settlement.paid_at,
      'payment_reference', v_settlement.payment_reference
    ),
    'items', v_items
  );
end;
$$;
revoke execute on function public.get_my_enterprise_monthly_settlement_items(uuid) from public, anon;
grant execute on function public.get_my_enterprise_monthly_settlement_items(uuid) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_tbl int; v_idx int; v_rpc int;
begin
  select count(*) into v_tbl from information_schema.tables
    where table_schema='public'
      and table_name in ('enterprise_monthly_settlements','enterprise_monthly_settlement_items');
  select count(*) into v_idx from pg_indexes
    where schemaname='public'
      and indexname in ('idx_ems_enterprise_month','idx_ems_status_month',
                        'uniq_ems_ea_month_active','idx_emsi_settlement');
  select count(*) into v_rpc from pg_proc
    where proname in (
      'admin_generate_enterprise_monthly_settlement',
      'admin_list_enterprise_monthly_settlements',
      'admin_get_enterprise_monthly_settlement',
      'admin_approve_enterprise_monthly_settlement',
      'admin_mark_paid_enterprise_monthly_settlement',
      'admin_cancel_enterprise_monthly_settlement',
      'get_my_enterprise_monthly_settlements',
      'get_my_enterprise_monthly_settlement_items'
    );

  raise notice '====== 0372 Monthly Settlement Diagnostics ======';
  raise notice 'tables: % / 2', v_tbl;
  raise notice 'indexes: % / 4', v_idx;
  raise notice 'RPCs: % / 8', v_rpc;
  raise notice '=================================================';

  if v_tbl=2 and v_idx=4 and v_rpc=8 then
    raise notice '0372 COMPLETE — monthly settlement engine ready';
  else
    raise warning '0372 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
