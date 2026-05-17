-- 0078 — stream_events 강화 (anonymous_id / 컨텍스트 / 서버 가드 + dedup)
--
-- 기존 (변경 없이 유지):
-- - stream_events 테이블 (id, user_id, track_id, playlist_id, session_id,
--   listened_seconds, completed, event_type, created_at) — 6766 events 적립 중
-- - trackStream client 함수 (start/milestone_30s/complete)
-- - get_track_chart / get_artist_streaming_summary / get_artist_daily_streams /
--   admin_generate_monthly_settlement 등 milestone_30s 기반 RPC 다수
--
-- 추가:
-- 1) stream_events: anonymous_id / artist_user_id / source_page / user_agent /
--    client_ip / eligible_for_payout 컬럼
-- 2) record_stream_event_safe RPC — 서버 측 강화:
--    · 봇 UA 차단 (bot/crawler/spider/curl/wget/headlesschrome)
--    · 5초 미만 milestone 차단
--    · 30초 dedup (같은 identity + track + event_type)
--    · eligible_for_payout 자동 판정:
--      - 미공개 트랙 (release_status != released 또는 admin_upload) → false
--      - /admin* / /artist* 페이지 미리듣기 → false
--      - 본인 (artist) 가 본인 트랙 재생 → false
-- 3) admin_streaming_overview / admin_top_streaming_tracks RPC

ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS anonymous_id text,
  ADD COLUMN IF NOT EXISTS artist_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_page text,
  ADD COLUMN IF NOT EXISTS user_agent text,
  ADD COLUMN IF NOT EXISTS client_ip inet,
  ADD COLUMN IF NOT EXISTS eligible_for_payout boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_stream_events_anon_track_time
  ON public.stream_events (anonymous_id, track_id, event_type, created_at DESC)
  WHERE anonymous_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_events_user_track_time
  ON public.stream_events (user_id, track_id, event_type, created_at DESC)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_events_artist_created
  ON public.stream_events (artist_user_id, created_at DESC)
  WHERE artist_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_stream_events_eligible_milestone
  ON public.stream_events (track_id, created_at DESC)
  WHERE event_type = 'milestone_30s' AND eligible_for_payout = true;

UPDATE public.stream_events se
SET artist_user_id = t.owner_user_id
FROM public.tracks t
WHERE se.track_id = t.id AND se.artist_user_id IS NULL AND t.source_type = 'artist_upload';

CREATE OR REPLACE FUNCTION public.record_stream_event_safe(
  p_track_id uuid, p_session_id text, p_event_type text,
  p_listened_seconds integer DEFAULT 0, p_completed boolean DEFAULT false,
  p_playlist_id uuid DEFAULT NULL, p_anonymous_id text DEFAULT NULL,
  p_source_page text DEFAULT NULL, p_user_agent text DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_track record; v_eligible boolean := true;
  v_identity_match boolean; v_event_id bigint;
begin
  if p_event_type not in ('start','milestone_30s','complete') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_event_type');
  end if;
  select id, owner_user_id, source_type, release_status, visibility_status, audio_url
    into v_track from public.tracks where id = p_track_id;
  if v_track.id is null then
    return jsonb_build_object('ok', false, 'reason', 'track_not_found');
  end if;
  if p_user_agent is not null and (
       p_user_agent ilike '%bot%' or p_user_agent ilike '%crawler%'
    or p_user_agent ilike '%spider%' or p_user_agent ilike '%curl%'
    or p_user_agent ilike '%wget%' or p_user_agent ilike '%headlesschrome%'
  ) then
    return jsonb_build_object('ok', false, 'reason', 'bot_filtered');
  end if;
  if p_event_type = 'milestone_30s' and p_listened_seconds < 5 then
    return jsonb_build_object('ok', false, 'reason', 'too_short');
  end if;
  if v_track.source_type <> 'artist_upload' or v_track.release_status <> 'released' then
    v_eligible := false;
  end if;
  if p_source_page is not null and (p_source_page like '/admin%' or p_source_page like '/artist%') then
    v_eligible := false;
  end if;
  if v_uid is not null and v_track.owner_user_id = v_uid then
    v_eligible := false;
  end if;
  if p_event_type = 'milestone_30s' then
    if v_uid is not null then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and user_id = v_uid
          and event_type = 'milestone_30s'
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and anonymous_id = p_anonymous_id
          and event_type = 'milestone_30s'
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    else v_identity_match := false; end if;
    if v_identity_match then
      return jsonb_build_object('ok', false, 'reason', 'dedup_30s');
    end if;
  end if;
  insert into public.stream_events (
    user_id, anonymous_id, track_id, artist_user_id, playlist_id,
    session_id, listened_seconds, completed, event_type,
    source_page, user_agent, eligible_for_payout
  ) values (
    v_uid, nullif(btrim(p_anonymous_id),''), p_track_id, v_track.owner_user_id, p_playlist_id,
    p_session_id, coalesce(p_listened_seconds, 0), coalesce(p_completed, false), p_event_type,
    p_source_page, p_user_agent, v_eligible
  ) returning id into v_event_id;
  return jsonb_build_object(
    'ok', true, 'event_id', v_event_id,
    'eligible_for_payout', v_eligible, 'event_type', p_event_type
  );
end; $function$;
GRANT EXECUTE ON FUNCTION public.record_stream_event_safe(uuid, text, text, integer, boolean, uuid, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.admin_streaming_overview(p_days int DEFAULT 30)
RETURNS TABLE(day date, total_streams bigint, eligible_streams bigint,
              unique_listeners bigint, unique_tracks bigint)
LANGUAGE sql SECURITY DEFINER SET search_path TO 'public'
AS $function$
  select
    (created_at at time zone 'Asia/Seoul')::date as day,
    count(*) filter (where event_type='milestone_30s')::bigint as total_streams,
    count(*) filter (where event_type='milestone_30s' and eligible_for_payout=true)::bigint as eligible_streams,
    count(distinct coalesce(user_id::text, anonymous_id)) filter (where event_type='milestone_30s')::bigint as unique_listeners,
    count(distinct track_id) filter (where event_type='milestone_30s')::bigint as unique_tracks
  from public.stream_events
  where created_at >= now() - ((p_days - 1) || ' days')::interval
    and exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin')
  group by 1 order by 1 desc;
$function$;
GRANT EXECUTE ON FUNCTION public.admin_streaming_overview(int) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_top_streaming_tracks(p_days int DEFAULT 7, p_limit int DEFAULT 20)
RETURNS TABLE(rank bigint, track_id uuid, track_code text, title text, artist text,
              artist_user_id uuid, stream_count bigint, eligible_count bigint)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  return query
  with agg as (
    select se.track_id, count(*) as total,
           count(*) filter (where se.eligible_for_payout=true) as eligible
    from public.stream_events se
    where se.event_type='milestone_30s'
      and se.created_at >= now() - (p_days || ' days')::interval
    group by se.track_id
  )
  select row_number() over (order by a.total desc) as rank,
         t.id, t.track_code, t.title, t.artist, t.owner_user_id, a.total, a.eligible
  from agg a join public.tracks t on t.id = a.track_id
  order by a.total desc limit greatest(1, p_limit);
end; $function$;
GRANT EXECUTE ON FUNCTION public.admin_top_streaming_tracks(int, int) TO authenticated;

NOTIFY pgrst, 'reload schema';
