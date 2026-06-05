-- 0289 — Inquiry events + 운영자 답변 발송 RPC (X6.3)
--
-- 신규: support_inquiry_events (audit log + 향후 카카오/webhook dispatcher 트리거 포인트)
-- 신규: admin_send_inquiry_reply RPC (답변 본문 + 상태 자동 업데이트)
-- 상태 매핑 (한국어 라벨 — DB 는 영문 enum 유지):
--   open          = 신규
--   in_progress   = 처리중
--   resolved      = 답변완료
--   closed        = 종료

-- ===== A. support_inquiry_events (audit log) =====
create table if not exists public.support_inquiry_events (
  id bigserial primary key,
  inquiry_id uuid not null references public.support_inquiries(id) on delete cascade,
  actor_user_id uuid references public.users(id) on delete set null,
  event_type text not null check (event_type in (
    'created',
    'status_changed',
    'priority_changed',
    'note_updated',
    'reply_sent',
    'reply_failed',
    'assigned',
    'kakao_dispatched',
    'kakao_failed',
    'webhook_dispatched',
    'webhook_failed'
  )),
  channel text check (channel is null or channel in (
    'email', 'kakao_chat', 'kakao_alimtalk', 'kakao_friendtalk', 'webhook'
  )),
  before_data jsonb,
  after_data jsonb,
  detail text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sie_inquiry_created
  on public.support_inquiry_events(inquiry_id, created_at desc);
create index if not exists idx_sie_event_type
  on public.support_inquiry_events(event_type, created_at desc);

alter table public.support_inquiry_events enable row level security;
drop policy if exists "sie admin read" on public.support_inquiry_events;
create policy "sie admin read" on public.support_inquiry_events
  for select to authenticated
  using (exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin'));

-- ===== B. admin_send_inquiry_reply RPC =====
create or replace function public.admin_send_inquiry_reply(
  p_inquiry_id uuid,
  p_reply_body text,
  p_status text default 'resolved'
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_inq record;
  v_before jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_status not in ('in_progress','resolved','closed') then
    raise exception 'invalid_status: %', p_status;
  end if;
  if p_reply_body is null or length(btrim(p_reply_body)) = 0 then
    raise exception 'reply_body_required';
  end if;

  select id, user_id, user_email, status, admin_note, assigned_admin_id, inquiry_type, title
    into v_inq
  from public.support_inquiries
  where id = p_inquiry_id;
  if v_inq.id is null then raise exception 'not_found'; end if;

  v_before := jsonb_build_object(
    'status', v_inq.status,
    'admin_note', v_inq.admin_note,
    'assigned_admin_id', v_inq.assigned_admin_id
  );

  update public.support_inquiries set
    admin_note = btrim(p_reply_body),
    status = p_status,
    assigned_admin_id = coalesce(assigned_admin_id, v_admin)
  where id = p_inquiry_id;

  -- 이벤트 로그 — 향후 카카오/webhook dispatcher 트리거 포인트
  insert into public.support_inquiry_events
    (inquiry_id, actor_user_id, event_type, channel, before_data, after_data, detail)
  values
    (p_inquiry_id, v_admin, 'reply_sent', 'email',
     v_before,
     jsonb_build_object('status', p_status, 'reply_body_length', length(btrim(p_reply_body))),
     format('Admin reply queued for email dispatch to %s', coalesce(v_inq.user_email, '?')));

  return jsonb_build_object(
    'ok', true,
    'inquiry_id', p_inquiry_id,
    'status', p_status,
    'user_email', v_inq.user_email,
    'user_id', v_inq.user_id,
    'inquiry_type', v_inq.inquiry_type,
    'title', v_inq.title
  );
end; $$;

revoke all on function public.admin_send_inquiry_reply(uuid,text,text) from public, anon;
grant execute on function public.admin_send_inquiry_reply(uuid,text,text) to authenticated, service_role;

-- ===== C. admin_list_inquiry_events RPC (특정 문의의 이벤트 타임라인) =====
create or replace function public.admin_list_inquiry_events(p_inquiry_id uuid)
returns table (
  id bigint,
  event_type text,
  channel text,
  actor_user_id uuid,
  actor_email text,
  before_data jsonb,
  after_data jsonb,
  detail text,
  created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select e.id, e.event_type, e.channel,
         e.actor_user_id, au.email::text,
         e.before_data, e.after_data, e.detail, e.created_at
  from public.support_inquiry_events e
  left join auth.users au on au.id = e.actor_user_id
  where e.inquiry_id = p_inquiry_id
  order by e.created_at desc;
end; $$;

revoke all on function public.admin_list_inquiry_events(uuid) from public, anon;
grant execute on function public.admin_list_inquiry_events(uuid) to authenticated, service_role;

-- ===== D. 기존 admin_update_inquiry 에 status 변경 이벤트 자동 로깅 =====
-- (트리거로 처리 — admin_update_inquiry / 직접 UPDATE 모두 캡처)
create or replace function public._support_inquiries_log_changes()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.status is distinct from old.status then
      insert into public.support_inquiry_events
        (inquiry_id, actor_user_id, event_type, before_data, after_data)
      values (
        new.id, auth.uid(), 'status_changed',
        jsonb_build_object('status', old.status),
        jsonb_build_object('status', new.status)
      );
    end if;
    if new.priority is distinct from old.priority then
      insert into public.support_inquiry_events
        (inquiry_id, actor_user_id, event_type, before_data, after_data)
      values (
        new.id, auth.uid(), 'priority_changed',
        jsonb_build_object('priority', old.priority),
        jsonb_build_object('priority', new.priority)
      );
    end if;
    if new.assigned_admin_id is distinct from old.assigned_admin_id and new.assigned_admin_id is not null then
      insert into public.support_inquiry_events
        (inquiry_id, actor_user_id, event_type, before_data, after_data)
      values (
        new.id, auth.uid(), 'assigned',
        jsonb_build_object('assigned_admin_id', old.assigned_admin_id),
        jsonb_build_object('assigned_admin_id', new.assigned_admin_id)
      );
    end if;
  elsif tg_op = 'INSERT' then
    insert into public.support_inquiry_events
      (inquiry_id, actor_user_id, event_type, after_data)
    values (
      new.id, new.user_id, 'created',
      jsonb_build_object('inquiry_type', new.inquiry_type, 'priority', new.priority)
    );
  end if;
  return new;
end; $$;

drop trigger if exists trg_support_inquiries_log on public.support_inquiries;
create trigger trg_support_inquiries_log
  after insert or update on public.support_inquiries
  for each row execute function public._support_inquiries_log_changes();
