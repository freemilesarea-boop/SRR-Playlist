-- ============================================================================
-- 0472_backfill_recurring_payment_orders.sql
-- 정기결제 재청구 사이클(payment_orders 미기록분)을 PayApp 웹훅 원장 기준으로 백필.
--
-- 배경(원장 대조 결과):
--   PayApp 재청구는 매달 정상 청구되고 있으나(state=4 승인완료 결제, pay_date+
--   payauthcode+mul_no 보유), 재청구 dispatcher가 꺼져 있어 사이클별 'requested'
--   주문이 선생성되지 않았다. 그 결과 state=4 실결제 웹훅이 매칭할 주문을 찾지
--   못해 payment_orders에 paid 행이 누락됐다(실제 180건 중 96건만 기록 → 84건 누락).
--   진실의 원장은 payapp_webhook_events(raw_payload)이며, 이 마이그레이션은 누락된
--   84건을 payment_orders에 paid로 복원해 매출/정산 리포팅을 실제와 일치시킨다.
--
-- 안전/멱등:
--   · payapp_mul_no 부분 유니크(uniq_payment_orders_mul_no) → ON CONFLICT DO NOTHING.
--     재실행 안전. order_no='bf_'||mul_no 로 백필 행 식별/롤백 가능.
--   · payment_orders엔 멤버십/구독을 바꾸는 AFTER-INSERT 트리거가 없음(raw INSERT).
--     따라서 멤버십·구독·접근권한은 일절 변경되지 않는다. 고객 카드 청구 없음.
--   · 실제 결제(state=4)만 대상. 취소/환불(state=64 등) 미포함.
--
-- 의도된 부수효과(운영자 승인됨):
--   · BEFORE INSERT _sales_agent_copy_on_insert → 재청구분도 영업수당 추정에 포함(결정 D1).
--   · BEFORE INSERT _set_payment_settlement_period_month → paid_at 기준 KST 정산월 세팅
--     → 5·6·7월 아티스트 정산 풀에 반영(결정 D2; 정산 재생성은 별도 단계).
-- ============================================================================

do $$
declare v_before int; v_after int; v_inserted int;
begin
  select count(*) into v_before from public.payment_orders where status='paid';

  insert into public.payment_orders
    (id, user_id, subscription_id, order_no, plan_type, amount, status,
     payapp_mul_no, payapp_rebill_no, payapp_state, payapp_state_label,
     paid_at, paid_at_source, created_at, discount_amount)
  select
    gen_random_uuid(),
    w.user_id,
    s.id,
    'bf_' || w.mul_no,
    coalesce(s.plan_type, 'individual'),
    w.amount,
    'paid',
    w.mul_no,
    w.rebill_no,
    4,
    '승인완료(백필)',
    w.pay_date,
    'webhook_backfill',
    w.pay_date,
    0
  from (
    select distinct on (raw_payload->>'mul_no')
      (raw_payload->>'mul_no')            as mul_no,
      user_id,
      nullif(raw_payload->>'rebill_no','') as rebill_no,
      (raw_payload->>'price')::int         as amount,
      (raw_payload->>'pay_date')::timestamp as pay_date
    from public.payapp_webhook_events
    where pay_state = 4
      and nullif(raw_payload->>'mul_no','') is not null
    order by (raw_payload->>'mul_no'), created_at
  ) w
  left join lateral (
    select sub.id, sub.plan_type
    from public.subscriptions sub
    where sub.user_id = w.user_id
    order by (sub.payapp_rebill_no is not distinct from w.rebill_no) desc,
             sub.created_at desc
    limit 1
  ) s on true
  on conflict (payapp_mul_no) where payapp_mul_no is not null do nothing;

  get diagnostics v_inserted = row_count;
  select count(*) into v_after from public.payment_orders where status='paid';
  raise notice '[0472] paid payment_orders: % -> % (backfilled %)', v_before, v_after, v_inserted;
end $$;

-- 롤백(필요시): delete from public.payment_orders where paid_at_source='webhook_backfill' and order_no like 'bf_%';
