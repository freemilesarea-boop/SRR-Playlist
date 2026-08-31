-- ============================================================================
-- 0472_enterprise_signup_payment.sql
--
-- 엔터프라이즈 본사(HQ)/가맹(store) 가입 직후 정기결제(PayApp rebill) 기능.
--   - 관리자가 본사 계정 등록 시 청구 모드 선택:
--       hq_consolidated (일괄청구) — 본사가 정액 월요금을 결제, 매장은 결제 안 함
--       per_store       (가맹청구) — 각 매장이 정액 월요금을 결제, 본사는 결제 안 함
--   - 금액은 관리자 정액(서버 신뢰): hq_monthly_price / store_monthly_price
--   - 가입 사용자는 결제 창(rebillRegist)에서 첫 결제 → 이후 매월 자동 청구
--
-- additive only. 기존 enterprise_accounts 에 컬럼 추가 + 신규 결제 테이블/함수.
-- (기존 enterprise_billing_invoices 월 청구 흐름과는 별개 — 정액 rebill 전용)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) enterprise_accounts 청구 설정 컬럼
-- ----------------------------------------------------------------------------
alter table public.enterprise_accounts
  add column if not exists billing_enabled boolean not null default false,
  add column if not exists billing_mode text not null default 'hq_consolidated',
  add column if not exists hq_monthly_price integer,
  add column if not exists store_monthly_price integer;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'enterprise_accounts_billing_mode_chk') then
    alter table public.enterprise_accounts
      add constraint enterprise_accounts_billing_mode_chk
      check (billing_mode in ('hq_consolidated','per_store'));
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 2) 결제 구독(정기결제 등록 단위) — 결제 주체(HQ 또는 store)별 1건
-- ----------------------------------------------------------------------------
create table if not exists public.enterprise_payment_subscriptions (
  id uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  payer_type text not null check (payer_type in ('hq','store')),
  payer_user_id uuid not null references public.users(id) on delete cascade,
  franchise_store_id uuid references public.franchise_stores(id) on delete set null,
  amount integer not null check (amount > 0),
  status text not null default 'pending'
    check (status in ('pending','active','canceled','failed','payment_waiting')),
  payapp_rebill_no text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ent_pay_sub_payer on public.enterprise_payment_subscriptions(payer_user_id, status);
create index if not exists idx_ent_pay_sub_account on public.enterprise_payment_subscriptions(enterprise_account_id);
create unique index if not exists uniq_ent_pay_sub_rebill on public.enterprise_payment_subscriptions(payapp_rebill_no) where payapp_rebill_no is not null;

-- ----------------------------------------------------------------------------
-- 3) 결제 주문(첫 결제 + 매월 rebill 청구 1건 = 1 row)
-- ----------------------------------------------------------------------------
create table if not exists public.enterprise_payment_orders (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.enterprise_payment_subscriptions(id) on delete set null,
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete cascade,
  payer_user_id uuid not null references public.users(id) on delete cascade,
  payer_type text not null check (payer_type in ('hq','store')),
  order_no text not null unique,
  amount integer not null check (amount > 0),
  status text not null default 'requested'
    check (status in ('requested','waiting','paid','failed','canceled')),
  payapp_rebill_no text,
  payapp_mul_no text,
  payapp_payurl text,
  raw_request jsonb,
  raw_response jsonb,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_ent_pay_order_payer on public.enterprise_payment_orders(payer_user_id, status);
create index if not exists idx_ent_pay_order_account on public.enterprise_payment_orders(enterprise_account_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 4) PayApp 웹훅 이벤트(멱등)
-- ----------------------------------------------------------------------------
create table if not exists public.enterprise_payapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text not null unique,
  order_no text,
  payapp_rebill_no text,
  payapp_mul_no text,
  pay_state int,
  price int,
  verified boolean not null default false,
  matched_order_id uuid,
  processing_note text,
  raw_payload jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_ent_webhook_order on public.enterprise_payapp_webhook_events(order_no);
create index if not exists idx_ent_webhook_rebill on public.enterprise_payapp_webhook_events(payapp_rebill_no);

-- updated_at 트리거
do $$ begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='_touch_updated_at') then
    drop trigger if exists trg_ent_pay_sub_touch on public.enterprise_payment_subscriptions;
    create trigger trg_ent_pay_sub_touch before update on public.enterprise_payment_subscriptions for each row execute function public._touch_updated_at();
    drop trigger if exists trg_ent_pay_order_touch on public.enterprise_payment_orders;
    create trigger trg_ent_pay_order_touch before update on public.enterprise_payment_orders for each row execute function public._touch_updated_at();
  end if;
end $$;

-- ----------------------------------------------------------------------------
-- 5) RLS — 결제 주체 본인 read, 관리자 all. (insert 는 service_role 엣지함수)
-- ----------------------------------------------------------------------------
alter table public.enterprise_payment_subscriptions enable row level security;
alter table public.enterprise_payment_orders enable row level security;
alter table public.enterprise_payapp_webhook_events enable row level security;

drop policy if exists ent_pay_sub_self on public.enterprise_payment_subscriptions;
create policy ent_pay_sub_self on public.enterprise_payment_subscriptions for select to authenticated using (payer_user_id = auth.uid());
drop policy if exists ent_pay_sub_admin on public.enterprise_payment_subscriptions;
create policy ent_pay_sub_admin on public.enterprise_payment_subscriptions for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

drop policy if exists ent_pay_order_self on public.enterprise_payment_orders;
create policy ent_pay_order_self on public.enterprise_payment_orders for select to authenticated using (payer_user_id = auth.uid());
drop policy if exists ent_pay_order_admin on public.enterprise_payment_orders;
create policy ent_pay_order_admin on public.enterprise_payment_orders for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

drop policy if exists ent_webhook_admin on public.enterprise_payapp_webhook_events;
create policy ent_webhook_admin on public.enterprise_payapp_webhook_events for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ----------------------------------------------------------------------------
-- 6) 관리자 — 청구 설정
-- ----------------------------------------------------------------------------
create or replace function public.admin_set_enterprise_billing_config(
  p_enterprise_account_id uuid, p_billing_enabled boolean, p_billing_mode text,
  p_hq_monthly_price integer default null, p_store_monthly_price integer default null
)
returns jsonb language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  if p_billing_mode not in ('hq_consolidated','per_store') then raise exception 'invalid billing_mode'; end if;
  if p_billing_enabled then
    if p_billing_mode='hq_consolidated' and coalesce(p_hq_monthly_price,0) <= 0 then raise exception '일괄청구는 본사 월요금(>0)이 필요합니다.'; end if;
    if p_billing_mode='per_store' and coalesce(p_store_monthly_price,0) <= 0 then raise exception '가맹청구는 매장 월요금(>0)이 필요합니다.'; end if;
  end if;
  update public.enterprise_accounts
     set billing_enabled = coalesce(p_billing_enabled,false),
         billing_mode = p_billing_mode,
         hq_monthly_price = p_hq_monthly_price,
         store_monthly_price = p_store_monthly_price
   where id = p_enterprise_account_id;
  if not found then raise exception 'enterprise account not found'; end if;
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_get_enterprise_billing_config(p_enterprise_account_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select jsonb_build_object(
    'billing_enabled', ea.billing_enabled, 'billing_mode', ea.billing_mode,
    'hq_monthly_price', ea.hq_monthly_price, 'store_monthly_price', ea.store_monthly_price,
    'active_hq_subs', (select count(*) from public.enterprise_payment_subscriptions s where s.enterprise_account_id=ea.id and s.payer_type='hq' and s.status='active'),
    'active_store_subs', (select count(*) from public.enterprise_payment_subscriptions s where s.enterprise_account_id=ea.id and s.payer_type='store' and s.status='active')
  ) into v from public.enterprise_accounts ea where ea.id = p_enterprise_account_id;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) 유저 — 내 결제 컨텍스트 (가입 후 결제창이 이걸로 금액/주체 판단)
-- ----------------------------------------------------------------------------
create or replace function public.get_my_enterprise_payment_context()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid; v_ea_name text; v_enabled boolean; v_mode text;
  v_amount integer;
  v_payer text;
  v_store_id uuid;
  v_active boolean;
begin
  if v_uid is null then return jsonb_build_object('should_pay', false); end if;

  -- (a) HQ 본인?
  select ea.id, ea.enterprise_name, ea.billing_enabled, ea.billing_mode, ea.hq_monthly_price
    into v_ea_id, v_ea_name, v_enabled, v_mode, v_amount
  from public.enterprise_accounts ea
  where ea.auth_user_id = v_uid and ea.deleted_at is null and ea.status in ('active','invited') limit 1;

  if v_ea_id is not null and v_enabled and v_mode = 'hq_consolidated' then
    v_payer := 'hq';
    v_store_id := null;
    -- v_amount = hq_monthly_price (위 select)
  else
    -- (b) 가맹 매장?
    select fs.id, ea2.id, ea2.enterprise_name, ea2.billing_enabled, ea2.billing_mode, ea2.store_monthly_price
      into v_store_id, v_ea_id, v_ea_name, v_enabled, v_mode, v_amount
    from public.users u
    join public.franchise_stores fs on fs.store_id = u.id and fs.status='active'
    join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
    join public.enterprise_accounts ea2 on ea2.id = ef.enterprise_account_id and ea2.deleted_at is null
    where u.id = v_uid and coalesce(u.account_type,'individual')='business'
    order by case ef.role when 'primary' then 0 else 1 end nulls last
    limit 1;
    if v_ea_id is not null and v_enabled and v_mode = 'per_store' then
      v_payer := 'store';
    else
      return jsonb_build_object('should_pay', false);
    end if;
  end if;

  if coalesce(v_amount,0) <= 0 then return jsonb_build_object('should_pay', false); end if;

  select exists (
    select 1 from public.enterprise_payment_subscriptions s
    where s.payer_user_id = v_uid and s.enterprise_account_id = v_ea_id
      and s.payer_type = v_payer and s.status in ('active','payment_waiting')
  ) into v_active;

  return jsonb_build_object(
    'should_pay', not v_active,
    'already_active', v_active,
    'payer_type', v_payer,
    'amount', v_amount,
    'enterprise_account_id', v_ea_id,
    'enterprise_name', v_ea_name,
    'franchise_store_id', v_store_id
  );
end;
$$;

-- 내 구독 상태(결제 성공 폴링/대시보드)
create or replace function public.get_my_enterprise_subscription()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  if auth.uid() is null then return null; end if;
  select jsonb_build_object(
    'status', s.status, 'amount', s.amount, 'payer_type', s.payer_type,
    'current_period_end', s.current_period_end, 'last_paid_at', s.last_paid_at,
    'enterprise_name', ea.enterprise_name
  ) into v
  from public.enterprise_payment_subscriptions s
  join public.enterprise_accounts ea on ea.id = s.enterprise_account_id
  where s.payer_user_id = auth.uid()
  order by case s.status when 'active' then 0 when 'payment_waiting' then 1 else 2 end, s.created_at desc
  limit 1;
  return v;
end;
$$;

-- 주문 상태(결제 성공 페이지 폴링)
create or replace function public.get_my_enterprise_order_status(p_order_no text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  select jsonb_build_object('order_no', o.order_no, 'status', o.status, 'paid', (o.status='paid'), 'amount', o.amount)
  into v from public.enterprise_payment_orders o
  where o.order_no = p_order_no and o.payer_user_id = auth.uid();
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) service_role — 결제 확인 반영 (웹훅)
--    첫 결제: order_no 매칭. 이후 자동청구: rebill_no 매칭(새 주문 생성).
-- ----------------------------------------------------------------------------
create or replace function public._apply_enterprise_payapp_event(
  p_order_no text, p_rebill_no text, p_mul_no text, p_pay_state int, p_amount int, p_raw jsonb default '{}'::jsonb
)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_order public.enterprise_payment_orders;
  v_sub public.enterprise_payment_subscriptions;
  v_has_order boolean := false;
  v_has_sub boolean := false;
begin
  -- 1) order_no 로 첫 결제 주문 매칭
  if p_order_no is not null and p_order_no <> '' then
    select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1;
    v_has_order := found;
  end if;

  -- 2) 없으면 rebill_no 로 구독 매칭(자동청구) → 새 주문 생성
  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1;
    v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if p_pay_state = 64 then
      insert into public.enterprise_payment_orders(subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no, amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
              'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text), coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;
      update public.enterprise_payment_subscriptions
         set status='active', last_paid_at=now(),
             current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_sub.id;
      return jsonb_build_object('ok', true, 'status', 'rebill_paid', 'subscription_id', v_sub.id);
    end if;
    return jsonb_build_object('ok', true, 'status', 'ignored_rebill_state');
  end if;

  if not v_has_order then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if p_amount is not null and p_amount <> 0 and p_amount <> v_order.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  if p_pay_state = 64 then
    if v_order.status <> 'paid' then
      update public.enterprise_payment_orders
         set status='paid', paid_at=now(), payapp_mul_no=coalesce(p_mul_no, payapp_mul_no),
             payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no), raw_response=coalesce(p_raw, raw_response)
       where id = v_order.id;
      update public.enterprise_payment_subscriptions
         set status='active', payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no),
             last_paid_at=now(), current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_order.subscription_id;
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id);
  elsif p_pay_state in (8,9,32,70,71) then
    update public.enterprise_payment_orders set status='canceled', payapp_mul_no=coalesce(p_mul_no, payapp_mul_no) where id=v_order.id and status<>'paid';
    update public.enterprise_payment_subscriptions set status='canceled' where id=v_order.subscription_id and status<>'active';
    return jsonb_build_object('ok', true, 'status', 'canceled');
  else
    update public.enterprise_payment_orders set status='waiting' where id=v_order.id and status='requested';
    return jsonb_build_object('ok', true, 'status', 'waiting');
  end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) 권한
-- ----------------------------------------------------------------------------
grant execute on function public.admin_set_enterprise_billing_config(uuid, boolean, text, integer, integer) to authenticated, service_role;
grant execute on function public.admin_get_enterprise_billing_config(uuid) to authenticated, service_role;
revoke execute on function public.admin_set_enterprise_billing_config(uuid, boolean, text, integer, integer) from public, anon;
revoke execute on function public.admin_get_enterprise_billing_config(uuid) from public, anon;

grant execute on function public.get_my_enterprise_payment_context() to authenticated, service_role;
grant execute on function public.get_my_enterprise_subscription() to authenticated, service_role;
grant execute on function public.get_my_enterprise_order_status(text) to authenticated, service_role;
revoke execute on function public.get_my_enterprise_payment_context() from public, anon;
revoke execute on function public.get_my_enterprise_subscription() from public, anon;
revoke execute on function public.get_my_enterprise_order_status(text) from public, anon;

revoke execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) from public, anon, authenticated;
grant  execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) to service_role;
