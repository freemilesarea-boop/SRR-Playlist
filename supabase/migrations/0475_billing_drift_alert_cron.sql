-- ============================================================================
-- 0475_billing_drift_alert_cron.sql  (P0 완성 — 드리프트 자동 통보)
-- 0473이 만든 결제기록 드리프트 감지(v_billing_recording_drift / check_billing_recording_drift)
-- 를 "매일 자동 점검 + 관리자 통보"로 연결한다. 감지에 그치지 않고, 다시는 몇 달간
-- 방치되지 않도록 drift>0 이면 admin_notifications 에 알림을 쌓아 기존 디스패치
-- (Slack/email)로 전파되게 한다.
--
-- 안전: 읽기 기반 점검 + 알림 insert 만. 결제/정산/멤버십 무변경. 재알림 방지(20시간
--   윈도)로 스팸 없음. 롤백 트랜잭션 실측 3/3 PASS(무드리프트→무알림 / 발생→알림 / 재알림방지).
-- ============================================================================

create or replace function public.alert_billing_recording_drift()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_drift int;
  v_completed int;
  v_recent int;
begin
  select drift_count, completed_webhooks
    into v_drift, v_completed
  from public.check_billing_recording_drift();

  if coalesce(v_drift, 0) <= 0 then
    return 0;
  end if;

  -- 재알림 방지: 최근 20시간 내 동일 알림이 있으면 새로 만들지 않음
  select count(*) into v_recent
  from public.admin_notifications
  where kind = 'billing_recording_drift'
    and created_at > now() - interval '20 hours';
  if v_recent > 0 then
    return v_drift;
  end if;

  insert into public.admin_notifications
    (kind, severity, title, body, context, dispatch_attempts, created_at)
  values
    ('billing_recording_drift', 'error',
     '결제 기록 누락 감지 (' || v_drift || '건)',
     'PayApp 완료 결제 ' || v_drift || '건이 payment_orders 에 기록되지 않았습니다. ' ||
     'public.v_billing_recording_drift 뷰에서 상세 확인 후 재처리가 필요합니다. ' ||
     '(완료 웹훅 총 ' || v_completed || '건 기준)',
     jsonb_build_object('drift_count', v_drift, 'completed_webhooks', v_completed,
                        'source', 'alert_billing_recording_drift',
                        'view', 'v_billing_recording_drift'),
     0, now());

  return v_drift;
end;
$$;

revoke all on function public.alert_billing_recording_drift() from public;
grant execute on function public.alert_billing_recording_drift() to service_role;

-- 매일 06:00 KST (21:00 UTC) 자동 점검·통보 (jobname 기준 upsert → 멱등)
select cron.schedule(
  'srr-billing-drift-check',
  '0 21 * * *',
  $cron$select public.alert_billing_recording_drift();$cron$
);
