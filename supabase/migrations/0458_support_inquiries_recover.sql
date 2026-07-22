-- 0458 — RPC-MIGRATION-RECOVERY-1B · Cluster B: support inquiries (Production-only drift recovery)
--
-- 배경: support_inquiries / support_inquiry_attachments 테이블 + 7개 RPC 가 Production 에만
--   존재(Repository/Test 부재). Production 정의를 정확히 복구하여 Repository/Test 재현.
--
-- 보안 상태(Production 검증 결과):
--   · 사용자 함수(create/list_my/get_my)는 owner 를 auth.uid() 로 결정(클라이언트 user_id 미신뢰),
--     조회는 user_id = auth.uid() 로 소유자 격리. → 과도노출 없음, verbatim 복구.
--   · admin_* 4개는 내부 admin role 검사(users.role='admin') 존재. → verbatim 복구.
--   따라서 Cluster A 와 달리 Cluster B 는 over-exposure 교정 대상 없음(전부 이미 안전).
--   Grant 는 fail-closed 로 명시(REVOKE PUBLIC, anon 없음, authenticated + 내부 검사).
--
-- 적용 대상: 이번 Phase 는 Test Supabase 에만 적용. Production 미변경.

-- ── 테이블 ───────────────────────────────────────────────────────────────
create table if not exists public.support_inquiries (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid references public.users(id) on delete set null,
  user_email                text,
  user_role                 text,
  business_id               uuid references public.business_profiles(id) on delete set null,
  artist_id                 uuid references public.artist_profiles(id) on delete set null,
  inquiry_type              text not null
    check (inquiry_type = any (array['재생 오류','플레이리스트 문의','결제/구독 문의','정산 문의','정산 정보 등록','음원 등록 문의','계정/로그인 문의','기타'])),
  title                     text not null check (length(btrim(title)) > 0),
  body                      text not null check (length(btrim(body)) > 0),
  contact_email             text,
  contact_phone             text,
  wants_kakao_contact       boolean not null default false,
  status                    text not null default 'open'
    check (status = any (array['open','in_progress','resolved','closed'])),
  priority                  text not null default 'normal'
    check (priority = any (array['low','normal','high','urgent'])),
  current_page_url          text,
  browser_user_agent        text,
  context                   jsonb not null default '{}'::jsonb,
  admin_note                text,
  assigned_admin_id         uuid references public.users(id) on delete set null,
  kakao_channel_status      text,
  kakao_notification_sent_at timestamptz,
  kakao_notification_error  text,
  resolved_at               timestamptz,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create index if not exists idx_support_inquiries_status_created on public.support_inquiries using btree (status, created_at desc);
create index if not exists idx_support_inquiries_priority_status on public.support_inquiries using btree (priority, status, created_at desc);
create index if not exists idx_support_inquiries_user on public.support_inquiries using btree (user_id, created_at desc) where (user_id is not null);
create index if not exists idx_support_inquiries_assigned on public.support_inquiries using btree (assigned_admin_id, status) where (assigned_admin_id is not null);

create table if not exists public.support_inquiry_attachments (
  id          uuid primary key default gen_random_uuid(),
  inquiry_id  uuid not null references public.support_inquiries(id) on delete cascade,
  file_url    text not null,
  file_name   text,
  file_type   text,
  file_size   bigint,
  created_at  timestamptz not null default now()
);
create index if not exists idx_support_attachments_inquiry on public.support_inquiry_attachments using btree (inquiry_id);

-- ── RLS + Policies (소유자 격리) ────────────────────────────────────────────
alter table public.support_inquiries enable row level security;
alter table public.support_inquiry_attachments enable row level security;

drop policy if exists "si select self or admin" on public.support_inquiries;
create policy "si select self or admin" on public.support_inquiries for select to authenticated
  using (user_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "si admin update" on public.support_inquiries;
create policy "si admin update" on public.support_inquiries for update to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))
  with check (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

drop policy if exists "sia select self or admin" on public.support_inquiry_attachments;
create policy "sia select self or admin" on public.support_inquiry_attachments for select to authenticated
  using (exists (select 1 from public.support_inquiries si
    where si.id = support_inquiry_attachments.inquiry_id
      and (si.user_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'))));

-- ── 함수 (Production verbatim; 소유자/admin 검사 내장) ────────────────────────
create or replace function public.create_support_inquiry(p_inquiry_type text, p_title text, p_body text, p_contact_email text default null, p_contact_phone text default null, p_wants_kakao_contact boolean default false, p_current_page_url text default null, p_browser_user_agent text default null, p_context jsonb default '{}'::jsonb, p_attachments jsonb default '[]'::jsonb)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_email text; v_role text; v_biz_id uuid; v_artist_id uuid; v_inquiry_id uuid; v_priority text; v_attachment jsonb;
begin
  if v_uid is null then raise exception 'unauthorized' using hint = '로그인 후 문의해주세요'; end if;
  select u.role into v_role from public.users u where u.id = v_uid;
  select au.email::text into v_email from auth.users au where au.id = v_uid;
  select id into v_biz_id from public.business_profiles where user_id = v_uid limit 1;
  select id into v_artist_id from public.artist_profiles where user_id = v_uid limit 1;
  insert into public.support_inquiries (user_id, user_email, user_role, business_id, artist_id, inquiry_type, title, body, contact_email, contact_phone, wants_kakao_contact, current_page_url, browser_user_agent, context)
  values (v_uid, v_email, v_role, v_biz_id, v_artist_id, p_inquiry_type, btrim(p_title), btrim(p_body), coalesce(nullif(btrim(p_contact_email),''), v_email), nullif(btrim(p_contact_phone),''), coalesce(p_wants_kakao_contact, false), nullif(btrim(p_current_page_url),''), nullif(btrim(p_browser_user_agent),''), coalesce(p_context, '{}'::jsonb))
  returning id, priority into v_inquiry_id, v_priority;
  if jsonb_typeof(p_attachments) = 'array' then
    for v_attachment in select * from jsonb_array_elements(p_attachments) loop
      if v_attachment ? 'file_url' then
        insert into public.support_inquiry_attachments (inquiry_id, file_url, file_name, file_type, file_size)
        values (v_inquiry_id, v_attachment->>'file_url', v_attachment->>'file_name', v_attachment->>'file_type', nullif(v_attachment->>'file_size','')::bigint);
      end if;
    end loop;
  end if;
  begin
    insert into public.admin_notifications (kind, severity, title, body, context)
    values ('support_inquiry',
      case v_priority when 'urgent' then 'error' when 'high' then 'warning' else 'info' end,
      format('[DEUDDA 문의] %s - %s', p_inquiry_type, btrim(p_title)),
      format(E'문의 유형: %s\n제목: %s\n\n내용:\n%s\n\n— 회원 정보 —\n이메일: %s\n역할: %s\n연락처: %s\n카카오톡 상담: %s',
        p_inquiry_type, btrim(p_title), btrim(p_body), coalesce(v_email,'-'), coalesce(v_role,'-'),
        coalesce(nullif(btrim(p_contact_phone),''), '-'), case when p_wants_kakao_contact then '희망' else '비희망' end),
      jsonb_build_object('inquiry_id', v_inquiry_id, 'inquiry_type', p_inquiry_type, 'priority', v_priority, 'user_id', v_uid, 'user_email', v_email, 'user_role', v_role, 'business_id', v_biz_id, 'artist_id', v_artist_id, 'current_page_url', p_current_page_url, 'inquiry_context', p_context));
  exception when others then
    update public.support_inquiries set context = context || jsonb_build_object('notification_error', sqlerrm) where id = v_inquiry_id;
  end;
  return jsonb_build_object('ok', true, 'inquiry_id', v_inquiry_id, 'priority', v_priority, 'inquiry_type', p_inquiry_type);
end; $function$;

create or replace function public.list_my_inquiries(p_limit integer default 50)
 returns table(id uuid, inquiry_type text, title text, status text, priority text, admin_note text, created_at timestamptz, resolved_at timestamptz)
 language sql stable security definer set search_path to 'public'
as $function$
  select id, inquiry_type, title, status, priority, admin_note, created_at, resolved_at
  from public.support_inquiries where user_id = auth.uid()
  order by created_at desc limit greatest(1, p_limit);
$function$;

create or replace function public.get_my_inquiry_detail(p_inquiry_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v jsonb;
begin
  select jsonb_build_object('inquiry', to_jsonb(si),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.support_inquiry_attachments a where a.inquiry_id = si.id), '[]'::jsonb)) into v
  from public.support_inquiries si
  where si.id = p_inquiry_id
    and (si.user_id = auth.uid() or exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));
  if v is null then raise exception 'not_found'; end if;
  return v;
end; $function$;

create or replace function public.admin_list_support_inquiries(p_status text default null, p_inquiry_type text default null, p_priority text default null, p_assigned_admin_id uuid default null, p_search text default null, p_limit integer default 100)
 returns table(id uuid, user_id uuid, user_email text, user_role text, business_id uuid, artist_id uuid, inquiry_type text, title text, body text, contact_email text, contact_phone text, wants_kakao_contact boolean, status text, priority text, current_page_url text, context jsonb, admin_note text, assigned_admin_id uuid, resolved_at timestamptz, created_at timestamptz, updated_at timestamptz, attachment_count bigint)
 language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then raise exception 'unauthorized'; end if;
  return query
  select si.id, si.user_id, si.user_email, si.user_role, si.business_id, si.artist_id, si.inquiry_type, si.title, si.body,
    si.contact_email, si.contact_phone, si.wants_kakao_contact, si.status, si.priority, si.current_page_url, si.context,
    si.admin_note, si.assigned_admin_id, si.resolved_at, si.created_at, si.updated_at,
    (select count(*) from public.support_inquiry_attachments a where a.inquiry_id = si.id) as attachment_count
  from public.support_inquiries si
  where (p_status is null or si.status = p_status)
    and (p_inquiry_type is null or si.inquiry_type = p_inquiry_type)
    and (p_priority is null or si.priority = p_priority)
    and (p_assigned_admin_id is null or si.assigned_admin_id = p_assigned_admin_id)
    and (p_search is null or (si.title ilike '%' || p_search || '%' or si.body ilike '%' || p_search || '%' or coalesce(si.user_email,'') ilike '%' || p_search || '%'))
  order by case si.priority when 'urgent' then 1 when 'high' then 2 when 'normal' then 3 else 4 end,
    case si.status when 'open' then 1 when 'in_progress' then 2 when 'resolved' then 3 else 4 end, si.created_at desc
  limit greatest(1, p_limit);
end; $function$;

create or replace function public.admin_get_support_inquiry_detail(p_inquiry_id uuid)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_admin uuid := auth.uid(); v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then raise exception 'unauthorized'; end if;
  select jsonb_build_object('inquiry', to_jsonb(si),
    'attachments', coalesce((select jsonb_agg(to_jsonb(a) order by a.created_at) from public.support_inquiry_attachments a where a.inquiry_id = si.id), '[]'::jsonb),
    'business', (select to_jsonb(bp) from public.business_profiles bp where bp.id = si.business_id),
    'artist', (select to_jsonb(ap) from public.artist_profiles ap where ap.id = si.artist_id)) into v
  from public.support_inquiries si where si.id = p_inquiry_id;
  if v is null then raise exception 'not_found'; end if;
  return v;
end; $function$;

create or replace function public.admin_support_inquiry_summary(p_days integer default 30)
 returns jsonb language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_admin uuid := auth.uid(); v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then raise exception 'unauthorized'; end if;
  select jsonb_build_object('window_days', p_days, 'total', count(*),
    'open', count(*) filter (where status='open'), 'in_progress', count(*) filter (where status='in_progress'),
    'resolved', count(*) filter (where status='resolved'), 'closed', count(*) filter (where status='closed'),
    'urgent_open', count(*) filter (where status in ('open','in_progress') and priority='urgent'),
    'by_type', coalesce((select jsonb_object_agg(inquiry_type, cnt) from (select inquiry_type, count(*) as cnt from public.support_inquiries where created_at > now() - (p_days || ' days')::interval group by inquiry_type) s), '{}'::jsonb)) into v
  from public.support_inquiries where created_at > now() - (p_days || ' days')::interval;
  return v;
end; $function$;

create or replace function public.admin_update_inquiry(p_inquiry_id uuid, p_status text default null, p_priority text default null, p_admin_note text default null, p_assigned_admin_id uuid default null)
 returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_admin uuid := auth.uid(); v_count int;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then raise exception 'unauthorized'; end if;
  update public.support_inquiries set
    status = coalesce(p_status, status), priority = coalesce(p_priority, priority),
    admin_note = coalesce(p_admin_note, admin_note),
    assigned_admin_id = case when p_assigned_admin_id is null then assigned_admin_id else p_assigned_admin_id end
  where id = p_inquiry_id;
  get diagnostics v_count = row_count;
  if v_count = 0 then raise exception 'not_found'; end if;
  return jsonb_build_object('ok', true, 'inquiry_id', p_inquiry_id);
end; $function$;

-- ── Grants (fail-closed: revoke PUBLIC, anon 없음, authenticated + 내부 검사) ──
revoke all on function public.create_support_inquiry(text,text,text,text,text,boolean,text,text,jsonb,jsonb) from public;
revoke all on function public.list_my_inquiries(integer) from public;
revoke all on function public.get_my_inquiry_detail(uuid) from public;
revoke all on function public.admin_list_support_inquiries(text,text,text,uuid,text,integer) from public;
revoke all on function public.admin_get_support_inquiry_detail(uuid) from public;
revoke all on function public.admin_support_inquiry_summary(integer) from public;
revoke all on function public.admin_update_inquiry(uuid,text,text,text,uuid) from public;

grant execute on function public.create_support_inquiry(text,text,text,text,text,boolean,text,text,jsonb,jsonb) to authenticated;
grant execute on function public.list_my_inquiries(integer) to authenticated;
grant execute on function public.get_my_inquiry_detail(uuid) to authenticated;
grant execute on function public.admin_list_support_inquiries(text,text,text,uuid,text,integer) to authenticated;
grant execute on function public.admin_get_support_inquiry_detail(uuid) to authenticated;
grant execute on function public.admin_support_inquiry_summary(integer) to authenticated;
grant execute on function public.admin_update_inquiry(uuid,text,text,text,uuid) to authenticated;

comment on table public.support_inquiries is 'RPC-MIGRATION-RECOVERY-1B: recovered from Production (owner=auth.uid; RLS self-or-admin).';
