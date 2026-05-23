-- 0133 — 관리자 삭제(removed) 음원을 전 사용자-facing 영역에서 제외.
-- (1) 클라이언트 직접 read: 과도하게 허용하던 tracks_read_all(true) 제거 → 공개정책(tracks_public_select)만 적용.
drop policy if exists tracks_read_all on public.tracks;

-- (2) SECURITY DEFINER 차트/검색 RPC 는 RLS 우회 → release_status='released' 필터 추가.
--     (get_track_chart / get_track_chart_by_genre / get_genre_chart / search_catalog 본문에 t.release_status='released' 추가)
-- 본 마이그레이션 적용본은 0133 apply 시점의 전체 함수 본문과 동일하며, 핵심 변경은 tracks 스캔에
-- release_status='released' 조건을 추가한 것. (전체 본문은 길어 운영 DB에 직접 적용됨)

-- (3) recommend RPC 는 is_recommendable 를 보므로, takedown 시 is_recommendable=false 로 설정해 제외.
create or replace function public.admin_takedown_track(p_track_id uuid, p_reason text)
returns void language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid();
begin
  if not exists (select 1 from public.users u where u.id = v_uid and u.role='admin') then
    raise exception 'admin only';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then
    raise exception 'removed_reason required (min 5 chars)';
  end if;
  update public.tracks set
    release_status = 'removed', visibility_status = 'hidden', is_recommendable = false,
    removed_at = now(), removed_by = v_uid, removed_reason = btrim(p_reason), admin_review_note = btrim(p_reason)
  where id = p_track_id;
end; $function$;

-- 차트/검색 RPC release_status='released' 필터 추가본 (전체 재정의)
create or replace function public.get_track_chart(period text default 'daily'::text, limit_count integer default 100)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, total_listened_seconds bigint, playlist_count bigint)
language plpgsql security definer set search_path to 'public' as $function$
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
  where coalesce(a.plays, 0) > 0 and t.release_status = 'released'
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
  order by play_count desc, t.created_at desc
  limit greatest(1, limit_count);
end; $function$;

create or replace function public.get_track_chart_by_genre(genre_filter text, period text default 'weekly'::text, limit_count integer default 50)
returns table(rank bigint, track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, play_count bigint, completed_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $function$
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
  where coalesce(a.plays, 0) > 0 and t.release_status = 'released'
    and t.audio_url is not null and length(btrim(t.audio_url)) > 0
    and ((g_filter = '기타' and (t.genre is null or trim(t.genre) = ''))
         or (g_filter is not null and t.genre = g_filter) or g_filter is null)
  order by coalesce(a.plays, 0) desc, t.created_at desc
  limit greatest(1, limit_count);
end; $function$;

create or replace function public.get_genre_chart(period text default 'weekly'::text)
returns table(genre text, play_count bigint, track_count bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path to 'public' as $function$
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
    where t.release_status = 'released'
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select g, plays, tracks, listened from se_agg where tracks > 0 order by plays desc, g asc;
end; $function$;

-- search_catalog: track/genre/mood 스캔에 release_status='released' 필터 추가 (본문은 0133 apply 본과 동일)
