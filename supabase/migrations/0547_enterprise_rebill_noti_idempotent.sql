-- 0547: 가맹 정기결제 재통보에 기간이 또 밀리던 문제.
--
-- 0546 적용 후 실제로 돌려보고 잡았다. 같은 승인건(mul_no 119176457)의 통보를 두 번
-- 흘리면 current_period_end 가 2026-11-29 → 2026-12-29 로 한 달 더 갔다.
--
-- 원인은 0546 이전부터 정기결제 분기에 있었다. 회차 주문은
--     insert ... on conflict (order_no) do nothing
-- 으로 멱등하게 넣는데, 그 다음 기간 갱신은 충돌 여부를 보지 않고 무조건 돌았다.
-- 주문은 한 행이고 기간만 계속 미는 구조다. PayApp 은 응답이 늦거나 불확실하면 통보를
-- 재전송하므로 이건 가정이 아니라 실제로 들어오는 입력이다. 0546 이 var1 을 달고 오는
-- 2회차 통보까지 이 분기로 보내면서 노출 범위가 넓어졌다.
--
-- 수정: 회차 주문을 넣기 전에 존재 여부를 먼저 확인하고, 처음 들어온 승인건일 때만
--       기간을 전진시킨다. 재통보는 'rebill_duplicate_noti' 로 돌려보내고 아무것도
--       바꾸지 않는다. 회원 등급 부여와 코어 미러는 그대로 돌린다 — 둘 다 멱등이고,
--       과거에 미러만 빠진 건을 통보 재전송으로 복구하는 경로(0515)를 살려야 한다.
--
-- mul_no 가 없는 통보는 주문번호를 만들 수 없으므로 종전처럼 UUID 로 새 주문을 만들고
-- 기간을 전진시킨다. 중복 판정 키가 없는 입력에서 결제를 누락시키는 쪽이 더 나쁘다.

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
  v_rebill_order_no text;
  v_rebill_order_id uuid;
  v_already_applied boolean := false;
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

  -- 0546: PayApp 은 2회차+ 통보에도 var1 에 최초 주문번호를 돌려준다. 승인건(mul_no)이
  --       최초 결제와 다르면 신규 결제가 아니라 새 회차이므로 정기결제 분기로 넘긴다.
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

      -- 0547: 이 승인건이 이미 반영됐는지 먼저 본다. 기간 전진은 처음 한 번만.
      v_rebill_order_no := 'entrebill_'||coalesce(nullif(p_mul_no, ''), gen_random_uuid()::text);
      select o.id into v_rebill_order_id
        from public.enterprise_payment_orders o
       where o.order_no = v_rebill_order_no
       limit 1;
      v_already_applied := v_rebill_order_id is not null;

      if not v_already_applied then
        insert into public.enterprise_payment_orders(
          subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no,
          amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
        values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
          v_rebill_order_no,
          coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
        on conflict (order_no) do nothing
        returning id into v_rebill_order_id;

        -- 동시에 같은 통보가 두 번 들어와 insert 가 충돌로 비면 이미 반영된 것으로 본다.
        if v_rebill_order_id is null then
          v_already_applied := true;
          select o.id into v_rebill_order_id
            from public.enterprise_payment_orders o
           where o.order_no = v_rebill_order_no
           limit 1;
        end if;
      end if;

      if v_dup_of is not null then
        update public.enterprise_payment_subscriptions
           set status = 'duplicate', updated_at = now()
         where id = v_sub.id;
        return jsonb_build_object('ok', true, 'status', 'duplicate_charge',
                                  'subscription_id', v_sub.id, 'active_subscription_id', v_dup_of);
      end if;

      if not v_already_applied then
        -- 기간은 직전 끝에 이어 붙인다. 회차와 1:1 로 맞춰야 PayApp 청구 주기와 안 어긋난다.
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
      else
        select s3.current_period_end into v_new_end
          from public.enterprise_payment_subscriptions s3 where s3.id = v_sub.id;
      end if;

      perform public._grant_enterprise_store_membership(v_sub.payer_user_id);

      -- 0515: 코어 결제 테이블 연동 (멱등 — 미러만 빠진 과거 건 복구 경로를 겸한다)
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

      return jsonb_build_object('ok', true,
                                'status', case when v_already_applied
                                               then 'rebill_duplicate_noti'
                                               else 'rebill_paid' end,
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
