-- 0217 — Collaborative Filtering 추천 RPC (이미 prod 적용)
--
-- 청취 로그(track_play_events) 기반 co-occurrence.
-- 기존 main_genre 단순 매칭을 보완 — 사용자 행동 기반.
--
-- 2 RPC:
--   recommend_collab_tracks_for(seed_track_id, limit)
--     "이 곡 들은 사용자가 같이 들은 곡" — 트랙 상세 / 공유 페이지
--   recommend_collab_for_user(user_id, limit)
--     "당신을 위한 추천" — 최근 청취 이력 기반, 홈 개인화 영역
--
-- 점수 계산
--   item-based: co_users / sqrt(total_users)  — 인기 보정 (TF-IDF 비슷)
--   user-based: 시드 트랙의 최신성 가중치 (오래된 시드일수록 점수 ↓)
--
-- visibility_status = 'approved' + removed_at IS NULL 만 추천

create or replace function public.recommend_collab_tracks_for(
  seed_track_id uuid,
  p_limit int default 12
)
returns table (track_id uuid, score numeric, co_users int)
language sql
security definer
set search_path = public
stable
as $$
  with seed_users as (
    select distinct user_id
    from public.track_play_events
    where track_id = seed_track_id
      and event_type in ('play','like','complete')
      and user_id is not null
  ),
  co_plays as (
    select e.track_id, count(distinct e.user_id) as co_users
    from public.track_play_events e
    join seed_users u on u.user_id = e.user_id
    where e.event_type in ('play','like','complete')
      and e.track_id <> seed_track_id
    group by e.track_id
  ),
  popularity as (
    select track_id, count(distinct user_id) as total_users
    from public.track_play_events
    where event_type in ('play','like','complete')
    group by track_id
  )
  select
    cp.track_id,
    (cp.co_users::numeric / nullif(sqrt(p.total_users), 0))::numeric as score,
    cp.co_users::int
  from co_plays cp
  join popularity p on p.track_id = cp.track_id
  join public.tracks t on t.id = cp.track_id
  where cp.co_users >= 2
    and t.visibility_status = 'approved'
    and t.removed_at is null
  order by score desc, co_users desc
  limit p_limit;
$$;

revoke all on function public.recommend_collab_tracks_for(uuid, int) from public;
grant execute on function public.recommend_collab_tracks_for(uuid, int) to anon, authenticated, service_role;

create or replace function public.recommend_collab_for_user(
  p_user_id uuid,
  p_limit int default 12
)
returns table (track_id uuid, score numeric)
language sql
security definer
set search_path = public
stable
as $$
  with my_recent as (
    select track_id, max(created_at) as last_at
    from public.track_play_events
    where user_id = p_user_id
      and event_type in ('play','like','complete')
      and created_at > now() - interval '30 days'
    group by track_id
    order by max(created_at) desc
    limit 20
  ),
  candidates as (
    select
      e.track_id,
      sum(1.0 / (extract(epoch from (now() - mr.last_at)) / 86400.0 + 1.0))::numeric as score
    from my_recent mr
    join public.track_play_events seed
      on seed.track_id = mr.track_id
      and seed.event_type in ('play','like','complete')
      and seed.user_id is not null
      and seed.user_id <> p_user_id
    join public.track_play_events e
      on e.user_id = seed.user_id
      and e.event_type in ('play','like','complete')
    join public.tracks t on t.id = e.track_id
    where e.track_id <> mr.track_id
      and e.track_id not in (select track_id from my_recent)
      and t.visibility_status = 'approved'
      and t.removed_at is null
    group by e.track_id
  )
  select track_id, score
  from candidates
  order by score desc
  limit p_limit;
$$;

revoke all on function public.recommend_collab_for_user(uuid, int) from public;
grant execute on function public.recommend_collab_for_user(uuid, int) to authenticated, service_role;
