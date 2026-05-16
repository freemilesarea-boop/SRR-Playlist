-- ============================================
-- 0048_force_paid_and_pending_match.sql
--
-- 운영 증상:
--   신규 결제 → PayApp 콘솔에서 결제 완료 확인됨 (입금 처리됨)
--   → 우리쪽 webhook 은 state=4 (no approval_no) 만 도착, state=64 미도착
--   → payment_orders.order_no 가 'requested' 그대로
--   → PaymentSuccessPage 30초 후 "관리자에게 주문번호 전달" 안내
--
--   2가지 운영 갭:
--   (a) admin webhook 진단 표에서 state=4 row 의 matched_user="—" 표시
--       → 어느 user 의 결제인지 즉시 알 수 없어 운영 대응 어려움.
--   (b) state=64 가 영영 안 오는 케이스 (PayApp config / 네트워크) 에 대한
--       1-클릭 강제 완료 수단 부재.
--
-- 수정:
--   1) _internal_match_user_for_event(...) — tier 적용 없이 user/order 매칭만
--      수행하는 헬퍼. EF 가 pending state(1,4,10) 수신 후 호출해서
--      payapp_webhook_events.matched_user_id / matched_order_id 만 update.
--   2) admin_force_paid_by_order_no(p_order_no, p_payapp_mul_no, p_approval_no)
--      — 운영자가 SQL Editor / UI 에서 1회 호출.
--      _internal_apply_payapp_paid_event 를 직접 호출해서 order paid 전환
--      + tier 부여. 감사 로그(admin_operation_logs) 기록.
-- ============================================

-- ---------- 1) pending state webhook 의 user/order 매칭 헬퍼 ----------
drop function if exists public._internal_match_user_for_event(
  text, text, text, jsonb
);

create or replace function public._internal_match_user_for_event(
  p_order_no text,
  p_payapp_mul_no text,
  p_buyer_email text,
  p_raw_payload jsonb
) returns table(
  matched_user_id uuid,
  matched_order_id uuid
)
language plpgsql security definer set search_path = public
as $$
declare
  v_user_id uuid;
  v_order_id uuid;
  v_scanned_order_no text;
  v_email text := lower(btrim(coalesce(p_buyer_email,'')));
  v_mul_no text := btrim(coalesce(p_payapp_mul_no,''));
begin
  -- raw_payload 안 swk_ 패턴 추출
  if p_raw_payload is not null then
    v_scanned_order_no := (regexp_match(
      p_raw_payload::text,
      'swk_[0-9a-fA-F]{8}_[a-zA-Z0-9]+_[a-zA-Z0-9]+'
    ))[1];
  end if;

  -- 1) p_order_no exact
  if p_order_no is not null and length(btrim(p_order_no)) > 0 then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = p_order_no limit 1;
  end if;

  -- 2) raw_payload scan
  if v_user_id is null and v_scanned_order_no is not null then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.order_no = v_scanned_order_no limit 1;
  end if;

  -- 3) mul_no exact
  if v_user_id is null and v_mul_no <> '' then
    select po.user_id, po.id into v_user_id, v_order_id
    from public.payment_orders as po where po.payapp_mul_no = v_mul_no limit 1;
  end if;

  -- 4) email (loose — tier 적용 없이 진단용 user 표시만)
  if v_user_id is null and v_email <> '' then
    select u.id into v_user_id
    from auth.users as au join public.users as u on u.id = au.id
    where lower(au.email) = v_email limit 1;
  end if;

  return query select v_user_id, v_order_id;
end;
$$;

grant execute on function public._internal_match_user_for_event(text, text, text, jsonb) to service_role;

-- ---------- 2) 운영자 강제 결제완료 RPC ----------
drop function if exists public.admin_force_paid_by_order_no(text, text, text);

create or replace function public.admin_force_paid_by_order_no(
  p_order_no text,
  p_payapp_mul_no text default null,
  p_approval_no text default null
) returns table(
  matched_user_id uuid,
  matched_order_id uuid,
  matched_order_no text,
  final_membership_tier text,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_order record;
  v_apply record;
  v_mul_no text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = v_caller and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  if p_order_no is null or length(trim(p_order_no))=0 then raise exception 'p_order_no required'; end if;

  select * into v_order from public.payment_orders po where po.order_no = p_order_no;
  if v_order is null then
    return query select null::uuid, null::uuid, p_order_no, null::text,
      ('order_no not found: ' || p_order_no)::text;
    return;
  end if;

  v_mul_no := coalesce(p_payapp_mul_no, v_order.payapp_mul_no, 'force_' || left(md5(random()::text), 10));

  select * into v_apply from public._internal_apply_payapp_paid_event(
    p_payapp_mul_no := v_mul_no,
    p_amount := v_order.amount,
    p_plan_type := v_order.plan_type,
    p_buyer_email := null,
    p_buyer_phone := null,
    p_paid_at := now(),
    p_approval_no := coalesce(p_approval_no, v_order.approval_no),
    p_goodname := null,
    p_order_no := p_order_no,
    p_source := 'admin_force_paid',
    p_raw_payload := jsonb_build_object(
      '_admin_forced', true,
      '_forced_by', v_caller,
      '_forced_at', now(),
      'var1', p_order_no,
      'mul_no', v_mul_no
    )
  );

  -- 감사 로그
  begin
    perform public.admin_log_operation(
      p_source := 'admin_force_paid',
      p_category := 'payment',
      p_level := 'warning',
      p_status := 'completed',
      p_message := 'admin 강제 결제완료: order_no=' || p_order_no || ' → tier=' ||
                   coalesce(v_apply.final_membership_tier,'?'),
      p_details := jsonb_build_object(
        'order_no', p_order_no, 'mul_no', v_mul_no,
        'approval_no', p_approval_no,
        'apply_msg', v_apply.message
      ),
      p_user_id := v_apply.matched_user_id,
      p_related_id := null,
      p_duration_ms := null,
      p_error_code := null,
      p_error_message := null
    );
  exception when others then
    -- 로그 실패해도 본 작업 계속
    raise notice 'admin_log_operation 실패 (무시): %', sqlerrm;
  end;

  return query
  select v_apply.matched_user_id, v_apply.matched_order_id, p_order_no,
         v_apply.final_membership_tier, v_apply.message;
end;
$$;

grant execute on function public.admin_force_paid_by_order_no(text, text, text) to authenticated;

-- 확인
select
  'match_helper=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='_internal_match_user_for_event')
    then 'OK' else 'MISSING' end) as check_1,
  'force_paid_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_force_paid_by_order_no')
    then 'OK' else 'MISSING' end) as check_2;
