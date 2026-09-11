-- 0515 — 엔터프라이즈 결제 → 코어 결제 테이블 연동
--
-- 사례: 르하임스터디카페s 워크라운지 숙대점 (김가희, 2026-09-06 결제)
--
-- 무슨 일이 있었나:
--   이 매장은 엔터프라이즈(가맹 개별청구) 경로로 월 4,900원을 정상 결제했다.
--     enterprise_payment_subscriptions  status=active, 기간 09-06 ~ 10-06
--     enterprise_payment_orders         status=paid,  rebill 262480000018
--   그런데 코어 결제 테이블에는 흔적이 0건이었다.
--     subscriptions   0건
--     payment_orders  0건
--
--   엔터프라이즈 결제 경로(_apply_enterprise_payapp_event)는 자기 테이블만 쓰고
--   코어 테이블에는 아무것도 남기지 않는다. membership_tier 승격 한 줄
--   (_grant_enterprise_store_membership) 이 전부다. 그래서 "결제는 됐는데
--   어디에도 연동이 안 된" 상태가 된다.
--
-- 무엇이 깨졌나 (코어 테이블을 읽는 쪽 전부):
--   1. 정산 — admin_generate_settlement 의 platform_revenue 는
--      payment_orders(status='paid', settlement_period_month) 합계다.
--      엔터프라이즈 매출은 아티스트 정산 재원에서 통째로 빠져 있었다.
--   2. 결제 사각지대 감지기(0511, v_billing_coverage_gap) —
--      "재생은 도는데 결제기록 없음" 으로 숙대점을 매일 오탐 경보.
--      정작 0511 은 이 매장 사례를 막으려고 만든 감지기였다.
--   3. 관리자 회원 화면 / 구독 조회 — 코어 subscriptions 기준이라 결제 이력 없음.
--
-- 이 마이그레이션이 하는 일:
--   1) subscriptions.enterprise_subscription_id — 연동 링크 컬럼 (1:1, 멱등 보장)
--   2) _mirror_enterprise_payment_to_core() — 엔터프라이즈 결제 1건을
--      코어 subscriptions + payment_orders 로 미러링
--   3) _apply_enterprise_payapp_event() 의 결제성공 분기 3곳에서 미러 호출
--      (2026-09-06 prod 정의 = state4/selfheal/중복청구 가드 포함본 기준)
--   4) 기존 paid 엔터프라이즈 주문 백필 — 숙대점 즉시 복구
--   5) v_billing_coverage_gap 에 enterprise_paid_unmirrored 플래그 추가 —
--      미러가 또 끊기면 "미결제" 가 아니라 "미연동" 으로 구분되어 보인다
--
-- 멱등성: payment_orders.order_no 는 UNIQUE 이고 엔터프라이즈 order_no 를 그대로
--         쓴다. subscriptions 는 enterprise_subscription_id UNIQUE 로 1:1 고정.
--         몇 번을 돌려도 행이 늘지 않는다.

-- ----------------------------------------------------------------------------
-- 1) 연동 링크 컬럼
-- ----------------------------------------------------------------------------
alter table public.subscriptions
  add column if not exists enterprise_subscription_id uuid
    references public.enterprise_payment_subscriptions(id) on delete set null;

create unique index if not exists uq_subscriptions_enterprise_subscription_id
  on public.subscriptions (enterprise_subscription_id)
  where enterprise_subscription_id is not null;

comment on column public.subscriptions.enterprise_subscription_id is
  '엔터프라이즈 정기결제 구독과의 1:1 연동 링크 (0515). NULL = 일반 결제 경로.';

-- ----------------------------------------------------------------------------
-- 2) 미러 함수 — 엔터프라이즈 결제 1건 → 코어 결제 테이블
-- ----------------------------------------------------------------------------
create or replace function public._mirror_enterprise_payment_to_core(p_ent_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_o public.enterprise_payment_orders;
  v_s public.enterprise_payment_subscriptions;
  v_sub_id uuid;
  v_order_id uuid;
  v_paid_at timestamptz;
  v_period_start timestamptz;
  v_period_end timestamptz;
  v_amount integer;
begin
  if p_ent_order_id is null then
    return jsonb_build_object('ok', false, 'error', 'order_id_required');
  end if;

  select * into v_o from public.enterprise_payment_orders where id = p_ent_order_id;
  if not found then return jsonb_build_object('ok', false, 'error', 'ent_order_not_found'); end if;
  if v_o.status <> 'paid' then return jsonb_build_object('ok', false, 'error', 'not_paid'); end if;

  select * into v_s from public.enterprise_payment_subscriptions where id = v_o.subscription_id;

  -- 아티스트 계정은 건드리지 않는다.
  -- membership_tier / subscriptions 는 아티스트 유통·정산 판정과 얽혀 있어
  -- 임의 변경 금지 (0467 / 0499 회귀 이력). 엔터프라이즈 매장 경로에서는
  -- 애초에 나올 수 없는 조합이지만 방어적으로 막는다.
  if exists (
    select 1 from public.users u
     where u.id = v_o.payer_user_id
       and coalesce(u.account_type, 'individual') = 'artist'
  ) then
    return jsonb_build_object('ok', false, 'error', 'artist_account_skipped');
  end if;

  v_amount       := coalesce(nullif(v_o.amount, 0), v_s.amount, 0);
  v_paid_at      := coalesce(v_o.paid_at, now());
  v_period_start := coalesce(v_s.current_period_start, v_paid_at);
  v_period_end   := coalesce(v_s.current_period_end, v_paid_at + interval '1 month');

  -- ── 2-1) subscriptions ────────────────────────────────────────────────────
  -- 이미 연동된 행이 있으면 그 행. 없으면 이 사용자의 기존 코어 구독을 입양한다
  -- (일반 결제로 쓰다가 엔터프라이즈로 넘어온 매장이 활성 구독 2개가 되는 걸 막는다).
  select s.id into v_sub_id
    from public.subscriptions s
   where s.enterprise_subscription_id = v_o.subscription_id
   limit 1;

  if v_sub_id is null then
    select s.id into v_sub_id
      from public.subscriptions s
     where s.user_id = v_o.payer_user_id
       and s.enterprise_subscription_id is null
     order by case s.status when 'active' then 0 when 'pending' then 1
                            when 'payment_waiting' then 2 else 3 end,
              s.created_at desc
     limit 1;
  end if;

  if v_sub_id is null then
    insert into public.subscriptions
      (user_id, plan_type, price, status, payapp_rebill_no, payapp_mul_no,
       current_period_start, current_period_end, last_paid_at, auto_renew,
       payapp_state_label, enterprise_subscription_id)
    values
      (v_o.payer_user_id, 'business', v_amount, 'active',
       coalesce(v_o.payapp_rebill_no, v_s.payapp_rebill_no), v_o.payapp_mul_no,
       v_period_start, v_period_end, v_paid_at, true,
       'enterprise', v_o.subscription_id)
    returning id into v_sub_id;
  else
    -- 기간 역행 금지: 이미 더 긴 기간이 잡혀 있으면 줄이지 않는다.
    update public.subscriptions s
       set status = 'active',
           plan_type = 'business',
           price = v_amount,
           payapp_rebill_no = coalesce(v_o.payapp_rebill_no, v_s.payapp_rebill_no, s.payapp_rebill_no),
           payapp_mul_no = coalesce(v_o.payapp_mul_no, s.payapp_mul_no),
           current_period_start = least(coalesce(s.current_period_start, v_period_start), v_period_start),
           current_period_end = greatest(coalesce(s.current_period_end, v_period_end), v_period_end),
           last_paid_at = greatest(coalesce(s.last_paid_at, v_paid_at), v_paid_at),
           canceled_at = null,
           refunded_at = null,
           cancel_requested_at = null,
           cancel_reason = null,
           auto_renew = true,
           payapp_state_label = 'enterprise',
           enterprise_subscription_id = v_o.subscription_id
     where s.id = v_sub_id;
  end if;

  -- ── 2-2) payment_orders ───────────────────────────────────────────────────
  -- 엔터프라이즈 order_no 를 그대로 쓴다 → UNIQUE(order_no) 가 멱등성을 보장하고
  -- 양쪽 원장을 order_no 하나로 대조할 수 있다.
  -- settlement_period_month 는 trg_payment_orders_settlement_period_month 가 채운다.
  insert into public.payment_orders
    (user_id, subscription_id, order_no, plan_type, amount, status,
     payapp_rebill_no, payapp_mul_no, paid_at, payapp_state, payapp_state_label,
     raw_response)
  values
    (v_o.payer_user_id, v_sub_id, v_o.order_no, 'business', v_amount, 'paid',
     coalesce(v_o.payapp_rebill_no, v_s.payapp_rebill_no), v_o.payapp_mul_no,
     v_paid_at, 64, 'enterprise',
     jsonb_build_object(
       'mirrored_from', 'enterprise_payment_orders',
       'enterprise_order_id', v_o.id,
       'enterprise_subscription_id', v_o.subscription_id,
       'enterprise_account_id', v_o.enterprise_account_id,
       'payer_type', v_o.payer_type,
       'mirrored_at', now()
     ))
  on conflict (order_no) do update
    set subscription_id = coalesce(payment_orders.subscription_id, excluded.subscription_id),
        status = 'paid',
        amount = excluded.amount,
        payapp_rebill_no = coalesce(excluded.payapp_rebill_no, payment_orders.payapp_rebill_no),
        payapp_mul_no = coalesce(excluded.payapp_mul_no, payment_orders.payapp_mul_no),
        paid_at = coalesce(payment_orders.paid_at, excluded.paid_at),
        payapp_state = coalesce(payment_orders.payapp_state, excluded.payapp_state),
        payapp_state_label = coalesce(payment_orders.payapp_state_label, excluded.payapp_state_label),
        raw_response = coalesce(payment_orders.raw_response, '{}'::jsonb) || excluded.raw_response
  returning payment_orders.id into v_order_id;

  -- ── 2-3) users 등급 컬럼 ──────────────────────────────────────────────────
  -- 0511 이 잡아낸 두 번째 문제: subscription_type 과 membership_tier 가 따로 논다.
  -- 승격만 한다(강등 없음).
  update public.users u
     set membership_tier = 'business',
         subscription_type = 'business'
   where u.id = v_o.payer_user_id
     and coalesce(u.account_type, 'individual') <> 'artist'
     and (coalesce(u.membership_tier, 'free') in ('free', 'individual')
       or coalesce(u.subscription_type, 'free') in ('free', 'individual'));

  return jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub_id,
    'payment_order_id', v_order_id,
    'order_no', v_o.order_no,
    'amount', v_amount);
end;
$$;

comment on function public._mirror_enterprise_payment_to_core(uuid) is
  '엔터프라이즈 결제 1건을 코어 subscriptions/payment_orders 로 미러링 (0515). 멱등.';

revoke execute on function public._mirror_enterprise_payment_to_core(uuid) from public, anon, authenticated;
grant  execute on function public._mirror_enterprise_payment_to_core(uuid) to service_role;

-- ----------------------------------------------------------------------------
-- 3) 결제 이벤트 적용 함수 — 결제성공 분기에서 미러 호출
--
--    2026-09-06 prod 정의(state4 승인 판정 / 중복청구 가드 포함)를 그대로 두고
--    _mirror_enterprise_payment_to_core() 호출만 더한다.
--    미러 실패가 결제 확정을 되돌리면 안 되므로 예외는 삼키고 로그만 남긴다.
-- ----------------------------------------------------------------------------
create or replace function public._apply_enterprise_payapp_event(
  p_order_no text, p_rebill_no text, p_mul_no text, p_pay_state integer,
  p_amount integer, p_raw jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_order public.enterprise_payment_orders;
  v_sub public.enterprise_payment_subscriptions;
  v_has_order boolean := false;
  v_has_sub boolean := false;
  v_dup_of uuid;
  v_rebill_order_id uuid;
  v_mirror jsonb;
  v_approval text := btrim(coalesce(
    p_raw->>'payauthcode', p_raw->>'approval_no', p_raw->>'app_no', ''
  ));
  v_paid boolean := public._payapp_is_paid_state(p_pay_state, v_approval, p_amount);
begin
  if p_order_no is not null and p_order_no <> '' then
    select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1;
    v_has_order := found;
  end if;

  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1;
    v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if v_paid then
      select s2.id into v_dup_of
        from public.enterprise_payment_subscriptions s2
       where s2.payer_user_id = v_sub.payer_user_id
         and s2.enterprise_account_id = v_sub.enterprise_account_id
         and s2.payer_type = v_sub.payer_type
         and s2.id <> v_sub.id
         and s2.status = 'active'
       limit 1;

      insert into public.enterprise_payment_orders(
        subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no,
        amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type,
        'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text),
        coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;

      if v_dup_of is not null then
        update public.enterprise_payment_subscriptions
           set status = 'duplicate', updated_at = now()
         where id = v_sub.id;
        return jsonb_build_object('ok', true, 'status', 'duplicate_charge',
                                  'subscription_id', v_sub.id, 'active_subscription_id', v_dup_of);
      end if;

      update public.enterprise_payment_subscriptions
         set status='active', last_paid_at=now(),
             current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_sub.id;
      perform public._grant_enterprise_store_membership(v_sub.payer_user_id);

      -- 0515: 코어 결제 테이블 연동
      select o.id into v_rebill_order_id
        from public.enterprise_payment_orders o
       where o.order_no = 'entrebill_'||coalesce(p_mul_no, '')
       limit 1;
      if v_rebill_order_id is null then
        select o.id into v_rebill_order_id
          from public.enterprise_payment_orders o
         where o.subscription_id = v_sub.id and o.status = 'paid'
         order by o.paid_at desc nulls last, o.created_at desc
         limit 1;
      end if;
      begin
        v_mirror := public._mirror_enterprise_payment_to_core(v_rebill_order_id);
      exception when others then
        v_mirror := jsonb_build_object('ok', false, 'error', SQLERRM);
        raise warning '[0515] rebill mirror failed for sub %: %', v_sub.id, SQLERRM;
      end;

      return jsonb_build_object('ok', true, 'status', 'rebill_paid',
                                'subscription_id', v_sub.id, 'core_mirror', v_mirror);
    end if;
    return jsonb_build_object('ok', true, 'status', 'ignored_rebill_state');
  end if;

  if not v_has_order then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if p_amount is not null and p_amount <> 0 and p_amount <> v_order.amount then
    return jsonb_build_object('ok', false, 'error', 'amount_mismatch');
  end if;

  if v_paid then
    if v_order.status <> 'paid' then
      update public.enterprise_payment_orders
         set status='paid', paid_at=now(),
             payapp_mul_no=coalesce(p_mul_no, payapp_mul_no),
             payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no),
             raw_response=coalesce(p_raw, raw_response)
       where id = v_order.id;
      update public.enterprise_payment_subscriptions
         set status='active', payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no),
             last_paid_at=now(), current_period_start=now(), current_period_end=now()+interval '1 month'
       where id = v_order.subscription_id;
      perform public._grant_enterprise_store_membership(v_order.payer_user_id);
    end if;

    -- 0515: 코어 결제 테이블 연동.
    -- 이미 paid 인 주문에 대해서도 돌린다 — 미러만 빠진 과거 건을
    -- 웹훅 재전송 한 번으로 복구할 수 있어야 한다(멱등).
    begin
      v_mirror := public._mirror_enterprise_payment_to_core(v_order.id);
    exception when others then
      v_mirror := jsonb_build_object('ok', false, 'error', SQLERRM);
      raise warning '[0515] mirror failed for order %: %', v_order.order_no, SQLERRM;
    end;

    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id,
                              'core_mirror', v_mirror);
  elsif p_pay_state in (8,9,32,70,71) then
    update public.enterprise_payment_orders set status='canceled',
           payapp_mul_no=coalesce(p_mul_no, payapp_mul_no)
     where id=v_order.id and status<>'paid';
    update public.enterprise_payment_subscriptions set status='canceled'
     where id=v_order.subscription_id and status<>'active';
    return jsonb_build_object('ok', true, 'status', 'canceled');
  else
    update public.enterprise_payment_orders set status='waiting' where id=v_order.id and status='requested';
    return jsonb_build_object('ok', true, 'status', 'waiting');
  end if;
end;
$$;

revoke execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) from public, anon, authenticated;
grant  execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 4) 백필 — 이미 결제된 엔터프라이즈 주문을 코어 테이블로 옮긴다
--    (숙대점 2026-09-06 결제 건이 여기서 복구된다)
-- ----------------------------------------------------------------------------
do $$
declare
  v_row record;
  v_res jsonb;
  v_ok int := 0;
  v_skip int := 0;
begin
  for v_row in
    select o.id, o.order_no
      from public.enterprise_payment_orders o
     where o.status = 'paid'
       and not exists (
         select 1 from public.payment_orders po where po.order_no = o.order_no
       )
     order by o.paid_at nulls last, o.created_at
  loop
    v_res := public._mirror_enterprise_payment_to_core(v_row.id);
    if coalesce((v_res->>'ok')::boolean, false) then
      v_ok := v_ok + 1;
    else
      v_skip := v_skip + 1;
      raise notice '[0515] backfill skipped %: %', v_row.order_no, v_res->>'error';
    end if;
  end loop;
  raise notice '[0515] backfill done — mirrored %, skipped %', v_ok, v_skip;
end $$;

-- ----------------------------------------------------------------------------
-- 5) 결제 사각지대 감지기(0511) — "미결제" 와 "미연동" 을 구분한다
--
--    no_payment_record 판정은 그대로 둔다(코어 테이블 기준). 엔터프라이즈 결제를
--    결제기록으로 쳐주면 미러가 또 끊겼을 때 감지기가 침묵해버린다.
--    대신 플래그를 하나 더 달아 운영자가 원인을 바로 가르게 한다.
-- ----------------------------------------------------------------------------
create or replace view public.v_billing_coverage_gap as
with recent_play as (
  select s.user_id,
         sum(s.verified_seconds) as verified_seconds_3d,
         max(s.created_at) as last_played_at
  from public.stream_sessions_v2 s
  where s.user_id is not null
    and s.created_at > now() - interval '3 days'
  group by s.user_id
  having sum(s.verified_seconds) > 600
),
store_user as (
  select u.id as user_id,
         u.nickname,
         u.subscription_type,
         u.membership_tier,
         (select fs.store_name from public.franchise_stores fs
           where fs.store_id = u.id limit 1) as store_name,
         exists (select 1 from public.franchise_stores fs where fs.store_id = u.id) as is_franchise
  from public.users u
)
select su.user_id,
       su.nickname,
       su.store_name,
       su.subscription_type,
       su.membership_tier,
       rp.verified_seconds_3d,
       rp.last_played_at,
       not exists (select 1 from public.payment_orders o where o.user_id = su.user_id)
         and not exists (select 1 from public.subscriptions sb where sb.user_id = su.user_id)
         as no_payment_record,
       coalesce(su.subscription_type,'') is distinct from coalesce(su.membership_tier,'')
         as tier_mismatch,
       -- 0515: 엔터프라이즈로는 결제했는데 코어 원장에 미러가 없는 상태.
       --       "미결제" 가 아니라 "미연동" — 대응이 완전히 다르다.
       exists (
         select 1 from public.enterprise_payment_orders eo
          where eo.payer_user_id = su.user_id
            and eo.status = 'paid'
            and not exists (
              select 1 from public.payment_orders po where po.order_no = eo.order_no
            )
       ) as enterprise_paid_unmirrored
from store_user su
join recent_play rp on rp.user_id = su.user_id
where su.is_franchise
   or su.membership_tier in ('business')
;

comment on view public.v_billing_coverage_gap is
  '재생 실적은 있는데 결제 기록이 없거나 등급 컬럼이 불일치하는 매장. 웹훅 유무와 무관하게 잡는다(0511). enterprise_paid_unmirrored = 엔터프라이즈 결제가 코어 원장에 미연동(0515).';

-- ----------------------------------------------------------------------------
-- 6) 진단 (무해)
-- ----------------------------------------------------------------------------
do $$
declare
  v_unmirrored int;
  v_gap int;
begin
  select count(*) into v_unmirrored
    from public.enterprise_payment_orders o
   where o.status = 'paid'
     and not exists (select 1 from public.payment_orders po where po.order_no = o.order_no);

  select count(*) into v_gap
    from public.v_billing_coverage_gap
   where no_payment_record or tier_mismatch or enterprise_paid_unmirrored;

  raise notice '[0515] 미연동 엔터프라이즈 결제 = % 건 (기대: 0)', v_unmirrored;
  raise notice '[0515] 결제 사각지대 매장 = % 곳', v_gap;
end $$;
