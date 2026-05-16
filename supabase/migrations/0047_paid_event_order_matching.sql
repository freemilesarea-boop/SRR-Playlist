-- ============================================
-- 0047_paid_event_order_matching.sql
--
-- 운영 증상:
--   PaymentSuccessPage 가 보는 원 payment_orders.order_no='swk_<uid>_<rand>'
--   는 'requested' 로 남아있고, webhook 결제완료 처리 시 별도 auto_<mul_no>
--   order 가 생성되거나 다른 user 의 다른 order 가 paid 로 업데이트되는 케이스.
--
--   원인 후보:
--   (a) PayApp webhook payload 에 var1=order_no 가 누락/다른 키로 들어옴
--       → EF 가 p_order_no=null 로 RPC 호출
--   (b) RPC 매칭이 email/phone 으로 user_id 만 잡고, 그 user 의 다른 requested
--       order (또는 신규 auto_) 를 paid 로 만듦
--   (c) 원 swk_ order 와 webhook 의 email/phone 매칭 user 가 다름
--
-- 수정:
--   1) _internal_apply_payapp_paid_event 가 p_raw_payload jsonb 도 받음
--      → 어떤 키에 들어와도 jsonb 값 전체를 정규식 스캔해서
--        ^swk_[0-9a-f]{8}_... 패턴 추출 가능.
--   2) 매칭 우선순위 재정의 (강한 식별자 우선):
--        priority 1: p_order_no 정확 매치
--        priority 2: raw_payload 안 어디든 swk_ 패턴 → payment_orders.order_no
--        priority 3: payapp_mul_no 가 이미 payment_orders 에 존재
--        priority 4: email 매칭 → 그 user 의 status='requested'+plan+amount
--                    AND 최근 60분 이내 (잘못된 오래된 order 갱신 방지)
--        priority 5: phone (users / artist_profiles)
--   3) raw_payload 가 swk_ order 를 가리키는데 email/phone 매칭으로 잡힌
--      user_id 가 그 order.user_id 와 다르면 → order 의 user_id 가 진실,
--      operation_logs 에 warning 기록.
--   4) auto_<mul_no> order 신규 생성은 (status in ('requested','pending','waiting')
--      AND 최근 60분 이내 user_id 매치 후보 없음) 일 때만.
--   5) admin_backfill_paid_order_by_mul_no(p_mul_no) RPC 신설 — 운영자가 SQL/UI
--      에서 1회 실행해서 기존 webhook event 의 raw_payload 로 원 swk_ order 를
--      paid 로 강제 reconcile.
--
-- 이전 시그니처와 호환:
--   _internal_apply_payapp_event 는 p_raw_payload 를 새 default-null 파라미터로
--   추가만. 기존 호출(EF / 다른 RPC) 그대로 동작. EF 가 명시적으로 raw_payload
--   전달하면 강한 매칭 적용.
-- ============================================

drop function if exists public._internal_apply_payapp_paid_event cascade;
drop function if exists public._internal_apply_payapp_event cascade;

-- ---------- paid 적용 (단일 매칭 진실 — order_no/raw_payload swk_ 추출 우선) ----------
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
  p_source text default 'unknown',
  p_raw_payload jsonb default null
) returns table(
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
  v_scanned_order_no text;
  v_email_user_id uuid;
  v_phone_user_id uuid;
  v_match_source text := '';
  v_warn text := null;
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

  -- priority 2 사전 처리: raw_payload 안 어떤 키든 swk_<uid8>_<token>_<token> 패턴 스캔
  if p_raw_payload is not null then
    select (regexp_match(
        jsonb_path_query_first(
          p_raw_payload,
          '$.*'  -- 모든 top-level 값을 string 으로 합쳐서 검색
        )::text || ' ' || p_raw_payload::text,
        'swk_[0-9a-fA-F]{8}_[a-zA-Z0-9]+_[a-zA-Z0-9]+'
      ))[1] into v_scanned_order_no;
  end if;

  v_tried_keys := format(
    'order_no=%s, scanned_order_no=%s, mul_no=%s, email=%s, phone_clean=%s',
    coalesce(p_order_no,'∅'),
    coalesce(v_scanned_order_no,'∅'),
    v_mul_no,
    case when v_email='' then '∅' else v_email end,
    case when v_phone_clean='' then '∅' else v_phone_clean end
  );

  -- ===== 매칭 우선순위 =====

  -- 1) p_order_no exact (EF 가 var1/order_no 등을 추출해서 전달한 경우 — 강한 매치)
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = p_order_no limit 1;
    if v_user_id is not null then v_match_source := 'order_no_exact'; end if;
  end if;

  -- 2) raw_payload 안 swk_ 패턴 → payment_orders.order_no 매치
  if v_user_id is null and v_scanned_order_no is not null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = v_scanned_order_no limit 1;
    if v_user_id is not null then v_match_source := 'raw_payload_scan'; end if;
  end if;

  -- 3) payapp_mul_no 가 이미 payment_orders 에 존재
  if v_user_id is null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.payapp_mul_no = v_mul_no limit 1;
    if v_user_id is not null then v_match_source := 'mul_no_existing'; end if;
  end if;

  -- 4) email → user_id, 그 user 의 status in (requested/pending/waiting) +
  --    plan_type=p_plan_type + amount=p_amount + 최근 60분 이내 order
  if v_user_id is null and v_email <> '' then
    select u.id into v_email_user_id
    from auth.users as au join public.users as u on u.id = au.id
    where lower(au.email) = v_email limit 1;
    if v_email_user_id is not null then
      select po.id into v_order_id from public.payment_orders as po
      where po.user_id = v_email_user_id
        and po.status in ('requested','pending','waiting')
        and po.plan_type = p_plan_type
        and po.amount = p_amount
        and po.created_at >= now() - interval '60 minutes'
      order by po.created_at desc limit 1;
      if v_order_id is not null then
        v_user_id := v_email_user_id;
        v_match_source := 'email+recent_requested';
      end if;
    end if;
  end if;

  -- 5) phone → user_id 동일한 fallback
  if v_user_id is null and v_phone_clean <> '' then
    select u.id into v_phone_user_id from public.users as u
    where regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    order by u.created_at desc limit 1;
    if v_phone_user_id is null then
      select ap.user_id into v_phone_user_id from public.artist_profiles as ap
      where regexp_replace(coalesce(ap.phone,''), '[^0-9]', '', 'g') = v_phone_clean
      order by ap.created_at desc limit 1;
    end if;
    if v_phone_user_id is not null then
      select po.id into v_order_id from public.payment_orders as po
      where po.user_id = v_phone_user_id
        and po.status in ('requested','pending','waiting')
        and po.plan_type = p_plan_type
        and po.amount = p_amount
        and po.created_at >= now() - interval '60 minutes'
      order by po.created_at desc limit 1;
      v_user_id := v_phone_user_id;
      v_match_source := case when v_order_id is not null
                              then 'phone+recent_requested'
                              else 'phone_only' end;
    end if;
  end if;

  -- ===== Cross-check warning =====
  -- order_no/scan 으로 잡힌 order.user_id 와 email/phone 으로 잡힌 user_id 가
  -- 다르면 order 의 user_id 우선 + warning.
  if v_match_source in ('order_no_exact','raw_payload_scan') then
    if v_email_user_id is not null and v_email_user_id <> v_user_id then
      v_warn := coalesce(v_warn,'') || format(
        '[WARN order_no.user_id=%s ≠ email.user_id=%s] ', v_user_id, v_email_user_id);
    end if;
    if v_phone_user_id is not null and v_phone_user_id <> v_user_id then
      v_warn := coalesce(v_warn,'') || format(
        '[WARN order_no.user_id=%s ≠ phone.user_id=%s] ', v_user_id, v_phone_user_id);
    end if;
  end if;

  if v_user_id is null then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      ('no matching user — tried: ' || v_tried_keys)::text;
    return;
  end if;

  -- order 매칭 실패 시 최근 requested order 1회 더 시도 (방어 — strict 60min 외)
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders as po
    where po.user_id = v_user_id
      and po.status in ('requested','pending','waiting','failed')
      and po.plan_type = p_plan_type
    order by po.created_at desc limit 1;
    if v_order_id is not null then
      v_match_source := v_match_source || '+legacy_requested';
    end if;
  end if;

  -- 신규 auto_<mul_no> order 는 정말 후보가 없을 때만
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response,
       paid_at, payapp_state, payapp_state_label)
    values
      (v_user_id, coalesce(p_order_no, 'auto_' || v_mul_no),
       p_plan_type, p_amount, 'paid', v_mul_no, v_payload,
       p_paid_at, 64, '승인완료')
    returning public.payment_orders.id into v_order_id;
    v_match_source := v_match_source || '+created_auto';
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

  -- 적용 — 원 payment_orders (찾았든 새로 만들었든) 를 paid 로 update
  update public.payment_orders as po
  set status = 'paid',
      payapp_mul_no = v_mul_no,
      paid_at = coalesce(po.paid_at, p_paid_at),
      payapp_state = 64,
      payapp_state_label = '승인완료',
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      approval_no = coalesce(po.approval_no, p_approval_no),
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
      canceled_at = null,
      refunded_at = null
  where s.id = v_sub_id;

  update public.users as u
  set membership_tier = p_plan_type,
      subscription_type = p_plan_type
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    ('membership_tier=' || coalesce(v_tier,'?') ||
     ' applied (match=' || v_match_source ||
     case when v_warn is null then '' else ' ' || v_warn end ||
     ' / tried: ' || v_tried_keys || ')')::text;
end;
$$;

grant execute on function public._internal_apply_payapp_paid_event(
  text, integer, text, text, text, timestamptz, text, text, text, text, jsonb
) to service_role;

-- ---------- 라우터 — p_raw_payload pass-through ----------
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
  v_is_state_4_paid boolean := (
    p_pay_state = 4
    and p_approval_no is not null
    and length(btrim(p_approval_no)) > 0
    and coalesce(p_amount, 0) > 0
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
      p_approval_no := p_approval_no,
      p_goodname := p_goodname,
      p_order_no := p_order_no,
      p_source := case when v_is_state_4_paid then p_source || '+state4_approval' else p_source end,
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
       case when p_pay_state = 4 then ' (no approval_no)' else '' end)::text;
    return;
  end if;

  return query select null::uuid, null::uuid, null::uuid, false, null::text,
    'unknown'::text, ('unknown pay_state ' || p_pay_state)::text;
end;
$$;

grant execute on function public._internal_apply_payapp_event(
  text, integer, integer, text, text, text, timestamptz, text, text, text, text, jsonb
) to service_role;

-- ---------- admin 백필: 기존 webhook event 의 raw_payload 로 원 swk_ order 강제 reconcile ----------
drop function if exists public.admin_backfill_paid_order_by_mul_no(text);

create or replace function public.admin_backfill_paid_order_by_mul_no(p_mul_no text)
returns table(
  matched_user_id uuid,
  matched_order_id uuid,
  matched_order_no text,
  final_membership_tier text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_event record;
  v_apply record;
  v_order_no text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  if p_mul_no is null or length(trim(p_mul_no)) = 0 then raise exception 'p_mul_no required'; end if;

  -- 가장 최근 state=64 paid 이벤트 1건
  select * into v_event from public.payapp_webhook_events ev
  where ev.payapp_mul_no = p_mul_no and ev.pay_state = 64
  order by ev.created_at desc limit 1;

  if v_event is null then
    return query select null::uuid, null::uuid, null::text, null::text,
      ('no state=64 webhook event for mul_no=' || p_mul_no)::text;
    return;
  end if;

  -- raw_payload 에서 order_no 후보 추출 (var1 / order_no / orderno / 또는 swk_ 패턴 scan)
  v_order_no := coalesce(
    v_event.raw_payload->>'var1',
    v_event.raw_payload->>'order_no',
    v_event.raw_payload->>'orderno',
    (regexp_match(v_event.raw_payload::text, 'swk_[0-9a-fA-F]{8}_[a-zA-Z0-9]+_[a-zA-Z0-9]+'))[1]
  );

  select * into v_apply from public._internal_apply_payapp_paid_event(
    p_payapp_mul_no := p_mul_no,
    p_amount := coalesce(v_event.price, 0),
    p_plan_type := case when coalesce(v_event.price,0) = 6900 then 'business' else 'individual' end,
    p_buyer_email := v_event.raw_payload->>'recvemail',
    p_buyer_phone := v_event.raw_payload->>'recvphone',
    p_paid_at := coalesce(v_event.created_at, now()),
    p_approval_no := v_event.approval_no,
    p_goodname := v_event.raw_payload->>'goodname',
    p_order_no := v_order_no,
    p_source := 'admin_backfill',
    p_raw_payload := v_event.raw_payload
  );

  -- webhook event 의 matched_user_id / membership_updated 도 갱신해서 운영 UI 동기화
  update public.payapp_webhook_events ev
  set matched_user_id = v_apply.matched_user_id,
      matched_order_id = v_apply.matched_order_id,
      matched_subscription_id = v_apply.matched_subscription_id,
      membership_updated = v_apply.membership_updated,
      final_membership_tier = v_apply.final_membership_tier,
      processing_error = null
  where ev.id = v_event.id;

  return query
  select v_apply.matched_user_id, v_apply.matched_order_id, v_order_no,
         v_apply.final_membership_tier, v_apply.message;
end;
$$;

grant execute on function public.admin_backfill_paid_order_by_mul_no(text) to authenticated;

-- 확인
select
  'paid_event_args=' ||
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_internal_apply_payapp_paid_event') as check_1,
  'router_args=' ||
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_internal_apply_payapp_event') as check_2,
  'backfill_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_backfill_paid_order_by_mul_no')
    then 'OK' else 'MISSING' end) as check_3;
