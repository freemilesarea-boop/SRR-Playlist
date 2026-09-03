-- ============================================================================
-- 0495_resume_paused_subscription.sql
--
-- 목적: 구독을 중간에 정지(해지 예약/해지)한 유저가 이전 요금제 기간이 끝나기를
--       기다릴 필요 없이, 언제든 바로 다시 결제해서 유통을 재개할 수 있게 한다.
--
-- 현상(재현):
--   1) 아티스트가 구독 취소 → subscriptions.status='cancel_scheduled',
--      cancel_requested_at=now(). users.membership_tier 는 유예기간(예: 9/14)까지
--      'individual' 로 유지된다.
--   2) 0467 게이트(artist_has_paid_access)는 cancel_requested_at is null 을 요구하므로
--      유통 신청/음원 등록은 그 즉시 막힌다.
--   3) 그런데 화면 판정(get_artist_upload_eligibility.has_paid_membership)은
--      membership_tier 만 보므로 "결제 완료" 로 보이고 재결제 카드가 뜨지 않는다.
--      → 유통도 안 되고 다시 결제할 수도 없는 교착. 유예 종료(9/14)까지 대기.
--
-- 조치(모두 additive · 기존 데이터 미변경):
--   (A) _internal_apply_payapp_paid_event — 결제 성공 시 해지 흔적(cancel_requested_at /
--       cancel_reason / auto_renew=false)까지 지운다. 대체된 이전 정지 구독은 결제시각
--       에서 기간을 끊어, 옛 유예 종료일이 뒤늦게 tier 를 free 로 떨어뜨리지 못하게 한다.
--       ※ 재결제 시점부터 새 결제주기(1개월)가 시작된다. PayApp 정기결제는 등록일
--         기준으로 매월 청구되므로 남은 유예 일수를 청구 주기에 얹지 않는다.
--   (B) get_artist_upload_eligibility — has_paid_membership 을 실제 게이트
--       (artist_has_paid_access)와 일치시킨다. 정지 상태면 재결제 카드가 즉시 노출.
--   (C) expire_my_scheduled_cancellation / admin_expire_scheduled_cancellations —
--       유효한 다른 활성 구독이 있으면 free 로 강등하지 않는다. (재결제 후 옛 유예
--       종료일이 지나면서 방금 결제한 유저를 free 로 떨어뜨리던 문제)
--
-- 안전 원칙:
--   • 신규 청구/환불 없음. PayApp 호출 없음. 결제 금액 로직 불변.
--   • 기존 음원/정산/유통 데이터 미변경.
--   • 게이트를 느슨하게 만들지 않는다 — (B)는 membership_tier 잔존만으로 통과하던
--     경로를 실제 구독 상태 기준으로 좁히는 방향(이미 0467 트리거가 막던 대상).
--   • 함수 시그니처 불변 → 오버로드 생성 없음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 결제 성공 적용 — 해지 흔적 제거 + 잔여 기간 이관
--     0482 본문 유지 + 0495 주석 표시 구간만 변경.
-- ----------------------------------------------------------------------------
create or replace function public._internal_apply_payapp_paid_event(
  p_payapp_mul_no text,
  p_amount integer,
  p_plan_type text,
  p_buyer_email text default null::text,
  p_buyer_phone text default null::text,
  p_paid_at timestamp with time zone default now(),
  p_approval_no text default null::text,
  p_goodname text default null::text,
  p_order_no text default null::text,
  p_source text default 'unknown'::text,
  p_raw_payload jsonb default null::jsonb
)
returns table(matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
              membership_updated boolean, final_membership_tier text, message text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_user_id uuid; v_order_id uuid; v_sub_id uuid;
  v_phone_clean text;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  v_email text := lower(btrim(coalesce(p_buyer_email, '')));
  v_payload jsonb; v_tier text; v_scanned_order_no text;
  v_email_user_id uuid; v_phone_user_id uuid;
  v_match_source text := ''; v_warn text := null; v_tried_keys text;
  v_tier_target text;
  -- 0482 신규
  v_is_renewal boolean := false;   -- 이미 paid 인 원본 주문만 존재 → 새 회차
  v_base_order_no text;            -- 재청구 주문번호 생성용 기준
  v_renewal_plan text;             -- 원본 주문의 plan_type 승계
  v_renewal_sub uuid;              -- 원본 주문의 subscription_id 승계
  v_rebill_no text := nullif(btrim(coalesce(
    p_raw_payload->>'rebill_no', p_raw_payload->>'rebillno', '')), '');
  v_new_order_no text;
begin
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  if p_plan_type not in ('individual','business','artist_general','artist_student') then
    raise exception 'invalid plan_type: %', p_plan_type;
  end if;

  v_tier_target := case p_plan_type
    when 'business'        then 'business'
    when 'individual'      then 'individual'
    when 'artist_general'  then 'individual'
    when 'artist_student'  then 'individual'
    else 'individual'
  end;

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no, 'approval_no', p_approval_no,
    'buyer_email', p_buyer_email, 'buyer_phone', p_buyer_phone,
    'amount', p_amount, 'plan_type', p_plan_type,
    'membership_tier_mapped', v_tier_target,
    'goodname', p_goodname, 'paid_at', p_paid_at, 'source', p_source,
    'pay_state', 64, 'state_label', '승인완료', 'applied_at', now()
  );

  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '[^0-9]', '', 'g');

  if p_raw_payload is not null then
    select (regexp_match(
        jsonb_path_query_first(p_raw_payload, '$.*')::text || ' ' || p_raw_payload::text,
        'swk_[0-9a-fA-F]{8}_[a-zA-Z0-9]+_[a-zA-Z0-9]+'
      ))[1] into v_scanned_order_no;
  end if;

  v_tried_keys := format(
    'order_no=%s, scanned_order_no=%s, mul_no=%s, email=%s, phone_clean=%s',
    coalesce(p_order_no,'∅'), coalesce(v_scanned_order_no,'∅'),
    v_mul_no, case when v_email='' then '∅' else v_email end,
    case when v_phone_clean='' then '∅' else v_phone_clean end
  );

  -- ── 1순위: 명시 order_no ────────────────────────────────────────────────
  -- 0482: 이 회차용으로 열려있는 주문(미결제) 또는 이미 이 mul_no 를 가진 주문만
  --       집는다. 이미 다른 mul_no 로 paid 인 주문(= 최초/직전 회차)은 절대 재사용
  --       하지 않는다 — 재사용하면 그 회차 매출이 덮여 사라진다.
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po
    where po.order_no = p_order_no
      and (po.status in ('requested','pending','waiting','failed')
           or po.payapp_mul_no = v_mul_no)
    limit 1;
    if v_user_id is not null then
      v_match_source := 'order_no_exact';
    else
      -- order_no 는 존재하나 이미 다른 mul_no 로 paid → 재청구 회차
      select po.user_id, po.order_no, po.plan_type, po.subscription_id
        into v_user_id, v_base_order_no, v_renewal_plan, v_renewal_sub
      from public.payment_orders as po
      where po.order_no = p_order_no
      limit 1;
      if v_user_id is not null then
        v_is_renewal := true;
        v_match_source := 'order_no_renewal';
      end if;
    end if;
  end if;

  -- ── 2순위: raw_payload 에서 스캔한 swk_ order_no (동일 규칙) ───────────────
  if v_user_id is null and v_scanned_order_no is not null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po
    where po.order_no = v_scanned_order_no
      and (po.status in ('requested','pending','waiting','failed')
           or po.payapp_mul_no = v_mul_no)
    limit 1;
    if v_user_id is not null then
      v_match_source := 'raw_payload_scan';
    else
      select po.user_id, po.order_no, po.plan_type, po.subscription_id
        into v_user_id, v_base_order_no, v_renewal_plan, v_renewal_sub
      from public.payment_orders as po
      where po.order_no = v_scanned_order_no
      limit 1;
      if v_user_id is not null then
        v_is_renewal := true;
        v_match_source := 'raw_payload_scan_renewal';
      end if;
    end if;
  end if;

  -- ── 3순위: 이미 이 mul_no 로 기록된 주문 (재수신/멱등) ────────────────────
  if v_user_id is null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.payapp_mul_no = v_mul_no limit 1;
    if v_user_id is not null then v_match_source := 'mul_no_existing'; end if;
  end if;

  -- ── 4순위: 이메일 + 최근 미결제 주문 ──────────────────────────────────────
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

  -- ── 5순위: 전화번호 ───────────────────────────────────────────────────────
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
                              then 'phone+recent_requested' else 'phone_only' end;
    end if;
  end if;

  if v_match_source in ('order_no_exact','raw_payload_scan',
                        'order_no_renewal','raw_payload_scan_renewal') then
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

  -- ── legacy fallback: 오래된 미결제 주문 승계 ──────────────────────────────
  -- 0482: 재청구 회차에서는 건너뛴다. 몇 달 전 버려진 'requested' 주문을 이번
  --       회차로 소진해버리면 주문 생성일/이력이 어긋나기 때문.
  if v_order_id is null and not v_is_renewal then
    select po.id into v_order_id from public.payment_orders as po
    where po.user_id = v_user_id
      and po.status in ('requested','pending','waiting','failed')
      and po.plan_type = p_plan_type
    order by po.created_at desc limit 1;
    if v_order_id is not null then
      v_match_source := v_match_source || '+legacy_requested';
    end if;
  end if;

  -- ── 주문이 없으면 생성 (재청구 회차 포함) ─────────────────────────────────
  if v_order_id is null then
    v_new_order_no := case
      when v_is_renewal and v_base_order_no is not null
        then v_base_order_no || '_renewal_' || v_mul_no
      else coalesce(p_order_no, 'auto_' || v_mul_no)
    end;

    begin
      insert into public.payment_orders
        (user_id, subscription_id, order_no, plan_type, amount, status,
         payapp_mul_no, payapp_rebill_no, raw_response,
         paid_at, paid_at_source, payapp_state, payapp_state_label)
      values
        (v_user_id,
         case when v_is_renewal then v_renewal_sub else null end,
         v_new_order_no,
         case when v_is_renewal then coalesce(v_renewal_plan, p_plan_type) else p_plan_type end,
         p_amount, 'paid', v_mul_no, v_rebill_no, v_payload,
         p_paid_at,
         case when v_is_renewal then 'webhook_rebill' else 'webhook' end,
         64, '승인완료')
      returning public.payment_orders.id into v_order_id;
      v_match_source := v_match_source ||
        case when v_is_renewal then '+created_renewal' else '+created_auto' end;
    exception when unique_violation then
      -- 동시 수신 경합 → 이미 만들어진 주문을 집어온다 (멱등)
      select po.id into v_order_id from public.payment_orders as po
      where po.payapp_mul_no = v_mul_no or po.order_no = v_new_order_no
      limit 1;
      v_match_source := v_match_source || '+created_race_resolved';
      if v_order_id is null then
        return query select v_user_id, null::uuid, null::uuid, false, null::text,
          ('order insert conflict unresolved — tried: ' || v_tried_keys)::text;
        return;
      end if;
    end;
  end if;

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

  -- 0482: payapp_mul_no 는 "아직 없거나 이미 같은 값일 때만" 쓴다.
  --       다른 mul_no 로 paid 인 주문을 덮어쓰는 경로는 위에서 이미 차단했지만,
  --       여기서도 이중으로 막아 회귀를 원천 봉쇄한다.
  update public.payment_orders as po
  set status = 'paid',
      payapp_mul_no = coalesce(po.payapp_mul_no, v_mul_no),
      paid_at = coalesce(po.paid_at, p_paid_at),
      payapp_state = 64, payapp_state_label = '승인완료',
      paid_at_source = coalesce(po.paid_at_source, 'webhook'),
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      approval_no = coalesce(po.approval_no, p_approval_no),
      payapp_rebill_no = coalesce(po.payapp_rebill_no, v_rebill_no),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  -- 0495: 해지 흔적(cancel_requested_at / cancel_reason / auto_renew=false)을 함께
  --       지운다. artist_has_paid_access 는 cancel_requested_at is null 을 요구하므로
  --       이걸 남겨두면 재결제해도 유통이 계속 막힌다.
  update public.subscriptions as s
  set status = 'active', plan_type = p_plan_type, price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      payapp_state_label = '승인완료',
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month',
      canceled_at = null, refunded_at = null,
      cancel_requested_at = null, cancel_reason = null, auto_renew = true
  where s.id = v_sub_id;

  -- 0495: 같은 유저의 다른 '정지' 구독은 이번 결제로 대체됐다. 남은 기간을 결제시각에서
  --       끊어, 옛 유예 종료일이 뒤늦게 돌아와 방금 결제한 유저를 free 로 떨어뜨리는
  --       것을 막는다((C) 가드와 이중 방어).
  update public.subscriptions as s
  set status = case when s.status = 'cancel_scheduled' then 'canceled' else s.status end,
      auto_renew = false,
      canceled_at = case when s.status = 'cancel_scheduled'
                         then coalesce(s.canceled_at, p_paid_at) else s.canceled_at end,
      cancel_reason = coalesce(s.cancel_reason, 'superseded_by_resubscription'),
      current_period_end = p_paid_at
  where s.user_id = v_user_id
    and s.id is distinct from v_sub_id
    and (s.status in ('cancel_scheduled','canceled','expired') or s.cancel_requested_at is not null)
    and s.current_period_end is not null
    and s.current_period_end > p_paid_at;

  update public.users as u
  set membership_tier = v_tier_target,
      subscription_type = v_tier_target
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    ('membership_tier=' || coalesce(v_tier,'?') ||
     ' (mapped from plan_type=' || p_plan_type || ')' ||
     ' applied (match=' || v_match_source ||
     case when v_warn is null then '' else ' ' || v_warn end ||
     ' / tried: ' || v_tried_keys || ')')::text;
end; $function$;

-- ----------------------------------------------------------------------------
-- (B) 업로드 자격 판정 — 실제 결제 게이트와 일치
-- ----------------------------------------------------------------------------
create or replace function public.get_artist_upload_eligibility()
returns table(
  can_upload boolean, is_artist boolean, approval_status text,
  has_paid_membership boolean, contract_status text, has_signed_contract boolean,
  pending_contract_id uuid, payout_status text, payout_account_id uuid,
  min_release_date date,                    -- 0063 추가
  reasons text[]
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text; v_tier text;
  v_paid boolean;   -- 0495: membership_tier 대신 실제 구독 상태 기준 판정
  v_users_approval text; v_profile_approval text;
  v_contract_status text; v_pending_contract_id uuid;
  v_payout_id uuid; v_payout_status text;
  v_reasons text[] := array[]::text[];
begin
  if v_uid is null then
    return query select false, false, 'unauthenticated'::text, false,
      'unauthenticated'::text, false, null::uuid,
      'unauthenticated'::text, null::uuid,
      (current_date + interval '3 days')::date,
      array['login_required']::text[];
    return;
  end if;
  select account_type, membership_tier, artist_approval_status, contract_status
    into v_account_type, v_tier, v_users_approval, v_contract_status
  from public.users where id = v_uid;
  select approval_status into v_profile_approval
  from public.artist_profiles where user_id = v_uid;
  select id, verification_status into v_payout_id, v_payout_status
  from public.artist_payout_accounts where user_id = v_uid;
  select id into v_pending_contract_id
  from public.artist_contracts
  where artist_user_id = v_uid and status = 'pending_signature'
  order by created_at desc limit 1;
  if v_account_type is null or v_account_type <> 'artist' then
    v_reasons := array_append(v_reasons, 'not_artist');
  end if;
  if coalesce(v_users_approval, 'pending') <> 'approved' then
    if coalesce(v_profile_approval, '') = 'approved' then
      v_reasons := array_append(v_reasons, 'approval_sync_broken');
    else
      v_reasons := array_append(v_reasons, 'artist_not_approved');
    end if;
  end if;
  -- 0495: membership_tier 는 해지 유예기간 동안 'individual' 로 남아 있어서, 정지한
  --       아티스트에게 "결제됨" 으로 보이지만 실제 mutation 은 0467 트리거가 막는다.
  --       판정을 실제 게이트(artist_has_paid_access)와 일치시켜, 정지 상태면 화면에
  --       재결제 카드가 뜨고 즉시 다시 시작할 수 있게 한다.
  v_paid := public.artist_has_paid_access(v_uid);
  if not v_paid then
    v_reasons := array_append(v_reasons, 'no_paid_membership');
  end if;
  if coalesce(v_contract_status, 'not_created') <> 'signed' then
    v_reasons := array_append(v_reasons, 'no_signed_contract');
  end if;
  if v_payout_id is null then
    v_reasons := array_append(v_reasons, 'no_payout_account');
  elsif v_payout_status <> 'verified' then
    v_reasons := array_append(v_reasons, 'payout_not_verified');
  end if;
  return query select
    (array_length(v_reasons, 1) is null),
    (v_account_type = 'artist'),
    coalesce(v_users_approval, 'none'),
    v_paid,
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'), v_payout_id,
    (current_date + interval '3 days')::date,
    v_reasons;
end;
$$;
grant execute on function public.get_artist_upload_eligibility() to authenticated;

-- ----------------------------------------------------------------------------
-- (C) 유예 만료 처리 — 유효한 다른 구독이 있으면 강등 금지
-- ----------------------------------------------------------------------------

-- 유효 결제 구독 보유 여부 (강등 가드 전용). artist_has_paid_access 와 달리
-- 관리자/데모 예외 없이 순수하게 구독 상태만 본다.
create or replace function public._has_valid_paid_subscription(p_user_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.subscriptions s
    where s.user_id = p_user_id
      and s.status = 'active'
      and s.cancel_requested_at is null
      and s.current_period_end is not null
      and s.current_period_end > now()
      and s.plan_type in ('individual','business','artist_general','artist_student')
  );
$$;

revoke execute on function public._has_valid_paid_subscription(uuid) from public;
revoke execute on function public._has_valid_paid_subscription(uuid) from anon;
grant execute on function public._has_valid_paid_subscription(uuid) to authenticated, service_role;

create or replace function public.expire_my_scheduled_cancellation()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_affected int := 0;
begin
  if v_uid is null then return 0; end if;

  with expired as (
    update public.subscriptions as s
    set status = 'canceled'
    where s.user_id = v_uid
      and s.status = 'cancel_scheduled'
      and s.current_period_end is not null
      and s.current_period_end <= now()
    returning s.user_id
  )
  select count(*) into v_affected from expired;

  -- 0495: 재결제로 새 구독이 살아있는 유저는 강등하지 않는다.
  --       (정지 → 즉시 재결제 → 옛 유예 종료일 도래 시 free 로 떨어지던 문제)
  if v_affected > 0 and not public._has_valid_paid_subscription(v_uid) then
    update public.users as u
    set membership_tier = 'free', subscription_type = 'free'
    where u.id = v_uid;
  end if;

  return v_affected;
end;
$$;

grant execute on function public.expire_my_scheduled_cancellation() to authenticated;

create or replace function public.admin_expire_scheduled_cancellations()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_affected int := 0;
  v_uid uuid;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  for v_uid in
    select distinct s.user_id from public.subscriptions as s
    where s.status = 'cancel_scheduled'
      and s.current_period_end is not null
      and s.current_period_end <= now()
  loop
    update public.subscriptions as s
    set status = 'canceled'
    where s.user_id = v_uid
      and s.status = 'cancel_scheduled'
      and s.current_period_end <= now();

    -- 0495: 재결제로 유효한 구독이 있으면 tier 유지.
    if not public._has_valid_paid_subscription(v_uid) then
      update public.users as u
      set membership_tier = 'free', subscription_type = 'free'
      where u.id = v_uid;
    end if;

    v_affected := v_affected + 1;
  end loop;

  return v_affected;
end;
$$;

grant execute on function public.admin_expire_scheduled_cancellations() to authenticated;

-- ----------------------------------------------------------------------------
-- (D) 관리자 강제 활성화 — 해지 흔적 제거 (0309 본문 유지 + 0495 표시 구간만 변경)
--     운영에서 "정지한 유저를 바로 다시 진행시켜 달라" 를 관리자 화면으로 처리할 때,
--     tier 만 올라가고 유통은 계속 막히던 문제를 함께 없앤다.
-- ----------------------------------------------------------------------------
create or replace function public.admin_force_activate_membership(
  p_user_id uuid,
  p_plan_type text default 'individual'::text,
  p_reason text default null::text,
  p_amount integer default null::integer,
  p_payapp_mul_no text default null::text,
  p_approval_no text default null::text,
  p_paid_at timestamptz default null::timestamptz
)
returns table(
  user_id uuid, subscription_id uuid, order_id uuid,
  membership_updated boolean, final_membership_tier text, message text
)
language plpgsql security definer set search_path = public as $$
declare
  v_amount integer;
  v_sub_id uuid; v_order_id uuid;
  v_tier text;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_payload jsonb;
  -- ✅ X6.24: PayApp 상품 plan_type vs users.membership_tier 매핑
  v_tier_target text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  if p_user_id is null then raise exception 'p_user_id required'; end if;
  -- X6.24: artist_general / artist_student 추가 허용
  if p_plan_type not in ('individual','business','artist_general','artist_student') then
    raise exception 'invalid plan_type: %', p_plan_type;
  end if;
  if not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  -- X6.24: membership_tier 매핑 (artist 플랜은 'individual')
  v_tier_target := case p_plan_type
    when 'business'        then 'business'
    when 'individual'      then 'individual'
    when 'artist_general'  then 'individual'
    when 'artist_student'  then 'individual'
    else 'individual'
  end;

  v_amount := coalesce(p_amount, case p_plan_type
    when 'individual'      then 4900
    when 'artist_student'  then 4900
    when 'business'        then 6900
    when 'artist_general'  then 6900
    else 4900
  end);

  v_payload := jsonb_build_object(
    'force_activated', true,
    'reason', coalesce(p_reason, 'admin manual activation'),
    'plan_type', p_plan_type,
    'membership_tier_mapped', v_tier_target,
    'amount', v_amount,
    'payapp_mul_no', p_payapp_mul_no, 'approval_no', p_approval_no,
    'paid_at', v_paid_at,
    'activated_by', auth.uid(), 'activated_at', now()
  );

  select s.id into v_sub_id from public.subscriptions as s where s.user_id = p_user_id
  order by case s.status when 'active' then 0 when 'pending' then 1
                         when 'payment_waiting' then 2 else 3 end, s.created_at desc
  limit 1;

  if v_sub_id is null then
    insert into public.subscriptions
      (user_id, plan_type, price, status, last_paid_at, current_period_start, current_period_end,
       payapp_mul_no, payapp_state_label)
    values
      (p_user_id, p_plan_type, v_amount, 'active', v_paid_at, v_paid_at, v_paid_at + interval '1 month',
       p_payapp_mul_no, 'force-activated')
    returning public.subscriptions.id into v_sub_id;
  else
    -- 0495: 관리자 강제 활성화도 해지 흔적을 지운다. cancel_requested_at 이 남으면
    --       artist_has_paid_access 가 계속 false 라서 tier 만 올라가고 유통은 막힌다.
    update public.subscriptions as s
    set status = 'active', plan_type = p_plan_type, price = v_amount,
        last_paid_at = v_paid_at,
        current_period_start = v_paid_at,
        current_period_end = v_paid_at + interval '1 month',
        payapp_mul_no = coalesce(s.payapp_mul_no, p_payapp_mul_no),
        canceled_at = null, refunded_at = null,
        cancel_requested_at = null, cancel_reason = null, auto_renew = true
    where s.id = v_sub_id;

    -- 0495: 대체된 다른 정지 구독은 기간을 끊어 만료 배치의 뒤늦은 free 강등을 막는다.
    update public.subscriptions as s
    set status = case when s.status = 'cancel_scheduled' then 'canceled' else s.status end,
        auto_renew = false,
        cancel_reason = coalesce(s.cancel_reason, 'superseded_by_force_activate'),
        current_period_end = v_paid_at
    where s.user_id = p_user_id
      and s.id is distinct from v_sub_id
      and (s.status in ('cancel_scheduled','canceled','expired') or s.cancel_requested_at is not null)
      and s.current_period_end is not null
      and s.current_period_end > v_paid_at;
  end if;

  if p_payapp_mul_no is not null then
    select po.id into v_order_id from public.payment_orders as po
    where po.payapp_mul_no = p_payapp_mul_no limit 1;
  end if;
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders as po
    where po.user_id = p_user_id and po.status in ('requested','waiting','failed','pending')
    order by po.created_at desc limit 1;
  end if;

  if v_order_id is null then
    insert into public.payment_orders
      (user_id, subscription_id, order_no, plan_type, amount, status,
       payapp_mul_no, approval_no, paid_at, payapp_state, payapp_state_label, raw_response)
    values
      (p_user_id, v_sub_id, 'force_' || extract(epoch from now())::text,
       p_plan_type, v_amount, 'paid',
       p_payapp_mul_no, p_approval_no, v_paid_at, 64, '강제승인', v_payload)
    returning public.payment_orders.id into v_order_id;
  else
    update public.payment_orders as po
    set status = 'paid',
        subscription_id = coalesce(po.subscription_id, v_sub_id),
        payapp_mul_no = coalesce(po.payapp_mul_no, p_payapp_mul_no),
        approval_no = coalesce(po.approval_no, p_approval_no),
        paid_at = coalesce(po.paid_at, v_paid_at),
        payapp_state = coalesce(po.payapp_state, 64),
        payapp_state_label = '강제승인',
        amount = coalesce(po.amount, v_amount),
        raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
    where po.id = v_order_id;
  end if;

  -- ✅ X6.24: users.membership_tier / subscription_type 는 매핑된 값 사용
  -- (CHECK: free/individual/business — artist_* 는 저장 불가)
  update public.users as u
  set membership_tier = v_tier_target, subscription_type = v_tier_target
  where u.id = p_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = p_user_id;

  return query select p_user_id, v_sub_id, v_order_id, true, v_tier,
    ('force-activated plan_type=' || p_plan_type ||
     ' tier=' || v_tier ||
     ' reason=' || coalesce(p_reason,'(no reason)'))::text;
end; $$;

grant execute on function public.admin_force_activate_membership(uuid, text, text, integer, text, text, timestamptz)
  to authenticated;

-- ============================================================================
-- 운영 확인 쿼리 (실행 안 함 — 필요 시 수동 실행)
-- ============================================================================
-- 1) 지금 정지 상태라 유통이 막혀 있는 아티스트 (재결제 안내 대상)
-- select u.id, u.email, s.status, s.cancel_requested_at, s.current_period_end
-- from public.users u
-- join lateral (
--   select sb.* from public.subscriptions sb
--   where sb.user_id = u.id order by sb.created_at desc limit 1
-- ) s on true
-- where u.account_type = 'artist'
--   and not public.artist_has_paid_access(u.id)
--   and (s.cancel_requested_at is not null or s.status in ('cancel_scheduled','canceled'))
-- order by s.current_period_end desc nulls last;
--
-- 2) 재결제 후 정상 복구됐는지 (allowed = true 여야 함)
-- select * from public.artist_billing_access_detail('<user_uuid>'::uuid);
--
-- 3) 대체되지 않고 남아 있는 정지 구독 (있으면 0 이어야 정상)
-- select s.user_id, count(*)
-- from public.subscriptions s
-- where s.status = 'cancel_scheduled'
--   and s.current_period_end > now()
--   and public._has_valid_paid_subscription(s.user_id)
-- group by s.user_id;
