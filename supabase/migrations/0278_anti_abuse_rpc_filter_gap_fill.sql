-- 0278 — Anti-abuse 누락 RPC 보완 (X6.0.1 — 0276 후속)
--
-- 0276 에서 누락된 4개 RPC 에 is_effective=true 필터 추가:
--   1. recompute_track_store_behavior_scores (0252) — 매장 학습 엔진 (모든 트랙)
--   2. recompute_single_track_store_behavior_score (0252) — 단일 트랙
--   3. refresh_user_music_preferences (0208) — 사용자 선호도 (추천 시드)
--   4. get_personalized_recommendations (0208) — 개인화 추천 popularity 카운트
--
-- 정책: stream_events.is_effective = true 만 집계 (0275 daily user×track cap)
-- 영향: 매장 학습 점수 / 사용자 선호도 / 추천 popularity 모두 abuse 영향 제거.
-- 멱등: CREATE OR REPLACE.

-- ===== 1. recompute_track_store_behavior_scores =====
create or replace function public.recompute_track_store_behavior_scores(p_window_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int;
  v_start timestamptz := clock_timestamp();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  with play_agg as (
    select
      se.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      count(*) filter (where se.event_type='start' and se.is_effective = true)::int as play_count,
      count(distinct coalesce(se.user_id::text, se.anonymous_id, se.session_id))
        filter (where se.is_effective = true)::int as unique_listeners,
      count(*) filter (where se.completed=true and se.is_effective = true)::int as completed_count,
      coalesce(avg(se.listened_seconds) filter (where se.is_effective = true), 0)::numeric as avg_listen
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.created_at > now() - (p_window_days || ' days')::interval
      and se.track_id is not null
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by se.track_id, public.normalize_store_label(pl.business_category)
  ),
  skip_agg as (
    select pts.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      count(*)::int as skip_count
    from public.playlist_track_skip_events pts
    join public.playlists pl on pl.id = pts.playlist_id
    where pts.created_at > now() - (p_window_days || ' days')::interval
      and pts.track_id is not null
      and (pts.track_duration is null or pts.played_seconds < coalesce(pts.track_duration, 999) * 0.3)
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by pts.track_id, public.normalize_store_label(pl.business_category)
  ),
  like_agg as (
    select track_id, count(distinct user_id)::int as like_count
    from public.liked_tracks
    where created_at > now() - (p_window_days || ' days')::interval
      and track_id is not null
    group by track_id
  ),
  completion_agg as (
    select tpe.track_id,
      public.normalize_store_label(pl.business_category) as store_slug,
      coalesce(avg(tpe.completion_ratio), 0)::numeric as avg_completion
    from public.track_play_events tpe
    join public.playlists pl on pl.id = tpe.playlist_id
    where tpe.created_at > now() - (p_window_days || ' days')::interval
      and tpe.track_id is not null
      and tpe.event_type in ('play','complete')
      and public.normalize_store_label(pl.business_category) is not null
    group by tpe.track_id, public.normalize_store_label(pl.business_category)
  ),
  scored as (
    select pa.track_id, pa.store_slug,
      pa.play_count, pa.unique_listeners,
      (pa.completed_count::numeric / nullif(pa.play_count, 0)) as completion_rate,
      least(1.0, coalesce(sa.skip_count, 0)::numeric / nullif(pa.play_count, 0)) as skip_rate,
      case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
           then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
           else 0 end as replay_rate,
      least(1.0, coalesce(la.like_count, 0)::numeric / nullif(pa.unique_listeners, 0)) as like_rate,
      pa.avg_listen,
      coalesce(ca.avg_completion, 0) as avg_completion_percent,
      coalesce(sa.skip_count, 0) as skip_count,
      coalesce(la.like_count, 0) as like_count
    from play_agg pa
    left join skip_agg sa on sa.track_id = pa.track_id and sa.store_slug = pa.store_slug
    left join like_agg la on la.track_id = pa.track_id
    left join completion_agg ca on ca.track_id = pa.track_id and ca.store_slug = pa.store_slug
  )
  insert into public.track_store_behavior_scores (
    track_id, store_type_slug, window_days,
    play_count, unique_listener_count, completion_rate, skip_rate, replay_rate, like_rate,
    avg_listen_seconds, avg_completion_percent,
    store_behavior_score, confidence, calculated_at
  )
  select
    s.track_id, s.store_slug, p_window_days,
    s.play_count, s.unique_listeners,
    round(coalesce(s.completion_rate, 0), 4),
    round(coalesce(s.skip_rate, 0), 4),
    round(s.replay_rate, 4),
    round(coalesce(s.like_rate, 0), 4),
    round(s.avg_listen, 2),
    round(s.avg_completion_percent, 4),
    round(
      coalesce(s.completion_rate, 0) * 40
      + s.replay_rate * 20
      + coalesce(s.like_rate, 0) * 20
      - coalesce(s.skip_rate, 0) * 30
      + least(10, s.play_count::numeric / 10), 2),
    round(least(1.0, s.play_count::numeric / 50), 4),
    now()
  from scored s
  on conflict (track_id, store_type_slug, window_days) do update set
    play_count = excluded.play_count,
    unique_listener_count = excluded.unique_listener_count,
    completion_rate = excluded.completion_rate,
    skip_rate = excluded.skip_rate,
    replay_rate = excluded.replay_rate,
    like_rate = excluded.like_rate,
    avg_listen_seconds = excluded.avg_listen_seconds,
    avg_completion_percent = excluded.avg_completion_percent,
    store_behavior_score = excluded.store_behavior_score,
    confidence = excluded.confidence,
    calculated_at = now();
  get diagnostics v_count = row_count;

  insert into public.admin_bulk_operation_audit(
    admin_id, operation_type, track_count, params_json, after_json, status, completed_at
  ) values (
    v_admin, 'recompute_track_store_behavior_scores', v_count,
    jsonb_build_object('window_days', p_window_days, 'is_effective_only', true),
    jsonb_build_object('rows_upserted', v_count,
      'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int),
    'completed', now()
  );

  return jsonb_build_object('ok', true, 'rows_upserted', v_count,
    'elapsed_ms', extract(milliseconds from clock_timestamp() - v_start)::int);
end; $$;

-- ===== 2. recompute_single_track_store_behavior_score =====
create or replace function public.recompute_single_track_store_behavior_score(
  p_track_id uuid, p_window_days int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_admin uuid := auth.uid();
  v_count int := 0;
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;

  delete from public.track_store_behavior_scores
    where track_id = p_track_id and window_days = p_window_days;

  with play_agg as (
    select se.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      count(*) filter (where se.event_type='start' and se.is_effective = true)::int as play_count,
      count(distinct coalesce(se.user_id::text, se.anonymous_id, se.session_id))
        filter (where se.is_effective = true)::int as unique_listeners,
      count(*) filter (where se.completed=true and se.is_effective = true)::int as completed_count,
      coalesce(avg(se.listened_seconds) filter (where se.is_effective = true), 0)::numeric as avg_listen
    from public.stream_events se
    join public.playlists pl on pl.id = se.playlist_id
    where se.track_id = p_track_id
      and se.created_at > now() - (p_window_days || ' days')::interval
      and pl.business_category is not null
      and public.normalize_store_label(pl.business_category) is not null
    group by se.track_id, public.normalize_store_label(pl.business_category)
  ),
  skip_agg as (
    select pts.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      count(*)::int as skip_count
    from public.playlist_track_skip_events pts
    join public.playlists pl on pl.id = pts.playlist_id
    where pts.track_id = p_track_id
      and pts.created_at > now() - (p_window_days || ' days')::interval
      and (pts.track_duration is null or pts.played_seconds < coalesce(pts.track_duration, 999) * 0.3)
      and public.normalize_store_label(pl.business_category) is not null
    group by pts.track_id, public.normalize_store_label(pl.business_category)
  ),
  like_agg as (
    select count(distinct user_id)::int as like_count
    from public.liked_tracks
    where track_id = p_track_id and created_at > now() - (p_window_days || ' days')::interval
  ),
  completion_agg as (
    select tpe.track_id, public.normalize_store_label(pl.business_category) as store_slug,
      coalesce(avg(tpe.completion_ratio), 0)::numeric as avg_completion
    from public.track_play_events tpe
    join public.playlists pl on pl.id = tpe.playlist_id
    where tpe.track_id = p_track_id
      and tpe.created_at > now() - (p_window_days || ' days')::interval
      and tpe.event_type in ('play','complete')
      and public.normalize_store_label(pl.business_category) is not null
    group by tpe.track_id, public.normalize_store_label(pl.business_category)
  )
  insert into public.track_store_behavior_scores (
    track_id, store_type_slug, window_days,
    play_count, unique_listener_count, completion_rate, skip_rate, replay_rate, like_rate,
    avg_listen_seconds, avg_completion_percent,
    store_behavior_score, confidence, calculated_at
  )
  select pa.track_id, pa.store_slug, p_window_days,
    pa.play_count, pa.unique_listeners,
    round(coalesce((pa.completed_count::numeric / nullif(pa.play_count, 0)), 0), 4),
    round(least(1.0, coalesce(sa.skip_count, 0)::numeric / nullif(pa.play_count, 0)), 4),
    round(case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
               then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
               else 0 end, 4),
    round(least(1.0, coalesce(la.like_count, 0)::numeric / nullif(pa.unique_listeners, 0)), 4),
    round(pa.avg_listen, 2),
    round(coalesce(ca.avg_completion, 0), 4),
    round(
      coalesce(pa.completed_count::numeric / nullif(pa.play_count, 0), 0) * 40
      + (case when pa.unique_listeners > 0 and pa.play_count > pa.unique_listeners
              then (pa.play_count - pa.unique_listeners)::numeric / pa.play_count
              else 0 end) * 20
      + coalesce(least(1.0, la.like_count::numeric / nullif(pa.unique_listeners, 0)), 0) * 20
      - coalesce(least(1.0, sa.skip_count::numeric / nullif(pa.play_count, 0)), 0) * 30
      + least(10, pa.play_count::numeric / 10), 2),
    round(least(1.0, pa.play_count::numeric / 50), 4),
    now()
  from play_agg pa
  left join skip_agg sa on sa.track_id = pa.track_id and sa.store_slug = pa.store_slug
  left join like_agg la on true
  left join completion_agg ca on ca.track_id = pa.track_id and ca.store_slug = pa.store_slug;
  get diagnostics v_count = row_count;

  return jsonb_build_object('ok', true, 'rows_upserted', v_count, 'track_id', p_track_id);
end; $$;

-- ===== 3. refresh_user_music_preferences =====
-- per_track 의 weighted score 와 plays/completes 카운트 모두 is_effective 만 사용.
create or replace function public.refresh_user_music_preferences(p_user_id uuid)
returns void
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if p_user_id is null then return; end if;
  with per_track as (
    select se.track_id, t.main_genre as genre, t.mood, se.artist_user_id,
           least(sum(
             (case se.event_type when 'complete' then 4 when 'milestone_30s' then 2 else 1 end)
             * (case when se.created_at > now()-interval '30 days' then 1.5
                     when se.created_at > now()-interval '90 days' then 1.0 else 0.4 end)), 14) as track_score,
           count(*) filter (where se.event_type in ('milestone_30s','complete')) as plays,
           count(*) filter (where se.completed) as completes,
           max(se.created_at) as last_at
    from public.stream_events se join public.tracks t on t.id = se.track_id
    where se.user_id = p_user_id and se.created_at > now()-interval '180 days'
      and se.event_type in ('start','milestone_30s','complete') and t.release_status='released'
      and se.is_effective = true
    group by se.track_id, t.main_genre, t.mood, se.artist_user_id
  ),
  liked as (
    select t.main_genre as genre, t.mood, t.owner_user_id as artist_user_id, 5::numeric bonus
    from public.liked_tracks lt join public.tracks t on t.id = lt.track_id
    where lt.user_id = p_user_id and t.release_status='released'
  ),
  combined as (
    select ptype, pkey, sum(sc) sc, sum(pc) pc, sum(cc) cc, max(la) la from (
      select 'genre'::text ptype, genre pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la from per_track where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'genre', genre, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(genre,'')),'') is not null group by genre
      union all select 'mood', mood, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'mood', mood, sum(bonus), 0,0,null from liked where nullif(trim(coalesce(mood,'')),'') is not null group by mood
      union all select 'artist', artist_user_id::text, sum(track_score), sum(plays), sum(completes), max(last_at) from per_track where artist_user_id is not null group by artist_user_id
    ) x group by ptype, pkey
  )
  insert into public.user_music_preferences(user_id, preference_type, preference_key, score, play_count, completed_count, last_played_at, updated_at)
  select p_user_id, ptype, pkey, round(sc,2), pc, cc, la, now() from combined
  on conflict (user_id, preference_type, preference_key) do update set
    score=excluded.score, play_count=excluded.play_count, completed_count=excluded.completed_count,
    last_played_at=excluded.last_played_at, updated_at=now();
  delete from public.user_music_preferences ump
  where ump.user_id = p_user_id and ump.updated_at < now() - interval '1 second';
end; $function$;

-- ===== 4. get_personalized_recommendations =====
-- popularity (pop) / 사용자별 myplays 모두 is_effective 만 카운트.
create or replace function public.get_personalized_recommendations(p_limit integer default 12)
returns table(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, score numeric, reason text)
language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0; v_mg numeric; v_mm numeric; v_ma numeric;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(p.score),0) into v_total from public.user_music_preferences p where p.user_id=v_uid;
  end if;

  if v_uid is null or v_total < 5 then
    return query
    with cand as (
      select t.*, coalesce((
        select count(*) from public.stream_events se
        where se.track_id=t.id and se.event_type='milestone_30s' and se.is_effective = true
      ),0) pop
      from public.tracks t
      where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
        and t.removed_at is null and coalesce(t.is_recommendable,true)=true
        and t.audio_url is not null and length(btrim(t.audio_url))>0
        and t.cover_url is not null and length(btrim(t.cover_url))>0
    ), ranked as (
      select c.*, row_number() over (partition by c.owner_user_id order by c.created_at desc) rn from cand c
    )
    select r.id, r.title, r.artist, r.main_genre, r.mood, r.cover_url, r.audio_url, r.duration,
           round((0.5*(case when r.created_at>now()-interval '21 days' then 1 else 0.3 end) + 0.5*least(r.pop::numeric/20,1) + 0.05*r.recommendation_priority),4),
           '인기·신곡 추천'::text
    from ranked r where rn <= 2
    order by 9 desc, r.created_at desc limit p_limit;
    return;
  end if;

  select max(p.score) into v_mg from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='genre';
  select max(p.score) into v_mm from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='mood';
  select max(p.score) into v_ma from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='artist';

  return query
  with cand as (
    select t.*,
      coalesce((select g.score from public.user_music_preferences g where g.user_id=v_uid and g.preference_type='genre' and g.preference_key=t.main_genre),0) gsc,
      coalesce((select m.score from public.user_music_preferences m where m.user_id=v_uid and m.preference_type='mood' and m.preference_key=t.mood),0) msc,
      coalesce((select a.score from public.user_music_preferences a where a.user_id=v_uid and a.preference_type='artist' and a.preference_key=t.owner_user_id::text),0) asc_,
      coalesce((
        select count(*) from public.stream_events se
        where se.track_id=t.id and se.event_type='milestone_30s' and se.is_effective = true
      ),0) pop,
      coalesce((
        select count(*) from public.stream_events se
        where se.user_id=v_uid and se.track_id=t.id and se.event_type='milestone_30s' and se.is_effective = true
      ),0) myplays
    from public.tracks t
    where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
      and t.removed_at is null and coalesce(t.is_recommendable,true)=true
      and t.audio_url is not null and length(btrim(t.audio_url))>0
      and t.cover_url is not null and length(btrim(t.cover_url))>0
  ),
  scored as (
    select c.*,
      ( 0.35*(case when coalesce(v_mg,0)>0 then c.gsc/v_mg else 0 end)
      + 0.25*(case when coalesce(v_mm,0)>0 then c.msc/v_mm else 0 end)
      + 0.15*(case when coalesce(v_ma,0)>0 then c.asc_/v_ma else 0 end)
      + 0.15*(case when c.created_at>now()-interval '21 days' then 1 when c.created_at>now()-interval '60 days' then 0.5 else 0.1 end)
      + 0.10*least(c.pop::numeric/20,1)
      + 0.02*c.recommendation_priority
      - (case when c.myplays>=5 then 0.4 when c.myplays>=2 then 0.2 else 0 end) ) as rec_score
    from cand c
  ),
  ranked as (
    select s.*, row_number() over (partition by s.owner_user_id order by rec_score desc) artist_rn from scored s where rec_score > 0
  )
  select r.id, r.title, r.artist, r.main_genre, r.mood, r.cover_url, r.audio_url, r.duration,
         round(r.rec_score,4),
         (case when r.gsc>0 and r.gsc=greatest(r.gsc,r.msc,r.asc_) then '자주 듣는 장르'
               when r.msc>0 and r.msc>=r.gsc then '자주 듣는 분위기'
               when r.asc_>0 then '관심 아티스트'
               when r.created_at>now()-interval '21 days' then '신곡'
               else '추천' end)::text
  from ranked r where artist_rn <= 2
  order by rec_score desc limit p_limit;
end; $function$;

grant execute on function public.recompute_track_store_behavior_scores(int) to authenticated, service_role;
grant execute on function public.recompute_single_track_store_behavior_score(uuid, int) to authenticated, service_role;
grant execute on function public.refresh_user_music_preferences(uuid) to authenticated, service_role;
grant execute on function public.get_personalized_recommendations(integer) to anon, authenticated;
