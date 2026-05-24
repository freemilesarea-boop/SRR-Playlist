-- 0146 — [3중 방어 DB 레벨] 발매 가능 상태에서 필수 메타데이터(특히 앨범 자켓) 누락 차단.
--   submit/review/approve/release 가 어떤 경로(RPC/직접 UPDATE/자동발매 트리거)로 진입하든,
--   release_status 가 submitted/review_pending/approved/scheduled/released 가 되려면 필수값이 모두 있어야 함.
--   draft/changes_requested/rejected/removed 는 누락 허용(임시저장 가능).
--   ⚠ 이 버전은 text[] || 'literal' 모호성 버그가 있어 0147 에서 array_append 로 수정됨.

create or replace function public._tracks_require_metadata_for_release()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare v_missing text[] := '{}';
begin
  if NEW.release_status in ('submitted','review_pending','approved','scheduled','released') then
    if NEW.cover_url is null or btrim(NEW.cover_url) = '' then v_missing := v_missing || '앨범 자켓'; end if;
    if NEW.audio_url is null or btrim(NEW.audio_url) = '' then v_missing := v_missing || '음원 파일'; end if;
    if NEW.title is null or btrim(NEW.title) = '' then v_missing := v_missing || '곡명'; end if;
    if NEW.album_name is null or btrim(NEW.album_name) = '' then v_missing := v_missing || '앨범명'; end if;
    if NEW.artist is null or btrim(NEW.artist) = '' then v_missing := v_missing || '아티스트명'; end if;
    if NEW.main_genre is null or btrim(NEW.main_genre) = '' then v_missing := v_missing || '장르'; end if;
    if NEW.release_type is null or btrim(NEW.release_type) = '' then v_missing := v_missing || '발매 유형'; end if;
    if NEW.release_date is null then v_missing := v_missing || '발매일'; end if;
    if NEW.rights_confirmed_at is null then v_missing := v_missing || '유통 동의/권리 확인'; end if;
    if array_length(v_missing, 1) is not null then
      raise exception 'release blocked (status=%): missing %', NEW.release_status, array_to_string(v_missing, ', ')
        using errcode = '23514',
          hint = '필수 정보 누락: ' || array_to_string(v_missing, ', ') || ' — 모두 입력해야 제출/검수/발매가 가능합니다.';
    end if;
  end if;
  return NEW;
end;
$function$;

drop trigger if exists trg_tracks_require_metadata_for_release on public.tracks;
create trigger trg_tracks_require_metadata_for_release
  before insert or update on public.tracks
  for each row execute function public._tracks_require_metadata_for_release();

-- 기존 누락 데이터 보정: 발매 가능 비-released 상태인데 필수값 누락 → changes_requested 로 되돌림.
-- (released 는 immutability 트리거로 직접 상태변경 불가하며, 적용 시점 누락 released 0건.)
update public.tracks set
  release_status = 'changes_requested',
  changes_requested_reason = coalesce(nullif(btrim(changes_requested_reason), ''), '앨범 자켓 등 필수 메타데이터 누락으로 자동 반려 — 보완 후 재제출 필요'),
  admin_review_note = coalesce(nullif(btrim(admin_review_note), ''), '필수값 누락 자동 반려(0146)')
where source_type = 'artist_upload'
  and release_status in ('submitted','review_pending','approved','scheduled')
  and (cover_url is null or btrim(cover_url) = ''
       or main_genre is null or btrim(main_genre) = ''
       or album_name is null or btrim(album_name) = ''
       or release_date is null
       or rights_confirmed_at is null);
