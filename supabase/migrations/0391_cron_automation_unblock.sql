-- 0391 — Cron 자동화 실행 레이어 unblock (Phase 1-1)
--
-- 배경 (운영 감사 K — Critical):
--   정책 자동화 평가(admin_evaluate_policy_automation_rules, 0378) /
--   청구 연체 마킹(admin_mark_enterprise_billing_overdue, 0382) RPC 는
--   _is_super_admin() 게이트로 보호되는데, 0378 설계 주석은
--   "자동 cron 트리거는 향후 Edge Function 에서 admin_evaluate... 를 cron 호출"
--   이라고 명시. 그러나 cron 은 service_role 키로 호출되므로 auth.uid() 가 null →
--   _is_super_admin() = false → 'forbidden' 으로 거부됨. 즉 자동 실행이 불가능했음.
--
-- 수정 (최소 변경, 실행 레이어만 추가):
--   _is_super_admin() 에 "service_role JWT" 분기를 OR 로 1줄 추가한다.
--   - service_role 키는 서버 전용(브라우저 노출 없음)이며 이미 RLS 를 전면 우회하는
--     최상위 권한이므로, admin RPC 호출 허용은 새로운 공격 표면을 만들지 않음.
--   - 정책/청구/정산/알림 "계산 로직" 은 전혀 건드리지 않음 (admin RPC 본문 무수정).
--   - 0378 의 원래 설계(cron → admin_evaluate 호출)를 그대로 완성하는 변경.
--
-- 절대 무수정:
--   - admin_evaluate_policy_automation_rules / admin_mark_enterprise_billing_overdue
--     / dispatch-admin-notifications 본문 및 시그니처 무수정 (재사용만).
--   - 정산/재생/정책 계산, RLS 정책(서비스롤은 이미 우회), 기존 admin 동작 무영향.
--
-- 참고: 실제 cron 실행은 api/cron/enterprise-ops.ts (Vercel Cron) 가
--   service_role 로 위 RPC + dispatch-admin-notifications 를 호출한다.

-- ============================================================
-- 1) _is_super_admin() — service_role 분기 추가 (OR, additive)
-- ============================================================
-- 기존(0349): select exists(... users.id=auth.uid() and role='admin')
-- 신규: + service_role JWT 도 통과 (cron/서버 전용 호출 허용)
create or replace function public._is_super_admin()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
    or coalesce((auth.jwt() ->> 'role'), '') = 'service_role';
$$;

-- ============================================================
-- 2) 대상 admin RPC 를 service_role 에 EXECUTE 부여 (defensive, additive)
-- ============================================================
-- (이미 authenticated 에 grant 되어 있음. service_role 실행을 명시 보장.)
do $$
begin
  begin
    grant execute on function public.admin_evaluate_policy_automation_rules(boolean, timestamptz) to service_role;
  exception when others then raise notice '0391 grant policy_eval to service_role skipped: %', sqlerrm;
  end;
  begin
    grant execute on function public.admin_mark_enterprise_billing_overdue(date) to service_role;
  exception when others then raise notice '0391 grant billing_overdue to service_role skipped: %', sqlerrm;
  end;
end$$;

-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare v_def text;
begin
  select pg_get_functiondef('public._is_super_admin()'::regprocedure) into v_def;
  if position('service_role' in v_def) > 0 then
    raise notice '0391 COMPLETE — _is_super_admin() now accepts service_role (cron-enabled). admin RPC bodies unchanged.';
  else
    raise warning '0391 INCOMPLETE — service_role branch not present in _is_super_admin()';
  end if;
end$$;
