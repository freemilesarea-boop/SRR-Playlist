// supabase/functions/admin-apply-analytics-db/index.ts
//
// 관리자가 한 번 클릭으로 0002_analytics.sql 의 모든 객체(테이블/RLS/RPC) 를 운영 DB
// 에 자동 적용. 운영자는 SQL Editor 나 supabase db push 같은 터미널 명령을 사용할
// 필요가 없음.
//
// 동작:
//   1) 호출자가 admin 인지 검증 (JWT)
//   2) 어떤 객체가 이미 존재하는지 사전 조사
//   3) deno-postgres 직접 연결로 ANALYTICS_SQL 적용 (전부 idempotent)
//   4) 적용 후 객체 존재 여부 재조사 → before/after 비교 결과 반환
//
// 보안:
//   - admin 검증 통과한 경우에만 SQL 실행
//   - 실행되는 SQL 은 ANALYTICS_SQL 상수 1개 — 요청 body 의 SQL 은 절대 실행 안 함
//   - DB 연결문자열 (ANALYTICS_DB_URL) 은 Edge Function 시크릿. 프론트 노출 X
//
// 시크릿 (운영자 1회 등록):
//   supabase secrets set ANALYTICS_DB_URL=postgresql://postgres:PW@host:5432/postgres
//
//   ⚠️ Supabase CLI 는 SUPABASE_ prefix 의 secret 등록을 차단하므로
//      env 이름은 반드시 ANALYTICS_DB_URL (또는 POSTGRES_URL / DATABASE_URL) 사용.

// deno-lint-ignore-file no-explicit-any
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { Client as PgClient } from 'https://deno.land/x/postgres@v0.17.0/mod.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const ANALYTICS_DB_URL =
  Deno.env.get('ANALYTICS_DB_URL') ??
  Deno.env.get('POSTGRES_URL') ??
  Deno.env.get('DATABASE_URL') ??
  '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders },
  });
}

// 0002_analytics.sql 의 정확한 사본. 운영 DB 에 그대로 적용. 모두 idempotent.
// 변경 시 supabase/migrations/0002_analytics.sql 도 동기화해야 함.
const ANALYTICS_SQL = String.raw`
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

alter table public.visitor_events enable row level security;
alter table public.stream_events enable row level security;
alter table public.revenue_events enable row level security;
alter table public.daily_metrics enable row level security;

drop policy if exists "visitor_events_insert_any" on public.visitor_events;
create policy "visitor_events_insert_any" on public.visitor_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "visitor_events_admin_select" on public.visitor_events;
create policy "visitor_events_admin_select" on public.visitor_events
  for select using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

drop policy if exists "stream_events_insert_self" on public.stream_events;
create policy "stream_events_insert_self" on public.stream_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "stream_events_admin_select" on public.stream_events;
create policy "stream_events_admin_select" on public.stream_events
  for select using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

drop policy if exists "revenue_events_admin_all" on public.revenue_events;
create policy "revenue_events_admin_all" on public.revenue_events
  for all using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));

drop policy if exists "daily_metrics_admin_all" on public.daily_metrics;
create policy "daily_metrics_admin_all" on public.daily_metrics
  for all using (exists (select 1 from public.users where id = auth.uid() and role = 'admin'));
`;

// 8 개의 admin_* RPC 본문 — DO 블록으로 한 번에 실행. 각각 CREATE OR REPLACE 라 멱등.
// (Edge Function 안에 RPC 본문을 직접 두는 게 보안적으로 안전 — 입력값 보간 없음)
const ANALYTICS_RPCS_SQL = String.raw`
create or replace function public.admin_dashboard_stats()
returns jsonb language plpgsql security definer set search_path = public as $body$
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
    'today_visitors', (select count(*) from public.visitor_events where created_at >= today_start),
    'today_unique_visitors', (select count(distinct session_id) from public.visitor_events where created_at >= today_start),
    'today_streams', (select count(*) from public.stream_events where created_at >= today_start and event_type = 'milestone_30s'),
    'today_new_users', (select count(*) from public.users where created_at >= today_start),
    'today_revenue', coalesce((select sum(amount) from public.revenue_events where status = 'paid' and paid_at >= today_start), 0),
    'week_revenue', coalesce((select sum(amount) from public.revenue_events where status = 'paid' and paid_at >= week_start), 0),
    'month_revenue', coalesce((select sum(amount) from public.revenue_events where status = 'paid' and paid_at >= month_start), 0),
    'total_revenue', coalesce((select sum(amount) from public.revenue_events where status = 'paid'), 0),
    'active_subscribers', (select count(*) from public.users where subscription_type in ('personal','business')),
    'free_users', (select count(*) from public.users where subscription_type = 'free'),
    'personal_users', (select count(*) from public.users where subscription_type = 'personal'),
    'business_users', (select count(*) from public.users where subscription_type = 'business'),
    'total_users', (select count(*) from public.users),
    'pending_subscriptions', (select count(*) from public.subscription_requests where status = 'pending')
  ) into result;
  return result;
end;
$body$;
grant execute on function public.admin_dashboard_stats() to authenticated;

create or replace function public.admin_daily_series(days int default 7)
returns table(d date, visitors bigint, unique_visitors bigint, streams bigint, revenue bigint)
language plpgsql security definer set search_path = public as $body$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  with day_series as (
    select generate_series((current_date - (days - 1))::date, current_date, interval '1 day')::date as d
  )
  select ds.d,
    coalesce((select count(*) from public.visitor_events ve where ve.created_at::date = ds.d), 0) as visitors,
    coalesce((select count(distinct ve.session_id) from public.visitor_events ve where ve.created_at::date = ds.d), 0) as unique_visitors,
    coalesce((select count(*) from public.stream_events se where se.created_at::date = ds.d and se.event_type = 'milestone_30s'), 0) as streams,
    coalesce((select sum(amount) from public.revenue_events re where re.status = 'paid' and re.paid_at::date = ds.d), 0)::bigint as revenue
  from day_series ds order by ds.d asc;
end;
$body$;
grant execute on function public.admin_daily_series(int) to authenticated;

create or replace function public.admin_top_tracks(limit_n int default 10)
returns table(track_id uuid, title text, artist text, plays bigint, completes bigint, avg_seconds numeric)
language plpgsql security definer set search_path = public as $body$
declare today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select t.id, t.title, t.artist,
    count(*) filter (where se.event_type = 'milestone_30s'),
    count(*) filter (where se.completed = true),
    coalesce(avg(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::numeric
  from public.stream_events se join public.tracks t on t.id = se.track_id
  where se.created_at >= today_start
  group by t.id, t.title, t.artist order by 4 desc limit limit_n;
end;
$body$;
grant execute on function public.admin_top_tracks(int) to authenticated;

create or replace function public.admin_top_playlists(limit_n int default 10)
returns table(playlist_id uuid, title text, category text, plays bigint)
language plpgsql security definer set search_path = public as $body$
declare today_start timestamptz := date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul';
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select p.id, p.title, p.category, count(*) filter (where se.event_type = 'milestone_30s')
  from public.stream_events se join public.playlists p on p.id = se.playlist_id
  where se.created_at >= today_start
  group by p.id, p.title, p.category order by 4 desc limit limit_n;
end;
$body$;
grant execute on function public.admin_top_playlists(int) to authenticated;

create or replace function public.admin_member_list(
  search text default null, plan_filter text default null,
  role_filter text default null, limit_n int default 100
)
returns table(id uuid, email text, nickname text, role text, subscription_type text,
              created_at timestamptz, last_seen_at timestamptz,
              total_streams bigint, total_listened_seconds bigint)
language plpgsql security definer set search_path = public as $body$
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select u.id, au.email::text, u.nickname, u.role, u.subscription_type, u.created_at,
    (select max(ve.created_at) from public.visitor_events ve where ve.user_id = u.id),
    (select count(*) from public.stream_events se where se.user_id = u.id and se.event_type = 'milestone_30s'),
    coalesce((select sum(listened_seconds) from public.stream_events se
      where se.user_id = u.id and se.event_type in ('milestone_30s','complete')), 0)::bigint
  from public.users u left join auth.users au on au.id = u.id
  where (search is null or au.email ilike '%' || search || '%' or u.nickname ilike '%' || search || '%')
    and (plan_filter is null or u.subscription_type = plan_filter)
    and (role_filter is null or u.role = role_filter)
  order by u.created_at desc limit limit_n;
end;
$body$;
grant execute on function public.admin_member_list(text, text, text, int) to authenticated;

create or replace function public.admin_member_detail(target_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $body$
declare result jsonb;
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  select jsonb_build_object(
    'user', jsonb_build_object('id', u.id, 'email', au.email, 'nickname', u.nickname,
      'role', u.role, 'subscription_type', u.subscription_type,
      'business_category', u.business_category, 'created_at', u.created_at),
    'total_streams', (select count(*) from public.stream_events where user_id = target_user_id and event_type = 'milestone_30s'),
    'total_listened_seconds', coalesce((select sum(listened_seconds) from public.stream_events
      where user_id = target_user_id and event_type in ('milestone_30s','complete')), 0),
    'last_seen_at', (select max(created_at) from public.visitor_events where user_id = target_user_id),
    'recent_visits', (select coalesce(jsonb_agg(jsonb_build_object('path', path, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from (select path, created_at from public.visitor_events where user_id = target_user_id order by created_at desc limit 10) v),
    'recent_plays', (select coalesce(jsonb_agg(jsonb_build_object('track_title', t.title, 'playlist_title', p.title,
      'completed', se.completed, 'created_at', se.created_at) order by se.created_at desc), '[]'::jsonb)
      from (select * from public.stream_events where user_id = target_user_id and event_type = 'milestone_30s'
            order by created_at desc limit 10) se
      left join public.tracks t on t.id = se.track_id
      left join public.playlists p on p.id = se.playlist_id),
    'revenue', (select coalesce(jsonb_agg(jsonb_build_object('amount', amount, 'subscription_type', subscription_type,
      'status', status, 'paid_at', paid_at) order by paid_at desc), '[]'::jsonb)
      from public.revenue_events where user_id = target_user_id),
    'subscription_requests', (select coalesce(jsonb_agg(jsonb_build_object(
      'requested_plan', requested_plan, 'status', status, 'created_at', created_at) order by created_at desc), '[]'::jsonb)
      from public.subscription_requests where user_id = target_user_id)
  ) into result from public.users u left join auth.users au on au.id = u.id where u.id = target_user_id;
  return result;
end;
$body$;
grant execute on function public.admin_member_detail(uuid) to authenticated;

create or replace function public.admin_track_analytics(days int default 30)
returns table(track_id uuid, title text, artist text, plays bigint, completes bigint,
              avg_seconds numeric, last_played_at timestamptz)
language plpgsql security definer set search_path = public as $body$
declare since timestamptz := now() - (days || ' days')::interval;
begin
  if not exists (select 1 from public.users where id = auth.uid() and role = 'admin') then
    raise exception 'admin only';
  end if;
  return query
  select t.id, t.title, t.artist,
    count(*) filter (where se.event_type = 'milestone_30s'),
    count(*) filter (where se.completed = true),
    coalesce(avg(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::numeric,
    max(se.created_at)
  from public.tracks t
  left join public.stream_events se on se.track_id = t.id and se.created_at >= since
  group by t.id, t.title, t.artist order by 4 desc nulls last limit 200;
end;
$body$;
grant execute on function public.admin_track_analytics(int) to authenticated;

create or replace function public.admin_revenue_summary()
returns jsonb language plpgsql security definer set search_path = public as $body$
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
    'today', coalesce((select sum(amount) from public.revenue_events where status='paid' and paid_at >= today_start), 0),
    'week', coalesce((select sum(amount) from public.revenue_events where status='paid' and paid_at >= week_start), 0),
    'month', coalesce((select sum(amount) from public.revenue_events where status='paid' and paid_at >= month_start), 0),
    'total', coalesce((select sum(amount) from public.revenue_events where status='paid'), 0),
    'by_plan', coalesce((select jsonb_object_agg(subscription_type, amount_sum) from
      (select subscription_type, sum(amount) as amount_sum from public.revenue_events where status='paid' group by subscription_type) bp), '{}'::jsonb),
    'by_status', coalesce((select jsonb_object_agg(status, amount_sum) from
      (select status, sum(amount) as amount_sum from public.revenue_events group by status) bs), '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('id', re.id, 'email', au.email, 'nickname', u.nickname,
      'subscription_type', re.subscription_type, 'amount', re.amount, 'status', re.status,
      'payment_provider', re.payment_provider, 'note', re.note, 'paid_at', re.paid_at) order by re.paid_at desc)
      from (select * from public.revenue_events order by paid_at desc limit 50) re
      left join public.users u on u.id = re.user_id
      left join auth.users au on au.id = re.user_id), '[]'::jsonb)
  ) into result;
  return result;
end;
$body$;
grant execute on function public.admin_revenue_summary() to authenticated;

create or replace function public.admin_compute_daily_metrics(target_date date default current_date)
returns daily_metrics language plpgsql security definer set search_path = public as $body$
declare
  d_start timestamptz := (target_date::text || ' 00:00:00+09')::timestamptz;
  d_end timestamptz := d_start + interval '1 day';
  week_start timestamptz := date_trunc('week', target_date)::timestamptz;
  month_start timestamptz := date_trunc('month', target_date)::timestamptz;
  v_visitors int; v_unique int; v_streams int; v_listened bigint;
  v_new_users int; v_active int; v_daily int; v_weekly int; v_monthly int;
  result daily_metrics;
  caller_role text := coalesce(current_setting('request.jwt.claim.role', true), '');
begin
  if caller_role <> 'service_role' and not exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  ) then
    raise exception 'admin only';
  end if;
  select count(*)::int, count(distinct session_id)::int into v_visitors, v_unique
    from public.visitor_events where created_at >= d_start and created_at < d_end;
  select count(*)::int, coalesce(sum(listened_seconds), 0)::bigint into v_streams, v_listened
    from public.stream_events where created_at >= d_start and created_at < d_end and event_type = 'milestone_30s';
  select count(*)::int into v_new_users from public.users where created_at >= d_start and created_at < d_end;
  select count(*)::int into v_active from public.users where subscription_type in ('personal','business');
  select coalesce(sum(amount), 0)::int into v_daily from public.revenue_events
    where status='paid' and paid_at >= d_start and paid_at < d_end;
  select coalesce(sum(amount), 0)::int into v_weekly from public.revenue_events
    where status='paid' and paid_at >= week_start and paid_at < d_end;
  select coalesce(sum(amount), 0)::int into v_monthly from public.revenue_events
    where status='paid' and paid_at >= month_start and paid_at < d_end;
  insert into public.daily_metrics(metric_date, visitors, unique_visitors, streams, total_listened_seconds,
    new_users, active_subscribers, daily_revenue, weekly_revenue, monthly_revenue, updated_at)
  values (target_date, v_visitors, v_unique, v_streams, v_listened, v_new_users, v_active,
    v_daily, v_weekly, v_monthly, now())
  on conflict (metric_date) do update set
    visitors = excluded.visitors, unique_visitors = excluded.unique_visitors,
    streams = excluded.streams, total_listened_seconds = excluded.total_listened_seconds,
    new_users = excluded.new_users, active_subscribers = excluded.active_subscribers,
    daily_revenue = excluded.daily_revenue, weekly_revenue = excluded.weekly_revenue,
    monthly_revenue = excluded.monthly_revenue, updated_at = now()
  returning * into result;
  return result;
end;
$body$;
grant execute on function public.admin_compute_daily_metrics(date) to authenticated;
`;

const TABLE_NAMES = ['visitor_events', 'stream_events', 'revenue_events', 'daily_metrics'];
const FN_NAMES = [
  'admin_dashboard_stats',
  'admin_daily_series',
  'admin_top_tracks',
  'admin_top_playlists',
  'admin_member_list',
  'admin_member_detail',
  'admin_track_analytics',
  'admin_revenue_summary',
  'admin_compute_daily_metrics',
];

interface Snapshot {
  tables: string[];
  functions: string[];
}

async function snapshot(pg: PgClient): Promise<Snapshot> {
  const tableRows = await pg.queryObject<{ table_name: string }>(
    `select table_name from information_schema.tables
     where table_schema='public' and table_name = any($1)`,
    [TABLE_NAMES],
  );
  const fnRows = await pg.queryObject<{ proname: string }>(
    `select p.proname from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
     where n.nspname='public' and p.proname = any($1)`,
    [FN_NAMES],
  );
  return {
    tables: tableRows.rows.map((r) => r.table_name),
    functions: fnRows.rows.map((r) => r.proname),
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json({ ok: false, error: 'method not allowed' }, 405);

  if (!SUPABASE_URL || !SERVICE_ROLE) {
    return json(
      { ok: false, error: 'server misconfigured: SUPABASE_URL / SERVICE_ROLE 누락' },
      500,
    );
  }
  if (!ANALYTICS_DB_URL) {
    return json(
      {
        ok: false,
        error: 'server misconfigured: ANALYTICS_DB_URL 시크릿 누락',
        hint: 'supabase secrets set ANALYTICS_DB_URL=postgresql://postgres:PW@host:5432/postgres 후 함수 재배포',
      },
      500,
    );
  }

  // 1) JWT → admin 검증
  const authHeader = req.headers.get('authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ ok: false, error: 'unauthorized' }, 401);

  const sbUser = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userRes, error: userErr } = await sbUser.auth.getUser();
  if (userErr || !userRes?.user) return json({ ok: false, error: 'unauthorized' }, 401);

  const sb = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });
  const { data: me } = await sb
    .from('users')
    .select('role')
    .eq('id', userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== 'admin') return json({ ok: false, error: 'admin only' }, 403);

  // 2) PG 직접 연결 + 적용
  let pg: PgClient | null = null;
  try {
    pg = new PgClient(ANALYTICS_DB_URL);
    await pg.connect();
  } catch (e) {
    return json(
      {
        ok: false,
        error: 'db connection failed',
        details: String(e),
        hint: 'ANALYTICS_DB_URL 형식 확인: postgresql://postgres:PW@host:5432/postgres',
      },
      500,
    );
  }

  try {
    const before = await snapshot(pg);

    // 두 SQL 블록 순차 실행. 각각 다중 statement 라 transaction 으로 묶음.
    await pg.queryArray('begin');
    try {
      await pg.queryArray(ANALYTICS_SQL);
      await pg.queryArray(ANALYTICS_RPCS_SQL);
      await pg.queryArray('commit');
    } catch (e) {
      try {
        await pg.queryArray('rollback');
      } catch {
        /* noop */
      }
      return json(
        {
          ok: false,
          error: 'sql apply failed',
          details: String(e),
        },
        500,
      );
    }

    const after = await snapshot(pg);

    const createdTables = after.tables.filter((t) => !before.tables.includes(t));
    const createdFunctions = after.functions.filter((f) => !before.functions.includes(f));

    return json({
      ok: true,
      before,
      after,
      created_tables: createdTables,
      created_functions: createdFunctions,
      skipped: {
        tables: before.tables.length,
        functions: before.functions.length,
      },
      message:
        createdTables.length === 0 && createdFunctions.length === 0
          ? '이미 모든 분석 DB 객체가 적용되어 있어요 (모두 OK).'
          : `생성됨: 테이블 ${createdTables.length}개, RPC ${createdFunctions.length}개`,
    });
  } finally {
    try {
      await pg.end();
    } catch {
      /* noop */
    }
  }
});
