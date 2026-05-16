-- ============================================
-- backfill_115593182.sql
--
-- mul_no=115593182, order_no=swk_1317d7b2_mp85vzym_0b5yty 케이스 1회 백필.
--
-- 사전 조건: 0047_paid_event_order_matching.sql 운영 DB 적용 완료.
-- 실행 위치: Supabase SQL Editor (admin / postgres / service_role).
-- ============================================

-- 1) 사전 상태 확인
select 'BEFORE'::text as phase, po.order_no, po.status, po.user_id, po.payapp_mul_no,
       po.paid_at, po.refunded_at, u.membership_tier
from public.payment_orders po
left join public.users u on u.id = po.user_id
where po.order_no = 'swk_1317d7b2_mp85vzym_0b5yty';

-- 2) webhook event raw_payload 확인 (이 값 안에 var1=swk_... 가 있어야 함)
select id, payapp_mul_no, pay_state, price, approval_no, linkval_verified,
       matched_user_id, membership_updated, final_membership_tier,
       processing_error,
       raw_payload->>'var1' as var1,
       raw_payload->>'order_no' as order_no_key,
       raw_payload->>'recvemail' as recvemail,
       raw_payload->>'recvphone' as recvphone,
       jsonb_pretty(raw_payload) as raw_payload_pretty
from public.payapp_webhook_events
where payapp_mul_no = '115593182'
order by created_at desc;

-- 3) 백필 실행 (0047 RPC) — raw_payload 의 var1/swk_ 스캔으로 원 swk_ order 매칭.
select * from public.admin_backfill_paid_order_by_mul_no('115593182');

-- 4) 사후 상태 확인
select 'AFTER'::text as phase, po.order_no, po.status, po.user_id, po.payapp_mul_no,
       po.paid_at, po.refunded_at, po.approval_no, u.membership_tier
from public.payment_orders po
left join public.users u on u.id = po.user_id
where po.order_no = 'swk_1317d7b2_mp85vzym_0b5yty';

-- 5) get_my_payment_status 로 PaymentSuccessPage 와 동일한 판정
select * from public.get_my_payment_status('swk_1317d7b2_mp85vzym_0b5yty');
-- 기대:
--   status=paid
--   membership_tier=individual
--   membership_applied=true
