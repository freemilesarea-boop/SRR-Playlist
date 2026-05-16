-- ============================================
-- 0052_state4_order_match_as_paid.sql
--
-- 운영 증상 (사용자 mingseouu@gmail.com 신규 결제 11:03:07):
--   mul_no 115596975, price=6900 (business), state=4 (승인대기)
--   linkval_verified=true, 그러나 raw_payload 에 rebill_no 와 approval_no 가 둘 다
--   없어서 0050 router 의 v_is_state_4_paid 가 false → pending 분류 →
--   PaymentSuccessPage 60초 polling 후 timeout.
--
-- PayApp 매뉴얼 + 검색 결과 종합:
--   pay_state=1   결제요청 수신 (사용자 결제 전, 단순 알림)
--   pay_state=4   승인대기 (카드 인증 완료, settlement 진행 중)
--   pay_state=64  승인완료 (settlement 확정)
--   pay_state=99  정기결제 실패 (2회차 이후)
--   pay_state=8/32  요청취소
--   pay_state=9/70/71  환불
--
--   PayApp 가 state=4 webhook 에 approval_no/rebill_no 를 안 보내는 케이스가
--   존재. state=64 는 PayApp 내부 settlement 스케줄러 지연으로 늦거나 누락됨.
--
-- 수정 (가장 강한 매칭 신호 추가):
--   _internal_apply_payapp_event router 의 state=4 paid 승격 기준 확장:
--     기존 (0050): state=4 AND amount>0 AND (approval_no OR rebill_no)
--     신규 (0052): state=4 AND amount>0 AND (
--                    approval_no
--                    OR rebill_no
--                    OR 다음 조건:
--                       p_order_no 가 존재하고
--                       payment_orders.order_no = p_order_no 인 row 가 존재하고
--                       그 row 의 status in (requested/pending/waiting) 이고
--                       그 row 의 amount = p_amount
--                  )
--   이유: 우리가 발급한 order_no(swk_...) + webhook 의 price 가 우리 DB 와
--   정확히 일치한다 = 위변조 불가능 + 명백한 결제 신호.
--   linkval 검증은 EF 가 이미 끝낸 상태에서만 router 가 호출됨.
--
-- 위험 / fail-safe:
--   - 카드 인증이 사후 실패하면 PayApp 가 state=8 (요청취소) webhook 송신.
--     기존 refund handler 가 즉시 회수 → 일시 grant 후 자동 revoke.
--   - 디지털 콘텐츠 접근 권한이므로 일시 over-grant 의 비용은 작음.
--
-- 백필:
--   기존 stuck state=4 webhook 중 위 신규 조건을 만족하는 row 자동 재처리.
-- ============================================

-- ---------- 1) router 재정의 — state=4 + valid order match 도 paid ----------
drop function if exists public._internal_apply_payapp_event(
  text, integer, integer, text, text, text, timestamptz, text, text, text, text, jsonb
);

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
begin
  if p_pay_state = 64 or v_is_state_4_paid then
    if p_amount is null or p_amount <= 0 then
      return query select null::uuid, null::uuid, null::uuid, false, null::text, 'paid'::text,
        'paid event missing/invalid amount'::text;
      return;
    end if;
    select * into v_result from public._internal_apply_payapp_paid_event(
      p_payapp_mul_no := p_payapp_mul_no,
      p_amount := p_amount,
      p_plan_type := p_plan_type,
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

-- ---------- 2) 백필 — 기존 stuck state=4 + order match row 복구 ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
  v_candidate_order_no text;
  v_plan text;
  v_matched_amount integer;
begin
  for v_row in
    select
      ev.id, ev.payapp_mul_no, ev.price, ev.raw_payload, ev.order_no, ev.created_at
    from public.payapp_webhook_events ev
    where ev.pay_state = 4
      and ev.linkval_verified = true
      and ev.membership_updated = false
      and ev.price is not null and ev.price > 0
      and ev.payapp_mul_no is not null
    order by ev.created_at asc
  loop
    v_candidate_order_no := coalesce(
      nullif(btrim(v_row.order_no), ''),
      nullif(btrim(v_row.raw_payload->>'var1'), ''),
      nullif(btrim(v_row.raw_payload->>'order_no'), '')
    );

    if v_candidate_order_no is null then continue; end if;

    -- payment_orders 와 정확히 매칭되는지 확인
    select po.amount into v_matched_amount
    from public.payment_orders po
    where po.order_no = v_candidate_order_no
      and po.status in ('requested','pending','waiting','failed')
      and po.amount = v_row.price
    limit 1;

    if v_matched_amount is null then continue; end if;

    v_plan := case when v_row.price = 6900 then 'business' else 'individual' end;

    begin
      select * into v_apply from public._internal_apply_payapp_paid_event(
        p_payapp_mul_no := v_row.payapp_mul_no,
        p_amount := v_row.price,
        p_plan_type := v_plan,
        p_buyer_email := v_row.raw_payload->>'recvemail',
        p_buyer_phone := v_row.raw_payload->>'recvphone',
        p_paid_at := v_row.created_at,
        p_approval_no := coalesce(
          v_row.raw_payload->>'approval_no',
          v_row.raw_payload->>'apv_no',
          'state4_order_match'
        ),
        p_goodname := v_row.raw_payload->>'goodname',
        p_order_no := v_candidate_order_no,
        p_source := 'backfill_0052_state4_order_match',
        p_raw_payload := v_row.raw_payload
      );

      update public.payapp_webhook_events ev
      set matched_user_id = v_apply.matched_user_id,
          matched_order_id = v_apply.matched_order_id,
          matched_subscription_id = v_apply.matched_subscription_id,
          membership_updated = v_apply.membership_updated,
          final_membership_tier = v_apply.final_membership_tier,
          processing_error = case when v_apply.membership_updated then null else v_apply.message end,
          processed_at = coalesce(ev.processed_at, now())
      where ev.id = v_row.id;

      v_count := v_count + 1;
      raise notice '[0052] state4 order-match fix mul_no=% order=% → tier=%',
        v_row.payapp_mul_no,
        v_candidate_order_no,
        coalesce(v_apply.final_membership_tier,'?');
    exception when others then
      v_failed := v_failed + 1;
      raise notice '[0052] state4 order-match FAILED mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;
  raise notice '[0052] state4+order-match backfill: success=% failed=%', v_count, v_failed;
end $$;

-- ---------- 3) 확인 ----------
select
  '[0052] check' as label,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 4 and linkval_verified = true and membership_updated = false)
    as still_stuck_state4_total,
  (select count(*) from public.payapp_webhook_events ev
    where ev.pay_state = 4 and ev.linkval_verified = true and ev.membership_updated = false
      and exists (
        select 1 from public.payment_orders po
        where po.order_no = coalesce(
          nullif(btrim(ev.order_no), ''),
          nullif(btrim(ev.raw_payload->>'var1'), '')
        )
        and po.status in ('requested','pending','waiting','failed')
        and po.amount = ev.price
      ))
    as still_stuck_state4_with_matching_order;
