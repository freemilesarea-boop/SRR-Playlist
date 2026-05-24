-- 0147 — 0146 수정: text[] || 'literal' 모호성(배열 리터럴 파싱 오류) → array_append 로 교체.
create or replace function public._tracks_require_metadata_for_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_missing text[] := '{}';
begin
  if NEW.release_status in ('submitted','review_pending','approved','scheduled','released') then
    if NEW.cover_url is null or btrim(NEW.cover_url) = '' then v_missing := array_append(v_missing, '앨범 자켓'); end if;
    if NEW.audio_url is null or btrim(NEW.audio_url) = '' then v_missing := array_append(v_missing, '음원 파일'); end if;
    if NEW.title is null or btrim(NEW.title) = '' then v_missing := array_append(v_missing, '곡명'); end if;
    if NEW.album_name is null or btrim(NEW.album_name) = '' then v_missing := array_append(v_missing, '앨범명'); end if;
    if NEW.artist is null or btrim(NEW.artist) = '' then v_missing := array_append(v_missing, '아티스트명'); end if;
    if NEW.main_genre is null or btrim(NEW.main_genre) = '' then v_missing := array_append(v_missing, '장르'); end if;
    if NEW.release_type is null or btrim(NEW.release_type) = '' then v_missing := array_append(v_missing, '발매 유형'); end if;
    if NEW.release_date is null then v_missing := array_append(v_missing, '발매일'); end if;
    if NEW.rights_confirmed_at is null then v_missing := array_append(v_missing, '유통 동의/권리 확인'); end if;
    if array_length(v_missing, 1) is not null then
      raise exception 'release blocked (status=%): missing %', NEW.release_status, array_to_string(v_missing, ', ')
        using errcode = '23514',
          hint = '필수 정보 누락: ' || array_to_string(v_missing, ', ') || ' — 모두 입력해야 제출/검수/발매가 가능합니다.';
    end if;
  end if;
  return NEW;
end;
$function$;
