-- ============================================
-- 0025_artist_upload_eligibility.sql
--
-- 아티스트 음원 업로드 자격 게이트 (5단계):
--   1) account_type='artist'
--   2) artist_approval_status='approved' + artist_profiles.approval_status='approved'
--   3) users.membership_tier='individual' (4,900원 요금제 결제)
--   4) artist_payout_accounts.verification_status='verified'
--   5) tracks INSERT 시 owner_user_id / source_type / visibility_status 강제
--
-- 변경:
--   - artist_payout_accounts 신규 테이블 + RLS (본인 + admin only)
--   - tracks 컬럼 추가: album_name / suitable_store / lyrics / payout_account_id
--   - tracks_artist_insert RLS 보강 — 결제 + 계좌 검증 추가
--   - RPC 5개: submit_payout / list_pending_payouts / verify / reject /
--     get_artist_upload_eligibility
-- ============================================

-- ----------------------
-- 1) artist_payout_accounts
-- ----------------------
create table if not exists public.artist_payout_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade unique,
  artist_profile_id uuid references public.artist_profiles(id) on delete set null,
  bank_name text not null,
  account_number text not null,
  account_holder text not null,
  verification_status text not null default 'pending'
    check (verification_status in ('pending','verified','rejected')),
  verified_by uuid references public.users(id) on delete set null,
  verified_at timestamptz,
  rejected_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_payout_status
  on public.artist_payout_accounts(verification_status);

alter table public.artist_payout_accounts enable row level security;

-- 계좌번호는 민감정보 — 본인 + admin 만 접근
drop policy if exists "payout_select_self" on public.artist_payout_accounts;
create policy "payout_select_self" on public.artist_payout_accounts
  for select using (auth.uid() = user_id);

drop policy if exists "payout_insert_self" on public.artist_payout_accounts;
create policy "payout_insert_self" on public.artist_payout_accounts
  for insert with check (auth.uid() = user_id and verification_status = 'pending');

-- pending/rejected 상태에서만 본인 수정 (verified 후엔 admin 만)
drop policy if exists "payout_update_self_pending" on public.artist_payout_accounts;
create policy "payout_update_self_pending" on public.artist_payout_accounts
  for update using (
    auth.uid() = user_id
    and verification_status in ('pending', 'rejected')
  ) with check (
    auth.uid() = user_id
    and verification_status = 'pending'
  );

drop policy if exists "payout_admin_all" on public.artist_payout_accounts;
create policy "payout_admin_all" on public.artist_payout_accounts
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- updated_at 트리거 (기존 공용 함수 재사용)
drop trigger if exists trg_payout_updated_at on public.artist_payout_accounts;
create trigger trg_payout_updated_at
  before update on public.artist_payout_accounts
  for each row execute function public._touch_updated_at();

-- ----------------------
-- 2) tracks 컬럼 추가 (main_genre/sub_genre/genre/mood 는 기존 컬럼 재사용)
-- ----------------------
alter table public.tracks
  add column if not exists album_name text,
  add column if not exists suitable_store text,
  add column if not exists lyrics text,
  add column if not exists payout_account_id uuid
    references public.artist_payout_accounts(id) on delete set null;

create index if not exists idx_tracks_payout on public.tracks(payout_account_id);

-- ----------------------
-- 3) tracks INSERT RLS 강화 — 결제 + 계좌 검증 추가
-- ----------------------
drop policy if exists "tracks_artist_insert" on public.tracks;
create policy "tracks_artist_insert" on public.tracks
  for insert with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and visibility_status = 'pending_review'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.account_type = 'artist'
        and u.artist_approval_status = 'approved'
        and u.membership_tier = 'individual'   -- 4,900원 결제 확인
    )
    and exists (
      select 1 from public.artist_payout_accounts pa
      where pa.user_id = auth.uid()
        and pa.verification_status = 'verified'   -- 계좌 검증 확인
    )
  );

-- ----------------------
-- 4) RPC: submit_artist_payout_account
-- ----------------------
create or replace function public.submit_artist_payout_account(
  p_bank_name text,
  p_account_number text,
  p_account_holder text
)
returns table(account_id uuid, verification_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile_id uuid;
  v_account_id uuid;
begin
  if v_uid is null then raise exception 'not authenticated'; end if;
  if length(btrim(coalesce(p_bank_name, ''))) = 0 then raise exception 'bank_name required'; end if;
  if length(btrim(coalesce(p_account_number, ''))) = 0 then raise exception 'account_number required'; end if;
  if length(btrim(coalesce(p_account_holder, ''))) = 0 then raise exception 'account_holder required'; end if;

  select id into v_profile_id from public.artist_profiles where user_id = v_uid;
  -- artist_profile 이 없어도 계좌 등록 가능 (회원가입 직후 케이스)

  insert into public.artist_payout_accounts (
    user_id, artist_profile_id, bank_name, account_number, account_holder,
    verification_status
  )
  values (v_uid, v_profile_id, btrim(p_bank_name), btrim(p_account_number), btrim(p_account_holder), 'pending')
  on conflict (user_id) do update set
    bank_name = excluded.bank_name,
    account_number = excluded.account_number,
    account_holder = excluded.account_holder,
    verification_status = 'pending',  -- 재제출 시 pending 으로 리셋
    rejected_reason = null,
    verified_by = null,
    verified_at = null
  returning id into v_account_id;

  return query select v_account_id, 'pending'::text;
end;
$$;

grant execute on function public.submit_artist_payout_account(text, text, text) to authenticated;

-- ----------------------
-- 5) RPC: list_pending_payout_accounts (admin)
-- ----------------------
create or replace function public.list_pending_payout_accounts(p_limit int default 100)
returns table(
  account_id uuid,
  user_id uuid,
  artist_name text,
  email text,
  bank_name text,
  account_number text,
  account_holder text,
  verification_status text,
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
  select pa.id, pa.user_id, ap.artist_name, ap.email,
         pa.bank_name, pa.account_number, pa.account_holder,
         pa.verification_status, pa.rejected_reason, pa.created_at
  from public.artist_payout_accounts pa
  left join public.artist_profiles ap on ap.user_id = pa.user_id
  order by
    case pa.verification_status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    pa.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_payout_accounts(int) to authenticated;

-- ----------------------
-- 6) RPC: verify / reject (admin)
-- ----------------------
create or replace function public.verify_artist_payout_account(p_account_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  update public.artist_payout_accounts
  set verification_status = 'verified',
      verified_by = auth.uid(),
      verified_at = now(),
      rejected_reason = null
  where id = p_account_id;
end;
$$;

grant execute on function public.verify_artist_payout_account(uuid) to authenticated;

create or replace function public.reject_artist_payout_account(p_account_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  update public.artist_payout_accounts
  set verification_status = 'rejected',
      rejected_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      verified_by = auth.uid(),
      verified_at = now()
  where id = p_account_id;
end;
$$;

grant execute on function public.reject_artist_payout_account(uuid, text) to authenticated;

-- ----------------------
-- 7) RPC: get_artist_upload_eligibility — UI 단일 진실의 원천
-- ----------------------
create or replace function public.get_artist_upload_eligibility()
returns table(
  can_upload boolean,
  is_artist boolean,
  approval_status text,
  has_paid_membership boolean,
  payout_status text,
  payout_account_id uuid,
  reasons text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_tier text;
  v_ap_status text;
  v_payout_id uuid;
  v_payout_status text;
  v_has_paid boolean;
  v_subs_exists boolean;
  v_reasons text[] := array[]::text[];
begin
  if v_uid is null then
    return query select
      false, false, 'unauthenticated'::text, false, 'unauthenticated'::text,
      null::uuid, array['login_required']::text[];
    return;
  end if;

  select account_type, membership_tier
    into v_account_type, v_tier
  from public.users where id = v_uid;

  select approval_status into v_ap_status
  from public.artist_profiles where user_id = v_uid;

  select id, verification_status into v_payout_id, v_payout_status
  from public.artist_payout_accounts where user_id = v_uid;

  select exists (
    select 1 from public.subscriptions
    where user_id = v_uid and status = 'active' and plan_type = 'individual'
  ) into v_subs_exists;

  v_has_paid := (v_tier = 'individual' or v_tier = 'business' or v_subs_exists);

  if v_account_type is null or v_account_type <> 'artist' then
    v_reasons := array_append(v_reasons, 'not_artist');
  end if;
  if v_ap_status is null then
    v_reasons := array_append(v_reasons, 'no_artist_profile');
  elsif v_ap_status <> 'approved' then
    v_reasons := array_append(v_reasons, 'artist_not_approved');
  end if;
  if not v_has_paid then
    v_reasons := array_append(v_reasons, 'no_paid_membership');
  end if;
  if v_payout_id is null then
    v_reasons := array_append(v_reasons, 'no_payout_account');
  elsif v_payout_status <> 'verified' then
    v_reasons := array_append(v_reasons, 'payout_not_verified');
  end if;

  return query select
    (array_length(v_reasons, 1) is null),
    (v_account_type = 'artist'),
    coalesce(v_ap_status, 'none'),
    v_has_paid,
    coalesce(v_payout_status, 'none'),
    v_payout_id,
    v_reasons;
end;
$$;

grant execute on function public.get_artist_upload_eligibility() to authenticated;

-- ----------------------
-- 8) RPC: list_pending_review_tracks — 새 메타데이터 포함 버전
--    (0017 의 시그니처 확장: album_name / main_genre / sub_genre / mood /
--     suitable_store / lyrics / payout_verification_status / payout_bank_name)
-- ----------------------
drop function if exists public.list_pending_review_tracks(int);

create or replace function public.list_pending_review_tracks(p_limit int default 50)
returns table(
  track_id uuid,
  title text,
  artist text,
  album_name text,
  main_genre text,
  sub_genre text,
  mood text,
  suitable_store text,
  lyrics text,
  audio_url text,
  cover_url text,
  duration int,
  owner_user_id uuid,
  artist_profile_id uuid,
  uploaded_by_account_type text,
  source_type text,
  visibility_status text,
  artist_name text,
  payout_verification_status text,
  payout_bank_name text,
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
  select t.id, t.title, t.artist,
         t.album_name, t.main_genre, t.sub_genre, t.mood, t.suitable_store, t.lyrics,
         t.audio_url, t.cover_url, t.duration,
         t.owner_user_id, t.artist_profile_id, t.uploaded_by_account_type,
         t.source_type, t.visibility_status,
         ap.artist_name,
         pa.verification_status, pa.bank_name,
         t.created_at
  from public.tracks t
  left join public.artist_profiles ap on ap.id = t.artist_profile_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.visibility_status = 'pending_review'
  order by t.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_pending_review_tracks(int) to authenticated;

-- 확인
select
  'payout_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='artist_payout_accounts')
    then 'OK' else 'MISSING' end) as check_1,
  'tracks_album_name=' ||
  (case when exists (select 1 from information_schema.columns
    where table_schema='public' and table_name='tracks' and column_name='album_name')
    then 'OK' else 'MISSING' end) as check_2,
  'eligibility_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='get_artist_upload_eligibility')
    then 'OK' else 'MISSING' end) as check_3;
