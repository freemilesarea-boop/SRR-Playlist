-- 0154 — 업로드 안정화: duration/contentType 기록 + 발매 게이트 강화 + 관리자 점검 도구
-- (additive: 새 RPC + 기존 approve RPC 게이트 강화. 데이터 파괴 없음)

-- 1) 소유자(아티스트)가 업로드 직후 duration / content_type 을 기록하는 RPC.
create or replace function public.set_artist_track_audio_meta(
  p_track_id uuid,
  p_duration numeric default null,
  p_content_type text default null,
  p_content_length bigint default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  update public.tracks set
    duration = case when p_duration is not null and p_duration > 0 then p_duration else duration end,
    audio_content_type = coalesce(nullif(btrim(p_content_type),''), audio_content_type),
    audio_content_length = coalesce(p_content_length, audio_content_length)
  where id = p_track_id
    and owner_user_id = v_uid
    and source_type = 'artist_upload';
  if not found then raise exception 'track not found or not owner'; end if;
  return jsonb_build_object('ok', true);
end; $$;

grant execute on function public.set_artist_track_audio_meta(uuid, numeric, text, bigint) to authenticated;

-- 2) 발매 게이트 강화 — audio 존재 + 변환 성공(MP3) + duration 필수.
create or replace function public.admin_approve_artist_release(p_track_id uuid, p_immediate_release boolean default null)
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
         t.cover_url, t.main_genre, t.title, t.album_name,
         t.audio_url, t.storage_path, t.duration, t.audio_content_type, t.audio_health_status
    into v_track from public.tracks t where t.id = p_track_id;
  if v_track.id is null then raise exception 'track not found'; end if;
  if v_track.source_type <> 'artist_upload' then raise exception 'not an artist upload'; end if;
  if v_track.release_status not in ('submitted','review_pending','changes_requested') then
    raise exception 'cannot approve in release_status=%', v_track.release_status;
  end if;
  if v_track.release_date is null then raise exception 'release_date missing'; end if;
  -- 앨범 자켓
  if v_track.cover_url is null or length(btrim(v_track.cover_url)) = 0 then
    raise exception 'cannot approve: album cover required'
      using hint = '앨범 자켓이 없으면 승인(발매)할 수 없습니다.';
  end if;
  -- 장르
  if v_track.main_genre is null or length(btrim(v_track.main_genre)) = 0 then
    raise exception 'cannot approve: genre(main_genre) required'
      using hint = '장르가 없으면 승인(발매)할 수 없습니다.';
  end if;
  -- 제목/앨범
  if v_track.title is null or length(btrim(v_track.title)) = 0
     or v_track.album_name is null or length(btrim(v_track.album_name)) = 0 then
    raise exception 'cannot approve: title/album required';
  end if;
  -- 오디오 파일 존재 (audio_url 또는 storage_path)
  if (v_track.audio_url is null or length(btrim(v_track.audio_url)) = 0)
     and (v_track.storage_path is null or length(btrim(v_track.storage_path)) = 0) then
    raise exception 'cannot approve: audio file required'
      using hint = '음원 파일이 없으면 발매할 수 없습니다.';
  end if;
  -- 변환 실패 곡 발매 불가
  if v_track.audio_health_status = 'conversion_failed' then
    raise exception 'cannot approve: audio conversion failed'
      using hint = 'MP3 변환에 실패한 음원은 발매할 수 없습니다. 재변환 후 다시 시도하세요.';
  end if;
  -- MP3 content type (알려진 경우 audio/mpeg 만 허용)
  if v_track.audio_content_type is not null and v_track.audio_content_type <> 'audio/mpeg' then
    raise exception 'cannot approve: non-MP3 audio (content_type=%)', v_track.audio_content_type
      using hint = '서비스용 MP3 로 변환된 음원만 발매할 수 있습니다.';
  end if;
  -- duration 필수 ( > 0 )
  if v_track.duration is null or v_track.duration <= 0 then
    raise exception 'cannot approve: audio duration missing'
      using hint = '재생 길이(duration)가 확인되지 않은 음원은 발매할 수 없습니다. 오디오 진단에서 재검사하세요.';
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

-- 3) 관리자 업로드/스토리지 점검 (read-only)
create or replace function public.admin_upload_audit()
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;

  with audio_refs as (
    select storage_path as name from public.tracks where storage_path is not null and btrim(storage_path) <> ''
    union
    select split_part(regexp_replace(audio_url, '^.*/object/(public|sign)/audio/', ''), '?', 1)
      from public.tracks where audio_url ~ '/object/(public|sign)/audio/'
  ),
  cover_refs as (
    select cover_storage_path as name from public.tracks where cover_storage_path is not null and btrim(cover_storage_path) <> ''
    union
    select split_part(regexp_replace(cover_url, '^.*/object/(public|sign)/covers/', ''), '?', 1)
      from public.tracks where cover_url ~ '/object/(public|sign)/covers/'
  ),
  orphan_audio as (
    select o.name, o.bucket_id, o.created_at, (o.metadata->>'size')::bigint as size
    from storage.objects o
    where o.bucket_id='audio' and o.name not in (select name from audio_refs where name is not null)
  ),
  orphan_cover as (
    select o.name, o.bucket_id, o.created_at
    from storage.objects o
    where o.bucket_id='covers' and o.name not in (select name from cover_refs where name is not null)
  ),
  missing_audio as (
    select t.id, t.title, t.release_status, t.storage_path, t.audio_url
    from public.tracks t
    where t.source_type='artist_upload'
      and (
        (t.storage_path is not null and btrim(t.storage_path) <> ''
          and not exists (select 1 from storage.objects o where o.bucket_id='audio' and o.name=t.storage_path))
        or
        (t.audio_url ~ '/object/(public|sign)/audio/'
          and not exists (select 1 from storage.objects o where o.bucket_id='audio'
              and o.name = split_part(regexp_replace(t.audio_url,'^.*/object/(public|sign)/audio/',''),'?',1)))
      )
  )
  select jsonb_build_object(
    'orphan_audio_count', (select count(*) from orphan_audio),
    'orphan_cover_count', (select count(*) from orphan_cover),
    'missing_audio_count', (select count(*) from missing_audio),
    'conversion_failed_count', (select count(*) from public.tracks where audio_health_status='conversion_failed'),
    'stale_pending_count', (select count(*) from public.tracks
        where source_type='artist_upload'
          and release_status in ('submitted','review_pending','changes_requested')
          and coalesce(submitted_at, created_at) < now() - interval '7 days'),
    'orphan_audio', (select coalesce(jsonb_agg(row_to_json(a) order by a.created_at desc),'[]'::jsonb)
        from (select name, size, created_at from orphan_audio order by created_at desc limit 100) a),
    'orphan_cover', (select coalesce(jsonb_agg(row_to_json(b) order by b.created_at desc),'[]'::jsonb)
        from (select name, created_at from orphan_cover order by created_at desc limit 100) b),
    'missing_audio', (select coalesce(jsonb_agg(row_to_json(c)),'[]'::jsonb) from missing_audio c),
    'conversion_failed', (select coalesce(jsonb_agg(row_to_json(d)),'[]'::jsonb) from (
        select id, title, artist, audio_health_status, audio_health_checked_at
        from public.tracks where audio_health_status='conversion_failed' order by audio_health_checked_at desc nulls last limit 100) d),
    'stale_pending', (select coalesce(jsonb_agg(row_to_json(e)),'[]'::jsonb) from (
        select id, title, artist, release_status, submitted_at, created_at
        from public.tracks where source_type='artist_upload'
          and release_status in ('submitted','review_pending','changes_requested')
          and coalesce(submitted_at, created_at) < now() - interval '7 days'
        order by coalesce(submitted_at, created_at) asc limit 100) e)
  ) into v;
  return v;
end; $$;

grant execute on function public.admin_upload_audit() to authenticated;
