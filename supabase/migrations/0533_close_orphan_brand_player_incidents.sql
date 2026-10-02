-- 0533_close_orphan_brand_player_incidents.sql
--
-- 24시간 넘게 죽은 세션의 incident 가 영원히 안 닫히던 문제.
--
-- detect_brand_player_incidents() 는 _brand_player_liveness(1440) 을 순회하면서
-- 그 안에 있는 매장만 평가한다. 그런데 liveness 는 24시간 창이라, heartbeat 이
-- 24시간 넘게 끊긴 세션은 창 밖으로 빠진다.
--
--   열 때   : 세션이 아직 창 안 → DOWN 판정 → incident 열림
--   닫을 때 : 세션이 창 밖으로 나감 → 순회 대상 아님 → resolve 로직이 돌 기회가 없음
--
-- 그래서 한 번 열린 뒤 기기가 24시간 넘게 안 돌아오면 incident 가 영구히 열려 있다.
-- 2026-10-02 기준 숙대점 건이 33시간(2,001분), ai@swk.today 2건이 각각 17일·14일째
-- 열려 있었다. 숙대 건은 그 사이 매장이 정상 재생 중이었는데도(계정 재생 22곡/시간)
-- 열린 채였다 — 즉 쌓이기만 하고 신뢰도를 떨어뜨린다.
--
-- 왜 detect_brand_player_incidents() 를 고치지 않았는가
--   그 함수는 12KB 짜리 운영 판정 로직이다. 블록 하나 넣자고 전체를 다시 쓰면
--   옮겨적다 생기는 사고 위험이 이득보다 크다. 관심사도 다르다 — 이건 '판정'이
--   아니라 '뒷정리'다. 그래서 별도 함수 + 별도 크론으로 분리한다.
--
-- 동작
--   · liveness 창(기본 1440분)에 없는 매장의 열린 incident 를 닫는다.
--   · 열린 지 p_min_open_minutes(기본 60분) 지난 건만 — 순간적인 liveness 누락으로
--     갓 열린 건을 지우지 않기 위한 안전장치.
--   · resolve_notified_at 을 채워 **복구 Slack 을 억제**한다. 기기가 돌아와서 복구된
--     것이 아니라 추적을 포기하는 것이므로, 복구 알림을 보내면 거짓말이 된다.
--     (감시 제외 계정을 조용히 닫는 기존 블록과 같은 방식이다.)
--   · 왜 닫았는지 context.orphan_close 에 남긴다.

create or replace function public.close_orphan_brand_player_incidents(
  p_liveness_minutes int default 1440,
  p_min_open_minutes int default 60
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_closed int := 0;
begin
  with live as (
    select distinct l.brand_id, l.user_id
      from public._brand_player_liveness(p_liveness_minutes) l
  ),
  closed as (
    update public.brand_player_incidents i
       set resolved_at         = now(),
           last_checked_at     = now(),
           resolve_notified_at = now(),   -- 복구 알림 억제: 복구된 게 아니라 추적 종료다
           context = coalesce(i.context, '{}'::jsonb) || jsonb_build_object(
             'orphan_close', jsonb_build_object(
               'at', now(),
               'by', 'close_orphan_brand_player_incidents',
               'reason', 'session heartbeat older than liveness window — detector no longer evaluates this store',
               'liveness_minutes', p_liveness_minutes,
               'open_minutes', round(extract(epoch from (now() - i.opened_at)) / 60)))
     where i.resolved_at is null
       and i.opened_at < now() - make_interval(mins => p_min_open_minutes)
       and not exists (
             select 1 from live v
              where v.brand_id = i.brand_id
                and v.user_id  = i.store_user_id)
    returning 1
  )
  select count(*) into v_closed from closed;

  return jsonb_build_object(
    'ok', true,
    'orphan_closed', v_closed,
    'liveness_minutes', p_liveness_minutes,
    'min_open_minutes', p_min_open_minutes,
    'checked_at', now());
end;
$function$;

revoke all on function public.close_orphan_brand_player_incidents(int, int) from public;

-- 매시 7분. 고아 정리는 급하지 않다 — 정각은 다른 잡이 몰리므로 피한다.
-- 기존 잡이 있으면 먼저 내리고 다시 건다(중복 크론 금지).
do $$
begin
  if exists (select 1 from cron.job where jobname = 'srr-brand-player-orphan-close') then
    perform cron.unschedule('srr-brand-player-orphan-close');
  end if;
  perform cron.schedule('srr-brand-player-orphan-close', '7 * * * *',
    $cmd$select public.close_orphan_brand_player_incidents();$cmd$);
end $$;
