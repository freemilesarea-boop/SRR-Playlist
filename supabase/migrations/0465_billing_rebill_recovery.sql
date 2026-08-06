-- ============================================
-- 0465_billing_rebill_recovery.sql
--
-- Phase BILLING-SCHEDULER-RECOVERY-1
-- 정기결제(rebill) 실행 계층의 형상관리 정상화 + 안전장치.
--
-- 배경(SUBSCRIPTION-BILLING-AUDIT-1):
--   Production 에만 수동 배포되어 있고 Git 에 없던 정기결제 구성요소
--   (subscription_rebill_charges 테이블, admin_list_rebill_due_subscriptions /
--    record_rebill_charge_attempt / mark_rebill_charge_result RPC)를 저장소에
--   idempotent 하게 복원한다. 이미 존재하는 Production 객체를 Drop/재생성하지
--   않으며(CREATE TABLE IF NOT EXISTS / CREATE OR REPLACE), 기존 데이터를 보존한다.
--
-- 추가(안전장치):
--   1) billing_rebill_cutover_ts()  — 과거/미래 경계 고정 상수(요청마다 now() 를
--      동적으로 쓰지 않는다). LEGACY_OVERDUE 격리 기준.
--   2) admin_list_rebill_due_v2()   — FUTURE_DUE / LEGACY_OVERDUE / INVALID_REBILL /
--      DUPLICATE_BLOCKED 로 분류하고 chargeable 플래그를 서버에서 확정. 개인정보 미반환.
--   3) subscription_rebill_charges  — execution_id / provider / operation_type 추적
--      컬럼 및 상태 vocabulary 확장(기존 4상태의 상위집합, 하위호환).
--   4) admin_rebill_ops_metrics()   — 운영 모니터링 집계(개인정보 없음).
--
-- ⚠️ 이 migration 은 청구를 실행하지 않는다. 실제 청구는 Edge Function +
--    Kill Switch(BILLING_REBILL_ENABLED) + 운영자 승인 이후에만 발생한다.
--    기존 12건(LEGACY_OVERDUE)은 chargeable=false 로 항상 격리된다.
-- ============================================

-- ----------------------------------------------------------------------------
-- (A) 베이스라인 복원 — Production 배포본과 동일. idempotent.
-- ----------------------------------------------------------------------------
create table if not exists public.subscription_rebill_charges (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid references public.subscriptions(id) on delete cascade,
  user_id uuid,
  rebill_no text,
  order_no text,
  amount integer check (amount >= 0),
  plan_type text,
  cycle_period_end timestamptz,
  status text not null default 'attempted',
  payapp_state text,
  payapp_raw jsonb,
  error_message text,
  requested_at timestamptz not null default now(),
  resolved_at timestamptz
);

-- 멱등성 핵심: (subscription, cycle) 당 최대 1건.
create unique index if not exists uq_rebill_charge_cycle
  on public.subscription_rebill_charges (subscription_id, cycle_period_end);
create index if not exists idx_rebill_charge_status
  on public.subscription_rebill_charges (status, requested_at desc);

alter table public.subscription_rebill_charges enable row level security;
-- 정책 없음 = service_role / SECURITY DEFINER 경유만 접근(Production 과 동일).

-- 갱신 대상 조회(베이스라인). v2 가 이를 대체하지만, 기존 배포본 호환을 위해 유지.
create or replace function public.admin_list_rebill_due_subscriptions(p_grace_days integer default 0)
returns table(subscription_id uuid, user_id uuid, email text, nickname text, phone text,
              plan_type text, plan_name text, amount integer,
              current_period_end timestamptz, rebill_no text)
language sql stable security definer set search_path to 'public'
as $$
  select s.id, s.user_id, au.email::text, u.nickname, u.phone,
         s.plan_type, sp.name, coalesce(s.current_amount, s.price)::int,
         s.current_period_end, s.payapp_rebill_no
  from public.subscriptions s
  join public.users u  on u.id = s.user_id
  join auth.users  au on au.id = s.user_id
  left join public.subscription_plans sp on sp.plan_type = s.plan_type
  where public._is_super_admin()
    and s.status = 'active'
    and s.auto_renew = true
    and s.payapp_rebill_no is not null
    and u.membership_tier in ('individual','business','artist_general','artist_student')
    and s.current_period_end is not null
    and s.current_period_end < now() - make_interval(days => greatest(coalesce(p_grace_days,0),0))
    and au.email is not null
    and length(au.email::text) > 3
    and not exists (
      select 1 from public.subscription_rebill_charges c
       where c.subscription_id = s.id
         and c.cycle_period_end = s.current_period_end
         and c.status in ('accepted','paid')
    )
  order by s.current_period_end;
$$;

-- 청구 시도 기록(베이스라인). (subscription, cycle) 멱등.
create or replace function public.record_rebill_charge_attempt(
  p_subscription_id uuid, p_user_id uuid, p_rebill_no text, p_amount integer,
  p_plan_type text, p_cycle_period_end timestamptz, p_order_no text default null)
returns uuid language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.subscription_rebill_charges
    (subscription_id, user_id, rebill_no, order_no, amount, plan_type, cycle_period_end, status)
  values
    (p_subscription_id, p_user_id, p_rebill_no, p_order_no, p_amount, p_plan_type, p_cycle_period_end, 'attempted')
  on conflict (subscription_id, cycle_period_end) do nothing
  returning id into v_id;
  return v_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- (B) 추적 컬럼 — 관측성. 기존 데이터 보존(테이블 비어있음/기본값 채움).
-- ----------------------------------------------------------------------------
alter table public.subscription_rebill_charges
  add column if not exists execution_id text,
  add column if not exists provider text not null default 'payapp',
  add column if not exists operation_type text not null default 'rebill';

-- 상태 vocabulary 확장 — 기존 4상태('attempted','accepted','paid','failed')의
-- 상위집합. 테이블이 비어 있어 안전(하위호환).
alter table public.subscription_rebill_charges
  drop constraint if exists subscription_rebill_charges_status_check;
alter table public.subscription_rebill_charges
  add constraint subscription_rebill_charges_status_check check (
    status in (
      'eligible','attempted','requesting','accepted','provider_accepted',
      'provider_rejected','awaiting_webhook','paid','failed','skipped',
      'unknown','reconciled'
    )
  );

-- 결과 마킹(확장판). 기존 시그니처 유지 + 확장 상태 허용(하위호환).
create or replace function public.mark_rebill_charge_result(
  p_charge_id uuid, p_status text, p_payapp_state text default null,
  p_payapp_raw jsonb default null, p_error text default null)
returns void language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in (
    'attempted','requesting','accepted','provider_accepted','provider_rejected',
    'awaiting_webhook','paid','failed','skipped','unknown','reconciled'
  ) then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.subscription_rebill_charges
     set status = p_status,
         payapp_state = coalesce(p_payapp_state, payapp_state),
         payapp_raw = coalesce(p_payapp_raw, payapp_raw),
         error_message = p_error,
         resolved_at = case
           when p_status in ('accepted','provider_accepted','provider_rejected','paid','failed','reconciled')
           then now() else resolved_at end
   where id = p_charge_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- (C) Cutover 상수 — 과거/미래 경계 고정. LEGACY_OVERDUE 격리 기준.
--     감사 완료(2026-08-06) 시점의 KST 자정. 이 시점 이전에 종료된 주기는
--     기존 장애 누락분(LEGACY)이며 자동 청구 대상에서 제외한다.
-- ----------------------------------------------------------------------------
create or replace function public.billing_rebill_cutover_ts()
returns timestamptz language sql immutable
as $$ select timestamptz '2026-08-06 00:00:00+09'; $$;

-- ----------------------------------------------------------------------------
-- (D) 분류 RPC v2 — chargeable 를 서버에서 확정. 개인정보(email/phone/nickname)
--     미반환. Edge Function 은 chargeable=true(FUTURE_DUE) 대상만 청구한다.
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_rebill_due_v2(
  p_cutover_ts timestamptz default public.billing_rebill_cutover_ts(),
  p_grace_days integer default 0)
returns table(
  subscription_id uuid, user_id uuid, plan_type text, plan_name text,
  amount integer, current_period_end timestamptz, cycle_period_end timestamptz,
  has_rebill_no boolean, auto_renew boolean, sub_status text,
  classification text, chargeable boolean, exclude_reason text,
  attempt_count integer, last_attempt_at timestamptz, last_attempt_status text)
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_now timestamptz := now();
  v_demo uuid[] := array[
    'de700001-0000-0000-0000-000000000001',
    'de700002-0000-0000-0000-000000000001',
    'de700002-0000-0000-0000-000000000002',
    'de700002-0000-0000-0000-000000000003'
  ]::uuid[];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  return query
  with pool as (
    select s.id, s.user_id, s.plan_type, s.status as sub_status, s.auto_renew,
           s.payapp_rebill_no, s.cancel_requested_at, s.current_period_end,
           coalesce(s.current_amount, s.price) as sub_amount,
           sp.price as plan_price, sp.name as plan_name,
           u.membership_tier
    from public.subscriptions s
    join public.users u on u.id = s.user_id
    left join public.subscription_plans sp on sp.plan_type = s.plan_type
    where s.status = 'active'
      and s.auto_renew = true
      and s.current_period_end is not null
      and s.current_period_end < (v_now - make_interval(days => greatest(coalesce(p_grace_days,0),0)))
  ),
  enriched as (
    select p.*,
      (select count(*)::int from public.subscription_rebill_charges c where c.subscription_id = p.id) as attempt_cnt,
      (select c.requested_at from public.subscription_rebill_charges c where c.subscription_id = p.id order by c.requested_at desc limit 1) as last_at,
      (select c.status from public.subscription_rebill_charges c where c.subscription_id = p.id order by c.requested_at desc limit 1) as last_status,
      exists(select 1 from public.subscription_rebill_charges c
             where c.subscription_id = p.id and c.cycle_period_end = p.current_period_end
               and c.status in ('attempted','requesting','accepted','provider_accepted','awaiting_webhook','paid')) as dup
    from pool p
  )
  select
    e.id, e.user_id, e.plan_type, e.plan_name,
    e.plan_price::int as amount,
    e.current_period_end, e.current_period_end as cycle_period_end,
    (e.payapp_rebill_no is not null and e.payapp_rebill_no <> '') as has_rebill_no,
    e.auto_renew, e.sub_status,
    v.classification, v.chargeable, v.reason as exclude_reason,
    e.attempt_cnt, e.last_at, e.last_status
  from enriched e
  cross join lateral (
    select
      case
        when e.user_id = any(v_demo)                                           then 'demo_account_excluded'
        when e.cancel_requested_at is not null                                 then 'cancel_requested'
        when e.payapp_rebill_no is null or e.payapp_rebill_no = ''             then 'missing_rebill_no'
        when e.membership_tier not in ('individual','business','artist_general','artist_student') then 'non_chargeable_tier'
        when e.plan_price is null                                              then 'unknown_plan'
        when e.sub_amount is distinct from e.plan_price                        then 'amount_mismatch'
        when e.dup                                                             then 'cycle_already_processed'
        when e.current_period_end < p_cutover_ts                               then 'legacy_overdue_requires_manual_policy'
        else 'due'
      end as reason,
      case
        when e.user_id = any(v_demo)
          or e.cancel_requested_at is not null
          or e.payapp_rebill_no is null or e.payapp_rebill_no = ''
          or e.membership_tier not in ('individual','business','artist_general','artist_student')
          or e.plan_price is null
          or e.sub_amount is distinct from e.plan_price                        then 'INVALID_REBILL'
        when e.dup                                                             then 'DUPLICATE_BLOCKED'
        when e.current_period_end < p_cutover_ts                               then 'LEGACY_OVERDUE'
        else 'FUTURE_DUE'
      end as classification,
      case
        when e.user_id = any(v_demo)
          or e.cancel_requested_at is not null
          or e.payapp_rebill_no is null or e.payapp_rebill_no = ''
          or e.membership_tier not in ('individual','business','artist_general','artist_student')
          or e.plan_price is null
          or e.sub_amount is distinct from e.plan_price
          or e.dup
          or e.current_period_end < p_cutover_ts                              then false
        else true
      end as chargeable
  ) v
  order by v.chargeable desc, e.current_period_end;
end;
$$;

-- ----------------------------------------------------------------------------
-- (E) 운영 모니터링 집계 — 개인정보 없음.
-- ----------------------------------------------------------------------------
create or replace function public.admin_rebill_ops_metrics()
returns jsonb language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object(
    'as_of', now(),
    'cutover_ts', public.billing_rebill_cutover_ts(),
    'due_future',    (select count(*) from public.admin_list_rebill_due_v2() where classification = 'FUTURE_DUE'),
    'due_legacy',    (select count(*) from public.admin_list_rebill_due_v2() where classification = 'LEGACY_OVERDUE'),
    'due_invalid',   (select count(*) from public.admin_list_rebill_due_v2() where classification = 'INVALID_REBILL'),
    'due_duplicate', (select count(*) from public.admin_list_rebill_due_v2() where classification = 'DUPLICATE_BLOCKED'),
    'attempts_today',      (select count(*) from public.subscription_rebill_charges where (requested_at at time zone 'Asia/Seoul')::date = v_today),
    'paid_today',          (select count(*) from public.subscription_rebill_charges where status = 'paid' and (resolved_at at time zone 'Asia/Seoul')::date = v_today),
    'charged_amount_today',(select coalesce(sum(amount),0) from public.subscription_rebill_charges where status = 'paid' and (resolved_at at time zone 'Asia/Seoul')::date = v_today),
    'by_status_today',     (select coalesce(jsonb_object_agg(status, n), '{}'::jsonb)
                              from (select status, count(*) n from public.subscription_rebill_charges
                                     where (requested_at at time zone 'Asia/Seoul')::date = v_today group by status) t),
    'last_charge_at', (select max(requested_at) from public.subscription_rebill_charges)
  ) into v;
  return v;
end;
$$;
