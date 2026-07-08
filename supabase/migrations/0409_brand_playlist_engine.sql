-- 0409 — Phase ENT-OS-2: Brand Playlist Engine + Brand Workspace 조회
--
-- 목적:
--   Brand 를 Enterprise OS 안의 독립 운영 단위(Workspace)로 승격.
--   그 핵심 데이터인 Playlist 를 영속 객체로 저장(생성/수정/복제/버전/soft-delete).
--   Manual / Auto(자동생성) 두 종류 지원. AI Playlist 는 후속 Phase 에서 이 위에 연결.
--
-- 절대 원칙:
--   • additive only — 신규 테이블 2개 + 신규 RPC. 기존 테이블/RPC 무변경.
--   • brand_* 테이블 패턴 준수: RLS on + super_admin SELECT 정책, 쓰기는 SECURITY DEFINER RPC.
--   • Brand Code 부활 없음. verify_store_code / brand_player_session / admin_get_enterprise_os_detail 무변경.
--   • 미래 확장(AI/Weather/Holiday/Schedule/Rotation/AB) 대비하여 type·version·weight 컬럼 확보.

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.brand_playlists (
  id          uuid primary key default gen_random_uuid(),
  brand_id    uuid not null references public.brand_accounts(id) on delete cascade,
  name        text not null,
  description text,
  type        text not null default 'manual' check (type in ('manual','auto')),
  version     integer not null default 1,
  status      text not null default 'active' check (status in ('active','inactive')),
  created_by  uuid,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  deleted_at  timestamptz
);
create index if not exists brand_playlists_brand_idx
  on public.brand_playlists(brand_id) where deleted_at is null;

create table if not exists public.brand_playlist_tracks (
  id          uuid primary key default gen_random_uuid(),
  playlist_id uuid not null references public.brand_playlists(id) on delete cascade,
  track_id    uuid not null references public.tracks(id) on delete cascade,
  sort_order  integer not null default 0,
  weight      numeric not null default 1,
  created_at  timestamptz not null default now()
);
create index if not exists brand_playlist_tracks_playlist_idx
  on public.brand_playlist_tracks(playlist_id, sort_order);
create unique index if not exists brand_playlist_tracks_uniq
  on public.brand_playlist_tracks(playlist_id, track_id);

alter table public.brand_playlists enable row level security;
alter table public.brand_playlist_tracks enable row level security;

do $$ begin
  if not exists (select 1 from pg_policy where polname = 'brand_playlists_admin_read') then
    create policy brand_playlists_admin_read on public.brand_playlists for select using (public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policy where polname = 'brand_playlist_tracks_admin_read') then
    create policy brand_playlist_tracks_admin_read on public.brand_playlist_tracks for select using (public._is_super_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. 내부 헬퍼 — track_ids 로 playlist_tracks 재구성 (dedupe, 순서 보존)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_playlist_replace_tracks(p_playlist_id uuid, p_track_ids uuid[])
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_count integer;
begin
  delete from public.brand_playlist_tracks where playlist_id = p_playlist_id;
  insert into public.brand_playlist_tracks (playlist_id, track_id, sort_order)
  select p_playlist_id, x.tid, (x.ord - 1)
    from (
      select tid, min(ord) as ord
        from (
          select t.tid, row_number() over () as ord
            from unnest(coalesce(p_track_ids,'{}'::uuid[])) with ordinality as t(tid, ord)
        ) s
        join public.tracks tr on tr.id = s.tid   -- 존재하는 track 만
       group by tid
    ) x
   order by x.ord;
  select count(*) into v_count from public.brand_playlist_tracks where playlist_id = p_playlist_id;
  return v_count;
end;
$$;

-- 자동생성 playlist 의 track id 목록 (brand 정책 기반)
create or replace function public._brand_auto_track_ids(p_brand_id uuid, p_limit integer default 100)
returns uuid[]
language sql
stable security definer
set search_path to 'public'
as $$
  select coalesce(array_agg((e->>'id')::uuid order by ord), '{}'::uuid[])
    from jsonb_array_elements(public._brand_generate_playlist(p_brand_id, p_limit)) with ordinality as t(e, ord);
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. 쓰기 RPC (super_admin, SECURITY DEFINER, brand_audit 기록)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_create_brand_playlist(
  p_brand_id uuid, p_name text, p_description text default null,
  p_type text default 'manual', p_track_ids uuid[] default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid; v_type text; v_ids uuid[]; v_count integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  v_type := case when p_type in ('manual','auto') then p_type else 'manual' end;

  insert into public.brand_playlists (brand_id, name, description, type, created_by)
  values (p_brand_id, btrim(p_name), nullif(btrim(coalesce(p_description,'')),''), v_type, auth.uid())
  returning id into v_id;

  if p_track_ids is not null and array_length(p_track_ids,1) is not null then
    v_ids := p_track_ids;                              -- 명시 목록 우선
  elsif v_type = 'auto' then
    v_ids := public._brand_auto_track_ids(p_brand_id, 100);
  else
    v_ids := '{}'::uuid[];                             -- 빈 manual playlist
  end if;

  v_count := public._brand_playlist_replace_tracks(v_id, v_ids);
  perform public._brand_audit(p_brand_id, 'playlist.create',
    jsonb_build_object('playlist_id', v_id, 'name', btrim(p_name), 'type', v_type, 'track_count', v_count));
  return jsonb_build_object('success', true, 'id', v_id, 'track_count', v_count);
end;
$$;

create or replace function public.admin_update_brand_playlist(
  p_playlist_id uuid, p_name text default null, p_description text default null, p_status text default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  if p_status is not null and p_status not in ('active','inactive') then raise exception 'invalid status'; end if;
  select brand_id into v_brand from public.brand_playlists where id = p_playlist_id;
  if v_brand is null then raise exception 'playlist not found'; end if;

  update public.brand_playlists
     set name = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
         description = case when p_description is null then description else nullif(btrim(p_description),'') end,
         status = coalesce(p_status, status),
         updated_at = now()
   where id = p_playlist_id;

  perform public._brand_audit(v_brand, 'playlist.update',
    jsonb_build_object('playlist_id', p_playlist_id, 'status', p_status));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_set_brand_playlist_tracks(p_playlist_id uuid, p_track_ids uuid[])
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid; v_count integer; v_ver integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select brand_id into v_brand from public.brand_playlists where id = p_playlist_id;
  if v_brand is null then raise exception 'playlist not found'; end if;

  v_count := public._brand_playlist_replace_tracks(p_playlist_id, coalesce(p_track_ids,'{}'::uuid[]));
  update public.brand_playlists set version = version + 1, updated_at = now()
   where id = p_playlist_id returning version into v_ver;

  perform public._brand_audit(v_brand, 'playlist.tracks_update',
    jsonb_build_object('playlist_id', p_playlist_id, 'track_count', v_count, 'version', v_ver));
  return jsonb_build_object('success', true, 'track_count', v_count, 'version', v_ver);
end;
$$;

create or replace function public.admin_clone_brand_playlist(p_playlist_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare src public.brand_playlists%rowtype; v_new uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into src from public.brand_playlists where id = p_playlist_id;
  if not found then raise exception 'playlist not found'; end if;

  insert into public.brand_playlists (brand_id, name, description, type, version, status, created_by)
  values (src.brand_id, left(src.name || ' (복제)', 200), src.description, src.type, 1, 'active', auth.uid())
  returning id into v_new;

  insert into public.brand_playlist_tracks (playlist_id, track_id, sort_order, weight)
  select v_new, track_id, sort_order, weight
    from public.brand_playlist_tracks where playlist_id = p_playlist_id;

  perform public._brand_audit(src.brand_id, 'playlist.clone',
    jsonb_build_object('source_id', p_playlist_id, 'playlist_id', v_new));
  return jsonb_build_object('success', true, 'id', v_new);
end;
$$;

create or replace function public.admin_delete_brand_playlist(p_playlist_id uuid, p_deleted boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select brand_id into v_brand from public.brand_playlists where id = p_playlist_id;
  if v_brand is null then raise exception 'playlist not found'; end if;

  update public.brand_playlists
     set deleted_at = case when p_deleted then now() else null end, updated_at = now()
   where id = p_playlist_id;

  perform public._brand_audit(v_brand, case when p_deleted then 'playlist.delete' else 'playlist.restore' end,
    jsonb_build_object('playlist_id', p_playlist_id));
  return jsonb_build_object('success', true);
end;
$$;

-- 자동생성 playlist 재생성 (brand 정책 기반, version bump). AI 아님.
create or replace function public.admin_regenerate_brand_playlist(p_playlist_id uuid)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid; v_type text; v_count integer; v_ver integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select brand_id, type into v_brand, v_type from public.brand_playlists where id = p_playlist_id;
  if v_brand is null then raise exception 'playlist not found'; end if;
  if v_type <> 'auto' then raise exception 'only auto playlists can be regenerated'; end if;

  v_count := public._brand_playlist_replace_tracks(p_playlist_id, public._brand_auto_track_ids(v_brand, 100));
  update public.brand_playlists set version = version + 1, updated_at = now()
   where id = p_playlist_id returning version into v_ver;

  perform public._brand_audit(v_brand, 'playlist.regenerate',
    jsonb_build_object('playlist_id', p_playlist_id, 'track_count', v_count, 'version', v_ver));
  return jsonb_build_object('success', true, 'track_count', v_count, 'version', v_ver);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Brand Workspace 통합 조회 (조회 전용)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_get_brand_workspace(p_brand_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_b public.brand_accounts%rowtype;
  v_ea public.enterprise_accounts%rowtype;
  v_franchise_ids uuid[];
  v_has_ent boolean := false;
  v_pol_exists boolean;
  v_active_media int; v_playlist_count int; v_track_avail int;
  v_health int := 0;
  v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode='42501'; end if;
  select * into v_b from public.brand_accounts where id = p_brand_id and deleted_at is null;
  if not found then raise exception 'brand not found'; end if;

  if v_b.enterprise_account_id is not null then
    select * into v_ea from public.enterprise_accounts where id = v_b.enterprise_account_id;
    v_has_ent := found;
  end if;
  select coalesce(array_agg(ef.franchise_id), '{}') into v_franchise_ids
    from public.enterprise_franchises ef
   where ef.enterprise_account_id = v_b.enterprise_account_id and ef.deleted_at is null;

  v_pol_exists  := exists (select 1 from public.brand_music_policies where brand_id = p_brand_id);
  v_active_media := (select count(*) from public.brand_media_assets where brand_id=p_brand_id and deleted_at is null and status='active');
  v_playlist_count := (select count(*) from public.brand_playlists where brand_id=p_brand_id and deleted_at is null);
  v_track_avail := jsonb_array_length(public._brand_generate_playlist(p_brand_id, 300));

  -- Health score (0~100): 브랜드 활성 / 매장코드 / 정책 / 재생가능 / 이미지
  v_health := (case when v_b.status='active' then 20 else 0 end)
            + (case when v_has_ent and v_ea.store_invite_code is not null then 20 else 0 end)
            + (case when v_pol_exists then 20 else 0 end)
            + (case when v_track_avail > 0 then 20 else 0 end)
            + (case when v_active_media > 0 then 20 else 0 end);

  v := jsonb_build_object(
    'brand', jsonb_build_object(
      'id', v_b.id, 'name', v_b.name, 'enterprise_account_id', v_b.enterprise_account_id,
      'enterprise_name', case when v_has_ent then v_ea.enterprise_name else null end,
      'industry_type', v_b.industry_type, 'status', v_b.status, 'description', v_b.description,
      'created_at', v_b.created_at, 'updated_at', v_b.updated_at),

    'overview', jsonb_build_object(
      'connected_store_count', (select count(*) from public.franchise_stores fs where fs.franchise_id = any(v_franchise_ids)),
      'connected_region_count', (select count(distinct fs.enterprise_region_id) from public.franchise_stores fs where fs.franchise_id = any(v_franchise_ids) and fs.enterprise_region_id is not null),
      'player_session_count', (select count(*) from public.brand_player_sessions s where s.brand_id=p_brand_id),
      'media_count', (select count(*) from public.brand_media_assets where brand_id=p_brand_id and deleted_at is null),
      'active_media_count', v_active_media,
      'playlist_count', v_playlist_count,
      'available_track_count', v_track_avail,
      'music_policy_set', v_pol_exists,
      'ai_profile_set', v_pol_exists,
      'store_invite_code', case when v_has_ent then v_ea.store_invite_code else null end,
      'health_score', v_health),

    'playlists', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', p.id, 'name', p.name, 'description', p.description, 'type', p.type,
        'version', p.version, 'status', p.status, 'created_at', p.created_at, 'updated_at', p.updated_at,
        'track_count', (select count(*) from public.brand_playlist_tracks bt where bt.playlist_id = p.id)
      ) order by p.created_at desc), '[]'::jsonb)
      from public.brand_playlists p where p.brand_id = p_brand_id and p.deleted_at is null),

    'playlist_summary', jsonb_build_object(
      'total', v_playlist_count,
      'active', (select count(*) from public.brand_playlists where brand_id=p_brand_id and deleted_at is null and status='active'),
      'manual', (select count(*) from public.brand_playlists where brand_id=p_brand_id and deleted_at is null and type='manual'),
      'auto', (select count(*) from public.brand_playlists where brand_id=p_brand_id and deleted_at is null and type='auto')),

    'media', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'asset_type', asset_type, 'title', title, 'image_url', image_url,
        'display_duration_seconds', display_duration_seconds, 'sort_order', sort_order,
        'status', status, 'starts_at', starts_at, 'ends_at', ends_at,
        'created_at', created_at, 'updated_at', updated_at) order by sort_order, created_at), '[]'::jsonb)
      from public.brand_media_assets where brand_id = p_brand_id and deleted_at is null),

    'player', jsonb_build_object(
      'store_invite_code', case when v_has_ent then v_ea.store_invite_code else null end,
      'enterprise_name', case when v_has_ent then v_ea.enterprise_name else null end,
      'session_summary', jsonb_build_object(
        'total', (select count(*) from public.brand_player_sessions s where s.brand_id=p_brand_id),
        'active_recent', (select count(*) from public.brand_player_sessions s where s.brand_id=p_brand_id and s.last_seen_at > now() - interval '10 minutes'),
        'last_24h', (select count(*) from public.brand_player_sessions s where s.brand_id=p_brand_id and s.last_seen_at > now() - interval '24 hours')),
      'now_playing', (
        select jsonb_build_object('track_id', s.current_track_id, 'title', t.title, 'artist', t.artist, 'last_seen_at', s.last_seen_at)
          from public.brand_player_sessions s left join public.tracks t on t.id = s.current_track_id
         where s.brand_id=p_brand_id and s.current_track_id is not null
         order by s.last_seen_at desc nulls last limit 1),
      'sessions', (
        select coalesce(jsonb_agg(x order by x.last_seen_at desc nulls last), '[]'::jsonb) from (
          select s.id, s.last_seen_at, s.playback_started_at, s.user_agent, s.current_track_id, s.created_at
          from public.brand_player_sessions s where s.brand_id=p_brand_id
          order by s.last_seen_at desc nulls last limit 20) x),
      'media_asset_count', v_active_media),

    'ai_profile', case when v_pol_exists then (
      select jsonb_build_object(
        'industry_type', v_b.industry_type,
        'preferred_genres', preferred_genres, 'blocked_genres', blocked_genres,
        'preferred_moods', preferred_moods, 'blocked_moods', blocked_moods,
        'energy_min', energy_min, 'energy_max', energy_max, 'vocal_policy', vocal_policy,
        'daypart_policy', daypart_policy, 'auto_generate_enabled', auto_generate_enabled,
        -- 후속 AI Music OS 예약 필드 (현재 미저장 → null)
        'weather_rule', null, 'holiday_rule', null, 'schedule_rule', null,
        'auto_media', null, 'auto_rotation', null)
      from public.brand_music_policies where brand_id = p_brand_id
    ) else null end,

    'history', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'action', l.action, 'metadata', l.metadata, 'created_at', l.created_at
      ) order by l.created_at desc), '[]'::jsonb)
      from (select * from public.brand_audit_logs where brand_id = p_brand_id order by created_at desc limit 50) l)
  );
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_create_brand_playlist(uuid,text,text,text,uuid[])',
    'public.admin_update_brand_playlist(uuid,text,text,text)',
    'public.admin_set_brand_playlist_tracks(uuid,uuid[])',
    'public.admin_clone_brand_playlist(uuid)',
    'public.admin_delete_brand_playlist(uuid,boolean)',
    'public.admin_regenerate_brand_playlist(uuid)',
    'public.admin_get_brand_workspace(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on function public.admin_get_brand_workspace(uuid) is
  'ENT-OS-2 — Brand Workspace 통합 조회 (조회 전용). brand/overview/playlists/playlist_summary/media/player/ai_profile/history. _is_super_admin 게이트.';
comment on table public.brand_playlists is 'ENT-OS-2 — Brand 영속 Playlist (manual/auto). AI/Weather/Holiday/Schedule/Rotation 은 후속 Phase 에서 이 위에 확장.';
