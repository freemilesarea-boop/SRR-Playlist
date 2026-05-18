-- 0086 — 동일 user+track 24h eligible 스트림 상한 3회 (어뷰징 방지)
--
-- 정책:
-- - user_id + track_id 기준 rolling 24h 동안 eligible_for_payout=true milestone 카운트
-- - 4회차+ : raw event 는 적립하되 eligible_for_payout=false +
--   exclusion_reason='daily_user_track_cap'
-- - user_id NULL 일 땐 anonymous_id 로 대체 (가능 시)
-- - 기존 가드 (bot / 30s dedup / unreleased / admin_preview / artist_preview / self_play)
--   와 충돌 없음 — 마지막 단계에서만 cap 적용
--
-- 변경:
-- 1) stream_events.exclusion_reason text 컬럼 + CHECK 추가
--    enum: unreleased / admin_preview / artist_preview / self_play / daily_user_track_cap
-- 2) (user_id, track_id, created_at desc) partial index — eligible milestone 빠른 카운트
-- 3) (anonymous_id, track_id, created_at desc) partial index — 익명 fallback
-- 4) record_stream_event_safe RPC 강화:
--    - exclusion_reason 1차 매핑 (unreleased / admin_preview / artist_preview / self_play)
--    - 30s dedup 은 record 거부 (기존)
--    - 24h cap 검사 — 마지막 단계, 이미 eligible 인 milestone_30s 만
--    - 반환 jsonb 에 exclusion_reason / daily_user_track_count / daily_user_track_limit 추가

ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS exclusion_reason text
    CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
      'unreleased','admin_preview','artist_preview','self_play','daily_user_track_cap'
    ));

CREATE INDEX IF NOT EXISTS idx_stream_events_user_track_cap
  ON public.stream_events (user_id, track_id, created_at DESC)
  WHERE user_id IS NOT NULL AND event_type='milestone_30s' AND eligible_for_payout=true;

CREATE INDEX IF NOT EXISTS idx_stream_events_anon_track_cap
  ON public.stream_events (anonymous_id, track_id, created_at DESC)
  WHERE anonymous_id IS NOT NULL AND user_id IS NULL
        AND event_type='milestone_30s' AND eligible_for_payout=true;

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
  v_track record;
  v_eligible boolean := true;
  v_reason text := null;
  v_identity_match boolean;
  v_event_id bigint;
  v_daily_count int := 0;
  v_daily_limit constant int := 3;
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

  -- eligible 1차 매핑 (우선순위: unreleased > admin_preview > artist_preview > self_play)
  if v_track.source_type <> 'artist_upload' or v_track.release_status <> 'released' then
    v_eligible := false; v_reason := 'unreleased';
  end if;
  if v_eligible then
    if p_source_page is not null and p_source_page like '/admin%' then
      v_eligible := false; v_reason := 'admin_preview';
    elsif p_source_page is not null and p_source_page like '/artist%' then
      v_eligible := false; v_reason := 'artist_preview';
    elsif v_uid is not null and v_track.owner_user_id = v_uid then
      v_eligible := false; v_reason := 'self_play';
    end if;
  end if;

  -- 30s dedup — record 자체 거부
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

  -- 0086 — 24h user+track eligible 상한 검사 (milestone_30s 만, 이미 eligible 인 경우만)
  if v_eligible and p_event_type = 'milestone_30s' then
    if v_uid is not null then
      select count(*) into v_daily_count
      from public.stream_events
      where track_id = p_track_id and user_id = v_uid
        and event_type = 'milestone_30s' and eligible_for_payout = true
        and created_at > now() - interval '24 hours';
    elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
      select count(*) into v_daily_count
      from public.stream_events
      where track_id = p_track_id and anonymous_id = p_anonymous_id and user_id is null
        and event_type = 'milestone_30s' and eligible_for_payout = true
        and created_at > now() - interval '24 hours';
    else v_daily_count := 0; end if;
    if v_daily_count >= v_daily_limit then
      v_eligible := false; v_reason := 'daily_user_track_cap';
    end if;
  end if;

  insert into public.stream_events (
    user_id, anonymous_id, track_id, artist_user_id, playlist_id,
    session_id, listened_seconds, completed, event_type,
    source_page, user_agent, eligible_for_payout, exclusion_reason
  ) values (
    v_uid, nullif(btrim(p_anonymous_id),''), p_track_id, v_track.owner_user_id, p_playlist_id,
    p_session_id, coalesce(p_listened_seconds, 0), coalesce(p_completed, false), p_event_type,
    p_source_page, p_user_agent, v_eligible, v_reason
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'event_id', v_event_id,
    'eligible_for_payout', v_eligible,
    'exclusion_reason', v_reason,
    'daily_user_track_count', v_daily_count,
    'daily_user_track_limit', v_daily_limit,
    'event_type', p_event_type
  );
end; $function$;

GRANT EXECUTE ON FUNCTION public.record_stream_event_safe(uuid, text, text, integer, boolean, uuid, text, text, text) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
