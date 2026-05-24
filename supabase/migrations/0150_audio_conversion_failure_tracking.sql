-- 0150 — 오디오 변환 실패 추적 (요구사항 #4). 변환 실패 트랙을 audio_health_status='conversion_failed'
--   로 표시 → 사용자 플레이리스트/추천/차트에서 제외(프론트 isPublicPlayableTrack + 추천/차트 RPC 의
--   audio_health_status in ('ok','unknown') 필터) + 관리자 화면에 사유 노출.
create or replace function public.admin_mark_audio_conversion_failed(p_track_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  update public.tracks set
    audio_health_status = 'conversion_failed',
    audio_health_error = left(coalesce(nullif(btrim(p_reason),''), 'MP3 변환 실패'), 500),
    audio_health_checked_at = now()
  where id = p_track_id;
  return jsonb_build_object('ok', true, 'track_id', p_track_id);
end;
$function$;
revoke execute on function public.admin_mark_audio_conversion_failed(uuid, text) from public, anon;
grant execute on function public.admin_mark_audio_conversion_failed(uuid, text) to authenticated;

-- 재인코딩 대상 목록에 health 상태/사유 포함 (관리자 패널이 이전 실패를 표시·재시도)
drop function if exists public.admin_list_reencode_candidates();
create function public.admin_list_reencode_candidates()
 RETURNS TABLE(track_id uuid, title text, artist text, audio_url text, release_status text, audio_content_type text, audio_health_status text, audio_health_error text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.title, t.artist, t.audio_url, t.release_status, t.audio_content_type,
         t.audio_health_status, t.audio_health_error
  from public.tracks t
  where (select 1 from public.users u where u.id = auth.uid() and u.role='admin') = 1
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and lower(t.audio_url) !~ '\.mp3($|\?)'
    and coalesce(t.release_status,'') <> 'removed'
  order by t.created_at desc;
$function$;
revoke execute on function public.admin_list_reencode_candidates() from public, anon;
grant execute on function public.admin_list_reencode_candidates() to authenticated;
