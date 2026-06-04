-- 0283 — Business fallback RPC + playable summary (X6.0.1 매장 납품 가드)
--
-- 제공 RPC:
--   1. business_find_fallback_playlist(p_category, p_daypart)
--      매장 모드 시작 시 큐가 비어 있을 때 같은 카테고리/daypart 의 정상 플리 추천.
--   2. business_list_playlists_with_playable_count()
--      schedule 편집 UI 가 각 플리의 playable_count 를 표시할 수 있도록.
--
-- 모두 anon/authenticated 모두 호출 가능 (사업자가 매장에서 사용).
-- 캐시 불필요 — light query.

-- ===== 1. fallback RPC =====
create or replace function public.business_find_fallback_playlist(
  p_category text default null,
  p_daypart text default null
) returns table (
  playlist_id uuid,
  title text,
  business_category text,
  daypart text,
  playable_count int,
  match_strategy text
)
language plpgsql stable security definer set search_path = public as $$
begin
  return query
  with all_pl as (
    select pl.id, pl.title, pl.business_category, pl.daypart, pl.created_at,
           jsonb_array_length(public.get_playlist_tracks(pl.id)) as cnt
    from public.playlists pl
    where coalesce(pl.archived_at, '1970-01-01'::timestamptz) < now() - interval '1 second'
       or pl.archived_at is null
  ),
  filtered as (
    select id, title, business_category, daypart, cnt, created_at
    from all_pl
    where cnt > 0
  )
  -- 우선순위 1: category + daypart 일치
  (
    select id, title, business_category, daypart, cnt, 'category_daypart'::text
    from filtered
    where business_category = p_category and daypart = p_daypart and p_category is not null and p_daypart is not null
    order by created_at desc, cnt desc
    limit 1
  )
  union all
  -- 우선순위 2: category 일치 (daypart 무관)
  (
    select id, title, business_category, daypart, cnt, 'category_only'::text
    from filtered
    where business_category = p_category and p_category is not null
    order by (daypart = p_daypart) desc nulls last, created_at desc, cnt desc
    limit 1
  )
  union all
  -- 우선순위 3: 어떤 정상 플리든 (last resort)
  (
    select id, title, business_category, daypart, cnt, 'any_playable'::text
    from filtered
    order by created_at desc, cnt desc
    limit 1
  );
end; $$;

grant execute on function public.business_find_fallback_playlist(text, text) to anon, authenticated;

-- ===== 2. playable summary =====
-- schedule 편집 UI 에서 각 플리의 재생 가능 곡 수 표시.
create or replace function public.business_list_playlists_with_playable_count()
returns table (
  id uuid,
  title text,
  business_category text,
  daypart text,
  is_business_only boolean,
  archived boolean,
  total_tracks bigint,
  playable_count int
)
language sql stable security definer set search_path = public as $$
  select pl.id, pl.title, pl.business_category, pl.daypart,
         coalesce(pl.is_business_only, false),
         pl.archived_at is not null as archived,
         (select count(*) from public.playlist_tracks pt
            where pt.playlist_id = pl.id and pt.removed_at is null) as total_tracks,
         jsonb_array_length(public.get_playlist_tracks(pl.id)) as playable_count
  from public.playlists pl
  where pl.archived_at is null
  order by pl.title;
$$;

grant execute on function public.business_list_playlists_with_playable_count() to anon, authenticated;
