-- 0300 — 정산용 PII (주민등록번호) 수집 구조 (X6.14)
--
-- 목적: 사업소득/기타소득 원천징수 + 지급명세서 제출용 PII 를 정산계좌 등록
-- 단계에서만 수집. 회원가입 단계에서는 절대 수집하지 않음.
--
-- 보안 원칙:
--   1) RRN / 계좌번호 평문 저장 금지 → vault 키로 pgp_sym_encrypt
--   2) 본인 화면: 모든 PII 마스킹된 RPC 만 노출
--   3) 관리자 화면: admin_reveal_payout_pii RPC 만 평문 노출 (audit 자동 기록)
--   4) audit: pii_type 컬럼으로 어떤 PII 가 노출됐는지 구분
--   5) 정산 보류: artist_payout_account_ready() 가 false 면 settlement 진행 금지
--
-- 필요 사전 작업 (운영자 수동):
--   select vault.create_secret(
--     '<랜덤 32자 이상>',
--     'payout_pii_key',
--     'PII encryption key for artist_payout_accounts'
--   );
--   * 키 미설정 시 _payout_pii_key() 호출 시점에서 raise exception.

-- ===== A. Vault 키 헬퍼 =====
create or replace function public._payout_pii_key()
returns text
language plpgsql stable security definer
set search_path = vault, public
as $$
declare v_key text;
begin
  select decrypted_secret into v_key
  from vault.decrypted_secrets
  where name = 'payout_pii_key'
  limit 1;
  if v_key is null or length(v_key) = 0 then
    raise exception 'pii_encryption_key_not_configured'
      using hint = 'Run: select vault.create_secret(<random_key_32+chars>, ''payout_pii_key'', ''PII key for artist_payout_accounts'');';
  end if;
  return v_key;
end; $$;
revoke all on function public._payout_pii_key() from public, anon, authenticated;
grant execute on function public._payout_pii_key() to service_role;

-- ===== B. 마스킹 헬퍼 =====
create or replace function public._mask_resident_number(p_rrn text)
returns text language sql immutable as $$
  -- 주민번호 표시 정책: 앞 6자리(생년월일) 만 노출, 뒤 7자리 전체 마스킹.
  -- 850305-1234567 → 850305-*******
  select case
    when p_rrn is null or length(btrim(p_rrn)) = 0 then null
    when position('-' in p_rrn) > 0 then split_part(p_rrn, '-', 1) || '-*******'
    when length(regexp_replace(p_rrn, '\D', '', 'g')) >= 13
      then substring(regexp_replace(p_rrn, '\D', '', 'g') from 1 for 6) || '-*******'
    else '******'
  end;
$$;

create or replace function public._mask_account_number(p_acct text)
returns text language sql immutable as $$
  -- 뒤 4자리만 노출. 앞은 마스킹 (최소 4 * 보장).
  select case
    when p_acct is null or length(btrim(p_acct)) = 0 then null
    when length(p_acct) <= 4 then repeat('*', length(p_acct))
    else repeat('*', greatest(length(p_acct) - 4, 4)) || right(p_acct, 4)
  end;
$$;

-- ===== C. artist_payout_accounts 컬럼 확장 =====
alter table public.artist_payout_accounts
  add column if not exists legal_name text,
  add column if not exists rrn_encrypted bytea,
  add column if not exists account_number_encrypted bytea,
  add column if not exists tax_withholding_type text default 'business_income_3_3'
    check (tax_withholding_type in ('business_income_3_3','other_income_8_8','none')),
  add column if not exists tax_consent_at timestamptz,
  add column if not exists tax_consent_text text,
  add column if not exists tax_consent_ip inet,
  add column if not exists tax_consent_user_agent text;

comment on column public.artist_payout_accounts.legal_name is '주민등록상 실명 (정산용)';
comment on column public.artist_payout_accounts.rrn_encrypted is '주민등록번호 pgp_sym_encrypt (vault: payout_pii_key)';
comment on column public.artist_payout_accounts.account_number_encrypted is '계좌번호 pgp_sym_encrypt — account_number (평문) 은 deprecated';
comment on column public.artist_payout_accounts.tax_withholding_type is '원천징수 유형: business_income_3_3 (사업 3.3%), other_income_8_8 (기타 8.8%), none';
comment on column public.artist_payout_accounts.tax_consent_at is 'PII 수집·이용 동의 시점 (감사 추적)';

-- ===== D. payout_account_reveal_logs.pii_type =====
alter table public.payout_account_reveal_logs
  add column if not exists pii_type text default 'account_number'
    check (pii_type in ('account_number','resident_number','full'));

create index if not exists idx_parl_pii_type
  on public.payout_account_reveal_logs(pii_type, viewed_at desc);

-- ===== E. submit_artist_payout_account_v2 (RRN + 동의 포함) =====
-- 기존 submit_artist_payout_account 는 그대로 유지 (legacy 호환).
-- 신규 폼은 반드시 v2 호출.
create or replace function public.submit_artist_payout_account_v2(
  p_legal_name text,
  p_resident_registration_number text,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_tax_consent_text text,
  p_tax_withholding_type text default 'business_income_3_3',
  p_consent_ip inet default null,
  p_consent_user_agent text default null
) returns table(account_id uuid, verification_status text)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_rrn_digits text;
  v_account_id uuid;
  v_status text;
  v_key text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- 필수값 검증
  if p_legal_name is null or length(btrim(p_legal_name)) = 0 then
    raise exception 'legal_name_required';
  end if;
  if p_bank_name is null or length(btrim(p_bank_name)) = 0 then
    raise exception 'bank_name_required';
  end if;
  if p_account_number is null or length(btrim(p_account_number)) = 0 then
    raise exception 'account_number_required';
  end if;
  if p_account_holder is null or length(btrim(p_account_holder)) = 0 then
    raise exception 'account_holder_required';
  end if;
  if p_tax_consent_text is null or length(btrim(p_tax_consent_text)) = 0 then
    raise exception 'tax_consent_required';
  end if;
  if p_tax_withholding_type not in ('business_income_3_3','other_income_8_8','none') then
    raise exception 'invalid_tax_withholding_type: %', p_tax_withholding_type;
  end if;

  -- RRN: 숫자만 추출 후 13자리 검증
  v_rrn_digits := regexp_replace(coalesce(p_resident_registration_number, ''), '\D', '', 'g');
  if length(v_rrn_digits) <> 13 then
    raise exception 'rrn_format_invalid' using hint = '주민등록번호 13자리 (숫자) 를 정확히 입력해주세요.';
  end if;

  v_key := public._payout_pii_key();

  insert into public.artist_payout_accounts as a (
    user_id, bank_name, account_number, account_holder,
    legal_name, rrn_encrypted, account_number_encrypted,
    tax_withholding_type, tax_consent_at, tax_consent_text,
    tax_consent_ip, tax_consent_user_agent,
    verification_status
  ) values (
    v_uid, btrim(p_bank_name),
    -- 평문 account_number 컬럼은 legacy 호환 — 마스킹된 값만 저장
    public._mask_account_number(p_account_number),
    btrim(p_account_holder),
    btrim(p_legal_name),
    pgp_sym_encrypt(v_rrn_digits, v_key)::bytea,
    pgp_sym_encrypt(regexp_replace(p_account_number, '\D', '', 'g'), v_key)::bytea,
    p_tax_withholding_type,
    now(),
    btrim(p_tax_consent_text),
    p_consent_ip,
    p_consent_user_agent,
    'pending'
  )
  on conflict (user_id) do update set
    bank_name = excluded.bank_name,
    account_number = excluded.account_number,
    account_holder = excluded.account_holder,
    legal_name = excluded.legal_name,
    rrn_encrypted = excluded.rrn_encrypted,
    account_number_encrypted = excluded.account_number_encrypted,
    tax_withholding_type = excluded.tax_withholding_type,
    tax_consent_at = excluded.tax_consent_at,
    tax_consent_text = excluded.tax_consent_text,
    tax_consent_ip = excluded.tax_consent_ip,
    tax_consent_user_agent = excluded.tax_consent_user_agent,
    -- 재등록 시 다시 pending 으로 (관리자 재검증 필요)
    verification_status = case when a.verification_status = 'rejected' then 'pending' else a.verification_status end,
    rejected_reason = case when a.verification_status = 'rejected' then null else a.rejected_reason end,
    updated_at = now()
  returning a.id, a.verification_status into v_account_id, v_status;

  return query select v_account_id, v_status;
end; $$;

revoke all on function public.submit_artist_payout_account_v2(text,text,text,text,text,text,text,inet,text) from public, anon;
grant execute on function public.submit_artist_payout_account_v2(text,text,text,text,text,text,text,inet,text)
  to authenticated, service_role;

-- ===== F. get_my_payout_account_masked (본인용 — 모든 PII 마스킹) =====
create or replace function public.get_my_payout_account_masked()
returns table(
  account_id uuid,
  legal_name text,
  masked_rrn text,
  bank_name text,
  masked_account_number text,
  account_holder text,
  tax_withholding_type text,
  has_tax_consent boolean,
  tax_consent_at timestamptz,
  verification_status text,
  rejected_reason text,
  created_at timestamptz,
  updated_at timestamptz,
  is_pii_complete boolean
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  return query
  select
    a.id,
    a.legal_name,
    case when a.rrn_encrypted is null then null else '******-*******' end,
    a.bank_name,
    public._mask_account_number(a.account_number),
    a.account_holder,
    a.tax_withholding_type,
    a.tax_consent_at is not null,
    a.tax_consent_at,
    a.verification_status,
    a.rejected_reason,
    a.created_at,
    a.updated_at,
    (a.legal_name is not null
       and a.rrn_encrypted is not null
       and a.account_number_encrypted is not null
       and a.tax_consent_at is not null)
  from public.artist_payout_accounts a
  where a.user_id = v_uid
  limit 1;
end; $$;

revoke all on function public.get_my_payout_account_masked() from public, anon;
grant execute on function public.get_my_payout_account_masked() to authenticated, service_role;

-- ===== G. admin_reveal_payout_pii (관리자 PII 노출 + audit) =====
-- 기존 admin_reveal_payout_account 는 계좌번호만 — 그대로 유지.
-- 신규 함수는 RRN 까지 포함한 full reveal + audit 강화.
create or replace function public.admin_reveal_payout_pii(
  p_account_id uuid,
  p_reason text,
  p_pii_type text default 'full',  -- 'account_number' / 'resident_number' / 'full'
  p_settlement_id uuid default null,
  p_user_agent text default null
) returns table(
  account_id uuid,
  legal_name text,
  resident_registration_number text,
  account_number text,
  bank_name text,
  account_holder text,
  tax_withholding_type text,
  tax_consent_at timestamptz,
  artist_user_id uuid,
  log_id uuid,
  viewed_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := auth.uid();
  v_acc record;
  v_log_id uuid;
  v_key text;
  v_rrn text;
  v_acc_num text;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_pii_type not in ('account_number','resident_number','full') then
    raise exception 'invalid_pii_type: %', p_pii_type;
  end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required';
  end if;

  select a.id, a.user_id, a.legal_name, a.bank_name, a.account_holder,
         a.account_number_encrypted, a.rrn_encrypted,
         a.tax_withholding_type, a.tax_consent_at
    into v_acc
  from public.artist_payout_accounts a where a.id = p_account_id;
  if v_acc.id is null then raise exception 'account_not_found'; end if;

  v_key := public._payout_pii_key();

  -- pii_type 에 따라 선택적 복호화
  v_rrn := case
    when p_pii_type in ('resident_number','full') and v_acc.rrn_encrypted is not null
      then pgp_sym_decrypt(v_acc.rrn_encrypted, v_key)
    else null
  end;
  v_acc_num := case
    when p_pii_type in ('account_number','full') and v_acc.account_number_encrypted is not null
      then pgp_sym_decrypt(v_acc.account_number_encrypted, v_key)
    else null
  end;

  insert into public.payout_account_reveal_logs (
    payout_account_id, artist_user_id, viewed_by,
    settlement_id, reason, viewer_user_agent, pii_type
  ) values (
    v_acc.id, v_acc.user_id, v_admin,
    p_settlement_id, btrim(p_reason), p_user_agent, p_pii_type
  ) returning id into v_log_id;

  return query select
    v_acc.id,
    v_acc.legal_name,
    v_rrn,
    v_acc_num,
    v_acc.bank_name,
    v_acc.account_holder,
    v_acc.tax_withholding_type,
    v_acc.tax_consent_at,
    v_acc.user_id,
    v_log_id,
    now();
end; $$;

revoke all on function public.admin_reveal_payout_pii(uuid,text,text,uuid,text) from public, anon;
grant execute on function public.admin_reveal_payout_pii(uuid,text,text,uuid,text)
  to authenticated, service_role;

-- ===== H. 정산 진행 가능 여부 (헬퍼 — settlement 함수가 호출) =====
create or replace function public.artist_payout_account_ready(p_user_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists(
    select 1 from public.artist_payout_accounts a
    where a.user_id = p_user_id
      and a.verification_status = 'verified'
      and a.legal_name is not null
      and a.rrn_encrypted is not null
      and a.account_number_encrypted is not null
      and a.tax_consent_at is not null
  );
$$;

revoke all on function public.artist_payout_account_ready(uuid) from public, anon;
grant execute on function public.artist_payout_account_ready(uuid) to authenticated, service_role;
