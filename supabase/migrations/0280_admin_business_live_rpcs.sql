-- 0280 — Admin Business Live: 매장 실시간 진단 RPC (X6.0.1 — 매장 납품 가드)
--
-- 사업자가 "음악이 안 나와요" 신고 시 admin 이 즉시 진단할 수 있는 도구.
--
-- 제공 RPC:
--   1. admin_list_active_businesses (최근 N분 활동 매장 목록)
--   2. admin_business_live_detail (특정 매장 실시간 상세)
--
-- 데이터 소스: playback_events_v2 (X4.3 표준 이벤트)
-- 익명 사용 매장은 anonymous_id 기준 그룹핑.

-- ===== 1. admin_list_active_businesses =====
create or replace function public.admin_list_active_businesses(
  p_minutes int default 60,
  p_limit int default 100
) returns table (
  business_id uuid,
  store_name text,
  business_type text,
  store_type_slug text,
  recent_events bigint,
  unique_sessions bigint,
  unique_tracks bigint,
  skips bigint,
  errors bigint,
  last_event_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  return query
  with windowed as (
    select * from public.playback_events_v2
    where created_at > now() - (p_minutes || ' minutes')::interval
  ),
  agg as (
    select coalesce(business_id, '00000000-0000-0000-0000-000000000000'::uuid) as bid,
           store_type_slug,
           count(*) as recent_events,
           count(distinct session_id) as unique_sessions,
           count(distinct track_id) as unique_tracks,
           count(*) filter (where event_type='skip') as skips,
           count(*) filter (where event_type='player_error') as errors,
           max(created_at) as last_event_at
    from windowed
    group by 1, 2
  )
  select a.bid,
         bp.store_name, bp.business_type,
         a.store_type_slug,
         a.recent_events, a.unique_sessions, a.unique_tracks, a.skips, a.errors,
         a.last_event_at
  from agg a
  left join public.business_profiles bp on bp.id = a.bid
  order by a.recent_events desc, a.last_event_at desc
  limit greatest(1, p_limit);
end; $$;

revoke all on function public.admin_list_active_businesses(int, int) from public, anon;
grant execute on function public.admin_list_active_businesses(int, int) to authenticated, service_role;

-- ===== 2. admin_business_live_detail =====
-- p_business_id 가 null 이면 "익명/businessId 없음" 풀.
create or replace function public.admin_business_live_detail(
  p_business_id uuid default null,
  p_minutes int default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v jsonb;
  v_business jsonb;
  v_events jsonb;
  v_top_tracks jsonb;
  v_errors jsonb;
  v_summary jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  -- 매장 메타
  if p_business_id is not null then
    select to_jsonb(bp) into v_business
    from public.business_profiles bp
    where bp.id = p_business_id;
  end if;

  -- 요약
  with w as (
    select * from public.playback_events_v2
    where created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or business_id = p_business_id)
  )
  select jsonb_build_object(
    'window_minutes', p_minutes,
    'total_events', count(*),
    'unique_sessions', count(distinct session_id),
    'unique_tracks', count(distinct track_id),
    'unique_playlists', count(distinct playlist_id),
    'event_breakdown', coalesce(jsonb_object_agg(event_type, et_count) filter (where event_type is not null), '{}'::jsonb),
    'last_event_at', max(created_at)
  )
  into v_summary
  from (
    select event_type, session_id, track_id, playlist_id, created_at,
           count(*) over (partition by event_type) as et_count
    from w
  ) s;

  -- 최근 이벤트 50개
  with w as (
    select * from public.playback_events_v2
    where created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or business_id = p_business_id)
    order by created_at desc limit 50
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'created_at', w.created_at,
    'event_type', w.event_type,
    'track_id', w.track_id,
    'track_title', t.title,
    'artist', t.artist,
    'playlist_id', w.playlist_id,
    'playlist_title', pl.title,
    'session_id', w.session_id,
    'listened_seconds', w.listened_seconds,
    'completion_percent', w.completion_percent,
    'volume', w.volume,
    'muted', w.muted,
    'device_type', w.device_type
  ) order by w.created_at desc), '[]'::jsonb) into v_events
  from w
  left join public.tracks t on t.id = w.track_id
  left join public.playlists pl on pl.id = w.playlist_id;

  -- 가장 많이 재생된 곡 TOP 10
  with w as (
    select * from public.playback_events_v2
    where created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or business_id = p_business_id)
      and event_type = 'play_start'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', track_id, 'title', max(t.title), 'artist', max(t.artist),
    'plays', count(*),
    'skip_rate', round(
      100.0 * (select count(*) from public.playback_events_v2 e2
               where e2.track_id = w.track_id
                 and e2.event_type='skip'
                 and e2.created_at > now() - (p_minutes || ' minutes')::interval
                 and (p_business_id is null or e2.business_id = p_business_id))
      / nullif(count(*),0), 1)
  ) order by count(*) desc), '[]'::jsonb)
  into v_top_tracks
  from w
  left join public.tracks t on t.id = w.track_id
  group by track_id
  limit 10;

  -- 에러 이벤트
  with w as (
    select * from public.playback_events_v2
    where created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or business_id = p_business_id)
      and event_type = 'player_error'
    order by created_at desc limit 20
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'created_at', w.created_at, 'track_id', w.track_id, 'track_title', t.title,
    'session_id', w.session_id, 'device_type', w.device_type, 'browser', w.browser
  ) order by w.created_at desc), '[]'::jsonb) into v_errors
  from w
  left join public.tracks t on t.id = w.track_id;

  v := jsonb_build_object(
    'business_id', p_business_id,
    'business', v_business,
    'summary', coalesce(v_summary, '{}'::jsonb),
    'recent_events', v_events,
    'top_tracks', v_top_tracks,
    'errors', v_errors
  );
  return v;
end; $$;

revoke all on function public.admin_business_live_detail(uuid, int) from public, anon;
grant execute on function public.admin_business_live_detail(uuid, int) to authenticated, service_role;
