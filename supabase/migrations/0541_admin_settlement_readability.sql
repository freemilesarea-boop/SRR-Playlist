-- 0541_admin_settlement_readability.sql
-- SETTLEMENT-UX-1 — Artist Settlement Admin Readability & Secure Payout Identity Center.
--
-- 절대 조건(전부 준수):
--  * Settlement Engine/Algorithm/Shadow Compare 계산/Payment Engine/Version 계산/정산 결과 — 일절 변경 없음.
--  * 이 파일의 RPC 는 전부 "읽기 전용 재조합 조회"(+ 접근 Audit INSERT)만 수행한다.
--  * 기존 함수(admin_settlement_v2_compare/admin_reveal_payout_pii 등)와 기존 테이블
--    (artist_settlements/artist_settlements_v2/artist_payout_accounts/payout_account_reveal_logs)은
--    정의를 변경하지 않는다(참조만).
--  * 개인정보: 주민번호/계좌번호 기본 마스킹(_mask_resident_number/_mask_account_number 0300 재사용).
--    원문 열람은 기존 admin_reveal_payout_pii(자동 Audit) 경유만 — 본 파일은 원문 반환 RPC 를 만들지 않는다.
--  * 조회/복사/다운로드 Audit: settlement_admin_access_logs (append-only).
--  * 차이 이유(reason)는 기존 저장 값의 성분 분해 후보이며 계산 변경이 아니다(reason_is_candidate).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) 관리자 접근 Audit (append-only) — 조회/복사/다운로드 기록.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.settlement_admin_access_logs (
  id                uuid primary key default gen_random_uuid(),
  action            text not null check (action in ('list_view','detail_view','shadow_view','history_view','kpi_view','copy_masked_value','copy_revealed_value','export_download','search_query')),
  target_type       text not null default 'settlement' check (target_type in ('settlement','payout_account','shadow_compare','kpi','history','export')),
  settlement_id     uuid,
  artist_user_id    uuid,
  detail            text,
  payload           jsonb,
  viewer_id         uuid,
  viewed_at         timestamptz not null default now()
);
create index if not exists idx_saal_action on public.settlement_admin_access_logs(action, viewed_at desc);
create index if not exists idx_saal_viewer on public.settlement_admin_access_logs(viewer_id, viewed_at desc);

create or replace function public._settlement_access_logs_protect()
returns trigger language plpgsql as $$
begin
  if TG_OP in ('UPDATE','DELETE') then
    raise exception 'settlement_admin_access_logs is append-only' using errcode = '42501';
  end if;
  return NEW;
end $$;
drop trigger if exists trg_saal_protect on public.settlement_admin_access_logs;
create trigger trg_saal_protect
  before update or delete on public.settlement_admin_access_logs
  for each row execute function public._settlement_access_logs_protect();

alter table public.settlement_admin_access_logs enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 안전 마스킹 헬퍼 — 암호화 RRN 을 "마스킹 형태(930101-*******)"로만 반환.
--    vault 키 미설정/복호화 실패 시 예외 대신 null (목록이 죽지 않도록).
--    원문은 절대 반환하지 않는다.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public._settlement_masked_rrn(p_rrn_encrypted bytea)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare v_key text; v_plain text;
begin
  if p_rrn_encrypted is null then return null; end if;
  begin
    v_key := public._payout_pii_key();
    v_plain := pgp_sym_decrypt(p_rrn_encrypted, v_key);
  exception when others then
    return null;   -- 키 미설정/복호화 실패 — 원문도 마스킹도 불가(미상 유지)
  end;
  return public._mask_resident_number(v_plain);
end $$;
revoke all on function public._settlement_masked_rrn(bytea) from public, anon, authenticated;

create or replace function public._settlement_masked_account(p_encrypted bytea, p_plain_deprecated text, p_snapshot_masked text)
returns text language plpgsql stable security definer set search_path = public, extensions as $$
declare v_key text; v_plain text;
begin
  -- 우선순위: 암호화본 복호화 후 마스킹 → v1 snapshot masked → deprecated 평문 마스킹.
  if p_encrypted is not null then
    begin
      v_key := public._payout_pii_key();
      v_plain := pgp_sym_decrypt(p_encrypted, v_key);
      return public._mask_account_number(v_plain);
    exception when others then null; end;
  end if;
  if p_snapshot_masked is not null and length(p_snapshot_masked) > 0 then return p_snapshot_masked; end if;
  return public._mask_account_number(p_plain_deprecated);
end $$;
revoke all on function public._settlement_masked_account(bytea, text, text) from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 접근 Audit 기록 RPC (조회/복사/다운로드).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_access_record(p_action text, p_target_type text, p_detail text, p_payload jsonb default '{}'::jsonb, p_settlement_id uuid default null, p_artist_user_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  v_uid := auth.uid();
  if p_action not in ('list_view','detail_view','shadow_view','history_view','kpi_view','copy_masked_value','copy_revealed_value','export_download','search_query') then
    raise exception '허용되지 않는 action';
  end if;
  if p_target_type not in ('settlement','payout_account','shadow_compare','kpi','history','export') then raise exception '허용되지 않는 target_type'; end if;
  if pg_column_size(coalesce(p_payload, '{}'::jsonb)) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.settlement_admin_access_logs (action, target_type, settlement_id, artist_user_id, detail, payload, viewer_id)
  values (p_action, p_target_type, p_settlement_id, p_artist_user_id, left(coalesce(p_detail,''), 300), coalesce(p_payload, '{}'::jsonb), v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'pii_revealed', false, 'settlement_modified', false);
end $$;

create or replace function public.admin_settlement_access_audit(p_limit int default 100)
returns setof public.settlement_admin_access_logs language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  return query select * from public.settlement_admin_access_logs order by viewed_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 가독 목록 — 이름 중심(UUID 는 개발자 모드 필드로만 포함). 읽기 전용 재조합.
--    검색: 아티스트명/회원명/닉네임/이메일/은행/계좌 끝4자리. 필터: 상태/월/유형/은행/금액범위.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_readable_list(
  p_month date default null, p_status text default null, p_search text default null,
  p_bank text default null, p_entity_type text default null,
  p_min_amount bigint default null, p_max_amount bigint default null, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  if p_status is not null and p_status not in ('pending','carried_over','payable','paid','held','disputed') then
    raise exception '허용되지 않는 status';
  end if;
  select coalesce(jsonb_agg(row_j order by settlement_month desc, artist_name), '[]'::jsonb) into v
  from (
    select
      s.id as settlement_id, s.artist_user_id, s.settlement_month, s.status,
      ap.artist_name, ap.real_name, u.nickname, ap.email,
      s.gross_settlement_amount, s.company_fee_amount, s.sales_agent_fee_amount,
      s.withholding_tax_amount, s.artist_net_settlement, s.previous_carried_amount,
      s.final_payout_amount, s.carried_over_amount, s.paid_at,
      coalesce(pa.bank_name, s.payout_bank_name) as bank_name,
      coalesce(pa.account_holder, s.payout_account_holder) as account_holder,
      public._settlement_masked_account(pa.account_number_encrypted, pa.account_number, s.masked_account_number) as masked_account_number,
      public._settlement_masked_rrn(pa.rrn_encrypted) as masked_resident_number,
      case
        when pa.id is null then 'unregistered'
        when pa.verification_status = 'verified' then 'verified'
        when pa.verification_status = 'rejected' then 'verification_failed'
        else 'verification_pending' end as account_status,
      pa.tax_withholding_type,
      case when pa.tax_withholding_type = 'business_income_3_3' then 'business'
           when pa.tax_withholding_type = 'other_income_8_8' then 'individual_other_income'
           when pa.tax_withholding_type = 'none' then 'none'
           else 'unknown' end as entity_type,
      (pa.rrn_encrypted is not null) as rrn_registered,
      jsonb_build_object('settlement_id', s.id, 'artist_user_id', s.artist_user_id, 'payout_account_id', pa.id, 'policy_id', s.policy_id, 'version_note', 'v1(0060)') as developer_fields
    from public.artist_settlements s
    left join public.artist_profiles ap on ap.user_id = s.artist_user_id
    left join public.users u on u.id = s.artist_user_id
    left join public.artist_payout_accounts pa on pa.user_id = s.artist_user_id
    where (p_month is null or s.settlement_month = p_month)
      and (p_status is null or s.status = p_status)
      and (p_bank is null or coalesce(pa.bank_name, s.payout_bank_name) ilike '%' || p_bank || '%')
      and (p_entity_type is null
           or (p_entity_type = 'business' and pa.tax_withholding_type = 'business_income_3_3')
           or (p_entity_type = 'individual_other_income' and pa.tax_withholding_type = 'other_income_8_8'))
      and (p_min_amount is null or s.final_payout_amount >= p_min_amount)
      and (p_max_amount is null or s.final_payout_amount <= p_max_amount)
      and (p_search is null or btrim(p_search) = ''
           or ap.artist_name ilike '%' || p_search || '%'
           or ap.real_name ilike '%' || p_search || '%'
           or u.nickname ilike '%' || p_search || '%'
           or ap.email ilike '%' || p_search || '%'
           or (length(regexp_replace(p_search, '\D', '', 'g')) = 4
               and right(coalesce(public._settlement_masked_account(pa.account_number_encrypted, pa.account_number, s.masked_account_number), ''), 4) = regexp_replace(p_search, '\D', '', 'g')))
    limit least(greatest(coalesce(p_limit, 100), 1), 500)
  ) row_j;
  return jsonb_build_object('rows', v, 'pii_masked_by_default', true, 'settlement_values_recomputed', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 상세 — 기본정보/정산/Shadow(성분 분해 reason 후보)/재생정보(v2 실측)/지급이력.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_readable_detail(p_settlement_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_s public.artist_settlements; v jsonb; v_v2 public.artist_settlements_v2;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select * into v_s from public.artist_settlements where id = p_settlement_id;
  if v_s.id is null then raise exception 'Settlement 없음(실존 검증 실패)'; end if;
  -- 같은 월/아티스트의 최신 v2 shadow 행(있으면). 계산 변경 없음 — 저장 값 참조만.
  select v2.* into v_v2 from public.artist_settlements_v2 v2
  where v2.artist_user_id = v_s.artist_user_id and v2.settlement_month = v_s.settlement_month
  order by v2.created_at desc limit 1;

  select jsonb_build_object(
    'basic', (select jsonb_build_object(
        'artist_name', ap.artist_name, 'real_name', ap.real_name, 'nickname', u.nickname, 'email', ap.email,
        'bank_name', coalesce(pa.bank_name, v_s.payout_bank_name),
        'account_holder', coalesce(pa.account_holder, v_s.payout_account_holder),
        'masked_account_number', public._settlement_masked_account(pa.account_number_encrypted, pa.account_number, v_s.masked_account_number),
        'masked_resident_number', public._settlement_masked_rrn(pa.rrn_encrypted),
        'account_status', case when pa.id is null then 'unregistered' when pa.verification_status = 'verified' then 'verified' when pa.verification_status = 'rejected' then 'verification_failed' else 'verification_pending' end,
        'entity_type', case when pa.tax_withholding_type = 'business_income_3_3' then 'business' when pa.tax_withholding_type = 'other_income_8_8' then 'individual_other_income' when pa.tax_withholding_type = 'none' then 'none' else 'unknown' end,
        'contract_status', (select c.status from public.artist_contracts c where c.artist_user_id = v_s.artist_user_id order by c.created_at desc limit 1),
        'payout_account_id', pa.id)
      from public.artist_profiles ap
      left join public.users u on u.id = v_s.artist_user_id
      left join public.artist_payout_accounts pa on pa.user_id = v_s.artist_user_id
      where ap.user_id = v_s.artist_user_id),
    'settlement', jsonb_build_object(
      'settlement_month', v_s.settlement_month, 'status', v_s.status,
      'gross', v_s.gross_settlement_amount, 'company_fee', v_s.company_fee_amount,
      'agent_fee', v_s.sales_agent_fee_amount, 'withholding_tax', v_s.withholding_tax_amount,
      'net', v_s.artist_net_settlement, 'previous_carried', v_s.previous_carried_amount,
      'final_payout', v_s.final_payout_amount, 'carried_over', v_s.carried_over_amount,
      'meets_min_payout', v_s.meets_min_payout, 'paid_at', v_s.paid_at, 'held_reason', v_s.held_reason),
    'shadow', case when v_v2.id is null then jsonb_build_object('has_v2', false) else jsonb_build_object(
      'has_v2', true,
      'v1_gross', v_s.gross_settlement_amount, 'v2_gross', v_v2.gross_amount,
      'v1_net', v_s.artist_net_settlement, 'v2_net', v_v2.artist_net_amount,
      'v1_final', v_s.final_payout_amount, 'v2_final', v_v2.final_amount,
      'net_delta', coalesce(v_v2.artist_net_amount,0) - coalesce(v_s.artist_net_settlement,0),
      -- 성분 분해(저장 값 재조합 — 계산 변경 아님·이유는 후보):
      'delta_components', jsonb_build_object(
        'gross_delta', coalesce(v_v2.gross_amount,0) - coalesce(v_s.gross_settlement_amount,0),
        'company_fee_delta', coalesce(v_v2.company_fee_amount,0) - coalesce(v_s.company_fee_amount,0),
        'agent_fee_delta', coalesce(v_v2.agent_fee_amount,0) - coalesce(v_s.sales_agent_fee_amount,0),
        'tax_delta', coalesce(v_v2.withholding_tax_amount,0) - coalesce(v_s.withholding_tax_amount,0),
        'carryover_delta', coalesce(v_v2.carried_over_amount,0) - coalesce(v_s.carried_over_amount,0)),
      'reason_is_candidate', true, 'shadow_recalculated', false)
    end,
    'streams', case when v_v2.id is null then jsonb_build_object('available', false, 'note', 'v2 shadow 데이터 없음 — v1 은 재생 상세를 저장하지 않음(정직 표기)') else jsonb_build_object(
      'available', true, 'eligible_streams', v_v2.eligible_stream_count, 'verified_streams', v_v2.verified_stream_count,
      'confidence_avg', v_v2.confidence_avg, 'source', 'artist_settlements_v2(0420) 실측') end,
    'payout_history', (select coalesce(jsonb_agg(jsonb_build_object(
        'settlement_month', h.settlement_month, 'final_payout', h.final_payout_amount, 'status', h.status, 'paid_at', h.paid_at) order by h.settlement_month desc), '[]'::jsonb)
      from (select * from public.artist_settlements where artist_user_id = v_s.artist_user_id order by settlement_month desc limit 12) h),
    'developer_fields', jsonb_build_object('settlement_id', v_s.id, 'artist_user_id', v_s.artist_user_id, 'policy_id', v_s.policy_id, 'v2_id', v_v2.id, 'v2_run_id', v_v2.run_id, 'v2_version', v_v2.version),
    'settlement_values_recomputed', false
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Shadow Compare 가독 목록 — 이름 + 성분 분해(저장 값 재조합·계산 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_shadow_readable(p_month date, p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_run uuid; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select id into v_run from public.settlement_generation_runs_v2 where settlement_month = p_month order by version desc, run_at desc limit 1;
  select jsonb_build_object(
    'settlement_month', p_month, 'v2_run_id', v_run, 'has_v2_run', v_run is not null,
    'rows', (select coalesce(jsonb_agg(jsonb_build_object(
        'artist_name', ap.artist_name, 'real_name', ap.real_name,
        'v1_net', v1.artist_net_settlement, 'v2_net', v2.artist_net_amount,
        'net_delta', coalesce(v2.artist_net_amount,0) - coalesce(v1.artist_net_settlement,0),
        'delta_components', jsonb_build_object(
          'gross_delta', coalesce(v2.gross_amount,0) - coalesce(v1.gross_settlement_amount,0),
          'company_fee_delta', coalesce(v2.company_fee_amount,0) - coalesce(v1.company_fee_amount,0),
          'agent_fee_delta', coalesce(v2.agent_fee_amount,0) - coalesce(v1.sales_agent_fee_amount,0),
          'tax_delta', coalesce(v2.withholding_tax_amount,0) - coalesce(v1.withholding_tax_amount,0),
          'carryover_delta', coalesce(v2.carried_over_amount,0) - coalesce(v1.carried_over_amount,0)),
        'v2_eligible_streams', v2.eligible_stream_count, 'v2_verified_streams', v2.verified_stream_count,
        'v1_missing', v1.id is null, 'v2_missing', v2.id is null,
        'developer_fields', jsonb_build_object('artist_user_id', coalesce(v1.artist_user_id, v2.artist_user_id), 'v1_id', v1.id, 'v2_id', v2.id)
      ) order by abs(coalesce(v2.artist_net_amount,0) - coalesce(v1.artist_net_settlement,0)) desc), '[]'::jsonb)
      from public.artist_settlements v1
      full outer join public.artist_settlements_v2 v2
        on v2.artist_user_id = v1.artist_user_id and v2.settlement_month = v1.settlement_month and v2.run_id = v_run
      left join public.artist_profiles ap on ap.user_id = coalesce(v1.artist_user_id, v2.artist_user_id)
      where coalesce(v1.settlement_month, p_month) = p_month
      limit least(greatest(coalesce(p_limit, 100), 1), 500)),
    'reason_is_candidate', true, 'shadow_recalculated', false
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) KPI — 상단 카드(전부 저장 값 집계 — 재계산 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_settlement_readable_kpi(p_month date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v jsonb; v_run uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select id into v_run from public.settlement_generation_runs_v2 where settlement_month = p_month order by version desc, run_at desc limit 1;
  select jsonb_build_object(
    'month', p_month,
    'month_payable_total', (select coalesce(sum(final_payout_amount),0) from public.artist_settlements where settlement_month = p_month and status in ('pending','payable')),
    'month_paid_total', (select coalesce(sum(final_payout_amount),0) from public.artist_settlements where settlement_month = p_month and status = 'paid'),
    'all_time_paid_total', (select coalesce(sum(final_payout_amount),0) from public.artist_settlements where status = 'paid'),
    'held_count', (select count(*) from public.artist_settlements where settlement_month = p_month and status = 'held'),
    'carried_over_count', (select count(*) from public.artist_settlements where settlement_month = p_month and status = 'carried_over'),
    'unregistered_account_count', (select count(*) from public.artist_settlements s left join public.artist_payout_accounts pa on pa.user_id = s.artist_user_id where s.settlement_month = p_month and pa.id is null),
    'verification_failed_count', (select count(*) from public.artist_settlements s join public.artist_payout_accounts pa on pa.user_id = s.artist_user_id where s.settlement_month = p_month and pa.verification_status = 'rejected'),
    'shadow', case when v_run is null then jsonb_build_object('has_v2_run', false) else (
      select jsonb_build_object('has_v2_run', true,
        'net_match_count', count(*) filter (where coalesce(v1.artist_net_settlement,0) = coalesce(v2.artist_net_amount,0)),
        'net_diff_count', count(*) filter (where coalesce(v1.artist_net_settlement,0) <> coalesce(v2.artist_net_amount,0)))
      from public.artist_settlements v1
      full outer join public.artist_settlements_v2 v2
        on v2.artist_user_id = v1.artist_user_id and v2.settlement_month = v1.settlement_month and v2.run_id = v_run
      where coalesce(v1.settlement_month, p_month) = p_month) end,
    'settlement_values_recomputed', false
  ) into v;
  return v;
end $$;

comment on table public.settlement_admin_access_logs is 'SETTLEMENT-UX-1 — 관리자 조회/복사/다운로드 접근 Audit(append-only). 원문 열람 Audit 는 payout_account_reveal_logs(0061/0300) 별도.';
