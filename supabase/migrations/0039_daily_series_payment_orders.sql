-- ============================================
-- 0039_daily_series_payment_orders.sql
--
-- 진단:
--   대시보드 "최근 7일 매출" 그래프가 0 원으로만 표시. 상단 KPI
--   (today/week/month revenue) 는 payment_orders 기반으로 정상 반영.
--   → admin_daily_series RPC 가 여전히 revenue_events 기반.
--
-- 수정:
--   admin_daily_series 를 payment_orders 단일 진실의 원천으로 재작성.
--   - status = 'paid'
--   - refunded_at IS NULL (환불은 그날 차감 없이 0으로 표시)
--   - paid_at 을 KST(Asia/Seoul) 일자로 bucket
--   - amount sum
--
--   기존 시그니처(days int default 7) 유지. 반환 컬럼도 호환 유지
--   (d / visitors / unique_visitors / streams / revenue).
--
--   admin only 체크는 _internal_is_admin_caller() 사용 (SQL Editor 우회).
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
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- KST(Asia/Seoul) 캘린더 기준 일자 bucket
  return query
  with day_series as (
    select (
      (current_date at time zone 'Asia/Seoul')::date - (offs)
    )::date as d
    from generate_series(greatest(1, days) - 1, 0, -1) as g(offs)
  )
  select
    ds.d as d,
    coalesce((
      select count(*)::bigint
      from public.visitor_events as ve
      where (ve.created_at at time zone 'Asia/Seoul')::date = ds.d
    ), 0) as visitors,
    coalesce((
      select count(distinct ve.session_id)::bigint
      from public.visitor_events as ve
      where (ve.created_at at time zone 'Asia/Seoul')::date = ds.d
    ), 0) as unique_visitors,
    coalesce((
      select count(*)::bigint
      from public.stream_events as se
      where (se.created_at at time zone 'Asia/Seoul')::date = ds.d
        and se.event_type = 'milestone_30s'
    ), 0) as streams,
    -- 매출: payment_orders.status='paid' + refunded_at IS NULL + paid_at KST 일자
    coalesce((
      select sum(po.amount)::bigint
      from public.payment_orders as po
      where po.status = 'paid'
        and po.refunded_at is null
        and po.paid_at is not null
        and (po.paid_at at time zone 'Asia/Seoul')::date = ds.d
    ), 0) as revenue
  from day_series ds
  order by ds.d asc;
end;
$$;

grant execute on function public.admin_daily_series(int) to authenticated;

-- 확인
select
  'daily_series_uses_payment_orders=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%payment_orders as po%refunded_at is null%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_daily_series')
        then 'OK' else 'MISSING' end) as check_1;
