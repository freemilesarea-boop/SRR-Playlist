-- ============================================
-- 0468_admin_daily_series_sargable_perf.sql
--
-- 진단(실측):
--   관리자 Dashboard 최초 진입 시 admin_daily_series(7) 호출이
--   authenticated 롤의 statement_timeout(8s) 를 초과 →
--   PostgreSQL "canceling statement due to statement timeout" (SQLSTATE 57014).
--
--   EXPLAIN ANALYZE (프로덕션, stream_events≈92k행 / visitor_events≈42k행):
--     기존 admin_daily_series(7) 실행시간 = 8047 ms
--       - SubPlan(streams)   : stream_events Seq Scan 727ms × 7 loops ≈ 5.1s
--       - SubPlan(uniq_visit): visitor_events Seq Scan 268ms × 7 loops ≈ 1.9s
--       - SubPlan(visitors)  : 151ms × 7 loops ≈ 1.1s
--
--   근본 원인:
--     일자 비교를 `(created_at at time zone 'Asia/Seoul')::date = ds.d`
--     처럼 "컬럼에 함수 적용" 형태(non-sargable)로 작성 →
--     created_at 인덱스(range scan)를 사용할 수 없어, 7일 각각의
--     상관 서브쿼리가 매번 테이블 전체를 Full Scan.
--     (테이블 1개당 최대 2회 × 7일 = Full Scan 반복)
--
-- 수정(동작/결과 불변, 성능만 개선):
--   1) 일자 필터를 sargable 범위 조건으로 변경:
--      `created_at >= <조회구간 시작(KST 자정)의 timestamptz>`
--      → idx_visitor_events_created_at / idx_stream_events_created_at /
--        idx_payment_orders_paid_at(부분인덱스) 를 Index Range Scan 으로 사용.
--   2) 7회 반복 상관 서브쿼리 → 테이블당 1회 단일 스캔 집계(GROUP BY KST date)
--      후 day_series 에 LEFT JOIN 으로 0 채움.
--
--   KST 자정 timestamptz 산출은 기존 admin_compute_daily_metrics 와
--   동일한 관용구(`(date::text || ' 00:00:00+09')::timestamptz`) 사용.
--
--   시그니처(days int default 7) / 반환 컬럼(d, visitors, unique_visitors,
--   streams, revenue) / 매출 정의(payment_orders status='paid' &
--   refunded_at IS NULL & KST 일자 bucket) / admin 체크 로직 모두 그대로 유지.
--
--   실측 결과: 재작성 쿼리 실행시간 97.8 ms (동일 데이터/동일 반환값).
--             8047ms → 97.8ms (약 82배 개선, 8s timeout 이하로 진입).
-- ============================================

drop function if exists public.admin_daily_series(int);
drop function if exists public.admin_daily_series(integer);

create or replace function public.admin_daily_series(days int default 7)
returns table(
  d date,
  visitors bigint,
  unique_visitors bigint,
  streams bigint,
  revenue bigint
)
language plpgsql security definer set search_path = public
as $$
declare
  v_days int := greatest(1, days);
  v_today_kst date := (now() at time zone 'Asia/Seoul')::date;
  v_since_kst date := (now() at time zone 'Asia/Seoul')::date - (v_days - 1);
  -- 조회 구간 시작 = 첫날(KST) 자정의 절대 시각(timestamptz).
  -- created_at/paid_at(timestamptz) 인덱스를 그대로 태우기 위한 sargable 경계값.
  v_since_ts timestamptz := (v_since_kst::text || ' 00:00:00+09')::timestamptz;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- KST(Asia/Seoul) 캘린더 기준 일자 bucket.
  -- 각 원본 테이블은 sargable 범위조건으로 인덱스 range scan 후 1회 집계.
  return query
  with day_series as (
    select (v_today_kst - offs)::date as d
    from generate_series(v_days - 1, 0, -1) as g(offs)
  ),
  ve_agg as (
    select (ve.created_at at time zone 'Asia/Seoul')::date as d,
           count(*)::bigint as visitors,
           count(distinct ve.session_id)::bigint as unique_visitors
    from public.visitor_events as ve
    where ve.created_at >= v_since_ts
    group by 1
  ),
  se_agg as (
    select (se.created_at at time zone 'Asia/Seoul')::date as d,
           count(*)::bigint as streams
    from public.stream_events as se
    where se.created_at >= v_since_ts
      and se.event_type = 'milestone_30s'
    group by 1
  ),
  po_agg as (
    -- 매출: payment_orders.status='paid' + refunded_at IS NULL + paid_at KST 일자
    select (po.paid_at at time zone 'Asia/Seoul')::date as d,
           sum(po.amount)::bigint as revenue
    from public.payment_orders as po
    where po.status = 'paid'
      and po.refunded_at is null
      and po.paid_at is not null
      and po.paid_at >= v_since_ts
    group by 1
  )
  select
    ds.d as d,
    coalesce(ve_agg.visitors, 0) as visitors,
    coalesce(ve_agg.unique_visitors, 0) as unique_visitors,
    coalesce(se_agg.streams, 0) as streams,
    coalesce(po_agg.revenue, 0) as revenue
  from day_series ds
  left join ve_agg on ve_agg.d = ds.d
  left join se_agg on se_agg.d = ds.d
  left join po_agg on po_agg.d = ds.d
  order by ds.d asc;
end;
$$;

grant execute on function public.admin_daily_series(int) to authenticated;

-- 확인: 매출은 여전히 payment_orders 기반 & 범위조건(sargable)으로 재작성됨
select
  'daily_series_sargable=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%created_at >= v_since_ts%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_daily_series')
        then 'OK' else 'MISSING' end) as check_1,
  'daily_series_uses_payment_orders=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%payment_orders as po%refunded_at is null%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_daily_series')
        then 'OK' else 'MISSING' end) as check_2;
