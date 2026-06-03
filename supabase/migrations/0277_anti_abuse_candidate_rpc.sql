-- 0277 — Anti-abuse: abuse candidate 조회 RPC (X6.0 — 0275/0276 후속)
--
-- 정책: 동일 user_id + track_id + KST date 기준
--   raw plays >= 10 OR excluded_count >= 7 인 경우 abuse candidate 로 노출
--
-- 별도 테이블 생성 없이 stream_events 기반 view 형태로 admin RPC 제공.
-- 백필/실시간 동기화 불필요.

create or replace function public.admin_list_abuse_candidates(
  p_days int default 7,
  p_min_raw int default 10,
  p_min_excluded int default 7,
  p_limit int default 200
) returns table (
  user_id uuid,
  user_email text,
  track_id uuid,
  track_title text,
  artist text,
  date_kst date,
  raw_plays bigint,
  effective_plays bigint,
  excluded_plays bigint,
  excluded_reason text,
  last_played_at timestamptz
)
language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
  with agg as (
    select se.user_id, se.track_id, se.effective_play_date_kst as date_kst,
           count(*) as raw_plays,
           count(*) filter (where se.is_effective=true) as effective_plays,
           count(*) filter (where se.is_effective=false) as excluded_plays,
           max(se.created_at) as last_played_at
    from public.stream_events se
    where se.event_type = 'milestone_30s'
      and se.user_id is not null
      and se.effective_play_date_kst >= (current_date at time zone 'Asia/Seoul')::date - (p_days - 1)
    group by se.user_id, se.track_id, se.effective_play_date_kst
    having count(*) >= p_min_raw
        or count(*) filter (where se.is_effective=false) >= p_min_excluded
  )
  select a.user_id,
         au.email::text,
         a.track_id, t.title, t.artist,
         a.date_kst,
         a.raw_plays, a.effective_plays, a.excluded_plays,
         'daily_user_track_cap'::text,
         a.last_played_at
  from agg a
  left join public.tracks t on t.id = a.track_id
  left join auth.users au on au.id = a.user_id
  order by a.excluded_plays desc, a.raw_plays desc
  limit greatest(1, p_limit);
end; $$;

revoke all on function public.admin_list_abuse_candidates(int, int, int, int) from public, anon;
grant execute on function public.admin_list_abuse_candidates(int, int, int, int) to authenticated, service_role;

-- 요약 RPC
create or replace function public.admin_abuse_summary(p_days int default 7)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v_admin uuid := auth.uid(); v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  with base as (
    select * from public.stream_events
    where event_type = 'milestone_30s'
      and effective_play_date_kst >= (current_date at time zone 'Asia/Seoul')::date - (p_days - 1)
  )
  select jsonb_build_object(
    'window_days', p_days,
    'total_raw_streams', count(*),
    'total_effective_streams', count(*) filter (where is_effective=true),
    'total_excluded_by_cap', count(*) filter (where excluded_reason='daily_user_track_cap'),
    'distinct_users_affected', (
      select count(distinct user_id)
      from base
      where user_id is not null
        and excluded_reason='daily_user_track_cap'
    ),
    'distinct_tracks_affected', (
      select count(distinct track_id)
      from base
      where excluded_reason='daily_user_track_cap'
    ),
    'distinct_user_track_day_caps', (
      select count(*) from (
        select user_id, track_id, effective_play_date_kst
        from base
        where excluded_reason='daily_user_track_cap'
        group by user_id, track_id, effective_play_date_kst
      ) s
    )
  ) into v from base;
  return v;
end; $$;

revoke all on function public.admin_abuse_summary(int) from public, anon;
grant execute on function public.admin_abuse_summary(int) to authenticated, service_role;
