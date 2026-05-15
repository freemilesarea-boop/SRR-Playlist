-- ============================================
-- 0037_paid_candidate_and_revenue_fix.sql
--
-- 운영 진단:
--   - mul_no 115572403: PayApp 관리자 결제완료. webhook 에는 state=4 만 도착.
--     approval_no=18071813 / price=4900 / 결제일시 명확.
--   - 현재 state=64 만 paid 처리 → 이런 케이스는 영구 pending.
--   - 대시보드 매출이 revenue_events 기반 → payment_orders 와 불일치.
--
-- 해결:
--   1) state=4 + approval_no 존재 = '결제완료 후보' (paid_candidate) 로 분류.
--      자동 paid 처리는 안 함 (보안), 운영자가 1-클릭 force-approve.
--   2) admin_force_activate_membership 보강:
--      approval_no / paid_at / mul_no / 사유 / admin_id 저장
--   3) 신규 RPC admin_force_apply_paid_candidate(event_id, reason):
--      webhook event row 의 모든 필드를 자동 추출해서 강제 승인
--   4) 매출 RPC payment_orders 기반으로 재작성:
--      admin_revenue_summary_v2 / admin_dashboard_stats
-- ============================================

-- ----------------------
-- 1) 컬럼 보강
-- ----------------------
alter table public.payment_orders
  add column if not exists approval_no text;

alter table public.payapp_webhook_events
  add column if not exists paid_candidate boolean not null default false,
  add column if not exists approval_no text;

create index if not exists idx_webhook_paid_candidate
  on public.payapp_webhook_events(paid_candidate)
  where paid_candidate = true;
create index if not exists idx_payment_orders_paid_at
  on public.payment_orders(paid_at)
  where status = 'paid';

-- ----------------------
-- 2) trigger — INSERT/UPDATE 시 approval_no + paid_candidate 자동 계산
--    (webhook handler 코드와 무관하게 DB 가 보장)
-- ----------------------
create or replace function public._payapp_webhook_event_compute()
returns trigger language plpgsql as $$
begin
  -- approval_no 자동 추출
  if new.approval_no is null and new.raw_payload is not null then
    new.approval_no := coalesce(
      new.raw_payload->>'approval_no',
      new.raw_payload->>'apv_no',
      new.raw_payload->>'card_apv_no',
      new.raw_payload->>'승인번호'
    );
  end if;
  -- paid_candidate: state=4 + approval_no 존재 + 아직 membership 적용 안 됨
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

-- 기존 행에 트리거 효과 적용 (raw_payload 재할당으로 BEFORE UPDATE 트리거 실행)
update public.payapp_webhook_events as e
set raw_payload = e.raw_payload
where e.approval_no is null and e.raw_payload is not null;

-- ----------------------
-- 3) admin_force_activate_membership 보강 — approval_no / mul_no / 결제일시 인자
-- ----------------------
drop function if exists public.admin_force_activate_membership(uuid, text, text, integer);
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
  if p_plan_type not in ('individual','business') then
    raise exception 'invalid plan_type';
  end if;
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

  -- subscription
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
    set status = 'active',
        plan_type = p_plan_type,
        price = v_amount,
        last_paid_at = v_paid_at,
        current_period_start = v_paid_at,
        current_period_end = v_paid_at + interval '1 month',
        payapp_mul_no = coalesce(s.payapp_mul_no, p_payapp_mul_no),
        canceled_at = null,
        refunded_at = null
    where s.id = v_sub_id;
  end if;

  -- payment_orders — mul_no 일치하는 기존 주문이 있으면 그걸 update, 없으면 새로 생성
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
      (p_user_id, v_sub_id,
       'force_' || extract(epoch from now())::text,
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

  -- users
  update public.users as u
  set membership_tier = p_plan_type,
      subscription_type = p_plan_type
  where u.id = p_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = p_user_id;

  return query select
    p_user_id, v_sub_id, v_order_id,
    true, v_tier,
    ('force-activated: ' || coalesce(p_reason,'(no reason)') || ' (tier=' || v_tier || ')')::text;
end;
$$;

grant execute on function public.admin_force_activate_membership(uuid, text, text, integer, text, text, timestamptz)
  to authenticated;

-- ----------------------
-- 4) admin_force_apply_paid_candidate — webhook event 로부터 모든 필드 자동 추출
-- ----------------------
create or replace function public.admin_force_apply_paid_candidate(
  p_event_id uuid,
  p_reason text default null
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

  -- 사용자 매칭 (matched_user_id 우선, 없으면 이메일/전화로 찾기)
  v_user_id := v_event.matched_user_id;
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

  -- force-activate
  select * into v_result from public.admin_force_activate_membership(
    p_user_id := v_user_id,
    p_plan_type := v_plan_type,
    p_reason := coalesce(p_reason, 'force_apply_paid_candidate state=4+approval_no, mul_no=' || v_event.payapp_mul_no),
    p_amount := v_amount,
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_approval_no := v_approval_no,
    p_paid_at := v_paid_at
  );

  -- writeback to event
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

  return query select
    v_user_id, v_result.subscription_id, v_result.order_id,
    true, v_result.final_membership_tier, v_result.message;
end;
$$;

grant execute on function public.admin_force_apply_paid_candidate(uuid, text) to authenticated;

-- ----------------------
-- 5) list_recent_webhook_events — paid_candidate / approval_no 컬럼 추가 반환
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
         e.paid_candidate, e.approval_no,
         e.created_at
  from public.payapp_webhook_events as e
  left join auth.users as au on au.id = e.matched_user_id
  where e.created_at > now() - make_interval(mins => greatest(1, p_minutes))
    and (
      v_search = '' or e.payapp_mul_no = v_search or e.order_no = v_search
      or e.raw_payload::text ilike '%' || v_search || '%'
    )
  order by e.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_webhook_events(text, int, int) to authenticated;

-- ----------------------
-- 6) 매출 RPC — payment_orders 기반 (revenue_events 와 합산)
-- ----------------------
create or replace function public.admin_revenue_summary()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
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

  -- payment_orders.status='paid' 가 단일 진실의 원천. revenue_events 는 보조.
  select jsonb_build_object(
    -- 기간별 매출 (payment_orders paid 기준, paid_at 사용)
    'today', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= today_start), 0),
    'week', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= week_start), 0),
    'month', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= month_start), 0),
    'total', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid'), 0),
    -- 환불 합계 (정보용)
    'refunded_total', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='refunded'), 0),
    -- 플랜별
    'by_plan', coalesce((
      select jsonb_object_agg(plan_type, amt) from (
        select po.plan_type, sum(po.amount) as amt
        from public.payment_orders as po
        where po.status='paid'
        group by po.plan_type
      ) bp
    ), '{}'::jsonb),
    -- 상태별 카운트
    'by_status', coalesce((
      select jsonb_object_agg(status, amt) from (
        select po.status, sum(po.amount) as amt
        from public.payment_orders as po
        group by po.status
      ) bs
    ), '{}'::jsonb),
    -- 최근 paid 50건
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', po.id,
        'email', au.email,
        'nickname', u.nickname,
        'plan_type', po.plan_type,
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
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_revenue_summary() to authenticated;

-- ----------------------
-- 7) admin_dashboard_stats — 매출 부분 payment_orders 기반으로 수정
-- ----------------------
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  result jsonb;
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
    'today_visitors',
      (select count(*) from public.visitor_events as ve where ve.created_at >= today_start),
    'today_unique_visitors',
      (select count(distinct ve.session_id) from public.visitor_events as ve where ve.created_at >= today_start),
    'today_streams',
      (select count(*) from public.stream_events as se
        where se.created_at >= today_start and se.event_type = 'milestone_30s'),
    'today_new_users',
      (select count(*) from public.users as u where u.created_at >= today_start),
    -- 매출: payment_orders.status='paid' 단일 진실의 원천
    'today_revenue', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= today_start), 0),
    'week_revenue', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= week_start), 0),
    'month_revenue', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid' and po.paid_at >= month_start), 0),
    'total_revenue', coalesce(
      (select sum(po.amount) from public.payment_orders as po
       where po.status='paid'), 0),
    'active_subscribers',
      (select count(*) from public.users as u
       where u.membership_tier in ('individual','business')),
    'free_users', (select count(*) from public.users as u where coalesce(u.membership_tier,'free') = 'free'),
    'personal_users', (select count(*) from public.users as u where u.membership_tier = 'individual'),
    'business_users', (select count(*) from public.users as u where u.membership_tier = 'business'),
    'total_users', (select count(*) from public.users),
    'pending_subscriptions',
      (select count(*) from public.subscription_requests as sr where sr.status = 'pending')
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_dashboard_stats() to authenticated;

-- 확인
select
  'paid_candidate_col=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payapp_webhook_events' and column_name='paid_candidate')
    then 'OK' else 'MISSING' end) as check_1,
  'approval_no_col=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='payment_orders' and column_name='approval_no')
    then 'OK' else 'MISSING' end) as check_2,
  'force_apply_candidate_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_force_apply_paid_candidate')
    then 'OK' else 'MISSING' end) as check_3,
  'revenue_uses_payment_orders=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%payment_orders as po%status%paid%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_revenue_summary')
        then 'OK' else 'MISSING' end) as check_4;
