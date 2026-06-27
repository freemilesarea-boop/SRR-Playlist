-- 0359 — Enterprise Phase 1-5: 정책 적용 성공률 (Policy Deployment Success Rate)
--
-- 목표:
--   본사/관리자가 정책 배포 상태를 숫자로 즉시 확인.
--   예) 총 240개 매장 / 233개 적용 완료 / 5개 대기 / 2개 실패 / 적용률 97.1%
--
-- 절대 원칙:
--   - 기존 매장 플레이어 재생 / heartbeat / now-playing 절대 수정 X
--   - 기존 apply_franchise_policy / get_store_active_music_policy / store_heartbeat
--     본문 절대 수정 X. 관측/집계 레이어만 추가.
--   - 다중 ALTER 금지. 각 인덱스/제약 개별 문장.
--   - users.business_name / users.email 사용 금지.
--     매장명: business_profiles.store_name → business_verification_profiles.store_name
--             → business_verification_profiles.business_name → users.full_name → users.nickname
--   - hard delete 금지 (deployment soft delete only). targets 는 cascade.
--   - 직접 INSERT/UPDATE/DELETE 차단 (RPC + service_role 만).
--
-- 의존:
--   - 0349 (franchises, franchise_music_policies, franchise_policy_versions,
--           franchise_stores, store_policy_sync_status, _is_super_admin, _touch_updated_at)
--   - 0351 (enterprise_accounts), 0352 (enterprise_regions), 0353 (sync_status 확장)
--   - 0041 (admin_log_operation)
--   - 0007 (business_profiles), 0014 (business_verification_profiles)
--
-- 성공 판정식 (recompute):
--   success: active_policy_id = expected AND coalesce(active_version_number,0) >= expected_version
--            AND last_synced_at IS NOT NULL AND last_synced_at >= deployment.started_at
--   stale  : active_policy_id = expected AND active_version_number < expected_version
--   failed : failed_at IS NOT NULL  OR  (status in ('pending','applying') AND timeout 30min 초과)
--   skipped: 관리자가 명시적으로 제외한 매장 (보존)
--   pending: 그 외 (heartbeat 도착 대기)

-- ============================================================
-- 1) enterprise_policy_deployments
-- ============================================================
create table if not exists public.enterprise_policy_deployments (
  id uuid primary key default gen_random_uuid(),
  deployment_name text not null,
  enterprise_account_id uuid references public.enterprise_accounts(id) on delete set null,
  franchise_id uuid references public.franchises(id) on delete set null,
  policy_id uuid not null references public.franchise_music_policies(id) on delete restrict,
  policy_version_number integer,
  target_store_count integer not null default 0 check (target_store_count >= 0),
  success_count integer not null default 0 check (success_count >= 0),
  pending_count integer not null default 0 check (pending_count >= 0),
  failed_count integer not null default 0 check (failed_count >= 0),
  skipped_count integer not null default 0 check (skipped_count >= 0),
  status text not null default 'pending'
    check (status in ('pending','running','completed','partial_failed','failed','cancelled')),
  started_at timestamptz default now(),
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  deleted_at timestamptz
);

-- 인덱스 — 개별 문장
create index if not exists idx_epd_enterprise_account
  on public.enterprise_policy_deployments (enterprise_account_id) where deleted_at is null;
create index if not exists idx_epd_franchise
  on public.enterprise_policy_deployments (franchise_id) where deleted_at is null;
create index if not exists idx_epd_policy
  on public.enterprise_policy_deployments (policy_id) where deleted_at is null;
create index if not exists idx_epd_status
  on public.enterprise_policy_deployments (status) where deleted_at is null;
create index if not exists idx_epd_created_at
  on public.enterprise_policy_deployments (created_at desc) where deleted_at is null;

drop trigger if exists trg_epd_updated_at on public.enterprise_policy_deployments;
create trigger trg_epd_updated_at before update on public.enterprise_policy_deployments
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 2) enterprise_policy_deployment_targets
-- ============================================================
create table if not exists public.enterprise_policy_deployment_targets (
  id uuid primary key default gen_random_uuid(),
  deployment_id uuid not null references public.enterprise_policy_deployments(id) on delete cascade,
  store_id uuid not null references public.users(id) on delete cascade,
  enterprise_region_id uuid references public.enterprise_regions(id) on delete set null,
  expected_policy_id uuid not null references public.franchise_music_policies(id) on delete restrict,
  expected_version_number integer,
  applied_policy_id uuid references public.franchise_music_policies(id) on delete set null,
  applied_version_number integer,
  status text not null default 'pending'
    check (status in ('pending','applying','success','failed','skipped','stale')),
  last_attempt_at timestamptz,
  applied_at timestamptz,
  failed_at timestamptz,
  failure_reason text,
  retry_count integer not null default 0 check (retry_count >= 0),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (deployment_id, store_id)
);

create index if not exists idx_epdt_deployment
  on public.enterprise_policy_deployment_targets (deployment_id);
create index if not exists idx_epdt_store
  on public.enterprise_policy_deployment_targets (store_id);
create index if not exists idx_epdt_status
  on public.enterprise_policy_deployment_targets (status);
create index if not exists idx_epdt_enterprise_region
  on public.enterprise_policy_deployment_targets (enterprise_region_id) where enterprise_region_id is not null;

drop trigger if exists trg_epdt_updated_at on public.enterprise_policy_deployment_targets;
create trigger trg_epdt_updated_at before update on public.enterprise_policy_deployment_targets
  for each row execute function public._touch_updated_at();


-- ============================================================
-- 3) RLS
--    admin: 전체. enterprise 담당자(auth_user_id 매칭): 자기 enterprise_account_id 만.
--    INSERT/UPDATE/DELETE 는 RPC + service_role 만.
-- ============================================================
alter table public.enterprise_policy_deployments enable row level security;
alter table public.enterprise_policy_deployment_targets enable row level security;

drop policy if exists epd_select on public.enterprise_policy_deployments;
create policy epd_select on public.enterprise_policy_deployments
  for select using (
    public._is_super_admin()
    or (
      enterprise_account_id is not null
      and exists (
        select 1 from public.enterprise_accounts ea
         where ea.id = enterprise_policy_deployments.enterprise_account_id
           and ea.auth_user_id is not null
           and ea.auth_user_id = auth.uid()
           and ea.deleted_at is null
      )
    )
  );

revoke insert, update, delete on public.enterprise_policy_deployments from authenticated, anon;

drop policy if exists epdt_select on public.enterprise_policy_deployment_targets;
create policy epdt_select on public.enterprise_policy_deployment_targets
  for select using (
    public._is_super_admin()
    or exists (
      select 1 from public.enterprise_policy_deployments d
        join public.enterprise_accounts ea on ea.id = d.enterprise_account_id
       where d.id = enterprise_policy_deployment_targets.deployment_id
         and ea.auth_user_id is not null
         and ea.auth_user_id = auth.uid()
         and ea.deleted_at is null
    )
  );

revoke insert, update, delete on public.enterprise_policy_deployment_targets from authenticated, anon;


-- ============================================================
-- 4) View: enterprise_policy_deployment_summary
-- ============================================================
create or replace view public.enterprise_policy_deployment_summary as
  select
    d.id as deployment_id,
    d.deployment_name,
    d.enterprise_account_id,
    ea.enterprise_name,
    d.franchise_id,
    f.name as franchise_name,
    d.policy_id,
    fmp.name as policy_name,
    d.policy_version_number,
    d.target_store_count,
    d.success_count,
    d.pending_count,
    d.failed_count,
    d.skipped_count,
    case
      when d.target_store_count = 0 then 0.0
      else round((d.success_count::numeric / d.target_store_count) * 100, 2)
    end as success_rate,
    d.status,
    d.started_at,
    d.completed_at,
    d.created_at,
    d.created_by,
    d.deleted_at
  from public.enterprise_policy_deployments d
  left join public.enterprise_accounts ea on ea.id = d.enterprise_account_id
  left join public.franchises f on f.id = d.franchise_id
  left join public.franchise_music_policies fmp on fmp.id = d.policy_id
  where d.deleted_at is null;

comment on view public.enterprise_policy_deployment_summary is
  'Phase 1-5 — 정책 배포별 집계 + success_rate (%) 동적 계산.';


-- ============================================================
-- 5) View: enterprise_policy_deployment_target_status
--    매장명은 bp → bvp.store_name → bvp.business_name → users.full_name → users.nickname fallback.
--    절대 users.business_name 사용 X (컬럼 부재).
-- ============================================================
create or replace view public.enterprise_policy_deployment_target_status as
  select
    t.id as target_id,
    t.deployment_id,
    t.store_id,
    coalesce(
      bp.store_name,
      bvp.store_name,
      bvp.business_name,
      u.full_name,
      u.nickname,
      '(매장명 없음)'
    ) as store_name,
    d.enterprise_account_id,
    ea.enterprise_name,
    t.enterprise_region_id,
    er.region_name,
    er.region_code,
    t.expected_policy_id,
    fmp_exp.name as expected_policy_name,
    t.expected_version_number,
    t.applied_policy_id,
    fmp_app.name as applied_policy_name,
    t.applied_version_number,
    t.status,
    t.last_attempt_at,
    t.applied_at,
    t.failed_at,
    t.failure_reason,
    t.retry_count,
    ss.last_seen_at,
    ss.last_synced_at,
    ss.active_policy_id as current_active_policy_id,
    ss.active_version_number as current_active_version_number,
    ss.player_status as current_player_status,
    t.created_at,
    t.updated_at
  from public.enterprise_policy_deployment_targets t
  join public.enterprise_policy_deployments d on d.id = t.deployment_id
  left join public.users u on u.id = t.store_id
  left join public.business_profiles bp on bp.user_id = t.store_id
  left join public.business_verification_profiles bvp on bvp.user_id = t.store_id
  left join public.enterprise_accounts ea on ea.id = d.enterprise_account_id
  left join public.enterprise_regions er on er.id = t.enterprise_region_id
  left join public.franchise_music_policies fmp_exp on fmp_exp.id = t.expected_policy_id
  left join public.franchise_music_policies fmp_app on fmp_app.id = t.applied_policy_id
  left join public.store_policy_sync_status ss on ss.store_id = t.store_id
  where d.deleted_at is null;

comment on view public.enterprise_policy_deployment_target_status is
  'Phase 1-5 — 배포별 매장 단위 상태 + 매장명/지역/현재 sync 상태 join.';


-- ============================================================
-- 6) RPC: admin_create_policy_deployment
--    대상 매장 = policy 의 franchise_id 에 active 로 연결된 모든 매장
--               (옵션: p_store_ids 로 부분집합 제한 가능)
-- ============================================================
create or replace function public.admin_create_policy_deployment(
  p_policy_id uuid,
  p_deployment_name text default null,
  p_store_ids uuid[] default null,
  p_enterprise_account_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_policy public.franchise_music_policies;
  v_franchise_id uuid;
  v_version int;
  v_deployment_id uuid := gen_random_uuid();
  v_name text;
  v_target_count int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_policy_id is null then raise exception 'policy_id required'; end if;

  select * into v_policy from public.franchise_music_policies where id = p_policy_id;
  if v_policy.id is null then raise exception 'policy not found: %', p_policy_id; end if;
  v_franchise_id := v_policy.franchise_id;

  -- 현재 정책의 최신 version_number (없으면 1)
  select coalesce(max(version_number), 1) into v_version
    from public.franchise_policy_versions
   where policy_id = p_policy_id;

  v_name := coalesce(
    nullif(btrim(p_deployment_name), ''),
    format(
      '%s — v%s (%s)',
      v_policy.name, v_version,
      to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM-DD HH24:MI')
    )
  );

  insert into public.enterprise_policy_deployments
    (id, deployment_name, enterprise_account_id, franchise_id, policy_id,
     policy_version_number, target_store_count, pending_count, status, started_at, created_by)
  values
    (v_deployment_id, v_name, p_enterprise_account_id, v_franchise_id, p_policy_id,
     v_version, 0, 0, 'running', now(), auth.uid());

  -- targets snapshot — franchise_stores active + 옵션 store_ids 필터
  with target_stores as (
    select fs.store_id, ss.enterprise_region_id
      from public.franchise_stores fs
      left join public.store_policy_sync_status ss on ss.store_id = fs.store_id
     where fs.franchise_id = v_franchise_id
       and fs.status = 'active'
       and (p_store_ids is null or fs.store_id = any(p_store_ids))
  )
  insert into public.enterprise_policy_deployment_targets
    (deployment_id, store_id, enterprise_region_id, expected_policy_id, expected_version_number, status)
  select v_deployment_id, ts.store_id, ts.enterprise_region_id, p_policy_id, v_version, 'pending'
    from target_stores ts;

  get diagnostics v_target_count = row_count;

  update public.enterprise_policy_deployments
     set target_store_count = v_target_count,
         pending_count = v_target_count,
         status = case when v_target_count = 0 then 'completed' else 'running' end,
         completed_at = case when v_target_count = 0 then now() else null end
   where id = v_deployment_id;

  perform public.admin_log_operation(
    'enterprise_policy_deployments', 'admin', 'info', 'created',
    format('Created deployment %s (%s stores, policy %s v%s)',
           v_name, v_target_count, v_policy.name, v_version),
    jsonb_build_object('action', 'policy_deployment.create',
      'target_table', 'enterprise_policy_deployments',
      'target_id', v_deployment_id,
      'target_store_count', v_target_count,
      'policy_id', p_policy_id,
      'expected_version_number', v_version),
    auth.uid(), v_deployment_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'deployment_id', v_deployment_id,
    'target_store_count', v_target_count,
    'policy_version_number', v_version
  );
end;
$$;
revoke execute on function public.admin_create_policy_deployment(uuid, text, uuid[], uuid) from public, anon;
grant execute on function public.admin_create_policy_deployment(uuid, text, uuid[], uuid) to authenticated;


-- ============================================================
-- 7) RPC: admin_recompute_policy_deployment
--    각 target 의 status 재계산 + deployment 집계 갱신.
-- ============================================================
create or replace function public.admin_recompute_policy_deployment(p_deployment_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_deployment public.enterprise_policy_deployments;
  v_timeout interval := interval '30 minutes';
  v_now timestamptz := now();
  v_success int;
  v_pending int;
  v_failed int;
  v_skipped int;
  v_status text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select * into v_deployment
    from public.enterprise_policy_deployments
   where id = p_deployment_id and deleted_at is null;
  if v_deployment.id is null then raise exception 'deployment not found: %', p_deployment_id; end if;

  -- A) sync_status 행이 있는 매장 — applied/status 결정
  update public.enterprise_policy_deployment_targets t
     set
       applied_policy_id = ss.active_policy_id,
       applied_version_number = ss.active_version_number,
       applied_at = case
         when ss.active_policy_id = t.expected_policy_id
           and coalesce(ss.active_version_number, 0) >= coalesce(t.expected_version_number, 1)
           and ss.last_synced_at is not null
           and ss.last_synced_at >= v_deployment.started_at
         then coalesce(t.applied_at, ss.last_synced_at)
         else t.applied_at
       end,
       last_attempt_at = coalesce(ss.last_synced_at, t.last_attempt_at),
       status = case
         when t.status = 'skipped' then 'skipped'
         when t.failed_at is not null then 'failed'
         when ss.active_policy_id = t.expected_policy_id
           and coalesce(ss.active_version_number, 0) >= coalesce(t.expected_version_number, 1)
           and ss.last_synced_at is not null
           and ss.last_synced_at >= v_deployment.started_at
         then 'success'
         when ss.active_policy_id = t.expected_policy_id
           and coalesce(ss.active_version_number, 0) < coalesce(t.expected_version_number, 1)
         then 'stale'
         when t.status in ('pending','applying')
           and v_deployment.started_at + v_timeout < v_now
           and (ss.last_synced_at is null or ss.last_synced_at < v_deployment.started_at)
         then 'failed'
         else 'pending'
       end,
       failed_at = case
         when t.failed_at is not null then t.failed_at
         when t.status in ('pending','applying')
           and v_deployment.started_at + v_timeout < v_now
           and (ss.last_synced_at is null or ss.last_synced_at < v_deployment.started_at)
         then v_now
         else t.failed_at
       end,
       failure_reason = case
         when t.failure_reason is not null then t.failure_reason
         when t.status in ('pending','applying')
           and v_deployment.started_at + v_timeout < v_now
           and (ss.last_synced_at is null or ss.last_synced_at < v_deployment.started_at)
         then format('timeout (no sync within %s after deployment started)', v_timeout)
         else t.failure_reason
       end
   from public.store_policy_sync_status ss
  where t.deployment_id = p_deployment_id
    and ss.store_id = t.store_id;

  -- B) sync_status 행이 없는 매장 — heartbeat 한 번도 없음
  update public.enterprise_policy_deployment_targets t
     set status = case
           when t.status = 'skipped' then 'skipped'
           when t.failed_at is not null then 'failed'
           when t.status in ('pending','applying')
             and v_deployment.started_at + v_timeout < v_now
           then 'failed'
           else 'pending'
         end,
         failed_at = case
           when t.failed_at is not null then t.failed_at
           when t.status in ('pending','applying')
             and v_deployment.started_at + v_timeout < v_now
           then v_now
           else t.failed_at
         end,
         failure_reason = case
           when t.failure_reason is not null then t.failure_reason
           when t.status in ('pending','applying')
             and v_deployment.started_at + v_timeout < v_now
           then format('timeout (store has never heartbeated within %s)', v_timeout)
           else t.failure_reason
         end
   where t.deployment_id = p_deployment_id
     and not exists (
       select 1 from public.store_policy_sync_status ss where ss.store_id = t.store_id
     );

  -- 집계
  select
    count(*) filter (where status = 'success'),
    count(*) filter (where status in ('pending','applying','stale')),
    count(*) filter (where status = 'failed'),
    count(*) filter (where status = 'skipped')
    into v_success, v_pending, v_failed, v_skipped
    from public.enterprise_policy_deployment_targets
   where deployment_id = p_deployment_id;

  v_status := case
    when (v_success + v_pending + v_failed + v_skipped) = 0 then 'completed'
    when v_pending = 0 and v_failed = 0 then 'completed'
    when v_pending = 0 and v_failed > 0 and v_success > 0 then 'partial_failed'
    when v_pending = 0 and v_failed > 0 and v_success = 0 then 'failed'
    else 'running'
  end;

  update public.enterprise_policy_deployments
     set success_count = v_success,
         pending_count = v_pending,
         failed_count = v_failed,
         skipped_count = v_skipped,
         status = v_status,
         completed_at = case when v_pending = 0 then coalesce(completed_at, now()) else null end
   where id = p_deployment_id;

  perform public.admin_log_operation(
    'enterprise_policy_deployments', 'admin', 'info', 'recomputed',
    format('Recomputed deployment %s — success=%s pending=%s failed=%s skipped=%s status=%s',
           p_deployment_id, v_success, v_pending, v_failed, v_skipped, v_status),
    jsonb_build_object('action', 'policy_deployment.recompute',
      'target_id', p_deployment_id,
      'after', jsonb_build_object(
        'success', v_success, 'pending', v_pending,
        'failed', v_failed, 'skipped', v_skipped, 'status', v_status
      )),
    auth.uid(), p_deployment_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'deployment_id', p_deployment_id,
    'counts', jsonb_build_object(
      'success', v_success, 'pending', v_pending,
      'failed', v_failed, 'skipped', v_skipped
    ),
    'status', v_status,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_recompute_policy_deployment(uuid) from public, anon;
grant execute on function public.admin_recompute_policy_deployment(uuid) to authenticated;


-- ============================================================
-- 8) RPC: admin_list_policy_deployments
-- ============================================================
create or replace function public.admin_list_policy_deployments(
  p_search text default null,
  p_status text default null,
  p_enterprise_account_id uuid default null,
  p_franchise_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  with filtered as (
    select * from public.enterprise_policy_deployment_summary s
     where (p_status is null or s.status = p_status)
       and (p_enterprise_account_id is null or s.enterprise_account_id = p_enterprise_account_id)
       and (p_franchise_id is null or s.franchise_id = p_franchise_id)
       and (p_from is null or s.started_at >= p_from)
       and (p_to is null or s.started_at <= p_to)
       and (
         v_search is null
         or s.deployment_name ilike '%' || v_search || '%'
         or coalesce(s.policy_name, '') ilike '%' || v_search || '%'
         or coalesce(s.franchise_name, '') ilike '%' || v_search || '%'
         or coalesce(s.enterprise_name, '') ilike '%' || v_search || '%'
       )
  )
  select count(*) into v_total from filtered;

  with filtered as (
    select * from public.enterprise_policy_deployment_summary s
     where (p_status is null or s.status = p_status)
       and (p_enterprise_account_id is null or s.enterprise_account_id = p_enterprise_account_id)
       and (p_franchise_id is null or s.franchise_id = p_franchise_id)
       and (p_from is null or s.started_at >= p_from)
       and (p_to is null or s.started_at <= p_to)
       and (
         v_search is null
         or s.deployment_name ilike '%' || v_search || '%'
         or coalesce(s.policy_name, '') ilike '%' || v_search || '%'
         or coalesce(s.franchise_name, '') ilike '%' || v_search || '%'
         or coalesce(s.enterprise_name, '') ilike '%' || v_search || '%'
       )
     order by started_at desc nulls last, created_at desc
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(filtered)), '[]'::jsonb) into v_rows from filtered;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_list_policy_deployments(text, text, uuid, uuid, timestamptz, timestamptz, int, int) from public, anon;
grant execute on function public.admin_list_policy_deployments(text, text, uuid, uuid, timestamptz, timestamptz, int, int) to authenticated;


-- ============================================================
-- 9) RPC: admin_policy_deployment_kpi
-- ============================================================
create or replace function public.admin_policy_deployment_kpi()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  return jsonb_build_object(
    'total_deployments', (
      select count(*) from public.enterprise_policy_deployments where deleted_at is null
    ),
    'running', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and status = 'running'
    ),
    'completed', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and status = 'completed'
    ),
    'partial_failed', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and status = 'partial_failed'
    ),
    'failed', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and status = 'failed'
    ),
    'cancelled', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and status = 'cancelled'
    ),
    'avg_success_rate', (
      select coalesce(round(avg(
        case when target_store_count = 0 then 0
             else (success_count::numeric / target_store_count) * 100
        end
      ), 2), 0)
      from public.enterprise_policy_deployments
       where deleted_at is null and target_store_count > 0
    ),
    'recent_24h', (
      select count(*) from public.enterprise_policy_deployments
       where deleted_at is null and created_at >= now() - interval '24 hours'
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_policy_deployment_kpi() from public, anon;
grant execute on function public.admin_policy_deployment_kpi() to authenticated;


-- ============================================================
-- 10) RPC: admin_get_policy_deployment_detail
-- ============================================================
create or replace function public.admin_get_policy_deployment_detail(p_deployment_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_summary jsonb;
  v_targets jsonb;
  v_distribution jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  select to_jsonb(s) into v_summary
    from public.enterprise_policy_deployment_summary s
   where s.deployment_id = p_deployment_id;
  if v_summary is null then raise exception 'deployment not found: %', p_deployment_id; end if;

  select coalesce(jsonb_agg(to_jsonb(ts) order by
    case ts.status
      when 'failed' then 0
      when 'stale' then 1
      when 'pending' then 2
      when 'applying' then 3
      when 'success' then 4
      when 'skipped' then 5
      else 6
    end,
    ts.store_name
  ), '[]'::jsonb) into v_targets
    from public.enterprise_policy_deployment_target_status ts
   where ts.deployment_id = p_deployment_id;

  select jsonb_build_object(
    'success', count(*) filter (where status = 'success'),
    'pending', count(*) filter (where status in ('pending','applying')),
    'failed', count(*) filter (where status = 'failed'),
    'stale', count(*) filter (where status = 'stale'),
    'skipped', count(*) filter (where status = 'skipped')
  ) into v_distribution
    from public.enterprise_policy_deployment_targets
   where deployment_id = p_deployment_id;

  return jsonb_build_object(
    'success', true,
    'deployment', v_summary,
    'targets', v_targets,
    'distribution', v_distribution,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.admin_get_policy_deployment_detail(uuid) from public, anon;
grant execute on function public.admin_get_policy_deployment_detail(uuid) to authenticated;


-- ============================================================
-- 11) RPC: admin_mark_policy_target_failed
-- ============================================================
create or replace function public.admin_mark_policy_target_failed(
  p_deployment_id uuid,
  p_store_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if coalesce(btrim(p_reason), '') = '' then raise exception 'failure_reason required'; end if;

  update public.enterprise_policy_deployment_targets
     set status = 'failed',
         failed_at = now(),
         failure_reason = btrim(p_reason),
         last_attempt_at = now()
   where deployment_id = p_deployment_id
     and store_id = p_store_id;
  if not found then
    raise exception 'target not found: deployment=% store=%', p_deployment_id, p_store_id;
  end if;

  -- 일관성 유지: recompute 호출
  perform public.admin_recompute_policy_deployment(p_deployment_id);

  perform public.admin_log_operation(
    'enterprise_policy_deployments', 'admin', 'warning', 'target_marked_failed',
    format('Marked target store %s in deployment %s as failed: %s',
           p_store_id, p_deployment_id, p_reason),
    jsonb_build_object('action', 'policy_deployment.mark_failed',
      'target_id', p_deployment_id, 'store_id', p_store_id, 'reason', p_reason),
    auth.uid(), p_deployment_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'deployment_id', p_deployment_id,
    'store_id', p_store_id
  );
end;
$$;
revoke execute on function public.admin_mark_policy_target_failed(uuid, uuid, text) from public, anon;
grant execute on function public.admin_mark_policy_target_failed(uuid, uuid, text) to authenticated;


-- ============================================================
-- 12) RPC: admin_retry_policy_deployment_targets
--     failed/pending(/stale) 대상 retry_count 증가 + status pending 으로 reset.
-- ============================================================
create or replace function public.admin_retry_policy_deployment_targets(
  p_deployment_id uuid,
  p_only_failed boolean default true
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;

  update public.enterprise_policy_deployment_targets
     set status = 'pending',
         failed_at = null,
         failure_reason = null,
         retry_count = retry_count + 1,
         last_attempt_at = now()
   where deployment_id = p_deployment_id
     and (
       (p_only_failed and status = 'failed')
       or (not p_only_failed and status in ('failed','pending','stale'))
     );
  get diagnostics v_count = row_count;

  -- deployment.started_at 갱신해서 timeout window reset
  -- (재시도는 새 deployment window 로 본다 — 사용자 spec 의 "retry_count 증가" 의도)
  update public.enterprise_policy_deployments
     set started_at = case when v_count > 0 then now() else started_at end,
         completed_at = case when v_count > 0 then null else completed_at end
   where id = p_deployment_id;

  perform public.admin_recompute_policy_deployment(p_deployment_id);

  perform public.admin_log_operation(
    'enterprise_policy_deployments', 'admin', 'info', 'targets_retried',
    format('Retried %s targets for deployment %s (only_failed=%s)',
           v_count, p_deployment_id, p_only_failed),
    jsonb_build_object('action', 'policy_deployment.retry',
      'target_id', p_deployment_id,
      'retried_count', v_count,
      'only_failed', p_only_failed),
    auth.uid(), p_deployment_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'deployment_id', p_deployment_id,
    'retried_count', v_count
  );
end;
$$;
revoke execute on function public.admin_retry_policy_deployment_targets(uuid, boolean) from public, anon;
grant execute on function public.admin_retry_policy_deployment_targets(uuid, boolean) to authenticated;


-- ============================================================
-- 13) Diagnostics
-- ============================================================
do $$
declare
  v_tables int;
  v_views  int;
  v_rpc    int;
  v_view_test_summary int;
  v_view_test_target  int;
begin
  select count(*) into v_tables from information_schema.tables
   where table_schema='public'
     and table_name in ('enterprise_policy_deployments','enterprise_policy_deployment_targets');

  select count(*) into v_views from information_schema.views
   where table_schema='public'
     and table_name in ('enterprise_policy_deployment_summary',
                        'enterprise_policy_deployment_target_status');

  select count(*) into v_rpc from pg_proc
   where proname in (
     'admin_create_policy_deployment',
     'admin_recompute_policy_deployment',
     'admin_list_policy_deployments',
     'admin_policy_deployment_kpi',
     'admin_get_policy_deployment_detail',
     'admin_mark_policy_target_failed',
     'admin_retry_policy_deployment_targets'
   );

  -- view SELECT 가능 여부 (0 row 라도 성공해야 함)
  begin
    select count(*) into v_view_test_summary from public.enterprise_policy_deployment_summary;
  exception when others then v_view_test_summary := -1;
  end;
  begin
    select count(*) into v_view_test_target from public.enterprise_policy_deployment_target_status;
  exception when others then v_view_test_target := -1;
  end;

  raise notice '====== Phase 1-5 Policy Deployment Diagnostics ======';
  raise notice 'tables: % / 2 (enterprise_policy_deployments, _targets)', v_tables;
  raise notice 'views:  % / 2 (summary, target_status)', v_views;
  raise notice 'RPC:    % / 7', v_rpc;
  raise notice 'summary view SELECT test: % (expect >=0, -1=err)', v_view_test_summary;
  raise notice 'target_status view SELECT test: % (expect >=0, -1=err)', v_view_test_target;
  raise notice '=====================================================';

  if v_tables = 2 and v_views = 2 and v_rpc = 7
     and v_view_test_summary >= 0 and v_view_test_target >= 0 then
    raise notice 'Phase 1-5 COMPLETE — Policy Deployment Success Rate ready';
  else
    raise warning 'Phase 1-5 INCOMPLETE — 위 카운트 확인 필요';
  end if;
end$$;


comment on table public.enterprise_policy_deployments is
  'Phase 1-5 — 정책 배포 단위 기록 + count/status 집계.';
comment on table public.enterprise_policy_deployment_targets is
  'Phase 1-5 — 배포별 매장 단위 적용 상태 (success/pending/failed/skipped/stale).';
