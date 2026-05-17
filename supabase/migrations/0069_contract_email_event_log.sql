-- 0069 — contract_email_jobs 상태 전이 audit log
--
-- 모든 status transition 을 append-only 로 기록 (sent / failed / retrying).
-- 운영 디버깅, 분쟁 대비, 발송 지표 산정 가능.

create table if not exists public.contract_email_job_events (
  id bigserial primary key,
  job_id uuid not null references public.contract_email_jobs(id) on delete cascade,
  contract_id uuid not null references public.artist_contracts(id) on delete cascade,
  recipient_email text not null,
  from_status text,
  to_status text not null,
  attempts int,
  error text,
  provider_message_id text,
  at timestamptz not null default now()
);

create index if not exists idx_contract_email_job_events_job on public.contract_email_job_events(job_id);
create index if not exists idx_contract_email_job_events_contract on public.contract_email_job_events(contract_id);
create index if not exists idx_contract_email_job_events_at on public.contract_email_job_events(at desc);

alter table public.contract_email_job_events enable row level security;

drop policy if exists contract_email_job_events_admin_read on public.contract_email_job_events;
create policy contract_email_job_events_admin_read on public.contract_email_job_events
  for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists contract_email_job_events_block_mutate on public.contract_email_job_events;
create policy contract_email_job_events_block_mutate on public.contract_email_job_events
  for all to authenticated using (false) with check (false);

revoke insert, update, delete on public.contract_email_job_events from public, authenticated, anon;
grant insert on public.contract_email_job_events to service_role;
grant usage, select on sequence public.contract_email_job_events_id_seq to service_role;

create or replace function public._log_contract_email_job_event()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if TG_OP = 'INSERT' then
    insert into public.contract_email_job_events
      (job_id, contract_id, recipient_email, from_status, to_status, attempts, error, provider_message_id)
    values
      (NEW.id, NEW.contract_id, NEW.recipient_email, null, NEW.status, NEW.attempts, NEW.last_error, NEW.provider_message_id);
  elsif TG_OP = 'UPDATE' and (OLD.status is distinct from NEW.status
                              or coalesce(OLD.attempts,0) is distinct from coalesce(NEW.attempts,0)
                              or coalesce(OLD.last_error,'') is distinct from coalesce(NEW.last_error,'')) then
    insert into public.contract_email_job_events
      (job_id, contract_id, recipient_email, from_status, to_status, attempts, error, provider_message_id)
    values
      (NEW.id, NEW.contract_id, NEW.recipient_email, OLD.status, NEW.status, NEW.attempts, NEW.last_error, NEW.provider_message_id);
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_log_contract_email_job_event on public.contract_email_jobs;
create trigger trg_log_contract_email_job_event
  after insert or update on public.contract_email_jobs
  for each row execute function public._log_contract_email_job_event();

create or replace function public.admin_list_contract_email_events(
  p_contract_id uuid
)
returns table (
  event_id bigint,
  job_id uuid,
  recipient_email text,
  from_status text,
  to_status text,
  attempts int,
  error text,
  provider_message_id text,
  at timestamptz
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
  select e.id, e.job_id, e.recipient_email, e.from_status, e.to_status,
         e.attempts, e.error, e.provider_message_id, e.at
  from public.contract_email_job_events e
  where e.contract_id = p_contract_id
  order by e.at asc, e.id asc;
end;
$function$;

grant execute on function public.admin_list_contract_email_events(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
