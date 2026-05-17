-- 0068 — 계약 체결 후 자동 이메일 발송 인프라
--
-- 목표:
-- 1) 아티스트가 계약 서명 완료 시 본인 + freemilesarea@gmail.com + admin role
--    이메일들에게 계약서 사본 자동 발송 (Resend via Edge Function)
-- 2) 이메일 발송 실패가 계약 signed 자체를 rollback 시키지 않음
-- 3) 발송 상태/실패 사유를 DB 에 기록하여 관리자 UI 에 노출
-- 4) 관리자 재발송 가능
-- 5) ensure_artist_contract_for_user RPC — 승인+결제 완료 아티스트가
--    /artist/contract 진입 시 fallback 자동 발행

-- ============================================
-- 1) contract_templates — 서버측 진본 계약서 본문 보관
-- ============================================
create table if not exists public.contract_templates (
  version text primary key,
  title text not null,
  body text not null,
  is_active boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references public.users(id) on delete set null
);

alter table public.contract_templates enable row level security;

drop policy if exists contract_templates_read_active on public.contract_templates;
create policy contract_templates_read_active on public.contract_templates
  for select to authenticated using (is_active = true);

drop policy if exists contract_templates_admin_all on public.contract_templates;
create policy contract_templates_admin_all on public.contract_templates
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

create unique index if not exists idx_contract_templates_one_active
  on public.contract_templates (is_active) where is_active = true;

-- ============================================
-- 2) artist_contracts 컬럼 추가
-- ============================================
alter table public.artist_contracts
  add column if not exists contract_hash text,
  add column if not exists emailed_to_artist_at timestamptz,
  add column if not exists emailed_to_admin_at timestamptz,
  add column if not exists admin_email_delivery_count int not null default 0,
  add column if not exists last_admin_emailed_at timestamptz,
  add column if not exists last_email_error text,
  add column if not exists email_status text not null default 'not_sent'
    check (email_status in ('not_sent','queued','sent','partial_failed','failed'));

-- ============================================
-- 3) contract_email_jobs — 발송 작업 큐 + 결과 로그
-- ============================================
create table if not exists public.contract_email_jobs (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.artist_contracts(id) on delete cascade,
  recipient_email text not null,
  recipient_kind text not null check (recipient_kind in ('artist','admin','hardcoded')),
  recipient_user_id uuid references public.users(id) on delete set null,
  subject text not null,
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','cancelled')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create index if not exists idx_contract_email_jobs_status_created
  on public.contract_email_jobs (status, created_at);
create index if not exists idx_contract_email_jobs_contract
  on public.contract_email_jobs (contract_id);

alter table public.contract_email_jobs enable row level security;

drop policy if exists contract_email_jobs_admin_all on public.contract_email_jobs;
create policy contract_email_jobs_admin_all on public.contract_email_jobs
  for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists contract_email_jobs_self_read on public.contract_email_jobs;
create policy contract_email_jobs_self_read on public.contract_email_jobs
  for select to authenticated
  using (exists (
    select 1 from public.artist_contracts c
    where c.id = contract_id and c.artist_user_id = auth.uid()
  ));

-- ============================================
-- 4) admin_seed_contract_template RPC
-- ============================================
create or replace function public.admin_seed_contract_template(
  p_version text,
  p_title text,
  p_body text,
  p_make_active boolean default true
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  if length(btrim(coalesce(p_body, ''))) < 100 then
    raise exception 'body too short';
  end if;
  if p_make_active then
    update public.contract_templates set is_active = false where is_active = true;
  end if;
  insert into public.contract_templates (version, title, body, is_active, created_by)
    values (btrim(p_version), btrim(p_title), p_body, p_make_active, auth.uid())
  on conflict (version) do update
    set title = excluded.title,
        body = excluded.body,
        is_active = excluded.is_active or contract_templates.is_active;
end;
$function$;

-- ============================================
-- 5) ensure_artist_contract_for_user RPC
-- ============================================
create or replace function public.ensure_artist_contract_for_user()
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_account_type text;
  v_approval text;
  v_tier text;
  v_template record;
  v_existing_id uuid;
  v_new_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select u.account_type, u.artist_approval_status, u.membership_tier
    into v_account_type, v_approval, v_tier
  from public.users u where u.id = v_uid;
  if v_account_type is null or v_account_type <> 'artist' then
    raise exception 'not artist account';
  end if;
  if coalesce(v_approval, 'pending') <> 'approved' then
    raise exception 'not approved (status=%)', coalesce(v_approval,'pending');
  end if;
  if coalesce(v_tier, 'free') <> 'individual' then
    raise exception 'not paid (tier=%)', coalesce(v_tier,'free');
  end if;

  select c.id into v_existing_id
  from public.artist_contracts c
  where c.artist_user_id = v_uid
    and c.status in ('pending_signature','signed')
  order by c.created_at desc limit 1;
  if v_existing_id is not null then
    return v_existing_id;
  end if;

  select version, title, body into v_template
  from public.contract_templates where is_active = true limit 1;
  if v_template.version is null then
    raise exception 'no active contract template — admin must seed via admin_seed_contract_template';
  end if;

  insert into public.artist_contracts (
    artist_user_id, contract_version, contract_title, contract_body,
    status, pending_signature_at, created_by
  ) values (
    v_uid, v_template.version, v_template.title, v_template.body,
    'pending_signature', now(), v_uid
  ) returning id into v_new_id;

  update public.users
    set contract_status = case when contract_status = 'signed' then 'signed'
                              else 'pending_signature' end
  where id = v_uid;

  return v_new_id;
end;
$function$;

grant execute on function public.ensure_artist_contract_for_user() to authenticated;

-- ============================================
-- 6) sign_artist_contract — contract_hash + email jobs enqueue
-- ============================================
create or replace function public.sign_artist_contract(
  p_contract_id uuid,
  p_signed_ip text default null,
  p_signed_user_agent text default null
)
returns table (contract_id uuid, status text, signed_at timestamptz)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_contract record;
  v_signed_at timestamptz;
  v_artist_email text;
  v_subject text;
  v_recipients text[];
  v_e text;
  v_admin_count int := 0;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;

  select c.id, c.artist_user_id, c.status, c.expires_at, c.contract_body, c.contract_version
    into v_contract
  from public.artist_contracts c where c.id = p_contract_id;
  if v_contract.id is null then raise exception 'contract not found'; end if;
  if v_contract.artist_user_id <> v_uid then raise exception 'forbidden'; end if;
  if v_contract.status <> 'pending_signature' then
    raise exception 'cannot sign contract in status=%', v_contract.status;
  end if;
  if v_contract.expires_at is not null and v_contract.expires_at < now() then
    update public.artist_contracts set status = 'expired' where id = p_contract_id;
    raise exception 'contract expired at %', v_contract.expires_at;
  end if;

  v_signed_at := now();

  update public.artist_contracts as c
  set status = 'signed',
      signed_at = v_signed_at,
      signed_ip = nullif(btrim(coalesce(p_signed_ip, '')), '')::inet,
      signed_user_agent = nullif(btrim(coalesce(p_signed_user_agent, '')), ''),
      contract_hash = encode(
        digest(
          coalesce(c.contract_body,'') || '|' ||
          v_contract.artist_user_id::text || '|' ||
          to_char(v_signed_at, 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
          'sha256'
        ),
        'hex'
      )
  where c.id = p_contract_id;

  update public.users set contract_status = 'signed' where id = v_uid;

  -- 이메일 큐잉 — 실패해도 signed 유지
  begin
    select au.email::text into v_artist_email
    from auth.users au where au.id = v_uid;

    v_subject := '[스르륵 플리] 아티스트 계약 체결 완료 - 버전 ' || v_contract.contract_version;

    v_recipients := array[]::text[];
    if v_artist_email is not null and length(btrim(v_artist_email)) > 0 then
      v_recipients := v_recipients || v_artist_email;
    end if;
    if not 'freemilesarea@gmail.com' = any(v_recipients) then
      v_recipients := v_recipients || 'freemilesarea@gmail.com';
    end if;

    if v_artist_email is not null then
      insert into public.contract_email_jobs
        (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
      values
        (p_contract_id, v_artist_email, 'artist', v_uid, v_subject);
    end if;

    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, subject)
    values
      (p_contract_id, 'freemilesarea@gmail.com', 'hardcoded', v_subject);

    insert into public.contract_email_jobs
      (contract_id, recipient_email, recipient_kind, recipient_user_id, subject)
    select distinct
      p_contract_id, au.email::text, 'admin', u.id, v_subject
    from public.users u
    join auth.users au on au.id = u.id
    where u.role = 'admin'
      and au.email is not null
      and au.email::text <> coalesce(v_artist_email, '')
      and au.email::text <> 'freemilesarea@gmail.com'
      and not exists (
        select 1 from public.contract_email_jobs j
        where j.contract_id = p_contract_id and j.recipient_email = au.email::text
      );

    get diagnostics v_admin_count = row_count;

    update public.artist_contracts
      set email_status = 'queued',
          admin_email_delivery_count = v_admin_count
    where id = p_contract_id;
  exception when others then
    get stacked diagnostics v_e = message_text;
    update public.artist_contracts
      set last_email_error = 'enqueue failed: ' || v_e,
          email_status = 'failed'
    where id = p_contract_id;
  end;

  return query
  select c.id, c.status::text, c.signed_at
  from public.artist_contracts c where c.id = p_contract_id;
end;
$function$;

grant execute on function public.sign_artist_contract(uuid, text, text) to authenticated;

-- ============================================
-- 7) Edge Function helpers (service_role only)
-- ============================================
create or replace function public.get_pending_contract_email_jobs(
  p_contract_id uuid default null,
  p_limit int default 50
)
returns table (
  job_id uuid,
  contract_id uuid,
  recipient_email text,
  recipient_kind text,
  subject text,
  attempts int,
  contract_version text,
  contract_title text,
  contract_body text,
  contract_hash text,
  signed_at timestamptz,
  signed_ip inet,
  signed_user_agent text,
  artist_user_id uuid,
  artist_email text,
  artist_name text
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role' then
    raise exception 'service_role only';
  end if;
  return query
  select
    j.id, j.contract_id, j.recipient_email, j.recipient_kind, j.subject, j.attempts,
    c.contract_version, c.contract_title, c.contract_body, c.contract_hash,
    c.signed_at, c.signed_ip, c.signed_user_agent,
    c.artist_user_id, au.email::text, coalesce(ap.artist_name, u.full_name, '')
  from public.contract_email_jobs j
  join public.artist_contracts c on c.id = j.contract_id
  join public.users u on u.id = c.artist_user_id
  left join auth.users au on au.id = c.artist_user_id
  left join public.artist_profiles ap on ap.user_id = c.artist_user_id
  where j.status = 'pending'
    and (p_contract_id is null or j.contract_id = p_contract_id)
    and c.status = 'signed'
  order by j.created_at asc
  limit greatest(1, p_limit);
end;
$function$;

revoke all on function public.get_pending_contract_email_jobs(uuid, int) from public;
grant execute on function public.get_pending_contract_email_jobs(uuid, int) to service_role;

create or replace function public.lock_contract_email_job(p_job_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_updated int;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role' then
    raise exception 'service_role only';
  end if;
  update public.contract_email_jobs
    set status = 'sending',
        last_attempt_at = now(),
        attempts = attempts + 1
  where id = p_job_id and status in ('pending','failed');
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.lock_contract_email_job(uuid) from public;
grant execute on function public.lock_contract_email_job(uuid) to service_role;

create or replace function public.mark_contract_email_sent(
  p_job_id uuid,
  p_provider_message_id text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract_id uuid;
  v_kind text;
  v_pending int;
  v_failed int;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role' then
    raise exception 'service_role only';
  end if;
  update public.contract_email_jobs
    set status = 'sent', sent_at = now(),
        provider_message_id = p_provider_message_id, last_error = null
  where id = p_job_id
  returning contract_id, recipient_kind into v_contract_id, v_kind;
  if v_contract_id is null then return; end if;
  if v_kind = 'artist' then
    update public.artist_contracts set emailed_to_artist_at = now() where id = v_contract_id;
  elsif v_kind in ('admin','hardcoded') then
    update public.artist_contracts
      set emailed_to_admin_at = coalesce(emailed_to_admin_at, now()),
          last_admin_emailed_at = now()
    where id = v_contract_id;
  end if;
  select
    sum(case when status in ('pending','sending') then 1 else 0 end),
    sum(case when status = 'failed' then 1 else 0 end)
    into v_pending, v_failed
  from public.contract_email_jobs where contract_id = v_contract_id;
  if v_pending = 0 then
    update public.artist_contracts
      set email_status = case when v_failed = 0 then 'sent' else 'partial_failed' end
    where id = v_contract_id;
  end if;
end;
$function$;

revoke all on function public.mark_contract_email_sent(uuid, text) from public;
grant execute on function public.mark_contract_email_sent(uuid, text) to service_role;

create or replace function public.mark_contract_email_failed(
  p_job_id uuid,
  p_error text
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_contract_id uuid;
  v_pending int;
  v_failed int;
begin
  if current_setting('request.jwt.claim.role', true) <> 'service_role'
     and auth.role() <> 'service_role' then
    raise exception 'service_role only';
  end if;
  update public.contract_email_jobs
    set status = 'failed', last_error = left(coalesce(p_error, ''), 2000)
  where id = p_job_id
  returning contract_id into v_contract_id;
  if v_contract_id is null then return; end if;
  update public.artist_contracts
    set last_email_error = left(coalesce(p_error, ''), 2000)
  where id = v_contract_id;
  select
    sum(case when status in ('pending','sending') then 1 else 0 end),
    sum(case when status = 'failed' then 1 else 0 end)
    into v_pending, v_failed
  from public.contract_email_jobs where contract_id = v_contract_id;
  if v_pending = 0 and v_failed > 0 then
    update public.artist_contracts
      set email_status = case
        when exists (select 1 from public.contract_email_jobs
                     where contract_id = v_contract_id and status = 'sent') then 'partial_failed'
        else 'failed'
      end
    where id = v_contract_id;
  end if;
end;
$function$;

revoke all on function public.mark_contract_email_failed(uuid, text) from public;
grant execute on function public.mark_contract_email_failed(uuid, text) to service_role;

-- ============================================
-- 8) 관리자 RPC — 발송 상태 조회 + 재발송
-- ============================================
create or replace function public.admin_list_contract_email_jobs(
  p_contract_id uuid
)
returns table (
  job_id uuid,
  recipient_email text,
  recipient_kind text,
  status text,
  attempts int,
  sent_at timestamptz,
  last_attempt_at timestamptz,
  last_error text,
  provider_message_id text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select j.id, j.recipient_email, j.recipient_kind, j.status, j.attempts,
         j.sent_at, j.last_attempt_at, j.last_error, j.provider_message_id, j.created_at
  from public.contract_email_jobs j
  where j.contract_id = p_contract_id
  order by j.created_at asc;
end;
$function$;

grant execute on function public.admin_list_contract_email_jobs(uuid) to authenticated;

create or replace function public.admin_requeue_contract_emails(
  p_contract_id uuid,
  p_only_failed boolean default false
)
returns int
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_count int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.contract_email_jobs
    set status = 'pending', sent_at = null
  where contract_id = p_contract_id
    and (not p_only_failed or status = 'failed');
  get diagnostics v_count = row_count;
  update public.artist_contracts
    set email_status = 'queued'
  where id = p_contract_id;
  return v_count;
end;
$function$;

grant execute on function public.admin_requeue_contract_emails(uuid, boolean) to authenticated;

-- ============================================
-- 9) PostgREST cache reload
-- ============================================
NOTIFY pgrst, 'reload schema';
