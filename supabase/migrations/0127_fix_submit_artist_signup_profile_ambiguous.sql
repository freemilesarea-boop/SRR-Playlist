-- 0127 — submit_artist_signup_profile "column reference user_id is ambiguous" 버그 수정.
--   원인: RETURNS TABLE 의 OUT 컬럼 user_id 가 on conflict (user_id) 의 테이블 컬럼을 가려 모호성 발생.
--   조치: ON CONFLICT 대신 명시적 UPDATE→INSERT (bare user_id 참조 제거). 시그니처 동일(REPLACE 가능).
create or replace function public.submit_artist_signup_profile(
  p_real_name text, p_birth_date date, p_artist_name text, p_phone text, p_address text, p_email text)
returns table(user_id uuid, status text, artist_profile_id uuid)
language plpgsql security definer set search_path to 'public' as $function$
declare
  v_uid uuid := auth.uid();
  v_ap_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  update public.users u
  set
    account_type = 'artist',
    artist_approval_status = coalesce(u.artist_approval_status, 'pending'),
    full_name = coalesce(nullif(u.full_name, ''), p_real_name),
    birth_date = coalesce(u.birth_date, p_birth_date),
    phone = coalesce(nullif(u.phone, ''), p_phone),
    address = coalesce(nullif(u.address, ''), p_address),
    nickname = coalesce(nullif(u.nickname, ''), p_artist_name),
    signup_completed = true
  where u.id = v_uid;

  insert into public.users (
    id, nickname, account_type, full_name, birth_date, phone, address,
    signup_completed, artist_approval_status
  )
  select v_uid, p_artist_name, 'artist', p_real_name, p_birth_date, p_phone, p_address, true, 'pending'
  where not exists (select 1 from public.users u2 where u2.id = v_uid);

  -- artist_profiles: 명시적 UPDATE → 없으면 INSERT (approval_status 보존)
  update public.artist_profiles ap
  set
    real_name   = coalesce(nullif(ap.real_name, ''),   p_real_name),
    artist_name = coalesce(nullif(ap.artist_name, ''), p_artist_name),
    phone       = coalesce(nullif(ap.phone, ''),       p_phone),
    address     = coalesce(nullif(ap.address, ''),     p_address),
    email       = coalesce(nullif(ap.email, ''),       p_email),
    birth_date  = coalesce(ap.birth_date,              p_birth_date)
  where ap.user_id = v_uid
  returning ap.id into v_ap_id;

  if v_ap_id is null then
    insert into public.artist_profiles (
      user_id, real_name, birth_date, artist_name, phone, address, email, approval_status
    )
    values (v_uid, p_real_name, p_birth_date, p_artist_name, p_phone, p_address, p_email, 'pending')
    returning id into v_ap_id;
  end if;

  begin
    insert into public.signup_debug_events (
      auth_user_id, email, metadata, account_type, artist_name,
      users_upserted, artist_profile_upserted, error_message
    ) values (
      v_uid, p_email, '{}'::jsonb, 'artist', p_artist_name, true, true, 'submit_rpc'
    );
  exception when others then null; end;

  return query select v_uid, 'ok'::text, v_ap_id;
end;
$function$;
