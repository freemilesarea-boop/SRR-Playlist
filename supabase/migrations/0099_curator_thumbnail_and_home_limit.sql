-- 0099 — 큐레이터 후속 안정화: released 썸네일 편집 허용 + 홈 추천 큐레이터당 제한

-- 1) released 상태 썸네일 전용 수정 RPC (thumbnail_url 만, 본인 curator 또는 admin)
create or replace function public.update_curator_playlist_thumbnail(
  p_playlist_id uuid,
  p_thumbnail_url text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_owner uuid;
  v_is_admin boolean;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select created_by_user_id into v_owner from public.playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;
  v_is_admin := exists (select 1 from public.users where id = v_uid and role = 'admin');
  if not v_is_admin then
    if v_owner <> v_uid then raise exception 'forbidden'; end if;
    if not exists (select 1 from public.users where id = v_uid and is_curator = true) then
      raise exception 'not a curator';
    end if;
  end if;
  update public.playlists set thumbnail_url = p_thumbnail_url where id = p_playlist_id;
  begin
    perform admin_log_operation('curator_actions', 'content', 'info', 'completed',
      format('update playlist thumbnail %s', p_playlist_id),
      jsonb_build_object('playlist_id', p_playlist_id, 'by', v_uid, 'is_admin', v_is_admin),
      v_uid, p_playlist_id::text, null, null, null);
  exception when others then null; end;
  return jsonb_build_object('ok', true, 'thumbnail_url', p_thumbnail_url);
end;
$$;
revoke execute on function public.update_curator_playlist_thumbnail(uuid, text) from public, anon;
grant execute on function public.update_curator_playlist_thumbnail(uuid, text) to authenticated;

-- 2) 홈 추천 — 큐레이터당 최대 2개 (ROW_NUMBER partition), 다양성 우선
create or replace function public.get_curator_made_playlists(p_limit int default 8)
returns table(
  id uuid, title text, category text, thumbnail_url text,
  curator_user_id uuid, curator_handle text, curator_name text,
  released_at timestamptz, follower_count bigint
)
language sql stable security definer set search_path = public as $$
  with ranked as (
    select p.id, p.title, p.category, p.thumbnail_url,
           p.created_by_user_id as curator_user_id,
           cp.handle as curator_handle, cp.display_name as curator_name,
           p.released_at,
           coalesce((select count(*)::bigint from public.playlist_follows pf where pf.playlist_id = p.id), 0) as follower_count,
           row_number() over (partition by p.created_by_user_id order by p.released_at desc nulls last) as rn
    from public.playlists p
    join public.users u on u.id = p.created_by_user_id and u.is_curator = true
    left join public.curator_profiles cp on cp.user_id = p.created_by_user_id
    where p.status = 'released'
  )
  select id, title, category, thumbnail_url, curator_user_id, curator_handle, curator_name, released_at, follower_count
  from ranked
  where rn <= 2
  order by released_at desc nulls last
  limit greatest(1, least(p_limit, 30));
$$;
grant execute on function public.get_curator_made_playlists(int) to anon, authenticated;
