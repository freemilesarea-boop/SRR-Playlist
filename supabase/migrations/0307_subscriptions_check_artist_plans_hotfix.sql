-- 0307 — X6.22 회귀 핫픽스 (X6.23)
--
-- 문제: "PayApp 으로 6,900원 결제하기" 클릭 → "subscription create failed".
--
-- 근본 원인: 0306 에서 subscription_plans.plan_type CHECK 만 확장하고,
-- 실제 INSERT 가 일어나는 4개 테이블의 plan_type CHECK 는 여전히
-- 'individual','business' 만 허용 → artist_general/artist_student INSERT
-- 시 23514 violation → Edge Function 이 "subscription create failed" 반환.
--
-- 영향 받는 테이블:
--   1. subscriptions              — 결제 시 INSERT (실패 위치)
--   2. payment_orders             — 결제 시 INSERT
--   3. payapp_manual_payment_imports — 관리자 수동 import (일관성)
--   4. promotion_codes.target_plan   — 프로모션 코드가 신규 플랜에도 적용 가능
--
-- 4개 모두 subscription_plans 와 동일 매트릭스로 일괄 확장.

alter table public.subscriptions
  drop constraint if exists subscriptions_plan_type_check;
alter table public.subscriptions
  add constraint subscriptions_plan_type_check
  check (plan_type = any (array[
    'individual'::text, 'business'::text,
    'artist_general'::text, 'artist_student'::text
  ]));

alter table public.payment_orders
  drop constraint if exists payment_orders_plan_type_check;
alter table public.payment_orders
  add constraint payment_orders_plan_type_check
  check (plan_type = any (array[
    'individual'::text, 'business'::text,
    'artist_general'::text, 'artist_student'::text
  ]));

alter table public.payapp_manual_payment_imports
  drop constraint if exists payapp_manual_payment_imports_plan_type_check;
alter table public.payapp_manual_payment_imports
  add constraint payapp_manual_payment_imports_plan_type_check
  check (plan_type = any (array[
    'individual'::text, 'business'::text,
    'artist_general'::text, 'artist_student'::text
  ]));

alter table public.promotion_codes
  drop constraint if exists promotion_codes_target_plan_check;
alter table public.promotion_codes
  add constraint promotion_codes_target_plan_check
  check (target_plan = any (array[
    'individual'::text, 'business'::text,
    'artist_general'::text, 'artist_student'::text,
    'all'::text
  ]));
