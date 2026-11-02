-- 0548: 무효화한 연체 요청이 결제되면 돈만 먹고 기간은 안 늘어나던 구멍.
--
-- 분당미금역점 건으로 드러났다. 0546/0547 로 10/31 실결제를 반영해 기간을 2026-11-29 로
-- 맞추고 연체 요청은 voided 로 표시했다. 그런데 PayApp 결제요청 링크는 취소하지 않으면
-- 계속 살아 있고(만료 설정 없음), 매장이 그 링크를 결제하면 apply_arrears_payment 가
--   - 회차 행과 payment_orders 를 paid 로 올려 4,900원을 매출로 잡고
--   - 기간은 v_new_end(10/29+1개월=11/29) 가 현재값 11/29 보다 뒤가 아니라서 그대로 둔다
-- 즉 돈은 받고 이용기간은 0일 늘어나는데 장부에는 '정상 결제'로 보인다. 가장 나쁜 조합이다.
--
-- 수정: 무효화(voided)/환불(refunded) 회차가 섞인 주문의 입금은 정상 결제로 처리하지
--       않는다. 돈이 실제로 들어온 사실은 payment_orders 에 paid 로 남긴다 — 숨기면
--       정산이 안 맞는다 — 대신 회차 행을 refund_due 로 세워 환불 대상으로 드러내고,
--       기간은 건드리지 않는다. 응답의 reason 은 'voided_request' 다.

create or replace function public.apply_arrears_payment(
  p_order_no text,
  p_mul_no text default null::text,
  p_pay_state integer default null::integer,
  p_amount integer default null::integer,
  p_raw jsonb default null::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_cnt integer;
  v_total integer;
  v_max_cycle timestamptz;
  v_sub uuid;
  v_already integer;
  v_dead integer;
  v_new_end timestamptz;
  v_moved boolean := false;
  v_months text;
begin
  select count(*), sum(amount), max(cycle_period_end),
         (array_agg(subscription_id))[1],
         count(*) filter (where status = 'paid'),
         count(*) filter (where status in ('voided', 'refunded')),
         string_agg(cycle_month, ',' order by cycle_period_end)
    into v_cnt, v_total, v_max_cycle, v_sub, v_already, v_dead, v_months
    from public.arrears_payment_requests
   where order_no = p_order_no;

  if coalesce(v_cnt, 0) = 0 then
    return jsonb_build_object('matched', false, 'order_no', p_order_no);
  end if;

  if p_amount is not null and p_amount <> v_total then
    return jsonb_build_object('matched', true, 'applied', false,
      'reason', 'amount_mismatch', 'expected', v_total, 'got', p_amount);
  end if;

  -- 0548: 무효화/환불된 청구가 결제된 경우. 기간을 밀지 않고 환불 대상으로 세운다.
  if coalesce(v_dead, 0) > 0 and p_pay_state in (4, 64) then
    update public.arrears_payment_requests
       set status = 'refund_due',
           paid_at = coalesce(paid_at, now()),
           payapp_mul_no = coalesce(p_mul_no, payapp_mul_no),
           error_message = coalesce(error_message || ' | ', '')
                        || '무효화된 청구가 결제됨(' || coalesce(p_mul_no, '?')
                        || '). 기간 미변경, 환불 대상.'
     where order_no = p_order_no;

    -- 돈은 실제로 들어왔으므로 숨기지 않는다. 정산 대조가 가능해야 한다.
    update public.payment_orders
       set status = 'paid',
           payapp_mul_no = coalesce(p_mul_no, payapp_mul_no),
           paid_at = coalesce(paid_at, now())
     where order_no = p_order_no;

    return jsonb_build_object('matched', true, 'applied', false,
      'reason', 'voided_request', 'cycles', v_cnt, 'amount', v_total,
      'note', 'payment recorded, period untouched, refund required');
  end if;

  if p_pay_state in (4, 64) then
    if v_already = v_cnt then
      return jsonb_build_object('matched', true, 'applied', false, 'reason', 'already_paid');
    end if;

    update public.arrears_payment_requests
       set status = 'paid',
           paid_at = now(),
           payapp_mul_no = coalesce(p_mul_no, payapp_mul_no)
     where order_no = p_order_no;

    update public.payment_orders
       set status = 'paid',
           payapp_mul_no = coalesce(p_mul_no, payapp_mul_no),
           paid_at = now()
     where order_no = p_order_no;

    -- 묶어 받았으면 묶은 회차 수만큼 민다. 가장 늦은 회차 + 1개월.
    -- 이미 더 뒤라면 그대로 둔다(뒤로 가지 않는다).
    v_new_end := v_max_cycle + interval '1 month';
    update public.subscriptions
       set current_period_start = v_max_cycle,
           current_period_end   = v_new_end,
           last_paid_at         = now()
     where id = v_sub
       and (current_period_end is null or current_period_end < v_new_end);
    get diagnostics v_moved = row_count;

    return jsonb_build_object(
      'matched', true, 'applied', true,
      'cycles', v_cnt, 'months', v_months, 'amount', v_total,
      'period_end_set_to', v_new_end, 'period_moved', v_moved);
  end if;

  if p_pay_state in (8, 32, 9, 70, 71) then
    update public.arrears_payment_requests
       set status = case when p_pay_state in (8, 32) then 'canceled' else 'refunded' end,
           error_message = coalesce(error_message, 'pay_state=' || p_pay_state)
     where order_no = p_order_no;
    update public.payment_orders
       set status = 'canceled'
     where order_no = p_order_no;
    return jsonb_build_object('matched', true, 'applied', true,
      'reason', 'canceled_or_refunded', 'pay_state', p_pay_state, 'cycles', v_cnt,
      'note', 'period not reverted — admin review');
  end if;

  return jsonb_build_object('matched', true, 'applied', false,
    'reason', 'ignored_state', 'pay_state', p_pay_state);
end;
$function$;
