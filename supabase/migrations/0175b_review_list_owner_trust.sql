-- 0175b — 검수 목록에 업로더 metadata 신뢰도 노출 + trust 낮은 곡 우선 정렬
drop function if exists public.list_pending_review_tracks(integer, integer, uuid);
create function public.list_pending_review_tracks(p_limit integer default 50, p_offset integer default 0, p_artist_id uuid default null)
 RETURNS TABLE(track_id uuid, track_code text, title text, artist text, artist_name text, album_name text, release_title text, isrc text, rights_holder_name text, rights_confirmed_at timestamptz, main_genre text, sub_genre text, mood text, suitable_store text, lyrics text, audio_url text, cover_url text, payout_verification_status text, payout_bank_name text, admin_note text, created_at timestamptz, release_status text, release_date date, submitted_at timestamptz, review_started_at timestamptz, changes_requested_reason text, storage_path text, audio_content_type text, duration integer, audio_content_length bigint, audio_health_status text, ai_status text, ai_energy_level text, ai_store_fit jsonb, ai_moods text[], mismatch_score numeric, mismatch_reasons text[], ai_explanation text, q_integrated_lufs numeric, q_true_peak numeric, q_loudness_range numeric, q_clipping boolean, q_passed boolean, owner_trust_score numeric, owner_trust_tier text)
 LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select t.id, t.track_code, t.title, t.artist, ap.artist_name, t.album_name, t.release_title, t.isrc,
    t.rights_holder_name, t.rights_confirmed_at, t.main_genre, t.sub_genre, t.mood, t.suitable_store, t.lyrics,
    t.audio_url, t.cover_url, pa.verification_status, pa.bank_name, t.admin_note, t.created_at,
    t.release_status, t.release_date, t.submitted_at, t.review_started_at, t.changes_requested_reason,
    t.storage_path, t.audio_content_type, t.duration, t.audio_content_length, t.audio_health_status,
    m.status, m.ai_energy_level, m.ai_store_fit, m.ai_moods, m.mismatch_score, m.mismatch_reasons, m.explanation,
    q.integrated_lufs, q.true_peak, q.loudness_range, q.clipping_detected, q.passed_quality_check,
    ap.metadata_trust_score, public._metadata_trust_tier(ap.metadata_trust_score)
  from public.tracks t
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  left join public.track_ai_metadata m on m.track_id = t.id
  left join lateral (select * from public.track_audio_quality qq where qq.track_id=t.id order by qq.analyzed_at desc limit 1) q on true
  where t.source_type = 'artist_upload'
    and (t.visibility_status = 'pending_review' or t.release_status in ('submitted','review_pending','changes_requested'))
    and t.release_status not in ('removed','rejected','released','approved','scheduled')
    and (p_artist_id is null or t.owner_user_id = p_artist_id)
  order by ap.metadata_trust_score asc nulls last, t.created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end; $function$;
grant execute on function public.list_pending_review_tracks(integer, integer, uuid) to authenticated;
