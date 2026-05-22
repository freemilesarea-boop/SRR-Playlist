-- 0115 — 자동 배치 관리자 조회/편집 RPC

create or replace function public.admin_list_auto_playlists()
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', p.id, 'title', p.title, 'subtitle', p.subtitle,
    'business_category', p.business_category, 'daypart', p.daypart,
    'mood_tags', p.mood_tags, 'genre_tags', p.genre_tags,
    'bpm_min', p.bpm_min, 'bpm_max', p.bpm_max, 'energy_min', p.energy_min, 'energy_max', p.energy_max,
    'vocal_preference', p.vocal_preference, 'priority_score', p.priority_score, 'status', p.status,
    'track_count', (select count(*) from public.playlist_tracks pt where pt.playlist_id=p.id),
    'auto_count', (select count(*) from public.playlist_tracks pt where pt.playlist_id=p.id and pt.placed_by='auto')
  ) order by p.priority_score desc, p.title), '[]'::jsonb)
  into v from public.playlists p where p.is_auto_generated = true;
  return v;
end; $function$;
grant execute on function public.admin_list_auto_playlists() to authenticated;

create or replace function public.admin_playlist_placed_tracks(p_playlist_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'track_id', t.id, 'title', t.title, 'artist', t.artist, 'cover_url', t.cover_url,
    'match_score', pt.match_score, 'placement_reason', pt.placement_reason, 'placed_by', pt.placed_by,
    'order_index', pt.order_index, 'release_status', t.release_status
  ) order by pt.order_index), '[]'::jsonb)
  into v
  from public.playlist_tracks pt join public.tracks t on t.id = pt.track_id
  where pt.playlist_id = p_playlist_id;
  return v;
end; $function$;
grant execute on function public.admin_playlist_placed_tracks(uuid) to authenticated;

create or replace function public.admin_add_track_to_playlist(p_playlist_id uuid, p_track_id uuid, p_reason text default null)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  insert into public.playlist_tracks(playlist_id, track_id, order_index, placement_reason, placed_by)
  values (p_playlist_id, p_track_id,
    coalesce((select max(order_index)+1 from public.playlist_tracks where playlist_id=p_playlist_id),0),
    coalesce(nullif(btrim(p_reason),''), '관리자 수동 추가'), 'admin')
  on conflict (playlist_id, track_id) do update set placed_by='admin',
    placement_reason = coalesce(nullif(btrim(p_reason),''), public.playlist_tracks.placement_reason);
  return jsonb_build_object('ok', true);
end; $function$;
grant execute on function public.admin_add_track_to_playlist(uuid, uuid, text) to authenticated;

create or replace function public.admin_remove_placed_track(p_playlist_id uuid, p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $function$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then raise exception 'admin only'; end if;
  delete from public.playlist_tracks where playlist_id=p_playlist_id and track_id=p_track_id;
  return jsonb_build_object('ok', true);
end; $function$;
grant execute on function public.admin_remove_placed_track(uuid, uuid) to authenticated;
