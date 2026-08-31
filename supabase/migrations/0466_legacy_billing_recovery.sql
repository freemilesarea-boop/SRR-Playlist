-- ============================================
-- 0466_legacy_billing_recovery.sql
--
-- Phase LEGACY-BILLING-RECOVERY-BUILD-NOTIFY-1
-- Scheduler 누락으로 미청구된 기존 고객의 "단일 주기(고객당 1회, 서버 플랜가)" 복구
-- 결제와 고객 안내(이메일)를 위한 additive 구성.
--
-- ⚠️ 이 migration 은 청구·발송을 실행하지 않는다. 실제 청구는 별도 Kill Switch
--    (BILLING_LEGACY_RECOVERY_ENABLED) + 운영자 승인 이후에만, 발송은 대상 RPC를
--    호출하는 Edge Function 을 통해서만 발생한다. 기존 객체 Drop/데이터 변경 없음.
-- ============================================

-- ----------------------------------------------------------------------------
-- (A) 복구 전용 멱등키 — 정상 rebill 과 분리. (subscription, op, recovery_cutover_date)
-- ----------------------------------------------------------------------------
alter table public.subscription_rebill_charges
  add column if not exists recovery_cutover_date date;

create unique index if not exists uq_rebill_charge_recovery
  on public.subscription_rebill_charges (subscription_id, operation_type, recovery_cutover_date)
  where operation_type = 'legacy_single_cycle_recovery';

-- 복구 cutover 일자(고정). rebill cutover 와 동일 시점의 KST 일자.
create or replace function public.billing_recovery_cutover_date()
returns date language sql immutable
as $$ select (public.billing_rebill_cutover_ts() at time zone 'Asia/Seoul')::date; $$;

-- ----------------------------------------------------------------------------
-- (B) 안내 발송 기록 — 멱등. 개인정보(전화·이메일·rebill_no) 원문 미저장.
-- ----------------------------------------------------------------------------
create table if not exists public.billing_recovery_notifications (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  user_id uuid,
  recovery_execution_id text not null,
  channel text not null check (channel in ('email','sms')),
  template_type text not null check (template_type in ('auto_recharge','payment_method_required')),
  scheduled_charge_at timestamptz,
  provider_message_id text,
  status text not null default 'pending' check (status in ('pending','sent','failed','skipped','cancelled')),
  failure_code text,
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_recovery_notification
  on public.billing_recovery_notifications (subscription_id, channel, template_type, recovery_execution_id);
create index if not exists idx_recovery_notification_status
  on public.billing_recovery_notifications (status, created_at desc);

alter table public.billing_recovery_notifications enable row level security;
-- 정책 없음 = service_role / SECURITY DEFINER 경유만.

-- ----------------------------------------------------------------------------
-- (C) 대상 분류 pool (internal). 각 subscription 정확히 1개 분류.
-- ----------------------------------------------------------------------------
create or replace function public._legacy_recovery_pool(p_cutover_ts timestamptz)
returns table(subscription_id uuid, user_id uuid, classification text, template_type text,
              amount integer, current_period_end timestamptz)
language sql stable security definer set search_path to 'public'
as $$
  with base as (
    select s.id, s.user_id, s.status, s.auto_renew, s.payapp_rebill_no, s.cancel_requested_at,
           s.current_period_end, coalesce(s.current_amount, s.price) as sub_amount, s.plan_type,
           sp.price as plan_price, u.role, u.membership_tier,
           (select count(*) from public.subscription_rebill_charges c where c.subscription_id = s.id) as prior_attempts,
           (select count(*) from public.payment_orders po where po.subscription_id = s.id and po.order_no like 'swk_recovery_%') as prior_recovery_orders
    from public.subscriptions s
    join public.users u on u.id = s.user_id
    left join public.subscription_plans sp on sp.plan_type = s.plan_type
    where s.status = 'active' and s.current_period_end is not null and s.current_period_end < now()
  )
  select b.id, b.user_id, cl.classification,
    case cl.classification
      when 'RECOVERY_CHARGE_ELIGIBLE' then 'auto_recharge'
      when 'PAYMENT_METHOD_REQUIRED' then 'payment_method_required'
      else null end as template_type,
    b.plan_price::int as amount, b.current_period_end
  from base b
  cross join lateral (
    select case
      when b.status <> 'active' or b.cancel_requested_at is not null or b.role = 'admin'
        or b.membership_tier = 'free'
        or b.user_id = any(array['de700001-0000-0000-0000-000000000001','de700002-0000-0000-0000-000000000001','de700002-0000-0000-0000-000000000002','de700002-0000-0000-0000-000000000003']::uuid[])
        or b.prior_attempts > 0 or b.prior_recovery_orders > 0 then 'EXCLUDED'
      when b.payapp_rebill_no is null or b.payapp_rebill_no = '' or b.plan_price is null
        or b.sub_amount is distinct from b.plan_price then 'PAYMENT_METHOD_REQUIRED'
      when b.current_period_end < p_cutover_ts and b.auto_renew = true then 'RECOVERY_CHARGE_ELIGIBLE'
      else 'OTHER'
    end as classification
  ) cl;
$$;

-- ----------------------------------------------------------------------------
-- (D) 관리자용 분류 요약 — 개인정보 미반환.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_legacy_recovery_targets(
  p_cutover_ts timestamptz default public.billing_rebill_cutover_ts())
returns table(subscription_id uuid, classification text, template_type text,
              amount integer, current_period_end timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
  select p.subscription_id, p.classification, p.template_type, p.amount, p.current_period_end
  from public._legacy_recovery_pool(p_cutover_ts) p
  where p.classification in ('RECOVERY_CHARGE_ELIGIBLE','PAYMENT_METHOD_REQUIRED')
  order by p.classification, p.current_period_end;
end;
$$;

-- ----------------------------------------------------------------------------
-- (E) 발송 후보 — service_role/admin 전용. 이메일 포함(전송용). 이미 발송/대기분 제외.
-- ----------------------------------------------------------------------------
create or replace function public.legacy_recovery_notify_candidates(
  p_cutover_ts timestamptz default public.billing_rebill_cutover_ts())
returns table(subscription_id uuid, user_id uuid, email text, template_type text,
              amount integer, current_period_end timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
  select p.subscription_id, p.user_id, au.email::text, p.template_type, p.amount, p.current_period_end
  from public._legacy_recovery_pool(p_cutover_ts) p
  join auth.users au on au.id = p.user_id
  where p.classification in ('RECOVERY_CHARGE_ELIGIBLE','PAYMENT_METHOD_REQUIRED')
    and au.email is not null and length(au.email::text) > 3
    and not exists (
      select 1 from public.billing_recovery_notifications n
       where n.subscription_id = p.subscription_id
         and n.channel = 'email'
         and n.template_type = p.template_type
         and n.status in ('sent','pending')
    )
  order by p.classification, p.current_period_end;
end;
$$;

-- ----------------------------------------------------------------------------
-- (F) 발송 기록 RPC — 멱등 insert + 결과 마킹.
-- ----------------------------------------------------------------------------
create or replace function public.record_recovery_notification(
  p_subscription_id uuid, p_user_id uuid, p_execution_id text, p_channel text,
  p_template_type text, p_scheduled_charge_at timestamptz default null)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.billing_recovery_notifications
    (subscription_id, user_id, recovery_execution_id, channel, template_type, scheduled_charge_at, status)
  values
    (p_subscription_id, p_user_id, p_execution_id, p_channel, p_template_type, p_scheduled_charge_at, 'pending')
  on conflict (subscription_id, channel, template_type, recovery_execution_id) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.mark_recovery_notification_result(
  p_id uuid, p_status text, p_provider_message_id text default null, p_failure_code text default null)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('pending','sent','failed','skipped','cancelled') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.billing_recovery_notifications
     set status = p_status,
         provider_message_id = coalesce(p_provider_message_id, provider_message_id),
         failure_code = p_failure_code,
         sent_at = case when p_status = 'sent' then now() else sent_at end
   where id = p_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- (G) 복구 결제 대상/기록 — 서버 재검증. 고객당 1회(멱등). 이 Phase 에서는 미실행.
-- ----------------------------------------------------------------------------
create or replace function public.legacy_recovery_charge_candidates(p_subscription_ids uuid[] default null)
returns table(subscription_id uuid, user_id uuid, plan_type text, amount integer)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return query
  select p.subscription_id, p.user_id, s.plan_type, p.amount
  from public._legacy_recovery_pool(public.billing_rebill_cutover_ts()) p
  join public.subscriptions s on s.id = p.subscription_id
  where p.classification = 'RECOVERY_CHARGE_ELIGIBLE'
    and (p_subscription_ids is null or p.subscription_id = any(p_subscription_ids))
    and not exists (
      select 1 from public.subscription_rebill_charges c
       where c.subscription_id = p.subscription_id
         and c.operation_type = 'legacy_single_cycle_recovery'
         and c.recovery_cutover_date = public.billing_recovery_cutover_date());
end;
$$;

create or replace function public.record_legacy_recovery_attempt(
  p_subscription_id uuid, p_user_id uuid, p_amount integer, p_plan_type text, p_execution_id text)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.subscription_rebill_charges
    (subscription_id, user_id, amount, plan_type, cycle_period_end, status,
     operation_type, recovery_cutover_date, execution_id)
  values
    (p_subscription_id, p_user_id, p_amount, p_plan_type, null, 'attempted',
     'legacy_single_cycle_recovery', public.billing_recovery_cutover_date(), p_execution_id)
  on conflict (subscription_id, operation_type, recovery_cutover_date)
    where operation_type = 'legacy_single_cycle_recovery' do nothing
  returning id into v_id;
  return v_id;
end;
$$;
