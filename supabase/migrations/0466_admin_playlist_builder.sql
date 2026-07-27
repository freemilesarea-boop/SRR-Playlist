-- =============================================================================
-- 0466_admin_playlist_builder.sql — Phase AI-PLAYLIST-ADMIN-UX-1
--
-- Admin-assisted Playlist Builder: transactional SAVE + CLONE helpers.
--
-- WHY new RPCs (not new tables): the builder needs (a) an ATOMIC "apply the
-- final track set + order in one shot" on explicit admin Save — the existing
-- PlaylistEditor writes per-row on every drag, which the phase forbids
-- ("Drag 중 DB Update 금지 / 최종 저장 시 순서를 일괄 반영") — and (b) a first-class
-- playlist CLONE (none exists today). Both REUSE the existing playlists /
-- playlist_tracks tables and the existing status('draft'|'released') model.
-- No new tables, no new status model, no recommendation engine.
--
-- SECURITY: SECURITY DEFINER + explicit users.role='admin' gate (same template
--   as 0465). search_path pinned. execute revoked from public/anon, granted to
--   authenticated (the inline gate is the real check — UI hiding is not relied
--   upon). Catalog is global (no per-enterprise partition — see 0460), so these
--   operate on the shared catalog under admin authority only.
--
-- AI never calls these autonomously — they run only from an explicit admin
-- Save/Clone action. Nothing here auto-generates, auto-edits, or auto-deploys.
--
-- NOTE: playlist_tracks in this project has NO soft-delete columns; removal is a
--   hard delete (matches the existing PlaylistEditor semantics).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admin_save_playlist_tracks — atomically apply the final track set + order.
--   Diff vs current rows: delete absent, upsert present with array-position
--   order_index. Deduplicates input preserving first occurrence. One txn.
-- -----------------------------------------------------------------------------
create or replace function public.admin_save_playlist_tracks(
  p_playlist_id uuid,
  p_track_ids   uuid[]
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid     uuid := auth.uid();
  v_is_auto boolean;
  v_ids     uuid[];
  v_count   int;
  v_removed int;
  v_missing int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin_only';
  end if;
  if p_playlist_id is null then raise exception 'playlist_id_required'; end if;

  select is_auto into v_is_auto from public.playlists where id = p_playlist_id;
  if v_is_auto is null then raise exception 'playlist_not_found'; end if;
  if v_is_auto then raise exception 'cannot_edit_auto_playlist'; end if;

  -- Dedupe input, preserving first-occurrence order.
  with pos as (
    select tid, min(ord) as ord
    from unnest(coalesce(p_track_ids, '{}'::uuid[])) with ordinality as u(tid, ord)
    group by tid
  )
  select array_agg(tid order by ord) into v_ids from pos;
  v_ids := coalesce(v_ids, '{}'::uuid[]);

  -- All track ids must exist (clear error instead of FK failure).
  select count(*) into v_missing
  from unnest(v_ids) as x(tid)
  where not exists (select 1 from public.tracks t where t.id = x.tid);
  if v_missing > 0 then raise exception 'unknown_track_ids:%', v_missing; end if;

  -- Remove tracks no longer in the final set (hard delete; <> all('{}') is true → clears all).
  delete from public.playlist_tracks
  where playlist_id = p_playlist_id
    and track_id <> all(v_ids);
  get diagnostics v_removed = row_count;

  -- Upsert final set with array-position order_index.
  insert into public.playlist_tracks (playlist_id, track_id, order_index, placed_by)
  select p_playlist_id, tid, (ord - 1)::int, 'admin'
  from unnest(v_ids) with ordinality as u(tid, ord)
  on conflict (playlist_id, track_id)
  do update set order_index = excluded.order_index;

  v_count := coalesce(array_length(v_ids, 1), 0);
  return jsonb_build_object(
    'playlist_id', p_playlist_id,
    'track_count', v_count,
    'removed',     v_removed,
    'computed_at', now()
  );
end;
$$;

revoke execute on function public.admin_save_playlist_tracks(uuid, uuid[]) from public, anon;
grant  execute on function public.admin_save_playlist_tracks(uuid, uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- admin_clone_playlist — duplicate a playlist's metadata + track list into a new
--   playlist (default draft). The clone is a plain manual playlist (is_auto=false)
--   the admin can then edit. Does NOT deploy or attach to any store.
-- -----------------------------------------------------------------------------
create or replace function public.admin_clone_playlist(
  p_source_playlist_id uuid,
  p_new_title          text,
  p_status             text default 'draft'
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid         uuid := auth.uid();
  v_new_id      uuid;
  v_track_count int;
begin
  if v_uid is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.users u where u.id = v_uid and u.role = 'admin') then
    raise exception 'admin_only';
  end if;
  if p_new_title is null or btrim(p_new_title) = '' then raise exception 'title_required'; end if;
  if p_status not in ('draft', 'released') then raise exception 'invalid_status'; end if;
  if not exists (select 1 from public.playlists where id = p_source_playlist_id) then
    raise exception 'source_not_found';
  end if;

  insert into public.playlists (
    title, category, business_category, description, is_business_only, time_slot,
    sort_order, created_by_user_id, status, mood_tags, situation_tags, genre_tags,
    daypart, bpm_min, bpm_max, energy_min, energy_max, vocal_preference, cover_theme, subtitle
  )
  select p_new_title, category, business_category, description, is_business_only, time_slot,
    sort_order, v_uid, p_status, mood_tags, situation_tags, genre_tags,
    daypart, bpm_min, bpm_max, energy_min, energy_max, vocal_preference, cover_theme, subtitle
  from public.playlists where id = p_source_playlist_id
  returning id into v_new_id;

  insert into public.playlist_tracks (playlist_id, track_id, order_index, placed_by)
  select v_new_id, track_id, order_index, 'admin'
  from public.playlist_tracks where playlist_id = p_source_playlist_id;
  get diagnostics v_track_count = row_count;

  return jsonb_build_object(
    'new_playlist_id',    v_new_id,
    'source_playlist_id', p_source_playlist_id,
    'track_count',        v_track_count,
    'status',             p_status
  );
end;
$$;

revoke execute on function public.admin_clone_playlist(uuid, text, text) from public, anon;
grant  execute on function public.admin_clone_playlist(uuid, text, text) to authenticated;
