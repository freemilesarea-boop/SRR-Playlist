-- 검색 정규화: 하이픈/공백/특수문자 없이 입력해도 canonical genre/tag 가 매칭되도록.
-- 적용 범위: search_catalog 의 genre(main_genre)/genre_tags 매칭 + 장르 facet 만.
--   - facet 기준 = main_genre, ranking primary = main_genre 유지
--   - genre_tags 는 recall 보조 (facet/ranking 미반영)
--   - title/artist 매칭은 기존 ilike 유지(정규화 미적용 — 과확장 방지)
-- additive: CREATE OR REPLACE / 신규 immutable helper. 데이터 UPDATE/release_status/stream_events·정산 무접근. legacy genre 미제거.

-- 검색어/단순 텍스트 정규화: lowercase + [a-z0-9가-힣] 외 제거
create or replace function public._search_norm(x text)
returns text language sql immutable
set search_path to 'public' as $$
  select regexp_replace(lower(coalesce(x,'')), '[^a-z0-9가-힣]', '', 'g')
$$;

-- 매칭 대상(genre/tag) 정규화 blob: '&' 를 and / n / 제거 세 변형으로 펼쳐 '|' 로 결합.
-- 예: 'Drum & Bass' -> 'drumandbass|drumnbass|drumbass', 'K-R&B' -> 'krandb|krnb|krb'
-- 쿼리 정규화값을 이 blob 에 substring 매칭하면 drum bass/drumandbass, rnb/krnb 등 표기 흡수.
create or replace function public._search_blob(x text)
returns text language sql immutable
set search_path to 'public' as $$
  select regexp_replace(replace(lower(coalesce(x,'')),'&','and'), '[^a-z0-9가-힣]', '', 'g')
    ||'|'|| regexp_replace(replace(lower(coalesce(x,'')),'&','n'),   '[^a-z0-9가-힣]', '', 'g')
    ||'|'|| regexp_replace(lower(coalesce(x,'')),                    '[^a-z0-9가-힣]', '', 'g')
$$;

grant execute on function public._search_norm(text) to anon, authenticated;
grant execute on function public._search_blob(text) to anon, authenticated;

create or replace function public.search_catalog(search_query text, limit_count integer default 30)
returns table(result_type text, id uuid, title text, subtitle text, image_url text, audio_url text, genre text, mood text, category text, rank_score numeric, play_count bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare q text := lower(btrim(search_query)); qpat text := '%' || lower(btrim(search_query)) || '%';
        nq text := public._search_norm(search_query);
begin
  if q = '' then return; end if;
  return query
  with
  tr as (
    select 'track'::text as result_type, t.id, t.title, t.artist as subtitle,
           t.cover_url as image_url, t.audio_url, t.main_genre as genre, t.mood, null::text as category,
           (case when lower(t.title) = q then 100 when lower(t.title) ilike q || '%' then 80
                 when lower(t.title) ilike qpat then 60 when lower(coalesce(t.artist,'')) ilike qpat then 50
                 when (lower(coalesce(t.main_genre,'')) ilike qpat
                       or (length(nq) >= 2 and public._search_blob(t.main_genre) like '%'||nq||'%')) then 30
                 when lower(coalesce(t.mood,'')) ilike qpat then 30
                 else 10 end)::numeric as rank_score,
           coalesce((select count(*) from public.stream_events se where se.track_id = t.id and se.event_type='milestone_30s'),0)::bigint as play_count
    from public.tracks t
    where t.release_status = 'released' and (t.audio_url is not null and t.audio_url <> '')
      and (lower(t.title) ilike qpat or lower(coalesce(t.artist,'')) ilike qpat
        or lower(coalesce(t.main_genre,'')) ilike qpat
        or (length(nq) >= 2 and public._search_blob(t.main_genre) like '%'||nq||'%')
        or exists (select 1 from unnest(coalesce(t.genre_tags,'{}')) gt
                   where lower(gt) ilike qpat
                      or (length(nq) >= 2 and public._search_blob(gt) like '%'||nq||'%'))
        or lower(coalesce(t.mood,'')) ilike qpat)
  ),
  pl as (
    select 'playlist'::text as result_type, p.id, p.title, p.description as subtitle,
           coalesce(nullif(p.thumbnail_url,''), case when p.is_auto then public.auto_playlist_cover_url(p.id) else public.playlist_cover_url(p.id) end) as image_url,
           null::text as audio_url, null::text as genre, null::text as mood, p.category,
           (case when lower(p.title) = q then 100 when lower(p.title) ilike q || '%' then 80
                 when lower(p.title) ilike qpat then 60 when lower(p.category) ilike qpat then 55
                 when lower(coalesce(p.description,'')) ilike qpat then 40 when lower(coalesce(p.business_category,'')) ilike qpat then 40
                 else 10 end)::numeric as rank_score, null::bigint as play_count
    from public.playlists p
    where p.status = 'released' and (lower(p.title) ilike qpat or lower(p.category) ilike qpat
        or lower(coalesce(p.description,'')) ilike qpat or lower(coalesce(p.business_category,'')) ilike qpat)
  ),
  upl as (
    select 'user_playlist'::text as result_type, up.id, up.title, up.description as subtitle,
           coalesce(nullif(up.thumbnail_url,''), public.user_playlist_cover_url(up.id)) as image_url,
           null::text as audio_url, null::text as genre, null::text as mood, null::text as category,
           (case when lower(up.title) = q then 95 when lower(up.title) ilike q || '%' then 78
                 when lower(up.title) ilike qpat then 58 when lower(coalesce(up.description,'')) ilike qpat then 38
                 else 10 end)::numeric as rank_score, null::bigint as play_count
    from public.user_playlists up
    where up.is_public = true and (lower(up.title) ilike qpat or lower(coalesce(up.description,'')) ilike qpat)
  ),
  cur as (
    select 'curator'::text as result_type, cp.user_id as id, cp.display_name as title,
           cp.bio as subtitle, cp.profile_image_url as image_url, null::text as audio_url,
           null::text as genre, null::text as mood, cp.handle as category,
           (case when lower(cp.display_name) = q then 90 when lower(cp.display_name) ilike qpat then 56
                 when lower(coalesce(cp.handle,'')) ilike qpat then 52 else 10 end)::numeric as rank_score, null::bigint as play_count
    from public.curator_profiles cp
    where lower(cp.display_name) ilike qpat or lower(coalesce(cp.handle,'')) ilike qpat
  ),
  gs as (
    select distinct 'genre'::text as result_type, null::uuid as id, g as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, g as genre, null::text as mood, null::text as category,
           70::numeric as rank_score, null::bigint as play_count
    from (select nullif(trim(tt.main_genre), '') as g from public.tracks tt
          where tt.release_status='released'
            and (lower(coalesce(tt.main_genre,'')) ilike qpat
                 or (length(nq) >= 2 and public._search_blob(tt.main_genre) like '%'||nq||'%'))) sub
    where g is not null
  ),
  ms as (
    select distinct 'mood'::text as result_type, null::uuid as id, m as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, null::text as genre, m as mood, null::text as category,
           65::numeric as rank_score, null::bigint as play_count
    from (select nullif(trim(tt.mood), '') as m from public.tracks tt where tt.release_status='released' and lower(coalesce(tt.mood,'')) ilike qpat) sub
    where m is not null
  ),
  cs as (
    select distinct 'category'::text as result_type, null::uuid as id, c as title, null::text as subtitle,
           null::text as image_url, null::text as audio_url, null::text as genre, null::text as mood, c as category,
           75::numeric as rank_score, null::bigint as play_count
    from (select distinct nullif(trim(pp.category), '') as c from public.playlists pp where pp.status = 'released' and lower(pp.category) ilike qpat) sub
    where c is not null
  ),
  all_results as (
    select * from tr union all select * from pl union all select * from upl
    union all select * from cur union all select * from gs union all select * from ms union all select * from cs
  )
  select ar.result_type, ar.id, ar.title, ar.subtitle, ar.image_url, ar.audio_url,
         ar.genre, ar.mood, ar.category, ar.rank_score, ar.play_count
  from all_results ar
  order by ar.rank_score desc, coalesce(ar.play_count, 0) desc, ar.title asc
  limit greatest(1, limit_count);
end; $function$;
