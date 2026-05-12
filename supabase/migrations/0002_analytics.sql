-- ============================================
-- 0002_analytics.sql
-- 관리자 분석 대시보드용 테이블 / RLS / 인덱스 / RPC
-- ============================================

-- ============================================
-- visitor_events — 페이지 방문 로그 (비회원 포함)
-- ============================================
create table if not exists public.visitor_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  session_id text not null,
  path text not null,
  referrer text,
  user_agent text,
  device_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_visitor_events_created_at on public.visitor_events(created_at desc);
create index if not exists idx_visitor_events_user on public.visitor_events(user_id);
create index if not exists idx_visitor_events_session on public.visitor_events(session_id);

-- ============================================
-- stream_events — 곡 재생 로그
-- ============================================
create table if not exists public.stream_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  track_id uuid references public.tracks(id) on delete cascade,
  playlist_id uuid references public.playlists(id) on delete set null,
  session_id text,
  listened_seconds int not null default 0,
  completed boolean not null default false,
  event_type text not null default 'start' check (event_type in ('start','milestone_30s','complete')),
  created_at timestamptz not null default now()
);

create index if not exists idx_stream_events_created_at on public.stream_events(created_at desc);
create index if not exists idx_stream_events_track on public.stream_events(track_id);
create index if not exists idx_stream_events_playlist on public.stream_events(playlist_id);
create index if not exists idx_stream_events_user on public.stream_events(user_id);

-- ============================================
-- revenue_events — 결제/매출 기록
-- ============================================
create table if not exists public.revenue_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  subscription_type text not null check (subscription_type in ('personal','business')),
  amount int not null,
  status text not null default 'paid' check (status in ('paid','refunded','pending','failed')),
  payment_provider text default 'manual',
  note text,
  paid_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_revenue_events_paid_at on public.revenue_events(paid_at desc);
create index if not exists idx_revenue_events_user on public.revenue_events(user_id);
create index if not exists idx_revenue_events_status on public.revenue_events(status);
create index if not exists idx_users_subscription_type on public.users(subscription_type);

-- ============================================
-- daily_metrics — 일 단위 사전 집계
-- ============================================
create table if not exists public.daily_metrics (
  id bigserial primary key,
  metric_date date not null unique,
  visitors int not null default 0,
  unique_visitors int not null default 0,
  streams int not null default 0,
  total_listened_seconds bigint not null default 0,
  new_users int not null default 0,
  active_subscribers int not null default 0,
  daily_revenue int not null default 0,
  weekly_revenue int not null default 0,
  monthly_revenue int not null default 0,
  updated_at timestamptz not null default now()
);

create index if not exists idx_daily_metrics_date on public.daily_metrics(metric_date desc);

-- ============================================
-- RLS
-- ============================================
alter table public.visitor_events enable row level security;
alter table public.stream_events enable row level security;
alter table public.revenue_events enable row level security;
alter table public.daily_metrics enable row level security;

-- visitor_events: 누구나 본인(또는 익명) insert, 관리자 read
drop policy if exists "visitor_events_insert_any" on public.visitor_events;
create policy "visitor_events_insert_any" on public.visitor_events
  for insert with check (
    user_id is null or auth.uid() = user_id
  );

drop policy if exists "visitor_events_admin_select" on public.visitor_events;
create policy "visitor_events_admin_select" on public.visitor_events
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- stream_events: 인증 유저 insert (본인), 관리자 read
drop policy if exists "stream_events_insert_self" on public.stream_events;
create policy "stream_events_insert_self" on public.stream_events
  for insert with check (
    user_id is null or auth.uid() = user_id
  );

drop policy if exists "stream_events_admin_select" on public.stream_events;
create policy "stream_events_admin_select" on public.stream_events
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- revenue_events: 관리자만 read/write
drop policy if exists "revenue_events_admin_all" on public.revenue_events;
create policy "revenue_events_admin_all" on public.revenue_events
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- daily_metrics: 관리자만 read/write
drop policy if exists "daily_metrics_admin_all" on public.daily_metrics;
create policy "daily_metrics_admin_all" on public.daily_metrics
  for all using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- RPCs (관리자 전용 집계)
-- 모두 security definer + 안에서 admin 체크
-- ============================================

-- 1) 대시보드 종합 통계
create or replace function public.admin_dashboard_stats()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'today_visitors',
      (select count(*) from public.visitor_events where created_at >= today_start),
    'today_unique_visitors',
      (select count(distinct session_id) from public.visitor_events where created_at >= today_start),
    'today_streams',
      (select count(*) from public.stream_events
        where created_at >= today_start and event_type = 'milestone_30s'),
    'today_new_users',
      (select count(*) from public.users where created_at >= today_start),
    'today_revenue',
      coalesce((select sum(amount) from public.revenue_events
        where status = 'paid' and paid_at >= today_start), 0),
    'week_revenue',
      coalesce((select sum(amount) from public.revenue_events
        where status = 'paid' and paid_at >= week_start), 0),
    'month_revenue',
      coalesce((select sum(amount) from public.revenue_events
        where status = 'paid' and paid_at >= month_start), 0),
    'total_revenue',
      coalesce((select sum(amount) from public.revenue_events where status = 'paid'), 0),
    'active_subscribers',
      (select count(*) from public.users
        where subscription_type in ('personal','business')),
    'free_users',
      (select count(*) from public.users where subscription_type = 'free'),
    'personal_users',
      (select count(*) from public.users where subscription_type = 'personal'),
    'business_users',
      (select count(*) from public.users where subscription_type = 'business'),
    'total_users',
      (select count(*) from public.users),
    'pending_subscriptions',
      (select count(*) from public.subscription_requests where status = 'pending')
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_dashboard_stats() to authenticated;

-- 2) 최근 7일 일별 시계열
create or replace function public.admin_daily_series(days int default 7)
returns table(
  d date,
  visitors bigint,
  unique_visitors bigint,
  streams bigint,
  revenue bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  with day_series as (
    select generate_series(
      (current_date - (days - 1))::date,
      current_date,
      interval '1 day'
    )::date as d
  )
  select
    ds.d,
    coalesce((select count(*) from public.visitor_events ve
      where ve.created_at::date = ds.d), 0) as visitors,
    coalesce((select count(distinct ve.session_id) from public.visitor_events ve
      where ve.created_at::date = ds.d), 0) as unique_visitors,
    coalesce((select count(*) from public.stream_events se
      where se.created_at::date = ds.d and se.event_type = 'milestone_30s'), 0) as streams,
    coalesce((select sum(amount) from public.revenue_events re
      where re.status = 'paid' and re.paid_at::date = ds.d), 0)::bigint as revenue
  from day_series ds
  order by ds.d asc;
end;
$$;

grant execute on function public.admin_daily_series(int) to authenticated;

-- 3) 오늘의 인기 곡 TOP N
create or replace function public.admin_top_tracks(limit_n int default 10)
returns table(
  track_id uuid,
  title text,
  artist text,
  plays bigint,
  completes bigint,
  avg_seconds numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    t.id as track_id,
    t.title,
    t.artist,
    count(*) filter (where se.event_type = 'milestone_30s') as plays,
    count(*) filter (where se.completed = true) as completes,
    coalesce(avg(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::numeric as avg_seconds
  from public.stream_events se
  join public.tracks t on t.id = se.track_id
  where se.created_at >= today_start
  group by t.id, t.title, t.artist
  order by plays desc
  limit limit_n;
end;
$$;

grant execute on function public.admin_top_tracks(int) to authenticated;

-- 4) 오늘의 인기 플레이리스트 TOP N
create or replace function public.admin_top_playlists(limit_n int default 10)
returns table(
  playlist_id uuid,
  title text,
  category text,
  plays bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    p.id as playlist_id,
    p.title,
    p.category,
    count(*) filter (where se.event_type = 'milestone_30s') as plays
  from public.stream_events se
  join public.playlists p on p.id = se.playlist_id
  where se.created_at >= today_start
  group by p.id, p.title, p.category
  order by plays desc
  limit limit_n;
end;
$$;

grant execute on function public.admin_top_playlists(int) to authenticated;

-- 5) 회원 목록 (이메일 + 통계)
create or replace function public.admin_member_list(
  search text default null,
  plan_filter text default null,
  role_filter text default null,
  limit_n int default 100
)
returns table(
  id uuid,
  email text,
  nickname text,
  role text,
  subscription_type text,
  created_at timestamptz,
  last_seen_at timestamptz,
  total_streams bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    u.id,
    au.email::text,
    u.nickname,
    u.role,
    u.subscription_type,
    u.created_at,
    (select max(ve.created_at) from public.visitor_events ve where ve.user_id = u.id) as last_seen_at,
    (select count(*) from public.stream_events se
      where se.user_id = u.id and se.event_type = 'milestone_30s') as total_streams,
    coalesce((select sum(listened_seconds) from public.stream_events se
      where se.user_id = u.id and se.event_type in ('milestone_30s','complete')), 0)::bigint
      as total_listened_seconds
  from public.users u
  left join auth.users au on au.id = u.id
  where (search is null or au.email ilike '%' || search || '%' or u.nickname ilike '%' || search || '%')
    and (plan_filter is null or u.subscription_type = plan_filter)
    and (role_filter is null or u.role = role_filter)
  order by u.created_at desc
  limit limit_n;
end;
$$;

grant execute on function public.admin_member_list(text, text, text, int) to authenticated;

-- 6) 회원 상세
create or replace function public.admin_member_detail(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'user', jsonb_build_object(
      'id', u.id,
      'email', au.email,
      'nickname', u.nickname,
      'role', u.role,
      'subscription_type', u.subscription_type,
      'business_category', u.business_category,
      'created_at', u.created_at
    ),
    'total_streams', (select count(*) from public.stream_events
      where user_id = target_user_id and event_type = 'milestone_30s'),
    'total_listened_seconds', coalesce((select sum(listened_seconds) from public.stream_events
      where user_id = target_user_id and event_type in ('milestone_30s','complete')), 0),
    'last_seen_at', (select max(created_at) from public.visitor_events where user_id = target_user_id),
    'recent_visits', (
      select coalesce(jsonb_agg(jsonb_build_object('path', path, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (
        select path, created_at from public.visitor_events
        where user_id = target_user_id order by created_at desc limit 10
      ) v
    ),
    'recent_plays', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'track_title', t.title,
        'playlist_title', p.title,
        'completed', se.completed,
        'created_at', se.created_at
      ) order by se.created_at desc), '[]'::jsonb)
      from (
        select * from public.stream_events
        where user_id = target_user_id and event_type = 'milestone_30s'
        order by created_at desc limit 10
      ) se
      left join public.tracks t on t.id = se.track_id
      left join public.playlists p on p.id = se.playlist_id
    ),
    'revenue', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'amount', amount, 'subscription_type', subscription_type,
        'status', status, 'paid_at', paid_at
      ) order by paid_at desc), '[]'::jsonb)
      from public.revenue_events where user_id = target_user_id
    ),
    'subscription_requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'requested_plan', requested_plan, 'status', status, 'created_at', created_at
      ) order by created_at desc), '[]'::jsonb)
      from public.subscription_requests where user_id = target_user_id
    )
  )
  into result
  from public.users u
  left join auth.users au on au.id = u.id
  where u.id = target_user_id;

  return result;
end;
$$;

grant execute on function public.admin_member_detail(uuid) to authenticated;

-- 7) 스트리밍 트랙별 집계 (지정 기간)
create or replace function public.admin_track_analytics(days int default 30)
returns table(
  track_id uuid,
  title text,
  artist text,
  plays bigint,
  completes bigint,
  avg_seconds numeric,
  last_played_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := now() - (days || ' days')::interval;
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  return query
  select
    t.id as track_id,
    t.title,
    t.artist,
    count(*) filter (where se.event_type = 'milestone_30s') as plays,
    count(*) filter (where se.completed = true) as completes,
    coalesce(avg(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::numeric as avg_seconds,
    max(se.created_at) as last_played_at
  from public.tracks t
  left join public.stream_events se on se.track_id = t.id and se.created_at >= since
  group by t.id, t.title, t.artist
  order by plays desc nulls last
  limit 200;
end;
$$;

grant execute on function public.admin_track_analytics(int) to authenticated;

-- 8) 매출 시계열 + 플랜별 합계
create or replace function public.admin_revenue_summary()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  result jsonb;
  today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  week_start timestamptz := date_trunc('week', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
  month_start timestamptz := date_trunc('month', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;

  select jsonb_build_object(
    'today', coalesce((select sum(amount) from public.revenue_events
      where status='paid' and paid_at >= today_start), 0),
    'week', coalesce((select sum(amount) from public.revenue_events
      where status='paid' and paid_at >= week_start), 0),
    'month', coalesce((select sum(amount) from public.revenue_events
      where status='paid' and paid_at >= month_start), 0),
    'total', coalesce((select sum(amount) from public.revenue_events where status='paid'), 0),
    'by_plan', coalesce((
      select jsonb_object_agg(subscription_type, amount_sum) from (
        select subscription_type, sum(amount) as amount_sum
        from public.revenue_events
        where status='paid'
        group by subscription_type
      ) bp
    ), '{}'::jsonb),
    'by_status', coalesce((
      select jsonb_object_agg(status, amount_sum) from (
        select status, sum(amount) as amount_sum
        from public.revenue_events
        group by status
      ) bs
    ), '{}'::jsonb),
    'recent', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', re.id,
        'email', au.email,
        'nickname', u.nickname,
        'subscription_type', re.subscription_type,
        'amount', re.amount,
        'status', re.status,
        'payment_provider', re.payment_provider,
        'note', re.note,
        'paid_at', re.paid_at
      ) order by re.paid_at desc)
      from (select * from public.revenue_events order by paid_at desc limit 50) re
      left join public.users u on u.id = re.user_id
      left join auth.users au on au.id = re.user_id
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

grant execute on function public.admin_revenue_summary() to authenticated;

-- 9) 일 단위 집계 (오늘 / 어제 / 지정 일자) — daily_metrics 에 upsert
create or replace function public.admin_compute_daily_metrics(target_date date default current_date)
returns daily_metrics
language plpgsql
security definer
set search_path = public
as $$
declare
  d_start timestamptz := (target_date::text || ' 00:00:00+09')::timestamptz;
  d_end timestamptz := d_start + interval '1 day';
  week_start timestamptz := date_trunc('week', target_date)::timestamptz;
  month_start timestamptz := date_trunc('month', target_date)::timestamptz;
  v_visitors int;
  v_unique int;
  v_streams int;
  v_listened bigint;
  v_new_users int;
  v_active int;
  v_daily int;
  v_weekly int;
  v_monthly int;
  result daily_metrics;
  caller_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  -- admin 또는 service_role 만 허용 (cron 에서도 호출 가능하도록)
  if caller_role <> 'service_role' and not exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'admin only';
  end if;

  select count(*)::int, count(distinct session_id)::int
    into v_visitors, v_unique
    from public.visitor_events
    where created_at >= d_start and created_at < d_end;

  select count(*)::int, coalesce(sum(listened_seconds), 0)::bigint
    into v_streams, v_listened
    from public.stream_events
    where created_at >= d_start and created_at < d_end
      and event_type = 'milestone_30s';

  select count(*)::int into v_new_users
    from public.users
    where created_at >= d_start and created_at < d_end;

  select count(*)::int into v_active
    from public.users
    where subscription_type in ('personal','business');

  select coalesce(sum(amount), 0)::int into v_daily
    from public.revenue_events
    where status='paid' and paid_at >= d_start and paid_at < d_end;

  select coalesce(sum(amount), 0)::int into v_weekly
    from public.revenue_events
    where status='paid' and paid_at >= week_start and paid_at < d_end;

  select coalesce(sum(amount), 0)::int into v_monthly
    from public.revenue_events
    where status='paid' and paid_at >= month_start and paid_at < d_end;

  insert into public.daily_metrics(
    metric_date, visitors, unique_visitors, streams, total_listened_seconds,
    new_users, active_subscribers, daily_revenue, weekly_revenue, monthly_revenue, updated_at
  ) values (
    target_date, v_visitors, v_unique, v_streams, v_listened,
    v_new_users, v_active, v_daily, v_weekly, v_monthly, now()
  )
  on conflict (metric_date) do update set
    visitors = excluded.visitors,
    unique_visitors = excluded.unique_visitors,
    streams = excluded.streams,
    total_listened_seconds = excluded.total_listened_seconds,
    new_users = excluded.new_users,
    active_subscribers = excluded.active_subscribers,
    daily_revenue = excluded.daily_revenue,
    weekly_revenue = excluded.weekly_revenue,
    monthly_revenue = excluded.monthly_revenue,
    updated_at = now()
  returning * into result;

  return result;
end;
$$;

grant execute on function public.admin_compute_daily_metrics(date) to authenticated;
