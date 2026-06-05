-- 0297 — admin_member_list 에 plan_type 컬럼 추가 (X6.10 Phase 2)
--
-- RETURNS TABLE 컬럼이 변경되므로 DROP FUNCTION 후 재선언.
-- 신규 컬럼은 마지막에 추가 (호환성 — 기존 컬럼 순서 유지).

drop function if exists public.admin_member_list(integer,integer,text,text,text,text);

create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_status text default null
)
returns table(
  id uuid, email text, nickname text, role text,
  subscription_type text, account_type text, membership_tier text,
  signup_completed boolean, identity_verified boolean,
  business_verified boolean, business_number text,
  created_at timestamptz, last_seen_at timestamptz,
  total_streams bigint, total_listened_seconds bigint,
  withdrawn_at timestamptz, disabled_at timestamptz, pii_masked_at timestamptz,
  last_sign_in_at timestamptz, has_cancel_scheduled boolean, has_promotion boolean,
  plan_type text
)
language plpgsql security definer set search_path = public as $$
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
    u.id, au.email::text, u.nickname, u.role,
    u.subscription_type, u.account_type, u.membership_tier,
    u.signup_completed, u.identity_verified,
    coalesce(bvp.business_verified, false), bvp.business_number,
    u.created_at,
    (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = u.id),
    coalesce((select count(*) from public.stream_events as se where se.user_id = u.id and se.event_type='milestone_30s'), 0),
    coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = u.id and se.event_type in ('milestone_30s','complete')), 0),
    u.withdrawn_at, u.disabled_at, u.pii_masked_at, au.last_sign_in_at,
    exists(select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled'),
    exists(select 1 from public.promotion_code_redemptions as r where r.user_id = u.id),
    u.plan_type
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
end; $$;

revoke all on function public.admin_member_list(integer,integer,text,text,text,text) from public, anon;
grant execute on function public.admin_member_list(integer,integer,text,text,text,text) to authenticated, service_role;
