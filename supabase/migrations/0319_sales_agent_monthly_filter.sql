-- 0319 — 영업인 통계 RPC 에 월 선택 파라미터 추가 (X6.30)
--
-- 변경:
--   admin_sales_agent_list / admin_sales_agent_detail 에
--   p_month date default null 추가.
--     - null  → 현재 KST 월 (back-compat: 기존 호출자 영향 없음)
--     - date  → 해당 월의 KST 1일 00:00 ~ 다음달 1일 00:00 범위로 집계
--
--   list 반환에 month_window_start/end 추가 (UI 가 어느 월을 본 결과인지 표기)
--   payment_id 기준 DISTINCT 보강 (중복 결제건 방지 — 안전망)
--
-- 보존:
--   누적 (total_*) 컬럼은 항상 전체 기간 합계 — p_month 와 무관.
--   월별 (monthly_*) 컬럼만 p_month 영향.
--
-- 정책 (수수료 산정):
--   monthly_commission_amount = FLOOR(monthly_paid_amount * commission_rate / 100)
--   이번 달 정산액은 항상 "그 월의 실제 결제 완료" 기준.
--   환불(status='refunded')/취소(status='canceled')/대기/요청 모두 제외.

drop function if exists public.admin_sales_agent_list();
drop function if exists public.admin_sales_agent_list(date);

create or replace function public.admin_sales_agent_list(p_month date default null)
returns table(
  id uuid, user_id uuid, name text, email text, phone text, code text,
  commission_rate numeric, is_active boolean,
  linked_business_count bigint, paid_business_count bigint,
  total_paid_amount bigint, total_commission_amount bigint, estimated_commission bigint,
  monthly_paid_amount bigint, monthly_commission_amount bigint, monthly_paid_count bigint,
  created_at timestamptz, updated_at timestamptz, last_activity_at timestamptz,
  month_window_start timestamptz, month_window_end timestamptz
)
language plpgsql security definer set search_path = public as $$
declare v_month_start timestamptz; v_month_end timestamptz; v_base date;
begin
  if not public.can_manage_sales() then
    raise exception '영업 매출 조회는 super_admin/sales_admin 만 가능합니다' using errcode='42501';
  end if;

  v_base := coalesce(
    date_trunc('month', p_month)::date,
    (date_trunc('month', (now() at time zone 'Asia/Seoul')))::date
  );
  v_month_start := (v_base::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((v_base + interval '1 month')::timestamp at time zone 'Asia/Seoul');

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
    -- X6.30: payment_id 기준 DISTINCT 처리 (안전망)
    select po.sales_agent_id as agent_id,
           coalesce(sum(po.amount), 0)::bigint as month_amount,
           count(distinct po.id)::bigint as month_count
    from public.payment_orders as po
    where po.status = 'paid'
      and po.sales_agent_id is not null
      and coalesce(po.paid_at, po.created_at) >= v_month_start
      and coalesce(po.paid_at, po.created_at) <  v_month_end
    group by po.sales_agent_id
  )
  select sa.id, sa.user_id, sa.name, sa.email, sa.phone, sa.code, sa.commission_rate, sa.is_active,
    coalesce(l.cnt, 0)::bigint, coalesce(p.paid_count, 0)::bigint, coalesce(p.total_amount, 0)::bigint,
    floor(coalesce(p.total_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as total_commission_amount,
    floor(coalesce(p.total_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as estimated_commission,
    coalesce(m.month_amount, 0)::bigint as monthly_paid_amount,
    floor(coalesce(m.month_amount, 0) * coalesce(sa.commission_rate, 0) / 100.0)::bigint as monthly_commission_amount,
    coalesce(m.month_count, 0)::bigint as monthly_paid_count,
    sa.created_at, sa.updated_at, p.last_paid,
    v_month_start, v_month_end
  from public.sales_agents as sa
  left join linked as l on l.agent_id = sa.id
  left join paid_summary as p on p.agent_id = sa.id
  left join monthly_summary as m on m.agent_id = sa.id
  order by sa.created_at desc;
end; $$;

-- detail 도 p_month 추가
drop function if exists public.admin_sales_agent_detail(uuid);
drop function if exists public.admin_sales_agent_detail(uuid, date);

create or replace function public.admin_sales_agent_detail(p_id uuid, p_month date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_result jsonb; v_base date;
  v_month_start timestamptz; v_month_end timestamptz;
  v_commission_rate numeric;
  v_total_amount bigint; v_month_amount bigint; v_month_count bigint;
begin
  if not public.can_manage_sales() then
    raise exception '영업 매출 조회는 super_admin/sales_admin 만 가능합니다' using errcode='42501';
  end if;

  v_base := coalesce(
    date_trunc('month', p_month)::date,
    (date_trunc('month', (now() at time zone 'Asia/Seoul')))::date
  );
  v_month_start := (v_base::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((v_base + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  select coalesce(commission_rate, 0) into v_commission_rate
  from public.sales_agents where id = p_id;

  select coalesce(sum(amount), 0)::bigint into v_total_amount
  from public.payment_orders
  where sales_agent_id = p_id and status = 'paid';

  -- X6.30: payment_id 기준 DISTINCT
  select coalesce(sum(amount), 0)::bigint, count(distinct id)::bigint
    into v_month_amount, v_month_count
  from public.payment_orders
  where sales_agent_id = p_id
    and status = 'paid'
    and coalesce(paid_at, created_at) >= v_month_start
    and coalesce(paid_at, created_at) <  v_month_end;

  select jsonb_build_object(
    'agent', jsonb_build_object(
      'id', sa.id, 'user_id', sa.user_id, 'name', sa.name, 'email', sa.email,
      'phone', sa.phone, 'code', sa.code, 'commission_rate', sa.commission_rate,
      'is_active', sa.is_active, 'note', sa.note,
      'created_at', sa.created_at, 'updated_at', sa.updated_at
    ),
    'businesses', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'user_id', u.id, 'email', au.email, 'nickname', u.nickname,
        'full_name', u.full_name, 'phone', u.phone, 'account_type', u.account_type,
        'membership_tier', u.membership_tier, 'subscription_type', u.subscription_type,
        'business_number', bvp.business_number, 'store_name', bvp.store_name,
        'created_at', u.created_at
      ) order by u.created_at desc), '[]'::jsonb)
      from public.users as u
      left join auth.users as au on au.id = u.id
      left join public.business_verification_profiles as bvp on bvp.user_id = u.id
      where u.sales_agent_id = p_id
    ),
    'payments', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', po.id, 'user_id', po.user_id, 'order_no', po.order_no,
        'plan_type', po.plan_type, 'amount', po.amount, 'status', po.status,
        'paid_at', po.paid_at, 'created_at', po.created_at
      ) order by coalesce(po.paid_at, po.created_at) desc), '[]'::jsonb)
      from public.payment_orders as po where po.sales_agent_id = p_id
    ),
    'summary', jsonb_build_object(
      'linked_business_count', (select count(*) from public.users where sales_agent_id = p_id),
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
      'month_window_end', v_month_end,
      'month_base', v_base
    )
  )
  into v_result from public.sales_agents as sa where sa.id = p_id;

  return v_result;
end; $$;
