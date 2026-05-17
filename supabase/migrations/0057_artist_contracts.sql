-- ============================================
-- 0057_artist_contracts.sql
--
-- Phase 2: 아티스트 음원 유통 계약서 + 동의 흐름
--
--   - artist_contracts 테이블 (계약 본문 snapshot + 서명 증빙)
--   - users.contract_status 컬럼
--   - admin: create / list / detail
--   - artist: get_my_contract / sign / reject
--   - immutability 트리거 (signed/paid 행 수정 차단)
--   - tracks_artist_insert RLS + get_artist_upload_eligibility RPC 갱신 —
--     contract_status='signed' 게이트 추가
--
-- 정책:
--   - admin 만 INSERT (RPC 통해서만). 본인 직접 INSERT 불가.
--   - artist 본인은 SELECT + 자기 계약 status='pending_signature' → 'signed'/'rejected' 전이만 가능
--   - signed 행은 모든 UPDATE/DELETE 차단
--   - artist_user_id, contract_body, contract_version 은 INSERT 후 변경 불가
-- ============================================

-- ----------------------
-- 1) artist_contracts 테이블
-- ----------------------
create table if not exists public.artist_contracts (
  id uuid primary key default gen_random_uuid(),
  artist_user_id uuid not null references public.users(id) on delete restrict,
  contract_version text not null,
  contract_title text not null,
  contract_body text not null,
  status text not null default 'pending_signature'
    check (status in ('pending_signature','signed','rejected','expired')),
  pending_signature_at timestamptz not null default now(),
  signed_at timestamptz,
  signed_ip inet,
  signed_user_agent text,
  rejected_reason text,
  rejected_at timestamptz,
  expires_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(artist_user_id, contract_version)
);

create index if not exists idx_artist_contracts_user on public.artist_contracts(artist_user_id);
create index if not exists idx_artist_contracts_status on public.artist_contracts(status);
create index if not exists idx_artist_contracts_pending_expires
  on public.artist_contracts(expires_at) where status = 'pending_signature';

drop trigger if exists trg_artist_contracts_updated_at on public.artist_contracts;
create trigger trg_artist_contracts_updated_at
  before update on public.artist_contracts
  for each row execute function public._touch_updated_at();

-- ----------------------
-- 2) users.contract_status 컬럼
-- ----------------------
alter table public.users
  add column if not exists contract_status text
    default 'not_created'
    check (contract_status in ('not_created','pending_signature','signed','rejected','expired'));

create index if not exists idx_users_contract_status
  on public.users(contract_status) where contract_status <> 'not_created';

-- ----------------------
-- 3) Immutability — signed/paid 행 보호
-- ----------------------
create or replace function public._artist_contract_protect_signed()
returns trigger
language plpgsql
as $$
begin
  -- DELETE 차단 (signed 는 영구 보존)
  if TG_OP = 'DELETE' then
    if OLD.status = 'signed' then
      raise exception 'cannot delete signed contract (id=%)', OLD.id
        using errcode = '42501';
    end if;
    return OLD;
  end if;

  -- artist_user_id / contract_version / contract_body 는 INSERT 후 변경 불가
  if NEW.artist_user_id <> OLD.artist_user_id then
    raise exception 'cannot change artist_user_id of contract %', OLD.id using errcode = '42501';
  end if;
  if NEW.contract_version <> OLD.contract_version then
    raise exception 'cannot change contract_version of contract %', OLD.id using errcode = '42501';
  end if;
  if NEW.contract_body <> OLD.contract_body then
    raise exception 'cannot change contract_body of contract %', OLD.id using errcode = '42501';
  end if;

  -- signed 상태로 한 번 들어가면 status / signed_* 필드 변경 차단
  if OLD.status = 'signed' then
    if NEW.status <> 'signed'
       or NEW.signed_at is distinct from OLD.signed_at
       or NEW.signed_ip is distinct from OLD.signed_ip
       or NEW.signed_user_agent is distinct from OLD.signed_user_agent
    then
      raise exception 'signed contract is immutable (id=%)', OLD.id using errcode = '42501';
    end if;
  end if;

  return NEW;
end;
$$;

drop trigger if exists trg_artist_contracts_protect on public.artist_contracts;
create trigger trg_artist_contracts_protect
  before update or delete on public.artist_contracts
  for each row execute function public._artist_contract_protect_signed();

-- ----------------------
-- 4) RLS
-- ----------------------
alter table public.artist_contracts enable row level security;

-- 본인만 SELECT
drop policy if exists "artist_contracts_select_self" on public.artist_contracts;
create policy "artist_contracts_select_self" on public.artist_contracts
  for select using (artist_user_id = auth.uid());

-- admin 전체 (SELECT/UPDATE)
drop policy if exists "artist_contracts_admin_all" on public.artist_contracts;
create policy "artist_contracts_admin_all" on public.artist_contracts
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- 일반 사용자 INSERT/UPDATE/DELETE 직접 차단 — RPC (security definer) 통해서만
-- (위 두 정책 외에는 정책 없음 → default DENY)

-- ----------------------
-- 5) admin_create_artist_contract — 관리자 계약서 생성
-- ----------------------
create or replace function public.admin_create_artist_contract(
  p_artist_user_id uuid,
  p_contract_version text,
  p_contract_title text,
  p_contract_body text,
  p_expires_at timestamptz default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
  v_artist_record record;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  -- 게이트 검증: 대상 아티스트가 approved + 결제 완료 상태여야 함
  select u.account_type, u.artist_approval_status, u.membership_tier
    into v_artist_record
  from public.users u where u.id = p_artist_user_id;

  if v_artist_record.account_type is null then
    raise exception 'artist not found';
  end if;
  if v_artist_record.account_type <> 'artist' then
    raise exception 'user is not an artist (account_type=%)', v_artist_record.account_type;
  end if;
  if coalesce(v_artist_record.artist_approval_status, 'pending') <> 'approved' then
    raise exception 'artist not approved (status=%)', coalesce(v_artist_record.artist_approval_status,'pending');
  end if;
  if coalesce(v_artist_record.membership_tier, 'free') not in ('individual','business') then
    raise exception 'artist payment not completed (tier=%)', coalesce(v_artist_record.membership_tier,'free');
  end if;

  -- 입력 검증
  if length(btrim(coalesce(p_contract_version, ''))) = 0 then raise exception 'contract_version required'; end if;
  if length(btrim(coalesce(p_contract_title, ''))) = 0 then raise exception 'contract_title required'; end if;
  if length(btrim(coalesce(p_contract_body, ''))) < 100 then
    raise exception 'contract_body too short (min 100 chars)';
  end if;

  -- 동일 버전 중복 차단 (UNIQUE 제약이 있지만 명확한 에러 메시지)
  if exists (
    select 1 from public.artist_contracts
    where artist_user_id = p_artist_user_id and contract_version = btrim(p_contract_version)
  ) then
    raise exception 'contract version % already exists for this artist', p_contract_version
      using errcode = '23505';
  end if;

  insert into public.artist_contracts (
    artist_user_id, contract_version, contract_title, contract_body,
    status, pending_signature_at, expires_at, created_by
  ) values (
    p_artist_user_id, btrim(p_contract_version), btrim(p_contract_title), p_contract_body,
    'pending_signature', now(), p_expires_at, auth.uid()
  )
  returning id into v_id;

  -- users.contract_status 동기화 (signed 인 경우는 보존)
  update public.users
  set contract_status = case
    when contract_status = 'signed' then 'signed'  -- 이미 다른 버전 서명 완료면 보존
    else 'pending_signature'
  end
  where id = p_artist_user_id;

  return v_id;
end;
$$;

grant execute on function public.admin_create_artist_contract(uuid, text, text, text, timestamptz) to authenticated;

-- ----------------------
-- 6) sign_artist_contract — 아티스트 본인 서명
-- ----------------------
create or replace function public.sign_artist_contract(
  p_contract_id uuid,
  p_signed_ip text default null,
  p_signed_user_agent text default null
)
returns table(
  contract_id uuid,
  status text,
  signed_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contract record;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select c.id, c.artist_user_id, c.status, c.expires_at
    into v_contract
  from public.artist_contracts c
  where c.id = p_contract_id;

  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.artist_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_contract.status <> 'pending_signature' then
    raise exception 'cannot sign contract in status=%', v_contract.status;
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at < now() then
    -- 만료된 계약은 자동으로 expired 마킹 후 거절
    update public.artist_contracts set status = 'expired' where id = p_contract_id;
    raise exception 'contract expired at %', v_contract.expires_at;
  end if;

  update public.artist_contracts as c
  set status = 'signed',
      signed_at = now(),
      signed_ip = nullif(btrim(coalesce(p_signed_ip, '')), '')::inet,
      signed_user_agent = nullif(btrim(coalesce(p_signed_user_agent, '')), '')
  where c.id = p_contract_id;

  -- users.contract_status 동기화
  update public.users
  set contract_status = 'signed'
  where id = v_uid;

  return query
  select c.id, c.status::text, c.signed_at
  from public.artist_contracts c where c.id = p_contract_id;
end;
$$;

grant execute on function public.sign_artist_contract(uuid, text, text) to authenticated;

-- ----------------------
-- 7) reject_artist_contract — 아티스트 본인 거절
-- ----------------------
create or replace function public.reject_artist_contract(
  p_contract_id uuid,
  p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_contract record;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select c.id, c.artist_user_id, c.status into v_contract
  from public.artist_contracts c where c.id = p_contract_id;

  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.artist_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_contract.status <> 'pending_signature' then
    raise exception 'cannot reject contract in status=%', v_contract.status;
  end if;

  update public.artist_contracts
  set status = 'rejected',
      rejected_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      rejected_at = now()
  where id = p_contract_id;

  -- 다른 pending 계약이 없으면 user.contract_status='rejected'
  if not exists (
    select 1 from public.artist_contracts
    where artist_user_id = v_uid and status in ('pending_signature','signed')
  ) then
    update public.users set contract_status = 'rejected' where id = v_uid;
  end if;

  return p_contract_id;
end;
$$;

grant execute on function public.reject_artist_contract(uuid, text) to authenticated;

-- ----------------------
-- 8) get_my_contract — 본인 최신 계약서 조회
-- ----------------------
create or replace function public.get_my_contract()
returns table(
  id uuid,
  contract_version text,
  contract_title text,
  contract_body text,
  status text,
  pending_signature_at timestamptz,
  signed_at timestamptz,
  rejected_reason text,
  expires_at timestamptz,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then return; end if;

  return query
  select c.id, c.contract_version, c.contract_title, c.contract_body, c.status,
         c.pending_signature_at, c.signed_at, c.rejected_reason, c.expires_at, c.created_at
  from public.artist_contracts c
  where c.artist_user_id = v_uid
  order by
    case c.status when 'pending_signature' then 0 when 'signed' then 1 else 2 end,
    c.created_at desc
  limit 1;
end;
$$;

grant execute on function public.get_my_contract() to authenticated;

-- ----------------------
-- 9) admin_artist_contract_list — 관리자 목록 (검색 + 상태 필터)
-- ----------------------
create or replace function public.admin_artist_contract_list(
  p_status text default null,    -- 'pending_signature' | 'signed' | 'rejected' | 'expired'
  p_search text default null     -- artist email/nickname 검색
)
returns table(
  id uuid,
  artist_user_id uuid,
  artist_email text,
  artist_nickname text,
  contract_version text,
  contract_title text,
  status text,
  pending_signature_at timestamptz,
  signed_at timestamptz,
  rejected_reason text,
  rejected_at timestamptz,
  expires_at timestamptz,
  created_by uuid,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare
  v_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || btrim(p_search) || '%' end;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  return query
  select c.id, c.artist_user_id,
    coalesce(au.email::text, '')::text,
    coalesce(u.nickname, '')::text,
    c.contract_version, c.contract_title, c.status,
    c.pending_signature_at, c.signed_at, c.rejected_reason, c.rejected_at,
    c.expires_at, c.created_by, c.created_at
  from public.artist_contracts c
  join public.users u on u.id = c.artist_user_id
  left join auth.users au on au.id = c.artist_user_id
  where (p_status is null or c.status = p_status)
    and (
      v_pattern is null
      or coalesce(u.nickname, '') ilike v_pattern
      or coalesce(au.email::text, '') ilike v_pattern
    )
  order by c.created_at desc;
end;
$$;

grant execute on function public.admin_artist_contract_list(text, text) to authenticated;

-- ----------------------
-- 10) tracks_artist_insert RLS 갱신 — contract_status='signed' 게이트 추가
-- ----------------------
-- 원본 (0025): owner + source_type + visibility_status + artist approved + membership_tier=individual + payout verified
-- 추가: users.contract_status = 'signed'
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
        and u.membership_tier = 'individual'
        and u.contract_status = 'signed'   -- 0057 추가: 계약 서명 게이트
    )
    and exists (
      select 1 from public.artist_payout_accounts pa
      where pa.user_id = auth.uid()
        and pa.verification_status = 'verified'
    )
  );

-- ----------------------
-- 11) get_artist_upload_eligibility RPC 갱신 — contract 필드 추가
-- ----------------------
drop function if exists public.get_artist_upload_eligibility();

create or replace function public.get_artist_upload_eligibility()
returns table(
  can_upload boolean,
  is_artist boolean,
  approval_status text,
  has_paid_membership boolean,
  contract_status text,
  has_signed_contract boolean,
  pending_contract_id uuid,
  payout_status text,
  payout_account_id uuid,
  reasons text[]
)
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_tier text;
  v_ap_status text;
  v_contract_status text;
  v_pending_contract_id uuid;
  v_payout_id uuid;
  v_payout_status text;
  v_has_paid boolean;
  v_subs_exists boolean;
  v_reasons text[] := array[]::text[];
begin
  if v_uid is null then
    return query select
      false, false, 'unauthenticated'::text, false,
      'unauthenticated'::text, false, null::uuid,
      'unauthenticated'::text, null::uuid,
      array['login_required']::text[];
    return;
  end if;

  select account_type, membership_tier, contract_status
    into v_account_type, v_tier, v_contract_status
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

  -- pending_signature 계약 ID (UI 라우팅용)
  select id into v_pending_contract_id
  from public.artist_contracts
  where artist_user_id = v_uid and status = 'pending_signature'
  order by created_at desc limit 1;

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
  if coalesce(v_contract_status, 'not_created') <> 'signed' then
    v_reasons := array_append(v_reasons, 'no_signed_contract');
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
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'),
    v_payout_id,
    v_reasons;
end;
$$;

grant execute on function public.get_artist_upload_eligibility() to authenticated;
