-- 정기결제 소급/즉시 청구 디스패처를 DB 레벨에서 멈춘다.
--
-- 왜:
--   세 디스패처(dispatch-subscription-rebill, dispatch-rebill-catchup,
--   dispatch-enterprise-rebill-catchup)는 PayApp 에 cmd=rebillPay 를 보낸다.
--   그런데 PayApp 공식 문서에 rebillPay 라는 cmd 는 없다. 실측으로도 전건
--   errno=70040 "cmd 값을 확인 하세요." 로 거절됐다(2026-11-01, 47건 전건).
--   등록된 rebill_no 에 임의 시점·임의 금액으로 결제를 일으키는 API 자체가
--   PayApp 에 없다 — 정기결제 회차는 PayApp 이 스스로 돌린다.
--   즉 이 경로는 고칠 수 있는 게 아니라 전제가 틀렸다.
--
-- 왜 여기서 막는가:
--   세 디스패처가 전부 청구 직전에 이 두 함수를 거친다. 엣지 함수 3개(약 900줄)를
--   각각 재배포하는 것보다 한 곳에서 막는 게 확실하고, 누락이 없다.
--   엣지 쪽 Kill Switch(BILLING_REBILL_ENABLED)는 시크릿이라 누가 켜면 그만이지만
--   이 가드는 코드에 남는다.
--
-- 되살리려면: admin_settings 의 billing_rebill_dispatch_enabled 를 true 로.
--   단 그 전에 PayApp 에서 올바른 청구 수단을 확인해야 한다(docs/PAYMENT.md).
--
-- 적용 기록: 원격에 disable_rebill_dispatch 로 적용 완료.
--   검증: dispatch-rebill-catchup 을 dry_run=false 로 1건 호출 →
--         attempted=1 / accepted=0 / rejected=0, 청구 기록 0행, PayApp 미호출.

insert into public.admin_settings (key, value)
values ('billing_rebill_dispatch_enabled', 'false'::jsonb)
on conflict (key) do nothing;

create or replace function public._rebill_dispatch_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 값이 없으면 비활성(fail-closed). 켜는 건 명시적 행위여야 한다.
  select coalesce(
    (select (trim(both '"' from (value::text)))::boolean
       from public.admin_settings
      where key = 'billing_rebill_dispatch_enabled'),
    false);
$function$;

CREATE OR REPLACE FUNCTION public.record_rebill_charge_attempt(
  p_subscription_id uuid, p_user_id uuid, p_rebill_no text, p_amount integer,
  p_plan_type text, p_cycle_period_end timestamp with time zone,
  p_order_no text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if not public._rebill_dispatch_enabled() then
    raise exception 'rebill dispatch disabled: PayApp 에 rebillPay cmd 가 없어 이 청구 경로는 폐기됐다. docs/PAYMENT.md 참고. 되살리려면 admin_settings.billing_rebill_dispatch_enabled 를 true 로 두되, 먼저 PayApp 에서 올바른 청구 수단을 확인할 것.';
  end if;
  insert into public.subscription_rebill_charges
    (subscription_id, user_id, rebill_no, order_no, amount, plan_type, cycle_period_end, status)
  values
    (p_subscription_id, p_user_id, p_rebill_no, p_order_no, p_amount, p_plan_type, p_cycle_period_end, 'attempted')
  on conflict (subscription_id, cycle_period_end) do nothing
  returning id into v_id;
  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.record_enterprise_rebill_charge_attempt(
  p_subscription_id uuid, p_payer_user_id uuid, p_rebill_no text, p_amount integer,
  p_cycle_period_end timestamp with time zone,
  p_order_no text DEFAULT NULL::text, p_execution_id text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare v_id uuid;
begin
  if not public._rebill_dispatch_enabled() then
    raise exception 'rebill dispatch disabled: PayApp 에 rebillPay cmd 가 없어 이 청구 경로는 폐기됐다. docs/PAYMENT.md 참고. 되살리려면 admin_settings.billing_rebill_dispatch_enabled 를 true 로 두되, 먼저 PayApp 에서 올바른 청구 수단을 확인할 것.';
  end if;
  insert into public.enterprise_rebill_charges(
    subscription_id, payer_user_id, rebill_no, amount, cycle_period_end, order_no, execution_id, status)
  values (p_subscription_id, p_payer_user_id, p_rebill_no, p_amount, p_cycle_period_end,
          p_order_no, p_execution_id, 'attempted')
  on conflict (subscription_id, cycle_period_end) do nothing
  returning id into v_id;
  return v_id;
end;
$function$;
