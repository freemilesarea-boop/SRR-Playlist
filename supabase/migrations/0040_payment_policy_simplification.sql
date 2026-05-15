-- ============================================
-- 0040_payment_policy_simplification.sql
--
-- 정책:
--   결제 성공 판단을 단순화한다.
--     1) state=64                                                 → paid
--     2) state=4 + approval_no 존재 + price > 0                   → paid (자동)
--     3) state=4 only (approval_no 없음)                          → pending
--     4) state=1, 10                                              → pending
--     5) state=8, 9, 32, 70, 71                                   → refund/cancel
--
-- 권한 부여:
--   plan_type 결정 우선순위:
--     A) payment_orders.plan_type (있으면 그대로)
--     B) users.account_type → individual/business/artist 매핑
--        artist 계정도 4,900원 결제 → membership_tier='individual' (artist 5단계
--        업로드 게이트가 이 tier 를 기반으로 권한 부여)
--
-- 변경:
--   1) _internal_apply_payapp_event 라우터 — state=4+approval_no 도 paid 경로로
--   2) admin_replay_webhook_by_mul_no — 동일 정책 적용
--   3) _payapp_webhook_event_compute 트리거 — paid_candidate 의미 보강
--      (state=4+approval_no 가 아직 적용 안 됐을 때만 true)
-- ============================================

-- ----------------------
-- 1) 라우터 업데이트 — state=4+approval_no 도 paid
-- ----------------------
drop function if exists public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text);

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
  p_source text default 'unknown'
)
returns table(
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
  v_is_state_4_paid boolean := (
    p_pay_state = 4
    and p_approval_no is not null
    and length(btrim(p_approval_no)) > 0
    and coalesce(p_amount, 0) > 0
  );
begin
  -- paid: state=64 OR (state=4 + approval_no + amount>0)
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
      p_approval_no := p_approval_no,
      p_goodname := p_goodname,
      p_order_no := p_order_no,
      p_source := case when v_is_state_4_paid then p_source || '+state4_approval' else p_source end
    );
    return query select
      v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier,
      'paid'::text, v_result.message;
    return;
  end if;

  -- refund / cancel
  if p_pay_state in (8, 9, 32, 70, 71) then
    select * into v_result from public._internal_apply_payapp_refund_event(
      p_payapp_mul_no := p_payapp_mul_no,
      p_pay_state := p_pay_state,
      p_event_at := p_event_at,
      p_source := p_source
    );
    return query select
      v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier,
      case when p_pay_state in (9,70,71) then 'refunded' else 'canceled' end,
      v_result.message;
    return;
  end if;

  -- pending (1, 10, 또는 state=4 with no approval_no)
  if p_pay_state in (1, 4, 10) then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      'pending'::text,
      ('pending state ' || p_pay_state || ' (' || public._payapp_state_label(p_pay_state) ||
       ') — no membership change' ||
       case when p_pay_state = 4 then ' (no approval_no)' else '' end)::text;
    return;
  end if;

  -- unknown
  return query select null::uuid, null::uuid, null::uuid, false, null::text,
    'unknown'::text,
    ('unknown pay_state ' || p_pay_state)::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text) to service_role;

-- ----------------------
-- 2) admin_replay_webhook_by_mul_no — 라우터 호출이므로 자동 정책 반영 (재선언만)
--    필요 시 0036 의 본문 재선언. 0036/0038 이 모두 적용된 환경이면 no-op.
-- ----------------------
-- (라우터가 정책을 판단하므로 replay 함수 본문 변경 불필요)

-- ----------------------
-- 3) 백필 — state=4 + approval_no + membership_updated=false 행을 자동 paid 처리
-- ----------------------
do $$
declare
  v_event record;
  v_payload jsonb;
  v_amount integer;
  v_plan_type text;
  v_processed int := 0;
  v_paid int := 0;
  v_error int := 0;
  v_apply record;
begin
  raise notice '== 0040 백필: state=4 + approval_no 자동 paid 처리 ==';
  for v_event in
    select e.*
    from public.payapp_webhook_events as e
    where e.pay_state = 4
      and e.approval_no is not null
      and length(btrim(e.approval_no)) > 0
      and coalesce(e.membership_updated, false) = false
      and coalesce(e.price, 0) > 0
    order by e.created_at asc
  loop
    v_processed := v_processed + 1;
    v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);
    v_amount := coalesce(v_event.price,
      nullif(v_payload->>'price','')::integer,
      nullif(v_payload->>'amount','')::integer);
    v_plan_type := case when v_amount = 6900 then 'business' else 'individual' end;

    begin
      select * into v_apply from public._internal_apply_payapp_event(
        p_payapp_mul_no := v_event.payapp_mul_no,
        p_pay_state := 4,
        p_amount := v_amount,
        p_plan_type := v_plan_type,
        p_buyer_email := nullif(lower(coalesce(
          v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email','')), ''),
        p_buyer_phone := nullif(coalesce(
          v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
          v_payload->>'hp', v_payload->>'cellphone', ''), ''),
        p_event_at := coalesce(
          nullif(v_payload->>'paid_at','')::timestamptz,
          nullif(v_payload->>'pay_date','')::timestamptz,
          v_event.created_at, now()),
        p_approval_no := v_event.approval_no,
        p_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname'),
        p_order_no := v_event.order_no,
        p_source := 'backfill_0040'
      );
      if v_apply.membership_updated then
        v_paid := v_paid + 1;
        update public.payapp_webhook_events as e
        set matched_user_id = v_apply.matched_user_id,
            matched_order_id = v_apply.matched_order_id,
            matched_subscription_id = v_apply.matched_subscription_id,
            membership_updated = true,
            final_membership_tier = v_apply.final_membership_tier,
            paid_candidate = false,
            processing_error = null,
            processed_at = coalesce(e.processed_at, now())
        where e.id = v_event.id;
      end if;
    exception when others then
      v_error := v_error + 1;
      raise notice '  backfill error mul_no=% : %', v_event.payapp_mul_no, sqlerrm;
    end;
  end loop;
  raise notice '== backfill done: processed=%, paid=%, error=% ==', v_processed, v_paid, v_error;
end$$;

-- 확인
select
  'router_includes_state4_paid=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%v_is_state_4_paid%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='_internal_apply_payapp_event')
        then 'OK' else 'MISSING' end) as check_1,
  'state4_paid_events=' ||
  (select count(*)::text from public.payapp_webhook_events
   where pay_state=4 and approval_no is not null and membership_updated=true) as check_2;
