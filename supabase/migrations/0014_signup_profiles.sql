-- ============================================
-- 0014_signup_profiles.sql
--
-- 회원가입 강화 (일반회원 / 사업자회원 분리 + 본인인증/사업자 검증 구조):
--   - users 테이블에 본인 정보 + 인증 상태 컬럼 추가
--   - business_verification_profiles 테이블 추가
--   - admin_member_list RPC 확장 (account_type / signup_completed /
--     identity_verified / business_verified 노출)
--
-- 보안 원칙:
--   - 주민등록번호 원문/뒷자리 컬럼 절대 추가 X
--   - CI/DI 는 외부 본인확인기관 결과만 저장 (mock 가능)
--   - 비밀번호는 Supabase Auth 가 관리 (public.users 에 절대 저장 X)
-- ============================================

-- ----------------------
-- 1) users 컬럼 확장
-- ----------------------
alter table public.users
  add column if not exists account_type text default 'individual'
    check (account_type in ('individual','business')),
  add column if not exists full_name text,
  add column if not exists birth_date date,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists identity_verified boolean not null default false,
  add column if not exists identity_provider text,
  add column if not exists identity_verified_at timestamptz,
  -- CI/DI 는 민감 — 외부 인증 결과만 저장. raw 주민번호 절대 들어가지 않음.
  add column if not exists identity_ci text,
  add column if not exists identity_di text,
  add column if not exists signup_completed boolean not null default false;

-- 기존 사용자는 신규 가입 플로우를 통과한 적이 없으므로,
-- 운영 중인 시드/관리자 계정이 갑자기 차단되지 않도록 legacy 호환:
--   created_at 이 마이그레이션 이전인 행은 signup_completed=true 로 마킹.
update public.users
set signup_completed = true
where signup_completed = false
  and created_at < now();

-- ----------------------
-- 2) business_verification_profiles 테이블
-- ----------------------
create table if not exists public.business_verification_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  business_number text not null,
  business_name text,
  representative_name text,
  business_open_date date,
  business_address text,
  business_type text,
  store_name text,
  store_address text,
  business_verified boolean not null default false,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected','manual_review')),
  business_state text,
  tax_type text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id),
  unique (business_number)
);

create index if not exists idx_business_verification_status
  on public.business_verification_profiles(verification_status);

-- updated_at 자동 갱신
create or replace function public._business_verification_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_business_verification_updated_at on public.business_verification_profiles;
create trigger trg_business_verification_updated_at
  before update on public.business_verification_profiles
  for each row execute function public._business_verification_set_updated_at();

-- RLS
alter table public.business_verification_profiles enable row level security;

drop policy if exists "bvp_select_self" on public.business_verification_profiles;
create policy "bvp_select_self" on public.business_verification_profiles
  for select using (auth.uid() = user_id);

drop policy if exists "bvp_insert_self" on public.business_verification_profiles;
create policy "bvp_insert_self" on public.business_verification_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "bvp_update_self" on public.business_verification_profiles;
create policy "bvp_update_self" on public.business_verification_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "bvp_admin_all" on public.business_verification_profiles;
create policy "bvp_admin_all" on public.business_verification_profiles
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 3) admin_member_list RPC 확장 — 새 인증 상태 컬럼 노출
--    (기존 0002 의 시그니처를 보강. 멱등 — CREATE OR REPLACE)
-- ----------------------
create or replace function public.admin_member_list(
  search text default null,
  plan_filter text default null,
  role_filter text default null,
  limit_n int default 100
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint,
  account_type text,
  signup_completed boolean,
  identity_verified boolean,
  business_verified boolean,
  business_number text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  with stream_agg as (
    select se.user_id,
           count(*) filter (where se.event_type = 'milestone_30s')::bigint as streams,
           coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.user_id is not null
    group by se.user_id
  ),
  last_seen as (
    select ve.user_id, max(ve.created_at) as last_seen_at
    from public.visitor_events ve
    where ve.user_id is not null
    group by ve.user_id
  )
  select
    u.id,
    -- email 은 auth.users 에서 join — public.users 에는 저장하지 않음
    (select au.email from auth.users au where au.id = u.id) as email,
    u.nickname,
    u.role,
    u.subscription_type,
    u.created_at,
    ls.last_seen_at,
    coalesce(sa.streams, 0) as total_streams,
    coalesce(sa.listened, 0) as total_listened_seconds,
    coalesce(u.account_type, 'individual') as account_type,
    coalesce(u.signup_completed, false) as signup_completed,
    coalesce(u.identity_verified, false) as identity_verified,
    coalesce(bvp.business_verified, false) as business_verified,
    bvp.business_number
  from public.users u
  left join stream_agg sa on sa.user_id = u.id
  left join last_seen ls on ls.user_id = u.id
  left join public.business_verification_profiles bvp on bvp.user_id = u.id
  where (search is null or length(btrim(search)) = 0
         or u.nickname ilike '%' || search || '%'
         or (select au.email from auth.users au where au.id = u.id) ilike '%' || search || '%')
    and (plan_filter is null or u.subscription_type = plan_filter)
    and (role_filter is null or u.role = role_filter)
  order by u.created_at desc
  limit greatest(1, limit_n);
end;
$$;

grant execute on function public.admin_member_list(text, text, text, int)
  to authenticated;

-- 확인 출력
select
  (select count(*) from public.users where account_type = 'individual') as individual_users,
  (select count(*) from public.users where account_type = 'business') as business_users,
  (select count(*) from public.users where signup_completed) as completed_users,
  (select count(*) from public.business_verification_profiles) as bvp_rows,
  (select count(*) from public.business_verification_profiles where business_verified) as verified_businesses;
