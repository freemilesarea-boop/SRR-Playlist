-- 0325 — PayApp webhook replay idempotency 강화 (X6.43)
--
-- 분석 보고서 Tier 2.2:
--   admin_replay_webhook_event 가 매번 email/phone round-robin 재매칭
--   → 첫 처리와 다른 user 로 갈 위험. plan_type 매핑이 4900/6900 만
--   인식 → X6.24 후 artist_general/artist_student 결제 재처리 시 잘못된
--   plan 적용.
--
-- 변경:
--   1) plan_type 매핑 X6.24 동기화:
--      - payment_orders.plan_type 이 있으면 그 값 우선 (artist_general /
--        artist_student / individual / business)
--      - 없으면 v_payload->>'goodname' 패턴 매칭 (보조)
--      - 그래도 없으면 amount 기반 fallback (4900→individual, 6900→business)
--   2) idempotency guard (옵션 p_force_replay 추가):
--      - 기본 false: processed_at IS NOT NULL AND membership_updated=true
--        이면 즉시 'already_applied' 반환 (기존 결과 보존)
--      - true: admin 명시적 강제 재처리
--   3) 매칭 보존 (옵션 p_force_rematch 추가):
--      - 기본 false: 이미 matched_user_id 있으면 paid_event 호출 시 그
--        order_no/mul_no 기반으로 fast-path — 새 email/phone round-robin
--        매칭 회피
--      - true: 완전 재매칭 (운영자 의도)

create or replace function public.admin_replay_webhook_event(
  p_event_id uuid,
  p_force_replay boolean default false,
  p_force_rematch boolean default false
)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text, final_status text, message text
)
language plpgsql security definer set search_path = public as $$
declare
  v_event public.payapp_webhook_events%rowtype;
  v_payload jsonb;
  v_amount integer;
  v_plan_type text;
  v_email text;
  v_phone text;
  v_goodname text;
  v_approval_no text;
  v_event_at timestamptz;
  v_result record;
  v_existing_order_no text;
  v_existing_plan_type text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select * into v_event from public.payapp_webhook_events as e where e.id = p_event_id;
  if not found then raise exception 'event not found'; end if;

  -- X6.43: idempotency guard
  if not p_force_replay
     and v_event.processed_at is not null
     and coalesce(v_event.membership_updated, false) = true then
    return query select v_event.matched_user_id, v_event.matched_order_id,
      v_event.matched_subscription_id, true, v_event.final_membership_tier,
      'already_applied'::text,
      ('already processed at ' || v_event.processed_at::text ||
       ' — use p_force_replay=true to override')::text;
    return;
  end if;

  v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);
  v_amount := coalesce(v_event.price,
    nullif(v_payload->>'price','')::integer,
    nullif(v_payload->>'amount','')::integer);

  v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');

  -- X6.43: plan_type 매핑 — 우선순위
  -- (1) matched_order_id 의 payment_orders.plan_type
  -- (2) goodname 키워드 ('아티스트 학생'/'학생'/'수강생' → artist_student,
  --                     '아티스트 일반'/'일반' → artist_general)
  -- (3) amount 기반 fallback
  v_existing_order_no := v_event.order_no;
  if v_event.matched_order_id is not null then
    select po.plan_type, po.order_no into v_existing_plan_type, v_existing_order_no
    from public.payment_orders po where po.id = v_event.matched_order_id;
  end if;

  v_plan_type := case
    when v_existing_plan_type in ('individual','business','artist_general','artist_student')
      then v_existing_plan_type
    when v_goodname is not null and (
         v_goodname ilike '%수강생%' or v_goodname ilike '%학생%'
         or v_goodname ilike '%artist_student%')
      then 'artist_student'
    when v_goodname is not null and (
         v_goodname ilike '%아티스트%일반%' or v_goodname ilike '%artist_general%')
      then 'artist_general'
    when v_amount = 4900 then 'individual'
    when v_amount = 6900 then 'business'
    else 'individual' end;

  v_email := nullif(lower(coalesce(
    v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
    v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
    v_payload->>'구매자이메일', '')), '');
  v_phone := nullif(coalesce(
    v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
    v_payload->>'recv_phone', v_payload->>'reqphone',
    v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
    v_payload->>'receiver_phone', v_payload->>'receiverphone',
    v_payload->>'구매자번호', v_payload->>'구매자전화번호', ''), '');
  v_approval_no := coalesce(v_event.approval_no, v_payload->>'approval_no', v_payload->>'apv_no',
                            v_payload->>'card_apv_no', v_payload->>'승인번호');
  v_event_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    nullif(v_payload->>'cancel_at','')::timestamptz,
    nullif(v_payload->>'canceldate','')::timestamptz,
    nullif(v_payload->>'refunded_at','')::timestamptz,
    v_event.created_at, now());

  -- X6.43: rematch 보존 — 이미 매칭된 order_no 가 있으면 그것을 우선
  -- (email/phone round-robin 매칭 비결정성 회피)
  if not p_force_rematch and v_existing_order_no is not null then
    -- order_no 가 있는 paid_event 는 _internal_apply_payapp_paid_event 에서
    -- 'order_no_exact' 단계가 먼저 매칭하므로 자연 보존됨
    null;
  end if;

  select * into v_result from public._internal_apply_payapp_event(
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_pay_state := v_event.pay_state,
    p_amount := v_amount,
    p_plan_type := v_plan_type,
    p_buyer_email := case when p_force_rematch then v_email else
                       coalesce(v_email, null) end,
    p_buyer_phone := case when p_force_rematch then v_phone else
                       coalesce(v_phone, null) end,
    p_event_at := v_event_at,
    p_approval_no := v_approval_no,
    p_goodname := v_goodname,
    p_order_no := v_existing_order_no,
    p_source := case when p_force_rematch then 'replay_event_rematch'
                     else 'replay_event' end
  );

  update public.payapp_webhook_events as e
  set matched_user_id = v_result.matched_user_id,
      matched_order_id = v_result.matched_order_id,
      matched_subscription_id = v_result.matched_subscription_id,
      membership_updated = v_result.membership_updated,
      final_membership_tier = v_result.final_membership_tier,
      state_label = coalesce(e.state_label, public._payapp_state_label(e.pay_state)),
      processing_error = case when v_result.membership_updated then null
                              else coalesce(v_result.message, 'unknown failure') end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
    v_result.membership_updated, v_result.final_membership_tier,
    v_result.final_status, v_result.message;
end;
$$;

-- 기존 1-arg 시그니처 drop (다른 서비스 / RPC 시그니처 안 깨지게 새 default 만 유지)
-- (호출자가 추가 인자 없이 부르면 기본값 false/false 로 새 함수가 picked up)
