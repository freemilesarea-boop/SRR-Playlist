-- ============================================
-- 0024_submit_artist_signup_rpc.sql
--
-- 트리거 의존을 보완하는 명시적 RPC.
--
-- 배경:
--   - handle_new_user 트리거는 auth.users INSERT 직후 1회 실행되지만 다음 케이스에서 실패 가능:
--     · 마이그레이션 미적용 (트리거 함수가 옛 버전)
--     · auth.users.raw_user_meta_data 가 비어있음 (signUp options.data 누락)
--     · 트리거 내부 silent fail
--
-- 해결:
--   - 로그인 사용자(auth.uid() != null) 본인이 호출 가능한 submit_artist_signup_profile RPC
--   - 트리거 동작 여부와 무관하게 본인이 명시적으로 호출해서 데이터 생성
--   - 멱등 (UPDATE + UPSERT, COALESCE 로 기존 값 보존)
--
-- 안전성:
--   - auth.uid() 강제 — 다른 사람 계정 조작 불가
--   - approved/rejected 상태는 절대 덮어쓰지 않음 (coalesce)
-- ============================================

create or replace function public.submit_artist_signup_profile(
  p_real_name text,
  p_birth_date date,
  p_artist_name text,
  p_phone text,
  p_address text,
  p_email text
)
returns table(user_id uuid, status text, artist_profile_id uuid)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_ap_id uuid;
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  -- ① public.users 보정 (account_type='artist', signup_completed=true)
  --    이미 approved/rejected 면 status 보존
  update public.users
  set
    account_type = 'artist',
    artist_approval_status = coalesce(artist_approval_status, 'pending'),
    full_name = coalesce(nullif(full_name, ''), p_real_name),
    birth_date = coalesce(birth_date, p_birth_date),
    phone = coalesce(nullif(phone, ''), p_phone),
    address = coalesce(nullif(address, ''), p_address),
    nickname = coalesce(nullif(nickname, ''), p_artist_name),
    signup_completed = true
  where id = v_uid;

  -- 만약 public.users 행 자체가 없으면 (handle_new_user 트리거 미작동) 생성
  insert into public.users (
    id, nickname, account_type, full_name, birth_date, phone, address,
    signup_completed, artist_approval_status
  )
  values (
    v_uid, p_artist_name, 'artist',
    p_real_name, p_birth_date, p_phone, p_address,
    true, 'pending'
  )
  on conflict (id) do nothing;

  -- ② artist_profiles UPSERT — approval_status 는 절대 덮어쓰지 않음
  insert into public.artist_profiles (
    user_id, real_name, birth_date, artist_name, phone, address, email,
    approval_status
  )
  values (
    v_uid, p_real_name, p_birth_date, p_artist_name, p_phone, p_address, p_email,
    'pending'
  )
  on conflict (user_id) do update set
    real_name   = coalesce(nullif(public.artist_profiles.real_name, ''),   excluded.real_name),
    artist_name = coalesce(nullif(public.artist_profiles.artist_name, ''), excluded.artist_name),
    phone       = coalesce(nullif(public.artist_profiles.phone, ''),       excluded.phone),
    address     = coalesce(nullif(public.artist_profiles.address, ''),     excluded.address),
    email       = coalesce(nullif(public.artist_profiles.email, ''),       excluded.email),
    birth_date  = coalesce(public.artist_profiles.birth_date,              excluded.birth_date)
    -- approval_status / rejected_reason / approved_by / approved_at 은 의도적 제외 (보존)
  returning id into v_ap_id;

  -- ③ 디버그 로그 (0022 signup_debug_events 가 있을 때만)
  begin
    insert into public.signup_debug_events (
      auth_user_id, email, metadata, account_type, artist_name,
      users_upserted, artist_profile_upserted, error_message
    ) values (
      v_uid, p_email, '{}'::jsonb, 'artist', p_artist_name,
      true, true, 'submit_rpc'
    );
  exception when others then
    null;
  end;

  return query select v_uid, 'ok'::text, v_ap_id;
end;
$$;

grant execute on function public.submit_artist_signup_profile(text, date, text, text, text, text)
  to authenticated;

-- 확인
select 'rpc_exists' as check,
  exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname='public' and p.proname='submit_artist_signup_profile'
  ) as ok;
