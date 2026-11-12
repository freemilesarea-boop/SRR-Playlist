-- 0555_announcement_monitoring.sql
--
-- 안내방송 전용 플레이어 3단계 — 본사·관리자 송출 현황 + 꺼짐/실패 알림.
--
-- 바뀌는 것
--   1) announcer_devices: closed_at(창을 닫음) · offline_notified_at(꺼짐 알림 보냄).
--      goodbye 는 줄을 지우지 않고 closed_at 을 남긴다 — "정상 종료"와 "갑자기 끊김"을 구분해
--      갑자기 끊긴 것만 알린다(매장 마감 때 창을 닫는 건 알림 대상이 아니다).
--      heartbeat 는 store 계정의 /business/announcer 처럼 브랜드가 없는 창도 가맹 관계로 본사를 찾는다.
--   2) enterprise_announcement_play_logs.alert_notified_at — 실패 알림 중복 방지.
--   3) _announcement_status_core(ea) — 안내 전용 기기 상태 + 오늘 매장별 송출 결과.
--      hq_announcement_status()  : 본사 자기 브랜드
--      admin_announcement_status(ea) : 관리자 — ea 없으면 브랜드별 요약
--   4) cron_check_announcement_health() (매분)
--      · 소리 허용된 안내 전용 기기가 닫힘 표시 없이 5분 넘게 신호가 없으면 → 본사·관리자 알림 1회
--      · 다시 신호가 오면 → 본사에 "다시 켜짐" 알림
--      · 송출 실패 기록 → 본사·관리자 알림 (브랜드별로 묶어서, 건당 1회)

-- ============================================================
-- 1) 기기 상태 컬럼 + heartbeat/goodbye/status 갱신
-- ============================================================
alter table public.announcer_devices
  add column if not exists closed_at timestamptz,
  add column if not exists offline_notified_at timestamptz;

alter table public.enterprise_announcement_play_logs
  add column if not exists alert_notified_at timestamptz;

create index if not exists idx_eapl_failed_unalerted
  on public.enterprise_announcement_play_logs (created_at)
  where status = 'failed' and alert_notified_at is null;

-- 매장 이름 — 가맹 매장명 → 브랜드 플레이어 매장 라벨 → 계정 이름 순.
create or replace function public._announcement_store_label(p_user_id uuid, p_ea uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(
    (select fs.store_name from public.franchise_stores fs
       join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
      where fs.store_id = p_user_id and (p_ea is null or ef.enterprise_account_id = p_ea)
      order by fs.status = 'active' desc limit 1),
    (select nullif(btrim(bps.device_label), '') from public.brand_player_sessions bps
      where bps.user_id = p_user_id and (p_ea is null or bps.enterprise_account_id = p_ea)
        and bps.device_label is not null
      order by bps.last_seen_at desc nulls last limit 1),
    (select coalesce(nullif(btrim(u.full_name), ''), nullif(btrim(u.nickname), '')) from public.users u where u.id = p_user_id),
    '이름 없는 매장');
$$;
revoke all on function public._announcement_store_label(uuid, uuid) from public, anon, authenticated;

create or replace function public.announcer_heartbeat(
  p_instance_id text,
  p_brand_id    uuid    default null,
  p_armed       boolean default false,
  p_user_agent  text    default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
  v_ea  uuid;
  v_was_notified timestamptz;
  v_hq  uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_instance_id is null or char_length(p_instance_id) not between 1 and 80 then
    raise exception 'invalid_instance_id';
  end if;
  if p_brand_id is not null then
    select b.enterprise_account_id into v_ea from public.brand_accounts b where b.id = p_brand_id;
  end if;
  if v_ea is null then
    select ef.enterprise_account_id into v_ea
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id and ef.deleted_at is null
     where fs.store_id = v_uid and fs.status = 'active' limit 1;
  end if;

  select offline_notified_at into v_was_notified
    from public.announcer_devices where user_id = v_uid and instance_id = p_instance_id;

  insert into public.announcer_devices (user_id, instance_id, brand_id, enterprise_account_id, armed, user_agent, last_seen_at)
  values (v_uid, p_instance_id, p_brand_id, v_ea, coalesce(p_armed, false), left(p_user_agent, 300), now())
  on conflict (user_id, instance_id) do update
     set brand_id              = coalesce(excluded.brand_id, announcer_devices.brand_id),
         enterprise_account_id = coalesce(excluded.enterprise_account_id, announcer_devices.enterprise_account_id),
         armed                 = excluded.armed,
         user_agent            = coalesce(excluded.user_agent, announcer_devices.user_agent),
         last_seen_at          = now(),
         closed_at             = null,
         offline_notified_at   = null;

  -- 꺼짐 알림을 보냈던 기기가 돌아오면 본사에 알린다.
  if v_was_notified is not null and v_ea is not null then
    begin
      select ea.auth_user_id into v_hq from public.enterprise_accounts ea where ea.id = v_ea;
      if v_hq is not null then
        insert into public.enterprise_notifications (
          enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
          title, message, severity, status, action_url, metadata)
        values (v_ea, 'user', v_hq, v_hq, 'announcer_online',
          format('%s 안내방송 플레이어가 다시 켜졌어요', public._announcement_store_label(v_uid, v_ea)),
          '안내방송이 다시 이 기기에서 나갑니다.', 'info', 'unread', '/enterprise/content',
          jsonb_build_object('store_user_id', v_uid, 'instance_id', p_instance_id));
      end if;
    exception when others then null;
    end;
  end if;

  delete from public.announcer_devices
   where user_id = v_uid and last_seen_at < now() - interval '7 days';

  return jsonb_build_object('success', true, 'at', now());
end;
$$;

create or replace function public.announcer_goodbye(p_instance_id text)
returns void
language sql
security definer
set search_path to 'public'
as $$
  update public.announcer_devices set closed_at = now()
   where user_id = auth.uid() and instance_id = p_instance_id;
$$;

create or replace function public.my_announcement_status()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select jsonb_build_object(
    'eligible', public.my_announcement_eligible(),
    'announcer_online', exists (
      select 1 from public.announcer_devices d
       where d.user_id = auth.uid() and d.armed and d.closed_at is null
         and d.last_seen_at > now() - interval '150 seconds'),
    'checked_at', now());
$$;

-- ============================================================
-- 2) 현황 조회
-- ============================================================
create or replace function public._announcement_status_core(p_ea uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with today as (
    select ((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul' as start_at
  ),
  devices as (
    select d.*,
           case when d.closed_at is not null then 'closed'
                when d.last_seen_at < now() - interval '150 seconds' then 'offline'
                when not d.armed then 'waiting_tap'
                else 'online' end as state
      from public.announcer_devices d
     where d.enterprise_account_id = p_ea
       and d.last_seen_at > now() - interval '3 days'
  ),
  logs as (
    select distinct on (coalesce(pl.occurrence_key, pl.id::text), pl.store_id)
           pl.store_id, pl.schedule_id, pl.status, pl.error_message,
           coalesce(pl.scheduled_for, pl.played_at, pl.created_at) as at
      from public.enterprise_announcement_play_logs pl
      join public.enterprise_announcement_schedules s on s.id = pl.schedule_id and s.enterprise_account_id = p_ea,
           today
     where pl.created_at >= today.start_at
     order by coalesce(pl.occurrence_key, pl.id::text), pl.store_id,
              case pl.status when 'played' then 0 when 'failed' then 1 when 'skipped' then 2 else 3 end,
              pl.created_at desc
  )
  select jsonb_build_object(
    'enterprise_account_id', p_ea,
    'now', now(),
    'devices', coalesce((
      select jsonb_agg(jsonb_build_object(
               'store_user_id', d.user_id,
               'store_label',   public._announcement_store_label(d.user_id, p_ea),
               'state',         d.state,
               'last_seen_at',  d.last_seen_at,
               'closed_at',     d.closed_at,
               'user_agent',    d.user_agent
             ) order by (d.state = 'online') desc, d.last_seen_at desc)
        from devices d), '[]'::jsonb),
    'today', coalesce((
      select jsonb_agg(jsonb_build_object(
               'store_user_id', l.store_id,
               'store_label',   public._announcement_store_label(l.store_id, p_ea),
               'schedule_name', s.name,
               'asset_title',   a.title,
               'status',        l.status,
               'error',         l.error_message,
               'scheduled_at',  l.at
             ) order by l.at desc)
        from (select * from logs order by at desc limit 200) l
        left join public.enterprise_announcement_schedules s on s.id = l.schedule_id
        left join public.enterprise_announcement_assets a on a.id = s.asset_id), '[]'::jsonb),
    'summary', jsonb_build_object(
      'devices_online', (select count(*) from devices where state = 'online'),
      'devices_offline', (select count(*) from devices where state = 'offline'),
      'played', (select count(*) from logs where status = 'played'),
      'failed', (select count(*) from logs where status = 'failed'),
      'active_schedules', (select count(*) from public.enterprise_announcement_schedules s
                            where s.enterprise_account_id = p_ea and s.deleted_at is null and s.status = 'active')
    ));
$$;
revoke all on function public._announcement_status_core(uuid) from public, anon, authenticated;

create or replace function public.hq_announcement_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea is null then
    raise exception 'forbidden: not an enterprise HQ admin' using errcode = '42501';
  end if;
  return public._announcement_status_core(v_ea);
end;
$$;
revoke all on function public.hq_announcement_status() from public, anon;
grant execute on function public.hq_announcement_status() to authenticated;

create or replace function public.admin_announcement_status(p_enterprise_account_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_res jsonb;
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only' using errcode = '42501';
  end if;
  if p_enterprise_account_id is not null then
    return public._announcement_status_core(p_enterprise_account_id);
  end if;

  -- 브랜드별 요약 — 일정이 있거나 안내 전용 기기가 있는 본사만.
  with today as (
    select ((now() at time zone 'Asia/Seoul')::date)::timestamp at time zone 'Asia/Seoul' as start_at
  ),
  eas as (
    select ea.id, ea.enterprise_name from public.enterprise_accounts ea
     where ea.deleted_at is null and (
       exists (select 1 from public.enterprise_announcement_schedules s
                where s.enterprise_account_id = ea.id and s.deleted_at is null and s.status = 'active')
       or exists (select 1 from public.announcer_devices d
                   where d.enterprise_account_id = ea.id and d.last_seen_at > now() - interval '3 days'))
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'enterprise_account_id', e.id,
           'enterprise_name', e.enterprise_name,
           'active_schedules', (select count(*) from public.enterprise_announcement_schedules s
                                 where s.enterprise_account_id = e.id and s.deleted_at is null and s.status = 'active'),
           'devices_online', (select count(*) from public.announcer_devices d
                               where d.enterprise_account_id = e.id and d.armed and d.closed_at is null
                                 and d.last_seen_at > now() - interval '150 seconds'),
           'devices_offline', (select count(*) from public.announcer_devices d
                                where d.enterprise_account_id = e.id and d.closed_at is null
                                  and d.last_seen_at <= now() - interval '150 seconds'
                                  and d.last_seen_at > now() - interval '3 days'),
           'played_today', (select count(*) from public.enterprise_announcement_play_logs pl
                              join public.enterprise_announcement_schedules s on s.id = pl.schedule_id
                             where s.enterprise_account_id = e.id and pl.status = 'played'
                               and pl.created_at >= (select start_at from today)),
           'failed_today', (select count(*) from public.enterprise_announcement_play_logs pl
                              join public.enterprise_announcement_schedules s on s.id = pl.schedule_id
                             where s.enterprise_account_id = e.id and pl.status = 'failed'
                               and pl.created_at >= (select start_at from today))
         ) order by e.enterprise_name), '[]'::jsonb)
    into v_res
    from eas e;
  return jsonb_build_object('success', true, 'data', v_res);
end;
$$;
revoke all on function public.admin_announcement_status(uuid) from public, anon;
grant execute on function public.admin_announcement_status(uuid) to authenticated;

-- ============================================================
-- 3) 알림 (매분)
-- ============================================================
create or replace function public.cron_check_announcement_health()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  r record;
  v_offline int := 0;
  v_failed int := 0;
  v_label text;
begin
  -- (a) 소리 허용된 안내 전용 기기가 닫힘 표시 없이 5분 넘게 조용함 → 1회 알림
  for r in
    select d.user_id, d.instance_id, d.enterprise_account_id, d.last_seen_at, ea.auth_user_id, ea.enterprise_name
      from public.announcer_devices d
      join public.enterprise_accounts ea on ea.id = d.enterprise_account_id
     where d.armed and d.closed_at is null and d.offline_notified_at is null
       and d.last_seen_at < now() - interval '5 minutes'
       and d.last_seen_at > now() - interval '1 day'
     for update of d skip locked
  loop
    v_label := public._announcement_store_label(r.user_id, r.enterprise_account_id);
    begin
      if r.auth_user_id is not null then
        insert into public.enterprise_notifications (
          enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
          title, message, severity, status, action_url, metadata)
        values (r.enterprise_account_id, 'user', r.auth_user_id, r.auth_user_id, 'announcer_offline',
          format('%s 안내방송 플레이어가 꺼졌어요', v_label),
          format('마지막 신호 %s. 그동안 안내방송은 같은 매장의 음악 플레이어가 대신 내보냅니다(켜져 있을 때). 기기 전원·인터넷을 확인해 주세요.',
                 to_char(r.last_seen_at at time zone 'Asia/Seoul', 'HH24:MI')),
          'high', 'unread', '/enterprise/content',
          jsonb_build_object('store_user_id', r.user_id, 'instance_id', r.instance_id, 'last_seen_at', r.last_seen_at));
      end if;
      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('announcer_offline', 'warning',
        format('[안내방송 플레이어 꺼짐] %s · %s', r.enterprise_name, v_label),
        format('마지막 신호 %s (KST)', to_char(r.last_seen_at at time zone 'Asia/Seoul', 'MM-DD HH24:MI')),
        jsonb_build_object('enterprise_account_id', r.enterprise_account_id, 'store_user_id', r.user_id,
                           'instance_id', r.instance_id, 'tab', 'enterprise-announcements'),
        0, now());
    exception when others then null;
    end;
    update public.announcer_devices set offline_notified_at = now()
     where user_id = r.user_id and instance_id = r.instance_id;
    v_offline := v_offline + 1;
  end loop;

  -- (b) 송출 실패 — 브랜드별로 묶어 1건
  for r in
    with f as (
      select pl.id, s.enterprise_account_id, pl.store_id, s.name as schedule_name,
             coalesce(pl.scheduled_for, pl.created_at) as at, pl.error_message
        from public.enterprise_announcement_play_logs pl
        join public.enterprise_announcement_schedules s on s.id = pl.schedule_id
       where pl.status = 'failed' and pl.alert_notified_at is null
         and pl.created_at > now() - interval '6 hours'
         and s.enterprise_account_id is not null
    )
    select f.enterprise_account_id, ea.auth_user_id, ea.enterprise_name,
           array_agg(f.id) as ids, count(*) as n,
           string_agg(format('%s %s · %s', to_char(f.at at time zone 'Asia/Seoul', 'HH24:MI'),
                             public._announcement_store_label(f.store_id, f.enterprise_account_id), f.schedule_name),
                      E'\n' order by f.at) as lines,
           bool_or(f.error_message like 'autoplay_blocked%') as has_autoplay
      from f join public.enterprise_accounts ea on ea.id = f.enterprise_account_id
     group by f.enterprise_account_id, ea.auth_user_id, ea.enterprise_name
  loop
    begin
      if r.auth_user_id is not null then
        insert into public.enterprise_notifications (
          enterprise_account_id, target_type, target_id, recipient_user_id, notification_type,
          title, message, severity, status, action_url, metadata)
        values (r.enterprise_account_id, 'user', r.auth_user_id, r.auth_user_id, 'announcement_failed',
          format('안내방송 %s건이 나가지 못했어요', r.n),
          left(r.lines, 900) || case when r.has_autoplay
            then E'\n매장 기기 화면을 한 번 눌러 두지 않아 소리가 막힌 경우가 있어요.' else '' end,
          'medium', 'unread', '/enterprise/content',
          jsonb_build_object('log_ids', to_jsonb(r.ids)));
      end if;
      insert into public.admin_notifications (kind, severity, title, body, context, dispatch_attempts, created_at)
      values ('announcement_failed', 'warning',
        format('[안내방송 송출 실패] %s · %s건', r.enterprise_name, r.n),
        left(r.lines, 900),
        jsonb_build_object('enterprise_account_id', r.enterprise_account_id, 'log_ids', to_jsonb(r.ids),
                           'tab', 'enterprise-announcements'),
        0, now());
    exception when others then null;
    end;
    update public.enterprise_announcement_play_logs set alert_notified_at = now() where id = any(r.ids);
    v_failed := v_failed + r.n;
  end loop;

  return jsonb_build_object('offline_alerts', v_offline, 'failed_alerted', v_failed);
end;
$$;
revoke all on function public.cron_check_announcement_health() from public, anon, authenticated;

-- 기존 실패 기록은 알림 대상에서 뺀다 (배포 직후 과거 실패가 한꺼번에 알림으로 나가지 않게).
update public.enterprise_announcement_play_logs set alert_notified_at = now()
 where status = 'failed' and alert_notified_at is null;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'srr-announcement-health';
    perform cron.schedule('srr-announcement-health', '* * * * *', 'select public.cron_check_announcement_health();');
  end if;
end;
$$;
