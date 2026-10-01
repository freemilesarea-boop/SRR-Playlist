-- 0530_business_verified_trial.sql
--
-- 사업자등록 완료 시 "영업인 코드 없이" 3일 무료체험을 개방한다.
--
-- 배경
--   기존 start_sales_agent_trial 은 _resolve_active_sales_agent(p_code) 가 NULL 이면
--   예외를 던진다 — 즉 유효한 영업인 코드가 반드시 있어야 체험이 시작된다.
--   영업인을 거치지 않고 들어온 사업자 회원에게는 체험을 줄 경로가 아예 없었다.
--
-- 설계
--   · 할인/실적 귀속 없음 — sales_agent_id / sales_agent_code 를 쓰지 않는다.
--     (users.sales_agent_* 도 건드리지 않으므로 요금 할인 경로를 타지 않는다.)
--   · trial_source='business_verified' 로 영업인 체험과 구분한다. 기존 CHECK 는
--     NULL | 'sales_agent' 두 값만 허용했어서, 운영 부여분이 영업인 체험으로
--     섞여 보이는 문제가 있었다. CHECK 를 넓혀 세 번째 값을 허용한다.
--   · 중복 체험 차단 키는 business_verification_profiles.business_number 다.
--     이 값은 엣지함수(verify-business-number)가 계정 간 UNIQUE 로 보장하므로
--     "사업자번호 1개당 체험 1회" 가 실제로 성립한다.
--   · '등록 완료' 의 기준은 verification_status in ('verified','manual_review') 다.
--     NTS_BUSINESS_API_KEY 가 설정된 환경에서만 'verified' 가 찍히고, 미설정이면
--     체크섬만 통과한 'manual_review' 로 남는다. 'verified' 만 조건으로 걸면
--     키가 없는 환경에서 체험이 영원히 열리지 않으므로 둘 다 받는다.
--     'rejected' 는 제외된다.
--   · 가입일(free_trial_config.launched_at) 제한은 적용하지 않는다. 이 체험은
--     가입 시점이 아니라 사업자등록을 조건으로 하는 별개 경로다.

-- ---------------------------------------------------------------- 1) CHECK 확장
do $$
declare v_name text;
begin
  select con.conname into v_name
    from pg_constraint con
   where con.conrelid = 'public.users'::regclass
     and con.contype = 'c'
     and pg_get_constraintdef(con.oid) ilike '%trial_source%'
   limit 1;
  if v_name is not null then
    execute format('alter table public.users drop constraint %I', v_name);
  end if;
end $$;

alter table public.users
  add constraint users_trial_source_check
  check (trial_source is null or trial_source in ('sales_agent', 'business_verified'));

-- -------------------------------------------------- 2) 게이트 상태 (UI 안내용)
create or replace function public.get_business_trial_gate()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_acct text; v_tier text;
  v_started timestamptz; v_ends timestamptz;
  v_reg_status text; v_verified boolean;
  v_paid boolean; v_trial_active boolean; v_registered boolean;
begin
  if v_uid is null then
    return jsonb_build_object(
      'signed_in', false, 'is_business', false, 'registered', false,
      'paid', false, 'trial_active', false, 'trial_used', false,
      'can_start_trial', false, 'reason', 'login_required');
  end if;

  select u.account_type, u.membership_tier::text, u.free_trial_started_at, u.free_trial_ends_at
    into v_acct, v_tier, v_started, v_ends
    from public.users u where u.id = v_uid;

  select bvp.verification_status, bvp.business_verified
    into v_reg_status, v_verified
    from public.business_verification_profiles bvp where bvp.user_id = v_uid;

  v_paid         := v_tier in ('individual', 'business');
  v_trial_active := v_ends is not null and v_ends > now();
  v_registered   := coalesce(v_reg_status, '') in ('verified', 'manual_review');

  return jsonb_build_object(
    'signed_in', true,
    'is_business', coalesce(v_acct, '') = 'business',
    'registered', v_registered,
    'registration_status', coalesce(v_reg_status, 'none'),
    'business_verified', coalesce(v_verified, false),
    'paid', v_paid,
    'trial_active', v_trial_active,
    'trial_used', v_started is not null,
    'free_trial_ends_at', v_ends,
    'can_start_trial', (coalesce(v_acct, '') = 'business'
                        and v_registered and not v_paid and v_started is null),
    'reason', case
      when coalesce(v_acct, '') <> 'business' then 'not_business'
      when v_paid                            then 'already_paid'
      when v_trial_active                    then 'trial_active'
      when v_started is not null             then 'trial_used'
      when not v_registered                  then 'registration_required'
      else 'ok' end);
end;
$function$;

-- ------------------------------------------------------------ 3) 체험 시작 RPC
create or replace function public.start_verified_business_trial()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_acct text; v_tier text; v_started timestamptz; v_found boolean;
  v_reg_status text; v_bn text; v_phone text;
  v_days integer;
  v_now timestamptz := now();
  v_ends timestamptz;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select true, u.account_type, u.membership_tier::text, u.free_trial_started_at,
         public._normalize_phone(u.phone)
    into v_found, v_acct, v_tier, v_started, v_phone
    from public.users u where u.id = v_uid;
  if not coalesce(v_found, false) then
    raise exception 'user not found';
  end if;

  if coalesce(v_acct, '') <> 'business' then
    return jsonb_build_object('ok', false, 'reason', 'not_business',
      'message', '사업자 회원만 무료 체험을 이용할 수 있습니다.');
  end if;
  if v_tier in ('individual', 'business') then
    return jsonb_build_object('ok', false, 'reason', 'already_paid',
      'message', '이미 유료 이용 중입니다.');
  end if;
  if v_started is not null then
    return jsonb_build_object('ok', false, 'reason', 'trial_used',
      'message', '무료 체험은 이미 사용되었습니다.');
  end if;

  select bvp.verification_status, bvp.business_number
    into v_reg_status, v_bn
    from public.business_verification_profiles bvp where bvp.user_id = v_uid;

  if coalesce(v_reg_status, '') not in ('verified', 'manual_review') then
    return jsonb_build_object('ok', false, 'reason', 'registration_required',
      'message', '사업자등록 후 3일 무료 체험이 가능합니다.');
  end if;

  -- 중복 체험 차단 (사업자번호 우선, 연락처 보조)
  if v_bn is not null and exists (
       select 1 from public.free_trial_redemptions r where r.business_number = v_bn) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_business_number',
      'message', '이 사업자등록번호로는 무료 체험이 이미 사용되었습니다.');
  end if;
  if v_phone is not null and exists (
       select 1 from public.free_trial_redemptions r where r.phone = v_phone) then
    return jsonb_build_object('ok', false, 'reason', 'duplicate_phone',
      'message', '이 연락처로는 무료 체험이 이미 사용되었습니다.');
  end if;

  select trial_days into v_days from public.free_trial_config limit 1;
  v_days := coalesce(v_days, 3);
  v_ends := v_now + make_interval(days => v_days);

  update public.users u set
    free_trial_started_at = v_now,
    free_trial_ends_at    = v_ends,
    trial_source          = 'business_verified',
    is_trial_active       = true,
    playback_enabled      = true
  where u.id = v_uid;

  -- 관리자 무료체험 목록(admin_list_free_trials)이 이 테이블을 FROM 으로 읽는다.
  -- 행을 남기지 않으면 운영 화면에서 보이지 않아 연장/회수를 할 수 없다.
  insert into public.free_trial_redemptions
    (user_id, business_number, phone, sales_agent_id, sales_agent_code,
     started_at, ends_at, status)
  values
    (v_uid, v_bn, v_phone, null, null, v_now, v_ends, 'active');

  return jsonb_build_object('ok', true,
    'free_trial_ends_at', v_ends,
    'trial_days', v_days,
    'message', format('사업자등록 확인 — %s일 무료 체험이 시작되었습니다.', v_days));
end;
$function$;

grant execute on function public.get_business_trial_gate() to authenticated;
grant execute on function public.start_verified_business_trial() to authenticated;
