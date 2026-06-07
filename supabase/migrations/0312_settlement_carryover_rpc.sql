-- 0312 — 정산 list/detail 에 PII 컬럼 추가 + 수동 이월 RPC (X6.25)
--
-- 변경:
--   1) admin_settlement_list  — payout_account PII 마스킹 + 이월 컬럼 노출
--   2) admin_settlement_detail — 동일 + carryover 메타데이터
--   3) admin_carryover_settlement — 신규 수동 이월 RPC
--
-- 정책 (수동 이월):
--   - 허용 상태: pending, payable
--   - 차단 상태: paid (terminal), carried_over (중복 방지), disputed
--   - held 는 어차피 이월 의도와 동일하므로 차단 (운영자가 풀어서 payable
--     로 만든 후 이월하라는 의미)
--   - carryover_amount = (payable 이면 final_payout_amount, pending 이면
--     total_settlement_amount)
--   - carried_over_to_month = settlement_month + 1 month
--   - 다음 달 generate 가 previous_carried_amount 로 합산하며 동시에
--     원본 row 의 carryover_applied = true 로 표시 (0313 migration).

-- ===== 1) admin_settlement_list — PII 마스킹 + 이월 컬럼 =====
drop function if exists public.admin_settlement_list(date, text, text);

create or replace function public.admin_settlement_list(
  p_month date default null,
  p_status text default null,
  p_search text default null
)
returns table(
  id uuid, settlement_month date, artist_user_id uuid,
  artist_nickname text, artist_email text,
  gross_settlement_amount bigint, company_fee_amount bigint,
  sales_agent_fee_amount bigint, artist_net_settlement bigint,
  previous_carried_amount bigint, total_settlement_amount bigint,
  meets_min_payout boolean, withholding_tax_amount bigint,
  final_payout_amount bigint, carried_over_amount bigint,
  status text, finalized_at timestamptz, paid_at timestamptz, created_at timestamptz,
  -- X6.25 신규
  payout_account_id uuid, legal_name text,
  rrn_masked text, has_rrn boolean,
  bank_name text, masked_account_number text, account_holder text,
  has_account_number boolean,
  tax_withholding_type text, payout_account_status text,
  is_manual_carryover boolean, carryover_applied boolean,
  carried_over_to_month date, carryover_reason text,
  held_reason text
)
language plpgsql security definer set search_path = public, extensions as $$
declare
  v_pattern text := case when p_search is null or length(btrim(p_search))=0
                         then null else '%' || btrim(p_search) || '%' end;
  v_key text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  v_key := public._payout_pii_key();

  return query
  select s.id, s.settlement_month, s.artist_user_id,
    coalesce(u.nickname, '')::text, coalesce(au.email::text, '')::text,
    s.gross_settlement_amount, s.company_fee_amount, s.sales_agent_fee_amount,
    s.artist_net_settlement, s.previous_carried_amount, s.total_settlement_amount,
    s.meets_min_payout, s.withholding_tax_amount, s.final_payout_amount, s.carried_over_amount,
    s.status, s.finalized_at, s.paid_at, s.created_at,
    pa.id as payout_account_id,
    pa.legal_name,
    case when pa.rrn_encrypted is not null
         then public._mask_resident_number(pgp_sym_decrypt(pa.rrn_encrypted, v_key))
         else null end as rrn_masked,
    (pa.rrn_encrypted is not null) as has_rrn,
    coalesce(pa.bank_name, s.payout_bank_name) as bank_name,
    coalesce(s.masked_account_number,
             case when pa.account_number_encrypted is not null
                  then public._mask_account_number(pgp_sym_decrypt(pa.account_number_encrypted, v_key))
                  else null end) as masked_account_number,
    coalesce(pa.account_holder, s.payout_account_holder) as account_holder,
    (pa.account_number_encrypted is not null) as has_account_number,
    pa.tax_withholding_type,
    case
      when pa.id is null then 'missing'
      when pa.verification_status <> 'verified' then 'pending'
      when pa.rrn_encrypted is null or pa.account_number_encrypted is null
        or pa.legal_name is null or pa.tax_consent_at is null then 'verified_partial'
      else 'ready'
    end as payout_account_status,
    coalesce(s.is_manual_carryover, false) as is_manual_carryover,
    coalesce(s.carryover_applied, false) as carryover_applied,
    s.carried_over_to_month,
    s.carryover_reason,
    s.held_reason
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_payout_accounts pa
         on pa.id = s.payout_account_id
         or (s.payout_account_id is null and pa.user_id = s.artist_user_id and pa.verification_status = 'verified')
  where (p_month is null or s.settlement_month = p_month)
    and (p_status is null or s.status = p_status)
    and (v_pattern is null or coalesce(u.nickname, '') ilike v_pattern or coalesce(au.email::text, '') ilike v_pattern)
  order by s.settlement_month desc, s.created_at desc;
end;
$$;

-- ===== 2) admin_settlement_detail — PII + 이월 메타데이터 =====
create or replace function public.admin_settlement_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  v_result jsonb;
  v_key text;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  v_key := public._payout_pii_key();

  select jsonb_build_object(
    'settlement', to_jsonb(s.*),
    'artist', jsonb_build_object(
      'nickname', u.nickname,
      'email', au.email,
      'artist_name', ap.artist_name
    ),
    'policy', to_jsonb(p.*),
    'payout_account', case when pa.id is null then null else jsonb_build_object(
      'id', pa.id,
      'legal_name', pa.legal_name,
      'bank_name', pa.bank_name,
      'account_holder', pa.account_holder,
      'tax_withholding_type', pa.tax_withholding_type,
      'tax_consent_at', pa.tax_consent_at,
      'verification_status', pa.verification_status,
      'has_rrn', pa.rrn_encrypted is not null,
      'has_account_number', pa.account_number_encrypted is not null,
      'rrn_masked', case when pa.rrn_encrypted is not null
                         then public._mask_resident_number(pgp_sym_decrypt(pa.rrn_encrypted, v_key))
                         else null end,
      'masked_account_number', coalesce(s.masked_account_number,
        case when pa.account_number_encrypted is not null
             then public._mask_account_number(pgp_sym_decrypt(pa.account_number_encrypted, v_key))
             else null end),
      'status', case
        when pa.verification_status <> 'verified' then 'pending'
        when pa.rrn_encrypted is null or pa.account_number_encrypted is null
          or pa.legal_name is null or pa.tax_consent_at is null then 'verified_partial'
        else 'ready'
      end
    ) end,
    'items', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_code', i.track_code,
        'track_title', i.track_title,
        'artist_name_snapshot', i.artist_name_snapshot,
        'stream_count', i.stream_count,
        'eligible_stream_count', i.eligible_stream_count,
        'raw_milestone_stream_count', i.raw_milestone_stream_count,
        'excluded_stream_count', i.excluded_stream_count,
        'pool_revenue_share', i.pool_revenue_share
      ) order by i.pool_revenue_share desc), '[]'::jsonb)
      from public.settlement_items i where i.settlement_id = s.id
    ),
    'audit_logs', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', al.id,
        'action', al.action,
        'amount', al.amount,
        'from_month', al.from_month,
        'to_month', al.to_month,
        'reason', al.reason,
        'admin_user_id', al.admin_user_id,
        'detail', al.detail,
        'created_at', al.created_at
      ) order by al.created_at desc), '[]'::jsonb)
      from public.settlement_admin_audit_logs al where al.settlement_id = s.id
    )
  ) into v_result
  from public.artist_settlements s
  join public.users u on u.id = s.artist_user_id
  left join auth.users au on au.id = s.artist_user_id
  left join public.artist_profiles ap on ap.user_id = s.artist_user_id
  left join public.settlement_policies p on p.id = s.policy_id
  left join public.artist_payout_accounts pa on pa.id = s.payout_account_id
  where s.id = p_id;

  return v_result;
end; $$;

-- ===== 3) admin_carryover_settlement — 수동 이월 =====
create or replace function public.admin_carryover_settlement(
  p_settlement_id uuid,
  p_reason text
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_row public.artist_settlements%rowtype;
  v_amount bigint;
  v_to_month date;
  v_audit_id bigint;
begin
  if not exists (select 1 from public.users u where u.id = v_admin and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;
  if p_reason is null or length(btrim(p_reason)) = 0 then
    raise exception 'reason_required (수동 이월 사유는 필수)';
  end if;

  select * into v_row from public.artist_settlements where id = p_settlement_id for update;
  if v_row.id is null then raise exception 'settlement_not_found'; end if;

  -- 차단 상태
  if v_row.status = 'paid' then
    raise exception 'cannot carryover paid settlement (id=%)', p_settlement_id using errcode = '42501';
  end if;
  if v_row.status = 'carried_over' then
    raise exception 'settlement already carried over (id=%, status=%)',
                    p_settlement_id, v_row.status using errcode = '42501';
  end if;
  if v_row.status not in ('pending','payable') then
    raise exception 'cannot carryover settlement in status=% (allowed: pending|payable)',
                    v_row.status using errcode = '42501';
  end if;

  -- 금액 계산
  if v_row.status = 'payable' then
    v_amount := v_row.final_payout_amount;
  else
    v_amount := v_row.total_settlement_amount;
  end if;
  if v_amount <= 0 then
    raise exception 'carryover_amount must be > 0 (current=%)', v_amount using errcode = '22023';
  end if;

  v_to_month := (v_row.settlement_month + interval '1 month')::date;

  update public.artist_settlements as s
  set status = 'carried_over',
      is_manual_carryover = true,
      carryover_applied = false,
      carried_over_amount = v_amount,
      carried_over_to_month = v_to_month,
      carried_over_at = now(),
      carried_over_by = v_admin,
      carryover_reason = btrim(p_reason),
      held_reason = 'manual_carryover',
      updated_at = now()
  where s.id = p_settlement_id;

  insert into public.settlement_admin_audit_logs (
    settlement_id, artist_id, action, amount, from_month, to_month,
    admin_user_id, reason, detail
  ) values (
    p_settlement_id, v_row.artist_user_id, 'manual_carryover',
    v_amount, v_row.settlement_month, v_to_month,
    v_admin, btrim(p_reason),
    jsonb_build_object(
      'previous_status', v_row.status,
      'final_payout_amount', v_row.final_payout_amount,
      'total_settlement_amount', v_row.total_settlement_amount
    )
  ) returning id into v_audit_id;

  return jsonb_build_object(
    'ok', true,
    'settlement_id', p_settlement_id,
    'audit_id', v_audit_id,
    'carryover_amount', v_amount,
    'carried_over_to_month', v_to_month,
    'status', 'carried_over'
  );
end; $$;

grant execute on function public.admin_carryover_settlement(uuid, text) to authenticated;
