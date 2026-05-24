-- 0162 — behavior_score 고도화 + 운영 성과 대시보드 + 자동 검토후보 등록
-- track_play_events 전용. 정산용 stream_events 는 절대 미사용/미변경.

create or replace function public._ai_behavior_score(p_playlist_id uuid, p_track_id uuid)
returns numeric language plpgsql stable security definer set search_path to 'public' as $$
declare
  v_plays int; v_skips int; v_comps int; v_likes int; v_errs int; v_depth numeric; v_n int;
  comp_r numeric; skip_r numeric; like_r numeric; err_r numeric; raw numeric;
begin
  select count(*) filter (where event_type in ('play','start')),
         count(*) filter (where event_type='skip'),
         count(*) filter (where event_type='complete'),
         count(*) filter (where event_type='like'),
         count(*) filter (where event_type='error'),
         coalesce(avg(completion_ratio) filter (where completion_ratio is not null), 0),
         count(*)
    into v_plays, v_skips, v_comps, v_likes, v_errs, v_depth, v_n
  from public.track_play_events
  where track_id=p_track_id and (p_playlist_id is null or playlist_id=p_playlist_id)
    and created_at > now()-interval '90 days';
  if coalesce(v_plays,0) = 0 then return 50; end if;
  comp_r := least(1, v_comps::numeric/v_plays);
  skip_r := least(1, v_skips::numeric/v_plays);
  like_r := least(1, v_likes::numeric/v_plays);
  err_r  := least(1, v_errs::numeric/v_plays);
  raw := comp_r*60 + like_r*20 + v_depth*20 - skip_r*40 - err_r*30;
  raw := least(100, greatest(0, raw));
  if v_n < 5 then raw := 50 + (raw-50)*(v_n::numeric/5); end if;
  return round(raw);
end; $$;
grant execute on function public._ai_behavior_score(uuid, uuid) to authenticated;

-- _ai_compute_fit behavior 를 _ai_behavior_score 로 교체
create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; ai record; t record; cfg record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric;
  v_status text; v_reason text; v_excluded boolean := false;
begin
  select * into cfg from public.ai_scoring_config where id=1;
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;
  v_key := public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart);
  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric; else v_audio := 50; end if;
  v_meta := 50 + public._ai_overlap(pl.genre_tags, t.genre_tags)*8 + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));
  v_behav := public._ai_behavior_score(p_playlist_id, p_track_id);
  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));
  v_fit := least(100, greatest(0, v_audio*cfg.fit_audio_w + v_meta*cfg.fit_meta_w + v_behav*cfg.fit_behavior_w - v_pen*cfg.fit_penalty_w));
  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then v_excluded := true; end if;
  v_status := case when v_excluded then 'excluded' when v_fit < cfg.fit_exclude_cutoff then 'review_needed' else 'active' end;
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s%s', round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    case when v_key is not null then ' · store='||v_key else '' end);
  insert into public.playlist_track_fit_scores(playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score, reason, source, status, updated_at)
  values (p_playlist_id, p_track_id, round(v_fit), round(v_audio), round(v_meta), round(v_behav), round(v_pen), v_reason, 'algorithm', v_status, now())
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin' then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now();
end; $$;

create or replace function public.admin_play_event_stats(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb; v_plays int; v_skips int; v_comps int; v_likes int; v_errs int;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select count(*) filter (where event_type in ('play','start')), count(*) filter (where event_type='skip'),
         count(*) filter (where event_type='complete'), count(*) filter (where event_type='like'),
         count(*) filter (where event_type='error')
    into v_plays, v_skips, v_comps, v_likes, v_errs
  from public.track_play_events where created_at > now() - (p_days || ' days')::interval;
  v := jsonb_build_object('total_plays', v_plays, 'total_skips', v_skips, 'total_completes', v_comps,
    'total_likes', v_likes, 'total_errors', v_errs,
    'avg_completion_rate', case when v_plays>0 then round((v_comps::numeric/v_plays)*100) else 0 end,
    'avg_skip_rate', case when v_plays>0 then round((v_skips::numeric/v_plays)*100) else 0 end, 'days', p_days);
  return v;
end; $$;
grant execute on function public.admin_play_event_stats(int) to authenticated;

create or replace function public.admin_track_performance(p_days int default 30, p_sort text default 'skip_rate', p_limit int default 100)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by
      case p_sort when 'skip_rate' then x.skip_rate when 'completion_rate' then -x.completion_rate
                  when 'fit_low' then x.fit_score when 'mismatch' then -coalesce(x.mismatch_score,0) else x.skip_rate end
      desc nulls last),'[]'::jsonb) into v
  from (
    select e.track_id, e.playlist_id, t.title, t.artist, p.title as playlist_title,
      count(*) filter (where e.event_type in ('play','start')) as play_count,
      count(*) filter (where e.event_type='skip') as skip_count,
      count(*) filter (where e.event_type='complete') as complete_count,
      count(*) filter (where e.event_type='like') as like_count,
      count(*) filter (where e.event_type='error') as error_count,
      round(coalesce(avg(e.played_seconds) filter (where e.played_seconds is not null),0)) as avg_played_seconds,
      case when count(*) filter (where e.event_type in ('play','start'))>0
        then round(100.0*count(*) filter (where e.event_type='skip')/count(*) filter (where e.event_type in ('play','start'))) else 0 end as skip_rate,
      case when count(*) filter (where e.event_type in ('play','start'))>0
        then round(100.0*count(*) filter (where e.event_type='complete')/count(*) filter (where e.event_type in ('play','start'))) else 0 end as completion_rate,
      case when count(*) filter (where e.event_type in ('play','start'))>0
        then round(100.0*count(*) filter (where e.event_type='like')/count(*) filter (where e.event_type in ('play','start'))) else 0 end as like_rate,
      public._ai_behavior_score(e.playlist_id, e.track_id) as behavior_score, fs.fit_score, m.mismatch_score
    from public.track_play_events e
    join public.tracks t on t.id=e.track_id
    left join public.playlists p on p.id=e.playlist_id
    left join public.playlist_track_fit_scores fs on fs.playlist_id=e.playlist_id and fs.track_id=e.track_id
    left join public.track_ai_metadata m on m.track_id=e.track_id
    where e.created_at > now() - (p_days || ' days')::interval
    group by e.track_id, e.playlist_id, t.title, t.artist, p.title, fs.fit_score, m.mismatch_score
    limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_track_performance(int, text, int) to authenticated;

create or replace function public.admin_playlist_performance(p_days int default 30)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.total_plays desc),'[]'::jsonb) into v from (
    select e.playlist_id, p.title as playlist_title,
      count(*) filter (where e.event_type in ('play','start')) as total_plays,
      count(*) filter (where e.event_type='skip') as total_skips,
      count(*) filter (where e.event_type='complete') as total_completes,
      case when count(*) filter (where e.event_type in ('play','start'))>0
        then round(100.0*count(*) filter (where e.event_type='skip')/count(*) filter (where e.event_type in ('play','start'))) else 0 end as avg_skip_rate,
      case when count(*) filter (where e.event_type in ('play','start'))>0
        then round(100.0*count(*) filter (where e.event_type='complete')/count(*) filter (where e.event_type in ('play','start'))) else 0 end as avg_completion_rate,
      (select count(*) from public.playlist_track_fit_scores fs where fs.playlist_id=e.playlist_id and fs.status='review_needed') as review_needed_count
    from public.track_play_events e
    left join public.playlists p on p.id=e.playlist_id
    where e.created_at > now() - (p_days || ' days')::interval and e.playlist_id is not null
    group by e.playlist_id, p.title
  ) x;
  return v;
end; $$;
grant execute on function public.admin_playlist_performance(int) to authenticated;

create or replace function public.admin_register_skip_violations()
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare r record; v_n int := 0; v_sev text; v_skiprate numeric; v_comprate numeric;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in
    select e.playlist_id, e.track_id,
      count(*) filter (where e.event_type in ('play','start')) as plays,
      count(*) filter (where e.event_type='skip') as skips,
      count(*) filter (where e.event_type='complete') as comps
    from public.track_play_events e
    where e.created_at > now()-interval '30 days' and e.playlist_id is not null
    group by e.playlist_id, e.track_id
    having count(*) filter (where e.event_type='skip') >= 3 and count(*) filter (where e.event_type in ('play','start')) > 0
  loop
    v_skiprate := r.skips::numeric/greatest(r.plays,1);
    v_comprate := r.comps::numeric/greatest(r.plays,1);
    if v_skiprate >= 0.40 and v_comprate <= 0.30 then
      v_sev := case when v_skiprate >= 0.60 then 'high' else 'medium' end;
      insert into public.metadata_violation_candidates(playlist_id, track_id, skip_count, status, violation_type, severity,
        completion_rate, mismatch_score, reason, first_detected_at, last_detected_at)
      values (r.playlist_id, r.track_id, r.skips, 'pending', 'high_skip_rate', v_sev, round(v_comprate,3), null,
        format('이 곡은 해당 플레이리스트에서 스킵률 %s%%, 완청률 %s%%로 낮은 성과를 보였습니다.', round(v_skiprate*100), round(v_comprate*100)),
        now(), now())
      on conflict (playlist_id, track_id) do update set
        skip_count=excluded.skip_count, violation_type='high_skip_rate', severity=excluded.severity,
        completion_rate=excluded.completion_rate, reason=excluded.reason, last_detected_at=now(),
        status=case when public.metadata_violation_candidates.status in ('resolved','ignored') then 'pending' else public.metadata_violation_candidates.status end;
      v_n := v_n + 1;
    end if;
  end loop;
  return jsonb_build_object('ok', true, 'registered', v_n);
end; $$;
grant execute on function public.admin_register_skip_violations() to authenticated;
