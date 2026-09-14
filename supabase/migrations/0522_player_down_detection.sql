-- 0522 — 서버가 스스로 "소리가 끊긴 것"을 알아챈다 (heartbeat silence 기반)
--
-- 사고: 2026-09-14 09:46:31 ~ 09:52:22 KST 숙대점 5분 51초 무음.
--       점주가 "탭이 중지된 상태"를 보고 직접 복구. Slack 알림 0건.
--
-- 왜 놓쳤나 (코드 경로):
--   1) _brand_player_session_health: last_seen_at 이 10분을 넘겨야 'offline'.
--      09:50 크론 시점 heartbeat 나이는 3분 29초 → status='playing'.
--   2) detect_brand_player_incidents: v_bad := (not any_playing) and (...).
--      any_playing 이 true 라 1번에서 이미 탈락.
--   3) 설사 offline 이 됐어도 p_offline_grace_minutes=20 이 다시 20분을 요구한다.
--   4) 크론은 5분 주기(srr-brand-player-health).
--   ⇒ heartbeat 가 완전히 죽어도 Slack 까지 최소 20~25분. 6분짜리 사고는
--      설계상 보이지 않았다. 감지 로직이 고장난 게 아니라 기준이 굵었던 것이다.
--
-- 전제 — 클라이언트는 자기 죽음을 보고할 수 없다.
--   탭/PWA 프로세스가 죽으면 Flight Recorder flush 도, pagehide/beforeunload 도,
--   Realtime unsubscribe 도 오지 않는다. 유일하게 믿을 수 있는 신호는
--   **heartbeat 의 부재**이고, 그 판단은 서버만 할 수 있다.
--
-- 판정 규칙의 정본은 src/lib/playerDownDetection.ts 이고 테스트로 고정돼 있다.
-- 여기서는 같은 경계값을 SQL 로 집행한다.

-- ----------------------------------------------------------------------------
-- 1) incident 에 2단계 상태를 기록할 칸
-- ----------------------------------------------------------------------------
alter table public.brand_player_incidents
  add column if not exists suspected_at      timestamptz,
  add column if not exists down_notified_at  timestamptz,
  add column if not exists detection         text;

comment on column public.brand_player_incidents.suspected_at is
  'heartbeat 가 SUSPECTED_DOWN(180초) 을 넘긴 시각. 이 단계에서는 Slack 을 보내지 않는다.';
comment on column public.brand_player_incidents.down_notified_at is
  'DOWN Slack 을 보낸 시각. 한 outage 당 정확히 1회 — 중복 알림을 막는 잠금이다.';
comment on column public.brand_player_incidents.detection is
  '무엇이 이 건을 열었는가: silence(heartbeat 부재) | stalled(heartbeat 는 오는데 곡이 안 넘어감).';

-- ----------------------------------------------------------------------------
-- 2) 매장별 "가장 싱싱한 신호의 나이"
--
--    두 갈래를 모두 본다:
--      brand_player_sessions.last_seen_at    — 60초 주기 제어 heartbeat
--      stream_sessions_v2.last_heartbeat_at  — 10초 주기 재생 검증 heartbeat
--    하나가 막혀도 다른 하나가 살아 있으면 플레이어는 살아 있다. 둘 다 조용해야
--    무음이다. (오탐을 줄이는 쪽으로만 작동한다.)
--
--    revoked 세션은 제외한다 — 옛 세션의 마지막 heartbeat 가 현재 세션의 죽음을
--    가려버리면 안 된다(테스트 시나리오 10).
-- ----------------------------------------------------------------------------
create or replace function public._brand_player_liveness(p_minutes integer default 1440)
returns table(
  brand_id uuid, brand_name text, user_id uuid, store_label text,
  heartbeat_age_seconds integer, last_signal_at timestamptz,
  session_id uuid, device text, current_track_title text,
  seconds_on_current_track integer, stall_threshold_seconds integer,
  playback_expected boolean, monitoring_exempt boolean
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with live as (
    -- 제어 heartbeat (revoked 제외)
    select bps.user_id, bps.last_seen_at as sig
      from public.brand_player_sessions bps
     where bps.revoked_at is null
       and bps.last_seen_at > now() - make_interval(mins => greatest(1, p_minutes))
    union all
    -- 재생 검증 heartbeat (BRAND 플레이어만)
    select ss.user_id, ss.last_heartbeat_at
      from public.stream_sessions_v2 ss
     where ss.player_type = 'BRAND'
       and ss.last_heartbeat_at > now() - make_interval(mins => greatest(1, p_minutes))
  ),
  freshest as (
    select l.user_id, max(l.sig) as last_signal_at
      from live l group by l.user_id
  ),
  rep as (
    -- 매장당 한 줄: heartbeat 가 가장 싱싱한 세션을 대표로 쓴다.
    select distinct on (h.user_id) h.*
      from public._brand_player_session_health(greatest(1, p_minutes)) h
     order by h.user_id, h.seconds_since_heartbeat asc
  )
  select r.brand_id, r.brand_name, r.user_id, r.store_label,
         extract(epoch from (now() - f.last_signal_at))::int,
         f.last_signal_at,
         r.session_id, r.device, r.current_track_title,
         r.seconds_on_current_track, r.stall_threshold_seconds,
         coalesce((public.resolve_brand_playback_window(r.brand_id)->>'should_play')::boolean, true),
         exists (select 1 from public.brand_player_monitoring_exempt e
                  where e.store_user_id = r.user_id)
    from rep r
    join freshest f on f.user_id = r.user_id
$$;

comment on function public._brand_player_liveness(integer) is
  '매장별 가장 싱싱한 heartbeat 의 나이(초). 제어 heartbeat 와 재생 검증 heartbeat 중 최신값을 쓴다.';

revoke all on function public._brand_player_liveness(integer) from public, anon;

-- ----------------------------------------------------------------------------
-- 3) 감지 — 2단계 + 무음 기준
--
--    ONLINE           heartbeat < 180초
--    SUSPECTED_DOWN   >= 180초 (3회 결측) — incident 만 연다. Slack 없음.
--    DOWN             >= 300초 (5회 결측) — Slack 1회.
--
--    기존 'stalled'(heartbeat 는 오는데 곡이 안 넘어감) 경로는 그대로 둔다.
--    그건 다른 고장이고, 없애면 관측을 잃는다.
--
--    영업 종료(resolve_brand_playback_window.should_play=false)와 감시 제외
--    계정은 아무리 조용해도 장애로 올리지 않는다.
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
  v_label text; v_who text;
  v_down_minutes numeric;
begin
  -- Recovery Console 딥링크는 여기서 만들지 않는다.
  -- dispatch-admin-notifications 가 _shared/recoveryConsoleLink.ts 의 허용 호스트
  -- 목록으로 만든다(open redirect 방지). SQL 이 URL 을 따로 조립하면 규칙이 두 벌로
  -- 갈라지고, 약한 쪽이 남는다. 여기서 할 일은 context 에 store_user_id 를 싣는 것뿐.

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
    elsif b.seconds_on_current_track >= b.stall_threshold_seconds then
      -- heartbeat 는 오는데 곡이 안 넘어간다 — 기존 경로 유지.
      v_liveness := 'DOWN'; v_detection := 'stalled';
    else
      v_liveness := 'ONLINE'; v_detection := null;
    end if;

    v_who := format('%s · %s', b.brand_name, coalesce(b.store_label, '(계정 미상)'));

    select * into v_inc from public.brand_player_incidents
     where brand_id = b.brand_id and store_user_id = b.user_id and resolved_at is null limit 1;

    -- ---- DOWN ---------------------------------------------------------------
    if v_liveness = 'DOWN' then
      if v_inc.id is null then
        insert into public.brand_player_incidents
          (brand_id, brand_name, store_user_id, store_label, session_id, status,
           context, healthy_checks, detection, suspected_at)
        values (b.brand_id, b.brand_name, b.user_id, b.store_label, b.session_id,
                case when v_detection = 'stalled' then 'stalled' else 'offline' end,
                jsonb_build_object('device', b.device, 'track', b.current_track_title,
                                   'seconds_since_heartbeat', b.heartbeat_age_seconds,
                                   'detection', v_detection), 0, v_detection, now())
        returning * into v_inc;
        v_opened := v_opened + 1;
      else
        update public.brand_player_incidents
           set last_checked_at = now(), healthy_checks = 0,
               status = case when v_detection = 'stalled' then 'stalled' else 'offline' end,
               store_label = coalesce(b.store_label, store_label),
               detection = coalesce(detection, v_detection),
               context = context || jsonb_build_object(
                 'device', b.device, 'track', b.current_track_title,
                 'seconds_since_heartbeat', b.heartbeat_age_seconds)
         where id = v_inc.id;
        v_updated := v_updated + 1;
      end if;

      -- DOWN Slack 은 한 outage 당 정확히 1회.
      if v_inc.down_notified_at is null then
        v_label := case when v_detection = 'stalled'
                        then '음악이 멈췄습니다 (화면은 켜져 있음)'
                        else format('플레이어 heartbeat 가 %s분 이상 끊겼습니다 — 브라우저/앱 중지 가능성',
                                    round(b.heartbeat_age_seconds/60.0)) end;

        insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
        values ('brand_player_down', 'error',
                format('[긴급] %s — %s', v_who, v_label),
                format('기기 %s · 마지막 신호 %s초 전 · 현재 곡 %s',
                       b.device, b.heartbeat_age_seconds, coalesce(b.current_track_title,'-')),
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
          'last_signal_at', b.last_signal_at, 'detected_at', now(),
          'store_user_id', b.user_id,
          'text', format('[긴급] %s %s (기기 %s · 마지막 신호 %s초 전 · 곡 %s)',
                         v_who, v_label, b.device, b.heartbeat_age_seconds,
                         coalesce(b.current_track_title,'-'))));

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
      if v_inc.id is null then
        insert into public.brand_player_incidents
          (brand_id, brand_name, store_user_id, store_label, session_id, status,
           context, healthy_checks, detection, suspected_at)
        values (b.brand_id, b.brand_name, b.user_id, b.store_label, b.session_id, 'offline',
                jsonb_build_object('device', b.device, 'track', b.current_track_title,
                                   'seconds_since_heartbeat', b.heartbeat_age_seconds,
                                   'detection', 'silence', 'stage', 'suspected'), 0, 'silence', now())
        returning * into v_inc;
        v_suspected := v_suspected + 1;
      else
        update public.brand_player_incidents
           set last_checked_at = now(), healthy_checks = 0,
               context = context || jsonb_build_object(
                 'seconds_since_heartbeat', b.heartbeat_age_seconds)
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
        -- 알리지도 않은 장애의 "복구됐습니다" 는 소음일 뿐이다.
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
            -- 원격 복구 명령이 실제로 완료된 기록이 있을 때만 automatic 이라 쓴다.
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

revoke all on function public.detect_brand_player_incidents(integer, integer, integer, integer) from public, anon;

-- 옛 시그니처(20분 grace)는 남겨두면 크론이나 운영자가 실수로 부를 수 있다.
drop function if exists public.detect_brand_player_incidents(integer, integer, integer);

-- ----------------------------------------------------------------------------
-- 4) 크론 — 5분에서 1분으로. 300초 임계는 1분 주기여야 의미가 있다.
--    (5분 주기면 최악의 경우 300+300=600초까지 늦어진다.)
-- ----------------------------------------------------------------------------
select cron.alter_job(
  (select jobid from cron.job where jobname = 'srr-brand-player-health'),
  schedule => '* * * * *');
