-- 0187 — 영업인 대시보드 리디자인 지원: 매장 위험계산용 필드 + 추이(차트) RPC. 읽기·집계 전용.
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
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at > now()-interval '14 days') as plays_14d,
      (select count(*) from public.track_play_events e where e.user_id=u.id and e.created_at <= now()-interval '14 days' and e.created_at > now()-interval '28 days') as plays_prev_14d,
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

-- 추이(차트) — 일별 재생(30일), 월별 매출/수수료/매장(6개월)
create or replace function public.salesperson_my_trends()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_agent record; v_rate numeric; v_daily jsonb; v_monthly jsonb;
begin
  select * into v_agent from public.sales_agents where user_id = auth.uid() and is_active limit 1;
  if v_agent.id is null then return jsonb_build_object('daily_plays', '[]'::jsonb, 'monthly', '[]'::jsonb); end if;
  v_rate := coalesce(v_agent.commission_rate, 0);

  select coalesce(jsonb_agg(jsonb_build_object('d', to_char(gd, 'MM-DD'), 'n', coalesce(c.n, 0)) order by gd), '[]'::jsonb) into v_daily
  from generate_series((now() at time zone 'Asia/Seoul')::date - 29, (now() at time zone 'Asia/Seoul')::date, interval '1 day') gd
  left join (
    select (e.created_at at time zone 'Asia/Seoul')::date dd, count(*) n
    from public.track_play_events e join public.users u on u.id = e.user_id
    where u.sales_agent_id = v_agent.id and e.created_at > now() - interval '31 days'
    group by 1
  ) c on c.dd = gd::date;

  select coalesce(jsonb_agg(jsonb_build_object(
      'm', to_char(gm, 'YY-MM'),
      'revenue', coalesce(rev.amt, 0),
      'commission', floor(coalesce(rev.amt, 0) * v_rate / 100.0)::bigint,
      'new_stores', coalesce(ns.n, 0),
      'cumulative_stores', (select count(*) from public.users u2 where u2.sales_agent_id = v_agent.id and u2.created_at < gm + interval '1 month')
    ) order by gm), '[]'::jsonb) into v_monthly
  from generate_series(date_trunc('month', (now() at time zone 'Asia/Seoul')) - interval '5 months', date_trunc('month', (now() at time zone 'Asia/Seoul')), interval '1 month') gm
  left join (
    select date_trunc('month', (coalesce(po.paid_at, po.created_at) at time zone 'Asia/Seoul')) mm, sum(po.amount) amt
    from public.payment_orders po where po.sales_agent_id = v_agent.id and po.status = 'paid'
    group by 1
  ) rev on rev.mm = gm
  left join (
    select date_trunc('month', (u.created_at at time zone 'Asia/Seoul')) mm, count(*) n
    from public.users u where u.sales_agent_id = v_agent.id
    group by 1
  ) ns on ns.mm = gm;

  return jsonb_build_object('daily_plays', v_daily, 'monthly', v_monthly);
end; $$;
grant execute on function public.salesperson_my_trends() to authenticated;
