-- ============================================
-- 0030_webhook_phone_match_fix.sql
--
-- 운영 진단:
--   - artist_profiles.phone='01023209997'  (숫자만)
--   - payapp webhook buyer phone='010-2320-9997' (하이픈)
--   - admin_replay_webhook_event 가 raw_payload 에서 phone 추출 시 후보 키가
--     recvphone/buyer_phone/phone 3개 뿐이라, PayApp 가 다른 키(hp/cellphone 등)
--     를 사용하면 phone 추출 실패 → _internal 이 phone 매칭을 시도조차 안 함.
--
-- 수정:
--   1) _internal_apply_payapp_paid_event:
--      - phone 정규화 regex 를 명시적 [^0-9] 로 변경 (\D 대신)
--      - 매칭 실패 시 어떤 식별자로 시도했는지 message 에 노출
--   2) admin_replay_webhook_event:
--      - phone 후보 키 13개로 확장 (recvphone/phone/buyer_phone/recv_phone/
--        reqphone/hp/cellphone/tel/mobile/receiver_phone + Korean 키)
--      - email 후보도 확장
--   3) webhook event row writeback 시 processing_error 가 NULL 되지 않도록
--      message 를 항상 저장 (membership_updated=false 인 경우).
-- ============================================

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
language plpgsql
security definer
set search_path = public
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
    'applied_at', now()
  );

  -- 숫자만 추출 (명시적 POSIX 문자 클래스)
  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '[^0-9]', '', 'g');

  -- 진단용: 시도한 식별자 종류 기록
  v_tried_keys := format(
    'order_no=%s, mul_no=%s, email=%s, phone_clean=%s',
    coalesce(p_order_no,'∅'),
    v_mul_no,
    case when v_email='' then '∅' else v_email end,
    case when v_phone_clean='' then '∅' else v_phone_clean end
  );

  -- 1) order_no exact
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders po
    where po.order_no = p_order_no
    limit 1;
  end if;

  -- 2) mul_no exact in payment_orders
  if v_user_id is null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders po
    where po.payapp_mul_no = v_mul_no
    limit 1;
  end if;

  -- 3) auth.users.email
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users au
    join public.users u on u.id = au.id
    where lower(au.email) = v_email
    limit 1;
  end if;

  -- 4) users.phone 정확 매칭 (숫자만 정규화)
  if v_user_id is null and v_phone_clean <> '' then
    select u.id into v_user_id
    from public.users u
    where regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    order by u.created_at desc
    limit 1;
  end if;

  -- 5) artist_profiles.phone 정확 매칭 (숫자만 정규화)
  if v_user_id is null and v_phone_clean <> '' then
    select ap.user_id into v_user_id
    from public.artist_profiles ap
    where regexp_replace(coalesce(ap.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    order by ap.created_at desc
    limit 1;
  end if;

  -- 6) 최근 pending/requested/payment_waiting subscription + amount 일치
  if v_user_id is null then
    select s.user_id into v_user_id
    from public.subscriptions s
    where s.status in ('pending','payment_waiting','requested','failed')
      and s.price = p_amount
    order by s.created_at desc
    limit 1;
  end if;

  -- 매칭 실패 — 시도한 식별자 명시
  if v_user_id is null then
    return query select
      null::uuid, null::uuid, null::uuid,
      false, null::text,
      ('no matching user — tried: ' || v_tried_keys)::text;
    return;
  end if;

  -- order 매칭 또는 생성
  if v_order_id is null then
    select po.id into v_order_id
    from public.payment_orders po
    where po.user_id = v_user_id and po.payapp_mul_no = v_mul_no
    limit 1;
  end if;
  if v_order_id is null then
    select po.id into v_order_id
    from public.payment_orders po
    where po.user_id = v_user_id
      and po.status in ('requested','waiting','failed','pending')
    order by po.created_at desc
    limit 1;
  end if;
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (v_user_id,
       coalesce(p_order_no, 'auto_' || v_mul_no),
       p_plan_type, p_amount, 'paid', v_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

  -- subscription
  select s.id into v_sub_id
  from public.subscriptions s
  where s.user_id = v_user_id
  order by
    case s.status
      when 'active' then 0
      when 'pending' then 1
      when 'payment_waiting' then 2
      else 3
    end,
    s.created_at desc
  limit 1;
  if v_sub_id is null then
    insert into public.subscriptions
      (user_id, plan_type, price, status)
    values
      (v_user_id, p_plan_type, p_amount, 'active')
    returning public.subscriptions.id into v_sub_id;
  end if;

  update public.payment_orders as po
  set status = 'paid',
      payapp_mul_no = v_mul_no,
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status = 'active',
      plan_type = p_plan_type,
      price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month'
  where s.id = v_sub_id;

  update public.users as u
  set membership_tier = p_plan_type,
      subscription_type = p_plan_type
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users u where u.id = v_user_id;

  return query select
    v_user_id, v_order_id, v_sub_id,
    true, v_tier,
    ('membership_tier=' || coalesce(v_tier,'?') || ' applied (matched via: ' || v_tried_keys || ')')::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) to service_role;

-- ----------------------
-- admin_replay_webhook_event — phone/email 후보 키 대폭 확장
-- ----------------------
create or replace function public.admin_replay_webhook_event(p_event_id uuid)
returns table(
  matched_user_id uuid,
  matched_order_id uuid,
  matched_subscription_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_event public.payapp_webhook_events%rowtype;
  v_payload jsonb;
  v_amount integer;
  v_plan_type text;
  v_email text;
  v_phone text;
  v_goodname text;
  v_approval_no text;
  v_paid_at timestamptz;
  v_result record;
begin
  select exists(select 1 from public.users u where u.id = auth.uid() and u.role='admin') into v_admin;
  if not v_admin then raise exception 'admin only'; end if;

  select * into v_event from public.payapp_webhook_events e where e.id = p_event_id;
  if not found then raise exception 'event not found'; end if;

  v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);

  v_amount := coalesce(v_event.price,
    nullif(v_payload->>'price','')::integer,
    nullif(v_payload->>'amount','')::integer);

  if v_amount = 4900 then v_plan_type := 'individual';
  elsif v_amount = 6900 then v_plan_type := 'business';
  else
    raise exception 'unsupported amount % (event_id=%)', v_amount, p_event_id;
  end if;

  -- email 후보 확장
  v_email := nullif(lower(coalesce(
    v_payload->>'recvemail',
    v_payload->>'buyer_email',
    v_payload->>'email',
    v_payload->>'recv_email',
    v_payload->>'useremail',
    v_payload->>'reqemail',
    v_payload->>'구매자이메일',
    ''
  )), '');

  -- phone 후보 확장 (13개)
  v_phone := nullif(coalesce(
    v_payload->>'recvphone',
    v_payload->>'phone',
    v_payload->>'buyer_phone',
    v_payload->>'recv_phone',
    v_payload->>'reqphone',
    v_payload->>'hp',
    v_payload->>'cellphone',
    v_payload->>'tel',
    v_payload->>'mobile',
    v_payload->>'receiver_phone',
    v_payload->>'receiverphone',
    v_payload->>'구매자번호',
    v_payload->>'구매자전화번호',
    ''
  ), '');

  v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');
  v_approval_no := coalesce(
    v_payload->>'approval_no',
    v_payload->>'apv_no',
    v_payload->>'card_apv_no',
    v_payload->>'승인번호'
  );
  v_paid_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    v_event.created_at,
    now()
  );

  select * into v_result from public._internal_apply_payapp_paid_event(
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_amount := v_amount,
    p_plan_type := v_plan_type,
    p_buyer_email := v_email,
    p_buyer_phone := v_phone,
    p_paid_at := v_paid_at,
    p_approval_no := v_approval_no,
    p_goodname := v_goodname,
    p_order_no := v_event.order_no,
    p_source := 'replay_event'
  );

  -- webhook event row writeback — processing_error 는 항상 message 로 채움 (실패 시)
  update public.payapp_webhook_events as e
  set matched_user_id = v_result.matched_user_id,
      matched_order_id = v_result.matched_order_id,
      matched_subscription_id = v_result.matched_subscription_id,
      membership_updated = v_result.membership_updated,
      final_membership_tier = v_result.final_membership_tier,
      processing_error = case
        when v_result.membership_updated then null
        else coalesce(v_result.message, 'unknown failure')
      end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select
    v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
    v_result.membership_updated, v_result.final_membership_tier, v_result.message;
end;
$$;

grant execute on function public.admin_replay_webhook_event(uuid) to authenticated;

-- 확인
select
  'internal_explicit_regex=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%[^0-9]%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='_internal_apply_payapp_paid_event')
        then 'OK' else 'MISSING' end) as check_1,
  'replay_phone_candidates_expanded=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%cellphone%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_replay_webhook_event')
        then 'OK' else 'MISSING' end) as check_2;
