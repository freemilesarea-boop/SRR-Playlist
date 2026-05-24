-- 0155 — 검수 페이지 audio 메타 노출 + 관리자 self-heal 백필
-- 원인: 업로드 시 duration/content_type 이 기록되지 않은 트랙이 검수에 노출되고,
-- 0154 발매 게이트(duration>0)에 막혀 승인 불가. 검수 페이지가 메타를 추출/백필하도록 한다.

-- 1) 검수 목록 RPC 확장 — storage_path/content_type/duration/health 노출 (return type 변경 → drop 후 재생성)
--    NOTE: tracks.duration 은 integer 타입.
drop function if exists public.list_pending_review_tracks(integer, integer, uuid);

create function public.list_pending_review_tracks(p_limit integer default 50, p_offset integer default 0, p_artist_id uuid default null)
 RETURNS TABLE(track_id uuid, track_code text, title text, artist text, artist_name text, album_name text, release_title text, isrc text, rights_holder_name text, rights_confirmed_at timestamptz, main_genre text, sub_genre text, mood text, suitable_store text, lyrics text, audio_url text, cover_url text, payout_verification_status text, payout_bank_name text, admin_note text, created_at timestamptz, release_status text, release_date date, submitted_at timestamptz, review_started_at timestamptz, changes_requested_reason text, storage_path text, audio_content_type text, duration integer, audio_content_length bigint, audio_health_status text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
    t.review_started_at, t.changes_requested_reason,
    t.storage_path, t.audio_content_type, t.duration, t.audio_content_length, t.audio_health_status
  from public.tracks t
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.source_type = 'artist_upload'
    and (
      t.visibility_status = 'pending_review'
      or t.release_status in ('submitted','review_pending','changes_requested')
    )
    and t.release_status not in ('removed','rejected','released','approved','scheduled')
    and (p_artist_id is null or t.owner_user_id = p_artist_id)
  order by t.created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end; $function$;

grant execute on function public.list_pending_review_tracks(integer, integer, uuid) to authenticated;

-- 2) 관리자 백필 — 검수 페이지가 브라우저에서 추출한 duration/content_type 을 기록 (self-heal)
create or replace function public.admin_backfill_track_audio_meta(
  p_track_id uuid,
  p_duration numeric default null,
  p_content_type text default null,
  p_content_length bigint default null,
  p_health text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_uid uuid := auth.uid(); v_dur integer; v_ct text; v_health text;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  if p_health is not null and p_health not in ('unknown','ok','unreachable','wrong_mime','empty','error','conversion_failed') then
    raise exception 'invalid health status %', p_health;
  end if;
  update public.tracks set
    duration = case when p_duration is not null and p_duration > 0 then p_duration else duration end,
    audio_content_type = coalesce(nullif(btrim(p_content_type),''), audio_content_type),
    audio_content_length = coalesce(p_content_length, audio_content_length),
    audio_health_status = coalesce(nullif(btrim(p_health),''), audio_health_status),
    audio_health_checked_at = case when p_health is not null then now() else audio_health_checked_at end
  where id = p_track_id and source_type='artist_upload'
  returning duration, audio_content_type, audio_health_status into v_dur, v_ct, v_health;
  if not found then raise exception 'track not found'; end if;
  return jsonb_build_object('ok', true, 'duration', v_dur, 'content_type', v_ct, 'audio_health_status', v_health);
end; $$;

grant execute on function public.admin_backfill_track_audio_meta(uuid, numeric, text, bigint, text) to authenticated;
