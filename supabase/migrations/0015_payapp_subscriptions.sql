-- ============================================
-- 0015_payapp_subscriptions.sql
--
-- PayApp 정기결제 (rebill) 통합:
--   - subscription_plans   (서버 가격 기준)
--   - subscriptions        (사용자별 활성 정기결제)
--   - payment_orders       (결제 요청 단위 — rebillRegist / 매월 결제)
--   - payapp_webhook_events (feedbackurl 멱등 처리)
--
-- 보안:
--   - 가격은 항상 subscription_plans 의 price 만 신뢰. 프론트 값 무시.
--   - linkval / linkkey 검증 후에만 권한 부여.
-- ============================================

-- ----------------------
-- users.membership_tier — 현재 유효한 권한
-- ----------------------
alter table public.users
  add column if not exists membership_tier text not null default 'free'
    check (membership_tier in ('free','individual','business'));

-- ----------------------
-- 1) subscription_plans + seed
-- ----------------------
create table if not exists public.subscription_plans (
  id uuid primary key default gen_random_uuid(),
  plan_type text unique not null check (plan_type in ('individual','business')),
  name text not null,
  price integer not null check (price > 0),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('monthly','yearly')),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.subscription_plans enable row level security;

drop policy if exists "plans_public_select" on public.subscription_plans;
create policy "plans_public_select" on public.subscription_plans
  for select using (true);

drop policy if exists "plans_admin_write" on public.subscription_plans;
create policy "plans_admin_write" on public.subscription_plans
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

insert into public.subscription_plans (plan_type, name, price, billing_cycle)
values
  ('individual', 'SWK 일반 이용권', 4900, 'monthly'),
  ('business',   'SWK 사업자 이용권', 6900, 'monthly')
on conflict (plan_type) do update
  set name = excluded.name, price = excluded.price, billing_cycle = excluded.billing_cycle;

-- ----------------------
-- 2) subscriptions
-- ----------------------
create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  plan_type text not null check (plan_type in ('individual','business')),
  status text not null default 'pending'
    check (status in ('pending','active','canceled','failed','expired','payment_waiting')),
  price integer not null,
  payapp_rebill_no text,
  payapp_mul_no text,
  payapp_pay_state integer,
  payapp_pay_type integer,
  current_period_start timestamptz,
  current_period_end timestamptz,
  canceled_at timestamptz,
  last_paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_subscriptions_user on public.subscriptions(user_id);
create index if not exists idx_subscriptions_rebill on public.subscriptions(payapp_rebill_no);
create index if not exists idx_subscriptions_status on public.subscriptions(status);

alter table public.subscriptions enable row level security;

drop policy if exists "subs_self_select" on public.subscriptions;
create policy "subs_self_select" on public.subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists "subs_admin_all" on public.subscriptions;
create policy "subs_admin_all" on public.subscriptions
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
-- INSERT/UPDATE 는 service_role(Edge Function) 에서만. anon/authed 는 차단.

-- ----------------------
-- 3) payment_orders
-- ----------------------
create table if not exists public.payment_orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  subscription_id uuid references public.subscriptions(id) on delete set null,
  order_no text unique not null,
  plan_type text not null check (plan_type in ('individual','business')),
  amount integer not null,
  status text not null default 'requested'
    check (status in ('requested','paid','canceled','failed','waiting')),
  payapp_rebill_no text,
  payapp_mul_no text,
  payapp_payurl text,
  raw_request jsonb,
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_user on public.payment_orders(user_id);
create index if not exists idx_orders_sub on public.payment_orders(subscription_id);

alter table public.payment_orders enable row level security;

drop policy if exists "orders_self_select" on public.payment_orders;
create policy "orders_self_select" on public.payment_orders
  for select using (auth.uid() = user_id);

drop policy if exists "orders_admin_all" on public.payment_orders;
create policy "orders_admin_all" on public.payment_orders
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 4) payapp_webhook_events (멱등 처리용)
-- ----------------------
create table if not exists public.payapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_key text unique not null,
  order_no text,
  user_id uuid references public.users(id) on delete set null,
  payapp_mul_no text,
  payapp_rebill_no text,
  pay_state integer,
  price integer,
  linkval_verified boolean not null default false,
  raw_payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_webhook_order on public.payapp_webhook_events(order_no);
create index if not exists idx_webhook_user on public.payapp_webhook_events(user_id);

alter table public.payapp_webhook_events enable row level security;

drop policy if exists "webhook_admin_select" on public.payapp_webhook_events;
create policy "webhook_admin_select" on public.payapp_webhook_events
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 5) updated_at trigger 공용
-- ----------------------
create or replace function public._touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_subs_updated_at on public.subscriptions;
create trigger trg_subs_updated_at before update on public.subscriptions
  for each row execute function public._touch_updated_at();

drop trigger if exists trg_orders_updated_at on public.payment_orders;
create trigger trg_orders_updated_at before update on public.payment_orders
  for each row execute function public._touch_updated_at();

-- 확인 출력
select
  (select count(*) from public.subscription_plans) as plans,
  (select count(*) from public.subscriptions) as subs,
  (select count(*) from public.payment_orders) as orders,
  (select count(*) from public.payapp_webhook_events) as webhooks;
