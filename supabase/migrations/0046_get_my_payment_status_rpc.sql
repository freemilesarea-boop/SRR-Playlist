-- ============================================
-- 0046_get_my_payment_status_rpc.sql
--
-- /payment/success 페이지가 order_no 기준으로 결제 적용 여부를 직접 조회.
--
-- 운영 증상:
--   결제는 정상 완료 (webhook state=64, payment_orders.status='paid',
--   users.membership_tier='individual') 인데 PaymentSuccessPage 가 계속
--   "결제 확인 중" 에 머무름.
--   원인: 기존 polling 이 useAuthStore.profile.membership_tier 만 보는데
--         refreshProfile() 의 RLS / 캐시 갱신 타이밍 때문에 새로 부여된
--         tier 가 frontend 에 반영 안 됨.
--
-- 수정:
--   get_my_payment_status(p_order_no text)
--     - 본인(auth.uid()=user_id) 또는 admin 만 조회 가능.
--     - payment_orders + users join 으로 정확한 적용 상태 반환.
--     - membership_applied: status='paid' AND membership_tier in
--       ('individual','business') AND tier == order.plan_type 일 때만 true.
--       → polling 종료의 단일 판정 기준이 됨.
-- ============================================

drop function if exists public.get_my_payment_status(text);

create or replace function public.get_my_payment_status(p_order_no text)
returns table(
  order_no text,
  status text,
  user_id uuid,
  plan_type text,
  amount integer,
  membership_tier text,
  subscription_type text,
  paid_at timestamptz,
  refunded_at timestamptz,
  membership_applied boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_is_admin boolean;
  v_caller uuid := auth.uid();
begin
  if p_order_no is null or length(trim(p_order_no)) = 0 then
    raise exception 'order_no required';
  end if;

  -- admin 또는 service_role 인 경우 user 검증 우회
  begin
    v_is_admin := public._internal_is_admin_caller();
  exception when undefined_function then
    v_is_admin := exists (
      select 1 from public.users as u
      where u.id = v_caller and u.role = 'admin'
    );
  end;

  return query
  select
    po.order_no,
    po.status,
    po.user_id,
    po.plan_type,
    po.amount,
    u.membership_tier,
    u.subscription_type,
    po.paid_at,
    po.refunded_at,
    (
      po.status = 'paid'
      and po.refunded_at is null
      and u.membership_tier in ('individual','business')
      and u.membership_tier = po.plan_type
    ) as membership_applied
  from public.payment_orders as po
  left join public.users as u on u.id = po.user_id
  where po.order_no = p_order_no
    and (v_is_admin or po.user_id = v_caller);
end;
$$;

grant execute on function public.get_my_payment_status(text) to authenticated;

-- 확인
select
  'rpc_exists=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_my_payment_status')
    then 'OK' else 'MISSING' end) as check_1;
