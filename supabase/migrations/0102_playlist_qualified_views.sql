-- 0102 — 플레이리스트 청취 조회수 (10분 이상 청취 = 1 view, 24h dedup)
-- stream_events 정산과 완전 분리된 별도 테이블. 정산 수치에 영향 없음.

create table if not exists public.playlist_qualified_views (
  id uuid primary key default gen_random_uuid(),
  playlist_type text not null check (playlist_type in ('catalog', 'user')),
  playlist_id uuid not null,
  user_id uuid references auth.users(id) on delete set null,
  anonymous_id text,
  listened_seconds int not null default 0,
  viewed_at timestamptz not null default now()
);
create index if not exists pqv_lookup_idx on public.playlist_qualified_views(playlist_type, playlist_id, viewed_at desc);
create index if not exists pqv_user_dedup_idx on public.playlist_qualified_views(playlist_type, playlist_id, user_id, viewed_at desc) where user_id is not null;
create index if not exists pqv_anon_dedup_idx on public.playlist_qualified_views(playlist_type, playlist_id, anonymous_id, viewed_at desc) where anonymous_id is not null;

alter table public.playlist_qualified_views enable row level security;
drop policy if exists pqv_no_direct on public.playlist_qualified_views;
create policy pqv_no_direct on public.playlist_qualified_views for select using (false);

create or replace function public.record_playlist_qualified_view(
  p_playlist_type text, p_playlist_id uuid, p_listened_seconds int,
  p_session_id text default null, p_anonymous_id text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_owner uuid; v_visible boolean := false; v_total bigint;
begin
  if p_listened_seconds is null or p_listened_seconds < 600 then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'insufficient_time');
  end if;
  if p_playlist_type not in ('catalog', 'user') then
    return jsonb_build_object('ok', false, 'counted', false, 'reason', 'bad_type');
  end if;

  if p_playlist_type = 'catalog' then
    select created_by_user_id into v_owner from public.playlists where id = p_playlist_id and status = 'released';
    v_visible := found;
  else
    select owner_user_id into v_owner from public.user_playlists up
      where up.id = p_playlist_id
        and (up.is_public = true or up.owner_user_id = v_uid
             or exists (select 1 from public.user_playlist_follows f where f.user_playlist_id = up.id and f.user_id = v_uid));
    v_visible := found;
  end if;
  if not v_visible then return jsonb_build_object('ok', true, 'counted', false, 'reason', 'forbidden'); end if;

  if v_uid is not null and v_owner is not null and v_uid = v_owner then
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'self_play');
  end if;

  if v_uid is not null then
    if exists (select 1 from public.playlist_qualified_views
               where playlist_type = p_playlist_type and playlist_id = p_playlist_id
                 and user_id = v_uid and viewed_at >= now() - interval '24 hours') then
      return jsonb_build_object('ok', true, 'counted', false, 'reason', 'already_counted_24h');
    end if;
  elsif p_anonymous_id is not null and length(btrim(p_anonymous_id)) > 0 then
    if exists (select 1 from public.playlist_qualified_views
               where playlist_type = p_playlist_type and playlist_id = p_playlist_id
                 and anonymous_id = p_anonymous_id and viewed_at >= now() - interval '24 hours') then
      return jsonb_build_object('ok', true, 'counted', false, 'reason', 'already_counted_24h');
    end if;
  else
    return jsonb_build_object('ok', true, 'counted', false, 'reason', 'no_identity');
  end if;

  insert into public.playlist_qualified_views (playlist_type, playlist_id, user_id, anonymous_id, listened_seconds)
  values (p_playlist_type, p_playlist_id, v_uid, nullif(btrim(coalesce(p_anonymous_id,'')), ''), p_listened_seconds);

  select count(*) into v_total from public.playlist_qualified_views
    where playlist_type = p_playlist_type and playlist_id = p_playlist_id;
  return jsonb_build_object('ok', true, 'counted', true, 'reason', 'counted', 'total_views', v_total);
end;
$$;
grant execute on function public.record_playlist_qualified_view(text, uuid, int, text, text) to anon, authenticated;

create or replace function public.get_playlist_view_count(p_playlist_type text, p_playlist_id uuid)
returns bigint language sql stable security definer set search_path = public as $$
  select count(*)::bigint from public.playlist_qualified_views
  where playlist_type = p_playlist_type and playlist_id = p_playlist_id;
$$;
grant execute on function public.get_playlist_view_count(text, uuid) to anon, authenticated;

-- get_user_playlist_detail 확장: creator_name + creator_is_curator + creator_handle + total_views
create or replace function public.get_user_playlist_detail(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); v_result jsonb; v_visible boolean;
begin
  select (is_public or owner_user_id = v_uid) into v_visible from public.user_playlists where id = p_playlist_id;
  if v_visible is null then return null; end if;
  if not v_visible then raise exception 'forbidden'; end if;
  select jsonb_build_object(
    'id', up.id, 'title', up.title, 'description', up.description,
    'thumbnail_url', up.thumbnail_url, 'is_public', up.is_public,
    'owner_user_id', up.owner_user_id, 'is_owner', (up.owner_user_id = v_uid),
    'created_at', up.created_at,
    'creator_name', coalesce(cp.display_name, ou.nickname, ou.full_name, '듣다 사용자'),
    'creator_is_curator', (cp.user_id is not null),
    'creator_handle', cp.handle,
    'total_views', coalesce((select count(*) from public.playlist_qualified_views v where v.playlist_type = 'user' and v.playlist_id = up.id), 0),
    'follower_count', coalesce((select count(*) from public.user_playlist_follows f where f.user_playlist_id = up.id), 0),
    'is_following', exists (select 1 from public.user_playlist_follows f where f.user_playlist_id = up.id and f.user_id = v_uid),
    'tracks', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist, 'genre', t.genre,
        'mood', t.mood, 'audio_url', t.audio_url, 'cover_url', t.cover_url, 'duration', t.duration,
        'created_at', t.created_at, 'order_index', upt.order_index) order by upt.order_index)
      from public.user_playlist_tracks upt join public.tracks t on t.id = upt.track_id
      where upt.user_playlist_id = up.id), '[]'::jsonb)
  ) into v_result
  from public.user_playlists up
  left join public.users ou on ou.id = up.owner_user_id
  left join public.curator_profiles cp on cp.user_id = up.owner_user_id
  where up.id = p_playlist_id;
  return v_result;
end; $$;
revoke execute on function public.get_user_playlist_detail(uuid) from public, anon;
grant execute on function public.get_user_playlist_detail(uuid) to authenticated;
