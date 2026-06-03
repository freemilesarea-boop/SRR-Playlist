-- 0276 — Anti-abuse: 모든 차트/정산/행동/추천 RPC 가 is_effective=true 만 집계
-- (X6.0 — 0275 후속)
--
-- 0275 에서 stream_events.is_effective 컬럼 + 트리거 + 백필 완료.
-- 이 마이그레이션은 모든 milestone_30s 집계 RPC 에 "and is_effective=true" 필터 추가.
--
-- 적용 대상:
--   1. get_track_chart / get_genre_chart / get_track_chart_by_genre / list_genres (charts)
--   2. get_artist_daily_streams / get_artist_streaming_summary (artist analytics)
--   3. _compute_track_behavior_score (behavior score)
--   4. admin_generate_monthly_settlement (settlement)
--   5. admin_streaming_overview / admin_top_streaming_tracks (admin)
--   6. refresh_user_music_preferences / get_personalized_recommendations (추천)
--   7. recompute_track_store_behavior_scores (store learning)
--
-- 멱등: CREATE OR REPLACE.

-- ===== 1. Charts (0205 기반) =====

create or replace function public.get_genre_chart(period text default 'weekly')
returns table(genre text, play_count bigint, track_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with se_agg as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g,
      count(*) filter (where se.event_type = 'milestone_30s' and se.is_effective = true) as plays,
      coalesce(sum(se.listened_seconds) filter (
        where se.event_type = 'complete'
           or (se.event_type = 'milestone_30s' and se.is_effective = true)
      ), 0)::bigint as listened,
      count(distinct t.id) as tracks
    from public.tracks t
    left join public.stream_events se on se.track_id = t.id and se.created_at >= since
      and se.event_type in ('milestone_30s','complete')
    where t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  )
  select g, plays, tracks, listened from se_agg where tracks > 0 order by plays desc, g asc;
end; $$;

create or replace function public.get_track_chart_by_genre(genre_filter text, period text default 'weekly', limit_count integer default 50)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period); g_filter text := nullif(trim(genre_filter), '');
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s' and se.is_effective = true) as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (
        where se.event_type = 'complete'
           or (se.event_type = 'milestone_30s' and se.is_effective = true)
      ), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  ),
  lk as (
    select tpe.track_id,
      greatest(0, count(*) filter (where tpe.event_type='like') - count(*) filter (where tpe.event_type='unlike')) as likes
    from public.track_play_events tpe where tpe.created_at >= since group by tpe.track_id
  )
  select row_number() over (order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.main_genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays,0), coalesce(a.completes,0), coalesce(lk.likes,0), coalesce(a.listened,0)
  from public.tracks t
  left join agg a on a.track_id = t.id
  left join lk on lk.track_id = t.id
  where coalesce(a.plays,0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and ((g_filter = '기타' and (t.main_genre is null or trim(t.main_genre) = ''))
         or (g_filter is not null and t.main_genre = g_filter) or g_filter is null)
  order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $$;

create or replace function public.get_track_chart(period text default 'daily', limit_count integer default 100)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, like_count bigint, total_listened_seconds bigint, playlist_count bigint)
language plpgsql security definer set search_path to 'public' as $$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s' and se.is_effective = true) as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (
        where se.event_type = 'complete'
           or (se.event_type = 'milestone_30s' and se.is_effective = true)
      ), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  ),
  lk as (
    select tpe.track_id,
      greatest(0, count(*) filter (where tpe.event_type='like') - count(*) filter (where tpe.event_type='unlike')) as likes
    from public.track_play_events tpe where tpe.created_at >= since group by tpe.track_id
  )
  select row_number() over (order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.main_genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays,0), coalesce(a.completes,0), coalesce(lk.likes,0), coalesce(a.listened,0),
    (select count(*) from public.playlist_tracks pt where pt.track_id = t.id)
  from public.tracks t
  left join agg a on a.track_id = t.id
  left join lk on lk.track_id = t.id
  where coalesce(a.plays,0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
  order by coalesce(a.plays,0) desc, coalesce(a.completes,0) desc, coalesce(lk.likes,0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $$;

create or replace function public.list_genres()
returns table(genre text, track_count bigint, play_count bigint)
language plpgsql security definer set search_path to 'public' as $$
begin
  return query
  with all_genres as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g, count(*) as tc
    from public.tracks t
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  ),
  plays as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g, count(*) as pc
    from public.tracks t
    join public.stream_events se on se.track_id = t.id
    where se.event_type = 'milestone_30s' and se.is_effective = true
    group by coalesce(nullif(trim(t.main_genre), ''), '기타')
  )
  select ag.g, ag.tc, coalesce(p.pc, 0)
  from all_genres ag left join plays p on p.g = ag.g
  order by coalesce(p.pc, 0) desc, ag.g asc;
end; $$;

-- ===== 2. Artist Analytics (0020 기반) =====

create or replace function public.get_artist_daily_streams(p_days int default 30)
returns table(day date, track_id uuid, title text, daily_streams bigint)
language sql security definer set search_path = public as $$
  with bound as (
    select greatest(1, least(coalesce(p_days, 30), 365)) as d
  ),
  mine as (
    select t.id, t.title from public.tracks t where t.owner_user_id = auth.uid()
  )
  select
    (se.created_at at time zone 'Asia/Seoul')::date as day,
    m.id, m.title,
    count(*)::bigint as daily_streams
  from mine m
  join public.stream_events se on se.track_id = m.id
  where se.event_type = 'milestone_30s'
    and se.is_effective = true
    and se.created_at >= now() - ((select d from bound) || ' days')::interval
  group by 1, 2, 3
  order by 1 desc, 4 desc;
$$;

create or replace function public.get_artist_streaming_summary()
returns table(
  track_id uuid, title text, visibility_status text,
  total_streams bigint, today_streams bigint,
  last_7d_streams bigint, last_30d_streams bigint,
  last_played_at timestamptz
)
language sql security definer set search_path = public as $$
  with kst_bounds as (
    select
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul')                       as today_start,
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '6 days'   as d7_start,
      (date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul') - interval '29 days'  as d30_start
  ),
  mine as (
    select t.id, t.title, t.visibility_status from public.tracks t where t.owner_user_id = auth.uid()
  )
  select
    m.id, m.title, m.visibility_status,
    count(se.*) filter (where se.event_type = 'milestone_30s' and se.is_effective = true)::bigint as total,
    count(se.*) filter (
      where se.event_type = 'milestone_30s' and se.is_effective = true
        and se.created_at >= (select today_start from kst_bounds)
    )::bigint as today,
    count(se.*) filter (
      where se.event_type = 'milestone_30s' and se.is_effective = true
        and se.created_at >= (select d7_start from kst_bounds)
    )::bigint as last_7d,
    count(se.*) filter (
      where se.event_type = 'milestone_30s' and se.is_effective = true
        and se.created_at >= (select d30_start from kst_bounds)
    )::bigint as last_30d,
    max(se.created_at) filter (where se.event_type = 'milestone_30s' and se.is_effective = true) as last_played_at
  from mine m
  left join public.stream_events se on se.track_id = m.id
  group by m.id, m.title, m.visibility_status
  order by total desc, m.title asc;
$$;

-- ===== 3. Admin Streaming Overview (0078 기반) =====

create or replace function public.admin_streaming_overview(p_days int default 30)
returns table(day date, total_streams bigint, eligible_streams bigint,
              effective_streams bigint, excluded_by_cap bigint,
              unique_listeners bigint, unique_tracks bigint)
language sql security definer set search_path = 'public' as $$
  select
    (created_at at time zone 'Asia/Seoul')::date as day,
    count(*) filter (where event_type='milestone_30s')::bigint as total_streams,
    count(*) filter (where event_type='milestone_30s' and eligible_for_payout=true)::bigint as eligible_streams,
    count(*) filter (where event_type='milestone_30s' and is_effective=true)::bigint as effective_streams,
    count(*) filter (where event_type='milestone_30s' and excluded_reason='daily_user_track_cap')::bigint as excluded_by_cap,
    count(distinct coalesce(user_id::text, anonymous_id)) filter (where event_type='milestone_30s' and is_effective=true)::bigint as unique_listeners,
    count(distinct track_id) filter (where event_type='milestone_30s' and is_effective=true)::bigint as unique_tracks
  from public.stream_events
  where created_at >= now() - ((p_days - 1) || ' days')::interval
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  group by 1 order by 1 desc;
$$;

create or replace function public.admin_top_streaming_tracks(p_days int default 7, p_limit int default 20)
returns table(rank bigint, track_id uuid, track_code text, title text, artist text,
              artist_user_id uuid, stream_count bigint, eligible_count bigint, effective_count bigint)
language plpgsql security definer set search_path = 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  with agg as (
    select se.track_id,
           count(*) as total,
           count(*) filter (where se.eligible_for_payout=true) as eligible,
           count(*) filter (where se.is_effective=true) as effective
    from public.stream_events se
    where se.event_type='milestone_30s'
      and se.created_at >= now() - (p_days || ' days')::interval
    group by se.track_id
  )
  select row_number() over (order by a.effective desc) as rank,
         t.id, t.track_code, t.title, t.artist, t.owner_user_id,
         a.total, a.eligible, a.effective
  from agg a join public.tracks t on t.id = a.track_id
  order by a.effective desc limit greatest(1, p_limit);
end; $$;

-- ===== 4. Behavior Score (0250 기반) =====
-- 핵심 변경: stream_events 카운트에 is_effective=true 추가.
-- store/playlist/daypart breakdown 모두 동일하게 적용.

create or replace function public._compute_track_behavior_score(p_track_id uuid, p_window_days int)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cutoff timestamptz := now() - (p_window_days || ' days')::interval;
  v_play_count int := 0;
  v_unique_listeners int := 0;
  v_completed int := 0;
  v_skip_count int := 0;
  v_like_count int := 0;
  v_avg_listen numeric := 0;
  v_avg_completion numeric := 0;
  v_completion_rate numeric := 0;
  v_skip_rate numeric := 0;
  v_replay_rate numeric := 0;
  v_like_rate numeric := 0;
  v_save_rate numeric := 0;
  v_behavior numeric := 0;
  v_confidence numeric := 0;
  v_store_b jsonb := '{}'::jsonb;
  v_playlist_b jsonb := '{}'::jsonb;
  v_daypart_b jsonb := '{}'::jsonb;
begin
  -- 1) Stream plays — is_effective 만 집계 (0275 cap 적용)
  select count(*) filter (where event_type='start' and is_effective = true),
         count(distinct coalesce(user_id::text, anonymous_id, session_id))
           filter (where is_effective = true),
         count(*) filter (where completed=true and is_effective = true),
         coalesce(avg(listened_seconds) filter (where is_effective = true), 0)
    into v_play_count, v_unique_listeners, v_completed, v_avg_listen
    from public.stream_events
    where track_id = p_track_id and created_at > v_cutoff;

  if v_play_count > 0 then
    v_completion_rate := v_completed::numeric / v_play_count;
    if v_unique_listeners > 0 and v_play_count > v_unique_listeners then
      v_replay_rate := (v_play_count - v_unique_listeners)::numeric / v_play_count;
    end if;
  end if;

  select count(*) into v_skip_count
    from public.playlist_track_skip_events
    where track_id = p_track_id and created_at > v_cutoff
      and (track_duration is null or played_seconds < coalesce(track_duration, 999) * 0.3);

  if v_play_count > 0 then
    v_skip_rate := least(1.0, v_skip_count::numeric / v_play_count);
  end if;

  select coalesce(avg(completion_ratio), 0) into v_avg_completion
    from public.track_play_events
    where track_id = p_track_id and created_at > v_cutoff
      and event_type in ('play','complete');

  select count(distinct user_id) into v_like_count
    from public.liked_tracks
    where track_id = p_track_id and created_at > v_cutoff;
  if v_unique_listeners > 0 then
    v_like_rate := least(1.0, v_like_count::numeric / v_unique_listeners);
    v_save_rate := v_like_rate;
  end if;

  select coalesce(jsonb_object_agg(business_category, breakdown), '{}'::jsonb) into v_store_b
  from (
    select pl.business_category,
           jsonb_build_object(
             'play_count', count(*),
             'completion_rate', round((count(*) filter (where se.completed=true))::numeric / nullif(count(*),0), 4),
             'avg_listen_seconds', round(avg(se.listened_seconds)::numeric, 2)
           ) as breakdown
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id and se.created_at > v_cutoff
      and se.is_effective = true
      and pl.business_category is not null
    group by pl.business_category
  ) s;

  select coalesce(jsonb_object_agg(playlist_id::text, breakdown), '{}'::jsonb) into v_playlist_b
  from (
    select se.playlist_id,
           jsonb_build_object(
             'title', max(pl.title), 'play_count', count(*),
             'completion_rate', round((count(*) filter (where se.completed=true))::numeric / nullif(count(*),0), 4),
             'business_category', max(pl.business_category)
           ) as breakdown
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id and se.created_at > v_cutoff
      and se.is_effective = true
      and se.playlist_id is not null
    group by se.playlist_id
  ) s;

  select coalesce(jsonb_object_agg(daypart, breakdown), '{}'::jsonb) into v_daypart_b
  from (
    select
      case
        when extract(hour from created_at) between 6 and 11 then 'morning'
        when extract(hour from created_at) between 12 and 17 then 'afternoon'
        when extract(hour from created_at) between 18 and 22 then 'evening'
        else 'night'
      end as daypart,
      jsonb_build_object(
        'play_count', count(*),
        'completion_rate', round((count(*) filter (where completed=true))::numeric / nullif(count(*),0), 4)
      ) as breakdown
    from public.stream_events
    where track_id = p_track_id and created_at > v_cutoff
      and is_effective = true
    group by daypart
  ) s;

  v_behavior := v_completion_rate * 35
              + v_replay_rate * 20
              + v_like_rate * 20
              + v_save_rate * 15
              - v_skip_rate * 25
              + least(10, v_play_count::numeric / 10);

  v_confidence := least(1.0, v_play_count::numeric / 100);

  insert into public.track_behavior_scores(
    track_id, window_days, play_count, unique_listener_count,
    completion_rate, skip_rate, replay_rate, like_rate, save_rate,
    avg_listen_seconds, avg_completion_percent,
    behavior_score, confidence,
    store_breakdown_json, playlist_breakdown_json, daypart_breakdown_json,
    calculated_at
  ) values (
    p_track_id, p_window_days, v_play_count, v_unique_listeners,
    round(v_completion_rate, 4), round(v_skip_rate, 4), round(v_replay_rate, 4),
    round(v_like_rate, 4), round(v_save_rate, 4),
    round(v_avg_listen, 2), round(v_avg_completion, 4),
    round(v_behavior, 2), round(v_confidence, 4),
    v_store_b, v_playlist_b, v_daypart_b, now()
  )
  on conflict (track_id, window_days) do update set
    play_count = excluded.play_count,
    unique_listener_count = excluded.unique_listener_count,
    completion_rate = excluded.completion_rate,
    skip_rate = excluded.skip_rate,
    replay_rate = excluded.replay_rate,
    like_rate = excluded.like_rate,
    save_rate = excluded.save_rate,
    avg_listen_seconds = excluded.avg_listen_seconds,
    avg_completion_percent = excluded.avg_completion_percent,
    behavior_score = excluded.behavior_score,
    confidence = excluded.confidence,
    store_breakdown_json = excluded.store_breakdown_json,
    playlist_breakdown_json = excluded.playlist_breakdown_json,
    daypart_breakdown_json = excluded.daypart_breakdown_json,
    calculated_at = now();
end; $$;

-- ===== 5. Settlement (0065 기반) =====
-- 변경: 모든 milestone_30s count 에 is_effective=true 추가.

create or replace function public.admin_generate_monthly_settlement(
  p_month date,
  p_dry_run boolean default true
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_month_start timestamptz;
  v_month_end timestamptz;
  v_policy record;
  v_platform_revenue bigint;
  v_pool_revenue bigint;
  v_total_streams bigint;
  v_artist record;
  v_existing record;
  v_payout record;
  v_sales_agent record;
  v_artist_email text;
  v_gross bigint;
  v_company_fee bigint;
  v_agent_fee bigint;
  v_artist_net bigint;
  v_prev_carried bigint;
  v_total bigint;
  v_meets_min boolean;
  v_withholding bigint;
  v_final_payout bigint;
  v_carried_over bigint;
  v_settlement_id uuid;
  v_track record;
  v_track_streams int;
  v_track_amount bigint;
  v_generated int := 0;
  v_overwritten int := 0;
  v_skipped int := 0;
  v_payable int := 0;
  v_carried_count int := 0;
  v_sum_gross bigint := 0;
  v_sum_company bigint := 0;
  v_sum_agent bigint := 0;
  v_sum_final bigint := 0;
  v_sum_carried bigint := 0;
  v_skipped_arr jsonb := '[]'::jsonb;
  v_run_id uuid;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  perform pg_advisory_xact_lock(hashtext('settlement_gen:' || p_month::text));

  select * into v_policy from public.settlement_policies
  where effective_from <= p_month
  order by effective_from desc limit 1;
  if v_policy.id is null then raise exception 'no settlement policy effective for %', p_month; end if;

  v_month_start := (p_month::timestamp at time zone 'Asia/Seoul');
  v_month_end := ((p_month + interval '1 month')::timestamp at time zone 'Asia/Seoul');

  select coalesce(sum(po.amount), 0)::bigint into v_platform_revenue
  from public.payment_orders po
  where po.status = 'paid'
    and coalesce(po.paid_at, po.created_at) >= v_month_start
    and coalesce(po.paid_at, po.created_at) <  v_month_end;
  v_pool_revenue := floor(v_platform_revenue * v_policy.pool_revenue_ratio);

  -- 0276: is_effective=true 만 정산 대상
  select coalesce(count(*), 0)::bigint into v_total_streams
  from public.stream_events se
  join public.eligible_settlement_tracks et on et.track_id = se.track_id
  where se.event_type = 'milestone_30s' and se.is_effective = true
    and se.created_at >= v_month_start
    and se.created_at <  v_month_end;

  for v_artist in
    select et.artist_user_id, count(distinct et.track_id) as track_count
    from public.eligible_settlement_tracks et
    where exists (
      select 1 from public.stream_events se
      where se.track_id = et.track_id
        and se.event_type = 'milestone_30s' and se.is_effective = true
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end
    )
    group by et.artist_user_id
  loop
    select id, status into v_existing
    from public.artist_settlements
    where settlement_month = p_month and artist_user_id = v_artist.artist_user_id;
    if v_existing.id is not null and v_existing.status <> 'pending' then
      v_skipped := v_skipped + 1;
      v_skipped_arr := v_skipped_arr || jsonb_build_object(
        'artist_user_id', v_artist.artist_user_id,
        'existing_status', v_existing.status,
        'reason', 'finalized_or_paid'
      );
      continue;
    end if;

    v_gross := 0;
    for v_track in
      select et.track_id, et.track_code, t.title as track_title,
             t.isrc, t.release_date, t.release_title, t.rights_holder_name
      from public.eligible_settlement_tracks et
      join public.tracks t on t.id = et.track_id
      where et.artist_user_id = v_artist.artist_user_id
    loop
      -- 0276: is_effective=true 만 정산 대상
      select coalesce(count(*), 0)::int into v_track_streams
      from public.stream_events se
      where se.track_id = v_track.track_id
        and se.event_type = 'milestone_30s' and se.is_effective = true
        and se.created_at >= v_month_start
        and se.created_at <  v_month_end;
      if v_track_streams = 0 or v_total_streams = 0 then
        v_track_amount := 0;
      else
        v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
      end if;
      v_gross := v_gross + v_track_amount;
      if not p_dry_run then
        insert into public.streaming_revenues (
          revenue_month, artist_user_id, track_id, track_code,
          stream_count, total_pool_revenue, total_pool_streams,
          gross_artist_amount, policy_id
        ) values (
          p_month, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
          v_track_streams, v_pool_revenue, v_total_streams, v_track_amount, v_policy.id
        ) on conflict (revenue_month, artist_user_id, track_id) do update set
          stream_count = excluded.stream_count,
          total_pool_revenue = excluded.total_pool_revenue,
          total_pool_streams = excluded.total_pool_streams,
          gross_artist_amount = excluded.gross_artist_amount,
          policy_id = excluded.policy_id,
          computed_at = now();
      end if;
    end loop;

    v_company_fee := floor(v_gross * v_policy.company_fee_ratio)::bigint;

    select u.sales_agent_id, sa.commission_rate, sa.code into v_sales_agent
    from public.users u
    left join public.sales_agents sa on sa.id = u.sales_agent_id
    where u.id = v_artist.artist_user_id;

    if v_sales_agent.sales_agent_id is not null and v_sales_agent.commission_rate is not null then
      v_agent_fee := floor(v_gross * v_sales_agent.commission_rate / 100.0)::bigint;
    else
      v_agent_fee := 0;
    end if;
    v_artist_net := greatest(v_gross - v_company_fee - v_agent_fee, 0);

    select coalesce(carried_over_amount, 0)::bigint into v_prev_carried
    from public.artist_settlements
    where artist_user_id = v_artist.artist_user_id
      and settlement_month < p_month
      and status in ('carried_over','payable','paid','held','disputed')
    order by settlement_month desc limit 1;
    v_prev_carried := coalesce(v_prev_carried, 0);
    v_total := v_artist_net + v_prev_carried;

    if v_policy.min_payout_basis = 'gross' then
      v_meets_min := (v_total >= v_policy.min_payout_amount);
    else
      v_meets_min := ((v_total - floor(v_total * v_policy.withholding_tax_ratio)) >= v_policy.min_payout_amount);
    end if;

    if v_meets_min then
      v_withholding := floor(v_total * v_policy.withholding_tax_ratio)::bigint;
      v_final_payout := v_total - v_withholding;
      v_carried_over := 0;
    else
      v_withholding := 0;
      v_final_payout := 0;
      v_carried_over := v_total;
    end if;

    select pa.id, pa.bank_name, pa.account_holder, pa.account_number into v_payout
    from public.artist_payout_accounts pa
    where pa.user_id = v_artist.artist_user_id and pa.verification_status = 'verified';

    select au.email::text into v_artist_email from auth.users au where au.id = v_artist.artist_user_id;

    v_sum_gross := v_sum_gross + v_gross;
    v_sum_company := v_sum_company + v_company_fee;
    v_sum_agent := v_sum_agent + v_agent_fee;
    v_sum_final := v_sum_final + v_final_payout;
    v_sum_carried := v_sum_carried + v_carried_over;
    if v_meets_min then v_payable := v_payable + 1; else v_carried_count := v_carried_count + 1; end if;

    if not p_dry_run then
      if v_existing.id is not null then
        delete from public.settlement_items where settlement_id = v_existing.id;
        v_settlement_id := v_existing.id;
        v_overwritten := v_overwritten + 1;
        update public.artist_settlements set
          policy_id = v_policy.id,
          gross_settlement_amount = v_gross,
          company_fee_amount = v_company_fee,
          sales_agent_id = v_sales_agent.sales_agent_id,
          sales_agent_code = v_sales_agent.code,
          sales_agent_commission_rate = v_sales_agent.commission_rate,
          sales_agent_fee_amount = v_agent_fee,
          artist_net_settlement = v_artist_net,
          previous_carried_amount = v_prev_carried,
          total_settlement_amount = v_total,
          meets_min_payout = v_meets_min,
          withholding_tax_amount = v_withholding,
          final_payout_amount = v_final_payout,
          carried_over_amount = v_carried_over,
          payout_account_id = v_payout.id,
          payout_bank_name = v_payout.bank_name,
          payout_account_holder = v_payout.account_holder,
          masked_account_number = public._mask_account_number(v_payout.account_number),
          artist_email = v_artist_email,
          status = 'pending'
        where id = v_existing.id;
      else
        insert into public.artist_settlements (
          settlement_month, artist_user_id, policy_id,
          gross_settlement_amount, company_fee_amount,
          sales_agent_id, sales_agent_code, sales_agent_commission_rate, sales_agent_fee_amount,
          artist_net_settlement, previous_carried_amount, total_settlement_amount,
          meets_min_payout, withholding_tax_amount, final_payout_amount, carried_over_amount,
          payout_account_id, payout_bank_name, payout_account_holder, masked_account_number,
          artist_email, status, created_by
        ) values (
          p_month, v_artist.artist_user_id, v_policy.id,
          v_gross, v_company_fee,
          v_sales_agent.sales_agent_id, v_sales_agent.code, v_sales_agent.commission_rate, v_agent_fee,
          v_artist_net, v_prev_carried, v_total,
          v_meets_min, v_withholding, v_final_payout, v_carried_over,
          v_payout.id, v_payout.bank_name, v_payout.account_holder,
          public._mask_account_number(v_payout.account_number),
          v_artist_email, 'pending', v_uid
        ) returning id into v_settlement_id;
        v_generated := v_generated + 1;
      end if;

      for v_track in
        select et.track_id, et.track_code, t.title as track_title,
               t.isrc, t.release_date, t.release_title, t.rights_holder_name
        from public.eligible_settlement_tracks et
        join public.tracks t on t.id = et.track_id
        where et.artist_user_id = v_artist.artist_user_id
      loop
        -- 0276: is_effective=true 만 정산
        select coalesce(count(*), 0)::int into v_track_streams
        from public.stream_events se
        where se.track_id = v_track.track_id
          and se.event_type = 'milestone_30s' and se.is_effective = true
          and se.created_at >= v_month_start
          and se.created_at <  v_month_end;
        if v_track_streams > 0 then
          v_track_amount := floor(v_pool_revenue::numeric * v_track_streams / v_total_streams)::bigint;
          insert into public.settlement_items (
            settlement_id, artist_user_id, track_id, track_code, track_title,
            stream_count, pool_revenue_share,
            isrc, release_date, release_title, rights_holder_name
          ) values (
            v_settlement_id, v_artist.artist_user_id, v_track.track_id, v_track.track_code,
            v_track.track_title, v_track_streams, v_track_amount,
            v_track.isrc, v_track.release_date, v_track.release_title, v_track.rights_holder_name
          );
        end if;
      end loop;
    else
      if v_existing.id is not null then v_overwritten := v_overwritten + 1;
      else v_generated := v_generated + 1; end if;
    end if;
  end loop;

  insert into public.settlement_generation_runs (
    run_by, settlement_month, dry_run, policy_id,
    platform_revenue, pool_revenue, total_pool_streams,
    generated_count, overwritten_count, skipped_count,
    payable_count, carried_over_count,
    total_gross, total_company_fee, total_sales_agent_fee,
    total_final_payout, total_carried_over, skipped_artists
  ) values (
    v_uid, p_month, p_dry_run, v_policy.id,
    v_platform_revenue, v_pool_revenue, v_total_streams,
    v_generated, v_overwritten, v_skipped,
    v_payable, v_carried_count,
    v_sum_gross, v_sum_company, v_sum_agent,
    v_sum_final, v_sum_carried, v_skipped_arr
  ) returning id into v_run_id;

  return jsonb_build_object(
    'ok', true, 'run_id', v_run_id, 'dry_run', p_dry_run,
    'settlement_month', p_month,
    'platform_revenue', v_platform_revenue,
    'pool_revenue', v_pool_revenue,
    'total_pool_streams', v_total_streams,
    'generated', v_generated, 'overwritten', v_overwritten, 'skipped', v_skipped,
    'payable', v_payable, 'carried_over', v_carried_count,
    'total_gross', v_sum_gross, 'total_company_fee', v_sum_company,
    'total_sales_agent_fee', v_sum_agent,
    'total_final_payout', v_sum_final, 'total_carried_over', v_sum_carried,
    'skipped_artists', v_skipped_arr,
    'note', 'streams counted with is_effective=true only (0275 daily user×track cap)'
  );
end; $$;

grant execute on function public.admin_streaming_overview(int) to authenticated;
grant execute on function public.admin_top_streaming_tracks(int, int) to authenticated;
grant execute on function public.get_genre_chart(text) to anon, authenticated;
grant execute on function public.get_track_chart_by_genre(text, text, integer) to anon, authenticated;
grant execute on function public.get_track_chart(text, integer) to anon, authenticated;
grant execute on function public.list_genres() to anon, authenticated;
grant execute on function public.get_artist_daily_streams(int) to authenticated;
grant execute on function public.get_artist_streaming_summary() to authenticated;
grant execute on function public.admin_generate_monthly_settlement(date, boolean) to authenticated;
