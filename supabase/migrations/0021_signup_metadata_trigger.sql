-- ============================================
-- 0021_signup_metadata_trigger.sql
--
-- 회원가입 데이터 누락 버그 핫픽스:
--   기존 handle_new_user 트리거는 nickname 만 채워서 public.users 를 만들고,
--   account_type / artist_approval_status / 본인정보 / artist_profiles 는
--   클라이언트가 별도로 INSERT 해야 했음. 이메일 인증이 ON 인 환경에선
--   가입 직후 session 이 없어 클라이언트 INSERT 가 스킵 → DB 에 정보 0건 →
--   관리자 승인 목록에 신규 아티스트 미노출.
--
-- 해결:
--   트리거가 auth.users.raw_user_meta_data 를 읽어 적절한 컬럼을 채우고,
--   account_type='artist' 면 artist_profiles 행도 자동 생성.
--   email 인증과 무관하게 atomic 처리.
--
-- 멱등 (CREATE OR REPLACE).
-- ============================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_account_type text := nullif(v_meta->>'account_type', '');
  v_full_name    text := nullif(v_meta->>'full_name', '');
  v_birth_date   date;
  v_phone        text := nullif(v_meta->>'phone', '');
  v_address      text := nullif(v_meta->>'address', '');
  v_artist_name  text := nullif(v_meta->>'artist_name', '');
  v_nickname     text := coalesce(
    nullif(v_meta->>'nickname', ''),
    v_artist_name,
    split_part(new.email, '@', 1)
  );
begin
  -- 안전한 account_type 만 허용 (메타데이터 위조 방지)
  if v_account_type not in ('individual','business','artist') then
    v_account_type := 'individual';
  end if;

  begin
    v_birth_date := (nullif(v_meta->>'birth_date', ''))::date;
  exception when others then
    v_birth_date := null;
  end;

  -- public.users 행 생성/갱신 (ON CONFLICT 로 멱등)
  insert into public.users (
    id, nickname, account_type, full_name, birth_date, phone, address,
    signup_completed, artist_approval_status
  )
  values (
    new.id,
    v_nickname,
    v_account_type,
    v_full_name,
    v_birth_date,
    v_phone,
    v_address,
    -- 메타에 핵심 필드가 채워졌으면 가입 완료로 간주
    (v_full_name is not null and v_phone is not null and v_address is not null),
    case when v_account_type = 'artist' then 'pending' else null end
  )
  on conflict (id) do update set
    nickname = coalesce(public.users.nickname, excluded.nickname),
    account_type = excluded.account_type,
    full_name = coalesce(public.users.full_name, excluded.full_name),
    birth_date = coalesce(public.users.birth_date, excluded.birth_date),
    phone = coalesce(public.users.phone, excluded.phone),
    address = coalesce(public.users.address, excluded.address),
    signup_completed = public.users.signup_completed or excluded.signup_completed,
    artist_approval_status = case
      when excluded.account_type = 'artist'
        then coalesce(public.users.artist_approval_status, 'pending')
      else public.users.artist_approval_status
    end;

  -- 아티스트면 artist_profiles 도 자동 생성
  if v_account_type = 'artist' and v_artist_name is not null then
    insert into public.artist_profiles (
      user_id, real_name, birth_date, artist_name, phone, address, email,
      approval_status
    )
    values (
      new.id,
      coalesce(v_full_name, v_nickname),
      coalesce(v_birth_date, '1900-01-01'::date),
      v_artist_name,
      coalesce(v_phone, ''),
      coalesce(v_address, ''),
      new.email,
      'pending'
    )
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

-- 트리거 재바인딩 (기존 트리거 있으면 재사용, 없으면 신규)
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- 확인
select
  (select count(*) from public.users where account_type = 'artist') as artist_users,
  (select count(*) from public.artist_profiles) as artist_profiles_rows,
  (select count(*) from public.artist_profiles where approval_status = 'pending') as pending_artists;
