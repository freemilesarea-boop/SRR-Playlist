-- ============================================================================
-- HOTFIX-B ROLLBACK — Store Category Guardrail Activation
-- ============================================================================
-- 도형준 매장의 business_category 를 적용 전 상태(NULL)로 복원.
-- 대상 1건 한정. 다른 유저/데이터/함수 무관.
--
-- 적용 전 값: NULL (2026-07-07 적용 시점 기준)
-- 가드: 현재 값이 '카페' 일 때만 되돌림 (그 사이 수동 변경분 보호)
-- ============================================================================

update public.users
   set business_category = null
 where id = '4aea0cf2-5220-4185-b194-8eef05e70786'
   and account_type = 'business'
   and business_category = '카페'
returning id, account_type, business_category;

-- 확인: business_category is null 기대
select id, account_type, business_category
from public.users
where id = '4aea0cf2-5220-4185-b194-8eef05e70786';
