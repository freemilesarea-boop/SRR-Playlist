-- 0134 — 개인화 추천 MVP: 사용자 취향 집계 테이블 + 재계산 RPC (룰/가중치 기반, ML 아님).
create table if not exists public.user_music_preferences (
  user_id uuid not null references public.users(id) on delete cascade,
  preference_type text not null check (preference_type in ('genre','mood','artist')),
  preference_key text not null,
  score numeric not null default 0,
  play_count int not null default 0,
  completed_count int not null default 0,
  last_played_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, preference_type, preference_key)
);
alter table public.user_music_preferences enable row level security;
drop policy if exists ump_select_self on public.user_music_preferences;
create policy ump_select_self on public.user_music_preferences for select
  using (auth.uid() = user_id or exists(select 1 from public.users u where u.id=auth.uid() and u.role='admin'));
revoke insert, update, delete on public.user_music_preferences from authenticated, anon;
create index if not exists idx_ump_user_score on public.user_music_preferences(user_id, preference_type, score desc);

-- 청취 이력 → 취향 점수 재계산 (decay + 최근 가중치 + 곡당 캡으로 어뷰징 방지 + removed 제외)
create or replace function public.refresh_user_music_preferences(p_user_id uuid)
returns void language plpgsql security definer set search_path to 'public' as $function$
begin
  if p_user_id is null then return; end if;

  -- 곡 단위 가중 점수(캡 적용) — start+1 / 30s+2 / complete+4, 좋아요 +5, 최근일수록 가중, 곡당 최대 14
  with per_track as (
    select se.track_id, t.genre, t.mood, se.artist_user_id,
           least(
             sum(
               (case se.event_type when 'complete' then 4 when 'milestone_30s' then 2 else 1 end)
               * (case when se.created_at > now() - interval '30 days' then 1.5
                       when se.created_at > now() - interval '90 days' then 1.0
                       else 0.4 end)
             ), 14
           ) as track_score,
           count(*) filter (where se.event_type in ('milestone_30s','complete')) as plays,
           count(*) filter (where se.completed) as completes,
           max(se.created_at) as last_at
    from public.stream_events se
    join public.tracks t on t.id = se.track_id
    where se.user_id = p_user_id
      and se.created_at > now() - interval '180 days'
      and se.event_type in ('start','milestone_30s','complete')
      and t.release_status = 'released'
    group by se.track_id, t.genre, t.mood, se.artist_user_id
  ),
  liked as (
    select t.genre, t.mood, t.owner_user_id as artist_user_id, 5::numeric as bonus
    from public.liked_tracks lt join public.tracks t on t.id = lt.track_id
    where lt.user_id = p_user_id and t.release_status = 'released'
  ),
  genre_pref as (
    select 'genre'::text ptype, genre as pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la
    from per_track where nullif(trim(coalesce(genre,'')),'') is not null group by genre
    union all
    select 'genre', genre, sum(bonus), 0, 0, null from liked where nullif(trim(coalesce(genre,'')),'') is not null group by genre
  ),
  mood_pref as (
    select 'mood'::text ptype, mood as pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la
    from per_track where nullif(trim(coalesce(mood,'')),'') is not null group by mood
    union all
    select 'mood', mood, sum(bonus), 0, 0, null from liked where nullif(trim(coalesce(mood,'')),'') is not null group by mood
  ),
  artist_pref as (
    select 'artist'::text ptype, artist_user_id::text as pkey, sum(track_score) sc, sum(plays) pc, sum(completes) cc, max(last_at) la
    from per_track where artist_user_id is not null group by artist_user_id
  ),
  combined as (
    select ptype, pkey, sum(sc) sc, sum(pc) pc, sum(cc) cc, max(la) la from (
      select * from genre_pref union all select * from mood_pref union all select * from artist_pref
    ) x group by ptype, pkey
  )
  insert into public.user_music_preferences(user_id, preference_type, preference_key, score, play_count, completed_count, last_played_at, updated_at)
  select p_user_id, ptype, pkey, round(sc,2), pc, cc, la, now() from combined
  on conflict (user_id, preference_type, preference_key) do update set
    score = excluded.score, play_count = excluded.play_count, completed_count = excluded.completed_count,
    last_played_at = excluded.last_played_at, updated_at = now();

  -- 더 이상 청취 근거가 없는(이전 집계) 행 정리
  delete from public.user_music_preferences ump
  where ump.user_id = p_user_id and ump.updated_at < now() - interval '1 second';
end; $function$;
grant execute on function public.refresh_user_music_preferences(uuid) to authenticated;
