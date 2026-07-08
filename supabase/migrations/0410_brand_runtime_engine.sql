-- 0410 — Phase ENT-OS-3: Brand Runtime Engine / Playlist Decision Core
--
-- 목적:
--   "지금 이 브랜드/매장에서 어떤 Playlist/Media 가 선택되어야 하는지" 를
--   규칙(brand_runtime_rules) 기반으로 결정하고, 관리자가 미리보고 설명 가능하게.
--   이 Phase 는 Decision + Preview 중심. 실제 player 재생 로직은 변경하지 않음.
--
-- 절대 원칙:
--   • additive only — 신규 테이블 1개 + 신규 RPC/헬퍼. 기존 테이블/RPC/함수 무변경.
--     (admin_get_brand_workspace(0409) 도 변경하지 않음 — health 고도화는 신규 RPC 로 분리)
--   • brand_* 패턴: RLS on + super_admin SELECT, 쓰기는 SECURITY DEFINER RPC, soft delete.
--   • Brand Code 부활 없음. verify_store_code / get_brand_player_config / 세션 무변경.
--   • 날씨/공휴일은 외부 API 미연동 — context(jsonb) 의 manual simulation 값만 사용.

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.brand_runtime_rules (
  id             uuid primary key default gen_random_uuid(),
  brand_id       uuid not null references public.brand_accounts(id) on delete cascade,
  name           text not null,
  rule_type      text not null default 'default',   -- default/time/daypart/weekday/weather/season/holiday/campaign/emergency
  priority       integer not null default 50,
  playlist_id    uuid references public.brand_playlists(id) on delete set null,
  media_asset_id uuid references public.brand_media_assets(id) on delete set null,
  conditions     jsonb not null default '{}'::jsonb,
  status         text not null default 'active' check (status in ('active','inactive')),
  starts_at      timestamptz,
  ends_at        timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz
);
create index if not exists brand_runtime_rules_brand_idx
  on public.brand_runtime_rules(brand_id) where deleted_at is null;
create index if not exists brand_runtime_rules_prio_idx
  on public.brand_runtime_rules(brand_id, priority desc) where deleted_at is null and status = 'active';

alter table public.brand_runtime_rules enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'brand_runtime_rules_admin_read') then
    create policy brand_runtime_rules_admin_read on public.brand_runtime_rules for select using (public._is_super_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. 헬퍼 — 조건 매칭 (conditions jsonb vs context jsonb, AND)
--    · conditions 값이 배열이면 context 값이 그 안에 있으면 매칭 (OR)
--    · 스칼라면 텍스트 동등 비교
--    · conditions 키가 context 에 없으면 불일치
--    · 빈 conditions {} 는 항상 매칭 (default 규칙용)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_rule_matches(p_conditions jsonb, p_context jsonb)
returns boolean
language plpgsql immutable
set search_path to 'public'
as $$
declare k text; cond jsonb;
begin
  if p_conditions is null or p_conditions = '{}'::jsonb then return true; end if;
  for k in select jsonb_object_keys(p_conditions) loop
    cond := p_conditions -> k;
    if (p_context -> k) is null then return false; end if;
    if jsonb_typeof(cond) = 'array' then
      if not exists (select 1 from jsonb_array_elements_text(cond) v where v = (p_context ->> k)) then
        return false;
      end if;
    else
      if (p_context ->> k) is distinct from (p_conditions ->> k) then
        return false;
      end if;
    end if;
  end loop;
  return true;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. 헬퍼 — Brand Health (score + checks). Runtime 기준 확장.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_health(p_brand_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_b public.brand_accounts%rowtype;
  c_policy boolean; c_playlist boolean; c_default boolean; c_media boolean; c_session boolean;
  v_tracks int; v_media_cnt int;
  checks jsonb; passed int := 0; total int := 8;
begin
  select * into v_b from public.brand_accounts where id = p_brand_id and deleted_at is null;
  if not found then return jsonb_build_object('score', 0, 'checks', '[]'::jsonb); end if;

  c_policy   := exists (select 1 from public.brand_music_policies where brand_id = p_brand_id);
  c_playlist := exists (select 1 from public.brand_playlists where brand_id = p_brand_id and deleted_at is null and status = 'active');
  c_default  := exists (select 1 from public.brand_runtime_rules where brand_id = p_brand_id and deleted_at is null and status = 'active' and rule_type = 'default');
  v_media_cnt := (select count(*) from public.brand_media_assets where brand_id = p_brand_id and deleted_at is null and status = 'active');
  c_media    := v_media_cnt > 0;
  c_session  := exists (select 1 from public.brand_player_sessions where brand_id = p_brand_id and last_seen_at > now() - interval '24 hours');
  v_tracks   := jsonb_array_length(public._brand_generate_playlist(p_brand_id, 300));

  checks := jsonb_build_array(
    jsonb_build_object('key','has_brand',              'label','브랜드 존재',        'passed', true,                'detail', v_b.name),
    jsonb_build_object('key','has_music_policy',       'label','음악 정책',          'passed', c_policy,            'detail', case when c_policy then '설정됨' else '기본값' end),
    jsonb_build_object('key','has_active_playlist',    'label','활성 플레이리스트',  'passed', c_playlist,          'detail', case when c_playlist then '있음' else '없음' end),
    jsonb_build_object('key','has_runtime_default_rule','label','기본 Runtime 규칙', 'passed', c_default,           'detail', case when c_default then '있음' else '미설정' end),
    jsonb_build_object('key','has_media',              'label','활성 이미지',        'passed', c_media,             'detail', v_media_cnt || '개'),
    jsonb_build_object('key','has_recent_player_session','label','최근 24h 세션',    'passed', c_session,           'detail', case when c_session then '있음' else '없음' end),
    jsonb_build_object('key','playlist_track_count',   'label','재생 가능 트랙',     'passed', v_tracks > 0,        'detail', v_tracks || '곡'),
    jsonb_build_object('key','media_asset_count',      'label','미디어 자산',        'passed', v_media_cnt > 0,     'detail', v_media_cnt || '개')
  );

  select count(*) into passed from jsonb_array_elements(checks) e where (e->>'passed')::boolean;
  return jsonb_build_object('score', round(passed * 100.0 / total), 'checks', checks);
end;
$$;

create or replace function public.admin_get_brand_health(p_brand_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  return public._brand_health(p_brand_id);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Runtime Rule CRUD (super_admin, SECURITY DEFINER, _brand_audit)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_create_brand_runtime_rule(
  p_brand_id uuid, p_name text, p_rule_type text default 'default', p_priority integer default 50,
  p_playlist_id uuid default null, p_media_asset_id uuid default null,
  p_conditions jsonb default '{}'::jsonb, p_status text default 'active',
  p_starts_at timestamptz default null, p_ends_at timestamptz default null)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  if coalesce(btrim(p_name),'') = '' then raise exception 'name required'; end if;
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then raise exception 'brand not found'; end if;
  if p_status not in ('active','inactive') then raise exception 'invalid status'; end if;
  if p_playlist_id is not null and not exists (select 1 from public.brand_playlists where id = p_playlist_id and brand_id = p_brand_id and deleted_at is null) then
    raise exception 'playlist not found in this brand';
  end if;
  if p_media_asset_id is not null and not exists (select 1 from public.brand_media_assets where id = p_media_asset_id and brand_id = p_brand_id and deleted_at is null) then
    raise exception 'media not found in this brand';
  end if;

  insert into public.brand_runtime_rules (brand_id, name, rule_type, priority, playlist_id, media_asset_id, conditions, status, starts_at, ends_at, created_by)
  values (p_brand_id, btrim(p_name), coalesce(nullif(btrim(p_rule_type),''),'default'), coalesce(p_priority,50),
          p_playlist_id, p_media_asset_id, coalesce(p_conditions,'{}'::jsonb), p_status, p_starts_at, p_ends_at, auth.uid())
  returning id into v_id;

  perform public._brand_audit(p_brand_id, 'runtime.rule_create',
    jsonb_build_object('rule_id', v_id, 'name', btrim(p_name), 'rule_type', p_rule_type, 'priority', p_priority));
  return jsonb_build_object('success', true, 'id', v_id);
end;
$$;

create or replace function public.admin_update_brand_runtime_rule(
  p_rule_id uuid, p_name text default null, p_rule_type text default null, p_priority integer default null,
  p_playlist_id uuid default null, p_media_asset_id uuid default null,
  p_conditions jsonb default null, p_status text default null,
  p_starts_at timestamptz default null, p_ends_at timestamptz default null,
  p_clear_playlist boolean default false, p_clear_media boolean default false,
  p_clear_starts boolean default false, p_clear_ends boolean default false)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select brand_id into v_brand from public.brand_runtime_rules where id = p_rule_id and deleted_at is null;
  if v_brand is null then raise exception 'rule not found'; end if;
  if p_status is not null and p_status not in ('active','inactive') then raise exception 'invalid status'; end if;
  if p_playlist_id is not null and not exists (select 1 from public.brand_playlists where id = p_playlist_id and brand_id = v_brand and deleted_at is null) then
    raise exception 'playlist not found in this brand';
  end if;
  if p_media_asset_id is not null and not exists (select 1 from public.brand_media_assets where id = p_media_asset_id and brand_id = v_brand and deleted_at is null) then
    raise exception 'media not found in this brand';
  end if;

  update public.brand_runtime_rules set
    name = coalesce(nullif(btrim(coalesce(p_name,'')),''), name),
    rule_type = coalesce(nullif(btrim(coalesce(p_rule_type,'')),''), rule_type),
    priority = coalesce(p_priority, priority),
    playlist_id = case when p_clear_playlist then null when p_playlist_id is not null then p_playlist_id else playlist_id end,
    media_asset_id = case when p_clear_media then null when p_media_asset_id is not null then p_media_asset_id else media_asset_id end,
    conditions = coalesce(p_conditions, conditions),
    status = coalesce(p_status, status),
    starts_at = case when p_clear_starts then null when p_starts_at is not null then p_starts_at else starts_at end,
    ends_at = case when p_clear_ends then null when p_ends_at is not null then p_ends_at else ends_at end,
    updated_at = now()
  where id = p_rule_id;

  perform public._brand_audit(v_brand, 'runtime.rule_update', jsonb_build_object('rule_id', p_rule_id, 'status', p_status));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_delete_brand_runtime_rule(p_rule_id uuid, p_deleted boolean default true)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v_brand uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select brand_id into v_brand from public.brand_runtime_rules where id = p_rule_id;
  if v_brand is null then raise exception 'rule not found'; end if;
  update public.brand_runtime_rules set deleted_at = case when p_deleted then now() else null end, updated_at = now() where id = p_rule_id;
  perform public._brand_audit(v_brand, case when p_deleted then 'runtime.rule_delete' else 'runtime.rule_restore' end, jsonb_build_object('rule_id', p_rule_id));
  return jsonb_build_object('success', true);
end;
$$;

create or replace function public.admin_list_brand_runtime_rules(p_brand_id uuid, p_include_deleted boolean default false)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'name', r.name, 'rule_type', r.rule_type, 'priority', r.priority,
    'playlist_id', r.playlist_id, 'playlist_name', pl.name,
    'media_asset_id', r.media_asset_id, 'media_title', m.title,
    'conditions', r.conditions, 'status', r.status,
    'starts_at', r.starts_at, 'ends_at', r.ends_at,
    'created_at', r.created_at, 'updated_at', r.updated_at, 'deleted_at', r.deleted_at
  ) order by r.priority desc, r.updated_at desc), '[]'::jsonb) into v
  from public.brand_runtime_rules r
  left join public.brand_playlists pl on pl.id = r.playlist_id
  left join public.brand_media_assets m on m.id = r.media_asset_id
  where r.brand_id = p_brand_id and (p_include_deleted or r.deleted_at is null);
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. Runtime Decision + Preview (조회 전용, super_admin)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_preview_brand_runtime(p_brand_id uuid, p_context jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_b public.brand_accounts%rowtype;
  v_ctx jsonb := coalesce(p_context, '{}'::jsonb);
  v_now timestamptz;
  v_rule public.brand_runtime_rules%rowtype;
  v_matched jsonb := '[]'::jsonb;
  v_sel_rule jsonb := null;
  v_playlist_id uuid; v_media_id uuid;
  v_fallback boolean := false; v_fallback_reason text := null;
  v_expl jsonb := '[]'::jsonb;
  v_sel_playlist jsonb := null; v_sel_media jsonb := null; v_queue jsonb := '[]'::jsonb;
  rec record;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select * into v_b from public.brand_accounts where id = p_brand_id and deleted_at is null;
  if not found then raise exception 'brand not found'; end if;

  v_now := coalesce((v_ctx->>'datetime')::timestamptz, now());

  -- 매칭 규칙 수집 (priority desc, updated_at desc)
  for rec in
    select r.* from public.brand_runtime_rules r
    where r.brand_id = p_brand_id and r.deleted_at is null and r.status = 'active'
      and (r.starts_at is null or r.starts_at <= v_now)
      and (r.ends_at is null or r.ends_at >= v_now)
      and public._brand_rule_matches(r.conditions, v_ctx)
    order by r.priority desc, r.updated_at desc
  loop
    v_matched := v_matched || jsonb_build_array(jsonb_build_object(
      'id', rec.id, 'name', rec.name, 'rule_type', rec.rule_type, 'priority', rec.priority,
      'playlist_id', rec.playlist_id, 'media_asset_id', rec.media_asset_id, 'conditions', rec.conditions));
  end loop;

  -- 최우선 규칙 선택
  select r.* into v_rule from public.brand_runtime_rules r
    where r.brand_id = p_brand_id and r.deleted_at is null and r.status = 'active'
      and (r.starts_at is null or r.starts_at <= v_now)
      and (r.ends_at is null or r.ends_at >= v_now)
      and public._brand_rule_matches(r.conditions, v_ctx)
    order by r.priority desc, r.updated_at desc limit 1;

  if found then
    v_sel_rule := jsonb_build_object('id', v_rule.id, 'name', v_rule.name, 'rule_type', v_rule.rule_type, 'priority', v_rule.priority);
    v_playlist_id := v_rule.playlist_id; v_media_id := v_rule.media_asset_id;
    v_expl := v_expl || jsonb_build_array(format('rule "%s" (type=%s, priority=%s) matched context', v_rule.name, v_rule.rule_type, v_rule.priority));
    if v_playlist_id is null then
      v_expl := v_expl || jsonb_build_array(format('selected rule "%s" has no playlist → fallback', v_rule.name));
    end if;
  else
    v_expl := v_expl || jsonb_build_array('no runtime rule matched context');
  end if;

  -- Playlist 결정 + fallback chain
  if v_playlist_id is not null and exists (select 1 from public.brand_playlists where id = v_playlist_id and deleted_at is null) then
    v_expl := v_expl || jsonb_build_array('playlist selected from matched rule');
  else
    -- fallback 1: active default rule with playlist
    select r.* into v_rule from public.brand_runtime_rules r
      where r.brand_id = p_brand_id and r.deleted_at is null and r.status = 'active'
        and r.rule_type = 'default' and r.playlist_id is not null
      order by r.priority desc, r.updated_at desc limit 1;
    if found and exists (select 1 from public.brand_playlists where id = v_rule.playlist_id and deleted_at is null) then
      v_playlist_id := v_rule.playlist_id; v_fallback := true; v_fallback_reason := 'active_default_rule';
      if v_sel_rule is null then v_sel_rule := jsonb_build_object('id', v_rule.id, 'name', v_rule.name, 'rule_type', v_rule.rule_type, 'priority', v_rule.priority); end if;
      v_expl := v_expl || jsonb_build_array(format('fallback: active default rule "%s" playlist', v_rule.name));
    else
      -- fallback 2: brand active playlist (latest)
      select id into v_playlist_id from public.brand_playlists
        where brand_id = p_brand_id and deleted_at is null and status = 'active'
        order by updated_at desc limit 1;
      if v_playlist_id is not null then
        v_fallback := true; v_fallback_reason := 'brand_active_playlist';
        v_expl := v_expl || jsonb_build_array('fallback: latest active brand playlist');
      else
        -- fallback 3: on-the-fly generate
        v_fallback := true; v_fallback_reason := 'generated_playlist';
        v_expl := v_expl || jsonb_build_array('fallback: on-the-fly generated playlist (_brand_generate_playlist)');
      end if;
    end if;
  end if;

  -- selected_playlist + queue_preview (10)
  if v_playlist_id is not null then
    select jsonb_build_object('id', p.id, 'name', p.name, 'type', p.type, 'version', p.version, 'status', p.status,
      'track_count', (select count(*) from public.brand_playlist_tracks bt where bt.playlist_id = p.id))
      into v_sel_playlist from public.brand_playlists p where p.id = v_playlist_id;
    select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'title', t.title, 'artist', t.artist, 'duration', t.duration) order by x.so), '[]'::jsonb)
      into v_queue
      from (select track_id tid, sort_order so from public.brand_playlist_tracks where playlist_id = v_playlist_id order by sort_order limit 10) x
      join public.tracks t on t.id = x.tid;
    -- stored playlist 가 비어있으면 generate 로 미리보기 보강
    if v_queue = '[]'::jsonb then
      v_queue := coalesce((select jsonb_agg(e order by ord) from (select e, ord from jsonb_array_elements(public._brand_generate_playlist(p_brand_id, 10)) with ordinality as g(e, ord)) s), '[]'::jsonb);
      v_expl := v_expl || jsonb_build_array('selected playlist empty → queue preview generated');
    end if;
  else
    v_sel_playlist := jsonb_build_object('id', null, 'name', '자동 생성', 'type', 'generated', 'status', 'active',
      'track_count', jsonb_array_length(public._brand_generate_playlist(p_brand_id, 300)));
    v_queue := coalesce((select jsonb_agg(e order by ord) from (select e, ord from jsonb_array_elements(public._brand_generate_playlist(p_brand_id, 10)) with ordinality as g(e, ord)) s), '[]'::jsonb);
  end if;

  -- selected_media
  if v_media_id is not null then
    select jsonb_build_object('id', id, 'title', title, 'image_url', image_url, 'status', status)
      into v_sel_media from public.brand_media_assets where id = v_media_id and deleted_at is null;
  end if;

  return jsonb_build_object(
    'brand', jsonb_build_object('id', v_b.id, 'name', v_b.name, 'status', v_b.status, 'industry_type', v_b.industry_type),
    'context', v_ctx,
    'evaluated_at', v_now,
    'matched_rules', v_matched,
    'selected_rule', v_sel_rule,
    'selected_playlist', v_sel_playlist,
    'selected_media', v_sel_media,
    'fallback_used', v_fallback,
    'fallback_reason', v_fallback_reason,
    'explanation', v_expl,
    'queue_preview', v_queue,
    'health', public._brand_health(p_brand_id)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_get_brand_health(uuid)',
    'public.admin_create_brand_runtime_rule(uuid,text,text,integer,uuid,uuid,jsonb,text,timestamptz,timestamptz)',
    'public.admin_update_brand_runtime_rule(uuid,text,text,integer,uuid,uuid,jsonb,text,timestamptz,timestamptz,boolean,boolean,boolean,boolean)',
    'public.admin_delete_brand_runtime_rule(uuid,boolean)',
    'public.admin_list_brand_runtime_rules(uuid,boolean)',
    'public.admin_preview_brand_runtime(uuid,jsonb)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.brand_runtime_rules is
  'ENT-OS-3 — Brand Runtime Rule. conditions(jsonb) 매칭 + priority 로 Playlist/Media 결정. 날씨/공휴일은 context manual 값. 자동 적용은 후속 Phase.';
comment on function public.admin_preview_brand_runtime(uuid,jsonb) is
  'ENT-OS-3 — Runtime Decision Preview (조회 전용). matched/selected/fallback/explanation/queue/health. _is_super_admin 게이트.';
