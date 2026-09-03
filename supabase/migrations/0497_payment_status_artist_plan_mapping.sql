-- ============================================================================
-- 0497_payment_status_artist_plan_mapping.sql
--
-- 버그: 아티스트 플랜(artist_general / artist_student)으로 결제하면 결제 성공
--       페이지가 60초 폴링 후 "결제가 아직 반영되지 않았습니다" 로 끝나, 이미
--       정상 결제한 회원에게 다시 결제하라고 안내된다.
--
-- 원인: get_my_payment_status(0046) 의 membership_applied 판정이
--         users.membership_tier = payment_orders.plan_type
--       를 요구한다. users.membership_tier 는 CHECK 상 free/individual/business
--       만 저장 가능해서 아티스트 플랜은 'individual' 로 매핑되는데(0308/0309),
--       주문의 plan_type 은 'artist_student' 그대로다.
--         'individual' = 'artist_student' → false → 영원히 미적용 판정.
--       0046 은 X6.22(아티스트 플랜 도입) 이전 함수라 이 매핑을 모른다.
--
-- 영향: 2026-06-10 이후 아티스트 플랜 결제 53건(회원 47명)이 전부 이 화면을 봤다.
--       실제 권한/구독은 정상 반영됐으므로 결제 자체는 문제 없었고, 중복 결제로
--       이어진 건은 확인되지 않았다(같은 회원의 10일 이내 중복 결제 0건).
--
-- 조치: 판정에 쓰는 plan_type 을 membership_tier 매핑값으로 변환한다.
--       (_internal_apply_payapp_paid_event / admin_force_activate_membership 의
--        v_tier_target 과 동일한 매핑)
--
-- 안전 원칙:
--   • 읽기 전용 판정 함수. 결제/구독/권한 데이터를 변경하지 않는다.
--   • 시그니처 · 반환 컬럼 불변 → 프론트 수정 불필요.
--   • 판정을 느슨하게 만들지 않는다 — status='paid' / 미환불 / tier 유효 조건은 유지.
-- ============================================================================

create or replace function public.get_my_payment_status(p_order_no text)
returns table(
  order_no text,
  status text,
  user_id uuid,
  plan_type text,
  amount integer,
  membership_tier text,
  subscription_type text,
  paid_at timestamptz,
  refunded_at timestamptz,
  membership_applied boolean
)
language plpgsql security definer set search_path = public
as $$
declare
  v_is_admin boolean;
  v_caller uuid := auth.uid();
begin
  if p_order_no is null or length(trim(p_order_no)) = 0 then
    raise exception 'order_no required';
  end if;

  -- admin 또는 service_role 인 경우 user 검증 우회
  begin
    v_is_admin := public._internal_is_admin_caller();
  exception when undefined_function then
    v_is_admin := exists (
      select 1 from public.users as u
      where u.id = v_caller and u.role = 'admin'
    );
  end;

  return query
  select
    po.order_no,
    po.status,
    po.user_id,
    po.plan_type,
    po.amount,
    u.membership_tier,
    u.subscription_type,
    po.paid_at,
    po.refunded_at,
    (
      po.status = 'paid'
      and po.refunded_at is null
      and u.membership_tier in ('individual','business')
      -- 0497: 주문의 plan_type 을 membership_tier 매핑값으로 변환해서 비교.
      --       아티스트 플랜은 tier 'individual' 로 저장되므로 원본 문자열 비교는
      --       항상 false 였다.
      and u.membership_tier = case po.plan_type
            when 'business'       then 'business'
            when 'individual'     then 'individual'
            when 'artist_general' then 'individual'
            when 'artist_student' then 'individual'
            else po.plan_type
          end
    ) as membership_applied
  from public.payment_orders as po
  left join public.users as u on u.id = po.user_id
  where po.order_no = p_order_no
    and (v_is_admin or po.user_id = v_caller);
end;
$$;

grant execute on function public.get_my_payment_status(text) to authenticated;

-- ============================================================================
-- 운영 확인 쿼리 (실행 안 함 — 필요 시 수동 실행)
-- ============================================================================
-- 1) 과거에 '미적용' 으로 잘못 표시됐던 아티스트 플랜 결제 (수정 후 true 여야 함)
-- select po.order_no, po.plan_type, u.membership_tier, po.paid_at,
--        (po.status='paid' and po.refunded_at is null
--         and u.membership_tier in ('individual','business')
--         and u.membership_tier = case po.plan_type
--               when 'business' then 'business' else 'individual' end) as applied_fixed
-- from public.payment_orders po join public.users u on u.id = po.user_id
-- where po.status='paid' and po.plan_type in ('artist_general','artist_student')
-- order by po.paid_at desc;
