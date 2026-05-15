-- ============================================
-- 0036_payapp_state_machine.sql
--
-- PayApp 결제·환불 상태머신 정식 연동.
--
-- 핵심 변경:
--   1) payment_orders / subscriptions / payapp_webhook_events 컬럼 보강
--      (paid_at, canceled_at, refunded_at, payapp_state, payapp_state_label,
--       state_label)
--   2) status CHECK 완화 — 'refunded' / 'cancelled' / 'pending' 추가
--   3) _internal_apply_payapp_paid_event — paid_at 컬럼 채우도록 보강
--   4) _internal_apply_payapp_refund_event — 신규. 환불/취소 처리
--   5) _internal_apply_payapp_event — 라우터. state 에 따라 paid/refund/pending 분기
--   6) admin_replay_webhook_by_mul_no — 모든 이벤트 시간순 재처리.
--      반환값: final_status / processed_count / paid_count / refund_count /
--              pending_count / error_count
--
-- State map:
--   pending  : 1, 4, 10        → payment pending, membership 변경 없음
--   paid     : 64              → payment paid, subscription active, membership=plan
--   cancel   : 8, 32           → payment canceled, sub canceled, membership=free
--   refund   : 9, 70, 71       → payment refunded, sub refunded, membership=free
-- ============================================

-- ----------------------
-- 1) 컬럼 보강 (멱등)
-- ----------------------
alter table public.payment_orders
  add column if not exists paid_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists payapp_state integer,
  add column if not exists payapp_state_label text;

alter table public.subscriptions
  add column if not exists refunded_at timestamptz,
  add column if not exists payapp_state_label text;

alter table public.payapp_webhook_events
  add column if not exists state_label text;

-- ----------------------
-- 2) status CHECK 완화 — refunded/cancelled/pending 허용
-- ----------------------
alter table public.payment_orders drop constraint if exists payment_orders_status_check;
alter table public.payment_orders add constraint payment_orders_status_check check (
  status in (
    'requested','pending','paid','canceled','cancelled','failed','waiting','refunded'
  )
);

alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (
  status in (
    'pending','active','canceled','cancelled','failed','expired','payment_waiting','refunded'
  )
);

-- ----------------------
-- 3) state label 매핑 함수
-- ----------------------
create or replace function public._payapp_state_label(p_state integer)
returns text language sql immutable as $$
  select case p_state
    when 1 then '요청수신'
    when 4 then '승인대기'
    when 8 then '요청취소'
    when 9 then '승인취소'
    when 10 then '입금대기'
    when 32 then '요청취소'
    when 64 then '승인완료'
    when 70 then '환불'
    when 71 then '환불'
    else 'unknown'
  end;
$$;

-- ----------------------
-- 4) _internal_apply_payapp_paid_event — paid_at 컬럼 채우도록 보강
--    기존 0030 의 본문을 그대로 유지하되 payment_orders.paid_at /
--    payapp_state / payapp_state_label 추가 set.
-- ----------------------
create or replace function public._internal_apply_payapp_paid_event(
  p_payapp_mul_no text,
  p_amount integer,
  p_plan_type text,
  p_buyer_email text default null,
  p_buyer_phone text default null,
  p_paid_at timestamptz default now(),
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
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_sub_id uuid;
  v_phone_clean text;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  v_email text := lower(btrim(coalesce(p_buyer_email, '')));
  v_payload jsonb;
  v_tier text;
  v_tried_keys text;
begin
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  if p_plan_type not in ('individual','business') then raise exception 'invalid plan_type'; end if;

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no,
    'approval_no', p_approval_no,
    'buyer_email', p_buyer_email,
    'buyer_phone', p_buyer_phone,
    'amount', p_amount,
    'plan_type', p_plan_type,
    'goodname', p_goodname,
    'paid_at', p_paid_at,
    'source', p_source,
    'pay_state', 64,
    'state_label', '승인완료',
    'applied_at', now()
  );

  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '[^0-9]', '', 'g');
  v_tried_keys := format(
    'order_no=%s, mul_no=%s, email=%s, phone_clean=%s',
    coalesce(p_order_no,'∅'), v_mul_no,
    case when v_email='' then '∅' else v_email end,
    case when v_phone_clean='' then '∅' else v_phone_clean end
  );

  -- 1) order_no exact
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = p_order_no limit 1;
  end if;

  -- 2) mul_no exact
  if v_user_id is null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.payapp_mul_no = v_mul_no limit 1;
  end if;

  -- 3) email
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users as au join public.users as u on u.id = au.id
    where lower(au.email) = v_email limit 1;
  end if;

  -- 4) users.phone
  if v_user_id is null and v_phone_clean <> '' then
    select u.id into v_user_id from public.users as u
    where regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    order by u.created_at desc limit 1;
  end if;

  -- 5) artist_profiles.phone
  if v_user_id is null and v_phone_clean <> '' then
    select ap.user_id into v_user_id from public.artist_profiles as ap
    where regexp_replace(coalesce(ap.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    order by ap.created_at desc limit 1;
  end if;

  if v_user_id is null then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      ('no matching user — tried: ' || v_tried_keys)::text;
    return;
  end if;

  -- order 매칭 또는 생성
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders as po
    where po.user_id = v_user_id and po.payapp_mul_no = v_mul_no limit 1;
  end if;
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders as po
    where po.user_id = v_user_id and po.status in ('requested','waiting','failed','pending')
    order by po.created_at desc limit 1;
  end if;
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response,
       paid_at, payapp_state, payapp_state_label)
    values
      (v_user_id, coalesce(p_order_no, 'auto_' || v_mul_no),
       p_plan_type, p_amount, 'paid', v_mul_no, v_payload,
       p_paid_at, 64, '승인완료')
    returning public.payment_orders.id into v_order_id;
  end if;

  -- subscription 매칭 또는 생성
  select s.id into v_sub_id from public.subscriptions as s where s.user_id = v_user_id
  order by case s.status when 'active' then 0 when 'pending' then 1
                          when 'payment_waiting' then 2 else 3 end, s.created_at desc
  limit 1;
  if v_sub_id is null then
    insert into public.subscriptions
      (user_id, plan_type, price, status, last_paid_at, current_period_start, current_period_end,
       payapp_mul_no, payapp_state_label)
    values
      (v_user_id, p_plan_type, p_amount, 'active', p_paid_at, p_paid_at, p_paid_at + interval '1 month',
       v_mul_no, '승인완료')
    returning public.subscriptions.id into v_sub_id;
  end if;

  -- 적용
  update public.payment_orders as po
  set status = 'paid',
      payapp_mul_no = v_mul_no,
      paid_at = coalesce(po.paid_at, p_paid_at),
      payapp_state = 64,
      payapp_state_label = '승인완료',
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status = 'active',
      plan_type = p_plan_type,
      price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      payapp_state_label = '승인완료',
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month',
      -- 재활성화 시 cancel/refund 시각 클리어
      canceled_at = null,
      refunded_at = null
  where s.id = v_sub_id;

  update public.users as u
  set membership_tier = p_plan_type,
      subscription_type = p_plan_type
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    ('membership_tier=' || coalesce(v_tier,'?') || ' applied (matched via: ' || v_tried_keys || ')')::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) to service_role;

-- ----------------------
-- 5) _internal_apply_payapp_refund_event — 신규
-- ----------------------
create or replace function public._internal_apply_payapp_refund_event(
  p_payapp_mul_no text,
  p_pay_state integer,
  p_event_at timestamptz default now(),
  p_source text default 'unknown'
)
returns table(
  matched_user_id uuid,
  matched_order_id uuid,
  matched_subscription_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_sub_id uuid;
  v_now timestamptz := now();
  v_is_refund boolean := p_pay_state in (9, 70, 71);
  v_target_status text;
  v_label text;
  v_payload jsonb;
  v_tier text;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
begin
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  v_target_status := case when v_is_refund then 'refunded' else 'canceled' end;
  v_label := public._payapp_state_label(p_pay_state);

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no,
    'pay_state', p_pay_state,
    'state_label', v_label,
    'event_at', p_event_at,
    'source', p_source,
    'is_refund', v_is_refund,
    'applied_at', v_now
  );

  -- mul_no 로 사용자/주문 매칭
  select po.user_id, po.id, po.subscription_id
    into v_user_id, v_order_id, v_sub_id
  from public.payment_orders as po
  where po.payapp_mul_no = v_mul_no
  order by po.created_at desc
  limit 1;

  if v_user_id is null then
    -- 결제 기록 없는 환불은 매칭 불가
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      ('cannot refund: no payment_order matched for mul_no=' || v_mul_no)::text;
    return;
  end if;

  -- payment_orders 업데이트
  update public.payment_orders as po
  set status = v_target_status,
      payapp_state = p_pay_state,
      payapp_state_label = v_label,
      canceled_at = case when not v_is_refund then v_now else po.canceled_at end,
      refunded_at = case when v_is_refund then v_now else po.refunded_at end,
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  -- subscription 매칭 (order 에 없으면 user 의 active 찾기)
  if v_sub_id is null then
    select s.id into v_sub_id
    from public.subscriptions as s
    where s.user_id = v_user_id
    order by
      case s.status when 'active' then 0 when 'pending' then 1
                    when 'payment_waiting' then 2 else 3 end,
      s.created_at desc
    limit 1;
  end if;

  if v_sub_id is not null then
    update public.subscriptions as s
    set status = v_target_status,
        payapp_state_label = v_label,
        canceled_at = case when not v_is_refund then v_now else s.canceled_at end,
        refunded_at = case when v_is_refund then v_now else s.refunded_at end
    where s.id = v_sub_id;
  end if;

  -- 권한 회수
  update public.users as u
  set membership_tier = 'free',
      subscription_type = 'free'
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    (v_target_status || ' applied (state=' || p_pay_state || '/' || v_label || ', tier=' || coalesce(v_tier,'?') || ')')::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_refund_event(text, integer, timestamptz, text) from public;
grant execute on function public._internal_apply_payapp_refund_event(text, integer, timestamptz, text) to service_role;

-- ----------------------
-- 6) _internal_apply_payapp_event — 라우터
-- ----------------------
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
begin
  -- paid (64)
  if p_pay_state = 64 then
    if p_amount is null then
      return query select null::uuid, null::uuid, null::uuid, false, null::text, 'paid'::text,
        'paid event missing amount'::text;
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
      p_source := p_source
    );
    return query select
      v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier,
      'paid'::text, v_result.message;
    return;
  end if;

  -- refund / cancel (8, 9, 32, 70, 71)
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

  -- pending (1, 4, 10) — membership 변경 없음
  if p_pay_state in (1, 4, 10) then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      'pending'::text,
      ('pending state ' || p_pay_state || ' (' || public._payapp_state_label(p_pay_state) || ') — no membership change')::text;
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
-- 7) admin_replay_webhook_by_mul_no — 모든 이벤트 시간순 재처리
-- ----------------------
drop function if exists public.admin_replay_webhook_by_mul_no(text);
create or replace function public.admin_replay_webhook_by_mul_no(p_mul_no text)
returns table(
  matched_user_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  final_status text,
  processed_count integer,
  paid_count integer,
  refund_count integer,
  pending_count integer,
  error_count integer,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_event record;
  v_apply record;
  v_payload jsonb;
  v_amount integer;
  v_plan_type text;
  v_email text;
  v_phone text;
  v_goodname text;
  v_approval_no text;
  v_event_at timestamptz;
  v_processed int := 0;
  v_paid int := 0;
  v_refund int := 0;
  v_pending int := 0;
  v_errors int := 0;
  v_last_user_id uuid;
  v_last_tier text := 'free';
  v_last_status text := 'unknown';
begin
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  for v_event in
    select e.*
    from public.payapp_webhook_events as e
    where e.payapp_mul_no = btrim(p_mul_no)
    order by e.created_at asc
  loop
    v_processed := v_processed + 1;
    v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);
    v_amount := coalesce(
      v_event.price,
      nullif(v_payload->>'price','')::integer,
      nullif(v_payload->>'amount','')::integer
    );
    v_plan_type := case
      when v_amount = 4900 then 'individual'
      when v_amount = 6900 then 'business'
      else 'individual'
    end;
    v_email := nullif(lower(coalesce(
      v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
      v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
      v_payload->>'구매자이메일', ''
    )), '');
    v_phone := nullif(coalesce(
      v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
      v_payload->>'recv_phone', v_payload->>'reqphone',
      v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
      v_payload->>'receiver_phone', v_payload->>'receiverphone',
      v_payload->>'구매자번호', v_payload->>'구매자전화번호', ''
    ), '');
    v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');
    v_approval_no := coalesce(v_payload->>'approval_no', v_payload->>'apv_no',
                              v_payload->>'card_apv_no', v_payload->>'승인번호');
    v_event_at := coalesce(
      nullif(v_payload->>'paid_at','')::timestamptz,
      nullif(v_payload->>'pay_date','')::timestamptz,
      nullif(v_payload->>'paydate','')::timestamptz,
      nullif(v_payload->>'cancel_at','')::timestamptz,
      nullif(v_payload->>'canceldate','')::timestamptz,
      nullif(v_payload->>'refunded_at','')::timestamptz,
      nullif(v_payload->>'refunddate','')::timestamptz,
      v_event.created_at,
      now()
    );

    begin
      select * into v_apply from public._internal_apply_payapp_event(
        p_payapp_mul_no := v_event.payapp_mul_no,
        p_pay_state := v_event.pay_state,
        p_amount := v_amount,
        p_plan_type := v_plan_type,
        p_buyer_email := v_email,
        p_buyer_phone := v_phone,
        p_event_at := v_event_at,
        p_approval_no := v_approval_no,
        p_goodname := v_goodname,
        p_order_no := v_event.order_no,
        p_source := 'replay_by_mul_no'
      );

      if v_apply.final_status = 'paid' then v_paid := v_paid + 1;
      elsif v_apply.final_status in ('refunded','canceled') then v_refund := v_refund + 1;
      elsif v_apply.final_status = 'pending' then v_pending := v_pending + 1;
      end if;

      if v_apply.matched_user_id is not null then
        v_last_user_id := v_apply.matched_user_id;
        v_last_tier := coalesce(v_apply.final_membership_tier, v_last_tier);
      end if;
      v_last_status := v_apply.final_status;

      -- writeback event row
      update public.payapp_webhook_events as e
      set matched_user_id = coalesce(e.matched_user_id, v_apply.matched_user_id),
          matched_order_id = coalesce(e.matched_order_id, v_apply.matched_order_id),
          matched_subscription_id = coalesce(e.matched_subscription_id, v_apply.matched_subscription_id),
          membership_updated = v_apply.membership_updated,
          final_membership_tier = v_apply.final_membership_tier,
          state_label = public._payapp_state_label(e.pay_state),
          processing_error = case when v_apply.membership_updated then null else v_apply.message end,
          processed_at = coalesce(e.processed_at, now())
      where e.id = v_event.id;
    exception when others then
      v_errors := v_errors + 1;
      update public.payapp_webhook_events as e
      set processing_error = sqlerrm,
          processed_at = coalesce(e.processed_at, now())
      where e.id = v_event.id;
    end;
  end loop;

  return query select
    v_last_user_id,
    (v_last_tier is not null and v_last_tier <> 'free'),
    coalesce(v_last_tier, 'free'),
    v_last_status,
    v_processed, v_paid, v_refund, v_pending, v_errors,
    format(
      'processed %s events (%s paid, %s refund/cancel, %s pending, %s errors). final tier=%s, status=%s',
      v_processed, v_paid, v_refund, v_pending, v_errors,
      coalesce(v_last_tier, 'free'), v_last_status
    );
end;
$$;

grant execute on function public.admin_replay_webhook_by_mul_no(text) to authenticated;

-- ----------------------
-- 8) admin_replay_webhook_event — 라우터 사용하도록 보강 (refund 도 처리)
-- ----------------------
drop function if exists public.admin_replay_webhook_event(uuid);
create or replace function public.admin_replay_webhook_event(p_event_id uuid)
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

  v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);
  v_amount := coalesce(v_event.price,
    nullif(v_payload->>'price','')::integer,
    nullif(v_payload->>'amount','')::integer);
  v_plan_type := case
    when v_amount = 4900 then 'individual'
    when v_amount = 6900 then 'business'
    else 'individual'
  end;
  v_email := nullif(lower(coalesce(
    v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
    v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
    v_payload->>'구매자이메일', '')), '');
  v_phone := nullif(coalesce(
    v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
    v_payload->>'recv_phone', v_payload->>'reqphone',
    v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
    v_payload->>'receiver_phone', v_payload->>'receiverphone',
    v_payload->>'구매자번호', v_payload->>'구매자전화번호', ''
  ), '');
  v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');
  v_approval_no := coalesce(v_payload->>'approval_no', v_payload->>'apv_no',
                            v_payload->>'card_apv_no', v_payload->>'승인번호');
  v_event_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    nullif(v_payload->>'cancel_at','')::timestamptz,
    nullif(v_payload->>'canceldate','')::timestamptz,
    nullif(v_payload->>'refunded_at','')::timestamptz,
    v_event.created_at, now()
  );

  select * into v_result from public._internal_apply_payapp_event(
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_pay_state := v_event.pay_state,
    p_amount := v_amount,
    p_plan_type := v_plan_type,
    p_buyer_email := v_email,
    p_buyer_phone := v_phone,
    p_event_at := v_event_at,
    p_approval_no := v_approval_no,
    p_goodname := v_goodname,
    p_order_no := v_event.order_no,
    p_source := 'replay_event'
  );

  update public.payapp_webhook_events as e
  set matched_user_id = v_result.matched_user_id,
      matched_order_id = v_result.matched_order_id,
      matched_subscription_id = v_result.matched_subscription_id,
      membership_updated = v_result.membership_updated,
      final_membership_tier = v_result.final_membership_tier,
      state_label = public._payapp_state_label(e.pay_state),
      processing_error = case when v_result.membership_updated then null
                              else coalesce(v_result.message, 'unknown failure') end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select
    v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
    v_result.membership_updated, v_result.final_membership_tier,
    v_result.final_status, v_result.message;
end;
$$;

grant execute on function public.admin_replay_webhook_event(uuid) to authenticated;

-- ----------------------
-- 9) list_recent_webhook_events 에 state_label 컬럼 노출
-- ----------------------
drop function if exists public.list_recent_webhook_events(text, int, int);
create or replace function public.list_recent_webhook_events(
  p_search text default null,
  p_minutes int default 60,
  p_limit int default 50
)
returns table(
  id uuid, event_key text, order_no text, user_id uuid,
  payapp_mul_no text, payapp_rebill_no text,
  pay_state integer, state_label text,
  price integer, linkval_verified boolean,
  processed_at timestamptz, reasons text,
  matched_user_id uuid, matched_user_email text,
  matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text,
  processing_error text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_search text := btrim(coalesce(p_search, ''));
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;
  return query
  select e.id, e.event_key, e.order_no, e.user_id, e.payapp_mul_no, e.payapp_rebill_no,
         e.pay_state,
         coalesce(e.state_label, public._payapp_state_label(e.pay_state)) as state_label,
         e.price, e.linkval_verified, e.processed_at,
         coalesce(e.raw_payload->'_verification'->>'reasons','')::text as reasons,
         e.matched_user_id, au.email::text as matched_user_email,
         e.matched_order_id, e.matched_subscription_id,
         e.membership_updated, e.final_membership_tier, e.processing_error,
         e.created_at
  from public.payapp_webhook_events as e
  left join auth.users as au on au.id = e.matched_user_id
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (
      v_search = '' or e.payapp_mul_no = v_search or e.order_no = v_search
      or e.raw_payload::text ilike '%' || v_search || '%'
    )
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_webhook_events(text, int, int) to authenticated;

-- ----------------------
-- 확인
-- ----------------------
select
  'router_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_apply_payapp_event')
    then 'OK' else 'MISSING' end) as check_1,
  'refund_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_apply_payapp_refund_event')
    then 'OK' else 'MISSING' end) as check_2,
  'state_label_fn=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_payapp_state_label')
    then 'OK' else 'MISSING' end) as check_3,
  'payment_orders_paid_at=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_orders' and column_name='paid_at')
    then 'OK' else 'MISSING' end) as check_4,
  'subs_refunded_at=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='subscriptions' and column_name='refunded_at')
    then 'OK' else 'MISSING' end) as check_5;
