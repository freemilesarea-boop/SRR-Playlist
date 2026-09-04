-- ============================================================================
-- 0509_hq_selfserve_block_artist.sql
--
-- 엔터프라이즈 본사 셀프 신청에서 아티스트 계정을 서버에서도 거절한다.
--
-- 0502 는 화면(pricingPlans.canApplyHq)에서만 아티스트를 막고 서버 함수에는 검사가
-- 없어서, RPC 를 직접 호출하면 아티스트 계정으로 본사 계정이 만들어질 수 있었다.
-- 가맹 가입(join_enterprise_store_by_code)에는 이미 같은 검사가 있어 규칙이 두 곳에서
-- 어긋나 있던 것을 맞춘다.
--
-- 아티스트로 매장/본사를 하려면 별도 계정을 만들어야 한다 — account_type='artist' 를
-- 바꾸면 아티스트 대시보드와 정산이 깨지고(0499 회귀 이력), 아티스트의 권리(업로드/
-- 유통/정산)를 지키려면 계정을 섞지 않는 편이 안전하다.
--
-- 0502 의 정의를 그대로 옮기고 검사 한 블록만 추가한다. 시그니처/반환 계약 무변경.
-- ============================================================================

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

  -- 🆕 0509 — 아티스트 계정 차단 (join_enterprise_store_by_code 와 동일 규칙).
  -- 0502 에서는 화면(canApplyHq)만 막고 서버는 안 막아, RPC 직접 호출로 우회됐다.
  -- 아티스트 계정의 account_type 을 바꾸면 아티스트 대시보드/정산이 깨지므로(0499 회귀),
  -- 승격하지 않고 명시적으로 거절하고 별도 계정을 안내한다.
  if coalesce(v_user.account_type, 'individual') = 'artist' then
    raise exception '아티스트 계정으로는 본사 신청을 할 수 없습니다. 매장/브랜드용 계정으로 가입해주세요.';
  end if;

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
