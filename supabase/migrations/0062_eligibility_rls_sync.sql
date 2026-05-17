-- ============================================
-- 0062_eligibility_rls_sync.sql
--
-- 긴급 수정: get_artist_upload_eligibility ↔ tracks_artist_insert RLS 조건 통일.
-- 사용자가 eligibility=true 인데 RLS 가 차단하는 상황 방지.
--
-- 변경:
--   1) eligibility RPC 를 RLS 조건과 1:1 매칭
--      - membership_tier='individual' 만 (business 제외 — 0025 시점에는 둘 다 허용했음)
--      - users.artist_approval_status='approved' 직접 검증 (artist_profiles 와 별개)
--      - users.contract_status='signed' 검증
--      - artist_payout_accounts.verification_status='verified' 검증
--   2) sync 불일치 자체 reason 추가:
--      - 'approval_sync_broken' — artist_profiles 만 approved, users 는 pending
--      → 운영자에게 즉시 가시화 (debug 용)
--   3) 운영 데이터 sync 복구: users.artist_approval_status 와
--      artist_profiles.approval_status 가 다른 row 보정
--
-- RLS 는 변경하지 않음 (RLS 가 진실의 단일 source).
-- ============================================

-- ----------------------
-- 1) 운영 데이터 sync 복구
--    artist_profiles.approval_status='approved' 인데 users.artist_approval_status<>'approved' 인 row 보정
-- ----------------------
update public.users u
set artist_approval_status = ap.approval_status
from public.artist_profiles ap
where ap.user_id = u.id
  and u.account_type = 'artist'
  and ap.approval_status = 'approved'
  and coalesce(u.artist_approval_status, '') <> 'approved';

-- ----------------------
-- 2) get_artist_upload_eligibility — RLS 조건과 1:1 매칭
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
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_tier text;
  v_users_approval text;
  v_profile_approval text;
  v_contract_status text;
  v_pending_contract_id uuid;
  v_payout_id uuid;
  v_payout_status text;
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

  -- RLS 가 보는 컬럼들 직접 확인
  select account_type, membership_tier, artist_approval_status, contract_status
    into v_account_type, v_tier, v_users_approval, v_contract_status
  from public.users where id = v_uid;

  -- artist_profiles 도 확인 (sync 진단용)
  select approval_status into v_profile_approval
  from public.artist_profiles where user_id = v_uid;

  -- payout
  select id, verification_status into v_payout_id, v_payout_status
  from public.artist_payout_accounts where user_id = v_uid;

  -- 가장 최근 pending 계약 (UI 가 ArtistContractPage 로 라우팅하기 위함)
  select id into v_pending_contract_id
  from public.artist_contracts
  where artist_user_id = v_uid and status = 'pending_signature'
  order by created_at desc limit 1;

  -- ===== RLS 조건과 1:1 매칭 =====
  if v_account_type is null or v_account_type <> 'artist' then
    v_reasons := array_append(v_reasons, 'not_artist');
  end if;

  -- approval: RLS 는 users.artist_approval_status 만 봄.
  -- 만약 artist_profiles 만 approved 이고 users 는 pending 이면 sync 깨짐 — 별도 reason
  if coalesce(v_users_approval, 'pending') <> 'approved' then
    if coalesce(v_profile_approval, '') = 'approved' then
      v_reasons := array_append(v_reasons, 'approval_sync_broken');
    else
      v_reasons := array_append(v_reasons, 'artist_not_approved');
    end if;
  end if;

  -- membership: RLS 는 'individual' 만 허용 (4,900원 plan_type)
  if coalesce(v_tier, 'free') <> 'individual' then
    v_reasons := array_append(v_reasons, 'no_paid_membership');
  end if;

  -- contract: RLS 는 'signed' 만 허용
  if coalesce(v_contract_status, 'not_created') <> 'signed' then
    v_reasons := array_append(v_reasons, 'no_signed_contract');
  end if;

  -- payout
  if v_payout_id is null then
    v_reasons := array_append(v_reasons, 'no_payout_account');
  elsif v_payout_status <> 'verified' then
    v_reasons := array_append(v_reasons, 'payout_not_verified');
  end if;

  return query select
    (array_length(v_reasons, 1) is null),
    (v_account_type = 'artist'),
    coalesce(v_users_approval, 'none'),    -- RLS 가 보는 값 노출
    (coalesce(v_tier, 'free') = 'individual'),
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'),
    v_payout_id,
    v_reasons;
end;
$$;

grant execute on function public.get_artist_upload_eligibility() to authenticated;
