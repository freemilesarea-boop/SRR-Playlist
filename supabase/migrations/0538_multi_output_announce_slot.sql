-- 0538_multi_output_announce_slot.sql
--
-- 분리 송출 — "안내방송 전용" 플레이어.
--
-- 왜
--   음악 없이 안내멘트만 나와야 하는 공간이 있다(복도·화장실·대기 공간 등).
--   플레이어 역할에 announce 를 더한다. 그 창은 음악을 틀지 않고 안내·긴급방송만 낸다.
--
-- 바뀌는 것
--   · multi_output_config.slots[].mode 에 'announce' 허용. 최대 1개.
--     announce 가 있으면 announcement_slot 은 자동으로 그 번호다.
--   · store_output_slot_status.mode / output_slot_heartbeat 가 'announce' 를 받는다.

create or replace function public._normalize_multi_output_config(p_config jsonb)
returns jsonb
language plpgsql
immutable
as $$
declare
  v_slots jsonb := '[]'::jsonb;
  v_item jsonb;
  v_slot int;
  v_mode text;
  v_source text;
  v_category text;
  v_seen int[] := '{}';
  v_ann int;
  v_active int[] := '{}';
  v_announce int[] := '{}';
begin
  if p_config is null or jsonb_typeof(p_config) <> 'object' then
    raise exception 'invalid_config';
  end if;
  if jsonb_typeof(coalesce(p_config->'slots', 'null'::jsonb)) <> 'array' then
    raise exception 'invalid_slots';
  end if;

  for v_item in select * from jsonb_array_elements(p_config->'slots') loop
    begin
      v_slot := (v_item->>'slot')::int;
    exception when others then
      raise exception 'invalid_slot';
    end;
    if v_slot is null or v_slot < 1 or v_slot > 3 or v_slot = any(v_seen) then
      raise exception 'invalid_slot';
    end if;
    v_seen := v_seen || v_slot;

    v_mode := coalesce(v_item->>'mode', 'off');
    if v_mode not in ('brand', 'store', 'announce', 'off') then
      raise exception 'invalid_mode';
    end if;

    v_source := null;
    v_category := null;
    if v_mode = 'store' then
      v_source := coalesce(v_item->>'source', 'schedule');
      if v_source not in ('schedule', 'category') then
        raise exception 'invalid_source';
      end if;
      if v_source = 'category' then
        v_category := left(nullif(btrim(coalesce(v_item->>'category', '')), ''), 40);
        if v_category is null then
          raise exception 'category_required';
        end if;
      end if;
    end if;
    if v_mode <> 'off' then
      v_active := v_active || v_slot;
    end if;
    if v_mode = 'announce' then
      v_announce := v_announce || v_slot;
    end if;

    v_slots := v_slots || jsonb_strip_nulls(jsonb_build_object(
      'slot', v_slot, 'mode', v_mode, 'source', v_source, 'category', v_category));
  end loop;

  if cardinality(v_active) = 0 then
    raise exception 'no_active_slot';
  end if;

  begin
    v_ann := coalesce((p_config->>'announcement_slot')::int, v_active[1]);
  exception when others then
    raise exception 'invalid_announcement_slot';
  end;
  if not (v_ann = any(v_active)) then
    raise exception 'invalid_announcement_slot';
  end if;
  -- 안내방송 전용 플레이어는 하나만, 그리고 안내방송은 반드시 그 창에서 나간다
  -- (전용 창을 두고 다른 창에서 안내가 나가면 전용 창이 아무 소리도 안 내는 창이 된다).
  if cardinality(v_announce) > 1 then
    raise exception 'multiple_announce_slots';
  end if;
  if cardinality(v_announce) = 1 then
    v_ann := v_announce[1];
  end if;

  return jsonb_build_object('slots', v_slots, 'announcement_slot', v_ann);
end;
$$;


do $$
declare
  v_name text;
begin
  select c.conname into v_name
  from pg_constraint c
  where c.conrelid = 'public.store_output_slot_status'::regclass
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) ilike '%mode%brand%store%'
    and pg_get_constraintdef(c.oid) not ilike '%announce%';
  if v_name is not null then
    execute format('alter table public.store_output_slot_status drop constraint %I', v_name);
    alter table public.store_output_slot_status
      add constraint store_output_slot_status_mode_check check (mode in ('brand', 'store', 'announce'));
  end if;
end;
$$;

create or replace function public.output_slot_heartbeat(
  p_slot int,
  p_mode text,
  p_player_status text default 'unknown',
  p_current_track_id uuid default null,
  p_current_track_started_at timestamptz default null,
  p_sink_label text default null,
  p_visibility text default null,
  p_app_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'unauthorized';
  end if;
  if p_slot is null or p_slot < 1 or p_slot > 3 then
    raise exception 'invalid_slot';
  end if;
  if p_mode not in ('brand', 'store', 'announce') then
    raise exception 'invalid_mode';
  end if;

  insert into public.store_output_slot_status as s (
    store_id, slot, mode, player_status, current_track_id, current_track_started_at,
    sink_label, visibility, app_version, last_heartbeat_at, updated_at
  ) values (
    v_uid, p_slot, p_mode,
    case when p_player_status in ('playing', 'paused', 'stopped') then p_player_status else 'unknown' end,
    p_current_track_id,
    -- least() 는 null 을 건너뛰어 now() 를 돌려준다 — 곡이 없으면 null 로 둔다.
    case when p_current_track_started_at is null then null else least(p_current_track_started_at, now()) end,
    left(nullif(btrim(coalesce(p_sink_label, '')), ''), 120),
    case when p_visibility in ('visible', 'hidden') then p_visibility else null end,
    left(p_app_version, 40),
    now(), now()
  )
  on conflict (store_id, slot) do update set
    mode = excluded.mode,
    player_status = excluded.player_status,
    current_track_id = excluded.current_track_id,
    current_track_started_at = coalesce(excluded.current_track_started_at, s.current_track_started_at),
    sink_label = excluded.sink_label,
    visibility = excluded.visibility,
    app_version = coalesce(excluded.app_version, s.app_version),
    last_heartbeat_at = now(),
    updated_at = now();

  return jsonb_build_object('success', true);
end;
$$;

