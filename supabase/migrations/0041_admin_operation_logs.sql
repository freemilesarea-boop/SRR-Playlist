-- ============================================
-- 0041_admin_operation_logs.sql
--
-- 운영 로그 시스템: Edge Function / RPC / Webhook 등에서 발생하는 작업 결과를
-- 한 테이블에 누적 저장. 관리자가 "운영 로그" 탭에서 한눈에 조회.
--
-- 구성:
--   1) admin_operation_logs 테이블
--   2) admin_log_operation(...) — service_role / security-definer RPC 만 호출
--   3) list_admin_operation_logs(...) — admin 조회 + 필터
--   4) admin_operation_log_kpi() — 최근 24h KPI 카운터
--   5) clear_old_admin_operation_logs(p_days) — 30일 이전 정리
-- ============================================

create table if not exists public.admin_operation_logs (
  id uuid primary key default gen_random_uuid(),
  source text not null,         -- e.g., 'payapp-feedback', 'sync-payapp-payments'
  category text not null,       -- e.g., 'payment','webhook','analytics','member','system','rpc'
  level text not null check (level in ('info','success','warning','error')),
  status text not null,         -- 'started','completed','failed','skipped' 등
  message text not null,
  details jsonb not null default '{}'::jsonb,
  user_id uuid references public.users(id) on delete set null,
  related_id text,              -- 자유 형식 식별자 (payapp_mul_no / order_no / event_id 등)
  duration_ms integer,
  error_code text,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists idx_admin_op_logs_created
  on public.admin_operation_logs(created_at desc);
create index if not exists idx_admin_op_logs_source
  on public.admin_operation_logs(source);
create index if not exists idx_admin_op_logs_category
  on public.admin_operation_logs(category);
create index if not exists idx_admin_op_logs_level
  on public.admin_operation_logs(level);
create index if not exists idx_admin_op_logs_related
  on public.admin_operation_logs(related_id);

alter table public.admin_operation_logs enable row level security;

drop policy if exists "op_logs_admin_select" on public.admin_operation_logs;
create policy "op_logs_admin_select" on public.admin_operation_logs
  for select using (
    exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin')
  );
-- INSERT 는 RLS 거치지 않는 service_role / security definer RPC 만 허용.

-- ----------------------
-- admin_log_operation — 호출자 RPC/Edge 가 사용. NEVER 실패하지 않음.
-- ----------------------
create or replace function public.admin_log_operation(
  p_source text,
  p_category text,
  p_level text,
  p_status text,
  p_message text,
  p_details jsonb default '{}'::jsonb,
  p_user_id uuid default null,
  p_related_id text default null,
  p_duration_ms int default null,
  p_error_code text default null,
  p_error_message text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  -- level 검증 (잘못된 값이 들어와도 'info' 로 fallback — 호출자를 막지 않음)
  insert into public.admin_operation_logs
    (source, category, level, status, message, details, user_id,
     related_id, duration_ms, error_code, error_message)
  values (
    coalesce(nullif(btrim(p_source), ''), 'unknown'),
    coalesce(nullif(btrim(p_category), ''), 'system'),
    case when p_level in ('info','success','warning','error') then p_level else 'info' end,
    coalesce(nullif(btrim(p_status), ''), 'unknown'),
    coalesce(nullif(btrim(p_message), ''), '(empty)'),
    coalesce(p_details, '{}'::jsonb),
    p_user_id, p_related_id, p_duration_ms, p_error_code, p_error_message
  )
  returning id into v_id;
  return v_id;
exception when others then
  -- 로그 기록 자체가 호출자를 막으면 안 됨
  return null;
end;
$$;

-- admin RPC / Edge Function service_role 만 호출. authenticated 차단.
revoke execute on function public.admin_log_operation(text,text,text,text,text,jsonb,uuid,text,int,text,text) from public;
do $$
begin
  begin grant execute on function public.admin_log_operation(text,text,text,text,text,jsonb,uuid,text,int,text,text) to service_role;
  exception when undefined_object then null; end;
end $$;

-- ----------------------
-- list_admin_operation_logs — admin 조회 + 필터
-- ----------------------
create or replace function public.list_admin_operation_logs(
  p_limit int default 100,
  p_level text default null,
  p_category text default null,
  p_source text default null,
  p_search text default null
)
returns table(
  id uuid,
  source text, category text, level text, status text,
  message text, details jsonb,
  user_id uuid, user_email text,
  related_id text,
  duration_ms int,
  error_code text, error_message text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
declare v_search text := btrim(coalesce(p_search, ''));
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select l.id, l.source, l.category, l.level, l.status, l.message, l.details,
         l.user_id, au.email::text as user_email,
         l.related_id, l.duration_ms, l.error_code, l.error_message, l.created_at
  from public.admin_operation_logs as l
  left join auth.users as au on au.id = l.user_id
  where (p_level is null or l.level = p_level)
    and (p_category is null or l.category = p_category)
    and (p_source is null or l.source ilike '%' || p_source || '%')
    and (
      v_search = ''
      or l.message ilike '%' || v_search || '%'
      or coalesce(l.related_id,'') ilike '%' || v_search || '%'
      or l.details::text ilike '%' || v_search || '%'
      or coalesce(l.error_message,'') ilike '%' || v_search || '%'
    )
  order by l.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_admin_operation_logs(int, text, text, text, text) to authenticated;

-- ----------------------
-- admin_operation_log_kpi — 최근 24h KPI
-- ----------------------
create or replace function public.admin_operation_log_kpi()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'errors_24h', (select count(*) from public.admin_operation_logs as l
                   where l.created_at > now() - interval '24 hours' and l.level = 'error'),
    'warnings_24h', (select count(*) from public.admin_operation_logs as l
                     where l.created_at > now() - interval '24 hours' and l.level = 'warning'),
    'success_24h', (select count(*) from public.admin_operation_logs as l
                    where l.created_at > now() - interval '24 hours' and l.level = 'success'),
    'payment_24h', (select count(*) from public.admin_operation_logs as l
                    where l.created_at > now() - interval '24 hours' and l.category = 'payment'),
    'total_24h', (select count(*) from public.admin_operation_logs as l
                  where l.created_at > now() - interval '24 hours')
  ) into v_result;
  return v_result;
end;
$$;

grant execute on function public.admin_operation_log_kpi() to authenticated;

-- ----------------------
-- clear_old_admin_operation_logs — 30일 이전 정리
-- ----------------------
create or replace function public.clear_old_admin_operation_logs(p_days int default 30)
returns int
language plpgsql security definer set search_path = public
as $$
declare v_deleted int;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  delete from public.admin_operation_logs
  where created_at < now() - make_interval(days => greatest(1, p_days));
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

grant execute on function public.clear_old_admin_operation_logs(int) to authenticated;

-- 확인
select
  'logs_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_1,
  'log_op_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_log_operation')
    then 'OK' else 'MISSING' end) as check_2,
  'list_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_3,
  'kpi_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_operation_log_kpi')
    then 'OK' else 'MISSING' end) as check_4,
  'clear_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='clear_old_admin_operation_logs')
    then 'OK' else 'MISSING' end) as check_5;
