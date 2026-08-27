-- ============================================================================
-- 0481_fix_payment_paid_at_misdating.sql
-- payment_orders.paid_at 오기재(월 단위) 교정 — 월별 매출 정확화.
--
-- 문제: 대시보드 "이번 달 매출"이 8월 ₩39,200(8건)로 비정상 낮게 표시.
--   실검증: 8월 pay_state=4 웹훅은 56건(실제 8월 수금)인데, 그 결제들의 payment_orders
--   paid_at 이 5~7월로 잘못 기록됨. 과거 백필(0472, source webhook_backfill)이 mul_no 와
--   paid_at 을 교차 배선한 데이터 손상 + 일부 app-side('unknown') 주문. 총 62건이
--   "주문 paid_at 월 ≠ 같은 mul_no 웹훅 pay_date 월"로 불일치.
--
-- 권위 원천: 각 payment_orders.payapp_mul_no 는 PayApp 거래번호(유니크). 그 mul_no 의
--   pay_state=4 웹훅 pay_date 가 그 거래의 실제 결제일이다. 따라서 order.paid_at 을
--   해당 웹훅 pay_date 로 교정한다(월 단위 불일치 건만).
--
-- 안전:
--   · status 무변경(paid 유지) → block_paid_downgrade 통과.
--   · settlement_period_month 트리거가 UPDATE 에도 발동 → 정산월 자동 재계산(일관).
--   · 커밋션 트리거는 멱등(unique_violation skip, 2회차만) → 중복 커밋션 없음.
--   · 멱등: 재실행 시 불일치 0건이면 무동작.
--   · 검증(롤백): 8월 ₩39,200(8)→₩274,400(56), 총합 불변(954,600), 월별 정정 분배.
--
-- 참고(별도 사안): 과거 월(5~7월)로 잘못 귀속됐던 매출이 실제 월로 이동하므로, 이미
--   생성된 과거 정산의 월별 근거가 달라질 수 있다. 이 마이그레이션은 '원장(payment_orders)'
--   만 교정하며 기존 정산 지급을 변경하지 않는다(필요 시 settlement_adjustments 로 별도 조정).
-- ============================================================================

with corr as (
  select o.id, (e.raw_payload->>'pay_date')::timestamptz as correct_paid_at
  from public.payment_orders o
  join lateral (
    select e2.raw_payload
    from public.payapp_webhook_events e2
    where e2.payapp_mul_no = o.payapp_mul_no and e2.pay_state = 4
    order by e2.created_at desc
    limit 1
  ) e on true
  where o.status = 'paid'
    and o.payapp_mul_no is not null
    and date_trunc('month', o.paid_at)
        <> date_trunc('month', (e.raw_payload->>'pay_date')::timestamptz)
)
update public.payment_orders o
   set paid_at = corr.correct_paid_at
  from corr
 where o.id = corr.id;
