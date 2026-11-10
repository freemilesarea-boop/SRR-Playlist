-- 0549_admin_member_list_sort.sql
--
-- 관리자 "회원관리" 목록 정렬 선택 (최신 가입순 / 오래된 가입순 / 최근 접속순 /
-- 청취시간 많은순 / 스트리밍 많은순 / 이름순).
--
-- 왜 서버에서 정렬하나 — 화면은 한 번에 100명만 받는다(p_limit). 회원은 이미 339명이라
-- 받아온 100명을 브라우저에서 다시 정렬하면 "오래된 가입순" 이 실제로 오래된 회원이 아니라
-- "최근 가입 100명 중 오래된 순" 이 된다. 정렬은 limit 보다 먼저 걸려야 한다.
--
-- 바뀌는 것:
--   · 8번째 인자 p_sort text default 'created_desc' 추가. 모르는 값은 기본값으로 처리.
--   · 본문(컬럼·필터·권한 검사)은 0514 그대로다. order by 만 바뀐다.
--
-- 호환:
--   · 기본값이 있어 기존 7인자 호출(배포 전 프론트)은 그대로 최신 가입순을 받는다.
--     → 마이그레이션을 프론트보다 먼저 적용해도 화면이 깨지지 않는다.
--   · 7인자 함수는 drop 한다. 둘 다 남기면 7인자 named 호출이 두 함수에 모두 맞아
--     "function is not unique" 로 실패한다.
--   · DB 안의 호출자 admin_resolve_broadcast_recipients 는 6개 위치 인자로 부른다.
--     나머지(p_category, p_sort)는 기본값으로 채워지므로 그대로 동작한다.
--
-- 적용 전 검증 (운영 DB, pg_temp 사본으로 — 실제 함수는 건드리지 않음):
--   · 6가지 정렬 + 모르는 값 모두 339명 전원 반환, 상위 행 순서 확인
--   · 소요 시간 정렬별 ~410–430ms (현행 함수 457ms) — 0531 의 8초 timeout 과 거리 멀다

drop function if exists public.admin_member_list(integer, integer, text, text, text, text, text);

create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_status text default null,
  p_category text default null,
  p_sort text default 'created_desc'
)
returns table(
  id uuid, email text, nickname text, role text, subscription_type text, account_type text,
  membership_tier text, signup_completed boolean, identity_verified boolean, business_verified boolean,
  business_number text, created_at timestamptz, last_seen_at timestamptz, total_streams bigint,
  total_listened_seconds bigint, total_verified_seconds bigint, withdrawn_at timestamptz,
  disabled_at timestamptz, pii_masked_at timestamptz, last_sign_in_at timestamptz,
  has_cancel_scheduled boolean, has_promotion boolean, plan_type text,
  is_enterprise_hq boolean, is_franchise_store boolean, enterprise_name text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || lower(btrim(p_search)) || '%'
  end;
  v_sort text := case
    when p_sort in ('created_desc', 'created_asc', 'last_seen_desc', 'listened_desc', 'streams_desc', 'nickname_asc')
      then p_sort
    else 'created_desc'
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
    b.c_id, b.c_email, b.c_nickname, b.c_role, b.c_subscription_type, b.c_account_type,
    b.c_membership_tier, b.c_signup_completed, b.c_identity_verified, b.c_business_verified,
    b.c_business_number, b.c_created_at, b.c_last_seen_at, b.c_total_streams,
    b.c_total_listened_seconds, b.c_total_verified_seconds, b.c_withdrawn_at,
    b.c_disabled_at, b.c_pii_masked_at, b.c_last_sign_in_at,
    b.c_has_cancel_scheduled, b.c_has_promotion, b.c_plan_type,
    b.c_is_enterprise_hq, b.c_is_franchise_store, b.c_enterprise_name
  from (
    select
      u.id as c_id, au.email::text as c_email, u.nickname as c_nickname, u.role as c_role,
      u.subscription_type as c_subscription_type, u.account_type as c_account_type,
      u.membership_tier as c_membership_tier,
      u.signup_completed as c_signup_completed, u.identity_verified as c_identity_verified,
      coalesce(bvp.business_verified, false) as c_business_verified,
      bvp.business_number as c_business_number,
      u.created_at as c_created_at,
      (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = u.id) as c_last_seen_at,
      mt.total_streams as c_total_streams,
      mt.total_listened_seconds as c_total_listened_seconds,
      mt.total_verified_seconds as c_total_verified_seconds,
      u.withdrawn_at as c_withdrawn_at, u.disabled_at as c_disabled_at,
      u.pii_masked_at as c_pii_masked_at, au.last_sign_in_at as c_last_sign_in_at,
      exists(select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled')
        as c_has_cancel_scheduled,
      exists(select 1 from public.promotion_code_redemptions as r where r.user_id = u.id) as c_has_promotion,
      u.plan_type as c_plan_type,
      exists(
        select 1 from public.enterprise_accounts as ea
        where ea.auth_user_id = u.id and ea.deleted_at is null
      ) as c_is_enterprise_hq,
      exists(
        select 1 from public.franchise_stores as fs
        where fs.store_id = u.id and fs.status = 'active'
      ) as c_is_franchise_store,
      coalesce(
        (select ea.enterprise_name from public.enterprise_accounts as ea
          where ea.auth_user_id = u.id and ea.deleted_at is null
          order by ea.created_at limit 1),
        (select ea2.enterprise_name
           from public.franchise_stores as fs
           join public.enterprise_franchises as ef
             on ef.franchise_id = fs.franchise_id and ef.role = 'primary' and ef.deleted_at is null
           join public.enterprise_accounts as ea2 on ea2.id = ef.enterprise_account_id
          where fs.store_id = u.id and fs.status = 'active'
          limit 1)
      ) as c_enterprise_name
    from public.users as u
    left join auth.users as au on au.id = u.id
    left join public.business_verification_profiles as bvp on bvp.user_id = u.id
    cross join lateral public.member_playback_totals(u.id) as mt
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
      and (
        p_category is null
        or (p_category = 'artist' and u.account_type = 'artist')
        or (p_category = 'hq' and exists(
              select 1 from public.enterprise_accounts as ea
              where ea.auth_user_id = u.id and ea.deleted_at is null))
        or (p_category = 'franchise' and exists(
              select 1 from public.franchise_stores as fs
              where fs.store_id = u.id and fs.status = 'active'))
        or (p_category = 'business' and u.account_type = 'business'
              and not exists(
                select 1 from public.franchise_stores as fs
                where fs.store_id = u.id and fs.status = 'active'))
        or (p_category = 'individual' and coalesce(u.account_type,'individual') = 'individual'
              and not exists(
                select 1 from public.enterprise_accounts as ea
                where ea.auth_user_id = u.id and ea.deleted_at is null))
      )
  ) as b
  order by
    -- 선택된 정렬 키 하나만 값이 있고 나머지는 null 이다. 동률·null 은 아래 보조 키로 정한다.
    case when v_sort = 'created_asc'    then b.c_created_at end asc,
    case when v_sort = 'last_seen_desc' then b.c_last_seen_at end desc nulls last,
    case when v_sort = 'listened_desc'  then b.c_total_listened_seconds end desc nulls last,
    case when v_sort = 'streams_desc'   then b.c_total_streams end desc nulls last,
    -- 이름순: 닉네임이 없으면 이메일로 이어서 정렬하고, 둘 다 없으면 맨 뒤.
    case when v_sort = 'nickname_asc'
      then lower(coalesce(nullif(btrim(b.c_nickname), ''), b.c_email)) end asc nulls last,
    b.c_created_at desc,
    b.c_id
  limit p_limit offset p_offset;
end; $function$;

revoke all on function public.admin_member_list(integer, integer, text, text, text, text, text, text) from public, anon;
grant execute on function public.admin_member_list(integer, integer, text, text, text, text, text, text) to authenticated;
