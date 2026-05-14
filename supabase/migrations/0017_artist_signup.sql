-- ============================================
-- 0017_artist_signup.sql
--
-- 아티스트 회원가입 + 음원 검수 구조:
--   1) users.account_type 에 'artist' 추가 (CHECK 재정의)
--   2) users.artist_approval_status 컬럼 추가 (pending/approved/rejected)
--   3) artist_profiles 테이블 신규
--   4) tracks 에 owner/source/visibility_status 컬럼 추가
--   5) RPC: approve_artist_profile / reject_artist_profile (admin only)
--   6) RLS: 본인 + admin 권한
--
-- 멱등 (IF NOT EXISTS / DROP+CREATE 패턴).
-- ============================================

-- ----------------------
-- 1) users.account_type CHECK 재정의 + artist_approval_status
-- ----------------------
alter table public.users
  drop constraint if exists users_account_type_check;
alter table public.users
  add constraint users_account_type_check
  check (account_type in ('individual','business','artist'));

alter table public.users
  add column if not exists artist_approval_status text
    check (artist_approval_status is null
           or artist_approval_status in ('pending','approved','rejected'));

create index if not exists idx_users_artist_status
  on public.users(artist_approval_status)
  where artist_approval_status is not null;

-- ----------------------
-- 2) artist_profiles 테이블
-- ----------------------
create table if not exists public.artist_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  real_name text not null,
  birth_date date not null,
  artist_name text not null,
  phone text not null,
  address text not null,
  email text not null,
  approval_status text not null default 'pending'
    check (approval_status in ('pending','approved','rejected')),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_artist_profiles_status
  on public.artist_profiles(approval_status);
create index if not exists idx_artist_profiles_artist_name_lower
  on public.artist_profiles(lower(artist_name));

create or replace function public._touch_artist_profiles_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

drop trigger if exists trg_artist_profiles_updated_at on public.artist_profiles;
create trigger trg_artist_profiles_updated_at
  before update on public.artist_profiles
  for each row execute function public._touch_artist_profiles_updated_at();

alter table public.artist_profiles enable row level security;

-- 본인 select
drop policy if exists "artist_select_self" on public.artist_profiles;
create policy "artist_select_self" on public.artist_profiles
  for select using (auth.uid() = user_id);

-- pending 상태일 때만 본인 insert 가능
drop policy if exists "artist_insert_self_pending" on public.artist_profiles;
create policy "artist_insert_self_pending" on public.artist_profiles
  for insert with check (auth.uid() = user_id and approval_status = 'pending');

-- 본인 update (pending 상태에서만 의미 있는 필드 변경. 승인 후엔 RPC 경유)
drop policy if exists "artist_update_self_pending" on public.artist_profiles;
create policy "artist_update_self_pending" on public.artist_profiles
  for update using (auth.uid() = user_id and approval_status = 'pending')
  with check (auth.uid() = user_id and approval_status = 'pending');

-- admin 전체 권한
drop policy if exists "artist_admin_all" on public.artist_profiles;
create policy "artist_admin_all" on public.artist_profiles
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 3) tracks 에 소유/검수 컬럼 추가
-- ----------------------
alter table public.tracks
  add column if not exists owner_user_id uuid references public.users(id) on delete set null,
  add column if not exists artist_profile_id uuid references public.artist_profiles(id) on delete set null,
  add column if not exists uploaded_by_account_type text
    check (uploaded_by_account_type is null
           or uploaded_by_account_type in ('individual','business','artist','admin')),
  add column if not exists visibility_status text not null default 'approved'
    check (visibility_status in ('pending_review','approved','rejected','hidden')),
  add column if not exists source_type text not null default 'admin_upload'
    check (source_type in ('admin_upload','artist_upload','import'));

create index if not exists idx_tracks_owner on public.tracks(owner_user_id);
create index if not exists idx_tracks_visibility on public.tracks(visibility_status);
create index if not exists idx_tracks_artist_profile on public.tracks(artist_profile_id);

-- tracks RLS 보강: 본인 업로드 곡 select 가능 (visibility 무관)
-- 기존 admin 정책은 0001 의 admin_*_all 로 커버되니 그대로 두고, owner 정책만 추가.
drop policy if exists "tracks_select_owner" on public.tracks;
create policy "tracks_select_owner" on public.tracks
  for select using (
    owner_user_id is not null and owner_user_id = auth.uid()
  );

-- 공개 select: visibility_status='approved' 인 곡만 (legacy tracks 는 기본값이 approved 라 호환)
-- 기존 public select 정책이 있을 수 있으나 더 엄격하게 재정의.
drop policy if exists "tracks_public_select_approved" on public.tracks;
create policy "tracks_public_select_approved" on public.tracks
  for select using (visibility_status = 'approved');

-- ----------------------
-- 4) RPC: approve_artist_profile (admin only)
-- ----------------------
create or replace function public.approve_artist_profile(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.artist_profiles
  set approval_status = 'approved',
      approved_by = auth.uid(),
      approved_at = now(),
      rejected_reason = null
  where user_id = p_user_id;

  update public.users
  set artist_approval_status = 'approved'
  where id = p_user_id;
end;
$$;

grant execute on function public.approve_artist_profile(uuid) to authenticated;

-- ----------------------
-- 5) RPC: reject_artist_profile (admin only)
-- ----------------------
create or replace function public.reject_artist_profile(p_user_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.artist_profiles
  set approval_status = 'rejected',
      rejected_reason = nullif(btrim(p_reason), ''),
      approved_by = auth.uid(),
      approved_at = now()
  where user_id = p_user_id;

  update public.users
  set artist_approval_status = 'rejected'
  where id = p_user_id;
end;
$$;

grant execute on function public.reject_artist_profile(uuid, text) to authenticated;

-- ----------------------
-- 6) RPC: list_pending_artists (admin only) — 관리자 페이지용
-- ----------------------
create or replace function public.list_pending_artists(p_limit int default 50)
returns table(
  user_id uuid,
  real_name text,
  artist_name text,
  phone text,
  email text,
  approval_status text,
  rejected_reason text,
  created_at timestamptz
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
  select ap.user_id, ap.real_name, ap.artist_name, ap.phone, ap.email,
         ap.approval_status, ap.rejected_reason, ap.created_at
  from public.artist_profiles ap
  order by
    case ap.approval_status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    ap.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_artists(int) to authenticated;

-- ----------------------
-- 7) RPC: list_pending_review_tracks (admin only)
-- ----------------------
create or replace function public.list_pending_review_tracks(p_limit int default 50)
returns table(
  track_id uuid,
  title text,
  artist text,
  audio_url text,
  cover_url text,
  duration int,
  owner_user_id uuid,
  artist_profile_id uuid,
  uploaded_by_account_type text,
  source_type text,
  visibility_status text,
  artist_name text,
  created_at timestamptz
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
  select t.id, t.title, t.artist, t.audio_url, t.cover_url, t.duration,
         t.owner_user_id, t.artist_profile_id, t.uploaded_by_account_type,
         t.source_type, t.visibility_status,
         ap.artist_name, t.created_at
  from public.tracks t
  left join public.artist_profiles ap on ap.id = t.artist_profile_id
  where t.visibility_status = 'pending_review'
  order by t.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_review_tracks(int) to authenticated;

-- ----------------------
-- 확인
-- ----------------------
select
  (select count(*) from public.artist_profiles) as total_artists,
  (select count(*) from public.artist_profiles where approval_status = 'pending') as pending_artists,
  (select count(*) from public.tracks where visibility_status = 'pending_review') as pending_tracks;
