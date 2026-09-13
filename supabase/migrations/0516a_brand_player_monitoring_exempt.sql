-- 0516: 테스트/데모 계정을 매장 장애 감시에서 제외
--
-- 배경: 데모 계정과 사내 테스트 계정은 상시 켜두지 않는다. 그런데 감지 로직은
-- "브랜드에 속한 계정이 조용하면 장애"로 보기 때문에, 테스트를 안 돌리는 동안
-- 계속 장애로 잡혀 [긴급] 알림이 나갔다. 실제 매장 장애와 섞이면 알림 자체를
-- 못 믿게 되므로 감시 대상에서 아예 뺀다.
--
-- 제외 계정은 incident 를 열지도 않고, 이미 열려 있던 건은 조용히 닫는다
-- (복구 알림도 보내지 않는다 — 애초에 장애가 아니었으므로).

create table if not exists public.brand_player_monitoring_exempt (
  store_user_id uuid primary key references auth.users(id) on delete cascade,
  label         text,
  reason        text not null,
  created_at    timestamptz not null default now()
);

comment on table public.brand_player_monitoring_exempt is
  '매장 장애 감시 제외 계정 (데모·내부 테스트). 여기 있는 계정은 장애 알림을 발생시키지 않는다.';

alter table public.brand_player_monitoring_exempt enable row level security;

drop policy if exists brand_player_monitoring_exempt_admin_read on public.brand_player_monitoring_exempt;
create policy brand_player_monitoring_exempt_admin_read
  on public.brand_player_monitoring_exempt for select
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- 현재 제외 대상 --------------------------------------------------------------
insert into public.brand_player_monitoring_exempt (store_user_id, label, reason)
values
  ('de700002-0000-0000-0000-000000000001', '데모 매장 1',
   '전 프랜차이즈 공용 데모 계정 — 상시 재생하지 않음'),
  ('a93c51b0-b486-4a61-a4c3-efbc307a9520', '01091446108a@gmail.com',
   '내부 테스트 계정 — 상시 재생하지 않음')
on conflict (store_user_id) do update
  set label = excluded.label, reason = excluded.reason;

-- 감지 함수: 제외 계정 건너뛰기 -----------------------------------------------
create or replace function public.detect_brand_player_incidents(
  p_offline_grace_minutes integer default 20,
  p_reminder_minutes      integer default 360,
  p_max_reminders         integer default 2
) returns jsonb
language plpgsql
security definer
set search_path = public
as $fn$
declare
  b record;
  v_inc public.brand_player_incidents;
  v_opened int := 0; v_resolved int := 0; v_reminded int := 0; v_updated int := 0;
  v_exempt_closed int := 0;
  v_bad boolean;
  v_label text;
  v_who text;
  v_down_minutes numeric;
begin
  -- 제외 계정에 열려 있던 건은 조용히 닫는다(복구 알림 없음).
  with closed as (
    update public.brand_player_incidents i
       set resolved_at = now(), last_checked_at = now(), resolve_notified_at = now()
     where i.resolved_at is null
       and exists (select 1 from public.brand_player_monitoring_exempt e
                    where e.store_user_id = i.store_user_id)
    returning 1
  )
  select count(*) into v_exempt_closed from closed;

  for b in
    select h.brand_id, h.brand_name, h.user_id,
           (array_agg(h.store_label order by h.seconds_since_heartbeat))[1] as store_label,
           bool_or(h.status = 'playing')               as any_playing,
           count(*) filter (where h.status = 'stalled') as stalled_n,
           min(h.seconds_since_heartbeat)               as min_hb,
           (array_agg(h.session_id          order by h.seconds_since_heartbeat))[1] as session_id,
           (array_agg(h.device              order by h.seconds_since_heartbeat))[1] as device,
           (array_agg(h.current_track_title order by h.seconds_since_heartbeat))[1] as track
      from public._brand_player_session_health(1440) h
     where not exists (select 1 from public.brand_player_monitoring_exempt e
                        where e.store_user_id = h.user_id)
     group by h.brand_id, h.brand_name, h.user_id
  loop
    v_bad := (not b.any_playing)
             and (b.stalled_n > 0 or b.min_hb >= p_offline_grace_minutes * 60);
    v_who := format('%s · %s', b.brand_name, coalesce(b.store_label, '(계정 미상)'));

    select * into v_inc from public.brand_player_incidents
     where brand_id = b.brand_id and store_user_id = b.user_id and resolved_at is null limit 1;

    if v_bad and v_inc.id is null then
      insert into public.brand_player_incidents
        (brand_id, brand_name, store_user_id, store_label, session_id, status, context, healthy_checks)
      values (b.brand_id, b.brand_name, b.user_id, b.store_label, b.session_id,
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
              format('[긴급] %s — %s', v_who, v_label),
              format('기기 %s · 마지막 신호 %s분 전 · 현재 곡 %s',
                     b.device, round(b.min_hb/60.0), coalesce(b.track,'-')),
              jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                 'store', b.store_label, 'store_user_id', b.user_id,
                                 'session_id', b.session_id, 'device', b.device),
              0, now());

      perform public._notify_brand_player_alert(jsonb_build_object(
        'event', 'brand_player_down', 'severity', 'critical',
        'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
        'session_id', b.session_id, 'status', v_inc.status, 'device', b.device, 'track', b.track,
        'minutes_since_heartbeat', round(b.min_hb/60.0), 'detected_at', now(),
        'text', format('[긴급] %s 음악이 멈췄습니다 — %s (기기 %s, 마지막 신호 %s분 전)',
                       v_who, v_label, b.device, round(b.min_hb/60.0))));
      update public.brand_player_incidents set notified_at = now() where id = v_inc.id;
      v_opened := v_opened + 1;

    elsif v_bad and v_inc.id is not null then
      update public.brand_player_incidents
         set last_checked_at = now(),
             status = case when b.stalled_n > 0 then 'stalled' else 'offline' end,
             healthy_checks = 0,
             store_label = coalesce(b.store_label, store_label),
             context = context || jsonb_build_object('device', b.device, 'track', b.track,
                                                     'seconds_since_heartbeat', b.min_hb)
       where id = v_inc.id;
      v_updated := v_updated + 1;

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

    elsif (not v_bad) and v_inc.id is not null then
      if v_inc.healthy_checks + 1 >= 2 then
        v_down_minutes := round(extract(epoch from (now() - v_inc.opened_at))/60.0);
        update public.brand_player_incidents
           set resolved_at = now(), last_checked_at = now(),
               resolve_notified_at = now(), healthy_checks = v_inc.healthy_checks + 1
         where id = v_inc.id;

        insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
        values ('brand_player_recovered', 'info',
                format('%s — 음악 재생이 복구됐습니다', v_who),
                format('%s분 만에 복구 · 현재 곡 %s', v_down_minutes, coalesce(b.track,'-')),
                jsonb_build_object('incident_id', v_inc.id, 'brand', b.brand_name,
                                   'store', b.store_label), 0, now());

        perform public._notify_brand_player_alert(jsonb_build_object(
          'event', 'brand_player_recovered', 'severity', 'info',
          'incident_id', v_inc.id, 'brand', b.brand_name, 'store', b.store_label,
          'minutes_down', v_down_minutes,
          'text', format('[복구] %s 음악이 다시 나옵니다 (%s분 중단).', v_who, v_down_minutes)));
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
    'exempt_closed', v_exempt_closed,
    'open_total', (select count(*) from public.brand_player_incidents where resolved_at is null));
end;
$fn$;
