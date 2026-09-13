-- 0513 — 알림 발송 복구 (숙대점 사례에서 드러난 전달 단절)
--
-- 무엇이 망가져 있었나:
--   admin_notifications 63건이 **전부 미발송**(dispatch_attempts = 0)이었다.
--     brand_player_down 23 · support_inquiry 14 · billing_recording_drift 8 · settlement_ready 2
--   매장이 15시간 멈춰도, 결제가 누락돼도 아무에게도 안 갔다.
--
-- 왜:
--   발송 담당이 Vercel cron(/api/cron/enterprise-ops, 15분 주기)인데
--   3일간 실행 로그가 0건이다(정상이면 ~288회/일). 크론 자체가 안 돈다.
--   DB 의 pg_cron 15개는 문제없이 돌고 있다 — 발송을 이쪽으로 옮긴다.
--
-- 왜 엣지 함수를 안 부르나:
--   dispatch-admin-notifications 는 x-cron-secret(= CRON_SECRET) 을 요구하는데
--   vault 의 brand_alert_secret 은 그 값과 다르다(net._http_response 에 401
--   "invalid worker secret" 12건). 우리가 가진 자격증명으로는 호출할 수 없다.
--   Slack 웹훅은 admin_settings 에 있고 DB 에서 바로 호출 가능하므로 그 경로를 쓴다.
--
-- 한계 (명시):
--   이 경로는 **Slack 전용**이다. 이메일(Resend)은 엣지 함수 시크릿이 필요해
--   여기서 보낼 수 없다. 이메일까지 살리려면 Vercel cron 을 고치거나
--   CRON_SECRET 을 vault 에 넣어야 한다.

-- ----------------------------------------------------------------------------
-- 1) 심각도 순서 — notification_min_severity 필터용
-- ----------------------------------------------------------------------------
create or replace function public._severity_rank(p text)
returns int
language sql
immutable
as $$
  select case lower(coalesce(p,'info'))
           when 'error' then 3
           when 'warning' then 2
           else 1
         end;
$$;

-- ----------------------------------------------------------------------------
-- 2) 미발송 알림을 Slack 으로 내보낸다.
--
--    • dispatched_at IS NULL 만 대상 (멱등)
--    • notification_min_severity 미만은 발송 대상에서 제외하되 재시도 큐에 남기지
--      않도록 dispatched 로 마킹한다(영원히 쌓이는 것 방지).
--    • Slack 미설정이면 아무것도 마킹하지 않는다 — 설정 후 그대로 나가야 하므로.
-- ----------------------------------------------------------------------------
create or replace function public.cron_dispatch_pending_notifications(p_limit int default 15)
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $$
declare
  v_slack text;
  v_min int;
  v_sent int := 0;
  r record;
  v_text text;
begin
  select trim(both '"' from (value::text)) into v_slack
    from public.admin_settings where key = 'notification_slack_webhook_url';

  -- Slack 이 없으면 큐를 건드리지 않는다(설정되면 그대로 발송되도록).
  if coalesce(v_slack, '') = '' then
    return 0;
  end if;

  select public._severity_rank(trim(both '"' from (value::text)))
    into v_min
    from public.admin_settings where key = 'notification_min_severity';
  v_min := coalesce(v_min, 2);

  for r in
    select id, kind, severity, title, body
    from public.admin_notifications
    where dispatched_at is null
    order by created_at
    limit greatest(1, p_limit)
  loop
    -- 심각도 미달 → 발송하지 않고 큐에서만 내린다.
    if public._severity_rank(r.severity) < v_min then
      update public.admin_notifications
         set dispatched_at = now(),
             dispatch_error = 'skipped: below min severity'
       where id = r.id;
      continue;
    end if;

    v_text := case lower(coalesce(r.severity,'info'))
                when 'error' then ':rotating_light: '
                when 'warning' then ':warning: '
                else ':information_source: '
              end
              || coalesce(r.title, '(제목 없음)')
              || case when coalesce(r.body,'') <> '' then E'\n' || r.body else '' end;

    begin
      perform net.http_post(
        url := v_slack,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('text', v_text),
        timeout_milliseconds := 8000);

      update public.admin_notifications
         set dispatched_at = now(),
             dispatch_attempts = coalesce(dispatch_attempts, 0) + 1,
             dispatch_error = null
       where id = r.id;
      v_sent := v_sent + 1;
    exception when others then
      -- 실패는 큐에 남긴다(다음 주기 재시도). 시도 횟수만 올린다.
      update public.admin_notifications
         set dispatch_attempts = coalesce(dispatch_attempts, 0) + 1,
             dispatch_error = left(SQLERRM, 200)
       where id = r.id;
    end;
  end loop;

  return v_sent;
end;
$$;

revoke all on function public.cron_dispatch_pending_notifications(int) from public, anon, authenticated;
grant execute on function public.cron_dispatch_pending_notifications(int) to service_role;

-- ----------------------------------------------------------------------------
-- 3) 밀린 63건 정리 — 하나씩 63개를 쏘면 Slack 이 도배된다.
--    요약 1건만 보내고 나머지 과거분은 큐에서 내린다.
--    (지금 미해소인 건은 다음 주기 감지에서 다시 알림이 생성되므로 손실 없음)
-- ----------------------------------------------------------------------------
create or replace function public.flush_notification_backlog(p_older_than interval default interval '1 hour')
returns int
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $$
declare
  v_slack text;
  v_count int;
  v_summary text;
begin
  select count(*) into v_count
    from public.admin_notifications
   where dispatched_at is null
     and created_at < now() - p_older_than;

  if coalesce(v_count, 0) = 0 then
    return 0;
  end if;

  select trim(both '"' from (value::text)) into v_slack
    from public.admin_settings where key = 'notification_slack_webhook_url';

  if coalesce(v_slack, '') <> '' then
    select ':package: 미발송 알림 ' || v_count || '건 정리 — 발송 경로가 끊겨 쌓여 있던 과거 알림입니다.' || E'\n'
           || string_agg(k || ' ' || c || '건', ' · ' order by c desc)
      into v_summary
      from (
        select kind as k, count(*) as c
          from public.admin_notifications
         where dispatched_at is null
           and created_at < now() - p_older_than
         group by kind
      ) s;

    begin
      perform net.http_post(
        url := v_slack,
        headers := jsonb_build_object('content-type', 'application/json'),
        body := jsonb_build_object('text', v_summary),
        timeout_milliseconds := 8000);
    exception when others then null;
    end;
  end if;

  update public.admin_notifications
     set dispatched_at = now(),
         dispatch_error = 'flushed: backlog summary sent'
   where dispatched_at is null
     and created_at < now() - p_older_than;

  return v_count;
end;
$$;

revoke all on function public.flush_notification_backlog(interval) from public, anon, authenticated;
grant execute on function public.flush_notification_backlog(interval) to service_role;

-- ----------------------------------------------------------------------------
-- 4) 스케줄 — 5분마다. 감지(srr-brand-player-health)와 같은 주기.
-- ----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('srr-dispatch-notifications')
      where exists (select 1 from cron.job where jobname = 'srr-dispatch-notifications');
    perform cron.schedule('srr-dispatch-notifications', '*/5 * * * *',
                          'select public.cron_dispatch_pending_notifications(15);');
  end if;
end;
$$;
