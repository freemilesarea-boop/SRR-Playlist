-- 0346 — Phase 9b: Store Learning Dashboard (X6.85)
--
-- 목적:
--   X6.84 에서 수집된 store_track_reactions 데이터를 admin 이 한눈에 보는 대시보드.
--   StoreLearningTab 상단에 7개 섹션(A~G) 렌더링용 데이터를 단일 RPC 로 반환.
--
-- 설계 원칙:
--   - 단일 RPC = N+1 방지 (CTE 한 번 계산 후 jsonb_build_object 로 합침)
--   - security definer + admin only WHERE EXISTS 가드
--   - 기존 store_track_reactions / tracks / users / playlist_track_fit_scores 만 join
--   - 기존 schema 변경 없음 (테이블/뷰 알터 금지)

-- =============================================================================
-- 1. admin_store_learning_dashboard RPC
--    입력: p_window_days (기본 30)
--    출력: jsonb {
--      overview, topLiked, topDisliked, dailyTrend, storeTypes, genres, readiness,
--      window_days, computed_at
--    }
-- =============================================================================
create or replace function public.admin_store_learning_dashboard(
  p_window_days int default 30
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb;
  v_window int := greatest(coalesce(p_window_days, 30), 1);
  v_since timestamptz := now() - (v_window || ' days')::interval;
begin
  -- admin guard
  if not exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin') then
    raise exception 'forbidden: admin only';
  end if;

  with
  -- =========================================================================
  -- A. Overview KPI
  -- =========================================================================
  overview as (
    select
      count(*) filter (where reaction_type = 'like') as total_likes,
      count(*) filter (where reaction_type = 'dislike') as total_dislikes,
      count(*) filter (where reaction_type = 'like' and updated_at > v_since) as recent_likes,
      count(*) filter (where reaction_type = 'dislike' and updated_at > v_since) as recent_dislikes,
      count(distinct store_id) as unique_stores,
      count(distinct track_id) as unique_tracks,
      count(*) as total_reactions,
      round(
        100.0 * count(*) filter (where reaction_type = 'like') / nullif(count(*), 0),
        1
      ) as like_ratio
    from public.store_track_reactions
  ),

  -- =========================================================================
  -- B/C. Track-level aggregate (window 내)
  -- =========================================================================
  track_agg as (
    select
      r.track_id,
      count(*) filter (where r.reaction_type = 'like') as like_count,
      count(*) filter (where r.reaction_type = 'dislike') as dislike_count,
      count(*) as total_reactions,
      round(
        100.0 * count(*) filter (where r.reaction_type = 'like') / nullif(count(*), 0),
        1
      ) as like_ratio,
      round(
        100.0 * count(*) filter (where r.reaction_type = 'dislike') / nullif(count(*), 0),
        1
      ) as dislike_ratio
    from public.store_track_reactions r
    where r.updated_at > v_since
    group by r.track_id
  ),

  track_meta as (
    select
      a.track_id,
      t.title,
      t.artist,
      coalesce(t.main_genre, t.genre) as genre,
      a.like_count,
      a.dislike_count,
      a.total_reactions,
      a.like_ratio,
      a.dislike_ratio,
      -- fit_score 는 트랙당 여러 플레이리스트가 있을 수 있으므로 최대값 채택
      (select max(p.fit_score)
         from public.playlist_track_fit_scores p
         where p.track_id = a.track_id) as fit_score
    from track_agg a
    join public.tracks t on t.id = a.track_id
  ),

  top_liked as (
    select jsonb_agg(row_obj order by like_count desc, like_ratio desc nulls last) as arr
    from (
      select jsonb_build_object(
        'track_id', track_id,
        'title', title,
        'artist', artist,
        'genre', genre,
        'like_count', like_count,
        'dislike_count', dislike_count,
        'like_ratio', like_ratio,
        'fit_score', fit_score
      ) as row_obj,
      like_count,
      like_ratio
      from track_meta
      where like_count > 0
      order by like_count desc, like_ratio desc nulls last
      limit 20
    ) s
  ),

  top_disliked as (
    select jsonb_agg(row_obj order by dislike_count desc, dislike_ratio desc nulls last) as arr
    from (
      select jsonb_build_object(
        'track_id', track_id,
        'title', title,
        'artist', artist,
        'genre', genre,
        'like_count', like_count,
        'dislike_count', dislike_count,
        'dislike_ratio', dislike_ratio,
        'fit_score', fit_score
      ) as row_obj,
      dislike_count,
      dislike_ratio
      from track_meta
      where dislike_count > 0
      order by dislike_count desc, dislike_ratio desc nulls last
      limit 20
    ) s
  ),

  -- =========================================================================
  -- D. Daily trend (window_days)
  -- =========================================================================
  date_series as (
    select generate_series(
      date_trunc('day', v_since),
      date_trunc('day', now()),
      interval '1 day'
    )::date as day
  ),
  daily as (
    select
      date_trunc('day', updated_at)::date as day,
      count(*) filter (where reaction_type = 'like') as likes,
      count(*) filter (where reaction_type = 'dislike') as dislikes
    from public.store_track_reactions
    where updated_at > v_since
    group by 1
  ),
  daily_trend as (
    select jsonb_agg(jsonb_build_object(
      'date', to_char(d.day, 'YYYY-MM-DD'),
      'likes', coalesce(daily.likes, 0),
      'dislikes', coalesce(daily.dislikes, 0)
    ) order by d.day) as arr
    from date_series d
    left join daily on daily.day = d.day
  ),

  -- =========================================================================
  -- E. Store Type Analysis (users.business_category → normalize_store_label)
  -- =========================================================================
  store_type_agg as (
    select
      coalesce(public.normalize_store_label(u.business_category), u.business_category, 'unknown') as store_type,
      count(*) filter (where r.reaction_type = 'like') as likes,
      count(*) filter (where r.reaction_type = 'dislike') as dislikes,
      count(*) as reactions,
      count(distinct r.store_id) as stores
    from public.store_track_reactions r
    left join public.users u on u.id = r.store_id
    where r.updated_at > v_since
    group by 1
  ),
  store_types as (
    select jsonb_agg(jsonb_build_object(
      'store_type', store_type,
      'likes', likes,
      'dislikes', dislikes,
      'like_ratio', round(100.0 * likes / nullif(reactions, 0), 1),
      'reactions', reactions,
      'stores', stores
    ) order by reactions desc) as arr
    from store_type_agg
  ),

  -- =========================================================================
  -- F. Genre Analysis (tracks.main_genre|genre)
  -- =========================================================================
  genre_agg as (
    select
      coalesce(t.main_genre, t.genre, 'unknown') as genre,
      count(*) filter (where r.reaction_type = 'like') as likes,
      count(*) filter (where r.reaction_type = 'dislike') as dislikes,
      count(*) as reactions,
      count(distinct r.track_id) as tracks
    from public.store_track_reactions r
    join public.tracks t on t.id = r.track_id
    where r.updated_at > v_since
    group by 1
  ),
  genres as (
    select jsonb_agg(jsonb_build_object(
      'genre', genre,
      'likes', likes,
      'dislikes', dislikes,
      'like_ratio', round(100.0 * likes / nullif(reactions, 0), 1),
      'reactions', reactions,
      'tracks', tracks
    ) order by reactions desc) as arr
    from genre_agg
  ),

  -- =========================================================================
  -- G. Readiness Score (0~100, LOW/MEDIUM/READY)
  --     기준:
  --       - reaction_count: 0~30 LOW, 31~70 MEDIUM, 71+ READY (40점)
  --       - store_count: 1점/매장 (최대 30점)
  --       - track_count: 1점/3트랙 (최대 30점)
  -- =========================================================================
  readiness_calc as (
    select
      ov.total_reactions,
      ov.unique_stores,
      ov.unique_tracks,
      least(40, round((ov.total_reactions::numeric / 70.0) * 40, 0))::int as reaction_score,
      least(30, ov.unique_stores)::int as store_score,
      least(30, floor(ov.unique_tracks / 3.0))::int as track_score
    from overview ov
  ),
  readiness as (
    select jsonb_build_object(
      'score', coalesce(reaction_score + store_score + track_score, 0),
      'status', case
        when total_reactions >= 71 and unique_stores >= 5 and unique_tracks >= 30 then 'READY'
        when total_reactions >= 31 then 'MEDIUM'
        else 'LOW'
      end,
      'breakdown', jsonb_build_object(
        'reaction_score', reaction_score,
        'store_score', store_score,
        'track_score', track_score,
        'total_reactions', total_reactions,
        'unique_stores', unique_stores,
        'unique_tracks', unique_tracks
      )
    ) as obj
    from readiness_calc
  )

  -- =========================================================================
  -- 합치기
  -- =========================================================================
  select jsonb_build_object(
    'overview', (select to_jsonb(ov) from overview ov),
    'topLiked', coalesce((select arr from top_liked), '[]'::jsonb),
    'topDisliked', coalesce((select arr from top_disliked), '[]'::jsonb),
    'dailyTrend', coalesce((select arr from daily_trend), '[]'::jsonb),
    'storeTypes', coalesce((select arr from store_types), '[]'::jsonb),
    'genres', coalesce((select arr from genres), '[]'::jsonb),
    'readiness', (select obj from readiness),
    'window_days', v_window,
    'computed_at', now()
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.admin_store_learning_dashboard(int) from public, anon;
grant execute on function public.admin_store_learning_dashboard(int) to authenticated;

comment on function public.admin_store_learning_dashboard(int) is
  'X6.85 — StoreLearningTab 상단 대시보드 (7 sections: overview/topLiked/topDisliked/dailyTrend/storeTypes/genres/readiness). admin only.';
