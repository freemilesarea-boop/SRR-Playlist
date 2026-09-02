-- ============================================================================
-- 0491_admin_member_list_enterprise_category.sql
-- 회원관리(admin_member_list) 유형 분류 강화 — 엔터프라이즈 본사/가맹 구분.
--
-- 문제: 관리자 회원관리 "유형"이 users.account_type 하나만 봐서
--   · 엔터프라이즈 본사 담당자(HQ)는 account_type='individual' 로 저장 → "일반" 으로 표시
--   · 엔터프라이즈 가맹 매장은 account_type='business' → 일반 "사업자" 와 구분 안 됨
--   실제 소속을 확인하기 어렵다.
--
-- 해결: enterprise_accounts.auth_user_id(본사) / franchise_stores.store_id(가맹)
--   연결을 조회해 두 플래그(is_enterprise_hq, is_franchise_store)와 소속 브랜드명
--   (enterprise_name)을 반환. 카테고리 필터(p_category)도 추가.
--
--   카테고리 우선순위(표시용): artist > hq(본사) > franchise(가맹) > business(사업자) > individual(일반)
--
-- 안전:
--   · 반환 컬럼이 늘어 CREATE OR REPLACE 불가 → 기존 6-arg 함수 DROP 후 재생성.
--   · p_category 는 DEFAULT NULL → 기존 호출(6개 인자)과 호환. 단 6-arg/7-arg
--     오버로드 모호성 방지를 위해 구 6-arg 시그니처를 명시적으로 DROP.
--   · SECURITY DEFINER + admin 체크 로직은 원본 그대로 유지.
--   · 읽기 전용 조회 — 데이터 변경 없음. (프로덕션에는 이미 동일 정의 적용됨 — 멱등)
-- ============================================================================

drop function if exists public.admin_member_list(integer, integer, text, text, text, text);

create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null,
  p_status text default null,
  p_category text default null
)
returns table(
  id uuid, email text, nickname text, role text,
  subscription_type text, account_type text, membership_tier text,
  signup_completed boolean, identity_verified boolean, business_verified boolean,
  business_number text, created_at timestamptz, last_seen_at timestamptz,
  total_streams bigint, total_listened_seconds bigint,
  withdrawn_at timestamptz, disabled_at timestamptz, pii_masked_at timestamptz,
  last_sign_in_at timestamptz, has_cancel_scheduled boolean, has_promotion boolean,
  plan_type text,
  -- 신규(0491)
  is_enterprise_hq boolean, is_franchise_store boolean, enterprise_name text
)
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
    u.plan_type,
    -- 본사 연결 여부
    exists(
      select 1 from public.enterprise_accounts as ea
      where ea.auth_user_id = u.id and ea.deleted_at is null
    ),
    -- 가맹 매장 연결 여부
    exists(
      select 1 from public.franchise_stores as fs
      where fs.store_id = u.id and fs.status = 'active'
    ),
    -- 소속 브랜드명 (본사 우선, 없으면 가맹 소속 브랜드)
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
    )
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
  order by u.created_at desc
  limit p_limit offset p_offset;
end; $function$;

grant execute on function public.admin_member_list(integer, integer, text, text, text, text, text)
  to authenticated, service_role;
