-- 0514 — 관리자 회원관리의 "스트리밍 / 청취" 지표가 매장 재생을 반영하도록
--
-- 무엇이 잘못돼 있었나:
--   admin_member_list 는 stream_events 의 event_type='milestone_30s' 만 센다.
--   그런데 **브랜드/매장 플레이어는 stream_events 를 남기지 않는다** — 재생 기록은
--   stream_sessions_v2 로만 들어간다.
--   결과: 매장이 하루 20시간을 틀어도 관리자 화면에는 0에 가깝게 보인다.
--
--   실제 사례 — 르하임스터디카페s 숙대점(김가희):
--     stream_sessions_v2  : 09-07 20.5시간 · 09-08 21.5시간 재생
--     관리자 화면         : 스트리밍 2 · 청취 2분
--   반대로 카공시대 화정점(박소선)의 "503 · 23시간 19분" 은 09-05 이전 옛 값이었다.
--   두 매장의 숫자 차이는 실제 사용량이 아니라 **가입일 차이**였고, 운영 판단을 오도했다.
--
-- 중복 집계 방지:
--   stream_sessions_v2 는 2026-07-09 부터 USER / BRAND / ARTIST_PREVIEW 를 모두 덮는다.
--   그 이전 기록만 stream_events 에서 가져온다(경계 기준 V2_CUTOVER).
--
-- 청취 시간 정의:
--   verified_seconds 는 playing + visible + !muted + volume>=0.1 이 **전부** 참일 때만
--   누적된다. 매장 태블릿은 화면이 꺼지면 visible 이 아니게 되어 음악이 나와도 0 이 된다
--   (화정점이 이틀간 검증 0 이었던 이유). 그래서 운영 지표로는 부적합하다.
--   → total_listened_seconds 는 **세션 실제 경과 시간**으로 바꾼다(세션당 30분 상한 —
--     멈춤(stall)/좀비 세션이 부풀리는 것 방지).
--   → 엄격 지표는 total_verified_seconds 로 **따로 노출**한다(정산 기준은 그대로 유지).

-- v2 전환 시점 — 이 시각 이전은 stream_events, 이후는 stream_sessions_v2.
create or replace function public._stream_v2_cutover()
returns timestamptz
language sql
immutable
as $$ select timestamptz '2026-07-09 00:00:00+09' $$;

-- 회원 1명의 재생 집계 (관리자 목록/상세가 공유).
create or replace function public.member_playback_totals(p_user_id uuid)
returns table (
  total_streams bigint,
  total_listened_seconds bigint,
  total_verified_seconds bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    -- 곡 재생 횟수: v2 세션 + (전환 이전) 레거시 milestone
    coalesce((select count(*) from public.stream_sessions_v2 s
               where s.user_id = p_user_id), 0)
    + coalesce((select count(*) from public.stream_events e
                 where e.user_id = p_user_id
                   and e.event_type = 'milestone_30s'
                   and e.created_at < public._stream_v2_cutover()), 0),

    -- 실제 재생 시간: 세션 경과 시간(세션당 30분 상한) + 레거시
    coalesce((select sum(least(
                extract(epoch from (s.last_heartbeat_at - s.created_at)), 1800))
               from public.stream_sessions_v2 s
              where s.user_id = p_user_id
                and s.last_heartbeat_at is not null), 0)::bigint
    + coalesce((select sum(e.listened_seconds) from public.stream_events e
                 where e.user_id = p_user_id
                   and e.event_type in ('milestone_30s','complete')
                   and e.created_at < public._stream_v2_cutover()), 0),

    -- 엄격 검증 시간(정산 기준) — 화면 꺼짐/음소거 시 누적되지 않음
    coalesce((select sum(s.verified_seconds) from public.stream_sessions_v2 s
               where s.user_id = p_user_id), 0)::bigint;
$$;

revoke all on function public.member_playback_totals(uuid) from public, anon;
grant execute on function public.member_playback_totals(uuid) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_member_list — 집계 두 줄만 교체 + total_verified_seconds 컬럼 추가.
-- 나머지 로직(권한 검사 · 필터 · 정렬)은 기존과 동일하다.
-- ----------------------------------------------------------------------------
drop function if exists public.admin_member_list(integer, integer, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.admin_member_list(p_limit integer DEFAULT 100, p_offset integer DEFAULT 0, p_search text DEFAULT NULL::text, p_plan text DEFAULT NULL::text, p_role text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_category text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, email text, nickname text, role text, subscription_type text, account_type text, membership_tier text, signup_completed boolean, identity_verified boolean, business_verified boolean, business_number text, created_at timestamp with time zone, last_seen_at timestamp with time zone, total_streams bigint, total_listened_seconds bigint, total_verified_seconds bigint, withdrawn_at timestamp with time zone, disabled_at timestamp with time zone, pii_masked_at timestamp with time zone, last_sign_in_at timestamp with time zone, has_cancel_scheduled boolean, has_promotion boolean, plan_type text, is_enterprise_hq boolean, is_franchise_store boolean, enterprise_name text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_search_pattern text := case
    when p_search is null or length(btrim(p_search)) = 0 then null
    else '%' || lower(btrim(p_search)) || '%'
  end;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  return query
  select
    u.id, au.email::text, u.nickname, u.role,
    u.subscription_type, u.account_type, u.membership_tier,
    u.signup_completed, u.identity_verified,
    coalesce(bvp.business_verified, false), bvp.business_number,
    u.created_at,
    (select max(ve.created_at) from public.visitor_events as ve where ve.user_id = u.id),
    mt.total_streams,
    mt.total_listened_seconds,
    mt.total_verified_seconds,
    u.withdrawn_at, u.disabled_at, u.pii_masked_at, au.last_sign_in_at,
    exists(select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled'),
    exists(select 1 from public.promotion_code_redemptions as r where r.user_id = u.id),
    u.plan_type,
    exists(
      select 1 from public.enterprise_accounts as ea
      where ea.auth_user_id = u.id and ea.deleted_at is null
    ),
    exists(
      select 1 from public.franchise_stores as fs
      where fs.store_id = u.id and fs.status = 'active'
    ),
    coalesce(
      (select ea.enterprise_name from public.enterprise_accounts as ea
        where ea.auth_user_id = u.id and ea.deleted_at is null
        order by ea.created_at limit 1),
      (select ea2.enterprise_name
         from public.franchise_stores as fs
         join public.enterprise_franchises as ef
           on ef.franchise_id = fs.franchise_id and ef.role = 'primary' and ef.deleted_at is null
         join public.enterprise_accounts as ea2 on ea2.id = ef.enterprise_account_id
        where fs.store_id = u.id and fs.status = 'active'
        limit 1)
    )
  from public.users as u
  left join auth.users as au on au.id = u.id
  left join public.business_verification_profiles as bvp on bvp.user_id = u.id
  cross join lateral public.member_playback_totals(u.id) as mt
  where
    (v_search_pattern is null
      or lower(coalesce(au.email,'')) like v_search_pattern
      or lower(coalesce(u.nickname,'')) like v_search_pattern
      or u.id::text like v_search_pattern)
    and (p_plan is null or u.subscription_type = p_plan or u.membership_tier = p_plan)
    and (p_role is null or u.role = p_role)
    and (
      p_status is null
      or (p_status = 'active' and u.withdrawn_at is null and u.disabled_at is null)
      or (p_status = 'withdrawn' and u.withdrawn_at is not null)
      or (p_status = 'disabled' and u.disabled_at is not null)
      or (p_status = 'cancel_scheduled' and exists(
            select 1 from public.subscriptions as s where s.user_id = u.id and s.status = 'cancel_scheduled'))
    )
    and (
      p_category is null
      or (p_category = 'artist' and u.account_type = 'artist')
      or (p_category = 'hq' and exists(
            select 1 from public.enterprise_accounts as ea
            where ea.auth_user_id = u.id and ea.deleted_at is null))
      or (p_category = 'franchise' and exists(
            select 1 from public.franchise_stores as fs
            where fs.store_id = u.id and fs.status = 'active'))
      or (p_category = 'business' and u.account_type = 'business'
            and not exists(
              select 1 from public.franchise_stores as fs
              where fs.store_id = u.id and fs.status = 'active'))
      or (p_category = 'individual' and coalesce(u.account_type,'individual') = 'individual'
            and not exists(
              select 1 from public.enterprise_accounts as ea
              where ea.auth_user_id = u.id and ea.deleted_at is null))
    )
  order by u.created_at desc
  limit p_limit offset p_offset;
end; $function$;

revoke all on function public.admin_member_list(integer, integer, text, text, text, text, text) from public, anon;
grant execute on function public.admin_member_list(integer, integer, text, text, text, text, text) to authenticated;

-- ----------------------------------------------------------------------------
-- admin_member_detail — 같은 문제(stream_events 만 집계). 함수 전문을 다시 쓰지 않고
-- 집계 표현식 두 곳만 정확히 교체한다(오타로 다른 로직을 깨뜨릴 위험 제거).
-- ----------------------------------------------------------------------------
do $do$
declare
  v_def text;
  v_old_streams text;
  v_old_listened text;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'admin_member_detail'
   limit 1;

  if v_def is null then
    return;
  end if;

  v_old_streams :=
    '''total_streams'', (select count(*) from public.stream_events as se where se.user_id = p_user_id and se.event_type=''milestone_30s''),';
  v_old_listened :=
    '''total_listened_seconds'', coalesce((select sum(se.listened_seconds) from public.stream_events as se where se.user_id = p_user_id and se.event_type in (''milestone_30s'',''complete'')), 0),';

  if position(v_old_streams in v_def) = 0 or position(v_old_listened in v_def) = 0 then
    raise notice '0514: admin_member_detail 집계 표현식을 찾지 못해 건너뜁니다(이미 수정됐거나 형태가 달라짐).';
    return;
  end if;

  v_def := replace(v_def, v_old_streams,
    '''total_streams'', (select t.total_streams from public.member_playback_totals(p_user_id) t),');
  v_def := replace(v_def, v_old_listened,
    '''total_listened_seconds'', (select t.total_listened_seconds from public.member_playback_totals(p_user_id) t), ''total_verified_seconds'', (select t.total_verified_seconds from public.member_playback_totals(p_user_id) t),');

  execute v_def;
end
$do$;
