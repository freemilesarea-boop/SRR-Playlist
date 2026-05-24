-- 0159 — 관리자 AI 큐레이션 목록 (분석 대기 / 판정 결과 / 필터)
create or replace function public.admin_list_ai_curation(p_filter text default 'all', p_limit int default 100, p_offset int default 0)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(row_to_json(x)),'[]'::jsonb) into v from (
    select t.id as track_id, t.title, t.artist, t.cover_url, t.audio_url, t.duration, t.main_genre, t.genre_tags, t.mood, t.mood_tags,
           t.business_type_tags, t.energy_level as registrant_energy, t.bpm as registrant_bpm,
           f.status as feature_status, f.analyzer, f.bpm, f.energy, f.danceability, f.acousticness,
           f.instrumentalness, f.vocal_presence, f.brightness, f.tempo_stability, f.error_message,
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
        when 'gym_unfit' then (m.ai_store_fit ? 'gym' and (m.ai_store_fit->>'gym')::numeric < 40)
        when 'cafe_fit' then (m.ai_store_fit ? 'cafe_afternoon' and (m.ai_store_fit->>'cafe_afternoon')::numeric >= 70)
        when 'review_needed' then (m.status in ('done','failed') and coalesce(m.mismatch_score,0) >= 0.4)
        else true
      end
    order by coalesce(m.mismatch_score,0) desc, t.created_at desc
    limit greatest(1,p_limit) offset greatest(0,p_offset)
  ) x;
  return v;
end; $$;
grant execute on function public.admin_list_ai_curation(text, int, int) to authenticated;
