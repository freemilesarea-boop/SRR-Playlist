-- ============================================
-- 0472_admin_member_growth.sql
--
-- Phase ADMIN-MEMBER-GROWTH-1 — 회원 성장 대시보드 집계 RPC.
--
-- PR #362(admin_member_stats)의 회원 스냅샷을 확장하여 "성장 추이 · 유료 전환 ·
-- 최근 가입 흐름"을 분석하기 위한 신규 RPC 3개를 추가한다. 기존 RPC
-- (admin_member_stats / admin_dashboard_stats / admin_daily_series) 는 무변경.
-- Player/Queue/Playback/Scheduler/정산/음원 무관. 읽기 전용 집계.
--
-- ── 시간대 기준 ─────────────────────────────────────────────────────────
--   "오늘 / 이번 달 / 지난달" 등 캘린더 경계는 한국시간(Asia/Seoul) 기준으로
--   계산한다. created_at 은 timestamptz(UTC 저장)이며, KST 일자 버킷은
--   (created_at at time zone 'Asia/Seoul')::date 로 산출한다(0039 패턴 동일).
--   "오늘"은 (now() at time zone 'Asia/Seoul')::date 로 KST 현재 일자를 구한다.
--   "최근 7/30일"은 캘린더 경계가 아니라 현재 시점 기준 rolling 창
--   (created_at >= now() - interval 'N days') 이다.
--
-- ── 집계 정의 (PR #362 와 일관) ────────────────────────────────────────
--   대상(전체 유효 회원) = public.users 중 role <> 'admin' (내부 운영자 제외).
--     → total_valid_members = admin_member_stats.total_members 와 동일 정의.
--   활성 유료 회원(active_paid) = subscriptions.status in ('active','cancel_scheduled')
--     보유 회원 = admin_member_stats.paid_users 와 동일 정의.
--   미결제(unpaid) = 유료형 subscription_type 인데 결제완료 이력(payment_orders
--     status='paid' or paid_at) 전무 = admin_member_stats.unpaid_users 동일.
--   회원 구분(seg): artist=account_type 'artist', business='business',
--     general=그 외(individual/NULL/기타). → admin_member_stats 와 동일.
--     ※ 단, 성장 추이 차트(series)의 유형별 집계는 NULL/미지정을 별도 'unknown'
--       버킷으로 분리한다(정합성 경고 목적). general(series)='individual' 로 한정.
--       스냅샷(admin_member_stats)의 general(=NULL 포함)과는 grouping 이 다르며
--       이는 의도된 것 — 각 RPC 주석/타입에 명시한다.
--
-- ── 무료 → 유료 전환 이력 ──────────────────────────────────────────────
--   전용 히스토리/이벤트 로그 테이블(membership tier 변경 이력)이 스키마에
--   존재하지 않는다(subscriptions/payment_orders/revenue_events 스냅샷만 존재).
--   → free_to_paid 전환 "수"는 스냅샷만으로 정확히 추정할 수 없으므로 임의
--     추정하지 않고 free_to_paid_history_supported=false / count=null 로 보고한다.
--     정확 집계가 필요하면 후속 마이그레이션에서 membership_change_events 이벤트
--     로그를 설계해야 한다(이 마이그레이션 범위 밖).
--
-- ── 정합성(설계상 성립) ────────────────────────────────────────────────
--   series: 각 버킷 new_total = new_general + new_business + new_artist + new_unknown.
--   KPI: active_paid <= total_valid, last30_paid <= last30_signups.
--   프론트에서 런타임 재검증(비차단 경고).
-- ============================================

-- created_at 기반 시계열 스캔을 위한 인덱스(소규모 테이블이라 즉시, 안전).
create index if not exists idx_users_created_at on public.users (created_at);

-- 관리자 가드: admin_member_stats 와 동일 패턴을 재사용하는 헬퍼.
create or replace function public._admin_growth_guard()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role = 'admin') then
      raise exception 'admin only';
    end if;
  end;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) admin_member_growth_kpis() — 성장 KPI + 유료 전환 KPI (단일 스캔).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_member_growth_kpis()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today        date := (now() at time zone 'Asia/Seoul')::date;
  v_month_start  date := date_trunc('month', (now() at time zone 'Asia/Seoul')::date)::date;
  v_prev_start   date := (date_trunc('month', (now() at time zone 'Asia/Seoul')::date) - interval '1 month')::date;
  v_this_month   bigint;
  v_last_month   bigint;
  v_result       jsonb;
begin
  perform public._admin_growth_guard();

  with base as (
    select
      u.id,
      u.created_at,
      -- 회원 구분 (스냅샷과 동일: NULL → general)
      case
        when u.account_type = 'artist'   then 'artist'
        when u.account_type = 'business' then 'business'
        else 'general'
      end as seg,
      exists (
        select 1 from public.subscriptions s
        where s.user_id = u.id and s.status in ('active', 'cancel_scheduled')
      ) as has_active_paid,
      coalesce(u.subscription_type, '') as sub_type,
      exists (
        select 1 from public.payment_orders p
        where p.user_id = u.id and (p.status = 'paid' or p.paid_at is not null)
      ) as has_paid_order,
      -- KST 캘린더 일자
      (u.created_at at time zone 'Asia/Seoul')::date as kst_day
    from public.users u
    where coalesce(u.role, 'user') <> 'admin'
  ),
  agg as (
    select
      count(*)                                                             as total_valid,
      count(*) filter (where has_active_paid)                              as active_paid,
      count(*) filter (
        where not has_active_paid
          and sub_type in ('individual', 'business', 'personal')
          and not has_paid_order
      )                                                                    as unpaid,
      -- 가입 흐름 (오늘/이번달/지난달 = KST 캘린더; 최근 7/30일 = rolling)
      count(*) filter (where kst_day = v_today)                            as today_signups,
      count(*) filter (where created_at >= now() - interval '7 days')      as last_7d,
      count(*) filter (where created_at >= now() - interval '30 days')     as last_30d,
      count(*) filter (where kst_day >= v_month_start)                     as this_month,
      count(*) filter (where kst_day >= v_prev_start and kst_day < v_month_start) as last_month,
      -- 세그먼트별 전환 (분모: 세그먼트 총원, 분자: 활성 유료)
      count(*) filter (where seg = 'general')                              as general_total,
      count(*) filter (where seg = 'general' and has_active_paid)          as general_paid,
      count(*) filter (where seg = 'business')                             as business_total,
      count(*) filter (where seg = 'business' and has_active_paid)         as business_paid,
      -- 최근 30일 가입자 중 현재 활성 유료 (<= last_30d)
      count(*) filter (where created_at >= now() - interval '30 days' and has_active_paid) as last30_paid
    from base
  )
  select jsonb_build_object(
    -- 가입 흐름
    'today_signups', today_signups,
    'last_7d', last_7d,
    'last_30d', last_30d,
    'this_month', this_month,
    'last_month', last_month,
    -- 전월 대비 (Infinity/NaN 방지: 지난달 0 처리는 mom_status 로 표현)
    'mom_growth_rate', case
      when last_month > 0 then round((this_month - last_month)::numeric / last_month * 100, 1)
      else null
    end,
    'mom_status', case
      when last_month > 0 then 'normal'
      when this_month > 0 then 'new_growth'   -- 지난달 0 · 이번달 >0 → 신규 성장
      else 'flat'                              -- 둘 다 0 → 0%
    end,
    -- 전환
    'active_paid_members', active_paid,
    'total_valid_members', total_valid,
    'unpaid_users', unpaid,
    'paid_conversion_rate',     case when total_valid    > 0 then round(active_paid::numeric    / total_valid    * 100, 1) else 0 end,
    'general_conversion_rate',  case when general_total  > 0 then round(general_paid::numeric   / general_total  * 100, 1) else 0 end,
    'business_conversion_rate', case when business_total > 0 then round(business_paid::numeric  / business_total * 100, 1) else 0 end,
    'general_total', general_total,
    'general_paid', general_paid,
    'business_total', business_total,
    'business_paid', business_paid,
    'last30_signups', last_30d,
    'last30_paid', last30_paid,
    'last30_conversion_rate', case when last_30d > 0 then round(last30_paid::numeric / last_30d * 100, 1) else 0 end,
    -- 무료→유료 전환 이력: 전용 이벤트 로그 부재 → 임의 추정 금지
    'free_to_paid_history_supported', false,
    'free_to_paid_count', null,
    'generated_at', now()
  )
  into v_result
  from agg;

  return v_result;
end;
$$;

grant execute on function public.admin_member_growth_kpis() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) admin_member_growth_series(p_range) — 시계열 (신규 + 누적 + 유형별), zero-fill.
--    p_range: '7d'|'30d'|'90d' → 일 단위, '12m' → 월 단위. 그 외 → 예외.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_member_growth_series(p_range text default '30d')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_today   date := (now() at time zone 'Asia/Seoul')::date;
  v_unit    text;
  v_start   date;
  v_end     date;
  v_prior   bigint;   -- 창 시작 이전까지의 누적 회원 수 (누적선 baseline)
  v_result  jsonb;
begin
  perform public._admin_growth_guard();

  -- 날짜 범위 검증 + 최대 조회 기간 제한 (SQL Injection 여지 없음: 화이트리스트)
  if p_range = '7d' then
    v_unit := 'day';  v_start := v_today - 6;  v_end := v_today;
  elsif p_range = '30d' then
    v_unit := 'day';  v_start := v_today - 29; v_end := v_today;
  elsif p_range = '90d' then
    v_unit := 'day';  v_start := v_today - 89; v_end := v_today;
  elsif p_range = '12m' then
    v_unit := 'month';
    v_start := (date_trunc('month', v_today) - interval '11 months')::date;
    v_end   := date_trunc('month', v_today)::date;
  else
    raise exception 'invalid range: %, allowed: 7d|30d|90d|12m', p_range
      using errcode = '22023';
  end if;

  -- 창 시작 이전 누적 baseline (KST 일자 기준)
  select count(*) into v_prior
  from public.users u
  where coalesce(u.role, 'user') <> 'admin'
    and (u.created_at at time zone 'Asia/Seoul')::date < v_start;

  with calendar as (
    select case when v_unit = 'day'
             then gs::date
             else date_trunc('month', gs)::date
           end as bucket
    from generate_series(
      v_start::timestamp,
      v_end::timestamp,
      case when v_unit = 'day' then interval '1 day' else interval '1 month' end
    ) as gs
  ),
  members as (
    select
      case when v_unit = 'day'
        then (u.created_at at time zone 'Asia/Seoul')::date
        else date_trunc('month', (u.created_at at time zone 'Asia/Seoul')::date)::date
      end as bucket,
      u.account_type
    from public.users u
    where coalesce(u.role, 'user') <> 'admin'
      and (u.created_at at time zone 'Asia/Seoul')::date >= v_start
  ),
  agg as (
    select
      bucket,
      count(*)                                                       as new_total,
      count(*) filter (where account_type = 'individual')           as new_general,
      count(*) filter (where account_type = 'business')             as new_business,
      count(*) filter (where account_type = 'artist')               as new_artist,
      count(*) filter (where account_type is null
                          or account_type not in ('individual','business','artist')) as new_unknown
    from members
    group by bucket
  ),
  joined as (
    select
      c.bucket,
      coalesce(a.new_total, 0)    as new_total,
      coalesce(a.new_general, 0)  as new_general,
      coalesce(a.new_business, 0) as new_business,
      coalesce(a.new_artist, 0)   as new_artist,
      coalesce(a.new_unknown, 0)  as new_unknown
    from calendar c
    left join agg a on a.bucket = c.bucket
  ),
  running as (
    select
      bucket, new_total, new_general, new_business, new_artist, new_unknown,
      v_prior + sum(new_total) over (order by bucket rows between unbounded preceding and current row) as cumulative
    from joined
  )
  select jsonb_build_object(
    'range', p_range,
    'unit', v_unit,
    'start', v_start,
    'end', v_end,
    'total_new', coalesce(sum(new_total), 0),
    'unknown_total', coalesce(sum(new_unknown), 0),
    'points', coalesce(jsonb_agg(
      jsonb_build_object(
        'bucket', bucket,
        'new_total', new_total,
        'new_general', new_general,
        'new_business', new_business,
        'new_artist', new_artist,
        'new_unknown', new_unknown,
        'cumulative', cumulative
      ) order by bucket
    ), '[]'::jsonb),
    'generated_at', now()
  )
  into v_result
  from running;

  return v_result;
end;
$$;

grant execute on function public.admin_member_growth_series(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) admin_recent_members(p_limit) — 최근 가입 회원 (최신순). 관리자 전용.
--    p_limit 검증(1..50). 개인정보 최소 노출: 표시명/이메일/유형/플랜/결제/상태만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_recent_members(p_limit int default 10)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int := greatest(1, least(coalesce(p_limit, 10), 50));
  v_result jsonb;
begin
  perform public._admin_growth_guard();

  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb)
  into v_result
  from (
    select
      u.id,
      u.nickname                       as display_name,
      au.email                         as email,
      u.account_type                   as account_type,
      coalesce(u.membership_tier, 'free') as membership_tier,
      coalesce(u.subscription_type, '')   as subscription_type,
      -- 결제 상태 (스냅샷 정의와 동일: paid > unpaid > free)
      case
        when exists (
          select 1 from public.subscriptions s
          where s.user_id = u.id and s.status in ('active', 'cancel_scheduled')
        ) then 'paid'
        when coalesce(u.subscription_type, '') in ('individual', 'business', 'personal')
          and not exists (
            select 1 from public.payment_orders p
            where p.user_id = u.id and (p.status = 'paid' or p.paid_at is not null)
          ) then 'unpaid'
        else 'free'
      end                              as pay_status,
      (au.email_confirmed_at is not null) as email_verified,
      -- 계정 상태 (스냅샷 정의와 동일 우선순위)
      case
        when u.withdrawn_at is not null then 'withdrawn'
        when u.disabled_at is not null  then 'disabled'
        when au.email_confirmed_at is null then 'email_unverified'
        else 'active'
      end                              as status,
      u.created_at                     as created_at
    from public.users u
    left join auth.users au on au.id = u.id
    where coalesce(u.role, 'user') <> 'admin'
    order by u.created_at desc
    limit v_limit
  ) as t;

  return v_result;
end;
$$;

grant execute on function public.admin_recent_members(int) to authenticated;
