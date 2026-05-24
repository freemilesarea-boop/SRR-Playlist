-- 0158 — fit score 계산 + behavior + 관리자/추천 RPC (Phase 4/5/7)

create or replace function public._ai_overlap(a text[], b text[])
returns int language sql immutable as $$
  select coalesce((select count(*) from (select unnest(coalesce(a,'{}')) intersect select unnest(coalesce(b,'{}'))) x),0)::int;
$$;

create or replace function public._ai_playlist_store_key(p_business text, p_category text, p_daypart text)
returns text language sql immutable as $$
  select case
    when p_business ilike '%카페%' or p_category ilike '%카페%' then case when p_daypart='morning' then 'cafe_morning' else 'cafe_afternoon' end
    when p_business ~* '와인바|라운지|호텔' or p_category ~* '와인바|라운지|호텔' then 'winebar_evening'
    when p_business ~* '미용실|네일|살롱|헤어' or p_category ~* '미용실|네일|살롱|헤어' then 'salon'
    when p_business ~* '사무실|오피스|업무' or p_category ~* '사무실|오피스|업무' then 'office'
    when p_business ~* '식당|레스토랑' or p_category ~* '식당|레스토랑' then 'restaurant'
    when p_business ~* '헬스|짐|운동|gym' or p_category ~* '헬스|짐|운동|gym' then 'gym'
    when p_business ~* '편집샵|쇼룸|플라워|편집' or p_category ~* '편집샵|쇼룸|플라워|편집' then 'lounge'
    else null
  end;
$$;

create or replace function public._ai_compute_fit(p_playlist_id uuid, p_track_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $$
declare
  pl record; ai record; t record;
  v_key text; v_audio numeric; v_meta numeric; v_behav numeric; v_pen numeric; v_fit numeric;
  v_plays int; v_comps int; v_skips int; v_status text; v_reason text; v_excluded boolean := false;
begin
  select id, business_category, category, daypart, genre_tags, mood_tags, situation_tags,
         bpm_min, bpm_max, energy_min, energy_max
    into pl from public.playlists where id=p_playlist_id;
  if pl.id is null then return; end if;
  select * into ai from public.track_ai_metadata where track_id=p_track_id;
  select genre_tags, mood_tags, audio_health_status into t from public.tracks where id=p_track_id;

  v_key := public._ai_playlist_store_key(pl.business_category, pl.category, pl.daypart);

  if ai.track_id is not null and v_key is not null and ai.ai_store_fit ? v_key then
    v_audio := (ai.ai_store_fit->>v_key)::numeric;
  else
    v_audio := 50;
  end if;

  v_meta := 50
    + public._ai_overlap(pl.genre_tags, t.genre_tags)*8
    + public._ai_overlap(pl.mood_tags, t.mood_tags)*8
    + (case when ai.track_id is not null then public._ai_overlap(pl.situation_tags, ai.ai_situations)*6 else 0 end)
    - (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*30 else 0 end);
  v_meta := least(100, greatest(0, v_meta));

  select count(*) filter (where event_type in ('play','start')),
         count(*) filter (where event_type='complete'),
         count(*) filter (where event_type='skip')
    into v_plays, v_comps, v_skips
  from public.track_play_events
  where playlist_id=p_playlist_id and track_id=p_track_id and created_at > now()-interval '90 days';
  if coalesce(v_plays,0) = 0 then
    v_behav := 50;
  else
    v_behav := least(100, greatest(0, 50 + (v_comps::numeric/v_plays)*40 - (v_skips::numeric/v_plays)*40));
  end if;

  v_pen := (case when ai.track_id is not null then coalesce(ai.mismatch_score,0)*40 else 0 end)
    + (case when t.audio_health_status='conversion_failed' then 50 else 0 end)
    + least(30, coalesce((select count(*) from public.playlist_track_skip_events e
         where e.playlist_id=p_playlist_id and e.track_id=p_track_id
           and e.created_at>now()-interval '30 days' and e.played_seconds>=5),0)*5);
  v_pen := least(100, greatest(0, v_pen));

  v_fit := least(100, greatest(0, v_audio*0.5 + v_meta*0.2 + v_behav*0.2 - v_pen*0.1));

  if ai.track_id is not null and v_key is not null and ai.ai_exclusions @> array[v_key] then
    v_excluded := true;
  end if;

  v_status := case when v_excluded then 'excluded' when v_fit < 40 then 'review_needed' else 'active' end;
  v_reason := format('audio %s · meta %s · behavior %s · penalty %s%s',
    round(v_audio), round(v_meta), round(v_behav), round(v_pen),
    case when v_key is not null then ' · store='||v_key else '' end);

  insert into public.playlist_track_fit_scores(playlist_id, track_id, fit_score, audio_score, metadata_score, behavior_score, penalty_score, reason, source, status, updated_at)
  values (p_playlist_id, p_track_id, round(v_fit), round(v_audio), round(v_meta), round(v_behav), round(v_pen), v_reason, 'algorithm', v_status, now())
  on conflict (playlist_id, track_id) do update set
    fit_score=excluded.fit_score, audio_score=excluded.audio_score, metadata_score=excluded.metadata_score,
    behavior_score=excluded.behavior_score, penalty_score=excluded.penalty_score, reason=excluded.reason,
    status=case when public.playlist_track_fit_scores.source='admin' then public.playlist_track_fit_scores.status else excluded.status end,
    updated_at=now();
end; $$;

create or replace function public.recompute_playlist_fit_scores(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select t.id from public.tracks t
    where t.release_status in ('released','approved','scheduled') and t.removed_at is null and t.audio_url is not null
  loop perform public._ai_compute_fit(p_playlist_id, r.id); v_n := v_n + 1; end loop;
  return jsonb_build_object('ok', true, 'playlist_id', p_playlist_id, 'tracks_scored', v_n);
end; $$;

create or replace function public.recompute_track_fit_scores(p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n int := 0; r record;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  for r in select id from public.playlists where coalesce(is_recommendable, true) loop
    perform public._ai_compute_fit(r.id, p_track_id); v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'playlists_scored', v_n);
end; $$;

create or replace function public.get_ai_recommended_tracks_for_playlist(p_playlist_id uuid, p_limit int default 50)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  select coalesce(jsonb_agg(row_to_json(x) order by x.fit_score desc),'[]'::jsonb) into v from (
    select s.track_id, s.fit_score, s.audio_score, s.metadata_score, s.behavior_score, s.penalty_score, s.reason, s.status,
           t.title, t.artist, t.cover_url
    from public.playlist_track_fit_scores s
    join public.tracks t on t.id=s.track_id
    where s.playlist_id=p_playlist_id and s.status='active' and s.fit_score>=70
      and t.release_status in ('released','approved') and t.removed_at is null
    order by s.fit_score desc limit greatest(1,p_limit)
  ) x;
  return v;
end; $$;

create or replace function public.get_tracks_needing_ai_review()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.mismatch_score desc nulls last),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, m.mismatch_score, m.mismatch_reasons, m.explanation, m.status as ai_status, f.status as feature_status
    from public.tracks t
    left join public.track_ai_metadata m on m.track_id=t.id
    left join public.track_audio_features f on f.track_id=t.id
    where t.source_type in ('artist_upload','admin_upload') and t.removed_at is null
      and (coalesce(m.mismatch_score,0) >= 0.4 or m.status='failed' or f.status='failed'
           or exists (select 1 from public.metadata_violation_candidates v where v.track_id=t.id and v.status='pending'))
    limit 200
  ) x;
  return v;
end; $$;

create or replace function public.admin_set_track_audio_features(p_track_id uuid, p_features jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.track_audio_features(track_id, bpm, key_name, musical_key, mode, loudness, rms, peak, dynamic_range,
     energy, danceability, acousticness, instrumentalness, speechiness, vocal_presence, brightness, tempo_stability,
     duration_seconds, analyzer, analysis_version, status, analyzed_at, updated_at)
  values (p_track_id,
    (p_features->>'bpm')::numeric, p_features->>'key_name', p_features->>'musical_key', p_features->>'mode',
    (p_features->>'loudness')::numeric, (p_features->>'rms')::numeric, (p_features->>'peak')::numeric, (p_features->>'dynamic_range')::numeric,
    (p_features->>'energy')::numeric, (p_features->>'danceability')::numeric, (p_features->>'acousticness')::numeric,
    (p_features->>'instrumentalness')::numeric, (p_features->>'speechiness')::numeric, (p_features->>'vocal_presence')::numeric,
    (p_features->>'brightness')::numeric, (p_features->>'tempo_stability')::numeric, (p_features->>'duration_seconds')::numeric,
    coalesce(p_features->>'analyzer','heuristic-v1'), coalesce(p_features->>'analysis_version','v1'), 'done', now(), now())
  on conflict (track_id) do update set
    bpm=excluded.bpm, key_name=excluded.key_name, musical_key=excluded.musical_key, mode=excluded.mode,
    loudness=excluded.loudness, rms=excluded.rms, peak=excluded.peak, dynamic_range=excluded.dynamic_range,
    energy=excluded.energy, danceability=excluded.danceability, acousticness=excluded.acousticness,
    instrumentalness=excluded.instrumentalness, speechiness=excluded.speechiness, vocal_presence=excluded.vocal_presence,
    brightness=excluded.brightness, tempo_stability=excluded.tempo_stability, duration_seconds=excluded.duration_seconds,
    analyzer=excluded.analyzer, status='done', analyzed_at=now(), updated_at=now();
  perform public.recompute_track_ai_metadata(p_track_id);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_mark_audio_analysis_failed(p_track_id uuid, p_error text)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.track_audio_features(track_id, status, error_message, updated_at)
  values (p_track_id, 'failed', left(coalesce(p_error,'analysis failed'),500), now())
  on conflict (track_id) do update set status='failed', error_message=left(coalesce(p_error,'analysis failed'),500), updated_at=now();
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_apply_ai_metadata(p_track_id uuid, p_genres text[] default null, p_moods text[] default null, p_situations text[] default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  update public.tracks set
    genre_tags = coalesce(p_genres, genre_tags), mood_tags = coalesce(p_moods, mood_tags),
    main_genre = coalesce((p_genres)[1], main_genre), mood = coalesce((p_moods)[1], mood)
  where id = p_track_id;
  update public.track_ai_metadata set status='reviewed', reviewed_by=v_uid, reviewed_at=now(), updated_at=now() where track_id=p_track_id;
  perform public.recompute_track_fit_scores(p_track_id);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.record_play_event(
  p_track_id uuid, p_playlist_id uuid, p_event_type text,
  p_played numeric default null, p_duration numeric default null,
  p_skip_reason text default null, p_device text default null, p_anon_id text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_ratio numeric;
begin
  if p_event_type not in ('play','start','skip','complete','like','unlike','error') then
    raise exception 'invalid event_type %', p_event_type;
  end if;
  v_ratio := case when p_duration is not null and p_duration>0 then least(1, greatest(0, coalesce(p_played,0)/p_duration)) else null end;
  insert into public.track_play_events(track_id, playlist_id, user_id, session_id, event_type, played_seconds, duration_seconds, completion_ratio, skip_reason, device)
  values (p_track_id, p_playlist_id, v_uid, nullif(btrim(coalesce(p_anon_id,'')),''), p_event_type,
          greatest(coalesce(p_played,0),0), p_duration, v_ratio, p_skip_reason, p_device);
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function public.recompute_playlist_fit_scores(uuid) to authenticated;
grant execute on function public.recompute_track_fit_scores(uuid) to authenticated;
grant execute on function public.get_ai_recommended_tracks_for_playlist(uuid, int) to authenticated;
grant execute on function public.get_tracks_needing_ai_review() to authenticated;
grant execute on function public.admin_set_track_audio_features(uuid, jsonb) to authenticated;
grant execute on function public.admin_mark_audio_analysis_failed(uuid, text) to authenticated;
grant execute on function public.admin_apply_ai_metadata(uuid, text[], text[], text[]) to authenticated;
grant execute on function public.record_play_event(uuid, uuid, text, numeric, numeric, text, text, text) to anon, authenticated;
