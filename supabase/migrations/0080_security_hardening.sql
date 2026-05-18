-- 0080 — 보안 강화: view 권한 잠금 + helper 함수 search_path
--
-- Supabase advisor 보고 기반:
-- - ERROR: security_definer_view — eligible_settlement_tracks 가 SECURITY DEFINER
-- - WARN: function_search_path_mutable — 내부 helper 함수 24건 search_path 미명시
--
-- 조치:
-- 1) eligible_settlement_tracks view 권한을 anon/authenticated 에서 회수
--    · 정산 RPC (postgres owner SECURITY DEFINER) 가 view 를 사용하지만 owner 권한이라
--      view 권한과 무관 — 안전하게 회수 가능
--    · Postgres 15+ 환경에서는 SECURITY INVOKER 옵션도 적용 (RLS 호출자 권한 사용)
-- 2) 내부 helper 함수 24건 search_path 명시 (defense-in-depth)
--    · trigger 함수들이라 컨텍스트는 이미 통제됨, 표준 hardening 패턴

REVOKE ALL ON public.eligible_settlement_tracks FROM anon, authenticated;
GRANT SELECT ON public.eligible_settlement_tracks TO service_role;

DO $$ BEGIN
  BEGIN
    EXECUTE 'ALTER VIEW public.eligible_settlement_tracks SET (security_invoker = true)';
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;

DO $$
DECLARE
  fn record; fn_name text;
  fn_list text[] := ARRAY[
    '_artist_contract_protect_signed','_artist_settlements_protect',
    '_business_verification_set_updated_at','_chart_period_start',
    '_curator_profiles_set_updated_at','_internal_is_admin_caller',
    '_mask_account_number','_next_artist_track_code',
    '_payapp_state_label','_payapp_webhook_event_compute',
    '_payout_reveal_logs_protect','_settlement_items_protect',
    '_settlement_policies_protect','_settlement_runs_protect',
    '_streaming_revenues_protect','_touch_artist_profiles_updated_at',
    '_touch_updated_at','_tracks_artist_update_guard',
    '_tracks_release_protect','_tracks_release_visibility_sync',
    '_tracks_set_track_code','_trg_block_payment_paid_downgrade',
    '_trg_block_subscription_active_downgrade','touch_updated_at'
  ];
BEGIN
  FOREACH fn_name IN ARRAY fn_list LOOP
    FOR fn IN
      SELECT p.oid::regprocedure AS sig FROM pg_proc p
      JOIN pg_namespace n ON n.oid=p.pronamespace
      WHERE n.nspname='public' AND p.proname=fn_name
    LOOP
      EXECUTE format('ALTER FUNCTION %s SET search_path = ''public''', fn.sig);
    END LOOP;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';
