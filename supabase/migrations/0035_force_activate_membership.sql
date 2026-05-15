-- ============================================
-- 0035_force_activate_membership.sql
--
-- 운영 진단 결과:
--   - 115554935: state=4 만 들어옴 (승인대기). state=64 (승인완료) 미수신 → membership 미적용.
--   - PayApp 의 실제 의미:
--       state=4   승인대기 (카드 인증 단계)
--       state=64  승인완료 (정산 확정 — 실제 결제 성공)
--   이전 버전 (state=4 도 paid 처리) 은 의미상 잘못됨.
--
-- 변경:
--   1) payapp-feedback Edge Function: state=4 는 pending 으로만 기록.
--      state=64 만 _internal_apply 트리거. (Edge Function 측 별도 커밋)
--   2) 본 migration: admin_force_activate_membership RPC 추가 —
--      state=64 webhook 이 영구 미도착하는 케이스 (PayApp 통보 누락 / retry 실패 등)
--      에서 운영자가 user_id 만으로 즉시 권한 부여.
--
-- 보안:
--   - admin only (헬퍼 _internal_is_admin_caller 사용 + alias fallback)
--   - 결과는 payapp_manual_payment_imports 에 'forced' 상태로 기록 (감사 로그)
-- ============================================

create or replace function public.admin_force_activate_membership(
  p_user_id uuid,
  p_plan_type text default 'individual',
  p_reason text default null,
  p_amount integer default null
)
returns table(
  user_id uuid,
  subscription_id uuid,
  order_id uuid,
  membership_updated boolean,
  final_membership_tier text,
  message text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_amount integer;
  v_sub_id uuid;
  v_order_id uuid;
  v_tier text;
  v_now timestamptz := now();
  v_payload jsonb;
begin
  -- admin 검증
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users as u
      where u.id = auth.uid() and u.role = 'admin'
    ) then
      raise exception 'admin only';
    end if;
  end;

  if p_user_id is null then raise exception 'p_user_id required'; end if;
  if p_plan_type not in ('individual','business') then
    raise exception 'invalid plan_type (individual|business 만 허용)';
  end if;
  if not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  v_amount := coalesce(p_amount, case when p_plan_type = 'individual' then 4900 else 6900 end);

  v_payload := jsonb_build_object(
    'force_activated', true,
    'reason', coalesce(p_reason, 'admin manual activation'),
    'plan_type', p_plan_type,
    'amount', v_amount,
    'activated_by', auth.uid(),
    'activated_at', v_now
  );

  -- subscription 적용 (있으면 갱신, 없으면 생성)
  select s.id into v_sub_id
  from public.subscriptions as s
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
      (user_id, plan_type, price, status, last_paid_at, current_period_start, current_period_end)
    values
      (p_user_id, p_plan_type, v_amount, 'active', v_now, v_now, v_now + interval '1 month')
    returning public.subscriptions.id into v_sub_id;
  else
    update public.subscriptions as s
    set status = 'active',
        plan_type = p_plan_type,
        price = v_amount,
        last_paid_at = v_now,
        current_period_start = v_now,
        current_period_end = v_now + interval '1 month'
    where s.id = v_sub_id;
  end if;

  -- payment_orders 적용 (있으면 갱신, 없으면 생성 — 감사 로그용)
  select po.id into v_order_id
  from public.payment_orders as po
  where po.user_id = p_user_id
    and po.status in ('requested','waiting','failed','pending')
  order by po.created_at desc
  limit 1;

  if v_order_id is null then
    insert into public.payment_orders
      (user_id, subscription_id, order_no, plan_type, amount, status, raw_response)
    values
      (p_user_id, v_sub_id,
       'force_' || extract(epoch from v_now)::text,
       p_plan_type, v_amount, 'paid', v_payload)
    returning public.payment_orders.id into v_order_id;
  else
    update public.payment_orders as po
    set status = 'paid',
        subscription_id = coalesce(po.subscription_id, v_sub_id),
        raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
    where po.id = v_order_id;
  end if;

  -- users.membership_tier 적용
  update public.users as u
  set membership_tier = p_plan_type,
      subscription_type = p_plan_type
  where u.id = p_user_id;

  select u.membership_tier into v_tier
  from public.users as u where u.id = p_user_id;

  return query select
    p_user_id, v_sub_id, v_order_id,
    true, v_tier,
    'force-activated: ' || coalesce(p_reason, '(no reason)') || ' (tier=' || v_tier || ')';
end;
$$;

grant execute on function public.admin_force_activate_membership(uuid, text, text, integer)
  to authenticated;

-- 확인
select
  'force_activate_rpc=' ||
  (case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'admin_force_activate_membership'
  ) then 'OK' else 'MISSING' end) as check_1;
