-- 0401 — Phase 3-3: Enterprise HQ Operations Center
--
-- 배경:
--   기존 매장 관제 인프라 (0353 store_monitoring_status view, 0385 NOC health score,
--   0353 admin_force_store_resync, 0356 store_now_playing, 0395 activity feed)
--   는 모두 super admin 전용이다.
--   HQ (본사) 계정이 자기 브랜드 소속 매장의 운영 상태를 관제할 수 없어
--   Phase 3-3 은 super admin RPC 를 미러링한 HQ scope RPC 를 신규 추가한다.
--
-- 목표:
--   HQ 가 `/enterprise/ops` 화면에서 자기 브랜드 매장만 조회/조치 가능.
--   super admin 관제(admin_*)는 그대로 유지. HQ RPC 는 별도 함수로 병행.
--
-- 절대 원칙:
--   - 기존 admin_* RPC 변경 0
--   - 기존 store_monitoring_status view / store_now_playing view 재사용 (스키마 무변경)
--   - 신규 테이블/컬럼/인덱스 0 (RPC + helper 만)
--   - 계약/정산/청구 파이프라인 무관
--   - HQ 는 자기 enterprise_account 소속 매장만 조회/조치 가능
--   - HQ 알림 dispatch / 외부 알림은 이번 스코프 밖 (Phase 3-3b)

-- ============================================================
-- 1) HQ scope 판정 helper
--    _hq_current_enterprise_account_id() : caller 가 HQ 면 enterprise_account.id
--                                          아니면 null 반환 (RPC 에서 forbidden 판정)
--    _hq_store_ids(ea_id) : ea 소속 매장 uuid[] 반환
--                          enterprise_franchises → franchise_stores 조인
-- ============================================================
create or replace function public._hq_current_enterprise_account_id()
returns uuid
language sql stable security definer set search_path to 'public'
as $$
  select ea.id
    from public.enterprise_accounts ea
   where ea.auth_user_id = auth.uid()
     and ea.deleted_at is null
     and ea.status in ('active','invited')
   limit 1;
$$;
revoke execute on function public._hq_current_enterprise_account_id() from public, anon;
grant   execute on function public._hq_current_enterprise_account_id() to authenticated;

comment on function public._hq_current_enterprise_account_id() is
  'Phase 3-3 — caller 가 HQ 면 enterprise_account.id · 아니면 null 반환 (HQ scope 게이트).';


create or replace function public._hq_owns_store(p_ea_id uuid, p_store_id uuid)
returns boolean
language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1
      from public.franchise_stores fs
      join public.enterprise_franchises ef
        on ef.franchise_id = fs.franchise_id
       and ef.deleted_at is null
     where fs.store_id = p_store_id
       and ef.enterprise_account_id = p_ea_id
  );
$$;
revoke execute on function public._hq_owns_store(uuid, uuid) from public, anon;
grant   execute on function public._hq_owns_store(uuid, uuid) to authenticated;

comment on function public._hq_owns_store(uuid, uuid) is
  'Phase 3-3 — HQ (ea_id) 가 store_id 를 소유하는지 판정 (enterprise_franchises → franchise_stores).';


-- ============================================================
-- 2) get_my_enterprise_ops_kpi
--    HQ 스코프 6-KPI + threshold 정보
-- ============================================================
create or replace function public.get_my_enterprise_ops_kpi()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'total',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)),
    'online',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.is_online),
    'idle_1h',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.is_idle_5m_to_1h),
    'idle_24h',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.is_idle_1h_to_24h),
    'offline',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.is_offline_24h),
    'policy_outdated',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.has_policy_outdated),
    'playback_errors',
      (select count(*) from public.store_monitoring_status sms
        where exists (
          select 1 from public.enterprise_franchises ef
           where ef.franchise_id = sms.franchise_id
             and ef.enterprise_account_id = v_ea_id
             and ef.deleted_at is null)
          and sms.has_playback_error),
    'computed_at', now(),
    'thresholds', jsonb_build_object(
      'online_seconds', 300,
      'idle_1h_seconds', 3600,
      'offline_seconds', 86400,
      'policy_outdated_seconds', 86400
    )
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_kpi() from public, anon;
grant   execute on function public.get_my_enterprise_ops_kpi() to authenticated;


-- ============================================================
-- 3) get_my_enterprise_ops_stores
--    HQ 스코프 매장 리스트 + 8 flag + 검색/상태 필터 + 페이지네이션
-- ============================================================
create or replace function public.get_my_enterprise_ops_stores(
  p_search text default null,
  p_status text default null,
  p_franchise_id uuid default null,
  p_enterprise_region_id uuid default null,
  p_sort text default 'status',
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_total bigint;
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  with scope as (
    select fs.store_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  ),
  base as (
    select
      sms.*,
      u.email as store_email,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join scope s on s.store_id = sms.store_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(u.business_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
      )
  )
  select count(*) into v_total from base;

  with scope as (
    select fs.store_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  ),
  base as (
    select
      sms.*,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      u.email as store_email,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      er.region_code as enterprise_region_code,
      t.title as current_track_title,
      t.artist as current_track_artist
    from public.store_monitoring_status sms
    join scope s on s.store_id = sms.store_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    left join public.tracks t on t.id = sms.current_track_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (p_franchise_id is null or sms.franchise_id = p_franchise_id)
      and (p_enterprise_region_id is null or sms.enterprise_region_id = p_enterprise_region_id)
      and (
        v_search is null
        or coalesce(u.business_name, u.nickname, '') ilike '%' || v_search || '%'
        or coalesce(f.name, '') ilike '%' || v_search || '%'
        or coalesce(er.region_name, '') ilike '%' || v_search || '%'
      )
      and (
        p_status is null
        or (p_status = 'online' and sms.is_online)
        or (p_status = 'idle_1h' and sms.is_idle_5m_to_1h)
        or (p_status = 'idle_24h' and sms.is_idle_1h_to_24h)
        or (p_status = 'offline' and sms.is_offline_24h)
        or (p_status = 'policy_outdated' and sms.has_policy_outdated)
        or (p_status = 'playback_error' and sms.has_playback_error)
        or (p_status = 'volume_error' and sms.has_volume_error)
        or (p_status = 'device_missing' and sms.has_device_missing)
        or (p_status = 'update_required' and sms.has_update_required)
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
      coalesce(last_seen_at, '1970-01-01'::timestamptz) desc
    limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(to_jsonb(base)), '[]'::jsonb) into v_rows from base;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'pagination', jsonb_build_object(
      'total', v_total, 'limit', v_limit, 'offset', v_offset,
      'has_more', (v_offset + v_limit) < v_total
    )
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_stores(text, text, uuid, uuid, text, int, int) from public, anon;
grant   execute on function public.get_my_enterprise_ops_stores(text, text, uuid, uuid, text, int, int) to authenticated;


-- ============================================================
-- 4) get_my_enterprise_ops_now_playing
--    HQ 스코프 현재 재생 매장 스냅샷 (최대 p_limit)
-- ============================================================
create or replace function public.get_my_enterprise_ops_now_playing(
  p_limit int default 30
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows jsonb;
  v_total_playing int;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  with scope as (
    select fs.store_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  )
  select count(*) into v_total_playing
    from public.store_now_playing np
    join scope s on s.store_id = np.store_id;

  with scope as (
    select fs.store_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  )
  select coalesce(jsonb_agg(to_jsonb(np) order by np.current_track_started_at desc), '[]'::jsonb)
    into v_rows
    from (
      select np.*
        from public.store_now_playing np
        join scope s on s.store_id = np.store_id
       order by np.current_track_started_at desc nulls last
       limit v_limit
    ) np;

  return jsonb_build_object(
    'success', true,
    'total_playing', v_total_playing,
    'data', v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_now_playing(int) from public, anon;
grant   execute on function public.get_my_enterprise_ops_now_playing(int) to authenticated;


-- ============================================================
-- 5) get_my_enterprise_ops_alerts
--    HQ 스코프 active alerts (severity 정렬)
--    _noc_store_health_score 헬퍼 재사용
-- ============================================================
create or replace function public.get_my_enterprise_ops_alerts(
  p_limit int default 50
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  -- 스코프: 소속 매장 · 상태 이슈 (offline / playback_error / policy_outdated 등) 만
  with scope as (
    select fs.store_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
  ),
  candidates as (
    select
      sms.store_id,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      sms.last_seen_at,
      sms.last_policy_sync_at,
      sms.playback_error,
      sms.is_online,
      sms.is_offline_24h,
      sms.is_idle_1h_to_24h,
      sms.has_playback_error,
      sms.has_policy_outdated,
      sms.has_device_missing,
      public._noc_store_health_score(sms.store_id) as health
    from public.store_monitoring_status sms
    join scope s on s.store_id = sms.store_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
    where coalesce(u.account_type, 'individual') = 'business'
      and u.withdrawn_at is null
      and (
        sms.has_playback_error
        or sms.is_offline_24h
        or sms.is_idle_1h_to_24h
        or sms.has_policy_outdated
        or sms.has_device_missing
      )
  )
  select coalesce(jsonb_agg(row_to_json(c) order by (c.health->>'score')::int asc, c.last_seen_at asc nulls last), '[]'::jsonb)
    into v_rows
    from (select * from candidates limit v_limit) c;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_alerts(int) from public, anon;
grant   execute on function public.get_my_enterprise_ops_alerts(int) to authenticated;


-- ============================================================
-- 6) get_my_enterprise_ops_activity_feed
--    HQ 스코프 audit log 최근 이벤트 (admin_operation_logs)
--    소속 매장 store_id 또는 enterprise_account_id 관련 이벤트만
-- ============================================================
create or replace function public.get_my_enterprise_ops_activity_feed(
  p_limit int default 30
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  with scope as (
    select fs.store_id::text as scope_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
    union
    select v_ea_id::text
  )
  select coalesce(jsonb_agg(row_to_json(l) order by l.created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select
        aol.id,
        aol.created_at,
        aol.source,
        aol.category,
        aol.level,
        aol.status,
        aol.message,
        aol.related_id
      from public.admin_operation_logs aol
      join scope s on s.scope_id = aol.related_id
      order by aol.created_at desc
      limit v_limit
    ) l;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_ops_activity_feed(int) from public, anon;
grant   execute on function public.get_my_enterprise_ops_activity_feed(int) to authenticated;


-- ============================================================
-- 7) hq_force_store_resync
--    HQ scope 단일 매장 재동기화 · scope 밖 매장은 forbidden
-- ============================================================
create or replace function public.hq_force_store_resync(p_store_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  if not public._hq_owns_store(v_ea_id, p_store_id) then
    raise exception 'forbidden: store % not in your brand', p_store_id;
  end if;

  update public.store_policy_sync_status
     set last_policy_sync_at = null, updated_at = now()
   where store_id = p_store_id;

  if not found then
    raise exception 'store not found in monitoring: %', p_store_id;
  end if;

  perform public.admin_log_operation(
    'store_policy_sync_status', 'hq', 'info', 'force_resync',
    format('HQ forced policy resync for store %s (ea=%s)', p_store_id, v_ea_id),
    jsonb_build_object(
      'action', 'hq.force_resync',
      'store_id', p_store_id,
      'enterprise_account_id', v_ea_id
    ),
    auth.uid(), p_store_id::text, null, null, null
  );

  return jsonb_build_object('success', true, 'store_id', p_store_id);
end;
$$;
revoke execute on function public.hq_force_store_resync(uuid) from public, anon;
grant   execute on function public.hq_force_store_resync(uuid) to authenticated;


-- ============================================================
-- 8) hq_bulk_force_resync
--    최대 100개 상한 · 개별 실패 skip · success_count / failed_count 집계
-- ============================================================
create or replace function public.hq_bulk_force_resync(p_store_ids uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_count int;
  v_success int := 0;
  v_failed int := 0;
  v_failures jsonb := '[]'::jsonb;
  v_store_id uuid;
  v_updated int;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  v_count := array_length(p_store_ids, 1);
  if v_count is null or v_count = 0 then
    raise exception 'validation: p_store_ids must contain at least 1 store';
  end if;

  if v_count > 100 then
    raise exception 'validation: bulk resync limit is 100 stores per call (received %)', v_count;
  end if;

  foreach v_store_id in array p_store_ids loop
    begin
      if not public._hq_owns_store(v_ea_id, v_store_id) then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'store_id', v_store_id, 'reason', 'not_in_scope');
        continue;
      end if;

      update public.store_policy_sync_status
         set last_policy_sync_at = null, updated_at = now()
       where store_id = v_store_id;
      get diagnostics v_updated = row_count;

      if v_updated = 0 then
        v_failed := v_failed + 1;
        v_failures := v_failures || jsonb_build_object(
          'store_id', v_store_id, 'reason', 'not_in_monitoring');
        continue;
      end if;

      v_success := v_success + 1;
    exception when others then
      v_failed := v_failed + 1;
      v_failures := v_failures || jsonb_build_object(
        'store_id', v_store_id, 'reason', 'db_error',
        'error', sqlerrm);
    end;
  end loop;

  perform public.admin_log_operation(
    'store_policy_sync_status', 'hq', 'info', 'bulk_force_resync',
    format('HQ bulk resync (ea=%s, total=%s, success=%s, failed=%s)',
      v_ea_id, v_count, v_success, v_failed),
    jsonb_build_object(
      'action', 'hq.bulk_force_resync',
      'enterprise_account_id', v_ea_id,
      'total_requested', v_count,
      'success_count', v_success,
      'failed_count', v_failed,
      'failures', v_failures
    ),
    auth.uid(), v_ea_id::text, null, null, null
  );

  return jsonb_build_object(
    'success', true,
    'total_requested', v_count,
    'success_count', v_success,
    'failed_count', v_failed,
    'failures', v_failures
  );
end;
$$;
revoke execute on function public.hq_bulk_force_resync(uuid[]) from public, anon;
grant   execute on function public.hq_bulk_force_resync(uuid[]) to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc int;
begin
  select count(*) into v_rpc from pg_proc
   where proname in (
     '_hq_current_enterprise_account_id',
     '_hq_owns_store',
     'get_my_enterprise_ops_kpi',
     'get_my_enterprise_ops_stores',
     'get_my_enterprise_ops_now_playing',
     'get_my_enterprise_ops_alerts',
     'get_my_enterprise_ops_activity_feed',
     'hq_force_store_resync',
     'hq_bulk_force_resync'
   );

  raise notice '====== 0401 HQ Operations Center Diagnostics ======';
  raise notice 'RPCs present: % / 9', v_rpc;
  raise notice '===================================================';

  if v_rpc = 9 then
    raise notice '0401 COMPLETE — HQ Operations Center ready';
  else
    raise warning '0401 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
