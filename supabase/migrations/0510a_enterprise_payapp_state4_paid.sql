-- 0510 — 엔터프라이즈 정기결제 웹훅: PayApp pay_state=4(승인완료)를 결제 성공으로 인정
--
-- 장애:
--   숙대점 가맹 4,900원 결제가 PayApp 에서는 승인(승인번호 30000588, KB국민카드)됐는데
--   우리 DB 에는 'waiting' 으로 남아 매장 음악이 계속 차단됐다.
--
-- 원인:
--   _apply_enterprise_payapp_event 가 성공 상태를 p_pay_state = 64 로만 판정한다.
--   그런데 PayApp 은 카드 승인 시 state=4 + payauthcode(승인번호) 를 보내는 경우가 많다.
--   소비자 결제 경로는 이미 0040 에서 이 규칙을 반영해 두었다:
--     paid = (state = 64) OR (state = 4 AND 승인번호 존재 AND 금액 > 0)
--   엔터프라이즈 경로만 이 규칙이 빠져 있어 결제가 누락됐다.
--
-- 수정:
--   동일 규칙을 엔터프라이즈 핸들러에도 적용한다. 승인번호는 raw payload 의
--   payauthcode / approval_no / app_no 중 존재하는 값을 쓴다.
--   결제 성공 처리(주문 paid + 구독 active + 기간 갱신 + membership 부여)는 기존 로직 그대로다.

create or replace function public._apply_enterprise_payapp_event(
  p_order_no text, p_rebill_no text, p_mul_no text, p_pay_state integer,
  p_amount integer, p_raw jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.enterprise_payment_orders;
  v_sub public.enterprise_payment_subscriptions;
  v_has_order boolean := false;
  v_has_sub boolean := false;
  v_approval text := btrim(coalesce(
    p_raw->>'payauthcode', p_raw->>'approval_no', p_raw->>'app_no', ''
  ));
  -- 0510: state=64 뿐 아니라 state=4 + 승인번호 + 금액>0 도 결제 성공으로 본다.
  v_paid boolean := (
    p_pay_state = 64
    or (p_pay_state = 4 and length(v_approval) > 0 and coalesce(p_amount, 0) > 0)
  );
begin
  if p_order_no is not null and p_order_no <> '' then
    select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1;
    v_has_order := found;
  end if;

  -- rebill 재청구(주문 번호 없이 rebill_no 만 오는 경우)
  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1;
    v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if v_paid then
      insert into public.enterprise_payment_orders(
        subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no,
        amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
        'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text),
        coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;
      update public.enterprise_payment_subscriptions
         set status='active', last_paid_at=now(),
             current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_sub.id;
      perform public._grant_enterprise_store_membership(v_sub.payer_user_id);
      return jsonb_build_object('ok', true, 'status', 'rebill_paid', 'subscription_id', v_sub.id);
    end if;
    return jsonb_build_object('ok', true, 'status', 'ignored_rebill_state');
  end if;

  if not v_has_order then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if p_amount is not null and p_amount <> 0 and p_amount <> v_order.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  if v_paid then
    if v_order.status <> 'paid' then
      update public.enterprise_payment_orders
         set status='paid', paid_at=now(),
             payapp_mul_no=coalesce(p_mul_no, payapp_mul_no),
             payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no),
             raw_response=coalesce(p_raw, raw_response)
       where id = v_order.id;
      update public.enterprise_payment_subscriptions
         set status='active', payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no),
             last_paid_at=now(), current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_order.subscription_id;
      perform public._grant_enterprise_store_membership(v_order.payer_user_id);
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id);
  elsif p_pay_state in (8,9,32,70,71) then
    update public.enterprise_payment_orders set status='canceled',
           payapp_mul_no=coalesce(p_mul_no, payapp_mul_no)
     where id=v_order.id and status<>'paid';
    update public.enterprise_payment_subscriptions set status='canceled'
     where id=v_order.subscription_id and status<>'active';
    return jsonb_build_object('ok', true, 'status', 'canceled');
  else
    update public.enterprise_payment_orders set status='waiting' where id=v_order.id and status='requested';
    return jsonb_build_object('ok', true, 'status', 'waiting');
  end if;
end; $$;
