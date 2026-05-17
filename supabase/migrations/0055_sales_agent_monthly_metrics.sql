-- ============================================
-- 0055_sales_agent_monthly_metrics.sql
--
-- 영업인 정산 지표 분리:
--   - 누적 정산액 (기존 estimated_commission 유지) +
--     total_commission_amount 별칭으로도 노출
--   - 월 정산액: KST(Asia/Seoul) 기준 이번 달 1일 00:00 ~ 다음 달 1일 00:00 (미만)
--     · monthly_paid_amount    : 이번 달 결제 완료 합계
--     · monthly_commission_amount : floor(monthly_paid_amount * commission_rate / 100)
--     · monthly_paid_count     : 이번 달 결제 완료 건수
--
-- 결제 완료 기준은 0054 와 동일 (payment_orders.status = 'paid').
-- 기준 시각도 0054 와 동일하게 coalesce(po.paid_at, po.created_at) 사용.
-- admin_sales_agent_list / admin_sales_agent_detail 두 RPC 모두 갱신.
-- ============================================

-- RETURNS TABLE 컬럼이 늘어났으므로 기존 함수를 먼저 제거
drop function if exists public.admin_sales_agent_list();

create or replace function public.admin_sales_agent_list()
returns table(
  id uuid,
  user_id uuid,
  name text,
  email text,
  phone text,
  code text,
  commission_rate numeric,
  is_active boolean,
  linked_business_count bigint,
  paid_business_count bigint,
  total_paid_amount bigint,
  total_commission_amount bigint,
  estimated_commission bigint,
  monthly_paid_amount bigint,
  monthly_commission_amount bigint,
  monthly_paid_count bigint,
  created_at timestamptz,
  updated_at timestamptz,
  last_activity_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_start timestamptz;
  v_month_end timestamptz;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  v_month_start := (date_trunc('month', (now() at time zone 'Asia/Seoul'))) at time zone 'Asia/Seoul';
  v_month_end := v_month_start + interval '1 month';

  return query
  with linked as (
    select u.sales_agent_id as agent_id, count(*)::bigint as cnt
    from public.users as u
    where u.sales_agent_id is not null
    group by u.sales_agent_id
  ),
  paid_summary as (
    select po.sales_agent_id as agent_id,
           count(distinct po.user_id)::bigint as paid_count,
           coalesce(sum(po.amount), 0)::bigint as total_amount,
           max(coalesce(po.paid_at, po.created_at)) as last_paid
    from public.payment_orders as po
    where po.status = 'paid' and po.sales_agent_id is not null
    group by po.sales_agent_id
  ),
  monthly_summary as (
    select po.sales_agent_id as agent_id,
           coalesce(sum(po.amount), 0)::bigint as month_amount,
           count(*)::bigint as month_count
    from public.payment_orders as po
    where po.status = 'paid'
      and po.sales_agent_id is not null
      and coalesce(po.paid_at, po.created_at) >= v_month_start
      and coalesce(po.paid_at, po.created_at) <  v_month_end
    group by po.sales_agent_id
  )
  select
    sa.id,
    sa.user_id,
    sa.name,
    sa.email,
    sa.phone,
    sa.code,
    sa.commission_rate,
    sa.is_active,
    coalesce(l.cnt, 0)::bigint as linked_business_count,
    coalesce(p.paid_count, 0)::bigint as paid_business_count,
    coalesce(p.total_amount, 0)::bigint as total_paid_amount,
    floor(coalesce(p.total_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as total_commission_amount,
    floor(coalesce(p.total_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as estimated_commission,
    coalesce(m.month_amount, 0)::bigint as monthly_paid_amount,
    floor(coalesce(m.month_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as monthly_commission_amount,
    coalesce(m.month_count, 0)::bigint as monthly_paid_count,
    sa.created_at,
    sa.updated_at,
    p.last_paid as last_activity_at
  from public.sales_agents as sa
  left join linked as l on l.agent_id = sa.id
  left join paid_summary as p on p.agent_id = sa.id
  left join monthly_summary as m on m.agent_id = sa.id
  order by sa.created_at desc;
end;
$$;

grant execute on function public.admin_sales_agent_list() to authenticated;

-- ----------------------
-- admin_sales_agent_detail — summary 에 월 지표 추가
-- ----------------------
create or replace function public.admin_sales_agent_detail(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_commission_rate numeric;
  v_total_amount bigint;
  v_month_amount bigint;
  v_month_count bigint;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;

  v_month_start := (date_trunc('month', (now() at time zone 'Asia/Seoul'))) at time zone 'Asia/Seoul';
  v_month_end := v_month_start + interval '1 month';

  select coalesce(commission_rate, 0) into v_commission_rate
  from public.sales_agents where id = p_id;

  select coalesce(sum(amount), 0)::bigint into v_total_amount
  from public.payment_orders
  where sales_agent_id = p_id and status = 'paid';

  select coalesce(sum(amount), 0)::bigint, count(*)::bigint
    into v_month_amount, v_month_count
  from public.payment_orders
  where sales_agent_id = p_id
    and status = 'paid'
    and coalesce(paid_at, created_at) >= v_month_start
    and coalesce(paid_at, created_at) <  v_month_end;

  select jsonb_build_object(
    'agent', jsonb_build_object(
      'id', sa.id,
      'user_id', sa.user_id,
      'name', sa.name,
      'email', sa.email,
      'phone', sa.phone,
      'code', sa.code,
      'commission_rate', sa.commission_rate,
      'is_active', sa.is_active,
      'note', sa.note,
      'created_at', sa.created_at,
      'updated_at', sa.updated_at
    ),
    'businesses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id,
        'email', au.email,
        'nickname', u.nickname,
        'full_name', u.full_name,
        'phone', u.phone,
        'account_type', u.account_type,
        'membership_tier', u.membership_tier,
        'subscription_type', u.subscription_type,
        'business_number', bvp.business_number,
        'store_name', bvp.store_name,
        'created_at', u.created_at
      ) order by u.created_at desc), '[]'::jsonb)
      from public.users as u
      left join auth.users as au on au.id = u.id
      left join public.business_verification_profiles as bvp on bvp.user_id = u.id
      where u.sales_agent_id = p_id
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', po.id,
        'user_id', po.user_id,
        'order_no', po.order_no,
        'plan_type', po.plan_type,
        'amount', po.amount,
        'status', po.status,
        'paid_at', po.paid_at,
        'created_at', po.created_at
      ) order by coalesce(po.paid_at, po.created_at) desc), '[]'::jsonb)
      from public.payment_orders as po
      where po.sales_agent_id = p_id
    ),
    'summary', jsonb_build_object(
      'linked_business_count', (
        select count(*) from public.users where sales_agent_id = p_id
      ),
      'paid_business_count', (
        select count(distinct user_id) from public.payment_orders
        where sales_agent_id = p_id and status = 'paid'
      ),
      'total_paid_amount', v_total_amount,
      'total_commission_amount', floor(v_total_amount * v_commission_rate / 100.0)::bigint,
      'estimated_commission', floor(v_total_amount * v_commission_rate / 100.0)::bigint,
      'monthly_paid_amount', v_month_amount,
      'monthly_commission_amount', floor(v_month_amount * v_commission_rate / 100.0)::bigint,
      'monthly_paid_count', v_month_count,
      'month_window_start', v_month_start,
      'month_window_end', v_month_end
    )
  )
  into v_result
  from public.sales_agents as sa
  where sa.id = p_id;

  return v_result;
end;
$$;

grant execute on function public.admin_sales_agent_detail(uuid) to authenticated;
