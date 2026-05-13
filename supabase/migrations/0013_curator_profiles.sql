-- ============================================
-- 0013_curator_profiles.sql
--
-- 큐레이터 프로필 시스템:
--   - 플레이리스트 제작자(큐레이터) 공개 프로필
--   - /curator/:handle 페이지 노출
--   - 협업 문의 메일 + SNS 링크
--   - 인기 큐레이터 / 검색 / 통계 RPC
--
-- 향후 확장 (현재 PR 범위 밖, 구조만 열어둠):
--   큐레이터 팔로우 / 광고 / AI 음악 피칭 / 수익쉐어 / 인증 배지 / 차트
-- ============================================

-- ----------------------
-- 0) playlists.created_by_user_id — 큐레이터 연결
-- ----------------------
alter table public.playlists
  add column if not exists created_by_user_id uuid references public.users(id) on delete set null;

create index if not exists idx_playlists_created_by
  on public.playlists(created_by_user_id);

-- ----------------------
-- 1) curator_profiles 테이블
-- ----------------------
create table if not exists public.curator_profiles (
  user_id uuid primary key references public.users(id) on delete cascade,
  display_name text not null,
  handle text unique not null
    check (handle ~ '^[a-z0-9][a-z0-9_-]{1,30}[a-z0-9]$'),
  bio text,
  profile_image_url text,
  contact_email text,
  instagram_url text,
  youtube_url text,
  website_url text,
  allow_business_contact boolean not null default true,
  is_verified boolean not null default false,
  is_featured boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_curator_handle on public.curator_profiles(handle);
create index if not exists idx_curator_featured on public.curator_profiles(is_featured) where is_featured = true;
create index if not exists idx_curator_display_name_lower on public.curator_profiles(lower(display_name));

-- updated_at 자동 갱신 트리거
create or replace function public._curator_profiles_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_curator_profiles_updated_at on public.curator_profiles;
create trigger trg_curator_profiles_updated_at
  before update on public.curator_profiles
  for each row execute function public._curator_profiles_set_updated_at();

-- RLS — public select / self insert/update / admin all
alter table public.curator_profiles enable row level security;

drop policy if exists "curator_public_select" on public.curator_profiles;
create policy "curator_public_select" on public.curator_profiles
  for select using (true);

drop policy if exists "curator_self_insert" on public.curator_profiles;
create policy "curator_self_insert" on public.curator_profiles
  for insert with check (auth.uid() = user_id);

drop policy if exists "curator_self_update" on public.curator_profiles;
create policy "curator_self_update" on public.curator_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "curator_admin_all" on public.curator_profiles;
create policy "curator_admin_all" on public.curator_profiles
  for all using (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  ) with check (
    exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin')
  );

-- ----------------------
-- 2) RPC: get_curator_profile(handle)
--    프로필 + 통계 + 플리 목록 한 번에
-- ----------------------
create or replace function public.get_curator_profile(p_handle text)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  profile_image_url text,
  contact_email text,
  instagram_url text,
  youtube_url text,
  website_url text,
  allow_business_contact boolean,
  is_verified boolean,
  is_featured boolean,
  created_at timestamptz,
  follower_count bigint,
  playlist_count bigint,
  total_playlist_streams bigint,
  monthly_streams bigint,
  chart_entries bigint,
  playlists jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid;
begin
  select cp.user_id into v_user_id
  from public.curator_profiles cp
  where cp.handle = lower(p_handle);

  if v_user_id is null then return; end if;

  return query
  with
    -- 큐레이터가 만든 플레이리스트
    own_pls as (
      select id, title, thumbnail_url, category, created_at
      from public.playlists
      where created_by_user_id = v_user_id
    ),
    -- 플레이리스트별 follower
    pl_follows as (
      select pf.playlist_id, count(*)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
      group by pf.playlist_id
    ),
    -- 플레이리스트별 stream count
    pl_streams as (
      select se.playlist_id,
             count(*) filter (where se.event_type = 'milestone_30s')::bigint as total,
             count(*) filter (where se.event_type = 'milestone_30s'
                              and se.created_at >= now() - interval '30 days')::bigint as monthly
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
      group by se.playlist_id
    ),
    -- 큐레이터 팔로워 (집계만 — playlist_follows 합산)
    user_followers as (
      select count(distinct pf.user_id)::bigint as fc
      from public.playlist_follows pf
      where pf.playlist_id in (select id from own_pls)
    ),
    -- 차트 진입 횟수 (현재 차트 RPC 가 단순 카운트 기반이므로 보수적 계산)
    chart_cnt as (
      select count(*)::bigint as ce
      from public.stream_events se
      where se.playlist_id in (select id from own_pls)
        and se.event_type = 'complete'
    ),
    pl_array as (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', p.id,
            'title', p.title,
            'thumbnail_url', p.thumbnail_url,
            'category', p.category,
            'follower_count', coalesce(plf.fc, 0),
            'stream_count', coalesce(pls.total, 0)
          )
          order by coalesce(pls.total, 0) desc, p.created_at desc
        ),
        '[]'::jsonb
      ) as arr
      from own_pls p
      left join pl_follows plf on plf.playlist_id = p.id
      left join pl_streams pls on pls.playlist_id = p.id
    )
  select
    cp.user_id, cp.display_name, cp.handle, cp.bio, cp.profile_image_url,
    cp.contact_email, cp.instagram_url, cp.youtube_url, cp.website_url,
    cp.allow_business_contact, cp.is_verified, cp.is_featured, cp.created_at,
    coalesce((select fc from user_followers), 0) as follower_count,
    (select count(*)::bigint from own_pls) as playlist_count,
    coalesce((select sum(total) from pl_streams), 0) as total_playlist_streams,
    coalesce((select sum(monthly) from pl_streams), 0) as monthly_streams,
    coalesce((select ce from chart_cnt), 0) as chart_entries,
    (select arr from pl_array) as playlists
  from public.curator_profiles cp
  where cp.user_id = v_user_id;
end;
$$;

grant execute on function public.get_curator_profile(text) to anon, authenticated;

-- ----------------------
-- 3) RPC: get_featured_curators(limit)
--    홈 노출용 — featured 우선, 최근 추가 보조
-- ----------------------
create or replace function public.get_featured_curators(p_limit int default 12)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  bio text,
  profile_image_url text,
  is_verified boolean,
  is_featured boolean,
  playlist_count bigint,
  total_streams bigint
)
language sql
security definer
set search_path = public
as $$
  with own as (
    select cp.user_id, count(p.id)::bigint as pc
    from public.curator_profiles cp
    left join public.playlists p on p.created_by_user_id = cp.user_id
    group by cp.user_id
  ),
  streams as (
    select p.created_by_user_id as user_id,
           count(*)::bigint as ts
    from public.stream_events se
    join public.playlists p on p.id = se.playlist_id
    where se.event_type = 'milestone_30s' and p.created_by_user_id is not null
    group by p.created_by_user_id
  )
  select cp.user_id, cp.display_name, cp.handle, cp.bio, cp.profile_image_url,
         cp.is_verified, cp.is_featured,
         coalesce(o.pc, 0), coalesce(s.ts, 0)
  from public.curator_profiles cp
  left join own o on o.user_id = cp.user_id
  left join streams s on s.user_id = cp.user_id
  order by cp.is_featured desc, coalesce(s.ts, 0) desc, cp.created_at desc
  limit greatest(1, p_limit);
$$;

grant execute on function public.get_featured_curators(int) to anon, authenticated;

-- ----------------------
-- 4) RPC: search_curators(query)
--    검색 자동완성 준비
-- ----------------------
create or replace function public.search_curators(p_query text)
returns table(
  user_id uuid,
  display_name text,
  handle text,
  profile_image_url text,
  is_verified boolean
)
language sql
security definer
set search_path = public
as $$
  select cp.user_id, cp.display_name, cp.handle, cp.profile_image_url, cp.is_verified
  from public.curator_profiles cp
  where p_query is null or length(btrim(p_query)) = 0
    or lower(cp.display_name) like '%' || lower(p_query) || '%'
    or lower(cp.handle) like '%' || lower(p_query) || '%'
  order by cp.is_featured desc, cp.is_verified desc, cp.created_at desc
  limit 20;
$$;

grant execute on function public.search_curators(text) to anon, authenticated;

-- 확인 출력
select
  (select count(*) from public.curator_profiles) as total_curators,
  (select count(*) from public.curator_profiles where is_featured) as featured_curators,
  (select count(*) from public.playlists where created_by_user_id is not null) as curated_playlists;
