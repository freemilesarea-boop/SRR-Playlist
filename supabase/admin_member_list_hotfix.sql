-- ============================================
-- admin_member_list / admin_member_detail
-- 운영 DB 직접 적용용 단일 SQL (SQL Editor 붙여넣기)
--
-- 사용법:
--   1) Supabase Dashboard → SQL Editor → New query
--   2) 이 파일 전체를 붙여넣기
--   3) Run
--   4) 결과 패널 마지막에 표시되는 'final_signature=' 행 확인
--
-- 동작 순서:
--   STEP 1) pg_proc 동적 조회 → admin_member_list / admin_member_detail 의 모든
--           overload 를 발견하여 자동 DROP (param 이름 무관)
--   STEP 2) 알려진 historical signature 명시적 DROP (fallback)
--   STEP 3) admin_member_list 새 시그니처 CREATE
--           (p_limit int, p_offset int, p_search text, p_plan text, p_role text)
--   STEP 4) admin_member_detail (p_user_id uuid) CREATE
--   STEP 5) 검증 — 시그니처 확인 + 실제 호출
-- ============================================


-- ─────────────────────────────────────────────────────────────
-- STEP 1) 동적 DROP — 어떤 historical signature 든 발견 후 제거
-- ─────────────────────────────────────────────────────────────
do $$
declare
  v_func record;
  v_dropped int := 0;
begin
  raise notice '== BEFORE: 기존 admin_member_list / admin_member_detail overload ==';
  for v_func in
    select p.proname,
           pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('admin_member_list', 'admin_member_detail')
    order by p.proname
  loop
    raise notice '  found: public.%(%)', v_func.proname, v_func.args;
    execute format('drop function if exists public.%I(%s)', v_func.proname, v_func.args);
    v_dropped := v_dropped + 1;
  end loop;
  raise notice '== dropped % overload(s) (동적) ==', v_dropped;
end $$;


-- ─────────────────────────────────────────────────────────────
-- STEP 2) 명시적 DROP — 알려진 historical signature (이중 안전망)
-- ─────────────────────────────────────────────────────────────
drop function if exists public.admin_member_list(text, text, text, integer);
drop function if exists public.admin_member_list(text, text, text, int4);
drop function if exists public.admin_member_list(integer, integer, text, text, text);
drop function if exists public.admin_member_list(int4, int4, text, text, text);
drop function if exists public.admin_member_list();
drop function if exists public.admin_member_detail(uuid);


-- 빈 상태 확인
do $$
declare v_remaining int;
begin
  select count(*) into v_remaining
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in ('admin_member_list', 'admin_member_detail');
  if v_remaining > 0 then
    raise exception '아직 % 개 함수가 남아있어요. DROP 실패. CASCADE 필요 가능성.', v_remaining;
  end if;
  raise notice '== admin_member_list / detail 모두 제거 확인 ==';
end $$;


-- ─────────────────────────────────────────────────────────────
-- STEP 3) admin_member_list 새 시그니처 CREATE
--   - 모든 컬럼 alias prefix 명시 (u/au/sa/ls/ue/bvp)
--   - admin check 도 alias 사용 (ambiguous id 완전 제거)
-- ─────────────────────────────────────────────────────────────
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
  -- admin 검증 (헬퍼 사용. 헬퍼 부재 시 alias 명시한 fallback)
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

grant execute on function public.admin_member_list(integer, integer, text, text, text)
  to authenticated;


-- ─────────────────────────────────────────────────────────────
-- STEP 4) admin_member_detail 새 시그니처 CREATE
-- ─────────────────────────────────────────────────────────────
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
      select count(*) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type = 'milestone_30s'
    ),
    'total_listened_seconds', coalesce((
      select sum(se.listened_seconds) from public.stream_events as se
      where se.user_id = p_user_id and se.event_type in ('milestone_30s','complete')
    ), 0),
    'last_seen_at', (
      select max(ve.created_at) from public.visitor_events as ve
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
        order by ve.created_at desc limit 10
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
        select t.title as track_title,
               p.title as playlist_title,
               se.completed as completed,
               se.created_at as created_at
        from public.stream_events as se
        left join public.tracks as t on t.id = se.track_id
        left join public.playlists as p on p.id = se.playlist_id
        where se.user_id = p_user_id and se.event_type = 'milestone_30s'
        order by se.created_at desc limit 10
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


-- ─────────────────────────────────────────────────────────────
-- STEP 5) 검증
-- ─────────────────────────────────────────────────────────────

-- [검증 1] 시그니처 확인 — 정확히 2 row 반환되어야 함
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as args
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('admin_member_list', 'admin_member_detail')
order by p.proname;

-- 기대 결과:
--   admin_member_detail | p_user_id uuid
--   admin_member_list   | p_limit integer, p_offset integer, p_search text, p_plan text, p_role text


-- [검증 2] 실제 호출 (명시적 캐스팅) — 안 죽고 row 반환되면 OK
select id, email, nickname, role, account_type, membership_tier
from public.admin_member_list(
  20::integer,
  0::integer,
  null::text,
  null::text,
  null::text
);


-- [검증 3] 기본값 호출 — 5개 default 적용되어 동일 결과 반환되어야 함
select id, email, nickname, role
from public.admin_member_list();


-- [최종 한 줄 요약]
select
  'final_signature=' || pg_get_function_identity_arguments(p.oid) as result
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname = 'admin_member_list';
-- 기대:
--   final_signature=p_limit integer, p_offset integer, p_search text, p_plan text, p_role text
