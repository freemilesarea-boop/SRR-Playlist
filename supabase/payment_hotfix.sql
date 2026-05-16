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


-- ============================================
-- [추가] 0040 — 정책 단순화 (state=4+approval_no 도 자동 paid)
-- ============================================
drop function if exists public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text);

create or replace function public._internal_apply_payapp_event(
  p_payapp_mul_no text, p_pay_state integer,
  p_amount integer default null, p_plan_type text default 'individual',
  p_buyer_email text default null, p_buyer_phone text default null,
  p_event_at timestamptz default now(), p_approval_no text default null,
  p_goodname text default null, p_order_no text default null,
  p_source text default 'unknown'
)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text,
  final_status text, message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_result record;
  v_is_state_4_paid boolean := (
    p_pay_state = 4 and p_approval_no is not null
    and length(btrim(p_approval_no)) > 0 and coalesce(p_amount, 0) > 0
  );
begin
  if p_pay_state = 64 or v_is_state_4_paid then
    if p_amount is null or p_amount <= 0 then
      return query select null::uuid, null::uuid, null::uuid, false, null::text, 'paid'::text,
        'paid event missing/invalid amount'::text;
      return;
    end if;
    select * into v_result from public._internal_apply_payapp_paid_event(
      p_payapp_mul_no := p_payapp_mul_no, p_amount := p_amount, p_plan_type := p_plan_type,
      p_buyer_email := p_buyer_email, p_buyer_phone := p_buyer_phone,
      p_paid_at := p_event_at, p_approval_no := p_approval_no,
      p_goodname := p_goodname, p_order_no := p_order_no, p_source := p_source
    );
    return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
      v_result.membership_updated, v_result.final_membership_tier, 'paid'::text, v_result.message;
    return;
  end if;
  if p_pay_state in (8, 9, 32, 70, 71) then
    select * into v_result from public._internal_apply_payapp_refund_event(
      p_payapp_mul_no := p_payapp_mul_no, p_pay_state := p_pay_state,
      p_event_at := p_event_at, p_source := p_source
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
revoke execute on function public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text) from public;
grant execute on function public._internal_apply_payapp_event(text, integer, integer, text, text, text, timestamptz, text, text, text, text) to service_role;

-- 백필: state=4 + approval_no + membership 미적용 → 모두 자동 paid 처리
do $$
declare v_e record; v_payload jsonb; v_amount int; v_plan text; v_r record;
begin
  for v_e in
    select * from public.payapp_webhook_events
    where pay_state=4 and approval_no is not null
      and length(btrim(approval_no)) > 0
      and coalesce(membership_updated, false) = false
      and coalesce(price, 0) > 0
    order by created_at asc
  loop
    v_payload := coalesce(v_e.raw_payload, '{}'::jsonb);
    v_amount := coalesce(v_e.price, nullif(v_payload->>'price','')::int);
    v_plan := case when v_amount = 6900 then 'business' else 'individual' end;
    begin
      select * into v_r from public._internal_apply_payapp_event(
        p_payapp_mul_no := v_e.payapp_mul_no, p_pay_state := 4,
        p_amount := v_amount, p_plan_type := v_plan,
        p_buyer_phone := coalesce(v_payload->>'recvphone', v_payload->>'phone', v_payload->>'hp', ''),
        p_event_at := coalesce(nullif(v_payload->>'paid_at','')::timestamptz, v_e.created_at, now()),
        p_approval_no := v_e.approval_no, p_order_no := v_e.order_no,
        p_source := 'backfill_hotfix_0040'
      );
      if v_r.membership_updated then
        update public.payapp_webhook_events as e
        set matched_user_id = v_r.matched_user_id,
            matched_order_id = v_r.matched_order_id,
            matched_subscription_id = v_r.matched_subscription_id,
            membership_updated = true,
            final_membership_tier = v_r.final_membership_tier,
            paid_candidate = false,
            processing_error = null,
            processed_at = coalesce(e.processed_at, now())
        where e.id = v_e.id;
        raise notice 'backfilled mul_no=% tier=%', v_e.payapp_mul_no, v_r.final_membership_tier;
      end if;
    exception when others then
      raise notice 'backfill error mul_no=% : %', v_e.payapp_mul_no, sqlerrm;
    end;
  end loop;
end$$;

-- 검증
select payapp_mul_no, pay_state, approval_no, membership_updated, final_membership_tier
from public.payapp_webhook_events
where pay_state in (4, 64) order by created_at desc limit 10;


-- ============================================
-- [추가] 0041 — 운영 로그 시스템 (admin_operation_logs + 4 RPC)
-- ============================================
  status text not null,         -- 'started','completed','failed','skipped' 등
  message text not null,
  details jsonb not null default '{}'::jsonb,
  user_id uuid references public.users(id) on delete set null,
  related_id text,              -- 자유 형식 식별자 (payapp_mul_no / order_no / event_id 등)
  duration_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_op_logs_created
  on public.admin_operation_logs(created_at desc);
create index if not exists idx_admin_op_logs_source
  on public.admin_operation_logs(source);
create index if not exists idx_admin_op_logs_category
  on public.admin_operation_logs(category);
create index if not exists idx_admin_op_logs_level
  on public.admin_operation_logs(level);
create index if not exists idx_admin_op_logs_related
  on public.admin_operation_logs(related_id);

alter table public.admin_operation_logs enable row level security;

drop policy if exists "op_logs_admin_select" on public.admin_operation_logs;
create policy "op_logs_admin_select" on public.admin_operation_logs
  for select using (
    exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin')
  );
-- INSERT 는 RLS 거치지 않는 service_role / security definer RPC 만 허용.

-- ----------------------
-- admin_log_operation — 호출자 RPC/Edge 가 사용. NEVER 실패하지 않음.
-- ----------------------
create or replace function public.admin_log_operation(
  p_source text,
  p_category text,
  p_level text,
  p_status text,
  p_message text,
  p_details jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_related_id text default null,
  p_duration_ms int default null,
  p_error_code text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  -- level 검증 (잘못된 값이 들어와도 'info' 로 fallback — 호출자를 막지 않음)
  insert into public.admin_operation_logs
    (source, category, level, status, message, details, user_id,
     related_id, duration_ms, error_code, error_message)
  values (
    coalesce(nullif(btrim(p_source), ''), 'unknown'),
    coalesce(nullif(btrim(p_category), ''), 'system'),
    case when p_level in ('info','success','warning','error') then p_level else 'info' end,
    coalesce(nullif(btrim(p_status), ''), 'unknown'),
    coalesce(nullif(btrim(p_message), ''), '(empty)'),
    coalesce(p_details, '{}'::jsonb),
    p_user_id, p_related_id, p_duration_ms, p_error_code, p_error_message
  )
  returning id into v_id;
  return v_id;
exception when others then
  -- 로그 기록 자체가 호출자를 막으면 안 됨
  return null;
end;
$$;

-- admin RPC / Edge Function service_role 만 호출. authenticated 차단.
revoke execute on function public.admin_log_operation(text,text,text,text,text,jsonb,uuid,text,int,text,text) from public;
do $$
begin
  begin grant execute on function public.admin_log_operation(text,text,text,text,text,jsonb,uuid,text,int,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ----------------------
-- list_admin_operation_logs — admin 조회 + 필터
-- ----------------------
create or replace function public.list_admin_operation_logs(
  p_limit int default 100,
  p_level text default null,
  p_category text default null,
  p_source text default null,
  p_search text default null
)
returns table(
  id uuid,
  source text, category text, level text, status text,
  message text, details jsonb,
  user_id uuid, user_email text,
  related_id text,
  duration_ms int,
  error_code text, error_message text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_search text := btrim(coalesce(p_search, ''));
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select l.id, l.source, l.category, l.level, l.status, l.message, l.details,
         l.user_id, au.email::text as user_email,
         l.related_id, l.duration_ms, l.error_code, l.error_message, l.created_at
  from public.admin_operation_logs as l
  left join auth.users as au on au.id = l.user_id
  where (p_level is null or l.level = p_level)
    and (p_category is null or l.category = p_category)
    and (p_source is null or l.source ilike '%' || p_source || '%')
    and (
      v_search = ''
      or l.message ilike '%' || v_search || '%'
      or coalesce(l.related_id,'') ilike '%' || v_search || '%'
      or l.details::text ilike '%' || v_search || '%'
      or coalesce(l.error_message,'') ilike '%' || v_search || '%'
    )
  order by l.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_admin_operation_logs(int, text, text, text, text) to authenticated;

-- ----------------------
-- admin_operation_log_kpi — 최근 24h KPI
-- ----------------------
create or replace function public.admin_operation_log_kpi()
returns jsonb
language plpgsql security definer set search_path = public
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
    'errors_24h', (select count(*) from public.admin_operation_logs as l
                   where l.created_at > now() - interval '24 hours' and l.level = 'error'),
    'warnings_24h', (select count(*) from public.admin_operation_logs as l
                     where l.created_at > now() - interval '24 hours' and l.level = 'warning'),
    'success_24h', (select count(*) from public.admin_operation_logs as l
                    where l.created_at > now() - interval '24 hours' and l.level = 'success'),
    'payment_24h', (select count(*) from public.admin_operation_logs as l
                    where l.created_at > now() - interval '24 hours' and l.category = 'payment'),
    'total_24h', (select count(*) from public.admin_operation_logs as l
                  where l.created_at > now() - interval '24 hours')
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.admin_operation_log_kpi() to authenticated;

-- ----------------------
-- clear_old_admin_operation_logs — 30일 이전 정리
-- ----------------------
create or replace function public.clear_old_admin_operation_logs(p_days int default 30)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_deleted int;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  delete from public.admin_operation_logs
  where created_at < now() - make_interval(days => greatest(1, p_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.clear_old_admin_operation_logs(int) to authenticated;

-- 확인
select
  'logs_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_1,
  'log_op_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_log_operation')
    then 'OK' else 'MISSING' end) as check_2,
  'list_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_3,
  'kpi_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_operation_log_kpi')
    then 'OK' else 'MISSING' end) as check_4,
  'clear_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='clear_old_admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_5;


-- ============================================
-- [추가] 0042 — 정기결제 해지 처리 + admin_member_detail payment_orders 기반
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


-- ============================================
-- [추가] 0043 — list_subscription_requests RPC
-- ============================================
returns table(
  id uuid,
  user_id uuid,
  email text,
  nickname text,
  account_type text,
  requested_plan text,
  status text,
  note text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    sr.id,
    sr.user_id,
    au.email::text as email,
    u.nickname,
    coalesce(u.account_type, 'individual')::text as account_type,
    sr.requested_plan,
    sr.status,
    sr.note,
    sr.created_at
  from public.subscription_requests as sr
  left join public.users as u on u.id = sr.user_id
  left join auth.users as au on au.id = sr.user_id
  order by
    case sr.status when 'pending' then 0 when 'contacted' then 1 else 2 end,
    sr.created_at desc;
end;
$$;

grant execute on function public.list_subscription_requests() to authenticated;

-- 확인
select
  'list_sub_req_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_subscription_requests')
    then 'OK' else 'MISSING' end) as check_1,
  'sub_req_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='subscription_requests')
    then 'OK' else 'MISSING' end) as check_2;


-- ============================================
-- [추가] 0044 — router 시그니처 강제 재배포 + list_manual_payment_imports
--                ambiguous id 수정 + list_pending_payout_accounts alias 보강
-- ============================================
-- STEP 1) _internal_apply_payapp_event + 의존 RPC 모두 DROP
-- ----------------------
do $$
declare v_func record; v_dropped int := 0;
begin
  raise notice '== BEFORE: _internal_apply_payapp_event 오버로드 ==';
  for v_func in
    select p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_apply_payapp_event'
  loop
    raise notice '  found: %(%)', v_func.proname, v_func.args;
    -- CASCADE 로 admin_replay_webhook_event / admin_replay_webhook_by_mul_no 도 같이 drop
    execute format('drop function public.%I(%s) cascade', v_func.proname, v_func.args);
    v_dropped := v_dropped + 1;
  end loop;
  raise notice '== dropped % overload(s) (cascade) ==', v_dropped;
end$$;

-- 명시적 DROP (방어적)
drop function if exists public._internal_apply_payapp_event(text,integer,integer,text,text,text,timestamptz,text,text,text,text) cascade;
drop function if exists public._internal_apply_payapp_event(text,int,int,text,text,text,timestamptz,text,text,text,text) cascade;
drop function if exists public.admin_replay_webhook_event(uuid);
drop function if exists public.admin_replay_webhook_by_mul_no(text);

-- ----------------------
-- STEP 2) _internal_apply_payapp_event 재생성
--    최신 Edge Function 이 호출하는 정확한 시그니처 (11 args, p_buyer_phone 포함).
--    p_buyer_phone 누락 호출도 default null 로 호환됨.
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
      p_source := case when v_is_state_4_paid then p_source || '+state4_approval' else p_source end
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

revoke execute on function public._internal_apply_payapp_event(text,integer,integer,text,text,text,timestamptz,text,text,text,text) from public;
grant execute on function public._internal_apply_payapp_event(text,integer,integer,text,text,text,timestamptz,text,text,text,text) to service_role;

-- ----------------------
-- STEP 3) admin_replay_webhook_event — 라우터 사용 (CASCADE 로 drop 됐으므로 재생성)
-- ----------------------
create or replace function public.admin_replay_webhook_event(p_event_id uuid)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text,
  final_status text, message text
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
    else 'individual' end;
  v_email := nullif(lower(coalesce(
    v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
    v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
    v_payload->>'구매자이메일', '')), '');
  v_phone := nullif(coalesce(
    v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
    v_payload->>'recv_phone', v_payload->>'reqphone',
    v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
    v_payload->>'receiver_phone', v_payload->>'receiverphone',
    v_payload->>'구매자번호', v_payload->>'구매자전화번호', ''), '');
  v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');
  v_approval_no := coalesce(v_event.approval_no, v_payload->>'approval_no', v_payload->>'apv_no',
                            v_payload->>'card_apv_no', v_payload->>'승인번호');
  v_event_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    nullif(v_payload->>'cancel_at','')::timestamptz,
    nullif(v_payload->>'canceldate','')::timestamptz,
    nullif(v_payload->>'refunded_at','')::timestamptz,
    v_event.created_at, now());

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
      state_label = coalesce(e.state_label, public._payapp_state_label(e.pay_state)),
      processing_error = case when v_result.membership_updated then null
                              else coalesce(v_result.message, 'unknown failure') end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select v_result.matched_user_id, v_result.matched_order_id, v_result.matched_subscription_id,
    v_result.membership_updated, v_result.final_membership_tier,
    v_result.final_status, v_result.message;
end;
$$;

grant execute on function public.admin_replay_webhook_event(uuid) to authenticated;

-- ----------------------
-- STEP 4) admin_replay_webhook_by_mul_no — 라우터 사용 (시간순 iterate)
-- ----------------------
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
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  for v_event in
    select e.* from public.payapp_webhook_events as e
    where e.payapp_mul_no = btrim(p_mul_no) order by e.created_at asc
  loop
    v_processed := v_processed + 1;
    v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);
    v_amount := coalesce(v_event.price,
      nullif(v_payload->>'price','')::integer,
      nullif(v_payload->>'amount','')::integer);
    v_plan_type := case when v_amount = 4900 then 'individual'
                        when v_amount = 6900 then 'business'
                        else 'individual' end;
    v_email := nullif(lower(coalesce(
      v_payload->>'recvemail', v_payload->>'buyer_email', v_payload->>'email',
      v_payload->>'recv_email', v_payload->>'useremail', v_payload->>'reqemail',
      v_payload->>'구매자이메일', '')), '');
    v_phone := nullif(coalesce(
      v_payload->>'recvphone', v_payload->>'phone', v_payload->>'buyer_phone',
      v_payload->>'recv_phone', v_payload->>'reqphone',
      v_payload->>'hp', v_payload->>'cellphone', v_payload->>'tel', v_payload->>'mobile',
      v_payload->>'receiver_phone', v_payload->>'receiverphone',
      v_payload->>'구매자번호', v_payload->>'구매자전화번호', ''), '');
    v_goodname := coalesce(v_payload->>'goodname', v_payload->>'goodsname', v_payload->>'pname');
    v_approval_no := coalesce(v_event.approval_no, v_payload->>'approval_no',
                              v_payload->>'apv_no', v_payload->>'card_apv_no');
    v_event_at := coalesce(
      nullif(v_payload->>'paid_at','')::timestamptz,
      nullif(v_payload->>'pay_date','')::timestamptz,
      nullif(v_payload->>'paydate','')::timestamptz,
      v_event.created_at, now());

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

  return query select v_last_user_id,
    (v_last_tier is not null and v_last_tier <> 'free'),
    coalesce(v_last_tier, 'free'), v_last_status,
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
-- STEP 5) list_manual_payment_imports DROP+CREATE — 모든 컬럼 alias 명시
-- ----------------------
drop function if exists public.list_manual_payment_imports(int);
drop function if exists public.list_manual_payment_imports(integer);

create or replace function public.list_manual_payment_imports(p_limit int default 50)
returns table(
  id uuid,
  payapp_mul_no text,
  approval_no text,
  buyer_email text,
  buyer_phone text,
  amount integer,
  plan_type text,
  goodname text,
  paid_at timestamptz,
  matched_user_id uuid,
  matched_user_email text,
  matched_order_id uuid,
  matched_subscription_id uuid,
  status text,
  error_message text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  -- admin 체크 (SQL Editor postgres 우회 포함)
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    mpi.id as id,
    mpi.payapp_mul_no as payapp_mul_no,
    mpi.approval_no as approval_no,
    mpi.buyer_email as buyer_email,
    mpi.buyer_phone as buyer_phone,
    mpi.amount as amount,
    mpi.plan_type as plan_type,
    mpi.goodname as goodname,
    mpi.paid_at as paid_at,
    mpi.matched_user_id as matched_user_id,
    au.email::text as matched_user_email,
    mpi.matched_order_id as matched_order_id,
    mpi.matched_subscription_id as matched_subscription_id,
    mpi.status as status,
    mpi.error_message as error_message,
    mpi.created_at as created_at
  from public.payapp_manual_payment_imports as mpi
  left join auth.users as au on au.id = mpi.matched_user_id
  order by mpi.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_manual_payment_imports(int) to authenticated;

-- ----------------------
-- STEP 6) list_pending_payout_accounts DROP+CREATE — 같은 패턴 보강 (예방)
-- ----------------------
drop function if exists public.list_pending_payout_accounts(int);
drop function if exists public.list_pending_payout_accounts(integer);

create or replace function public.list_pending_payout_accounts(p_limit int default 100)
returns table(
  account_id uuid,
  user_id uuid,
  artist_name text,
  email text,
  bank_name text,
  account_number text,
  account_holder text,
  verification_status text,
  rejected_reason text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    pa.id as account_id,
    pa.user_id as user_id,
    ap.artist_name as artist_name,
    ap.email as email,
    pa.bank_name as bank_name,
    pa.account_number as account_number,
    pa.account_holder as account_holder,
    pa.verification_status as verification_status,
    pa.rejected_reason as rejected_reason,
    pa.created_at as created_at
  from public.artist_payout_accounts as pa
  left join public.artist_profiles as ap on ap.user_id = pa.user_id
  order by
    case pa.verification_status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    pa.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_payout_accounts(int) to authenticated;

-- ----------------------
-- 최종 확인
-- ----------------------
do $$
declare v_args text;
begin
  select pg_get_function_identity_arguments(p.oid) into v_args
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='_internal_apply_payapp_event';
  raise notice '_internal_apply_payapp_event args: %', coalesce(v_args, '(MISSING)');

  if v_args not like '%p_buyer_phone%' then
    raise exception '0044 검증 실패: p_buyer_phone 누락 (signature=%)', v_args;
  end if;
end$$;

select
  'router_args=' ||
  (select pg_get_function_identity_arguments(p.oid)
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_internal_apply_payapp_event') as check_1,
  'imports_aliased=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%mpi.id as id%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='list_manual_payment_imports')
        then 'OK' else 'MISSING' end) as check_2,
  'payout_aliased=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%pa.id as account_id%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='list_pending_payout_accounts')
        then 'OK' else 'MISSING' end) as check_3;
-- ============================================
-- 0045_membership_tier_as_truth.sql
--
-- 단일 진실의 원천: users.membership_tier
--   - free → 무료
--   - individual → 일반 활성
--   - business → 사업자 활성
--
-- 운영 증상:
--   1) admin_dashboard_stats.active_subscribers 가 subscriptions.status='active'
--      기준 → 해지된 회원도 active 로 잡힘 / 활성 회원이 누락되는 등 mismatch.
--   2) subscriptions.status='canceled' 인데 users.membership_tier 가 free 가
--      아닌 케이스 발생 (과거 데이터 정합성 부재).
--
-- 수정:
--   1) admin_dashboard_stats DROP+CREATE — active_subscribers 를
--      users.membership_tier 기반으로 통일.
--   2) 데이터 정합성 backfill:
--      subscription.status in (canceled, cancelled, refunded, expired) AND
--      user.membership_tier <> 'free' → tier 와 subscription_type 을 free 로.
--      단, 같은 user 에 active 상태의 다른 subscription 이 있으면 skip.
--   3) admin_sync_membership_from_subscriptions() RPC — 운영자가 주기적으로
--      호출 가능한 reconcile.
-- ============================================

-- ----------------------
-- 1) admin_dashboard_stats 재작성 — membership_tier 단일 진실 원천
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
    -- 매출: payment_orders.status='paid' + refunded_at IS NULL
    'today_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= today_start), 0),
    'week_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= week_start), 0),
    'month_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= month_start), 0),
    'total_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null), 0),
    -- ★ active_subscribers: users.membership_tier 가 단일 진실 원천 ★
    'active_subscribers', (
      select count(*) from public.users as u
      where u.membership_tier in ('individual','business')
    ),
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
-- 2) admin_sync_membership_from_subscriptions — 정합성 reconcile RPC
-- ----------------------
create or replace function public.admin_sync_membership_from_subscriptions(p_dry_run boolean default false)
returns table(
  downgraded_count integer,
  upgraded_count integer,
  total_scanned integer,
  details jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  v_u record;
  v_active_sub_exists boolean;
  v_active_sub_plan text;
  v_scanned int := 0;
  v_down int := 0;
  v_up int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- 모든 user 를 순회하면서 active subscription 존재 여부로 tier 정합성 보정.
  -- 같은 user 에 active 와 canceled 가 동시 존재할 수 있음 → active 우선.
  for v_u in
    select u.id, u.membership_tier, u.subscription_type
    from public.users as u
  loop
    v_scanned := v_scanned + 1;

    -- active subscription 존재 여부 + plan_type 조회
    select
      exists (
        select 1 from public.subscriptions as s
        where s.user_id = v_u.id and s.status = 'active'
      )
      into v_active_sub_exists;

    if v_active_sub_exists then
      select s.plan_type into v_active_sub_plan
      from public.subscriptions as s
      where s.user_id = v_u.id and s.status = 'active'
      order by s.last_paid_at desc nulls last, s.created_at desc
      limit 1;
    else
      v_active_sub_plan := null;
    end if;

    -- 케이스 A) active sub 없는데 tier 가 free 아님 → free 로 downgrade
    if not v_active_sub_exists and v_u.membership_tier <> 'free' then
      v_down := v_down + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_u.id, 'action', 'downgrade',
        'from_tier', v_u.membership_tier, 'to_tier', 'free'
      );
      if not p_dry_run then
        update public.users as u
        set membership_tier = 'free', subscription_type = 'free'
        where u.id = v_u.id;
      end if;
    -- 케이스 B) active sub 있는데 tier 가 그 plan 과 불일치 → tier 보정
    elsif v_active_sub_exists and v_active_sub_plan in ('individual','business')
          and v_u.membership_tier <> v_active_sub_plan then
      v_up := v_up + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_u.id, 'action', 'sync_to_active',
        'from_tier', v_u.membership_tier, 'to_tier', v_active_sub_plan
      );
      if not p_dry_run then
        update public.users as u
        set membership_tier = v_active_sub_plan, subscription_type = v_active_sub_plan
        where u.id = v_u.id;
      end if;
    end if;
  end loop;

  return query select v_down, v_up, v_scanned, v_details;
end;
$$;

grant execute on function public.admin_sync_membership_from_subscriptions(boolean) to authenticated;

-- ----------------------
-- 3) 적용 시점 한 번에 자동 정합성 보정 (dry_run=false)
--    ⚠️ 운영 적용 직후 1회 자동 실행 — 이미 해지된 회원의 tier=free 강제 회수.
--    동시에 active 인 회원은 그대로 유지.
-- ----------------------
do $$
declare
  v_down int := 0;
  v_up int := 0;
  v_scanned int := 0;
begin
  -- public._internal_is_admin_caller() bypass 를 위해 직접 실행 (현재 session_user='postgres')
  -- 정상 운영 적용 컨텍스트면 session_user='postgres' 또는 'supabase_admin'
  -- → _internal_is_admin_caller() 통과.
  begin
    select downgraded_count, upgraded_count, total_scanned
      into v_down, v_up, v_scanned
    from public.admin_sync_membership_from_subscriptions(p_dry_run := false);
    raise notice '== 0045 자동 정합성 보정 — scanned=%, downgraded=%, upgraded=% ==',
      v_scanned, v_down, v_up;
  exception when others then
    -- admin 검증 실패 등 — 자동 실행 못해도 migration 자체는 통과
    raise notice '== 0045 자동 정합성 보정 skip (admin context 아님): % ==', sqlerrm;
  end;
end$$;

-- 확인
select
  'dashboard_uses_tier=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%active_subscribers%membership_tier in%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_dashboard_stats')
        then 'OK' else 'MISSING' end) as check_1,
  'sync_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_sync_membership_from_subscriptions')
    then 'OK' else 'MISSING' end) as check_2;
-- ============================================
-- 0046_get_my_payment_status_rpc.sql
--
-- /payment/success 페이지가 order_no 기준으로 결제 적용 여부를 직접 조회.
--
-- 운영 증상:
--   결제는 정상 완료 (webhook state=64, payment_orders.status='paid',
--   users.membership_tier='individual') 인데 PaymentSuccessPage 가 계속
--   "결제 확인 중" 에 머무름.
--   원인: 기존 polling 이 useAuthStore.profile.membership_tier 만 보는데
--         refreshProfile() 의 RLS / 캐시 갱신 타이밍 때문에 새로 부여된
--         tier 가 frontend 에 반영 안 됨.
--
-- 수정:
--   get_my_payment_status(p_order_no text)
--     - 본인(auth.uid()=user_id) 또는 admin 만 조회 가능.
--     - payment_orders + users join 으로 정확한 적용 상태 반환.
--     - membership_applied: status='paid' AND membership_tier in
--       ('individual','business') AND tier == order.plan_type 일 때만 true.
--       → polling 종료의 단일 판정 기준이 됨.
-- ============================================

drop function if exists public.get_my_payment_status(text);

create or replace function public.get_my_payment_status(p_order_no text)
returns table(
  order_no text,
  status text,
  user_id uuid,
  plan_type text,
  amount integer,
  membership_tier text,
  subscription_type text,
  paid_at timestamptz,
  refunded_at timestamptz,
  membership_applied boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_is_admin boolean;
  v_caller uuid := auth.uid();
begin
  if p_order_no is null or length(trim(p_order_no)) = 0 then
    raise exception 'order_no required';
  end if;

  -- admin 또는 service_role 인 경우 user 검증 우회
  begin
    v_is_admin := public._internal_is_admin_caller();
  exception when undefined_function then
    v_is_admin := exists (
      select 1 from public.users as u
      where u.id = v_caller and u.role = 'admin'
    );
  end;

  return query
  select
    po.order_no,
    po.status,
    po.user_id,
    po.plan_type,
    po.amount,
    u.membership_tier,
    u.subscription_type,
    po.paid_at,
    po.refunded_at,
    (
      po.status = 'paid'
      and po.refunded_at is null
      and u.membership_tier in ('individual','business')
      and u.membership_tier = po.plan_type
    ) as membership_applied
  from public.payment_orders as po
  left join public.users as u on u.id = po.user_id
  where po.order_no = p_order_no
    and (v_is_admin or po.user_id = v_caller);
end;
$$;

grant execute on function public.get_my_payment_status(text) to authenticated;

-- 확인
select
  'rpc_exists=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_my_payment_status')
    then 'OK' else 'MISSING' end) as check_1;
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
