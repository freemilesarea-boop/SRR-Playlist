-- admin 음원 관리: 안정 정렬 + 전체 count + 전체 상태 뷰에서 removed 자동 제외.
-- additive: 시그니처 유지. release_status/stream_events/정산 무접근, 데이터 UPDATE 없음.

-- 1) 안정 정렬(created_at desc, id desc) + 전체 상태 뷰에서 removed 자동 제외.
create or replace function public.admin_artist_tracks_list(
  p_status text default null::text,
  p_search text default null::text,
  p_limit integer default 100,
  p_offset integer default 0
) returns table(
  track_id uuid, track_code text, title text, artist text, artist_name text, artist_email text,
  album_name text, release_title text, isrc text, rights_holder_name text, rights_confirmed_at timestamptz,
  visibility_status text, release_status text, release_date date,
  rejected_reason text, admin_note text, removed_reason text,
  payout_verification_status text, contract_status text,
  audio_url text, cover_url text, reviewed_at timestamptz, reviewed_by uuid, created_at timestamptz
) language plpgsql security definer set search_path to 'public'
as $function$
declare v_pattern text := case when p_search is null or length(btrim(p_search))=0 then null else '%'||btrim(p_search)||'%' end;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  return query
  select
    t.id, t.track_code, t.title, t.artist, ap.artist_name, au.email::text,
    t.album_name, t.release_title, t.isrc, t.rights_holder_name, t.rights_confirmed_at,
    t.visibility_status, t.release_status, t.release_date,
    t.rejected_reason, t.admin_note, t.removed_reason,
    pa.verification_status, u.contract_status,
    t.audio_url, t.cover_url,
    t.reviewed_at, t.reviewed_by, t.created_at
  from public.tracks t
  left join public.users u on u.id = t.owner_user_id
  left join auth.users au on au.id = t.owner_user_id
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join public.artist_payout_accounts pa on pa.id = t.payout_account_id
  where t.source_type = 'artist_upload'
    and (
      p_status is null
      or t.visibility_status = p_status
      or t.release_status = p_status
    )
    -- 0212: 전체 상태 뷰(p_status null)에서는 removed 자동 제외 (삭제음원 탭은 status='removed' 명시).
    and (p_status is not null or t.release_status <> 'removed')
    and (
      v_pattern is null
      or coalesce(t.track_code,'') ilike v_pattern
      or coalesce(t.title,'') ilike v_pattern
      or coalesce(t.artist,'') ilike v_pattern
      or coalesce(ap.artist_name,'') ilike v_pattern
      or coalesce(t.isrc,'') ilike v_pattern
      or coalesce(au.email::text,'') ilike v_pattern
      or coalesce(t.rights_holder_name,'') ilike v_pattern
    )
  order by t.created_at desc, t.id desc
  limit greatest(1, p_limit) offset greatest(0, p_offset);
end; $function$;

-- 2) 전체 개수 (동일 필터, 정렬/페이지 무관).
create or replace function public.admin_artist_tracks_count(
  p_status text default null::text,
  p_search text default null::text
) returns bigint language plpgsql stable security definer set search_path to 'public'
as $function$
declare v_pattern text := case when p_search is null or length(btrim(p_search))=0 then null else '%'||btrim(p_search)||'%' end;
        v_n bigint;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select count(*) into v_n
  from public.tracks t
  left join public.artist_profiles ap on ap.user_id = t.owner_user_id
  left join auth.users au on au.id = t.owner_user_id
  where t.source_type = 'artist_upload'
    and (
      p_status is null
      or t.visibility_status = p_status
      or t.release_status = p_status
    )
    and (p_status is not null or t.release_status <> 'removed')
    and (
      v_pattern is null
      or coalesce(t.track_code,'') ilike v_pattern
      or coalesce(t.title,'') ilike v_pattern
      or coalesce(t.artist,'') ilike v_pattern
      or coalesce(ap.artist_name,'') ilike v_pattern
      or coalesce(t.isrc,'') ilike v_pattern
      or coalesce(au.email::text,'') ilike v_pattern
      or coalesce(t.rights_holder_name,'') ilike v_pattern
    );
  return coalesce(v_n, 0);
end; $function$;

grant execute on function public.admin_artist_tracks_list(text, text, integer, integer) to authenticated;
grant execute on function public.admin_artist_tracks_count(text, text) to authenticated;
