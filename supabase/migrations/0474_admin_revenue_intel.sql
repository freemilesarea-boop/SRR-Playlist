-- ============================================
-- 0474_admin_revenue_intel.sql
--
-- Phase ADMIN-REVENUE-1 — Revenue Intelligence Dashboard 집계 RPC 4개.
--
-- PR #362(스냅샷)·#363(성장)·#364(퍼널) 위에 이어, 관리자 대시보드를 SaaS Revenue
-- Intelligence 수준으로 확장한다. 기존 admin_revenue_summary / admin_dashboard_stats /
-- admin_daily_series 는 무변경(신규 이름 사용). 결제/구독/정산 로직 무변경. 읽기 전용.
--
-- ── 실제 Revenue 데이터 모델 (프로덕션 read-only 확인) ─────────────────────
--   revenue_events: 0행 → 미사용. 매출의 원천은 payment_orders.
--   payment_orders: status(paid/requested/failed) · amount(청구액) · final_amount
--     (할인후) · paid_at · refunded_at · canceled_at · plan_type · subscription_id
--     · payapp_rebill_no · promotion_code_id/discount_amount.
--   subscriptions: status(active/cancel_scheduled/canceled/pending) · price ·
--     current_amount(할인후 실청구) · current_period_end · auto_renew · canceled_at ·
--     created_at. 모든 플랜 billing_cycle=monthly (subscription_plans).
--
-- ── 매출 정의 (기존 admin_daily_series(0039) 관례와 일치) ───────────────────
--   실매출(revenue) = payment_orders.status='paid' AND refunded_at IS NULL,
--                     sum(amount), paid_at 을 KST(Asia/Seoul) 일자로 bucket.
--   ※ amount(청구액) 사용 — 기존 대시보드/일별 시계열과 동일해 "총매출 = 플랜별 합"
--     정합성이 성립한다. final_amount(할인후)는 참고용.
--
-- ── KPI 정의 (모두 실데이터 기준) ──────────────────────────────────────────
--   MRR  = 활성 구독(status in active/cancel_scheduled)의 월 청구액 합
--          = sum(coalesce(current_amount, price)). 모든 플랜 monthly → 정규화 불필요.
--   ARR  = MRR × 12.
--   총매출(total) = 전체 기간 paid(환불 제외) amount 합 (누적).
--   ARPU  = 총매출 / 활성 회원(비탈퇴·비정지)   ← 누적 기준(본 Phase 정의)
--   ARPPU = 총매출 / 결제 회원(paid distinct user)
--   Revenue Growth      = (이번달 매출 − 지난달 매출) / 지난달 매출 × 100
--   Subscription Growth = (이번달 신규구독 − 지난달 신규구독) / 지난달 신규구독 × 100
--   신규 결제 = 구독(또는 회원)별 첫 paid 주문, 재결제 = 그 이후 paid 주문.
--   결제 성공률 = paid / (paid+failed), 환불률 = 환불 / paid.
--   활성 구독 = active + cancel_scheduled. 종료 예정 = cancel_scheduled 또는 auto_renew=false.
--   ※ 지난달 0 → Infinity/NaN 대신 프론트에서 상태(new_growth/flat) 처리 (0472 패턴).
--     RPC 는 raw 값만 반환하고 비율 clamp/정합성은 프론트 순수함수가 담당.
--
-- ── 시간대 ─────────────────────────────────────────────────────────────────
--   오늘/어제/이번주/이번달/지난달/올해 경계는 KST(Asia/Seoul). paid_at 을 KST 일자로.
--
-- ── 미지원 (추정 금지 → "데이터 없음") ─────────────────────────────────────
--   LTV(리텐션 코호트 부재) · CAC(마케팅 비용 없음) · Chargeback(필드 없음) ·
--   Retention 3/6/12개월(코호트 이력 없음) · Tax(회원 결제 세금 필드 없음) ·
--   지역/브랜드별 매출(회원-지역/브랜드 매핑 없음).
--   지원: Refund(refunded_at) · Coupon/Promotion(promotion_code_id/discount_amount).
-- ============================================

-- 관리자 가드는 0472 의 _admin_growth_guard() 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) admin_revenue_kpis() — 핵심 Revenue KPI (단일 집계).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_revenue_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today       date := (now() at time zone 'Asia/Seoul')::date;
  v_yest        date := v_today - 1;
  v_week_start  date := v_today - ((extract(isodow from v_today)::int) - 1); -- 이번주 월요일(KST)
  v_month_start date := date_trunc('month', v_today)::date;
  v_prev_start  date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_year_start  date := date_trunc('year', v_today)::date;
  v_days_in_month int := extract(day from (date_trunc('month', v_today) + interval '1 month' - interval '1 day'))::int;
  v_days_elapsed  int := extract(day from v_today)::int;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with paid as (
    select po.*, (po.paid_at at time zone 'Asia/Seoul')::date as kst_day
    from public.payment_orders po
    where po.status = 'paid' and po.refunded_at is null and po.paid_at is not null
  ),
  ranked as (
    select coalesce(subscription_id::text, user_id::text) as grp,
           row_number() over (partition by coalesce(subscription_id::text, user_id::text) order by paid_at) as rn
    from paid
  ),
  rev as (
    select
      coalesce(sum(amount) filter (where kst_day = v_today), 0)                                as today_rev,
      coalesce(sum(amount) filter (where kst_day = v_yest), 0)                                 as yest_rev,
      coalesce(sum(amount) filter (where kst_day >= v_week_start), 0)                          as week_rev,
      coalesce(sum(amount) filter (where kst_day >= v_month_start), 0)                         as month_rev,
      coalesce(sum(amount) filter (where kst_day >= v_prev_start and kst_day < v_month_start), 0) as prev_month_rev,
      coalesce(sum(amount) filter (where kst_day >= v_year_start), 0)                          as year_rev,
      coalesce(sum(amount), 0)                                                                 as total_rev,
      coalesce(round(avg(amount)), 0)                                                          as avg_amount,
      count(*)                                                                                 as paid_count,
      count(distinct user_id)                                                                  as paying_users
    from paid
  ),
  subs as (
    select
      coalesce(sum(coalesce(current_amount, price)) filter (where status in ('active','cancel_scheduled')), 0) as mrr,
      count(*) filter (where status in ('active','cancel_scheduled'))                          as active_subs,
      count(*) filter (where status = 'cancel_scheduled' or auto_renew is false)               as ending_subs,
      count(*) filter (where created_at >= v_month_start)                                      as subs_this_month,
      count(*) filter (where created_at >= v_prev_start and created_at < v_month_start)        as subs_last_month,
      count(*) filter (where status = 'canceled')                                              as canceled_subs
    from public.subscriptions
  ),
  members as (
    select
      count(*) filter (where withdrawn_at is null and disabled_at is null) as active_members,
      count(*) filter (
        where not exists (select 1 from public.subscriptions s where s.user_id = u.id and s.status in ('active','cancel_scheduled'))
          and coalesce(u.subscription_type,'') in ('individual','business','personal')
          and not exists (select 1 from public.payment_orders p where p.user_id = u.id and (p.status='paid' or p.paid_at is not null))
      ) as unpaid_users
    from public.users u where coalesce(u.role,'user') <> 'admin'
  ),
  orders as (
    select
      count(*) filter (where status='failed') as failed_count,
      count(*) filter (where refunded_at is not null) as refund_count,
      coalesce(sum(amount) filter (where refunded_at is not null),0) as refund_amount,
      count(*) filter (where canceled_at is not null) as cancel_count,
      count(*) filter (where promotion_code_id is not null) as promo_count
    from public.payment_orders
  )
  select jsonb_build_object(
    'today_revenue', (select today_rev from rev),
    'yesterday_revenue', (select yest_rev from rev),
    'week_revenue', (select week_rev from rev),
    'month_revenue', (select month_rev from rev),
    'last_month_revenue', (select prev_month_rev from rev),
    'year_revenue', (select year_rev from rev),
    'total_revenue', (select total_rev from rev),
    -- 이번달 예상 매출 = 이번달 실적 / 경과일 × 이번달 총일수 (단순 run-rate)
    'month_forecast', case when v_days_elapsed > 0
      then round((select month_rev from rev)::numeric / v_days_elapsed * v_days_in_month)
      else (select month_rev from rev) end,
    'mrr', (select mrr from subs),
    'arr', (select mrr from subs) * 12,
    'revenue_growth_this', (select month_rev from rev),
    'revenue_growth_prev', (select prev_month_rev from rev),
    'subs_this_month', (select subs_this_month from subs),
    'subs_last_month', (select subs_last_month from subs),
    'arpu', (select total_rev from rev),               -- 분자(총매출); 분모는 프론트에서 active_members
    'arppu_numerator', (select total_rev from rev),
    'active_members', (select active_members from members),
    'paying_users', (select paying_users from rev),
    'avg_payment_amount', (select avg_amount from rev),
    'paid_count', (select paid_count from rev),
    'new_payments', (select count(*) from ranked where rn = 1),
    'renewal_payments', (select count(*) from ranked where rn > 1),
    'failed_payments', (select failed_count from orders),
    'refund_count', (select refund_count from orders),
    'refund_amount', (select refund_amount from orders),
    'cancel_count', (select cancel_count from orders),
    'promo_count', (select promo_count from orders),
    'unpaid_users', (select unpaid_users from members),
    'active_subscriptions', (select active_subs from subs),
    'ending_subscriptions', (select ending_subs from subs),
    'canceled_subscriptions', (select canceled_subs from subs),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_revenue_kpis() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) admin_revenue_trend(p_range) — 매출/결제/구독 시계열 (zero-fill).
--    p_range: '7d'|'30d'|'90d' 일단위 · '12m' 월단위. 그 외 → 예외.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_revenue_trend(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today  date := (now() at time zone 'Asia/Seoul')::date;
  v_unit   text;
  v_start  date;
  v_end    date;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  if p_range = '7d' then       v_unit := 'day';   v_start := v_today - 6;  v_end := v_today;
  elsif p_range = '30d' then   v_unit := 'day';   v_start := v_today - 29; v_end := v_today;
  elsif p_range = '90d' then   v_unit := 'day';   v_start := v_today - 89; v_end := v_today;
  elsif p_range = '12m' then   v_unit := 'month';
    v_start := (date_trunc('month', v_today) - interval '11 months')::date;
    v_end   := date_trunc('month', v_today)::date;
  else
    raise exception 'invalid range: %, allowed: 7d|30d|90d|12m', p_range using errcode = '22023';
  end if;

  with calendar as (
    select case when v_unit='day' then gs::date else date_trunc('month',gs)::date end as bucket
    from generate_series(v_start::timestamp, v_end::timestamp,
      case when v_unit='day' then interval '1 day' else interval '1 month' end) gs
  ),
  paid as (
    select
      case when v_unit='day' then (po.paid_at at time zone 'Asia/Seoul')::date
           else date_trunc('month',(po.paid_at at time zone 'Asia/Seoul')::date)::date end as bucket,
      po.amount,
      row_number() over (partition by coalesce(po.subscription_id::text, po.user_id::text) order by po.paid_at) as rn
    from public.payment_orders po
    where po.status='paid' and po.refunded_at is null and po.paid_at is not null
      and (po.paid_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  refunds as (
    select case when v_unit='day' then (refunded_at at time zone 'Asia/Seoul')::date
                else date_trunc('month',(refunded_at at time zone 'Asia/Seoul')::date)::date end as bucket
    from public.payment_orders where refunded_at is not null and (refunded_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  cancels as (
    select case when v_unit='day' then (canceled_at at time zone 'Asia/Seoul')::date
                else date_trunc('month',(canceled_at at time zone 'Asia/Seoul')::date)::date end as bucket
    from public.payment_orders where canceled_at is not null and (canceled_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  pagg as (
    select bucket, sum(amount) revenue, count(*) payments,
      count(*) filter (where rn=1) new_payments, count(*) filter (where rn>1) renewal_payments
    from paid group by bucket
  ),
  ragg as (select bucket, count(*) refunds from refunds group by bucket),
  cagg as (select bucket, count(*) cancels from cancels group by bucket),
  joined as (
    select c.bucket,
      coalesce(p.revenue,0) revenue, coalesce(p.payments,0) payments,
      coalesce(p.new_payments,0) new_payments, coalesce(p.renewal_payments,0) renewal_payments,
      coalesce(r.refunds,0) refunds, coalesce(x.cancels,0) cancels,
      -- 활성 구독 재구성: 버킷 종료 시점까지 생성 & (미취소 또는 취소가 그 이후)
      (select count(*) from public.subscriptions s
        where s.created_at <= (c.bucket + case when v_unit='day' then interval '1 day' else interval '1 month' end)
          and (s.canceled_at is null or s.canceled_at > c.bucket)) as active_subs
    from calendar c
    left join pagg p on p.bucket=c.bucket
    left join ragg r on r.bucket=c.bucket
    left join cagg x on x.bucket=c.bucket
  )
  select jsonb_build_object(
    'range', p_range, 'unit', v_unit, 'start', v_start, 'end', v_end,
    'points', coalesce(jsonb_agg(jsonb_build_object(
      'bucket', bucket, 'revenue', revenue, 'payments', payments,
      'new_payments', new_payments, 'renewal_payments', renewal_payments,
      'refunds', refunds, 'cancels', cancels, 'active_subs', active_subs
    ) order by bucket), '[]'::jsonb),
    'total_revenue', coalesce(sum(revenue),0),
    'generated_at', now()
  ) into v_result from joined;

  return v_result;
end;
$$;

grant execute on function public.admin_revenue_trend(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) admin_revenue_breakdown() — 플랜/유형/기간별 매출 + 플랜 분석 + Churn + Top + Funnel.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_revenue_breakdown()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  with paid as (
    select po.*, (po.paid_at at time zone 'Asia/Seoul')::date kst_day
    from public.payment_orders po
    where po.status='paid' and po.refunded_at is null and po.paid_at is not null
  )
  select jsonb_build_object(
    -- 플랜별 매출 (누적 paid)
    'by_plan', (select coalesce(jsonb_agg(jsonb_build_object('key', plan_type, 'count', c, 'revenue', amt) order by amt desc), '[]'::jsonb)
      from (select coalesce(plan_type,'unknown') plan_type, count(*) c, sum(amount) amt from paid group by 1) q),
    -- 회원 유형별 매출 (account_type)
    'by_type', (select coalesce(jsonb_agg(jsonb_build_object('key', seg, 'count', c, 'revenue', amt) order by amt desc), '[]'::jsonb)
      from (select case when u.account_type='artist' then 'artist' when u.account_type='business' then 'business' else 'general' end seg,
                   count(*) c, sum(p.amount) amt
            from paid p join public.users u on u.id=p.user_id group by 1) q),
    -- 기간별 매출
    'by_period', jsonb_build_object(
      'today', (select coalesce(sum(amount),0) from paid where kst_day = v_today),
      'this_week', (select coalesce(sum(amount),0) from paid where kst_day >= v_today - ((extract(isodow from v_today)::int)-1)),
      'this_month', (select coalesce(sum(amount),0) from paid where kst_day >= date_trunc('month',v_today)::date),
      'this_year', (select coalesce(sum(amount),0) from paid where kst_day >= date_trunc('year',v_today)::date),
      'total', (select coalesce(sum(amount),0) from paid)
    ),
    -- 플랜 분석: 구독 기준 (매출/구독수/활성/취소/평균유지일/전환)
    'plan_analysis', (select coalesce(jsonb_agg(jsonb_build_object(
        'key', plan_type,
        'subs', subs, 'active', active_c, 'canceled', canceled_c,
        'revenue', coalesce(rev,0),
        'avg_retention_days', avg_days
      ) order by coalesce(rev,0) desc), '[]'::jsonb)
      from (
        select s.plan_type,
          count(*) subs,
          count(*) filter (where s.status in ('active','cancel_scheduled')) active_c,
          count(*) filter (where s.status='canceled') canceled_c,
          (select sum(p.amount) from paid p where p.plan_type = s.plan_type) rev,
          round(avg(extract(epoch from (coalesce(s.canceled_at, now()) - s.created_at)) / 86400.0)) avg_days
        from public.subscriptions s group by s.plan_type
      ) q),
    -- Churn: 취소/종료예정/실패/미결제 + churn rate
    'churn', jsonb_build_object(
      'canceled', (select count(*) from public.subscriptions where status='canceled'),
      'cancel_scheduled', (select count(*) from public.subscriptions where status='cancel_scheduled'),
      'failed_payments', (select count(*) from public.payment_orders where status='failed'),
      'refunds', (select count(*) from public.payment_orders where refunded_at is not null),
      'active', (select count(*) from public.subscriptions where status in ('active','cancel_scheduled')),
      -- churn rate = 취소 / (활성 + 취소)  (스냅샷 기준, 시계열 리텐션은 미지원)
      'churn_numerator', (select count(*) from public.subscriptions where status='canceled'),
      'churn_denominator', (select count(*) from public.subscriptions where status in ('active','cancel_scheduled','canceled'))
    ),
    -- Top: 결제 회원 / 플랜 / 매출일 / 결제일
    'top_payers', (select coalesce(jsonb_agg(jsonb_build_object('user_id', user_id, 'email', email, 'revenue', amt, 'payments', c) order by amt desc), '[]'::jsonb)
      from (select p.user_id, au.email, sum(p.amount) amt, count(*) c
            from paid p left join auth.users au on au.id=p.user_id group by 1,2 order by amt desc limit 10) q),
    'top_plan', (select jsonb_build_object('key', plan_type, 'revenue', amt) from (select coalesce(plan_type,'unknown') plan_type, sum(amount) amt from paid group by 1 order by amt desc limit 1) q),
    'top_revenue_day', (select jsonb_build_object('day', kst_day, 'revenue', amt) from (select kst_day, sum(amount) amt from paid group by 1 order by amt desc limit 1) q),
    'top_count_day', (select jsonb_build_object('day', kst_day, 'payments', c) from (select kst_day, count(*) c from paid group by 1 order by c desc limit 1) q),
    -- Revenue Funnel (결제 관점): 시도 → 성공 → 활성구독 → 첫 갱신 → 유지(미지원)
    'revenue_funnel', jsonb_build_array(
      jsonb_build_object('key','attempt','label','결제 시도','count', (select count(*) from public.payment_orders where status in ('paid','failed','requested')),'supported',true),
      jsonb_build_object('key','success','label','결제 성공','count', (select count(distinct coalesce(subscription_id::text,user_id::text)) from paid),'supported',true),
      jsonb_build_object('key','active','label','구독 활성','count', (select count(*) from public.subscriptions where status in ('active','cancel_scheduled')),'supported',true),
      jsonb_build_object('key','renew','label','첫 갱신','count', (select count(*) from (select coalesce(subscription_id::text,user_id::text) g, count(*) c from paid group by 1 having count(*) > 1) r),'supported',true,'note','2회차 이상 결제'),
      jsonb_build_object('key','m3','label','3개월 유지','count',null,'supported',false,'note','리텐션 코호트 이력 부재'),
      jsonb_build_object('key','m6','label','6개월 유지','count',null,'supported',false,'note','리텐션 코호트 이력 부재'),
      jsonb_build_object('key','m12','label','12개월 유지','count',null,'supported',false,'note','리텐션 코호트 이력 부재')
    ),
    -- 지원 여부 매트릭스 (추정 금지 → 데이터 없음 명시)
    'support', jsonb_build_object(
      'refund', true, 'promotion', true,
      'ltv', false, 'cac', false, 'chargeback', false, 'retention', false, 'tax', false,
      'region', false, 'brand', false
    ),
    'generated_at', now()
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_revenue_breakdown() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) admin_revenue_forecast() — 단순 예측 (실 활성구독 기반, AI 추정 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_revenue_forecast()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today date := (now() at time zone 'Asia/Seoul')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_prev_start  date := (date_trunc('month', v_today) - interval '1 month')::date;
  v_days_in_month int := extract(day from (date_trunc('month', v_today) + interval '1 month' - interval '1 day'))::int;
  v_days_elapsed  int := extract(day from v_today)::int;
  v_mtd bigint;
  v_mrr bigint;
  v_next_mrr bigint;
  v_subs_this int;
  v_subs_last int;
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(sum(amount),0) into v_mtd
  from public.payment_orders
  where status='paid' and refunded_at is null and paid_at is not null
    and (paid_at at time zone 'Asia/Seoul')::date >= v_month_start;

  select coalesce(sum(coalesce(current_amount, price)),0) into v_mrr
  from public.subscriptions where status in ('active','cancel_scheduled');

  -- 다음달 MRR = 계속 유지될 구독(활성 & auto_renew, cancel_scheduled 제외)의 월 청구액
  select coalesce(sum(coalesce(current_amount, price)),0) into v_next_mrr
  from public.subscriptions where status='active' and auto_renew is true;

  select count(*) filter (where created_at >= v_month_start),
         count(*) filter (where created_at >= v_prev_start and created_at < v_month_start)
    into v_subs_this, v_subs_last
  from public.subscriptions;

  v_result := jsonb_build_object(
    'method', '단순 run-rate & 활성구독 기반 (AI 추정 없음)',
    'month_to_date_revenue', v_mtd,
    'days_elapsed', v_days_elapsed,
    'days_in_month', v_days_in_month,
    -- 이번달 예상 매출 = MTD / 경과일 × 총일수
    'projected_month_revenue', case when v_days_elapsed > 0 then round(v_mtd::numeric / v_days_elapsed * v_days_in_month) else v_mtd end,
    'current_mrr', v_mrr,
    'next_month_mrr', v_next_mrr,      -- cancel_scheduled 종료 반영
    'arr_forecast', v_next_mrr * 12,
    'subs_this_month', v_subs_this,
    'subs_last_month', v_subs_last,
    'generated_at', now()
  );

  return v_result;
end;
$$;

grant execute on function public.admin_revenue_forecast() to authenticated;
