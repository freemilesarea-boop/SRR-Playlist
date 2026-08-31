-- ============================================================================
-- 0482_rebill_order_per_cycle_fix.sql
-- P0 — 정기 재청구(2회차+) 결제가 payment_orders 에 사이클별로 남지 않던 근본 버그 수정.
--
-- ── 진단 (실측) ──────────────────────────────────────────────────────────────
-- PayApp 정기 재청구는 매 회차 feedback 의 var1 에 "최초 회차 order_no"(swk_...)를
-- 그대로 echo 한다. 실측 예:
--   mul_no=117211148 (2026-07-29) var1=swk_3ccc92f3_ms62gpwr_zp61gc
--   mul_no=117799461 (2026-08-31) var1=swk_3ccc92f3_ms62gpwr_zp61gc  ← 동일
-- 그런데 _internal_apply_payapp_paid_event 의 1순위 매칭이
--     select ... from payment_orders where order_no = p_order_no limit 1
-- 로 status 필터가 없어, 이미 'paid' 인 최초 회차 주문을 그대로 집어온 뒤 말미의
--     update ... set payapp_mul_no = v_mul_no, paid_at = coalesce(po.paid_at, p_paid_at)
-- 로 그 주문의 mul_no 를 새 회차 것으로 덮어썼다. 결과:
--   (1) 새 회차 주문이 생성되지 않음        → 그 회차 매출 미기록
--   (2) 직전 회차 mul_no 가 지워짐          → 직전 회차가 드리프트로 검출
--   (3) paid_at 이 최초 회차 날짜로 고정    → 매출 월 오기재 (0481 이 쫓던 증상)
-- 두 웹훅 모두 matched_order_id 가 동일 주문(986dcdc6…)이었음이 실측으로 확인됨.
--
-- 0473 안전망(AFTER INSERT)이 못 막은 이유: BEFORE INSERT 인
-- _trg_promote_state4_to_paid 가 먼저 apply 를 돌려 새 mul_no 를 기존 주문에 찍고,
-- 그 뒤 실행되는 안전망의 exists(mul_no) 검사가 true 가 되어 skip 된다.
-- 재청구 경로에서 안전망은 구조적으로 무력화되어 있었다.
--
-- ── 조치 ────────────────────────────────────────────────────────────────────
-- (A) _internal_apply_payapp_paid_event — order_no 매칭을 "미결제 주문 우선"으로
--     제한하고, 이미 paid 인 원본 주문만 있으면 사용자만 승계해 재청구 신규 주문
--     (order_no = '<원본>_renewal_<mul_no>')을 생성한다. 기존 paid 주문의 mul_no 는
--     더 이상 덮어쓰지 않는다.
-- (B) _trg_promote_state4_to_paid — p_event_at 을 webhook 수신시각이 아니라 PayApp
--     실제 결제일(raw_payload.pay_date, KST)로 전달 → paid_at/정산월 원천 정합.
-- (C) v_billing_recording_drift — 0478 이 넣은 "같은 유저·같은 달 paid order 존재"
--     가드 제거. 그 가드는 오탐이 아니라 진짜 누락 5건을 가리고 있었다(실측).
--     mul_no 는 부분 유니크 키이므로 mul_no 단독 판정으로 충분하다.
-- (D) 미기록 결제 전량 백필 — mul_no 기준 누락 건을 (A)와 동일 규약으로 기록.
-- (E) paid_at 월단위 오기재 재교정 — 각 주문의 mul_no 웹훅 pay_date(KST) 기준.
-- (F) alert_billing_recording_drift — 20시간 억제 → 드리프트 지문(fingerprint) 변경
--     시에만 재알림 + 미해소 시 7일 주기 리마인드. 동일 건 매일 재알림 스팸 제거.
--
-- ── 안전성 ──────────────────────────────────────────────────────────────────
-- · 백필은 이미 수금된 결제의 '기록'만 생성한다. 신규 청구/환불 없음.
-- · 멱등: (D) 는 mul_no 미기록 건만, (E) 는 월 불일치 건만 대상 → 재실행 무동작.
-- · payment_orders 트리거 영향: 영업수당 커밋션은 '유저의 paid 주문 수 == 2' 일 때만
--   발생하고 ledger 가 유니크라 멱등이다. 백필로 2회차가 채워지는 유저에게는 실제
--   2회차 결제가 존재하므로 커밋션 발생이 정당하다(사후 검증 쿼리 주석 참조).
-- · settlement_period_month 는 BEFORE INSERT/UPDATE OF paid_at 트리거가 자동 재계산.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- (A) 재청구 회차별 주문 생성 — paid 주문 mul_no 덮어쓰기 금지
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

  update public.subscriptions as s
  set status = 'active', plan_type = p_plan_type, price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      payapp_state_label = '승인완료',
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month',
      canceled_at = null, refunded_at = null
  where s.id = v_sub_id;

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
-- (B) promote 트리거 — 결제일 원천을 PayApp pay_date(KST)로
-- ----------------------------------------------------------------------------
create or replace function public._trg_promote_state4_to_paid()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_apply record;
  v_plan text;
  v_candidate_order_no text;
  v_pay_date timestamptz;
begin
  if NEW.pay_state <> 4 or NEW.linkval_verified is not true
     or NEW.price is null or NEW.price <= 0 or NEW.payapp_mul_no is null then
    return NEW;
  end if;

  v_plan := case when NEW.price = 6900 then 'business' else 'individual' end;
  v_candidate_order_no := coalesce(
    nullif(btrim(NEW.order_no), ''),
    nullif(btrim(NEW.raw_payload->>'var1'), ''),
    nullif(btrim(NEW.raw_payload->>'order_no'), '')
  );

  -- 0482: PayApp pay_date 는 TZ 표기가 없는 KST 문자열("2026-08-31 10:10:13").
  --       '+09' 를 붙여 명시적으로 해석한다. 파싱 실패 시 수신시각으로 폴백.
  begin
    v_pay_date := (nullif(btrim(NEW.raw_payload->>'pay_date'), '') || '+09')::timestamptz;
  exception when others then
    v_pay_date := null;
  end;

  begin
    select * into v_apply from public._internal_apply_payapp_event(
      p_payapp_mul_no := NEW.payapp_mul_no,
      p_pay_state := 4,
      p_amount := NEW.price,
      p_plan_type := v_plan,
      p_buyer_email := NEW.raw_payload->>'recvemail',
      p_buyer_phone := NEW.raw_payload->>'recvphone',
      p_event_at := coalesce(v_pay_date, NEW.created_at, now()),
      p_approval_no := coalesce(
        NEW.raw_payload->>'approval_no',
        NEW.raw_payload->>'apv_no',
        NEW.raw_payload->>'card_apv_no'
      ),
      p_goodname := NEW.raw_payload->>'goodname',
      p_order_no := v_candidate_order_no,
      p_source := 'trigger_state4_auto',
      p_raw_payload := NEW.raw_payload
    );

    if v_apply.membership_updated then
      NEW.matched_user_id := v_apply.matched_user_id;
      NEW.matched_order_id := v_apply.matched_order_id;
      NEW.matched_subscription_id := v_apply.matched_subscription_id;
      NEW.membership_updated := true;
      NEW.final_membership_tier := v_apply.final_membership_tier;
      NEW.state_label := '승인완료 (state4 auto)';
      NEW.processed_at := coalesce(NEW.processed_at, now());
      NEW.processing_error := null;
    end if;
  exception when others then
    raise notice '[trg_state4] error mul_no=%: %', NEW.payapp_mul_no, sqlerrm;
  end;

  return NEW;
end;
$function$;

-- ----------------------------------------------------------------------------
-- (C) 드리프트 뷰 — 0478 의 "같은 달 paid order" 가드 제거
--     그 가드는 오탐 차단이 아니라 진짜 누락(7건 중 5건)을 은폐하고 있었다.
-- ----------------------------------------------------------------------------
create or replace view public.v_billing_recording_drift as
select e.id            as webhook_id,
       e.user_id,
       e.matched_user_id,
       e.payapp_mul_no,
       e.payapp_rebill_no,
       e.price,
       e.linkval_verified,
       (e.raw_payload ->> 'pay_date') as pay_date,
       e.created_at
from public.payapp_webhook_events e
where e.pay_state = 4
  and e.payapp_mul_no is not null
  and not exists (
    select 1 from public.payment_orders o where o.payapp_mul_no = e.payapp_mul_no
  );

revoke all on public.v_billing_recording_drift from public;
grant select on public.v_billing_recording_drift to service_role;

-- ----------------------------------------------------------------------------
-- (D) 미기록 결제 백필 — (A)와 동일 규약(원본 주문 승계 + _renewal_<mul_no>)
-- ----------------------------------------------------------------------------
insert into public.payment_orders
  (user_id, subscription_id, order_no, plan_type, amount, status,
   payapp_mul_no, payapp_rebill_no, payapp_state, payapp_state_label,
   paid_at, paid_at_source, discount_amount)
select
  coalesce(base.user_id, coalesce(e.matched_user_id, e.user_id)),
  base.subscription_id,
  case when base.order_no is not null
       then base.order_no || '_renewal_' || e.payapp_mul_no
       else 'wh_' || e.payapp_mul_no end,
  coalesce(base.plan_type, sub.plan_type,
           case when e.price = 6900 then 'business' else 'individual' end),
  e.price, 'paid', e.payapp_mul_no, e.payapp_rebill_no, 64, '승인완료(백필0482)',
  coalesce((nullif(btrim(e.raw_payload->>'pay_date'),'') || '+09')::timestamptz, e.created_at),
  'backfill_0482', 0
from public.payapp_webhook_events e
left join lateral (
  select o.user_id, o.order_no, o.plan_type, o.subscription_id
  from public.payment_orders o
  where o.order_no = coalesce(
          nullif(btrim(e.order_no), ''),
          nullif(btrim(e.raw_payload->>'var1'), ''))
  limit 1
) base on true
left join lateral (
  select s.plan_type from public.subscriptions s
  where s.user_id = coalesce(base.user_id, e.matched_user_id, e.user_id)
  order by (s.payapp_rebill_no is not distinct from e.payapp_rebill_no) desc, s.created_at desc
  limit 1
) sub on true
where e.pay_state = 4
  and e.linkval_verified is true
  and e.payapp_mul_no is not null
  and coalesce(e.price, 0) > 0
  and coalesce(base.user_id, e.matched_user_id, e.user_id) is not null
  and not exists (
    select 1 from public.payment_orders o2 where o2.payapp_mul_no = e.payapp_mul_no
  )
on conflict (order_no) do nothing;

-- ----------------------------------------------------------------------------
-- (E) paid_at 월단위 오기재 재교정 — 각 주문의 mul_no 웹훅 pay_date(KST) 기준
--     0481 과 동일한 보수적 규칙(월 불일치 건만). (D) 이후 각 주문이 자기 회차의
--     mul_no 를 갖게 되므로 이제 교정 결과가 안정적이다.
-- ----------------------------------------------------------------------------
with corr as (
  select o.id,
         (nullif(btrim(e.raw_payload->>'pay_date'),'') || '+09')::timestamptz as correct_paid_at
  from public.payment_orders o
  join lateral (
    select e2.raw_payload
    from public.payapp_webhook_events e2
    where e2.payapp_mul_no = o.payapp_mul_no
      and e2.pay_state in (4, 64)
      and nullif(btrim(e2.raw_payload->>'pay_date'), '') is not null
    order by e2.created_at desc
    limit 1
  ) e on true
  where o.status = 'paid'
    and o.payapp_mul_no is not null
    and o.paid_at is not null
    and date_trunc('month', o.paid_at at time zone 'Asia/Seoul')
        <> date_trunc('month',
             ((nullif(btrim(e.raw_payload->>'pay_date'),'') || '+09')::timestamptz)
               at time zone 'Asia/Seoul')
)
update public.payment_orders o
   set paid_at = corr.correct_paid_at,
       paid_at_source = 'webhook_pay_date_0482'
  from corr
 where o.id = corr.id;

-- ----------------------------------------------------------------------------
-- (F) 드리프트 알림 — 지문 기반 재알림 (동일 건 매일 재알림 스팸 제거)
-- ----------------------------------------------------------------------------
create or replace function public.alert_billing_recording_drift()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_drift int;
  v_completed int;
  v_fingerprint text;
  v_last_fingerprint text;
  v_last_at timestamptz;
begin
  select drift_count, completed_webhooks
    into v_drift, v_completed
  from public.check_billing_recording_drift();

  if coalesce(v_drift, 0) <= 0 then
    return 0;
  end if;

  -- 현재 드리프트 집합의 지문 — 구성이 바뀌어야 새 알림
  select md5(coalesce(string_agg(d.webhook_id::text, ',' order by d.webhook_id), ''))
    into v_fingerprint
  from public.v_billing_recording_drift d;

  select n.context->>'fingerprint', n.created_at
    into v_last_fingerprint, v_last_at
  from public.admin_notifications n
  where n.kind = 'billing_recording_drift'
  order by n.created_at desc
  limit 1;

  -- 동일 집합이 이미 통보됐고 7일이 지나지 않았으면 침묵 (미해소 리마인드는 주 1회)
  if v_last_fingerprint is not null
     and v_last_fingerprint = v_fingerprint
     and v_last_at > now() - interval '7 days' then
    return v_drift;
  end if;

  insert into public.admin_notifications
    (kind, severity, title, body, context, dispatch_attempts, created_at)
  values
    ('billing_recording_drift', 'error',
     '결제 기록 누락 감지 (' || v_drift || '건)',
     'PayApp 완료 결제 ' || v_drift || '건이 payment_orders 에 기록되지 않았습니다. ' ||
     'public.v_billing_recording_drift 뷰에서 상세 확인 후 재처리가 필요합니다. ' ||
     '(완료 웹훅 총 ' || v_completed || '건 기준)' ||
     case when v_last_fingerprint = v_fingerprint
          then ' [7일 경과 미해소 리마인드]' else '' end,
     jsonb_build_object('drift_count', v_drift, 'completed_webhooks', v_completed,
                        'source', 'alert_billing_recording_drift',
                        'view', 'v_billing_recording_drift',
                        'fingerprint', v_fingerprint),
     0, now());

  return v_drift;
end;
$$;

revoke all on function public.alert_billing_recording_drift() from public;
grant execute on function public.alert_billing_recording_drift() to service_role;
