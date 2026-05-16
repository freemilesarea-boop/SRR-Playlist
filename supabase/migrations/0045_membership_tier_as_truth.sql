-- ============================================
-- 0045_membership_tier_as_truth.sql
--
-- 단일 진실의 원천: users.membership_tier
--   - free → 무료
--   - individual → 일반 활성
--   - business → 사업자 활성
--
-- 운영 증상:
--   1) admin_dashboard_stats.active_subscribers 가 subscriptions.status='active'
--      기준 → 해지된 회원도 active 로 잡힘 / 활성 회원이 누락되는 등 mismatch.
--   2) subscriptions.status='canceled' 인데 users.membership_tier 가 free 가
--      아닌 케이스 발생 (과거 데이터 정합성 부재).
--
-- 수정:
--   1) admin_dashboard_stats DROP+CREATE — active_subscribers 를
--      users.membership_tier 기반으로 통일.
--   2) 데이터 정합성 backfill:
--      subscription.status in (canceled, cancelled, refunded, expired) AND
--      user.membership_tier <> 'free' → tier 와 subscription_type 을 free 로.
--      단, 같은 user 에 active 상태의 다른 subscription 이 있으면 skip.
--   3) admin_sync_membership_from_subscriptions() RPC — 운영자가 주기적으로
--      호출 가능한 reconcile.
-- ============================================

-- ----------------------
-- 1) admin_dashboard_stats 재작성 — membership_tier 단일 진실 원천
-- ----------------------
drop function if exists public.admin_dashboard_stats();

create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public
as $$
declare
  v_result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  select jsonb_build_object(
    'today_visitors', (select count(*) from public.visitor_events as ve where ve.created_at >= today_start),
    'today_unique_visitors', (select count(distinct ve.session_id) from public.visitor_events as ve
      where ve.created_at >= today_start),
    'today_streams', (select count(*) from public.stream_events as se
      where se.created_at >= today_start and se.event_type='milestone_30s'),
    'today_new_users', (select count(*) from public.users as u where u.created_at >= today_start),
    -- 매출: payment_orders.status='paid' + refunded_at IS NULL
    'today_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= today_start), 0),
    'week_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= week_start), 0),
    'month_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null and po.paid_at >= month_start), 0),
    'total_revenue', coalesce((select sum(po.amount) from public.payment_orders as po
      where po.status='paid' and po.refunded_at is null), 0),
    -- ★ active_subscribers: users.membership_tier 가 단일 진실 원천 ★
    'active_subscribers', (
      select count(*) from public.users as u
      where u.membership_tier in ('individual','business')
    ),
    -- 플랜별: users.membership_tier
    'free_users', (select count(*) from public.users as u where coalesce(u.membership_tier,'free')='free'),
    'personal_users', (select count(*) from public.users as u where u.membership_tier='individual'),
    'business_users', (select count(*) from public.users as u where u.membership_tier='business'),
    'total_users', (select count(*) from public.users),
    'pending_subscriptions', (select count(*) from public.subscription_requests as sr
      where sr.status='pending')
  ) into v_result;

  return v_result;
end;
$$;

grant execute on function public.admin_dashboard_stats() to authenticated;

-- ----------------------
-- 2) admin_sync_membership_from_subscriptions — 정합성 reconcile RPC
-- ----------------------
create or replace function public.admin_sync_membership_from_subscriptions(p_dry_run boolean default false)
returns table(
  downgraded_count integer,
  upgraded_count integer,
  total_scanned integer,
  details jsonb
)
language plpgsql security definer set search_path = public
as $$
declare
  v_u record;
  v_active_sub_exists boolean;
  v_active_sub_plan text;
  v_scanned int := 0;
  v_down int := 0;
  v_up int := 0;
  v_details jsonb := '[]'::jsonb;
begin
  begin
    if not public._internal_is_admin_caller() then raise exception 'admin only'; end if;
  exception when undefined_function then
    if not exists (select 1 from public.users as u where u.id = auth.uid() and u.role='admin') then
      raise exception 'admin only';
    end if;
  end;

  -- 모든 user 를 순회하면서 active subscription 존재 여부로 tier 정합성 보정.
  -- 같은 user 에 active 와 canceled 가 동시 존재할 수 있음 → active 우선.
  for v_u in
    select u.id, u.membership_tier, u.subscription_type
    from public.users as u
  loop
    v_scanned := v_scanned + 1;

    -- active subscription 존재 여부 + plan_type 조회
    select
      exists (
        select 1 from public.subscriptions as s
        where s.user_id = v_u.id and s.status = 'active'
      )
      into v_active_sub_exists;

    if v_active_sub_exists then
      select s.plan_type into v_active_sub_plan
      from public.subscriptions as s
      where s.user_id = v_u.id and s.status = 'active'
      order by s.last_paid_at desc nulls last, s.created_at desc
      limit 1;
    else
      v_active_sub_plan := null;
    end if;

    -- 케이스 A) active sub 없는데 tier 가 free 아님 → free 로 downgrade
    if not v_active_sub_exists and v_u.membership_tier <> 'free' then
      v_down := v_down + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_u.id, 'action', 'downgrade',
        'from_tier', v_u.membership_tier, 'to_tier', 'free'
      );
      if not p_dry_run then
        update public.users as u
        set membership_tier = 'free', subscription_type = 'free'
        where u.id = v_u.id;
      end if;
    -- 케이스 B) active sub 있는데 tier 가 그 plan 과 불일치 → tier 보정
    elsif v_active_sub_exists and v_active_sub_plan in ('individual','business')
          and v_u.membership_tier <> v_active_sub_plan then
      v_up := v_up + 1;
      v_details := v_details || jsonb_build_object(
        'user_id', v_u.id, 'action', 'sync_to_active',
        'from_tier', v_u.membership_tier, 'to_tier', v_active_sub_plan
      );
      if not p_dry_run then
        update public.users as u
        set membership_tier = v_active_sub_plan, subscription_type = v_active_sub_plan
        where u.id = v_u.id;
      end if;
    end if;
  end loop;

  return query select v_down, v_up, v_scanned, v_details;
end;
$$;

grant execute on function public.admin_sync_membership_from_subscriptions(boolean) to authenticated;

-- ----------------------
-- 3) 적용 시점 한 번에 자동 정합성 보정 (dry_run=false)
--    ⚠️ 운영 적용 직후 1회 자동 실행 — 이미 해지된 회원의 tier=free 강제 회수.
--    동시에 active 인 회원은 그대로 유지.
-- ----------------------
do $$
declare
  v_down int := 0;
  v_up int := 0;
  v_scanned int := 0;
begin
  -- public._internal_is_admin_caller() bypass 를 위해 직접 실행 (현재 session_user='postgres')
  -- 정상 운영 적용 컨텍스트면 session_user='postgres' 또는 'supabase_admin'
  -- → _internal_is_admin_caller() 통과.
  begin
    select downgraded_count, upgraded_count, total_scanned
      into v_down, v_up, v_scanned
    from public.admin_sync_membership_from_subscriptions(p_dry_run := false);
    raise notice '== 0045 자동 정합성 보정 — scanned=%, downgraded=%, upgraded=% ==',
      v_scanned, v_down, v_up;
  exception when others then
    -- admin 검증 실패 등 — 자동 실행 못해도 migration 자체는 통과
    raise notice '== 0045 자동 정합성 보정 skip (admin context 아님): % ==', sqlerrm;
  end;
end$$;

-- 확인
select
  'dashboard_uses_tier=' ||
  (case when (select pg_get_functiondef(p.oid) ilike '%active_subscribers%membership_tier in%'
              from pg_proc p join pg_namespace n on n.oid=p.pronamespace
              where n.nspname='public' and p.proname='admin_dashboard_stats')
        then 'OK' else 'MISSING' end) as check_1,
  'sync_rpc=' ||
  (case when exists (select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname='admin_sync_membership_from_subscriptions')
    then 'OK' else 'MISSING' end) as check_2;
