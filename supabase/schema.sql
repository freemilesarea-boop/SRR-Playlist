-- ============================================
-- 스르륵 플리 DB 스키마
-- Supabase 프로젝트에서 SQL Editor로 실행
-- ============================================

-- ============================================
-- users (auth.users를 확장)
-- ============================================
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  role text not null default 'user' check (role in ('user', 'admin')),
  subscription_type text not null default 'free' check (subscription_type in ('free', 'personal', 'business')),
  business_category text,
  created_at timestamptz not null default now()
);

-- ============================================
-- tracks
-- ============================================
create table if not exists public.tracks (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  artist text,
  genre text,
  mood text,
  audio_url text not null,
  cover_url text,
  duration int,
  created_at timestamptz not null default now()
);

-- ============================================
-- playlists
-- ============================================
create table if not exists public.playlists (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  category text not null,
  business_category text,
  thumbnail_url text,
  description text,
  is_business_only boolean not null default false,
  time_slot text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

-- ============================================
-- playlist_tracks
-- ============================================
create table if not exists public.playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  order_index int not null default 0,
  unique(playlist_id, track_id)
);

create index if not exists idx_playlist_tracks_playlist on public.playlist_tracks(playlist_id, order_index);

-- ============================================
-- likes
-- ============================================
create table if not exists public.likes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, playlist_id)
);

create index if not exists idx_likes_user on public.likes(user_id);

-- ============================================
-- recent_plays
-- ============================================
create table if not exists public.recent_plays (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  played_at timestamptz not null default now()
);

create index if not exists idx_recent_plays_user on public.recent_plays(user_id, played_at desc);

-- ============================================
-- auto-create users row when auth user signs up
-- ============================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, nickname)
  values (new.id, coalesce(new.raw_user_meta_data->>'nickname', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================
-- Row Level Security
-- ============================================
alter table public.users enable row level security;
alter table public.tracks enable row level security;
alter table public.playlists enable row level security;
alter table public.playlist_tracks enable row level security;
alter table public.likes enable row level security;
alter table public.recent_plays enable row level security;

-- users: 본인만 select/update, 관리자는 전체
drop policy if exists "users_select_self" on public.users;
create policy "users_select_self" on public.users for select using (auth.uid() = id);

drop policy if exists "users_update_self" on public.users;
create policy "users_update_self" on public.users for update using (auth.uid() = id);

-- tracks: 로그인 사용자 read, admin write
drop policy if exists "tracks_read_all" on public.tracks;
create policy "tracks_read_all" on public.tracks for select using (true);

drop policy if exists "tracks_admin_write" on public.tracks;
create policy "tracks_admin_write" on public.tracks for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- playlists: read all, admin write
drop policy if exists "playlists_read_all" on public.playlists;
create policy "playlists_read_all" on public.playlists for select using (true);

drop policy if exists "playlists_admin_write" on public.playlists;
create policy "playlists_admin_write" on public.playlists for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- playlist_tracks: read all, admin write
drop policy if exists "playlist_tracks_read_all" on public.playlist_tracks;
create policy "playlist_tracks_read_all" on public.playlist_tracks for select using (true);

drop policy if exists "playlist_tracks_admin_write" on public.playlist_tracks;
create policy "playlist_tracks_admin_write" on public.playlist_tracks for all using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- likes: 본인 데이터만
drop policy if exists "likes_select_self" on public.likes;
create policy "likes_select_self" on public.likes for select using (auth.uid() = user_id);

drop policy if exists "likes_insert_self" on public.likes;
create policy "likes_insert_self" on public.likes for insert with check (auth.uid() = user_id);

drop policy if exists "likes_delete_self" on public.likes;
create policy "likes_delete_self" on public.likes for delete using (auth.uid() = user_id);

-- recent_plays: 본인 데이터만
drop policy if exists "recent_plays_select_self" on public.recent_plays;
create policy "recent_plays_select_self" on public.recent_plays for select using (auth.uid() = user_id);

drop policy if exists "recent_plays_insert_self" on public.recent_plays;
create policy "recent_plays_insert_self" on public.recent_plays for insert with check (auth.uid() = user_id);

-- ============================================
-- Subscription requests (PayApp 연동 전 단계의 신청 큐)
-- ============================================
create table if not exists public.subscription_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  requested_plan text not null check (requested_plan in ('personal', 'business')),
  status text not null default 'pending' check (status in ('pending', 'contacted', 'approved', 'rejected', 'cancelled')),
  note text,
  created_at timestamptz not null default now()
);

create index if not exists idx_sub_req_user on public.subscription_requests(user_id, created_at desc);

alter table public.subscription_requests enable row level security;

drop policy if exists "sub_req_select_self_or_admin" on public.subscription_requests;
create policy "sub_req_select_self_or_admin" on public.subscription_requests for select using (
  auth.uid() = user_id
  or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

drop policy if exists "sub_req_insert_self" on public.subscription_requests;
create policy "sub_req_insert_self" on public.subscription_requests for insert with check (auth.uid() = user_id);

drop policy if exists "sub_req_admin_update" on public.subscription_requests;
create policy "sub_req_admin_update" on public.subscription_requests for update using (
  exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

-- 관리자 페이지에서 신청자의 이메일/닉네임을 함께 조회하기 위한 RPC
-- (auth.users는 직접 read 불가하므로 security definer 함수로 우회)
create or replace function public.list_subscription_requests()
returns table (
  id uuid,
  user_id uuid,
  email text,
  nickname text,
  requested_plan text,
  status text,
  note text,
  created_at timestamptz
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
    sr.id,
    sr.user_id,
    au.email::text,
    pu.nickname,
    sr.requested_plan,
    sr.status,
    sr.note,
    sr.created_at
  from public.subscription_requests sr
  left join auth.users au on au.id = sr.user_id
  left join public.users pu on pu.id = sr.user_id
  order by sr.created_at desc;
end;
$$;

grant execute on function public.list_subscription_requests() to authenticated;

-- ============================================
-- Storage buckets + 정책
-- (대시보드에서 audio, covers 두 버킷을 Public 으로 만든 뒤 아래 정책을 적용)
-- ============================================

-- public read (둘 다 익명 read 가능)
drop policy if exists "audio_public_read" on storage.objects;
create policy "audio_public_read" on storage.objects for select using (bucket_id = 'audio');

drop policy if exists "covers_public_read" on storage.objects;
create policy "covers_public_read" on storage.objects for select using (bucket_id = 'covers');

-- 인증 사용자만 업로드 (관리자 페이지에서 업로드)
drop policy if exists "audio_authed_write" on storage.objects;
create policy "audio_authed_write" on storage.objects for insert with check (
  bucket_id = 'audio' and auth.role() = 'authenticated'
);

drop policy if exists "covers_authed_write" on storage.objects;
create policy "covers_authed_write" on storage.objects for insert with check (
  bucket_id = 'covers' and auth.role() = 'authenticated'
);

-- 관리자만 삭제
drop policy if exists "audio_admin_delete" on storage.objects;
create policy "audio_admin_delete" on storage.objects for delete using (
  bucket_id = 'audio'
  and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);

drop policy if exists "covers_admin_delete" on storage.objects;
create policy "covers_admin_delete" on storage.objects for delete using (
  bucket_id = 'covers'
  and exists (select 1 from public.users where id = auth.uid() and role = 'admin')
);
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
-- ============================================
-- 0003_charts.sql
-- 차트(일간/주간/월간/Top100/장르별) RPC
-- 일반 사용자도 호출 가능 (집계만 반환, 개인정보 없음)
-- ============================================

-- 기간 → 시작 시각 변환 헬퍼
create or replace function public._chart_period_start(period text)
returns timestamptz
language plpgsql
immutable
as $$
declare
  kst_now timestamptz := now() at time zone 'Asia/Seoul';
begin
  case lower(period)
    when 'daily'   then return (date_trunc('day',   kst_now) at time zone 'Asia/Seoul');
    when 'weekly'  then return (now() - interval '7 days');
    when 'monthly' then return (now() - interval '30 days');
    when 'all'     then return timestamp '1970-01-01';
    else                return (date_trunc('day', kst_now) at time zone 'Asia/Seoul');
  end case;
end;
$$;

-- ============================================
-- 1) 트랙 차트 — 기간/Top N
-- ============================================
create or replace function public.get_track_chart(
  period text default 'daily',
  limit_count int default 100
)
returns table(
  rank bigint,
  track_id uuid,
  title text,
  artist text,
  genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  play_count bigint,
  completed_count bigint,
  total_listened_seconds bigint,
  playlist_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
begin
  return query
  with agg as (
    select
      se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since
      and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select
    row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id as track_id,
    t.title,
    t.artist,
    t.genre,
    t.mood,
    t.cover_url,
    t.audio_url,
    t.duration,
    coalesce(a.plays, 0) as play_count,
    coalesce(a.completes, 0) as completed_count,
    coalesce(a.listened, 0) as total_listened_seconds,
    (select count(*) from public.playlist_tracks pt where pt.track_id = t.id) as playlist_count
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
  order by play_count desc, t.created_at desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.get_track_chart(text, int) to anon, authenticated;

-- ============================================
-- 2) 장르 차트 — 장르별 총 재생수
-- ============================================
create or replace function public.get_genre_chart(
  period text default 'weekly'
)
returns table(
  genre text,
  play_count bigint,
  track_count bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
begin
  return query
  with se_agg as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened,
      count(distinct t.id) as tracks
    from public.tracks t
    left join public.stream_events se
      on se.track_id = t.id
     and se.created_at >= since
     and se.event_type in ('milestone_30s','complete')
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select g, plays, tracks, listened
  from se_agg
  where tracks > 0
  order by plays desc, g asc;
end;
$$;

grant execute on function public.get_genre_chart(text) to anon, authenticated;

-- ============================================
-- 3) 장르별 트랙 차트
-- ============================================
create or replace function public.get_track_chart_by_genre(
  genre_filter text,
  period text default 'weekly',
  limit_count int default 50
)
returns table(
  rank bigint,
  track_id uuid,
  title text,
  artist text,
  genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  play_count bigint,
  completed_count bigint,
  total_listened_seconds bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  since timestamptz := public._chart_period_start(period);
  g_filter text := nullif(trim(genre_filter), '');
begin
  return query
  with agg as (
    select
      se.track_id,
      count(*) filter (where se.event_type = 'milestone_30s') as plays,
      count(*) filter (where se.completed = true) as completes,
      coalesce(sum(se.listened_seconds) filter (where se.event_type in ('milestone_30s','complete')), 0)::bigint as listened
    from public.stream_events se
    where se.created_at >= since
      and se.event_type in ('milestone_30s','complete')
    group by se.track_id
  )
  select
    row_number() over (order by coalesce(a.plays, 0) desc, t.created_at desc) as rank,
    t.id, t.title, t.artist, t.genre, t.mood, t.cover_url, t.audio_url, t.duration,
    coalesce(a.plays, 0),
    coalesce(a.completes, 0),
    coalesce(a.listened, 0)
  from public.tracks t
  left join agg a on a.track_id = t.id
  where coalesce(a.plays, 0) > 0
    and (
      (g_filter = '기타' and (t.genre is null or trim(t.genre) = ''))
      or (g_filter is not null and t.genre = g_filter)
      or g_filter is null
    )
  order by coalesce(a.plays, 0) desc, t.created_at desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.get_track_chart_by_genre(text, text, int) to anon, authenticated;

-- ============================================
-- 4) 사용 가능한 장르 목록 (재생 많은 순)
-- ============================================
create or replace function public.list_genres()
returns table(
  genre text,
  track_count bigint,
  play_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with all_genres as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) as tc
    from public.tracks t
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  ),
  plays as (
    select
      coalesce(nullif(trim(t.genre), ''), '기타') as g,
      count(*) as pc
    from public.tracks t
    join public.stream_events se on se.track_id = t.id
    where se.event_type = 'milestone_30s'
    group by coalesce(nullif(trim(t.genre), ''), '기타')
  )
  select ag.g, ag.tc, coalesce(p.pc, 0)
  from all_genres ag
  left join plays p on p.g = ag.g
  order by coalesce(p.pc, 0) desc, ag.g asc;
end;
$$;

grant execute on function public.list_genres() to anon, authenticated;
-- ============================================
-- 0004_search.sql
-- 통합 검색 RPC + 검색 로그 테이블
-- 공개 RPC (anon/authenticated 모두 호출 가능, 개인정보 없음)
-- ============================================

-- ============================================
-- search_events (검색 로그, 선택적 사용)
-- ============================================
create table if not exists public.search_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  query text not null,
  result_count int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists idx_search_events_created_at on public.search_events(created_at desc);
create index if not exists idx_search_events_query on public.search_events(lower(query));

alter table public.search_events enable row level security;

drop policy if exists "search_events_insert_any" on public.search_events;
create policy "search_events_insert_any" on public.search_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "search_events_admin_select" on public.search_events;
create policy "search_events_admin_select" on public.search_events
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- 검색용 인덱스 (ILIKE 가속을 위한 lower() 인덱스)
-- pg_trgm 은 운영 권한에 따라 다를 수 있어 표준 인덱스 우선 사용
-- ============================================
create index if not exists idx_tracks_lower_title on public.tracks(lower(title));
create index if not exists idx_tracks_lower_artist on public.tracks(lower(artist));
create index if not exists idx_playlists_lower_title on public.playlists(lower(title));
create index if not exists idx_playlists_lower_category on public.playlists(lower(category));

-- ============================================
-- search_catalog — 통합 검색
-- ============================================
create or replace function public.search_catalog(
  search_query text,
  limit_count int default 20
)
returns table(
  result_type text,
  id uuid,
  title text,
  subtitle text,
  image_url text,
  audio_url text,
  genre text,
  mood text,
  category text,
  rank_score numeric,
  play_count bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  q text := lower(trim(coalesce(search_query, '')));
  qpat text := '%' || q || '%';
begin
  if q = '' or length(q) < 1 then
    return;
  end if;

  return query
  with
  -- 트랙
  tr as (
    select
      'track'::text as result_type,
      t.id,
      t.title,
      t.artist as subtitle,
      t.cover_url as image_url,
      t.audio_url,
      t.genre,
      t.mood,
      null::text as category,
      (
        case when lower(t.title)  = q then 100
             when lower(t.title)  ilike q || '%' then 80
             when lower(t.title)  ilike qpat then 60
             when lower(coalesce(t.artist,''))   ilike qpat then 50
             when lower(coalesce(t.genre,''))    ilike qpat then 30
             when lower(coalesce(t.mood,''))     ilike qpat then 30
             else 10 end
      )::numeric as rank_score,
      coalesce((
        select count(*) from public.stream_events se
        where se.track_id = t.id and se.event_type = 'milestone_30s'
      ), 0)::bigint as play_count
    from public.tracks t
    where lower(t.title)               ilike qpat
       or lower(coalesce(t.artist,''))  ilike qpat
       or lower(coalesce(t.genre,''))   ilike qpat
       or lower(coalesce(t.mood,''))    ilike qpat
  ),
  -- 플레이리스트
  pl as (
    select
      'playlist'::text as result_type,
      p.id,
      p.title,
      p.description as subtitle,
      p.thumbnail_url as image_url,
      null::text as audio_url,
      null::text as genre,
      null::text as mood,
      p.category,
      (
        case when lower(p.title)    = q then 100
             when lower(p.title)    ilike q || '%' then 80
             when lower(p.title)    ilike qpat then 60
             when lower(p.category) ilike qpat then 55
             when lower(coalesce(p.description,'')) ilike qpat then 40
             when lower(coalesce(p.business_category,'')) ilike qpat then 40
             else 10 end
      )::numeric as rank_score,
      null::bigint as play_count
    from public.playlists p
    where lower(p.title)                          ilike qpat
       or lower(p.category)                       ilike qpat
       or lower(coalesce(p.description,''))       ilike qpat
       or lower(coalesce(p.business_category,'')) ilike qpat
  ),
  -- 장르 / 분위기 / 카테고리 (distinct chip)
  gs as (
    select distinct
      'genre'::text as result_type,
      null::uuid as id,
      g as title,
      null::text as subtitle,
      null::text as image_url,
      null::text as audio_url,
      g as genre,
      null::text as mood,
      null::text as category,
      70::numeric as rank_score,
      null::bigint as play_count
    from (
      select nullif(trim(genre), '') as g from public.tracks
      where lower(coalesce(genre,'')) ilike qpat
    ) sub
    where g is not null
  ),
  ms as (
    select distinct
      'mood'::text as result_type,
      null::uuid as id,
      m as title,
      null::text as subtitle,
      null::text as image_url,
      null::text as audio_url,
      null::text as genre,
      m as mood,
      null::text as category,
      65::numeric as rank_score,
      null::bigint as play_count
    from (
      select nullif(trim(mood), '') as m from public.tracks
      where lower(coalesce(mood,'')) ilike qpat
    ) sub
    where m is not null
  ),
  cs as (
    select distinct
      'category'::text as result_type,
      null::uuid as id,
      c as title,
      null::text as subtitle,
      null::text as image_url,
      null::text as audio_url,
      null::text as genre,
      null::text as mood,
      c as category,
      75::numeric as rank_score,
      null::bigint as play_count
    from (
      select distinct nullif(trim(category), '') as c from public.playlists
      where lower(category) ilike qpat
    ) sub
    where c is not null
  )
  select * from (
    select * from tr
    union all select * from pl
    union all select * from gs
    union all select * from ms
    union all select * from cs
  ) all_results
  order by rank_score desc, coalesce(play_count, 0) desc, title asc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.search_catalog(text, int) to anon, authenticated;

-- ============================================
-- top_searches — 인기 검색어 (admin 또는 fallback)
-- ============================================
create or replace function public.top_searches(limit_count int default 10)
returns table(query text, hits bigint)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  select lower(trim(s.query)) as query, count(*)::bigint as hits
  from public.search_events s
  where s.created_at >= now() - interval '14 days'
    and length(trim(s.query)) > 0
  group by lower(trim(s.query))
  order by hits desc
  limit greatest(1, limit_count);
end;
$$;

grant execute on function public.top_searches(int) to anon, authenticated;
-- ============================================
-- 0005_library.sql
-- 개인 음악 공간: 좋아요한 곡 / 최근 재생 / 이어듣기
-- ============================================

-- ============================================
-- liked_tracks
-- ============================================
create table if not exists public.liked_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, track_id)
);

create index if not exists idx_liked_tracks_user on public.liked_tracks(user_id, created_at desc);
create index if not exists idx_liked_tracks_track on public.liked_tracks(track_id);

alter table public.liked_tracks enable row level security;

drop policy if exists "liked_tracks_select_self" on public.liked_tracks;
create policy "liked_tracks_select_self" on public.liked_tracks
  for select using (auth.uid() = user_id);

drop policy if exists "liked_tracks_insert_self" on public.liked_tracks;
create policy "liked_tracks_insert_self" on public.liked_tracks
  for insert with check (auth.uid() = user_id);

drop policy if exists "liked_tracks_delete_self" on public.liked_tracks;
create policy "liked_tracks_delete_self" on public.liked_tracks
  for delete using (auth.uid() = user_id);

-- ============================================
-- recently_played_tracks
-- ============================================
create table if not exists public.recently_played_tracks (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade,
  session_id text,
  track_id uuid not null references public.tracks(id) on delete cascade,
  played_at timestamptz not null default now(),
  play_duration_sec int not null default 0
);

create index if not exists idx_recently_played_user on public.recently_played_tracks(user_id, played_at desc);
create index if not exists idx_recently_played_played on public.recently_played_tracks(played_at desc);

alter table public.recently_played_tracks enable row level security;

drop policy if exists "recently_played_select_self" on public.recently_played_tracks;
create policy "recently_played_select_self" on public.recently_played_tracks
  for select using (auth.uid() = user_id);

drop policy if exists "recently_played_insert_self_or_anon" on public.recently_played_tracks;
create policy "recently_played_insert_self_or_anon" on public.recently_played_tracks
  for insert with check (user_id is null or auth.uid() = user_id);

-- ============================================
-- continue_listening (1 user × 1 track 최대 1행)
-- ============================================
create table if not exists public.continue_listening (
  user_id uuid not null references public.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  position_sec int not null default 0,
  duration_sec int,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create index if not exists idx_continue_listening_user on public.continue_listening(user_id, updated_at desc);

alter table public.continue_listening enable row level security;

drop policy if exists "continue_listening_all_self" on public.continue_listening;
create policy "continue_listening_all_self" on public.continue_listening
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- RPC: 라이브러리 한 번에 조회
-- ============================================
create or replace function public.get_library_overview(limit_recent int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    return jsonb_build_object(
      'liked_tracks', '[]'::jsonb,
      'recently_played', '[]'::jsonb,
      'continue', null,
      'recommended_playlists', '[]'::jsonb
    );
  end if;

  with liked as (
    select t.*, lt.created_at as liked_at
    from public.liked_tracks lt
    join public.tracks t on t.id = lt.track_id
    where lt.user_id = uid
    order by lt.created_at desc
    limit 100
  ),
  recent as (
    select distinct on (t.id)
      t.*, rp.played_at, rp.play_duration_sec
    from public.recently_played_tracks rp
    join public.tracks t on t.id = rp.track_id
    where rp.user_id = uid
    order by t.id, rp.played_at desc
  ),
  recent_ordered as (
    select * from recent order by played_at desc limit limit_recent
  ),
  cont as (
    select c.*, t.title, t.artist, t.cover_url, t.audio_url, t.duration as track_duration, t.genre
    from public.continue_listening c
    join public.tracks t on t.id = c.track_id
    where c.user_id = uid
    order by c.updated_at desc
    limit 1
  ),
  -- 추천: 최근 재생 트랙의 (genre, category) 빈도 기반
  hist_categories as (
    select coalesce(nullif(trim(t.genre), ''), '기타') as g
    from public.recently_played_tracks rp
    join public.tracks t on t.id = rp.track_id
    where rp.user_id = uid
    order by rp.played_at desc
    limit 30
  ),
  top_genres as (
    select g, count(*) as cnt from hist_categories group by g order by cnt desc limit 3
  ),
  reco as (
    select distinct p.*
    from public.playlists p
    where exists (
      select 1
      from public.playlist_tracks pt
      join public.tracks t on t.id = pt.track_id
      join top_genres tg on tg.g = coalesce(nullif(trim(t.genre), ''), '기타')
      where pt.playlist_id = p.id
    )
    limit 10
  )
  select jsonb_build_object(
    'liked_tracks', coalesce((select jsonb_agg(row_to_json(liked) order by liked_at desc) from liked), '[]'::jsonb),
    'recently_played', coalesce((select jsonb_agg(row_to_json(recent_ordered) order by played_at desc) from recent_ordered), '[]'::jsonb),
    'continue', (select row_to_json(cont) from cont),
    'recommended_playlists', coalesce((select jsonb_agg(row_to_json(reco)) from reco), '[]'::jsonb)
  )
  into result;

  return result;
end;
$$;

grant execute on function public.get_library_overview(int) to authenticated;
-- ============================================
-- 0006_share.sql
-- 공유 이벤트 로그
-- ============================================

create table if not exists public.share_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete set null,
  session_id text,
  target_type text not null check (target_type in ('playlist','track','business_qr')),
  target_id uuid,
  method text not null check (method in ('web_share','clipboard','qr_download','qr_view')),
  created_at timestamptz not null default now()
);

create index if not exists idx_share_events_created_at on public.share_events(created_at desc);
create index if not exists idx_share_events_target on public.share_events(target_type, target_id);

alter table public.share_events enable row level security;

drop policy if exists "share_events_insert_any" on public.share_events;
create policy "share_events_insert_any" on public.share_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "share_events_admin_select" on public.share_events;
create policy "share_events_admin_select" on public.share_events
  for select using (
    exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );
-- ============================================
-- 0007_business_scheduler.sql
-- 매장 자동 스케줄러 — 영업시간/요일별 플레이리스트 전환
-- ============================================

-- ============================================
-- business_profiles
-- ============================================
create table if not exists public.business_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.users(id) on delete cascade,
  store_name text,
  business_type text,
  timezone text not null default 'Asia/Seoul',
  open_time time,
  close_time time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_business_profiles_user on public.business_profiles(user_id);

alter table public.business_profiles enable row level security;

drop policy if exists "business_profiles_select_self_or_admin" on public.business_profiles;
create policy "business_profiles_select_self_or_admin" on public.business_profiles
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

drop policy if exists "business_profiles_all_self" on public.business_profiles;
create policy "business_profiles_all_self" on public.business_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- business_music_schedules
-- ============================================
create table if not exists public.business_music_schedules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  day_of_week int not null check (day_of_week >= 0 and day_of_week <= 6),
  slot_name text not null,
  start_time time not null,
  end_time time not null,
  playlist_id uuid references public.playlists(id) on delete set null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (start_time < end_time)
);

create index if not exists idx_bms_user on public.business_music_schedules(user_id);
create index if not exists idx_bms_day on public.business_music_schedules(user_id, day_of_week);
create index if not exists idx_bms_active on public.business_music_schedules(is_active);

alter table public.business_music_schedules enable row level security;

drop policy if exists "bms_select_self_or_admin" on public.business_music_schedules;
create policy "bms_select_self_or_admin" on public.business_music_schedules
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

drop policy if exists "bms_all_self" on public.business_music_schedules;
create policy "bms_all_self" on public.business_music_schedules
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- business_schedule_events (선택적 로그)
-- ============================================
create table if not exists public.business_schedule_events (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade,
  schedule_id uuid references public.business_music_schedules(id) on delete set null,
  playlist_id uuid references public.playlists(id) on delete set null,
  event_type text not null check (event_type in ('started','switched','stopped')),
  created_at timestamptz not null default now()
);

create index if not exists idx_bse_user on public.business_schedule_events(user_id, created_at desc);

alter table public.business_schedule_events enable row level security;

drop policy if exists "bse_insert_self" on public.business_schedule_events;
create policy "bse_insert_self" on public.business_schedule_events
  for insert with check (user_id is null or auth.uid() = user_id);

drop policy if exists "bse_select_self_or_admin" on public.business_schedule_events;
create policy "bse_select_self_or_admin" on public.business_schedule_events
  for select using (
    auth.uid() = user_id
    or exists (select 1 from public.users where id = auth.uid() and role = 'admin')
  );

-- ============================================
-- updated_at 자동 갱신 트리거
-- ============================================
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end; $$;

drop trigger if exists trg_bp_touch on public.business_profiles;
create trigger trg_bp_touch before update on public.business_profiles
  for each row execute function public.touch_updated_at();

drop trigger if exists trg_bms_touch on public.business_music_schedules;
create trigger trg_bms_touch before update on public.business_music_schedules
  for each row execute function public.touch_updated_at();
-- ============================================
-- 0008_recommendation_metadata.sql
-- 트랙 메타데이터 확장 + 룰 기반 추천 RPC
-- ============================================

-- ============================================
-- tracks 테이블 컬럼 확장
-- ============================================
alter table public.tracks
  add column if not exists main_genre text,
  add column if not exists sub_genre text,
  add column if not exists language text,
  add column if not exists lyric_type text,
  add column if not exists bpm int,
  add column if not exists energy_level int check (energy_level between 1 and 5),
  add column if not exists brightness_level int check (brightness_level between 1 and 5),
  add column if not exists emotional_intensity int check (emotional_intensity between 1 and 5),
  add column if not exists vocal_presence int check (vocal_presence between 1 and 5),
  add column if not exists mood_tags text[] default '{}',
  add column if not exists situation_tags text[] default '{}',
  add column if not exists time_slots text[] default '{}',
  add column if not exists season_tags text[] default '{}',
  add column if not exists business_tags text[] default '{}',
  add column if not exists visibility text default 'public',
  add column if not exists recommendation_priority int default 0,
  add column if not exists copyright_status text default 'unknown',
  add column if not exists is_recommendable boolean default true;

-- 인덱스 (GIN — 배열 검색용)
create index if not exists idx_tracks_main_genre on public.tracks(main_genre);
create index if not exists idx_tracks_mood_tags on public.tracks using gin(mood_tags);
create index if not exists idx_tracks_situation_tags on public.tracks using gin(situation_tags);
create index if not exists idx_tracks_time_slots on public.tracks using gin(time_slots);
create index if not exists idx_tracks_business_tags on public.tracks using gin(business_tags);
create index if not exists idx_tracks_recommendable on public.tracks(is_recommendable, visibility);

-- ============================================
-- RPC 1: 컨텍스트 기반 트랙 추천
-- ============================================
create or replace function public.recommend_tracks_by_context(
  p_time_slot text default null,
  p_situation text default null,
  p_business_type text default null,
  p_mood text default null,
  p_limit int default 20
)
returns table(
  track_id uuid,
  title text,
  artist text,
  genre text,
  main_genre text,
  sub_genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  score int,
  score_reasons text[]
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then 15 else 0 end), 0) +
        coalesce((case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then 25 else 0 end), 0) +
        coalesce((case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then 20 else 0 end), 0) +
        coalesce((case when p_mood is not null and lower(coalesce(t.mood, '')) = lower(p_mood) then 10 else 0 end), 0) +
        coalesce((case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then 10 else 0 end), 0) +
        coalesce(t.recommendation_priority, 0)
      ) as s,
      array_remove(array[
        case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then format('+15 %s 시간대', p_time_slot) end,
        case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then format('+25 %s 상황', p_situation) end,
        case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then format('+25 %s 업종', p_business_type) end,
        case when p_mood is not null and p_mood = any(coalesce(t.mood_tags, '{}')) then format('+20 %s 무드', p_mood) end,
        case when p_business_type is not null and coalesce(t.lyric_type, '') in ('instrumental','soft_vocal') then '+10 매장 적합 보컬' end,
        case when coalesce(t.recommendation_priority, 0) > 0 then format('+%s 우선순위', t.recommendation_priority) end
      ], null) as reasons
    from public.tracks t
    where coalesce(t.is_recommendable, true) = true
      and coalesce(t.visibility, 'public') <> 'private'
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.sub_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int as score,
    s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_tracks_by_context(text, text, text, text, int) to anon, authenticated;

-- ============================================
-- RPC 2: 유사 트랙 추천
-- ============================================
create or replace function public.recommend_similar_tracks(
  p_track_id uuid,
  p_limit int default 20
)
returns table(
  track_id uuid,
  title text,
  artist text,
  genre text,
  main_genre text,
  mood text,
  cover_url text,
  audio_url text,
  duration int,
  score int,
  score_reasons text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  src record;
begin
  select * into src from public.tracks where id = p_track_id;
  if src.id is null then return; end if;

  return query
  with scored as (
    select
      t.*,
      (
        coalesce((case when t.main_genre is not null and t.main_genre = src.main_genre then 20 else 0 end), 0) +
        coalesce((case when t.sub_genre is not null and t.sub_genre = src.sub_genre then 15 else 0 end), 0) +
        coalesce(
          (case when array_length(t.mood_tags, 1) > 0 and array_length(src.mood_tags, 1) > 0
            then array_length(array(select unnest(t.mood_tags) intersect select unnest(src.mood_tags)), 1) * 7
            else 0 end), 0) +
        coalesce(
          (case when array_length(t.situation_tags, 1) > 0 and array_length(src.situation_tags, 1) > 0
            then array_length(array(select unnest(t.situation_tags) intersect select unnest(src.situation_tags)), 1) * 5
            else 0 end), 0) +
        coalesce(
          (case when t.bpm is not null and src.bpm is not null
            then greatest(0, 10 - abs(t.bpm - src.bpm) / 4)
            else 0 end), 0) +
        coalesce(
          (case when t.energy_level is not null and src.energy_level is not null
            then greatest(0, 10 - abs(t.energy_level - src.energy_level) * 2)
            else 0 end), 0) +
        coalesce(
          (case when t.lyric_type is not null and t.lyric_type = src.lyric_type then 10 else 0 end), 0) +
        coalesce(
          (case when t.brightness_level is not null and src.brightness_level is not null
            then greatest(0, 5 - abs(t.brightness_level - src.brightness_level)) else 0 end), 0) +
        coalesce(
          (case when t.emotional_intensity is not null and src.emotional_intensity is not null
            then greatest(0, 5 - abs(t.emotional_intensity - src.emotional_intensity)) else 0 end), 0)
      ) as s,
      array_remove(array[
        case when t.main_genre = src.main_genre then '+20 같은 메인 장르' end,
        case when t.sub_genre = src.sub_genre then '+15 같은 서브 장르' end,
        case when t.lyric_type = src.lyric_type then '+10 같은 가사 유형' end
      ], null) as reasons
    from public.tracks t
    where t.id <> p_track_id
      and coalesce(t.is_recommendable, true) = true
      and coalesce(t.visibility, 'public') <> 'private'
  )
  select
    s.id, s.title, s.artist, s.genre, s.main_genre, s.mood,
    s.cover_url, s.audio_url, s.duration,
    s.s::int, s.reasons
  from scored s
  where s.s > 0
  order by s.s desc, s.created_at desc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_similar_tracks(uuid, int) to anon, authenticated;

-- ============================================
-- RPC 3: 컨텍스트 기반 플리 추천
-- (플리 안 트랙들의 평균 컨텍스트 점수)
-- ============================================
create or replace function public.recommend_playlists_by_context(
  p_time_slot text default null,
  p_situation text default null,
  p_business_type text default null,
  p_limit int default 10
)
returns table(
  playlist_id uuid,
  title text,
  category text,
  thumbnail_url text,
  description text,
  is_business_only boolean,
  time_slot text,
  score numeric
)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with track_scores as (
    select
      pt.playlist_id,
      avg(
        case when p_time_slot is not null and p_time_slot = any(coalesce(t.time_slots, '{}')) then 15 else 0 end
        + case when p_situation is not null and p_situation = any(coalesce(t.situation_tags, '{}')) then 25 else 0 end
        + case when p_business_type is not null and p_business_type = any(coalesce(t.business_tags, '{}')) then 25 else 0 end
        + coalesce(t.recommendation_priority, 0)
      ) as avg_s
    from public.playlist_tracks pt
    join public.tracks t on t.id = pt.track_id
    where coalesce(t.is_recommendable, true) = true
    group by pt.playlist_id
  )
  select
    p.id, p.title, p.category, p.thumbnail_url, p.description, p.is_business_only, p.time_slot,
    coalesce(ts.avg_s, 0)::numeric as score
  from public.playlists p
  left join track_scores ts on ts.playlist_id = p.id
  -- time_slot 컬럼도 보너스
  order by (
    coalesce(ts.avg_s, 0)
    + case when p_time_slot is not null and p.time_slot = p_time_slot then 10 else 0 end
    + case when p_business_type is not null and (p.business_category = p_business_type or p.is_business_only) then 5 else 0 end
  ) desc, p.sort_order asc
  limit greatest(1, p_limit);
end;
$$;

grant execute on function public.recommend_playlists_by_context(text, text, text, int) to anon, authenticated;
