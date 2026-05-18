-- 0084 — admin RPC 권한 표면 축소 (defense-in-depth)
--
-- 배경:
-- Postgres 기본: 함수 생성 시 PUBLIC 에 EXECUTE 자동 부여.
-- 기존 migrations 가 GRANT EXECUTE TO authenticated 만 했고 PUBLIC EXECUTE 가 남아 있었음.
-- 결과: anon (비로그인) 사용자도 admin RPC 호출 시도 가능.
--
-- 실제 영향:
-- 모든 admin RPC 가 내부에 `if not exists (... auth.uid() = admin) then raise 'admin only'`
-- 가드 보유 → anon 호출 시 'admin only' 예외 발생. **데이터 노출은 일어나지 않음**.
--
-- 본 마이그레이션:
-- - REVOKE EXECUTE ON FUNCTION ... FROM PUBLIC, anon
-- - authenticated / service_role 권한은 유지 (RPC 내부 가드로 비-admin 차단)
-- - 호출 표면 축소 → advisor 경고 & spray attack 노이즈 감소

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid, p.proname, p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public'
      AND p.prosecdef=true
      AND (
        p.proname LIKE 'admin_%'
        OR p.proname IN (
          'create_admin_notification',
          'update_track_audio_health',
          'pick_tracks_for_health_check',
          'process_due_scheduled_releases'
        )
      )
  LOOP
    BEGIN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon', r.sig);
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'revoke skipped for %: %', r.proname, SQLERRM;
    END;
  END LOOP;
END $$;

-- 검증 (참고):
-- WITH admin_rpcs AS (
--   SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
--   WHERE n.nspname='public' AND p.prosecdef=true AND p.proname LIKE 'admin_%'
-- )
-- SELECT count(*) FILTER (WHERE has_function_privilege('anon', oid, 'EXECUTE')) AS anon_exposed,
--        count(*) AS total
-- FROM admin_rpcs;
-- → anon_exposed=0, total=66 (배포 후 확인 완료)

NOTIFY pgrst, 'reload schema';
