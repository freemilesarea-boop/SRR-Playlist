-- 0305 — 정산 정보 신청 승인/반려 자동화 + needs_revision 추가 (X6.21)
--
-- payout_intake_submissions 의 운영 흐름 완성:
--   1) 'needs_revision' 상태 추가 (보완 요청)
--   2) admin_approve_payout_intake — 승인 시 자동 마이그레이션:
--      payout_intake_submissions → artist_payout_accounts (PII 그대로 복사)
--      verification_status='verified' 즉시 반영 → 정산 보류 해소 가능
--   3) admin_update_payout_intake_status 가 'needs_revision' 도 처리
--
-- legacy 41건 artist_payout_accounts 절대 자동 변경 금지.
-- 신규 INSERT/UPDATE 만 수행 (해당 사용자 user_id 기준).

-- ===== A. status 값 확장 =====
alter table public.payout_intake_submissions
  drop constraint if exists payout_intake_submissions_status_check;
alter table public.payout_intake_submissions
  add constraint payout_intake_submissions_status_check
  check (status in ('pending','approved','rejected','withdrawn','needs_revision'));

-- ===== B. admin_update_payout_intake_status — needs_revision 추가 =====
create or replace function public.admin_update_payout_intake_status(
  p_submission_id uuid, p_status text, p_reason text default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v_before text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized'; end if;
  if p_status not in ('approved','rejected','withdrawn','needs_revision') then
    raise exception 'invalid_status'; end if;
  if p_status in ('rejected','needs_revision') and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'reason_required'; end if;

  select status into v_before from public.payout_intake_submissions where id = p_submission_id;
  if v_before is null then raise exception 'submission_not_found'; end if;

  update public.payout_intake_submissions set
    status = p_status,
    approved_by = case when p_status = 'approved' then v_admin else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    rejected_reason = case when p_status in ('rejected','needs_revision') then btrim(p_reason)
                            when p_status = 'approved' then null
                            else rejected_reason end,
    updated_at = now()
  where id = p_submission_id;

  return jsonb_build_object('ok', true, 'submission_id', p_submission_id,
    'before', v_before, 'after', p_status);
end; $$;

-- ===== C. admin_approve_payout_intake — 승인 + 자동 마이그레이션 =====
-- payout_intake_submissions → artist_payout_accounts 로 PII 복사.
-- rrn_encrypted / account_number_encrypted 는 이미 vault 키로 암호화된 bytea 이므로 그대로 복사.
-- 해당 user_id 의 artist_payout_accounts 가 없으면 INSERT, 있으면 UPDATE.
create or replace function public.admin_approve_payout_intake(
  p_submission_id uuid,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := auth.uid();
  v_sub record;
  v_account_id uuid;
  v_consent_text text := '정산 및 원천징수 신고를 위해 주민등록번호를 수집·이용합니다. '
    || '수집된 정보는 세법상 신고 및 지급명세서 제출 목적으로만 사용됩니다.';
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized'; end if;

  select s.* into v_sub
  from public.payout_intake_submissions s where s.id = p_submission_id;
  if v_sub.id is null then raise exception 'submission_not_found'; end if;
  if v_sub.status = 'approved' then
    return jsonb_build_object('ok', true, 'noop', true, 'submission_id', p_submission_id);
  end if;

  -- 1) artist_payout_accounts upsert (해당 user_id 만)
  insert into public.artist_payout_accounts as a (
    user_id, bank_name, account_number, account_holder,
    legal_name, rrn_encrypted, account_number_encrypted,
    tax_withholding_type, tax_consent_at, tax_consent_text,
    verification_status, verified_by, verified_at
  ) values (
    v_sub.user_id, v_sub.bank_name,
    -- legacy 평문 컬럼은 더 이상 사용 안 함. placeholder 로 마스킹 패턴 저장.
    '**********',
    v_sub.account_holder, v_sub.legal_name,
    v_sub.rrn_encrypted, v_sub.account_number_encrypted,
    'business_income_3_3', now(), v_consent_text,
    'verified', v_admin, now()
  )
  on conflict (user_id) do update set
    bank_name = excluded.bank_name,
    account_number = excluded.account_number,
    account_holder = excluded.account_holder,
    legal_name = excluded.legal_name,
    rrn_encrypted = excluded.rrn_encrypted,
    account_number_encrypted = excluded.account_number_encrypted,
    tax_withholding_type = coalesce(a.tax_withholding_type, excluded.tax_withholding_type),
    tax_consent_at = coalesce(a.tax_consent_at, excluded.tax_consent_at),
    tax_consent_text = coalesce(a.tax_consent_text, excluded.tax_consent_text),
    verification_status = 'verified',
    verified_by = v_admin,
    verified_at = now(),
    rejected_reason = null,
    updated_at = now()
  returning id into v_account_id;

  -- 2) payout_intake_submissions 상태 업데이트
  update public.payout_intake_submissions set
    status = 'approved',
    approved_by = v_admin,
    approved_at = now(),
    rejected_reason = null,
    updated_at = now()
  where id = p_submission_id;

  -- 3) admin_log_operation (있으면)
  begin
    perform public.admin_log_operation(
      'admin_member_actions', 'payout', 'info', 'completed',
      format('approve payout_intake → artist_payout_accounts %s', v_account_id),
      jsonb_build_object('submission_id', p_submission_id, 'account_id', v_account_id,
                        'user_id', v_sub.user_id, 'reason', p_reason),
      v_sub.user_id, p_submission_id::text, null, null, null
    );
  exception when others then null; end;

  return jsonb_build_object(
    'ok', true,
    'submission_id', p_submission_id,
    'artist_payout_account_id', v_account_id,
    'user_id', v_sub.user_id,
    'verification_status', 'verified'
  );
end; $$;

revoke all on function public.admin_approve_payout_intake(uuid,text) from public, anon;
grant execute on function public.admin_approve_payout_intake(uuid,text) to authenticated, service_role;
