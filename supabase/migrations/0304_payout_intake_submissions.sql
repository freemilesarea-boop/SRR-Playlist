-- 0304 — 정산 정보 등록 문의 (Payout Intake Submissions) [X6.20]
--
-- 신규 문의 유형 '정산 정보 등록' 추가. 일반 문의와 분리된 전용 테이블에
-- PII (RRN/계좌) 를 vault 키로 암호화 저장. 운영팀 이메일에는 마스킹된
-- 내용만 발송.
--
-- 주의:
--   * 평문 저장 절대 금지 — pgp_sym_encrypt + vault 'payout_pii_key' 재사용
--   * 관리자만 reveal 가능 — admin_reveal_payout_intake_pii (audit 자동)
--   * 일반 admin_list/detail RPC 는 마스킹된 값만 반환
--   * 본인은 자기 제출 내역 조회 가능 (마스킹된 값만)

-- ===== A. inquiry_type CHECK 확장 =====
alter table public.support_inquiries
  drop constraint if exists support_inquiries_inquiry_type_check;
alter table public.support_inquiries
  add constraint support_inquiries_inquiry_type_check
  check (inquiry_type = any (array[
    '재생 오류'::text,
    '플레이리스트 문의'::text,
    '결제/구독 문의'::text,
    '정산 문의'::text,
    '정산 정보 등록'::text,   -- X6.20 신규
    '음원 등록 문의'::text,
    '계정/로그인 문의'::text,
    '기타'::text
  ]));

-- ===== B. payout_intake_submissions 테이블 =====
create table if not exists public.payout_intake_submissions (
  id uuid primary key default gen_random_uuid(),
  support_inquiry_id uuid references public.support_inquiries(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  -- 평문 텍스트 필드 (PII 분류상 민감)
  legal_name text not null,
  phone text not null,
  address text not null,
  bank_name text not null,
  account_holder text not null,
  -- 암호화 필드 (bytea, pgp_sym_encrypt)
  rrn_encrypted bytea not null,
  account_number_encrypted bytea not null,
  -- 신분증 첨부 (storage path)
  id_document_url text not null,
  id_document_filename text,
  id_document_size int,
  id_document_mime text,
  -- 운영 상태
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','withdrawn')),
  approved_by uuid references public.users(id) on delete set null,
  approved_at timestamptz,
  rejected_reason text,
  -- Google Sheets 적재 트래킹 (X6.20 준비)
  sheets_synced_at timestamptz,
  sheets_row_url text,
  -- 메타
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_pis_user on public.payout_intake_submissions(user_id);
create index if not exists idx_pis_status on public.payout_intake_submissions(status, created_at desc);
create index if not exists idx_pis_inquiry on public.payout_intake_submissions(support_inquiry_id);

alter table public.payout_intake_submissions enable row level security;

-- RLS: 본인 read (마스킹 RPC 통해서만 표시), admin all
drop policy if exists "pis self read" on public.payout_intake_submissions;
create policy "pis self read" on public.payout_intake_submissions for select to authenticated
  using (user_id = auth.uid());
drop policy if exists "pis admin all" on public.payout_intake_submissions;
create policy "pis admin all" on public.payout_intake_submissions for all to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== C. submit_payout_intake_inquiry RPC (단일 진입점) =====
-- 흐름:
--   1) RRN/계좌 정규화 + 검증
--   2) create_support_inquiry 호출 (body = 마스킹된 요약, attachments = 신분증)
--   3) payout_intake_submissions INSERT (vault 키로 즉시 암호화)
--   4) inquiry_id + submission_id 반환
create or replace function public.submit_payout_intake_inquiry(
  p_legal_name text,
  p_resident_registration_number text,
  p_phone text,
  p_address text,
  p_bank_name text,
  p_account_number text,
  p_account_holder text,
  p_id_document_url text,
  p_id_document_filename text default null,
  p_id_document_size int default null,
  p_id_document_mime text default null
) returns table(inquiry_id uuid, submission_id uuid)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_uid uuid := auth.uid();
  v_rrn_digits text;
  v_account_digits text;
  v_masked_rrn text;
  v_masked_acc text;
  v_key text;
  v_inquiry_id uuid;
  v_submission_id uuid;
  v_body text;
  v_attachments jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  -- 필수값 검증
  if p_legal_name is null or length(btrim(p_legal_name)) = 0 then raise exception 'legal_name_required'; end if;
  if p_phone is null or length(btrim(p_phone)) = 0 then raise exception 'phone_required'; end if;
  if p_address is null or length(btrim(p_address)) = 0 then raise exception 'address_required'; end if;
  if p_bank_name is null or length(btrim(p_bank_name)) = 0 then raise exception 'bank_name_required'; end if;
  if p_account_holder is null or length(btrim(p_account_holder)) = 0 then raise exception 'account_holder_required'; end if;
  if p_id_document_url is null or length(btrim(p_id_document_url)) = 0 then raise exception 'id_document_required'; end if;

  -- RRN 13자리 검증
  v_rrn_digits := regexp_replace(coalesce(p_resident_registration_number, ''), '\D', '', 'g');
  if length(v_rrn_digits) <> 13 then
    raise exception 'rrn_format_invalid' using hint = '주민등록번호 13자리를 정확히 입력해주세요.';
  end if;

  -- 계좌 숫자만 추출 (최소 6자리)
  v_account_digits := regexp_replace(coalesce(p_account_number, ''), '\D', '', 'g');
  if length(v_account_digits) < 6 then
    raise exception 'account_number_format_invalid';
  end if;

  v_key := public._payout_pii_key();
  v_masked_rrn := substring(v_rrn_digits from 1 for 6) || '-*******';
  v_masked_acc := public._mask_account_number(v_account_digits);

  -- 이메일/관리자 표시용 마스킹 body 생성 (PII 평문 절대 포함 X)
  v_body :=
    '[정산 정보 등록 신청]' || chr(10) ||
    '실명: ' || p_legal_name || chr(10) ||
    '주민번호: ' || v_masked_rrn || ' (암호화 저장)' || chr(10) ||
    '휴대폰: ' || p_phone || chr(10) ||
    '주소: ' || p_address || chr(10) ||
    '은행: ' || p_bank_name || chr(10) ||
    '계좌번호: ' || v_masked_acc || ' (암호화 저장)' || chr(10) ||
    '예금주: ' || p_account_holder || chr(10) ||
    '신분증: 첨부됨 (관리자 페이지에서 확인)' || chr(10) ||
    chr(10) ||
    '※ 원본 PII 는 관리자 화면에서 admin_reveal_payout_intake_pii RPC 로만 조회 가능.';

  v_attachments := jsonb_build_array(jsonb_build_object(
    'file_url', p_id_document_url,
    'file_name', coalesce(p_id_document_filename, '신분증'),
    'file_type', p_id_document_mime,
    'file_size', p_id_document_size
  ));

  -- support_inquiries 자동 INSERT
  select (create_support_inquiry(
    '정산 정보 등록',
    '[정산 정보 등록] ' || p_legal_name,
    v_body,
    null, p_phone, false, null, null,
    jsonb_build_object('topic', 'payout_intake', 'legal_name', p_legal_name),
    v_attachments
  ))->>'inquiry_id' into v_inquiry_id;

  -- payout_intake_submissions INSERT
  insert into public.payout_intake_submissions (
    support_inquiry_id, user_id, legal_name, phone, address,
    bank_name, account_holder,
    rrn_encrypted, account_number_encrypted,
    id_document_url, id_document_filename, id_document_size, id_document_mime,
    status
  ) values (
    v_inquiry_id, v_uid, btrim(p_legal_name), btrim(p_phone), btrim(p_address),
    btrim(p_bank_name), btrim(p_account_holder),
    pgp_sym_encrypt(v_rrn_digits, v_key)::bytea,
    pgp_sym_encrypt(v_account_digits, v_key)::bytea,
    btrim(p_id_document_url), p_id_document_filename, p_id_document_size, p_id_document_mime,
    'pending'
  ) returning id into v_submission_id;

  return query select v_inquiry_id, v_submission_id;
end; $$;

revoke all on function public.submit_payout_intake_inquiry(text,text,text,text,text,text,text,text,text,int,text) from public, anon;
grant execute on function public.submit_payout_intake_inquiry(text,text,text,text,text,text,text,text,text,int,text) to authenticated, service_role;

-- ===== D. admin_list_payout_intake — 마스킹 목록 =====
create or replace function public.admin_list_payout_intake(
  p_status text default null,
  p_limit int default 100
) returns table(
  submission_id uuid,
  support_inquiry_id uuid,
  user_id uuid,
  user_email text,
  legal_name text,
  masked_rrn text,
  phone text,
  address text,
  bank_name text,
  masked_account_number text,
  account_holder text,
  id_document_url text,
  id_document_filename text,
  status text,
  approved_at timestamptz,
  rejected_reason text,
  sheets_synced_at timestamptz,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized'; end if;
  return query
  select s.id, s.support_inquiry_id, s.user_id, au.email::text,
    s.legal_name,
    case when s.rrn_encrypted is null then null else '******-*******' end,
    s.phone, s.address, s.bank_name,
    public._mask_account_number(''),  -- 평문은 저장 안 되므로 표시용은 항상 마스킹 패턴
    s.account_holder, s.id_document_url, s.id_document_filename,
    s.status, s.approved_at, s.rejected_reason,
    s.sheets_synced_at, s.created_at
  from public.payout_intake_submissions s
  left join auth.users au on au.id = s.user_id
  where (p_status is null or s.status = p_status)
  order by case s.status when 'pending' then 0 when 'rejected' then 1 else 2 end,
           s.created_at desc
  limit greatest(p_limit, 1);
end; $$;

revoke all on function public.admin_list_payout_intake(text,int) from public, anon;
grant execute on function public.admin_list_payout_intake(text,int) to authenticated, service_role;

-- ===== E. admin_reveal_payout_intake_pii — RRN/계좌 평문 + audit =====
-- 기존 payout_account_reveal_logs 재사용 (payout_account_id 컬럼은 nullable 로 가정).
-- payout_account_id 가 nullable 이 아니면 별도 audit 테이블 필요. 확인 후 분기.
create or replace function public.admin_reveal_payout_intake_pii(
  p_submission_id uuid,
  p_reason text,
  p_pii_type text default 'full',
  p_user_agent text default null
) returns table(
  submission_id uuid,
  legal_name text,
  resident_registration_number text,
  account_number text,
  bank_name text,
  account_holder text,
  user_id uuid,
  log_id bigint,
  viewed_at timestamptz
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_admin uuid := auth.uid();
  v_sub record; v_key text; v_rrn text; v_acc_num text;
  v_log_id bigint;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized'; end if;
  if p_pii_type not in ('account_number','resident_number','full') then
    raise exception 'invalid_pii_type'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required'; end if;

  select s.id, s.user_id, s.legal_name, s.bank_name, s.account_holder,
         s.rrn_encrypted, s.account_number_encrypted
    into v_sub
  from public.payout_intake_submissions s where s.id = p_submission_id;
  if v_sub.id is null then raise exception 'submission_not_found'; end if;

  v_key := public._payout_pii_key();
  v_rrn := case when p_pii_type in ('resident_number','full')
                then pgp_sym_decrypt(v_sub.rrn_encrypted, v_key) else null end;
  v_acc_num := case when p_pii_type in ('account_number','full')
                    then pgp_sym_decrypt(v_sub.account_number_encrypted, v_key) else null end;

  -- audit log — 별도 테이블 (payout_intake_reveal_logs)
  insert into public.payout_intake_reveal_logs (
    submission_id, artist_user_id, viewed_by,
    reason, viewer_user_agent, pii_type
  ) values (
    v_sub.id, v_sub.user_id, v_admin,
    btrim(p_reason), p_user_agent, p_pii_type
  ) returning id into v_log_id;

  return query select
    v_sub.id, v_sub.legal_name, v_rrn, v_acc_num,
    v_sub.bank_name, v_sub.account_holder,
    v_sub.user_id, v_log_id, now();
end; $$;

-- ===== F. payout_intake_reveal_logs (PII 노출 감사) =====
create table if not exists public.payout_intake_reveal_logs (
  id bigserial primary key,
  submission_id uuid not null references public.payout_intake_submissions(id) on delete cascade,
  artist_user_id uuid not null references public.users(id) on delete cascade,
  viewed_by uuid not null references public.users(id) on delete set null,
  reason text not null,
  viewer_user_agent text,
  pii_type text not null check (pii_type in ('account_number','resident_number','full')),
  viewed_at timestamptz not null default now()
);

create index if not exists idx_pirl_submission on public.payout_intake_reveal_logs(submission_id, viewed_at desc);

alter table public.payout_intake_reveal_logs enable row level security;
drop policy if exists "pirl admin read" on public.payout_intake_reveal_logs;
create policy "pirl admin read" on public.payout_intake_reveal_logs for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

revoke all on function public.admin_reveal_payout_intake_pii(uuid,text,text,text) from public, anon;
grant execute on function public.admin_reveal_payout_intake_pii(uuid,text,text,text) to authenticated, service_role;

-- ===== G. admin_update_payout_intake_status (승인/반려) =====
create or replace function public.admin_update_payout_intake_status(
  p_submission_id uuid,
  p_status text,
  p_reason text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_before text;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized'; end if;
  if p_status not in ('approved','rejected','withdrawn') then
    raise exception 'invalid_status'; end if;
  if p_status = 'rejected' and (p_reason is null or length(btrim(p_reason)) = 0) then
    raise exception 'reason_required_for_rejection'; end if;

  select status into v_before from public.payout_intake_submissions where id = p_submission_id;
  if v_before is null then raise exception 'submission_not_found'; end if;

  update public.payout_intake_submissions set
    status = p_status,
    approved_by = case when p_status = 'approved' then v_admin else approved_by end,
    approved_at = case when p_status = 'approved' then now() else approved_at end,
    rejected_reason = case when p_status = 'rejected' then btrim(p_reason) else null end,
    updated_at = now()
  where id = p_submission_id;

  return jsonb_build_object('ok', true, 'submission_id', p_submission_id,
    'before', v_before, 'after', p_status);
end; $$;

revoke all on function public.admin_update_payout_intake_status(uuid,text,text) from public, anon;
grant execute on function public.admin_update_payout_intake_status(uuid,text,text) to authenticated, service_role;

-- ===== H. 본인 조회 RPC (마스킹) =====
create or replace function public.get_my_payout_intake_submissions(p_limit int default 10)
returns table(
  submission_id uuid,
  support_inquiry_id uuid,
  legal_name text,
  masked_rrn text,
  bank_name text,
  masked_account_number text,
  account_holder text,
  status text,
  rejected_reason text,
  created_at timestamptz,
  approved_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  return query
  select s.id, s.support_inquiry_id, s.legal_name,
    case when s.rrn_encrypted is null then null else '******-*******' end,
    s.bank_name,
    case when s.account_number_encrypted is null then null else '**********' end,
    s.account_holder, s.status, s.rejected_reason,
    s.created_at, s.approved_at
  from public.payout_intake_submissions s
  where s.user_id = v_uid
  order by s.created_at desc
  limit greatest(p_limit, 1);
end; $$;

revoke all on function public.get_my_payout_intake_submissions(int) from public, anon;
grant execute on function public.get_my_payout_intake_submissions(int) to authenticated, service_role;
