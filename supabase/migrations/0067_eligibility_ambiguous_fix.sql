-- 0067 — get_artist_upload_eligibility column ambiguity 핫픽스
--
-- 증상:
--   POST /rest/v1/rpc/get_artist_upload_eligibility 400
--   code 42702 — column reference "contract_status" is ambiguous
--   PL/pgSQL variable or table column 둘 다 매칭.
--
-- 원인:
--   RETURNS TABLE 의 OUT 컬럼 `contract_status`, `approval_status` 가
--   PL/pgSQL 내부에서 자동으로 변수로 노출됨. 함수 본문의 bare 참조가
--   테이블 컬럼과 충돌하여 42702 error.
--   - SELECT ... contract_status FROM public.users → OUT contract_status 충돌
--   - SELECT approval_status FROM public.artist_profiles → OUT approval_status 충돌
--
-- 조치:
--   모든 bare 컬럼 참조를 테이블 alias 로 정규화 (u.*, ap.*, pa.*, c.*).
--   RETURNS TABLE 컬럼명 / RLS 조건 / 게이트 로직 모두 그대로 유지.
--   동일 함수 내 다른 컬럼들도 검토 — payout_status 는 verification_status
--   를 INTO 받으므로 ambiguous 아님. is_artist / can_upload / has_paid_membership /
--   payout_account_id / min_release_date / reasons 는 테이블 컬럼 충돌 없음.
--
-- 검증:
--   SELECT * FROM get_artist_upload_eligibility() — 비로그인 시 login_required reason 반환
--   PostgREST NOTIFY 로 스키마 캐시 갱신

CREATE OR REPLACE FUNCTION public.get_artist_upload_eligibility()
RETURNS TABLE (
  can_upload boolean,
  is_artist boolean,
  approval_status text,
  has_paid_membership boolean,
  contract_status text,
  has_signed_contract boolean,
  pending_contract_id uuid,
  payout_status text,
  payout_account_id uuid,
  min_release_date date,
  reasons text[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
      (current_date + interval '3 days')::date, array['login_required']::text[];
    return;
  end if;

  -- u.* 로 정규화 — bare contract_status 가 OUT 파라미터와 충돌하지 않도록
  select u.account_type, u.membership_tier, u.artist_approval_status, u.contract_status
    into v_account_type, v_tier, v_users_approval, v_contract_status
  from public.users u where u.id = v_uid;

  -- ap.approval_status 로 정규화 — OUT approval_status 와 충돌 차단
  select ap.approval_status into v_profile_approval
  from public.artist_profiles ap where ap.user_id = v_uid;

  select pa.id, pa.verification_status into v_payout_id, v_payout_status
  from public.artist_payout_accounts pa where pa.user_id = v_uid;

  select c.id into v_pending_contract_id
  from public.artist_contracts c
  where c.artist_user_id = v_uid and c.status = 'pending_signature'
  order by c.created_at desc limit 1;

  if v_account_type is null or v_account_type <> 'artist' then
    v_reasons := array_append(v_reasons, 'not_artist');
  end if;

  if coalesce(v_users_approval, 'pending') <> 'approved' then
    if coalesce(v_profile_approval, '') = 'approved' then
      v_reasons := array_append(v_reasons, 'approval_sync_broken');
    else
      v_reasons := array_append(v_reasons, 'artist_not_approved');
    end if;
  end if;

  if coalesce(v_tier, 'free') <> 'individual' then
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
    coalesce(v_users_approval, 'none'),
    (coalesce(v_tier, 'free') = 'individual'),
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'),
    v_payout_id,
    (current_date + interval '3 days')::date,
    v_reasons;
end;
$function$;

-- PostgREST 스키마 캐시 갱신
NOTIFY pgrst, 'reload schema';
