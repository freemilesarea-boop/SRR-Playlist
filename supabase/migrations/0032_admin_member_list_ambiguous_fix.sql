-- ============================================
-- 0032_admin_member_list_ambiguous_fix.sql
--
-- 운영 진단:
--   /admin → 회원관리 진입 시 column reference "id" is ambiguous 오류 발생.
--
-- 원인:
--   0014 의 admin_member_list 가 RETURNS TABLE(id, role, ...) 로 OUT 컬럼을
--   선언하는데, 본문 시작부의 admin 체크가 unqualified `id` / `role` 을 사용:
--
--     if not exists (select 1 from public.users
--                    where id = auth.uid() and role = 'admin')
--
--   public.users.id / public.users.role 컬럼과 OUT 컬럼 id / role 이 충돌.
--
-- 수정:
--   - admin_member_list: 모든 admin 체크와 본문 SELECT 에 테이블 alias 명시.
--     0031 의 _internal_is_admin_caller() 헬퍼를 사용해 SQL Editor 호출도 대응.
--   - admin_member_detail: jsonb 반환이라 OUT 충돌은 없지만 일관성 위해 동일 패턴.
-- ============================================

-- ----------------------
-- admin_member_list — RETURNS TABLE 와 alias 충돌 제거
-- ----------------------
create or replace function public.admin_member_list(
  search text default null,
  plan_filter text default null,
  role_filter text default null,
  limit_n int default 100
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint,
  account_type text,
  signup_completed boolean,
  identity_verified boolean,
  business_verified boolean,
  business_number text
)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- 헬퍼 사용 — postgres / service_role / admin user 모두 통과.
  -- 헬퍼가 없는 환경(0031 미적용)에 대비해 정상 admin 체크도 함께 시도.
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    ) then
      raise exception 'admin only';
    end if;
  end;

  return query
  with stream_agg as (
    select se.user_id,
           count(*) filter (where se.event_type = 'milestone_30s')::bigint as streams,
           coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.user_id is not null
    group by se.user_id
  ),
  last_seen as (
    select ve.user_id, max(ve.created_at) as last_seen_at
    from public.visitor_events ve
    where ve.user_id is not null
    group by ve.user_id
  )
  select
    u.id,
    (select au.email::text from auth.users au where au.id = u.id) as email,
    u.nickname,
    u.role,
    u.subscription_type,
    u.created_at,
    ls.last_seen_at,
    coalesce(sa.streams, 0)::bigint as total_streams,
    coalesce(sa.listened, 0)::bigint as total_listened_seconds,
    coalesce(u.account_type, 'individual')::text as account_type,
    coalesce(u.signup_completed, false) as signup_completed,
    coalesce(u.identity_verified, false) as identity_verified,
    coalesce(bvp.business_verified, false) as business_verified,
    bvp.business_number
  from public.users u
  left join stream_agg sa on sa.user_id = u.id
  left join last_seen ls on ls.user_id = u.id
  left join public.business_verification_profiles bvp on bvp.user_id = u.id
  where (search is null or length(btrim(search)) = 0
         or u.nickname ilike '%' || search || '%'
         or (select au.email from auth.users au where au.id = u.id) ilike '%' || search || '%')
    and (plan_filter is null or u.subscription_type = plan_filter)
    and (role_filter is null or u.role = role_filter)
  order by u.created_at desc
  limit greatest(1, limit_n);
end;
$$;

grant execute on function public.admin_member_list(text, text, text, int) to authenticated;

-- ----------------------
-- admin_member_detail — alias 명시 (jsonb 반환이라 OUT 충돌은 없지만 일관성)
-- ----------------------
create or replace function public.admin_member_detail(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    ) then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', au.email,
      'nickname', u.nickname,
      'role', u.role,
      'subscription_type', u.subscription_type,
      'business_category', u.business_category,
      'created_at', u.created_at
    ),
    'total_streams', (
      select count(*) from public.stream_events se
      where se.user_id = target_user_id and se.event_type = 'milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events se
      where se.user_id = target_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events ve where ve.user_id = target_user_id
    ),
    'recent_visits', (
      select coalesce(jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc), '[]'::jsonb)
      from (
        select ve.path, ve.created_at from public.visitor_events ve
        where ve.user_id = target_user_id order by ve.created_at desc limit 10
      ) v
    ),
    'recent_plays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_title', t.title,
        'playlist_title', p.title,
        'completed', se.completed,
        'created_at', se.created_at
      ) order by se.created_at desc), '[]'::jsonb)
      from (
        select * from public.stream_events
        where user_id = target_user_id and event_type = 'milestone_30s'
        order by created_at desc limit 10
      ) se
      left join public.tracks t on t.id = se.track_id
      left join public.playlists p on p.id = se.playlist_id
    ),
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'amount', re.amount,
        'subscription_type', re.subscription_type,
        'status', re.status,
        'paid_at', re.paid_at
      ) order by re.paid_at desc), '[]'::jsonb)
      from public.revenue_events re where re.user_id = target_user_id
    ),
    'subscription_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requested_plan', sr.requested_plan,
        'status', sr.status,
        'created_at', sr.created_at
      ) order by sr.created_at desc), '[]'::jsonb)
      from public.subscription_requests sr where sr.user_id = target_user_id
    )
  )
  into result
  from public.users u
  left join auth.users au on au.id = u.id
  where u.id = target_user_id;

  return result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;

-- 확인
select
  'member_list_fixed=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%where u.id = auth.uid()%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'admin_member_list')
        then 'OK' else 'MISSING' end) as check_1,
  'member_detail_fixed=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%where u.id = auth.uid()%'
              from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'admin_member_detail')
        then 'OK' else 'MISSING' end) as check_2;
