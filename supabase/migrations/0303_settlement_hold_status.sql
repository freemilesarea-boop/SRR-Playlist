-- 0303 — 정산 보류 상태 안내 RPC (X6.16)
--
-- 본인 화면에서 4가지 보류 사유를 한 번에 확인할 수 있도록:
--   - rrn_missing            : 주민등록번호 미등록
--   - account_missing        : 정산계좌 미등록
--   - identity_not_verified  : 본인인증 미완료
--   - account_not_verified   : 계좌 검증 미완료 (관리자 승인 대기/반려)
--
-- 추가로 누적 예상 정산금 (held 또는 carried_over 상태 합계).
-- 정산금은 소멸하지 않고 carried_over_amount 컬럼으로 누적.

create or replace function public.get_my_settlement_hold_status()
returns table(
  is_held boolean,
  hold_reasons text[],
  identity_verified boolean,
  has_payout_account boolean,
  payout_account_status text,
  has_rrn boolean,
  has_tax_consent boolean,
  has_account_number boolean,
  held_settlement_count int,
  pending_payout_amount bigint,
  carried_over_amount bigint,
  total_pending_amount bigint,
  last_settlement_month date
)
language plpgsql stable security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_reasons text[] := array[]::text[];
  v_identity boolean;
  v_account record;
  v_held_count int;
  v_payout bigint;
  v_carried bigint;
  v_last_month date;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- 본인인증 상태
  select coalesce(u.identity_verified, false) into v_identity
  from public.users u where u.id = v_uid;

  -- 정산계좌 + PII 상태
  select
    a.id is not null as has_account,
    a.verification_status,
    a.rrn_encrypted is not null as has_rrn,
    a.tax_consent_at is not null as has_consent,
    a.account_number_encrypted is not null as has_acc_num
  into v_account
  from public.artist_payout_accounts a
  where a.user_id = v_uid
  limit 1;

  -- 보류 사유 수집 (우선순위 순서)
  if not v_identity then
    v_reasons := array_append(v_reasons, 'identity_not_verified');
  end if;
  if v_account.has_account is not true then
    v_reasons := array_append(v_reasons, 'account_missing');
  else
    if not v_account.has_rrn then
      v_reasons := array_append(v_reasons, 'rrn_missing');
    end if;
    if not v_account.has_acc_num then
      v_reasons := array_append(v_reasons, 'account_missing');
    end if;
    if v_account.verification_status <> 'verified' then
      v_reasons := array_append(v_reasons, 'account_not_verified');
    end if;
  end if;

  -- 보류 정산 건수 + 누적 금액 (held + carried_over 둘 다 합산)
  select
    count(*) filter (where s.status = 'held'),
    coalesce(sum(s.final_payout_amount) filter (where s.status = 'held'), 0)::bigint,
    coalesce(sum(s.carried_over_amount) filter (where s.status in ('held','carried_over')), 0)::bigint,
    max(s.settlement_month)
  into v_held_count, v_payout, v_carried, v_last_month
  from public.artist_settlements s
  where s.artist_user_id = v_uid;

  return query select
    (array_length(v_reasons, 1) > 0 or v_held_count > 0),
    v_reasons,
    v_identity,
    coalesce(v_account.has_account, false),
    v_account.verification_status,
    coalesce(v_account.has_rrn, false),
    coalesce(v_account.has_consent, false),
    coalesce(v_account.has_acc_num, false),
    v_held_count,
    v_payout,
    v_carried,
    (v_payout + v_carried),
    v_last_month;
end; $$;

revoke all on function public.get_my_settlement_hold_status() from public, anon;
grant execute on function public.get_my_settlement_hold_status() to authenticated, service_role;
