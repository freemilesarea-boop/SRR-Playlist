-- ============================================
-- 0042_subscription_cancel_handling.sql
--
-- 운영 진단:
--   5월 14일 결제건들 PayApp 정기결제 해지됐으나 웹에서는 active 로 표시.
--   현재 라우터는 paid/refund/cancel(결제전취소) 만 처리 — '정기결제 해지' 별도
--   처리 없음. paid_at 은 남아있지만 subscription 활성 상태 유지.
--
-- 정책 (A안 — 해지 즉시 회수):
--   PayApp 해지 webhook 수신 →
--     subscriptions.status = 'canceled'
--     subscriptions.auto_renew = false
--     subscriptions.canceled_at = now()
--     users.membership_tier = 'free'
--     users.subscription_type = 'free'
--   (payment_orders.status = 'paid' 그대로 유지 — 과거 결제는 인정됨)
--
-- 해지 감지 (Edge Function 측 isCancelSubscriptionWebhook):
--   raw_payload 에 다음 중 하나 존재 →
--     rebill_cancel=Y/true/1 / canceldate / cancel_at / stopdate /
--     subscr_status=canceled / rebill_status=stop|cancel|expired /
--     '정기결제해지' / 'unsubscribe'
--
-- 추가 사항:
--   - subscriptions / payment_orders 컬럼 보강
--   - _internal_apply_payapp_subscription_cancel_event RPC
--   - admin_backfill_subscription_cancels() — 운영자 호출용 백필
--   - admin_member_detail 의 'revenue' 섹션을 payment_orders 기반으로 전환
-- ============================================

-- ----------------------
-- 1) 컬럼 보강
-- ----------------------
alter table public.subscriptions
  add column if not exists auto_renew boolean not null default true,
  add column if not exists cancel_reason text,
  add column if not exists last_payapp_state int,
  add column if not exists last_payapp_state_label text;

alter table public.payment_orders
  add column if not exists cancel_reason text;

-- status CHECK 에 'cancel_scheduled' 추가 (B안 대비, 사용 안 해도 무해)
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (
  status in (
    'pending','active','canceled','cancelled','cancel_scheduled',
    'failed','expired','payment_waiting','refunded'
  )
);

-- ----------------------
-- 2) _internal_apply_payapp_subscription_cancel_event
-- ----------------------
create or replace function public._internal_apply_payapp_subscription_cancel_event(
  p_payapp_mul_no text,
  p_payapp_rebill_no text default null,
  p_reason text default 'PayApp 정기결제 해지',
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
  v_now timestamptz := coalesce(p_event_at, now());
  v_payload jsonb;
  v_tier text;
begin
  -- 매칭 우선순위: mul_no → rebill_no → 최근 active subscription (못 찾으면 종료)
  if p_payapp_mul_no is not null and length(btrim(p_payapp_mul_no)) > 0 then
    select po.user_id, po.id, po.subscription_id
      into v_user_id, v_order_id, v_sub_id
    from public.payment_orders as po
    where po.payapp_mul_no = btrim(p_payapp_mul_no)
    order by po.created_at desc limit 1;
  end if;

  if v_user_id is null and p_payapp_rebill_no is not null and length(btrim(p_payapp_rebill_no)) > 0 then
    select s.user_id, s.id into v_user_id, v_sub_id
    from public.subscriptions as s
    where s.payapp_rebill_no = btrim(p_payapp_rebill_no)
    order by s.created_at desc limit 1;
  end if;

  if v_user_id is null then
    return query select null::uuid, null::uuid, null::uuid, false, null::text,
      ('no matching subscription for cancel — mul_no=' || coalesce(p_payapp_mul_no,'∅') ||
       ', rebill_no=' || coalesce(p_payapp_rebill_no,'∅'))::text;
    return;
  end if;

  -- subscription 못 찾았으면 user 의 active/pending 으로 fallback
  if v_sub_id is null then
    select s.id into v_sub_id from public.subscriptions as s
    where s.user_id = v_user_id
    order by case s.status when 'active' then 0 when 'pending' then 1
                          when 'payment_waiting' then 2 else 3 end,
             s.created_at desc
    limit 1;
  end if;

  v_payload := jsonb_build_object(
    'subscription_canceled', true,
    'reason', p_reason,
    'event_at', v_now,
    'source', p_source,
    'mul_no', p_payapp_mul_no,
    'rebill_no', p_payapp_rebill_no
  );

  -- subscription 업데이트 (없으면 skip)
  if v_sub_id is not null then
    update public.subscriptions as s
    set status = 'canceled',
        auto_renew = false,
        canceled_at = coalesce(s.canceled_at, v_now),
        cancel_reason = coalesce(s.cancel_reason, p_reason),
        last_payapp_state_label = '정기결제 해지'
    where s.id = v_sub_id;
  end if;

  -- payment_orders: 가장 최근 paid 주문의 cancel_reason 만 기록 (status='paid' 유지 — 과거 결제는 인정)
  if v_order_id is not null then
    update public.payment_orders as po
    set cancel_reason = coalesce(po.cancel_reason, p_reason),
        raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
    where po.id = v_order_id;
  end if;

  -- users: 즉시 free 회수 (A안)
  update public.users as u
  set membership_tier = 'free',
      subscription_type = 'free'
  where u.id = v_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, true, v_tier,
    ('subscription canceled — membership=free (reason: ' || p_reason || ')')::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_subscription_cancel_event(text, text, text, timestamptz, text) from public;
grant execute on function public._internal_apply_payapp_subscription_cancel_event(text, text, text, timestamptz, text) to service_role;

-- ----------------------
-- 3) 운영자 백필 RPC — admin only
-- ----------------------
create or replace function public.admin_backfill_subscription_cancels(
  p_since timestamptz default null,
  p_dry_run boolean default true
)
returns table(
  applied int,
  scanned int,
  events jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  v_e record;
  v_scanned int := 0;
  v_applied int := 0;
  v_events jsonb := '[]'::jsonb;
  v_result record;
  v_since timestamptz := coalesce(p_since, now() - interval '30 days');
  v_label text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- 해지 신호가 있는 webhook event 스캔
  for v_e in
    select e.id, e.payapp_mul_no, e.payapp_rebill_no, e.raw_payload, e.created_at
    from public.payapp_webhook_events as e
    where e.created_at >= v_since
      and (
        coalesce(e.raw_payload->>'rebill_cancel','') in ('Y','1','true','TRUE','y')
        or coalesce(e.raw_payload->>'rebill_status','') ilike any (array['cancel%','stop%','expire%'])
        or coalesce(e.raw_payload->>'subscr_status','') ilike any (array['cancel%','stop%','expire%'])
        or nullif(e.raw_payload->>'canceldate','') is not null
        or nullif(e.raw_payload->>'cancel_at','') is not null
        or nullif(e.raw_payload->>'stopdate','') is not null
        or e.raw_payload::text ilike '%정기결제해지%'
        or e.raw_payload::text ilike '%정기결제 해지%'
        or e.raw_payload::text ilike '%unsubscribe%'
      )
    order by e.created_at asc
  loop
    v_scanned := v_scanned + 1;
    v_label := coalesce(
      nullif(v_e.raw_payload->>'rebill_status',''),
      nullif(v_e.raw_payload->>'subscr_status',''),
      'PayApp 해지 webhook'
    );

    if p_dry_run then
      v_events := v_events || jsonb_build_object(
        'event_id', v_e.id,
        'mul_no', v_e.payapp_mul_no,
        'rebill_no', v_e.payapp_rebill_no,
        'detected_label', v_label,
        'created_at', v_e.created_at
      );
    else
      select * into v_result from public._internal_apply_payapp_subscription_cancel_event(
        p_payapp_mul_no := v_e.payapp_mul_no,
        p_payapp_rebill_no := v_e.payapp_rebill_no,
        p_reason := v_label,
        p_event_at := v_e.created_at,
        p_source := 'backfill_0042'
      );
      if v_result.membership_updated then
        v_applied := v_applied + 1;
        update public.payapp_webhook_events as e
        set matched_user_id = coalesce(e.matched_user_id, v_result.matched_user_id),
            matched_subscription_id = coalesce(e.matched_subscription_id, v_result.matched_subscription_id),
            membership_updated = true,
            final_membership_tier = 'free',
            processing_error = null,
            processed_at = coalesce(e.processed_at, now()),
            state_label = coalesce(e.state_label, '정기결제 해지')
        where e.id = v_e.id;
      end if;
      v_events := v_events || jsonb_build_object(
        'event_id', v_e.id,
        'mul_no', v_e.payapp_mul_no,
        'user_id', v_result.matched_user_id,
        'message', v_result.message
      );
    end if;
  end loop;

  return query select v_applied, v_scanned, v_events;
end;
$$;

grant execute on function public.admin_backfill_subscription_cancels(timestamptz, boolean) to authenticated;

-- ----------------------
-- 4) admin_member_detail — 결제/매출 섹션을 payment_orders 기반으로 전환
--    (DROP+CREATE 로 안전 재배포. 다른 컬럼은 동일.)
-- ----------------------
drop function if exists public.admin_member_detail(uuid);

create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id, 'email', au.email, 'nickname', u.nickname,
      'role', u.role, 'subscription_type', u.subscription_type,
      'account_type', u.account_type, 'membership_tier', u.membership_tier,
      'business_category', u.business_category, 'created_at', u.created_at
    ),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan_type', s.plan_type,
        'price', s.price, 'auto_renew', s.auto_renew,
        'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason,
        'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no,
        'payapp_rebill_no', s.payapp_rebill_no,
        'created_at', s.created_at
      ) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (
      select count(*) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type='milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id
    ),
    'recent_visits', (
      select coalesce(
        jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc),
        '[]'::jsonb
      )
      from (
        select ve.path, ve.created_at from public.visitor_events as ve
        where ve.user_id = p_user_id order by ve.created_at desc limit 10
      ) as v
    ),
    'recent_plays', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'track_title', rp.track_title, 'playlist_title', rp.playlist_title,
          'completed', rp.completed, 'created_at', rp.created_at
        ) order by rp.created_at desc),
        '[]'::jsonb
      )
      from (
        select t.title as track_title, p.title as playlist_title,
               se.completed, se.created_at
        from public.stream_events as se
        left join public.tracks as t on t.id = se.track_id
        left join public.playlists as p on p.id = se.playlist_id
        where se.user_id = p_user_id and se.event_type='milestone_30s'
        order by se.created_at desc limit 10
      ) as rp
    ),
    -- 결제 기록: payment_orders 단일 진실의 원천
    'revenue', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'id', po.id,
          'amount', po.amount,
          'status', po.status,
          'plan_type', po.plan_type,
          'subscription_type', po.plan_type,  -- 구버전 UI 호환
          'payapp_mul_no', po.payapp_mul_no,
          'approval_no', po.approval_no,
          'paid_at', po.paid_at,
          'canceled_at', po.canceled_at,
          'refunded_at', po.refunded_at,
          'cancel_reason', po.cancel_reason,
          'created_at', po.created_at
        ) order by coalesce(po.paid_at, po.created_at) desc),
        '[]'::jsonb
      )
      from public.payment_orders as po where po.user_id = p_user_id
    ),
    'subscription_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requested_plan', sr.requested_plan,
        'status', sr.status, 'created_at', sr.created_at
      ) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests as sr where sr.user_id = p_user_id
    )
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;

-- ----------------------
-- 5) 확인
-- ----------------------
select
  'auto_renew_col=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='subscriptions' and column_name='auto_renew')
    then 'OK' else 'MISSING' end) as check_1,
  'cancel_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_apply_payapp_subscription_cancel_event')
    then 'OK' else 'MISSING' end) as check_2,
  'backfill_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_backfill_subscription_cancels')
    then 'OK' else 'MISSING' end) as check_3,
  'member_detail_uses_orders=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%public.payment_orders as po where po.user_id%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_member_detail')
        then 'OK' else 'MISSING' end) as check_4;
