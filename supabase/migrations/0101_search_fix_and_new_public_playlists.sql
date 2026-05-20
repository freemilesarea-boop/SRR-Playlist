-- 0101 — 검색 정상화 + 신규 공개 플리 노출
-- (1) search_catalog: ambiguous 컬럼(genre/mood/category/play_count/rank_score/title) qualify
--     + released/public/audio_url 필터 + user_playlists(public)/curator 추가
--     원인: 0004 의 search_catalog 가 lazy-bind ambiguous 로 호출 시 42702 → fallback → 경고
-- (2) get_new_public_playlists: released 카탈로그 + public user_playlists 통합 (source 구분)
--
-- private user_playlists / draft playlists / audio_url 없는 트랙은 제외.

create or replace function public.search_catalog(search_query text, limit_count integer default 30)
returns table(
  result_type text, id uuid, title text, subtitle text, image_url text,
  audio_url text, genre text, mood text, category text,
  rank_score numeric, play_count bigint
)
language plpgsql stable security definer set search_path = public as $$
declare
  q text := lower(btrim(search_query));
  qpat text := '%' || lower(btrim(search_query)) || '%';
begin
  if q = '' then return; end if;
  return query
  with
  tr as (
    select 'track'::text as result_type, t.id, t.title, t.artist as subtitle,
           t.cover_url as image_url, t.audio_url, t.genre, t.mood, null::text as category,
           (case when lower(t.title) = q then 100
                 when lower(t.title) ilike q || '%' then 80
                 when lower(t.title) ilike qpat then 60
                 when lower(coalesce(t.artist,'')) ilike qpat then 50
                 when lower(coalesce(t.genre,'')) ilike qpat then 30
                 when lower(coalesce(t.mood,'')) ilike qpat then 30
                 else 10 end)::numeric as rank_score,
           coalesce((select count(*) from public.stream_events se where se.track_id = t.id and se.event_type='milestone_30s'),0)::bigint as play_count
    from public.tracks t
    where (t.audio_url is not null and t.audio_url <> '')
      and (lower(t.title) ilike qpat or lower(coalesce(t.artist,'')) ilike qpat
        or lower(coalesce(t.genre,'')) ilike qpat or lower(coalesce(t.mood,'')) ilike qpat)
  ),
  pl as (
    select 'playlist'::text as result_type, p.id, p.title, p.description as subtitle,
           p.thumbnail_url as image_url, null::text as audio_url, null::text as genre, null::text as mood, p.category,
           (case when lower(p.title) = q then 100
                 when lower(p.title) ilike q || '%' then 80
                 when lower(p.title) ilike qpat then 60
                 when lower(p.category) ilike qpat then 55
                 when lower(coalesce(p.description,'')) ilike qpat then 40
                 when lower(coalesce(p.business_category,'')) ilike qpat then 40
                 else 10 end)::numeric as rank_score,
           null::bigint as play_count
    from public.playlists p
    where p.status = 'released'
      and (lower(p.title) ilike qpat or lower(p.category) ilike qpat
        or lower(coalesce(p.description,'')) ilike qpat or lower(coalesce(p.business_category,'')) ilike qpat)
  ),
  upl as (
    select 'user_playlist'::text as result_type, up.id, up.title, up.description as subtitle,
           up.thumbnail_url as image_url, null::text as audio_url, null::text as genre, null::text as mood, null::text as category,
           (case when lower(up.title) = q then 95
                 when lower(up.title) ilike q || '%' then 78
                 when lower(up.title) ilike qpat then 58
                 when lower(coalesce(up.description,'')) ilike qpat then 38
                 else 10 end)::numeric as rank_score,
           null::bigint as play_count
    from public.user_playlists up
    where up.is_public = true
      and (lower(up.title) ilike qpat or lower(coalesce(up.description,'')) ilike qpat)
  ),
  cur as (
    select 'curator'::text as result_type, cp.user_id as id, cp.display_name as title,
           cp.bio as subtitle, cp.profile_image_url as image_url, null::text as audio_url,
           null::text as genre, null::text as mood, cp.handle as category,
           (case when lower(cp.display_name) = q then 90
                 when lower(cp.display_name) ilike qpat then 56
                 when lower(coalesce(cp.handle,'')) ilike qpat then 52
                 else 10 end)::numeric as rank_score,
           null::bigint as play_count
    from public.curator_profiles cp
    where lower(cp.display_name) ilike qpat or lower(coalesce(cp.handle,'')) ilike qpat
  ),
  gs as (
    select distinct 'genre'::text as result_type, null::uuid as id, g as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, g as genre, null::text as mood, null::text as category,
           70::numeric as rank_score, null::bigint as play_count
    from (select nullif(trim(tt.genre), '') as g from public.tracks tt where lower(coalesce(tt.genre,'')) ilike qpat) sub
    where g is not null
  ),
  ms as (
    select distinct 'mood'::text as result_type, null::uuid as id, m as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, null::text as genre, m as mood, null::text as category,
           65::numeric as rank_score, null::bigint as play_count
    from (select nullif(trim(tt.mood), '') as m from public.tracks tt where lower(coalesce(tt.mood,'')) ilike qpat) sub
    where m is not null
  ),
  cs as (
    select distinct 'category'::text as result_type, null::uuid as id, c as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, null::text as genre, null::text as mood, c as category,
           75::numeric as rank_score, null::bigint as play_count
    from (select distinct nullif(trim(pp.category), '') as c from public.playlists pp
          where pp.status = 'released' and lower(pp.category) ilike qpat) sub
    where c is not null
  ),
  all_results as (
    select * from tr
    union all select * from pl
    union all select * from upl
    union all select * from cur
    union all select * from gs
    union all select * from ms
    union all select * from cs
  )
  select ar.result_type, ar.id, ar.title, ar.subtitle, ar.image_url, ar.audio_url,
         ar.genre, ar.mood, ar.category, ar.rank_score, ar.play_count
  from all_results ar
  order by ar.rank_score desc, coalesce(ar.play_count, 0) desc, ar.title asc
  limit greatest(1, limit_count);
end;
$$;
grant execute on function public.search_catalog(text, integer) to anon, authenticated;

create or replace function public.get_new_public_playlists(p_limit int default 12)
returns table(id uuid, title text, category text, thumbnail_url text, source text, sort_at timestamptz)
language sql stable security definer set search_path = public as $$
  select * from (
    select p.id, p.title, p.category, p.thumbnail_url, 'catalog'::text as source,
           coalesce(p.released_at, p.created_at) as sort_at
    from public.playlists p where p.status = 'released'
    union all
    select up.id, up.title, null::text as category, up.thumbnail_url, 'user'::text as source,
           up.created_at as sort_at
    from public.user_playlists up where up.is_public = true
  ) merged
  order by sort_at desc
  limit greatest(1, least(p_limit, 50));
$$;
grant execute on function public.get_new_public_playlists(int) to anon, authenticated;
