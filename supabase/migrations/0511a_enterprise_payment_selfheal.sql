-- 0511 — 엔터프라이즈 결제 누락 자동 감지·복구 (사람이 DB 를 들여다보지 않아도 되게)
--
-- 배경:
--   0510 에서 pay_state=4 누락을 고쳤지만, 그 버그는 "결제됐는데 반영 안 됨" 이라는
--   더 큰 부류의 한 사례일 뿐이다. 매장이 늘면 이런 건 사람이 못 잡는다.
--   실제로 오늘 건도 운영자가 DB 를 직접 조회해서 발견했다.
--
-- 이 마이그레이션이 넣는 것:
--   1) _payapp_is_paid_state() — 결제 성공 판정 규칙의 단일 진실.
--      소비자 경로(0040)와 같은 규칙을 한 곳에 못박아 두 경로가 다시 갈라지지 않게 한다.
--   2) cron_reconcile_enterprise_payments() — 10분마다 자동 복구.
--      (A) PayApp 이 결제 성공을 보냈고 서명 검증도 통과했는데 주문이 paid 가 아닌 건 → 재처리
--      (B) 구독은 active 인데 매장 계정 membership 이 안 열린 건 → 권한 부여
--      둘 다 멱등이라 반복 실행해도 안전하다.
--
--   (B)가 중요한 이유: 결제 반영이 늦어지는 원인이 웹훅이든 다른 무엇이든,
--   "돈은 냈는데 음악이 안 나온다" 는 상태만큼은 자동으로 사라진다.

-- ────────────────────────── 1) 결제 성공 판정 단일화 ──────────────────────────
-- paid = state 64  OR  (state 4 + 승인번호 존재 + 금액 > 0)
-- PayApp 은 카드 승인 시 state=4 + payauthcode 를 보내는 경우가 많다. 64 만 보면 누락된다.
create or replace function public._payapp_is_paid_state(
  p_state integer, p_approval text, p_amount integer
)
returns boolean
language sql
immutable
set search_path to 'public'
as $$
  select p_state = 64
      or (p_state = 4
          and p_approval is not null
          and length(btrim(p_approval)) > 0
          and coalesce(p_amount, 0) > 0);
$$;

comment on function public._payapp_is_paid_state(integer, text, integer) is
  'PayApp 결제 성공 판정의 단일 진실. 소비자(0040)/엔터프라이즈(0510) 공통 규칙.';

-- ────────────────────────── 2) 자동 복구 크론 ──────────────────────────
create or replace function public.cron_reconcile_enterprise_payments()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_repaired int := 0;
  v_granted  int := 0;
  v_row record;
begin
  -- (A) 검증된 결제 성공 웹훅인데 주문이 paid 가 아닌 건 → 원본 payload 로 재처리.
  --     웹훅 유실이 아니라 "해석 실패" 를 잡는다. 원본은 이미 저장돼 있으므로 재생 가능.
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

  -- (B) 구독은 살아 있는데 매장 계정 권한이 안 열린 건 → 권한 부여.
  --     원인이 무엇이든 "결제했는데 음악이 안 나오는" 상태를 자동으로 없앤다.
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

  return jsonb_build_object(
    'ok', true, 'checked_at', now(),
    'orders_repaired', v_repaired, 'memberships_granted', v_granted);
end; $$;

comment on function public.cron_reconcile_enterprise_payments() is
  '엔터프라이즈 결제 누락 자동 복구. (A) 검증된 성공 웹훅 미반영 재처리 (B) 결제 활성인데 미개통 권한 부여. 멱등.';

revoke execute on function public.cron_reconcile_enterprise_payments() from public, anon, authenticated;

-- 10분마다 실행 — 최악의 경우에도 점주 대기시간이 10분을 넘지 않는다.
select cron.schedule(
  'srr-enterprise-payment-reconcile',
  '*/10 * * * *',
  $$select public.cron_reconcile_enterprise_payments();$$
);
