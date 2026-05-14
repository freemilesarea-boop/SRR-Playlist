-- ============================================
-- 0029_webhook_apply_internal.sql
--
-- 목표:
--   1) payapp_webhook_events 에 진단/추적 컬럼 추가 (matched_user_id 등)
--   2) _internal_apply_payapp_paid_event 공용 RPC — webhook / admin / replay
--      모두에서 동일한 user matching + membership 적용 로직 사용.
--   3) admin_replay_webhook_event(p_event_id) — 저장된 webhook 이벤트 재처리
--   4) admin_replay_webhook_by_mul_no(p_mul_no) — mul_no 기반 편의 wrapper
--   5) list_recent_webhook_events 확장 — 신규 컬럼 반환
--
-- 핵심 설계:
--   - _internal 은 admin 검사 없음. service_role(Edge Function) + admin RPC 둘 다
--     호출 가능. RLS 우회.
--   - admin_sync_payapp_payment 는 그대로 유지 (payapp_manual_payment_imports
--     멱등 + unmatched 큐 관리). 내부적으로는 _internal 호출 안 함 (이미 검증된
--     기존 로직 그대로 두는 게 안전).
-- ============================================

-- ----------------------
-- 1) payapp_webhook_events 진단 컬럼
-- ----------------------
alter table public.payapp_webhook_events
  add column if not exists matched_user_id uuid references public.users(id) on delete set null,
  add column if not exists matched_order_id uuid references public.payment_orders(id) on delete set null,
  add column if not exists matched_subscription_id uuid references public.subscriptions(id) on delete set null,
  add column if not exists membership_updated boolean not null default false,
  add column if not exists final_membership_tier text,
  add column if not exists processing_error text;

create index if not exists idx_webhook_matched_user on public.payapp_webhook_events(matched_user_id);

-- ----------------------
-- 1b) users.subscription_type CHECK 완화
--    0001 의 check (subscription_type in ('free','personal','business')) 가
--    membership_tier 와 함께 'individual' 을 거부 → webhook 의 dual-write 가
--    silently 실패하면서 membership_tier 도 적용 안 되던 버그의 진짜 원인.
--    'individual' 도 허용하도록 완화.
-- ----------------------
alter table public.users drop constraint if exists users_subscription_type_check;
alter table public.users add constraint users_subscription_type_check
  check (subscription_type in ('free','personal','business','individual'));

-- ----------------------
-- 2) _internal_apply_payapp_paid_event
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

  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '\D', '', 'g');

  -- 1) order_no exact (webhook var1 가 있을 때)
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
    where regexp_replace(coalesce(u.phone,''), '\D', '', 'g') = v_phone_clean
    limit 1;
  end if;

  -- 5) artist_profiles.phone
  if v_user_id is null and v_phone_clean <> '' then
    select ap.user_id into v_user_id
    from public.artist_profiles ap
    where regexp_replace(coalesce(ap.phone,''), '\D', '', 'g') = v_phone_clean
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

  if v_user_id is null then
    -- 매칭 실패 — 호출자가 imports 큐로 라우팅하도록 NULL 반환
    return query select
      null::uuid, null::uuid, null::uuid,
      false, null::text,
      'no matching user — caller should enqueue to manual imports'::text;
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

  -- subscription 매칭 또는 생성
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

  -- 적용
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

  -- 적용 후 실제 tier 조회 (RLS / 정책 영향 없는지 검증)
  select u.membership_tier into v_tier from public.users u where u.id = v_user_id;

  return query select
    v_user_id, v_order_id, v_sub_id,
    true, v_tier,
    'membership_tier=' || coalesce(v_tier, '?') || ' applied'::text;
end;
$$;

-- service_role 만 호출 가능 (Edge Function context). authenticated 권한 부여 안 함.
revoke execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public._internal_apply_payapp_paid_event(text, integer, text, text, text, timestamptz, text, text, text, text) to service_role;

-- ----------------------
-- 3) admin_replay_webhook_event — 저장된 webhook event 재처리
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

  v_email := lower(coalesce(
    v_payload->>'recvemail',
    v_payload->>'buyer_email',
    v_payload->>'email', ''));
  v_phone := coalesce(
    v_payload->>'recvphone',
    v_payload->>'buyer_phone',
    v_payload->>'phone', '');
  v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname');
  v_approval_no := coalesce(v_payload->>'approval_no', v_payload->>'apv_no', v_payload->>'card_apv_no');
  v_paid_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    v_event.created_at,
    now());

  select * into v_result from public._internal_apply_payapp_paid_event(
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_amount := v_amount,
    p_plan_type := v_plan_type,
    p_buyer_email := nullif(v_email, ''),
    p_buyer_phone := nullif(v_phone, ''),
    p_paid_at := v_paid_at,
    p_approval_no := v_approval_no,
    p_goodname := v_goodname,
    p_order_no := v_event.order_no,
    p_source := 'replay_event'
  );

  -- webhook event row 에 결과 writeback
  update public.payapp_webhook_events as e
  set matched_user_id = v_result.matched_user_id,
      matched_order_id = v_result.matched_order_id,
      matched_subscription_id = v_result.matched_subscription_id,
      membership_updated = v_result.membership_updated,
      final_membership_tier = v_result.final_membership_tier,
      processing_error = case when v_result.membership_updated then null else v_result.message end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select
    v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
    v_result.membership_updated, v_result.final_membership_tier, v_result.message;
end;
$$;

grant execute on function public.admin_replay_webhook_event(uuid) to authenticated;

-- ----------------------
-- 4) admin_replay_webhook_by_mul_no — 편의 wrapper
-- ----------------------
create or replace function public.admin_replay_webhook_by_mul_no(p_mul_no text)
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
  v_event_id uuid;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  select e.id into v_event_id
  from public.payapp_webhook_events e
  where e.payapp_mul_no = btrim(p_mul_no)
  order by e.created_at desc
  limit 1;
  if v_event_id is null then raise exception 'no webhook event for mul_no=%', p_mul_no; end if;

  return query select * from public.admin_replay_webhook_event(v_event_id);
end;
$$;

grant execute on function public.admin_replay_webhook_by_mul_no(text) to authenticated;

-- ----------------------
-- 5) list_recent_webhook_events 확장 — 신규 컬럼 반환
-- ----------------------
drop function if exists public.list_recent_webhook_events(text, int, int);
create or replace function public.list_recent_webhook_events(
  p_search text default null,
  p_minutes int default 60,
  p_limit int default 50
)
returns table(
  id uuid,
  event_key text,
  order_no text,
  user_id uuid,
  payapp_mul_no text,
  payapp_rebill_no text,
  pay_state integer,
  price integer,
  linkval_verified boolean,
  processed_at timestamptz,
  reasons text,
  matched_user_id uuid,
  matched_user_email text,
  matched_order_id uuid,
  matched_subscription_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  processing_error text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_search text := btrim(coalesce(p_search, ''));
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select e.id, e.event_key, e.order_no, e.user_id, e.payapp_mul_no, e.payapp_rebill_no,
         e.pay_state, e.price, e.linkval_verified, e.processed_at,
         coalesce(e.raw_payload->'_verification'->>'reasons', '')::text as reasons,
         e.matched_user_id, au.email::text as matched_user_email,
         e.matched_order_id, e.matched_subscription_id,
         e.membership_updated, e.final_membership_tier, e.processing_error,
         e.created_at
  from public.payapp_webhook_events e
  left join auth.users au on au.id = e.matched_user_id
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (
      v_search = '' or
      e.payapp_mul_no = v_search or
      e.order_no = v_search or
      e.raw_payload::text ilike '%' || v_search || '%'
    )
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_webhook_events(text, int, int) to authenticated;

-- 확인
select
  'event_matched_user_col=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payapp_webhook_events' and column_name='matched_user_id')
    then 'OK' else 'MISSING' end) as check_1,
  'internal_apply_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_apply_payapp_paid_event')
    then 'OK' else 'MISSING' end) as check_2,
  'replay_event_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_replay_webhook_event')
    then 'OK' else 'MISSING' end) as check_3,
  'replay_by_mul_no_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_replay_webhook_by_mul_no')
    then 'OK' else 'MISSING' end) as check_4;
