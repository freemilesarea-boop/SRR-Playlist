-- ============================================================================
-- 0499_plan_type_fidelity.sql
--
-- 목적: 결제 반영 시 플랜을 "금액 추정" 이 아니라 "주문의 plan_type" 으로 확정한다.
--
-- 문제:
--   금액은 플랜을 구분하지 못한다.
--     4,900원 = individual  또는 artist_student
--     6,900원 = business    또는 artist_general
--   그런데 state=4 승격 트리거(_trg_promote_state4_to_paid)와 payapp-feedback
--   Edge Function 이 금액 추정을 우선했다. 그 결과:
--     · artist_student 결제 → subscriptions.plan_type = 'individual' (라벨 오류)
--     · artist_general 결제 → subscriptions.plan_type = 'business'
--       → membership_tier 도 'business' 로 매핑됨
--       → tracks_artist_insert RLS 는 membership_tier='individual' 을 요구하므로
--         **결제한 일반 아티스트가 음원을 등록하지 못한다**(기능 버그).
--
-- 조치:
--   (A) 트리거가 주문(payment_orders.plan_type)을 먼저 신뢰하고, 주문을 못 찾은
--       경우에만 금액 추정으로 폴백한다. (payapp-feedback EF 도 동일하게 수정)
--   (B) 이미 어긋난 subscriptions.plan_type 을 주문 기준으로 정정(47건).
--
-- 안전 원칙:
--   • 결제/청구 금액 로직 불변. 신규 청구·환불 없음.
--   • (B)는 아티스트 플랜(artist_general/artist_student)으로 결제된 건만 대상.
--     금액이 플랜 정가와 일치하는 것을 조건에 포함해 재청구 판정(정가 대조)이
--     깨지지 않도록 한다.
--   • users.membership_tier 는 건드리지 않는다(현재 접근 권한 상태이므로).
--     앞으로의 결제부터 artist_general → tier 'individual' 로 올바르게 매핑된다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) state=4 승격 트리거 — 주문의 plan_type 우선
--     0482 본문 유지 + 0499 표시 구간만 변경.
-- ----------------------------------------------------------------------------
create or replace function public._trg_promote_state4_to_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_apply record;
  v_plan text;
  v_candidate_order_no text;
  v_pay_date timestamptz;
begin
  if NEW.pay_state <> 4 or NEW.linkval_verified is not true
     or NEW.price is null or NEW.price <= 0 or NEW.payapp_mul_no is null then
    return NEW;
  end if;

  v_candidate_order_no := coalesce(
    nullif(btrim(NEW.order_no), ''),
    nullif(btrim(NEW.raw_payload->>'var1'), ''),
    nullif(btrim(NEW.raw_payload->>'order_no'), '')
  );

  -- 0499: 주문의 plan_type 을 먼저 신뢰한다. 금액만으로는 individual/artist_student
  --       (4,900)와 business/artist_general(6,900)을 구분할 수 없다.
  if v_candidate_order_no is not null then
    select po.plan_type into v_plan
    from public.payment_orders as po
    where po.order_no = v_candidate_order_no
    limit 1;
  end if;
  if v_plan is null
     or v_plan not in ('individual','business','artist_general','artist_student') then
    -- 폴백: 주문을 못 찾은 경우에만 금액 추정
    v_plan := case when NEW.price = 6900 then 'business' else 'individual' end;
  end if;

  -- 0482: PayApp pay_date 는 TZ 표기가 없는 KST 문자열("2026-08-31 10:10:13").
  --       '+09' 를 붙여 명시적으로 해석한다. 파싱 실패 시 수신시각으로 폴백.
  begin
    v_pay_date := (nullif(btrim(NEW.raw_payload->>'pay_date'), '') || '+09')::timestamptz;
  exception when others then
    v_pay_date := null;
  end;

  begin
    select * into v_apply from public._internal_apply_payapp_event(
      p_payapp_mul_no := NEW.payapp_mul_no,
      p_pay_state := 4,
      p_amount := NEW.price,
      p_plan_type := v_plan,
      p_buyer_email := NEW.raw_payload->>'recvemail',
      p_buyer_phone := NEW.raw_payload->>'recvphone',
      p_event_at := coalesce(v_pay_date, NEW.created_at, now()),
      p_approval_no := coalesce(
        NEW.raw_payload->>'approval_no',
        NEW.raw_payload->>'apv_no',
        NEW.raw_payload->>'card_apv_no'
      ),
      p_goodname := NEW.raw_payload->>'goodname',
      p_order_no := v_candidate_order_no,
      p_source := 'trigger_state4_auto',
      p_raw_payload := NEW.raw_payload
    );

    if v_apply.membership_updated then
      NEW.matched_user_id := v_apply.matched_user_id;
      NEW.matched_order_id := v_apply.matched_order_id;
      NEW.matched_subscription_id := v_apply.matched_subscription_id;
      NEW.membership_updated := true;
      NEW.final_membership_tier := v_apply.final_membership_tier;
      NEW.state_label := '승인완료 (state4 auto)';
      NEW.processed_at := coalesce(NEW.processed_at, now());
      NEW.processing_error := null;
    end if;
  exception when others then
    raise notice '[trg_state4] error mul_no=%: %', NEW.payapp_mul_no, sqlerrm;
  end;

  return NEW;
end;
$function$;

-- ----------------------------------------------------------------------------
-- (B) 기존 라벨 정정 — 아티스트 플랜으로 결제된 구독만
-- ----------------------------------------------------------------------------
update public.subscriptions as s
set plan_type = o.plan_type
from (
  select sub.id as sub_id, po.plan_type, po.amount
  from public.subscriptions sub
  join lateral (
    select p.plan_type, p.amount from public.payment_orders p
    where p.subscription_id = sub.id and p.status = 'paid'
    order by p.paid_at desc limit 1
  ) po on true
  where po.plan_type in ('artist_general','artist_student')
    and sub.plan_type is distinct from po.plan_type
) as o
where s.id = o.sub_id
  -- 정가 대조 — 금액이 플랜 정가와 다르면 건드리지 않는다(재청구 판정 보호)
  and s.price = case o.plan_type
        when 'artist_student' then 4900
        when 'artist_general' then 6900
      end;

-- ============================================================================
-- 운영 확인 쿼리 (실행 안 함 — 필요 시 수동 실행)
-- ============================================================================
-- 1) 주문 plan_type 과 구독 plan_type 이 아직도 어긋난 건 (아티스트 플랜 기준 0 이어야 함)
-- select s.id, s.plan_type as 구독plan, o.plan_type as 주문plan, s.price, s.status
-- from public.subscriptions s
-- join lateral (
--   select po.plan_type from public.payment_orders po
--   where po.subscription_id = s.id and po.status='paid'
--   order by po.paid_at desc limit 1
-- ) o on true
-- where o.plan_type in ('artist_general','artist_student')
--   and s.plan_type is distinct from o.plan_type;
--
-- 2) artist_general 결제자가 tier='business' 로 잘못 올라가 업로드가 막혔는지
-- select u.id, u.membership_tier, s.plan_type
-- from public.users u join public.subscriptions s on s.user_id = u.id
-- where u.account_type='artist' and u.membership_tier='business';
