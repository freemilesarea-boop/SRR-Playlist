-- ============================================
-- 0027_admin_link_unmatched.sql
--
-- 자동 동기화에서 미매칭(unmatched) 상태로 저장된 import 행을 관리자가
-- 직접 사용자에게 연결하는 보조 RPC 2개:
--
--   1) admin_search_users_for_link(p_query, p_limit)
--      - 이메일/닉네임 ilike 검색 (admin only)
--      - auth.users.email + public.users.nickname 조인 결과 반환
--
--   2) admin_link_unmatched_import(p_import_id, p_user_id)
--      - import 의 mul_no / amount / paid_at 정보를 그대로 사용해
--        payment_orders / subscriptions / users 적용
--      - 멱등 (status='matched' 면 그대로 반환)
--
-- 보안:
--   - 모든 RPC admin only
--   - 모든 컬럼 alias prefix qualify (0026 에서 ambiguous 이슈 학습 반영)
-- ============================================

create or replace function public.admin_search_users_for_link(
  p_query text,
  p_limit int default 10
)
returns table(user_id uuid, email text, nickname text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_q text := btrim(coalesce(p_query, ''));
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if length(v_q) < 2 then
    raise exception 'query must be at least 2 chars';
  end if;

  return query
  select u.id, au.email::text, u.nickname
  from public.users u
  left join auth.users au on au.id = u.id
  where coalesce(au.email,'') ilike '%' || v_q || '%'
     or coalesce(u.nickname,'') ilike '%' || v_q || '%'
  order by au.email nulls last
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.admin_search_users_for_link(text, int) to authenticated;

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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_admin boolean;
  v_import public.payapp_manual_payment_imports%rowtype;
  v_order_id uuid;
  v_sub_id uuid;
  v_payload jsonb;
begin
  select exists(select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') into v_admin;
  if not v_admin then raise exception 'admin only'; end if;

  -- import 행 조회
  select mpi.* into v_import
  from public.payapp_manual_payment_imports mpi
  where mpi.id = p_import_id;
  if not found then raise exception 'import row not found'; end if;

  -- 이미 matched 면 그대로 반환 (멱등)
  if v_import.status = 'matched' then
    return query select
      'matched'::text,
      v_import.matched_user_id,
      v_import.matched_order_id,
      v_import.matched_subscription_id,
      'already linked'::text;
    return;
  end if;

  -- 대상 사용자 검증
  if not exists (select 1 from public.users u where u.id = p_user_id) then
    raise exception 'target user not found';
  end if;

  v_payload := coalesce(v_import.raw_payload, '{}'::jsonb)
    || jsonb_build_object('manually_linked', true, 'linked_by', auth.uid(), 'linked_at', now());

  -- payment_orders 매칭 또는 생성
  select po.id into v_order_id
  from public.payment_orders po
  where po.payapp_mul_no = v_import.payapp_mul_no
  limit 1;

  if v_order_id is null then
    select po.id into v_order_id
    from public.payment_orders po
    where po.user_id = p_user_id
      and po.status in ('requested','waiting','failed')
    order by po.created_at desc
    limit 1;
  end if;

  if v_order_id is null then
    insert into public.payment_orders
      (user_id, order_no, plan_type, amount, status, payapp_mul_no, raw_response)
    values
      (p_user_id, 'manual_' || v_import.payapp_mul_no, v_import.plan_type, v_import.amount,
       'paid', v_import.payapp_mul_no, v_payload)
    returning public.payment_orders.id into v_order_id;
  end if;

  -- subscriptions 매칭 또는 생성
  select s.id into v_sub_id
  from public.subscriptions s
  where s.user_id = p_user_id
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
      (p_user_id, v_import.plan_type, v_import.amount, 'active')
    returning public.subscriptions.id into v_sub_id;
  end if;

  -- 적용
  update public.payment_orders as po
  set status = 'paid',
      user_id = p_user_id,
      payapp_mul_no = v_import.payapp_mul_no,
      subscription_id = coalesce(po.subscription_id, v_sub_id),
      raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
  where po.id = v_order_id;

  update public.subscriptions as s
  set status = 'active',
      plan_type = v_import.plan_type,
      price = v_import.amount,
      payapp_mul_no = coalesce(s.payapp_mul_no, v_import.payapp_mul_no),
      last_paid_at = v_import.paid_at,
      current_period_start = v_import.paid_at,
      current_period_end = v_import.paid_at + interval '1 month'
  where s.id = v_sub_id;

  update public.users as u
  set membership_tier = v_import.plan_type
  where u.id = p_user_id;

  update public.payapp_manual_payment_imports as mpi
  set status = 'matched',
      matched_user_id = p_user_id,
      matched_order_id = v_order_id,
      matched_subscription_id = v_sub_id,
      raw_payload = v_payload,
      error_message = null
  where mpi.id = p_import_id;

  return query select 'matched'::text, p_user_id, v_order_id, v_sub_id, 'manually linked'::text;
end;
$$;

grant execute on function public.admin_link_unmatched_import(uuid, uuid) to authenticated;

-- 확인
select
  'link_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_link_unmatched_import')
    then 'OK' else 'MISSING' end) as check_1,
  'search_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_search_users_for_link')
    then 'OK' else 'MISSING' end) as check_2;
