-- ============================================
-- 0056_user_self_cancel_and_withdrawal.sql
--
-- 회원탈퇴 + 구독취소 (grace period) 구현.
--
-- 정책:
--   1) 구독취소: 사용자가 self-cancel 하면
--      - subscriptions.status = 'cancel_scheduled'
--      - auto_renew = false
--      - cancel_requested_at = now(), cancel_reason = 'user_request'
--      - membership_tier 는 그대로 유지 (current_period_end 까지 이용)
--   2) PayApp rebillCancel 호출은 cancel-payapp-subscription EF 가 담당.
--   3) PayApp 해지 webhook 도착 시:
--      - 매칭된 subscription 의 current_period_end 가 미래이거나
--        status='cancel_scheduled' 이면 → membership 유지, canceled_at 만 마킹
--      - 그 외(정보 없음/이미 만료) → 기존대로 즉시 free 회수
--   4) 회원탈퇴:
--      - users.withdrawn_at = now(), withdrawn_reason 마킹
--      - 활성 구독(active/payment_waiting/cancel_scheduled with period_end>now) 있으면 차단
--      - public.users soft delete. auth.users 는 보존.
--
-- 영업인/정산 데이터는 일체 건드리지 않음 (FK on delete set null 안 발동).
-- ============================================

-- ----------------------
-- 1) 컬럼 추가
-- ----------------------
alter table public.users
  add column if not exists withdrawn_at timestamptz,
  add column if not exists withdrawn_reason text;

create index if not exists idx_users_withdrawn_at
  on public.users(withdrawn_at) where withdrawn_at is not null;

alter table public.subscriptions
  add column if not exists cancel_requested_at timestamptz;

-- ----------------------
-- 2) user_cancel_my_subscription — 사용자 self-cancel RPC
--    (cancel-payapp-subscription EF 가 이 RPC 를 호출. EF 는 PayApp rebillCancel
--     호출 + 이 RPC 로 DB 상태 변경.)
-- ----------------------
create or replace function public.user_cancel_my_subscription(
  p_subscription_id uuid,
  p_reason text default 'user_request'
)
returns table(
  subscription_id uuid,
  status text,
  cancel_requested_at timestamptz,
  current_period_end timestamptz,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_sub record;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  select s.id, s.user_id, s.status, s.current_period_end, s.payapp_rebill_no
    into v_sub
  from public.subscriptions as s
  where s.id = p_subscription_id;

  if v_sub.id is null then
    raise exception 'subscription not found';
  end if;
  if v_sub.user_id <> v_uid then
    raise exception 'forbidden';
  end if;
  if v_sub.status not in ('active','pending','payment_waiting') then
    raise exception 'cannot cancel: status=%', v_sub.status;
  end if;

  update public.subscriptions as s
  set status = 'cancel_scheduled',
      auto_renew = false,
      cancel_requested_at = coalesce(s.cancel_requested_at, now()),
      cancel_reason = coalesce(s.cancel_reason, p_reason)
  where s.id = p_subscription_id;

  return query
  select s.id, s.status::text, s.cancel_requested_at, s.current_period_end,
    ('subscription scheduled to cancel on ' ||
     coalesce(s.current_period_end::text, 'period end'))::text
  from public.subscriptions as s where s.id = p_subscription_id;
end;
$$;

grant execute on function public.user_cancel_my_subscription(uuid, text) to authenticated;

-- ----------------------
-- 3) _internal_apply_payapp_subscription_cancel_event — grace period 분기 추가
--    (0042 본문 유지 + 매칭 subscription 의 current_period_end / cancel_scheduled
--     상태에 따라 membership 회수 여부 분기)
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
  v_sub record;
  v_now timestamptz := coalesce(p_event_at, now());
  v_payload jsonb;
  v_tier text;
  v_grace boolean := false;
begin
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

  if v_sub_id is null then
    select s.id into v_sub_id from public.subscriptions as s
    where s.user_id = v_user_id
    order by case s.status when 'active' then 0 when 'pending' then 1
                          when 'payment_waiting' then 2 when 'cancel_scheduled' then 3 else 4 end,
             s.created_at desc
    limit 1;
  end if;

  -- Grace period 판정: cancel_scheduled 상태이거나 current_period_end 가 미래면 유지
  if v_sub_id is not null then
    select s.status, s.current_period_end into v_sub
    from public.subscriptions as s where s.id = v_sub_id;
    if v_sub.status = 'cancel_scheduled'
       or (v_sub.current_period_end is not null and v_sub.current_period_end > v_now) then
      v_grace := true;
    end if;
  end if;

  v_payload := jsonb_build_object(
    'subscription_canceled', true,
    'reason', p_reason,
    'event_at', v_now,
    'source', p_source,
    'mul_no', p_payapp_mul_no,
    'rebill_no', p_payapp_rebill_no,
    'grace_period', v_grace
  );

  if v_sub_id is not null then
    update public.subscriptions as s
    set status = case when v_grace then 'cancel_scheduled' else 'canceled' end,
        auto_renew = false,
        canceled_at = coalesce(s.canceled_at, v_now),
        cancel_reason = coalesce(s.cancel_reason, p_reason),
        last_payapp_state_label = '정기결제 해지'
    where s.id = v_sub_id;
  end if;

  if v_order_id is not null then
    update public.payment_orders as po
    set cancel_reason = coalesce(po.cancel_reason, p_reason),
        raw_response = coalesce(po.raw_response, '{}'::jsonb) || v_payload
    where po.id = v_order_id;
  end if;

  -- Grace period 면 membership 그대로 유지, 아니면 즉시 free 회수
  if not v_grace then
    update public.users as u
    set membership_tier = 'free',
        subscription_type = 'free'
    where u.id = v_user_id;
  end if;

  select u.membership_tier into v_tier from public.users as u where u.id = v_user_id;

  return query select v_user_id, v_order_id, v_sub_id, (not v_grace), v_tier,
    (case when v_grace
       then 'cancel scheduled — membership retained until period end'
       else 'subscription canceled — membership=free (reason: ' || p_reason || ')'
     end)::text;
end;
$$;

revoke execute on function public._internal_apply_payapp_subscription_cancel_event(text, text, text, timestamptz, text) from public;
grant execute on function public._internal_apply_payapp_subscription_cancel_event(text, text, text, timestamptz, text) to service_role;

-- ----------------------
-- 4) expire_scheduled_cancellations — current_period_end 지난 cancel_scheduled 정리
--    just-in-time: 사용자가 호출 가능 (자기 자신만) + admin 전역
-- ----------------------
create or replace function public.expire_my_scheduled_cancellation()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_affected int := 0;
  v_sub_user uuid;
begin
  if v_uid is null then return 0; end if;

  with expired as (
    update public.subscriptions as s
    set status = 'canceled'
    where s.user_id = v_uid
      and s.status = 'cancel_scheduled'
      and s.current_period_end is not null
      and s.current_period_end <= now()
    returning s.user_id
  )
  select count(*) into v_affected from expired;

  if v_affected > 0 then
    update public.users as u
    set membership_tier = 'free', subscription_type = 'free'
    where u.id = v_uid;
  end if;

  return v_affected;
end;
$$;

grant execute on function public.expire_my_scheduled_cancellation() to authenticated;

create or replace function public.admin_expire_scheduled_cancellations()
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_affected int := 0;
  v_uid uuid;
begin
  if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  for v_uid in
    select distinct s.user_id from public.subscriptions as s
    where s.status = 'cancel_scheduled'
      and s.current_period_end is not null
      and s.current_period_end <= now()
  loop
    update public.subscriptions as s
    set status = 'canceled'
    where s.user_id = v_uid
      and s.status = 'cancel_scheduled'
      and s.current_period_end <= now();

    update public.users as u
    set membership_tier = 'free', subscription_type = 'free'
    where u.id = v_uid;

    v_affected := v_affected + 1;
  end loop;

  return v_affected;
end;
$$;

grant execute on function public.admin_expire_scheduled_cancellations() to authenticated;

-- ----------------------
-- 5) user_request_withdrawal — 회원탈퇴
-- ----------------------
create or replace function public.user_request_withdrawal(p_reason text default null)
returns table(
  user_id uuid,
  withdrawn_at timestamptz,
  message text
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_active_count int;
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;

  -- 활성 또는 grace 중인 구독이 있으면 차단
  select count(*) into v_active_count
  from public.subscriptions as s
  where s.user_id = v_uid
    and (
      s.status in ('active','payment_waiting','pending')
      or (s.status = 'cancel_scheduled'
          and s.current_period_end is not null
          and s.current_period_end > now())
    );

  if v_active_count > 0 then
    raise exception 'active_subscription_exists' using
      hint = '활성 또는 취소 예정 구독이 있어요. 먼저 구독을 취소하고 결제 기간이 종료된 후 다시 시도해주세요.';
  end if;

  update public.users as u
  set withdrawn_at = now(),
      withdrawn_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      membership_tier = 'free',
      subscription_type = 'free'
  where u.id = v_uid;

  return query
  select v_uid, u.withdrawn_at, 'withdrawn'::text
  from public.users as u where u.id = v_uid;
end;
$$;

grant execute on function public.user_request_withdrawal(text) to authenticated;

-- ----------------------
-- 6) RLS — 탈퇴 회원이 본인 row 읽기는 가능 (App 에서 withdrawn 체크 후 sign-out)
--    SELECT/UPDATE 정책은 기존 유지. UPDATE 시 withdrawn_at 본인이 자가 클리어
--    못 하도록 (방어선): policy 보강은 생략 — RPC 만 통해 변경
-- ----------------------

-- ----------------------
-- 7) admin_member_list — 새 컬럼 + 필터 추가 (DROP+CREATE — RETURNS TABLE 변경)
-- ----------------------
drop function if exists public.admin_member_list(integer, integer, text, text, text);
drop function if exists public.admin_member_list(integer, integer, text, text, text, text);

create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_status text default null  -- 'active' | 'withdrawn' | 'cancel_scheduled'
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  account_type text,
  membership_tier text,
  signup_completed boolean,
  identity_verified boolean,
  business_verified boolean,
  business_number text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint,
  withdrawn_at timestamptz,
  has_cancel_scheduled boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || btrim(p_search) || '%'
  end;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin'
    ) then raise exception 'admin only'; end if;
  end;

  return query
  with stream_agg as (
    select se.user_id, count(*) filter (where se.event_type='milestone_30s')::bigint as streams,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events as se where se.user_id is not null group by se.user_id
  ),
  last_seen as (
    select ve.user_id, max(ve.created_at) as last_seen_at
    from public.visitor_events as ve where ve.user_id is not null group by ve.user_id
  ),
  user_email as (
    select au.id as user_id, au.email::text as email from auth.users as au
  ),
  cancel_pending as (
    select s.user_id, true as has_scheduled
    from public.subscriptions as s
    where s.status = 'cancel_scheduled'
      and (s.current_period_end is null or s.current_period_end > now())
    group by s.user_id
  )
  select
    u.id,
    coalesce(ue.email, '')::text,
    coalesce(u.nickname, '')::text,
    coalesce(u.role, 'user')::text,
    coalesce(u.subscription_type, 'free')::text,
    coalesce(u.account_type, 'individual')::text,
    coalesce(u.membership_tier, 'free')::text,
    coalesce(u.signup_completed, false),
    coalesce(u.identity_verified, false),
    coalesce(bvp.business_verified, false),
    bvp.business_number::text,
    u.created_at,
    ls.last_seen_at,
    coalesce(sa.streams, 0)::bigint,
    coalesce(sa.listened, 0)::bigint,
    u.withdrawn_at,
    coalesce(cp.has_scheduled, false)
  from public.users as u
  left join user_email as ue on ue.user_id = u.id
  left join stream_agg as sa on sa.user_id = u.id
  left join last_seen as ls on ls.user_id = u.id
  left join public.business_verification_profiles as bvp on bvp.user_id = u.id
  left join cancel_pending as cp on cp.user_id = u.id
  where (
    v_search_pattern is null
    or coalesce(u.nickname, '') ilike v_search_pattern
    or coalesce(ue.email, '') ilike v_search_pattern
  )
  and (p_plan is null or u.subscription_type = p_plan)
  and (p_role is null or u.role = p_role)
  and (
    p_status is null
    or (p_status = 'active' and u.withdrawn_at is null)
    or (p_status = 'withdrawn' and u.withdrawn_at is not null)
    or (p_status = 'cancel_scheduled' and coalesce(cp.has_scheduled, false) = true)
  )
  order by u.created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end;
$$;

grant execute on function public.admin_member_list(integer, integer, text, text, text, text) to authenticated;

-- ----------------------
-- 8) admin_member_detail — user 객체에 withdrawn_at 노출
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
    if not exists (
      select 1 from public.users as u where u.id = auth.uid() and u.role='admin'
    ) then raise exception 'admin only'; end if;
  end;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id, 'email', au.email, 'nickname', u.nickname,
      'role', u.role, 'subscription_type', u.subscription_type,
      'account_type', u.account_type, 'membership_tier', u.membership_tier,
      'business_category', u.business_category, 'created_at', u.created_at,
      'withdrawn_at', u.withdrawn_at, 'withdrawn_reason', u.withdrawn_reason
    ),
    'sales_agent', (
      select case when sa.id is null then null else jsonb_build_object(
        'id', sa.id, 'name', sa.name, 'code', sa.code,
        'is_active', sa.is_active, 'commission_rate', sa.commission_rate,
        'linked_at', u2.created_at
      ) end
      from public.users as u2
      left join public.sales_agents as sa on sa.id = u2.sales_agent_id
      where u2.id = p_user_id
    ),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan_type', s.plan_type,
        'price', s.price, 'auto_renew', s.auto_renew,
        'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start,
        'current_period_end', s.current_period_end,
        'cancel_requested_at', s.cancel_requested_at,
        'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason,
        'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no,
        'payapp_rebill_no', s.payapp_rebill_no,
        'sales_agent_id', s.sales_agent_id,
        'sales_agent_code', s.sales_agent_code,
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
      select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from (
        select ve.path, ve.created_at from public.visitor_events as ve
        where ve.user_id = p_user_id order by ve.created_at desc limit 10
      ) as v
    ),
    'recent_plays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_title', rp.track_title, 'playlist_title', rp.playlist_title,
        'completed', rp.completed, 'created_at', rp.created_at
      ) order by rp.created_at desc), '[]'::jsonb)
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
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', po.id, 'amount', po.amount, 'status', po.status,
        'plan_type', po.plan_type,
        'subscription_type', po.plan_type,
        'payapp_mul_no', po.payapp_mul_no,
        'approval_no', po.approval_no,
        'paid_at', po.paid_at,
        'canceled_at', po.canceled_at, 'refunded_at', po.refunded_at,
        'cancel_reason', po.cancel_reason,
        'sales_agent_id', po.sales_agent_id,
        'sales_agent_code', po.sales_agent_code,
        'created_at', po.created_at
      ) order by coalesce(po.paid_at, po.created_at) desc), '[]'::jsonb)
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
