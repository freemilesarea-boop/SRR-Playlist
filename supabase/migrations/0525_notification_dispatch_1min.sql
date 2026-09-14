-- 0525 — Slack 전달을 5분에서 1분으로. 그리고 그래도 안전하도록 디스패처를 잠근다.
--
-- 왜 — 2026-09-14 숙대점 실측:
--
--   17:29:15  heartbeat 침묵 시작
--   17:33:00  SUSPECTED_DOWN  (incident 만 열림, Slack 없음 — 설계대로)
--   17:35:00  DOWN 확정 + admin_notifications 행 생성
--   17:40:00  ← Slack 실제 발송.  **여기서 5분을 그냥 잃었다.**
--
-- 감지는 5분 45초 만에 끝났는데 전달에서 5분을 더 먹었다. 무인 매장에서 그 5분은
-- 손님이 정적 속에 앉아 있는 시간이다.
--
-- ── 왜 지금까지 5분이었나, 그리고 왜 이제 바꿔도 되나 ──────────────────────
--
-- 5분은 "같은 장애로 Slack 이 도배되지 않게" 하는 안전장치 역할을 겸하고 있었다.
-- 그 역할은 이제 0522 가 **행을 만드는 쪽에서** 이미 한다:
--
--   · DOWN      — `down_notified_at is null` 일 때만 알림 행을 만든다. outage 당 1회.
--   · RECOVERED — incident 가 resolved 로 넘어가는 그 UPDATE 안에서만 만들고,
--                 넘어간 뒤에는 열린 집합에서 빠져 두 번 만들어질 수 없다.
--                 (`resolve_notified_at` 이 그 사실을 기록한다.)
--   · SUSPECTED — 알림 행을 아예 만들지 않는다.
--
-- 즉 debounce 의 canonical 위치는 incident state 다. 디스패처는 "만들어진 행을
-- 한 번 보낸다" 만 하면 된다. 그러니 주기를 줄여도 Slack 이 늘지 않는다.
--
-- ── 다만 주기를 줄이면 새로 생기는 위험 ────────────────────────────────────
--
-- 지금 디스패처는 `where dispatched_at is null ... limit 15` 로 행을 고르고,
-- 루프 안에서 하나씩 보낸 뒤 dispatched_at 을 찍는다. **행을 선점하지 않는다.**
-- 두 실행이 겹치면 둘 다 같은 행을 골라 **같은 Slack 을 두 번** 보낸다.
--
-- */5 에서는 실행이 워낙 짧아 겹칠 일이 없었다(실측: 알림 131건, dispatch_attempts
-- 최댓값 1, 중복 0). 하지만 1분 주기에서는 그 여유가 사라진다. pg_cron 은 같은
-- 잡의 이전 실행이 아직 도는 중이어도 새 실행을 막아주지 않는다.
--
-- 그래서 **주기를 바꾸기 전에** 선점을 넣는다: `for update skip locked`.
-- 함수 전체가 한 트랜잭션이므로, 먼저 든 실행이 고른 행은 커밋될 때까지 잠겨
-- 있고 겹쳐 든 실행은 그 행을 건너뛴다. 한 행은 정확히 한 번만 발송된다.
--
-- ── 이 마이그레이션이 하지 않는 것 ──────────────────────────────────────────
--   • 0522 감지 로직·임계값·알림 행 생성 규칙을 건드리지 않는다.
--   • severity 필터, Slack 문구, 재시도 의미를 바꾸지 않는다.
--   • 만료된 command 의 status 잔존 문제는 손대지 않는다(P2 backlog).
--   • 파괴적 DDL 없음.

-- ----------------------------------------------------------------------------
-- 1) 디스패처 — 행 선점만 추가한다. 나머지는 그대로다.
-- ----------------------------------------------------------------------------
create or replace function public.cron_dispatch_pending_notifications(p_limit integer default 15)
returns integer
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $function$
declare
  v_slack text;
  v_min int;
  v_sent int := 0;
  r record;
  v_text text;
begin
  select trim(both '"' from (value::text)) into v_slack
    from public.admin_settings where key = 'notification_slack_webhook_url';

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
    -- 1분 주기에서 실행이 겹쳐도 같은 행을 두 번 보내지 않는다.
    -- 겹쳐 든 실행은 잠긴 행을 조용히 건너뛰고 다음 행으로 간다.
    for update skip locked
  loop
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
      update public.admin_notifications
         set dispatch_attempts = coalesce(dispatch_attempts, 0) + 1,
             dispatch_error = left(SQLERRM, 200)
       where id = r.id;
    end;
  end loop;

  return v_sent;
end;
$function$;

comment on function public.cron_dispatch_pending_notifications(integer) is
  '미발송 admin_notifications 를 Slack 으로 보낸다. 행을 for update skip locked 로 선점하므로 실행이 겹쳐도 한 행은 정확히 한 번만 발송된다. debounce 는 여기가 아니라 incident state(0522)가 한다.';

revoke all on function public.cron_dispatch_pending_notifications(integer) from public, anon, authenticated;
grant execute on function public.cron_dispatch_pending_notifications(integer) to service_role;

-- ----------------------------------------------------------------------------
-- 2) 주기 5분 → 1분
--
--    잡이 없으면 만들고, 있으면 schedule 만 바꾼다. 중복 잡을 만들지 않는다
--    (0522 에서 srr-brand-player-health 에 쓴 것과 같은 가드다).
-- ----------------------------------------------------------------------------
do $cron$
declare v_id bigint;
begin
  select jobid into v_id from cron.job where jobname = 'srr-dispatch-notifications';
  if v_id is null then
    perform cron.schedule('srr-dispatch-notifications', '* * * * *',
                          'select public.cron_dispatch_pending_notifications(15);');
  else
    perform cron.alter_job(v_id, schedule => '* * * * *');
  end if;
end
$cron$;
