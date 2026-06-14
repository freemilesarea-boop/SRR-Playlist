-- 0344 — Hotfix: admin_list_embedding_jobs service_role 권한 회귀 (X6.78)
--
-- 문제:
--   X6.73 (0340 Phase 6) 의 admin_list_embedding_jobs 가 admin 만 select 허용.
--   local_worker.py (X6.77) 가 service_role 키로 호출 시 WHERE 필터에 막혀 빈 결과 반환.
--   → 워커가 847건 enqueue 후 큐를 못 읽고 즉시 종료.
--
-- 수정:
--   admin_mark_embedding_job_done 과 동일 패턴 (admin || service_role || postgres) 적용.

create or replace function public.admin_list_embedding_jobs(
  p_status text default null, p_limit int default 50
)
returns table(
  id uuid, track_id uuid, track_title text, status text,
  source text, attempts int, max_attempts int,
  enqueued_at timestamptz, dispatched_at timestamptz, finished_at timestamptz,
  error text, response jsonb
) language sql stable security definer set search_path to 'public' as $$
  select j.id, j.track_id, t.title, j.status,
         j.source, j.attempts, j.max_attempts,
         j.enqueued_at, j.dispatched_at, j.finished_at,
         j.error, j.response
  from public.track_embedding_jobs j
  left join public.tracks t on t.id = j.track_id
  where (
    exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
    or coalesce(auth.role(), '') = 'service_role'
    or current_user = 'postgres'
  )
    and (p_status is null or p_status='all' or j.status = p_status)
  order by j.enqueued_at desc
  limit greatest(1, p_limit);
$$;
grant execute on function public.admin_list_embedding_jobs(text, int) to authenticated, service_role;
