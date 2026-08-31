-- ============================================================================
-- 0473_billing_recording_safetynet.sql
-- 정산 파이프라인 하드닝 (P0) — 재청구 매출 과소집계 재발 방지.
--
-- 배경: PayApp 정기 재청구(state=4 결제완료) 웹훅이 들어와도, 재청구 dispatcher가
--   선(先)'requested' 주문을 만들지 않으면 promote/apply 매칭 로직이 사이클별 paid
--   주문을 남기지 못해 payment_orders에 누락 → 매출/정산 과소집계(2026-05~07에 84건
--   누락, 0472로 사후 백필). 근본 방지책은 "완료 결제는 무조건 mul_no 기준으로
--   payment_orders에 paid로 존재하도록 보장"하는 안전망이다.
--
-- 이 마이그레이션(additive):
--   (P0a) AFTER INSERT 안전망 트리거 — 기존 promote 트리거/apply 로직이 어떤 이유로든
--         paid 주문을 못 남겨도, 검증된 완료결제(state=4, linkval_verified, mul_no,
--         price>0)는 payment_orders에 반드시 1건 존재하도록 멱등 보장.
--         (이미 해당 mul_no 주문이 있으면 skip → promote/apply와 충돌 없음.)
--   (P0b) 드리프트 감지 뷰/함수 — 완료 웹훅인데 payment_orders에 없는 건을 상시 노출.
--         월마감 전/크론에서 0인지 점검 → 다시는 몇 달간 방치되지 않도록.
--
-- 안전:
--   · 과거 데이터 재처리 없음(앞으로 들어오는 웹훅에만 관여). 백필은 0472가 이미 처리.
--   · 멱등(payapp_mul_no 부분 유니크 ON CONFLICT). 오류는 삼켜서 웹훅 수신 실패로
--     이어지지 않게 함(PayApp 재시도 폭주 방지) — 대신 드리프트 뷰가 포착.
--   · payment_orders엔 멤버십 트리거 없음(raw INSERT) → 멤버십/구독 무변경.
--     기존 정책대로 영업수당(BEFORE INSERT copy)·정산월(settlement_period_month)만 자동.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (P0a) 완료 결제 자동기록 안전망
-- ----------------------------------------------------------------------------
create or replace function public._tg_payapp_ensure_payment_order()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid;
  v_sub record;
begin
  -- 검증된 완료 카드결제만 대상
  if NEW.pay_state <> 4
     or NEW.linkval_verified is not true
     or NEW.payapp_mul_no is null
     or coalesce(NEW.price, 0) <= 0 then
    return NEW;
  end if;

  -- 이미 이 mul_no 로 주문이 있으면 promote/apply 가 기록한 것 → 아무것도 안 함
  if exists (select 1 from public.payment_orders o where o.payapp_mul_no = NEW.payapp_mul_no) then
    return NEW;
  end if;

  v_uid := coalesce(NEW.matched_user_id, NEW.user_id);
  if v_uid is null then
    -- 사용자 매칭 불가 → 강제로 만들지 않고 드리프트 뷰가 플래그하도록 남겨둠
    return NEW;
  end if;

  -- 구독/플랜 해석: rebill_no 우선 매칭, 없으면 최신 구독
  select s.id, s.plan_type
    into v_sub
  from public.subscriptions s
  where s.user_id = v_uid
  order by (s.payapp_rebill_no is not distinct from NEW.payapp_rebill_no) desc, s.created_at desc
  limit 1;

  insert into public.payment_orders
    (id, user_id, subscription_id, order_no, plan_type, amount, status,
     payapp_mul_no, payapp_rebill_no, payapp_state, payapp_state_label,
     paid_at, paid_at_source, created_at, discount_amount)
  values
    (gen_random_uuid(), v_uid, v_sub.id, 'wh_' || NEW.payapp_mul_no,
     coalesce(v_sub.plan_type, case when NEW.price = 6900 then 'business' else 'individual' end),
     NEW.price, 'paid',
     NEW.payapp_mul_no, NEW.payapp_rebill_no, 4, '결제완료(자동기록)',
     coalesce((NEW.raw_payload->>'pay_date')::timestamptz, NEW.created_at, now()),
     'webhook_ensure',
     coalesce(NEW.created_at, now()), 0)
  on conflict (payapp_mul_no) where payapp_mul_no is not null do nothing;

  return NEW;
exception when others then
  -- 안전망 실패가 웹훅 수신을 깨지 않도록 삼킴. 드리프트 뷰가 포착.
  raise notice '[ensure_payment_order] mul_no=% err=%', NEW.payapp_mul_no, sqlerrm;
  return NEW;
end;
$$;

drop trigger if exists trg_payapp_ensure_payment_order on public.payapp_webhook_events;
create trigger trg_payapp_ensure_payment_order
  after insert on public.payapp_webhook_events
  for each row execute function public._tg_payapp_ensure_payment_order();

-- ----------------------------------------------------------------------------
-- (P0b) 드리프트 감지 — 완료 웹훅인데 payment_orders 에 없는 건
-- ----------------------------------------------------------------------------
create or replace view public.v_billing_recording_drift as
select
  e.id            as webhook_id,
  e.user_id,
  e.matched_user_id,
  e.payapp_mul_no,
  e.payapp_rebill_no,
  e.price,
  e.linkval_verified,
  (e.raw_payload->>'pay_date') as pay_date,
  e.created_at
from public.payapp_webhook_events e
where e.pay_state = 4
  and e.payapp_mul_no is not null
  and not exists (
    select 1 from public.payment_orders o where o.payapp_mul_no = e.payapp_mul_no
  );

-- 뷰는 백엔드(service_role) 전용 — 웹훅 상세 노출 제한
revoke all on public.v_billing_recording_drift from public;
grant select on public.v_billing_recording_drift to service_role;

-- 월마감/크론 점검용 요약(카운트만) — drift_count 가 0 이어야 정상
create or replace function public.check_billing_recording_drift()
returns table(completed_webhooks bigint, recorded_orders bigint, drift_count bigint)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    (select count(*) from public.payapp_webhook_events
       where pay_state = 4 and payapp_mul_no is not null),
    (select count(distinct o.payapp_mul_no) from public.payment_orders o
       where o.payapp_mul_no in
         (select payapp_mul_no from public.payapp_webhook_events where pay_state = 4)),
    (select count(*) from public.v_billing_recording_drift);
$$;

revoke all on function public.check_billing_recording_drift() from public;
grant execute on function public.check_billing_recording_drift() to service_role;
