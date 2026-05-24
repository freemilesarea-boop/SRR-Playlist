-- 0141 — 0140 보강: PUBLIC 권한 회수. `=X/postgres`(PUBLIC) 가 남아 있으면 anon/authenticated 가
--   PUBLIC 을 통해 EXECUTE 를 상속하므로 명시적 anon/authenticated revoke 만으로는 부족하다.
--   PUBLIC 에서 회수하고 service_role 만 유지(정상 webhook/내부 호출 경로).
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (p.proname like '\_internal\_apply\_payapp\_%' or p.proname = 'redeem_promotion_code')
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
