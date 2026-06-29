-- 0383 — Enterprise Contract Management V1 (Phase 4-12)
--
-- 본사 계약 관리 (신규 도메인).
-- 계약이 활성 상태면 enterprise_settlement_profiles 대신 계약값을 사용.
-- 없으면 기존 profile 로 fallback (모든 기존 callers 영향 0).
--
-- 절대 원칙:
--   - enterprise_monthly_settlements / _items (0372) / admin_generate_enterprise_monthly_settlement
--     RPC 본문 무수정. Settlement 의 contract 통합은 V2 deferred.
--   - enterprise_billing_invoices / _items (0382) 테이블/RPC 시그니처 무수정.
--   - payment / payapp / artist settlement / store player / policy automation /
--     announcement scheduler / store_heartbeat / store_now_playing / AI 무관.
--
-- 신규:
--   tables:
--     enterprise_contracts
--     enterprise_contract_files
--   storage bucket: enterprise-contracts (public read, super admin write, 20MB, PDF/DOCX)
--   helpers:
--     _enterprise_active_contract(ea_id)             returns record
--     _enterprise_effective_monthly_store_price(ea)  returns int (contract > profile > 4900)
--     _enterprise_effective_commission_rate(ea)      returns numeric (contract > profile > 0)
--     _enterprise_effective_minimum_payout(ea)       returns int (contract > profile > 0)
--     _enterprise_effective_settlement_method(ea)    returns text (contract > profile > 'monthly')
--     _contract_compute_status(start, end, current_status, today) returns text
--   RPCs (9):
--     admin_list_enterprise_contracts
--     admin_get_enterprise_contract
--     admin_create_enterprise_contract
--     admin_update_enterprise_contract
--     admin_set_enterprise_contract_status
--     admin_soft_delete_enterprise_contract
--     admin_upload_contract_file              (metadata insert — file upload via Storage)
--     admin_delete_contract_file
--     admin_contract_kpi
--     get_my_enterprise_contract               (HQ read-only)
--   Billing helper update (additive integration):
--     0382 의 _enterprise_monthly_store_price 를 contract-aware 로 CREATE OR REPLACE
--     (signature 보존 — 모든 callers 동일하게 작동)

-- ============================================================
-- 1) Tables
-- ============================================================
create table if not exists public.enterprise_contracts (
  id                    uuid primary key default gen_random_uuid(),
  enterprise_account_id uuid not null references public.enterprise_accounts(id) on delete restrict,
  contract_no           text not null,
  contract_name         text not null,
  contract_type         text not null default 'standard',
  start_date            date not null,
  end_date              date,
  auto_renew            boolean not null default true,
  renewal_period_month  integer not null default 12 check (renewal_period_month >= 1 and renewal_period_month <= 60),
  status                text not null default 'draft'
                          check (status in ('draft','active','expiring','expired','terminated')),
  monthly_store_price   integer check (monthly_store_price is null or monthly_store_price >= 0),
  commission_rate       numeric(5,2) check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100)),
  minimum_payout        integer check (minimum_payout is null or minimum_payout >= 0),
  settlement_method     text check (settlement_method is null or settlement_method in ('monthly','weekly','manual')),
  memo                  text,
  signed_at             timestamptz,
  created_by            uuid references auth.users(id) on delete set null,
  updated_by            uuid references auth.users(id) on delete set null,
  deleted_at            timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint ec_end_after_start check (end_date is null or end_date >= start_date)
);

create unique index if not exists ec_contract_no_active_unique
  on public.enterprise_contracts (contract_no)
  where deleted_at is null;
create index if not exists idx_ec_enterprise on public.enterprise_contracts(enterprise_account_id) where deleted_at is null;
create index if not exists idx_ec_status     on public.enterprise_contracts(status) where deleted_at is null;
create index if not exists idx_ec_end_date   on public.enterprise_contracts(end_date) where deleted_at is null and status in ('active','expiring');

create table if not exists public.enterprise_contract_files (
  id          uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.enterprise_contracts(id) on delete cascade,
  file_name   text not null,
  file_url    text not null,
  file_path   text not null,
  mime_type   text,
  file_size   bigint check (file_size is null or file_size >= 0),
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists idx_ecf_contract on public.enterprise_contract_files(contract_id);

-- updated_at trigger
do $$
begin
  if not exists (select 1 from pg_trigger where tgname='trg_ec_updated_at') then
    create trigger trg_ec_updated_at before update on public.enterprise_contracts
      for each row execute function public._touch_updated_at();
  end if;
end$$;

-- ============================================================
-- 2) RLS
-- ============================================================
alter table public.enterprise_contracts       enable row level security;
alter table public.enterprise_contract_files  enable row level security;

drop policy if exists ec_select on public.enterprise_contracts;
create policy ec_select on public.enterprise_contracts
  for select to authenticated using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_accounts ea
       where ea.id = enterprise_contracts.enterprise_account_id
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

drop policy if exists ecf_select on public.enterprise_contract_files;
create policy ecf_select on public.enterprise_contract_files
  for select to authenticated using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_contracts c
        join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
       where c.id = enterprise_contract_files.contract_id
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
         and c.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_contracts       from authenticated, anon;
revoke insert, update, delete on public.enterprise_contract_files  from authenticated, anon;

-- ============================================================
-- 3) Storage bucket — enterprise-contracts (PDF/DOCX, 20MB)
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'enterprise-contracts', 'enterprise-contracts', true, 20971520,
  array['application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'image/jpeg', 'image/png']
)
on conflict (id) do update set
  public             = excluded.public,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_contracts_public_read'
  ) then
    create policy enterprise_contracts_public_read on storage.objects
      for select to anon, authenticated
      using (bucket_id = 'enterprise-contracts');
  end if;
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_contracts_admin_write'
  ) then
    create policy enterprise_contracts_admin_write on storage.objects
      for all to authenticated
      using (bucket_id = 'enterprise-contracts' and public._is_super_admin())
      with check (bucket_id = 'enterprise-contracts' and public._is_super_admin());
  end if;
end$$;

-- ============================================================
-- 4) Helpers — active contract resolution + status compute
-- ============================================================

-- 활성 계약 1건 (start_date<=today, end_date null or >=today, status active/expiring)
create or replace function public._enterprise_active_contract(p_enterprise_account_id uuid)
returns table (
  id                   uuid,
  contract_no          text,
  contract_name        text,
  monthly_store_price  integer,
  commission_rate      numeric,
  minimum_payout       integer,
  settlement_method    text
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select c.id, c.contract_no, c.contract_name,
         c.monthly_store_price, c.commission_rate, c.minimum_payout, c.settlement_method
    from public.enterprise_contracts c
   where c.enterprise_account_id = p_enterprise_account_id
     and c.deleted_at is null
     and c.status in ('active','expiring')
     and c.start_date <= current_date
     and (c.end_date is null or c.end_date >= current_date)
   order by c.signed_at desc nulls last, c.start_date desc, c.created_at desc
   limit 1;
$$;

-- contract > profile > default(4900) — same signature 로 0382 helper 교체
create or replace function public._enterprise_monthly_store_price(p_enterprise_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select monthly_store_price from public._enterprise_active_contract(p_enterprise_account_id)
      where monthly_store_price is not null limit 1),
    (select monthly_store_price from public.enterprise_settlement_profiles
      where enterprise_account_id = p_enterprise_account_id),
    4900
  )::int;
$$;

-- 새 helper: commission_rate (contract > profile > 0)
create or replace function public._enterprise_effective_commission_rate(p_enterprise_account_id uuid)
returns numeric
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select commission_rate from public._enterprise_active_contract(p_enterprise_account_id)
      where commission_rate is not null limit 1),
    (select commission_rate from public.enterprise_settlement_profiles
      where enterprise_account_id = p_enterprise_account_id),
    0
  )::numeric;
$$;

create or replace function public._enterprise_effective_minimum_payout(p_enterprise_account_id uuid)
returns integer
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select minimum_payout from public._enterprise_active_contract(p_enterprise_account_id)
      where minimum_payout is not null limit 1),
    (select minimum_payout from public.enterprise_settlement_profiles
      where enterprise_account_id = p_enterprise_account_id),
    0
  )::int;
$$;

create or replace function public._enterprise_effective_settlement_method(p_enterprise_account_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select settlement_method from public._enterprise_active_contract(p_enterprise_account_id)
      where settlement_method is not null limit 1),
    (select settlement_method from public.enterprise_settlement_profiles
      where enterprise_account_id = p_enterprise_account_id),
    'monthly'
  )::text;
$$;

-- 계약 상태 자동 계산 (start/end_date + 현재 status 기준)
create or replace function public._contract_compute_status(
  p_start_date    date,
  p_end_date      date,
  p_current_status text,
  p_today         date default current_date
) returns text
language sql
immutable
as $$
  select case
    when p_current_status in ('draft','terminated') then p_current_status
    when p_start_date is not null and p_start_date > p_today then 'draft'
    when p_end_date is not null and p_end_date < p_today then 'expired'
    when p_end_date is not null and (p_end_date - p_today) <= 30 then 'expiring'
    else 'active'
  end;
$$;

-- ============================================================
-- 5) Admin RPCs
-- ============================================================
create or replace function public.admin_list_enterprise_contracts(
  p_search                text default null,
  p_status                text default null,
  p_enterprise_account_id uuid default null,
  p_auto_renew            boolean default null,
  p_expiring_only         boolean default false,
  p_limit                 int default 50,
  p_offset                int default 0
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total  bigint := 0;
  v_rows   jsonb := '[]'::jsonb;
  v_today  date := current_date;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with base as (
    select c.*,
           ea.enterprise_name,
           ea.manager_email,
           public._contract_compute_status(c.start_date, c.end_date, c.status, v_today) as computed_status,
           (select count(*) from public.enterprise_contract_files f where f.contract_id = c.id)::int as file_count,
           case when c.end_date is not null then (c.end_date - v_today) else null end as days_to_end
      from public.enterprise_contracts c
      join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
     where c.deleted_at is null
       and (p_status                is null or c.status = p_status)
       and (p_enterprise_account_id is null or c.enterprise_account_id = p_enterprise_account_id)
       and (p_auto_renew            is null or c.auto_renew = p_auto_renew)
       and (not p_expiring_only
            or (c.status in ('active','expiring') and c.end_date is not null
                and (c.end_date - v_today) between 0 and 30))
       and (
         p_search is null
         or c.contract_no   ilike '%' || p_search || '%'
         or c.contract_name ilike '%' || p_search || '%'
         or ea.enterprise_name ilike '%' || p_search || '%'
         or coalesce(c.memo, '') ilike '%' || p_search || '%'
       )
  ),
  total_cte as (select count(*)::bigint as c from base),
  paged as (
    select * from base
     order by case when status = 'active' then 0 when status = 'expiring' then 1 when status = 'draft' then 2 else 3 end,
              end_date asc nulls last,
              updated_at desc
     limit v_limit offset v_offset
  )
  select coalesce((select c from total_cte), 0),
         coalesce(jsonb_agg(to_jsonb(p) order by p.updated_at desc), '[]'::jsonb)
    into v_total, v_rows
    from paged p;

  return jsonb_build_object(
    'success', true, 'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'today', v_today,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_enterprise_contracts(text,text,uuid,boolean,boolean,int,int) from public, anon;
grant   execute on function public.admin_list_enterprise_contracts(text,text,uuid,boolean,boolean,int,int) to authenticated;

create or replace function public.admin_get_enterprise_contract(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_c jsonb; v_files jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select to_jsonb(t) into v_c from (
    select c.*, ea.enterprise_name, ea.manager_email,
           public._contract_compute_status(c.start_date, c.end_date, c.status, current_date) as computed_status
      from public.enterprise_contracts c
      join public.enterprise_accounts ea on ea.id = c.enterprise_account_id
     where c.id = p_id and c.deleted_at is null
  ) t;
  if v_c is null then raise exception 'contract not found: %', p_id; end if;
  select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc), '[]'::jsonb)
    into v_files from public.enterprise_contract_files f where f.contract_id = p_id;
  return jsonb_build_object('success', true, 'contract', v_c, 'files', v_files, 'computed_at', now());
end;
$$;
revoke execute on function public.admin_get_enterprise_contract(uuid) from public, anon;
grant   execute on function public.admin_get_enterprise_contract(uuid) to authenticated;

create or replace function public.admin_create_enterprise_contract(
  p_enterprise_account_id uuid,
  p_contract_no           text,
  p_contract_name         text,
  p_start_date            date,
  p_contract_type         text default 'standard',
  p_end_date              date default null,
  p_auto_renew            boolean default true,
  p_renewal_period_month  int default 12,
  p_status                text default 'draft',
  p_monthly_store_price   int default null,
  p_commission_rate       numeric default null,
  p_minimum_payout        int default null,
  p_settlement_method     text default null,
  p_memo                  text default null,
  p_signed_at             timestamptz default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_enterprise_account_id is null then raise exception 'enterprise_account_id required'; end if;
  if nullif(btrim(coalesce(p_contract_no, '')), '')   is null then raise exception 'contract_no required'; end if;
  if nullif(btrim(coalesce(p_contract_name, '')), '') is null then raise exception 'contract_name required'; end if;
  if p_start_date is null then raise exception 'start_date required'; end if;
  if p_status not in ('draft','active','expiring','expired','terminated') then
    raise exception 'invalid status: %', p_status;
  end if;

  insert into public.enterprise_contracts (
    enterprise_account_id, contract_no, contract_name, contract_type,
    start_date, end_date, auto_renew, renewal_period_month, status,
    monthly_store_price, commission_rate, minimum_payout, settlement_method,
    memo, signed_at, created_by, updated_by
  ) values (
    p_enterprise_account_id, p_contract_no, p_contract_name,
    coalesce(p_contract_type, 'standard'),
    p_start_date, p_end_date, coalesce(p_auto_renew, true),
    coalesce(p_renewal_period_month, 12), coalesce(p_status, 'draft'),
    p_monthly_store_price, p_commission_rate, p_minimum_payout, p_settlement_method,
    p_memo, p_signed_at, auth.uid(), auth.uid()
  ) returning id into v_id;

  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.create', 'info', 'created',
    format('contract created — %s (%s)', p_contract_name, p_contract_no),
    jsonb_build_object('contract_id', v_id, 'enterprise_account_id', p_enterprise_account_id,
                       'contract_no', p_contract_no, 'start_date', p_start_date, 'end_date', p_end_date,
                       'status', p_status, 'monthly_store_price', p_monthly_store_price,
                       'commission_rate', p_commission_rate),
    auth.uid(), v_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'contract_id', v_id);
end;
$$;
revoke execute on function public.admin_create_enterprise_contract(uuid,text,text,date,text,date,boolean,int,text,int,numeric,int,text,text,timestamptz) from public, anon;
grant   execute on function public.admin_create_enterprise_contract(uuid,text,text,date,text,date,boolean,int,text,int,numeric,int,text,text,timestamptz) to authenticated;

create or replace function public.admin_update_enterprise_contract(
  p_id                   uuid,
  p_contract_no          text default null,
  p_contract_name        text default null,
  p_contract_type        text default null,
  p_start_date           date default null,
  p_end_date             date default null,
  p_auto_renew           boolean default null,
  p_renewal_period_month int default null,
  p_monthly_store_price  int default null,
  p_commission_rate      numeric default null,
  p_minimum_payout       int default null,
  p_settlement_method    text default null,
  p_memo                 text default null,
  p_signed_at            timestamptz default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_before record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_before from public.enterprise_contracts where id = p_id and deleted_at is null;
  if v_before.id is null then raise exception 'contract not found: %', p_id; end if;

  update public.enterprise_contracts
     set contract_no          = coalesce(p_contract_no, contract_no),
         contract_name        = coalesce(p_contract_name, contract_name),
         contract_type        = coalesce(p_contract_type, contract_type),
         start_date           = coalesce(p_start_date, start_date),
         end_date             = coalesce(p_end_date, end_date),
         auto_renew           = coalesce(p_auto_renew, auto_renew),
         renewal_period_month = coalesce(p_renewal_period_month, renewal_period_month),
         monthly_store_price  = coalesce(p_monthly_store_price, monthly_store_price),
         commission_rate      = coalesce(p_commission_rate, commission_rate),
         minimum_payout       = coalesce(p_minimum_payout, minimum_payout),
         settlement_method    = coalesce(p_settlement_method, settlement_method),
         memo                 = coalesce(p_memo, memo),
         signed_at            = coalesce(p_signed_at, signed_at),
         updated_by           = auth.uid()
   where id = p_id;

  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.update', 'info', 'updated',
    format('contract updated — id=%s', p_id),
    jsonb_build_object('contract_id', p_id,
                       'before', jsonb_build_object(
                         'contract_no', v_before.contract_no, 'contract_name', v_before.contract_name,
                         'start_date', v_before.start_date, 'end_date', v_before.end_date,
                         'monthly_store_price', v_before.monthly_store_price,
                         'commission_rate', v_before.commission_rate,
                         'minimum_payout', v_before.minimum_payout,
                         'settlement_method', v_before.settlement_method,
                         'auto_renew', v_before.auto_renew
                       ),
                       'after', jsonb_build_object(
                         'contract_no', coalesce(p_contract_no, v_before.contract_no),
                         'contract_name', coalesce(p_contract_name, v_before.contract_name),
                         'start_date', coalesce(p_start_date, v_before.start_date),
                         'end_date', coalesce(p_end_date, v_before.end_date),
                         'monthly_store_price', coalesce(p_monthly_store_price, v_before.monthly_store_price),
                         'commission_rate', coalesce(p_commission_rate, v_before.commission_rate),
                         'minimum_payout', coalesce(p_minimum_payout, v_before.minimum_payout),
                         'settlement_method', coalesce(p_settlement_method, v_before.settlement_method),
                         'auto_renew', coalesce(p_auto_renew, v_before.auto_renew)
                       )),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'contract_id', p_id);
end;
$$;
revoke execute on function public.admin_update_enterprise_contract(uuid,text,text,text,date,date,boolean,int,int,numeric,int,text,text,timestamptz) from public, anon;
grant   execute on function public.admin_update_enterprise_contract(uuid,text,text,text,date,date,boolean,int,int,numeric,int,text,text,timestamptz) to authenticated;

create or replace function public.admin_set_enterprise_contract_status(
  p_id     uuid,
  p_status text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_prev text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_status not in ('draft','active','expiring','expired','terminated') then
    raise exception 'invalid status: %', p_status;
  end if;
  select status into v_prev from public.enterprise_contracts where id = p_id and deleted_at is null;
  if v_prev is null then raise exception 'contract not found: %', p_id; end if;

  update public.enterprise_contracts
     set status = p_status, updated_by = auth.uid()
   where id = p_id;

  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.status', 'info', p_status,
    format('contract status %s → %s (id=%s)', v_prev, p_status, p_id),
    jsonb_build_object('contract_id', p_id, 'before_status', v_prev, 'after_status', p_status),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'contract_id', p_id, 'status', p_status, 'previous_status', v_prev);
end;
$$;
revoke execute on function public.admin_set_enterprise_contract_status(uuid, text) from public, anon;
grant   execute on function public.admin_set_enterprise_contract_status(uuid, text) to authenticated;

create or replace function public.admin_soft_delete_enterprise_contract(p_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  update public.enterprise_contracts
     set deleted_at = now(), status = 'terminated', updated_by = auth.uid()
   where id = p_id and deleted_at is null;
  if not found then raise exception 'contract not found or already deleted: %', p_id; end if;
  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.delete', 'warning', 'deleted',
    format('contract soft-deleted — id=%s', p_id),
    jsonb_build_object('contract_id', p_id),
    auth.uid(), p_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'contract_id', p_id);
end;
$$;
revoke execute on function public.admin_soft_delete_enterprise_contract(uuid) from public, anon;
grant   execute on function public.admin_soft_delete_enterprise_contract(uuid) to authenticated;

create or replace function public.admin_upload_contract_file(
  p_contract_id uuid,
  p_file_name   text,
  p_file_url    text,
  p_file_path   text,
  p_mime_type   text default null,
  p_file_size   bigint default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_contract_id is null then raise exception 'contract_id required'; end if;
  if not exists (select 1 from public.enterprise_contracts where id = p_contract_id and deleted_at is null) then
    raise exception 'contract not found: %', p_contract_id;
  end if;
  insert into public.enterprise_contract_files (
    contract_id, file_name, file_url, file_path, mime_type, file_size, uploaded_by
  ) values (
    p_contract_id, p_file_name, p_file_url, p_file_path, p_mime_type, p_file_size, auth.uid()
  ) returning id into v_id;

  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.file.upload', 'info', 'uploaded',
    format('contract file uploaded — %s', p_file_name),
    jsonb_build_object('contract_id', p_contract_id, 'file_id', v_id, 'file_name', p_file_name,
                       'file_path', p_file_path, 'mime_type', p_mime_type, 'file_size', p_file_size),
    auth.uid(), p_contract_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'file_id', v_id);
end;
$$;
revoke execute on function public.admin_upload_contract_file(uuid,text,text,text,text,bigint) from public, anon;
grant   execute on function public.admin_upload_contract_file(uuid,text,text,text,text,bigint) to authenticated;

create or replace function public.admin_delete_contract_file(p_file_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_f record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select id, contract_id, file_name, file_path into v_f
    from public.enterprise_contract_files where id = p_file_id;
  if v_f.id is null then raise exception 'file not found: %', p_file_id; end if;
  delete from public.enterprise_contract_files where id = p_file_id;
  perform public.admin_log_operation(
    'enterprise_contract', 'enterprise_contract.file.delete', 'warning', 'deleted',
    format('contract file deleted — %s', v_f.file_name),
    jsonb_build_object('contract_id', v_f.contract_id, 'file_id', p_file_id,
                       'file_name', v_f.file_name, 'file_path', v_f.file_path),
    auth.uid(), v_f.contract_id::text, null, null, null
  );
  return jsonb_build_object('success', true, 'file_id', p_file_id);
end;
$$;
revoke execute on function public.admin_delete_contract_file(uuid) from public, anon;
grant   execute on function public.admin_delete_contract_file(uuid) to authenticated;

create or replace function public.admin_contract_kpi()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_today date := current_date;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  return jsonb_build_object(
    'total_contracts',  (select count(*) from public.enterprise_contracts where deleted_at is null),
    'active_contracts', (select count(*) from public.enterprise_contracts where deleted_at is null and status = 'active'),
    'expiring_30d',     (select count(*) from public.enterprise_contracts
                          where deleted_at is null and status in ('active','expiring')
                            and end_date is not null and (end_date - v_today) between 0 and 30),
    'expired_contracts',(select count(*) from public.enterprise_contracts where deleted_at is null and status = 'expired'),
    'auto_renew_count', (select count(*) from public.enterprise_contracts where deleted_at is null and auto_renew = true),
    'terminated_count', (select count(*) from public.enterprise_contracts where deleted_at is null and status = 'terminated'),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_contract_kpi() from public, anon;
grant   execute on function public.admin_contract_kpi() to authenticated;

-- ============================================================
-- 6) HQ read-only — get_my_enterprise_contract
-- ============================================================
create or replace function public.get_my_enterprise_contract()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_uid    uuid := auth.uid();
  v_ea_id  uuid;
  v_active jsonb;
  v_recent jsonb;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select id into v_ea_id from public.enterprise_accounts
   where auth_user_id = v_uid and deleted_at is null limit 1;
  if v_ea_id is null then raise exception 'forbidden: no enterprise account'; end if;

  select to_jsonb(t) into v_active from (
    select c.id, c.contract_no, c.contract_name, c.contract_type,
           c.start_date, c.end_date, c.auto_renew, c.renewal_period_month, c.status,
           c.monthly_store_price, c.commission_rate, c.minimum_payout, c.settlement_method,
           c.signed_at,
           public._contract_compute_status(c.start_date, c.end_date, c.status, current_date) as computed_status,
           case when c.end_date is not null then (c.end_date - current_date) else null end as days_to_end
      from public.enterprise_contracts c
     where c.enterprise_account_id = v_ea_id
       and c.deleted_at is null
       and c.status in ('active','expiring')
     order by c.signed_at desc nulls last, c.start_date desc, c.created_at desc
     limit 1
  ) t;

  select coalesce(jsonb_agg(to_jsonb(t) order by t.start_date desc), '[]'::jsonb) into v_recent from (
    select c.id, c.contract_no, c.contract_name, c.start_date, c.end_date, c.status
      from public.enterprise_contracts c
     where c.enterprise_account_id = v_ea_id
       and c.deleted_at is null
     order by c.start_date desc, c.created_at desc
     limit 5
  ) t;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'active_contract', v_active,
    'recent_contracts', v_recent,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_contract() from public, anon;
grant   execute on function public.get_my_enterprise_contract() to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_t int; v_rpc int; v_bucket int;
begin
  select count(*) into v_t from pg_class where relname in
    ('enterprise_contracts','enterprise_contract_files');
  select count(*) into v_rpc from pg_proc where pronamespace='public'::regnamespace and proname in (
    '_enterprise_active_contract','_enterprise_monthly_store_price',
    '_enterprise_effective_commission_rate','_enterprise_effective_minimum_payout',
    '_enterprise_effective_settlement_method','_contract_compute_status',
    'admin_list_enterprise_contracts','admin_get_enterprise_contract',
    'admin_create_enterprise_contract','admin_update_enterprise_contract',
    'admin_set_enterprise_contract_status','admin_soft_delete_enterprise_contract',
    'admin_upload_contract_file','admin_delete_contract_file',
    'admin_contract_kpi','get_my_enterprise_contract'
  );
  select count(*) into v_bucket from storage.buckets where id='enterprise-contracts';
  raise notice '====== 0383 Enterprise Contracts V1 ======';
  raise notice 'tables          : % / 2', v_t;
  raise notice 'rpcs + helpers  : % / 16 (6 helpers + 9 RPCs + 1 HQ RPC)', v_rpc;
  raise notice 'storage bucket  : % / 1', v_bucket;
  if v_t = 2 and v_rpc >= 16 and v_bucket = 1 then
    raise notice '0383 COMPLETE — contracts + files + helpers + 9 RPCs + storage ready';
    raise notice 'NOTE: Billing (0382) helper now contract-aware. Settlement (0372) integration deferred to V2.';
  else
    raise warning '0383 INCOMPLETE';
  end if;
end$$;
