-- 0151 — [400 수정] audio_health_status CHECK 제약에 'conversion_failed' 추가.
--   0150 의 admin_mark_audio_conversion_failed 가 'conversion_failed' 로 set 하는데 기존 CHECK 가
--   (unknown/ok/unreachable/wrong_mime/empty/error) 만 허용 → 23514 check_violation → PostgREST 400.
--   허용값을 넓히는 additive 변경(기존 행은 모두 unknown/ok 이라 위반 없음).
alter table public.tracks drop constraint if exists tracks_audio_health_status_check;
alter table public.tracks add constraint tracks_audio_health_status_check
  check (audio_health_status = any (array['unknown','ok','unreachable','wrong_mime','empty','error','conversion_failed']));
