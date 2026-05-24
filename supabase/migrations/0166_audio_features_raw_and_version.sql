-- 0166 — 실 DSP 분석 결과 저장 확장 (raw_features/spectral_centroid) + analyzer/version 노출
alter table public.track_audio_features add column if not exists raw_features jsonb;
alter table public.track_audio_features add column if not exists spectral_centroid numeric;

create or replace function public.admin_set_track_audio_features(p_track_id uuid, p_features jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.track_audio_features(track_id, bpm, key_name, musical_key, mode, loudness, rms, peak, dynamic_range,
     energy, danceability, acousticness, instrumentalness, speechiness, vocal_presence, brightness, tempo_stability,
     spectral_centroid, duration_seconds, raw_features, analyzer, analysis_version, status, analyzed_at, updated_at)
  values (p_track_id,
    (p_features->>'bpm')::numeric, p_features->>'key_name', p_features->>'musical_key', p_features->>'mode',
    (p_features->>'loudness')::numeric, (p_features->>'rms')::numeric, (p_features->>'peak')::numeric, (p_features->>'dynamic_range')::numeric,
    (p_features->>'energy')::numeric, (p_features->>'danceability')::numeric, (p_features->>'acousticness')::numeric,
    (p_features->>'instrumentalness')::numeric, (p_features->>'speechiness')::numeric, (p_features->>'vocal_presence')::numeric,
    (p_features->>'brightness')::numeric, (p_features->>'tempo_stability')::numeric, (p_features->>'spectral_centroid')::numeric,
    (p_features->>'duration_seconds')::numeric, p_features->'raw_features',
    coalesce(p_features->>'analyzer','heuristic-v1'), coalesce(p_features->>'analysis_version','v1'), 'done', now(), now())
  on conflict (track_id) do update set
    bpm=excluded.bpm, key_name=excluded.key_name, musical_key=excluded.musical_key, mode=excluded.mode,
    loudness=excluded.loudness, rms=excluded.rms, peak=excluded.peak, dynamic_range=excluded.dynamic_range,
    energy=excluded.energy, danceability=excluded.danceability, acousticness=excluded.acousticness,
    instrumentalness=excluded.instrumentalness, speechiness=excluded.speechiness, vocal_presence=excluded.vocal_presence,
    brightness=excluded.brightness, tempo_stability=excluded.tempo_stability, spectral_centroid=excluded.spectral_centroid,
    duration_seconds=excluded.duration_seconds, raw_features=excluded.raw_features,
    analyzer=excluded.analyzer, analysis_version=excluded.analysis_version, status='done', analyzed_at=now(), updated_at=now();
  perform public.recompute_track_ai_metadata(p_track_id);
  return jsonb_build_object('ok', true);
end; $$;

create or replace function public.admin_list_ai_curation(p_filter text default 'all', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.cover_url, t.audio_url, t.duration, t.main_genre, t.genre_tags, t.mood, t.mood_tags,
           t.business_type_tags, t.energy_level as registrant_energy, t.bpm as registrant_bpm,
           f.status as feature_status, f.analyzer, f.analysis_version, f.bpm, f.energy, f.danceability, f.acousticness,
           f.instrumentalness, f.vocal_presence, f.brightness, f.tempo_stability, f.spectral_centroid, f.loudness, f.dynamic_range,
           f.raw_features, f.error_message,
           m.status as ai_status, m.ai_energy_level, m.ai_store_fit, m.ai_exclusions, m.ai_moods, m.ai_situations,
           m.mismatch_score, m.mismatch_reasons, m.explanation, m.metadata_confidence, m.reviewed_at
    from public.tracks t
    left join public.track_audio_features f on f.track_id=t.id
    left join public.track_ai_metadata m on m.track_id=t.id
    where t.source_type in ('artist_upload','admin_upload') and t.removed_at is null
      and t.release_status in ('released','approved','scheduled','submitted','review_pending','changes_requested')
      and case p_filter
        when 'pending' then (f.track_id is null or f.status in ('pending','analyzing'))
        when 'analyzed' then (f.status='done')
        when 'failed' then (f.status='failed' or m.status='failed')
        when 'mismatch_high' then (coalesce(m.mismatch_score,0) >= 0.5)
        when 'gym_fit' then (m.ai_store_fit ? 'gym' and (m.ai_store_fit->>'gym')::numeric >= 70)
        when 'gym_unfit' then (m.ai_store_fit ? 'gym' and (m.ai_store_fit->>'gym')::numeric < 40)
        when 'cafe_fit' then (m.ai_store_fit ? 'cafe_independent' and (m.ai_store_fit->>'cafe_independent')::numeric >= 70)
        when 'yoga_hospital_unfit' then (m.ai_exclusions && array['yoga','hospital'])
        when 'kids_risk' then (m.ai_exclusions && array['kids_cafe'])
        when 'heuristic' then (f.analyzer in ('heuristic-v1','mock-v1'))
        when 'real_dsp' then (f.analyzer like 'webaudio%' or f.analyzer like 'essentia%' or f.analyzer like 'meyda%')
        when 'review_needed' then (m.status in ('done','failed') and coalesce(m.mismatch_score,0) >= 0.4)
        else true
      end
    order by coalesce(m.mismatch_score,0) desc, t.created_at desc
    limit greatest(1,p_limit) offset greatest(0,p_offset)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_ai_curation(text, int, int) to authenticated;
