-- 0513 — 중복 rebill 이 실제로 청구되더라도 조용히 넘어가지 않게
--
-- 배경:
--   0512 로 중복 등록 자체는 막았지만, 그 이전에 만들어진 rebill(예: 숙대점 262480000019)이
--   PayApp 에 남아 있을 가능성을 사람이 콘솔에서 확인해야 했다. 사람 확인에 의존하면
--   매장이 늘었을 때 그대로 사고가 된다.
--
-- 이 마이그레이션:
--   결제자에게 이미 유효한 구독이 있는데 '다른' rebill 로 결제가 들어오면,
--   두 번째 구독을 활성화하지 않는다. 대신
--     • 돈이 들어온 사실은 주문으로 기록하고 (환불 근거)
--     • 구독은 'duplicate' 로 표시해 활성 구독이 두 개가 되지 않게 하고
--     • reconcile 크론이 그 건수를 보고한다.
--   즉 "모르고 이중청구가 유지되는" 상태가 존재할 수 없다.

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
  v_dup_of uuid;
  v_approval text := btrim(coalesce(
    p_raw->>'payauthcode', p_raw->>'approval_no', p_raw->>'app_no', ''
  ));
  v_paid boolean := public._payapp_is_paid_state(p_pay_state, v_approval, p_amount);
begin
  if p_order_no is not null and p_order_no <> '' then
    select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1;
    v_has_order := found;
  end if;

  -- rebill 재청구 경로 (주문번호 없이 rebill_no 만 오는 경우)
  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1;
    v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if v_paid then
      -- 0513 — 같은 결제자에게 이미 유효한 '다른' 구독이 있으면 이중청구다.
      select s2.id into v_dup_of
        from public.enterprise_payment_subscriptions s2
       where s2.payer_user_id = v_sub.payer_user_id
         and s2.enterprise_account_id = v_sub.enterprise_account_id
         and s2.payer_type = v_sub.payer_type
         and s2.id <> v_sub.id
         and s2.status = 'active'
       limit 1;

      -- 돈이 들어온 사실은 어느 쪽이든 기록한다(환불 근거).
      insert into public.enterprise_payment_orders(
        subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no,
        amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
        'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text),
        coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;

      if v_dup_of is not null then
        -- 두 번째 구독을 활성화하지 않는다. 표시만 남기고 reconcile 이 보고하게 한다.
        update public.enterprise_payment_subscriptions
           set status = 'duplicate', updated_at = now()
         where id = v_sub.id;
        return jsonb_build_object('ok', true, 'status', 'duplicate_charge',
                                  'subscription_id', v_sub.id, 'active_subscription_id', v_dup_of);
      end if;

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
