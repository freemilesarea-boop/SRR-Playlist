-- 0382 — Enterprise Billing Management V1 (Priority 6)
--
-- "본사 → 우리" 청구/인보이스 (HQ pays platform).
-- 기존 "우리 → 본사" 지급 (enterprise_monthly_settlements / 0372) 와 완전 분리.
--
-- 절대 원칙:
--   - enterprise_monthly_settlements / _items / admin_generate_enterprise_monthly_settlement
--     모두 무수정
--   - 지급 (settlement) 로직 / payment / payapp / artist settlement 무관
--   - store player / policy automation / announcement scheduler 무관
--   - settlement_method / minimum_payout / commission_rate 정책 무수정
--
-- 추가:
--   tables:
--     enterprise_billing_invoices       (월별 청구서)
--     enterprise_billing_invoice_items  (라인 아이템 — V1 store_subscription 1줄 자동)
--   RPCs (9):
--     admin_generate_enterprise_billing_invoice
--     admin_list_enterprise_billing_invoices
--     admin_get_enterprise_billing_invoice_detail
--     admin_issue_enterprise_billing_invoice
--     admin_mark_enterprise_billing_invoice_paid
--     admin_cancel_enterprise_billing_invoice
--     admin_mark_enterprise_billing_overdue
--     admin_update_enterprise_billing_invoice_adjustments
--     get_my_enterprise_billing_summary
--
-- 계산식:
--   active_store_count = COUNT(franchise_stores.status='active')
--     JOIN enterprise_franchises (deleted_at IS NULL) → franchises → franchise_stores
--   monthly_store_price = enterprise_settlement_profiles.monthly_store_price (fallback 4900)
--   subtotal_amount = active_store_count * monthly_store_price
--   tax_amount      = floor(subtotal_amount * tax_rate / 100)  (입력 시)
--   total_amount    = subtotal_amount - discount_amount + tax_amount

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.enterprise_billing_invoices (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  billing_month         date not null,
  active_store_count    integer not null default 0 check (active_store_count >= 0),
  monthly_store_price   integer not null default 4900 check (monthly_store_price >= 0),
  subtotal_amount       integer not null default 0 check (subtotal_amount >= 0),
  discount_amount       integer not null default 0 check (discount_amount >= 0),
  tax_amount            integer not null default 0 check (tax_amount >= 0),
  total_amount          integer not null default 0 check (total_amount >= 0),
  currency              text not null default 'KRW',
  status                text not null default 'draft'
                          check (status in ('draft','issued','paid','overdue','cancelled','failed')),
  due_date              date,
  issued_at             timestamptz,
  paid_at               timestamptz,
  cancelled_at          timestamptz,
  payment_reference     text,
  payment_method        text,
  memo                  text,
  metadata              jsonb not null default '{}'::jsonb,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  -- billing_month 는 항상 월 첫날
  constraint ebi_billing_month_first_day check (billing_month = date_trunc('month', billing_month)::date)
);

-- (enterprise_account_id, billing_month) unique — soft-delete 제외
create unique index if not exists ebi_uniq_enterprise_month_active
  on public.enterprise_billing_invoices (enterprise_account_id, billing_month)
  where deleted_at is null;

create index if not exists idx_ebi_month      on public.enterprise_billing_invoices(billing_month) where deleted_at is null;
create index if not exists idx_ebi_status     on public.enterprise_billing_invoices(status) where deleted_at is null;
create index if not exists idx_ebi_enterprise on public.enterprise_billing_invoices(enterprise_account_id) where deleted_at is null;
create index if not exists idx_ebi_due_date   on public.enterprise_billing_invoices(due_date) where deleted_at is null and status in ('issued','overdue');

create table if not exists public.enterprise_billing_invoice_items (
  id           uuid primary key default gen_random_uuid(),
  invoice_id   uuid not null references public.enterprise_billing_invoices(id) on delete cascade,
  store_id     uuid references public.users(id) on delete set null,
  store_name   text,
  region_id    uuid references public.enterprise_regions(id) on delete set null,
  region_name  text,
  unit_price   integer not null check (unit_price >= 0),
  quantity     integer not null default 1 check (quantity >= 0),
  amount       integer not null check (amount >= 0),
  item_type    text not null
                 check (item_type in ('store_subscription','discount','adjustment','tax')),
  memo         text,
  created_at   timestamptz not null default now()
);
create index if not exists idx_ebii_invoice on public.enterprise_billing_invoice_items(invoice_id);
create index if not exists idx_ebii_type    on public.enterprise_billing_invoice_items(item_type);

-- updated_at trigger
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_ebi_updated_at') then
    create trigger trg_ebi_updated_at before update on public.enterprise_billing_invoices
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_billing_invoices       enable row level security;
alter table public.enterprise_billing_invoice_items  enable row level security;

drop policy if exists ebi_select on public.enterprise_billing_invoices;
create policy ebi_select on public.enterprise_billing_invoices
  for select to authenticated using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_billing_invoices.enterprise_account_id
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

drop policy if exists ebii_select on public.enterprise_billing_invoice_items;
create policy ebii_select on public.enterprise_billing_invoice_items
  for select to authenticated using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_billing_invoices inv
       join public.enterprise_accounts ea on ea.id = inv.enterprise_account_id
       where inv.id = enterprise_billing_invoice_items.invoice_id
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_billing_invoices       from authenticated, anon;
revoke insert, update, delete on public.enterprise_billing_invoice_items  from authenticated, anon;

-- ============================================================
-- 3) Helper — enterprise active store snapshot
-- ============================================================
create or replace function public._enterprise_active_store_count(p_enterprise_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select count(*)::int
    from public.franchise_stores fs
    join public.enterprise_franchises ef
      on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
   where ef.enterprise_account_id = p_enterprise_account_id
     and fs.status = 'active';
$$;

create or replace function public._enterprise_monthly_store_price(p_enterprise_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select monthly_store_price from public.enterprise_settlement_profiles
      where enterprise_account_id = p_enterprise_account_id),
    4900
  )::int;
$$;

-- ============================================================
-- 4) admin_generate_enterprise_billing_invoice
-- ============================================================
create or replace function public.admin_generate_enterprise_billing_invoice(
  p_billing_month         date,
  p_enterprise_account_id uuid    default null,
  p_due_date              date    default null,
  p_tax_rate              numeric default 0,
  p_overwrite             boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_month       date := date_trunc('month', p_billing_month)::date;
  v_tax_rate    numeric := coalesce(p_tax_rate, 0);
  v_due         date := p_due_date;
  v_uid         uuid := auth.uid();
  v_ea          record;
  v_existing    record;
  v_count       int;
  v_unit_price  int;
  v_subtotal    int;
  v_tax         int;
  v_total       int;
  v_invoice_id  uuid;
  v_created     int := 0;
  v_skipped     int := 0;
  v_overwritten int := 0;
  v_skipped_reasons jsonb := '[]'::jsonb;
  v_total_amount bigint := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_billing_month is null then raise exception 'billing_month required'; end if;
  if v_tax_rate < 0 or v_tax_rate > 100 then raise exception 'tax_rate must be 0..100'; end if;

  -- 본사 loop
  for v_ea in
    select id, enterprise_name, status, deleted_at
      from public.enterprise_accounts
     where deleted_at is null
       and status in ('active','invited')
       and (p_enterprise_account_id is null or id = p_enterprise_account_id)
     order by enterprise_name
  loop
    -- 기존 invoice 있는지 확인
    select id, status into v_existing
      from public.enterprise_billing_invoices
     where enterprise_account_id = v_ea.id
       and billing_month = v_month
       and deleted_at is null
     limit 1;

    if v_existing.id is not null then
      if not p_overwrite then
        v_skipped := v_skipped + 1;
        v_skipped_reasons := v_skipped_reasons || jsonb_build_array(
          jsonb_build_object('enterprise_account_id', v_ea.id, 'reason', 'invoice already exists',
                             'existing_status', v_existing.status));
        continue;
      end if;
      if v_existing.status <> 'draft' then
        v_skipped := v_skipped + 1;
        v_skipped_reasons := v_skipped_reasons || jsonb_build_array(
          jsonb_build_object('enterprise_account_id', v_ea.id, 'reason', 'overwrite blocked — status not draft',
                             'existing_status', v_existing.status));
        continue;
      end if;
      -- overwrite: 기존 row + items 삭제 (hard delete — draft 상태)
      delete from public.enterprise_billing_invoice_items where invoice_id = v_existing.id;
      delete from public.enterprise_billing_invoices       where id = v_existing.id;
      v_overwritten := v_overwritten + 1;
    end if;

    -- 계산
    v_count      := public._enterprise_active_store_count(v_ea.id);
    v_unit_price := public._enterprise_monthly_store_price(v_ea.id);
    v_subtotal   := v_count * v_unit_price;
    v_tax        := floor(v_subtotal * v_tax_rate / 100)::int;
    v_total      := v_subtotal - 0 + v_tax;  -- discount = 0 at generation

    -- invoice 생성 (draft)
    insert into public.enterprise_billing_invoices (
      enterprise_account_id, billing_month, active_store_count, monthly_store_price,
      subtotal_amount, discount_amount, tax_amount, total_amount,
      currency, status, due_date,
      metadata, created_by, updated_by
    ) values (
      v_ea.id, v_month, v_count, v_unit_price,
      v_subtotal, 0, v_tax, v_total,
      'KRW', 'draft', v_due,
      jsonb_build_object('generated_at', now(), 'tax_rate', v_tax_rate),
      v_uid, v_uid
    ) returning id into v_invoice_id;

    -- store_subscription 라인 아이템 (V1: 1줄 집계)
    if v_count > 0 then
      insert into public.enterprise_billing_invoice_items (
        invoice_id, store_id, store_name, region_id, region_name,
        unit_price, quantity, amount, item_type, memo
      ) values (
        v_invoice_id, null,
        format('매장 구독료 — %s개', v_count),
        null, null,
        v_unit_price, v_count, v_subtotal, 'store_subscription',
        format('%s 활성 매장 × %s원 (월 기준)', v_count, v_unit_price)
      );
    end if;

    v_created := v_created + 1;
    v_total_amount := v_total_amount + v_total;

    perform public.admin_log_operation(
      'enterprise_billing', 'enterprise_billing.invoice.generate', 'info', 'created',
      format('billing invoice generated — %s / %s', v_ea.enterprise_name, to_char(v_month, 'YYYY-MM')),
      jsonb_build_object(
        'invoice_id', v_invoice_id, 'enterprise_account_id', v_ea.id,
        'billing_month', v_month, 'active_store_count', v_count,
        'monthly_store_price', v_unit_price, 'subtotal_amount', v_subtotal,
        'tax_amount', v_tax, 'total_amount', v_total, 'tax_rate', v_tax_rate
      ),
      v_uid, v_invoice_id::text, null, null, null
    );
  end loop;

  return jsonb_build_object(
    'success', true,
    'billing_month', v_month,
    'created_count', v_created,
    'overwritten_count', v_overwritten,
    'skipped_count', v_skipped,
    'total_amount', v_total_amount,
    'errors', v_skipped_reasons
  );
end;
$$;
revoke execute on function public.admin_generate_enterprise_billing_invoice(date, uuid, date, numeric, boolean) from public, anon;
grant   execute on function public.admin_generate_enterprise_billing_invoice(date, uuid, date, numeric, boolean) to authenticated;

-- ============================================================
-- 5) admin_list_enterprise_billing_invoices
-- ============================================================
create or replace function public.admin_list_enterprise_billing_invoices(
  p_search                text default null,
  p_status                text default null,
  p_billing_month         date default null,
  p_enterprise_account_id uuid default null,
  p_overdue_only          boolean default false,
  p_limit                 int  default 50,
  p_offset                int  default 0
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint := 0;
  v_rows   jsonb  := '[]'::jsonb;
  v_today  date   := current_date;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select inv.*,
           ea.enterprise_name,
           ea.manager_email,
           ea.manager_name,
           (select count(*) from public.enterprise_billing_invoice_items it
             where it.invoice_id = inv.id)::int as item_count
      from public.enterprise_billing_invoices inv
      join public.enterprise_accounts ea on ea.id = inv.enterprise_account_id
     where inv.deleted_at is null
       and (p_status                is null or inv.status = p_status)
       and (p_billing_month         is null or inv.billing_month = date_trunc('month', p_billing_month)::date)
       and (p_enterprise_account_id is null or inv.enterprise_account_id = p_enterprise_account_id)
       and (not p_overdue_only
            or (inv.status in ('issued','overdue') and inv.due_date is not null and inv.due_date < v_today))
       and (
         p_search is null
         or ea.enterprise_name ilike '%' || p_search || '%'
         or coalesce(ea.manager_email, '') ilike '%' || p_search || '%'
         or coalesce(ea.manager_name, '')  ilike '%' || p_search || '%'
         or coalesce(inv.payment_reference, '') ilike '%' || p_search || '%'
         or coalesce(inv.memo, '') ilike '%' || p_search || '%'
       )
  ),
  total_cte as (select count(*)::bigint as c from base),
  paged as (
    select * from base
     order by billing_month desc, enterprise_name
     limit v_limit offset v_offset
  )
  select coalesce((select c from total_cte), 0),
         coalesce(jsonb_agg(to_jsonb(p) order by p.billing_month desc, p.enterprise_name), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_enterprise_billing_invoices(text,text,date,uuid,boolean,int,int) from public, anon;
grant   execute on function public.admin_list_enterprise_billing_invoices(text,text,date,uuid,boolean,int,int) to authenticated;

-- ============================================================
-- 6) admin_get_enterprise_billing_invoice_detail
-- ============================================================
create or replace function public.admin_get_enterprise_billing_invoice_detail(p_invoice_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_inv  jsonb;
  v_items jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_invoice_id is null then raise exception 'invoice_id required'; end if;

  select to_jsonb(t) into v_inv
    from (
      select inv.*,
             ea.enterprise_name, ea.manager_email, ea.manager_name
        from public.enterprise_billing_invoices inv
        join public.enterprise_accounts ea on ea.id = inv.enterprise_account_id
       where inv.id = p_invoice_id and inv.deleted_at is null
    ) t;
  if v_inv is null then raise exception 'invoice not found: %', p_invoice_id; end if;

  select coalesce(jsonb_agg(to_jsonb(it) order by it.created_at), '[]'::jsonb) into v_items
    from public.enterprise_billing_invoice_items it
   where it.invoice_id = p_invoice_id;

  return jsonb_build_object(
    'success', true,
    'invoice', v_inv,
    'items', v_items,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_get_enterprise_billing_invoice_detail(uuid) from public, anon;
grant   execute on function public.admin_get_enterprise_billing_invoice_detail(uuid) to authenticated;

-- ============================================================
-- 7) admin_issue_enterprise_billing_invoice
-- ============================================================
create or replace function public.admin_issue_enterprise_billing_invoice(
  p_invoice_id uuid,
  p_due_date   date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select id, status, due_date, enterprise_account_id, billing_month, total_amount
    into v_inv from public.enterprise_billing_invoices
   where id = p_invoice_id and deleted_at is null;
  if v_inv.id is null then raise exception 'invoice not found: %', p_invoice_id; end if;
  if v_inv.status <> 'draft' then
    raise exception 'invoice not in draft status: %', v_inv.status;
  end if;

  update public.enterprise_billing_invoices
     set status     = 'issued',
         issued_at  = now(),
         due_date   = coalesce(p_due_date, due_date),
         updated_by = auth.uid()
   where id = p_invoice_id;

  perform public.admin_log_operation(
    'enterprise_billing', 'enterprise_billing.invoice.issue', 'info', 'issued',
    format('invoice issued — id=%s month=%s', p_invoice_id, to_char(v_inv.billing_month, 'YYYY-MM')),
    jsonb_build_object('invoice_id', p_invoice_id, 'enterprise_account_id', v_inv.enterprise_account_id,
                       'billing_month', v_inv.billing_month, 'before_status', 'draft', 'after_status', 'issued',
                       'total_amount', v_inv.total_amount),
    auth.uid(), p_invoice_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'status', 'issued');
end;
$$;
revoke execute on function public.admin_issue_enterprise_billing_invoice(uuid, date) from public, anon;
grant   execute on function public.admin_issue_enterprise_billing_invoice(uuid, date) to authenticated;

-- ============================================================
-- 8) admin_mark_enterprise_billing_invoice_paid
-- ============================================================
create or replace function public.admin_mark_enterprise_billing_invoice_paid(
  p_invoice_id        uuid,
  p_payment_reference text default null,
  p_payment_method    text default null,
  p_paid_at           timestamptz default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv record; v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select id, status, enterprise_account_id, billing_month, total_amount
    into v_inv from public.enterprise_billing_invoices
   where id = p_invoice_id and deleted_at is null;
  if v_inv.id is null then raise exception 'invoice not found: %', p_invoice_id; end if;
  v_prev := v_inv.status;
  if v_prev not in ('issued','overdue') then
    raise exception 'invoice cannot be marked paid from status: %', v_prev;
  end if;

  update public.enterprise_billing_invoices
     set status            = 'paid',
         paid_at           = coalesce(p_paid_at, now()),
         payment_reference = coalesce(p_payment_reference, payment_reference),
         payment_method    = coalesce(p_payment_method, payment_method),
         updated_by        = auth.uid()
   where id = p_invoice_id;

  perform public.admin_log_operation(
    'enterprise_billing', 'enterprise_billing.invoice.paid', 'success', 'paid',
    format('invoice paid — id=%s', p_invoice_id),
    jsonb_build_object('invoice_id', p_invoice_id, 'enterprise_account_id', v_inv.enterprise_account_id,
                       'billing_month', v_inv.billing_month, 'before_status', v_prev, 'after_status', 'paid',
                       'total_amount', v_inv.total_amount,
                       'payment_reference', p_payment_reference, 'payment_method', p_payment_method),
    auth.uid(), p_invoice_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'status', 'paid', 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_mark_enterprise_billing_invoice_paid(uuid, text, text, timestamptz) from public, anon;
grant   execute on function public.admin_mark_enterprise_billing_invoice_paid(uuid, text, text, timestamptz) to authenticated;

-- ============================================================
-- 9) admin_cancel_enterprise_billing_invoice
-- ============================================================
create or replace function public.admin_cancel_enterprise_billing_invoice(
  p_invoice_id uuid,
  p_memo       text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_inv record; v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select id, status, enterprise_account_id, billing_month, total_amount
    into v_inv from public.enterprise_billing_invoices
   where id = p_invoice_id and deleted_at is null;
  if v_inv.id is null then raise exception 'invoice not found: %', p_invoice_id; end if;
  v_prev := v_inv.status;
  if v_prev not in ('draft','issued','overdue') then
    raise exception 'invoice cannot be cancelled from status: %', v_prev;
  end if;

  update public.enterprise_billing_invoices
     set status       = 'cancelled',
         cancelled_at = now(),
         memo         = coalesce(p_memo, memo),
         updated_by   = auth.uid()
   where id = p_invoice_id;

  perform public.admin_log_operation(
    'enterprise_billing', 'enterprise_billing.invoice.cancel', 'warning', 'cancelled',
    format('invoice cancelled — id=%s', p_invoice_id),
    jsonb_build_object('invoice_id', p_invoice_id, 'enterprise_account_id', v_inv.enterprise_account_id,
                       'billing_month', v_inv.billing_month, 'before_status', v_prev, 'after_status', 'cancelled',
                       'total_amount', v_inv.total_amount, 'memo', p_memo),
    auth.uid(), p_invoice_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'status', 'cancelled', 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_cancel_enterprise_billing_invoice(uuid, text) from public, anon;
grant   execute on function public.admin_cancel_enterprise_billing_invoice(uuid, text) to authenticated;

-- ============================================================
-- 10) admin_mark_enterprise_billing_overdue (batch)
-- ============================================================
create or replace function public.admin_mark_enterprise_billing_overdue(
  p_as_of date default current_date
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_today  date := coalesce(p_as_of, current_date);
  v_marked int  := 0;
  v_rec    record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  for v_rec in
    select id, enterprise_account_id, billing_month, total_amount, due_date
      from public.enterprise_billing_invoices
     where deleted_at is null
       and status = 'issued'
       and due_date is not null
       and due_date < v_today
  loop
    update public.enterprise_billing_invoices
       set status = 'overdue', updated_by = v_uid
     where id = v_rec.id;
    v_marked := v_marked + 1;

    perform public.admin_log_operation(
      'enterprise_billing', 'enterprise_billing.invoice.overdue', 'warning', 'overdue',
      format('invoice overdue — id=%s due=%s', v_rec.id, v_rec.due_date),
      jsonb_build_object('invoice_id', v_rec.id, 'enterprise_account_id', v_rec.enterprise_account_id,
                         'billing_month', v_rec.billing_month, 'before_status', 'issued', 'after_status', 'overdue',
                         'total_amount', v_rec.total_amount, 'due_date', v_rec.due_date),
      v_uid, v_rec.id::text, null, null, null
    );
  end loop;

  return jsonb_build_object('success', true, 'as_of', v_today, 'marked_count', v_marked);
end;
$$;
revoke execute on function public.admin_mark_enterprise_billing_overdue(date) from public, anon;
grant   execute on function public.admin_mark_enterprise_billing_overdue(date) to authenticated;

-- ============================================================
-- 11) admin_update_enterprise_billing_invoice_adjustments
-- ============================================================
create or replace function public.admin_update_enterprise_billing_invoice_adjustments(
  p_invoice_id     uuid,
  p_discount_amount int  default null,
  p_tax_amount     int  default null,
  p_memo           text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_inv  record;
  v_new_discount int;
  v_new_tax      int;
  v_new_total    int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select id, status, subtotal_amount, discount_amount, tax_amount, total_amount
    into v_inv from public.enterprise_billing_invoices
   where id = p_invoice_id and deleted_at is null;
  if v_inv.id is null then raise exception 'invoice not found: %', p_invoice_id; end if;
  if v_inv.status <> 'draft' then
    raise exception 'adjustments only allowed in draft status (current: %)', v_inv.status;
  end if;
  if p_discount_amount is not null and p_discount_amount < 0 then raise exception 'discount_amount must be >= 0'; end if;
  if p_tax_amount      is not null and p_tax_amount      < 0 then raise exception 'tax_amount must be >= 0';      end if;

  v_new_discount := coalesce(p_discount_amount, v_inv.discount_amount);
  v_new_tax      := coalesce(p_tax_amount,      v_inv.tax_amount);
  v_new_total    := greatest(v_inv.subtotal_amount - v_new_discount + v_new_tax, 0);

  update public.enterprise_billing_invoices
     set discount_amount = v_new_discount,
         tax_amount      = v_new_tax,
         total_amount    = v_new_total,
         memo            = coalesce(p_memo, memo),
         updated_by      = auth.uid()
   where id = p_invoice_id;

  perform public.admin_log_operation(
    'enterprise_billing', 'enterprise_billing.invoice.adjust', 'info', 'adjusted',
    format('invoice adjusted — id=%s', p_invoice_id),
    jsonb_build_object('invoice_id', p_invoice_id,
                       'discount_amount_before', v_inv.discount_amount, 'discount_amount_after', v_new_discount,
                       'tax_amount_before', v_inv.tax_amount, 'tax_amount_after', v_new_tax,
                       'total_amount_before', v_inv.total_amount, 'total_amount_after', v_new_total,
                       'memo', p_memo),
    auth.uid(), p_invoice_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'invoice_id', p_invoice_id,
    'discount_amount', v_new_discount, 'tax_amount', v_new_tax, 'total_amount', v_new_total);
end;
$$;
revoke execute on function public.admin_update_enterprise_billing_invoice_adjustments(uuid, int, int, text) from public, anon;
grant   execute on function public.admin_update_enterprise_billing_invoice_adjustments(uuid, int, int, text) to authenticated;

-- ============================================================
-- 12) get_my_enterprise_billing_summary (HQ read-only)
-- ============================================================
create or replace function public.get_my_enterprise_billing_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_ea_id   uuid;
  v_today   date := current_date;
  v_this_m  date := date_trunc('month', v_today)::date;
  v_current jsonb;
  v_recent  jsonb;
  v_active  int := 0;
  v_price   int := 4900;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null
   limit 1;
  if v_ea_id is null then raise exception 'forbidden: no enterprise account'; end if;

  v_active := public._enterprise_active_store_count(v_ea_id);
  v_price  := public._enterprise_monthly_store_price(v_ea_id);

  select to_jsonb(t) into v_current
    from (
      select inv.id, inv.billing_month, inv.status, inv.due_date, inv.issued_at, inv.paid_at,
             inv.subtotal_amount, inv.discount_amount, inv.tax_amount, inv.total_amount,
             inv.active_store_count, inv.monthly_store_price, inv.currency,
             (inv.status in ('issued','overdue') and inv.due_date is not null and inv.due_date < v_today) as is_overdue
        from public.enterprise_billing_invoices inv
       where inv.enterprise_account_id = v_ea_id
         and inv.deleted_at is null
         and inv.billing_month = v_this_m
       limit 1
    ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.billing_month desc), '[]'::jsonb) into v_recent
    from (
      select inv.id, inv.billing_month, inv.status, inv.due_date, inv.issued_at, inv.paid_at,
             inv.subtotal_amount, inv.discount_amount, inv.tax_amount, inv.total_amount,
             inv.active_store_count, inv.monthly_store_price, inv.currency
        from public.enterprise_billing_invoices inv
       where inv.enterprise_account_id = v_ea_id
         and inv.deleted_at is null
         and inv.billing_month >= (v_this_m - interval '5 months')::date
       order by inv.billing_month desc
       limit 6
    ) t;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'this_month', v_this_m,
    'current_invoice', v_current,
    'recent_invoices', v_recent,
    'active_store_count', v_active,
    'monthly_store_price', v_price,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_billing_summary() from public, anon;
grant   execute on function public.get_my_enterprise_billing_summary() to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_t int; v_rpc int;
begin
  select count(*) into v_t from pg_class where relname in
    ('enterprise_billing_invoices','enterprise_billing_invoice_items');
  select count(*) into v_rpc from pg_proc where pronamespace='public'::regnamespace and proname in (
    'admin_generate_enterprise_billing_invoice','admin_list_enterprise_billing_invoices',
    'admin_get_enterprise_billing_invoice_detail','admin_issue_enterprise_billing_invoice',
    'admin_mark_enterprise_billing_invoice_paid','admin_cancel_enterprise_billing_invoice',
    'admin_mark_enterprise_billing_overdue','admin_update_enterprise_billing_invoice_adjustments',
    'get_my_enterprise_billing_summary',
    '_enterprise_active_store_count','_enterprise_monthly_store_price'
  );
  raise notice '====== 0382 Enterprise Billing V1 ======';
  raise notice 'tables: % / 2', v_t;
  raise notice 'rpcs+helpers: % / 11 (9 RPC + 2 helpers)', v_rpc;
  if v_t = 2 and v_rpc >= 11 then
    raise notice '0382 COMPLETE — billing invoices + items + 9 RPCs ready';
  else
    raise warning '0382 INCOMPLETE';
  end if;
end$$;
