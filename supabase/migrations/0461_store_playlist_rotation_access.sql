-- 0461_store_playlist_rotation_access.sql
-- Phase BRAND-PLAYLIST-ROTATION-4B — DRAFT (Test-DB certification; NOT applied to Production).
--
-- Adds a STORE-SCOPED, read-only RPC that lets a store player fetch the curated-playlist-set
-- "rotation pool" it is allowed to see — WITHOUT opening any direct table SELECT to store users
-- and WITHOUT touching 0459/0460, the resolver, or any existing RPC signature.
--
-- Why this exists: `franchise_playlist_sets` RLS (0460 fps_select) and admin_list_franchise_playlist_sets
-- both restrict reads to super-admin / franchise-admin, so a store user cannot read the set pool, and
-- resolve_store_playback_policy returns only the single set for the current instant. Runtime rotation
-- across sets therefore needs a dedicated, ownership-checked read path — provided here.
--
-- Design (mirrors resolve_store_playback_policy exactly):
--   • SECURITY DEFINER, search_path pinned to public, anon/public EXECUTE revoked, authenticated only.
--   • auth.uid() required; the client-supplied p_store_id is NEVER trusted — access is granted only to
--     the store's own user (auth.uid() = p_store_id), the franchise's admins, or a super admin.
--   • Franchise is resolved server-side from franchise_stores (status='active'); the client never
--     supplies a franchise id.
--   • Pool = the store's franchise's sets that are eligible RIGHT NOW: not deleted, active, within the
--     valid_from/valid_until window (evaluated in the store's timezone), with an existing RELEASED
--     playlist. inactive / deleted / future / expired / draft-playlist / other-franchise rows are excluded.
--   • Deterministic order: rotation_order ASC, created_at ASC, id ASC.
--   • No DDL on existing tables, no data backfill, no row mutation, no RLS relaxation, no dynamic SQL.

-- Optional supporting index for the pool lookup (idempotent; matches the eligibility predicate shape).
create index if not exists idx_fps_franchise_rotation
  on public.franchise_playlist_sets (franchise_id, rotation_order, created_at, id)
  where deleted_at is null and is_active;

create or replace function public.get_store_playlist_rotation_pool(
  p_store_id uuid,
  p_at       timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_at           timestamptz := coalesce(p_at, now());
  v_tz           text := 'Asia/Seoul';
  v_franchise_id uuid;
  v_local_date   date;
  v_rows         jsonb;
begin
  -- auth: identical rule to resolve_store_playback_policy (never trust p_store_id).
  if auth.uid() is null then raise exception 'unauthorized'; end if;
  if not (public._is_super_admin() or auth.uid() = p_store_id) then
    if not exists (
      select 1 from public.franchise_stores fs
        join public.franchise_admins fa on fa.franchise_id = fs.franchise_id and fa.user_id = auth.uid()
       where fs.store_id = p_store_id
    ) then
      raise exception 'forbidden';
    end if;
  end if;

  -- store timezone override (same as the resolver) → validity windows evaluated in local calendar date.
  select coalesce(o.timezone, 'Asia/Seoul') into v_tz
    from public.store_playback_schedule_overrides o
   where o.store_id = p_store_id and o.is_active limit 1;
  if v_tz is null then v_tz := 'Asia/Seoul'; end if;
  v_local_date := (v_at at time zone v_tz)::date;

  -- store → franchise (server-resolved; client never supplies franchise id).
  select fs.franchise_id into v_franchise_id
    from public.franchise_stores fs
   where fs.store_id = p_store_id and fs.status = 'active' limit 1;

  if v_franchise_id is null then
    return jsonb_build_object('success', true, 'franchise_id', null,
      'timezone', v_tz, 'computed_at', v_at, 'data', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(x order by (x->>'rotation_order')::int, x->>'created_at', x->>'id'), '[]'::jsonb)
    into v_rows
  from (
    select jsonb_build_object(
      'playlist_set_id', s.id,
      'playlist_id',     s.playlist_id,
      'name',            s.name,
      'rotation_order',  s.rotation_order,
      'is_active',       s.is_active,
      'valid_from',      s.valid_from,
      'valid_until',     s.valid_until,
      'franchise_id',    s.franchise_id,
      'created_at',      s.created_at
    ) as x
    from public.franchise_playlist_sets s
    join public.playlists p on p.id = s.playlist_id
    where s.franchise_id = v_franchise_id
      and s.deleted_at is null
      and s.is_active
      and (s.valid_from is null or s.valid_from <= v_local_date)
      and (s.valid_until is null or s.valid_until >= v_local_date)
      and p.status = 'released'
  ) t;

  return jsonb_build_object(
    'success', true,
    'franchise_id', v_franchise_id,
    'timezone', v_tz,
    'computed_at', v_at,
    'data', v_rows
  );
end $$;

revoke all on function public.get_store_playlist_rotation_pool(uuid, timestamptz) from public, anon;
grant execute on function public.get_store_playlist_rotation_pool(uuid, timestamptz) to authenticated;
