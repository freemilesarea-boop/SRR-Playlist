-- 0515 — 엔터프라이즈 밀린 회차 소급 청구 (판정 + 멱등 기록)
--
-- PayApp 은 결제내역 조회 API 가 없다(0514 참고). 그래서 "안 걷힌 회차" 는 우리가
-- 기간으로 판정하고, 필요하면 rebillPay 로 직접 청구한다. 소비자 쪽
-- dispatch-rebill-catchup 과 같은 구조다.
--
-- 이 마이그레이션은 **판정과 기록**만 담당한다. 실제 카드 청구는 엣지 함수가 하고,
-- 그것도 킬스위치(BILLING_ENTERPRISE_REBILL_ENABLED)가 명시적으로 켜져야만 한다.
--
-- 안전 원칙:
--   • 청구 대상은 이 SQL 이 chargeable=true 로 확정한 회차뿐. 엣지는 좁히기만 가능.
--   • 금액은 구독 row 가 아니라 **본사 설정의 현재 요금**을 쓴다(서버 진실).
--   • (구독, 회차) 유니크 — 같은 회차를 두 번 긁을 수 없다.

create table if not exists public.enterprise_rebill_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.enterprise_payment_subscriptions(id) on delete cascade,
  payer_user_id uuid not null,
  rebill_no text not null,
  amount integer not null,
  cycle_period_end timestamptz not null,
  status text not null default 'attempted',
  order_no text,
  execution_id text,
  payapp_state text,
  payapp_raw jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists uq_enterprise_rebill_charge_cycle
  on public.enterprise_rebill_charges (subscription_id, cycle_period_end);

comment on table public.enterprise_rebill_charges is
  '엔터프라이즈 소급 청구 시도 기록. (구독, 회차) 유니크로 같은 회차 중복 청구를 막는다.';

alter table public.enterprise_rebill_charges enable row level security;

-- 밀린 회차 목록 — chargeable 여부와 제외 사유를 함께 준다.
create or replace function public.admin_list_enterprise_catchup_cycles(
  p_subscription_ids uuid[] default null,
  p_max_cycles integer default 6,
  p_grace_days integer default 2
)
returns table (
  subscription_id uuid,
  payer_user_id uuid,
  enterprise_account_id uuid,
  payer_type text,
  store_label text,
  amount integer,
  rebill_no text,
  current_period_end timestamptz,
  cycle_period_end timestamptz,
  cycle_index integer,
  cycles_owed integer,
  chargeable boolean,
  exclude_reason text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with base as (
    select s.id, s.payer_user_id, s.enterprise_account_id, s.payer_type,
           s.payapp_rebill_no, s.current_period_end, s.status,
           coalesce(fs.store_name, au.email, s.payer_user_id::text) as store_label,
           -- 금액은 구독 row 가 아니라 본사 설정의 현재 요금을 쓴다.
           case when s.payer_type = 'hq' then ea.hq_monthly_price else ea.store_monthly_price end as cfg_amount,
           ea.billing_enabled,
           ea.billing_mode,
           -- 밀린 개월 수 (유예기간 반영)
           greatest(0, least(
             coalesce(p_max_cycles, 6),
             floor(extract(epoch from (now() - make_interval(days => greatest(p_grace_days,0)) - s.current_period_end)) / 2592000.0)::int + 1
           )) as owed
      from public.enterprise_payment_subscriptions s
      join public.enterprise_accounts ea on ea.id = s.enterprise_account_id
      left join public.franchise_stores fs on fs.id = s.franchise_store_id
      left join auth.users au on au.id = s.payer_user_id
     where s.status = 'active'
       and s.current_period_end is not null
       and (p_subscription_ids is null or s.id = any(p_subscription_ids))
  ),
  expanded as (
    select b.*, g.i as cycle_index,
           (b.current_period_end + make_interval(months => g.i)) as cycle_end
      from base b
      cross join lateral generate_series(1, greatest(b.owed, 0)) as g(i)
     where b.owed > 0
  )
  select e.id, e.payer_user_id, e.enterprise_account_id, e.payer_type, e.store_label,
         coalesce(e.cfg_amount, 0) as amount,
         e.payapp_rebill_no, e.current_period_end, e.cycle_end, e.cycle_index, e.owed,
         (
           e.payapp_rebill_no is not null
           and e.billing_enabled
           and coalesce(e.cfg_amount, 0) > 0
           and e.cycle_end < now() - make_interval(days => greatest(p_grace_days,0))
           and not exists (select 1 from public.enterprise_rebill_charges c
                            where c.subscription_id = e.id and c.cycle_period_end = e.cycle_end)
           and not exists (select 1 from public.enterprise_payment_orders o
                            where o.subscription_id = e.id and o.status = 'paid'
                              and o.paid_at >= e.cycle_end)
         ) as chargeable,
         case
           when e.payapp_rebill_no is null then 'no_rebill_no'
           when not e.billing_enabled then 'billing_disabled'
           when coalesce(e.cfg_amount, 0) <= 0 then 'no_price_configured'
           when e.cycle_end >= now() - make_interval(days => greatest(p_grace_days,0)) then 'within_grace'
           when exists (select 1 from public.enterprise_rebill_charges c
                         where c.subscription_id = e.id and c.cycle_period_end = e.cycle_end)
                then 'already_attempted'
           when exists (select 1 from public.enterprise_payment_orders o
                         where o.subscription_id = e.id and o.status = 'paid'
                           and o.paid_at >= e.cycle_end)
                then 'already_paid'
           else ''
         end as exclude_reason
    from expanded e
   order by e.cycle_end, e.id;
$$;

comment on function public.admin_list_enterprise_catchup_cycles(uuid[], integer, integer) is
  '엔터프라이즈 밀린 회차 목록. 청구 가능 여부(chargeable)와 제외 사유를 SQL 이 확정한다 — 엣지 함수는 좁히기만 가능.';

revoke execute on function public.admin_list_enterprise_catchup_cycles(uuid[], integer, integer) from public, anon;

-- (구독, 회차) 멱등키 — 이미 시도한 회차면 null 을 돌려 청구를 막는다.
create or replace function public.record_enterprise_rebill_charge_attempt(
  p_subscription_id uuid, p_payer_user_id uuid, p_rebill_no text,
  p_amount integer, p_cycle_period_end timestamptz, p_order_no text default null,
  p_execution_id text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_id uuid;
begin
  insert into public.enterprise_rebill_charges(
    subscription_id, payer_user_id, rebill_no, amount, cycle_period_end, order_no, execution_id, status)
  values (p_subscription_id, p_payer_user_id, p_rebill_no, p_amount, p_cycle_period_end,
          p_order_no, p_execution_id, 'attempted')
  on conflict (subscription_id, cycle_period_end) do nothing
  returning id into v_id;
  return v_id;   -- null = 이미 시도된 회차
end; $$;

revoke execute on function public.record_enterprise_rebill_charge_attempt(uuid, uuid, text, integer, timestamptz, text, text) from public, anon;

create or replace function public.mark_enterprise_rebill_charge_result(
  p_charge_id uuid, p_status text, p_payapp_state text default null,
  p_payapp_raw jsonb default null, p_error text default null
)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.enterprise_rebill_charges
     set status = p_status,
         payapp_state = coalesce(p_payapp_state, payapp_state),
         payapp_raw = coalesce(p_payapp_raw, payapp_raw),
         error = coalesce(p_error, error),
         updated_at = now()
   where id = p_charge_id;
$$;

revoke execute on function public.mark_enterprise_rebill_charge_result(uuid, text, text, jsonb, text) from public, anon;
