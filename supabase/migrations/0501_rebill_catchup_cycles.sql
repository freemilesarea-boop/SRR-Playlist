-- ============================================================================
-- 0501_rebill_catchup_cycles.sql
--
-- 목적: 청구가 누락된 구독의 **밀린 주기를 전부** 청구할 수 있도록 대상 회차를
--       확정하는 조회 RPC. (실제 청구는 별도 Edge Function + Kill Switch)
--
-- 배경:
--   기존 dispatch 는 "현재 1회차" 만 청구한다(admin_list_rebill_due_v2). 결제 성공
--   webhook 이 current_period_end 를 결제시각+1개월로 밀어버리므로, 재실행해도 밀린
--   과거 회차는 영원히 청구되지 않는다. 운영 판단으로 밀린 개월 수 전부를 소급 청구
--   하기로 해서, 회차를 명시적으로 전개하는 함수를 추가한다.
--
-- 회차 정의:
--   current_period_end 는 "마지막으로 결제된 주기의 종료일" 이며 동시에 다음 청구
--   예정일이다. 따라서 밀린 회차 키는
--     current_period_end + k months  (k = 0,1,2, ... , 그 값이 now() 미만인 동안)
--   이며, 이 값이 subscription_rebill_charges.cycle_period_end 로 그대로 쓰인다
--   (기존 멱등키 재사용 → 중복 청구 불가).
--
-- 안전 원칙:
--   • 조회 전용(stable). 이 함수 자체는 어떤 청구도 하지 않는다.
--   • 제외 규칙은 admin_list_rebill_due_v2 와 동일 집합 + 관리자 계정 제외.
--     (해지 요청 있음 / rebill_no 없음 / 무료 tier / 플랜가 불일치 / 데모 / 관리자)
--   • 이미 진행·성공 이력이 있는 (구독, 회차) 는 chargeable=false 로 표시.
--   • p_max_cycles 상한(기본 6, 최대 24)으로 데이터 이상 시 폭주 방지.
-- ============================================================================

create or replace function public.admin_list_catchup_cycles(
  p_subscription_ids uuid[] default null,
  p_max_cycles integer default 6
)
returns table(
  subscription_id uuid,
  user_id uuid,
  plan_type text,
  amount integer,
  current_period_end timestamptz,
  cycle_period_end timestamptz,
  cycle_index integer,
  cycles_owed integer,
  chargeable boolean,
  exclude_reason text
)
language plpgsql stable security definer set search_path to 'public'
as $$
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
        when p.sub_amount is distinct from p.plan_price             then 'amount_mismatch'
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
    m.id, m.user_id, m.plan_type, m.plan_price::int,
    m.period_end, m.cyc_end, (m.idx + 1)::int,
    (count(*) over (partition by m.id))::int,
    (m.excl is null and not m.dup),
    coalesce(m.excl, case when m.dup then 'cycle_already_processed' else 'due' end)
  from marked m
  order by m.id, m.idx;
end;
$$;

revoke execute on function public.admin_list_catchup_cycles(uuid[], integer) from public;
revoke execute on function public.admin_list_catchup_cycles(uuid[], integer) from anon;
grant execute on function public.admin_list_catchup_cycles(uuid[], integer) to authenticated, service_role;

-- ============================================================================
-- 운영 확인 쿼리 (실행 안 함 — 관리자/service_role 로 호출)
-- ============================================================================
-- select exclude_reason, count(*) 회차, count(distinct subscription_id) 구독,
--        sum(amount) filter (where chargeable) 청구예정액
-- from public.admin_list_catchup_cycles() group by 1 order by 2 desc;
