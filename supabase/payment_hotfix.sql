-- ============================================
-- supabase/payment_hotfix.sql
--
-- 운영 DB 직접 적용용 단일 SQL (SQL Editor 붙여넣기 → Run).
-- 내용: supabase/migrations/0038_payment_candidate_and_dashboard_admin_hotfix.sql 과 동일.
--
-- 적용 효과:
--   1) admin_force_apply_paid_candidate(uuid, text) 생성 — 결제완료 후보 적용
--   2) admin_force_activate_membership 7-arg 시그니처로 강제 재배포
--   3) admin_revenue_summary() — payment_orders 기반 + _internal_is_admin_caller() 사용
--      → SQL Editor (postgres role) 에서도 실행 가능
--   4) admin_dashboard_stats() — payment_orders 기반 + SQL Editor 우회
--   5) list_recent_webhook_events() — paid_candidate / approval_no 컬럼 노출
--   6) payapp_webhook_events 트리거 — approval_no / paid_candidate 자동 계산
--
-- 파일 끝의 검증 SQL 결과 확인 후 115572403 적용:
--   select * from public.admin_force_apply_paid_candidate(
--     (select id from public.payapp_webhook_events where payapp_mul_no='115572403'
--      order by created_at desc limit 1),
--     'PayApp 관리자 결제완료 확인'
--   );
-- ============================================

-- ============================================
-- 0038_payment_candidate_and_dashboard_admin_hotfix.sql
--
-- 운영 진단:
--   1) function admin_force_apply_paid_candidate(uuid, unknown) does not exist
--      → 0037 미적용. RPC 부재.
--   2) admin_revenue_summary() 호출 시 'admin only' 에러 (SQL Editor 에서도)
--      → 운영 DB 는 아직 0002 의 옛 admin 체크 (where id = auth.uid()) 사용 중.
--
-- 0038 은 0037 의 핵심 4 RPC 를 DROP+CREATE 로 강제 재배포 + admin 체크를
-- 일관되게 _internal_is_admin_caller() 로 통일. 같은 SQL 을 supabase/payment_hotfix.sql
-- 에도 두어 SQL Editor 직접 붙여넣기 지원.
-- ============================================

-- ----------------------
-- 1) 컬럼 보강 (멱등) — 0037 이 안 돌았어도 동작하도록 재선언
-- ----------------------
alter table public.payment_orders
  add column if not exists approval_no text,
  add column if not exists paid_at timestamptz,
  add column if not exists canceled_at timestamptz,
  add column if not exists refunded_at timestamptz,
  add column if not exists payapp_state integer,
  add column if not exists payapp_state_label text;

alter table public.subscriptions
  add column if not exists refunded_at timestamptz,
  add column if not exists payapp_state_label text;

alter table public.payapp_webhook_events
  add column if not exists paid_candidate boolean not null default false,
  add column if not exists approval_no text,
  add column if not exists state_label text,
  add column if not exists matched_user_id uuid references public.users(id) on delete set null,
  add column if not exists matched_order_id uuid references public.payment_orders(id) on delete set null,
  add column if not exists matched_subscription_id uuid references public.subscriptions(id) on delete set null,
  add column if not exists membership_updated boolean not null default false,
  add column if not exists final_membership_tier text,
  add column if not exists processing_error text;

-- status CHECK 완화
alter table public.payment_orders drop constraint if exists payment_orders_status_check;
alter table public.payment_orders add constraint payment_orders_status_check check (
  status in ('requested','pending','paid','canceled','cancelled','failed','waiting','refunded')
);
alter table public.subscriptions drop constraint if exists subscriptions_status_check;
alter table public.subscriptions add constraint subscriptions_status_check check (
  status in ('pending','active','canceled','cancelled','failed','expired','payment_waiting','refunded')
);

-- ----------------------
-- 2) trigger (paid_candidate 자동 계산)
-- ----------------------
create or replace function public._payapp_webhook_event_compute()
returns trigger language plpgsql as $$
begin
  if new.approval_no is null and new.raw_payload is not null then
    new.approval_no := coalesce(
      new.raw_payload->>'approval_no', new.raw_payload->>'apv_no',
      new.raw_payload->>'card_apv_no', new.raw_payload->>'승인번호'
    );
  end if;
  new.paid_candidate := (
    new.pay_state = 4
    and new.approval_no is not null
    and length(btrim(new.approval_no)) > 0
    and not coalesce(new.membership_updated, false)
  );
  return new;
end;
$$;
drop trigger if exists trg_payapp_webhook_event_compute on public.payapp_webhook_events;
create trigger trg_payapp_webhook_event_compute
  before insert or update on public.payapp_webhook_events
  for each row execute function public._payapp_webhook_event_compute();

-- 기존 행에 트리거 적용
update public.payapp_webhook_events as e
set raw_payload = e.raw_payload
where e.approval_no is null and e.raw_payload is not null;

-- ----------------------
-- 3) admin_force_activate_membership — 7-arg signature 강제 (DROP+CREATE)
-- ----------------------
drop function if exists public.admin_force_activate_membership(uuid, text, text, integer);
drop function if exists public.admin_force_activate_membership(uuid, text, text, integer, text, text, timestamptz);

create or replace function public.admin_force_activate_membership(
  p_user_id uuid,
  p_plan_type text default 'individual',
  p_reason text default null,
  p_amount integer default null,
  p_payapp_mul_no text default null,
  p_approval_no text default null,
  p_paid_at timestamptz default null
)
returns table(
  user_id uuid,
  subscription_id uuid,
  order_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_amount integer;
  v_sub_id uuid;
  v_order_id uuid;
  v_tier text;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_payload jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  if p_user_id is null then raise exception 'p_user_id required'; end if;
  if p_plan_type not in ('individual','business') then raise exception 'invalid plan_type'; end if;
  if not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  v_amount := coalesce(p_amount, case when p_plan_type='individual' then 4900 else 6900 end);

  v_payload := jsonb_build_object(
    'force_activated', true,
    'reason', coalesce(p_reason, 'admin manual activation'),
    'plan_type', p_plan_type,
    'amount', v_amount,
    'payapp_mul_no', p_payapp_mul_no,
    'approval_no', p_approval_no,
    'paid_at', v_paid_at,
    'activated_by', auth.uid(),
    'activated_at', now()
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
    update public.subscriptions as s
    set status = 'active', plan_type = p_plan_type, price = v_amount,
        last_paid_at = v_paid_at,
        current_period_start = v_paid_at,
        current_period_end = v_paid_at + interval '1 month',
        payapp_mul_no = coalesce(s.payapp_mul_no, p_payapp_mul_no),
        canceled_at = null, refunded_at = null
    where s.id = v_sub_id;
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

  update public.users as u
  set membership_tier = p_plan_type, subscription_type = p_plan_type
  where u.id = p_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = p_user_id;

  return query select p_user_id, v_sub_id, v_order_id, true, v_tier,
    ('force-activated: ' || coalesce(p_reason,'(no reason)') || ' (tier=' || v_tier || ')')::text;
end;
$$;

grant execute on function public.admin_force_activate_membership(uuid, text, text, integer, text, text, timestamptz)
  to authenticated;

-- ----------------------
-- 4) admin_force_apply_paid_candidate — DROP+CREATE
-- ----------------------
drop function if exists public.admin_force_apply_paid_candidate(uuid, text);

create or replace function public.admin_force_apply_paid_candidate(
  p_event_id uuid,
  p_reason text default 'PayApp 관리자 결제완료 확인'
)
returns table(
  user_id uuid,
  subscription_id uuid,
  order_id uuid,
  membership_updated boolean,
  final_membership_tier text,
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
  v_phone_clean text;
  v_approval_no text;
  v_paid_at timestamptz;
  v_user_id uuid;
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
  if v_amount = 4900 then v_plan_type := 'individual';
  elsif v_amount = 6900 then v_plan_type := 'business';
  else raise exception 'unsupported amount %', v_amount;
  end if;

  v_approval_no := coalesce(
    v_event.approval_no,
    v_payload->>'approval_no', v_payload->>'apv_no',
    v_payload->>'card_apv_no', v_payload->>'승인번호'
  );
  v_paid_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    v_event.created_at, now()
  );

  -- 사용자 매칭: matched_user_id → event.user_id → order_no 주문 → email → phone
  v_user_id := v_event.matched_user_id;

  if v_user_id is null then
    v_user_id := v_event.user_id;
  end if;

  if v_user_id is null and v_event.order_no is not null then
    select po.user_id into v_user_id from public.payment_orders as po
    where po.order_no = v_event.order_no limit 1;
  end if;

  if v_user_id is null and v_event.payapp_mul_no is not null then
    select po.user_id into v_user_id from public.payment_orders as po
    where po.payapp_mul_no = v_event.payapp_mul_no limit 1;
  end if;

  if v_user_id is null then
    v_email := nullif(lower(coalesce(
      v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
      v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
      v_payload->>'구매자이메일', '')), '');
    v_phone := coalesce(
      v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
      v_payload->>'recv_phone', v_payload->>'reqphone',
      v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
      v_payload->>'receiver_phone', v_payload->>'receiverphone',
      v_payload->>'구매자번호', v_payload->>'구매자전화번호', '');
    v_phone_clean := regexp_replace(v_phone, '[^0-9]', '', 'g');

    if v_email is not null and v_email <> '' then
      select u.id into v_user_id
      from auth.users as au join public.users as u on u.id = au.id
      where lower(au.email) = v_email limit 1;
    end if;
    if v_user_id is null and v_phone_clean <> '' then
      select u.id into v_user_id from public.users as u
      where regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g') = v_phone_clean
      limit 1;
    end if;
    if v_user_id is null and v_phone_clean <> '' then
      select ap.user_id into v_user_id from public.artist_profiles as ap
      where regexp_replace(coalesce(ap.phone,''), '[^0-9]', '', 'g') = v_phone_clean
      limit 1;
    end if;
  end if;

  if v_user_id is null then
    raise exception 'cannot resolve user for event % (mul_no=%)', p_event_id, v_event.payapp_mul_no;
  end if;

  select * into v_result from public.admin_force_activate_membership(
    p_user_id := v_user_id,
    p_plan_type := v_plan_type,
    p_reason := coalesce(p_reason, 'force_apply_paid_candidate mul_no=' || v_event.payapp_mul_no),
    p_amount := v_amount,
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_approval_no := v_approval_no,
    p_paid_at := v_paid_at
  );

  update public.payapp_webhook_events as e
  set matched_user_id = coalesce(e.matched_user_id, v_user_id),
      matched_order_id = coalesce(e.matched_order_id, v_result.order_id),
      matched_subscription_id = coalesce(e.matched_subscription_id, v_result.subscription_id),
      membership_updated = true,
      final_membership_tier = v_result.final_membership_tier,
      paid_candidate = false,
      processing_error = null,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select v_user_id, v_result.subscription_id, v_result.order_id,
    true, v_result.final_membership_tier, v_result.message;
end;
$$;

grant execute on function public.admin_force_apply_paid_candidate(uuid, text) to authenticated;

-- ----------------------
-- 5) admin_revenue_summary — DROP+CREATE, payment_orders 기반
-- ----------------------
drop function if exists public.admin_revenue_summary();

create or replace function public.admin_revenue_summary()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- 단일 진실의 원천: payment_orders.status='paid' + paid_at
  -- 사용자 요구한 컬럼명(today_revenue 등) + 기존 컬럼명(today 등) 둘 다 노출
  select jsonb_build_object(
    'today_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= today_start), 0),
    'week_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= week_start), 0),
    'month_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= month_start), 0),
    'total_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid'), 0),
    'refunded_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='refunded'), 0),
    'paid_count', (select count(*) from public.payment_orders as po where po.status='paid'),
    'refunded_count', (select count(*) from public.payment_orders as po where po.status='refunded'),
    -- 구버전 호환 (RevenueManagement.tsx 가 today/week/month/total/by_plan/by_status/recent 사용)
    'today', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= today_start), 0),
    'week', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= week_start), 0),
    'month', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= month_start), 0),
    'total', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid'), 0),
    'by_plan', coalesce((
      select jsonb_object_agg(plan_type, amt) from (
        select po.plan_type, sum(po.amount) as amt
        from public.payment_orders as po where po.status='paid'
        group by po.plan_type
      ) bp), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, amt) from (
        select po.status, sum(po.amount) as amt
        from public.payment_orders as po
        group by po.status
      ) bs), '{}'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', po.id,
        'email', au.email,
        'nickname', u.nickname,
        'plan_type', po.plan_type,
        'subscription_type', po.plan_type,
        'amount', po.amount,
        'status', po.status,
        'payapp_mul_no', po.payapp_mul_no,
        'approval_no', po.approval_no,
        'paid_at', po.paid_at,
        'refunded_at', po.refunded_at
      ) order by coalesce(po.paid_at, po.created_at) desc)
      from (
        select po2.* from public.payment_orders as po2
        where po2.status in ('paid','refunded')
        order by coalesce(po2.paid_at, po2.created_at) desc
        limit 50
      ) as po
      left join public.users as u on u.id = po.user_id
      left join auth.users as au on au.id = po.user_id
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_revenue_summary() to authenticated;

-- ----------------------
-- 6) admin_dashboard_stats — DROP+CREATE
-- ----------------------
drop function if exists public.admin_dashboard_stats();

create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'today_visitors', (select count(*) from public.visitor_events as ve where ve.created_at >= today_start),
    'today_unique_visitors', (select count(distinct ve.session_id) from public.visitor_events as ve
      where ve.created_at >= today_start),
    'today_streams', (select count(*) from public.stream_events as se
      where se.created_at >= today_start and se.event_type='milestone_30s'),
    'today_new_users', (select count(*) from public.users as u where u.created_at >= today_start),
    -- 매출: payment_orders.status='paid'
    'today_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= today_start), 0),
    'week_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= week_start), 0),
    'month_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.paid_at >= month_start), 0),
    'total_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid'), 0),
    -- 활성 구독자: subscriptions.status='active'
    'active_subscribers', (select count(*) from public.subscriptions as s where s.status='active'),
    -- 플랜별: users.membership_tier
    'free_users', (select count(*) from public.users as u where coalesce(u.membership_tier,'free')='free'),
    'personal_users', (select count(*) from public.users as u where u.membership_tier='individual'),
    'business_users', (select count(*) from public.users as u where u.membership_tier='business'),
    'total_users', (select count(*) from public.users),
    'pending_subscriptions', (select count(*) from public.subscription_requests as sr
      where sr.status='pending')
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_dashboard_stats() to authenticated;

-- ----------------------
-- 7) list_recent_webhook_events — paid_candidate / approval_no 노출
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
  processing_error text,
  paid_candidate boolean, approval_no text,
  created_at timestamptz
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
         e.paid_candidate, e.approval_no, e.created_at
  from public.payapp_webhook_events as e
  left join auth.users as au on au.id = e.matched_user_id
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (v_search = '' or e.payapp_mul_no = v_search or e.order_no = v_search
         or e.raw_payload::text ilike '%' || v_search || '%')
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_webhook_events(text, int, int) to authenticated;

-- ----------------------
-- 최종 확인
-- ----------------------
select proname,
       pg_get_function_identity_arguments(p.oid) as args
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname='public' and p.proname in (
  'admin_force_apply_paid_candidate',
  'admin_force_activate_membership',
  'admin_revenue_summary',
  'admin_dashboard_stats',
  'list_recent_webhook_events'
)
order by p.proname;


-- ============================================
-- 검증 SQL (SQL Editor 결과 패널에서 확인)
-- ============================================

-- [1] 4 RPC 시그니처 확인
select proname, pg_get_function_identity_arguments(oid) as args
from pg_proc
where proname in (
  'admin_force_apply_paid_candidate',
  'admin_force_activate_membership',
  'admin_revenue_summary',
  'admin_dashboard_stats'
)
order by proname;

-- [2] admin_revenue_summary SQL Editor 에서 작동 확인 (← 이전 운영 에러 재현 검증)
select public.admin_revenue_summary();

-- [3] (선택) 115572403 결제완료 후보 자동 적용
-- 실행 전 PayApp 관리자에서 결제완료 재확인하세요.
-- 아래 do 블록 주석 해제 후 Run:
-- do $$
-- declare v_eid uuid; v_r record;
-- begin
--   select id into v_eid from public.payapp_webhook_events
--   where payapp_mul_no = '115572403' order by created_at desc limit 1;
--   if v_eid is null then
--     raise notice 'event for 115572403 not found';
--     return;
--   end if;
--   for v_r in select * from public.admin_force_apply_paid_candidate(v_eid, 'PayApp 관리자 결제완료 확인 (115572403)') loop
--     raise notice 'applied: user_id=% sub=% order=% tier=% msg=%',
--       v_r.user_id, v_r.subscription_id, v_r.order_id, v_r.final_membership_tier, v_r.message;
--   end loop;
-- end$$;

-- [4] 매출 반영 확인
select
  (public.admin_dashboard_stats()->>'today_revenue')::int as today,
  (public.admin_dashboard_stats()->>'month_revenue')::int as month,
  (public.admin_dashboard_stats()->>'total_revenue')::int as total;


-- ============================================
-- [추가] 0039 — 최근 7일 매출 그래프 payment_orders 기반 재작성
-- (필요 시 위 0038 적용 후 이 블록도 함께 Run)
-- ============================================
drop function if exists public.admin_daily_series(int);
drop function if exists public.admin_daily_series(integer);

create or replace function public.admin_daily_series(days int default 7)
returns table(d date, visitors bigint, unique_visitors bigint, streams bigint, revenue bigint)
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  with day_series as (
    select ((current_date at time zone 'Asia/Seoul')::date - (offs))::date as d
    from generate_series(greatest(1, days) - 1, 0, -1) as g(offs)
  )
  select ds.d,
    coalesce((select count(*)::bigint from public.visitor_events as ve
              where (ve.created_at at time zone 'Asia/Seoul')::date = ds.d), 0),
    coalesce((select count(distinct ve.session_id)::bigint from public.visitor_events as ve
              where (ve.created_at at time zone 'Asia/Seoul')::date = ds.d), 0),
    coalesce((select count(*)::bigint from public.stream_events as se
              where (se.created_at at time zone 'Asia/Seoul')::date = ds.d
                and se.event_type='milestone_30s'), 0),
    coalesce((select sum(po.amount)::bigint from public.payment_orders as po
              where po.status='paid' and po.refunded_at is null
                and po.paid_at is not null
                and (po.paid_at at time zone 'Asia/Seoul')::date = ds.d), 0)
  from day_series ds order by ds.d asc;
end;
$$;
grant execute on function public.admin_daily_series(int) to authenticated;

-- 검증
select d, revenue from public.admin_daily_series(7);
