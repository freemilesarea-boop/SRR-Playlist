-- 0092 — P0/P1 마감 패치
--
-- P0: record_stream_event_safe legacy 9-arg 시그니처 DROP
-- - 0089 가 11-arg 로 확장하면서 OLD 시그니처 DROP 누락 → overload 공존
-- - PostgREST overload 충돌 시 PGRST203 raise 위험 (실 트래픽 영향 없었으나 잠재)
-- - 11-arg v2 만 유지
--
-- P1: admin 로직 RPC 18개 anon/PUBLIC EXECUTE 회수
-- - 함수명에 'admin_' 접두어 없어 0084 회수에서 누락된 RPC들
-- - 모두 내부 'admin only' raise 가드 보유 → 데이터 노출 X
-- - 표면 축소 (advisor 경고 + spray attack 노이즈 감소)

DROP FUNCTION IF EXISTS public.record_stream_event_safe(
  uuid, text, text, integer, boolean, uuid, text, text, text
);

DO $$
DECLARE
  fn_name text;
  fn_list text[] := ARRAY[
    'approve_artist_profile',
    'reject_artist_profile',
    'approve_artist_track',
    'reject_artist_track',
    'hide_artist_track',
    'reject_artist_contract',
    'reject_artist_payout_account',
    'verify_artist_payout_account',
    'list_pending_artists',
    'list_pending_payout_accounts',
    'list_admin_operation_logs',
    'clear_old_admin_operation_logs',
    'list_manual_payment_imports',
    'list_recent_sync_attempts',
    'list_recent_webhook_events',
    'list_subscription_requests',
    'repair_artist_signups',
    'ensure_artist_contract_for_user'
  ];
  r record;
BEGIN
  FOREACH fn_name IN ARRAY fn_list LOOP
    FOR r IN
      SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=fn_name
    LOOP
      BEGIN
        EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
      EXCEPTION WHEN OTHERS THEN
        RAISE NOTICE 'revoke skipped for %: %', r.sig, SQLERRM;
      END;
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
