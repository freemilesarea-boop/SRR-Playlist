-- ============================================================================
-- 0480_brand_code_store_entry.sql
-- 매장 진입/가입을 '읽기 쉬운 브랜드 코드'로도 가능하게 (예: REFINE, 카공시대).
--
-- 배경: 지금은 암호형 store_invite_code(STORE-XXXX)만 진입 코드로 쓴다. 가맹점주가
--   외우기 어렵다. enterprise_accounts.brand_code(읽기 쉬움, upper(btrim) 기준 유니크)를
--   진입 코드로도 허용해 "카공시대 / REFINE" 처럼 입력하면 되게 한다.
--
-- 정책: 브랜드 코드만(간편). 대소문자·공백 무시. 기존 암호형 코드도 계속 작동(backward-compat).
--   보안: 브랜드 플레이어는 '브랜드 음악 재생'만 가능(결제·계정 정보 없음). 코드가 추측
--   가능해도 노출 위험이 낮다는 판단(사용자 선택).
--
-- 구성:
--   (1) verify_store_code       — 플레이어 진입: store_invite_code(정확) OR brand_code(무시대소문자).
--   (2) validate_enterprise_invite('store') — 매장 가입: store_invite_code OR brand_code.
--   (3) admin_set_enterprise_brand_code     — 기존 본사에 읽기 쉬운 brand_code 설정(관리자).
-- ============================================================================

-- (1) 플레이어 진입 — brand_code 도 허용
create or replace function public.verify_store_code(p_store_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_ea    public.enterprise_accounts%rowtype;
  v_brand public.brand_accounts%rowtype;
  v_token text;
  v_hash  text;
  v_in    text := btrim(coalesce(p_store_code, ''));
begin
  if v_in = '' then
    return jsonb_build_object('success', false, 'error', 'empty_code');
  end if;

  -- 암호형 store_invite_code(정확 매칭) 우선, 없으면 읽기 쉬운 brand_code(대소문자 무시).
  select * into v_ea
    from public.enterprise_accounts
   where deleted_at is null
     and (
       store_invite_code = v_in
       or (brand_code is not null and upper(btrim(brand_code)) = upper(v_in))
     )
   order by (store_invite_code = v_in) desc
   limit 1;
  if not found then
    return jsonb_build_object('success', false, 'error', 'invalid_code');
  end if;

  select * into v_brand
    from public.brand_accounts
   where enterprise_account_id = v_ea.id and deleted_at is null and status = 'active'
   limit 1;
  if not found then
    return jsonb_build_object('success', false, 'error', 'brand_not_linked');
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'hex');
  v_hash  := encode(extensions.digest(v_token::bytea, 'sha256'), 'hex');
  insert into public.brand_player_sessions (brand_id, enterprise_account_id, session_token_hash, user_id, last_seen_at)
  values (v_brand.id, v_ea.id, v_hash, auth.uid(), now());

  perform public._brand_audit(v_brand.id, 'brand.verify_store_ok',
    jsonb_build_object('enterprise_account_id', v_ea.id, 'user', auth.uid()));

  return jsonb_build_object(
    'success', true, 'brand_id', v_brand.id, 'store_label', v_ea.enterprise_name,
    'session_token', v_token, 'expires_at', (now() + interval '30 days'));
end
$function$;

-- (2) 매장 가입 검증 — 'store' 브랜치에서 brand_code 도 허용
create or replace function public.validate_enterprise_invite(p_brand_name text, p_invite_code text, p_claim_type text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_ea public.enterprise_accounts;
  v_norm_name text := lower(btrim(coalesce(p_brand_name, '')));
  v_norm_code text := upper(btrim(coalesce(p_invite_code, '')));
  v_regions jsonb;
begin
  if p_claim_type not in ('hq_admin','store') then raise exception 'invalid claim_type'; end if;
  if v_norm_name = '' or v_norm_code = '' then
    return jsonb_build_object('success', false, 'reason', '브랜드명 또는 초대코드가 올바르지 않습니다.');
  end if;

  if p_claim_type = 'hq_admin' then
    select * into v_ea from public.enterprise_accounts
     where lower(btrim(enterprise_name)) = v_norm_name
       and upper(btrim(hq_invite_code)) = v_norm_code
       and deleted_at is null and onboarding_enabled = true and status in ('active','invited')
     limit 1;
  else
    -- store: 암호형 store_invite_code OR 읽기 쉬운 brand_code (둘 다 대소문자 무시)
    select * into v_ea from public.enterprise_accounts
     where lower(btrim(enterprise_name)) = v_norm_name
       and (
         upper(btrim(store_invite_code)) = v_norm_code
         or (brand_code is not null and upper(btrim(brand_code)) = v_norm_code)
       )
       and deleted_at is null and onboarding_enabled = true and status in ('active','invited')
     limit 1;
  end if;

  if v_ea.id is null then
    return jsonb_build_object('success', false, 'reason', '브랜드명 또는 초대코드가 올바르지 않습니다.');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', r.id, 'region_name', r.region_name, 'region_code', r.region_code
         ) order by r.region_name), '[]'::jsonb)
    into v_regions
    from public.enterprise_regions r
   where r.enterprise_account_id = v_ea.id and r.deleted_at is null and r.status = 'active';

  return jsonb_build_object(
    'success', true, 'enterprise_account_id', v_ea.id, 'enterprise_name', v_ea.enterprise_name,
    'brand_code', v_ea.brand_code, 'claim_type', p_claim_type,
    'allow_self_register_region', v_ea.allow_self_register_region, 'allowed_regions', v_regions);
end
$function$;

-- (3) 관리자: 기존 본사에 읽기 쉬운 brand_code 설정/변경/제거 (super_admin)
create or replace function public.admin_set_enterprise_brand_code(
  p_enterprise_account_id uuid,
  p_brand_code text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_code text; v_name text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_enterprise_account_id is null then raise exception 'enterprise_account_id required'; end if;
  v_code := nullif(btrim(coalesce(p_brand_code, '')), '');

  -- 활성 계정 간 대소문자 무시 유니크(인덱스와 동일 기준) 선검사 → 친절한 에러
  if v_code is not null and exists (
    select 1 from public.enterprise_accounts
     where id <> p_enterprise_account_id and deleted_at is null
       and brand_code is not null and upper(btrim(brand_code)) = upper(v_code)
  ) then
    raise exception '이미 사용 중인 브랜드 코드입니다: %', v_code;
  end if;

  begin
    update public.enterprise_accounts
       set brand_code = v_code, updated_by = v_uid, updated_at = now()
     where id = p_enterprise_account_id and deleted_at is null
     returning enterprise_name into v_name;
  exception when unique_violation then
    raise exception '이미 사용 중인 브랜드 코드입니다: %', v_code;
  end;

  if v_name is null then raise exception 'enterprise account not found'; end if;

  perform public.admin_log_operation(
    'enterprise_accounts', 'enterprise_account.brand_code.set', 'info', 'updated',
    format('브랜드 진입 코드 설정 — %s → %s', v_name, coalesce(v_code, '(제거)')),
    jsonb_build_object('enterprise_account_id', p_enterprise_account_id, 'brand_code', v_code),
    v_uid, p_enterprise_account_id::text, null, null, null);

  return jsonb_build_object('success', true,
    'enterprise_account_id', p_enterprise_account_id, 'brand_code', v_code);
end
$$;
revoke all on function public.admin_set_enterprise_brand_code(uuid, text) from public;
grant execute on function public.admin_set_enterprise_brand_code(uuid, text) to authenticated, service_role;
