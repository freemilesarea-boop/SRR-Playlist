-- ============================================================================
-- 0470_admin_member_broadcast_email.sql
--
-- 관리자 → 회원 대량 메일 발송 기능.
--   - 전체 회원 / 검색·필터 / 개별 선택 수신자
--   - 공지성(notice) / 광고성(ad) — 광고성은 제목 [광고] 표기 + 수신거부 필수 +
--     수신거부자 자동 제외 (정보통신망법 대응)
--   - 예약 발송(scheduled_at) + 발송 이력/통계
--   - 발송은 기존 관례(작업 큐 테이블 + dispatch 엣지 함수 + Resend)를 그대로 따름.
--     (track_moderation_email_jobs / dispatch-moderation-emails 패턴 미러)
--
-- 이 마이그레이션은 additive(신규 테이블·함수·인덱스·RLS)만 추가한다.
-- 기존 테이블/함수/정책/데이터 변경 없음.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 수신거부 (광고성 메일 opt-out)
-- ----------------------------------------------------------------------------
create table if not exists public.email_unsubscribes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users(id) on delete set null,
  email text not null,
  -- 'ad' = 광고성 수신거부(기본), 'all' = 모든 유형 수신거부
  scope text not null default 'ad' check (scope in ('ad','all')),
  -- 'link' = 메일 하단 링크, 'admin' = 관리자 수동 등록
  source text not null default 'link' check (source in ('link','admin')),
  unsubscribed_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
-- 이메일당 1건(대소문자 무시). 재수신거부는 scope/시각 갱신.
create unique index if not exists uniq_email_unsubscribes_email
  on public.email_unsubscribes (lower(email));
create index if not exists idx_email_unsubscribes_user on public.email_unsubscribes(user_id);

-- ----------------------------------------------------------------------------
-- 2) 캠페인 (발송 1건 = 1 row)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  created_by uuid references public.users(id) on delete set null,
  subject text not null,
  body_html text not null,
  email_kind text not null default 'notice' check (email_kind in ('notice','ad')),
  recipient_mode text not null check (recipient_mode in ('all','filter','selected')),
  recipient_filter jsonb not null default '{}'::jsonb,
  scheduled_at timestamptz,                       -- null 또는 과거 = 즉시 발송 대상
  status text not null default 'scheduled'
    check (status in ('draft','scheduled','sending','sent','partial','failed','cancelled')),
  total_recipients int not null default 0,
  sent_count int not null default 0,
  failed_count int not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_broadcast_campaigns_status on public.admin_broadcast_campaigns(status, scheduled_at);
create index if not exists idx_broadcast_campaigns_created on public.admin_broadcast_campaigns(created_at desc);

-- ----------------------------------------------------------------------------
-- 3) 수신자별 작업 (job = 1 recipient)
-- ----------------------------------------------------------------------------
create table if not exists public.admin_broadcast_email_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.admin_broadcast_campaigns(id) on delete cascade,
  recipient_user_id uuid references public.users(id) on delete set null,
  recipient_email text not null,
  unsubscribe_token uuid not null default gen_random_uuid(),
  status text not null default 'pending'
    check (status in ('pending','sending','sent','failed','cancelled')),
  attempts int not null default 0,
  last_attempt_at timestamptz,
  last_error text,
  sent_at timestamptz,
  provider_message_id text,
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_email)
);
create unique index if not exists uniq_broadcast_job_token on public.admin_broadcast_email_jobs(unsubscribe_token);
create index if not exists idx_broadcast_jobs_status on public.admin_broadcast_email_jobs(status, campaign_id);
create index if not exists idx_broadcast_jobs_campaign on public.admin_broadcast_email_jobs(campaign_id);

-- ----------------------------------------------------------------------------
-- 4) RLS — 관리자 전용 (worker/unsubscribe 는 security definer RPC 로만 접근)
-- ----------------------------------------------------------------------------
alter table public.email_unsubscribes enable row level security;
alter table public.admin_broadcast_campaigns enable row level security;
alter table public.admin_broadcast_email_jobs enable row level security;

drop policy if exists email_unsubscribes_admin_all on public.email_unsubscribes;
create policy email_unsubscribes_admin_all on public.email_unsubscribes for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists broadcast_campaigns_admin_all on public.admin_broadcast_campaigns;
create policy broadcast_campaigns_admin_all on public.admin_broadcast_campaigns for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

drop policy if exists broadcast_jobs_admin_all on public.admin_broadcast_email_jobs;
create policy broadcast_jobs_admin_all on public.admin_broadcast_email_jobs for all to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin'));

-- ----------------------------------------------------------------------------
-- 5) 수신자 해석 헬퍼 (admin_member_list 재사용 + 수신거부 제외)
-- ----------------------------------------------------------------------------
create or replace function public.admin_resolve_broadcast_recipients(
  p_recipient_mode text,
  p_filter jsonb default '{}'::jsonb,
  p_selected_user_ids uuid[] default '{}'::uuid[],
  p_email_kind text default 'notice'
)
returns table(user_id uuid, email text, nickname text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  return query
  with base as (
    select m.id, m.email, m.nickname, m.withdrawn_at, m.disabled_at, m.pii_masked_at
    from public.admin_member_list(
      1000000, 0,
      case when p_recipient_mode = 'filter' then nullif(p_filter->>'search','') else null end,
      case when p_recipient_mode = 'filter' then nullif(p_filter->>'plan','')   else null end,
      case when p_recipient_mode = 'filter' then nullif(p_filter->>'role','')   else null end,
      case when p_recipient_mode = 'filter' then nullif(p_filter->>'status','') else null end
    ) m
  ),
  eligible as (
    select b.id, b.email, b.nickname
    from base b
    where b.email is not null
      and b.withdrawn_at is null
      and b.disabled_at is null
      and b.pii_masked_at is null
      and (
        p_recipient_mode <> 'selected'
        or b.id = any (coalesce(p_selected_user_ids, '{}'::uuid[]))
      )
  )
  select e.id, e.email, e.nickname
  from eligible e
  where p_email_kind <> 'ad'
     or not exists (
       select 1 from public.email_unsubscribes u
       where lower(u.email) = lower(e.email) and u.scope in ('ad','all')
     );
end;
$$;

-- 미리보기: 수신자 수 + 표본 (발송 전 확인용)
create or replace function public.admin_preview_broadcast_recipients(
  p_recipient_mode text,
  p_filter jsonb default '{}'::jsonb,
  p_selected_user_ids uuid[] default '{}'::uuid[],
  p_email_kind text default 'notice'
)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_total int;
  v_excluded int := 0;
  v_sample jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  select count(*) into v_total
  from public.admin_resolve_broadcast_recipients(p_recipient_mode, p_filter, p_selected_user_ids, p_email_kind);

  -- 광고성일 때, 수신거부로 제외된 인원 계산 (kind='notice' 로 다시 해석 후 차이)
  if p_email_kind = 'ad' then
    select greatest(0, (
      select count(*) from public.admin_resolve_broadcast_recipients(p_recipient_mode, p_filter, p_selected_user_ids, 'notice')
    ) - v_total) into v_excluded;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('email', s.email, 'nickname', s.nickname)), '[]'::jsonb)
    into v_sample
  from (
    select r.email, r.nickname
    from public.admin_resolve_broadcast_recipients(p_recipient_mode, p_filter, p_selected_user_ids, p_email_kind) r
    order by r.email
    limit 20
  ) s;

  return jsonb_build_object('count', v_total, 'excluded_unsubscribed', v_excluded, 'sample', v_sample);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 캠페인 생성 + job enqueue
-- ----------------------------------------------------------------------------
create or replace function public.admin_create_broadcast_campaign(
  p_subject text,
  p_body_html text,
  p_email_kind text,
  p_recipient_mode text,
  p_filter jsonb default '{}'::jsonb,
  p_selected_user_ids uuid[] default '{}'::uuid[],
  p_scheduled_at timestamptz default null
)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_campaign_id uuid;
  v_count int;
  v_status text;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  if coalesce(btrim(p_subject),'') = '' then raise exception 'subject required'; end if;
  if coalesce(btrim(p_body_html),'') = '' then raise exception 'body required'; end if;
  if p_email_kind not in ('notice','ad') then raise exception 'invalid email_kind'; end if;
  if p_recipient_mode not in ('all','filter','selected') then raise exception 'invalid recipient_mode'; end if;

  v_status := case
    when p_scheduled_at is not null and p_scheduled_at > now() then 'scheduled'
    else 'sending'
  end;

  insert into public.admin_broadcast_campaigns(
    created_by, subject, body_html, email_kind, recipient_mode, recipient_filter, scheduled_at, status,
    started_at
  ) values (
    v_uid, p_subject, p_body_html, p_email_kind, p_recipient_mode, coalesce(p_filter,'{}'::jsonb), p_scheduled_at, v_status,
    case when v_status = 'sending' then now() else null end
  ) returning id into v_campaign_id;

  insert into public.admin_broadcast_email_jobs(campaign_id, recipient_user_id, recipient_email)
  select v_campaign_id, r.user_id, r.email
  from public.admin_resolve_broadcast_recipients(p_recipient_mode, coalesce(p_filter,'{}'::jsonb), p_selected_user_ids, p_email_kind) r
  on conflict (campaign_id, recipient_email) do nothing;

  select count(*) into v_count from public.admin_broadcast_email_jobs where campaign_id = v_campaign_id;

  if v_count = 0 then
    -- 수신자 0명 — 캠페인 즉시 취소 상태로 표기하고 에러.
    update public.admin_broadcast_campaigns set status='cancelled', completed_at=now() where id = v_campaign_id;
    raise exception 'no recipients matched';
  end if;

  update public.admin_broadcast_campaigns set total_recipients = v_count where id = v_campaign_id;

  return jsonb_build_object(
    'campaign_id', v_campaign_id,
    'total_recipients', v_count,
    'status', v_status,
    'scheduled_at', p_scheduled_at
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) Worker RPC (service_role 전용) — get_pending / lock / mark_sent / mark_failed
-- ----------------------------------------------------------------------------

-- 예약 도래 캠페인 활성화 + pending job 반환
create or replace function public.get_pending_broadcast_email_jobs(p_limit int default 100)
returns table(
  job_id uuid,
  campaign_id uuid,
  recipient_email text,
  recipient_user_id uuid,
  unsubscribe_token uuid,
  subject text,
  body_html text,
  email_kind text,
  attempts int
)
language plpgsql security definer set search_path = public
as $$
begin
  -- 예약 시간 도래한 scheduled → sending 전환
  update public.admin_broadcast_campaigns c
     set status = 'sending', started_at = coalesce(c.started_at, now())
   where c.status = 'scheduled'
     and c.scheduled_at is not null
     and c.scheduled_at <= now();

  return query
  select j.id, j.campaign_id, j.recipient_email, j.recipient_user_id, j.unsubscribe_token,
         c.subject, c.body_html, c.email_kind, j.attempts
  from public.admin_broadcast_email_jobs j
  join public.admin_broadcast_campaigns c on c.id = j.campaign_id
  where j.status = 'pending'
    and c.status = 'sending'
  order by j.created_at asc
  limit greatest(1, coalesce(p_limit, 100));
end;
$$;

create or replace function public.lock_broadcast_email_job(p_job_id uuid)
returns boolean
language plpgsql security definer set search_path = public
as $$
declare v_locked boolean := false;
begin
  update public.admin_broadcast_email_jobs
     set status = 'sending', attempts = attempts + 1, last_attempt_at = now()
   where id = p_job_id and status = 'pending'
  returning true into v_locked;
  return coalesce(v_locked, false);
end;
$$;

-- 캠페인 완료 여부 재계산 (내부)
create or replace function public._finalize_broadcast_campaign(p_campaign_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_pending int; v_sent int; v_failed int;
begin
  select
    count(*) filter (where status in ('pending','sending')),
    count(*) filter (where status = 'sent'),
    count(*) filter (where status = 'failed')
  into v_pending, v_sent, v_failed
  from public.admin_broadcast_email_jobs where campaign_id = p_campaign_id;

  update public.admin_broadcast_campaigns
     set sent_count = v_sent,
         failed_count = v_failed,
         status = case
           when v_pending > 0 then status
           when v_failed = 0 then 'sent'
           when v_sent = 0 then 'failed'
           else 'partial'
         end,
         completed_at = case when v_pending > 0 then completed_at else now() end
   where id = p_campaign_id;
end;
$$;

create or replace function public.mark_broadcast_email_sent(p_job_id uuid, p_provider_message_id text default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_campaign uuid;
begin
  update public.admin_broadcast_email_jobs
     set status='sent', sent_at=now(), provider_message_id=p_provider_message_id, last_error=null
   where id = p_job_id
  returning campaign_id into v_campaign;
  if v_campaign is not null then perform public._finalize_broadcast_campaign(v_campaign); end if;
end;
$$;

create or replace function public.mark_broadcast_email_failed(p_job_id uuid, p_error text)
returns void
language plpgsql security definer set search_path = public
as $$
declare v_campaign uuid;
begin
  update public.admin_broadcast_email_jobs
     set status='failed', last_error=left(coalesce(p_error,'unknown'), 2000)
   where id = p_job_id
  returning campaign_id into v_campaign;
  if v_campaign is not null then perform public._finalize_broadcast_campaign(v_campaign); end if;
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) 수신거부 기록 (토큰 기반, 공개 엣지 함수가 service_role 로 호출)
-- ----------------------------------------------------------------------------
create or replace function public.record_broadcast_unsubscribe(p_token uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_email text; v_user uuid;
begin
  select recipient_email, recipient_user_id into v_email, v_user
  from public.admin_broadcast_email_jobs where unsubscribe_token = p_token limit 1;
  if v_email is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  insert into public.email_unsubscribes(user_id, email, scope, source)
  values (v_user, v_email, 'ad', 'link')
  on conflict (lower(email)) do update
    set scope='ad', source='link', unsubscribed_at=now(), user_id=coalesce(excluded.user_id, email_unsubscribes.user_id);

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;

-- ----------------------------------------------------------------------------
-- 9) 관리자 조회/관리 RPC
-- ----------------------------------------------------------------------------
create or replace function public.admin_list_broadcast_campaigns(p_limit int default 50, p_offset int default 0)
returns table(
  id uuid, subject text, email_kind text, recipient_mode text, status text,
  total_recipients int, sent_count int, failed_count int,
  scheduled_at timestamptz, started_at timestamptz, completed_at timestamptz, created_at timestamptz,
  created_by_email text
)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select c.id, c.subject, c.email_kind, c.recipient_mode, c.status,
         c.total_recipients, c.sent_count, c.failed_count,
         c.scheduled_at, c.started_at, c.completed_at, c.created_at,
         au.email::text
  from public.admin_broadcast_campaigns c
  left join auth.users au on au.id = c.created_by
  order by c.created_at desc
  limit greatest(1, coalesce(p_limit,50)) offset greatest(0, coalesce(p_offset,0));
end;
$$;

create or replace function public.admin_get_broadcast_campaign(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select jsonb_build_object(
    'campaign', to_jsonb(c.*),
    'jobs_by_status', (
      select coalesce(jsonb_object_agg(status, cnt), '{}'::jsonb)
      from (select status, count(*) as cnt from public.admin_broadcast_email_jobs where campaign_id=c.id group by status) t
    ),
    'recent_failures', (
      select coalesce(jsonb_agg(jsonb_build_object('email', recipient_email, 'error', last_error) order by last_attempt_at desc), '[]'::jsonb)
      from (select recipient_email, last_error, last_attempt_at from public.admin_broadcast_email_jobs
            where campaign_id=c.id and status='failed' order by last_attempt_at desc limit 20) f
    )
  ) into v
  from public.admin_broadcast_campaigns c where c.id = p_id;
  return v;
end;
$$;

create or replace function public.admin_cancel_broadcast_campaign(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_status text; v_cancelled int;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select status into v_status from public.admin_broadcast_campaigns where id = p_id;
  if v_status is null then raise exception 'campaign not found'; end if;
  if v_status in ('sent','failed','partial','cancelled') then
    raise exception 'campaign already finished (%).', v_status;
  end if;

  update public.admin_broadcast_email_jobs
     set status='cancelled'
   where campaign_id = p_id and status in ('pending','sending');
  get diagnostics v_cancelled = row_count;

  update public.admin_broadcast_campaigns set status='cancelled', completed_at=now() where id = p_id;
  return jsonb_build_object('ok', true, 'cancelled_jobs', v_cancelled);
end;
$$;

create or replace function public.admin_list_email_unsubscribes(p_limit int default 100, p_offset int default 0, p_search text default null)
returns table(id uuid, email text, user_id uuid, scope text, source text, unsubscribed_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select u.id, u.email, u.user_id, u.scope, u.source, u.unsubscribed_at
  from public.email_unsubscribes u
  where p_search is null or u.email ilike '%'||p_search||'%'
  order by u.unsubscribed_at desc
  limit greatest(1, coalesce(p_limit,100)) offset greatest(0, coalesce(p_offset,0));
end;
$$;

create or replace function public.admin_add_email_unsubscribe(p_email text, p_scope text default 'ad')
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_user uuid;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  if coalesce(btrim(p_email),'') = '' then raise exception 'email required'; end if;
  if p_scope not in ('ad','all') then raise exception 'invalid scope'; end if;
  select id into v_user from auth.users where lower(email) = lower(btrim(p_email)) limit 1;
  insert into public.email_unsubscribes(user_id, email, scope, source)
  values (v_user, btrim(p_email), p_scope, 'admin')
  on conflict (lower(email)) do update set scope=excluded.scope, source='admin', unsubscribed_at=now();
  return jsonb_build_object('ok', true);
end;
$$;

create or replace function public.admin_remove_email_unsubscribe(p_email text)
returns jsonb
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  delete from public.email_unsubscribes where lower(email) = lower(btrim(p_email));
  return jsonb_build_object('ok', true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 10) 권한 — 관리자 RPC 는 authenticated(+service_role), worker/unsubscribe 는 service_role 전용
-- ----------------------------------------------------------------------------
grant execute on function public.admin_resolve_broadcast_recipients(text, jsonb, uuid[], text) to authenticated, service_role;
grant execute on function public.admin_preview_broadcast_recipients(text, jsonb, uuid[], text) to authenticated, service_role;
grant execute on function public.admin_create_broadcast_campaign(text, text, text, text, jsonb, uuid[], timestamptz) to authenticated, service_role;
grant execute on function public.admin_list_broadcast_campaigns(int, int) to authenticated, service_role;
grant execute on function public.admin_get_broadcast_campaign(uuid) to authenticated, service_role;
grant execute on function public.admin_cancel_broadcast_campaign(uuid) to authenticated, service_role;
grant execute on function public.admin_list_email_unsubscribes(int, int, text) to authenticated, service_role;
grant execute on function public.admin_add_email_unsubscribe(text, text) to authenticated, service_role;
grant execute on function public.admin_remove_email_unsubscribe(text) to authenticated, service_role;

-- worker + unsubscribe 기록 — service_role 전용 (0142 하드닝 패턴)
revoke execute on function public.get_pending_broadcast_email_jobs(int) from public, anon, authenticated;
revoke execute on function public.lock_broadcast_email_job(uuid) from public, anon, authenticated;
revoke execute on function public.mark_broadcast_email_sent(uuid, text) from public, anon, authenticated;
revoke execute on function public.mark_broadcast_email_failed(uuid, text) from public, anon, authenticated;
revoke execute on function public._finalize_broadcast_campaign(uuid) from public, anon, authenticated;
revoke execute on function public.record_broadcast_unsubscribe(uuid) from public, anon, authenticated;
grant  execute on function public.get_pending_broadcast_email_jobs(int) to service_role;
grant  execute on function public.lock_broadcast_email_job(uuid) to service_role;
grant  execute on function public.mark_broadcast_email_sent(uuid, text) to service_role;
grant  execute on function public.mark_broadcast_email_failed(uuid, text) to service_role;
grant  execute on function public.record_broadcast_unsubscribe(uuid) to service_role;
