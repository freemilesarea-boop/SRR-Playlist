-- 0392 — admin_notifications dispatch 멱등화 (Phase 1-2)
--
-- 배경:
--   Phase 1-1 cron(enterprise-ops)이 dispatch-admin-notifications 를 주기 호출하는데,
--   admin_notifications 에 "발송 완료" 마커가 없어 윈도우 겹침 시 동일 알림이
--   Slack/이메일로 중복 발송될 수 있었음.
--
-- 수정 (조회 화면/생성 로직 무수정, 발송 추적 컬럼만 추가):
--   - dispatched_at        : 적용 채널이 모두 처리(성공 or 비활성)되면 set → 재발송 차단 기준.
--   - dispatch_slack_at    : Slack 발송 성공 시각 (채널별 멱등 — 실패 채널만 재시도).
--   - dispatch_email_at    : 이메일 발송 성공 시각.
--   - dispatch_attempts    : 디스패치 시도 횟수.
--   - dispatch_error       : 최근 실패 사유 요약.
--   - 미발송 조회용 partial index.
--   - 기존 row 는 dispatched_at = created_at 로 backfill → 배포 직후 과거 알림 대량
--     재발송 방지 (역사적 알림은 "이미 처리"로 간주).
--
-- 절대 무수정:
--   - create_admin_notification / admin_list_notifications / unread_count / mark_read
--     RPC 무수정 (UI 는 새 컬럼을 select 하지 않으므로 영향 0, null-safe).
--   - RLS 정책 무수정 (service_role 는 0083 에서 이미 INSERT/UPDATE/DELETE grant 보유 →
--     edge dispatch 가 새 컬럼 UPDATE 가능. authenticated 는 여전히 mutate 차단).
--   - 기존 cron 구조 유지 (enterprise-ops 가 동일 edge 를 호출, 윈도우만 조정).

-- ============================================================
-- 1) dispatch 추적 컬럼 (additive, nullable)
-- ============================================================
alter table public.admin_notifications
  add column if not exists dispatched_at     timestamptz,
  add column if not exists dispatch_slack_at  timestamptz,
  add column if not exists dispatch_email_at  timestamptz,
  add column if not exists dispatch_attempts  integer not null default 0,
  add column if not exists dispatch_error     text;

-- 미발송 알림 빠른 조회 (cron dispatch 대상)
create index if not exists idx_admin_notif_pending_dispatch
  on public.admin_notifications (created_at desc)
  where dispatched_at is null;

-- ============================================================
-- 2) 기존 row backfill — 과거 알림은 "이미 처리"로 간주 (재발송 방지)
-- ============================================================
update public.admin_notifications
   set dispatched_at = created_at
 where dispatched_at is null;

-- ============================================================
-- 3) Diagnostics
-- ============================================================
do $$
declare v_cols int; v_pending int;
begin
  select count(*) into v_cols from information_schema.columns
   where table_schema='public' and table_name='admin_notifications'
     and column_name in ('dispatched_at','dispatch_slack_at','dispatch_email_at','dispatch_attempts','dispatch_error');
  select count(*) into v_pending from public.admin_notifications where dispatched_at is null;
  raise notice '====== 0392 admin_notifications dispatch idempotency ======';
  raise notice 'new columns: % / 5 ; pending(dispatched_at null) after backfill: %', v_cols, v_pending;
  if v_cols = 5 and v_pending = 0 then
    raise notice '0392 COMPLETE — dispatch markers added, history backfilled (no resend flood)';
  else
    raise warning '0392 CHECK — cols=% pending=% (pending should be 0 after backfill)', v_cols, v_pending;
  end if;
end$$;
