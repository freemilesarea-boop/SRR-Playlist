-- 0110 — 플레이리스트 대표 커버(내부 음원 자켓) 자동 계산
--   카드/상세가 단색 그라데이션 대신 포함 음원의 cover_url 을 대표 커버로 사용.
--   우선순위: thumbnail_url(관리자 지정) → 내부 트랙 자켓(순서순 첫 곡) → NULL(프론트 AutoCover 그라데이션 fallback).
--   N+1 방지: lateral LIMIT 1(인덱스 활용) + 홈은 covers 맵 1회 호출.
--   private user playlist 누출 방지: 공개 컨텍스트(RPC)에서만 user 커버 계산.
--   정산/스트리밍/결제 로직 무관.

-- 카탈로그 플레이리스트 대표 커버 (playlist_tracks 순서 우선)
create or replace function public.playlist_cover_url(p_playlist_id uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select t.cover_url
  from public.playlist_tracks pt
  join public.tracks t on t.id = pt.track_id
  where pt.playlist_id = p_playlist_id
    and t.cover_url is not null and t.cover_url <> ''
  order by pt.order_index asc nulls last, t.created_at desc
  limit 1;
$function$;

-- 유저 플레이리스트 대표 커버 (user_playlist_tracks 순서 우선)
create or replace function public.user_playlist_cover_url(p_user_playlist_id uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select t.cover_url
  from public.user_playlist_tracks upt
  join public.tracks t on t.id = upt.track_id
  where upt.user_playlist_id = p_user_playlist_id
    and t.cover_url is not null and t.cover_url <> ''
  order by upt.order_index asc nulls last, t.created_at desc
  limit 1;
$function$;

-- 스마트(자동) 플레이리스트 대표 커버 (저장 트랙 없음 → 매칭 RPC 결과 첫 자켓)
create or replace function public.auto_playlist_cover_url(p_playlist_id uuid)
returns text language sql stable security definer set search_path to 'public' as $function$
  select x.cover_url
  from public.get_auto_playlist_tracks(p_playlist_id, 30) x
  where x.cover_url is not null and x.cover_url <> ''
  limit 1;
$function$;

grant execute on function public.playlist_cover_url(uuid) to anon, authenticated;
grant execute on function public.user_playlist_cover_url(uuid) to anon, authenticated;
grant execute on function public.auto_playlist_cover_url(uuid) to anon, authenticated;

-- 카탈로그 플레이리스트 대표 커버 맵 (홈 카드용 — 1회 호출, N+1 방지)
create or replace function public.get_catalog_playlist_covers()
returns table(playlist_id uuid, cover_url text)
language sql stable security definer set search_path to 'public' as $function$
  select p.id,
         coalesce(nullif(p.thumbnail_url,''),
                  case when p.is_auto then public.auto_playlist_cover_url(p.id)
                       else public.playlist_cover_url(p.id) end)
  from public.playlists p
  where p.status = 'released';
$function$;
grant execute on function public.get_catalog_playlist_covers() to anon, authenticated;

-- get_new_public_playlists: cover_url 추가
drop function if exists public.get_new_public_playlists(integer);
create or replace function public.get_new_public_playlists(p_limit integer default 12)
returns table(id uuid, title text, category text, thumbnail_url text, cover_url text, source text, sort_at timestamp with time zone)
language sql stable security definer set search_path to 'public' as $function$
  select * from (
    select p.id, p.title, p.category, p.thumbnail_url,
           coalesce(nullif(p.thumbnail_url,''),
                    case when p.is_auto then public.auto_playlist_cover_url(p.id)
                         else public.playlist_cover_url(p.id) end) as cover_url,
           'catalog'::text as source,
           coalesce(p.released_at, p.created_at) as sort_at
    from public.playlists p
    where p.status = 'released'
    union all
    select up.id, up.title, null::text as category, up.thumbnail_url,
           coalesce(nullif(up.thumbnail_url,''), public.user_playlist_cover_url(up.id)) as cover_url,
           'user'::text as source,
           up.created_at as sort_at
    from public.user_playlists up
    where up.is_public = true
  ) merged
  order by sort_at desc
  limit greatest(1, least(p_limit, 50));
$function$;
grant execute on function public.get_new_public_playlists(integer) to anon, authenticated;

-- get_user_playlist_detail: computed_cover_url 추가
create or replace function public.get_user_playlist_detail(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v_uid uuid := auth.uid(); v_result jsonb; v_visible boolean;
begin
  select (is_public or owner_user_id = v_uid) into v_visible
  from public.user_playlists where id = p_playlist_id;
  if v_visible is null then return null; end if;
  if not v_visible then raise exception 'forbidden'; end if;

  select jsonb_build_object(
    'id', up.id, 'title', up.title, 'description', up.description,
    'thumbnail_url', up.thumbnail_url, 'is_public', up.is_public,
    'computed_cover_url', coalesce(nullif(up.thumbnail_url,''), public.user_playlist_cover_url(up.id)),
    'owner_user_id', up.owner_user_id, 'is_owner', (up.owner_user_id = v_uid),
    'created_at', up.created_at,
    'creator_name', coalesce(cp.display_name, ou.nickname, ou.full_name, '듣다 사용자'),
    'creator_is_curator', (cp.user_id is not null),
    'creator_handle', cp.handle,
    'total_views', coalesce((select count(*) from public.playlist_qualified_views v
                             where v.playlist_type = 'user' and v.playlist_id = up.id), 0),
    'follower_count', coalesce((select count(*) from public.user_playlist_follows f where f.user_playlist_id = up.id), 0),
    'is_following', exists (select 1 from public.user_playlist_follows f where f.user_playlist_id = up.id and f.user_id = v_uid),
    'tracks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'artist', t.artist, 'genre', t.genre,
        'mood', t.mood, 'audio_url', t.audio_url, 'cover_url', t.cover_url,
        'duration', t.duration, 'created_at', t.created_at, 'order_index', upt.order_index
      ) order by upt.order_index)
      from public.user_playlist_tracks upt join public.tracks t on t.id = upt.track_id
      where upt.user_playlist_id = up.id
    ), '[]'::jsonb)
  ) into v_result
  from public.user_playlists up
  left join public.users ou on ou.id = up.owner_user_id
  left join public.curator_profiles cp on cp.user_id = up.owner_user_id
  where up.id = p_playlist_id;
  return v_result;
end; $function$;

-- search_catalog: playlist / user_playlist 결과의 image_url 을 대표 커버로 계산
--   (thumbnail_url 우선, 없으면 내부 트랙/auto 매칭 자켓)
create or replace function public.search_catalog(search_query text, limit_count integer default 30)
returns table(result_type text, id uuid, title text, subtitle text, image_url text, audio_url text, genre text, mood text, category text, rank_score numeric, play_count bigint)
language plpgsql stable security definer set search_path to 'public' as $function$
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
      and (lower(t.title) ilike qpat
        or lower(coalesce(t.artist,'')) ilike qpat
        or lower(coalesce(t.genre,'')) ilike qpat
        or lower(coalesce(t.mood,'')) ilike qpat)
  ),
  pl as (
    select 'playlist'::text as result_type, p.id, p.title, p.description as subtitle,
           coalesce(nullif(p.thumbnail_url,''),
                    case when p.is_auto then public.auto_playlist_cover_url(p.id)
                         else public.playlist_cover_url(p.id) end) as image_url,
           null::text as audio_url, null::text as genre, null::text as mood,
           p.category,
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
      and (lower(p.title) ilike qpat
        or lower(p.category) ilike qpat
        or lower(coalesce(p.description,'')) ilike qpat
        or lower(coalesce(p.business_category,'')) ilike qpat)
  ),
  upl as (
    select 'user_playlist'::text as result_type, up.id, up.title, up.description as subtitle,
           coalesce(nullif(up.thumbnail_url,''), public.user_playlist_cover_url(up.id)) as image_url,
           null::text as audio_url, null::text as genre, null::text as mood,
           null::text as category,
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
$function$;