-- 0185 — 영업인 본인 대시보드 (매장/매출/수수료 조회). 읽기·집계 중심.
-- 기존 결제/정산(payment_orders/subscriptions/settlement) 로직 미수정. 수수료 자동지급 없음(관리자 확인용 payout 기록만).
-- 영업인 RPC 는 auth.uid() → sales_agents.user_id 로 본인 매장만 노출. 관리자는 기존 admin_sales_agent_* 사용.

-- 수수료 정산 상태 기록 (관리자 확인용; 자동 지급 아님)
create table if not exists public.salesperson_commission_payouts (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.sales_agents(id) on delete cascade,
  period_label text,
  amount bigint not null default 0,
  status text not null default 'paid' check (status in ('pending','paid','canceled')),
  note text,
  confirmed_by uuid, confirmed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists idx_scp_agent on public.salesperson_commission_payouts(agent_id, status);
alter table public.salesperson_commission_payouts enable row level security;
drop policy if exists scp_read on public.salesperson_commission_payouts;
create policy scp_read on public.salesperson_commission_payouts for select using (
  exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin')
  or exists (select 1 from public.sales_agents a where a.id = salesperson_commission_payouts.agent_id and a.user_id = auth.uid()));

-- 영업인 본인 요약
create or replace function public.salesperson_my_summary()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent record; v_rate numeric; v_ms timestamptz; v_me timestamptz;
  v_total bigint; v_month bigint; v_paid_comm bigint;
begin
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  if v_agent.id is null then return jsonb_build_object('is_agent', false); end if;
  v_rate := coalesce(v_agent.commission_rate, 0);
  v_ms := (date_trunc('month', (now() at time zone 'Asia/Seoul'))) at time zone 'Asia/Seoul';
  v_me := v_ms + interval '1 month';
  select coalesce(sum(amount),0) into v_total from public.payment_orders where status='paid' and sales_agent_id = v_agent.id;
  select coalesce(sum(amount),0) into v_month from public.payment_orders where status='paid' and sales_agent_id = v_agent.id
    and coalesce(paid_at, created_at) >= v_ms and coalesce(paid_at, created_at) < v_me;
  select coalesce(sum(amount),0) into v_paid_comm from public.salesperson_commission_payouts where agent_id = v_agent.id and status='paid';
  return jsonb_build_object(
    'is_agent', true, 'agent_id', v_agent.id, 'agent_name', v_agent.name, 'code', v_agent.code, 'commission_rate', v_rate,
    'total_stores', (select count(*) from public.users u where u.sales_agent_id = v_agent.id),
    'active_stores', (select count(*) from public.users u join public.subscriptions s on s.user_id=u.id where u.sales_agent_id=v_agent.id and s.status='active'),
    'play_stores_7d', (select count(distinct u.id) from public.users u join public.track_play_events e on e.user_id=u.id where u.sales_agent_id=v_agent.id and e.created_at > now()-interval '7 days'),
    'play_stores_30d', (select count(distinct u.id) from public.users u join public.track_play_events e on e.user_id=u.id where u.sales_agent_id=v_agent.id and e.created_at > now()-interval '30 days'),
    'total_revenue', v_total, 'month_revenue', v_month,
    'est_total_commission', floor(v_total * v_rate / 100.0)::bigint,
    'month_commission', floor(v_month * v_rate / 100.0)::bigint,
    'paid_commission', v_paid_comm,
    'unsettled_commission', greatest(0, floor(v_total * v_rate / 100.0)::bigint - v_paid_comm));
end; $$;
grant execute on function public.salesperson_my_summary() to authenticated;

-- 영업인 본인 매장 목록
create or replace function public.salesperson_my_stores()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent record; v jsonb;
begin
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  if v_agent.id is null then return '[]'::jsonb; end if;
  select coalesce(jsonb_agg(row_to_json(x) order by x.last_play_at desc nulls last, x.joined_at desc), '[]'::jsonb) into v from (
    select u.id as store_user_id,
      coalesce(bp.store_name, u.nickname, '(매장명 없음)') as store_name,
      coalesce(u.full_name, u.nickname) as owner_name,
      u.created_at as joined_at,
      (select s.status from public.subscriptions s where s.user_id=u.id order by s.created_at desc limit 1) as subscription_status,
      (select po.status from public.payment_orders po where po.user_id=u.id order by coalesce(po.paid_at,po.created_at) desc limit 1) as payment_status,
      (select max(e.created_at) from public.track_play_events e where e.user_id=u.id) as last_play_at,
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at > now()-interval '30 days') as plays_30d,
      (select coalesce(jsonb_agg(distinct pl.title), '[]'::jsonb) from public.track_play_events e join public.playlists pl on pl.id=e.playlist_id
        where e.user_id=u.id and e.created_at > now()-interval '30 days' and pl.title is not null) as recent_playlists,
      (select coalesce(s.current_amount, s.price, 0) from public.subscriptions s where s.user_id=u.id order by s.created_at desc limit 1) as monthly_amount,
      floor(coalesce((select sum(po.amount) from public.payment_orders po where po.user_id=u.id and po.status='paid' and po.sales_agent_id=v_agent.id),0) * coalesce(v_agent.commission_rate,0) / 100.0)::bigint as est_commission
    from public.users u
    left join public.business_profiles bp on bp.user_id = u.id
    where u.sales_agent_id = v_agent.id
  ) x;
  return v;
end; $$;
grant execute on function public.salesperson_my_stores() to authenticated;

-- 매장 상세 (본인 매장 또는 관리자만)
create or replace function public.salesperson_store_detail(p_store_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent record; v_is_admin boolean; v_store record; v_plays_30d int; v_last timestamptz;
begin
  select exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin') into v_is_admin;
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  select u.id, u.sales_agent_id, u.full_name, u.nickname, u.created_at, u.subscription_type, bp.store_name, bp.business_type
    into v_store from public.users u left join public.business_profiles bp on bp.user_id=u.id where u.id = p_store_user_id;
  if v_store.id is null then raise exception 'store not found'; end if;
  if not v_is_admin and (v_agent.id is null or v_store.sales_agent_id is distinct from v_agent.id) then
    raise exception 'forbidden';  -- 다른 영업인 매장 접근 금지
  end if;
  select count(*), max(created_at) into v_plays_30d, v_last from public.track_play_events where user_id=p_store_user_id and created_at > now()-interval '30 days';
  return jsonb_build_object(
    'store_user_id', v_store.id,
    'store_name', coalesce(v_store.store_name, v_store.nickname, '(매장명 없음)'),
    'owner_name', coalesce(v_store.full_name, v_store.nickname),
    'business_type', v_store.business_type, 'joined_at', v_store.created_at, 'subscription_type', v_store.subscription_type,
    'subscriptions', (select coalesce(jsonb_agg(jsonb_build_object('plan_type', s.plan_type, 'status', s.status, 'amount', coalesce(s.current_amount, s.price), 'period_start', s.current_period_start, 'period_end', s.current_period_end, 'canceled_at', s.canceled_at) order by s.created_at desc), '[]'::jsonb) from public.subscriptions s where s.user_id=p_store_user_id),
    'payments', (select coalesce(jsonb_agg(jsonb_build_object('order_no', po.order_no, 'amount', po.amount, 'status', po.status, 'paid_at', po.paid_at, 'refunded_at', po.refunded_at) order by coalesce(po.paid_at,po.created_at) desc), '[]'::jsonb) from public.payment_orders po where po.user_id=p_store_user_id),
    'plays_30d', v_plays_30d, 'last_play_at', v_last,
    'recent_playlists', (select coalesce(jsonb_agg(distinct pl.title), '[]'::jsonb) from public.track_play_events e join public.playlists pl on pl.id=e.playlist_id where e.user_id=p_store_user_id and e.created_at > now()-interval '30 days' and pl.title is not null),
    'at_risk', (v_plays_30d = 0) or exists (select 1 from public.subscriptions s where s.user_id=p_store_user_id and s.status in ('canceled','pending') order by s.created_at desc limit 1),
    'risk_reason', case when v_plays_30d = 0 then '최근 30일 재생 없음' when exists (select 1 from public.subscriptions s where s.user_id=p_store_user_id and s.status='canceled') then '구독 해지' else null end);
end; $$;
grant execute on function public.salesperson_store_detail(uuid) to authenticated;

-- 관리자: 수수료 정산(지급) 기록 (관리자 확인용)
create or replace function public.admin_record_commission_payout(p_agent_id uuid, p_amount bigint, p_period text default null, p_note text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if not exists (select 1 from public.users u where u.id=v_uid and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.salesperson_commission_payouts(agent_id, period_label, amount, status, note, confirmed_by, confirmed_at)
  values (p_agent_id, p_period, p_amount, 'paid', p_note, v_uid, now()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end; $$;
grant execute on function public.admin_record_commission_payout(uuid, bigint, text, text) to authenticated;
