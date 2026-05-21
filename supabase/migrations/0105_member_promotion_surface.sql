-- 0105_member_promotion_surface.sql
-- 회원 상세/목록에 프로모션 사용 정보 노출
--   - admin_member_detail: 'promotions' 배열 추가
--   - admin_member_list: 'has_promotion' 컬럼 추가 (RETURNS TABLE 변경 → drop 후 재생성)

create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      'business_category', u.business_category, 'created_at', u.created_at,
      'withdrawn_at', u.withdrawn_at, 'withdrawn_reason', u.withdrawn_reason,
      'disabled_at', u.disabled_at, 'disabled_reason', u.disabled_reason,
      'pii_masked_at', u.pii_masked_at,
      'is_curator', u.is_curator,
      'last_sign_in_at', au.last_sign_in_at
    ),
    'subscriptions', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'status', s.status, 'plan_type', s.plan_type,
        'price', s.price, 'auto_renew', s.auto_renew, 'last_paid_at', s.last_paid_at,
        'current_period_start', s.current_period_start, 'current_period_end', s.current_period_end,
        'canceled_at', s.canceled_at, 'cancel_reason', s.cancel_reason, 'refunded_at', s.refunded_at,
        'payapp_mul_no', s.payapp_mul_no, 'payapp_rebill_no', s.payapp_rebill_no,
        'created_at', s.created_at) order by s.created_at desc), '[]'::jsonb)
      from public.subscriptions as s where s.user_id = p_user_id
    ),
    'total_streams', (select count(*) from public.stream_events as se where se.user_id = p_user_id and se.event_type='milestone_30s'),
    'total_listened_seconds', coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')), 0),
    'last_seen_at', (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = p_user_id),
    'recent_visits', (select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from (select ve.path, ve.created_at from public.visitor_events as ve where ve.user_id = p_user_id order by ve.created_at desc limit 10) as v),
    'recent_plays', (select coalesce(jsonb_agg(jsonb_build_object('track_title', rp.track_title, 'playlist_title', rp.playlist_title, 'completed', rp.completed, 'created_at', rp.created_at) order by rp.created_at desc), '[]'::jsonb)
      from (select se.created_at, t.title as track_title, p.title as playlist_title, (se.event_type = 'complete') as completed
            from public.stream_events as se left join public.tracks as t on t.id = se.track_id left join public.playlists as p on p.id = se.playlist_id
            where se.user_id = p_user_id and se.event_type in ('milestone_30s', 'complete') order by se.created_at desc limit 10) as rp),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object('amount', re.amount, 'subscription_type', re.subscription_type, 'status', re.status, 'paid_at', re.paid_at, 'payment_provider', re.payment_provider, 'note', re.note) order by re.paid_at desc), '[]'::jsonb)
      from public.revenue_events as re where re.user_id = p_user_id),
    'subscription_requests', (select coalesce(jsonb_agg(jsonb_build_object('requested_plan', sr.requested_plan, 'status', sr.status, 'created_at', sr.created_at) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests as sr where sr.user_id = p_user_id),
    'promotions', (select coalesce(jsonb_agg(jsonb_build_object(
        'code', pc.code, 'name', pc.name, 'discount_type', pc.discount_type,
        'discount_amount', r.discount_amount, 'original_amount', r.original_amount,
        'final_amount', r.final_amount, 'plan_type', r.plan_type, 'redeemed_at', r.redeemed_at) order by r.redeemed_at desc), '[]'::jsonb)
      from public.promotion_code_redemptions as r join public.promotion_codes as pc on pc.id = r.promotion_code_id where r.user_id = p_user_id),
    'sales_agent', (select jsonb_build_object('id', sa.id, 'name', sa.name, 'code', sa.code, 'is_active', sa.is_active, 'commission_rate', sa.commission_rate, 'linked_at', sa.created_at)
      from public.sales_agents as sa where sa.user_id = p_user_id limit 1)
  )
  into v_result
  from public.users as u left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end; $function$;

drop function if exists public.admin_member_list(integer, integer, text, text, text, text);

create or replace function public.admin_member_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_plan text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_status text DEFAULT NULL::text)
returns table(id uuid, email text, nickname text, role text, subscription_type text, account_type text, membership_tier text, signup_completed boolean, identity_verified boolean, business_verified boolean, business_number text, created_at timestamp with time zone, last_seen_at timestamp with time zone, total_streams bigint, total_listened_seconds bigint, withdrawn_at timestamp with time zone, disabled_at timestamp with time zone, pii_masked_at timestamp with time zone, last_sign_in_at timestamp with time zone, has_cancel_scheduled boolean, has_promotion boolean)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || lower(btrim(p_search)) || '%'
  end;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    u.id, au.email::text as email, u.nickname, u.role,
    u.subscription_type, u.account_type, u.membership_tier,
    u.signup_completed, u.identity_verified,
    coalesce(bvp.business_verified, false) as business_verified, bvp.business_number,
    u.created_at,
    (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = u.id) as last_seen_at,
    coalesce((select count(*) from public.stream_events as se where se.user_id = u.id and se.event_type='milestone_30s'), 0) as total_streams,
    coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = u.id and se.event_type in ('milestone_30s','complete')), 0) as total_listened_seconds,
    u.withdrawn_at, u.disabled_at, u.pii_masked_at, au.last_sign_in_at,
    exists(select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled') as has_cancel_scheduled,
    exists(select 1 from public.promotion_code_redemptions as r where r.user_id = u.id) as has_promotion
  from public.users as u
  left join auth.users as au on au.id = u.id
  left join public.business_verification_profiles as bvp on bvp.user_id = u.id
  where
    (v_search_pattern is null
      or lower(coalesce(au.email,'')) like v_search_pattern
      or lower(coalesce(u.nickname,'')) like v_search_pattern
      or u.id::text like v_search_pattern)
    and (p_plan is null or u.subscription_type = p_plan or u.membership_tier = p_plan)
    and (p_role is null or u.role = p_role)
    and (
      p_status is null
      or (p_status = 'active' and u.withdrawn_at is null and u.disabled_at is null)
      or (p_status = 'withdrawn' and u.withdrawn_at is not null)
      or (p_status = 'disabled' and u.disabled_at is not null)
      or (p_status = 'cancel_scheduled' and exists(
            select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled'))
    )
  order by u.created_at desc
  limit p_limit offset p_offset;
end; $function$;