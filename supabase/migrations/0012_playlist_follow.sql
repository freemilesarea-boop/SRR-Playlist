-- ============================================
-- 0012_playlist_follow.sql
--
-- 플레이리스트 팔로우(구독) 시스템:
--   - 사용자가 플레이리스트를 "팔로우" 해서 업데이트 추적
--   - 팔로워 수 집계 → 인기/급상승 랭킹의 기반
--   - 추후 큐레이터 시스템 / 새 곡 알림 / 수익쉐어의 토대
--
-- 기존 likes 테이블은 "좋아요" 의 별도 의미로 유지 (UI 에서 분리).
-- ============================================

-- ----------------------
-- 1) playlist_follows 테이블
-- ----------------------
create table if not exists public.playlist_follows (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  playlist_id uuid not null references public.playlists(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_id, playlist_id)
);

create index if not exists idx_playlist_follows_user
  on public.playlist_follows(user_id, created_at desc);
create index if not exists idx_playlist_follows_playlist
  on public.playlist_follows(playlist_id, created_at desc);

alter table public.playlist_follows enable row level security;

drop policy if exists "playlist_follows_select_self" on public.playlist_follows;
create policy "playlist_follows_select_self" on public.playlist_follows
  for select using (auth.uid() = user_id);

drop policy if exists "playlist_follows_insert_self" on public.playlist_follows;
create policy "playlist_follows_insert_self" on public.playlist_follows
  for insert with check (auth.uid() = user_id);

drop policy if exists "playlist_follows_delete_self" on public.playlist_follows;
create policy "playlist_follows_delete_self" on public.playlist_follows
  for delete using (auth.uid() = user_id);

drop policy if exists "playlist_follows_admin_select" on public.playlist_follows;
create policy "playlist_follows_admin_select" on public.playlist_follows
  for select using (
    exists (
      select 1 from public.users u
      where u.id = auth.uid() and u.role = 'admin'
    )
  );

-- ----------------------
-- 2) RPC: get_playlist_follow_counts
--    개인정보 없이 집계만 → anon/authenticated 모두 호출 가능
-- ----------------------
create or replace function public.get_playlist_follow_counts(
  p_playlist_ids uuid[]
)
returns table(playlist_id uuid, follower_count bigint)
language sql
security definer
set search_path = public
as $$
  select pf.playlist_id, count(*)::bigint as follower_count
  from public.playlist_follows pf
  where pf.playlist_id = any(p_playlist_ids)
  group by pf.playlist_id;
$$;

grant execute on function public.get_playlist_follow_counts(uuid[])
  to anon, authenticated;

-- ----------------------
-- 3) RPC: get_followed_playlists
--    현재 로그인 사용자가 팔로우한 플레이리스트 목록
-- ----------------------
create or replace function public.get_followed_playlists()
returns table(
  playlist_id uuid,
  title text,
  description text,
  category text,
  thumbnail_url text,
  is_business_only boolean,
  time_slot text,
  followed_at timestamptz,
  follower_count bigint
)
language sql
security definer
set search_path = public
as $$
  with own as (
    select pf.playlist_id, pf.created_at as followed_at
    from public.playlist_follows pf
    where pf.user_id = auth.uid()
  ),
  counts as (
    select pf2.playlist_id, count(*)::bigint as fc
    from public.playlist_follows pf2
    where pf2.playlist_id in (select playlist_id from own)
    group by pf2.playlist_id
  )
  select
    p.id, p.title, p.description, p.category, p.thumbnail_url,
    p.is_business_only, p.time_slot,
    o.followed_at,
    coalesce(c.fc, 0) as follower_count
  from own o
  join public.playlists p on p.id = o.playlist_id
  left join counts c on c.playlist_id = o.playlist_id
  order by o.followed_at desc;
$$;

grant execute on function public.get_followed_playlists()
  to authenticated;

-- ----------------------
-- 4) RPC: get_popular_playlists_by_follows
--    팔로워 수 기준 인기 플리 (랭킹/홈 섹션용)
-- ----------------------
create or replace function public.get_popular_playlists_by_follows(
  p_limit int default 20
)
returns table(
  playlist_id uuid,
  title text,
  description text,
  category text,
  thumbnail_url text,
  is_business_only boolean,
  time_slot text,
  follower_count bigint,
  track_count bigint
)
language sql
security definer
set search_path = public
as $$
  with counts as (
    select pf.playlist_id, count(*)::bigint as fc
    from public.playlist_follows pf
    group by pf.playlist_id
  ),
  tcounts as (
    select pt.playlist_id, count(*)::bigint as tc
    from public.playlist_tracks pt
    group by pt.playlist_id
  )
  select
    p.id, p.title, p.description, p.category, p.thumbnail_url,
    p.is_business_only, p.time_slot,
    coalesce(c.fc, 0) as follower_count,
    coalesce(t.tc, 0) as track_count
  from public.playlists p
  left join counts c on c.playlist_id = p.id
  left join tcounts t on t.playlist_id = p.id
  where coalesce(c.fc, 0) > 0
  order by coalesce(c.fc, 0) desc, p.sort_order asc, p.created_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.get_popular_playlists_by_follows(int)
  to anon, authenticated;

-- 확인 출력
select
  (select count(*) from public.playlist_follows) as total_follows,
  (select count(distinct user_id) from public.playlist_follows) as following_users,
  (select count(distinct playlist_id) from public.playlist_follows) as followed_playlists;
