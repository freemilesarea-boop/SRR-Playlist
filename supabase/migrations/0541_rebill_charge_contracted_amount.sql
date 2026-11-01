-- 정기결제 청구 금액을 "플랜 정가" 가 아니라 "구독 계약가" 로 바꾼다.
--
-- 기존 가드는 sub_amount <> plan_price 면 전부 amount_mismatch 로 막았다. 그런데
-- 가맹점 이용료처럼 정가보다 싼 계약가가 실재한다 — 숙대점·분당미금역점 4,900,
-- 이루밍 일산후곡 5,900, 이승현 4,900. 이들은 결제가 막혀 연체로 쌓이고 있었다.
--
-- 바꾸는 것:
--   1) 청구 금액 = coalesce(current_amount, price)  (고객이 실제로 약정한 금액)
--   2) 차단은 "정가와 다름" 이 아니라 아래 둘로 좁힌다
--        invalid_amount    : 금액이 없거나 0 이하      → 청구 불가
--        amount_above_list : 계약가가 정가보다 비싸다  → 과청구 위험, 사람이 봐야 한다
--      정가보다 싼 것(계약 할인)은 정상으로 통과시킨다.
--
-- 적용 시점 기준으로 이미 청구 가능하던 건들은 sub_amount = plan_price 라 금액이
-- 그대로다. 이 변경으로 달라지는 건 계약가 구독 4건이 풀리는 것과, 정가 초과 1건이
-- 계속 막히는 것뿐이다.
--
-- 적용 기록: 원격에 rebill_charge_contracted_amount 로 적용 완료.

CREATE OR REPLACE FUNCTION public.admin_list_catchup_cycles(
  p_subscription_ids uuid[] DEFAULT NULL::uuid[],
  p_max_cycles integer DEFAULT 6
)
RETURNS TABLE(subscription_id uuid, user_id uuid, plan_type text, amount integer,
              current_period_end timestamp with time zone, cycle_period_end timestamp with time zone,
              cycle_index integer, cycles_owed integer, chargeable boolean, exclude_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_now timestamptz := now();
  v_max integer := least(greatest(coalesce(p_max_cycles, 6), 1), 24);
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
    select s.id, s.user_id, s.plan_type, s.payapp_rebill_no, s.cancel_requested_at,
           s.current_period_end as period_end,
           coalesce(s.current_amount, s.price) as sub_amount,
           sp.price as plan_price, u.role, u.membership_tier
    from public.subscriptions s
    join public.users u on u.id = s.user_id
    left join public.subscription_plans sp on sp.plan_type = s.plan_type
    where s.status = 'active'
      and s.auto_renew = true
      and s.current_period_end is not null
      and s.current_period_end < v_now
      and (p_subscription_ids is null or s.id = any(p_subscription_ids))
  ),
  judged as (
    select p.*,
      case
        when p.user_id = any(v_demo)                                then 'demo_account_excluded'
        when p.role = 'admin'                                       then 'admin_account'
        when p.cancel_requested_at is not null                      then 'cancel_requested'
        when p.payapp_rebill_no is null or p.payapp_rebill_no = ''  then 'missing_rebill_no'
        when p.membership_tier not in ('individual','business')     then 'non_chargeable_tier'
        when p.plan_price is null                                   then 'unknown_plan'
        when p.sub_amount is null or p.sub_amount <= 0              then 'invalid_amount'
        -- 계약가가 정가보다 비싸면 과청구 위험이라 사람이 확인해야 한다.
        -- (정가보다 싼 계약 할인 — 가맹 이용료 등 — 은 정상 통과시킨다.)
        when p.sub_amount > p.plan_price                            then 'amount_above_list'
        else null
      end as excl
    from pool p
  ),
  expanded as (
    select j.*, k.k as idx,
           (j.period_end + make_interval(months => k.k)) as cyc_end
    from judged j
    cross join lateral generate_series(0, v_max - 1) as k(k)
    where j.period_end + make_interval(months => k.k) < v_now
  ),
  marked as (
    select e.*,
      exists (
        select 1 from public.subscription_rebill_charges c
        where c.subscription_id = e.id
          and c.cycle_period_end = e.cyc_end
          and c.status in ('attempted','requesting','accepted','provider_accepted','awaiting_webhook','paid')
      ) as dup
    from expanded e
  )
  select
    m.id, m.user_id, m.plan_type, m.sub_amount::int,
    m.period_end, m.cyc_end, (m.idx + 1)::int,
    (count(*) over (partition by m.id))::int,
    (m.excl is null and not m.dup),
    coalesce(m.excl, case when m.dup then 'cycle_already_processed' else 'due' end)
  from marked m
  order by m.id, m.idx;
end;
$function$;

-- 일반(소급 아닌) 디스패처도 같은 가드를 쓴다. 여기를 안 고치면 계약가 구독은
-- 다음 달에 또 조용히 막힌다.
CREATE OR REPLACE FUNCTION public.admin_list_rebill_due_v2(
  p_cutover_ts timestamp with time zone DEFAULT billing_rebill_cutover_ts(),
  p_grace_days integer DEFAULT 0
)
RETURNS TABLE(subscription_id uuid, user_id uuid, plan_type text, plan_name text, amount integer,
              current_period_end timestamp with time zone, cycle_period_end timestamp with time zone,
              has_rebill_no boolean, auto_renew boolean, sub_status text, classification text,
              chargeable boolean, exclude_reason text, attempt_count integer,
              last_attempt_at timestamp with time zone, last_attempt_status text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    e.sub_amount::int as amount,
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
        when e.sub_amount is null or e.sub_amount <= 0                         then 'invalid_amount'
        when e.sub_amount > e.plan_price                                       then 'amount_above_list'
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
          or e.sub_amount is null or e.sub_amount <= 0
          or e.sub_amount > e.plan_price                                       then 'INVALID_REBILL'
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
          or e.sub_amount is null or e.sub_amount <= 0
          or e.sub_amount > e.plan_price
          or e.dup
          or e.current_period_end < p_cutover_ts                              then false
        else true
      end as chargeable
  ) v
  order by v.chargeable desc, e.current_period_end;
end;
$function$;
