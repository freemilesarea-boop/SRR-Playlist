-- 0546: 가맹 정기결제 2회차+ 통보가 구독 기간을 갱신하지 않던 버그.
--
-- 증상
--   분당미금역점(카공시대)은 2026-10-31 10:10 KST 에 4,900원이 정상 승인됐고 통보도
--   도착했다. 그런데 current_period_end 는 2026-10-29 에 그대로 멈춰 있어 연체로 잡혔고,
--   연체 청구 링크가 발송됐다. 김가희 건은 같은 경로로 실제 중복 결제까지 갔다.
--
-- 원인
--   PayApp 은 2회차 이후 정기결제 통보에도 var1 에 '최초 결제의 주문번호'를 그대로
--   돌려준다. _apply_enterprise_payapp_event 는 var1 로 주문을 먼저 찾고, 찾히면
--   '신규 결제' 분기로 들어간다. 그 분기는
--       if v_order.status <> 'paid' then  ... 기간 갱신 ...
--   가드를 두고 있어서, 최초 주문이 이미 paid 인 2회차에는 기간 갱신이 통째로
--   건너뛰어진다. 기간을 제대로 미는 정기결제 분기는 애초에 도달하지 못한다.
--   초회 결제만 정상 동작했기 때문에(주문이 requested 상태) 2회차를 맞은 가맹 회원만
--   터졌고, 그래서 발견이 늦었다.
--
-- 수정
--   1) 2회차 판정을 넣는다. rebill_no 가 있고, 승인건의 mul_no 가 최초 주문의 mul_no 와
--      다르고, 그 주문이 이미 paid 면 별개 승인건이므로 정기결제 분기로 넘긴다.
--      mul_no 비교가 핵심이다 — 같은 승인건의 재통보(멱등)와 새 회차를 가르는 유일한 키다.
--   2) 정기결제 분기의 기간 계산을 now() 기준에서 '직전 기간 끝' 기준으로 바꾼다.
--      now()+1개월 로 두면 매 회차 결제일만큼 기간이 뒤로 밀려 PayApp 의 청구 주기와
--      어긋난다(10/29 만료 + 10/31 결제 → 12/01 이 되어 이틀을 덤으로 준다).
--      직전 끝에 1개월을 더하면 회차와 기간이 1:1 로 맞는다.
--      단, 통보가 아주 늦게 왔거나 여러 회차가 비어 결과가 과거가 되면 방금 받은 돈이
--      기간 0일이 되므로, 그 경우에만 now()+1개월 로 떨어뜨린다.

create or replace function public._apply_enterprise_payapp_event(
  p_order_no text,
  p_rebill_no text,
  p_mul_no text,
  p_pay_state integer,
  p_amount integer,
  p_raw jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_order public.enterprise_payment_orders;
  v_sub public.enterprise_payment_subscriptions;
  v_has_order boolean := false;
  v_has_sub boolean := false;
  v_dup_of uuid;
  v_rebill_order_id uuid;
  v_mirror jsonb;
  v_new_start timestamptz;
  v_new_end timestamptz;
  v_cycle boolean := false;
  v_approval text := btrim(coalesce(
    p_raw->>'payauthcode', p_raw->>'approval_no', p_raw->>'app_no', ''
  ));
  v_paid boolean := public._payapp_is_paid_state(p_pay_state, v_approval, p_amount);
begin
  if p_order_no is not null and p_order_no <> '' then
    select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1;
    v_has_order := found;
  end if;

  -- (1) 2회차+ 정기결제 판정. var1 이 최초 주문을 가리키고 있어도 승인건이 다르면
  --     신규 결제가 아니라 새 회차다.
  if v_has_order
     and v_paid
     and v_order.status = 'paid'
     and p_rebill_no is not null and p_rebill_no <> ''
     and p_mul_no is not null and p_mul_no <> ''
     and coalesce(v_order.payapp_mul_no, '') <> p_mul_no
  then
    v_has_order := false;
    v_cycle := true;
  end if;

  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1;
    v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if v_paid then
      select s2.id into v_dup_of
        from public.enterprise_payment_subscriptions s2
       where s2.payer_user_id = v_sub.payer_user_id
         and s2.enterprise_account_id = v_sub.enterprise_account_id
         and s2.payer_type = v_sub.payer_type
         and s2.id <> v_sub.id
         and s2.status = 'active'
       limit 1;

      insert into public.enterprise_payment_orders(
        subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no,
        amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
        'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text),
        coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;

      if v_dup_of is not null then
        update public.enterprise_payment_subscriptions
           set status = 'duplicate', updated_at = now()
         where id = v_sub.id;
        return jsonb_build_object('ok', true, 'status', 'duplicate_charge',
                                  'subscription_id', v_sub.id, 'active_subscription_id', v_dup_of);
      end if;

      -- (2) 기간은 직전 끝에 이어 붙인다. 회차와 1:1 로 맞춰야 PayApp 주기와 안 어긋난다.
      v_new_start := coalesce(v_sub.current_period_end, now());
      v_new_end := v_new_start + interval '1 month';
      if v_new_end < now() then
        v_new_start := now();
        v_new_end := now() + interval '1 month';
      end if;

      update public.enterprise_payment_subscriptions
         set status='active', last_paid_at=now(),
             current_period_start=v_new_start, current_period_end=v_new_end
       where id = v_sub.id;
      perform public._grant_enterprise_store_membership(v_sub.payer_user_id);

      -- 0515: 코어 결제 테이블 연동
      select o.id into v_rebill_order_id
        from public.enterprise_payment_orders o
       where o.order_no = 'entrebill_'||coalesce(p_mul_no, '')
       limit 1;
      if v_rebill_order_id is null then
        select o.id into v_rebill_order_id
          from public.enterprise_payment_orders o
         where o.subscription_id = v_sub.id and o.status = 'paid'
         order by o.paid_at desc nulls last, o.created_at desc
         limit 1;
      end if;
      begin
        v_mirror := public._mirror_enterprise_payment_to_core(v_rebill_order_id);
      exception when others then
        v_mirror := jsonb_build_object('ok', false, 'error', SQLERRM);
        raise warning '[0515] rebill mirror failed for sub %: %', v_sub.id, SQLERRM;
      end;

      return jsonb_build_object('ok', true, 'status', 'rebill_paid',
                                'subscription_id', v_sub.id,
                                'cycle_from_var1_order', v_cycle,
                                'period_end', v_new_end,
                                'core_mirror', v_mirror);
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

    -- 0515: 이미 paid 인 주문도 돌린다 — 미러만 빠진 과거 건을 웹훅 재전송으로 복구(멱등)
    begin
      v_mirror := public._mirror_enterprise_payment_to_core(v_order.id);
    exception when others then
      v_mirror := jsonb_build_object('ok', false, 'error', SQLERRM);
      raise warning '[0515] mirror failed for order %: %', v_order.order_no, SQLERRM;
    end;

    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id,
                              'core_mirror', v_mirror);
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
end;
$function$;
