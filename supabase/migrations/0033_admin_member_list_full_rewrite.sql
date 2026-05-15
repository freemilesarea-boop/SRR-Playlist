-- ============================================
-- 0033_admin_member_list_full_rewrite.sql
--
-- 진단:
--   0002 가 admin_member_list 를 9-컬럼 return 으로 생성한 뒤,
--   0014 가 14-컬럼 return 으로 CREATE OR REPLACE 시도하면
--     ERROR: cannot change return type of existing function
--   로 실패함. 운영 DB 에는 0002 의 9-컬럼 버그 버전이 남아있음.
--   0032 도 같은 14-컬럼 시도라 적용 실패. 결국 운영 함수에는
--   `where id = auth.uid() and role = 'admin'` unqualified 가 그대로.
--
-- 운영 진단 SQL (SQL Editor 에서 실행):
--   select pg_get_functiondef(
--     'public.admin_member_list(text, text, text, integer)'::regprocedure
--   );
--
-- 해결:
--   1) 알려진 historical 시그니처 모두 DROP FUNCTION IF EXISTS
--   2) 새 시그니처로 재생성: (p_limit int, p_offset int, p_search text, p_plan text, p_role text)
--      - 모든 컬럼 alias 명시. 단독 id / role / status / created_at / email / phone /
--        user_id 사용 절대 금지.
--      - admin check 는 _internal_is_admin_caller() 사용. fallback 도 alias.
--   3) admin_member_detail 도 시그니처 명확화 (p_user_id) + 본문 alias 보강
-- ============================================

-- ----------------------
-- 1) 모든 historical 시그니처 DROP
-- ----------------------
drop function if exists public.admin_member_list(text, text, text, integer);
drop function if exists public.admin_member_list(text, text, text, int);
drop function if exists public.admin_member_list();
drop function if exists public.admin_member_detail(uuid);

-- ----------------------
-- 2) admin_member_list 신 시그니처
-- ----------------------
create or replace function public.admin_member_list(
  p_limit integer default 100,
  p_offset integer default 0,
  p_search text default null,
  p_plan text default null,
  p_role text default null
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  account_type text,
  membership_tier text,
  signup_completed boolean,
  identity_verified boolean,
  business_verified boolean,
  business_number text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || btrim(p_search) || '%'
  end;
begin
  -- admin 검증
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users as u
      where u.id = auth.uid() and u.role = 'admin'
    ) then
      raise exception 'admin only';
    end if;
  end;

  return query
  with stream_agg as (
    select
      se.user_id as user_id,
      count(*) filter (where se.event_type = 'milestone_30s')::bigint as streams,
      coalesce(
        sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')),
        0
      )::bigint as listened
    from public.stream_events as se
    where se.user_id is not null
    group by se.user_id
  ),
  last_seen as (
    select ve.user_id as user_id, max(ve.created_at) as last_seen_at
    from public.visitor_events as ve
    where ve.user_id is not null
    group by ve.user_id
  ),
  user_email as (
    select au.id as user_id, au.email::text as email
    from auth.users as au
  )
  select
    u.id as id,
    coalesce(ue.email, '')::text as email,
    coalesce(u.nickname, '')::text as nickname,
    coalesce(u.role, 'user')::text as role,
    coalesce(u.subscription_type, 'free')::text as subscription_type,
    coalesce(u.account_type, 'individual')::text as account_type,
    coalesce(u.membership_tier, 'free')::text as membership_tier,
    coalesce(u.signup_completed, false) as signup_completed,
    coalesce(u.identity_verified, false) as identity_verified,
    coalesce(bvp.business_verified, false) as business_verified,
    bvp.business_number::text as business_number,
    u.created_at as created_at,
    ls.last_seen_at as last_seen_at,
    coalesce(sa.streams, 0)::bigint as total_streams,
    coalesce(sa.listened, 0)::bigint as total_listened_seconds
  from public.users as u
  left join user_email as ue on ue.user_id = u.id
  left join stream_agg as sa on sa.user_id = u.id
  left join last_seen as ls on ls.user_id = u.id
  left join public.business_verification_profiles as bvp on bvp.user_id = u.id
  where (
    v_search_pattern is null
    or coalesce(u.nickname, '') ilike v_search_pattern
    or coalesce(ue.email, '') ilike v_search_pattern
  )
  and (p_plan is null or u.subscription_type = p_plan)
  and (p_role is null or u.role = p_role)
  order by u.created_at desc
  limit greatest(1, p_limit)
  offset greatest(0, p_offset);
end;
$$;

grant execute on function public.admin_member_list(integer, integer, text, text, text) to authenticated;

-- ----------------------
-- 3) admin_member_detail 재작성 — alias 명시, p_user_id 시그니처
-- ----------------------
create or replace function public.admin_member_detail(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then
      raise exception 'admin only';
    end if;
  exception when undefined_function then
    if not exists (
      select 1 from public.users as u
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
      'account_type', u.account_type,
      'membership_tier', u.membership_tier,
      'business_category', u.business_category,
      'created_at', u.created_at
    ),
    'total_streams', (
      select count(*)
      from public.stream_events as se
      where se.user_id = p_user_id and se.event_type = 'milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds)
      from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at)
      from public.visitor_events as ve
      where ve.user_id = p_user_id
    ),
    'recent_visits', (
      select coalesce(
        jsonb_agg(jsonb_build_object('path', v.path, 'created_at', v.created_at) order by v.created_at desc),
        '[]'::jsonb
      )
      from (
        select ve.path as path, ve.created_at as created_at
        from public.visitor_events as ve
        where ve.user_id = p_user_id
        order by ve.created_at desc
        limit 10
      ) as v
    ),
    'recent_plays', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'track_title', rp.track_title,
          'playlist_title', rp.playlist_title,
          'completed', rp.completed,
          'created_at', rp.created_at
        ) order by rp.created_at desc),
        '[]'::jsonb
      )
      from (
        select
          t.title as track_title,
          p.title as playlist_title,
          se.completed as completed,
          se.created_at as created_at
        from public.stream_events as se
        left join public.tracks as t on t.id = se.track_id
        left join public.playlists as p on p.id = se.playlist_id
        where se.user_id = p_user_id and se.event_type = 'milestone_30s'
        order by se.created_at desc
        limit 10
      ) as rp
    ),
    'revenue', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'amount', re.amount,
          'subscription_type', re.subscription_type,
          'status', re.status,
          'paid_at', re.paid_at
        ) order by re.paid_at desc),
        '[]'::jsonb
      )
      from public.revenue_events as re
      where re.user_id = p_user_id
    ),
    'subscription_requests', (
      select coalesce(
        jsonb_agg(jsonb_build_object(
          'requested_plan', sr.requested_plan,
          'status', sr.status,
          'created_at', sr.created_at
        ) order by sr.created_at desc),
        '[]'::jsonb
      )
      from public.subscription_requests as sr
      where sr.user_id = p_user_id
    )
  )
  into v_result
  from public.users as u
  left join auth.users as au on au.id = u.id
  where u.id = p_user_id;

  return v_result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;

-- ----------------------
-- 확인
-- ----------------------
select
  'member_list_new_sig=' ||
  (case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_member_list'
      and pg_get_function_arguments(p.oid) ilike '%p_limit%p_offset%p_search%p_plan%p_role%'
  ) then 'OK' else 'MISSING' end) as check_1,
  'member_detail_new_sig=' ||
  (case when exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_member_detail'
      and pg_get_function_arguments(p.oid) ilike '%p_user_id%'
  ) then 'OK' else 'MISSING' end) as check_2,
  'old_member_list_dropped=' ||
  (case when not exists (
    select 1 from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'admin_member_list'
      and pg_get_function_arguments(p.oid) ilike '%search text%plan_filter%'
  ) then 'OK' else 'STILL_EXISTS' end) as check_3;
