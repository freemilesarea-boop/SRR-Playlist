-- 0397 — Enterprise Billing PDF + Email + Contract Suspended metadata (Phase 3-1)
--
-- 목적:
--   /admin 정산·청구 통합 탭에서 Billing invoice PDF 생성 + 이메일 발송 (재발송) 지원.
--   Contract SUSPENDED 상태를 enum 확장 없이 metadata jsonb 로 표현 (기존 UI 회귀 0).
--
-- 절대 원칙:
--   • 기존 컬럼/제약/RPC/index 무수정
--   • admin_generate_enterprise_monthly_settlement (0372 + 0390) 본문 무영향
--   • enterprise_billing_invoices 의 status enum / 계산식 / 기존 9개 RPC 시그니처 무영향
--   • cron / dispatch / policy / player / announcement / artist settlement 무관
--   • additive 만 — 신규 컬럼 default null/0, 신규 테이블 empty start
--
-- 신규:
--   A) enterprise_billing_invoices 에 additive 컬럼 4개
--      pdf_url text, pdf_generated_at timestamptz,
--      last_email_sent_at timestamptz, email_send_count int default 0
--   B) enterprise_billing_email_jobs (신규 테이블 — 재발송 이력)
--   C) enterprise_contracts 에 additive 컬럼 1개 (metadata jsonb default '{}')
--      SUSPENDED 상태는 metadata->>'suspended_at' 존재 여부로 표현
--   D) 5 RPCs:
--      admin_mark_billing_invoice_pdf(uuid, text)                          — edge function 이 호출
--      admin_create_billing_email_job(uuid, text, text[])                  — client 가 호출 (enqueue)
--      admin_finalize_billing_email_job(uuid, text, text, text)            — edge function 이 호출 (결과 반영)
--      admin_list_billing_email_jobs(uuid)                                 — UI 목록
--      admin_set_contract_suspended(uuid, boolean, text)                   — SUSPENDED 토글
--
-- 정책:
--   • security definer + set search_path='public'
--   • _is_super_admin() gate 필수
--   • revoke public/anon, grant authenticated
--   • best-effort 감사 로그 (admin_log_operation 는 caller 가 처리)

-- ============================================================
-- A) enterprise_billing_invoices 컬럼 추가 (additive)
-- ============================================================
alter table public.enterprise_billing_invoices
  add column if not exists pdf_url             text,
  add column if not exists pdf_generated_at    timestamptz,
  add column if not exists last_email_sent_at  timestamptz,
  add column if not exists email_send_count    integer not null default 0;

-- ============================================================
-- B) enterprise_billing_email_jobs (신규 테이블)
-- ============================================================
create table if not exists public.enterprise_billing_email_jobs (
  id             uuid primary key default gen_random_uuid(),
  invoice_id     uuid not null references public.enterprise_billing_invoices(id) on delete cascade,
  to_email       text not null,
  cc_emails      text[],
  resend_id      text,
  status         text not null default 'pending' check (status in ('pending','sent','failed')),
  error_message  text,
  retry_count    integer not null default 0,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  sent_at        timestamptz
);
create index if not exists idx_ebej_invoice   on public.enterprise_billing_email_jobs(invoice_id, created_at desc);
create index if not exists idx_ebej_status    on public.enterprise_billing_email_jobs(status) where status='pending';

-- ============================================================
-- C) enterprise_contracts.metadata (additive jsonb, SUSPENDED 표현용)
-- ============================================================
alter table public.enterprise_contracts
  add column if not exists metadata jsonb not null default '{}'::jsonb;

-- ============================================================
-- D-1) admin_mark_billing_invoice_pdf(uuid, text)
--   edge function generate-enterprise-billing-pdf 이 완료 시 호출.
--   invoice.pdf_url 갱신 + pdf_generated_at now().
-- ============================================================
create or replace function public.admin_mark_billing_invoice_pdf(
  p_invoice_id uuid, p_pdf_url text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.enterprise_billing_invoices;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_invoice_id is null then raise exception 'p_invoice_id required'; end if;
  if p_pdf_url is null or btrim(p_pdf_url)='' then raise exception 'p_pdf_url required'; end if;

  update public.enterprise_billing_invoices
     set pdf_url = p_pdf_url,
         pdf_generated_at = now(),
         updated_at = now(),
         updated_by = auth.uid()
   where id = p_invoice_id and deleted_at is null
   returning * into v_row;

  if not found then raise exception 'invoice not found or deleted: %', p_invoice_id; end if;
  return jsonb_build_object('success', true, 'invoice_id', v_row.id, 'pdf_url', v_row.pdf_url, 'pdf_generated_at', v_row.pdf_generated_at);
end $$;
revoke execute on function public.admin_mark_billing_invoice_pdf(uuid, text) from public, anon;
grant   execute on function public.admin_mark_billing_invoice_pdf(uuid, text) to authenticated;
comment on function public.admin_mark_billing_invoice_pdf(uuid, text) is
  'Phase 3-1: mark invoice.pdf_url + pdf_generated_at. Called by generate-enterprise-billing-pdf edge fn.';

-- ============================================================
-- D-2) admin_create_billing_email_job(uuid, text, text[])
--   client 가 "이메일 발송" 클릭 시 호출.
--   pending job 생성 후 job_id 반환 (edge function 이 이 id 로 발송/결과 기록).
-- ============================================================
create or replace function public.admin_create_billing_email_job(
  p_invoice_id uuid, p_to_email text, p_cc_emails text[] default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_job_id uuid; v_invoice record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_invoice_id is null then raise exception 'p_invoice_id required'; end if;
  if p_to_email is null or btrim(p_to_email)='' then raise exception 'p_to_email required'; end if;
  if p_to_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'invalid email: %', p_to_email; end if;

  select id, pdf_url, status, email_send_count
    into v_invoice
    from public.enterprise_billing_invoices
   where id = p_invoice_id and deleted_at is null;
  if not found then raise exception 'invoice not found: %', p_invoice_id; end if;
  if v_invoice.pdf_url is null then raise exception 'invoice has no PDF yet (generate first): %', p_invoice_id; end if;

  insert into public.enterprise_billing_email_jobs (invoice_id, to_email, cc_emails, status, created_by)
       values (p_invoice_id, btrim(p_to_email), p_cc_emails, 'pending', auth.uid())
    returning id into v_job_id;

  return jsonb_build_object(
    'success', true, 'job_id', v_job_id, 'invoice_id', p_invoice_id,
    'to_email', btrim(p_to_email), 'send_count_before', coalesce(v_invoice.email_send_count, 0)
  );
end $$;
revoke execute on function public.admin_create_billing_email_job(uuid, text, text[]) from public, anon;
grant   execute on function public.admin_create_billing_email_job(uuid, text, text[]) to authenticated;
comment on function public.admin_create_billing_email_job(uuid, text, text[]) is
  'Phase 3-1: enqueue pending email job. Requires pdf_url pre-generated. Called by client.';

-- ============================================================
-- D-3) admin_finalize_billing_email_job(uuid, text, text, text)
--   edge function 이 Resend 결과 반영. status = sent|failed.
--   sent 이면 invoice.last_email_sent_at + email_send_count 증가.
-- ============================================================
create or replace function public.admin_finalize_billing_email_job(
  p_job_id uuid, p_status text, p_resend_id text default null, p_error text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_job public.enterprise_billing_email_jobs;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_job_id is null then raise exception 'p_job_id required'; end if;
  if p_status not in ('sent','failed') then raise exception 'p_status must be sent|failed (got %)', p_status; end if;

  update public.enterprise_billing_email_jobs
     set status        = p_status,
         resend_id     = coalesce(p_resend_id, resend_id),
         error_message = case when p_status='failed' then p_error else null end,
         retry_count   = retry_count + case when p_status='failed' then 1 else 0 end,
         sent_at       = case when p_status='sent' then now() else sent_at end
   where id = p_job_id
   returning * into v_job;

  if not found then raise exception 'email job not found: %', p_job_id; end if;

  if p_status = 'sent' then
    update public.enterprise_billing_invoices
       set last_email_sent_at = now(),
           email_send_count   = email_send_count + 1,
           updated_at         = now()
     where id = v_job.invoice_id and deleted_at is null;
  end if;

  return jsonb_build_object('success', true, 'job_id', v_job.id, 'status', v_job.status);
end $$;
revoke execute on function public.admin_finalize_billing_email_job(uuid, text, text, text) from public, anon;
grant   execute on function public.admin_finalize_billing_email_job(uuid, text, text, text) to authenticated;
comment on function public.admin_finalize_billing_email_job(uuid, text, text, text) is
  'Phase 3-1: mark email job sent/failed. sent → invoice.last_email_sent_at + count++. Called by edge fn.';

-- ============================================================
-- D-4) admin_list_billing_email_jobs(uuid)
--   invoice 상세 UI 에서 발송 이력 목록.
-- ============================================================
create or replace function public.admin_list_billing_email_jobs(
  p_invoice_id uuid
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_invoice_id is null then raise exception 'p_invoice_id required'; end if;

  select coalesce(jsonb_agg(row order by (row->>'created_at') desc), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'id',            j.id,
      'invoice_id',    j.invoice_id,
      'to_email',      j.to_email,
      'cc_emails',     j.cc_emails,
      'resend_id',     j.resend_id,
      'status',        j.status,
      'error_message', j.error_message,
      'retry_count',   j.retry_count,
      'created_at',    j.created_at,
      'sent_at',       j.sent_at
    ) as row
    from public.enterprise_billing_email_jobs j
    where j.invoice_id = p_invoice_id
    order by j.created_at desc
    limit 200
  ) t;

  return jsonb_build_object('success', true, 'invoice_id', p_invoice_id, 'jobs', v_rows);
end $$;
revoke execute on function public.admin_list_billing_email_jobs(uuid) from public, anon;
grant   execute on function public.admin_list_billing_email_jobs(uuid) to authenticated;
comment on function public.admin_list_billing_email_jobs(uuid) is
  'Phase 3-1: list email dispatch history for a billing invoice (super_admin only).';

-- ============================================================
-- D-5) admin_set_contract_suspended(uuid, boolean, text)
--   Contract SUSPENDED 상태를 metadata.suspended_at 로 표현 (enum 무변경).
--   suspended=true 면 metadata['suspended_at']=now(), 'suspended_reason']=p_reason.
--   suspended=false 면 두 키를 제거.
--   기존 status enum 은 그대로 유지.
-- ============================================================
create or replace function public.admin_set_contract_suspended(
  p_contract_id uuid, p_suspended boolean, p_reason text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_row public.enterprise_contracts;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_contract_id is null then raise exception 'p_contract_id required'; end if;

  if p_suspended then
    update public.enterprise_contracts
       set metadata   = coalesce(metadata, '{}'::jsonb)
                        || jsonb_build_object(
                             'suspended_at',     now(),
                             'suspended_reason', coalesce(nullif(btrim(p_reason), ''), '')
                           ),
           updated_at = now(),
           updated_by = auth.uid()
     where id = p_contract_id and deleted_at is null
     returning * into v_row;
  else
    update public.enterprise_contracts
       set metadata   = (coalesce(metadata, '{}'::jsonb) - 'suspended_at') - 'suspended_reason',
           updated_at = now(),
           updated_by = auth.uid()
     where id = p_contract_id and deleted_at is null
     returning * into v_row;
  end if;

  if not found then raise exception 'contract not found or deleted: %', p_contract_id; end if;
  return jsonb_build_object(
    'success', true, 'contract_id', v_row.id,
    'suspended', p_suspended,
    'suspended_at', v_row.metadata->>'suspended_at',
    'suspended_reason', v_row.metadata->>'suspended_reason'
  );
end $$;
revoke execute on function public.admin_set_contract_suspended(uuid, boolean, text) from public, anon;
grant   execute on function public.admin_set_contract_suspended(uuid, boolean, text) to authenticated;
comment on function public.admin_set_contract_suspended(uuid, boolean, text) is
  'Phase 3-1: toggle SUSPENDED state via metadata.suspended_at (enum unchanged, no regression).';

-- ============================================================
-- E) Storage bucket — enterprise-billing-invoices (PDF only, 5MB, private)
--   서비스 정책은 0394 (enterprise-contracts) 와 동일: super_admin read/write.
--   에지 함수(generate-enterprise-billing-pdf) 가 service_role 로 쓰기.
-- ============================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'enterprise-billing-invoices', 'enterprise-billing-invoices',
  false,           -- private
  5242880,         -- 5 MB
  array['application/pdf']
)
on conflict (id) do update set
  public          = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

do $$
begin
  -- super_admin write
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_billing_invoices_admin_write'
  ) then
    create policy enterprise_billing_invoices_admin_write on storage.objects
      for insert to authenticated
      with check (bucket_id = 'enterprise-billing-invoices' and public._is_super_admin());
  end if;

  -- super_admin update (덮어쓰기)
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_billing_invoices_admin_update'
  ) then
    create policy enterprise_billing_invoices_admin_update on storage.objects
      for update to authenticated
      using (bucket_id = 'enterprise-billing-invoices' and public._is_super_admin())
      with check (bucket_id = 'enterprise-billing-invoices' and public._is_super_admin());
  end if;

  -- super_admin read (signed URL 발급용)
  if not exists (
    select 1 from pg_policies where schemaname='storage' and tablename='objects'
      and policyname='enterprise_billing_invoices_admin_read'
  ) then
    create policy enterprise_billing_invoices_admin_read on storage.objects
      for select to authenticated
      using (bucket_id = 'enterprise-billing-invoices' and public._is_super_admin());
  end if;
end$$;

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_bucket int; v_col int; v_rpc int;
begin
  select count(*) into v_bucket from storage.buckets where id='enterprise-billing-invoices';
  select count(*) into v_col from information_schema.columns
    where table_schema='public' and table_name='enterprise_billing_invoices'
      and column_name in ('pdf_url','pdf_generated_at','last_email_sent_at','email_send_count');
  select count(*) into v_rpc from pg_proc where pronamespace = 'public'::regnamespace
    and proname in (
      'admin_mark_billing_invoice_pdf',
      'admin_create_billing_email_job',
      'admin_finalize_billing_email_job',
      'admin_list_billing_email_jobs',
      'admin_set_contract_suspended'
    );
  raise notice '====== 0397 Enterprise Billing PDF/Email + Contract Suspended ======';
  raise notice 'billing_invoices new columns : % / 4', v_col;
  raise notice 'storage bucket               : % / 1', v_bucket;
  raise notice 'rpcs                         : % / 5', v_rpc;
  if v_col = 4 and v_bucket = 1 and v_rpc = 5 then
    raise notice '0397 COMPLETE — additive only, super_admin gated, no existing schema/rpc modified.';
  else
    raise warning '0397 CHECK — cols=% bucket=% rpc=%', v_col, v_bucket, v_rpc;
  end if;
end$$;
