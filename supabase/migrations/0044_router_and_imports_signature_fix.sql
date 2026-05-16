-- ============================================
-- 0044_router_and_imports_signature_fix.sql
--
-- 운영 증상:
--   1) list_manual_payment_imports [42702] column reference "id" is ambiguous
--   2) Could not find the function public._internal_apply_payapp_event(...)
--
-- 원인:
--   - 운영 DB 에 _internal_apply_payapp_event 의 다중 overload 또는 구버전이
--     남아 PostgREST 가 시그니처 매칭 실패.
--   - list_manual_payment_imports 운영 본문이 구버전(0026 fix 전) 으로 남아
--     id 컬럼이 OUT param 과 충돌.
--
-- 수정:
--   1) _internal_apply_payapp_event 와 그에 의존하는 RPC 들을 DROP CASCADE 로
--      모두 제거 → 라우터 + replay_event + replay_by_mul_no 재생성.
--   2) list_manual_payment_imports DROP + CREATE — 모든 컬럼 alias 명시 +
--      _internal_is_admin_caller() admin 체크 사용.
--   3) list_pending_payout_accounts 도 동일 패턴으로 보강 (CASCADE 안전).
-- ============================================

-- ----------------------
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
