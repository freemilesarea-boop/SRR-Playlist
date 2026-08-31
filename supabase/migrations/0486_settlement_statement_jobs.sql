-- ============================================================================
-- 0486_settlement_statement_jobs.sql
-- 정산 지급명세서 발송 — 잡 큐 + 스냅샷.
--
-- 배경: admin_mark_settlement_paid 는 status/paid_at 갱신과 감사 로그만 남긴다.
--   아티스트에게 가는 통지가 전혀 없어, 입금이 돼도 본인이 앱을 열어보지 않으면
--   얼마가 왜 들어왔는지 알 수 없다. 원천징수 3.3% 가 빠진 이유도 확인 불가.
--
-- 설계 (기존 contract_email_jobs / dispatch-contract-emails 패턴 준용):
--   · 지급완료 후 관리자가 "명세서 발송" 을 눌러야 잡이 쌓인다(자동 발송 아님).
--     → 지급 처리와 대외 문서 발송을 분리. 지급이 메일 실패로 깨지지 않는다.
--   · 잡에는 발송 시점 금액/내역 스냅샷(jsonb)을 함께 저장한다.
--     명세서는 대외 문서이므로 나중에 정산이 재산정돼도 보낸 내용이 바뀌면 안 된다.
--   · 발송은 edge function(dispatch-settlement-statements)이 PDF 생성 후 Resend 로.
--
-- 명세서 구성: 정산월 / 총 배분액 / 회사·영업 수수료 / 당월 순정산 / 전월 이월 승계 /
--   정산 합계 / 원천징수 3.3% / 실지급액 / 입금계좌(마스킹) / 트랙별 스트리밍 내역.
--
-- 안전: 기존 정산 스키마·RPC 무변경(additive). paid 상태에서만 큐잉 가능.
--   금액은 정산 행에서 그대로 읽어 스냅샷에 복사하며 어떤 값도 재계산하지 않는다.
-- ============================================================================

create table if not exists public.settlement_statement_jobs (
  id                  uuid primary key default gen_random_uuid(),
  settlement_id       uuid not null references public.artist_settlements(id) on delete cascade,
  artist_user_id      uuid not null,
  settlement_month    date not null,
  recipient_email     text not null,
  subject             text not null,
  status              text not null default 'pending'
                        check (status in ('pending','sent','failed','canceled')),
  attempts            int  not null default 0,
  last_attempt_at     timestamptz,
  last_error          text,
  sent_at             timestamptz,
  provider_message_id text,
  pdf_path            text,
  pdf_generated_at    timestamptz,
  -- 발송 시점 금액/내역 동결 스냅샷 (대외 문서 불변성)
  snapshot            jsonb not null,
  requested_by        uuid,
  created_at          timestamptz not null default now()
);

create index if not exists settlement_statement_jobs_pending_idx
  on public.settlement_statement_jobs (status, created_at)
  where status = 'pending';
create index if not exists settlement_statement_jobs_settlement_idx
  on public.settlement_statement_jobs (settlement_id, created_at desc);

-- 같은 정산에 대기 중인 잡이 둘 이상 쌓이지 않게 (중복 발송 방지)
create unique index if not exists settlement_statement_jobs_one_pending
  on public.settlement_statement_jobs (settlement_id)
  where status = 'pending';

alter table public.settlement_statement_jobs enable row level security;
revoke all on public.settlement_statement_jobs from public, anon, authenticated;
grant select, insert, update on public.settlement_statement_jobs to service_role;

-- 스냅샷/수신자/정산 참조는 발송 후 불변 (감사 추적)
create or replace function public._settlement_statement_jobs_protect()
returns trigger language plpgsql set search_path to 'public'
as $$
begin
  if TG_OP = 'DELETE' then
    raise exception 'settlement_statement_jobs cannot be deleted (audit trail)' using errcode='42501';
  end if;
  if NEW.settlement_id  is distinct from OLD.settlement_id
     or NEW.artist_user_id is distinct from OLD.artist_user_id
     or NEW.settlement_month is distinct from OLD.settlement_month
     or NEW.recipient_email is distinct from OLD.recipient_email
     or NEW.snapshot is distinct from OLD.snapshot
     or NEW.created_at is distinct from OLD.created_at
  then
    raise exception 'settlement_statement_jobs core fields are immutable' using errcode='42501';
  end if;
  if OLD.status = 'sent' and NEW.status <> 'sent' then
    raise exception 'sent statement job cannot be reopened (id=%)', OLD.id using errcode='42501';
  end if;
  return NEW;
end;
$$;

drop trigger if exists trg_settlement_statement_jobs_protect on public.settlement_statement_jobs;
create trigger trg_settlement_statement_jobs_protect
  before update or delete on public.settlement_statement_jobs
  for each row execute function public._settlement_statement_jobs_protect();

-- ----------------------------------------------------------------------------
-- 명세서 큐잉 — 지급완료(paid) 정산에 대해서만
-- ----------------------------------------------------------------------------
create or replace function public.admin_queue_settlement_statement(
  p_settlement_id uuid,
  p_recipient_email text default null,
  p_resend boolean default false
)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_s record;
  v_email text;
  v_items jsonb;
  v_snapshot jsonb;
  v_job_id uuid;
  v_prev_sent int;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_settlement_id is null then raise exception 'p_settlement_id required'; end if;

  select * into v_s from public.artist_settlements where id = p_settlement_id;
  if v_s.id is null then raise exception 'settlement not found'; end if;
  if v_s.status <> 'paid' then
    raise exception '지급완료(paid) 정산만 명세서를 발송할 수 있습니다 (현재 status=%)', v_s.status
      using errcode = '42501';
  end if;

  v_email := nullif(btrim(coalesce(p_recipient_email, v_s.artist_email, '')), '');
  if v_email is null then
    select au.email::text into v_email from auth.users au where au.id = v_s.artist_user_id;
  end if;
  if v_email is null or position('@' in v_email) = 0 then
    raise exception '수신 이메일을 찾을 수 없습니다 (artist_user_id=%)', v_s.artist_user_id
      using errcode = '22023';
  end if;

  -- 이미 발송된 적이 있으면 p_resend 명시 필요
  select count(*) into v_prev_sent from public.settlement_statement_jobs j
   where j.settlement_id = p_settlement_id and j.status = 'sent';
  if v_prev_sent > 0 and not coalesce(p_resend, false) then
    raise exception '이미 발송된 명세서입니다 (%건). 재발송하려면 p_resend=true', v_prev_sent
      using errcode = '42501';
  end if;

  -- 트랙별 스트리밍 내역
  select coalesce(jsonb_agg(jsonb_build_object(
           'track_code', i.track_code, 'track_title', i.track_title,
           'isrc', i.isrc, 'release_title', i.release_title,
           'stream_count', i.stream_count, 'amount', i.pool_revenue_share
         ) order by i.pool_revenue_share desc, i.track_title), '[]'::jsonb)
    into v_items
  from public.settlement_items i where i.settlement_id = p_settlement_id;

  v_snapshot := jsonb_build_object(
    'settlement_id', v_s.id,
    'settlement_month', v_s.settlement_month,
    'paid_at', v_s.paid_at,
    'artist_user_id', v_s.artist_user_id,
    'artist_email', v_email,
    'gross_settlement_amount', v_s.gross_settlement_amount,
    'company_fee_amount', v_s.company_fee_amount,
    'sales_agent_fee_amount', v_s.sales_agent_fee_amount,
    'artist_net_settlement', v_s.artist_net_settlement,
    'previous_carried_amount', v_s.previous_carried_amount,
    'total_settlement_amount', v_s.total_settlement_amount,
    'withholding_tax_amount', v_s.withholding_tax_amount,
    'final_payout_amount', v_s.final_payout_amount,
    'carried_over_amount', v_s.carried_over_amount,
    'payout_bank_name', v_s.payout_bank_name,
    'payout_account_holder', v_s.payout_account_holder,
    'masked_account_number', v_s.masked_account_number,
    'payout_memo', v_s.payout_memo,
    'withholding_tax_ratio', (select pl.withholding_tax_ratio from public.settlement_policies pl
                               where pl.effective_from <= v_s.settlement_month
                               order by pl.effective_from desc limit 1),
    'items', v_items,
    'items_count', jsonb_array_length(v_items),
    'total_streams', (select coalesce(sum(i.stream_count),0) from public.settlement_items i
                       where i.settlement_id = p_settlement_id),
    'snapshot_at', now()
  );

  -- unique_violation 은 잡 insert 에만 한정해 잡는다. 함수 전체를 감싸면 다른 제약
  -- 위반까지 "발송 대기 중" 으로 잘못 보고된다.
  begin
    insert into public.settlement_statement_jobs
      (settlement_id, artist_user_id, settlement_month, recipient_email, subject,
       snapshot, requested_by)
    values
      (v_s.id, v_s.artist_user_id, v_s.settlement_month, v_email,
       '[듣다] ' || to_char(v_s.settlement_month, 'YYYY년 MM월') || ' 정산 지급명세서',
       v_snapshot, v_uid)
    returning id into v_job_id;
  exception when unique_violation then
    raise exception '이미 발송 대기 중인 명세서가 있습니다 (settlement_id=%)', p_settlement_id
      using errcode = '42501';
  end;

  insert into public.settlement_admin_audit_logs
    (settlement_id, artist_id, action, amount, from_month, to_month, admin_user_id, reason, detail)
  values
    (v_s.id, v_s.artist_user_id, 'mark_paid', v_s.final_payout_amount,
     v_s.settlement_month, null, v_uid, '지급명세서 발송 큐잉',
     jsonb_build_object('statement_job_id', v_job_id, 'recipient_email', v_email,
                        'resend', coalesce(p_resend,false), 'prev_sent', v_prev_sent));

  return jsonb_build_object('ok', true, 'job_id', v_job_id, 'recipient_email', v_email,
                            'settlement_id', v_s.id, 'resend', coalesce(p_resend,false));
end;
$$;

revoke all on function public.admin_queue_settlement_statement(uuid, text, boolean) from public;
grant execute on function public.admin_queue_settlement_statement(uuid, text, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 발송 이력 조회 (관리자)
-- ----------------------------------------------------------------------------
create or replace function public.admin_settlement_statement_jobs(p_settlement_id uuid)
returns table(id uuid, status text, recipient_email text, subject text,
              attempts int, last_error text, sent_at timestamptz,
              pdf_path text, created_at timestamptz)
language plpgsql stable security definer set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
    select j.id, j.status, j.recipient_email, j.subject, j.attempts, j.last_error,
           j.sent_at, j.pdf_path, j.created_at
    from public.settlement_statement_jobs j
    where j.settlement_id = p_settlement_id
    order by j.created_at desc;
end;
$$;

revoke all on function public.admin_settlement_statement_jobs(uuid) from public;
grant execute on function public.admin_settlement_statement_jobs(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- 발송 결과 기록 (edge function 이 service_role 로 호출)
-- ----------------------------------------------------------------------------
create or replace function public._internal_mark_statement_job_result(
  p_job_id uuid, p_status text, p_error text default null,
  p_provider_message_id text default null, p_pdf_path text default null
)
returns void
language plpgsql security definer set search_path to 'public'
as $$
begin
  if p_status not in ('pending','sent','failed','canceled') then
    raise exception 'invalid status: %', p_status;
  end if;
  update public.settlement_statement_jobs j
     set status = p_status,
         attempts = j.attempts + 1,
         last_attempt_at = now(),
         last_error = p_error,
         provider_message_id = coalesce(p_provider_message_id, j.provider_message_id),
         pdf_path = coalesce(p_pdf_path, j.pdf_path),
         pdf_generated_at = case when p_pdf_path is not null then now() else j.pdf_generated_at end,
         sent_at = case when p_status = 'sent' then now() else j.sent_at end
   where j.id = p_job_id;
end;
$$;

revoke all on function public._internal_mark_statement_job_result(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public._internal_mark_statement_job_result(uuid, text, text, text, text) to service_role;

-- ----------------------------------------------------------------------------
-- 명세서 PDF 보관 버킷 (비공개)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('settlement-statements', 'settlement-statements', false, 20971520, array['application/pdf'])
on conflict (id) do nothing;
