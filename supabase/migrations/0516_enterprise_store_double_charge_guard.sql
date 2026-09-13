-- 0516 — 이미 결제 중인 가맹매장에 추가 결제를 요구하지 않는다
--
-- 사례: 카공시대 화정점 (박소선, 2026-08-31 결제)
--
-- 무슨 일이 있었나:
--   화정점은 일반 매장 가입 경로로 먼저 가입해서 월 4,900원을 내고 있다.
--     subscriptions   plan_type=individual, 4,900원, active, rebill 262420000028
--     payment_orders  swk_3caef236_... paid (2026-08-31)
--   그 뒤 카공시대 본사가 가맹 개별청구(per_store, 4,900원)를 켰다.
--
--   get_my_enterprise_payment_context 는 "엔터프라이즈 구독이 있느냐" 만 본다.
--   화정점은 엔터프라이즈 구독이 없으니 should_pay=true —
--   **이미 4,900원을 내고 있는 매장에 4,900원을 또 결제하라고 요구**한다.
--   눌렀으면 월 9,800원이 나갔다.
--
-- 왜 이렇게 고치나:
--   화정점에 가짜 엔터프라이즈 구독 행을 만들어 붙이는 방법도 있지만,
--   그러면 매달 자동청구 웹훅이 코어 경로로만 들어와 엔터프라이즈 구독의
--   current_period_end 가 갱신되지 않는다 → enterprise_billing_gaps 가
--   매달 "연체" 로 오탐한다. 원장을 억지로 맞추는 대신 판정을 고친다.
--
--   판정 기준: 결제주체가 누구든, 매장이 이미 가맹요금 이상을 내고 있고
--   그 기간이 살아 있으면 추가 결제 대상이 아니다.
--
-- 이 마이그레이션이 하는 일:
--   get_my_enterprise_payment_context() 에 코어 구독 커버리지 판정을 추가하고,
--   무엇이 결제를 커버하는지 covered_by 로 드러낸다.
--   (2026-09-06 prod 정의 기준, 그 외 로직은 그대로)

create or replace function public.get_my_enterprise_payment_context()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_uid uuid := auth.uid();
  v_ea_id uuid;
  v_ea_name text;
  v_enabled boolean;
  v_mode text;
  v_amount integer;
  v_payer text;
  v_store_id uuid;
  v_active boolean;
  v_core_covered boolean := false;
  v_covered_by text;
begin
  if v_uid is null then return jsonb_build_object('should_pay', false); end if;

  select ea.id, ea.enterprise_name, ea.billing_enabled, ea.billing_mode, ea.hq_monthly_price
    into v_ea_id, v_ea_name, v_enabled, v_mode, v_amount
    from public.enterprise_accounts ea
   where ea.auth_user_id = v_uid and ea.deleted_at is null and ea.status in ('active','invited')
   limit 1;

  if v_ea_id is not null and v_enabled and v_mode = 'hq_consolidated' then
    v_payer := 'hq'; v_store_id := null;
  else
    select fs.id, ea2.id, ea2.enterprise_name, ea2.billing_enabled, ea2.billing_mode, ea2.store_monthly_price
      into v_store_id, v_ea_id, v_ea_name, v_enabled, v_mode, v_amount
      from public.users u
      join public.franchise_stores fs on fs.store_id = u.id and fs.status='active'
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
      join public.enterprise_accounts ea2 on ea2.id = ef.enterprise_account_id and ea2.deleted_at is null
     where u.id = v_uid and coalesce(u.account_type,'individual')='business'
     order by case ef.role when 'primary' then 0 else 1 end nulls last
     limit 1;
    if v_ea_id is not null and v_enabled and v_mode = 'per_store' then
      v_payer := 'store';
    else
      return jsonb_build_object('should_pay', false);
    end if;
  end if;

  if coalesce(v_amount,0) <= 0 then return jsonb_build_object('should_pay', false); end if;

  select exists (
    select 1 from public.enterprise_payment_subscriptions s
     where s.payer_user_id = v_uid
       and s.enterprise_account_id = v_ea_id
       and s.payer_type = v_payer
       and s.status in ('active','payment_waiting')
  ) into v_active;

  -- 0516: 엔터프라이즈 구독이 없어도, 일반 결제 경로로 이미 가맹요금 이상을
  --       내고 있고 그 기간이 살아 있으면 추가 결제 대상이 아니다.
  --       (cancel_scheduled 도 기간이 남아 있는 동안은 커버로 본다.
  --        기간이 끝나면 자연히 should_pay=true 로 돌아온다.)
  if not v_active then
    select exists (
      select 1 from public.subscriptions s
       where s.user_id = v_uid
         and s.status in ('active','payment_waiting','cancel_scheduled')
         and coalesce(s.current_period_end, now()) > now()
         and coalesce(s.price, 0) >= v_amount
    ) into v_core_covered;
  end if;

  v_covered_by := case
    when v_active then 'enterprise_subscription'
    when v_core_covered then 'core_subscription'
    else null
  end;

  return jsonb_build_object(
    'should_pay', not (v_active or v_core_covered),
    'already_active', v_active or v_core_covered,
    'covered_by', v_covered_by,
    'payer_type', v_payer,
    'amount', v_amount,
    'enterprise_account_id', v_ea_id,
    'enterprise_name', v_ea_name,
    'franchise_store_id', v_store_id
  );
end;
$fn$;

comment on function public.get_my_enterprise_payment_context() is
  '엔터프라이즈 결제 대상/금액 판정. 코어 구독으로 이미 커버된 매장은 제외(0516).';

revoke execute on function public.get_my_enterprise_payment_context() from public, anon;
grant  execute on function public.get_my_enterprise_payment_context() to authenticated, service_role;
