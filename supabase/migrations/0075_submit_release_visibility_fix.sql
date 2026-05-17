-- 0075 — 아티스트 업로드 직후 "승인됨" 자동 표시 버그 수정
--
-- 원인:
-- · tracks.visibility_status DEFAULT 'approved' (admin_upload 용으로 설정됨)
-- · submit_artist_release INSERT 시 visibility_status 미지정 → 'approved' 박힘
-- · list_pending_review_tracks 가 visibility_status='pending_review' 만 봄 → 검수 탭 0건
-- · 관리자 UI 가 visibility_status 라벨 표시 → "승인됨" 으로 잘못 표시
--
-- 픽스:
-- 1) submit_artist_release: INSERT/UPDATE 모두 visibility_status='pending_review' 명시,
--    approved_at/released_at = null 도 명시
-- 2) list_pending_review_tracks: release_status 도 추가 반환 + release_status in (submitted,
--    changes_requested) 도 매칭. 단, 이미 처리된 (approved/scheduled/released/rejected/removed)
--    상태는 제외
-- 3) 0074 _log_track_moderation_event trigger: visibility-only 전이 시
--    visibility='pending_review' 매핑 추가 (action='review_started'). unmapped 면 skip
-- 4) BEFORE INSERT trigger 신규: artist_upload 면 release_status 에 맞게 visibility 자동 동기
--    — RPC 가 실수로 누락해도 안전망
-- 5) 기존 잘못 박힌 데이터 복구 — artist_upload + release_status in
--    (submitted/changes_requested/draft) + visibility_status='approved' 인 행을
--    visibility_status='pending_review' 로 재설정

DROP FUNCTION IF EXISTS public.list_pending_review_tracks(integer);

CREATE OR REPLACE FUNCTION public._log_track_moderation_event()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v_action text; v_actor uuid := auth.uid();
begin
  if TG_OP = 'INSERT' then
    insert into public.track_moderation_events
      (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
    values (NEW.id, v_actor, 'upload_created', null, NEW.release_status, null, NEW.visibility_status,
            coalesce(NEW.admin_review_note, NEW.changes_requested_reason, null));
    return NEW;
  end if;
  if TG_OP = 'UPDATE' then
    if OLD.release_status is distinct from NEW.release_status then
      v_action := case NEW.release_status
        when 'submitted' then 'submitted' when 'changes_requested' then 'revision_requested'
        when 'approved' then 'approved' when 'scheduled' then 'scheduled'
        when 'released' then 'released_now' when 'rejected' then 'rejected'
        when 'removed' then 'removed' else null end;
      if OLD.release_status in ('removed','rejected') and NEW.release_status in ('draft','submitted','approved','scheduled','released') then
        v_action := 'restored';
      end if;
      if v_action is null then return NEW; end if;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
              coalesce(NEW.changes_requested_reason, NEW.admin_review_note, NEW.rejected_reason, NEW.removed_reason));
    elsif OLD.visibility_status is distinct from NEW.visibility_status then
      v_action := case NEW.visibility_status
        when 'hidden' then 'hidden' when 'approved' then 'unhidden'
        when 'pending_review' then 'review_started' when 'rejected' then 'rejected'
        else null end;
      if v_action is null then return NEW; end if;
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, v_action, OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status,
              coalesce(NEW.admin_review_note, NEW.rejected_reason));
    elsif OLD.review_started_at is null and NEW.review_started_at is not null then
      insert into public.track_moderation_events
        (track_id, actor_user_id, action, from_release_status, to_release_status, from_visibility_status, to_visibility_status, note)
      values (NEW.id, v_actor, 'review_started', OLD.release_status, NEW.release_status, OLD.visibility_status, NEW.visibility_status, null);
    end if;
  end if;
  return NEW;
end; $function$;

CREATE OR REPLACE FUNCTION public.submit_artist_release(
  p_track_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text,
  p_artist text DEFAULT NULL::text, p_album_name text DEFAULT NULL::text,
  p_release_title text DEFAULT NULL::text, p_release_type text DEFAULT NULL::text,
  p_release_date date DEFAULT NULL::date, p_main_genre text DEFAULT NULL::text,
  p_sub_genre text DEFAULT NULL::text, p_mood text DEFAULT NULL::text,
  p_suitable_store text DEFAULT NULL::text, p_lyrics text DEFAULT NULL::text,
  p_isrc text DEFAULT NULL::text, p_rights_holder_name text DEFAULT NULL::text,
  p_explicit_content boolean DEFAULT false, p_instrumental boolean DEFAULT false,
  p_audio_url text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text,
  p_rights_confirmed boolean DEFAULT false, p_audio_sha256 text DEFAULT NULL::text
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_track_id uuid;
  v_profile_id uuid; v_payout_id uuid;
  v_artist_name text; v_real_name text;
  v_min_date date := (current_date + interval '3 days')::date;
  v_dup_row record;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if not p_rights_confirmed then raise exception 'rights confirmation required'; end if;
  if p_release_date is null then raise exception 'release_date required'; end if;
  if p_release_date < v_min_date then
    raise exception 'release_date must be at least % (today + 3 days)', v_min_date
      using hint = '검수 및 출시 준비를 위해 발매일은 최소 3일 뒤부터 선택할 수 있습니다.';
  end if;
  if p_release_type not in ('single','ep','album') then raise exception 'release_type must be single/ep/album'; end if;
  if not exists (
    select 1 from public.users u where u.id = v_uid
      and u.account_type = 'artist' and u.artist_approval_status = 'approved'
      and u.membership_tier = 'individual' and u.contract_status = 'signed'
  ) then raise exception 'artist not eligible (approval/payment/contract)'; end if;
  select id into v_payout_id from public.artist_payout_accounts
  where user_id = v_uid and verification_status = 'verified';
  if v_payout_id is null then raise exception 'verified payout account required'; end if;
  select id, artist_name, real_name into v_profile_id, v_artist_name, v_real_name
  from public.artist_profiles where user_id = v_uid;
  if v_profile_id is null then raise exception 'artist profile not found'; end if;

  perform pg_advisory_xact_lock(hashtext('release_submit:' || v_uid::text));

  if p_track_id is not null then
    if not exists (
      select 1 from public.tracks where id = p_track_id and owner_user_id = v_uid
        and release_status in ('draft','changes_requested')
    ) then raise exception 'cannot resubmit track in current status'; end if;
    update public.tracks set
      title = coalesce(nullif(btrim(p_title), ''), title),
      artist = coalesce(nullif(btrim(p_artist), ''), artist, v_artist_name),
      album_name = coalesce(nullif(btrim(p_album_name), ''), album_name),
      release_title = coalesce(nullif(btrim(p_release_title), ''), release_title),
      release_type = coalesce(p_release_type, release_type),
      release_date = coalesce(p_release_date, release_date),
      main_genre = coalesce(nullif(btrim(p_main_genre), ''), main_genre),
      sub_genre = coalesce(nullif(btrim(p_sub_genre), ''), sub_genre),
      mood = coalesce(nullif(btrim(p_mood), ''), mood),
      suitable_store = coalesce(nullif(btrim(p_suitable_store), ''), suitable_store),
      lyrics = coalesce(nullif(btrim(p_lyrics), ''), lyrics),
      isrc = coalesce(nullif(btrim(p_isrc), ''), isrc),
      rights_holder_name = coalesce(nullif(btrim(p_rights_holder_name), ''), rights_holder_name, v_real_name, v_artist_name),
      explicit_content = coalesce(p_explicit_content, explicit_content),
      instrumental = coalesce(p_instrumental, instrumental),
      audio_url = coalesce(p_audio_url, audio_url),
      audio_sha256 = coalesce(nullif(btrim(p_audio_sha256), ''), audio_sha256),
      cover_url = coalesce(p_cover_url, cover_url),
      rights_confirmed_at = now(), rights_confirmed_by = v_uid,
      release_status = 'submitted', submitted_at = now(), resubmitted_at = now(),
      submission_version = submission_version + 1,
      audio_review_status = 'pending', cover_review_status = 'pending', metadata_review_status = 'pending',
      review_started_at = null, admin_review_note = null, changes_requested_reason = null,
      visibility_status = 'pending_review', approved_at = null, released_at = null
    where id = p_track_id;
    return p_track_id;
  end if;

  if p_audio_url is null then raise exception 'audio_url required for new release'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  if p_album_name is null or length(btrim(p_album_name)) = 0 then raise exception 'album_name required'; end if;

  if p_audio_sha256 is not null and length(btrim(p_audio_sha256)) > 0 then
    select id into v_dup_row from public.tracks
    where owner_user_id = v_uid and source_type = 'artist_upload' and audio_sha256 = btrim(p_audio_sha256) limit 1;
    if v_dup_row.id is not null then return v_dup_row.id; end if;
  end if;

  select id into v_dup_row from public.tracks
  where owner_user_id = v_uid and source_type = 'artist_upload'
    and audio_url = p_audio_url and created_at >= now() - interval '60 seconds'
  order by created_at desc limit 1;
  if v_dup_row.id is not null then return v_dup_row.id; end if;

  insert into public.tracks (
    title, artist, album_name, release_title, release_type, release_date,
    main_genre, sub_genre, mood, suitable_store, lyrics,
    isrc, rights_holder_name, rights_confirmed_at, rights_confirmed_by,
    explicit_content, instrumental, audio_url, audio_sha256, cover_url,
    owner_user_id, artist_profile_id, payout_account_id,
    uploaded_by_account_type, source_type,
    release_status, submitted_at, submission_version,
    audio_review_status, cover_review_status, metadata_review_status,
    visibility_status, approved_at, released_at
  ) values (
    btrim(p_title), coalesce(nullif(btrim(p_artist), ''), v_artist_name),
    btrim(p_album_name), nullif(btrim(p_release_title), ''),
    p_release_type, p_release_date,
    nullif(btrim(p_main_genre), ''), nullif(btrim(p_sub_genre), ''),
    nullif(btrim(p_mood), ''), nullif(btrim(p_suitable_store), ''),
    nullif(btrim(p_lyrics), ''), nullif(btrim(p_isrc), ''),
    coalesce(nullif(btrim(p_rights_holder_name), ''), v_real_name, v_artist_name),
    now(), v_uid,
    coalesce(p_explicit_content, false), coalesce(p_instrumental, false),
    p_audio_url, nullif(btrim(p_audio_sha256), ''), p_cover_url,
    v_uid, v_profile_id, v_payout_id,
    'artist', 'artist_upload',
    'submitted', now(), 1,
    'pending', 'pending', 'pending',
    'pending_review', null, null
  ) returning id into v_track_id;
  return v_track_id;
end; $function$;
GRANT EXECUTE ON FUNCTION public.submit_artist_release(uuid, text, text, text, text, text, date, text, text, text, text, text, text, text, boolean, boolean, text, text, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_pending_review_tracks(p_limit integer DEFAULT 50)
RETURNS TABLE(
  track_id uuid, track_code text, title text, artist text, artist_name text,
  album_name text, release_title text, isrc text, rights_holder_name text,
  rights_confirmed_at timestamp with time zone, main_genre text, sub_genre text,
  mood text, suitable_store text, lyrics text, audio_url text, cover_url text,
  payout_verification_status text, payout_bank_name text, admin_note text,
  created_at timestamp with time zone,
  release_status text, release_date date, submitted_at timestamp with time zone,
  review_started_at timestamp with time zone, changes_requested_reason text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  select
    t.id, t.track_code, t.title, t.artist, ap.artist_name,
    t.album_name, t.release_title, t.isrc, t.rights_holder_name, t.rights_confirmed_at,
    t.main_genre, t.sub_genre, t.mood, t.suitable_store, t.lyrics,
    t.audio_url, t.cover_url,
    pa.verification_status, pa.bank_name,
    t.admin_note, t.created_at,
    t.release_status, t.release_date, t.submitted_at,
    t.review_started_at, t.changes_requested_reason
  from public.tracks t
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.source_type = 'artist_upload'
    and (
      t.visibility_status = 'pending_review'
      or t.release_status in ('submitted','changes_requested')
    )
    and t.release_status not in ('removed','rejected','released','approved','scheduled')
  order by t.created_at desc
  limit greatest(1, p_limit);
end; $function$;
GRANT EXECUTE ON FUNCTION public.list_pending_review_tracks(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public._sync_artist_upload_visibility_on_insert()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public'
AS $function$
begin
  if NEW.source_type = 'artist_upload' then
    NEW.visibility_status := case NEW.release_status
      when 'draft' then 'pending_review' when 'submitted' then 'pending_review'
      when 'changes_requested' then 'pending_review' when 'approved' then 'pending_review'
      when 'scheduled' then 'pending_review' when 'released' then 'approved'
      when 'rejected' then 'rejected' when 'removed' then 'hidden'
      else NEW.visibility_status end;
  end if;
  return NEW;
end; $function$;

DROP TRIGGER IF EXISTS trg_artist_upload_visibility_insert ON public.tracks;
CREATE TRIGGER trg_artist_upload_visibility_insert
  BEFORE INSERT ON public.tracks
  FOR EACH ROW EXECUTE FUNCTION public._sync_artist_upload_visibility_on_insert();

-- 데이터 복구 — 기존 artist_upload 중 잘못 박힌 visibility 정상화
UPDATE public.tracks
SET visibility_status = 'pending_review'
WHERE source_type = 'artist_upload'
  AND release_status IN ('submitted','changes_requested','draft')
  AND visibility_status = 'approved';

NOTIFY pgrst, 'reload schema';
