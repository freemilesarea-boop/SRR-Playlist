-- ============================================
-- 0018_artist_track_review.sql
--
-- 아티스트 음원 업로드 + 관리자 검수 운영 보강:
--   1) tracks.rejected_reason 컬럼 추가
--   2) tracks INSERT RLS: 승인된 아티스트만 본인 곡 추가 가능
--   3) tracks UPDATE RLS: 본인 pending_review 곡만 수정 가능
--   4) RPC: approve_artist_track / reject_artist_track / hide_artist_track (admin only)
--   5) RPC: list_my_artist_tracks (본인 곡 목록, 모든 visibility)
--
-- 멱등 (모든 객체 IF NOT EXISTS / DROP+CREATE).
-- ============================================

-- ----------------------
-- 1) tracks.rejected_reason
-- ----------------------
alter table public.tracks
  add column if not exists rejected_reason text;

-- ----------------------
-- 2) tracks RLS — 아티스트 INSERT
-- ----------------------
-- 승인된 아티스트만, 본인 owner_user_id 로, pending_review + artist_upload 로만 INSERT 가능.
drop policy if exists "tracks_artist_insert" on public.tracks;
create policy "tracks_artist_insert" on public.tracks
  for insert with check (
    owner_user_id = auth.uid()
    and source_type = 'artist_upload'
    and visibility_status = 'pending_review'
    and exists (
      select 1 from public.users u
      where u.id = auth.uid()
        and u.account_type = 'artist'
        and u.artist_approval_status = 'approved'
    )
  );

-- ----------------------
-- 3) tracks RLS — 아티스트 UPDATE (본인 pending_review 곡만)
-- ----------------------
-- 거절된 곡 수정 후 재심사 등은 별도 admin 정책으로. 현재는 pending_review 중에만 메타 수정 가능.
drop policy if exists "tracks_artist_update_pending" on public.tracks;
create policy "tracks_artist_update_pending" on public.tracks
  for update using (
    owner_user_id = auth.uid()
    and visibility_status = 'pending_review'
  ) with check (
    owner_user_id = auth.uid()
    and visibility_status = 'pending_review'
  );

-- 본인 DELETE 도 pending_review 동안만 허용 (관리자가 검수한 곡은 admin 만 삭제)
drop policy if exists "tracks_artist_delete_pending" on public.tracks;
create policy "tracks_artist_delete_pending" on public.tracks
  for delete using (
    owner_user_id = auth.uid()
    and visibility_status = 'pending_review'
  );

-- ----------------------
-- 4) RPC: approve_artist_track
-- ----------------------
create or replace function public.approve_artist_track(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.tracks
  set visibility_status = 'approved',
      rejected_reason = null
  where id = p_track_id;
end;
$$;

grant execute on function public.approve_artist_track(uuid) to authenticated;

-- ----------------------
-- 5) RPC: reject_artist_track
-- ----------------------
create or replace function public.reject_artist_track(p_track_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.tracks
  set visibility_status = 'rejected',
      rejected_reason = nullif(btrim(coalesce(p_reason, '')), '')
  where id = p_track_id;
end;
$$;

grant execute on function public.reject_artist_track(uuid, text) to authenticated;

-- ----------------------
-- 6) RPC: hide_artist_track
-- ----------------------
create or replace function public.hide_artist_track(p_track_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  update public.tracks
  set visibility_status = 'hidden'
  where id = p_track_id;
end;
$$;

grant execute on function public.hide_artist_track(uuid) to authenticated;

-- ----------------------
-- 7) RPC: list_my_artist_tracks — 본인 업로드 곡 (모든 visibility)
-- ----------------------
create or replace function public.list_my_artist_tracks(p_limit int default 100)
returns table(
  track_id uuid,
  title text,
  artist text,
  genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  visibility_status text,
  rejected_reason text,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
         t.visibility_status, t.rejected_reason, t.created_at
  from public.tracks t
  where t.owner_user_id = auth.uid()
  order by t.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.list_my_artist_tracks(int) to authenticated;

-- 확인
select
  (select count(*) from public.tracks where source_type = 'artist_upload') as artist_uploaded,
  (select count(*) from public.tracks where visibility_status = 'pending_review') as pending_review,
  (select count(*) from public.tracks where visibility_status = 'rejected') as rejected,
  (select count(*) from public.tracks where visibility_status = 'hidden') as hidden;
