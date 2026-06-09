-- 0329 — record_stream_event_safe: 30s dedup 을 flag-based 로 전환 (X6.47, Tier 3.3)
--
-- 분석 보고서 Tier 3.3:
--   현재 record_stream_event_safe 의 30s dedup 만 유일하게 rejection-based:
--     if v_identity_match then
--       return jsonb_build_object('ok', false, 'reason', 'dedup_30s');
--     end if;
--   다른 모든 exclusion (unreleased / admin_preview / artist_preview / self_play /
--   daily_user_track_cap / muted_play / low_player_volume) 은 row 를 INSERT 하면서
--   exclusion_reason 으로 flag — admin 이 후속 분석 가능.
--
-- 문제:
--   1) audit gap — dedup 거부 건수 admin 에서 안 보임 (record 자체 없음)
--   2) over-aggressive — admin_preview/artist_preview/self_play 후 30s 내
--      진짜 user play 가 들어와도 dedup 으로 rejection. 첫 play 가 ineligible 이면
--      후속 eligible play 는 정당하게 받아야 함.
--
-- 변경 (X6.47):
--   1) dedup 대상 좁힘 — 직전 30s 내 eligible_for_payout=true 인 milestone_30s 만 검사
--      (admin/artist/self/muted preview 는 dedup trigger 안 함)
--   2) dedup 매치 시 flag-based: INSERT row + eligible_for_payout=false +
--      exclusion_reason='dedup_30s_window' (rejection 폐기)
--   3) exclusion_reason CHECK 에 'dedup_30s_window' 추가
--   4) return jsonb 에 ok=true 유지 — client 는 더 이상 dedup 으로 reason='dedup_30s' 받지 않음
--
-- 호환:
--   - 옛 client 가 ok=false reason=dedup_30s 보던 코드는 그냥 안 발생함 (분기 dead)
--   - 정산 영향: dedup 된 row 가 eligible_for_payout=false 라서 settlement 합산에서 자동 제외
--     (X6.44 admin_generate_monthly_settlement 의 stream count 는 eligible_for_payout=true 만 카운트)
--   - admin_streaming_overview / admin_top_streaming_tracks 는 total count 가 약간 증가 가능
--     (이전엔 reject 됐던 row 가 이제 record 됨, 다만 eligible_count 는 동일)

alter table public.stream_events
  drop constraint if exists stream_events_exclusion_reason_check;

alter table public.stream_events
  add constraint stream_events_exclusion_reason_check
  check (
    exclusion_reason is null or exclusion_reason = any (array[
      'unreleased', 'admin_preview', 'artist_preview', 'self_play',
      'daily_user_track_cap', 'muted_play', 'low_player_volume',
      'dedup_30s_window'
    ])
  );

create or replace function public.record_stream_event_safe(
  p_track_id uuid, p_session_id text, p_event_type text,
  p_listened_seconds integer default 0, p_completed boolean default false,
  p_playlist_id uuid default null::uuid, p_anonymous_id text default null::text,
  p_source_page text default null::text, p_user_agent text default null::text,
  p_player_volume numeric default null::numeric, p_player_muted boolean default null::boolean
)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
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

  -- eligible 1차 매핑 — 우선순위: unreleased > admin_preview > artist_preview > self_play
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

  -- X6.47 30s dedup — flag-based (eligible 인 prior play 가 있을 때만 dedup 처리)
  -- 이전: rejection-based, 모든 prior milestone 검사 (admin_preview 도 user_play 차단)
  -- 변경: 현재 row 가 eligible 일 때만 dedup 가능 + 직전 eligible_for_payout=true milestone 만 검사
  if v_eligible and p_event_type = 'milestone_30s' then
    if v_uid is not null then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and user_id = v_uid
          and event_type = 'milestone_30s'
          and eligible_for_payout = true
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
      select exists (
        select 1 from public.stream_events
        where track_id = p_track_id and anonymous_id = p_anonymous_id
          and event_type = 'milestone_30s'
          and eligible_for_payout = true
          and created_at > now() - interval '30 seconds'
      ) into v_identity_match;
    else v_identity_match := false; end if;
    if v_identity_match then
      v_eligible := false; v_reason := 'dedup_30s_window';
    end if;
  end if;

  -- 24h cap (마지막 단계, 이미 eligible 인 경우만 — dedup 으로 이미 ineligible 면 skip)
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

grant execute on function public.record_stream_event_safe(uuid, text, text, integer, boolean, uuid, text, text, text, numeric, boolean) to anon, authenticated;
