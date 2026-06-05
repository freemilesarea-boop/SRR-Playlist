-- 0302 — list_pending_payout_accounts 에 PII 필드 노출 (X6.15)
--
-- 관리자 화면이 RRN/세금/동의 정보를 마스킹된 형태로 표시할 수 있도록
-- RETURNS TABLE 확장. legal_name / masked_rrn / tax_withholding_type /
-- has_tax_consent / tax_consent_at / is_pii_complete 추가.
--
-- RETURNS 시그니처 변경이므로 DROP + CREATE.

drop function if exists public.list_pending_payout_accounts(integer);

create or replace function public.list_pending_payout_accounts(p_limit integer default 100)
returns table(
  account_id uuid,
  user_id uuid,
  artist_name text,
  email text,
  legal_name text,
  masked_rrn text,
  bank_name text,
  masked_account_number text,
  account_holder text,
  tax_withholding_type text,
  has_tax_consent boolean,
  tax_consent_at timestamptz,
  is_pii_complete boolean,
  verification_status text,
  rejected_reason text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select
    pa.id,
    pa.user_id,
    ap.artist_name,
    au.email::text,
    pa.legal_name,
    case when pa.rrn_encrypted is null then null else '******-*******' end,
    pa.bank_name,
    public._mask_account_number(pa.account_number),
    pa.account_holder,
    pa.tax_withholding_type,
    (pa.tax_consent_at is not null),
    pa.tax_consent_at,
    (pa.legal_name is not null and pa.rrn_encrypted is not null
     and pa.account_number_encrypted is not null and pa.tax_consent_at is not null),
    pa.verification_status,
    pa.rejected_reason,
    pa.created_at
  from public.artist_payout_accounts pa
  left join public.artist_profiles ap on ap.user_id = pa.user_id
  left join auth.users au on au.id = pa.user_id
  order by
    case pa.verification_status when 'pending' then 0 when 'rejected' then 1 else 2 end,
    pa.created_at desc
  limit greatest(1, p_limit);
end; $$;

revoke all on function public.list_pending_payout_accounts(integer) from public, anon;
grant execute on function public.list_pending_payout_accounts(integer) to authenticated, service_role;
