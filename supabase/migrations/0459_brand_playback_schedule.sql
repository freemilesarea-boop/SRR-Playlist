-- 0459_brand_playback_schedule.sql
-- Phase BRAND-PLAYLIST-ROTATION-1 — DRAFT (NOT applied to Production; DB runtime verification PENDING).
--
-- Extends the EXISTING franchise music-policy system (franchise_music_policies /
-- franchise_music_policy_slots / franchise_policy_assignments / get_store_active_music_policy)
-- rather than replacing it. All changes are ADDITIVE and default-inert, so franchise stores
-- with no new configuration keep their exact current behavior:
--   • franchise_music_policy_slots.slot_type defaults 'playlist' → existing slots unchanged.
--   • franchise_music_policy_slots.playlist_set_id is nullable/optional → existing slots unchanged.
--   • new tables (franchise_playlist_sets, store_playback_schedule_overrides) start empty.
-- No data backfill, no bulk update, no DROP/TRUNCATE. Rollback = drop the new columns/tables/RPC.
--
-- Break semantics: a slot with slot_type='break' is an intentional silence window; "no matching
-- slot" continues to mean CLOSED (outside operating hours). The resolver below returns
-- mode ∈ {play, break, closed} plus source, playlist_set_id, next_transition_at, timezone —
-- mirroring the unit-tested pure core in src/lib/storePlaybackPolicy.ts.

-- ============================================================
-- A) Curated playlist sets (grouping layer over existing playlists; no track duplication)
-- ============================================================
create table if not exists public.franchise_playlist_sets (
  id             uuid primary key default gen_random_uuid(),
  franchise_id   uuid not null references public.franchises(id) on delete cascade,
  playlist_id    uuid not null references public.playlists(id) on delete restrict,
  name           text not null,
  description    text,
  rotation_order integer not null default 0,
  is_active      boolean not null default true,
  valid_from     date,
  valid_until    date,
  created_by     uuid references auth.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint fps_valid_range check (valid_until is null or valid_from is null or valid_until >= valid_from)
);
create index if not exists idx_fps_franchise_active on public.franchise_playlist_sets(franchise_id) where deleted_at is null and is_active;

-- ============================================================
-- B) Slot additions — break support + optional set reference (additive; existing rows inert)
-- ============================================================
alter table public.franchise_music_policy_slots
  add column if not exists slot_type       text not null default 'playlist',
  add column if not exists playlist_set_id uuid references public.franchise_playlist_sets(id) on delete set null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fmps_slot_type_check') then
    alter table public.franchise_music_policy_slots
      add constraint fmps_slot_type_check check (slot_type in ('playlist','break'));
  end if;
end$$;

-- A 'break' slot has no playlist, so playlist_id must be nullable. Loosen the 0349 NOT NULL and
-- enforce (via CHECK) that only 'playlist' slots require a playlist_id. Existing rows are all
-- slot_type='playlist' with a non-null playlist_id, so the CHECK holds for them.
alter table public.franchise_music_policy_slots alter column playlist_id drop not null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'fmps_playlist_required_for_playlist_type') then
    alter table public.franchise_music_policy_slots
      add constraint fmps_playlist_required_for_playlist_type
      check (slot_type = 'break' or playlist_id is not null);
  end if;
end$$;

-- ============================================================
-- C) Store-level override (timezone + use-brand-schedule toggle). Policy override itself
--    continues to use franchise_policy_assignments(target_type='store'); this table only
--    carries the store's timezone and whether it follows the brand schedule.
-- ============================================================
create table if not exists public.store_playback_schedule_overrides (
  id                 uuid primary key default gen_random_uuid(),
  store_id           uuid not null references public.users(id) on delete cascade,
  use_brand_schedule boolean not null default true,
  timezone           text not null default 'Asia/Seoul',
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (store_id)
);

-- ============================================================
-- D) Resolver — resolve_store_playback_policy(p_store_id, p_at)
--    Reuses the exact store→policy resolution of get_store_active_music_policy
--    (store > region > all assignment priority; active + effective window), then layers
--    break/closed mode, source, set, timezone, and next_transition_at.
-- ============================================================
create or replace function public.resolve_store_playback_policy(
  p_store_id uuid,
  p_at       timestamptz default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_at            timestamptz := coalesce(p_at, now());
  v_tz            text := 'Asia/Seoul';
  v_franchise_id  uuid;
  v_region_id     uuid;
  v_policy_id     uuid;
  v_policy        record;
  v_slot          record;
  v_source        text := 'fallback';
  v_local         timestamp;   -- local wall-clock (no tz); = v_at converted into v_tz
  v_local_time    time;
  v_dow           int;
  v_mode          text;
  v_next          timestamptz := null;
begin
  -- auth: same rule as get_store_active_music_policy
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

  -- store timezone override
  select coalesce(o.timezone, 'Asia/Seoul') into v_tz
    from public.store_playback_schedule_overrides o
   where o.store_id = p_store_id and o.is_active limit 1;
  if v_tz is null then v_tz := 'Asia/Seoul'; end if;

  v_local := v_at at time zone v_tz;
  v_local_time := v_local::time;
  v_dow := extract(isodow from v_local)::int;  -- 월=1 … 일=7

  -- store → franchise
  select fs.franchise_id, fs.region_id into v_franchise_id, v_region_id
    from public.franchise_stores fs
   where fs.store_id = p_store_id and fs.status = 'active' limit 1;

  if v_franchise_id is null then
    return jsonb_build_object('mode','closed','source','fallback','has_franchise_policy',false,
      'timezone',v_tz,'playlist_set_id',null,'playlist_id',null,'next_transition_at',null,'computed_at',v_at);
  end if;

  -- policy priority: store > region > all (source labels store_override vs brand_schedule)
  select a.policy_id into v_policy_id from public.franchise_policy_assignments a
   where a.franchise_id = v_franchise_id and a.target_type='store' and a.target_id = p_store_id
   order by a.applied_at desc limit 1;
  if v_policy_id is not null then v_source := 'store_override'; end if;

  if v_policy_id is null and v_region_id is not null then
    select a.policy_id into v_policy_id from public.franchise_policy_assignments a
     where a.franchise_id = v_franchise_id and a.target_type='region' and a.target_id = v_region_id
     order by a.applied_at desc limit 1;
    if v_policy_id is not null then v_source := 'brand_schedule'; end if;
  end if;
  if v_policy_id is null then
    select a.policy_id into v_policy_id from public.franchise_policy_assignments a
     where a.franchise_id = v_franchise_id and a.target_type='all'
     order by a.applied_at desc limit 1;
    if v_policy_id is not null then v_source := 'brand_schedule'; end if;
  end if;

  if v_policy_id is null then
    return jsonb_build_object('mode','closed','source','fallback','has_franchise_policy',false,
      'franchise_id',v_franchise_id,'timezone',v_tz,'playlist_set_id',null,'playlist_id',null,
      'next_transition_at',null,'computed_at',v_at);
  end if;

  select * into v_policy from public.franchise_music_policies
   where id = v_policy_id and status='active'
     and (effective_from is null or effective_from <= v_at)
     and (effective_until is null or effective_until > v_at);
  if v_policy.id is null then
    return jsonb_build_object('mode','closed','source','fallback','has_franchise_policy',false,
      'franchise_id',v_franchise_id,'timezone',v_tz,'playlist_set_id',null,'playlist_id',null,
      'next_transition_at',null,'computed_at',v_at);
  end if;

  -- match current slot (same predicate as get_store_active_music_policy, incl. midnight cross)
  select * into v_slot from public.franchise_music_policy_slots
   where policy_id = v_policy.id and (v_dow = any(days_of_week))
     and ((start_time <= end_time and v_local_time >= start_time and v_local_time < end_time)
       or (start_time >  end_time and (v_local_time >= start_time or v_local_time < end_time)))
   order by sort_order asc, created_at asc limit 1;

  if v_slot.id is null then
    v_mode := 'closed';
  elsif v_slot.slot_type = 'break' then
    v_mode := 'break';
  else
    v_mode := 'play';
  end if;

  -- next transition: nearest FUTURE slot boundary (start or end), scanning today..+7 days.
  -- Local wall-times are converted to UTC via `at time zone v_tz` (DST-safe). A slot applies on
  -- days where its start-day ISO dow is in days_of_week; a midnight-crossing slot's end falls on
  -- the following calendar day.
  select min(edge_utc) into v_next from (
    -- slot start boundaries
    select ((date_trunc('day', v_local) + make_interval(days => d) + s.start_time) at time zone v_tz) as edge_utc
      from public.franchise_music_policy_slots s
      cross join generate_series(0, 7) as d
     where s.policy_id = v_policy.id
       and (((v_dow - 1 + d) % 7) + 1) = any(s.days_of_week)
    union all
    -- slot end boundaries (crossing slots end on the next calendar day)
    select ((date_trunc('day', v_local) + make_interval(days => d)
              + case when s.end_time > s.start_time then s.end_time else s.end_time + interval '1 day' end
            ) at time zone v_tz)
      from public.franchise_music_policy_slots s
      cross join generate_series(0, 7) as d
     where s.policy_id = v_policy.id
       and (((v_dow - 1 + d) % 7) + 1) = any(s.days_of_week)
  ) cand(edge_utc)
  where edge_utc > v_at;

  return jsonb_build_object(
    'mode', v_mode,
    'source', v_source,
    'has_franchise_policy', true,
    'franchise_id', v_franchise_id,
    'policy_id', v_policy.id,
    'policy_name', v_policy.name,
    'timezone', v_tz,
    'matched_slot', case when v_slot.id is null then null else jsonb_build_object(
        'id', v_slot.id, 'slot_name', v_slot.slot_name, 'slot_type', v_slot.slot_type,
        'start_time', v_slot.start_time, 'end_time', v_slot.end_time,
        'days_of_week', v_slot.days_of_week) end,
    'playlist_set_id', v_slot.playlist_set_id,
    'playlist_id', v_slot.playlist_id,
    'effective_from', v_policy.effective_from,
    'effective_until', v_policy.effective_until,
    'next_transition_at', v_next,
    'computed_at', v_at
  );
end $$;

revoke all on function public.resolve_store_playback_policy(uuid, timestamptz) from public, anon;
grant execute on function public.resolve_store_playback_policy(uuid, timestamptz) to authenticated;
