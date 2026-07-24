-- 0457 — ENTERPRISE-HQ-OPS-1: Headquarters Franchise Operations Center (Fleet)
--
-- 목표:
--   본사(HQ) 계정이 소속 전체 가맹점의 운영 상태(재생·플레이어·계약·미납·헬스)를
--   하나의 통합 목록/상세에서 정확히 관리. 상태 판정은 서버 단일 함수로 표준화.
--
-- 절대 조건 준수:
--   - Production 직접 적용/변경 없음 (migration 파일만)
--   - 기존 RPC 보안 정책 유지: SECURITY DEFINER + search_path 고정 + revoke public/anon + HQ scope 게이트
--   - RLS/DEFINER 우회 없음 — HQ 는 자기 enterprise 소속 매장만 조회 (_hq_owns_store / enterprise_franchises)
--   - Pagination 강제, 필터 DB 처리, N+1 없음 (단일 RPC)
--   - 미구현 데이터(Queue/Scheduler/Streaming Quality/재생량)는 여기서 만들지 않음 → UI 가 '미지원' 표기
--
-- 의존: 0401(_hq_current_enterprise_account_id, _hq_owns_store, store_monitoring_status),
--       0456(last_heartbeat_at, heartbeat_state, _store_heartbeat_state, _noc_store_health_score),
--       0382(enterprise_billing_invoices), 0383(enterprise_contracts), 0372(enterprise_monthly_settlements)

-- ============================================================
-- 1) 표준 매장 운영 상태 판정 (단일 진실 소스)
--    HEALTHY | WARNING | CRITICAL | OFFLINE | UNKNOWN + reasons[]
--    클라이언트는 이 결과를 그대로 표시만 한다 (재계산 금지).
-- ============================================================
create or replace function public._store_operational_status(
  p_heartbeat_state text,
  p_health_score int,
  p_has_playback_error boolean,
  p_is_active boolean,
  p_unpaid_count int,
  p_is_overdue boolean,
  p_active_alert_count int,
  p_update_required boolean,
  p_contract_expiring boolean
)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_reasons text[] := array[]::text[];
  v_status  text;
begin
  if p_is_active is false then
    v_reasons := array_append(v_reasons, '비활성 매장');
  end if;

  if p_heartbeat_state = 'OFFLINE' then
    v_reasons := array_append(v_reasons, '오프라인(24시간+ heartbeat 없음)');
  elsif p_heartbeat_state = 'STALE' then
    v_reasons := array_append(v_reasons, 'heartbeat 지연(15분~24시간)');
  elsif p_heartbeat_state = 'DEGRADED' then
    v_reasons := array_append(v_reasons, 'heartbeat 불안정(5~15분)');
  elsif p_heartbeat_state = 'UNKNOWN' then
    v_reasons := array_append(v_reasons, 'heartbeat 수집 전');
  end if;

  if p_has_playback_error then
    v_reasons := array_append(v_reasons, '재생 오류 발생');
  end if;

  if p_health_score is not null and p_health_score < 50 then
    v_reasons := array_append(v_reasons, format('Health 위험(%s점)', p_health_score));
  elsif p_health_score is not null and p_health_score < 80 then
    v_reasons := array_append(v_reasons, format('Health 주의(%s점)', p_health_score));
  end if;

  if coalesce(p_unpaid_count, 0) > 0 then
    v_reasons := array_append(v_reasons, format('미납 인보이스 %s건', p_unpaid_count));
  end if;
  if p_is_overdue then
    v_reasons := array_append(v_reasons, '연체 발생');
  end if;
  if coalesce(p_active_alert_count, 0) > 0 then
    v_reasons := array_append(v_reasons, format('활성 알림 %s건', p_active_alert_count));
  end if;
  if p_update_required then
    v_reasons := array_append(v_reasons, '플레이어 업데이트 필요');
  end if;
  if p_contract_expiring then
    v_reasons := array_append(v_reasons, '계약 만료 임박');
  end if;

  -- 심각도 순 상태 결정
  if p_heartbeat_state = 'UNKNOWN' then
    v_status := 'UNKNOWN';
  elsif p_heartbeat_state = 'OFFLINE' then
    v_status := 'OFFLINE';
  elsif p_has_playback_error
        or (p_health_score is not null and p_health_score < 50)
        or p_is_overdue then
    v_status := 'CRITICAL';
  elsif p_heartbeat_state in ('DEGRADED', 'STALE')
        or (p_health_score is not null and p_health_score < 80)
        or coalesce(p_unpaid_count, 0) > 0
        or coalesce(p_active_alert_count, 0) > 0
        or p_update_required
        or p_contract_expiring then
    v_status := 'WARNING';
  else
    v_status := 'HEALTHY';
  end if;

  return jsonb_build_object('status', v_status, 'reasons', to_jsonb(v_reasons));
end;
$$;
comment on function public._store_operational_status(text,int,boolean,boolean,int,boolean,int,boolean,boolean) is
  'ENTERPRISE-HQ-OPS-1 — 매장 운영 상태 표준 판정 (HEALTHY/WARNING/CRITICAL/OFFLINE/UNKNOWN + reasons).';


-- ============================================================
-- 2) get_my_enterprise_ops_fleet
--    KPI + 통합 매장 목록(플레이어/계약/미납/헬스/운영상태) 단일 RPC.
--    billing/contract 는 enterprise 단위(공유) — 각 행에 동일 값으로 부착(라벨: enterprise-scoped).
-- ============================================================
create or replace function public.get_my_enterprise_ops_fleet(
  p_search text default null,
  p_status text default null,               -- normal|warning|offline|unpaid|overdue|contract_expiring|update_required|incident
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_business_category text default null,    -- 업종
  p_sort text default 'status',             -- status|name|health
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
  v_ea_id  uuid := public._hq_current_enterprise_account_id();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_bizcat text := nullif(btrim(coalesce(p_business_category, '')), '');
  v_limit  int  := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int  := greatest(coalesce(p_offset, 0), 0);
  -- enterprise 단위 billing/contract (1회 계산 — 행별 재조회 없음)
  v_unpaid_count int := 0;
  v_is_overdue boolean := false;
  v_contract record;
  v_contract_expiring boolean := false;
  v_kpi jsonb;
  v_total bigint;
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  -- billing 요약 (미납 = issued/overdue, 연체 = overdue)
  select
    count(*) filter (where status in ('issued', 'overdue')),
    coalesce(bool_or(status = 'overdue'), false)
    into v_unpaid_count, v_is_overdue
  from public.enterprise_billing_invoices
  where enterprise_account_id = v_ea_id and deleted_at is null;

  -- 대표 계약 1건 (active > expiring > draft 순)
  select id, contract_no, status, start_date, end_date,
         case when end_date is not null then (end_date - current_date) end as days_to_end
    into v_contract
  from public.enterprise_contracts
  where enterprise_account_id = v_ea_id and deleted_at is null and status <> 'terminated'
  order by case status when 'active' then 0 when 'expiring' then 1 when 'draft' then 2 else 3 end,
           start_date desc
  limit 1;

  v_contract_expiring := coalesce(
    v_contract.status = 'expiring'
    or (v_contract.days_to_end is not null and v_contract.days_to_end between 0 and 30),
    false
  );

  -- 공통 scope + 필터 base (KPI/목록 공유)
  with scope as (
    select fs.store_id, fs.status as fs_status, fs.store_name as fs_store_name
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  ),
  base as (
    select
      sms.*,
      s.fs_status,
      coalesce(s.fs_store_name, u.full_name, u.nickname, '(매장명 없음)') as store_name,
      u.business_category,
      au.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist,
      (
        (case when sms.has_playback_error then 1 else 0 end)
        + (case when sms.is_offline_24h then 1 else 0 end)
        + (case when sms.has_policy_outdated then 1 else 0 end)
        + (case when sms.has_volume_error then 1 else 0 end)
        + (case when sms.has_device_missing then 1 else 0 end)
        + (case when sms.has_update_required then 1 else 0 end)
      ) as active_alert_count
    from public.store_monitoring_status sms
    join scope s on s.store_id = sms.store_id
    join public.users u on u.id = sms.store_id
    left join auth.users au on au.id = u.id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (v_bizcat is null or coalesce(u.business_category, '') = v_bizcat)
      and (
        v_search is null
        or coalesce(s.fs_store_name, u.full_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
        or coalesce(u.business_category, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'normal' and sms.is_online and not sms.has_playback_error and not sms.has_policy_outdated)
        or (p_status = 'warning' and not sms.is_offline_24h and not sms.has_playback_error
            and (sms.is_idle_5m_to_1h or sms.is_idle_1h_to_24h or sms.has_policy_outdated
                 or sms.has_volume_error or sms.has_update_required or sms.has_device_missing))
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'incident' and sms.has_playback_error)
        or (p_status = 'update_required' and sms.has_update_required)
        -- enterprise 단위 상태 필터: 조건 충족 시 전체 매장 통과
        or (p_status = 'unpaid' and v_unpaid_count > 0)
        or (p_status = 'overdue' and v_is_overdue)
        or (p_status = 'contract_expiring' and v_contract_expiring)
      )
  )
  select
    jsonb_build_object(
      'total_stores', count(*),
      'normal_stores', count(*) filter (where is_online and not has_playback_error and not has_policy_outdated),
      'warning_stores', count(*) filter (
        where not is_offline_24h and not has_playback_error
          and (is_idle_5m_to_1h or is_idle_1h_to_24h or has_policy_outdated
               or has_volume_error or has_update_required or has_device_missing)),
      'offline_stores', count(*) filter (where is_offline_24h),
      'incident_stores', count(*) filter (where has_playback_error),
      'update_required_stores', count(*) filter (where has_update_required),
      -- enterprise 단위 (공유): 조건 충족 시 전체 매장 수, 아니면 0
      'unpaid_stores', case when v_unpaid_count > 0 then count(*) else 0 end,
      'contract_expiring_stores', case when v_contract_expiring then count(*) else 0 end
    ),
    count(*)
    into v_kpi, v_total
  from base;

  -- 페이지 행 (페이지 범위에서만 health score 계산 → N+1 없음)
  with scope as (
    select fs.store_id, fs.status as fs_status, fs.store_name as fs_store_name
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  ),
  base as (
    select
      sms.*,
      s.fs_status,
      coalesce(s.fs_store_name, u.full_name, u.nickname, '(매장명 없음)') as store_name,
      u.business_category,
      au.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist,
      (
        (case when sms.has_playback_error then 1 else 0 end)
        + (case when sms.is_offline_24h then 1 else 0 end)
        + (case when sms.has_policy_outdated then 1 else 0 end)
        + (case when sms.has_volume_error then 1 else 0 end)
        + (case when sms.has_device_missing then 1 else 0 end)
        + (case when sms.has_update_required then 1 else 0 end)
      ) as active_alert_count
    from public.store_monitoring_status sms
    join scope s on s.store_id = sms.store_id
    join public.users u on u.id = sms.store_id
    left join auth.users au on au.id = u.id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (v_bizcat is null or coalesce(u.business_category, '') = v_bizcat)
      and (
        v_search is null
        or coalesce(s.fs_store_name, u.full_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
        or coalesce(u.business_category, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'normal' and sms.is_online and not sms.has_playback_error and not sms.has_policy_outdated)
        or (p_status = 'warning' and not sms.is_offline_24h and not sms.has_playback_error
            and (sms.is_idle_5m_to_1h or sms.is_idle_1h_to_24h or sms.has_policy_outdated
                 or sms.has_volume_error or sms.has_update_required or sms.has_device_missing))
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'incident' and sms.has_playback_error)
        or (p_status = 'update_required' and sms.has_update_required)
        or (p_status = 'unpaid' and v_unpaid_count > 0)
        or (p_status = 'overdue' and v_is_overdue)
        or (p_status = 'contract_expiring' and v_contract_expiring)
      )
    order by
      case when p_sort = 'name' then store_name end asc nulls last,
      case when p_sort = 'status' then
        case
          when has_playback_error then 0
          when is_offline_24h then 1
          when is_idle_1h_to_24h then 2
          when has_policy_outdated then 3
          when is_idle_5m_to_1h then 4
          when is_online then 5
          else 6
        end
      end asc nulls last,
      coalesce(last_heartbeat_at, '1970-01-01'::timestamptz) desc
    limit v_limit offset v_offset
  ),
  paged as (
    select
      b.*,
      (public._noc_store_health_score(b.store_id) ->> 'score')::int as health_score
    from base b
  )
  select coalesce(jsonb_agg(
    to_jsonb(p)
    || jsonb_build_object(
         'is_active', (p.fs_status = 'active'),
         'operational', public._store_operational_status(
            p.heartbeat_state, p.health_score, p.has_playback_error,
            (p.fs_status = 'active'), v_unpaid_count, v_is_overdue,
            p.active_alert_count, p.has_update_required, v_contract_expiring)
       )
  ), '[]'::jsonb)
  into v_rows
  from paged p;

  return jsonb_build_object(
    'success', true,
    'kpi', v_kpi,
    'billing', jsonb_build_object(
      'scope', 'enterprise',
      'unpaid_invoice_count', v_unpaid_count,
      'is_overdue', v_is_overdue
    ),
    'contract', case when v_contract.id is null then null else jsonb_build_object(
      'scope', 'enterprise',
      'contract_no', v_contract.contract_no,
      'status', v_contract.status,
      'start_date', v_contract.start_date,
      'end_date', v_contract.end_date,
      'days_to_end', v_contract.days_to_end,
      'is_expiring', v_contract_expiring
    ) end,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_fleet(text, text, uuid, uuid, text, text, int, int) from public, anon;
grant   execute on function public.get_my_enterprise_ops_fleet(text, text, uuid, uuid, text, text, int, int) to authenticated;


-- ============================================================
-- 3) get_my_enterprise_ops_store_detail
--    매장 상세 (Overview/Playback/Health/Billing/Device) — 소유 검증 필수.
--    Queue/Scheduler 상세/Streaming Quality/재생량은 미구현 → 반환하지 않음(UI 가 '미지원').
-- ============================================================
create or replace function public.get_my_enterprise_ops_store_detail(p_store_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_sms   record;
  v_np    record;
  v_fs    record;
  v_health jsonb;
  v_health_score int;
  v_alert_count int;
  v_unpaid_count int := 0;
  v_is_overdue boolean := false;
  v_current_invoice jsonb;
  v_contract record;
  v_contract_expiring boolean := false;
  v_settlement record;
  v_business_category text;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;
  if p_store_id is null then
    raise exception 'invalid input: store_id required';
  end if;
  if not public._hq_owns_store(v_ea_id, p_store_id) then
    raise exception 'forbidden: store % not in your brand', p_store_id;
  end if;

  select * into v_sms from public.store_monitoring_status where store_id = p_store_id;
  if v_sms.store_id is null then
    raise exception 'store not found in monitoring: %', p_store_id;
  end if;

  -- 업종은 users 에만 존재 (store_monitoring_status 미포함) → 별도 조회.
  select business_category into v_business_category from public.users where id = p_store_id;

  select * into v_np from public.store_now_playing where store_id = p_store_id;

  select fs.status, fs.store_name, fs.joined_at, f.name as franchise_name
    into v_fs
  from public.franchise_stores fs
  left join public.franchises f on f.id = fs.franchise_id
  where fs.store_id = p_store_id
    and fs.franchise_id in (
      select ef.franchise_id from public.enterprise_franchises ef
       where ef.enterprise_account_id = v_ea_id and ef.deleted_at is null
    )
  limit 1;

  v_health := public._noc_store_health_score(p_store_id);
  v_health_score := (v_health ->> 'score')::int;

  v_alert_count :=
      (case when v_sms.has_playback_error then 1 else 0 end)
    + (case when v_sms.is_offline_24h then 1 else 0 end)
    + (case when v_sms.has_policy_outdated then 1 else 0 end)
    + (case when v_sms.has_volume_error then 1 else 0 end)
    + (case when v_sms.has_device_missing then 1 else 0 end)
    + (case when v_sms.has_update_required then 1 else 0 end);

  -- billing (enterprise 단위)
  select
    count(*) filter (where status in ('issued', 'overdue')),
    coalesce(bool_or(status = 'overdue'), false)
    into v_unpaid_count, v_is_overdue
  from public.enterprise_billing_invoices
  where enterprise_account_id = v_ea_id and deleted_at is null;

  select jsonb_build_object(
      'billing_month', billing_month, 'status', status,
      'total_amount', total_amount, 'due_date', due_date,
      'active_store_count', active_store_count
    ) into v_current_invoice
  from public.enterprise_billing_invoices
  where enterprise_account_id = v_ea_id and deleted_at is null
  order by billing_month desc
  limit 1;

  select id, contract_no, status, start_date, end_date,
         case when end_date is not null then (end_date - current_date) end as days_to_end
    into v_contract
  from public.enterprise_contracts
  where enterprise_account_id = v_ea_id and deleted_at is null and status <> 'terminated'
  order by case status when 'active' then 0 when 'expiring' then 1 when 'draft' then 2 else 3 end,
           start_date desc
  limit 1;

  v_contract_expiring := coalesce(
    v_contract.status = 'expiring'
    or (v_contract.days_to_end is not null and v_contract.days_to_end between 0 and 30),
    false
  );

  select status, settlement_month, total_commission, carryover_amount
    into v_settlement
  from public.enterprise_monthly_settlements
  where enterprise_account_id = v_ea_id
  order by settlement_month desc
  limit 1;

  return jsonb_build_object(
    'success', true,
    'store_id', p_store_id,
    'overview', jsonb_build_object(
      'store_name', coalesce(v_fs.store_name, v_np.store_name, '(매장명 없음)'),
      'business_category', v_business_category,   -- may be null → UI '데이터 없음'
      'franchise_name', v_fs.franchise_name,
      'enterprise_region_id', v_sms.enterprise_region_id,
      'is_active', (v_fs.status = 'active'),
      'fs_status', v_fs.status,
      'joined_at', v_fs.joined_at,
      'operational', public._store_operational_status(
        v_sms.heartbeat_state, v_health_score, v_sms.has_playback_error,
        (v_fs.status = 'active'), v_unpaid_count, v_is_overdue,
        v_alert_count, v_sms.has_update_required, v_contract_expiring)
    ),
    'playback', jsonb_build_object(
      'current_track_id', v_sms.current_track_id,
      'current_track_title', v_np.track_title,
      'current_track_artist', v_np.artist_name,
      'started_at', v_np.started_at,
      'elapsed_seconds', v_np.elapsed_seconds,
      'remaining_seconds', v_np.remaining_seconds,
      'player_status', v_sms.player_status,
      'last_seen_at', v_sms.last_seen_at,
      'last_heartbeat_at', v_sms.last_heartbeat_at,
      'heartbeat_state', v_sms.heartbeat_state,
      'playback_error', v_sms.playback_error
    ),
    'health', jsonb_build_object(
      'score', v_health_score,
      'breakdown', v_health -> 'breakdown',
      'heartbeat_state', v_sms.heartbeat_state,
      'last_heartbeat_at', v_sms.last_heartbeat_at,
      'active_alert_count', v_alert_count,
      'has_policy_outdated', v_sms.has_policy_outdated,
      'has_volume_error', v_sms.has_volume_error
    ),
    'billing', jsonb_build_object(
      'scope', 'enterprise',
      'unpaid_invoice_count', v_unpaid_count,
      'is_overdue', v_is_overdue,
      'current_invoice', v_current_invoice,
      'contract', case when v_contract.id is null then null else jsonb_build_object(
        'contract_no', v_contract.contract_no,
        'status', v_contract.status,
        'start_date', v_contract.start_date,
        'end_date', v_contract.end_date,
        'days_to_end', v_contract.days_to_end,
        'is_expiring', v_contract_expiring
      ) end,
      'settlement', case when v_settlement.settlement_month is null then null else jsonb_build_object(
        'settlement_month', v_settlement.settlement_month,
        'status', v_settlement.status,
        'total_commission', v_settlement.total_commission,
        'carryover_amount', v_settlement.carryover_amount
      ) end
    ),
    'device', jsonb_build_object(
      'app_version', v_sms.app_version,
      'last_player_version', v_sms.last_player_version,
      'device_model', v_sms.device_model,
      'device_os', v_sms.device_os,
      'device_identifier', v_sms.device_identifier,
      'connection_type', v_sms.connection_type,
      'wifi_ssid', v_sms.wifi_ssid,
      'has_update_required', v_sms.has_update_required,
      'last_heartbeat_at', v_sms.last_heartbeat_at
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_store_detail(uuid) from public, anon;
grant   execute on function public.get_my_enterprise_ops_store_detail(uuid) to authenticated;
