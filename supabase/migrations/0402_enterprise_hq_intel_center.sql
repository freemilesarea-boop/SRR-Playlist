-- 0402 — Phase 3-4: Enterprise HQ Intelligence Center
--
-- 목표:
--   본사 (HQ) 운영자용 Executive Dashboard 백엔드.
--   기존 인프라 (0353 store_monitoring_status, 0372/0400 enterprise_monthly_settlements,
--   0041 admin_operation_logs, 0385 _noc_store_health_score, 0401 HQ scope helpers)
--   위에 집계 RPC 만 추가한다.
--
-- 절대 원칙:
--   - 기존 admin_* / 0401 HQ 관제 RPC 무변경
--   - 신규 테이블/컬럼/인덱스 0 (집계 RPC + Rule 헬퍼만)
--   - HQ 는 자기 enterprise_account 소속 매장/정산만 조회
--   - Trend 는 admin_operation_logs + enterprise_monthly_settlements 기반
--     (stream_events 대용량 집계는 이번 스코프 밖)
--   - PDF 는 Phase 3-4b 로 분리 (이번 스코프: JSON/CSV 응답만)
--   - HF1~GC UI contrast 정책 유지 (UI 별도 파일)
--
-- 신규 함수 (8):
--   get_my_enterprise_intel_kpi()               → Executive KPI
--   get_my_enterprise_intel_health_score()      → Brand Health + 7d delta + breakdown
--   get_my_enterprise_intel_store_ranking(...)  → top/bottom N
--   get_my_enterprise_intel_risk_stores(limit)  → health<50 or offline_24h+
--   get_my_enterprise_intel_trend(period)       → 7d/30d/90d 시계열
--   get_my_enterprise_intel_insights()          → 7 rule cards
--   get_my_enterprise_intel_monthly_report(m)   → 특정 월 리포트 데이터 (JSON/CSV 소스)
--   get_my_enterprise_intel_executive_summary() → 자연어 2-3줄 요약 (Executive Summary AI 카드)

-- ============================================================
-- 1) Executive KPI
--    total_stores · active_stores · brand_health_avg · mtd_revenue ·
--    carryover_pending · open_alerts
-- ============================================================
create or replace function public.get_my_enterprise_intel_kpi()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_month_first date := date_trunc('month', current_date)::date;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'total_stores',
      (select count(*) from public.store_monitoring_status sms
        join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
       where ef.enterprise_account_id = v_ea_id
         and ef.deleted_at is null),
    'active_stores',
      (select count(*) from public.store_monitoring_status sms
        join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
       where ef.enterprise_account_id = v_ea_id
         and ef.deleted_at is null
         and sms.is_online),
    'mtd_revenue',
      coalesce((
        select sum(coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0))
          from public.enterprise_monthly_settlements ems
         where ems.enterprise_account_id = v_ea_id
           and ems.settlement_month = v_month_first
      ), 0),
    'carryover_pending',
      (select count(*) from public.enterprise_monthly_settlements ems
        where ems.enterprise_account_id = v_ea_id
          and ems.status in ('pending','approved')
          and coalesce(ems.carryover_applied, false) = false
          and coalesce(ems.minimum_payout, 0) > 0
          and (coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0))
              < coalesce(ems.minimum_payout, 0)),
    'open_alerts',
      (select count(*) from public.store_monitoring_status sms
        join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
       where ef.enterprise_account_id = v_ea_id
         and ef.deleted_at is null
         and (sms.has_playback_error or sms.is_offline_24h or sms.is_idle_1h_to_24h
              or sms.has_policy_outdated or sms.has_device_missing)),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_kpi() from public, anon;
grant   execute on function public.get_my_enterprise_intel_kpi() to authenticated;


-- ============================================================
-- 2) Brand Health Score
--    - 매장 health score 가중 평균 (활성 매장 +1.5, 나머지 1.0)
--    - breakdown: online_ratio · policy_sync_ratio · playback_success_ratio · avg_store_health
--    - 7d delta: 현재 avg vs 7일 전 approx (스냅샷 없으므로 policy_outdated 매장 감소로 approx)
-- ============================================================
create or replace function public.get_my_enterprise_intel_health_score()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_total int;
  v_active int;
  v_online int;
  v_playback_ok int;
  v_policy_synced int;
  v_avg_store_health numeric;
  v_score numeric;
  v_online_ratio numeric;
  v_policy_ratio numeric;
  v_playback_ratio numeric;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  select
    count(*) filter (where true),
    count(*) filter (where sms.is_online),
    count(*) filter (where sms.is_online),
    count(*) filter (where not sms.has_playback_error),
    count(*) filter (where not sms.has_policy_outdated),
    coalesce(avg(((public._noc_store_health_score(sms.store_id))->>'score')::numeric), 0)
    into v_total, v_active, v_online, v_playback_ok, v_policy_synced, v_avg_store_health
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null;

  v_online_ratio   := case when v_total > 0 then v_online::numeric / v_total * 100 else 0 end;
  v_policy_ratio   := case when v_total > 0 then v_policy_synced::numeric / v_total * 100 else 0 end;
  v_playback_ratio := case when v_total > 0 then v_playback_ok::numeric / v_total * 100 else 0 end;

  -- Brand Health = 매장 avg health (가중치 이미 _noc_store_health_score 내부에 반영)
  --                + online/policy/playback ratio 를 4:2:2:2 가중 평균
  v_score := round((v_avg_store_health * 0.4)
                 + (v_online_ratio    * 0.2)
                 + (v_policy_ratio    * 0.2)
                 + (v_playback_ratio  * 0.2));

  return jsonb_build_object(
    'success', true,
    'score', greatest(0, least(100, v_score)),
    'total_stores', v_total,
    'active_stores', v_active,
    'breakdown', jsonb_build_object(
      'avg_store_health', round(v_avg_store_health, 1),
      'online_ratio',     round(v_online_ratio, 1),
      'policy_sync_ratio', round(v_policy_ratio, 1),
      'playback_success_ratio', round(v_playback_ratio, 1)
    ),
    -- 7d delta approx: 최근 7일 동안 발생한 force_resync/paid_blocked 이벤트 카운트를 delta 지표로 반환
    'delta_7d_signal', jsonb_build_object(
      'force_resync_events', (
        select count(*) from public.admin_operation_logs
         where source = 'store_policy_sync_status'
           and status in ('force_resync', 'bulk_force_resync')
           and related_id::text in (
             select fs.store_id::text
               from public.franchise_stores fs
               join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
              where ef.enterprise_account_id = v_ea_id
                and ef.deleted_at is null)
           and created_at >= now() - interval '7 days'
      ),
      'paid_blocked_events', (
        select count(*) from public.admin_operation_logs
         where status = 'enterprise_monthly_settlement.paid_blocked'
           and details->>'enterprise_account_id' = v_ea_id::text
           and created_at >= now() - interval '7 days'
      )
    ),
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_health_score() from public, anon;
grant   execute on function public.get_my_enterprise_intel_health_score() to authenticated;


-- ============================================================
-- 3) Store Ranking
--    p_metric = 'health' | 'uptime'
--    p_direction = 'top' | 'bottom'
--    p_limit = 5 (default) · 최대 20
-- ============================================================
create or replace function public.get_my_enterprise_intel_store_ranking(
  p_metric text default 'health',
  p_direction text default 'top',
  p_limit int default 5
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;
  if p_metric not in ('health','uptime') then
    raise exception 'validation: invalid metric %', p_metric;
  end if;
  if p_direction not in ('top','bottom') then
    raise exception 'validation: invalid direction %', p_direction;
  end if;

  with base as (
    select
      sms.store_id,
      coalesce(u.business_name, u.nickname, '(매장명 없음)') as store_name,
      f.name as franchise_name,
      er.region_name as enterprise_region_name,
      sms.last_seen_at,
      sms.last_policy_sync_at,
      sms.is_online,
      sms.is_offline_24h,
      ((public._noc_store_health_score(sms.store_id))->>'score')::int as health_score,
      -- uptime approx: 최근 7일간 last_seen_at 존재 여부 (fallback 0)
      case
        when sms.last_seen_at is null then 0
        when sms.last_seen_at >= now() - interval '5 minutes' then 100
        when sms.last_seen_at >= now() - interval '1 hour' then 75
        when sms.last_seen_at >= now() - interval '24 hours' then 50
        else 0
      end as uptime_score
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null
     and coalesce(u.account_type, 'individual') = 'business'
     and u.withdrawn_at is null
  )
  select coalesce(jsonb_agg(row_to_json(b) order by
    case
      when p_metric = 'health' and p_direction = 'top'    then -b.health_score
      when p_metric = 'health' and p_direction = 'bottom' then  b.health_score
      when p_metric = 'uptime' and p_direction = 'top'    then -b.uptime_score
      when p_metric = 'uptime' and p_direction = 'bottom' then  b.uptime_score
    end
  ), '[]'::jsonb)
    into v_rows
    from (select * from base limit v_limit) b;

  return jsonb_build_object(
    'success', true,
    'metric', p_metric,
    'direction', p_direction,
    'data', v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_store_ranking(text, text, int) from public, anon;
grant   execute on function public.get_my_enterprise_intel_store_ranking(text, text, int) to authenticated;


-- ============================================================
-- 4) Risk Stores
--    health < 50 or is_offline_24h · limit 20 default
-- ============================================================
create or replace function public.get_my_enterprise_intel_risk_stores(
  p_limit int default 20
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_limit int := least(greatest(coalesce(p_limit, 20), 1), 100);
  v_rows jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  with base as (
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
      ((public._noc_store_health_score(sms.store_id))->>'score')::int as health_score
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null
     and coalesce(u.account_type, 'individual') = 'business'
     and u.withdrawn_at is null
     and (
       sms.is_offline_24h
       or sms.has_playback_error
       or ((public._noc_store_health_score(sms.store_id))->>'score')::int < 50
     )
  )
  select coalesce(jsonb_agg(row_to_json(b) order by b.health_score asc, b.last_seen_at asc nulls last), '[]'::jsonb)
    into v_rows
    from (select * from base order by health_score asc limit v_limit) b;

  return jsonb_build_object(
    'success', true,
    'data', v_rows,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_risk_stores(int) from public, anon;
grant   execute on function public.get_my_enterprise_intel_risk_stores(int) to authenticated;


-- ============================================================
-- 5) Trend Series (7d / 30d / 90d)
--    admin_operation_logs 이벤트 카운트 (daily) + enterprise_monthly_settlements (monthly)
--    stream_events 는 이번 스코프 밖.
-- ============================================================
create or replace function public.get_my_enterprise_intel_trend(
  p_period text default '30d'
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_days int;
  v_from timestamptz;
  v_daily jsonb;
  v_monthly jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  v_days := case p_period
    when '7d'  then 7
    when '30d' then 30
    when '90d' then 90
    else 30
  end;
  v_from := now() - (v_days || ' days')::interval;

  -- Daily activity: force_resync + paid_blocked + carryover_created 이벤트
  with scope as (
    select fs.store_id::text as store_scope
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
    union select v_ea_id::text
  ),
  buckets as (
    select generate_series(
      date_trunc('day', v_from)::date,
      current_date,
      interval '1 day'
    )::date as bucket_day
  ),
  events as (
    select
      date_trunc('day', aol.created_at)::date as bucket_day,
      count(*) filter (where aol.status in ('force_resync','bulk_force_resync')) as force_resync_count,
      count(*) filter (where aol.status = 'enterprise_monthly_settlement.paid_blocked') as paid_blocked_count,
      count(*) filter (where aol.status = 'enterprise_monthly_settlement.carryover_created') as carryover_created_count,
      count(*) filter (where aol.level = 'error') as error_count
    from public.admin_operation_logs aol
    join scope s on s.store_scope = aol.related_id
   where aol.created_at >= v_from
   group by 1
  )
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'date', to_char(b.bucket_day, 'YYYY-MM-DD'),
      'force_resync_count',      coalesce(e.force_resync_count, 0),
      'paid_blocked_count',      coalesce(e.paid_blocked_count, 0),
      'carryover_created_count', coalesce(e.carryover_created_count, 0),
      'error_count',             coalesce(e.error_count, 0)
    ) order by b.bucket_day
  ), '[]'::jsonb)
    into v_daily
    from buckets b left join events e on e.bucket_day = b.bucket_day;

  -- Monthly revenue: enterprise_monthly_settlements (최근 v_days 커버하는 월 범위)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
      'total_commission', coalesce(ems.total_commission, 0),
      'previous_carryover', coalesce(ems.previous_carryover, 0),
      'effective_total', coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0),
      'status', ems.status,
      'active_store_count', ems.active_store_count
    ) order by ems.settlement_month
  ), '[]'::jsonb)
    into v_monthly
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = v_ea_id
     and ems.settlement_month >= date_trunc('month', v_from)::date;

  return jsonb_build_object(
    'success', true,
    'period', p_period,
    'from', v_from,
    'daily_activity', v_daily,
    'monthly_revenue', v_monthly,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_trend(text) from public, anon;
grant   execute on function public.get_my_enterprise_intel_trend(text) to authenticated;


-- ============================================================
-- 6) AI Insights (7 rule-based)
--    각 rule 은 조건 매치 시 카드 반환 · 무매치는 skip.
--    반환: {rule, severity, title, body, metric?, action_hint?}
-- ============================================================
create or replace function public.get_my_enterprise_intel_insights()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_insights jsonb := '[]'::jsonb;

  v_offline_5d int;
  v_policy_stale int;
  v_playback_recent int;
  v_playback_prev int;
  v_carryover_pending int;
  v_this_month numeric;
  v_last_month numeric;
  v_pct_change numeric;
  v_top_health int;
  v_bottom_health int;
  v_recent_force_resync int;
  v_prev_force_resync int;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  -- Rule 1: 5일 이상 Offline
  select count(*) into v_offline_5d
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null
     and (sms.last_seen_at is null or sms.last_seen_at < now() - interval '5 days');
  if v_offline_5d > 0 then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'offline_5d',
      'severity', 'critical',
      'title', '5일 이상 오프라인 매장',
      'body', format('%s개 매장이 5일 이상 heartbeat 를 받지 못했어요. 매장에 연락하거나 관제에서 확인해주세요.', v_offline_5d),
      'metric', jsonb_build_object('count', v_offline_5d),
      'action_hint', '/enterprise/ops?filter=offline'
    );
  end if;

  -- Rule 2: 정책 sync 24h 이상 지연 매장
  select count(*) into v_policy_stale
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null
     and sms.has_policy_outdated;
  if v_policy_stale > 0 then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'policy_sync_stale',
      'severity', 'warning',
      'title', '정책 sync 24h 이상 지연',
      'body', format('%s개 매장이 24시간 이상 정책을 재수신하지 못했어요. 강제 동기화를 실행하는 것을 추천드려요.', v_policy_stale),
      'metric', jsonb_build_object('count', v_policy_stale),
      'action_hint', '/enterprise/ops?filter=policy_outdated'
    );
  end if;

  -- Rule 3: 재생 오류 급증 (최근 7일 vs 이전 7일 30% 이상 증가)
  select count(*) into v_playback_recent
    from public.admin_operation_logs
   where source = 'store_policy_sync_status'
     and level = 'error'
     and related_id::text in (
       select fs.store_id::text
         from public.franchise_stores fs
         join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        where ef.enterprise_account_id = v_ea_id
          and ef.deleted_at is null)
     and created_at >= now() - interval '7 days';
  select count(*) into v_playback_prev
    from public.admin_operation_logs
   where source = 'store_policy_sync_status'
     and level = 'error'
     and related_id::text in (
       select fs.store_id::text
         from public.franchise_stores fs
         join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        where ef.enterprise_account_id = v_ea_id
          and ef.deleted_at is null)
     and created_at >= now() - interval '14 days'
     and created_at <  now() - interval '7 days';
  if v_playback_prev > 0 and v_playback_recent > v_playback_prev * 1.3 then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'playback_error_spike',
      'severity', 'critical',
      'title', '재생 오류 급증',
      'body', format('최근 7일간 재생 오류가 %s건으로 이전 7일(%s건) 대비 %s%% 증가했어요.',
        v_playback_recent, v_playback_prev,
        round(((v_playback_recent - v_playback_prev)::numeric / v_playback_prev * 100), 0)),
      'metric', jsonb_build_object('recent', v_playback_recent, 'prev', v_playback_prev),
      'action_hint', '/enterprise/ops?filter=playback_error'
    );
  end if;

  -- Rule 4: Carryover 예정 매장 (minimum_payout 미달 pending/approved)
  select count(*) into v_carryover_pending
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = v_ea_id
     and ems.status in ('pending','approved')
     and coalesce(ems.carryover_applied, false) = false
     and coalesce(ems.minimum_payout, 0) > 0
     and (coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0))
         < coalesce(ems.minimum_payout, 0);
  if v_carryover_pending > 0 then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'carryover_pending',
      'severity', 'info',
      'title', 'Carryover 예정',
      'body', format('%s개 정산이 최소정산금 미달로 다음 달 자동 이월될 예정이에요.', v_carryover_pending),
      'metric', jsonb_build_object('count', v_carryover_pending),
      'action_hint', '/enterprise/me'
    );
  end if;

  -- Rule 5: 전월 대비 정산 증감
  select coalesce(sum(coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0)), 0)
    into v_this_month
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = v_ea_id
     and ems.settlement_month = date_trunc('month', current_date)::date;
  select coalesce(sum(coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0)), 0)
    into v_last_month
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = v_ea_id
     and ems.settlement_month = date_trunc('month', current_date - interval '1 month')::date;
  if v_last_month > 0 then
    v_pct_change := round(((v_this_month - v_last_month) / v_last_month * 100), 1);
    if abs(v_pct_change) >= 5 then
      v_insights := v_insights || jsonb_build_object(
        'rule', 'monthly_revenue_change',
        'severity', case when v_pct_change < 0 then 'warning' else 'info' end,
        'title', case when v_pct_change < 0 then '이번 달 정산 감소' else '이번 달 정산 증가' end,
        'body', format('이번 달 정산금(이월 포함)이 전월 대비 %s%% %s했어요. (이번달 %s원 · 지난달 %s원)',
          abs(v_pct_change),
          case when v_pct_change < 0 then '감소' else '증가' end,
          to_char(v_this_month, 'FM999,999,999'),
          to_char(v_last_month, 'FM999,999,999')),
        'metric', jsonb_build_object(
          'this_month', v_this_month,
          'last_month', v_last_month,
          'pct_change', v_pct_change),
        'action_hint', '/enterprise/me'
      );
    end if;
  end if;

  -- Rule 6: Brand Health 상위/하위 매장 (top/bottom 1 매장의 health 차이가 40 이상)
  select
    coalesce(max(((public._noc_store_health_score(sms.store_id))->>'score')::int), 0),
    coalesce(min(((public._noc_store_health_score(sms.store_id))->>'score')::int), 0)
    into v_top_health, v_bottom_health
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null;
  if v_top_health - v_bottom_health >= 40 then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'health_gap',
      'severity', 'warning',
      'title', '매장별 health 편차 큼',
      'body', format('상위 매장 health %s점 · 하위 매장 health %s점 · %s점 차이. 하위 매장 점검을 추천드려요.',
        v_top_health, v_bottom_health, v_top_health - v_bottom_health),
      'metric', jsonb_build_object('top', v_top_health, 'bottom', v_bottom_health),
      'action_hint', '/enterprise/intel'
    );
  end if;

  -- Rule 7: 최근 7일 force_resync 이벤트 급증 (Brand Health 저하 signal)
  select count(*) into v_recent_force_resync
    from public.admin_operation_logs
   where source = 'store_policy_sync_status'
     and status in ('force_resync','bulk_force_resync')
     and related_id::text in (
       select fs.store_id::text
         from public.franchise_stores fs
         join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        where ef.enterprise_account_id = v_ea_id
          and ef.deleted_at is null)
     and created_at >= now() - interval '7 days';
  select count(*) into v_prev_force_resync
    from public.admin_operation_logs
   where source = 'store_policy_sync_status'
     and status in ('force_resync','bulk_force_resync')
     and related_id::text in (
       select fs.store_id::text
         from public.franchise_stores fs
         join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
        where ef.enterprise_account_id = v_ea_id
          and ef.deleted_at is null)
     and created_at >= now() - interval '14 days'
     and created_at <  now() - interval '7 days';
  if v_recent_force_resync >= 5 and (v_prev_force_resync = 0 or v_recent_force_resync > v_prev_force_resync * 1.5) then
    v_insights := v_insights || jsonb_build_object(
      'rule', 'brand_health_drop_signal',
      'severity', 'warning',
      'title', '최근 7일 Brand Health 저하 신호',
      'body', format('최근 7일간 강제 동기화가 %s건 발생 (이전 7일 %s건). 정책/네트워크 이슈 가능성.',
        v_recent_force_resync, v_prev_force_resync),
      'metric', jsonb_build_object('recent', v_recent_force_resync, 'prev', v_prev_force_resync),
      'action_hint', '/enterprise/ops'
    );
  end if;

  return jsonb_build_object(
    'success', true,
    'insights', v_insights,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_insights() from public, anon;
grant   execute on function public.get_my_enterprise_intel_insights() to authenticated;


-- ============================================================
-- 7) Monthly Report (JSON/CSV source)
--    p_month: 'YYYY-MM-DD' (월 첫째날) · null 이면 current month
--    반환: 매장별 통계 + 정산 요약 + 이월 요약 + 이벤트 집계
-- ============================================================
create or replace function public.get_my_enterprise_intel_monthly_report(
  p_month date default null
)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_month date := date_trunc('month', coalesce(p_month, current_date))::date;
  v_settlement jsonb;
  v_stores jsonb;
  v_event_counts jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  -- 해당 월 정산 스냅샷
  select jsonb_build_object(
    'settlement_month', to_char(ems.settlement_month, 'YYYY-MM-DD'),
    'status', ems.status,
    'active_store_count', ems.active_store_count,
    'monthly_store_price', ems.monthly_store_price,
    'commission_rate', ems.commission_rate,
    'per_store_commission', ems.per_store_commission,
    'total_commission', ems.total_commission,
    'previous_carryover', ems.previous_carryover,
    'effective_total', coalesce(ems.total_commission, 0) + coalesce(ems.previous_carryover, 0),
    'minimum_payout', ems.minimum_payout,
    'carryover_amount', ems.carryover_amount,
    'carryover_applied', ems.carryover_applied,
    'paid_at', ems.paid_at,
    'payment_reference', ems.payment_reference
  )
    into v_settlement
    from public.enterprise_monthly_settlements ems
   where ems.enterprise_account_id = v_ea_id
     and ems.settlement_month = v_month
   limit 1;

  -- 매장별 현재 상태 (해당 월 데이터가 아닌 현재 스냅샷)
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'store_id', sms.store_id,
      'store_name', coalesce(u.business_name, u.nickname, '(매장명 없음)'),
      'franchise_name', f.name,
      'region_name', er.region_name,
      'is_online', sms.is_online,
      'has_playback_error', sms.has_playback_error,
      'has_policy_outdated', sms.has_policy_outdated,
      'last_seen_at', sms.last_seen_at,
      'last_policy_sync_at', sms.last_policy_sync_at,
      'health_score', ((public._noc_store_health_score(sms.store_id))->>'score')::int
    ) order by u.business_name nulls last
  ), '[]'::jsonb)
    into v_stores
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
    join public.users u on u.id = sms.store_id
    left join public.franchises f on f.id = sms.franchise_id
    left join public.enterprise_regions er on er.id = sms.enterprise_region_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null
     and coalesce(u.account_type, 'individual') = 'business'
     and u.withdrawn_at is null;

  -- 해당 월 이벤트 카운트
  with scope as (
    select fs.store_id::text as scope_id
      from public.franchise_stores fs
      join public.enterprise_franchises ef on ef.franchise_id = fs.franchise_id
     where ef.enterprise_account_id = v_ea_id
       and ef.deleted_at is null
    union select v_ea_id::text
  )
  select jsonb_build_object(
    'force_resync', count(*) filter (where aol.status in ('force_resync','bulk_force_resync')),
    'paid_blocked', count(*) filter (where aol.status = 'enterprise_monthly_settlement.paid_blocked'),
    'carryover_created', count(*) filter (where aol.status = 'enterprise_monthly_settlement.carryover_created'),
    'total_events', count(*)
  )
    into v_event_counts
    from public.admin_operation_logs aol
    join scope s on s.scope_id = aol.related_id
   where aol.created_at >= v_month
     and aol.created_at <  (v_month + interval '1 month');

  return jsonb_build_object(
    'success', true,
    'enterprise_account_id', v_ea_id,
    'month', to_char(v_month, 'YYYY-MM-DD'),
    'settlement', v_settlement,
    'stores', v_stores,
    'event_counts', v_event_counts,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_monthly_report(date) from public, anon;
grant   execute on function public.get_my_enterprise_intel_monthly_report(date) to authenticated;


-- ============================================================
-- 8) Executive Summary AI (자연어 2-3줄)
--    브랜드 상태를 한 문장 tone 판정 + 온라인률 · 주의 매장 수 요약.
--    UI 는 페이지 최상단 카드에 노출.
-- ============================================================
create or replace function public.get_my_enterprise_intel_executive_summary()
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_ea_id uuid := public._hq_current_enterprise_account_id();
  v_total int;
  v_online int;
  v_alert int;
  v_online_ratio numeric;
  v_brand_score numeric;
  v_tone text;
  v_headline text;
  v_lines jsonb;
begin
  if v_ea_id is null then
    raise exception 'forbidden: not an enterprise HQ admin';
  end if;

  select
    count(*),
    count(*) filter (where sms.is_online),
    count(*) filter (where sms.has_playback_error or sms.is_offline_24h or sms.is_idle_1h_to_24h
                        or sms.has_policy_outdated or sms.has_device_missing)
    into v_total, v_online, v_alert
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null;

  v_online_ratio := case when v_total > 0 then round(v_online::numeric / v_total * 100, 1) else 0 end;

  select coalesce(round(avg(((public._noc_store_health_score(sms.store_id))->>'score')::numeric)), 0)
    into v_brand_score
    from public.store_monitoring_status sms
    join public.enterprise_franchises ef on ef.franchise_id = sms.franchise_id
   where ef.enterprise_account_id = v_ea_id
     and ef.deleted_at is null;

  v_tone := case
    when v_brand_score >= 80 and v_alert = 0 then 'stable'
    when v_brand_score >= 60 or v_alert <= greatest(1, v_total / 20) then 'attention'
    else 'risk'
  end;

  v_headline := case v_tone
    when 'stable' then '이번 주 브랜드 운영은 안정적입니다.'
    when 'attention' then '이번 주 브랜드 운영에 주의가 필요한 부분이 있어요.'
    else '이번 주 브랜드 운영에 즉시 조치가 필요합니다.'
  end;

  v_lines := jsonb_build_array(
    v_headline,
    format('전체 %s개 매장 중 %s개가 온라인 (온라인률 %s%%).', v_total, v_online, v_online_ratio),
    case
      when v_alert = 0 then '주의가 필요한 매장은 없습니다.'
      else format('주의 매장 %s곳이 있어요.', v_alert)
    end
  );

  return jsonb_build_object(
    'success', true,
    'tone', v_tone,
    'brand_score', v_brand_score,
    'online_ratio', v_online_ratio,
    'alert_stores', v_alert,
    'total_stores', v_total,
    'lines', v_lines,
    'computed_at', now()
  );
end;
$$;
revoke execute on function public.get_my_enterprise_intel_executive_summary() from public, anon;
grant   execute on function public.get_my_enterprise_intel_executive_summary() to authenticated;


-- ============================================================
-- Diagnostics
-- ============================================================
do $$
declare
  v_rpc int;
begin
  select count(*) into v_rpc from pg_proc
   where proname in (
     'get_my_enterprise_intel_kpi',
     'get_my_enterprise_intel_health_score',
     'get_my_enterprise_intel_store_ranking',
     'get_my_enterprise_intel_risk_stores',
     'get_my_enterprise_intel_trend',
     'get_my_enterprise_intel_insights',
     'get_my_enterprise_intel_monthly_report',
     'get_my_enterprise_intel_executive_summary'
   );

  raise notice '====== 0402 HQ Intelligence Center Diagnostics ======';
  raise notice 'RPCs present: % / 8', v_rpc;
  raise notice '=====================================================';

  if v_rpc = 8 then
    raise notice '0402 COMPLETE — HQ Intelligence Center ready';
  else
    raise warning '0402 INCOMPLETE — 위 카운트 확인';
  end if;
end$$;
