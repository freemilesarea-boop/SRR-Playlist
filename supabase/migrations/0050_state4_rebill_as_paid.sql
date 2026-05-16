-- ============================================
-- 0050_state4_rebill_as_paid.sql
--
-- 운영 증상:
--   rebillRegist 정기결제 등록 후 PayApp 가 state=4 (승인대기) webhook 만
--   보내고 state=64 (승인완료) 가 지연/누락되는 케이스. 사용자는 PayApp 의
--   "정기결제 승인내역" 페이지에 도달했고 카드 인증도 끝났는데, 우리쪽 router
--   는 state=4 를 pending 으로 간주해서 membership_tier 활성화 안 함.
--
--   실측 사례 (mingseouu@gmail.com):
--     mul_no 115594883 / 115593587 / 115593182 — state=64 정상 도착, 즉시 활성화
--     mul_no 115596022 / 115596616 — state=4 만 도착, state=64 영영 안 옴
--   동일 사용자 / plan / EF / 시간대에서 state=64 도착 여부가 갈림 → PayApp
--   내부 settlement scheduler 의 지연. 우리쪽 통제 불가.
--
-- 수정:
--   router (_internal_apply_payapp_event) 의 v_is_state_4_paid 기준 확장.
--     기존: state=4 AND approval_no 존재 AND amount > 0
--     신규: state=4 AND amount > 0 AND (
--             approval_no 존재
--             OR raw_payload.rebill_no  (rebillRegist 발급된 정기결제 토큰)
--             OR raw_payload.rebillno
--           )
--   rebill_no 가 발급됐다는 건 PayApp 가 카드 인증 + 정기결제 등록을 성공적으로
--   처리했다는 강한 증거. webhook 의 linkval 검증 + price 검증을 EF 가 이미
--   완료한 상태에서 paid 로 즉시 승격해도 안전. settlement 실패 시 PayApp 가
--   state=8 (요청취소) 또는 state=9 (승인취소) 를 보내고 기존 refund handler
--   가 권한 회수 — 본 정책의 fail-safe.
--
-- 1회 백필:
--   payapp_webhook_events 중 다음 조건의 state=4 row 들을 자동 재처리:
--     - pay_state = 4
--     - linkval_verified = true
--     - membership_updated = false (아직 활성화 안 됨)
--     - raw_payload->>'rebill_no' 또는 'rebillno' 가 존재
--     - price > 0
--   → _internal_apply_payapp_paid_event 호출 → membership 활성화 +
--     event row 의 membership_updated/final_membership_tier 갱신.
--
-- 영향:
--   - 신규 rebillRegist 결제: state=4 webhook 도착 즉시 (PayApp settlement
--     기다리지 않고) membership 활성화. realtime publication 통해 클라이언트
--     도 1~2초 내 success.
--   - 기존 stuck rows (115596022, 115596616 등) 마이그레이션 실행 즉시 복구.
-- ============================================

-- ---------- 1) router 재정의 — state=4 + rebill_no 도 paid 로 인정 ----------
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
  -- state=4 paid 승격 조건: amount > 0 AND (approval_no OR rebill_no)
  -- 카드 인증 완료 신호 둘 중 하나라도 있으면 paid 로 즉시 처리.
  v_is_state_4_paid boolean := (
    p_pay_state = 4
    and coalesce(p_amount, 0) > 0
    and (v_has_approval or v_has_rebill)
  );
  -- approval_no 가 없고 rebill_no 만 있으면 paid_event 에 rebill_no 를 approval
  -- 자리로 전달 (payment_orders.approval_no 컬럼에 기록되어 운영 진단에 도움).
  v_effective_approval text := coalesce(
    p_approval_no,
    case when v_has_rebill then 'rebill_' || v_rebill_token else null end
  );
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
      p_order_no := p_order_no,
      p_source := case
        when v_is_state_4_paid and v_has_rebill and not v_has_approval
          then p_source || '+state4_rebill'
        when v_is_state_4_paid
          then p_source || '+state4_approval'
        else p_source
      end,
      p_raw_payload := p_raw_payload
    );
    return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier, 'paid'::text, v_result.message;
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
      ('pending state ' || p_pay_state || ' — no membership change' ||
       case
         when p_pay_state = 4 and not v_has_approval and not v_has_rebill
           then ' (no approval_no / no rebill_no)'
         when p_pay_state = 4
           then ''
         else ''
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

-- ---------- 2) 백필: 기존 stuck state=4 + rebill_no row 자동 복구 ----------
do $$
declare
  v_row record;
  v_apply record;
  v_count integer := 0;
  v_failed integer := 0;
  v_rebill_token text;
  v_plan text;
begin
  for v_row in
    select ev.id, ev.payapp_mul_no, ev.price, ev.raw_payload, ev.order_no, ev.created_at
    from public.payapp_webhook_events ev
    where ev.pay_state = 4
      and ev.linkval_verified = true
      and ev.membership_updated = false
      and ev.price is not null and ev.price > 0
      and ev.payapp_mul_no is not null
      and (
        ev.raw_payload->>'rebill_no' is not null
        or ev.raw_payload->>'rebillno' is not null
      )
    order by ev.created_at asc
  loop
    v_rebill_token := nullif(btrim(coalesce(
      v_row.raw_payload->>'rebill_no',
      v_row.raw_payload->>'rebillno', ''
    )), '');
    v_plan := case when v_row.price = 6900 then 'business' else 'individual' end;

    begin
      select * into v_apply from public._internal_apply_payapp_paid_event(
        p_payapp_mul_no := v_row.payapp_mul_no,
        p_amount := v_row.price,
        p_plan_type := v_plan,
        p_buyer_email := v_row.raw_payload->>'recvemail',
        p_buyer_phone := v_row.raw_payload->>'recvphone',
        p_paid_at := v_row.created_at,
        p_approval_no := 'rebill_' || coalesce(v_rebill_token, ''),
        p_goodname := v_row.raw_payload->>'goodname',
        p_order_no := coalesce(
          v_row.order_no,
          v_row.raw_payload->>'var1',
          v_row.raw_payload->>'order_no'
        ),
        p_source := 'backfill_0050_state4_rebill',
        p_raw_payload := v_row.raw_payload
      );

      update public.payapp_webhook_events ev
      set matched_user_id = v_apply.matched_user_id,
          matched_order_id = v_apply.matched_order_id,
          matched_subscription_id = v_apply.matched_subscription_id,
          membership_updated = v_apply.membership_updated,
          final_membership_tier = v_apply.final_membership_tier,
          processing_error = case when v_apply.membership_updated then null
                                  else v_apply.message end,
          processed_at = coalesce(ev.processed_at, now())
      where ev.id = v_row.id;

      v_count := v_count + 1;
      raise notice 'backfilled state=4+rebill mul_no=% → tier=% (msg=%)',
        v_row.payapp_mul_no,
        coalesce(v_apply.final_membership_tier,'?'),
        substr(coalesce(v_apply.message,'?'), 1, 120);
    exception when others then
      v_failed := v_failed + 1;
      raise notice 'backfill failed mul_no=%: %', v_row.payapp_mul_no, sqlerrm;
    end;
  end loop;

  raise notice '[0050] state=4+rebill backfill: success=% failed=%', v_count, v_failed;
end $$;

-- ---------- 확인 ----------
select
  '[0050] check' as label,
  (select count(*) from public.payapp_webhook_events
    where pay_state = 4 and linkval_verified = true and membership_updated = false
      and (raw_payload->>'rebill_no' is not null or raw_payload->>'rebillno' is not null))
    as stuck_state4_rebill_remaining,
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_internal_apply_payapp_event')
    as router_signature;
