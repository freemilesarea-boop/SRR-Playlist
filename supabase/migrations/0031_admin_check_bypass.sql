-- ============================================
-- 0031_admin_check_bypass.sql
--
-- 운영 복구/디버깅 목적으로 SQL Editor (postgres role) 와 service_role 에서도
-- admin RPC 호출 가능하도록 admin 체크 우회 허용.
--
-- 보안:
--   - session_user 가 postgres / service_role / supabase_admin 이면 통과
--     (SQL Editor 직접 실행 + Edge Function 의 service_role context 만 해당)
--   - auth.role() = 'service_role' 도 통과 (PostgREST 가 JWT role 을 설정한 경우)
--   - 그 외엔 기존 users.role='admin' 체크 유지
--
-- 주의: SECURITY DEFINER 안에서 current_user 는 항상 함수 owner('postgres') 가 되므로
--       session_user 를 사용해야 진짜 caller 의 role 을 식별할 수 있음.
-- ============================================

-- ----------------------
-- 0) 공용 admin 체크 헬퍼
-- ----------------------
create or replace function public._internal_is_admin_caller()
returns boolean
language plpgsql
stable
as $$
declare
  v_jwt_role text := '';
begin
  -- 1) DB session role 검증 (SQL Editor / service_role Edge Function)
  if session_user in ('postgres', 'service_role', 'supabase_admin') then
    return true;
  end if;

  -- 2) PostgREST JWT role 검증
  begin
    v_jwt_role := coalesce(current_setting('request.jwt.claim.role', true), '');
  exception when others then
    v_jwt_role := '';
  end;
  if v_jwt_role = 'service_role' then return true; end if;

  -- 3) 일반 admin user
  return exists (
    select 1 from public.users u
    where u.id = auth.uid() and u.role = 'admin'
  );
end;
$$;

-- 모든 caller (anon 포함) 가 호출할 수 있어야 다른 RPC 내부에서 일관되게 사용 가능.
-- Supabase 의 anon/service_role 은 기본 존재. 다른 환경에선 누락 가능 → DO 로 안전 처리.
do $$
begin
  begin grant execute on function public._internal_is_admin_caller() to authenticated;
  exception when undefined_object then null; end;
  begin grant execute on function public._internal_is_admin_caller() to anon;
  exception when undefined_object then null; end;
  begin grant execute on function public._internal_is_admin_caller() to service_role;
  exception when undefined_object then null; end;
end $$;

-- ----------------------
-- 1) admin_sync_payapp_payment — 0028 body + 헬퍼 사용
-- ----------------------
create or replace function public.admin_sync_payapp_payment(
  p_payapp_mul_no text,
  p_amount integer,
  p_plan_type text default 'individual',
  p_approval_no text default null,
  p_buyer_email text default null,
  p_buyer_phone text default null,
  p_paid_at timestamptz default now(),
  p_goodname text default null
)
returns table(
  status text,
  user_id uuid,
  order_id uuid,
  subscription_id uuid,
  import_id uuid,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected_price integer;
  v_user_id uuid;
  v_order_id uuid;
  v_sub_id uuid;
  v_import_id uuid;
  v_phone_clean text;
  v_existing public.payapp_manual_payment_imports%rowtype;
  v_mul_no text := btrim(coalesce(p_payapp_mul_no, ''));
  v_email text := lower(btrim(coalesce(p_buyer_email, '')));
  v_payload jsonb;
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;

  if v_mul_no = '' then raise exception 'p_payapp_mul_no required'; end if;
  if p_plan_type not in ('individual','business') then raise exception 'invalid plan_type'; end if;
  v_expected_price := case when p_plan_type = 'individual' then 4900 else 6900 end;
  if p_amount <> v_expected_price then
    raise exception 'amount mismatch: expected %, got %', v_expected_price, p_amount;
  end if;

  select mpi.* into v_existing
  from public.payapp_manual_payment_imports mpi
  where mpi.payapp_mul_no = v_mul_no;
  if found then
    return query select
      v_existing.status, v_existing.matched_user_id, v_existing.matched_order_id,
      v_existing.matched_subscription_id, v_existing.id, 'already synced'::text;
    return;
  end if;

  v_payload := jsonb_build_object(
    'payapp_mul_no', v_mul_no, 'approval_no', p_approval_no,
    'buyer_email', p_buyer_email, 'buyer_phone', p_buyer_phone,
    'amount', p_amount, 'plan_type', p_plan_type, 'goodname', p_goodname,
    'paid_at', p_paid_at, 'manual_sync', true, 'synced_at', now()
  );

  v_phone_clean := regexp_replace(coalesce(p_buyer_phone, ''), '[^0-9]', '', 'g');

  -- 4a) payment_orders.payapp_mul_no
  select po.user_id into v_user_id from public.payment_orders po
  where po.payapp_mul_no = v_mul_no limit 1;

  -- 4b) raw_response 안의 mul_no
  if v_user_id is null then
    select po.user_id into v_user_id from public.payment_orders po
    where po.raw_response::text ilike '%' || v_mul_no || '%'
    order by po.created_at desc limit 1;
  end if;

  -- 4c) auth.users.email
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users au join public.users u on u.id = au.id
    where lower(au.email) = v_email limit 1;
  end if;

  -- 4d) raw_request 안의 phone
  if v_user_id is null and v_phone_clean <> '' then
    select po.user_id into v_user_id from public.payment_orders po
    where po.status in ('requested','waiting','failed')
      and po.raw_request::text ilike '%' || v_phone_clean || '%'
    order by po.created_at desc limit 1;
  end if;

  -- 5) users.phone
  if v_user_id is null and v_phone_clean <> '' then
    select u.id into v_user_id from public.users u
    where regexp_replace(coalesce(u.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    limit 1;
  end if;

  -- 6) artist_profiles.phone
  if v_user_id is null and v_phone_clean <> '' then
    select ap.user_id into v_user_id from public.artist_profiles ap
    where regexp_replace(coalesce(ap.phone,''), '[^0-9]', '', 'g') = v_phone_clean
    limit 1;
  end if;

  -- 7) business_verification_profiles.phone (테이블 있으면)
  if v_user_id is null and v_phone_clean <> '' then
    begin
      select bvp.user_id into v_user_id from public.business_verification_profiles bvp
      where regexp_replace(coalesce(bvp.phone,''), '[^0-9]', '', 'g') = v_phone_clean
      limit 1;
    exception when undefined_table then null;
    end;
  end if;

  if v_user_id is null then
    insert into public.payapp_manual_payment_imports
      (payapp_mul_no, approval_no, buyer_email, buyer_phone, amount, plan_type, goodname,
       paid_at, status, raw_payload, created_by)
    values
      (v_mul_no, p_approval_no, p_buyer_email, p_buyer_phone, p_amount, p_plan_type, p_goodname,
       p_paid_at, 'unmatched',
       v_payload || jsonb_build_object('phone_clean', v_phone_clean), auth.uid())
    returning public.payapp_manual_payment_imports.id into v_import_id;
    return query select 'unmatched'::text, null::uuid, null::uuid, null::uuid,
      v_import_id, '매칭되는 사용자를 찾지 못했습니다'::text;
    return;
  end if;

  select po.id into v_order_id from public.payment_orders po
  where po.payapp_mul_no = v_mul_no and po.user_id = v_user_id limit 1;
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders po
    where po.user_id = v_user_id and po.status in ('requested','waiting','failed')
    order by po.created_at desc limit 1;
  end if;
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (v_user_id, 'manual_' || v_mul_no, p_plan_type, p_amount, 'paid', v_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

  select s.id into v_sub_id from public.subscriptions s
  where s.user_id = v_user_id
  order by case s.status when 'active' then 0 when 'pending' then 1
                          when 'payment_waiting' then 2 else 3 end, s.created_at desc
  limit 1;
  if v_sub_id is null then
    insert into public.subscriptions (user_id, plan_type, price, status)
    values (v_user_id, p_plan_type, p_amount, 'active')
    returning public.subscriptions.id into v_sub_id;
  end if;

  update public.payment_orders as po
  set status = 'paid', payapp_mul_no = v_mul_no,
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status = 'active', plan_type = p_plan_type, price = p_amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_mul_no),
      last_paid_at = p_paid_at,
      current_period_start = p_paid_at,
      current_period_end = p_paid_at + interval '1 month'
  where s.id = v_sub_id;

  update public.users as u set membership_tier = p_plan_type,
                               subscription_type = p_plan_type
  where u.id = v_user_id;

  insert into public.payapp_manual_payment_imports
    (payapp_mul_no, approval_no, buyer_email, buyer_phone, amount, plan_type, goodname,
     paid_at, matched_user_id, matched_order_id, matched_subscription_id,
     status, raw_payload, created_by)
  values
    (v_mul_no, p_approval_no, p_buyer_email, p_buyer_phone, p_amount, p_plan_type, p_goodname,
     p_paid_at, v_user_id, v_order_id, v_sub_id, 'matched', v_payload, auth.uid())
  returning public.payapp_manual_payment_imports.id into v_import_id;

  return query select 'matched'::text, v_user_id, v_order_id, v_sub_id, v_import_id,
    'sync ok'::text;
end;
$$;

grant execute on function public.admin_sync_payapp_payment(text, integer, text, text, text, text, timestamptz, text) to authenticated;

-- ----------------------
-- 2) admin_link_unmatched_import — 0027 body + 헬퍼
-- ----------------------
create or replace function public.admin_link_unmatched_import(
  p_import_id uuid,
  p_user_id uuid
)
returns table(
  status text,
  user_id uuid,
  order_id uuid,
  subscription_id uuid,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_import public.payapp_manual_payment_imports%rowtype;
  v_order_id uuid;
  v_sub_id uuid;
  v_payload jsonb;
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;

  select mpi.* into v_import from public.payapp_manual_payment_imports mpi where mpi.id = p_import_id;
  if not found then raise exception 'import row not found'; end if;

  if v_import.status = 'matched' then
    return query select 'matched'::text, v_import.matched_user_id, v_import.matched_order_id,
      v_import.matched_subscription_id, 'already linked'::text;
    return;
  end if;

  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'target user not found';
  end if;

  v_payload := coalesce(v_import.raw_payload, '{}'::jsonb)
    || jsonb_build_object('manually_linked', true, 'linked_by', auth.uid(), 'linked_at', now());

  select po.id into v_order_id from public.payment_orders po
  where po.payapp_mul_no = v_import.payapp_mul_no limit 1;
  if v_order_id is null then
    select po.id into v_order_id from public.payment_orders po
    where po.user_id = p_user_id and po.status in ('requested','waiting','failed')
    order by po.created_at desc limit 1;
  end if;
  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (p_user_id, 'manual_' || v_import.payapp_mul_no, v_import.plan_type, v_import.amount,
       'paid', v_import.payapp_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

  select s.id into v_sub_id from public.subscriptions s where s.user_id = p_user_id
  order by case s.status when 'active' then 0 when 'pending' then 1
                          when 'payment_waiting' then 2 else 3 end, s.created_at desc
  limit 1;
  if v_sub_id is null then
    insert into public.subscriptions (user_id, plan_type, price, status)
    values (p_user_id, v_import.plan_type, v_import.amount, 'active')
    returning public.subscriptions.id into v_sub_id;
  end if;

  update public.payment_orders as po
  set status='paid', user_id=p_user_id, payapp_mul_no=v_import.payapp_mul_no,
      subscription_id=coalesce(po.subscription_id, v_sub_id),
      raw_response=coalesce(po.raw_response,'{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status='active', plan_type=v_import.plan_type, price=v_import.amount,
      payapp_mul_no=coalesce(s.payapp_mul_no, v_import.payapp_mul_no),
      last_paid_at=v_import.paid_at,
      current_period_start=v_import.paid_at,
      current_period_end=v_import.paid_at + interval '1 month'
  where s.id = v_sub_id;

  update public.users as u set membership_tier=v_import.plan_type,
                               subscription_type=v_import.plan_type
  where u.id = p_user_id;

  update public.payapp_manual_payment_imports as mpi
  set status='matched', matched_user_id=p_user_id, matched_order_id=v_order_id,
      matched_subscription_id=v_sub_id, raw_payload=v_payload, error_message=null
  where mpi.id = p_import_id;

  return query select 'matched'::text, p_user_id, v_order_id, v_sub_id, 'manually linked'::text;
end;
$$;

grant execute on function public.admin_link_unmatched_import(uuid, uuid) to authenticated;

-- ----------------------
-- 3) list_recent_sync_attempts — 0028 body + 헬퍼
-- ----------------------
create or replace function public.list_recent_sync_attempts(p_limit int default 20)
returns table(
  id uuid, requested_cmd text, date_from date, date_to date,
  http_status int, parsed_count int, success boolean,
  error_message text, raw_preview text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  return query
  select a.id, a.requested_cmd, a.date_from, a.date_to, a.http_status,
         a.parsed_count, a.success, a.error_message,
         left(coalesce(a.raw_response,''), 2000), a.created_at
  from public.payapp_api_sync_attempts a
  order by a.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_recent_sync_attempts(int) to authenticated;

-- ----------------------
-- 4) list_recent_webhook_events — 0029 body (확장 컬럼) + 헬퍼
-- ----------------------
create or replace function public.list_recent_webhook_events(
  p_search text default null,
  p_minutes int default 60,
  p_limit int default 50
)
returns table(
  id uuid, event_key text, order_no text, user_id uuid,
  payapp_mul_no text, payapp_rebill_no text,
  pay_state integer, price integer, linkval_verified boolean,
  processed_at timestamptz, reasons text,
  matched_user_id uuid, matched_user_email text,
  matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text,
  processing_error text, created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_search text := btrim(coalesce(p_search, ''));
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  return query
  select e.id, e.event_key, e.order_no, e.user_id, e.payapp_mul_no, e.payapp_rebill_no,
         e.pay_state, e.price, e.linkval_verified, e.processed_at,
         coalesce(e.raw_payload->'_verification'->>'reasons','')::text,
         e.matched_user_id, au.email::text,
         e.matched_order_id, e.matched_subscription_id,
         e.membership_updated, e.final_membership_tier, e.processing_error,
         e.created_at
  from public.payapp_webhook_events e
  left join auth.users au on au.id = e.matched_user_id
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
-- 5) admin_replay_webhook_event — 0030 body (확장 phone keys) + 헬퍼
-- ----------------------
create or replace function public.admin_replay_webhook_event(p_event_id uuid)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text, message text
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
  v_paid_at timestamptz;
  v_result record;
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;

  select * into v_event from public.payapp_webhook_events e where e.id = p_event_id;
  if not found then raise exception 'event not found'; end if;

  v_payload := coalesce(v_event.raw_payload, '{}'::jsonb);

  v_amount := coalesce(v_event.price,
    nullif(v_payload->>'price','')::integer,
    nullif(v_payload->>'amount','')::integer);

  if v_amount = 4900 then v_plan_type := 'individual';
  elsif v_amount = 6900 then v_plan_type := 'business';
  else raise exception 'unsupported amount % (event_id=%)', v_amount, p_event_id;
  end if;

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
  v_approval_no := coalesce(v_payload->>'approval_no', v_payload->>'apv_no',
                            v_payload->>'card_apv_no', v_payload->>'승인번호');
  v_paid_at := coalesce(
    nullif(v_payload->>'paid_at','')::timestamptz,
    nullif(v_payload->>'pay_date','')::timestamptz,
    nullif(v_payload->>'paydate','')::timestamptz,
    v_event.created_at, now());

  select * into v_result from public._internal_apply_payapp_paid_event(
    p_payapp_mul_no := v_event.payapp_mul_no,
    p_amount := v_amount, p_plan_type := v_plan_type,
    p_buyer_email := v_email, p_buyer_phone := v_phone,
    p_paid_at := v_paid_at, p_approval_no := v_approval_no,
    p_goodname := v_goodname, p_order_no := v_event.order_no,
    p_source := 'replay_event'
  );

  update public.payapp_webhook_events as e
  set matched_user_id = v_result.matched_user_id,
      matched_order_id = v_result.matched_order_id,
      matched_subscription_id = v_result.matched_subscription_id,
      membership_updated = v_result.membership_updated,
      final_membership_tier = v_result.final_membership_tier,
      processing_error = case when v_result.membership_updated then null
                              else coalesce(v_result.message, 'unknown failure') end,
      processed_at = coalesce(e.processed_at, now())
  where e.id = p_event_id;

  return query select v_result.matched_user_id, v_result.matched_order_id,
    v_result.matched_subscription_id, v_result.membership_updated,
    v_result.final_membership_tier, v_result.message;
end;
$$;

grant execute on function public.admin_replay_webhook_event(uuid) to authenticated;

-- ----------------------
-- 6) admin_replay_webhook_by_mul_no — 0029 body + 헬퍼
-- ----------------------
create or replace function public.admin_replay_webhook_by_mul_no(p_mul_no text)
returns table(
  matched_user_id uuid, matched_order_id uuid, matched_subscription_id uuid,
  membership_updated boolean, final_membership_tier text, message text
)
language plpgsql security definer set search_path = public
as $$
declare v_event_id uuid;
begin
  if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;

  select e.id into v_event_id
  from public.payapp_webhook_events e
  where e.payapp_mul_no = btrim(p_mul_no)
  order by e.created_at desc limit 1;
  if v_event_id is null then raise exception 'no webhook event for mul_no=%', p_mul_no; end if;

  return query select * from public.admin_replay_webhook_event(v_event_id);
end;
$$;

grant execute on function public.admin_replay_webhook_by_mul_no(text) to authenticated;

-- ----------------------
-- 확인
-- ----------------------
select
  'helper_fn=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_is_admin_caller')
    then 'OK' else 'MISSING' end) as check_1,
  'admin_replay_uses_helper=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%_internal_is_admin_caller%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_replay_webhook_by_mul_no')
        then 'OK' else 'MISSING' end) as check_2,
  'admin_sync_uses_helper=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%_internal_is_admin_caller%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_sync_payapp_payment')
        then 'OK' else 'MISSING' end) as check_3;
