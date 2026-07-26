-- 0458_brand_store_price_propagation.sql
-- Phase BRAND-BILLING-DYNAMIC-PRICE-1
--
-- Lets an admin choose, when changing a brand's store unit price, between:
--   (1) changing only the NEW-contract default (enterprise_brand_registry.default_store_price), or
--   (2) ALSO applying the new price to that brand's ACTIVE contracts (from the next invoice on).
--
-- Adds three SECURITY DEFINER admin RPCs. It does NOT change the invoice pricing resolver
-- (_enterprise_monthly_store_price / _enterprise_active_contract) or its precedence
-- (contract > settlement profile > 4900). It NEVER touches issued invoices, past payments,
-- settlements, subscription_plans, subscriptions, payment_orders, or any PayApp object.
--
-- Non-destructive: creates functions only. No table changes, no data backfill, no bulk price
-- rewrite on deploy. The active-contract set matches _enterprise_active_contract EXACTLY so the
-- price we write is the same one the resolver bills:
--     deleted_at IS NULL
--     AND status IN ('active','expiring')
--     AND start_date <= current_date
--     AND (end_date IS NULL OR end_date >= current_date)
-- Brand → enterprise linkage: enterprise_accounts.brand_registry_id = <registry id>.
-- Auth: public._is_super_admin(). Audit: public.admin_log_operation(...) → admin_operation_logs.

-- ---------------------------------------------------------------------------
-- 1) Reusable propagation primitive: apply a store price to a brand's ACTIVE contracts only.
--    Independently callable (spec §2). Updates only rows whose price actually differs.
-- ---------------------------------------------------------------------------
create or replace function public.admin_apply_brand_store_price_to_active_contracts(
  p_brand_registry_id   uuid,
  p_monthly_store_price  integer,
  p_effective_from       date default null   -- reserved for future effective-date policy; not enforced yet
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_new   int := p_monthly_store_price;
  v_prev  int;                      -- price the resolver currently bills (top active contract), for reporting
  v_count int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_brand_registry_id is null then raise exception 'p_brand_registry_id required'; end if;
  if v_new is null or v_new < 0 then raise exception 'p_monthly_store_price must be >= 0'; end if;

  -- The single contract the resolver would bill (same ordering as _enterprise_active_contract).
  select c.monthly_store_price into v_prev
  from public.enterprise_contracts c
  join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
  where ea.brand_registry_id = p_brand_registry_id
    and ea.deleted_at is null
    and c.deleted_at is null
    and c.status in ('active','expiring')
    and c.start_date <= current_date
    and (c.end_date is null or c.end_date >= current_date)
  order by c.signed_at desc nulls last, c.start_date desc, c.created_at desc
  limit 1;

  -- Update ONLY active-predicate contracts whose price actually differs (idempotent; same price → 0 rows).
  with upd as (
    update public.enterprise_contracts c
       set monthly_store_price = v_new,
           updated_by          = auth.uid(),
           updated_at          = now()
    from public.enterprise_accounts ea
    where ea.id = c.enterprise_account_id
      and ea.brand_registry_id = p_brand_registry_id
      and ea.deleted_at is null
      and c.deleted_at is null
      and c.status in ('active','expiring')
      and c.start_date <= current_date
      and (c.end_date is null or c.end_date >= current_date)
      and c.monthly_store_price is distinct from v_new
    returning c.id
  )
  select count(*) into v_count from upd;

  return jsonb_build_object(
    'updated_contract_count', v_count,
    'previous_price',         v_prev,
    'new_price',              v_new
  );
end $$;

-- ---------------------------------------------------------------------------
-- 2) Read-only dry-run counter for the confirm modal. Never writes.
-- ---------------------------------------------------------------------------
create or replace function public.admin_count_brand_active_contracts(
  p_brand_registry_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_count          int := 0;
  v_distinct       int := 0;
  v_registry_price int;
  v_billed_price   int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_brand_registry_id is null then raise exception 'p_brand_registry_id required'; end if;

  select default_store_price into v_registry_price
  from public.enterprise_brand_registry
  where id = p_brand_registry_id and deleted_at is null;
  if not found then raise exception 'brand not found or deleted: %', p_brand_registry_id; end if;

  select count(*), count(distinct c.monthly_store_price)
    into v_count, v_distinct
  from public.enterprise_contracts c
  join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
  where ea.brand_registry_id = p_brand_registry_id
    and ea.deleted_at is null
    and c.deleted_at is null
    and c.status in ('active','expiring')
    and c.start_date <= current_date
    and (c.end_date is null or c.end_date >= current_date);

  select c.monthly_store_price into v_billed_price
  from public.enterprise_contracts c
  join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
  where ea.brand_registry_id = p_brand_registry_id
    and ea.deleted_at is null
    and c.deleted_at is null
    and c.status in ('active','expiring')
    and c.start_date <= current_date
    and (c.end_date is null or c.end_date >= current_date)
  order by c.signed_at desc nulls last, c.start_date desc, c.created_at desc
  limit 1;

  return jsonb_build_object(
    'active_contract_count',        v_count,
    'registry_default_store_price', v_registry_price,
    'billed_contract_price',        v_billed_price,
    'distinct_active_prices',       v_distinct
  );
end $$;

-- ---------------------------------------------------------------------------
-- 3) Integrated atomic pricing update: registry default (+ optional active-contract propagation)
--    + audit, all in ONE transaction (avoids partial success on the pricing path). Owns the
--    default_store_price change; other brand fields stay with admin_update_brand_registry.
-- ---------------------------------------------------------------------------
create or replace function public.admin_update_brand_registry_pricing(
  p_brand_registry_id          uuid,
  p_default_store_price         integer,
  p_apply_to_active_contracts   boolean default false,
  p_effective_from             date default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_prev_registry int;
  v_new           int := p_default_store_price;
  v_apply         boolean := coalesce(p_apply_to_active_contracts, false);
  v_apply_result  jsonb := null;
  v_updated       int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_brand_registry_id is null then raise exception 'p_brand_registry_id required'; end if;
  if v_new is null or v_new < 0 then raise exception 'p_default_store_price must be >= 0'; end if;

  select default_store_price into v_prev_registry
  from public.enterprise_brand_registry
  where id = p_brand_registry_id and deleted_at is null
  for update;
  if not found then raise exception 'brand not found or deleted: %', p_brand_registry_id; end if;

  -- (a) registry default = source of truth for NEW contracts
  update public.enterprise_brand_registry
     set default_store_price = v_new,
         updated_by          = auth.uid(),
         updated_at          = now()
   where id = p_brand_registry_id;

  -- (b) optional propagation to ACTIVE contracts (same transaction → atomic)
  if v_apply then
    v_apply_result := public.admin_apply_brand_store_price_to_active_contracts(
      p_brand_registry_id, v_new, p_effective_from
    );
    v_updated := coalesce((v_apply_result ->> 'updated_contract_count')::int, 0);
  end if;

  -- (c) audit (generic admin log; no secrets, no PII)
  perform public.admin_log_operation(
    'enterprise_operations', 'brand_pricing', 'success', 'success',
    'brand store price updated',
    jsonb_build_object(
      'brand_registry_id',            p_brand_registry_id,
      'previous_default_store_price', v_prev_registry,
      'new_default_store_price',      v_new,
      'apply_to_active_contracts',    v_apply,
      'affected_contract_count',      v_updated,
      'effective_from',               p_effective_from
    ),
    auth.uid(),
    p_brand_registry_id::text
  );

  return jsonb_build_object(
    'success',                      true,
    'brand_registry_id',            p_brand_registry_id,
    'previous_default_store_price', v_prev_registry,
    'new_default_store_price',      v_new,
    'applied_to_active_contracts',  v_apply,
    'updated_contract_count',       v_updated
  );
end $$;

-- ---------------------------------------------------------------------------
-- Grants: authenticated only; each function enforces _is_super_admin() internally.
-- ---------------------------------------------------------------------------
revoke all on function public.admin_apply_brand_store_price_to_active_contracts(uuid,integer,date) from public, anon;
revoke all on function public.admin_count_brand_active_contracts(uuid) from public, anon;
revoke all on function public.admin_update_brand_registry_pricing(uuid,integer,boolean,date) from public, anon;

grant execute on function public.admin_apply_brand_store_price_to_active_contracts(uuid,integer,date) to authenticated;
grant execute on function public.admin_count_brand_active_contracts(uuid) to authenticated;
grant execute on function public.admin_update_brand_registry_pricing(uuid,integer,boolean,date) to authenticated;
