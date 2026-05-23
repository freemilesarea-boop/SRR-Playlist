-- 0129 — 아티스트 권한 부여 가드 (코드 검증 RPC/트리거를 거치지 않은 artist 승격 차단).
--   허용 조건: (1) app.artist_grant_ok='1' 세션플래그 (2) 관리자 (3) postgres/service.
--   individual/business 영향 없음 (account_type='artist' 전환 + artist_profiles INSERT 만 가드).
create or replace function public._artist_grant_allowed()
returns boolean language plpgsql stable security definer set search_path to 'public' as $function$
begin
  if coalesce(current_setting('app.artist_grant_ok', true), '') = '1' then return true; end if;
  if exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then return true; end if;
  if session_user in ('postgres', 'supabase_admin', 'service_role') then return true; end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then return true; end if;
  return false;
end; $function$;

create or replace function public._guard_users_artist_grant()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if NEW.account_type = 'artist'
     and (TG_OP = 'INSERT' or OLD.account_type is distinct from 'artist')
     and not public._artist_grant_allowed() then
    raise exception '아티스트 전환은 유효한 초대코드가 필요합니다 (account_type)';
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_guard_users_artist_grant on public.users;
create trigger trg_guard_users_artist_grant
  before insert or update on public.users
  for each row execute function public._guard_users_artist_grant();

create or replace function public._guard_artist_profiles_insert()
returns trigger language plpgsql security definer set search_path to 'public' as $function$
begin
  if not public._artist_grant_allowed() then
    raise exception '아티스트 등록은 유효한 초대코드가 필요합니다 (artist_profiles)';
  end if;
  return NEW;
end; $function$;
drop trigger if exists trg_guard_artist_profiles_insert on public.artist_profiles;
create trigger trg_guard_artist_profiles_insert
  before insert on public.artist_profiles
  for each row execute function public._guard_artist_profiles_insert();

drop policy if exists artist_insert_self_pending on public.artist_profiles;
