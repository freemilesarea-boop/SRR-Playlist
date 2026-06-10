-- 0335 — 관리자 '발매곡 검수 회수' (admin_recall_released_track).
--
-- 배경: 음압 기준 강화(0334) 이전에 발매된 음압 미달 곡을 검수로 되돌려 직접 재검수하기 위함.
-- 제약: released 트랙은 _tracks_release_protect 가드상 removed 로만 전이 가능(발매곡 불변 원칙).
-- 방식: GUC(app.allow_release_recall='on') 로 게이트된 released → review_pending 전이만 예외 허용.
--   - 일반 경로는 그대로 차단 — GUC 가 켜진 RPC 안에서만 회수 가능(안전 가드 유지).
--   - 회수 시 차트/플레이리스트에서 빠지도록 visibility 동기화(트리거) + playlist_tracks 링크 삭제.
--   - released→review_pending 은 이메일 트리거 분기에 안 걸려 아티스트 알림 없음(조용한 회수).
-- additive: 트리거 함수 1개 CREATE OR REPLACE + RPC 1개 신규. 데이터 UPDATE 없음.

-- 1) 발매곡 불변 가드 — GUC 게이트된 검수 회수(review_pending) 1건만 예외 추가.
create or replace function public._tracks_release_protect()
returns trigger language plpgsql set search_path to 'public'
as $function$
declare
  v_allow_audio  boolean := coalesce(current_setting('app.allow_audio_reencode', true) = 'on', false);
  v_allow_recall boolean := coalesce(current_setting('app.allow_release_recall', true) = 'on', false);
begin
  if OLD.release_status = 'released' then
    -- 0335: 관리자 검수 회수 — GUC 가 켜진 경우에 한해 released → review_pending 허용.
    if v_allow_recall and NEW.release_status = 'review_pending' then
      return NEW;
    end if;
    -- 허용 전이: released 유지 또는 removed(공개중단). 그 외 상태 변경 금지.
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

-- 2) 관리자 회수 RPC — released → review_pending + 플레이리스트 링크 삭제 + 재검수 플래그.
create or replace function public.admin_recall_released_track(p_track_id uuid, p_note text)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_track record; v_removed int;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin only';
  end if;
  if p_note is null or length(btrim(p_note)) < 3 then raise exception 'reason required (>=3 chars)'; end if;
  select id, release_status, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status <> 'released' then
    raise exception 'only released tracks can be recalled (status=%)', v_track.release_status;
  end if;

  -- 발매곡 불변 가드를 이 트랜잭션 한정으로 해제(회수 전용).
  perform set_config('app.allow_release_recall', 'on', true);

  update public.tracks set
    release_status = 'review_pending',
    review_started_at = now(),
    reviewed_at = null,
    reviewed_by = v_uid,
    admin_review_note = btrim(p_note)
  where id = p_track_id;

  -- 차트는 visibility 동기화(트리거)로 자동 제외. 플레이리스트는 링크를 직접 삭제.
  delete from public.playlist_tracks where track_id = p_track_id;
  get diagnostics v_removed = row_count;

  -- 검수 큐 가시성 — 품질 재검수 플래그.
  insert into public.track_rereview_flags(track_id, flag_type, reason, status)
  values (p_track_id, 'quality_review_required', btrim(p_note), 'open')
  on conflict (track_id, flag_type)
    do update set status = 'open', reason = excluded.reason, resolved_at = null, resolved_by = null;

  return jsonb_build_object('ok', true, 'track_id', p_track_id,
    'status', 'review_pending', 'playlist_links_removed', v_removed);
end;
$function$;
grant execute on function public.admin_recall_released_track(uuid, text) to authenticated;
