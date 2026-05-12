-- ============================================
-- 0005_library.sql
-- 개인 음악 공간: 좋아요한 곡 / 최근 재생 / 이어듣기
-- ============================================

-- ============================================
-- liked_tracks
-- ============================================
create table if not exists public.liked_tracks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique(user_id, track_id)
);

create index if not exists idx_liked_tracks_user on public.liked_tracks(user_id, created_at desc);
create index if not exists idx_liked_tracks_track on public.liked_tracks(track_id);

alter table public.liked_tracks enable row level security;

drop policy if exists "liked_tracks_select_self" on public.liked_tracks;
create policy "liked_tracks_select_self" on public.liked_tracks
  for select using (auth.uid() = user_id);

drop policy if exists "liked_tracks_insert_self" on public.liked_tracks;
create policy "liked_tracks_insert_self" on public.liked_tracks
  for insert with check (auth.uid() = user_id);

drop policy if exists "liked_tracks_delete_self" on public.liked_tracks;
create policy "liked_tracks_delete_self" on public.liked_tracks
  for delete using (auth.uid() = user_id);

-- ============================================
-- recently_played_tracks
-- ============================================
create table if not exists public.recently_played_tracks (
  id bigserial primary key,
  user_id uuid references public.users(id) on delete cascade,
  session_id text,
  track_id uuid not null references public.tracks(id) on delete cascade,
  played_at timestamptz not null default now(),
  play_duration_sec int not null default 0
);

create index if not exists idx_recently_played_user on public.recently_played_tracks(user_id, played_at desc);
create index if not exists idx_recently_played_played on public.recently_played_tracks(played_at desc);

alter table public.recently_played_tracks enable row level security;

drop policy if exists "recently_played_select_self" on public.recently_played_tracks;
create policy "recently_played_select_self" on public.recently_played_tracks
  for select using (auth.uid() = user_id);

drop policy if exists "recently_played_insert_self_or_anon" on public.recently_played_tracks;
create policy "recently_played_insert_self_or_anon" on public.recently_played_tracks
  for insert with check (user_id is null or auth.uid() = user_id);

-- ============================================
-- continue_listening (1 user × 1 track 최대 1행)
-- ============================================
create table if not exists public.continue_listening (
  user_id uuid not null references public.users(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  position_sec int not null default 0,
  duration_sec int,
  updated_at timestamptz not null default now(),
  primary key (user_id, track_id)
);

create index if not exists idx_continue_listening_user on public.continue_listening(user_id, updated_at desc);

alter table public.continue_listening enable row level security;

drop policy if exists "continue_listening_all_self" on public.continue_listening;
create policy "continue_listening_all_self" on public.continue_listening
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ============================================
-- RPC: 라이브러리 한 번에 조회
-- ============================================
create or replace function public.get_library_overview(limit_recent int default 20)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
    select c.*, t.title, t.artist, t.cover_url, t.audio_url, t.duration as track_duration, t.genre
    from public.continue_listening c
    join public.tracks t on t.id = c.track_id
    where c.user_id = uid
    order by c.updated_at desc
    limit 1
  ),
  -- 추천: 최근 재생 트랙의 (genre, category) 빈도 기반
  hist_categories as (
    select coalesce(nullif(trim(t.genre), ''), '기타') as g
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
      join top_genres tg on tg.g = coalesce(nullif(trim(t.genre), ''), '기타')
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
end;
$$;

grant execute on function public.get_library_overview(int) to authenticated;
