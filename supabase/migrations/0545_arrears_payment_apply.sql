-- 연체분 결제 반영 — 기존 결제 핸들러와 규칙이 다르다.
--
-- 기존 _internal_apply_payapp_paid_event 는 결제를 "오늘부터 한 달"로 본다.
-- 일반 갱신엔 맞지만 연체분은 '과거 회차'를 받는 것이라 틀린다. 실측(2026-11-01):
-- 7월분 4,900원을 받았더니 period_end 가 2026-07-15 → 2026-12-01 로 점프했고
-- 남은 연체 3회차(8·9·10월, 14,700원)가 통째로 사라졌다. 16명에게 그대로 돌렸으면
-- 각자 첫 건만 결제해도 나머지가 소멸할 뻔했다.
--
-- 그래서 연체는 별도 경로로 받는다. 회원당 1건으로 묶어 보내고,
--   period_end = max(현재값, 가장 늦은 회차 + 1개월)
-- 로 묶은 회차 수만큼만 민다. 뒤로는 가지 않는다.
--
-- order_no 하나에 회차 행 N 개가 달린다. (subscription_id, cycle_period_end)
-- UNIQUE 는 유지 — 같은 회차를 두 번 청구하는 것은 여전히 불가능하다.
--
-- 적용 기록: 원격에 apply_arrears_payment / arrears_combined_payment /
--   fix_arrears_payment_uuid_agg 로 적용 완료.
--   (중간에 min(uuid) 집계로 42883 에러가 났다 — uuid 용 min() 은 없다.
--    array_agg(...)[1] 로 교정. 한 order_no 의 행은 전부 같은 구독이다.)

alter table public.arrears_payment_requests
  add column if not exists paid_at timestamptz;

alter table public.arrears_payment_requests
  drop constraint if exists arrears_payment_requests_order_no_key;

create index if not exists idx_arrears_requests_order_no
  on public.arrears_payment_requests (order_no);

create or replace function public.apply_arrears_payment(
  p_order_no text,
  p_mul_no text default null,
  p_pay_state integer default null,
  p_amount integer default null,
  p_raw jsonb default null
)
returns jsonb
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
  v_new_end timestamptz;
  v_moved boolean := false;
  v_months text;
begin
  select count(*), sum(amount), max(cycle_period_end),
         (array_agg(subscription_id))[1],
         count(*) filter (where status = 'paid'),
         string_agg(cycle_month, ',' order by cycle_period_end)
    into v_cnt, v_total, v_max_cycle, v_sub, v_already, v_months
    from public.arrears_payment_requests
   where order_no = p_order_no;

  if coalesce(v_cnt, 0) = 0 then
    -- 연체 주문이 아니다. 이 경로는 아무것도 하지 않는다.
    return jsonb_build_object('matched', false, 'order_no', p_order_no);
  end if;

  -- 금액 위변조 차단. 통보 금액이 우리가 요청한 합계와 다르면 반영하지 않는다.
  if p_amount is not null and p_amount <> v_total then
    return jsonb_build_object('matched', true, 'applied', false,
      'reason', 'amount_mismatch', 'expected', v_total, 'got', p_amount);
  end if;

  -- 결제 완료 (이 가맹점은 4 로도 실제 결제완료가 통보된다 — 0482 참고)
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

  -- 취소/환불 — 기간을 자동으로 되돌리지 않는다. 사람이 판단할 일이라 표시만 남긴다.
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

revoke all on function public.apply_arrears_payment(text, text, integer, integer, jsonb) from anon, authenticated;
