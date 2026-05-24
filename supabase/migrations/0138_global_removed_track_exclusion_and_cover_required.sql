-- 0138 — 전역 미노출 강화 + 앨범 자켓/장르 필수 검증 (additive: CREATE OR REPLACE / ALTER POLICY).
--   공개 사용자-facing 트랙 노출 기준 통일:
--     visibility_status='approved' AND (release_status='released' OR source_type='admin_upload')
--     AND removed_at IS NULL AND audio_url(비어있지 않음) AND cover_url(비어있지 않음).
--   removed/hidden/rejected/pending_review 트랙은 visibility_status<>'approved' 또는 removed_at 으로 전부 제외.
--   SECURITY DEFINER RPC 는 RLS 를 우회하므로 함수 내부에도 동일 필터를 명시.

-- ============================================================
-- 1) RLS: 직접 PostgREST 쿼리(플레이리스트/아티스트/앨범 상세, 좋아요, 최근재생, 직접 URL) 전역 가드
--    removed_at + cover_url 조건 추가 (기존 visibility/release/audio 유지).
-- ============================================================
drop policy if exists tracks_public_select on public.tracks;
create policy tracks_public_select on public.tracks for select using (
  visibility_status = 'approved'
  and (release_status = 'released' or source_type = 'admin_upload')
  and removed_at is null
  and audio_url is not null and length(btrim(audio_url)) > 0
  and cover_url is not null and length(btrim(cover_url)) > 0
);

-- ============================================================
-- 2) submit_artist_release — 앨범 자켓(cover_url) + 장르(main_genre) 필수 검증 (신규/재제출 양쪽).
-- ============================================================
create or replace function public.submit_artist_release(p_track_id uuid DEFAULT NULL::uuid, p_title text DEFAULT NULL::text, p_artist text DEFAULT NULL::text, p_album_name text DEFAULT NULL::text, p_release_title text DEFAULT NULL::text, p_release_type text DEFAULT NULL::text, p_release_date date DEFAULT NULL::date, p_main_genre text DEFAULT NULL::text, p_sub_genre text DEFAULT NULL::text, p_mood text DEFAULT NULL::text, p_suitable_store text DEFAULT NULL::text, p_lyrics text DEFAULT NULL::text, p_isrc text DEFAULT NULL::text, p_rights_holder_name text DEFAULT NULL::text, p_explicit_content boolean DEFAULT false, p_instrumental boolean DEFAULT false, p_audio_url text DEFAULT NULL::text, p_cover_url text DEFAULT NULL::text, p_rights_confirmed boolean DEFAULT false, p_audio_sha256 text DEFAULT NULL::text)
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

    -- 필수값: 앨범 자켓 + 장르 (재제출 후 최종값 기준)
    if coalesce(nullif(btrim(p_cover_url), ''), (select cover_url from public.tracks t2 where t2.id = p_track_id)) is null then
      raise exception 'cover_url required' using hint = '앨범 자켓 이미지를 등록해야 검수 제출이 가능합니다.';
    end if;
    if coalesce(nullif(btrim(p_main_genre), ''), (select main_genre from public.tracks t2 where t2.id = p_track_id)) is null then
      raise exception 'main_genre required' using hint = '장르를 선택해야 검수 제출이 가능합니다.';
    end if;

    -- cross-owner sha 충돌 검사 (재제출 시에도, 본인 트랙은 제외)
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
  -- 필수값: 앨범 자켓 + 장르
  if p_cover_url is null or length(btrim(p_cover_url)) = 0 then
    raise exception 'cover_url required' using hint = '앨범 자켓 이미지를 등록해야 발매 제출이 가능합니다.';
  end if;
  if p_main_genre is null or length(btrim(p_main_genre)) = 0 then
    raise exception 'main_genre required' using hint = '장르를 선택해야 발매 제출이 가능합니다.';
  end if;

  -- A) cross-owner sha 충돌 검사 (신규 업로드)
  if v_sha is not null then
    -- 자기 자신 dup → 기존 row 반환 (멱등성)
    select id into v_dup_row from public.tracks
    where owner_user_id = v_uid and source_type = 'artist_upload' and audio_sha256 = v_sha limit 1;
    if v_dup_row.id is not null then return v_dup_row.id; end if;

    -- 타인 dup → reject
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
    v_uid, v_profile_id, v_payout_id,
    'artist', 'artist_upload',
    'submitted', now(), 1,
    'pending', 'pending', 'pending',
    'pending_review', null, null
  ) returning id into v_track_id;
  return v_track_id;
end;
$function$;

-- ============================================================
-- 3) recommend_tracks_by_context — release/visibility/removed/cover 필터 추가.
-- ============================================================
create or replace function public.recommend_tracks_by_context(p_time_slot text DEFAULT NULL::text, p_situation text DEFAULT NULL::text, p_business_type text DEFAULT NULL::text, p_mood text DEFAULT NULL::text, p_limit integer DEFAULT 20)
 RETURNS TABLE(track_id uuid, title text, artist text, genre text, main_genre text, sub_genre text, mood text, cover_url text, audio_url text, duration integer, score integer, score_reasons text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then 15 else 0 end), 0) +
        coalesce((case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then 20 else 0 end), 0) +
        coalesce((case when p_mood is not null and lower(coalesce(t.mood, '')) = lower(p_mood) then 10 else 0 end), 0) +
        coalesce((case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then 10 else 0 end), 0) +
        coalesce(t.recommendation_priority, 0)
      ) as s,
      array_remove(array[
        case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then format('+15 %s 시간대', p_time_slot) end,
        case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then format('+25 %s 상황', p_situation) end,
        case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then format('+25 %s 업종', p_business_type) end,
        case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then format('+20 %s 무드', p_mood) end,
        case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then '+10 매장 적합 보컬' end,
        case when coalesce(t.recommendation_priority, 0) > 0 then format('+%s 우선순위', t.recommendation_priority) end
      ], null) as reasons
    from public.tracks t
    where coalesce(t.is_recommendable, true) = true
      and t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and coalesce(t.audio_health_status, 'unknown') in ('ok','unknown')
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.sub_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int as score, s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end; $function$;

-- ============================================================
-- 4) recommend_similar_tracks (자동 다음곡) — 동일 필터 추가.
-- ============================================================
create or replace function public.recommend_similar_tracks(p_track_id uuid, p_limit integer DEFAULT 20)
 RETURNS TABLE(track_id uuid, title text, artist text, genre text, main_genre text, mood text, cover_url text, audio_url text, duration integer, score integer, score_reasons text[])
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare src record;
begin
  select * into src from public.tracks where id = p_track_id;
  if src.id is null then return; end if;

  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when t.main_genre is not null and t.main_genre = src.main_genre then 20 else 0 end), 0) +
        coalesce((case when t.sub_genre is not null and t.sub_genre = src.sub_genre then 15 else 0 end), 0) +
        coalesce(
          (case when array_length(t.mood_tags, 1) > 0 and array_length(src.mood_tags, 1) > 0
            then array_length(array(select unnest(t.mood_tags) intersect select unnest(src.mood_tags)), 1) * 7
            else 0 end), 0) +
        coalesce(
          (case when array_length(t.situation_tags, 1) > 0 and array_length(src.situation_tags, 1) > 0
            then array_length(array(select unnest(t.situation_tags) intersect select unnest(src.situation_tags)), 1) * 5
            else 0 end), 0) +
        coalesce(
          (case when t.bpm is not null and src.bpm is not null
            then greatest(0, 10 - abs(t.bpm - src.bpm) / 4)
            else 0 end), 0) +
        coalesce(
          (case when t.energy_level is not null and src.energy_level is not null
            then greatest(0, 10 - abs(t.energy_level - src.energy_level) * 2)
            else 0 end), 0) +
        coalesce(
          (case when t.lyric_type is not null and t.lyric_type = src.lyric_type then 10 else 0 end), 0) +
        coalesce(
          (case when t.brightness_level is not null and src.brightness_level is not null
            then greatest(0, 5 - abs(t.brightness_level - src.brightness_level)) else 0 end), 0) +
        coalesce(
          (case when t.emotional_intensity is not null and src.emotional_intensity is not null
            then greatest(0, 5 - abs(t.emotional_intensity - src.emotional_intensity)) else 0 end), 0)
      ) as s,
      array_remove(array[
        case when t.main_genre = src.main_genre then '+20 같은 메인 장르' end,
        case when t.sub_genre = src.sub_genre then '+15 같은 서브 장르' end,
        case when t.lyric_type = src.lyric_type then '+10 같은 가사 유형' end
      ], null) as reasons
    from public.tracks t
    where t.id <> p_track_id
      and coalesce(t.is_recommendable, true) = true
      and t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and coalesce(t.audio_health_status, 'unknown') in ('ok','unknown')
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int, s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end; $function$;

-- ============================================================
-- 5) get_track_chart — removed/visibility/cover 추가.
-- ============================================================
create or replace function public.get_track_chart(period text DEFAULT 'daily'::text, limit_count integer DEFAULT 100)
 RETURNS TABLE(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, total_listened_seconds bigint, playlist_count bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays, 0), coalesce(a.completes, 0), coalesce(a.listened, 0),
    (select count(*) from public.playlist_tracks pt where pt.track_id = t.id)
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
  order by play_count desc, t.created_at desc
  limit greatest(1, limit_count);
end; $function$;

-- ============================================================
-- 6) get_track_chart_by_genre — removed/visibility/cover 추가.
-- ============================================================
create or replace function public.get_track_chart_by_genre(genre_filter text, period text DEFAULT 'weekly'::text, limit_count integer DEFAULT 50)
 RETURNS TABLE(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, total_listened_seconds bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare since timestamptz := public._chart_period_start(period); g_filter text := nullif(trim(genre_filter), '');
begin
  return query
  with agg as (
    select se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays, 0), coalesce(a.completes, 0), coalesce(a.listened, 0)
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
    and t.visibility_status = 'approved'
    and (t.release_status = 'released' or t.source_type = 'admin_upload')
    and t.removed_at is null
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    and ((g_filter = '기타' and (t.genre is null or trim(t.genre) = ''))
         or (g_filter is not null and t.genre = g_filter) or g_filter is null)
  order by coalesce(a.plays, 0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $function$;

-- ============================================================
-- 7) get_genre_chart — removed/visibility/cover 추가.
-- ============================================================
create or replace function public.get_genre_chart(period text DEFAULT 'weekly'::text)
 RETURNS TABLE(genre text, play_count bigint, track_count bigint, total_listened_seconds bigint)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare since timestamptz := public._chart_period_start(period);
begin
  return query
  with se_agg as (
    select coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened,
      count(distinct t.id) as tracks
    from public.tracks t
    left join public.stream_events se on se.track_id = t.id and se.created_at >= since and se.event_type in ('milestone_30s','complete')
    where t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select g, plays, tracks, listened from se_agg where tracks > 0 order by plays desc, g asc;
end; $function$;

-- ============================================================
-- 8) get_auto_playlist_tracks — `or release_status is null` 누수 제거 + removed/visibility/cover 추가.
-- ============================================================
create or replace function public.get_auto_playlist_tracks(p_playlist_id uuid, p_limit integer DEFAULT 100)
 RETURNS TABLE(id uuid, title text, artist text, genre text, mood text, audio_url text, cover_url text, duration integer, created_at timestamp with time zone, score numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  r jsonb;
  v_business text; v_time_slot text;
  v_moods text[]; v_situations text[];
  v_bpm_min int; v_bpm_max int; v_energy_min int; v_energy_max int;
  v_vocal text; v_fresh_days int; v_max_per_artist int; v_seed text;
  v_has_tag_rule boolean;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  select p.auto_rule into r from public.playlists p where p.id = p_playlist_id and p.is_auto = true;
  if r is null then return; end if;

  v_business     := nullif(r->>'business_category', '');
  v_time_slot    := nullif(r->>'time_slot', '');
  v_moods        := case when r ? 'mood_tags' then array(select jsonb_array_elements_text(r->'mood_tags')) else '{}' end;
  v_situations   := case when r ? 'situation_tags' then array(select jsonb_array_elements_text(r->'situation_tags')) else '{}' end;
  v_bpm_min      := nullif(r->>'bpm_min','')::int;
  v_bpm_max      := nullif(r->>'bpm_max','')::int;
  v_energy_min   := nullif(r->>'energy_min','')::int;
  v_energy_max   := nullif(r->>'energy_max','')::int;
  v_vocal        := nullif(r->>'vocal_type','');
  v_fresh_days   := coalesce(nullif(r->>'freshness_boost_days','')::int, 0);
  v_max_per_artist := nullif(r->>'max_tracks_per_artist','')::int;
  v_seed         := coalesce(r->>'shuffle_seed', p_playlist_id::text);
  v_has_tag_rule := v_business is not null or v_time_slot is not null
                    or array_length(v_moods,1) is not null or array_length(v_situations,1) is not null;

  return query
  with scored as (
    select
      t.id as tid, t.title as ttitle, t.artist as tartist, t.genre as tgenre, t.mood as tmood,
      t.audio_url as taudio, t.cover_url as tcover, t.duration as tduration, t.created_at as tcreated,
      (
        coalesce(case when v_time_slot  is not null and v_time_slot = any(coalesce(t.time_slots,'{}')) then 15 else 0 end,0)
      + coalesce(case when v_business is not null
                      and (v_business = any(coalesce(t.business_tags,'{}')) or t.suitable_store = v_business)
                      then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(v_moods) m
                  where m = any(coalesce(t.mood_tags,'{}')) or coalesce(t.mood,'') ilike '%'||m||'%'),0) * 20
      + coalesce((select count(*) from unnest(v_situations) s where s = any(coalesce(t.situation_tags,'{}'))),0) * 25
      + coalesce(case when v_business is not null and coalesce(t.lyric_type,'') in ('instrumental','soft_vocal') then 10 else 0 end,0)
      + coalesce(case when v_fresh_days > 0 and coalesce(t.released_at, t.created_at) >= now() - make_interval(days => v_fresh_days) then 20 else 0 end,0)
      )::numeric as tscore,
      ('x' || substr(md5(t.id::text || v_seed), 1, 8))::bit(32)::bigint as trot
    from public.tracks t
    where t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      and (v_bpm_min is null or coalesce(t.bpm, 0) >= v_bpm_min)
      and (v_bpm_max is null or coalesce(t.bpm, 9999) <= v_bpm_max)
      and (v_energy_min is null or coalesce(t.energy_level, 0) >= v_energy_min)
      and (v_energy_max is null or coalesce(t.energy_level, 9999) <= v_energy_max)
      and (v_vocal is null or coalesce(t.lyric_type,'') = v_vocal)
  ),
  filtered as (
    select * from scored s where (not v_has_tag_rule) or s.tscore > 0
  ),
  diversified as (
    select f.*,
      row_number() over (
        partition by coalesce(lower(btrim(f.tartist)), f.tid::text)
        order by f.tscore desc, f.trot
      ) as artist_rank
    from filtered f
  )
  select d.tid, d.ttitle, d.tartist, d.tgenre, d.tmood, d.taudio, d.tcover,
         d.tduration, d.tcreated, d.tscore
  from diversified d
  where v_max_per_artist is null or d.artist_rank <= v_max_per_artist
  order by d.tscore desc, d.trot
  limit v_limit;
end;
$function$;

-- ============================================================
-- 9) get_personalized_recommendations — removed/visibility/cover 추가 (cold + personalized cand).
-- ============================================================
create or replace function public.get_personalized_recommendations(p_limit integer DEFAULT 12)
 RETURNS TABLE(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, score numeric, reason text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_total numeric := 0; v_mg numeric; v_mm numeric; v_ma numeric;
begin
  if v_uid is not null then
    perform public.refresh_user_music_preferences(v_uid);
    select coalesce(sum(p.score),0) into v_total from public.user_music_preferences p where p.user_id=v_uid;
  end if;

  if v_uid is null or v_total < 5 then
    return query
    with cand as (
      select t.*, coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop
      from public.tracks t
      where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
        and t.removed_at is null and coalesce(t.is_recommendable,true)=true
        and t.audio_url is not null and length(btrim(t.audio_url))>0
        and t.cover_url is not null and length(btrim(t.cover_url))>0
    ), ranked as (
      select c.*, row_number() over (partition by c.owner_user_id order by c.created_at desc) rn from cand c
    )
    select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre),''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
           round((0.5*(case when r.created_at>now()-interval '21 days' then 1 else 0.3 end) + 0.5*least(r.pop::numeric/20,1) + 0.05*r.recommendation_priority),4),
           '인기·신곡 추천'::text
    from ranked r where rn <= 2
    order by 9 desc, r.created_at desc limit p_limit;
    return;
  end if;

  select max(p.score) into v_mg from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='genre';
  select max(p.score) into v_mm from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='mood';
  select max(p.score) into v_ma from public.user_music_preferences p where p.user_id=v_uid and p.preference_type='artist';

  return query
  with cand as (
    select t.*,
      coalesce((select g.score from public.user_music_preferences g where g.user_id=v_uid and g.preference_type='genre' and g.preference_key=coalesce(nullif(trim(t.genre),''),t.main_genre)),0) gsc,
      coalesce((select m.score from public.user_music_preferences m where m.user_id=v_uid and m.preference_type='mood' and m.preference_key=t.mood),0) msc,
      coalesce((select a.score from public.user_music_preferences a where a.user_id=v_uid and a.preference_type='artist' and a.preference_key=t.owner_user_id::text),0) asc_,
      coalesce((select count(*) from public.stream_events se where se.track_id=t.id and se.event_type='milestone_30s'),0) pop,
      coalesce((select count(*) from public.stream_events se where se.user_id=v_uid and se.track_id=t.id and se.event_type='milestone_30s'),0) myplays
    from public.tracks t
    where t.visibility_status='approved' and (t.release_status='released' or t.source_type='admin_upload')
      and t.removed_at is null and coalesce(t.is_recommendable,true)=true
      and t.audio_url is not null and length(btrim(t.audio_url))>0
      and t.cover_url is not null and length(btrim(t.cover_url))>0
  ),
  scored as (
    select c.*,
      ( 0.35*(case when coalesce(v_mg,0)>0 then c.gsc/v_mg else 0 end)
      + 0.25*(case when coalesce(v_mm,0)>0 then c.msc/v_mm else 0 end)
      + 0.15*(case when coalesce(v_ma,0)>0 then c.asc_/v_ma else 0 end)
      + 0.15*(case when c.created_at>now()-interval '21 days' then 1 when c.created_at>now()-interval '60 days' then 0.5 else 0.1 end)
      + 0.10*least(c.pop::numeric/20,1)
      + 0.02*c.recommendation_priority
      - (case when c.myplays>=5 then 0.4 when c.myplays>=2 then 0.2 else 0 end) ) as rec_score
    from cand c
  ),
  ranked as (
    select s.*, row_number() over (partition by s.owner_user_id order by rec_score desc) artist_rn from scored s where rec_score > 0
  )
  select r.id, r.title, r.artist, coalesce(nullif(trim(r.genre),''), r.main_genre), r.mood, r.cover_url, r.audio_url, r.duration,
         round(r.rec_score,4),
         (case when r.gsc>0 and r.gsc=greatest(r.gsc,r.msc,r.asc_) then '자주 듣는 장르'
               when r.msc>0 and r.msc>=r.gsc then '자주 듣는 분위기'
               when r.asc_>0 then '관심 아티스트'
               when r.created_at>now()-interval '21 days' then '신곡'
               else '추천' end)::text
  from ranked r where artist_rn <= 2
  order by rec_score desc limit p_limit;
end; $function$;

-- ============================================================
-- 10) get_user_playlist_detail — 플레이리스트 내 removed/미발매/자켓없음 트랙 미노출.
-- ============================================================
create or replace function public.get_user_playlist_detail(p_playlist_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_uid uuid := auth.uid(); v_result jsonb; v_visible boolean;
begin
  select (is_public or owner_user_id = v_uid) into v_visible
  from public.user_playlists where id = p_playlist_id;
  if v_visible is null then return null; end if;
  if not v_visible then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'id', up.id, 'title', up.title, 'description', up.description,
    'thumbnail_url', up.thumbnail_url, 'is_public', up.is_public,
    'computed_cover_url', coalesce(nullif(up.thumbnail_url,''), public.user_playlist_cover_url(up.id)),
    'owner_user_id', up.owner_user_id, 'is_owner', (up.owner_user_id = v_uid),
    'created_at', up.created_at,
    'creator_name', coalesce(cp.display_name, ou.nickname, ou.full_name, '듣다 사용자'),
    'creator_is_curator', (cp.user_id is not null),
    'creator_handle', cp.handle,
    'total_views', coalesce((select count(*) from public.playlist_qualified_views v
                             where v.playlist_type = 'user' and v.playlist_id = up.id), 0),
    'follower_count', coalesce((select count(*) from public.user_playlist_follows f where f.user_playlist_id = up.id), 0),
    'is_following', exists (select 1 from public.user_playlist_follows f where f.user_playlist_id = up.id and f.user_id = v_uid),
    'tracks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'artist', t.artist, 'genre', t.genre,
        'mood', t.mood, 'audio_url', t.audio_url, 'cover_url', t.cover_url,
        'duration', t.duration, 'created_at', t.created_at, 'order_index', upt.order_index
      ) order by upt.order_index)
      from public.user_playlist_tracks upt join public.tracks t on t.id = upt.track_id
      where upt.user_playlist_id = up.id
        and t.visibility_status = 'approved'
        and (t.release_status = 'released' or t.source_type = 'admin_upload')
        and t.removed_at is null
        and t.audio_url is not null and length(btrim(t.audio_url)) > 0
        and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    ), '[]'::jsonb)
  ) into v_result
  from public.user_playlists up
  left join public.users ou on ou.id = up.owner_user_id
  left join public.curator_profiles cp on cp.user_id = up.owner_user_id
  where up.id = p_playlist_id;
  return v_result;
end; $function$;
