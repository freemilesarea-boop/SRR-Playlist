-- 0131 — released 트랙 공개중단(takedown) 허용: released → removed 전이만 예외 허용.
--   기존 보호(다른 상태 전이 금지 + 발매 유지 중 release_*/핵심 메타데이터 불변)는 유지.
--   admin_takedown_track(관리자 전용, 사유 5자+)만 removed 로 전환 가능(물리삭제 아님, 데이터 보존).
create or replace function public._tracks_release_protect()
returns trigger language plpgsql set search_path to 'public' as $function$
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
         or NEW.audio_url is distinct from OLD.audio_url
         or NEW.audio_sha256 is distinct from OLD.audio_sha256
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
