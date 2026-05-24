-- 0145 — 0144 보강: 두 번째 불변성 트리거(_tracks_immutable_fields_check)도 재인코딩 플래그를 존중.
--   audio_url/audio_sha256 만, app.allow_audio_reencode='on'(관리자 RPC) 일 때 변경 허용. 나머지는 불변 유지.
create or replace function public._tracks_immutable_fields_check()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_allow_audio boolean := coalesce(current_setting('app.allow_audio_reencode', true) = 'on', false);
begin
  if OLD.release_status in ('scheduled','released') then
    if NEW.title is distinct from OLD.title
       or NEW.isrc is distinct from OLD.isrc
       or (not v_allow_audio and NEW.audio_url is distinct from OLD.audio_url)
       or (not v_allow_audio and NEW.audio_sha256 is distinct from OLD.audio_sha256)
       or NEW.release_date is distinct from OLD.release_date
       or NEW.rights_holder_name is distinct from OLD.rights_holder_name
       or NEW.release_title is distinct from OLD.release_title
       or NEW.track_code is distinct from OLD.track_code
    then
      raise exception 'released track immutable (id=%, status=%)', OLD.id, OLD.release_status
        using errcode = '42501',
          hint = 'released/scheduled 트랙의 핵심 메타데이터(title/isrc/audio_url/audio_sha256/release_date/rights_holder_name/release_title/track_code)는 수정할 수 없습니다. 변경하려면 새 발매로 진행하세요.';
    end if;
  end if;
  return NEW;
end; $function$;
