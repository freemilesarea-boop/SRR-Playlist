-- 0139 — 검수 거절 = 즉시 removed 처리(삭제 음원 탭으로 이동) + 승인 시 필수 메타/자켓 게이트.
--   reject → release_status='removed' (트리거가 visibility_status='hidden' 동기화) + removed_at/by/reason + is_recommendable=false.
--   bulk reject 는 admin_reject_artist_release 를 호출하므로 자동 반영.
--   approve → 앨범 자켓/장르/제목/앨범명/발매일 누락 시 발매(승인) 불가.

create or replace function public.admin_reject_artist_release(p_track_id uuid, p_note text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then raise exception 'admin only'; end if;
  if p_note is null or length(btrim(p_note)) = 0 then raise exception 'reject reason required'; end if;
  select id, release_status, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status in ('released','paid') then raise exception 'cannot reject in release_status=% (use takedown)', v_track.release_status; end if;
  -- 거절 = 즉시 서비스 미노출(removed). 트리거가 visibility_status='hidden' 동기화.
  update public.tracks set
    release_status = 'removed',
    is_recommendable = false,
    removed_at = now(), removed_by = v_uid,
    removed_reason = btrim(p_note),
    rejected_reason = btrim(p_note),
    admin_review_note = btrim(p_note),
    reviewed_at = now(), reviewed_by = v_uid
  where id = p_track_id;
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'removed');
end;
$function$;

create or replace function public.admin_approve_artist_release(p_track_id uuid, p_immediate_release boolean DEFAULT NULL::boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_track record;
  v_artist record; v_contract_signed boolean; v_payout_verified boolean;
  v_immediate boolean; v_default jsonb; v_new_status text;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  select t.id, t.release_status, t.release_date, t.source_type, t.owner_user_id,
         t.cover_url, t.main_genre, t.title, t.album_name
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','review_pending','changes_requested') then
    raise exception 'cannot approve in release_status=%', v_track.release_status;
  end if;
  if v_track.release_date is null then raise exception 'release_date missing'; end if;
  -- 필수 메타데이터/앨범 자켓 게이트 — 누락 시 발매 불가
  if v_track.cover_url is null or length(btrim(v_track.cover_url)) = 0 then
    raise exception 'cannot approve: album cover required'
      using hint = '앨범 자켓이 없으면 승인(발매)할 수 없습니다. 아티스트에게 수정 요청하세요.';
  end if;
  if v_track.main_genre is null or length(btrim(v_track.main_genre)) = 0 then
    raise exception 'cannot approve: genre(main_genre) required'
      using hint = '장르가 없으면 승인(발매)할 수 없습니다.';
  end if;
  if v_track.title is null or length(btrim(v_track.title)) = 0
     or v_track.album_name is null or length(btrim(v_track.album_name)) = 0 then
    raise exception 'cannot approve: title/album required';
  end if;
  select u.artist_approval_status, u.contract_status, u.membership_tier
    into v_artist from public.users u where u.id = v_track.owner_user_id;
  if coalesce(v_artist.artist_approval_status,'pending') <> 'approved' then
    raise exception 'artist not approved at approval time (status=%)', v_artist.artist_approval_status;
  end if;
  select exists (select 1 from public.artist_contracts c
    where c.artist_user_id = v_track.owner_user_id and c.status='signed') into v_contract_signed;
  if not v_contract_signed then raise exception 'no signed contract at approval time'; end if;
  select exists (select 1 from public.artist_payout_accounts pa
    where pa.user_id = v_track.owner_user_id and pa.verification_status='verified') into v_payout_verified;
  if not v_payout_verified then raise exception 'payout account not verified at approval time'; end if;

  if p_immediate_release is not null then v_immediate := p_immediate_release;
  else
    select value into v_default from public.admin_settings where key='default_immediate_release';
    v_immediate := coalesce((v_default)::text::boolean, true);
  end if;
  if v_track.release_date <= current_date then v_immediate := true; end if;
  v_new_status := case when v_immediate then 'released' else 'scheduled' end;

  update public.tracks set
    release_status = v_new_status,
    audio_review_status = 'approved', cover_review_status = 'approved', metadata_review_status = 'approved',
    approved_at = now(),
    scheduled_at = case when v_new_status='scheduled' then now() else null end,
    released_at = case when v_new_status='released' then now() else null end,
    reviewed_at = now(), reviewed_by = v_uid,
    admin_review_note = null, rejected_reason = null
  where id = p_track_id;

  return jsonb_build_object(
    'ok', true, 'track_id', p_track_id, 'status', v_new_status,
    'immediate_release', v_immediate, 'release_date', v_track.release_date
  );
exception when others then
  insert into public.release_failures (track_id, kind, error_code, error_message, context)
  values (p_track_id, 'approve', SQLSTATE, SQLERRM,
          jsonb_build_object('immediate_request', p_immediate_release, 'actor', v_uid));
  raise;
end; $function$;
