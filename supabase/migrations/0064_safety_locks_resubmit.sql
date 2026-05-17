-- ============================================
-- 0064_safety_locks_resubmit.sql
--
-- P0 안전성 핫픽스:
--   1) admin_mark_settlement_paid 에 advisory lock 추가 (TOCTOU race 차단)
--   2) submit_artist_release 에 중복 가드 (60초 내 동일 artist+audio → 기존 row)
--   3) tracks 컬럼 추가: resubmitted_at, submission_version, changes_requested_reason
--   4) admin_request_track_changes 가 changes_requested_reason 도 set
--
-- 운영 데이터 영향:
--   - artist_settlements 0건 → admin_mark_settlement_paid 변경 무영향
--   - artist_upload 트랙 0건 → submit_artist_release 변경 무영향
--   - 새 컬럼 nullable → 기존 row 영향 0
-- ============================================

-- ----------------------
-- 1) tracks 신규 컬럼 (재제출 audit)
-- ----------------------
alter table public.tracks
  add column if not exists resubmitted_at timestamptz,
  add column if not exists submission_version integer not null default 1,
  add column if not exists changes_requested_reason text;

-- ----------------------
-- 2) submit_artist_release — 60초 중복 가드 + 재제출 시 version 증가
-- ----------------------
create or replace function public.submit_artist_release(
  p_track_id uuid default null,
  p_title text default null, p_artist text default null,
  p_album_name text default null, p_release_title text default null,
  p_release_type text default null, p_release_date date default null,
  p_main_genre text default null, p_sub_genre text default null,
  p_mood text default null, p_suitable_store text default null,
  p_lyrics text default null, p_isrc text default null,
  p_rights_holder_name text default null,
  p_explicit_content boolean default false, p_instrumental boolean default false,
  p_audio_url text default null, p_cover_url text default null,
  p_rights_confirmed boolean default false
)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_track_id uuid;
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
  if p_release_type not in ('single','ep','album') then
    raise exception 'release_type must be single/ep/album';
  end if;
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

  -- 동시 호출 방지 (artist 단위 lock)
  perform pg_advisory_xact_lock(hashtext('release_submit:' || v_uid::text));

  if p_track_id is not null then
    -- 재제출 (draft/changes_requested 만)
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
      cover_url = coalesce(p_cover_url, cover_url),
      rights_confirmed_at = now(), rights_confirmed_by = v_uid,
      release_status = 'submitted', submitted_at = now(),
      resubmitted_at = now(),
      submission_version = submission_version + 1,
      audio_review_status = 'pending', cover_review_status = 'pending', metadata_review_status = 'pending',
      review_started_at = null, admin_review_note = null,
      changes_requested_reason = null
    where id = p_track_id;
    return p_track_id;
  end if;

  -- 신규 INSERT 경로
  if p_audio_url is null then raise exception 'audio_url required for new release'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  if p_album_name is null or length(btrim(p_album_name)) = 0 then raise exception 'album_name required'; end if;

  -- 60초 중복 가드: 같은 아티스트가 동일 audio_url 로 최근 60초 내 INSERT 한 row 가 있으면 그대로 반환
  select id into v_dup_row from public.tracks
  where owner_user_id = v_uid
    and source_type = 'artist_upload'
    and audio_url = p_audio_url
    and created_at >= now() - interval '60 seconds'
  order by created_at desc limit 1;
  if v_dup_row.id is not null then
    return v_dup_row.id;
  end if;

  insert into public.tracks (
    title, artist, album_name, release_title, release_type, release_date,
    main_genre, sub_genre, mood, suitable_store, lyrics,
    isrc, rights_holder_name, rights_confirmed_at, rights_confirmed_by,
    explicit_content, instrumental, audio_url, cover_url,
    owner_user_id, artist_profile_id, payout_account_id,
    uploaded_by_account_type, source_type,
    release_status, submitted_at, submission_version,
    audio_review_status, cover_review_status, metadata_review_status
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
    p_audio_url, p_cover_url,
    v_uid, v_profile_id, v_payout_id,
    'artist', 'artist_upload',
    'submitted', now(), 1,
    'pending', 'pending', 'pending'
  ) returning id into v_track_id;
  return v_track_id;
end;
$$;

grant execute on function public.submit_artist_release(
  uuid, text, text, text, text, text, date, text, text, text, text, text, text, text,
  boolean, boolean, text, text, boolean
) to authenticated;

-- ----------------------
-- 3) admin_request_track_changes — changes_requested_reason 분리 저장
-- ----------------------
create or replace function public.admin_request_track_changes(
  p_track_id uuid, p_note text, p_target text default 'all'
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_track record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then raise exception 'admin only'; end if;
  if p_note is null or length(btrim(p_note)) = 0 then raise exception 'reason required'; end if;
  if p_target not in ('audio','cover','metadata','all') then raise exception 'p_target must be audio/cover/metadata/all'; end if;
  select id, release_status, source_type into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','approved','scheduled') then
    raise exception 'cannot request changes in release_status=%', v_track.release_status;
  end if;
  update public.tracks set
    release_status = 'changes_requested',
    admin_review_note = btrim(p_note),
    changes_requested_reason = btrim(p_note),
    audio_review_status = case when p_target in ('audio','all') then 'rejected' else audio_review_status end,
    cover_review_status = case when p_target in ('cover','all') then 'rejected' else cover_review_status end,
    metadata_review_status = case when p_target in ('metadata','all') then 'rejected' else metadata_review_status end,
    reviewed_at = now(), reviewed_by = v_uid
  where id = p_track_id;
  return jsonb_build_object('ok', true, 'track_id', p_track_id, 'status', 'changes_requested', 'target', p_target);
end;
$$;
grant execute on function public.admin_request_track_changes(uuid, text, text) to authenticated;

-- ----------------------
-- 4) admin_mark_settlement_paid — TOCTOU lock 추가
-- ----------------------
create or replace function public.admin_mark_settlement_paid(p_settlement_id uuid, p_payout_memo text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_sett record;
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then raise exception 'admin only'; end if;

  -- TOCTOU 차단: settlement_id 단위 lock + row lock
  perform pg_advisory_xact_lock(hashtext('settlement_paid:' || p_settlement_id::text));

  select * into v_sett from public.artist_settlements where id = p_settlement_id for update;
  if v_sett.id is null then raise exception 'settlement not found'; end if;
  if v_sett.status = 'paid' then
    return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'status', 'paid', 'already_paid', true);
  end if;
  if v_sett.status <> 'payable' then raise exception 'can only mark payable settlements as paid (current=%)', v_sett.status; end if;
  if v_sett.final_payout_amount <= 0 then raise exception 'cannot mark as paid: final_payout_amount=0'; end if;

  update public.artist_settlements set
    status = 'paid', paid_at = now(), paid_by = v_uid,
    payout_memo = nullif(btrim(coalesce(p_payout_memo, '')), '')
  where id = p_settlement_id;
  return jsonb_build_object('ok', true, 'settlement_id', p_settlement_id, 'status', 'paid');
end;
$$;
grant execute on function public.admin_mark_settlement_paid(uuid, text) to authenticated;
