-- 0118 — 아티스트 승인 상태 동기화 오류 + 계약서 자동 발행 실패 긴급 수정 (additive only)
--   SOURCE OF TRUTH = artist_profiles.approval_status. users.* 는 캐시/미러.
--   기존 컬럼/타입/enum/데이터 변경 없음. RPC 동작만 source-of-truth 기준으로 정정 + 신규 동기화 RPC 추가.

-- 신규 RPC: 관리자/서비스 롤 전용. approved 프로필 기준으로만 users 를 동기화 (임의 승인 상승 방지).
create or replace function public.sync_artist_approval_state(p_user_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare
  v_is_admin boolean := exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin');
  v_is_service boolean := coalesce(auth.role() = 'service_role', false)
                       or coalesce(current_setting('request.jwt.claim.role', true) = 'service_role', false);
  v_profile_approval text;
  v_before jsonb; v_after jsonb; v_changed text[] := '{}';
  v_before_approval text; v_before_acct text;
begin
  if not (v_is_admin or v_is_service) then raise exception 'admin only'; end if;

  select ap.approval_status into v_profile_approval from public.artist_profiles ap where ap.user_id = p_user_id;
  select u.artist_approval_status, u.account_type into v_before_approval, v_before_acct
    from public.users u where u.id = p_user_id;
  if v_before_acct is null and v_before_approval is null then raise exception 'user not found'; end if;

  v_before := jsonb_build_object('artist_approval_status', v_before_approval, 'account_type', v_before_acct,
                                 'profile_approval', v_profile_approval);

  -- profile 이 approved 일 때만 users 를 approved/artist 로 동기화 (임의 승인 상승 방지)
  if coalesce(v_profile_approval,'') = 'approved' then
    if coalesce(v_before_approval,'pending') <> 'approved' then
      update public.users set artist_approval_status = 'approved' where id = p_user_id;
      v_changed := array_append(v_changed, 'artist_approval_status');
    end if;
    if coalesce(v_before_acct,'') <> 'artist' then
      update public.users set account_type = 'artist' where id = p_user_id;
      v_changed := array_append(v_changed, 'account_type');
    end if;
  end if;

  select jsonb_build_object('artist_approval_status', u.artist_approval_status, 'account_type', u.account_type,
                            'profile_approval', v_profile_approval)
    into v_after from public.users u where u.id = p_user_id;

  return jsonb_build_object('ok', true, 'user_id', p_user_id, 'before_state', v_before,
                            'after_state', v_after, 'changed_columns', v_changed);
end; $function$;
grant execute on function public.sync_artist_approval_state(uuid) to authenticated;

-- 계약서 발행 RPC: SOURCE OF TRUTH = artist_profiles.approval_status.
--   profile approved → users 불일치 시 자동 복구 후 진행 (approval_sync_broken 으로 막지 않음).
--   profile 이 실제로 approved 가 아닐 때만 실패.
create or replace function public.ensure_artist_contract_for_user()
returns uuid language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_users_approval text;
  v_profile_approval text;
  v_tier text;
  v_template_version text; v_template_title text; v_template_body text;
  v_existing_id uuid; v_new_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select u.account_type, u.artist_approval_status, u.membership_tier
    into v_account_type, v_users_approval, v_tier
  from public.users u where u.id = v_uid;
  if v_account_type is null then raise exception 'user not found'; end if;

  select ap.approval_status into v_profile_approval
  from public.artist_profiles ap where ap.user_id = v_uid;

  -- source of truth = artist_profiles.approval_status
  if coalesce(v_profile_approval,'') <> 'approved' then
    raise exception 'not approved (profile=%)', coalesce(v_profile_approval, 'none');
  end if;

  -- profile approved → account_type/approval 불일치면 자동 복구 (approval_sync_broken 으로 막지 않음)
  if coalesce(v_account_type,'') <> 'artist' then
    update public.users set account_type = 'artist' where id = v_uid;
    v_account_type := 'artist';
  end if;
  if coalesce(v_users_approval,'pending') <> 'approved' then
    update public.users set artist_approval_status = 'approved' where id = v_uid;
    v_users_approval := 'approved';
  end if;

  if coalesce(v_tier, 'free') <> 'individual' then
    raise exception 'not paid (tier=%)', coalesce(v_tier,'free');
  end if;

  select c.id into v_existing_id from public.artist_contracts c
  where c.artist_user_id = v_uid and c.status in ('pending_signature','signed')
  order by c.created_at desc limit 1;
  if v_existing_id is not null then return v_existing_id; end if;

  select tpl.version, tpl.title, tpl.body into v_template_version, v_template_title, v_template_body
  from public.contract_templates tpl where tpl.is_active = true limit 1;
  if v_template_version is null then
    raise exception 'no active contract template — admin must seed via admin_seed_contract_template';
  end if;

  insert into public.artist_contracts (
    artist_user_id, contract_version, contract_title, contract_body,
    status, pending_signature_at, created_by
  ) values (
    v_uid, v_template_version, v_template_title, v_template_body,
    'pending_signature', now(), v_uid
  ) returning id into v_new_id;

  update public.users
    set contract_status = case when contract_status = 'signed' then 'signed' else 'pending_signature' end
  where id = v_uid;

  return v_new_id;
end; $function$;
