-- 0122 — admin_mask_user_pii 스키마 정합성 수정 (기존 버그 수정, 비파괴)
--   버그1: artist_profiles.real_name/phone/address 가 NOT NULL 인데 null 대입 → 23502 로 마스킹 전체 실패(아티스트 전원).
--   버그2: business_profiles 에 없는 컬럼(business_name/phone/address) 참조 → 런타임 에러.
--   조치: NOT NULL 컬럼은 placeholder/빈문자열로 마스킹, 존재하는 PII 컬럼만 갱신.
--   정산/식별자 보존: artist_profiles.artist_name·email, business_verification_profiles.business_number.
create or replace function public.admin_mask_user_pii(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_anon_nick text;
begin
  if not _internal_is_admin_caller() then raise exception 'admin only'; end if;
  perform public._admin_user_action_guards(p_user_id);

  if exists (select 1 from public.users where id = p_user_id and pii_masked_at is not null) then
    raise exception 'already masked: 이미 PII 마스킹 처리된 사용자에요.';
  end if;

  v_anon_nick := '탈퇴회원_' || substr(p_user_id::text, 1, 8);

  update public.users
    set nickname = v_anon_nick, full_name = null, phone = null, address = null,
        birth_date = null, identity_ci = null, identity_di = null,
        business_category = null, pii_masked_at = now()
    where id = p_user_id;

  -- artist_profiles: NOT NULL 컬럼은 placeholder/빈문자열로. 정산 식별자(artist_name, email)는 보존.
  update public.artist_profiles
    set real_name = '탈퇴회원', phone = '', address = '', birth_date = '1900-01-01'::date
    where user_id = p_user_id;

  -- business_profiles: 실제 PII 는 store_name (nullable) 뿐.
  update public.business_profiles
    set store_name = null
    where user_id = p_user_id;

  -- business_verification_profiles: 대표자/주소 PII 마스킹. 사업자번호(business_number)는 식별자로 보존.
  update public.business_verification_profiles
    set representative_name = null, business_address = null, store_address = null
    where user_id = p_user_id;

  begin
    perform admin_log_operation('admin_member_actions', 'member', 'warning', 'completed',
      format('mask PII user %s', p_user_id),
      jsonb_build_object('user_id', p_user_id, 'anon_nickname', v_anon_nick),
      p_user_id, p_user_id::text, null, null, null);
  exception when others then null; end;

  return jsonb_build_object('ok', true, 'anon_nickname', v_anon_nick);
end; $function$;
