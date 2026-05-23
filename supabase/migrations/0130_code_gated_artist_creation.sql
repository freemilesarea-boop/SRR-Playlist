-- 0130 — 아티스트 생성/전환을 초대코드로 게이팅. handle_new_user(가입) + submit RPC(인앱) 둘 다.
-- A) handle_new_user: 항상 비-artist 베이스라인으로 users 생성 → 유효 코드가 있을 때만 artist 승격.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_account_type text := nullif(v_meta->>'account_type', '');
  v_full_name    text := nullif(v_meta->>'full_name', '');
  v_birth_date   date;
  v_phone        text := nullif(v_meta->>'phone', '');
  v_address      text := nullif(v_meta->>'address', '');
  v_artist_name  text := nullif(v_meta->>'artist_name', '');
  v_invite_code  text := nullif(v_meta->>'artist_invite_code', '');
  v_nickname     text := coalesce(nullif(v_meta->>'nickname', ''), v_artist_name, split_part(new.email, '@', 1));
  v_base_type    text;
  v_err          text;
begin
  if v_account_type not in ('individual','business','artist') then v_account_type := 'individual'; end if;
  begin v_birth_date := (nullif(v_meta->>'birth_date',''))::date; exception when others then v_birth_date := null; end;
  v_base_type := case when v_account_type = 'artist' then 'individual' else v_account_type end;

  begin
    insert into public.users (
      id, nickname, account_type, full_name, birth_date, phone, address, signup_completed, artist_approval_status
    ) values (
      new.id, v_nickname, v_base_type, v_full_name, v_birth_date, v_phone, v_address,
      (v_full_name is not null and v_phone is not null and v_address is not null), null
    )
    on conflict (id) do update set
      nickname = coalesce(public.users.nickname, excluded.nickname),
      account_type = case when public.users.account_type = 'artist' then 'artist' else excluded.account_type end,
      full_name = coalesce(public.users.full_name, excluded.full_name),
      birth_date = coalesce(public.users.birth_date, excluded.birth_date),
      phone = coalesce(public.users.phone, excluded.phone),
      address = coalesce(public.users.address, excluded.address),
      signup_completed = public.users.signup_completed or excluded.signup_completed;
  exception when others then v_err := SQLERRM; raise log '[handle_new_user] users upsert FAILED: %', v_err; end;

  if v_account_type = 'artist' and public._consume_artist_invite_code(v_invite_code, new.id) then
    perform set_config('app.artist_grant_ok', '1', true);
    begin
      update public.users set account_type = 'artist',
        artist_approval_status = coalesce(artist_approval_status, 'pending') where id = new.id;
      if v_artist_name is not null then
        insert into public.artist_profiles (
          user_id, real_name, birth_date, artist_name, phone, address, email, approval_status
        ) values (
          new.id, coalesce(v_full_name, v_nickname), coalesce(v_birth_date, '1900-01-01'::date),
          v_artist_name, coalesce(v_phone, ''), coalesce(v_address, ''), new.email, 'pending'
        ) on conflict (user_id) do nothing;
      end if;
    exception when others then v_err := SQLERRM; raise log '[handle_new_user] artist promote FAILED: %', v_err; end;
  end if;

  begin
    insert into public.signup_debug_events (
      auth_user_id, email, metadata, account_type, artist_name,
      users_upserted, artist_profile_upserted, error_message
    ) values (new.id, new.email, v_meta, v_account_type, v_artist_name, true, (v_invite_code is not null), v_err);
  exception when others then null; end;

  return new;
end; $function$;

-- B) 인앱 전환 RPC: 초대코드 필수. 6-arg 폐기 → 7-arg(code) 신규.
drop function if exists public.submit_artist_signup_profile(text, date, text, text, text, text);
create or replace function public.submit_artist_signup_profile(
  p_real_name text, p_birth_date date, p_artist_name text, p_phone text, p_address text, p_email text, p_invite_code text)
returns table(user_id uuid, status text, artist_profile_id uuid)
language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_ap_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if not public._consume_artist_invite_code(p_invite_code, v_uid) then
    raise exception '유효하지 않거나 이미 사용된 초대코드입니다';
  end if;
  perform set_config('app.artist_grant_ok', '1', true);

  update public.users u set
    account_type = 'artist',
    artist_approval_status = coalesce(u.artist_approval_status, 'pending'),
    full_name = coalesce(nullif(u.full_name, ''), p_real_name),
    birth_date = coalesce(u.birth_date, p_birth_date),
    phone = coalesce(nullif(u.phone, ''), p_phone),
    address = coalesce(nullif(u.address, ''), p_address),
    nickname = coalesce(nullif(u.nickname, ''), p_artist_name),
    signup_completed = true
  where u.id = v_uid;

  insert into public.users (id, nickname, account_type, full_name, birth_date, phone, address, signup_completed, artist_approval_status)
  select v_uid, p_artist_name, 'artist', p_real_name, p_birth_date, p_phone, p_address, true, 'pending'
  where not exists (select 1 from public.users u2 where u2.id = v_uid);

  update public.artist_profiles ap set
    real_name = coalesce(nullif(ap.real_name,''), p_real_name),
    artist_name = coalesce(nullif(ap.artist_name,''), p_artist_name),
    phone = coalesce(nullif(ap.phone,''), p_phone),
    address = coalesce(nullif(ap.address,''), p_address),
    email = coalesce(nullif(ap.email,''), p_email),
    birth_date = coalesce(ap.birth_date, p_birth_date)
  where ap.user_id = v_uid
  returning ap.id into v_ap_id;

  if v_ap_id is null then
    insert into public.artist_profiles (user_id, real_name, birth_date, artist_name, phone, address, email, approval_status)
    values (v_uid, p_real_name, p_birth_date, p_artist_name, p_phone, p_address, p_email, 'pending')
    returning id into v_ap_id;
  end if;

  return query select v_uid, 'ok'::text, v_ap_id;
end; $function$;
grant execute on function public.submit_artist_signup_profile(text,date,text,text,text,text,text) to authenticated;
