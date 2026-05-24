-- 0148 — iOS 비호환 오디오(.wav 등 non-mp3) 재인코딩 대상 목록 RPC (관리자 전용, read-only).
--   audio_url 이 .mp3 가 아닌 트랙(주로 WAV) 을 반환 → 관리자 재인코딩 도구가 사용.
create or replace function public.admin_list_reencode_candidates()
 RETURNS TABLE(track_id uuid, title text, artist text, audio_url text, release_status text, audio_content_type text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select t.id, t.title, t.artist, t.audio_url, t.release_status, t.audio_content_type
  from public.tracks t
  where (select 1 from public.users u where u.id = auth.uid() and u.role='admin') = 1
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and lower(t.audio_url) !~ '\.mp3($|\?)'
    and coalesce(t.release_status,'') <> 'removed'
  order by t.created_at desc;
$function$;
revoke execute on function public.admin_list_reencode_candidates() from public, anon;
grant execute on function public.admin_list_reencode_candidates() to authenticated;
