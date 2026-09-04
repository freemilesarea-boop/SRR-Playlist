-- ============================================================================
-- 0505_brand_player_incident_alerts.sql
-- Phase BRAND-PLAYER-INCIDENT-ALERTS-1
--
-- 목적: 매장 음악이 멈추면 민원이 들어오기 전에 먼저 안다.
--   0504 가 playing/stalled/offline 판정을 만들었으니, 이제 그걸 5분마다 돌려
--   장애를 incident 로 열고 알림을 쏜다. 복구되면 자동으로 닫고 해제 알림까지.
--
-- 알림 경로 (설정된 것만 동작 — 미설정이면 조용히 skip):
--   1. admin_notifications  — 관리자 화면 종 아이콘 (항상)
--   2. Slack webhook        — admin_settings.notification_slack_webhook_url
--   3. Web Push (앱 알림)   — brand_alert_push_url + Vault(brand_alert_secret)
--   4. 릴레이 webhook       — admin_settings.brand_alert_relay_url
--
-- 설계 원칙:
--   • incident 단위 dedup — 같은 장애로 5분마다 알림이 오지 않는다.
--     열 때 1회, 복구될 때 1회. 미해소가 길어지면 리마인드 1시간 간격.
--   • offline 은 유예시간(기본 20분)을 준다. 잠깐의 네트워크 끊김/새로고침으로
--     알림이 튀지 않게. stalled 는 즉시 — 페이지는 살아 있는데 소리만 죽은 상태라
--     명백한 장애다.
--   • 알림 전송 실패가 감지 자체를 막지 않는다 (전부 예외 격리).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 세션 상태 판정 내부 함수 — 0504 admin RPC 의 본체를 분리해 재사용
--    (admin RPC 는 admin 체크 때문에 cron 에서 못 부른다)
-- ----------------------------------------------------------------------------
create or replace function public._brand_player_session_health(p_minutes int default 1440)
returns table (
  session_id uuid, brand_id uuid, brand_name text, status text,
  seconds_since_heartbeat int, seconds_on_current_track int,
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
    select bps.id, bps.brand_id, ba.name as brand,
           bps.last_seen_at, bps.created_at,
           bps.current_track_started_at, bps.user_agent,
           t.title as track_title, t.duration as track_duration,
           greatest(coalesce(t.duration, 180) * 2, 480) as stall_secs
    from public.brand_player_sessions bps
    join public.brand_accounts ba on ba.id = bps.brand_id
    left join public.tracks t on t.id = bps.current_track_id
    where bps.revoked_at is null
      and bps.last_seen_at > now() - make_interval(mins => greatest(1, p_minutes))
  )
  select s.id, s.brand_id, s.brand,
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

-- 0504 의 admin RPC 를 내부 함수 위로 재작성 (시그니처/컬럼 동일 — 호출측 무영향)
create or replace function public.admin_brand_player_health(p_minutes int default 1440)
returns table (
  session_id uuid, brand_name text, status text,
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
  select h.session_id, h.brand_name, h.status,
         h.seconds_since_heartbeat, h.seconds_on_current_track,
         h.current_track_title, h.current_track_duration,
         h.stall_threshold_seconds, h.session_age_hours,
         h.device, h.last_seen_at
  from public._brand_player_session_health(p_minutes) h;
end;
$$;

-- ----------------------------------------------------------------------------
-- 2) incident 테이블
-- ----------------------------------------------------------------------------
create table if not exists public.brand_player_incidents (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_accounts(id) on delete cascade,
  brand_name text not null,
  session_id uuid not null,
  status text not null check (status in ('stalled','offline')),
  opened_at timestamptz not null default now(),
  resolved_at timestamptz,
  last_checked_at timestamptz not null default now(),
  notified_at timestamptz,
  reminded_at timestamptz,
  resolve_notified_at timestamptz,
  context jsonb not null default '{}'::jsonb
);
-- 세션당 미해소 incident 는 하나만 (dedup 의 핵심)
create unique index if not exists uniq_brand_incident_open
  on public.brand_player_incidents (session_id) where resolved_at is null;
create index if not exists idx_brand_incident_open
  on public.brand_player_incidents (opened_at desc) where resolved_at is null;
create index if not exists idx_brand_incident_brand
  on public.brand_player_incidents (brand_id, opened_at desc);

alter table public.brand_player_incidents enable row level security;
drop policy if exists brand_incident_admin on public.brand_player_incidents;
create policy brand_incident_admin on public.brand_player_incidents for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ----------------------------------------------------------------------------
-- 3) 알림 발사 — 설정된 채널로만. 실패는 전부 격리한다.
-- ----------------------------------------------------------------------------
create or replace function public._notify_brand_player_alert(p_payload jsonb)
returns void
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net', 'vault'
as $$
declare
  v_slack text;
  v_relay text;
  v_push text;
  v_secret text;
  v_text text;
begin
  v_text := coalesce(p_payload->>'text', '브랜드 플레이어 알림');

  -- (a) Slack
  begin
    select trim(both '"' from (value::text)) into v_slack
      from public.admin_settings where key = 'notification_slack_webhook_url';
    if coalesce(v_slack,'') <> '' then
      perform net.http_post(
        url := v_slack,
        headers := jsonb_build_object('content-type','application/json'),
        body := jsonb_build_object('text', v_text),
        timeout_milliseconds := 8000);
    end if;
  exception when others then null;
  end;

  -- (b) 릴레이 webhook (외부 수신자 — 전체 payload 그대로)
  begin
    select trim(both '"' from (value::text)) into v_relay
      from public.admin_settings where key = 'brand_alert_relay_url';
    if coalesce(v_relay,'') <> '' then
      perform net.http_post(
        url := v_relay,
        headers := jsonb_build_object('content-type','application/json'),
        body := p_payload,
        timeout_milliseconds := 8000);
    end if;
  exception when others then null;
  end;

  -- (c) Web Push (앱 알림) — 엣지함수 경유. Vault 에 secret 이 있어야 동작.
  begin
    select trim(both '"' from (value::text)) into v_push
      from public.admin_settings where key = 'brand_alert_push_url';
    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'brand_alert_secret' limit 1;
    if coalesce(v_push,'') <> '' and coalesce(v_secret,'') <> '' then
      perform net.http_post(
        url := v_push,
        headers := jsonb_build_object('content-type','application/json',
                                      'x-cron-secret', v_secret),
        body := p_payload,
        timeout_milliseconds := 15000);
    end if;
  exception when others then null;
  end;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 감지 — 5분마다 cron 이 호출
-- ----------------------------------------------------------------------------
create or replace function public.detect_brand_player_incidents(
  p_offline_grace_minutes int default 20,
  p_reminder_minutes int default 60
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  h record;
  v_inc public.brand_player_incidents;
  v_opened int := 0; v_resolved int := 0; v_reminded int := 0;
  v_bad boolean;
  v_payload jsonb;
  v_label text;
begin
  for h in select * from public._brand_player_session_health(1440) loop
    -- offline 은 유예시간을 넘겨야 장애로 본다 (새로고침/짧은 끊김 오탐 방지)
    v_bad := h.status = 'stalled'
          or (h.status = 'offline' and h.seconds_since_heartbeat >= p_offline_grace_minutes * 60);

    select * into v_inc from public.brand_player_incidents
     where session_id = h.session_id and resolved_at is null limit 1;

    if v_bad and v_inc.id is null then
      -- 신규 장애
      insert into public.brand_player_incidents
        (brand_id, brand_name, session_id, status, context)
      values (h.brand_id, h.brand_name, h.session_id, h.status,
              jsonb_build_object('device', h.device, 'track', h.current_track_title,
                                 'seconds_since_heartbeat', h.seconds_since_heartbeat,
                                 'seconds_on_current_track', h.seconds_on_current_track))
      returning * into v_inc;

      v_label := case when h.status = 'stalled'
                      then '음악이 멈췄습니다 (화면은 켜져 있음)'
                      else '플레이어 연결이 끊겼습니다' end;

      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('brand_player_down', 'error',
              format('[긴급] %s — %s', h.brand_name, v_label),
              format('기기 %s · 마지막 신호 %s분 전 · 현재 곡 %s',
                     h.device, round(h.seconds_since_heartbeat/60.0), coalesce(h.current_track_title,'-')),
              jsonb_build_object('incident_id', v_inc.id, 'brand', h.brand_name,
                                 'session_id', h.session_id, 'status', h.status,
                                 'device', h.device),
              0, now());

      v_payload := jsonb_build_object(
        'event', 'brand_player_down',
        'severity', 'critical',
        'incident_id', v_inc.id,
        'brand', h.brand_name,
        'session_id', h.session_id,
        'status', h.status,
        'device', h.device,
        'track', h.current_track_title,
        'minutes_since_heartbeat', round(h.seconds_since_heartbeat/60.0),
        'detected_at', now(),
        'text', format('[긴급] %s 매장 음악이 멈췄습니다 — %s (기기 %s, 마지막 신호 %s분 전)',
                       h.brand_name, v_label, h.device, round(h.seconds_since_heartbeat/60.0))
      );
      perform public._notify_brand_player_alert(v_payload);
      update public.brand_player_incidents set notified_at = now() where id = v_inc.id;
      v_opened := v_opened + 1;

    elsif v_bad and v_inc.id is not null then
      -- 미해소 지속 — 리마인드는 간격을 두고
      update public.brand_player_incidents
         set last_checked_at = now(), status = h.status
       where id = v_inc.id;
      if coalesce(v_inc.reminded_at, v_inc.opened_at) < now() - make_interval(mins => p_reminder_minutes) then
        perform public._notify_brand_player_alert(jsonb_build_object(
          'event', 'brand_player_down_reminder', 'severity', 'critical',
          'incident_id', v_inc.id, 'brand', h.brand_name, 'status', h.status,
          'minutes_down', round(extract(epoch from (now() - v_inc.opened_at))/60.0),
          'text', format('[긴급·계속] %s 매장 음악이 %s분째 멈춰 있습니다.',
                         h.brand_name, round(extract(epoch from (now() - v_inc.opened_at))/60.0))));
        update public.brand_player_incidents set reminded_at = now() where id = v_inc.id;
        v_reminded := v_reminded + 1;
      end if;

    elsif (not v_bad) and v_inc.id is not null then
      -- 복구
      update public.brand_player_incidents
         set resolved_at = now(), last_checked_at = now(), resolve_notified_at = now()
       where id = v_inc.id;

      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('brand_player_recovered', 'info',
              format('%s — 음악 재생이 복구됐습니다', h.brand_name),
              format('%s분 만에 복구 · 현재 곡 %s',
                     round(extract(epoch from (now() - v_inc.opened_at))/60.0),
                     coalesce(h.current_track_title,'-')),
              jsonb_build_object('incident_id', v_inc.id, 'brand', h.brand_name), 0, now());

      perform public._notify_brand_player_alert(jsonb_build_object(
        'event', 'brand_player_recovered', 'severity', 'info',
        'incident_id', v_inc.id, 'brand', h.brand_name,
        'minutes_down', round(extract(epoch from (now() - v_inc.opened_at))/60.0),
        'text', format('[복구] %s 매장 음악이 다시 나옵니다 (%s분 중단).',
                       h.brand_name, round(extract(epoch from (now() - v_inc.opened_at))/60.0))));
      v_resolved := v_resolved + 1;
    end if;
  end loop;

  return jsonb_build_object('ok', true, 'checked_at', now(),
    'opened', v_opened, 'resolved', v_resolved, 'reminded', v_reminded,
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

-- 관리자 조회 — 현재 열린 장애
create or replace function public.admin_list_brand_player_incidents(p_include_resolved boolean default false, p_limit int default 50)
returns setof public.brand_player_incidents
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
    select * from public.brand_player_incidents
     where (p_include_resolved or resolved_at is null)
     order by opened_at desc
     limit greatest(1, p_limit);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 권한
-- ----------------------------------------------------------------------------
revoke execute on function public._brand_player_session_health(int) from public, anon, authenticated;
grant  execute on function public._brand_player_session_health(int) to service_role;
revoke execute on function public._notify_brand_player_alert(jsonb) from public, anon, authenticated;
grant  execute on function public._notify_brand_player_alert(jsonb) to service_role;
revoke execute on function public.detect_brand_player_incidents(int, int) from public, anon;
grant  execute on function public.detect_brand_player_incidents(int, int) to service_role;
revoke execute on function public.cron_check_brand_player_health() from public, anon;
grant  execute on function public.cron_check_brand_player_health() to service_role;
revoke execute on function public.admin_list_brand_player_incidents(boolean, int) from public, anon;
grant  execute on function public.admin_list_brand_player_incidents(boolean, int) to authenticated, service_role;
