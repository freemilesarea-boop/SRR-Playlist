-- 0309 — admin_force_activate_membership 의 artist 플랜 수용 + tier 매핑 (X6.24)
--
-- 문제:
--   admin_force_activate_membership 가 plan_type 을 'individual','business' 만
--   허용 → 관리자가 artist_general / artist_student 결제를 수동 활성화하려 하면
--   'invalid plan_type' raise → PaymentSyncTool 강제 활성화 불가.
--
-- 수정 (0308 _internal_apply_payapp_paid_event 와 동일 패턴):
--   1) 허용 plan_type 에 artist_general / artist_student 추가
--   2) membership_tier 매핑: artist_general/student → 'individual' (RLS 호환)
--   3) v_amount 기본값 매트릭스:
--        individual / artist_student → 4900
--        business   / artist_general → 6900
--   4) subscriptions / payment_orders.plan_type 는 원본 그대로 저장
--      users.membership_tier / subscription_type 만 'individual' 로 normalize.
--
-- 보존:
--   * users.membership_tier CHECK 변경 X
--   * tracks_artist_insert RLS 정책 변경 X
--   * 세부 권한/한도는 users.plan_type / get_my_artist_plan() 에서 판단

create or replace function public.admin_force_activate_membership(
  p_user_id uuid,
  p_plan_type text default 'individual'::text,
  p_reason text default null::text,
  p_amount integer default null::integer,
  p_payapp_mul_no text default null::text,
  p_approval_no text default null::text,
  p_paid_at timestamptz default null::timestamptz
)
returns table(
  user_id uuid, subscription_id uuid, order_id uuid,
  membership_updated boolean, final_membership_tier text, message text
)
language plpgsql security definer set search_path = public as $$
declare
  v_amount integer;
  v_sub_id uuid; v_order_id uuid;
  v_tier text;
  v_paid_at timestamptz := coalesce(p_paid_at, now());
  v_payload jsonb;
  -- ✅ X6.24: PayApp 상품 plan_type vs users.membership_tier 매핑
  v_tier_target text;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  if p_user_id is null then raise exception 'p_user_id required'; end if;
  -- X6.24: artist_general / artist_student 추가 허용
  if p_plan_type not in ('individual','business','artist_general','artist_student') then
    raise exception 'invalid plan_type: %', p_plan_type;
  end if;
  if not exists (select 1 from public.users as u where u.id = p_user_id) then
    raise exception 'user not found';
  end if;

  -- X6.24: membership_tier 매핑 (artist 플랜은 'individual')
  v_tier_target := case p_plan_type
    when 'business'        then 'business'
    when 'individual'      then 'individual'
    when 'artist_general'  then 'individual'
    when 'artist_student'  then 'individual'
    else 'individual'
  end;

  v_amount := coalesce(p_amount, case p_plan_type
    when 'individual'      then 4900
    when 'artist_student'  then 4900
    when 'business'        then 6900
    when 'artist_general'  then 6900
    else 4900
  end);

  v_payload := jsonb_build_object(
    'force_activated', true,
    'reason', coalesce(p_reason, 'admin manual activation'),
    'plan_type', p_plan_type,
    'membership_tier_mapped', v_tier_target,
    'amount', v_amount,
    'payapp_mul_no', p_payapp_mul_no, 'approval_no', p_approval_no,
    'paid_at', v_paid_at,
    'activated_by', auth.uid(), 'activated_at', now()
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

  -- ✅ X6.24: users.membership_tier / subscription_type 는 매핑된 값 사용
  -- (CHECK: free/individual/business — artist_* 는 저장 불가)
  update public.users as u
  set membership_tier = v_tier_target, subscription_type = v_tier_target
  where u.id = p_user_id;

  select u.membership_tier into v_tier from public.users as u where u.id = p_user_id;

  return query select p_user_id, v_sub_id, v_order_id, true, v_tier,
    ('force-activated plan_type=' || p_plan_type ||
     ' tier=' || v_tier ||
     ' reason=' || coalesce(p_reason,'(no reason)'))::text;
end; $$;
