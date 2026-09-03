-- ============================================================================
-- 0498_eligibility_ambiguous_regression_hotfix.sql
--
-- HOTFIX — get_artist_upload_eligibility 42702 회귀 복구.
--
-- 사고 경위:
--   0495(B) 에서 has_paid_membership 판정을 바꾸면서 함수 본문을 **0063** 기준으로
--   다시 작성했다. 그런데 0063 이후 **0067_eligibility_ambiguous_fix** 가 이미
--   같은 함수를 고쳐 놓은 상태였고(대문자 CREATE OR REPLACE 로 작성돼 있어 소문자
--   grep 에 걸리지 않았다), 0495 가 그 핫픽스를 통째로 덮어썼다.
--
-- 증상 (2026-09-03 운영):
--   RETURNS TABLE 의 OUT 컬럼(contract_status / approval_status)과 본문의 bare 컬럼
--   참조가 충돌 → 모든 로그인 아티스트에게
--     ERROR 42702: column reference "contract_status" is ambiguous
--   프론트는 eligibility 를 null 로 폴백 →
--     · 프로필의 '아티스트 관리' 버튼이 '계약서 확인하기' 로 바뀜
--     · 아티스트 대시보드에 월 결제 요구 카드가 노출
--   → 정상 결제 회원까지 "결제하라고 뜬다" 는 문의가 다수 발생.
--
-- 조치:
--   0067 의 alias 정규화(u./ap./pa./c.)를 복원하고, 그 위에 0495 의 판정 변경
--   (has_paid_membership = artist_has_paid_access)만 다시 얹는다.
--   반환 컬럼/시그니처/게이트 로직은 불변 → 프론트 수정 불필요.
--
-- 재발 방지:
--   기존 함수를 재정의하기 전에 **대소문자 무시**로 최신 정의를 찾을 것.
--     grep -rlni "create or replace function public.<이름>" supabase/migrations
--   docs/MIGRATION_RULES.md 에 규칙으로 추가했다.
-- ============================================================================

create or replace function public.get_artist_upload_eligibility()
returns table (
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
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_tier text;
  v_paid boolean;            -- 0495: membership_tier 대신 실제 구독 상태 기준 판정
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

  -- 0067: u.* 로 정규화 — bare contract_status 가 OUT 파라미터와 충돌하지 않도록
  select u.account_type, u.membership_tier, u.artist_approval_status, u.contract_status
    into v_account_type, v_tier, v_users_approval, v_contract_status
  from public.users u where u.id = v_uid;

  -- 0067: ap.approval_status 로 정규화 — OUT approval_status 와 충돌 차단
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

  -- 0495: 실제 결제 게이트(artist_has_paid_access)와 판정을 일치시킨다.
  --       0496 이후 이 게이트는 "결제한 이용기간이 남아 있으면 해지 예약이어도 허용".
  v_paid := public.artist_has_paid_access(v_uid);
  if not v_paid then
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
    v_paid,
    coalesce(v_contract_status, 'not_created'),
    (coalesce(v_contract_status, 'not_created') = 'signed'),
    v_pending_contract_id,
    coalesce(v_payout_status, 'none'),
    v_payout_id,
    (current_date + interval '3 days')::date,
    v_reasons;
end;
$function$;

grant execute on function public.get_artist_upload_eligibility() to authenticated;

-- PostgREST 스키마 캐시 갱신
notify pgrst, 'reload schema';

-- ============================================================================
-- 운영 확인 (실행 안 함)
-- ============================================================================
-- 전 아티스트 대상으로 42702 없이 호출되는지 확인:
-- do $$
-- declare r record; e record; err int := 0;
-- begin
--   for r in select u.id from public.users u where u.account_type='artist' loop
--     begin
--       perform set_config('request.jwt.claims',
--         json_build_object('sub', r.id::text, 'role','authenticated')::text, true);
--       select * into e from public.get_artist_upload_eligibility();
--     exception when others then err := err + 1;
--     end;
--   end loop;
--   raise notice '실패=%', err;   -- 0 이어야 정상
-- end $$;
