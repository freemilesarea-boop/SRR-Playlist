-- 0274 — get_playlist_tracks: review_needed 도 재생 대상에서 제외 (X5.4 후속)
--
-- 문제: MD 정책 위반 → playlist_track_fit_scores.status='review_needed' 마킹됐으나,
--       0262/0259 의 get_playlist_tracks 필터는 'excluded' 만 차단.
--       따라서 위반곡이 사업자/사용자 재생 목록에 그대로 노출됨.
--
-- 수정: f.status 가 null 또는 'active' 인 경우만 재생 노출.
--       'review_needed' / 'excluded' 둘 다 사업자 재생/자동 큐에서 숨김.
--       관리자 화면 (admin_get_playlist_inspector 등) 은 영향 없음.
--
-- 복구: admin_change_track_fit_status(playlist, track, 'active') 로 복구 가능.
-- 제거: admin_remove_track_from_playlist(playlist, track) 로 soft delete 가능.
-- playlist_tracks 원본 변경 없음 (status flip only).

create or replace function public.get_playlist_tracks(p_playlist_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare v jsonb; v_sk text;
begin
  v_sk := public._playlist_store_key(p_playlist_id);
  select coalesce(jsonb_agg(to_jsonb(t) order by pt.order_index), '[]'::jsonb) into v
  from public.playlist_tracks pt
  join public.tracks t on t.id = pt.track_id
  left join public.playlist_track_fit_scores f
    on f.playlist_id = pt.playlist_id and f.track_id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and pt.removed_at is null
    and t.release_status in ('released','approved') and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
    and not public._business_track_excluded(t.id, v_sk)
    -- 🆕 0274: 'excluded' + 'review_needed' 둘 다 차단 (whitelist: null|active)
    and (f.status is null or f.status = 'active');
  return v;
end; $$;

grant execute on function public.get_playlist_tracks(uuid) to authenticated, anon;
