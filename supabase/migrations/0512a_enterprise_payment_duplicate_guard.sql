-- 0512 — 엔터프라이즈 정기결제 중복 등록 차단
--
-- 사고:
--   숙대점 점주가 결제창에서 승인을 마쳤는데 화면이 그대로라 한 번 더 눌렀다.
--   그 결과 PayApp 에 정기결제(rebill)가 두 건 등록됐다(...018 결제됨 / ...019 미승인).
--   ...019 가 PayApp 에 살아 있으면 다음 달 4,900원이 두 번 청구된다.
--
-- 원인:
--   결제 개시(create-enterprise-payment)가 매번 새 구독 row + 새 rebill 등록을 만든다.
--   진행 중인 결제가 있는지 확인하지 않는다. get_my_enterprise_payment_context 도
--   status in ('active','payment_waiting') 만 "이미 결제 중" 으로 보고 'pending' 은 안 본다.
--
-- 이 마이그레이션:
--   1) 오래된 pending 구독 만료 처리 함수 — 결제창만 띄우고 이탈한 건을 정리한다.
--      (정리하지 않으면 아래 유니크 제약 때문에 점주가 영영 재시도할 수 없다.)
--   2) 부분 유니크 인덱스 — (결제자 × 본사 × 결제주체) 당 살아있는 구독은 최대 1건.
--      앱 로직이 실수해도 DB 가 두 번째 등록을 물리적으로 막는다.

-- ────────── 1) 이탈한 pending 정리 ──────────
create or replace function public.expire_stale_enterprise_pending_subscriptions(
  p_minutes integer default 30
)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_n integer;
begin
  with expired as (
    update public.enterprise_payment_subscriptions s
       set status = 'failed', updated_at = now()
     where s.status = 'pending'
       and s.created_at < now() - make_interval(mins => greatest(p_minutes, 1))
       and s.last_paid_at is null
     returning s.id
  )
  select count(*) into v_n from expired;

  -- 짝이 되는 미결제 주문도 함께 정리 (paid 는 절대 건드리지 않는다)
  update public.enterprise_payment_orders o
     set status = 'canceled'
   where o.status in ('requested', 'waiting')
     and o.paid_at is null
     and exists (
       select 1 from public.enterprise_payment_subscriptions s
        where s.id = o.subscription_id and s.status = 'failed');

  return coalesce(v_n, 0);
end; $$;

comment on function public.expire_stale_enterprise_pending_subscriptions(integer) is
  '결제창만 띄우고 이탈한 pending 구독을 만료 처리. 중복 등록 차단 인덱스가 재시도를 막지 않도록 하는 짝.';

revoke execute on function public.expire_stale_enterprise_pending_subscriptions(integer) from public, anon;

-- 인덱스 생성 전에 기존 잔재 정리 (숙대점 ...019 같은 건)
select public.expire_stale_enterprise_pending_subscriptions(30);

-- ────────── 2) 살아있는 구독은 결제자당 1건 ──────────
create unique index if not exists uq_enterprise_payment_sub_live
  on public.enterprise_payment_subscriptions (payer_user_id, enterprise_account_id, payer_type)
  where status in ('pending', 'payment_waiting', 'active');

comment on index public.uq_enterprise_payment_sub_live is
  '결제자×본사×결제주체 당 살아있는 정기결제는 1건. 점주가 결제 버튼을 두 번 눌러도 rebill 이 두 번 등록되지 않는다.';

-- ────────── 3) 만료 정리를 자동 복구 크론에 포함 ──────────
-- 0511 의 reconcile 이 10분마다 도므로 거기에 얹는다(별도 크론 추가 없음).
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

  -- 0512 — 이탈한 결제 시도 정리(멱등). 재시도 경로를 막지 않기 위해 필요.
  v_expired := public.expire_stale_enterprise_pending_subscriptions(30);

  return jsonb_build_object(
    'ok', true, 'checked_at', now(),
    'orders_repaired', v_repaired, 'memberships_granted', v_granted,
    'stale_expired', v_expired);
end; $$;
