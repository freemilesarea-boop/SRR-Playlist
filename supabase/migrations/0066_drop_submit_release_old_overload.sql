-- 0066 — submit_artist_release 19-param 구버전 DROP (긴급 핫픽스)
--
-- 배경:
--   0065 (P0 stabilization) 에서 submit_artist_release 에 p_audio_sha256 (text)
--   파라미터를 추가하며 CREATE OR REPLACE FUNCTION 으로 작성.
--   그러나 Postgres 는 시그니처(파라미터 개수/타입)가 다르면 REPLACE 가 아닌
--   별개 함수로 추가하므로, 19-param 구버전 + 20-param 신버전이 함께 존재.
--
-- 운영 증상:
--   아티스트 음원 업로드 시 PostgREST 가 PGRST203 (Could not choose the
--   best candidate function) 으로 400 반환 → 업로드 실패.
--
-- 조치:
--   구버전(19-param) 만 명시적 DROP. 신버전(20-param) 보존.
--   DROP 후 함수가 정확히 1개만 남아있는지 DO 블록으로 검증.

DROP FUNCTION IF EXISTS public.submit_artist_release(
  p_track_id uuid,
  p_title text,
  p_artist text,
  p_album_name text,
  p_release_title text,
  p_release_type text,
  p_release_date date,
  p_main_genre text,
  p_sub_genre text,
  p_mood text,
  p_suitable_store text,
  p_lyrics text,
  p_isrc text,
  p_rights_holder_name text,
  p_explicit_content boolean,
  p_instrumental boolean,
  p_audio_url text,
  p_cover_url text,
  p_rights_confirmed boolean
);

DO $$
DECLARE c int;
BEGIN
  SELECT COUNT(*) INTO c FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='submit_artist_release';
  IF c <> 1 THEN
    RAISE EXCEPTION 'submit_artist_release overload 정리 실패 (남은 함수: %)', c;
  END IF;
END $$;
