-- 0533 — 감시 기기가 꺼진 뒤 "매장이 실제로 조용한가" 를 따로 본다
--
-- 사고: 2026-10-01 숙대점 (르하임스터디카페s 워크라운지 숙대점, Windows 일체형 PC)
--   05:19:22  브랜드 플레이어에서 '나가기' → 확인 (pause + navigate('/')).
--             같은 탭·같은 세션(e4b617f9), 리로드 없음.
--   05:22     incident 16f7ccd4 열림 (silence) · 05:24 DOWN 알림 — 여기까지는 정상.
--   05:36:04  같은 PC 홈 화면(/)에서 재생 재개 → stream_sessions_v2 player_type=USER.
--             매장은 소리가 났지만 incident 는 감시 기기(브랜드 세션) 기준이라 계속 열림.
--   11:24     리마인더 "음악이 362분째 멈춰 있습니다" — 사실이 아니었다(재생 중).
--   12:44:56  #583 배포 → 곡 경계 자동 리로드 → 자동재생 없음 → 진짜 무음 시작.
--             incident 가 이미 열려 있어 **아무 신호도 나가지 않았다.**
--   17:24     두 번째 리마인더(마지막). 17:3x 알바생이 발견해 재생. 무음 약 4시간 50분.
--
-- 원인: 열린 incident 는 감시 기기 하나만 본다(0528, 의도된 설계). 그 기기가 꺼진 뒤
--       같은 매장이 다른 화면으로 재생하다 멈추는 경우를 볼 눈이 없었다.
--
-- ── 고치는 방법 ────────────────────────────────────────────────────────────
-- incident 판정·해소 규칙은 **바꾸지 않는다.** 0528 FALSE RECOVERY 방지는 그대로다 —
-- 다른 화면 재생은 incident 를 닫지 않는다.
--
-- silence incident 가 열려 있는 동안만, 같은 매장 계정(user_id)의 stream_sessions_v2
-- 최신 heartbeat 를 본다(player_type 무관). 0522 가 이 테이블을 생존 판정에서 뺀
-- 이유(옛 탭이 죽은 매장을 ONLINE 으로 붙잡음)는 여기 해당하지 않는다 — 이 값은
-- 무엇도 ONLINE 으로 만들지 않고, 알림 문구와 "그것마저 멈췄다" 경보에만 쓴다.
--
--   • 꺼짐 → 켜짐 (180초 안 신호): [참고] 다른 화면에서 재생 중 — 정보 알림 1회
--   • 켜짐 → 꺼짐 (300초 무신호)   : [긴급] 다른 화면 재생도 멈췄습니다 — DOWN 과 같은 등급
--                                    리마인더 주기도 여기서 다시 센다(새 무음이다)
--   • 다른 화면 재생 중에는 "음악이 N분째 멈춰 있습니다" 리마인더를 보내지 않는다.
--
-- 함께: 진단 이벤트 'player_exit' — 브랜드 플레이어 '나가기' 를 기록한다.
--   05:19 은 이번에 코드 경로를 하나씩 지워서야 '나가기' 로 특정했다. 다음에는 기록으로
--   본다. 첫 DOWN 알림 문구에 "매장에서 나가기를 눌렀습니다 (HH:MI)" 로 실린다.
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • silence / stalled / frozen 판정 경계값 무변경. incident 해소 규칙 무변경.
--   • _brand_player_liveness 무변경. 어떤 명령도 보내지 않는다.

-- ----------------------------------------------------------------------------
-- 1) 진단 이벤트 CHECK — player_exit 추가 (15종 → 16종)
--    log_store_playback_diagnostic 은 CHECK 위반을 조용히 삼킨다. 빼먹으면 소리 없이 사라진다.
-- ----------------------------------------------------------------------------
alter table public.store_playback_diagnostics
  drop constraint if exists store_playback_diagnostics_event_check;

alter table public.store_playback_diagnostics
  add constraint store_playback_diagnostics_event_check check (event in (
    'session_start', 'page_frozen', 'page_resumed', 'page_hidden',
    'autoplay_blocked', 'autoplay_recovered', 'track_cut_short', 'playback_stalled',
    'update_pending', 'update_activated', 'update_blocked',   -- 22
    'sw_controllerchange',                                    -- 24
    'audio_frozen',                                           -- 25
    'app_error',                                              -- 27 전역 예외
    'shell_health',                                           -- 27 셸 생존
    'player_execution_stale',                                 -- 29 플레이어 실행 상실
    'player_exit'                                             -- 0533 브랜드 플레이어 '나가기'
  ));

-- ----------------------------------------------------------------------------
-- 2) 감지 — 0527 본문 + 다른 화면 재생 추적
--    시그니처·권한은 0527 과 같다. 바뀐 곳은 "0533" 주석이 붙은 블록뿐이다.
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
  -- 0533 — 감시 기기가 죽은 동안 같은 매장 계정이 다른 화면에서 내는 소리.
  v_else_at timestamptz;
  v_else_type text;
  v_else_prev boolean;
  v_else_now boolean;
  v_exit_at timestamptz;
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

      -- 0533 ★ 다른 화면 재생 추적 (silence 만).
      --   incident 의 판정·해소는 그대로 감시 기기 기준이다(0528). 이 값은 incident 를
      --   닫지 않는다 — "감시 기기는 죽었지만 매장은 지금 소리가 나는가" 만 따로 본다.
      --   2026-10-01 숙대점: 05:19 브랜드 플레이어 '나가기' → 05:36 홈 화면에서 재생
      --   → 12:44 재생 멈춤 → 17:3x 알바생이 발견. incident 는 05:22 부터 열려 있었고
      --   12:44 의 진짜 무음은 아무 신호도 만들지 못했다.
      if v_detection = 'silence' then
        select s.last_heartbeat_at,
               case s.player_type when 'USER'  then '홈/일반 화면'
                                  when 'STORE' then '매장 모드 플레이어'
                                  when 'BRAND' then '브랜드 플레이어(다른 기기)'
                                  else s.player_type end
          into v_else_at, v_else_type
          from public.stream_sessions_v2 s
         where s.user_id = b.user_id
           and s.last_heartbeat_at > now() - interval '1 hour'
         order by s.last_heartbeat_at desc limit 1;
        v_else_prev := coalesce((v_inc.context->>'store_audio_elsewhere')::boolean, false);
        -- 히스테리시스: 켜짐은 180초 안 신호, 꺼짐은 300초 무신호. 곡 경계로 깜빡이지 않는다.
        v_else_now := case
          when v_else_at is not null and v_else_at > now() - make_interval(secs => p_suspected_seconds) then true
          when v_else_at is null or v_else_at <= now() - make_interval(secs => p_down_seconds) then false
          else v_else_prev end;
        select max(d.created_at) into v_exit_at
          from public.store_playback_diagnostics d
         where d.user_id = b.user_id and d.event = 'player_exit'
           and d.created_at >= coalesce(v_inc.opened_at, now()) - interval '10 minutes';

        update public.brand_player_incidents
           set context = context || jsonb_build_object(
                 'store_audio_elsewhere', v_else_now,
                 'store_audio_last_at', v_else_at,
                 'store_audio_player_type', v_else_type,
                 'player_exit_at', v_exit_at)
         where id = v_inc.id
         returning * into v_inc;

        -- 첫 DOWN 알림 이후의 전환만 따로 알린다(첫 알림 문구에는 아래에서 덧붙인다).
        if v_inc.down_notified_at is not null and v_else_now is distinct from v_else_prev then
          if v_else_now then
            perform public._notify_brand_player_alert(jsonb_build_object(
              'event', 'brand_player_audio_elsewhere', 'severity', 'info',
              'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
              'store_user_id', b.user_id, 'player_type', v_else_type,
              'text', format('[참고] %s 감시 기기는 아직 꺼져 있지만, 같은 계정이 다른 화면(%s)에서 재생 중입니다. 이 재생이 멈추면 다시 알립니다.',
                             v_who, coalesce(v_else_type, '-'))));
          else
            insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
            values ('brand_player_down', 'error',
                    format('[긴급] %s — 다른 화면 재생도 멈췄습니다 (매장 무음)', v_who),
                    format('감시 기기는 %s분째 꺼져 있고, 대신 재생하던 %s 도 %s 이후 신호가 없습니다',
                           round(extract(epoch from (now() - v_inc.opened_at))/60.0),
                           coalesce(v_else_type, '-'),
                           to_char(v_else_at at time zone 'Asia/Seoul', 'HH24:MI')),
                    jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                       'store', b.store_label, 'store_user_id', b.user_id,
                                       'detection', 'silence_elsewhere'), 0, now());
            perform public._notify_brand_player_alert(jsonb_build_object(
              'event', 'brand_player_down', 'severity', 'critical',
              'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
              'store_user_id', b.user_id, 'detection', 'silence_elsewhere',
              'session_id', b.session_id, 'device', b.device,
              'last_signal_at', v_else_at, 'detected_at', now(),
              'text', format('[긴급] %s 다른 화면(%s) 재생도 %s 이후 멈췄습니다 — 매장 무음 가능성.',
                             v_who, coalesce(v_else_type, '-'),
                             coalesce(to_char(v_else_at at time zone 'Asia/Seoul', 'HH24:MI'), '-'))));
            -- 새 무음이므로 리마인더 주기를 여기서 다시 센다.
            update public.brand_player_incidents
               set reminded_at = now(), reminder_count = 0 where id = v_inc.id;
            v_inc.reminded_at := now(); v_inc.reminder_count := 0;
            v_notified := v_notified + 1;
          end if;
        end if;
      else
        v_else_now := false; v_exit_at := null;
      end if;

      -- DOWN Slack 은 한 outage 당 정확히 1회.
      if v_inc.down_notified_at is null then
        v_label := case
          when v_detection = 'stalled' then '음악이 멈췄습니다 (화면은 켜져 있음)'
          when v_detection = 'frozen'  then
            format('화면은 살아 있는데 소리가 %s분 이상 나오지 않습니다 (재생 표시만 유지)',
                   round(b.audio_progress_age_seconds/60.0))
          when v_exit_at is not null then
            format('매장에서 플레이어 ''나가기''를 눌렀습니다 (%s) — heartbeat %s분 끊김',
                   to_char(v_exit_at at time zone 'Asia/Seoul', 'HH24:MI'),
                   round(b.heartbeat_age_seconds/60.0))
          else format('플레이어 heartbeat 가 %s분 이상 끊겼습니다 — 브라우저/앱 중지 가능성',
                      round(b.heartbeat_age_seconds/60.0)) end;
        if v_else_now then
          v_label := v_label || format(' · 단, 다른 화면(%s)에서는 재생 중', coalesce(v_else_type, '-'));
        end if;

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
        -- 0533: 다른 화면에서 소리가 나는 동안은 "음악이 멈춰 있다" 는 리마인더를 보내지 않는다
        --       (2026-10-01 11:24 숙대점 리마인더는 실제로는 재생 중이었다).
        if not v_else_now
           and v_inc.reminder_count < p_max_reminders
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
