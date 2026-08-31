-- ============================================================================
-- 0478_billing_drift_july_backfill_and_view_hardening.sql
-- 7월 결제기록 누락(드리프트) 교정 + 드리프트 뷰 오탐 방지 하드닝.
--
-- 배경(진단):
--   drift 알림(0475)이 pay_state=4 완료 웹훅 16건을 "payment_orders 미기록"으로 보고.
--   실검증 결과:
--     · 결제 자체는 전부 정상 수금(pay_state=4 + linkval_verified + pay_date 존재).
--     · 드리프트는 backfill(0472)과 안전망 트리거(0473) 배포 사이 틈(2026-07-22~07-25)에
--       낀 과거 기록 갭. 그 전(≤7/20)·그 후(7/28~) 모든 결제는 이미 정상 기록됨(안전망 정상).
--   16건 세부:
--     · 14건 = 진짜 미기록(해당 유저의 7월 payment_order 0건). → 백필 대상.
--     · 2건(35480a6c…, c15240a1…) = 이미 7월에 정상 기록됨. 앱측 체크아웃(swk_) order 가
--       PayApp 완료 웹훅과 mul_no 만 다르게 부여되어 mul_no 키 뷰가 오탐. → 백필 금지(이중기록).
--
-- 조치:
--   (1) 14건 백필 — 안전망 트리거(_tg_payapp_ensure_payment_order)와 동일 규약으로 기록.
--       멱등·이중기록 방지: mul_no 미기록 AND 같은 유저·같은 결제월 paid order 없음일 때만.
--       이 이중 가드로 재실행 안전 + 오탐 2건은 자동 제외.
--   (2) v_billing_recording_drift 하드닝 — "같은 유저·같은 결제월에 이미 paid order 존재"면
--       기록된 것으로 보고 제외. mul_no 불일치로 인한 미래 오탐까지 예방.
--       (월정액 구독 기준 월 단위 판정 — 같은 달 재기록 오탐만 차단, 진짜 미기록은 그대로 검출.)
--
-- 안전성: 백필은 이미 수금된 결제의 '기록'만 생성(신규 청구/환불 없음). 뷰는 검출 로직만 강화.
--   롤백 트랜잭션 검증 완료: 백필 정확히 14건(68,600원, 전부 2026-07 individual),
--   뷰 적용 후 드리프트 0, 뷰만 적용 시 genuine 14 보존·오탐 2 제거.
-- ============================================================================

-- (1) 7월 누락 14건 백필 (멱등 + 이중기록 방지)
INSERT INTO public.payment_orders
  (id, user_id, subscription_id, order_no, plan_type, amount, status,
   payapp_mul_no, payapp_rebill_no, payapp_state, payapp_state_label,
   paid_at, paid_at_source, created_at, discount_amount)
SELECT gen_random_uuid(), coalesce(e.matched_user_id, e.user_id), sub.id,
   'wh_' || e.payapp_mul_no,
   coalesce(sub.plan_type, case when e.price = 6900 then 'business' else 'individual' end),
   e.price, 'paid', e.payapp_mul_no, e.payapp_rebill_no, 4, '결제완료(백필0478)',
   coalesce((e.raw_payload->>'pay_date')::timestamptz, e.created_at), 'backfill_0478',
   e.created_at, 0
FROM public.payapp_webhook_events e
LEFT JOIN LATERAL (
   SELECT s.id, s.plan_type FROM public.subscriptions s
   WHERE s.user_id = coalesce(e.matched_user_id, e.user_id)
   ORDER BY (s.payapp_rebill_no IS NOT DISTINCT FROM e.payapp_rebill_no) DESC, s.created_at DESC
   LIMIT 1
) sub ON true
WHERE e.pay_state = 4 AND e.linkval_verified IS TRUE AND e.payapp_mul_no IS NOT NULL
  AND coalesce(e.price, 0) > 0
  AND coalesce(e.matched_user_id, e.user_id) IS NOT NULL
  -- mul_no 로 미기록
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_orders o WHERE o.payapp_mul_no = e.payapp_mul_no
  )
  -- 같은 유저·같은 결제월에 이미 paid order 없음 (오탐 2건 제외 + 이중기록 방지)
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_orders o2
    WHERE o2.user_id = coalesce(e.matched_user_id, e.user_id) AND o2.status = 'paid'
      AND date_trunc('month', o2.paid_at)
          = date_trunc('month', coalesce((e.raw_payload->>'pay_date')::timestamptz, e.created_at))
  )
ON CONFLICT (payapp_mul_no) WHERE payapp_mul_no IS NOT NULL DO NOTHING;

-- (2) 드리프트 뷰 하드닝 — 같은 유저·같은 결제월 paid order 존재 시 오탐 제외
CREATE OR REPLACE VIEW public.v_billing_recording_drift AS
SELECT e.id AS webhook_id,
       e.user_id,
       e.matched_user_id,
       e.payapp_mul_no,
       e.payapp_rebill_no,
       e.price,
       e.linkval_verified,
       e.raw_payload ->> 'pay_date' AS pay_date,
       e.created_at
FROM public.payapp_webhook_events e
WHERE e.pay_state = 4
  AND e.payapp_mul_no IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_orders o WHERE o.payapp_mul_no = e.payapp_mul_no
  )
  AND NOT EXISTS (
    SELECT 1 FROM public.payment_orders o2
    WHERE o2.user_id = COALESCE(e.matched_user_id, e.user_id)
      AND o2.status = 'paid'
      AND date_trunc('month', o2.paid_at)
          = date_trunc('month', COALESCE((e.raw_payload ->> 'pay_date')::timestamptz, e.created_at))
  );
