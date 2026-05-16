-- ============================================
-- diagnostic_member_tier.sql
--
-- 특정 이메일 계정의 membership_tier 정합성 검증.
-- Supabase SQL Editor 에서 admin / postgres 권한으로 실행.
--
-- 사용법:
--   1) 아래 :target_email 자리에 검증할 이메일 넣고 실행.
--   2) 또는 ':target_email' 그대로 두고 psql -v target_email=... 으로 호출.
-- ============================================

-- swk.midea@gmail.com 계정 정합성 진단
with target as (select 'swk.midea@gmail.com'::text as email)
select
  au.email,
  u.id as user_id,
  u.nickname,
  u.membership_tier as "tier (단일 진실 원천)",
  u.subscription_type as "subscription_type (호환)",
  case
    when u.membership_tier = 'individual' then '✓ 일반 활성'
    when u.membership_tier = 'business'   then '✓ 사업자 활성'
    when u.membership_tier = 'free'       then '· 무료'
    else '? unknown'
  end as "표시"
from auth.users au
join public.users u on u.id = au.id
where au.email = (select email from target);

-- 최근 결제/구독 이력
with target as (select 'swk.midea@gmail.com'::text as email)
select
  po.order_no,
  po.status,
  po.plan_type,
  po.amount,
  po.payapp_state,
  po.paid_at,
  po.refunded_at,
  po.canceled_at,
  po.payapp_mul_no
from public.payment_orders po
join auth.users au on au.id = po.user_id
where au.email = (select email from target)
order by po.created_at desc
limit 10;

-- 최근 PayApp webhook 이벤트 (해당 user)
with target as (select 'swk.midea@gmail.com'::text as email)
select
  ev.created_at,
  ev.payapp_mul_no,
  ev.pay_state,
  ev.state_label,
  ev.price,
  ev.approval_no,
  ev.linkval_verified,
  ev.membership_updated,
  ev.final_membership_tier,
  ev.processing_error
from public.payapp_webhook_events ev
join auth.users au on au.id = ev.matched_user_id
where au.email = (select email from target)
order by ev.created_at desc
limit 20;
