-- ============================================
-- 0471_admin_member_stats.sql
--
-- 관리자 회원 통계 전면 개선 — 단일 집계 RPC admin_member_stats().
--
-- 기존 admin_dashboard_stats() 는 그대로 두고(무변경), 회원 현황 전용 KPI 를
-- 한 번의 스캔으로 계산하는 신규 RPC 를 추가한다. Player/Queue/정산 등 런타임
-- 무관. 읽기 전용 집계.
--
-- 집계 기준 (코드로 명확히 정의):
--   대상(총 회원) = public.users 중 role <> 'admin' (내부 운영자 2계정 제외).
--     탈퇴/가입미완 회원도 "가입 이력"이므로 총 회원에 포함 → 상태 파티션에서
--     탈퇴/이메일미인증 버킷으로 분류된다.
--
--   ① 회원 구분 (account_type 기준, 정확한 파티션):
--        아티스트 = account_type='artist'
--        사업자   = account_type='business'
--        일반     = 그 외(individual/NULL/기타 기본값)
--      ※ users.role 은 user/admin 뿐이라 구분 불가 → account_type 을 진실로 사용.
--
--   ② 결제 현황 (우선순위 CASE, 정확한 파티션):
--        유료   = 활성 유료 구독 보유(subscriptions.status in active/cancel_scheduled)
--        미결제 = 유료가 아니고, subscription_type 이 유료형(individual/business/personal)
--                 인데 결제 완료 이력이 전혀 없음(payment_orders.status='paid' 부재)
--                 = 유료 플랜을 시작했으나 한 번도 결제 완료되지 않음
--        무료   = 나머지(무료 플랜 가입자)
--
--   ③ 플랜별 가입자 (도넛; 미결제 제외):
--        무료   = 결제=무료
--        사업자 = 결제=유료 AND membership_tier='business'
--        일반   = 결제=유료 AND membership_tier<>'business'
--        (무료+일반+사업자 = 총 - 미결제)
--
--   ④ 회원 상태 (우선순위 CASE, 정확한 파티션):
--        탈퇴        = withdrawn_at is not null
--        정지        = disabled_at is not null
--        이메일미인증 = auth.users.email_confirmed_at is null
--        활성        = 나머지
--      ※ 휴면(dormant) 상태 모델은 스키마에 없음 → has_dormant_model=false 로
--        보고하고 UI 에서 자동 제외.
--
-- 정합성(설계상 항상 성립):
--   총 = 일반+사업자+아티스트 = 유료+무료+미결제 = 활성+이메일미인증+정지+탈퇴
--   각 파티션은 회원당 정확히 하나의 버킷을 부여하는 CASE 로 구성되므로
--   합계는 구조적으로 총 회원과 일치한다. UI 는 이를 런타임 재검증한다.
-- ============================================

create or replace function public.admin_member_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  -- 관리자 가드 (admin_dashboard_stats 와 동일 패턴)
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  with base as (
    select
      u.id,
      -- ① 구분
      case
        when u.account_type = 'artist'   then 'artist'
        when u.account_type = 'business' then 'business'
        else 'general'
      end as seg,
      coalesce(u.subscription_type, '') as sub_type,
      coalesce(u.membership_tier, 'free') as tier,
      u.withdrawn_at,
      u.disabled_at,
      exists (
        select 1 from public.subscriptions s
        where s.user_id = u.id and s.status in ('active', 'cancel_scheduled')
      ) as has_active_paid,
      exists (
        select 1 from public.payment_orders p
        where p.user_id = u.id and (p.status = 'paid' or p.paid_at is not null)
      ) as has_paid_order,
      (au.email_confirmed_at is null) as email_unverified
    from public.users u
    left join auth.users au on au.id = u.id
    where coalesce(u.role, 'user') <> 'admin'
  ),
  classified as (
    select
      seg,
      tier,
      -- ② 결제 (우선순위: 유료 > 미결제 > 무료)
      case
        when has_active_paid then 'paid'
        when sub_type in ('individual', 'business', 'personal') and not has_paid_order then 'unpaid'
        else 'free'
      end as pay,
      -- ④ 상태 (우선순위: 탈퇴 > 정지 > 이메일미인증 > 활성)
      case
        when withdrawn_at is not null then 'withdrawn'
        when disabled_at is not null then 'disabled'
        when email_unverified then 'email_unverified'
        else 'active'
      end as status
    from base
  )
  select jsonb_build_object(
    'total_members', count(*),
    -- ① 회원 구분
    'member_general',  count(*) filter (where seg = 'general'),
    'member_business', count(*) filter (where seg = 'business'),
    'member_artist',   count(*) filter (where seg = 'artist'),
    -- ② 결제 현황
    'paid_users',   count(*) filter (where pay = 'paid'),
    'free_users',   count(*) filter (where pay = 'free'),
    'unpaid_users', count(*) filter (where pay = 'unpaid'),
    -- ③ 플랜별 가입자 (미결제 제외)
    'plan_free',       count(*) filter (where pay = 'free'),
    'plan_individual', count(*) filter (where pay = 'paid' and tier <> 'business'),
    'plan_business',   count(*) filter (where pay = 'paid' and tier = 'business'),
    -- ④ 회원 상태
    'status_active',           count(*) filter (where status = 'active'),
    'status_email_unverified', count(*) filter (where status = 'email_unverified'),
    'status_disabled',         count(*) filter (where status = 'disabled'),
    'status_withdrawn',        count(*) filter (where status = 'withdrawn'),
    'has_dormant_model', false,
    'generated_at', now()
  )
  into v_result
  from classified;

  return coalesce(v_result, jsonb_build_object(
    'total_members', 0,
    'member_general', 0, 'member_business', 0, 'member_artist', 0,
    'paid_users', 0, 'free_users', 0, 'unpaid_users', 0,
    'plan_free', 0, 'plan_individual', 0, 'plan_business', 0,
    'status_active', 0, 'status_email_unverified', 0, 'status_disabled', 0, 'status_withdrawn', 0,
    'has_dormant_model', false,
    'generated_at', now()
  ));
end;
$$;

grant execute on function public.admin_member_stats() to authenticated;
