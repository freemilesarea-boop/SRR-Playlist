-- 검색/추천/출력 경로의 레거시 tracks.genre 의존을 main_genre 기준으로 교체.
-- 방향: main_genre = primary canonical genre (검색 매칭/랭킹/facet 기준),
--       genre_tags = recall 보조 매칭(검색 WHERE 에서만, 랭킹/facet 미오염).
-- additive: CREATE OR REPLACE 만. 데이터 UPDATE/release_status/stream_events·정산 무접근. legacy genre 컬럼 미제거.

-- A) search_catalog : 트랙 매칭(main_genre + genre_tags recall) / 랭킹(main_genre) / 장르 facet(main_genre) / 출력(main_genre)
create or replace function public.search_catalog(search_query text, limit_count integer default 30)
returns table(result_type text, id uuid, title text, subtitle text, image_url text, audio_url text, genre text, mood text, category text, rank_score numeric, play_count bigint)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare q text := lower(btrim(search_query)); qpat text := '%' || lower(btrim(search_query)) || '%';
begin
  if q = '' then return; end if;
  return query
  with
  tr as (
    select 'track'::text as result_type, t.id, t.title, t.artist as subtitle,
           t.cover_url as image_url, t.audio_url, t.main_genre as genre, t.mood, null::text as category,
           (case when lower(t.title) = q then 100 when lower(t.title) ilike q || '%' then 80
                 when lower(t.title) ilike qpat then 60 when lower(coalesce(t.artist,'')) ilike qpat then 50
                 when lower(coalesce(t.main_genre,'')) ilike qpat then 30 when lower(coalesce(t.mood,'')) ilike qpat then 30
                 else 10 end)::numeric as rank_score,
           coalesce((select count(*) from public.stream_events se where se.track_id = t.id and se.event_type='milestone_30s'),0)::bigint as play_count
    from public.tracks t
    where t.release_status = 'released' and (t.audio_url is not null and t.audio_url <> '')
      and (lower(t.title) ilike qpat or lower(coalesce(t.artist,'')) ilike qpat
        or lower(coalesce(t.main_genre,'')) ilike qpat
        or exists (select 1 from unnest(coalesce(t.genre_tags,'{}')) gt where lower(gt) ilike qpat)
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
    from (select nullif(trim(tt.main_genre), '') as g from public.tracks tt where tt.release_status='released' and lower(coalesce(tt.main_genre,'')) ilike qpat) sub
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

-- B) get_library_overview : 최근재생 장르 집계 + 추천 플리 join + continue 출력 모두 main_genre
create or replace function public.get_library_overview(limit_recent integer default 20)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
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
    select c.*, t.title, t.artist, t.cover_url, t.audio_url, t.duration as track_duration, t.main_genre as genre
    from public.continue_listening c
    join public.tracks t on t.id = c.track_id
    where c.user_id = uid
    order by c.updated_at desc
    limit 1
  ),
  hist_categories as (
    select coalesce(nullif(trim(t.main_genre), ''), '기타') as g
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
      join top_genres tg on tg.g = coalesce(nullif(trim(t.main_genre), ''), '기타')
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
end; $function$;

-- C1) get_auto_playlist_tracks : 출력 tgenre 만 main_genre 로 (점수 로직 무변경)
create or replace function public.get_auto_playlist_tracks(p_playlist_id uuid, p_limit integer default 100)
returns table(id uuid, title text, artist text, genre text, mood text, audio_url text, cover_url text, duration integer, created_at timestamp with time zone, score numeric)
language plpgsql stable security definer set search_path to 'public'
as $function$
declare
  r jsonb;
  v_business text; v_time_slot text;
  v_moods text[]; v_situations text[];
  v_bpm_min int; v_bpm_max int; v_energy_min int; v_energy_max int;
  v_vocal text; v_fresh_days int; v_max_per_artist int; v_seed text;
  v_has_tag_rule boolean;
  v_limit int := greatest(1, least(coalesce(p_limit, 100), 200));
begin
  select p.auto_rule into r from public.playlists p where p.id = p_playlist_id and p.is_auto = true;
  if r is null then return; end if;

  v_business     := nullif(r->>'business_category', '');
  v_time_slot    := nullif(r->>'time_slot', '');
  v_moods        := case when r ? 'mood_tags' then array(select jsonb_array_elements_text(r->'mood_tags')) else '{}' end;
  v_situations   := case when r ? 'situation_tags' then array(select jsonb_array_elements_text(r->'situation_tags')) else '{}' end;
  v_bpm_min      := nullif(r->>'bpm_min','')::int;
  v_bpm_max      := nullif(r->>'bpm_max','')::int;
  v_energy_min   := nullif(r->>'energy_min','')::int;
  v_energy_max   := nullif(r->>'energy_max','')::int;
  v_vocal        := nullif(r->>'vocal_type','');
  v_fresh_days   := coalesce(nullif(r->>'freshness_boost_days','')::int, 0);
  v_max_per_artist := nullif(r->>'max_tracks_per_artist','')::int;
  v_seed         := coalesce(r->>'shuffle_seed', p_playlist_id::text);
  v_has_tag_rule := v_business is not null or v_time_slot is not null
                    or array_length(v_moods,1) is not null or array_length(v_situations,1) is not null;

  return query
  with scored as (
    select
      t.id as tid, t.title as ttitle, t.artist as tartist, t.main_genre as tgenre, t.mood as tmood,
      t.audio_url as taudio, t.cover_url as tcover, t.duration as tduration, t.created_at as tcreated,
      (
        coalesce(case when v_time_slot  is not null and v_time_slot = any(coalesce(t.time_slots,'{}')) then 15 else 0 end,0)
      + coalesce(case when v_business is not null
                      and (v_business = any(coalesce(t.business_tags,'{}')) or t.suitable_store = v_business)
                      then 25 else 0 end,0)
      + coalesce((select count(*) from unnest(v_moods) m
                  where m = any(coalesce(t.mood_tags,'{}')) or coalesce(t.mood,'') ilike '%'||m||'%'),0) * 20
      + coalesce((select count(*) from unnest(v_situations) s where s = any(coalesce(t.situation_tags,'{}'))),0) * 25
      + coalesce(case when v_business is not null and coalesce(t.lyric_type,'') in ('instrumental','soft_vocal') then 10 else 0 end,0)
      + coalesce(case when v_fresh_days > 0 and coalesce(t.released_at, t.created_at) >= now() - make_interval(days => v_fresh_days) then 20 else 0 end,0)
      )::numeric as tscore,
      ('x' || substr(md5(t.id::text || v_seed), 1, 8))::bit(32)::bigint as trot
    from public.tracks t
    where t.visibility_status = 'approved'
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.removed_at is null
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      and (v_bpm_min is null or coalesce(t.bpm, 0) >= v_bpm_min)
      and (v_bpm_max is null or coalesce(t.bpm, 9999) <= v_bpm_max)
      and (v_energy_min is null or coalesce(t.energy_level, 0) >= v_energy_min)
      and (v_energy_max is null or coalesce(t.energy_level, 9999) <= v_energy_max)
      and (v_vocal is null or coalesce(t.lyric_type,'') = v_vocal)
  ),
  filtered as (
    select * from scored s where (not v_has_tag_rule) or s.tscore > 0
  ),
  diversified as (
    select f.*,
      row_number() over (
        partition by coalesce(lower(btrim(f.tartist)), f.tid::text)
        order by f.tscore desc, f.trot
      ) as artist_rank
    from filtered f
  )
  select d.tid, d.ttitle, d.tartist, d.tgenre, d.tmood, d.taudio, d.tcover,
         d.tduration, d.tcreated, d.tscore
  from diversified d
  where v_max_per_artist is null or d.artist_rank <= v_max_per_artist
  order by d.tscore desc, d.trot
  limit v_limit;
end; $function$;

-- C2) get_user_playlist_detail : jsonb 'genre' 출력만 main_genre
create or replace function public.get_user_playlist_detail(p_playlist_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
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
        'id', t.id, 'title', t.title, 'artist', t.artist, 'genre', t.main_genre,
        'mood', t.mood, 'audio_url', t.audio_url, 'cover_url', t.cover_url,
        'duration', t.duration, 'created_at', t.created_at, 'order_index', upt.order_index
      ) order by upt.order_index)
      from public.user_playlist_tracks upt join public.tracks t on t.id = upt.track_id
      where upt.user_playlist_id = up.id
        and t.visibility_status = 'approved'
        and (t.release_status = 'released' or t.source_type = 'admin_upload')
        and t.removed_at is null
        and t.audio_url is not null and length(btrim(t.audio_url)) > 0
        and t.cover_url is not null and length(btrim(t.cover_url)) > 0
    ), '[]'::jsonb)
  ) into v_result
  from public.user_playlists up
  left join public.users ou on ou.id = up.owner_user_id
  left join public.curator_profiles cp on cp.user_id = up.owner_user_id
  where up.id = p_playlist_id;
  return v_result;
end; $function$;

-- C3) list_my_artist_tracks : 출력만 main_genre
create or replace function public.list_my_artist_tracks(p_limit integer default 100)
returns table(track_id uuid, title text, artist text, genre text, mood text, cover_url text, audio_url text, duration integer, visibility_status text, rejected_reason text, created_at timestamp with time zone)
language plpgsql security definer set search_path to 'public'
as $function$
begin
  return query
  select t.id, t.title, t.artist, t.main_genre, t.mood, t.cover_url, t.audio_url, t.duration,
         t.visibility_status, t.rejected_reason, t.created_at
  from public.tracks t
  where t.owner_user_id = auth.uid()
  order by t.created_at desc
  limit greatest(1, p_limit);
end; $function$;
