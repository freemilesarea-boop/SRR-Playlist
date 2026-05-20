-- 0100 — 일반 사용자 "내 플레이리스트" 시스템
-- 별도 테이블로 격리: private 플리가 공개 playlists(홈/차트/검색) 에 절대 누출 안 됨.

create table if not exists public.user_playlists (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  description text,
  thumbnail_url text,
  is_public boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists user_playlists_owner_idx on public.user_playlists(owner_user_id, created_at desc);
create index if not exists user_playlists_public_idx on public.user_playlists(is_public) where is_public = true;

create table if not exists public.user_playlist_tracks (
  id uuid primary key default gen_random_uuid(),
  user_playlist_id uuid not null references public.user_playlists(id) on delete cascade,
  track_id uuid not null references public.tracks(id) on delete cascade,
  order_index integer not null default 0,
  added_at timestamptz not null default now(),
  unique (user_playlist_id, track_id)
);
create index if not exists user_playlist_tracks_pl_idx on public.user_playlist_tracks(user_playlist_id, order_index);

create table if not exists public.user_playlist_follows (
  user_id uuid not null references auth.users(id) on delete cascade,
  user_playlist_id uuid not null references public.user_playlists(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, user_playlist_id)
);
create index if not exists user_playlist_follows_user_idx on public.user_playlist_follows(user_id, created_at desc);

alter table public.user_playlists enable row level security;
alter table public.user_playlist_tracks enable row level security;
alter table public.user_playlist_follows enable row level security;

drop policy if exists user_playlists_select on public.user_playlists;
create policy user_playlists_select on public.user_playlists
  for select using (is_public = true or owner_user_id = auth.uid());
drop policy if exists user_playlists_insert on public.user_playlists;
create policy user_playlists_insert on public.user_playlists
  for insert with check (owner_user_id = auth.uid());
drop policy if exists user_playlists_update on public.user_playlists;
create policy user_playlists_update on public.user_playlists
  for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists user_playlists_delete on public.user_playlists;
create policy user_playlists_delete on public.user_playlists
  for delete using (owner_user_id = auth.uid());

drop policy if exists user_playlist_tracks_select on public.user_playlist_tracks;
create policy user_playlist_tracks_select on public.user_playlist_tracks
  for select using (
    exists (select 1 from public.user_playlists up
            where up.id = user_playlist_tracks.user_playlist_id
              and (up.is_public = true or up.owner_user_id = auth.uid()))
  );
drop policy if exists user_playlist_tracks_write on public.user_playlist_tracks;
create policy user_playlist_tracks_write on public.user_playlist_tracks
  for all using (
    exists (select 1 from public.user_playlists up
            where up.id = user_playlist_tracks.user_playlist_id and up.owner_user_id = auth.uid())
  ) with check (
    exists (select 1 from public.user_playlists up
            where up.id = user_playlist_tracks.user_playlist_id and up.owner_user_id = auth.uid())
  );

drop policy if exists user_playlist_follows_select on public.user_playlist_follows;
create policy user_playlist_follows_select on public.user_playlist_follows
  for select using (user_id = auth.uid());
drop policy if exists user_playlist_follows_write on public.user_playlist_follows;
create policy user_playlist_follows_write on public.user_playlist_follows
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create or replace function public.create_user_playlist(
  p_title text, p_description text default null,
  p_is_public boolean default false, p_thumbnail_url text default null
)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  insert into public.user_playlists (owner_user_id, title, description, is_public, thumbnail_url)
  values (v_uid, btrim(p_title), p_description, coalesce(p_is_public, false), p_thumbnail_url)
  returning id into v_id;
  return v_id;
end; $$;
revoke execute on function public.create_user_playlist(text, text, boolean, text) from public, anon;
grant execute on function public.create_user_playlist(text, text, boolean, text) to authenticated;

create or replace function public.add_track_to_user_playlist(p_playlist_id uuid, p_track_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_next int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select owner_user_id into v_owner from public.user_playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;
  if v_owner <> v_uid then raise exception 'forbidden'; end if;
  if exists (select 1 from public.user_playlist_tracks where user_playlist_id = p_playlist_id and track_id = p_track_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select coalesce(max(order_index), -1) + 1 into v_next from public.user_playlist_tracks where user_playlist_id = p_playlist_id;
  insert into public.user_playlist_tracks (user_playlist_id, track_id, order_index)
  values (p_playlist_id, p_track_id, v_next);
  update public.user_playlists set updated_at = now() where id = p_playlist_id;
  return jsonb_build_object('ok', true, 'already', false, 'order_index', v_next);
end; $$;
revoke execute on function public.add_track_to_user_playlist(uuid, uuid) from public, anon;
grant execute on function public.add_track_to_user_playlist(uuid, uuid) to authenticated;

create or replace function public.reorder_user_playlist_tracks(p_playlist_id uuid, p_track_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_i int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select owner_user_id into v_owner from public.user_playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;
  if v_owner <> v_uid then raise exception 'forbidden'; end if;
  for v_i in 1 .. array_length(p_track_ids, 1) loop
    update public.user_playlist_tracks set order_index = v_i - 1
      where user_playlist_id = p_playlist_id and track_id = p_track_ids[v_i];
  end loop;
  update public.user_playlists set updated_at = now() where id = p_playlist_id;
  return jsonb_build_object('ok', true);
end; $$;
revoke execute on function public.reorder_user_playlist_tracks(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_user_playlist_tracks(uuid, uuid[]) to authenticated;

create or replace function public.get_my_user_playlists()
returns table(
  id uuid, title text, description text, thumbnail_url text, is_public boolean,
  created_at timestamptz, updated_at timestamptz, track_count bigint, follower_count bigint
)
language sql stable security definer set search_path = public as $$
  select up.id, up.title, up.description, up.thumbnail_url, up.is_public,
         up.created_at, up.updated_at,
         coalesce((select count(*)::bigint from public.user_playlist_tracks t where t.user_playlist_id = up.id), 0),
         coalesce((select count(*)::bigint from public.user_playlist_follows f where f.user_playlist_id = up.id), 0)
  from public.user_playlists up
  where up.owner_user_id = auth.uid()
  order by up.updated_at desc;
$$;
revoke execute on function public.get_my_user_playlists() from public, anon;
grant execute on function public.get_my_user_playlists() to authenticated;

create or replace function public.get_user_playlist_detail(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb; v_visible boolean;
begin
  select (is_public or owner_user_id = v_uid) into v_visible
  from public.user_playlists where id = p_playlist_id;
  if v_visible is null then return null; end if;
  if not v_visible then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'id', up.id, 'title', up.title, 'description', up.description,
    'thumbnail_url', up.thumbnail_url, 'is_public', up.is_public,
    'owner_user_id', up.owner_user_id, 'is_owner', (up.owner_user_id = v_uid),
    'created_at', up.created_at,
    'follower_count', coalesce((select count(*) from public.user_playlist_follows f where f.user_playlist_id = up.id), 0),
    'is_following', exists (select 1 from public.user_playlist_follows f where f.user_playlist_id = up.id and f.user_id = v_uid),
    'tracks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', t.id, 'title', t.title, 'artist', t.artist, 'genre', t.genre,
        'mood', t.mood, 'audio_url', t.audio_url, 'cover_url', t.cover_url,
        'duration', t.duration, 'created_at', t.created_at, 'order_index', upt.order_index
      ) order by upt.order_index)
      from public.user_playlist_tracks upt
      join public.tracks t on t.id = upt.track_id
      where upt.user_playlist_id = up.id
    ), '[]'::jsonb)
  ) into v_result
  from public.user_playlists up where up.id = p_playlist_id;
  return v_result;
end; $$;
revoke execute on function public.get_user_playlist_detail(uuid) from public, anon;
grant execute on function public.get_user_playlist_detail(uuid) to authenticated;

create or replace function public.toggle_user_playlist_follow(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_exists boolean; v_public boolean;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select is_public into v_public from public.user_playlists where id = p_playlist_id;
  if v_public is null then raise exception 'playlist not found'; end if;
  select exists (select 1 from public.user_playlist_follows where user_playlist_id = p_playlist_id and user_id = v_uid) into v_exists;
  if v_exists then
    delete from public.user_playlist_follows where user_playlist_id = p_playlist_id and user_id = v_uid;
    return jsonb_build_object('ok', true, 'following', false);
  else
    if not v_public then raise exception 'cannot follow private playlist'; end if;
    insert into public.user_playlist_follows (user_id, user_playlist_id) values (v_uid, p_playlist_id) on conflict do nothing;
    return jsonb_build_object('ok', true, 'following', true);
  end if;
end; $$;
revoke execute on function public.toggle_user_playlist_follow(uuid) from public, anon;
grant execute on function public.toggle_user_playlist_follow(uuid) to authenticated;

create or replace function public.get_followed_user_playlists()
returns table(id uuid, title text, thumbnail_url text, owner_user_id uuid, track_count bigint, followed_at timestamptz)
language sql stable security definer set search_path = public as $$
  select up.id, up.title, up.thumbnail_url, up.owner_user_id,
         coalesce((select count(*)::bigint from public.user_playlist_tracks t where t.user_playlist_id = up.id), 0),
         f.created_at
  from public.user_playlist_follows f
  join public.user_playlists up on up.id = f.user_playlist_id
  where f.user_id = auth.uid() and up.is_public = true
  order by f.created_at desc;
$$;
revoke execute on function public.get_followed_user_playlists() from public, anon;
grant execute on function public.get_followed_user_playlists() to authenticated;
