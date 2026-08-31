-- ============================================================================
-- 0488_drop_course_enrollment.sql
--
-- 수강신청(course enrollment) 기능 제거.
--   0471 에서 추가한 course_products / course_orders /
--   course_payapp_webhook_events 테이블과 관련 RPC 를 삭제한다.
--   (테이블 모두 비어 있음 — 실 신청/결제 없음. 다른 기능과 무관.)
--
-- ⚠️ 되돌리려면 0471 을 다시 적용.
-- ============================================================================

-- RPC 삭제 (시그니처 명시)
drop function if exists public.list_active_course_products();
drop function if exists public.get_my_course_order_status(text);
drop function if exists public.admin_list_course_products();
drop function if exists public.admin_create_course_product(text, text, text, integer, integer, integer);
drop function if exists public.admin_update_course_product(uuid, text, text, text, integer, integer, integer);
drop function if exists public.admin_set_course_product_active(uuid, boolean);
drop function if exists public.admin_delete_course_product(uuid);
drop function if exists public.admin_list_course_enrollments(uuid, int, int);
drop function if exists public._apply_course_payapp_event(text, text, int, int, jsonb);

-- 테이블 삭제 (FK 순서 무관하게 cascade)
drop table if exists public.course_payapp_webhook_events cascade;
drop table if exists public.course_orders cascade;
drop table if exists public.course_products cascade;
