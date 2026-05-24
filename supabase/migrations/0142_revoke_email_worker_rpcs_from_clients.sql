-- 0142 — [보안 MED] 이메일 워커 RPC 의 anon/authenticated/PUBLIC EXECUTE 회수.
--   lock/mark/get_pending (contract·moderation email job) 함수는 dispatch-*-emails Edge Function 이
--   service_role(sbAdmin)로만 호출한다. 프론트는 edge function 만 invoke 하고 이 RPC 를 직접 호출하지 않음.
--   anon/authenticated 직접 호출 시 이메일 잡을 임의로 sent/failed 처리해 계약/검수 메일 발송을 방해할 수 있어 회수.
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'lock_contract_email_job','mark_contract_email_sent','mark_contract_email_failed','get_pending_contract_email_jobs',
        'lock_track_moderation_email_job','mark_track_moderation_email_sent','mark_track_moderation_email_failed','get_pending_track_moderation_email_jobs'
      )
  loop
    execute format('revoke execute on function %s from public', r.sig);
    execute format('revoke execute on function %s from anon', r.sig);
    execute format('revoke execute on function %s from authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end $$;
