-- ============================================================================
-- 0506_brand_player_incident_dedup.sql
-- Phase BRAND-PLAYER-INCIDENT-DEDUP-1
--
-- 문제: 0505 알림이 같은 매장에 대해 [긴급]/[복구] 를 반복 발송했다.
--   실측 (카공시대, 2026-09-04):
--     07:39:54 offline 열림 → 07:45:00 복구 → 07:50:00 stalled 열림 → 08:05:00 복구
--     → 08:05:00 offline 열림 …  25분 동안 알림 6건
--
-- 원인 3가지 (전부 감지 로직 결함 — 매장 문제가 아니다):
--
--   ① 세션 단위 incident.
--      매장 한 곳에 탭이 여러 개 떠 있으면(정상) 버려진 탭마다 따로 장애가 잡힌다.
--      운영자가 알고 싶은 것은 "카공시대에서 음악이 나오는가" 하나다.
--
--   ② stalled ↔ offline 전환이 "복구 후 재발" 로 처리됐다.
--      heartbeat 가 늦으면 offline, 도착하면 stalled — 같은 고장의 두 얼굴인데
--      상태가 바뀔 때마다 이전 incident 를 닫고(=복구 알림) 새로 열었다(=긴급 알림).
--
--   ③ 곡 전환 직후 8분의 판정 사각지대.
--      stall 임계값이 max(곡길이×2, 8분)이라, 리로드로 곡이 바뀌면 실제로 소리가
--      안 나도 8분 동안은 'playing' 으로 보인다. 그 사이 검사가 걸리면 "복구" 로
--      오판하고, 8분 뒤 다시 "장애" 로 잡는다 → 무한 플래핑.
--
-- 수정:
--   • incident 를 **브랜드 단위**로 (세션 하나라도 재생 중이면 그 매장은 정상)
--   • 상태 전환(offline↔stalled)은 **제자리 업데이트** — 알림 없음
--   • 복구는 **연속 2회 정상 확인** 후에만 (③의 8분 사각지대를 건너뛴다)
--   • 리마인드 1시간 → 6시간, 최대 2회까지만
--
-- 기존 열린 incident 는 잘못된 로직의 산물이므로 조용히 닫는다(복구 알림 없음).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 스키마 — 브랜드 단위 + 연속 정상 카운터
-- ----------------------------------------------------------------------------
alter table public.brand_player_incidents
  add column if not exists healthy_checks int not null default 0,
  add column if not exists reminder_count int not null default 0;

-- 잘못된 로직으로 열린 것들 조용히 정리 (복구 알림 발송 안 함)
update public.brand_player_incidents
   set resolved_at = now(), last_checked_at = now()
 where resolved_at is null;

-- 미해소 incident 는 브랜드당 하나
drop index if exists uniq_brand_incident_open;
create unique index if not exists uniq_brand_incident_open_brand
  on public.brand_player_incidents (brand_id) where resolved_at is null;

-- ----------------------------------------------------------------------------
-- 2) 감지 — 브랜드 단위 + 플래핑 방지
-- ----------------------------------------------------------------------------
create or replace function public.detect_brand_player_incidents(
  p_offline_grace_minutes int default 20,
  p_reminder_minutes int default 360,     -- 1시간 → 6시간
  p_max_reminders int default 2
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b record;
  v_inc public.brand_player_incidents;
  v_opened int := 0; v_resolved int := 0; v_reminded int := 0; v_updated int := 0;
  v_bad boolean;
  v_label text;
  v_down_minutes numeric;
begin
  -- 브랜드 단위 롤업: 세션 하나라도 재생 중이면 그 매장은 정상이다.
  for b in
    select h.brand_id,
           h.brand_name,
           bool_or(h.status = 'playing')                        as any_playing,
           count(*) filter (where h.status = 'stalled')          as stalled_n,
           min(h.seconds_since_heartbeat)                        as min_hb,
           (array_agg(h.session_id          order by h.seconds_since_heartbeat))[1] as session_id,
           (array_agg(h.device              order by h.seconds_since_heartbeat))[1] as device,
           (array_agg(h.current_track_title order by h.seconds_since_heartbeat))[1] as track,
           (array_agg(h.status              order by h.seconds_since_heartbeat))[1] as lead_status
      from public._brand_player_session_health(1440) h
     group by h.brand_id, h.brand_name
  loop
    -- 장애 판정: 재생 중인 세션이 하나도 없고, (멈춘 세션이 있거나 / 신호가 유예시간 넘게 없음)
    v_bad := (not b.any_playing)
             and (b.stalled_n > 0 or b.min_hb >= p_offline_grace_minutes * 60);

    select * into v_inc from public.brand_player_incidents
     where brand_id = b.brand_id and resolved_at is null limit 1;

    -- ── (A) 신규 장애 ────────────────────────────────────────────────────
    if v_bad and v_inc.id is null then
      insert into public.brand_player_incidents
        (brand_id, brand_name, session_id, status, context, healthy_checks)
      values (b.brand_id, b.brand_name, b.session_id,
              case when b.stalled_n > 0 then 'stalled' else 'offline' end,
              jsonb_build_object('device', b.device, 'track', b.track,
                                 'seconds_since_heartbeat', b.min_hb,
                                 'stalled_sessions', b.stalled_n), 0)
      returning * into v_inc;

      v_label := case when b.stalled_n > 0
                      then '음악이 멈췄습니다 (화면은 켜져 있음)'
                      else '플레이어 연결이 끊겼습니다' end;

      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('brand_player_down', 'error',
              format('[긴급] %s — %s', b.brand_name, v_label),
              format('기기 %s · 마지막 신호 %s분 전 · 현재 곡 %s',
                     b.device, round(b.min_hb/60.0), coalesce(b.track,'-')),
              jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                 'session_id', b.session_id, 'device', b.device),
              0, now());

      perform public._notify_brand_player_alert(jsonb_build_object(
        'event', 'brand_player_down', 'severity', 'critical',
        'incident_id', v_inc.id, 'brand', b.brand_name, 'session_id', b.session_id,
        'status', v_inc.status, 'device', b.device, 'track', b.track,
        'minutes_since_heartbeat', round(b.min_hb/60.0), 'detected_at', now(),
        'text', format('[긴급] %s 매장 음악이 멈췄습니다 — %s (기기 %s, 마지막 신호 %s분 전)',
                       b.brand_name, v_label, b.device, round(b.min_hb/60.0))));
      update public.brand_player_incidents set notified_at = now() where id = v_inc.id;
      v_opened := v_opened + 1;

    -- ── (B) 장애 지속 ────────────────────────────────────────────────────
    elsif v_bad and v_inc.id is not null then
      -- 상태 전환(offline↔stalled)은 같은 고장의 두 얼굴 — 제자리 업데이트, 알림 없음.
      update public.brand_player_incidents
         set last_checked_at = now(),
             status = case when b.stalled_n > 0 then 'stalled' else 'offline' end,
             healthy_checks = 0,
             context = context || jsonb_build_object('device', b.device, 'track', b.track,
                                                     'seconds_since_heartbeat', b.min_hb)
       where id = v_inc.id;
      v_updated := v_updated + 1;

      if v_inc.reminder_count < p_max_reminders
         and coalesce(v_inc.reminded_at, v_inc.opened_at) < now() - make_interval(mins => p_reminder_minutes) then
        v_down_minutes := round(extract(epoch from (now() - v_inc.opened_at))/60.0);
        perform public._notify_brand_player_alert(jsonb_build_object(
          'event', 'brand_player_down_reminder', 'severity', 'critical',
          'incident_id', v_inc.id, 'brand', b.brand_name,
          'minutes_down', v_down_minutes,
          'text', format('[긴급·계속] %s 매장 음악이 %s분째 멈춰 있습니다.', b.brand_name, v_down_minutes)));
        update public.brand_player_incidents
           set reminded_at = now(), reminder_count = reminder_count + 1
         where id = v_inc.id;
        v_reminded := v_reminded + 1;
      end if;

    -- ── (C) 정상으로 보임 — 연속 2회 확인해야 복구로 인정 ────────────────
    --     곡이 바뀐 직후 8분은 소리가 안 나도 'playing' 으로 보이는 사각지대가 있다.
    --     한 번만 보고 복구 처리하면 8분 뒤 다시 장애로 잡혀 플래핑한다.
    elsif (not v_bad) and v_inc.id is not null then
      if v_inc.healthy_checks + 1 >= 2 then
        v_down_minutes := round(extract(epoch from (now() - v_inc.opened_at))/60.0);
        update public.brand_player_incidents
           set resolved_at = now(), last_checked_at = now(),
               resolve_notified_at = now(), healthy_checks = v_inc.healthy_checks + 1
         where id = v_inc.id;

        insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
        values ('brand_player_recovered', 'info',
                format('%s — 음악 재생이 복구됐습니다', b.brand_name),
                format('%s분 만에 복구 · 현재 곡 %s', v_down_minutes, coalesce(b.track,'-')),
                jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name), 0, now());

        perform public._notify_brand_player_alert(jsonb_build_object(
          'event', 'brand_player_recovered', 'severity', 'info',
          'incident_id', v_inc.id, 'brand', b.brand_name, 'minutes_down', v_down_minutes,
          'text', format('[복구] %s 매장 음악이 다시 나옵니다 (%s분 중단).', b.brand_name, v_down_minutes)));
        v_resolved := v_resolved + 1;
      else
        update public.brand_player_incidents
           set healthy_checks = v_inc.healthy_checks + 1, last_checked_at = now()
         where id = v_inc.id;
        v_updated := v_updated + 1;
      end if;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'checked_at', now(),
    'opened', v_opened, 'resolved', v_resolved, 'reminded', v_reminded, 'updated', v_updated,
    'open_total', (select count(*) from public.brand_player_incidents where resolved_at is null));
end;
$$;

create or replace function public.cron_check_brand_player_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  return public.detect_brand_player_incidents();
end;
$$;

revoke execute on function public.detect_brand_player_incidents(int, int, int) from public, anon;
grant  execute on function public.detect_brand_player_incidents(int, int, int) to service_role;

-- 구 시그니처 제거 (인자 2개짜리) — cron 은 인자 없이 호출하므로 영향 없음
drop function if exists public.detect_brand_player_incidents(int, int);
