-- 0144 — 발매 음원 재인코딩(iOS 호환 MP3) 허용 경로.
--   기존 _tracks_release_protect 트리거가 released 트랙의 audio_url/audio_sha256 변경을 전면 차단해
--   WAV→MP3 재인코딩이 불가능했다. 관리자 전용 RPC(admin_replace_track_audio)가 설정하는
--   트랜잭션-local 플래그(app.allow_audio_reencode='on')일 때만 audio_url/audio_sha256 변경을 허용한다.
--   그 외 핵심 메타데이터(제목/권리/앨범/소유자/발매일 등)는 여전히 불변. 데이터 삭제 없음.

create or replace function public._tracks_release_protect()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_allow_audio boolean := coalesce(current_setting('app.allow_audio_reencode', true) = 'on', false);
begin
  if OLD.release_status = 'released' then
    if NEW.release_status not in ('released', 'removed') then
      raise exception 'released track is immutable on release_status (id=%)', OLD.id using errcode = '42501';
    end if;
    if NEW.release_status = 'released' then
      if NEW.release_date is distinct from OLD.release_date
         or NEW.release_type is distinct from OLD.release_type
         or NEW.released_at is distinct from OLD.released_at then
        raise exception 'released track is immutable on release_* fields (id=%)', OLD.id using errcode = '42501';
      end if;
      if NEW.title is distinct from OLD.title
         or (not v_allow_audio and NEW.audio_url is distinct from OLD.audio_url)
         or (not v_allow_audio and NEW.audio_sha256 is distinct from OLD.audio_sha256)
         or NEW.isrc is distinct from OLD.isrc
         or NEW.rights_holder_name is distinct from OLD.rights_holder_name
         or NEW.rights_confirmed_at is distinct from OLD.rights_confirmed_at
         or NEW.album_name is distinct from OLD.album_name
         or NEW.release_title is distinct from OLD.release_title
         or NEW.owner_user_id is distinct from OLD.owner_user_id
         or NEW.artist_profile_id is distinct from OLD.artist_profile_id
         or NEW.payout_account_id is distinct from OLD.payout_account_id then
        raise exception 'released track core metadata is immutable (id=%)', OLD.id using errcode = '42501';
      end if;
    end if;
  end if;
  return NEW;
end;
$function$;

create or replace function public.admin_replace_track_audio(
  p_track_id uuid, p_audio_url text, p_audio_sha256 text default null, p_content_type text default null)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_exists boolean;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  if p_audio_url is null or length(btrim(p_audio_url)) = 0 then raise exception 'audio_url required'; end if;
  select exists(select 1 from public.tracks where id=p_track_id) into v_exists;
  if not v_exists then raise exception 'track not found'; end if;

  perform set_config('app.allow_audio_reencode', 'on', true);

  update public.tracks set
    audio_url = btrim(p_audio_url),
    audio_sha256 = coalesce(nullif(btrim(p_audio_sha256), ''), audio_sha256),
    audio_content_type = coalesce(nullif(btrim(p_content_type), ''), audio_content_type, 'audio/mpeg'),
    audio_health_status = 'unknown',
    audio_health_checked_at = null,
    audio_health_error = null
  where id = p_track_id;

  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'audio_url', btrim(p_audio_url));
end;
$function$;
revoke execute on function public.admin_replace_track_audio(uuid, text, text, text) from public, anon;
grant execute on function public.admin_replace_track_audio(uuid, text, text, text) to authenticated;
