-- 0089 — 플레이어 볼륨/뮤트 기반 정산 제외
--
-- 정책:
-- - audio.muted=true OR volume=0 → eligible=false, exclusion_reason='muted_play'
-- - 0 < volume < 0.1 → eligible=false, exclusion_reason='low_player_volume'
-- - raw stream_event 는 계속 적립 (record 거부 X)
-- - 가드 순서: unreleased / preview / self_play → muted → low_volume → dedup → daily_cap
-- - OS / 외부 스피커 볼륨은 감지 X — 웹 플레이어 내부 값만
--
-- 변경:
-- 1) stream_events.player_volume numeric(4,3) + player_muted boolean 컬럼
-- 2) exclusion_reason CHECK 확장: muted_play / low_player_volume
-- 3) record_stream_event_safe RPC 시그니처 확장 + 가드 추가
-- 4) admin_streaming_exclusion_breakdown 반환 jsonb 에 신규 reason 2종 포함

ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS player_volume numeric(4,3)
    CHECK (player_volume IS NULL OR (player_volume >= 0 AND player_volume <= 1)),
  ADD COLUMN IF NOT EXISTS player_muted boolean;

ALTER TABLE public.stream_events DROP CONSTRAINT IF EXISTS stream_events_exclusion_reason_check;
ALTER TABLE public.stream_events ADD CONSTRAINT stream_events_exclusion_reason_check
  CHECK (exclusion_reason IS NULL OR exclusion_reason IN (
    'unreleased','admin_preview','artist_preview','self_play',
    'daily_user_track_cap','muted_play','low_player_volume'
  ));

CREATE OR REPLACE FUNCTION public.record_stream_event_safe(
  p_track_id uuid, p_session_id text, p_event_type text,
  p_listened_seconds integer DEFAULT 0, p_completed boolean DEFAULT false,
  p_playlist_id uuid DEFAULT NULL, p_anonymous_id text DEFAULT NULL,
  p_source_page text DEFAULT NULL, p_user_agent text DEFAULT NULL,
  p_player_volume numeric DEFAULT NULL, p_player_muted boolean DEFAULT NULL
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
  v_vol numeric;
  v_muted boolean;
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

  -- admin_settings cap (0088)
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

  -- 볼륨 / 뮤트 정규화
  v_vol := p_player_volume;
  if v_vol is not null and (v_vol < 0 or v_vol > 1) then v_vol := null; end if;
  v_muted := coalesce(p_player_muted, false);

  -- eligible 1차 매핑 — unreleased > admin_preview > artist_preview > self_play
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

  -- 0089 — 플레이어 볼륨 / 뮤트 검사
  if v_eligible then
    if v_muted or (v_vol is not null and v_vol = 0) then
      v_eligible := false; v_reason := 'muted_play';
    elsif v_vol is not null and v_vol < 0.1 then
      v_eligible := false; v_reason := 'low_player_volume';
    end if;
  end if;

  -- 30s dedup — record 거부
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

  -- 24h cap (이미 eligible 인 경우만)
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
    source_page, user_agent, eligible_for_payout, exclusion_reason,
    player_volume, player_muted
  ) values (
    v_uid, nullif(btrim(p_anonymous_id),''), p_track_id, v_track.owner_user_id, p_playlist_id,
    p_session_id, coalesce(p_listened_seconds, 0), coalesce(p_completed, false), p_event_type,
    p_source_page, p_user_agent, v_eligible, v_reason,
    v_vol, v_muted
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true, 'event_id', v_event_id,
    'eligible_for_payout', v_eligible,
    'exclusion_reason', v_reason,
    'daily_user_track_count', v_daily_count,
    'daily_user_track_limit', v_daily_limit,
    'player_volume', v_vol,
    'player_muted', v_muted,
    'event_type', p_event_type
  );
end; $function$;
GRANT EXECUTE ON FUNCTION public.record_stream_event_safe(uuid, text, text, integer, boolean, uuid, text, text, text, numeric, boolean) TO anon, authenticated;

-- breakdown RPC 확장
CREATE OR REPLACE FUNCTION public.admin_streaming_exclusion_breakdown(p_days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role='admin') then
    raise exception 'admin only';
  end if;
  with bucket as (
    select exclusion_reason
    from public.stream_events
    where event_type = 'milestone_30s'
      and created_at > now() - ((p_days - 1) || ' days')::interval
  )
  select jsonb_build_object(
    'unreleased',           count(*) filter (where exclusion_reason='unreleased'),
    'admin_preview',        count(*) filter (where exclusion_reason='admin_preview'),
    'artist_preview',       count(*) filter (where exclusion_reason='artist_preview'),
    'self_play',            count(*) filter (where exclusion_reason='self_play'),
    'daily_user_track_cap', count(*) filter (where exclusion_reason='daily_user_track_cap'),
    'muted_play',           count(*) filter (where exclusion_reason='muted_play'),
    'low_player_volume',    count(*) filter (where exclusion_reason='low_player_volume'),
    'total_excluded',       count(*) filter (where exclusion_reason is not null),
    'total_eligible',       (
      select count(*) from public.stream_events
      where event_type='milestone_30s' and eligible_for_payout=true
        and created_at > now() - ((p_days - 1) || ' days')::interval
    ),
    'days', p_days
  ) into v from bucket;
  return v;
end; $function$;
REVOKE EXECUTE ON FUNCTION public.admin_streaming_exclusion_breakdown(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_streaming_exclusion_breakdown(int) TO authenticated;

NOTIFY pgrst, 'reload schema';
