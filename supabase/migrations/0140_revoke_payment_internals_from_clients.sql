-- 0140 — [보안 CRITICAL] 결제/프로모션 내부 적용 함수의 anon/authenticated EXECUTE 회수.
--   _internal_apply_payapp_* (paid/refund/cancel/router) 와 redeem_promotion_code 는
--   SECURITY DEFINER 이며 호출자 권한 가드가 없다. 정상 호출 경로는:
--     - payapp webhook Edge Function → service_role 로 _internal_apply_payapp_event(router) 호출
--     - create-payapp-subscription Edge Function → service_role 로 redeem_promotion_code 호출
--     - 관리자/라우터 RPC(postgres-owned SECURITY DEFINER) 내부 중첩 호출 → definer(postgres) 권한으로 실행
--   따라서 anon/authenticated 직접 호출은 전부 비정상(결제 위조/환불 강제/프로모션 위조)이며
--   회수해도 정상 경로(service_role / 내부 definer 호출)는 영향 없음.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_internal\_apply\_payapp\_%' or p.proname = 'redeem_promotion_code')
  loop
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
