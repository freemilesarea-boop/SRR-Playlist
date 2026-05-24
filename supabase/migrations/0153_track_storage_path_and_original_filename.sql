-- 0153 — storage_path / original_filename / cover_storage_path 분리 저장
-- 사용자 제목(title)은 한국어 가능, 원본 파일명(original_filename)은 표시/기록용으로 DB 저장,
-- 실제 storage key(storage_path)는 항상 ASCII-safe UUID 기반. (한국어 절대 금지)

alter table public.tracks add column if not exists original_filename text;
alter table public.tracks add column if not exists storage_path text;
alter table public.tracks add column if not exists cover_storage_path text;

comment on column public.tracks.original_filename is '사용자가 업로드한 원본 파일명(표시용). storage key 로는 절대 사용하지 않음.';
comment on column public.tracks.storage_path is 'audio 버킷 내 실제 object key (ASCII-safe UUID 기반).';
comment on column public.tracks.cover_storage_path is 'covers 버킷 내 실제 object key (ASCII-safe UUID 기반).';

-- 기존 20-param 시그니처 제거 후 23-param 으로 재생성 (params 추가 → overload 충돌 방지).
drop function if exists public.submit_artist_release(uuid,text,text,text,text,text,date,text,text,text,text,text,text,text,boolean,boolean,text,text,boolean,text);

create or replace function public.submit_artist_release(
  p_track_id uuid default null,
  p_title text default null,
  p_artist text default null,
  p_album_name text default null,
  p_release_title text default null,
  p_release_type text default null,
  p_release_date date default null,
  p_main_genre text default null,
  p_sub_genre text default null,
  p_mood text default null,
  p_suitable_store text default null,
  p_lyrics text default null,
  p_isrc text default null,
  p_rights_holder_name text default null,
  p_explicit_content boolean default false,
  p_instrumental boolean default false,
  p_audio_url text default null,
  p_cover_url text default null,
  p_rights_confirmed boolean default false,
  p_audio_sha256 text default null,
  p_original_filename text default null,
  p_storage_path text default null,
  p_cover_storage_path text default null
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid(); v_track_id uuid;
  v_profile_id uuid; v_payout_id uuid;
  v_artist_name text; v_real_name text;
  v_min_date date := (current_date + interval '3 days')::date;
  v_dup_row record;
  v_sha text;
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

  v_sha := nullif(btrim(p_audio_sha256), '');

  if p_track_id is not null then
    if not exists (
      select 1 from public.tracks where id = p_track_id and owner_user_id = v_uid
        and release_status in ('draft','changes_requested')
    ) then raise exception 'cannot resubmit track in current status'; end if;

    if coalesce(nullif(btrim(p_cover_url), ''), (select cover_url from public.tracks t2 where t2.id = p_track_id)) is null then
      raise exception 'cover_url required' using hint = '앨범 자켓 이미지를 등록해야 검수 제출이 가능합니다.';
    end if;
    if coalesce(nullif(btrim(p_main_genre), ''), (select main_genre from public.tracks t2 where t2.id = p_track_id)) is null then
      raise exception 'main_genre required' using hint = '장르를 선택해야 검수 제출이 가능합니다.';
    end if;

    if v_sha is not null then
      select id, owner_user_id, track_code into v_dup_row
      from public.tracks
      where audio_sha256 = v_sha
        and source_type = 'artist_upload'
        and id <> p_track_id
        and release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
      limit 1;
      if v_dup_row.id is not null then
        raise exception 'duplicate audio (sha256 already used by another track %)', v_dup_row.track_code
          using hint = '동일한 음원이 이미 등록되어 있습니다. 다른 파일을 업로드하거나 운영팀에 문의해주세요.';
      end if;
    end if;

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
      audio_sha256 = coalesce(v_sha, audio_sha256),
      cover_url = coalesce(p_cover_url, cover_url),
      original_filename = coalesce(nullif(btrim(p_original_filename), ''), original_filename),
      storage_path = coalesce(nullif(btrim(p_storage_path), ''), storage_path),
      cover_storage_path = coalesce(nullif(btrim(p_cover_storage_path), ''), cover_storage_path),
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
  if p_cover_url is null or length(btrim(p_cover_url)) = 0 then
    raise exception 'cover_url required' using hint = '앨범 자켓 이미지를 등록해야 발매 제출이 가능합니다.';
  end if;
  if p_main_genre is null or length(btrim(p_main_genre)) = 0 then
    raise exception 'main_genre required' using hint = '장르를 선택해야 발매 제출이 가능합니다.';
  end if;

  if v_sha is not null then
    select id into v_dup_row from public.tracks
    where owner_user_id = v_uid and source_type = 'artist_upload' and audio_sha256 = v_sha limit 1;
    if v_dup_row.id is not null then return v_dup_row.id; end if;

    select id, owner_user_id, track_code into v_dup_row
    from public.tracks
    where audio_sha256 = v_sha
      and source_type = 'artist_upload'
      and release_status in ('submitted','review_pending','changes_requested','approved','scheduled','released')
    limit 1;
    if v_dup_row.id is not null then
      raise exception 'duplicate audio (sha256 already used by another track %)', v_dup_row.track_code
        using hint = '동일한 음원이 이미 등록되어 있습니다. 다른 파일을 업로드하거나 운영팀에 문의해주세요.';
    end if;
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
    original_filename, storage_path, cover_storage_path,
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
    p_audio_url, v_sha, p_cover_url,
    nullif(btrim(p_original_filename), ''), nullif(btrim(p_storage_path), ''), nullif(btrim(p_cover_storage_path), ''),
    v_uid, v_profile_id, v_payout_id,
    'artist', 'artist_upload',
    'submitted', now(), 1,
    'pending', 'pending', 'pending',
    'pending_review', null, null
  ) returning id into v_track_id;
  return v_track_id;
end;
$function$;
