-- ============================================================================
-- 0507_brand_player_incident_per_store.sql
-- Phase BRAND-PLAYER-INCIDENT-PER-STORE-1
--
-- 문제: 0506 이 incident 를 **브랜드 단위**로 묶었는데, 이게 실제 운영과 안 맞는다.
--
--   브랜드 하나(카공시대)에 여러 **계정**이 각자 브랜드 코드를 넣고 플레이어를 쓴다:
--     demoshop1@deudda.com      (데모 매장 — 시연/테스트용)
--     kagongsidae-01@naver.com  (실제 가맹점)
--     01091446108a@gmail.com    (아티스트 계정)
--
--   0506 은 "세션 하나라도 재생 중이면 그 브랜드는 정상" 으로 판정한다. 그래서
--   **데모 계정이 재생 중이면 실제 매장이 죽어 있어도 '정상' 으로 나온다.**
--   실측: demoshop1 재생 중 / kagongsidae-01 은 63분째 멈춤 → 알림 0건 (거짓 음성)
--
-- 판정 단위를 바로잡는다:
--   • 세션(탭) 단위 = 너무 잘다. 한 매장이 탭을 여러 개 열면 알림이 배로 늘어난다(0505 문제)
--   • 브랜드 단위   = 너무 굵다. 한 매장이 살아 있으면 나머지 매장이 다 죽어도 조용하다(0506 문제)
--   • **(브랜드 × 계정) 단위 = 매장 하나** ← 이게 맞다
--     같은 계정의 탭 여러 개는 하나로 묶고, 계정이 다르면 다른 매장으로 본다.
--
-- 함께: 알림에 어느 계정인지 드러나게 한다(이메일). "카공시대가 멈췄다" 만으로는
--       어느 매장인지 알 수 없어 조치가 불가능하다.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 세션 상태에 user_id / 계정 라벨 노출
-- ----------------------------------------------------------------------------
drop function if exists public._brand_player_session_health(int);
create or replace function public._brand_player_session_health(p_minutes int default 1440)
returns table (
  session_id uuid, brand_id uuid, brand_name text, user_id uuid, store_label text,
  status text, seconds_since_heartbeat int, seconds_on_current_track int,
  current_track_title text, current_track_duration int,
  stall_threshold_seconds int, session_age_hours numeric,
  device text, last_seen_at timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  with s as (
    select bps.id, bps.brand_id, ba.name as brand, bps.user_id,
           coalesce(
             (select fs.store_name from public.franchise_stores fs
               where fs.store_id = bps.user_id and fs.status = 'active' limit 1),
             au.email::text,
             bps.user_id::text
           ) as store_label,
           bps.last_seen_at, bps.created_at,
           bps.current_track_started_at, bps.user_agent,
           t.title as track_title, t.duration as track_duration,
           greatest(coalesce(t.duration, 180) * 2, 480) as stall_secs
    from public.brand_player_sessions bps
    join public.brand_accounts ba on ba.id = bps.brand_id
    left join auth.users au on au.id = bps.user_id
    left join public.tracks t on t.id = bps.current_track_id
    where bps.revoked_at is null
      and bps.last_seen_at > now() - make_interval(mins => greatest(1, p_minutes))
  )
  select s.id, s.brand_id, s.brand, s.user_id, s.store_label,
         case
           when s.last_seen_at < now() - interval '10 minutes' then 'offline'
           when coalesce(s.current_track_started_at, s.created_at) < now() - make_interval(secs => s.stall_secs) then 'stalled'
           else 'playing'
         end::text,
         extract(epoch from (now() - s.last_seen_at))::int,
         extract(epoch from (now() - coalesce(s.current_track_started_at, s.created_at)))::int,
         s.track_title, s.track_duration, s.stall_secs::int,
         round(extract(epoch from (now() - s.created_at)) / 3600.0, 1),
         case
           when s.user_agent ilike '%iphone%' or s.user_agent ilike '%android%' then 'mobile'
           when s.user_agent ilike '%ipad%' or s.user_agent ilike '%tablet%' then 'tablet'
           when s.user_agent ilike '%mac os%' then 'mac'
           when s.user_agent ilike '%windows%' then 'windows'
           else 'other'
         end::text,
         s.last_seen_at
  from s
  order by s.last_seen_at desc;
$$;

create or replace function public.admin_brand_player_health(p_minutes int default 1440)
returns table (
  session_id uuid, brand_name text, store_label text, status text,
  seconds_since_heartbeat int, seconds_on_current_track int,
  current_track_title text, current_track_duration int,
  stall_threshold_seconds int, session_age_hours numeric,
  device text, last_seen_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  return query
  select h.session_id, h.brand_name, h.store_label, h.status,
         h.seconds_since_heartbeat, h.seconds_on_current_track,
         h.current_track_title, h.current_track_duration,
         h.stall_threshold_seconds, h.session_age_hours,
         h.device, h.last_seen_at
  from public._brand_player_session_health(p_minutes) h;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) incident 단위를 (브랜드 × 계정) 으로
-- ----------------------------------------------------------------------------
alter table public.brand_player_incidents
  add column if not exists store_user_id uuid,
  add column if not exists store_label text;

-- 잘못된 단위로 열린 것 조용히 정리
update public.brand_player_incidents
   set resolved_at = now(), last_checked_at = now()
 where resolved_at is null;

drop index if exists uniq_brand_incident_open_brand;
create unique index if not exists uniq_brand_incident_open_store
  on public.brand_player_incidents (brand_id, store_user_id) where resolved_at is null;

create or replace function public.detect_brand_player_incidents(
  p_offline_grace_minutes int default 20,
  p_reminder_minutes int default 360,
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
  v_who text;
  v_down_minutes numeric;
begin
  -- (브랜드 × 계정) = 매장 하나. 같은 계정의 탭 여러 개는 하나로 묶는다.
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
      -- 곡 전환 직후 8분은 소리가 안 나도 'playing' 으로 보이는 사각지대가 있다 →
      -- 연속 2회 정상일 때만 복구로 인정 (0506 과 동일)
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
    'open_total', (select count(*) from public.brand_player_incidents where resolved_at is null));
end;
$$;

-- 요약 RPC — store_label 반영
create or replace function public.admin_brand_player_health_summary(p_minutes int default 1440)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'unauthorized';
  end if;
  select jsonb_build_object(
    'checked_at', now(), 'window_minutes', p_minutes,
    'total', count(*),
    'playing', count(*) filter (where h.status = 'playing'),
    'stalled', count(*) filter (where h.status = 'stalled'),
    'offline', count(*) filter (where h.status = 'offline'),
    'by_store', coalesce(jsonb_agg(distinct jsonb_build_object(
        'brand', h.brand_name, 'store', h.store_label, 'status', h.status,
        'minutes_since_heartbeat', round(h.seconds_since_heartbeat/60.0))), '[]'::jsonb)
  ) into v
  from public.admin_brand_player_health(p_minutes) h;
  return v;
end;
$$;

revoke execute on function public._brand_player_session_health(int) from public, anon, authenticated;
grant  execute on function public._brand_player_session_health(int) to service_role;
revoke execute on function public.admin_brand_player_health(int) from public, anon;
grant  execute on function public.admin_brand_player_health(int) to authenticated, service_role;
