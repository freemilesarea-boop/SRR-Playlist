-- ============================================================================
-- 0495 — 정산 계좌 변경 신청 (PAYOUT-ACCOUNT-CHANGE-1)
--
-- 배경:
--   계좌 등록/변경 경로가 둘인데 통제가 한쪽에만 있었다.
--     ① PayoutIntakeForm → submit_payout_intake_inquiry → payout_intake_submissions
--        → 관리자가 admin_approve_payout_intake 로 승인.  (관리자 검증 O)
--     ② 아티스트 대시보드 → submit_artist_payout_account_v2
--        → artist_payout_accounts 에 직접 upsert.          (관리자 검증 X)
--
--   ②의 0300 정의에는 이런 주석이 달려 있다:
--       -- 재등록 시 다시 pending 으로 (관리자 재검증 필요)
--       verification_status = case when a.verification_status = 'rejected'
--                                  then 'pending' else a.verification_status end
--   주석은 "재등록하면 pending" 이라고 하는데, 코드는 rejected 였던 것만 되돌린다.
--   즉 이미 verified 인 아티스트가 계좌번호를 바꾸면 verified 가 그대로 유지되고,
--   관리자는 바뀐 사실조차 알 수 없다. 다음 정산이 검증 없이 새 계좌로 나간다.
--   게다가 on conflict do update 는 제자리 덮어쓰기라 변경 이력이 0 이다 —
--   누가 언제 어느 계좌에서 어느 계좌로 바꿨는지 사후 복원이 불가능하다.
--   (운영 DB 기준 계좌 102건 전부 verified, 그중 90건이 생성 후 수정된 이력 보유.)
--
--   지금까지 사고가 없었던 이유는 순전히 UI 때문이다. ArtistDashboardPage 의
--     showForm = !masked || !masked.is_pii_complete || status === 'rejected'
--   조건 탓에 verified + PII 완비 아티스트에겐 폼이 아예 렌더되지 않는다.
--   구멍은 RPC 레벨에만 뚫려 있고 화면으로는 닿지 않았다. 그래서 아티스트는
--   계좌를 못 바꾸고 운영팀에 카톡/메일로 요청하게 되고, 관리자가 대신 처리한다.
--
-- 이 마이그레이션이 하는 일 — ①의 "신청 → 승인" 패턴을 ②에 이식한다:
--   1. artist_payout_account_changes  변경 이력/신청 테이블 (마스킹 스냅샷만 보관)
--   2. submit_artist_payout_account_v2 재정의
--        · 지급에 영향 있는 항목이 실제로 바뀌면 verification_status 를 무조건 pending
--          으로 되돌린다 (0300 주석이 원래 의도했던 동작).
--        · 변경 전/후 마스킹 스냅샷 + 변경 필드 + 신청 시점 지급 대기 금액을 기록.
--        · 바뀐 게 없으면(재동의 등) 상태를 건드리지 않는다 — 헛되이 지급을 막지 않기 위해.
--   3. verify/reject_artist_payout_account 가 열린 신청을 함께 종결 (승인자·시각 기록)
--   4. admin_list_payout_account_changes / get_my_payout_account_changes 조회 RPC
--   5. admin_work_queue_counts 에 payout_change 카운트 추가
--
-- 지급 보류는 자동으로 걸린다:
--   artist_payout_account_ready() 가 verification_status='verified' 를 요구하므로,
--   pending 으로 되돌리는 것만으로 승인 전까지 지급 대상에서 빠진다.
--   → 별도의 하드 블록을 두지 않는다. 현재 artist_settlements 는 pending 이 40건이라
--     "지급 대기 중이면 변경 차단" 규칙을 넣으면 사실상 상시 차단이 된다.
--     대신 신청 시점의 대기 건수/금액을 스냅샷으로 남겨 관리자가 위험도를 보고 판단한다.
--
-- 소급 적용 없음:
--   기존 90건을 pending 으로 되돌리면 정산이 전부 멈춘다. 앞으로의 변경분부터 적용한다.
--   이력 테이블도 빈 상태로 시작한다(과거 변경은 복원할 데이터가 없음).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1) 변경 이력 / 신청 테이블
-- ---------------------------------------------------------------------------
create table if not exists public.artist_payout_account_changes (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null references auth.users(id) on delete cascade,
  account_id                uuid references public.artist_payout_accounts(id) on delete set null,

  -- 'create' = 최초 등록, 'update' = 기존 계좌 변경
  change_type               text not null check (change_type in ('create', 'update')),

  -- 변경 전 스냅샷. 마스킹된 값만 남긴다 — 평문/암호문 사본을 이력에 복제하지 않는다
  -- (PII 보관처를 늘리지 않기 위해. 원본 확인은 계좌 테이블 + RevealPiiButton 경로 유지).
  prev_legal_name           text,
  prev_bank_name            text,
  prev_masked_account_number text,
  prev_account_holder       text,
  prev_tax_withholding_type text,
  prev_verification_status  text,

  -- 변경 후 스냅샷 (동일하게 마스킹)
  new_legal_name            text,
  new_bank_name             text,
  new_masked_account_number text,
  new_account_holder        text,
  new_tax_withholding_type  text,

  -- 실제로 바뀐 항목. 관리자가 "계좌번호만 바뀐 건지 명의까지 바뀐 건지" 를 즉시 구분.
  changed_fields            text[] not null default '{}',

  -- 신청 시점의 지급 대기 스냅샷 — 지급 직전 계좌 변경이 가장 위험하므로 위험도 표시용.
  pending_settlement_count  int    not null default 0,
  pending_settlement_amount bigint not null default 0,

  status                    text not null default 'pending'
                              check (status in ('pending', 'approved', 'rejected')),
  reviewed_by               uuid references auth.users(id),
  reviewed_at               timestamptz,
  review_note               text,

  requested_ip              inet,
  requested_user_agent      text,
  created_at                timestamptz not null default now()
);

comment on table public.artist_payout_account_changes is
  '정산 계좌 등록/변경 신청 및 이력 (0495). 마스킹 스냅샷만 보관 — 평문/암호문 미복제.';

create index if not exists idx_payout_account_changes_user
  on public.artist_payout_account_changes (user_id, created_at desc);

-- 관리자 대기 목록 전용 — pending 만 인덱싱해서 102건 전수 스캔을 피한다.
create index if not exists idx_payout_account_changes_open
  on public.artist_payout_account_changes (created_at desc)
  where status = 'pending';

alter table public.artist_payout_account_changes enable row level security;

-- 쓰기는 전부 SECURITY DEFINER 함수만 — 클라이언트 직접 INSERT/UPDATE 경로를 열지 않는다.
drop policy if exists payout_account_changes_select_own on public.artist_payout_account_changes;
create policy payout_account_changes_select_own
  on public.artist_payout_account_changes
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists payout_account_changes_select_admin on public.artist_payout_account_changes;
create policy payout_account_changes_select_admin
  on public.artist_payout_account_changes
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

revoke all on public.artist_payout_account_changes from public, anon;
grant select on public.artist_payout_account_changes to authenticated;
grant all    on public.artist_payout_account_changes to service_role;

-- ---------------------------------------------------------------------------
-- 2) submit_artist_payout_account_v2 — 변경 시 재검증 강제 + 이력 기록
--
--    0300 정의를 기반으로 하되, upsert 전에 기존 행을 읽어 비교하고
--    (a) 지급에 영향 있는 변경이면 verification_status 를 pending 으로 되돌린 뒤
--    (b) 변경 이력 행을 남긴다.
--    검증/암호화/마스킹 로직은 0300 그대로 — 손대지 않는다.
-- ---------------------------------------------------------------------------
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
)
returns table(account_id uuid, verification_status text)
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rrn_digits text;
  v_acct_digits text;
  v_account_id uuid;
  v_status text;
  v_key text;
  v_prev public.artist_payout_accounts%rowtype;
  v_prev_acct_digits text;
  v_changed text[] := '{}';
  v_change_type text;
  v_next_status text;
  v_pending_cnt int := 0;
  v_pending_amt bigint := 0;
  v_new_masked text;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_legal_name is null or length(btrim(p_legal_name)) = 0 then raise exception 'legal_name_required'; end if;
  if p_bank_name is null or length(btrim(p_bank_name)) = 0 then raise exception 'bank_name_required'; end if;
  if p_account_number is null or length(btrim(p_account_number)) = 0 then raise exception 'account_number_required'; end if;
  if p_account_holder is null or length(btrim(p_account_holder)) = 0 then raise exception 'account_holder_required'; end if;
  if p_tax_consent_text is null or length(btrim(p_tax_consent_text)) = 0 then raise exception 'tax_consent_required'; end if;
  if p_tax_withholding_type not in ('business_income_3_3','other_income_8_8','none') then
    raise exception 'invalid_tax_withholding_type: %', p_tax_withholding_type; end if;

  v_rrn_digits := regexp_replace(coalesce(p_resident_registration_number, ''), '\D', '', 'g');
  if length(v_rrn_digits) <> 13 then
    raise exception 'rrn_format_invalid' using hint = '주민등록번호 13자리를 정확히 입력해주세요.';
  end if;
  v_acct_digits := regexp_replace(p_account_number, '\D', '', 'g');
  v_key := public._payout_pii_key();
  -- 마스킹은 하이픈을 제거한 숫자 기준으로 만든다.
  -- 0300 은 원본 입력을 그대로 마스킹해서, 같은 계좌라도 '110-123-456789' 와
  -- '110123456789' 가 서로 다른 마스킹 문자열이 됐다(별 개수가 다름).
  -- 이력의 before/after 를 나란히 보여줘야 하므로 정규화된 형태로 통일한다.
  v_new_masked := public._mask_account_number(v_acct_digits);

  -- ── 변경 판정 (upsert 전에 읽어야 한다) ────────────────────────────────
  select * into v_prev from public.artist_payout_accounts a where a.user_id = v_uid;

  if not found then
    v_change_type := 'create';
    v_next_status := 'pending';
    v_changed := array['legal_name','bank_name','account_number','account_holder','tax_withholding_type'];
  else
    v_change_type := 'update';

    -- 계좌번호는 마스킹 비교로는 앞자리 변경을 놓친다. 복호화해서 숫자로 비교한다.
    -- (키 회전 등으로 복호화가 실패하면 마스킹 비교로 안전하게 후퇴 — 판정을 못 하느니
    --  '바뀌었다'로 보수적으로 처리되는 쪽이 낫다.)
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

    if coalesce(v_prev.bank_name, '')       is distinct from btrim(p_bank_name)       then v_changed := array_append(v_changed, 'bank_name'); end if;
    if coalesce(v_prev.account_holder, '')  is distinct from btrim(p_account_holder)  then v_changed := array_append(v_changed, 'account_holder'); end if;
    if coalesce(v_prev.legal_name, '')      is distinct from btrim(p_legal_name)      then v_changed := array_append(v_changed, 'legal_name'); end if;
    if coalesce(v_prev.tax_withholding_type, '') is distinct from p_tax_withholding_type then v_changed := array_append(v_changed, 'tax_withholding_type'); end if;
    -- 주민번호 변경은 복호화 비교로 판정 (명의 도용 시도를 놓치지 않기 위해).
    begin
      if v_prev.rrn_encrypted is null
         or pgp_sym_decrypt(v_prev.rrn_encrypted, v_key) is distinct from v_rrn_digits then
        v_changed := array_append(v_changed, 'resident_registration_number');
      end if;
    exception when others then
      v_changed := array_append(v_changed, 'resident_registration_number');
    end;

    -- 재검증 규칙:
    --   · 지급에 영향 있는 항목이 바뀌었다 → 무조건 pending (0300 주석의 원래 의도)
    --   · rejected 였다 → pending (0300 기존 동작 유지)
    --   · 바뀐 게 없다(재동의 등) → 상태 유지. 멀쩡한 계좌의 지급을 헛되이 막지 않는다.
    v_next_status := case
      when array_length(v_changed, 1) > 0 then 'pending'
      when v_prev.verification_status = 'rejected' then 'pending'
      else v_prev.verification_status
    end;

    -- 신청 시점 지급 대기 스냅샷 (관리자 위험도 판단용)
    if array_length(v_changed, 1) > 0 then
      select count(*)::int, coalesce(sum(s.total_settlement_amount), 0)::bigint
        into v_pending_cnt, v_pending_amt
      from public.artist_settlements s
      where s.artist_user_id = v_uid and s.status in ('pending', 'held');
    end if;
  end if;

  -- ── upsert (0300 그대로, verification_status 계산만 교체) ──────────────
  insert into public.artist_payout_accounts as a (
    user_id, bank_name, account_number, account_holder,
    legal_name, rrn_encrypted, account_number_encrypted,
    tax_withholding_type, tax_consent_at, tax_consent_text,
    tax_consent_ip, tax_consent_user_agent, verification_status
  ) values (
    v_uid, btrim(p_bank_name),
    v_new_masked,
    btrim(p_account_holder), btrim(p_legal_name),
    pgp_sym_encrypt(v_rrn_digits, v_key)::bytea,
    pgp_sym_encrypt(v_acct_digits, v_key)::bytea,
    p_tax_withholding_type, now(), btrim(p_tax_consent_text),
    p_consent_ip, p_consent_user_agent, 'pending'
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
    verification_status = v_next_status,
    -- pending 으로 되돌아가면 이전 승인 흔적을 남겨두지 않는다.
    -- (승인 이력은 artist_payout_account_changes 가 보관한다.)
    verified_by  = case when v_next_status = 'verified' then a.verified_by  else null end,
    verified_at  = case when v_next_status = 'verified' then a.verified_at  else null end,
    rejected_reason = case when v_next_status = 'rejected' then a.rejected_reason else null end,
    updated_at = now()
  returning a.id, a.verification_status into v_account_id, v_status;

  -- ── 이력 기록 ─────────────────────────────────────────────────────────
  -- 최초 등록이거나 실제 변경이 있을 때만. 재동의만 한 경우는 남기지 않는다(노이즈).
  if v_change_type = 'create' or array_length(v_changed, 1) > 0 then
    insert into public.artist_payout_account_changes (
      user_id, account_id, change_type,
      prev_legal_name, prev_bank_name, prev_masked_account_number,
      prev_account_holder, prev_tax_withholding_type, prev_verification_status,
      new_legal_name, new_bank_name, new_masked_account_number,
      new_account_holder, new_tax_withholding_type,
      changed_fields, pending_settlement_count, pending_settlement_amount,
      status, requested_ip, requested_user_agent
    ) values (
      v_uid, v_account_id, v_change_type,
      v_prev.legal_name, v_prev.bank_name, v_prev.account_number,
      v_prev.account_holder, v_prev.tax_withholding_type, v_prev.verification_status,
      btrim(p_legal_name), btrim(p_bank_name), v_new_masked,
      btrim(p_account_holder), p_tax_withholding_type,
      v_changed, v_pending_cnt, v_pending_amt,
      case when v_status = 'verified' then 'approved' else 'pending' end,
      p_consent_ip, p_consent_user_agent
    );
  end if;

  return query select v_account_id, v_status;
end; $function$;

revoke all on function public.submit_artist_payout_account_v2(text,text,text,text,text,text,text,inet,text) from public, anon;
grant execute on function public.submit_artist_payout_account_v2(text,text,text,text,text,text,text,inet,text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3) 승인/거절이 열린 신청을 함께 종결
--    (승인 버튼은 그대로 — 관리자 동선 변경 없음. 이력만 닫힌다.)
-- ---------------------------------------------------------------------------
create or replace function public.verify_artist_payout_account(p_account_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- 0495: 열려 있는 변경 신청 종결
  update public.artist_payout_account_changes
  set status = 'approved', reviewed_by = auth.uid(), reviewed_at = now()
  where account_id = p_account_id and status = 'pending';
end;
$function$;

create or replace function public.reject_artist_payout_account(p_account_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
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

  -- 0495: 열려 있는 변경 신청 종결 (사유를 이력에도 남긴다)
  update public.artist_payout_account_changes
  set status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
      review_note = nullif(btrim(coalesce(p_reason, '')), '')
  where account_id = p_account_id and status = 'pending';
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4) 조회 RPC
-- ---------------------------------------------------------------------------

-- 관리자: 변경 신청 목록. 기본은 대기 건만.
create or replace function public.admin_list_payout_account_changes(
  p_status text default 'pending',
  p_limit  int  default 100
)
returns table(
  change_id uuid,
  account_id uuid,
  user_id uuid,
  artist_name text,
  email text,
  change_type text,
  changed_fields text[],
  prev_legal_name text,
  prev_bank_name text,
  prev_masked_account_number text,
  prev_account_holder text,
  prev_verification_status text,
  new_legal_name text,
  new_bank_name text,
  new_masked_account_number text,
  new_account_holder text,
  pending_settlement_count int,
  pending_settlement_amount bigint,
  status text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select
    c.id, c.account_id, c.user_id,
    ap.artist_name, au.email::text,
    c.change_type, c.changed_fields,
    c.prev_legal_name, c.prev_bank_name, c.prev_masked_account_number,
    c.prev_account_holder, c.prev_verification_status,
    c.new_legal_name, c.new_bank_name, c.new_masked_account_number,
    c.new_account_holder,
    c.pending_settlement_count, c.pending_settlement_amount,
    c.status, c.reviewed_at, c.review_note, c.created_at
  from public.artist_payout_account_changes c
  left join public.artist_profiles ap on ap.user_id = c.user_id
  left join auth.users au on au.id = c.user_id
  where p_status is null or p_status = 'all' or c.status = p_status
  order by
    case c.status when 'pending' then 0 else 1 end,
    c.created_at desc
  limit greatest(1, p_limit);
end;
$function$;

revoke all on function public.admin_list_payout_account_changes(text, int) from public, anon;
grant execute on function public.admin_list_payout_account_changes(text, int) to authenticated, service_role;

-- 아티스트 본인: 내 변경 신청 이력 (마스킹된 값만).
create or replace function public.get_my_payout_account_changes(p_limit int default 10)
returns table(
  change_id uuid,
  change_type text,
  changed_fields text[],
  prev_bank_name text,
  prev_masked_account_number text,
  new_bank_name text,
  new_masked_account_number text,
  new_account_holder text,
  status text,
  review_note text,
  reviewed_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  return query
  select c.id, c.change_type, c.changed_fields,
         c.prev_bank_name, c.prev_masked_account_number,
         c.new_bank_name, c.new_masked_account_number, c.new_account_holder,
         c.status, c.review_note, c.reviewed_at, c.created_at
  from public.artist_payout_account_changes c
  where c.user_id = v_uid
  order by c.created_at desc
  limit greatest(1, p_limit);
end;
$function$;

revoke all on function public.get_my_payout_account_changes(int) from public, anon;
grant execute on function public.get_my_payout_account_changes(int) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5) 홈 처리 대기 줄에 '계좌 변경 신청' 추가
--
--    payout_verify(계좌 확인 대기)에 이미 포함되는 값이지만 별도로 뽑는다 —
--    신규 등록 대기와 "이미 승인된 계좌가 바뀐 것" 은 위험도가 다르고,
--    후자는 정산이 이미 잡혀 있을 수 있어 먼저 봐야 한다.
--
--    0489 본문을 여기에 복사하면 두 벌이 되어 다음 수정 때 드리프트가 난다.
--    그래서 0485/0494 와 같은 방식으로, 현재 정의를 읽어 세 군데만 치환한다.
--    앵커가 하나라도 안 맞으면 예외로 중단한다(조용히 반쯤 적용되는 것을 막는다).
-- ---------------------------------------------------------------------------
do $patch$
declare
  v_src  text;
  v_out  text;
  v_a_old text; v_a_new text;
  v_b_old text; v_b_new text;
  v_c_old text; v_c_new text;
begin
  select pg_get_functiondef(p.oid) into v_src
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'admin_work_queue_counts';

  if v_src is null then
    raise exception '0495: admin_work_queue_counts() 없음 — 0489 선행 필요';
  end if;

  if position('payout_change' in v_src) > 0 then
    raise notice '0495: admin_work_queue_counts() 이미 패치됨 — 건너뜀';
    return;
  end if;

  -- (a) 선언부
  v_a_old := E'  v_payout_incomplete   int := 0;';
  v_a_new := E'  v_payout_incomplete   int := 0;\n  v_payout_change       int := 0;   -- 0495';

  -- (b) 집계부 — 미완비 집계 바로 뒤에 붙인다
  v_b_old := E'  -- 정산 지급 대기 — admin_pending_settlement_alert() (0476) 과 동일(최신 정산월 한정).';
  v_b_new := E'  -- 계좌 변경 신청 대기 (0495) — payout_verify 에 포함되는 값이지만 따로 센다.\n'
          || E'  -- 신규 등록 대기와 달리 "이미 승인된 계좌가 바뀐 것" 이라 정산이 이미 잡혀 있을 수 있다.\n'
          || E'  select count(*) into v_payout_change\n'
          || E'  from public.artist_payout_account_changes c\n'
          || E'  where c.status = ''pending'' and c.change_type = ''update'';\n\n'
          || v_b_old;

  -- (c) 출력부
  v_c_old := E'    ''payout_incomplete'',   v_payout_incomplete,';
  v_c_new := E'    ''payout_incomplete'',   v_payout_incomplete,\n    ''payout_change'',       v_payout_change,';

  if position(v_a_old in v_src) = 0 then raise exception '0495: 앵커 (a) 불일치'; end if;
  if position(v_b_old in v_src) = 0 then raise exception '0495: 앵커 (b) 불일치'; end if;
  if position(v_c_old in v_src) = 0 then raise exception '0495: 앵커 (c) 불일치'; end if;

  v_out := replace(v_src, v_a_old, v_a_new);
  v_out := replace(v_out, v_b_old, v_b_new);
  v_out := replace(v_out, v_c_old, v_c_new);

  execute v_out;
end;
$patch$;

revoke all on function public.admin_work_queue_counts() from public, anon;
grant execute on function public.admin_work_queue_counts() to authenticated, service_role;
