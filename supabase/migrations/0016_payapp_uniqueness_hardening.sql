-- ============================================
-- 0016_payapp_uniqueness_hardening.sql
--
-- PayApp 결제 데이터 중복 방지 보강.
--   1) payment_orders.payapp_mul_no partial unique index
--      → 같은 mul_no 가 서로 다른 order_no 로 두 번 저장되는 케이스 차단
--   2) payapp_webhook_events 의 raw_payload._verification 키 인덱스 (관측용)
--
-- 멱등 (IF NOT EXISTS).
-- ============================================

-- 1) payment_orders 의 mul_no 가 채워졌을 때만 unique
--    pay_state=1 / pay_state=4 첫결제 등 payapp_mul_no 가 NULL 인 단계에서는 제약 없음.
create unique index if not exists uniq_payment_orders_mul_no
  on public.payment_orders(payapp_mul_no)
  where payapp_mul_no is not null;

-- 2) payapp_webhook_events 의 _verification.reasons 길이 인덱스 (실패 webhook 조회 가속)
--    GIN(jsonb_path_ops) 대안: text 캐스팅 인덱스로 단순 조회만 빠르게.
create index if not exists idx_webhook_verification_failed
  on public.payapp_webhook_events(created_at desc)
  where linkval_verified = false;

-- 확인
select
  (select count(*) from public.payment_orders where payapp_mul_no is not null) as mul_no_rows,
  (select count(*) from public.payapp_webhook_events) as webhooks,
  (select count(*) from public.payapp_webhook_events where linkval_verified = false) as failed_webhooks;
