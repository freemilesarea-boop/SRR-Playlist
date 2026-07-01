-- 0396 — Enterprise Operations Center: Export Logs RPC (Phase 2-2 QA-6)
--
-- 목적:
--   운영 관제 탭의 "Export Logs" Quick Action 이 호출할 read-only RPC.
--   admin_operation_logs (source='cron') 를 최근 N일 범위로 반환.
--
-- 절대 무수정:
--   • 신규 table / view / index / trigger 없음
--   • 기존 admin_operation_logs 컬럼 무변경
--   • 기존 admin_log_operation / cron RPC 무관
--
-- 정책:
--   • security definer + set search_path='public'
--   • _is_super_admin() 게이트
--   • revoke public/anon, grant authenticated
--   • LIMIT 10000 하드 캡 (대용량 timeout 방지)
--   • p_from_days_ago 기본 30, 최대 365

create or replace function public.admin_enterprise_ops_export_logs(
  p_days       int default 30,
  p_source     text default 'cron',
  p_category   text default null,
  p_limit      int default 5000
) returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_days       int := greatest(1, least(coalesce(p_days, 30), 365));
  v_limit      int := greatest(1, least(coalesce(p_limit, 5000), 10000));
  v_source     text := coalesce(nullif(btrim(p_source), ''), 'cron');
  v_category   text := nullif(btrim(p_category), '');
  v_from_ts    timestamptz;
  v_rows       jsonb;
  v_count      int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  v_from_ts := now() - make_interval(days => v_days);

  select coalesce(jsonb_agg(row order by (row->>'created_at') desc), '[]'::jsonb),
         count(*)::int
    into v_rows, v_count
  from (
    select jsonb_build_object(
      'id',            id,
      'source',        source,
      'category',      category,
      'level',         level,
      'status',        status,
      'message',       message,
      'details',       details,
      'user_id',       user_id,
      'related_id',    related_id,
      'duration_ms',   duration_ms,
      'error_code',    error_code,
      'error_message', error_message,
      'created_at',    created_at
    ) as row
    from public.admin_operation_logs
    where created_at >= v_from_ts
      and source = v_source
      and (v_category is null or category = v_category)
    order by created_at desc
    limit v_limit
  ) t;

  return jsonb_build_object(
    'success',    true,
    'source',     v_source,
    'category',   v_category,
    'days',       v_days,
    'from_at',    v_from_ts,
    'to_at',      now(),
    'row_count',  v_count,
    'row_limit',  v_limit,
    'truncated',  v_count >= v_limit,
    'rows',       v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_enterprise_ops_export_logs(int, text, text, int) from public, anon;
grant   execute on function public.admin_enterprise_ops_export_logs(int, text, text, int) to authenticated;

comment on function public.admin_enterprise_ops_export_logs(int, text, text, int) is
  'Phase 2-2 QA-6: read-only export of admin_operation_logs. super_admin only. Hard-capped 10000 rows.';

-- ============================================================
-- Diagnostics
-- ============================================================
do $$
begin
  raise notice '0396 — admin_enterprise_ops_export_logs compiled OK (read-only, super_admin gated, LIMIT 10000)';
end$$;
