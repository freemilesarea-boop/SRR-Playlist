-- ============================================
-- 0043_subscription_requests_list_rpc.sql
--
-- /admin → 구독신청 탭이 'schema.sql 적용 필요' 경고를 띄우는 원인:
--   list_subscription_requests RPC 가 운영 DB 에 존재하지 않음.
--   (subscription_requests 테이블은 0001 부터 존재. RPC 만 누락.)
--
-- 본 migration 은:
--   1) list_subscription_requests() RPC 생성 — admin 또는 service_role 호출 가능.
--      auth.users.email + public.users.nickname / account_type 조인 결과 반환.
--   2) SQL Editor (postgres role) 우회는 0031 의 _internal_is_admin_caller() 사용.
-- ============================================

drop function if exists public.list_subscription_requests();

create or replace function public.list_subscription_requests()
returns table(
  id uuid,
  user_id uuid,
  email text,
  nickname text,
  account_type text,
  requested_plan text,
  status text,
  note text,
  created_at timestamptz
)
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    sr.id,
    sr.user_id,
    au.email::text as email,
    u.nickname,
    coalesce(u.account_type, 'individual')::text as account_type,
    sr.requested_plan,
    sr.status,
    sr.note,
    sr.created_at
  from public.subscription_requests as sr
  left join public.users as u on u.id = sr.user_id
  left join auth.users as au on au.id = sr.user_id
  order by
    case sr.status when 'pending' then 0 when 'contacted' then 1 else 2 end,
    sr.created_at desc;
end;
$$;

grant execute on function public.list_subscription_requests() to authenticated;

-- 확인
select
  'list_sub_req_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='list_subscription_requests')
    then 'OK' else 'MISSING' end) as check_1,
  'sub_req_table=' ||
  (case when exists (select 1 from information_schema.tables
    where table_schema='public' and table_name='subscription_requests')
    then 'OK' else 'MISSING' end) as check_2;
