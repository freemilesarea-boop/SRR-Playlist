-- 0308 — PayApp webhook 의 artist 플랜 수용 + membership_tier 매핑 (X6.24)
--
-- 문제 (X6.22 회귀):
--   _internal_apply_payapp_paid_event 가 plan_type 을 'individual','business' 만
--   허용 → artist_general / artist_student 결제 시 'invalid plan_type' raise
--   → webhook 처리 실패 → membership_tier 활성화 안 됨 → 영원히 업로드 불가.
--
-- 수정 (B-1 권장안):
--   1) 허용 plan_type 에 artist_general / artist_student 추가
--   2) membership_tier 매핑: artist_general/student → 'individual' (RLS 호환)
--   3) subscriptions / payment_orders / users.subscription_type 의 plan_type 은
--      원본 그대로 저장 (상품 구분 보존).
--      단, users.membership_tier 만 'individual' 로 normalize.
--
-- 보존:
--   * users.membership_tier CHECK 변경 X
--   * tracks_artist_insert RLS 정책 변경 X
--   * 세부 권한/한도는 users.plan_type / get_my_artist_plan() 에서 판단

create or replace function public._internal_apply_payapp_paid_event(
  p_payapp_mul_no text, p_amount integer, p_plan_type text,
  p_buyer_email text default null::text, p_buyer_phone text default null::text,
  p_paid_at timestamptz default now(), p_approval_no text default null::text,
  p_goodname text default null::text, p_order_no text default null::text,
  p_source text default 'unknown'::text, p_raw_payload jsonb default null::jsonb
)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text, message text
)
language plpgsql security definer set search_path = public as $$
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
  -- ✅ X6.24: PayApp 상품 plan_type vs users.membership_tier 매핑
  v_tier_target text;
begin
  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  -- X6.24: artist_general / artist_student 추가 허용
  if p_plan_type not in ('individual','business','artist_general','artist_student') then
    raise exception 'invalid plan_type: %', p_plan_type;
  end if;

  -- X6.24: membership_tier 매핑 — artist 플랜은 'individual' 로 normalize
  -- (CHECK 위반 회피 + 기존 RLS tracks_artist_insert 의 'individual' 조건 통과)
  v_tier_target := case p_plan_type
    when 'business'        then 'business'
    when 'individual'      then 'individual'
    when 'artist_general'  then 'individual'
    when 'artist_student'  then 'individual'
    else 'individual'
  end;

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no,
    'approval_no', p_approval_no,
    'buyer_email', p_buyer_email,
    'buyer_phone', p_buyer_phone,
    'amount', p_amount,
    'plan_type', p_plan_type,
    'membership_tier_mapped', v_tier_target,
    'goodname', p_goodname,
    'paid_at', p_paid_at,
    'source', p_source,
    'pay_state', 64,
    'state_label', '승인완료',
    'applied_at', now()
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
    coalesce(p_order_no,'∅'),
    coalesce(v_scanned_order_no,'∅'),
    v_mul_no,
    case when v_email='' then '∅' else v_email end,
    case when v_phone_clean='' then '∅' else v_phone_clean end
  );

  -- ===== 매칭 우선순위 (기존 로직 그대로 유지) =====
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = p_order_no limit 1;
    if v_user_id is not null then v_match_source := 'order_no_exact'; end if;
  end if;

  if v_user_id is null and v_scanned_order_no is not null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = v_scanned_order_no limit 1;
    if v_user_id is not null then v_match_source := 'raw_payload_scan'; end if;
  end if;

  if v_user_id is null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.payapp_mul_no = v_mul_no limit 1;
    if v_user_id is not null then v_match_source := 'mul_no_existing'; end if;
  end if;

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

  -- subscription 매칭 또는 생성 (원본 plan_type 그대로 저장)
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

  -- subscriptions.plan_type 은 원본 (artist_general/student) 그대로 저장
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

  -- ✅ users.membership_tier 는 'individual' 로 normalize (RLS 호환)
  -- users.subscription_type 도 동일 매핑 (CHECK: free/personal/business/individual)
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
end; $$;
