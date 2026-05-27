-- "어디서든 내 플레이리스트에 담기" UX 지원 RPC.
-- additive: CREATE OR REPLACE 만. 데이터 UPDATE 없음. release_status/stream_events·정산 무접근.
-- 중복방지는 기존 UNIQUE(user_playlist_id, track_id) + 본 함수의 exists 체크로 이중 보장.

-- 곡이 플레이리스트에 담길 수 있는 상태인지(승인/미삭제/공개가능/오디오 보유) 판정하는 헬퍼.
create or replace function public._track_is_addable(p_track_id uuid)
returns boolean language sql stable security definer set search_path to 'public'
as $$
  select exists (
    select 1 from public.tracks t
    where t.id = p_track_id
      and t.visibility_status = 'approved'
      and t.removed_at is null
      and (t.release_status = 'released' or t.source_type = 'admin_upload')
      and t.audio_url is not null and length(btrim(t.audio_url)) > 0
  );
$$;

-- 1) 특정 곡 기준, 내 플레이리스트 목록 + 이미 포함 여부.
create or replace function public.list_my_playlists_for_add(p_track_id uuid)
returns table(playlist_id uuid, title text, track_count bigint, is_public boolean, already_contains_track boolean)
language sql stable security definer set search_path to 'public'
as $$
  select up.id, up.title,
    coalesce((select count(*)::bigint from public.user_playlist_tracks t where t.user_playlist_id = up.id), 0),
    up.is_public,
    exists (select 1 from public.user_playlist_tracks t2 where t2.user_playlist_id = up.id and t2.track_id = p_track_id)
  from public.user_playlists up
  where up.owner_user_id = auth.uid()
  order by up.updated_at desc;
$$;

-- 2) 곡을 내 플레이리스트에 추가 (소유권/중복/유효성/순서 보장). 기존 함수 시그니처·반환형 유지하며 유효성 가드 추가.
create or replace function public.add_track_to_user_playlist(p_playlist_id uuid, p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_owner uuid; v_next int;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  select owner_user_id into v_owner from public.user_playlists where id = p_playlist_id;
  if v_owner is null then raise exception 'playlist not found'; end if;
  if v_owner <> v_uid then raise exception 'forbidden'; end if;
  if not public._track_is_addable(p_track_id) then
    raise exception '담을 수 없는 곡입니다 (미승인/삭제/재생불가)';
  end if;
  if exists (select 1 from public.user_playlist_tracks where user_playlist_id = p_playlist_id and track_id = p_track_id) then
    return jsonb_build_object('ok', true, 'already', true);
  end if;
  select coalesce(max(order_index), -1) + 1 into v_next from public.user_playlist_tracks where user_playlist_id = p_playlist_id;
  insert into public.user_playlist_tracks (user_playlist_id, track_id, order_index)
  values (p_playlist_id, p_track_id, v_next)
  on conflict (user_playlist_id, track_id) do nothing;
  update public.user_playlists set updated_at = now() where id = p_playlist_id;
  return jsonb_build_object('ok', true, 'already', false, 'order_index', v_next);
end; $function$;

-- 3) 새 플레이리스트 생성 + 곡 추가 (원자적).
create or replace function public.create_my_playlist_and_add_track(p_title text, p_is_public boolean, p_track_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_id uuid;
begin
  if v_uid is null then raise exception 'unauthorized'; end if;
  if p_title is null or length(btrim(p_title)) = 0 then raise exception 'title required'; end if;
  if not public._track_is_addable(p_track_id) then
    raise exception '담을 수 없는 곡입니다 (미승인/삭제/재생불가)';
  end if;
  insert into public.user_playlists (owner_user_id, title, is_public)
  values (v_uid, btrim(p_title), coalesce(p_is_public, false))
  returning id into v_id;
  insert into public.user_playlist_tracks (user_playlist_id, track_id, order_index)
  values (v_id, p_track_id, 0)
  on conflict (user_playlist_id, track_id) do nothing;
  return jsonb_build_object('ok', true, 'playlist_id', v_id, 'already', false);
end; $function$;

grant execute on function public._track_is_addable(uuid) to authenticated;
grant execute on function public.list_my_playlists_for_add(uuid) to authenticated;
grant execute on function public.add_track_to_user_playlist(uuid, uuid) to authenticated;
grant execute on function public.create_my_playlist_and_add_track(text, boolean, uuid) to authenticated;
