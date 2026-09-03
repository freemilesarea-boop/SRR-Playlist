-- ============================================================================
-- 0500_paid_event_plan_from_order.sql
--
-- 0499 의 마무리 — 결제 이벤트 라우터에서도 플랜을 주문 기준으로 확정한다.
--
-- 배경:
--   금액은 플랜을 구분하지 못한다. 4,900 = individual|artist_student,
--   6,900 = business|artist_general. 그런데 호출자(payapp-feedback Edge Function)는
--   금액 추정으로 plan_type 을 넘긴다. 0499 에서 state=4 승격 트리거는 고쳤지만,
--   state=64 로 들어오는 경로는 여전히 EF 의 추정값을 그대로 쓴다.
--
--   특히 artist_general(6,900) 이 'business' 로 반영되면 membership_tier 가
--   'business' 가 되고, tracks_artist_insert RLS 는 tier='individual' 을 요구하므로
--   **결제한 일반 아티스트가 음원을 등록하지 못한다.**
--
-- 조치:
--   _internal_apply_payapp_event(모든 webhook/replay 경로가 지나는 단일 깔때기)에서
--   주문(payment_orders.plan_type)을 먼저 조회해 p_plan_type 을 덮어쓴다. 주문을
--   못 찾으면 호출자가 넘긴 값을 그대로 쓴다(기존 동작).
--   → EF 재배포 없이 state=4 / state=64 / 관리자 replay 전 경로가 한 번에 교정된다.
--
-- 안전 원칙:
--   • 라우팅 분기 · 금액 검증 · 환불/취소 처리 로직 불변 (0052 본문 유지).
--   • 주문에 기록된 plan_type 은 결제창을 띄울 때 서버가 확정한 값이라 금액 추정보다
--     항상 정확하다.
--   • 유효하지 않은 값이면 무시하고 기존 인자를 사용 → 폴백 동작 보존.
-- ============================================================================

create or replace function public._internal_apply_payapp_event(
  p_payapp_mul_no text,
  p_pay_state integer,
  p_amount integer default null,
  p_plan_type text default 'individual',
  p_buyer_email text default null,
  p_buyer_phone text default null,
  p_event_at timestamptz default now(),
  p_approval_no text default null,
  p_goodname text default null,
  p_order_no text default null,
  p_source text default 'unknown',
  p_raw_payload jsonb default null
) returns table(
  matched_user_id uuid,
  matched_order_id uuid,
  matched_subscription_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  final_status text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_result record;
  v_has_approval boolean := (
    p_approval_no is not null and length(btrim(p_approval_no)) > 0
  );
  v_rebill_token text := nullif(btrim(coalesce(
    p_raw_payload->>'rebill_no',
    p_raw_payload->>'rebillno',
    ''
  )), '');
  v_has_rebill boolean := v_rebill_token is not null;

  -- 신규 (0052): order_no 가 우리 payment_orders 의 미결제 row 와 amount 까지
  -- 정확히 일치하면 paid 신호로 간주. raw_payload->>var1 또는 명시 p_order_no
  -- 둘 다 검사.
  v_candidate_order_no text := coalesce(
    nullif(btrim(p_order_no), ''),
    nullif(btrim(p_raw_payload->>'var1'), ''),
    nullif(btrim(p_raw_payload->>'order_no'), '')
  );
  v_has_valid_order boolean := (
    v_candidate_order_no is not null
    and coalesce(p_amount, 0) > 0
    and exists (
      select 1 from public.payment_orders po
      where po.order_no = v_candidate_order_no
        and po.status in ('requested','pending','waiting','failed')
        and po.amount = p_amount
    )
  );

  v_is_state_4_paid boolean := (
    p_pay_state = 4
    and coalesce(p_amount, 0) > 0
    and (v_has_approval or v_has_rebill or v_has_valid_order)
  );

  v_effective_approval text := coalesce(
    p_approval_no,
    case when v_has_rebill then 'rebill_' || v_rebill_token else null end,
    case when v_has_valid_order then 'state4_order_match' else null end
  );

  v_source_suffix text := case
    when v_is_state_4_paid and v_has_approval then '+state4_approval'
    when v_is_state_4_paid and v_has_rebill then '+state4_rebill'
    when v_is_state_4_paid and v_has_valid_order then '+state4_order_match'
    else ''
  end;

  -- 0500 신규 — 주문 기준 플랜 확정
  v_order_plan text;
  v_resolved_plan text := p_plan_type;
begin
  if p_pay_state = 64 or v_is_state_4_paid then
    if p_amount is null or p_amount <= 0 then
      return query select null::uuid, null::uuid, null::uuid, false, null::text, 'paid'::text,
        'paid event missing/invalid amount'::text;
      return;
    end if;

    -- 0500: 주문에 기록된 plan_type 이 있으면 그것을 신뢰한다(금액 추정보다 정확).
    if v_candidate_order_no is not null then
      select po.plan_type into v_order_plan
      from public.payment_orders as po
      where po.order_no = v_candidate_order_no
      limit 1;
      if v_order_plan in ('individual','business','artist_general','artist_student') then
        v_resolved_plan := v_order_plan;
      end if;
    end if;

    select * into v_result from public._internal_apply_payapp_paid_event(
      p_payapp_mul_no := p_payapp_mul_no,
      p_amount := p_amount,
      p_plan_type := v_resolved_plan,
      p_buyer_email := p_buyer_email,
      p_buyer_phone := p_buyer_phone,
      p_paid_at := p_event_at,
      p_approval_no := v_effective_approval,
      p_goodname := p_goodname,
      p_order_no := v_candidate_order_no,
      p_source := p_source || v_source_suffix,
      p_raw_payload := p_raw_payload
    );
    return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier, 'paid'::text, v_result.message;
    return;
  end if;

  -- pay_state=99 (정기결제 실패) — 2회차+ 자동결제 실패 알림. 권한 변경 없음
  -- (이미 기간 종료 후 발생). 운영 로그용으로 message 만.
  if p_pay_state = 99 then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      'rebill_failed'::text,
      'rebill payment failed (state=99) — no membership change'::text;
    return;
  end if;

  if p_pay_state in (8, 9, 32, 70, 71) then
    select * into v_result from public._internal_apply_payapp_refund_event(
      p_payapp_mul_no := p_payapp_mul_no,
      p_pay_state := p_pay_state,
      p_event_at := p_event_at,
      p_source := p_source
    );
    return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier,
      case when p_pay_state in (9,70,71) then 'refunded' else 'canceled' end, v_result.message;
    return;
  end if;

  if p_pay_state in (1, 4, 10) then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      'pending'::text,
      ('pending state ' || p_pay_state ||
       case
         when p_pay_state = 4 then ' — no approval_no / no rebill_no / no matching order'
         else ' — no membership change'
       end)::text;
    return;
  end if;

  return query select null::uuid, null::uuid, null::uuid, false, null::text,
    'unknown'::text, ('unknown pay_state ' || p_pay_state)::text;
end;
$$;

grant execute on function public._internal_apply_payapp_event(
  text, integer, integer, text, text, text, timestamptz, text, text, text, text, jsonb
) to service_role;
