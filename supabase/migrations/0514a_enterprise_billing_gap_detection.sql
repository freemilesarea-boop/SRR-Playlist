-- 0514 — 엔터프라이즈 미청구(밀린 회차) 감지
--
-- 왜 "PayApp 역대조" 가 아니라 이 방식인가:
--   PayApp REST API 는 결제내역 조회 cmd 를 제공하지 않는다(sync-payapp-payments 주석 참고,
--   조회 cmd 호출 시 errno=70040). 따라서 "PayApp 에 물어봐서 대조" 는 불가능하다.
--   대신 우리가 기간을 계산해 "받았어야 할 회차가 안 들어왔다" 를 스스로 판정한다.
--   소비자 쪽 dispatch-rebill-catchup 이 쓰는 것과 같은 접근이다.
--
-- 이 마이그레이션은 감지까지만 한다(카드 청구 없음).
--   구독이 active 인데 current_period_end 가 유예기간을 넘겨 지났고, 그 회차에 해당하는
--   결제(paid order)가 없으면 "미청구" 로 본다. PayApp 정기결제 스케줄러가 걸렀거나
--   웹훅이 유실된 경우가 여기에 걸린다.

create or replace function public.enterprise_billing_gaps(p_grace_days integer default 2)
returns table (
  subscription_id uuid,
  payer_user_id uuid,
  enterprise_name text,
  store_label text,
  amount integer,
  period_end timestamptz,
  days_overdue numeric,
  last_paid_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select s.id,
         s.payer_user_id,
         ea.enterprise_name,
         coalesce(fs.store_name, au.email, s.payer_user_id::text) as store_label,
         s.amount,
         s.current_period_end,
         round(extract(epoch from (now() - s.current_period_end)) / 86400.0, 1) as days_overdue,
         s.last_paid_at
    from public.enterprise_payment_subscriptions s
    join public.enterprise_accounts ea on ea.id = s.enterprise_account_id
    left join public.franchise_stores fs on fs.id = s.franchise_store_id
    left join auth.users au on au.id = s.payer_user_id
   where s.status = 'active'
     and s.current_period_end is not null
     and s.current_period_end < now() - make_interval(days => greatest(p_grace_days, 0))
     -- 해당 회차 이후 들어온 결제가 하나도 없을 때만 미청구로 본다.
     and not exists (
       select 1 from public.enterprise_payment_orders o
        where o.subscription_id = s.id
          and o.status = 'paid'
          and o.paid_at >= s.current_period_end
     )
   order by s.current_period_end;
$$;

comment on function public.enterprise_billing_gaps(integer) is
  '엔터프라이즈 미청구 감지: 구독은 active 인데 결제 주기가 유예기간을 넘겨 지났고 그 회차 결제가 없는 건. PayApp 은 조회 API 가 없어 우리가 직접 판정한다.';

revoke execute on function public.enterprise_billing_gaps(integer) from public, anon;

-- reconcile 크론 결과에 미청구 건수를 함께 실어 보낸다(10분마다 갱신).
create or replace function public.cron_reconcile_enterprise_payments()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_repaired int := 0;
  v_granted  int := 0;
  v_expired  int := 0;
  v_overdue  int := 0;
  v_row record;
begin
  for v_row in
    select e.order_no, e.payapp_rebill_no, e.payapp_mul_no, e.pay_state, e.price, e.raw_payload
      from public.enterprise_payapp_webhook_events e
      left join public.enterprise_payment_orders o on o.order_no = e.order_no
     where e.verified = true
       and public._payapp_is_paid_state(
             e.pay_state,
             coalesce(e.raw_payload->>'payauthcode', e.raw_payload->>'approval_no', e.raw_payload->>'app_no'),
             e.price)
       and (o.id is null or o.status <> 'paid')
       and e.created_at > now() - interval '30 days'
     order by e.created_at
  loop
    perform public._apply_enterprise_payapp_event(
      v_row.order_no, v_row.payapp_rebill_no, v_row.payapp_mul_no,
      v_row.pay_state, v_row.price, v_row.raw_payload);
    v_repaired := v_repaired + 1;
  end loop;

  for v_row in
    select distinct s.payer_user_id
      from public.enterprise_payment_subscriptions s
      join public.users u on u.id = s.payer_user_id
     where s.status = 'active'
       and coalesce(s.current_period_end, now()) > now()
       and coalesce(u.account_type, 'individual') <> 'artist'
       and coalesce(u.membership_tier, 'free') in ('free', 'individual')
  loop
    perform public._grant_enterprise_store_membership(v_row.payer_user_id);
    v_granted := v_granted + 1;
  end loop;

  v_expired := public.expire_stale_enterprise_pending_subscriptions(30);

  select count(*) into v_overdue from public.enterprise_billing_gaps(2);

  return jsonb_build_object(
    'ok', true, 'checked_at', now(),
    'orders_repaired', v_repaired, 'memberships_granted', v_granted,
    'stale_expired', v_expired, 'billing_overdue', v_overdue);
end; $$;
