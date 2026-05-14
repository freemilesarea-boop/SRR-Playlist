-- ============================================
-- 0023_backfill_artist_signups.sql
--
-- 기존 회원가입자 백필 + 관리자 동기화 RPC.
--
-- 배경:
--   0021/0022 트리거는 신규 가입부터 적용. 이미 가입했지만 artist_profiles
--   생성이 누락된 계정은 관리자 승인 목록에 안 보임 → 운영 직접 SQL 작업이
--   필요해지는 상황을 피하기 위해 RPC + 관리자 UI 버튼 제공.
--
-- 처리 기준 (OR 조합):
--   - auth.users.raw_user_meta_data->>'account_type' = 'artist'
--   - auth.users.raw_user_meta_data->>'artist_name' is not null
--   - public.users.account_type = 'artist'
--   - public.users.artist_approval_status is not null
--
-- 멱등:
--   - public.users INSERT 시 ON CONFLICT DO NOTHING
--   - approved/rejected 상태는 절대 덮어쓰지 않음 (coalesce 로 보존)
--   - artist_profiles 가 이미 있으면 INSERT 안 하고 누락 필드만 보정
--   - 여러 번 실행해도 안전
--
-- 권한:
--   - authenticated user 가 호출하면 admin 권한 검증
--   - migration 컨텍스트(auth.uid() is null) 에선 권한 검증 생략 →
--     마이그레이션 끝에서 초기 1회 자동 실행 가능
-- ============================================

create or replace function public.repair_artist_signups()
returns table(
  scanned int,
  users_updated int,
  profiles_created int,
  skipped int
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scanned int := 0;
  v_users_updated int := 0;
  v_profiles_created int := 0;
  v_skipped int := 0;
  r record;
  v_artist_name text;
  v_full_name text;
  v_phone text;
  v_address text;
  v_birth_date date;
begin
  -- 권한 검증: 로그인 사용자가 호출했다면 admin 인지 확인
  -- migration 컨텍스트에선 auth.uid() = null → 건너뜀
  if auth.uid() is not null and not exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'admin only';
  end if;

  -- 후보 탐색
  for r in
    select
      au.id as user_id,
      au.email,
      coalesce(au.raw_user_meta_data, '{}'::jsonb) as meta,
      pu.account_type as pu_account_type,
      pu.artist_approval_status as pu_status,
      pu.full_name as pu_full_name,
      pu.birth_date as pu_birth_date,
      pu.phone as pu_phone,
      pu.address as pu_address,
      ap.id as ap_id,
      ap.approval_status as ap_status
    from auth.users au
    left join public.users pu on pu.id = au.id
    left join public.artist_profiles ap on ap.user_id = au.id
    where
      coalesce(au.raw_user_meta_data->>'account_type', '') = 'artist'
      or nullif(au.raw_user_meta_data->>'artist_name', '') is not null
      or pu.account_type = 'artist'
      or pu.artist_approval_status is not null
  loop
    v_scanned := v_scanned + 1;

    -- 필드 fallback 순서: meta → public.users 기존값 → 이메일 prefix → ''
    v_artist_name := coalesce(
      nullif(r.meta->>'artist_name', ''),
      nullif(r.meta->>'nickname', ''),
      split_part(r.email, '@', 1)
    );
    v_full_name := coalesce(
      nullif(r.meta->>'full_name', ''),
      r.pu_full_name,
      v_artist_name
    );
    v_phone   := coalesce(nullif(r.meta->>'phone', ''),   r.pu_phone,   '');
    v_address := coalesce(nullif(r.meta->>'address', ''), r.pu_address, '');
    begin
      v_birth_date := coalesce(
        (nullif(r.meta->>'birth_date', ''))::date,
        r.pu_birth_date,
        '1900-01-01'::date
      );
    exception when others then
      v_birth_date := coalesce(r.pu_birth_date, '1900-01-01'::date);
    end;

    -- ① public.users 보정
    if r.pu_account_type is null then
      -- users row 자체가 없음 (트리거 미작동했던 케이스)
      insert into public.users (
        id, nickname, account_type, full_name, birth_date, phone, address,
        signup_completed, artist_approval_status
      ) values (
        r.user_id,
        v_artist_name,
        'artist',
        v_full_name,
        v_birth_date,
        v_phone,
        v_address,
        true,
        'pending'
      )
      on conflict (id) do nothing;
      v_users_updated := v_users_updated + 1;
    elsif r.pu_account_type <> 'artist' or r.pu_status is null then
      -- 일반/사업자로 잘못 들어가 있거나 status null → 보정.
      -- 단 이미 approved/rejected 면 그 status 유지 (coalesce).
      update public.users
      set
        account_type = 'artist',
        artist_approval_status = coalesce(artist_approval_status, 'pending'),
        full_name = coalesce(full_name, v_full_name),
        birth_date = coalesce(birth_date, v_birth_date),
        phone = coalesce(phone, v_phone),
        address = coalesce(address, v_address)
      where id = r.user_id;
      v_users_updated := v_users_updated + 1;
    end if;

    -- ② artist_profiles 보정
    if r.ap_id is null then
      -- 신규 생성
      begin
        insert into public.artist_profiles (
          user_id, real_name, birth_date, artist_name, phone, address, email,
          approval_status
        ) values (
          r.user_id,
          v_full_name,
          v_birth_date,
          v_artist_name,
          v_phone,
          v_address,
          r.email,
          'pending'
        )
        on conflict (user_id) do nothing;
        v_profiles_created := v_profiles_created + 1;
      exception when others then
        v_skipped := v_skipped + 1;
      end;
    else
      -- 이미 존재 — approval_status 는 절대 건드리지 않음.
      -- 누락된 디스플레이 필드만 채움.
      update public.artist_profiles
      set
        artist_name = coalesce(nullif(artist_name, ''), v_artist_name),
        real_name   = coalesce(nullif(real_name, ''),   v_full_name),
        phone       = coalesce(nullif(phone, ''),       v_phone),
        address     = coalesce(nullif(address, ''),     v_address),
        email       = coalesce(nullif(email, ''),       r.email)
      where id = r.ap_id;
      v_skipped := v_skipped + 1;
    end if;

    -- ③ 디버그 로그 (0022 signup_debug_events 가 있을 때만)
    begin
      insert into public.signup_debug_events (
        auth_user_id, email, metadata, account_type, artist_name,
        users_upserted, artist_profile_upserted, error_message
      ) values (
        r.user_id, r.email, r.meta, 'artist', v_artist_name,
        true,
        (r.ap_id is null),
        'backfill'
      );
    exception when others then
      null;
    end;
  end loop;

  return query select v_scanned, v_users_updated, v_profiles_created, v_skipped;
end;
$$;

grant execute on function public.repair_artist_signups() to authenticated;

-- ----------------------
-- 초기 자동 백필 — 마이그레이션 적용 직후 1회 실행
-- ----------------------
do $$
declare
  rec record;
begin
  select * into rec from public.repair_artist_signups();
  raise notice 'Initial backfill: scanned=% users_updated=% profiles_created=% skipped=%',
    rec.scanned, rec.users_updated, rec.profiles_created, rec.skipped;
end$$;

-- 확인
select
  (select count(*) from public.users where account_type = 'artist') as artist_users_total,
  (select count(*) from public.users where artist_approval_status = 'pending') as pending_users,
  (select count(*) from public.artist_profiles) as artist_profiles_total,
  (select count(*) from public.artist_profiles where approval_status = 'pending') as pending_profiles;
