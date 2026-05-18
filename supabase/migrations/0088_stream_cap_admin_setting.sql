-- 0088 — daily_user_track_cap 외부화 (admin_settings)
--
-- 정책:
-- - 설정 키: stream_daily_user_track_cap (jsonb int)
-- - 기본값: 3 (seed)
-- - record_stream_event_safe 는 호출 시점에 설정값 읽음
-- - 설정 없거나 비정상값 (NULL / 0 이하 / int 파싱 실패) 이면 fallback 3
-- - 변경은 변경 이후 신규 이벤트부터 적용 (기존 이벤트 재분류 X)

INSERT INTO public.admin_settings (key, value, description)
VALUES (
  'stream_daily_user_track_cap',
  '3'::jsonb,
  '같은 user+track 의 rolling 24h 동안 eligible 정산 인정 최대 회수 (기본 3). NULL/비정상 시 fallback 3'
)
ON CONFLICT (key) DO NOTHING;

-- admin_settings_authed_read_safe 정책에 신규 키 추가 (authenticated 읽기 허용)
DROP POLICY IF EXISTS admin_settings_authed_read_safe ON public.admin_settings;
CREATE POLICY admin_settings_authed_read_safe ON public.admin_settings
  FOR SELECT TO authenticated
  USING (key IN ('default_immediate_release','stream_daily_user_track_cap'));

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
  v_daily_limit int := 3;
  v_cap_setting jsonb;
  v_cap_parsed int;
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

  -- 0088 — admin_settings 에서 cap 읽기 (fallback 3)
  select value into v_cap_setting from public.admin_settings
  where key='stream_daily_user_track_cap';
  if v_cap_setting is not null then
    begin
      v_cap_parsed := (v_cap_setting)::text::int;
      if v_cap_parsed is not null and v_cap_parsed > 0 then
        v_daily_limit := v_cap_parsed;
      end if;
    exception when others then null;
    end;
  end if;

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
