-- 0267 — Feedback Summary UI + Inspector Badge 지원
--
-- 목표:
--   1. admin_feedback_summary 확장
--      - by_genre 추가 (제거/제외 장르 집계)
--      - by_store_action 행렬
--      - recent_logs 에 track/artist/playlist/admin 정보 join
--   2. admin_get_track_feedback(track_id) — 트랙 단위 조회
--      QcQueueRowDetail / AdminPlaylistTrackInspector 양쪽에서 재사용
--   3. 두 함수 모두 SECURITY DEFINER + 명시적 admin role check (RLS 우회 방지)

-- ===== A. admin_feedback_summary (확장 + 권한 강화) =====
drop function if exists public.admin_feedback_summary();
create or replace function public.admin_feedback_summary()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return (
    select jsonb_build_object(
      'total', (select count(*) from public.track_store_feedback),
      'by_action', (
        select jsonb_object_agg(action, n) from (
          select action, count(*) as n from public.track_store_feedback group by action
        ) s
      ),
      'by_store', (
        select jsonb_object_agg(coalesce(store_type, 'GLOBAL'), n) from (
          select store_type, count(*) as n from public.track_store_feedback group by store_type
        ) s
      ),
      'by_store_action', (
        select jsonb_object_agg(coalesce(store_type, 'GLOBAL'), per_action) from (
          select store_type, jsonb_object_agg(action, n) as per_action
          from (
            select store_type, action, count(*) as n
            from public.track_store_feedback group by store_type, action
          ) s2 group by store_type
        ) s
      ),
      'by_genre', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'main_genre', main_genre, 'removed', removed,
          'excluded', excluded, 'approved', approved,
          'review_needed', review_needed, 'total', total
        ) order by total desc), '[]'::jsonb)
        from (
          select coalesce(t.main_genre, '(미지정)') as main_genre,
                 count(*) filter (where f.action='admin_removed') as removed,
                 count(*) filter (where f.action='admin_excluded') as excluded,
                 count(*) filter (where f.action='admin_approved') as approved,
                 count(*) filter (where f.action='admin_review_needed') as review_needed,
                 count(*) as total
          from public.track_store_feedback f
          join public.tracks t on t.id = f.track_id
          where f.action <> 'metadata_corrected'
          group by t.main_genre
          order by total desc limit 30
        ) g
      ),
      'recent_logs', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', f.id, 'track_id', f.track_id,
          'track_title', t.title, 'artist_name', t.artist, 'main_genre', t.main_genre,
          'playlist_id', f.playlist_id, 'playlist_name', pl.title,
          'store_type', f.store_type, 'action', f.action, 'admin_note', f.admin_note,
          'before_fit_score', f.before_fit_score, 'after_fit_score', f.after_fit_score,
          'created_by', f.created_by, 'created_by_name', u.full_name,
          'created_at', f.created_at
        ) order by f.created_at desc), '[]'::jsonb)
        from (select * from public.track_store_feedback order by created_at desc limit 50) f
        left join public.tracks t on t.id = f.track_id
        left join public.playlists pl on pl.id = f.playlist_id
        left join public.users u on u.id = f.created_by
      )
    )
  );
end; $$;

-- ===== B. admin_get_track_feedback (트랙 단위 + 권한 강화) =====
drop function if exists public.admin_get_track_feedback(uuid);
create or replace function public.admin_get_track_feedback(p_track_id uuid)
returns table (
  id uuid, track_id uuid, store_type text, action text,
  playlist_id uuid, playlist_name text,
  before_fit_score numeric, after_fit_score numeric,
  admin_note text, created_by uuid, created_by_name text,
  created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = public
as $$
declare v_admin uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id=v_admin and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return query
    select f.id, f.track_id, f.store_type, f.action,
           f.playlist_id,
           (select pl.title from public.playlists pl where pl.id = f.playlist_id),
           f.before_fit_score, f.after_fit_score,
           f.admin_note, f.created_by,
           (select u.full_name from public.users u where u.id = f.created_by),
           f.created_at, f.updated_at
    from public.track_store_feedback f
    where f.track_id = p_track_id
    order by
      case f.action
        when 'admin_removed' then 0
        when 'admin_excluded' then 1
        when 'admin_review_needed' then 2
        when 'admin_approved' then 3
        when 'metadata_corrected' then 4
        else 5 end,
      f.created_at desc;
end; $$;

-- ===== C. 권한 =====
revoke all on function public.admin_feedback_summary() from public, anon;
revoke all on function public.admin_get_track_feedback(uuid) from public, anon;
grant execute on function public.admin_feedback_summary() to authenticated, service_role;
grant execute on function public.admin_get_track_feedback(uuid) to authenticated, service_role;
