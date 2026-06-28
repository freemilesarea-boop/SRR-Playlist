-- 0377 — Policy Deployment Center V2 (Priority 2-5/6/7)
--
-- 목표:
--   1) 시스템 전체 적용률 집계 KPI (총 매장 / 완료 / 대기 / 실패 / 적용률 / 최근 배포)
--   2) 모든 배포에 걸친 실패 매장 단일 리스트 + 실패 사유 자동 분류
--   3) 실패 매장 단건 재시도 RPC (bulk 는 기존 admin_retry_policy_deployment_targets 재사용)
--
-- 절대 원칙:
--   - 기존 테이블 (enterprise_policy_deployments / _targets) 스키마 무변경
--   - 기존 RPC 8개 무변경 (admin_create/recompute/list/kpi/detail/mark_failed/retry/list_deployable)
--   - 기존 view 2개 (enterprise_policy_deployment_summary / _target_status) 무변경
--   - apply_franchise_policy / store_heartbeat / store_now_playing 무관
--   - artist / settlement / payment / player / queue / crossfade / AI 무관
--
-- 새 RPC 3개:
--   admin_policy_deployment_overview()
--   admin_policy_deployment_failed_stores(...)
--   admin_request_policy_retry(p_deployment_id, p_store_id)
--
-- 실패 사유 분류 (priority order):
--   policy_version_mismatch → heartbeat_missing → device_offline
--   → playback_error → app_version_old → unknown

-- ============================================================
-- 1) admin_policy_deployment_overview — 시스템 전체 집계
-- ============================================================
create or replace function public.admin_policy_deployment_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_recent_24h timestamptz := now() - interval '24 hours';
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  return jsonb_build_object(
    -- 대상 매장: 모든 비-cancelled, 비-soft-delete deployment 의 target 합
    'total_target_stores', (
      select coalesce(sum(d.target_store_count), 0)::int
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    'success_stores', (
      select coalesce(sum(d.success_count), 0)::int
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    'pending_stores', (
      select coalesce(sum(d.pending_count), 0)::int
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    'failed_stores', (
      select coalesce(sum(d.failed_count), 0)::int
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    'skipped_stores', (
      select coalesce(sum(d.skipped_count), 0)::int
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    -- 적용률 = success / (target - skipped) * 100 (소수점 2자리)
    'success_rate', (
      select case
        when coalesce(sum(d.target_store_count - d.skipped_count), 0) <= 0 then 0
        else round(
          (sum(d.success_count)::numeric
            / nullif(sum(d.target_store_count - d.skipped_count), 0)::numeric) * 100,
          2)
      end
        from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status <> 'cancelled'
    ),
    'total_deployments', (
      select count(*) from public.enterprise_policy_deployments d
       where d.deleted_at is null
    ),
    'recent_24h_deployments', (
      select count(*) from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.started_at >= v_recent_24h
    ),
    'last_deployment_at', (
      select max(d.started_at) from public.enterprise_policy_deployments d
       where d.deleted_at is null
    ),
    'last_deployment_name', (
      select d.deployment_name from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.started_at is not null
       order by d.started_at desc nulls last
       limit 1
    ),
    -- 진행 중 / 부분 실패 / 실패 상태 deployment 수 — 운영 시각화용
    'running_deployments', (
      select count(*) from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status = 'running'
    ),
    'partial_failed_deployments', (
      select count(*) from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status = 'partial_failed'
    ),
    'failed_deployments', (
      select count(*) from public.enterprise_policy_deployments d
       where d.deleted_at is null and d.status = 'failed'
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_policy_deployment_overview() from public, anon;
grant execute on function public.admin_policy_deployment_overview() to authenticated;

-- ============================================================
-- 2) admin_policy_deployment_failed_stores — cross-deployment 실패 매장
-- ============================================================
-- 분류 우선순위:
--   policy_version_mismatch (failure_reason ILIKE '%version%' OR applied < expected)
--   heartbeat_missing       (sync_status row 자체 없음)
--   device_offline          (last_seen_at IS NULL OR < now()-10min)
--   playback_error          (sync_status.playback_error 존재)
--   app_version_old         (app_version IS NULL or empty)
--   unknown                 (그 외)
create or replace function public.admin_policy_deployment_failed_stores(
  p_search             text default null,
  p_franchise_id       uuid default null,
  p_enterprise_region_id uuid default null,
  p_failure_category   text default null,
  p_deployment_id      uuid default null,
  p_from               timestamptz default null,
  p_to                 timestamptz default null,
  p_limit              int default 100,
  p_offset             int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_limit  int := coalesce(nullif(p_limit, 0), 100);
  v_offset int := coalesce(p_offset, 0);
  v_total  int;
  v_rows   jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with classified as (
    select
      ts.target_id,
      ts.deployment_id,
      d.deployment_name,
      d.started_at as deployment_started_at,
      ts.store_id,
      ts.store_name,
      ts.enterprise_account_id,
      ts.enterprise_name,
      ts.enterprise_region_id,
      ts.region_name,
      ts.region_code,
      ts.expected_policy_id,
      ts.expected_policy_name,
      ts.expected_version_number,
      ts.applied_policy_id,
      ts.applied_policy_name,
      ts.applied_version_number,
      ts.current_active_policy_id,
      ts.current_active_version_number,
      ts.current_player_status,
      ts.last_attempt_at,
      ts.failed_at,
      ts.failure_reason,
      ts.retry_count,
      ts.last_seen_at,
      ts.last_synced_at,
      sps.app_version,
      sps.playback_error,
      case
        when nullif(btrim(coalesce(ts.failure_reason, '')), '') ilike '%version%'
          or (
            ts.applied_version_number is not null
            and ts.expected_version_number is not null
            and ts.applied_version_number < ts.expected_version_number
          )
          then 'policy_version_mismatch'
        when sps.store_id is null
          then 'heartbeat_missing'
        when ts.last_seen_at is null or ts.last_seen_at < now() - interval '10 minutes'
          then 'device_offline'
        when nullif(btrim(coalesce(sps.playback_error, '')), '') is not null
          then 'playback_error'
        when sps.app_version is null or btrim(sps.app_version) = ''
          then 'app_version_old'
        else 'unknown'
      end as failure_category
    from public.enterprise_policy_deployment_target_status ts
    join public.enterprise_policy_deployments d
      on d.id = ts.deployment_id and d.deleted_at is null
    left join public.store_policy_sync_status sps
      on sps.store_id = ts.store_id
    where ts.status = 'failed'
      and (p_deployment_id is null or ts.deployment_id = p_deployment_id)
      and (p_enterprise_region_id is null or ts.enterprise_region_id = p_enterprise_region_id)
      and (p_from is null or ts.failed_at >= p_from)
      and (p_to is null or ts.failed_at <= p_to)
      and (
        p_franchise_id is null
        or exists (
          select 1 from public.franchise_stores fs
           where fs.store_id = ts.store_id
             and fs.franchise_id = p_franchise_id
             and fs.status = 'active'
        )
      )
      and (
        p_search is null
        or ts.store_name ilike '%' || p_search || '%'
        or coalesce(ts.region_name, '')        ilike '%' || p_search || '%'
        or coalesce(ts.enterprise_name, '')    ilike '%' || p_search || '%'
        or coalesce(ts.expected_policy_name, '') ilike '%' || p_search || '%'
        or coalesce(ts.failure_reason, '')     ilike '%' || p_search || '%'
      )
  ),
  filtered as (
    select * from classified
     where p_failure_category is null or failure_category = p_failure_category
  )
  select
    count(*) over (),
    coalesce(
      jsonb_agg(
        jsonb_build_object(
          'target_id', f.target_id,
          'deployment_id', f.deployment_id,
          'deployment_name', f.deployment_name,
          'deployment_started_at', f.deployment_started_at,
          'store_id', f.store_id,
          'store_name', f.store_name,
          'enterprise_account_id', f.enterprise_account_id,
          'enterprise_name', f.enterprise_name,
          'enterprise_region_id', f.enterprise_region_id,
          'region_name', f.region_name,
          'region_code', f.region_code,
          'expected_policy_id', f.expected_policy_id,
          'expected_policy_name', f.expected_policy_name,
          'expected_version_number', f.expected_version_number,
          'applied_policy_id', f.applied_policy_id,
          'applied_policy_name', f.applied_policy_name,
          'applied_version_number', f.applied_version_number,
          'current_active_policy_id', f.current_active_policy_id,
          'current_active_version_number', f.current_active_version_number,
          'current_player_status', f.current_player_status,
          'last_attempt_at', f.last_attempt_at,
          'failed_at', f.failed_at,
          'failure_reason', f.failure_reason,
          'failure_category', f.failure_category,
          'retry_count', f.retry_count,
          'last_seen_at', f.last_seen_at,
          'last_synced_at', f.last_synced_at,
          'app_version', f.app_version,
          'playback_error', f.playback_error
        )
        order by f.failed_at desc nulls last, f.last_attempt_at desc nulls last
      ),
      '[]'::jsonb
    )
  into v_total, v_rows
  from (
    select * from filtered
     order by failed_at desc nulls last, last_attempt_at desc nulls last
     limit v_limit offset v_offset
  ) f;

  return jsonb_build_object(
    'success', true,
    'data', coalesce(v_rows, '[]'::jsonb),
    'pagination', jsonb_build_object(
      'total', coalesce(v_total, 0),
      'limit', v_limit,
      'offset', v_offset,
      'has_more', coalesce(v_total, 0) > (v_offset + v_limit)
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_policy_deployment_failed_stores(
  text, uuid, uuid, text, uuid, timestamptz, timestamptz, int, int
) from public, anon;
grant execute on function public.admin_policy_deployment_failed_stores(
  text, uuid, uuid, text, uuid, timestamptz, timestamptz, int, int
) to authenticated;

-- ============================================================
-- 3) admin_request_policy_retry — 단건 매장 재시도
-- ============================================================
-- Bulk retry 는 기존 admin_retry_policy_deployment_targets 그대로 사용.
-- 본 RPC 는 (deployment_id, store_id) 1건만 재설정.
create or replace function public.admin_request_policy_retry(
  p_deployment_id uuid,
  p_store_id      uuid
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target_id uuid;
  v_prev_status text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_deployment_id is null then raise exception 'deployment_id required'; end if;
  if p_store_id      is null then raise exception 'store_id required'; end if;

  -- 대상 target row 존재 확인
  select t.id, t.status::text
    into v_target_id, v_prev_status
    from public.enterprise_policy_deployment_targets t
   where t.deployment_id = p_deployment_id
     and t.store_id = p_store_id
   limit 1;

  if v_target_id is null then
    raise exception 'deployment target not found for (deployment=%s, store=%s)',
      p_deployment_id, p_store_id;
  end if;

  -- 단건 재설정 — status='pending', failed_at=null, failure_reason=null, retry_count+1
  update public.enterprise_policy_deployment_targets
     set status         = 'pending',
         failed_at      = null,
         failure_reason = null,
         retry_count    = retry_count + 1,
         last_attempt_at= now(),
         updated_at     = now()
   where id = v_target_id;

  -- 감사 로그
  perform public.admin_log_operation(
    'policy_deployment',                  -- source
    'policy_retry_requested',             -- category
    'info',                               -- level
    'requested',                          -- status
    format('Single-store retry requested (prev=%s)', v_prev_status),
    jsonb_build_object(
      'deployment_id', p_deployment_id,
      'store_id', p_store_id,
      'target_id', v_target_id,
      'previous_status', v_prev_status
    ),
    auth.uid(),
    p_deployment_id::text,
    null::int,
    null::text,
    null::text
  );

  -- 집계 즉시 재계산 — pending 으로 바뀐 상태가 deployment.status 에 반영되도록
  perform public.admin_recompute_policy_deployment(p_deployment_id);

  return jsonb_build_object(
    'success', true,
    'deployment_id', p_deployment_id,
    'store_id', p_store_id,
    'retried_count', 1,
    'previous_status', v_prev_status
  );
end;
$$;
revoke execute on function public.admin_request_policy_retry(uuid, uuid) from public, anon;
grant execute on function public.admin_request_policy_retry(uuid, uuid) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare v_overview int; v_failed int; v_retry int;
begin
  select count(*) into v_overview from pg_proc
    where proname='admin_policy_deployment_overview' and pronamespace='public'::regnamespace;
  select count(*) into v_failed   from pg_proc
    where proname='admin_policy_deployment_failed_stores' and pronamespace='public'::regnamespace;
  select count(*) into v_retry    from pg_proc
    where proname='admin_request_policy_retry' and pronamespace='public'::regnamespace;
  raise notice '====== 0377 Policy Deployment Center V2 ======';
  raise notice 'admin_policy_deployment_overview     : % / 1', v_overview;
  raise notice 'admin_policy_deployment_failed_stores: % / 1', v_failed;
  raise notice 'admin_request_policy_retry           : % / 1', v_retry;
  if v_overview = 1 and v_failed = 1 and v_retry = 1 then
    raise notice '0377 COMPLETE — overview + failed_stores + single-store retry ready';
  else
    raise warning '0377 INCOMPLETE';
  end if;
end$$;
