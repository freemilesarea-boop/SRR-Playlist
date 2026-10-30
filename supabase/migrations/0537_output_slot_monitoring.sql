-- 0537_output_slot_monitoring.sql
--
-- 분리 송출 2단계 — 공간(플레이어 1~3)별 상태 모니터링.
--
-- 왜
--   분리 송출(0536) 매장은 플레이어 창을 2~3개 띄운다. 기존 매장 상태
--   (store_policy_sync_status)는 매장당 한 줄이라 창들이 마지막에 보고한 값으로 덮어써,
--   "2번 룸 스피커가 멈췄다" 를 관리자도 점주도 볼 수 없었다.
--   그 한 줄은 여러 관제 화면이 읽으므로 손대지 않고, 공간별 상태를 따로 받는다.
--
-- 바뀌는 것
--   · store_output_slot_status — (매장, 슬롯) 한 줄. RLS 켬, 직접 접근 없음(RPC 전용).
--   · output_slot_heartbeat   — 슬롯 창이 1분마다 + 곡 바뀔 때 보고(본인 매장만).
--   · get_my_output_slot_status — 점주가 내 정보에서 공간별 상태를 본다.
--   · admin_list_output_slot_status — 관리자 매장 상태 > 분리 송출.
--   온라인 판정: 마지막 보고 3분 이내.

create table if not exists public.store_output_slot_status (
  store_id uuid not null references auth.users(id) on delete cascade,
  slot smallint not null check (slot between 1 and 3),
  mode text not null check (mode in ('brand', 'store')),
  player_status text not null default 'unknown'
    check (player_status in ('playing', 'paused', 'stopped', 'unknown')),
  current_track_id uuid,
  current_track_started_at timestamptz,
  sink_label text,
  visibility text check (visibility is null or visibility in ('visible', 'hidden')),
  app_version text,
  last_heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (store_id, slot)
);

alter table public.store_output_slot_status enable row level security;
revoke all on public.store_output_slot_status from anon, authenticated;

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
  if p_mode not in ('brand', 'store') then
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

revoke all on function public.output_slot_heartbeat(int, text, text, uuid, timestamptz, text, text, text) from public, anon;
grant execute on function public.output_slot_heartbeat(int, text, text, uuid, timestamptz, text, text, text) to authenticated;

-- 한 매장의 슬롯 상태 — 설정(점주가 고른 역할)과 실제 보고를 합친다.
create or replace function public._output_slots_for_store(p_store_id uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
      'slot', cfg.slot,
      'mode', cfg.mode,
      'source', cfg.source,
      'category', cfg.category,
      'reported_mode', st.mode,
      'player_status', st.player_status,
      'online', st.last_heartbeat_at is not null and st.last_heartbeat_at > now() - interval '3 minutes',
      'last_heartbeat_at', st.last_heartbeat_at,
      'visibility', st.visibility,
      'sink_label', st.sink_label,
      'track_title', t.title,
      'track_artist', t.artist,
      'track_started_at', st.current_track_started_at,
      'app_version', st.app_version
    ) order by cfg.slot), '[]'::jsonb)
  from public.users u
  cross join lateral (
    select (e->>'slot')::int as slot, e->>'mode' as mode, e->>'source' as source, e->>'category' as category
    from jsonb_array_elements(coalesce(u.multi_output_config->'slots', '[]'::jsonb)) e
    where coalesce(e->>'mode', 'off') <> 'off'
  ) cfg
  left join public.store_output_slot_status st on st.store_id = u.id and st.slot = cfg.slot
  left join public.tracks t on t.id = st.current_track_id
  where u.id = p_store_id;
$$;

revoke all on function public._output_slots_for_store(uuid) from public, anon, authenticated;

create or replace function public.get_my_output_slot_status()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null then
    raise exception 'unauthorized';
  end if;
  return public._output_slots_for_store(auth.uid());
end;
$$;

revoke all on function public.get_my_output_slot_status() from public, anon;
grant execute on function public.get_my_output_slot_status() to authenticated;

create or replace function public.admin_list_output_slot_status(p_search text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_q text := nullif(btrim(coalesce(p_search, '')), '');
begin
  if not public._is_super_admin() then
    raise exception 'forbidden: admin only';
  end if;

  return coalesce((
    select jsonb_agg(row_obj order by (row_obj->>'offline_count')::int desc, row_obj->>'store_label')
    from (
      select jsonb_build_object(
        'store_id', u.id,
        'store_label', coalesce(fs.store_name, bp.store_name, bvp.store_name, bvp.business_name, u.nickname, au.email),
        'email', au.email,
        'enabled', u.multi_output_enabled,
        'announcement_slot', (u.multi_output_config->>'announcement_slot')::int,
        'slots', slots,
        'offline_count', (
          select count(*) from jsonb_array_elements(slots) x where not coalesce((x->>'online')::boolean, false)
        )
      ) as row_obj
      from public.users u
      join auth.users au on au.id = u.id
      left join lateral (select store_name from public.franchise_stores f where f.store_id = u.id and f.status = 'active' limit 1) fs on true
      left join lateral (select store_name from public.business_profiles b where b.user_id = u.id limit 1) bp on true
      left join lateral (select store_name, business_name from public.business_verification_profiles v where v.user_id = u.id limit 1) bvp on true
      cross join lateral (select public._output_slots_for_store(u.id) as slots) sl
      where (u.multi_output_enabled
             or exists (select 1 from public.store_output_slot_status s where s.store_id = u.id
                        and s.last_heartbeat_at > now() - interval '1 day'))
        and (v_q is null
             or au.email ilike '%' || v_q || '%'
             or coalesce(fs.store_name, bp.store_name, bvp.store_name, bvp.business_name, u.nickname, '') ilike '%' || v_q || '%')
    ) z
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.admin_list_output_slot_status(text) from public, anon;
grant execute on function public.admin_list_output_slot_status(text) to authenticated;
