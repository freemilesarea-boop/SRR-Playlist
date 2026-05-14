-- ============================================
-- 0022_signup_trigger_debug.sql
--
-- 회원가입 트리거 적용 여부 / 동작 가시화.
--   1) signup_debug_events 테이블 (admin select only) — 트리거가 매 회원가입마다
--      자기가 본 메타데이터 / 결과 / 에러 메시지를 기록
--   2) handle_new_user 트리거 재정의 (0021 와 동일 로직 + raise log + 디버그 INSERT)
--   3) 끝에 자체 검증 SELECT 3종:
--      · 함수가 최신 본문(artist_profiles 포함)인지
--      · 트리거가 auth.users 에 enabled 되어있는지
--      · 최근 7일 가입 수
--
-- 멱등 (CREATE OR REPLACE).
-- ============================================

-- ----------------------
-- 1) 디버그 이벤트 테이블
-- ----------------------
create table if not exists public.signup_debug_events (
  id bigserial primary key,
  auth_user_id uuid,
  email text,
  metadata jsonb,
  account_type text,
  artist_name text,
  users_upserted boolean not null default false,
  artist_profile_upserted boolean not null default false,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_signup_debug_created
  on public.signup_debug_events(created_at desc);

alter table public.signup_debug_events enable row level security;

drop policy if exists "signup_debug_admin_select" on public.signup_debug_events;
create policy "signup_debug_admin_select" on public.signup_debug_events
  for select using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );
-- INSERT 는 트리거(SECURITY DEFINER) 만 — RLS 정책 없음 = 비인가 차단

-- ----------------------
-- 2) handle_new_user 재정의 (0021 + 디버그 로깅)
-- ----------------------
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
    nullif(v_meta->>'nickname', ''), v_artist_name, split_part(new.email, '@', 1)
  );
  v_users_ok    boolean := false;
  v_artist_ok   boolean := false;
  v_err         text;
begin
  raise log '[handle_new_user] start user_id=% email=% account_type=% artist_name=%',
    new.id, new.email, v_account_type, v_artist_name;

  if v_account_type not in ('individual','business','artist') then
    v_account_type := 'individual';
  end if;

  begin
    v_birth_date := (nullif(v_meta->>'birth_date', ''))::date;
  exception when others then
    v_birth_date := null;
  end;

  -- A) public.users
  begin
    insert into public.users (
      id, nickname, account_type, full_name, birth_date, phone, address,
      signup_completed, artist_approval_status
    )
    values (
      new.id, v_nickname, v_account_type,
      v_full_name, v_birth_date, v_phone, v_address,
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
    v_users_ok := true;
  exception when others then
    v_err := SQLERRM;
    raise log '[handle_new_user] users upsert FAILED: %', v_err;
  end;

  -- B) artist_profiles (account_type='artist' + artist_name 존재)
  if v_account_type = 'artist' and v_artist_name is not null then
    begin
      insert into public.artist_profiles (
        user_id, real_name, birth_date, artist_name, phone, address, email, approval_status
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
      v_artist_ok := true;
    exception when others then
      v_err := SQLERRM;
      raise log '[handle_new_user] artist_profiles insert FAILED: %', v_err;
    end;
  end if;

  -- C) 디버그 이벤트 기록 (best-effort)
  begin
    insert into public.signup_debug_events (
      auth_user_id, email, metadata, account_type, artist_name,
      users_upserted, artist_profile_upserted, error_message
    ) values (
      new.id, new.email, v_meta, v_account_type, v_artist_name,
      v_users_ok, v_artist_ok, v_err
    );
  exception when others then
    -- 디버그 실패는 무시 (가입 자체 막지 않음)
    null;
  end;

  raise log '[handle_new_user] done user_id=% users_ok=% artist_ok=% err=%',
    new.id, v_users_ok, v_artist_ok, v_err;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ----------------------
-- 3) 자체 검증 — 워크플로우 로그 / SQL Editor 에 결과 노출
-- ----------------------

-- 3a) 함수가 새 본문(artist_profiles 포함)인지
select
  'fn_has_artist_profiles' as check,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'handle_new_user'
      and pg_get_functiondef(p.oid) ilike '%artist_profiles%'
  ) as ok;

-- 3b) 트리거가 auth.users 에 enabled 인지
select
  'trigger_enabled' as check,
  exists (
    select 1
    from pg_trigger
    where tgname = 'on_auth_user_created'
      and tgrelid = 'auth.users'::regclass
      and tgenabled in ('O', 'A')  -- O = origin/local, A = always
  ) as ok;

-- 3c) 디버그 테이블 존재
select 'debug_table' as check,
  exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'signup_debug_events'
  ) as ok;

-- 3d) 최근 7일 가입자 수
select
  'recent_signups_7d' as label,
  (select count(*) from auth.users where created_at > now() - interval '7 days') as auth_users,
  (select count(*) from public.users where created_at > now() - interval '7 days') as public_users,
  (select count(*) from public.users where account_type = 'artist'
     and created_at > now() - interval '7 days') as artists,
  (select count(*) from public.artist_profiles where created_at > now() - interval '7 days') as artist_profiles_rows;
