-- 0195b — 0195 보안 하드닝 (advisor 대응)
-- 1) expire_free_trials 는 cron/service_role 전용 (내부 권한 체크 없음) →
--    public/anon/authenticated 실행권한 회수.
revoke execute on function public.expire_free_trials() from public;
revoke execute on function public.expire_free_trials() from anon;
revoke execute on function public.expire_free_trials() from authenticated;
grant execute on function public.expire_free_trials() to service_role;

-- 2) _normalize_phone search_path 고정 (function_search_path_mutable)
create or replace function public._normalize_phone(p text)
returns text language sql immutable set search_path = pg_catalog, public as $$
  select nullif(regexp_replace(coalesce(p, ''), '\D', '', 'g'), '');
$$;
