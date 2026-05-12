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
