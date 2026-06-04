-- 0287 — support_contact_events: 외부 채널 문의 진입 이벤트 로깅 (X6.2.8)
--
-- 목적: 카카오톡 채널 "카톡으로 문의" 버튼 클릭 등 외부 채널 진입을 기록.
-- 자동 발송 기능이 아니라 "사용자가 우리 측 채널로 이동했다" 는 이벤트.
-- 운영자는 이 로그를 보고 카톡 채널에서 실제 메시지 도착 여부 추적.
--
-- support_inquiries 와 분리:
--   - support_inquiries = 폼 제출 문의 (admin_notifications 자동 발송)
--   - support_contact_events = 외부 채널 진입 클릭 로그 (자동 발송 없음)

create table if not exists public.support_contact_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  user_email text,
  channel text not null check (channel in ('kakao','tel','email')),
  action text not null check (action in ('open_chat','add_friend','open_channel','dial','mailto')),
  page_url text,
  user_agent text,
  device_type text,
  context jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_support_contact_events_created
  on public.support_contact_events(created_at desc);
create index if not exists idx_support_contact_events_channel_action
  on public.support_contact_events(channel, action, created_at desc);
create index if not exists idx_support_contact_events_user
  on public.support_contact_events(user_id, created_at desc)
  where user_id is not null;

alter table public.support_contact_events enable row level security;

-- 본인 + admin 만 읽기
drop policy if exists "sce select self or admin" on public.support_contact_events;
create policy "sce select self or admin" on public.support_contact_events
  for select to authenticated
  using (
    user_id = auth.uid()
    or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- INSERT 는 RPC 로만 (직접 INSERT 차단)

-- ===== log_support_contact_event RPC =====
-- 익명도 호출 가능 (로그인 안 한 사용자 카톡 클릭도 추적).
-- user_id 는 auth.uid() 자동 채움 (있을 때).
create or replace function public.log_support_contact_event(
  p_channel text,
  p_action text,
  p_page_url text default null,
  p_user_agent text default null,
  p_device_type text default null,
  p_context jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_email text;
  v_id bigint;
begin
  -- 채널/액션 검증 (CHECK constraint 도 있지만 빠른 reject)
  if p_channel not in ('kakao','tel','email') then
    return jsonb_build_object('ok', false, 'error', 'invalid_channel');
  end if;
  if p_action not in ('open_chat','add_friend','open_channel','dial','mailto') then
    return jsonb_build_object('ok', false, 'error', 'invalid_action');
  end if;

  if v_uid is not null then
    select au.email::text into v_email from auth.users au where au.id = v_uid;
  end if;

  insert into public.support_contact_events (
    user_id, user_email, channel, action,
    page_url, user_agent, device_type, context
  ) values (
    v_uid, v_email, p_channel, p_action,
    nullif(btrim(coalesce(p_page_url,'')),''),
    nullif(btrim(coalesce(p_user_agent,'')),''),
    nullif(btrim(coalesce(p_device_type,'')),''),
    coalesce(p_context, '{}'::jsonb)
  ) returning id into v_id;

  return jsonb_build_object('ok', true, 'event_id', v_id);
exception when others then
  -- 로깅 실패해도 호출자 흐름 차단 금지
  return jsonb_build_object('ok', false, 'error', sqlerrm);
end; $$;

revoke all on function public.log_support_contact_event(text,text,text,text,text,jsonb) from public;
grant execute on function public.log_support_contact_event(text,text,text,text,text,jsonb) to anon, authenticated, service_role;

-- ===== admin_list_support_contact_events =====
create or replace function public.admin_list_support_contact_events(
  p_days int default 7,
  p_channel text default null,
  p_action text default null,
  p_limit int default 200
) returns table (
  id bigint, user_id uuid, user_email text,
  channel text, action text,
  page_url text, device_type text,
  context jsonb, created_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select e.id, e.user_id, e.user_email,
         e.channel, e.action,
         e.page_url, e.device_type,
         e.context, e.created_at
  from public.support_contact_events e
  where e.created_at >= now() - (p_days || ' days')::interval
    and (p_channel is null or e.channel = p_channel)
    and (p_action is null or e.action = p_action)
  order by e.created_at desc
  limit greatest(1, p_limit);
end; $$;

revoke all on function public.admin_list_support_contact_events(int,text,text,int) from public, anon;
grant execute on function public.admin_list_support_contact_events(int,text,text,int) to authenticated, service_role;
