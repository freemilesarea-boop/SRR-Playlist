-- 0460_brand_playlist_management_access.sql
-- Phase BRAND-PLAYLIST-MGMT-RPC-1 — DRAFT (Test-DB certification; NOT applied to Production).
--
-- Adds the missing MANAGEMENT + RLS access layer for the 0459 tables so HQ/Franchise admins and
-- store users can manage playlist sets / schedule slots (incl. break + set) / store overrides
-- WITHOUT direct service-role access. Does NOT modify 0459 or any existing function/table.
--
-- Design decisions (certified below):
--  • franchise_playlist_sets, store_playback_schedule_overrides: RLS enabled; authenticated gets
--    SELECT grant only → direct READS are franchise-scoped via RLS; direct WRITES are blocked
--    (no write grant) so all writes go through the SECURITY DEFINER RPCs here (RPC-only writes).
--  • playlists is a GLOBAL catalog (not franchise-scoped) → no per-franchise restriction on
--    playlist_id; same-franchise enforcement applies to playlist_set_id (sets ARE franchise-scoped).
--  • Store-self override write is limited to timezone + use_brand_schedule (never is_active/store_id).
--  • Timezone validated against pg_timezone_names (not a hardcoded allowlist).
--  • Audit: reuses public.admin_log_operation (logs for super-admin/service-role callers). NOTE:
--    that RPC's caller-gate means FRANCHISE-ADMIN actions are not logged today — see report §16.

-- ============================================================
-- A) RLS — franchise_playlist_sets
-- ============================================================
alter table public.franchise_playlist_sets enable row level security;
drop policy if exists fps_select on public.franchise_playlist_sets;
create policy fps_select on public.franchise_playlist_sets
  for select using (public._is_super_admin() or public._is_franchise_admin(franchise_id));
drop policy if exists fps_write on public.franchise_playlist_sets;
create policy fps_write on public.franchise_playlist_sets
  for all using (public._is_super_admin() or public._is_franchise_admin(franchise_id))
  with check (public._is_super_admin() or public._is_franchise_admin(franchise_id));
grant select on public.franchise_playlist_sets to authenticated;  -- reads only; writes via RPC

-- ============================================================
-- B) RLS — store_playback_schedule_overrides
-- ============================================================
alter table public.store_playback_schedule_overrides enable row level security;
drop policy if exists spso_select on public.store_playback_schedule_overrides;
create policy spso_select on public.store_playback_schedule_overrides
  for select using (
    public._is_super_admin()
    or store_id = auth.uid()
    or exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = store_playback_schedule_overrides.store_id)
  );
drop policy if exists spso_write on public.store_playback_schedule_overrides;
create policy spso_write on public.store_playback_schedule_overrides
  for all using (
    public._is_super_admin()
    or exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = store_playback_schedule_overrides.store_id)
  ) with check (
    public._is_super_admin()
    or exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = store_playback_schedule_overrides.store_id)
  );
grant select on public.store_playback_schedule_overrides to authenticated;  -- reads only; writes via RPC

-- ============================================================
-- Helper: audit (reuses admin_log_operation; no-op for non-admin callers — see report)
-- ============================================================
-- (used inline via perform below)

-- ============================================================
-- C) Playlist Set — list / upsert / archive / restore
-- ============================================================
create or replace function public.admin_list_franchise_playlist_sets(
  p_franchise_id uuid, p_include_deleted boolean default false
) returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(x order by (x->>'rotation_order')::int, x->>'created_at', x->>'id'), '[]'::jsonb) into v_rows
  from (
    select jsonb_build_object(
      'id', s.id, 'franchise_id', s.franchise_id, 'playlist_id', s.playlist_id,
      'playlist_title', p.title, 'name', s.name, 'description', s.description,
      'rotation_order', s.rotation_order, 'is_active', s.is_active,
      'valid_from', s.valid_from, 'valid_until', s.valid_until,
      'deleted_at', s.deleted_at, 'created_at', s.created_at, 'updated_at', s.updated_at,
      'status', case
        when s.deleted_at is not null then 'deleted'
        when not s.is_active then 'inactive'
        when s.valid_from is not null and s.valid_from > current_date then 'scheduled'
        when s.valid_until is not null and s.valid_until < current_date then 'expired'
        else 'active' end
    ) as x
    from public.franchise_playlist_sets s
    left join public.playlists p on p.id = s.playlist_id
    where s.franchise_id = p_franchise_id
      and (p_include_deleted or s.deleted_at is null)
  ) t;
  return jsonb_build_object('success', true, 'data', v_rows);
end $$;

create or replace function public.admin_upsert_franchise_playlist_set(
  p_franchise_id uuid, p_playlist_id uuid, p_name text, p_description text,
  p_rotation_order integer, p_is_active boolean,
  p_valid_from date, p_valid_until date, p_set_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_id uuid; v_existing_franchise uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then raise exception 'forbidden'; end if;
  if coalesce(nullif(btrim(p_name), ''), '') = '' then raise exception 'name required'; end if;
  if not exists (select 1 from public.playlists where id = p_playlist_id) then raise exception 'playlist not found: %', p_playlist_id; end if;
  if p_rotation_order is null or p_rotation_order < 0 then raise exception 'rotation_order must be >= 0'; end if;
  if p_valid_from is not null and p_valid_until is not null and p_valid_until < p_valid_from then
    raise exception 'valid_from must be <= valid_until'; end if;

  if p_set_id is null then
    insert into public.franchise_playlist_sets
      (franchise_id, playlist_id, name, description, rotation_order, is_active, valid_from, valid_until, created_by)
    values (p_franchise_id, p_playlist_id, btrim(p_name), p_description, p_rotation_order,
            coalesce(p_is_active, true), p_valid_from, p_valid_until, auth.uid())
    returning id into v_id;
  else
    -- guard: cannot move a set across franchises
    select franchise_id into v_existing_franchise from public.franchise_playlist_sets where id = p_set_id and deleted_at is null;
    if v_existing_franchise is null then raise exception 'playlist set not found: %', p_set_id; end if;
    if v_existing_franchise <> p_franchise_id then raise exception 'forbidden: cross-franchise set'; end if;
    update public.franchise_playlist_sets set
      playlist_id = p_playlist_id, name = btrim(p_name), description = p_description,
      rotation_order = p_rotation_order, is_active = coalesce(p_is_active, is_active),
      valid_from = p_valid_from, valid_until = p_valid_until, updated_at = now()
    where id = p_set_id
    returning id into v_id;
  end if;

  perform public.admin_log_operation('enterprise_operations','brand_playlist_mgmt','info','success',
    'playlist_set_upsert', jsonb_build_object('franchise_id',p_franchise_id,'set_id',v_id,'new', p_set_id is null),
    auth.uid(), v_id::text);
  return jsonb_build_object('success', true, 'id', v_id);
end $$;

create or replace function public.admin_archive_franchise_playlist_set(p_set_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_franchise uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise from public.franchise_playlist_sets where id = p_set_id;
  if v_franchise is null then raise exception 'playlist set not found: %', p_set_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise)) then raise exception 'forbidden'; end if;
  -- soft delete (idempotent). Referencing slots keep the id; the rotation layer excludes deleted/inactive sets.
  update public.franchise_playlist_sets set deleted_at = coalesce(deleted_at, now()), is_active = false, updated_at = now()
   where id = p_set_id;
  perform public.admin_log_operation('enterprise_operations','brand_playlist_mgmt','info','success',
    'playlist_set_archive', jsonb_build_object('set_id',p_set_id), auth.uid(), p_set_id::text);
  return jsonb_build_object('success', true, 'id', p_set_id, 'archived', true);
end $$;

create or replace function public.admin_restore_franchise_playlist_set(p_set_id uuid)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_franchise uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise from public.franchise_playlist_sets where id = p_set_id;
  if v_franchise is null then raise exception 'playlist set not found: %', p_set_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise)) then raise exception 'forbidden'; end if;
  update public.franchise_playlist_sets set deleted_at = null, updated_at = now() where id = p_set_id;
  perform public.admin_log_operation('enterprise_operations','brand_playlist_mgmt','info','success',
    'playlist_set_restore', jsonb_build_object('set_id',p_set_id), auth.uid(), p_set_id::text);
  return jsonb_build_object('success', true, 'id', p_set_id, 'restored', true);
end $$;

-- ============================================================
-- D) Store Override — list (HQ) / my (store) / upsert (HQ) / upsert-my (store)
-- ============================================================
create or replace function public.admin_list_store_playback_overrides(p_franchise_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(p_franchise_id)) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'store_id', fs.store_id, 'store_name', fs.store_name, 'region_id', fs.region_id,
    'use_brand_schedule', o.use_brand_schedule, 'timezone', o.timezone,
    'is_active', o.is_active, 'updated_at', o.updated_at,
    'has_override', (o.store_id is not null)
  ) order by fs.store_name), '[]'::jsonb) into v_rows
  from public.franchise_stores fs
  left join public.store_playback_schedule_overrides o on o.store_id = fs.store_id
  where fs.franchise_id = p_franchise_id;
  return jsonb_build_object('success', true, 'data', v_rows);
end $$;

create or replace function public.get_my_store_playback_override()
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_row public.store_playback_schedule_overrides;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.franchise_stores where store_id = auth.uid()) then
    raise exception 'forbidden: not a store'; end if;
  select * into v_row from public.store_playback_schedule_overrides where store_id = auth.uid();
  return jsonb_build_object('success', true,
    'store_id', auth.uid(),
    'override', case when v_row.store_id is null then null else jsonb_build_object(
      'use_brand_schedule', v_row.use_brand_schedule, 'timezone', v_row.timezone,
      'is_active', v_row.is_active, 'updated_at', v_row.updated_at) end);
end $$;

create or replace function public.admin_upsert_store_playback_override(
  p_store_id uuid, p_use_brand_schedule boolean, p_timezone text, p_is_active boolean
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_franchise uuid;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select fs.franchise_id into v_franchise from public.franchise_stores fs where fs.store_id = p_store_id limit 1;
  if v_franchise is null then raise exception 'store not found or not in a franchise: %', p_store_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise)) then raise exception 'forbidden'; end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone: %', p_timezone; end if;
  insert into public.store_playback_schedule_overrides (store_id, use_brand_schedule, timezone, is_active)
  values (p_store_id, coalesce(p_use_brand_schedule, true), p_timezone, coalesce(p_is_active, true))
  on conflict (store_id) do update set
    use_brand_schedule = excluded.use_brand_schedule, timezone = excluded.timezone,
    is_active = excluded.is_active, updated_at = now();
  perform public.admin_log_operation('enterprise_operations','brand_playlist_mgmt','info','success',
    'store_override_upsert', jsonb_build_object('store_id',p_store_id,'timezone',p_timezone), auth.uid(), p_store_id::text);
  return jsonb_build_object('success', true, 'store_id', p_store_id);
end $$;

-- Store-self: may set ONLY timezone + use_brand_schedule for their OWN store. Never is_active/store_id.
create or replace function public.upsert_my_store_playback_override(
  p_use_brand_schedule boolean, p_timezone text
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_store uuid := auth.uid();
begin
  if v_store is null then raise exception 'unauthorized'; end if;
  if not exists (select 1 from public.franchise_stores where store_id = v_store) then
    raise exception 'forbidden: not a store'; end if;
  if p_timezone is null or not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid timezone: %', p_timezone; end if;
  insert into public.store_playback_schedule_overrides (store_id, use_brand_schedule, timezone, is_active)
  values (v_store, coalesce(p_use_brand_schedule, true), p_timezone, true)
  on conflict (store_id) do update set
    use_brand_schedule = excluded.use_brand_schedule, timezone = excluded.timezone, updated_at = now();
    -- NOTE: is_active intentionally NOT modified on store-self update.
  return jsonb_build_object('success', true, 'store_id', v_store);
end $$;

-- ============================================================
-- E) Slot V2 — supports slot_type + playlist_set_id (break/playlist/set); + list
-- ============================================================
create or replace function public.admin_upsert_franchise_slot_v2(
  p_policy_id uuid, p_slot_name text, p_start_time time, p_end_time time,
  p_slot_type text, p_playlist_id uuid, p_playlist_set_id uuid,
  p_days_of_week integer[], p_sort_order integer, p_slot_id uuid default null
) returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_franchise uuid; v_set_franchise uuid; v_set_playlist uuid; v_id uuid; v_d int;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise from public.franchise_music_policies where id = p_policy_id;
  if v_franchise is null then raise exception 'policy not found: %', p_policy_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise)) then raise exception 'forbidden'; end if;
  if p_slot_type not in ('playlist','break') then raise exception 'invalid slot_type: %', p_slot_type; end if;
  if p_days_of_week is null or array_length(p_days_of_week,1) is null then raise exception 'days_of_week required'; end if;
  foreach v_d in array p_days_of_week loop
    if v_d < 1 or v_d > 7 then raise exception 'invalid day_of_week: %', v_d; end if;
  end loop;
  if p_sort_order is null or p_sort_order < 0 then raise exception 'sort_order must be >= 0'; end if;

  if p_slot_type = 'break' then
    if p_playlist_id is not null or p_playlist_set_id is not null then
      raise exception 'break slot must have null playlist_id and playlist_set_id'; end if;
  else -- playlist
    if p_playlist_id is null then raise exception 'playlist slot requires playlist_id'; end if;
    if not exists (select 1 from public.playlists where id = p_playlist_id) then
      raise exception 'playlist not found: %', p_playlist_id; end if;
    if p_playlist_set_id is not null then
      select franchise_id, playlist_id into v_set_franchise, v_set_playlist
        from public.franchise_playlist_sets where id = p_playlist_set_id and deleted_at is null;
      if v_set_franchise is null then raise exception 'playlist set not found: %', p_playlist_set_id; end if;
      if v_set_franchise <> v_franchise then raise exception 'forbidden: cross-franchise playlist set'; end if;
      if v_set_playlist <> p_playlist_id then raise exception 'slot playlist_id must match its playlist set playlist'; end if;
    end if;
  end if;

  if p_slot_id is null then
    insert into public.franchise_music_policy_slots
      (policy_id, slot_name, start_time, end_time, slot_type, playlist_id, playlist_set_id, days_of_week, sort_order)
    values (p_policy_id, p_slot_name, p_start_time, p_end_time, p_slot_type, p_playlist_id, p_playlist_set_id, p_days_of_week, p_sort_order)
    returning id into v_id;
  else
    update public.franchise_music_policy_slots set
      slot_name = p_slot_name, start_time = p_start_time, end_time = p_end_time, slot_type = p_slot_type,
      playlist_id = p_playlist_id, playlist_set_id = p_playlist_set_id, days_of_week = p_days_of_week, sort_order = p_sort_order
    where id = p_slot_id and policy_id = p_policy_id
    returning id into v_id;
    if v_id is null then raise exception 'slot not found: %', p_slot_id; end if;
  end if;

  perform public.admin_log_operation('enterprise_operations','brand_playlist_mgmt','info','success',
    'slot_v2_upsert', jsonb_build_object('policy_id',p_policy_id,'slot_id',v_id,'slot_type',p_slot_type), auth.uid(), v_id::text);
  return jsonb_build_object('success', true, 'id', v_id);
end $$;

create or replace function public.admin_list_franchise_policy_slots(p_policy_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v_franchise uuid; v_rows jsonb;
begin
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  select franchise_id into v_franchise from public.franchise_music_policies where id = p_policy_id;
  if v_franchise is null then raise exception 'policy not found: %', p_policy_id; end if;
  if not (public._is_super_admin() or public._is_franchise_admin(v_franchise)) then raise exception 'forbidden'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'slot_id', s.id, 'slot_name', s.slot_name, 'days_of_week', s.days_of_week,
    'start_time', s.start_time, 'end_time', s.end_time, 'slot_type', s.slot_type,
    'playlist_id', s.playlist_id, 'playlist_title', p.title,
    'playlist_set_id', s.playlist_set_id, 'playlist_set_name', ps.name,
    'sort_order', s.sort_order, 'created_at', s.created_at
  ) order by s.sort_order, s.created_at), '[]'::jsonb) into v_rows
  from public.franchise_music_policy_slots s
  left join public.playlists p on p.id = s.playlist_id
  left join public.franchise_playlist_sets ps on ps.id = s.playlist_set_id
  where s.policy_id = p_policy_id;
  return jsonb_build_object('success', true, 'data', v_rows);
end $$;

-- ============================================================
-- Grants: authenticated only; each function enforces auth internally.
-- ============================================================
do $$
declare fn text;
begin
  foreach fn in array array[
    'admin_list_franchise_playlist_sets(uuid,boolean)',
    'admin_upsert_franchise_playlist_set(uuid,uuid,text,text,integer,boolean,date,date,uuid)',
    'admin_archive_franchise_playlist_set(uuid)',
    'admin_restore_franchise_playlist_set(uuid)',
    'admin_list_store_playback_overrides(uuid)',
    'get_my_store_playback_override()',
    'admin_upsert_store_playback_override(uuid,boolean,text,boolean)',
    'upsert_my_store_playback_override(boolean,text)',
    'admin_upsert_franchise_slot_v2(uuid,text,time,time,text,uuid,uuid,integer[],integer,uuid)',
    'admin_list_franchise_policy_slots(uuid)'
  ] loop
    execute format('revoke all on function public.%s from public, anon;', fn);
    execute format('grant execute on function public.%s to authenticated;', fn);
  end loop;
end $$;
