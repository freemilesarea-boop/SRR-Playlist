-- ============================================================================
-- 0502_pricing_self_serve_signup.sql
-- Phase PRICING-SELF-SERVE-1
--
-- 배경: 매장 점주님들이 "일반 회원"으로 가입해 버려서, 가입 이후에는 결제 화면을
--   찾을 수가 없다(결제 진입점이 회원가입 플로우 안에만 있었다). 좌측 네비게이터에
--   "요금제" 카테고리를 만들고, 가입 유형과 무관하게 언제든 아래 3가지로 결제/가입할
--   수 있게 한다.
--
--     1) 매장 가입            — 기존 business 플랜(월 6,900원) 즉시 정기결제
--     2) 엔터프라이즈 본사    — 사업자 인증 → 본사 계정이 우리 DB 에 즉시 생성(승인 대기)
--                               + 가맹점 초대용 "본사 코드" 즉시 발급
--     3) 엔터프라이즈 가맹    — 본사 코드로만 가입 가능 → 매장 연결 → 정기결제
--
-- (1) 은 서버 변경이 전혀 필요 없다. 기존 create-payapp-subscription(plan_type='business')
--     경로를 그대로 쓴다. 이 마이그레이션은 (2)(3) 과 요금제 화면용 조회만 추가한다.
--
-- ⚠ 불변식 (절대 건드리지 않음):
--   • subscriptions / payment_orders / users.membership_tier 의 기존 행 무변경
--   • artist_has_paid_access / get_artist_upload_eligibility / 업로드 RLS 무관
--   • _internal_apply_payapp_event(일반 구독 웹훅) 무관
--   • claim_enterprise_store_account(0490) / validate_enterprise_invite(0480) 본문 무변경
--     → 신규 RPC 가 "그대로 호출"만 한다.
--
-- 유일한 기존 함수 재정의: _apply_enterprise_payapp_event (0472).
--   prod 정의를 그대로 옮긴 뒤 "결제 성공 시 매장 스트리밍 권한 부여" 한 줄만 추가.
--   근거: 엔터프라이즈 결제는 지금까지 한 번도 실행된 적이 없다
--        (enterprise_payment_subscriptions / _orders / _webhook_events 전부 0행).
--        그동안은 결제해도 membership_tier 가 올라가지 않아 매장 재생이 안 되는 상태였다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 사업자등록번호 체크섬 (KS X 1003) — 서버 권위 검증
--    프론트 businessVerification.ts 와 동일 알고리즘. 클라이언트 값 신뢰 금지.
-- ----------------------------------------------------------------------------
create or replace function public._kr_business_number_valid(p_input text)
returns boolean
language plpgsql
immutable
set search_path to 'public'
as $$
declare
  v_digits text := regexp_replace(coalesce(p_input, ''), '\D', '', 'g');
  v_weights int[] := array[1,3,7,1,3,7,1,3,5];
  v_sum int := 0;
  i int;
begin
  if length(v_digits) <> 10 then return false; end if;
  if v_digits = '0000000000' then return false; end if;   -- 체크섬을 통과해버리는 예외값
  for i in 1..9 loop
    v_sum := v_sum + (substr(v_digits, i, 1))::int * v_weights[i];
  end loop;
  v_sum := v_sum + floor((substr(v_digits, 9, 1))::int * 5 / 10)::int;
  return ((10 - (v_sum % 10)) % 10) = (substr(v_digits, 10, 1))::int;
end;
$$;
comment on function public._kr_business_number_valid(text) is
  '0502 — 사업자등록번호 10자리 체크섬 검증(서버 권위). 국세청 실 조회는 verify-business-number 엣지함수.';

-- ----------------------------------------------------------------------------
-- 2) 초대 코드 발번 — 혼동 문자(0/O/1/I) 제외, 기존 3개 코드 컬럼 전체와 충돌 회피
-- ----------------------------------------------------------------------------
create or replace function public._gen_enterprise_join_code(p_prefix text)
returns text
language plpgsql
volatile
set search_path to 'public'
as $$
declare
  v_alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_prefix text := upper(btrim(coalesce(p_prefix, 'DD')));
  v_code text;
  v_try int := 0;
  i int;
begin
  loop
    v_try := v_try + 1;
    v_code := v_prefix || '-';
    for i in 1..6 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;

    if not exists (
      select 1 from public.enterprise_accounts ea
       where upper(btrim(coalesce(ea.store_invite_code, ''))) = v_code
          or upper(btrim(coalesce(ea.hq_invite_code, ''))) = v_code
          or upper(btrim(coalesce(ea.brand_code, ''))) = v_code
    ) then
      return v_code;
    end if;

    if v_try >= 40 then
      raise exception '초대 코드 발급에 실패했습니다. 다시 시도해주세요.';
    end if;
  end loop;
end;
$$;

-- ----------------------------------------------------------------------------
-- 3) 매장 요금(정액) 단일 진실 원천 — subscription_plans.business 가격을 그대로 사용.
--    새 가격을 발명하지 않는다. 관리자가 플랜 가격을 바꾸면 자동으로 따라간다.
-- ----------------------------------------------------------------------------
create or replace function public._default_store_monthly_price()
returns integer
language sql
stable
set search_path to 'public'
as $$
  select coalesce(
    (select p.price from public.subscription_plans p
      where p.plan_type = 'business' and p.is_active = true limit 1),
    6900
  );
$$;

-- ----------------------------------------------------------------------------
-- 4) 엔터프라이즈 본사 — 셀프 신청
--    사업자 인증(verify-business-number 엣지함수)이 선행되어야 한다.
--    성공 시: enterprise_accounts(status='invited') 즉시 생성 → 관리자 화면에 바로 노출.
--             본사 코드(store_invite_code) 즉시 발급 → 가맹점이 그 코드로만 가입 가능.
-- ----------------------------------------------------------------------------
create or replace function public.apply_enterprise_hq_selfserve(
  p_enterprise_name text,
  p_business_number text,
  p_business_name text,
  p_representative_name text,
  p_business_open_date date,
  p_business_address text default null,
  p_manager_name text default null,
  p_manager_phone text default null,
  p_billing_mode text default 'per_store'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.users;
  v_email text;
  v_name text := btrim(coalesce(p_enterprise_name, ''));
  v_digits text := regexp_replace(coalesce(p_business_number, ''), '\D', '', 'g');
  v_mode text := lower(btrim(coalesce(p_billing_mode, 'per_store')));
  v_bvp public.business_verification_profiles;
  v_ea public.enterprise_accounts;
  v_store_code text;
  v_hq_code text;
  v_price int := public._default_store_monthly_price();
  v_manager_name text;
  v_manager_phone text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if v_mode not in ('per_store', 'hq_consolidated') then raise exception 'invalid billing_mode'; end if;
  if v_name = '' then raise exception '본사(브랜드)명을 입력해주세요.'; end if;

  select * into v_user from public.users where id = v_uid;
  if v_user.id is null then
    raise exception '회원 정보를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.';
  end if;
  if v_user.withdrawn_at is not null then raise exception 'user withdrawn'; end if;

  select au.email into v_email from auth.users au where au.id = v_uid;
  if coalesce(btrim(v_email), '') = '' then
    raise exception '계정 이메일을 확인할 수 없습니다. 고객센터로 문의해주세요.';
  end if;

  -- (a) 이미 본사 계정이 있으면 멱등 반환 (중복 신청 방지)
  select * into v_ea
    from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null
   order by created_at
   limit 1;
  if v_ea.id is not null then
    return jsonb_build_object(
      'success', true, 'already_exists', true,
      'enterprise_account_id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
      'status', v_ea.status, 'join_code', v_ea.store_invite_code,
      'billing_mode', v_ea.billing_mode, 'billing_enabled', v_ea.billing_enabled,
      'store_monthly_price', v_ea.store_monthly_price
    );
  end if;

  -- (b) 사업자 인증 선행 확인 — 값은 verify-business-number 엣지함수만 기록한다
  if not public._kr_business_number_valid(v_digits) then
    raise exception '사업자등록번호가 올바르지 않습니다.';
  end if;
  select * into v_bvp from public.business_verification_profiles where user_id = v_uid;
  if v_bvp.user_id is null
     or regexp_replace(coalesce(v_bvp.business_number, ''), '\D', '', 'g') <> v_digits
     or v_bvp.verification_status not in ('verified', 'manual_review') then
    raise exception '사업자 인증을 먼저 완료해주세요.';
  end if;

  -- (c) 같은 이름의 본사가 이미 있으면 거절 — 브랜드명+코드 기반 가입이 모호해진다
  if exists (
    select 1 from public.enterprise_accounts
     where deleted_at is null and lower(btrim(enterprise_name)) = lower(v_name)
  ) then
    raise exception '이미 등록된 본사명입니다: %. 다른 이름을 쓰시거나 고객센터로 문의해주세요.', v_name;
  end if;

  if exists (
    select 1 from public.enterprise_accounts
     where deleted_at is null and lower(btrim(manager_email)) = lower(btrim(v_email))
  ) then
    raise exception '이 이메일로 등록된 본사 계정이 이미 있습니다. 고객센터로 문의해주세요.';
  end if;

  -- (d) 사업자 프로필 보강 (엣지함수가 못 채운 부가정보만)
  update public.business_verification_profiles
     set business_name        = coalesce(nullif(btrim(coalesce(p_business_name, '')), ''), business_name),
         representative_name  = coalesce(nullif(btrim(coalesce(p_representative_name, '')), ''), representative_name),
         business_open_date   = coalesce(p_business_open_date, business_open_date),
         business_address     = coalesce(nullif(btrim(coalesce(p_business_address, '')), ''), business_address),
         updated_at           = now()
   where user_id = v_uid;

  v_manager_name  := coalesce(nullif(btrim(coalesce(p_manager_name, '')), ''),
                              nullif(btrim(coalesce(v_user.full_name, '')), ''),
                              nullif(btrim(coalesce(v_user.nickname, '')), ''),
                              '담당자');
  v_manager_phone := nullif(btrim(coalesce(p_manager_phone, coalesce(v_user.phone, ''))), '');
  if v_manager_phone is not null and char_length(v_manager_phone) < 8 then
    v_manager_phone := null;   -- enterprise_phone_length CHECK 회피 (전화번호는 선택)
  end if;

  v_store_code := public._gen_enterprise_join_code('DD');
  v_hq_code    := public._gen_enterprise_join_code('HQ');

  -- (e) 본사 계정 생성 — status='invited' (관리자 승인 대기, 관리자 목록에 즉시 노출)
  --     primary franchise 는 0373 AFTER INSERT 트리거가 자동 생성한다.
  insert into public.enterprise_accounts (
    enterprise_name, manager_name, manager_email, manager_phone,
    role, status, auth_user_id, auto_onboarded, onboarding_enabled,
    store_invite_code, hq_invite_code, invite_code_rotated_at,
    billing_enabled, billing_mode, hq_monthly_price, store_monthly_price,
    notes, created_by, updated_by
  ) values (
    v_name, v_manager_name, btrim(v_email), v_manager_phone,
    'enterprise_manager', 'invited', v_uid, true, true,
    v_store_code, v_hq_code, now(),
    -- 가맹 개별청구: 즉시 결제 가능. 본사 일괄청구: 규모별 요금 협의가 필요하므로
    -- 관리자가 admin_set_enterprise_billing_config 로 금액 확정 후 활성화한다.
    (v_mode = 'per_store'), v_mode, null,
    case when v_mode = 'per_store' then v_price else null end,
    format('셀프 신청(요금제 화면) · 사업자번호 %s · 청구방식 %s%s',
           v_digits, v_mode,
           case when v_mode = 'hq_consolidated' then ' · 본사 월요금 협의 필요' else '' end),
    v_uid, v_uid
  )
  returning * into v_ea;

  return jsonb_build_object(
    'success', true, 'already_exists', false,
    'enterprise_account_id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
    'status', v_ea.status, 'join_code', v_ea.store_invite_code,
    'billing_mode', v_ea.billing_mode, 'billing_enabled', v_ea.billing_enabled,
    'store_monthly_price', v_ea.store_monthly_price,
    'awaiting_admin_approval', true
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 본사 코드 조회 — 가맹 가입 1단계(코드만으로 본사 확인)
--    매칭 기준은 0480 validate_enterprise_invite('store') 과 동일:
--    store_invite_code(정확) 또는 brand_code(대소문자 무시).
--    반환값은 화면 표시용 최소 정보만 — 결제/계정 정보 없음.
-- ----------------------------------------------------------------------------
create or replace function public.lookup_enterprise_join_code(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea public.enterprise_accounts;
  v_code text := upper(btrim(coalesce(p_code, '')));
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if v_code = '' then
    return jsonb_build_object('success', false, 'reason', '본사 코드를 입력해주세요.');
  end if;

  select * into v_ea
    from public.enterprise_accounts
   where deleted_at is null
     and onboarding_enabled = true
     and status in ('active', 'invited')
     and (
       upper(btrim(coalesce(store_invite_code, ''))) = v_code
       or (brand_code is not null and upper(btrim(brand_code)) = v_code)
     )
   order by (upper(btrim(coalesce(store_invite_code, ''))) = v_code) desc
   limit 1;

  if v_ea.id is null then
    return jsonb_build_object('success', false, 'reason', '본사 코드가 올바르지 않습니다.');
  end if;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea.id,
    'enterprise_name', v_ea.enterprise_name,
    'billing_mode', v_ea.billing_mode,
    'billing_enabled', v_ea.billing_enabled,
    -- 가맹점이 직접 결제하는 구조인지 + 얼마인지
    'store_pays', (v_ea.billing_enabled and v_ea.billing_mode = 'per_store'),
    'store_monthly_price',
      case when v_ea.billing_enabled and v_ea.billing_mode = 'per_store'
           then v_ea.store_monthly_price else null end
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 엔터프라이즈 가맹 — 본사 코드로 가입
--    기존 claim_enterprise_store_account(0490) 를 그대로 호출한다(본문 무변경).
--    그 함수가 account_type='business' 를 요구하므로, 일반회원(individual/null)만
--    business 로 승격한다. 아티스트 계정은 승격하지 않고 명시적으로 거절한다
--    (account_type='artist' 를 바꾸면 아티스트 대시보드/정산이 깨진다).
-- ----------------------------------------------------------------------------
create or replace function public.join_enterprise_store_by_code(
  p_code text,
  p_store_name text,
  p_region_name text default null,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.users;
  v_lookup jsonb;
  v_ea_name text;
  v_claim jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if btrim(coalesce(p_store_name, '')) = '' then raise exception '매장명을 입력해주세요.'; end if;

  select * into v_user from public.users where id = v_uid;
  if v_user.id is null then
    raise exception '회원 정보를 찾을 수 없습니다. 잠시 후 다시 시도해주세요.';
  end if;
  if v_user.withdrawn_at is not null then raise exception 'user withdrawn'; end if;
  if coalesce(v_user.account_type, 'individual') = 'artist' then
    raise exception '아티스트 계정으로는 가맹 매장 가입을 할 수 없습니다. 매장용 계정으로 가입해주세요.';
  end if;

  v_lookup := public.lookup_enterprise_join_code(p_code);
  if not coalesce((v_lookup->>'success')::boolean, false) then
    return jsonb_build_object('success', false,
                              'reason', coalesce(v_lookup->>'reason', '본사 코드가 올바르지 않습니다.'));
  end if;
  v_ea_name := v_lookup->>'enterprise_name';

  -- 일반회원 → 매장(business) 승격. membership_tier(스트리밍 권한)는 건드리지 않는다.
  if coalesce(v_user.account_type, 'individual') <> 'business' then
    update public.users set account_type = 'business' where id = v_uid;
  end if;

  v_claim := public.claim_enterprise_store_account(
    v_ea_name, p_code, btrim(p_store_name), coalesce(btrim(p_region_name), ''), p_user_agent
  );

  if not coalesce((v_claim->>'success')::boolean, false) then
    return jsonb_build_object('success', false,
                              'reason', coalesce(v_claim->>'reason', '매장 연결에 실패했습니다.'));
  end if;

  return v_claim
    || jsonb_build_object(
         'enterprise_name', v_ea_name,
         'store_pays', coalesce((v_lookup->>'store_pays')::boolean, false),
         'store_monthly_price', (v_lookup->>'store_monthly_price')
       );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) 요금제 화면 컨텍스트 — 화면 1개 = RPC 1개
-- ----------------------------------------------------------------------------
create or replace function public.get_my_pricing_context()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_user public.users;
  v_sub public.subscriptions;
  v_ea public.enterprise_accounts;
  v_bvp public.business_verification_profiles;
  v_store_name text;
  v_store_ea_name text;
  v_ent_pay jsonb;
  v_store_price int := public._default_store_monthly_price();
begin
  if v_uid is null then return jsonb_build_object('signed_in', false); end if;
  select * into v_user from public.users where id = v_uid;

  -- 개인/매장 정기구독 (기존 subscriptions — 판단 기준 변경 없음)
  select * into v_sub
    from public.subscriptions s
   where s.user_id = v_uid
     and s.status in ('active', 'cancel_scheduled')
     and s.refunded_at is null
     and s.current_period_end is not null
     and s.current_period_end > now()
   order by s.current_period_end desc
   limit 1;

  select * into v_ea
    from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null
   order by created_at
   limit 1;

  select fs.store_name, ea2.enterprise_name
    into v_store_name, v_store_ea_name
    from public.franchise_stores fs
    join public.enterprise_franchises ef
      on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
    join public.enterprise_accounts ea2
      on ea2.id = ef.enterprise_account_id and ea2.deleted_at is null
   where fs.store_id = v_uid and fs.status = 'active'
   order by case ef.role when 'primary' then 0 else 1 end nulls last
   limit 1;

  select * into v_bvp from public.business_verification_profiles where user_id = v_uid;

  v_ent_pay := public.get_my_enterprise_payment_context();

  return jsonb_build_object(
    'signed_in', true,
    'account_type', coalesce(v_user.account_type, 'individual'),
    'membership_tier', coalesce(v_user.membership_tier, 'free'),
    'store_monthly_price', v_store_price,
    'subscription', case when v_sub.id is null then null else jsonb_build_object(
      'plan_type', v_sub.plan_type, 'status', v_sub.status, 'price', v_sub.price,
      'current_period_end', v_sub.current_period_end,
      'cancel_requested_at', v_sub.cancel_requested_at
    ) end,
    'hq', case when v_ea.id is null then null else jsonb_build_object(
      'enterprise_account_id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
      'status', v_ea.status, 'join_code', v_ea.store_invite_code,
      'billing_mode', v_ea.billing_mode, 'billing_enabled', v_ea.billing_enabled,
      'store_monthly_price', v_ea.store_monthly_price,
      'hq_monthly_price', v_ea.hq_monthly_price
    ) end,
    'store', case when v_store_name is null then null else jsonb_build_object(
      'store_name', v_store_name, 'enterprise_name', v_store_ea_name
    ) end,
    'business_verification', case when v_bvp.user_id is null then null else jsonb_build_object(
      'verification_status', v_bvp.verification_status,
      'business_verified', v_bvp.business_verified,
      'business_number', v_bvp.business_number,
      'business_name', v_bvp.business_name
    ) end,
    'enterprise_payment', v_ent_pay
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) 엔터프라이즈 결제 성공 → 매장 스트리밍 권한 부여
--    prod 정의(0472)를 그대로 옮기고, 결제 성공 분기 2곳에서
--    _grant_enterprise_store_membership() 호출 한 줄만 추가한다.
-- ----------------------------------------------------------------------------
create or replace function public._grant_enterprise_store_membership(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if p_user_id is null then return; end if;
  -- 승격만 한다(강등 없음). 아티스트 계정은 제외 —
  -- membership_tier 는 아티스트 결제 판정과 얽혀 있어 임의 변경 금지(0499 회귀 이력).
  update public.users
     set membership_tier = 'business'
   where id = p_user_id
     and coalesce(account_type, 'individual') <> 'artist'
     and coalesce(membership_tier, 'free') in ('free', 'individual');
end;
$$;

create or replace function public._apply_enterprise_payapp_event(
  p_order_no text, p_rebill_no text, p_mul_no text, p_pay_state integer,
  p_amount integer, p_raw jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_order public.enterprise_payment_orders; v_sub public.enterprise_payment_subscriptions; v_has_order boolean := false; v_has_sub boolean := false;
begin
  if p_order_no is not null and p_order_no <> '' then select * into v_order from public.enterprise_payment_orders where order_no = p_order_no limit 1; v_has_order := found; end if;
  if not v_has_order and p_rebill_no is not null and p_rebill_no <> '' then
    select * into v_sub from public.enterprise_payment_subscriptions where payapp_rebill_no = p_rebill_no limit 1; v_has_sub := found;
    if not v_has_sub then return jsonb_build_object('ok', false, 'error', 'sub_not_found'); end if;
    if p_pay_state = 64 then
      insert into public.enterprise_payment_orders(subscription_id, enterprise_account_id, payer_user_id, payer_type, order_no, amount, status, payapp_rebill_no, payapp_mul_no, paid_at, raw_response)
      values (v_sub.id, v_sub.enterprise_account_id, v_sub.payer_user_id, v_sub.payer_type, 'entrebill_'||coalesce(p_mul_no, gen_random_uuid()::text), coalesce(nullif(p_amount,0), v_sub.amount), 'paid', p_rebill_no, p_mul_no, now(), p_raw)
      on conflict (order_no) do nothing;
      update public.enterprise_payment_subscriptions set status='active', last_paid_at=now(), current_period_start=now(), current_period_end=now()+interval '1 month' where id = v_sub.id;
      perform public._grant_enterprise_store_membership(v_sub.payer_user_id);   -- 🆕 0502
      return jsonb_build_object('ok', true, 'status', 'rebill_paid', 'subscription_id', v_sub.id);
    end if;
    return jsonb_build_object('ok', true, 'status', 'ignored_rebill_state');
  end if;
  if not v_has_order then return jsonb_build_object('ok', false, 'error', 'order_not_found'); end if;
  if p_amount is not null and p_amount <> 0 and p_amount <> v_order.amount then return jsonb_build_object('ok', false, 'error', 'amount_mismatch'); end if;
  if p_pay_state = 64 then
    if v_order.status <> 'paid' then
      update public.enterprise_payment_orders set status='paid', paid_at=now(), payapp_mul_no=coalesce(p_mul_no, payapp_mul_no), payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no), raw_response=coalesce(p_raw, raw_response) where id = v_order.id;
      update public.enterprise_payment_subscriptions set status='active', payapp_rebill_no=coalesce(p_rebill_no, payapp_rebill_no), last_paid_at=now(), current_period_start=now(), current_period_end=now()+interval '1 month' where id = v_order.subscription_id;
      perform public._grant_enterprise_store_membership(v_order.payer_user_id);  -- 🆕 0502
    end if;
    return jsonb_build_object('ok', true, 'status', 'paid', 'order_id', v_order.id);
  elsif p_pay_state in (8,9,32,70,71) then
    update public.enterprise_payment_orders set status='canceled', payapp_mul_no=coalesce(p_mul_no, payapp_mul_no) where id=v_order.id and status<>'paid';
    update public.enterprise_payment_subscriptions set status='canceled' where id=v_order.subscription_id and status<>'active';
    return jsonb_build_object('ok', true, 'status', 'canceled');
  else
    update public.enterprise_payment_orders set status='waiting' where id=v_order.id and status='requested';
    return jsonb_build_object('ok', true, 'status', 'waiting');
  end if;
end; $$;

-- ----------------------------------------------------------------------------
-- 9) 권한
-- ----------------------------------------------------------------------------
revoke execute on function public._kr_business_number_valid(text) from public, anon;
grant  execute on function public._kr_business_number_valid(text) to authenticated, service_role;

revoke execute on function public._gen_enterprise_join_code(text) from public, anon, authenticated;
grant  execute on function public._gen_enterprise_join_code(text) to service_role;

revoke execute on function public._default_store_monthly_price() from public, anon;
grant  execute on function public._default_store_monthly_price() to authenticated, service_role;

revoke execute on function public.apply_enterprise_hq_selfserve(text, text, text, text, date, text, text, text, text) from public, anon;
grant  execute on function public.apply_enterprise_hq_selfserve(text, text, text, text, date, text, text, text, text) to authenticated, service_role;

revoke execute on function public.lookup_enterprise_join_code(text) from public, anon;
grant  execute on function public.lookup_enterprise_join_code(text) to authenticated, service_role;

revoke execute on function public.join_enterprise_store_by_code(text, text, text, text) from public, anon;
grant  execute on function public.join_enterprise_store_by_code(text, text, text, text) to authenticated, service_role;

revoke execute on function public.get_my_pricing_context() from public, anon;
grant  execute on function public.get_my_pricing_context() to authenticated, service_role;

revoke execute on function public._grant_enterprise_store_membership(uuid) from public, anon, authenticated;
grant  execute on function public._grant_enterprise_store_membership(uuid) to service_role;

revoke execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) from public, anon, authenticated;
grant  execute on function public._apply_enterprise_payapp_event(text, text, text, int, int, jsonb) to service_role;

-- ----------------------------------------------------------------------------
-- 10) 진단 (무해)
-- ----------------------------------------------------------------------------
do $$
declare v_ok boolean;
begin
  -- 체크섬 자체 검증 — 유효한 번호는 true, 잘못된 번호는 false 여야 한다.
  select public._kr_business_number_valid('234-52-00922') into v_ok;
  raise notice '[0502] checksum(valid sample) = % (expected: t)', v_ok;
  select public._kr_business_number_valid('123-45-67890') into v_ok;
  raise notice '[0502] checksum(invalid sample) = % (expected: f)', v_ok;
  raise notice '[0502] default store monthly price = %', public._default_store_monthly_price();
end $$;
