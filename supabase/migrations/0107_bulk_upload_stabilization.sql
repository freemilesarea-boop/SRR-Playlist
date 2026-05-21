-- 0107_bulk_upload_stabilization.sql
-- 대량 아티스트/음원 업로드 대비 안정화 (P0)
--   1) audio 버킷 파일 크기 한도 50MB → 100MB (실제 100MB 업로드 차단 원인이던 서버 제약)
--   2) 검수 큐 RPC: 페이지네이션(offset) + 아티스트 필터
--   3) 검수 대기 총건수 + 아티스트별 건수 RPC
-- 결제/정산/스트리밍 로직은 변경하지 않음.
-- 정렬 인덱스는 별도로 검토했으나, 기존 idx_tracks_release_status(partial, source_type='artist_upload')가
-- 검수 큐 쿼리를 충분히 커버(2k행 ~1.5ms, top-N heapsort)하여 추가 인덱스는 생성하지 않음.

-- 1) 버킷 한도 상향 (100MB = 104857600)
update storage.buckets set file_size_limit = 104857600 where id = 'audio';

-- 2) 검수 큐: 페이지네이션 + 아티스트 필터 (기존 (integer) signature drop 후 재생성)
drop function if exists public.list_pending_review_tracks(integer);

create or replace function public.list_pending_review_tracks(
  p_limit integer default 50,
  p_offset integer default 0,
  p_artist_id uuid default null)
returns table(track_id uuid, track_code text, title text, artist text, artist_name text, album_name text, release_title text, isrc text, rights_holder_name text, rights_confirmed_at timestamp with time zone, main_genre text, sub_genre text, mood text, suitable_store text, lyrics text, audio_url text, cover_url text, payout_verification_status text, payout_bank_name text, admin_note text, created_at timestamp with time zone, release_status text, release_date date, submitted_at timestamp with time zone, review_started_at timestamp with time zone, changes_requested_reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
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
      or t.release_status in ('submitted','review_pending','changes_requested')
    )
    and t.release_status not in ('removed','rejected','released','approved','scheduled')
    and (p_artist_id is null or t.owner_user_id = p_artist_id)
  order by t.created_at desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end; $function$;

-- 3) 검수 대기 총건수 + 아티스트별 건수
create or replace function public.count_pending_review_tracks()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_total int; v_by_artist jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  select count(*) into v_total
  from public.tracks t
  where t.source_type = 'artist_upload'
    and (t.visibility_status = 'pending_review'
         or t.release_status in ('submitted','review_pending','changes_requested'))
    and t.release_status not in ('removed','rejected','released','approved','scheduled');

  select coalesce(jsonb_agg(x order by x.n desc), '[]'::jsonb) into v_by_artist
  from (
    select t.owner_user_id,
           coalesce(ap.artist_name, t.artist, '—') as artist_name,
           count(*) as n
    from public.tracks t
    left join public.artist_profiles ap on ap.user_id = t.owner_user_id
    where t.source_type = 'artist_upload'
      and (t.visibility_status = 'pending_review'
           or t.release_status in ('submitted','review_pending','changes_requested'))
      and t.release_status not in ('removed','rejected','released','approved','scheduled')
    group by t.owner_user_id, coalesce(ap.artist_name, t.artist, '—')
  ) x;

  return jsonb_build_object('total', v_total, 'by_artist', v_by_artist);
end; $function$;
