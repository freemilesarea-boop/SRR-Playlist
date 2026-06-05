-- 0294 — 매장 실시간 진단 RPC 버그 일괄 핫픽스 (X6.9)
--
-- 운영 제보: 관리자 → 매장 실시간 진단 탭 진입 시
--   ERROR 42702: column reference "business_id" is ambiguous
--
-- 조사 중 추가 버그 발견 (매장 클릭 시 동일하게 실패):
--   ERROR 42803: aggregate function calls cannot be nested
--   in admin_business_live_detail.top_tracks 계산
--
-- 수정 1) admin_list_active_businesses
--   원인: RETURNS TABLE(business_id uuid, ..., store_type_slug text, ...) 의
--   출력 컬럼들이 PL/pgSQL OUT 변수로 declared → CTE `agg` 안에서 alias 없는
--   bare 컬럼 참조와 충돌.
--   해결: 모든 CTE 컬럼 참조에 명시적 alias (windowed w.x) 적용.
--
-- 수정 2) admin_business_live_detail
--   원인: jsonb_agg(jsonb_build_object(..., 'plays', count(*),
--          'skip_rate', round(... / nullif(count(*),0), 1)) order by count(*) desc)
--   → jsonb_agg 안에 count(*) 가 들어있어 nested aggregate 로 판정.
--   해결: play_counts / skip_counts / top10 CTE 로 분리 후 jsonb_agg.
--
-- admin_business_skip_summary 는 동일 패턴 없음 — 확인 완료, 손대지 않음.

create or replace function public.admin_list_active_businesses(
  p_minutes integer default 60,
  p_limit integer default 100
)
returns table(
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
    select
      coalesce(w.business_id, '00000000-0000-0000-0000-000000000000'::uuid) as bid,
      w.store_type_slug                                as sts,
      count(*)                                          as recent_events,
      count(distinct w.session_id)                      as unique_sessions,
      count(distinct w.track_id)                        as unique_tracks,
      count(*) filter (where w.event_type='skip')       as skips,
      count(*) filter (where w.event_type='player_error') as errors,
      max(w.created_at)                                 as last_event_at
    from windowed w
    group by 1, 2
  )
  select
    a.bid          as business_id,
    bp.store_name  as store_name,
    bp.business_type as business_type,
    a.sts          as store_type_slug,
    a.recent_events,
    a.unique_sessions,
    a.unique_tracks,
    a.skips,
    a.errors,
    a.last_event_at
  from agg a
  left join public.business_profiles bp on bp.id = a.bid
  order by a.recent_events desc, a.last_event_at desc
  limit greatest(1, p_limit);
end; $$;

revoke all on function public.admin_list_active_businesses(integer,integer) from public, anon;
grant execute on function public.admin_list_active_businesses(integer,integer) to authenticated, service_role;

-- ===== admin_business_live_detail nested aggregate fix =====
create or replace function public.admin_business_live_detail(
  p_business_id uuid default null,
  p_minutes integer default 30
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

  if p_business_id is not null then
    select to_jsonb(bp) into v_business
    from public.business_profiles bp
    where bp.id = p_business_id;
  end if;

  -- 1) summary
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
  ) into v_summary
  from (
    select event_type, session_id, track_id, playlist_id, created_at,
           count(*) over (partition by event_type) as et_count
    from w
  ) s;

  -- 2) recent_events (50)
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

  -- 3) top_tracks — nested aggregate 회피: play/skip CTE 분리 후 jsonb_agg
  with play_counts as (
    select e.track_id, count(*) as plays
    from public.playback_events_v2 e
    where e.created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or e.business_id = p_business_id)
      and e.event_type = 'play_start'
      and e.track_id is not null
    group by e.track_id
  ),
  skip_counts as (
    select e.track_id, count(*) as skips
    from public.playback_events_v2 e
    where e.created_at > now() - (p_minutes || ' minutes')::interval
      and (p_business_id is null or e.business_id = p_business_id)
      and e.event_type = 'skip'
      and e.track_id is not null
    group by e.track_id
  ),
  top10 as (
    select pc.track_id, pc.plays, t.title, t.artist,
           coalesce(sc.skips, 0) as skips
    from play_counts pc
    left join public.tracks t on t.id = pc.track_id
    left join skip_counts sc on sc.track_id = pc.track_id
    order by pc.plays desc
    limit 10
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', track_id, 'title', title, 'artist', artist,
    'plays', plays,
    'skip_rate', round(100.0 * skips / nullif(plays, 0), 1)
  ) order by plays desc), '[]'::jsonb) into v_top_tracks
  from top10;

  -- 4) errors (20)
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

revoke all on function public.admin_business_live_detail(uuid,integer) from public, anon;
grant execute on function public.admin_business_live_detail(uuid,integer) to authenticated, service_role;
