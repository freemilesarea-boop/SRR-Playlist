-- 0527 — 클라이언트는 살아 있는데 소리만 멎은 상태를 서버가 본다 (AUDIO_PIPELINE_FROZEN)
--
-- 사고: 2026-09-15 12:17~12:44 KST 숙대점(르하임스터디카페s 워크라운지 숙대점,
--       Android 10 / SamsungBrowser 30). 약 27분, 26곡 연속.
--       paused=false / readyState=4 / networkState=1 / currentTime 0.02~0.05 고정.
--       마지막에 MediaError code=3(DECODE). 점주가 "화면은 바뀌는데 소리가 안 나요".
--
-- 서버는 27분 내내 **정상**이라고 답했다. 왜 셋 다 놓쳤는지:
--
--   1) silence 경로 — heartbeat 는 60초마다 멀쩡히 도착했다. heartbeat_age 는
--      한 번도 180초를 넘지 않았다. 프로세스는 살아 있었으니 당연하다.
--
--   2) stalled 경로 — 판정 기준은 seconds_on_current_track >= stall_threshold
--      이고 stall_threshold 는 max(곡 길이 x 2, 480초) 다. 그런데 이 장애는
--      36~63초마다 **곡을 건너뛰었다**. current_track_started_at 이 계속 새로
--      찍혔으니 seconds_on_current_track 은 480초 근처에도 못 갔다.
--      곡이 계속 바뀌는 무음은 stall 정의에 애초에 잡히지 않는다.
--
--   3) last_audio_progress_at — 이건 원래 이 상황을 위한 칸이었다(0524).
--      그런데 클라이언트가 **곡이 바뀌었다는 사실만으로** 이 시각을 갱신했고,
--      얼어붙은 엘리먼트의 0 → 0.02 지터도 진행으로 셌다. 그래서 이 값마저
--      27분 내내 싱싱했다. 클라이언트 쪽 수정은 mediaProgress.ts 에 있다.
--
-- 즉 서버에는 "클라이언트는 살아 있는데 타임라인이 안 간다" 는 칸이 없었다.
-- 이 마이그레이션이 그 칸을 만든다.
--
-- ── 하지 않는 것 ────────────────────────────────────────────────────────────
--   • 근본 원인을 단정하지 않는다. Samsung 디코더 / blob 손상 / 엘리먼트 오염
--     중 무엇인지 아직 모른다. 여기서는 **관측과 알림**만 만든다.
--   • silence / stalled 경로를 건드리지 않는다. 둘 다 실전에서 작동 중이다.
--   • 어떤 복구 명령도 보내지 않는다. 자동 원격 복구는 이 Phase 범위가 아니다.
--   • verified_seconds 를 개명하지 않는다 — 정산(0511/0515)이 읽는 칸이다.
--     아래 8) 에서 의미만 정확히 박아둔다.

-- ----------------------------------------------------------------------------
-- 1) 진단 이벤트 CHECK 를 실제 코드와 맞춘다  ★ 이번 감사에서 나온 별개의 결함
--
--    Phase 24 에서 "배포는 자동으로 적용되는데 update_* 텔레메트리가 전 매장
--    0건" 이라는 결함을 남겨뒀다. 원인이 여기 있었다.
--
--    store_playback_diagnostics.event 의 CHECK 는 0512 의 8개에서 멈춰 있고,
--    그 뒤 클라이언트가 추가한 update_pending / update_activated / update_blocked
--    (22) 와 sw_controllerchange (24) 는 **한 번도 허용된 적이 없다.**
--    log_store_playback_diagnostic 은 `exception when others then return` 이라
--    CHECK 위반을 조용히 삼킨다 — 그래서 에러 한 줄 없이 0건이었다.
--    실제로 30일치를 세어보면 저 5종은 정확히 0건이고 나머지 6종만 남아 있다.
--
--    Phase 24 가 keepalive beacon 을 넣은 것은 옳았지만(네비게이션 취소는 진짜
--    문제다) 그것만으로는 절대 고쳐지지 않았을 결함이다. 두 번째 원인이 있었다.
--
--    그리고 이번 Phase 의 audio_frozen 도 고치지 않으면 같은 자리에서 삼켜진다.
--
--    ※ CHECK 를 넓히는 것은 되돌리기 쉽다(좁히기만 하면 된다). 기존 행은 전부
--      새 목록의 부분집합이라 검증 실패가 날 수 없다.
-- ----------------------------------------------------------------------------
alter table public.store_playback_diagnostics
  drop constraint if exists store_playback_diagnostics_event_check;

alter table public.store_playback_diagnostics
  add constraint store_playback_diagnostics_event_check check (event in (
    'session_start',
    'page_frozen',
    'page_resumed',
    'page_hidden',
    'autoplay_blocked',
    'autoplay_recovered',
    'track_cut_short',
    'playback_stalled',
    -- 22 — 업데이트 수명주기
    'update_pending',
    'update_activated',
    'update_blocked',
    -- 24 — 새 SW 가 이 문서를 넘겨받은 순간
    'sw_controllerchange',
    -- 25 — 오디오 파이프라인이 얼어붙은 순간 (정지 구간당 1회)
    'audio_frozen'
  ));

-- ----------------------------------------------------------------------------
-- 2) incident status 에 'frozen' 추가
--
--    이름은 기존 스키마 결을 따른다: detection 은 silence | stalled 에 frozen 을,
--    status 는 offline | stalled 에 frozen 을 더한다. 새 테이블을 만들지 않는다.
--    (admin_brand_player_health 의 status(playing|stalled|offline)는 다른 값이고
--     건드리지 않는다 — Recovery Console 이 그걸 읽는다.)
-- ----------------------------------------------------------------------------
alter table public.brand_player_incidents
  drop constraint if exists brand_player_incidents_status_check;

alter table public.brand_player_incidents
  add constraint brand_player_incidents_status_check
  check (status in ('stalled', 'offline', 'frozen'));

comment on column public.brand_player_incidents.detection is
  '무엇이 이 건을 열었는가: silence(heartbeat 부재) | stalled(heartbeat 는 오는데 곡이 안 넘어감) | frozen(heartbeat 도 오고 곡도 넘어가는데 미디어 타임라인이 안 간다).';

-- ----------------------------------------------------------------------------
-- 3) liveness 에 "마지막 진행 이후 몇 초" 를 싣는다
--
--    출처는 brand_player_sessions.last_audio_progress_at 하나뿐이다(0524).
--    _brand_player_session_health 는 건드리지 않고 canonical session 행에
--    같은 테이블을 id 로 다시 붙인다 — 0522 가 정한 session-scope 를 그대로 쓴다.
--
--    null 은 null 로 둔다. 0 으로 채우면 이 값을 보내지 않는 구버전 클라이언트가
--    전부 즉시 장애가 된다. "모른다" 와 "안 간다" 는 다르다.
-- ----------------------------------------------------------------------------
create or replace function public._brand_player_liveness(p_minutes integer default 1440)
returns table(
  brand_id uuid, brand_name text, user_id uuid, store_label text,
  heartbeat_age_seconds integer, last_signal_at timestamptz,
  session_id uuid, device text, current_track_title text,
  seconds_on_current_track integer, stall_threshold_seconds integer,
  playback_expected boolean, monitoring_exempt boolean,
  audio_progress_age_seconds integer, last_audio_progress_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  -- _brand_player_session_health 는 이미 revoked_at is null 로 거른다.
  with canonical as (
    select distinct on (h.user_id) h.*
      from public._brand_player_session_health(greatest(1, p_minutes)) h
     order by h.user_id, h.seconds_since_heartbeat asc
  )
  select c.brand_id, c.brand_name, c.user_id, c.store_label,
         c.seconds_since_heartbeat,
         c.last_seen_at,
         c.session_id, c.device, c.current_track_title,
         c.seconds_on_current_track, c.stall_threshold_seconds,
         coalesce((public.resolve_brand_playback_window(c.brand_id)->>'should_play')::boolean, true),
         exists (select 1 from public.brand_player_monitoring_exempt e
                  where e.store_user_id = c.user_id),
         case when bps.last_audio_progress_at is null then null
              else extract(epoch from (now() - bps.last_audio_progress_at))::integer end,
         bps.last_audio_progress_at
    from canonical c
    left join public.brand_player_sessions bps on bps.id = c.session_id
$$;

comment on function public._brand_player_liveness(integer) is
  '매장별 canonical session(revoked 제외, heartbeat 가 가장 싱싱한 것)과 그 heartbeat 나이(초), 그리고 마지막 미디어 진행 이후 경과(초). 생존 판정의 유일한 출처다.';

revoke all on function public._brand_player_liveness(integer) from public, anon, authenticated;
grant execute on function public._brand_player_liveness(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 4) 감지 — silence / stalled 에 frozen 을 더한다
--
--    frozen 판정 조건 (전부 참일 때만):
--      • heartbeat 는 싱싱하다        (heartbeat_age < p_suspected_seconds)
--        → 프로세스가 죽은 건 silence 가 이미 잡는다. 두 번 세지 않는다.
--      • last_audio_progress_at 이 있다 (null 이면 판정하지 않는다)
--      • 그 값이 p_suspected_seconds / p_down_seconds 를 넘겼다
--
--    임계값을 왜 silence 와 같은 180 / 300 으로 두는가 — 새 숫자를 만들지 않는다:
--
--      a) 클라이언트 자체 복구 사다리의 마지막 칸이 RELOAD_PAGE_AFTER_MS = 150초다
--         (stallWatchdog.ts). 180초는 그 사다리가 **끝까지 갔다가 실패한 뒤**에야
--         온다. 서버가 클라이언트보다 먼저 소리치지 않는다.
--      b) heartbeat 주기가 60초다. 180초 = heartbeat 3번이 연속으로 "진행 없음"
--         을 실어 왔다는 뜻이다 — silence 의 "3회 결측" 과 같은 셈법이다.
--      c) 이번 실제 장애는 27분(1,620초) 지속됐다. 300초에서 DOWN 이 뜬다.
--         한 곡이 잠깐 얼었다가 사다리로 복구되는 경우(최대 150초)는 180초에
--         닿지 못하므로 incident 가 되지 않는다.
--
--    남는 공백은 정직하게 적어둔다 — last_audio_progress_at 이 null 인 세션
--    (한 번도 진행한 적 없음: 자동재생 차단, 구버전 클라이언트)은 frozen 으로
--    잡지 않는다. 그 경우는 기존 stalled(곡이 안 넘어감) 경로가 본다.
--    "한 번도 소리 난 적 없음" 을 여기서 같이 처리하면 구버전 매장이 전부
--    오탐으로 터진다. 별도 문제로 남긴다.
-- ----------------------------------------------------------------------------
create or replace function public.detect_brand_player_incidents(
  p_suspected_seconds integer default 180,
  p_down_seconds      integer default 300,
  p_reminder_minutes  integer default 360,
  p_max_reminders     integer default 2
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  b record;
  v_inc public.brand_player_incidents;
  v_opened int := 0; v_resolved int := 0; v_reminded int := 0; v_updated int := 0;
  v_notified int := 0; v_suspected int := 0;
  v_exempt_closed int := 0;
  v_liveness text;
  v_detection text;
  v_status text;
  v_label text; v_who text;
  v_down_minutes numeric;
  v_frozen_reports int;
begin
  -- Recovery Console 딥링크는 여기서 만들지 않는다.
  -- dispatch-admin-notifications 가 _shared/recoveryConsoleLink.ts 의 허용 호스트
  -- 목록으로 만든다(open redirect 방지). 여기서 할 일은 context 에 store_user_id 를
  -- 싣는 것뿐.

  -- 감시 제외 계정에 열려 있던 건은 조용히 닫는다(복구 알림 없음).
  with closed as (
    update public.brand_player_incidents i
       set resolved_at = now(), last_checked_at = now(), resolve_notified_at = now()
     where i.resolved_at is null
       and exists (select 1 from public.brand_player_monitoring_exempt e
                    where e.store_user_id = i.store_user_id)
    returning 1
  )
  select count(*) into v_exempt_closed from closed;

  for b in select * from public._brand_player_liveness(1440) loop
    -- 상태 판정 — playerDownDetection.ts 의 resolveLiveness 와 같은 경계값.
    if b.monitoring_exempt or not b.playback_expected then
      v_liveness := 'ONLINE'; v_detection := null;
    elsif b.heartbeat_age_seconds >= p_down_seconds then
      v_liveness := 'DOWN'; v_detection := 'silence';
    elsif b.heartbeat_age_seconds >= p_suspected_seconds then
      v_liveness := 'SUSPECTED_DOWN'; v_detection := 'silence';
    elsif b.audio_progress_age_seconds is not null
          and b.audio_progress_age_seconds >= p_down_seconds then
      -- heartbeat 도 오고 곡도 넘어가는데 미디어 타임라인이 안 간다.
      -- 2026-09-15 숙대점이 정확히 이 모양이었다.
      v_liveness := 'DOWN'; v_detection := 'frozen';
    elsif b.audio_progress_age_seconds is not null
          and b.audio_progress_age_seconds >= p_suspected_seconds then
      v_liveness := 'SUSPECTED_DOWN'; v_detection := 'frozen';
    elsif b.seconds_on_current_track >= b.stall_threshold_seconds then
      -- heartbeat 는 오는데 곡이 안 넘어간다 — 기존 경로 유지.
      v_liveness := 'DOWN'; v_detection := 'stalled';
    else
      v_liveness := 'ONLINE'; v_detection := null;
    end if;

    v_status := case v_detection when 'stalled' then 'stalled'
                                 when 'frozen'  then 'frozen'
                                 else 'offline' end;

    v_who := format('%s · %s', b.brand_name, coalesce(b.store_label, '(계정 미상)'));

    select * into v_inc from public.brand_player_incidents
     where brand_id = b.brand_id and store_user_id = b.user_id and resolved_at is null limit 1;

    -- ---- DOWN ---------------------------------------------------------------
    if v_liveness = 'DOWN' then
      if v_inc.id is null then
        -- 클라이언트가 스스로 "얼었다" 고 보고한 횟수 — 서버 판정의 방증이다.
        -- 판정 근거가 아니라 기록이다. 이게 0 이어도 incident 는 열린다
        -- (구버전 클라이언트는 이 beacon 을 보내지 않는다).
        select count(*) into v_frozen_reports
          from public.store_playback_diagnostics d
         where d.user_id = b.user_id
           and d.event = 'audio_frozen'
           and d.created_at > now() - make_interval(secs => greatest(p_down_seconds, 1) * 4);

        insert into public.brand_player_incidents
          (brand_id, brand_name, store_user_id, store_label, session_id, status,
           context, healthy_checks, detection, suspected_at)
        values (b.brand_id, b.brand_name, b.user_id, b.store_label, b.session_id,
                v_status,
                jsonb_build_object('device', b.device, 'track', b.current_track_title,
                                   'seconds_since_heartbeat', b.heartbeat_age_seconds,
                                   'seconds_since_audio_progress', b.audio_progress_age_seconds,
                                   'frozen_reports', v_frozen_reports,
                                   'detection', v_detection), 0, v_detection, now())
        returning * into v_inc;
        v_opened := v_opened + 1;
      else
        update public.brand_player_incidents
           set last_checked_at = now(), healthy_checks = 0,
               status = v_status,
               store_label = coalesce(b.store_label, store_label),
               detection = coalesce(detection, v_detection),
               context = context || jsonb_build_object(
                 'device', b.device, 'track', b.current_track_title,
                 'seconds_since_heartbeat', b.heartbeat_age_seconds,
                 'seconds_since_audio_progress', b.audio_progress_age_seconds)
         where id = v_inc.id;
        v_updated := v_updated + 1;
      end if;

      -- DOWN Slack 은 한 outage 당 정확히 1회.
      if v_inc.down_notified_at is null then
        v_label := case
          when v_detection = 'stalled' then '음악이 멈췄습니다 (화면은 켜져 있음)'
          when v_detection = 'frozen'  then
            format('화면은 살아 있는데 소리가 %s분 이상 나오지 않습니다 (재생 표시만 유지)',
                   round(b.audio_progress_age_seconds/60.0))
          else format('플레이어 heartbeat 가 %s분 이상 끊겼습니다 — 브라우저/앱 중지 가능성',
                      round(b.heartbeat_age_seconds/60.0)) end;

        insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
        values ('brand_player_down', 'error',
                format('[긴급] %s — %s', v_who, v_label),
                case when v_detection = 'frozen'
                     then format('기기 %s · 마지막 진행 %s초 전 · heartbeat 는 %s초 전(정상) · 현재 곡 %s',
                                 b.device, b.audio_progress_age_seconds,
                                 b.heartbeat_age_seconds, coalesce(b.current_track_title,'-'))
                     else format('기기 %s · 마지막 신호 %s초 전 · 현재 곡 %s',
                                 b.device, b.heartbeat_age_seconds, coalesce(b.current_track_title,'-'))
                end,
                jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                   'store', b.store_label, 'store_user_id', b.user_id,
                                   'session_id', b.session_id, 'device', b.device,
                                   'detection', v_detection), 0, now());

        perform public._notify_brand_player_alert(jsonb_build_object(
          'event', 'brand_player_down', 'severity', 'critical',
          'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
          'session_id', b.session_id, 'status', v_inc.status, 'device', b.device,
          'track', b.current_track_title, 'detection', v_detection,
          'seconds_since_heartbeat', b.heartbeat_age_seconds,
          'seconds_since_audio_progress', b.audio_progress_age_seconds,
          'last_signal_at', b.last_signal_at, 'detected_at', now(),
          'store_user_id', b.user_id,
          'text', case when v_detection = 'frozen'
            then format('[긴급] %s %s (기기 %s · 마지막 진행 %s초 전 · 곡 %s)',
                        v_who, v_label, b.device, b.audio_progress_age_seconds,
                        coalesce(b.current_track_title,'-'))
            else format('[긴급] %s %s (기기 %s · 마지막 신호 %s초 전 · 곡 %s)',
                        v_who, v_label, b.device, b.heartbeat_age_seconds,
                        coalesce(b.current_track_title,'-')) end));

        update public.brand_player_incidents
           set notified_at = now(), down_notified_at = now() where id = v_inc.id;
        v_notified := v_notified + 1;
      else
        -- 계속 끊겨 있어도 매 분 다시 보내지 않는다. 장시간 건은 리마인더만.
        if v_inc.reminder_count < p_max_reminders
           and coalesce(v_inc.reminded_at, v_inc.opened_at) < now() - make_interval(mins => p_reminder_minutes) then
          v_down_minutes := round(extract(epoch from (now() - v_inc.opened_at))/60.0);
          perform public._notify_brand_player_alert(jsonb_build_object(
            'event', 'brand_player_down_reminder', 'severity', 'critical',
            'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
            'minutes_down', v_down_minutes,
            'text', format('[긴급·계속] %s 음악이 %s분째 멈춰 있습니다.', v_who, v_down_minutes)));
          update public.brand_player_incidents
             set reminded_at = now(), reminder_count = reminder_count + 1 where id = v_inc.id;
          v_reminded := v_reminded + 1;
        end if;
      end if;

    -- ---- SUSPECTED_DOWN -----------------------------------------------------
    elsif v_liveness = 'SUSPECTED_DOWN' then
      -- 아직 확정이 아니다. 기록만 남기고 Slack 은 참는다.
      -- 한 곡이 잠깐 얼었다가 사다리로 복구되는 경우가 여기서 걸러진다.
      if v_inc.id is null then
        insert into public.brand_player_incidents
          (brand_id, brand_name, store_user_id, store_label, session_id, status,
           context, healthy_checks, detection, suspected_at)
        values (b.brand_id, b.brand_name, b.user_id, b.store_label, b.session_id, v_status,
                jsonb_build_object('device', b.device, 'track', b.current_track_title,
                                   'seconds_since_heartbeat', b.heartbeat_age_seconds,
                                   'seconds_since_audio_progress', b.audio_progress_age_seconds,
                                   'detection', v_detection, 'stage', 'suspected'), 0, v_detection, now())
        returning * into v_inc;
        v_suspected := v_suspected + 1;
      else
        update public.brand_player_incidents
           set last_checked_at = now(), healthy_checks = 0,
               context = context || jsonb_build_object(
                 'seconds_since_heartbeat', b.heartbeat_age_seconds,
                 'seconds_since_audio_progress', b.audio_progress_age_seconds)
         where id = v_inc.id;
        v_updated := v_updated + 1;
      end if;

    -- ---- ONLINE -------------------------------------------------------------
    elsif v_inc.id is not null then
      if v_inc.healthy_checks + 1 >= 2 then
        v_down_minutes := round(extract(epoch from (now() - v_inc.opened_at))/60.0);
        update public.brand_player_incidents
           set resolved_at = now(), last_checked_at = now(),
               resolve_notified_at = now(), healthy_checks = v_inc.healthy_checks + 1
         where id = v_inc.id;

        -- DOWN 을 알린 적 없는 건(SUSPECTED 로만 끝남)은 조용히 닫는다.
        if v_inc.down_notified_at is not null then
          insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
          values ('brand_player_recovered', 'info',
                  format('%s — 음악 재생이 복구됐습니다', v_who),
                  format('%s분 만에 복구 · 현재 곡 %s', v_down_minutes, coalesce(b.current_track_title,'-')),
                  jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                     'store', b.store_label,
                                     'store_user_id', b.user_id), 0, now());

          perform public._notify_brand_player_alert(jsonb_build_object(
            'event', 'brand_player_recovered', 'severity', 'info',
            'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
            'minutes_down', v_down_minutes, 'track', b.current_track_title,
            'store_user_id', b.user_id,
            'seconds_on_current_track', b.seconds_on_current_track,
            -- 사람이 고쳤는지 자동 복구인지는 heartbeat 재개만으로 알 수 없다.
            'recovery', case when exists (
                 select 1 from public.brand_player_commands c
                  where c.store_user_id = b.user_id
                    and c.status = 'completed'
                    and c.completed_at >= v_inc.opened_at)
               then 'automatic' else 'unknown' end,
            'text', format('[복구] %s 음악이 다시 나옵니다 (%s분 중단).', v_who, v_down_minutes)));
          v_resolved := v_resolved + 1;
        end if;
      else
        update public.brand_player_incidents
           set healthy_checks = v_inc.healthy_checks + 1, last_checked_at = now()
         where id = v_inc.id;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'checked_at', now(),
    'opened', v_opened, 'suspected', v_suspected, 'notified', v_notified,
    'resolved', v_resolved, 'reminded', v_reminded, 'updated', v_updated,
    'exempt_closed', v_exempt_closed,
    'open_total', (select count(*) from public.brand_player_incidents where resolved_at is null));
end;
$fn$;

-- 권한 — 0522 와 동일하게 유지한다. create or replace 는 기존 ACL 을 보존하지만
-- 명시해두는 편이 안전하다(이 함수는 Slack HTTP POST 까지 쏜다).
revoke all on function public.detect_brand_player_incidents(integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.detect_brand_player_incidents(integer, integer, integer, integer)
  to service_role;

-- ----------------------------------------------------------------------------
-- 5) verified_seconds 의 뜻을 칸에 박아둔다 (개명하지 않는다)
--
--    T+12h 보고에서 이 값을 "검증된 재생 46,031초" 라고 불렀다. 틀렸다.
--    verify_stream_heartbeat_v2 는 currentTime 이 아니라 **벽시계**를 더한다:
--      least(now() - last_heartbeat_at, 15) 를, playing && visible && !muted
--      && volume >= 0.1 일 때마다. 전부 "재생하겠다는 의사 표시" 이지
--      "타임라인이 갔다" 도 "소리가 났다" 도 아니다.
--    2026-09-15 숙대점 27분 무음 동안에도 이 값은 정상 속도로 늘었다.
--
--    개명(session_alive_seconds)은 여기서 하지 않는다 — 이 칸은 정산 경로가
--    읽는다(0511 billing_coverage_gap, 0515 enterprise_payment_core_billing_link,
--    0514 admin_member_list.total_verified_seconds). 이름만 바꿔도 청구가 걸린다.
--    의미를 먼저 고정하고, 개명은 정산 영향 검토를 포함한 별도 작업으로 뺀다.
--
--    과거 데이터를 소급 재해석하지 않는다. 이 값은 **그때도 지금도** 세션 생존
--    시간이었다. 달라진 것은 우리가 그것을 뭐라고 부르는가뿐이다.
-- ----------------------------------------------------------------------------
comment on column public.stream_sessions_v2.verified_seconds is
  '세션이 살아 있던 시간(초). heartbeat 벽시계 누적 — playing && visible && !muted && volume>=0.1 인 동안 least(now()-last_heartbeat_at, 15) 를 더한다. **실제 소리가 났다는 증거가 아니다**: currentTime 이 얼어붙어도 이 값은 정상 속도로 는다(2026-09-15 숙대점). 정산 기준 값이므로 개명하지 않는다. 미디어 타임라인이 실제로 갔는지는 brand_player_sessions.last_audio_progress_at 을 본다.';
