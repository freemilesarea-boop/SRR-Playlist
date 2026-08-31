-- ============================================================================
-- 0483_paid_at_timezone_normalize.sql
-- payment_orders.paid_at 타임존 정규화 — KST 문자열을 UTC 로 읽어 생긴 9시간 편차 제거.
--
-- 배경:
--   PayApp raw_payload.pay_date 는 TZ 표기가 없는 KST 문자열이다("2026-08-31 10:10:13").
--   0481 은 이를 (pay_date)::timestamptz 로 캐스팅했는데, 세션 타임존이 UTC 라
--   같은 벽시계 값을 UTC 로 해석해 실제보다 9시간 뒤로 기록됐다.
--   0482 (B)/(E) 는 이후 유입/월불일치 건을 '+09' 명시 파싱으로 바로잡았지만,
--   "월은 맞고 시각만 어긋난" 과거 행 155건이 그대로 남아 있다.
--
-- 실측(적용 전):
--   · pay_date 대비 60초 초과 편차: 155건 / 검사 대상 201건
--   · 그 중 정확히 9시간 편차: 155건 (전량)
--   · KST 기준 '월' 불일치: 0건   → 정산월/월매출 영향 없음
--   · KST 기준 '일' 불일치: 35건  → 일별 매출·리포트가 하루씩 어긋남
--
-- 조치: 각 주문의 payapp_mul_no 에 대응하는 완료 웹훅 pay_date 를 '+09' 로 명시
--   해석해 paid_at 을 정확한 시각으로 맞춘다.
--
-- 안전:
--   · status 무변경(paid 유지) → block_paid_downgrade 통과.
--   · 월 불일치가 0 이므로 settlement_period_month 재계산 결과가 동일 → 기존 정산 불변.
--   · 커밋션 트리거는 status 전이(AFTER UPDATE WHEN old.status <> 'paid')에서만 발동 →
--     paid→paid UPDATE 이므로 커밋션 신규 생성/변경 없음.
--   · 멱등: 재실행 시 편차 60초 초과 건이 없으면 무동작.
-- ============================================================================

with corr as (
  select o.id,
         (nullif(btrim(e.raw_payload->>'pay_date'), '') || '+09')::timestamptz as correct_paid_at
  from public.payment_orders o
  join lateral (
    select e2.raw_payload
    from public.payapp_webhook_events e2
    where e2.payapp_mul_no = o.payapp_mul_no
      and e2.pay_state in (4, 64)
      and nullif(btrim(e2.raw_payload->>'pay_date'), '') is not null
    order by e2.created_at desc
    limit 1
  ) e on true
  where o.status = 'paid'
    and o.payapp_mul_no is not null
    and o.paid_at is not null
    and abs(extract(epoch from (
          o.paid_at - (nullif(btrim(e.raw_payload->>'pay_date'), '') || '+09')::timestamptz
        ))) > 60
)
update public.payment_orders o
   set paid_at = corr.correct_paid_at,
       paid_at_source = 'webhook_pay_date_kst'
  from corr
 where o.id = corr.id;
