-- 0532_admin_update_artist_payout_account.sql
--
-- 관리자가 정산 계좌(은행·계좌번호·예금주)를 직접 고칠 수 있게 한다.
--
-- 배경
--   지금까지 계좌를 바꾸는 길은 아티스트 본인이 submit_artist_payout_account_v2 또는
--   submit_payout_intake_inquiry 로 재제출하는 것뿐이었다. 둘 다 auth.uid() 로 본인을
--   확인하고 주민등록번호·신분증을 다시 요구한다. 그래서 "은행만 바꿔달라" 는 고객센터
--   문의가 와도 운영자가 처리할 수단이 없었고, 아티스트에게 전체 재제출을 요구해야 했다.
--
-- 왜 직접 UPDATE 로는 안 되는가
--   계좌번호는 평문이 아니다. artist_payout_accounts.account_number 는 마스킹 패턴만
--   담는 레거시 컬럼이고, 실제 값은 _payout_pii_key() 로 암호화된
--   account_number_encrypted 에 있다. 평문을 써넣으면 admin_reveal_payout_account 가
--   복호화하지 못해 지급 담당자가 계좌를 볼 수 없게 된다.
--
-- 설계
--   · 관리자 전용. 사유(p_reason) 필수 — 감사 기록에 남는다.
--   · 신원 정보는 건드리지 않는다. legal_name · rrn_encrypted · 세금 동의
--     (tax_consent_at/text/ip/user_agent) 는 그대로 둔다. 이 함수는 "돈이 가는 곳"만
--     바꾸고 "누구인지" 는 바꾸지 않는다. 명의자가 실제로 바뀌는 건이라면 아티스트가
--     신분증과 함께 재제출하는 기존 경로를 써야 한다.
--   · artist_payout_account_changes 에 변경 전/후를 남긴다. 미지급 정산 건수·금액을
--     같이 적어 둔다 — 지급 직전에 계좌가 바뀐 건을 나중에 추적할 수 있어야 한다.
--   · 바뀐 값이 없으면 아무것도 쓰지 않고 noop 으로 돌려준다.

create or replace function public.admin_update_artist_payout_account(
  p_account_id uuid,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_reason text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_admin uuid := auth.uid();
  v_prev public.artist_payout_accounts%rowtype;
  v_key text;
  v_acct_digits text;
  v_new_masked text;
  v_prev_acct_digits text;
  v_changed text[] := '{}';
  v_pending_cnt int := 0;
  v_pending_amt bigint := 0;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required' using hint = '변경 사유는 감사 기록에 남습니다.';
  end if;
  if p_bank_name is null or length(btrim(p_bank_name)) = 0 then
    raise exception 'bank_name_required';
  end if;
  if p_account_holder is null or length(btrim(p_account_holder)) = 0 then
    raise exception 'account_holder_required';
  end if;

  select * into v_prev from public.artist_payout_accounts a where a.id = p_account_id;
  if v_prev.id is null then
    raise exception 'account_not_found';
  end if;

  v_acct_digits := regexp_replace(coalesce(p_account_number, ''), '\D', '', 'g');
  if length(v_acct_digits) < 6 then
    raise exception 'account_number_format_invalid' using hint = '계좌번호 숫자를 정확히 입력해주세요.';
  end if;

  v_key := public._payout_pii_key();
  v_new_masked := public._mask_account_number(v_acct_digits);

  -- 이전 계좌번호와 실제로 다른지 본다. 복호화가 깨져 있으면 마스킹 값으로 비교한다.
  begin
    v_prev_acct_digits := case
      when v_prev.account_number_encrypted is null then null
      else pgp_sym_decrypt(v_prev.account_number_encrypted, v_key)
    end;
  exception when others then
    v_prev_acct_digits := null;
  end;

  if v_prev_acct_digits is null then
    if coalesce(v_prev.account_number, '') is distinct from coalesce(v_new_masked, '') then
      v_changed := array_append(v_changed, 'account_number');
    end if;
  elsif v_prev_acct_digits is distinct from v_acct_digits then
    v_changed := array_append(v_changed, 'account_number');
  end if;

  if coalesce(v_prev.bank_name, '') is distinct from btrim(p_bank_name) then
    v_changed := array_append(v_changed, 'bank_name');
  end if;
  if coalesce(v_prev.account_holder, '') is distinct from btrim(p_account_holder) then
    v_changed := array_append(v_changed, 'account_holder');
  end if;

  if array_length(v_changed, 1) is null then
    return jsonb_build_object('ok', true, 'noop', true, 'account_id', p_account_id,
      'message', '바뀐 값이 없습니다.');
  end if;

  -- 지급 직전 변경을 추적할 수 있도록 미지급 정산 현황을 함께 기록한다.
  select count(*)::int, coalesce(sum(s.total_settlement_amount), 0)::bigint
    into v_pending_cnt, v_pending_amt
    from public.artist_settlements s
   where s.artist_user_id = v_prev.user_id
     and s.status in ('pending', 'held');

  update public.artist_payout_accounts a set
    bank_name                = btrim(p_bank_name),
    account_number           = v_new_masked,
    account_holder           = btrim(p_account_holder),
    account_number_encrypted = pgp_sym_encrypt(v_acct_digits, v_key)::bytea,
    -- 신원·세금 정보는 유지한다 (legal_name, rrn_encrypted, tax_consent_*).
    verification_status      = 'verified',
    verified_by              = v_admin,
    verified_at              = now(),
    rejected_reason          = null,
    updated_at               = now()
  where a.id = p_account_id;

  insert into public.artist_payout_account_changes (
    user_id, account_id, change_type,
    prev_legal_name, prev_bank_name, prev_masked_account_number,
    prev_account_holder, prev_tax_withholding_type, prev_verification_status,
    new_legal_name, new_bank_name, new_masked_account_number,
    new_account_holder, new_tax_withholding_type,
    changed_fields, pending_settlement_count, pending_settlement_amount,
    status, reviewed_by, reviewed_at, review_note, requested_user_agent
  ) values (
    v_prev.user_id, p_account_id, 'update',
    v_prev.legal_name, v_prev.bank_name, v_prev.account_number,
    v_prev.account_holder, v_prev.tax_withholding_type, v_prev.verification_status,
    v_prev.legal_name, btrim(p_bank_name), v_new_masked,
    btrim(p_account_holder), v_prev.tax_withholding_type,
    v_changed, v_pending_cnt, v_pending_amt,
    'approved', v_admin, now(), btrim(p_reason), p_user_agent
  );

  return jsonb_build_object(
    'ok', true,
    'account_id', p_account_id,
    'changed_fields', to_jsonb(v_changed),
    'masked_account_number', v_new_masked,
    'pending_settlement_count', v_pending_cnt,
    'pending_settlement_amount', v_pending_amt
  );
end;
$function$;

grant execute on function public.admin_update_artist_payout_account(
  uuid, text, text, text, text, text) to authenticated;
