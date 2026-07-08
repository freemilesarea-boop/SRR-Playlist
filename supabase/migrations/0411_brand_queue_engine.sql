-- 0411 — Phase ENT-OS-4: Brand Queue Engine / Track Ordering Core
--
-- 목적:
--   Runtime Engine(0410)이 "무엇을 틀지" 결정한 Playlist 를,
--   Player 가 재생 가능한 "어떤 순서로 틀지" Track Queue 로 변환.
--   이 Phase 는 Queue 생성/Preview 중심. Player 강제 연동은 후속 Phase.
--
-- 절대 원칙:
--   • additive only — 신규 테이블 2 + 신규 RPC/헬퍼. 기존 테이블/RPC 무변경.
--     (_brand_health 만 CREATE OR REPLACE 로 queue 체크 3개 확장 — 시그니처 동일)
--   • brand_* 패턴: RLS on + super_admin SELECT, 쓰기는 SECURITY DEFINER RPC, soft delete.
--   • _brand_generate_playlist fallback 유지. verify_store_code / get_brand_player_config /
--     admin_preview_brand_runtime 무변경. Brand Code 부활 없음.

-- ─────────────────────────────────────────────────────────────────────
-- A. 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.brand_queue_runs (
  id              uuid primary key default gen_random_uuid(),
  brand_id        uuid not null references public.brand_accounts(id) on delete cascade,
  playlist_id     uuid references public.brand_playlists(id) on delete set null,
  runtime_rule_id uuid references public.brand_runtime_rules(id) on delete set null,
  context         jsonb not null default '{}'::jsonb,
  strategy        text not null default 'balanced_shuffle',
  status          text not null default 'generated',
  track_count     integer not null default 0,
  seed            text,
  reason          text,
  created_by      uuid,
  created_at      timestamptz not null default now(),
  deleted_at      timestamptz
);
create index if not exists brand_queue_runs_brand_idx
  on public.brand_queue_runs(brand_id, created_at desc) where deleted_at is null;

create table if not exists public.brand_queue_tracks (
  id                 uuid primary key default gen_random_uuid(),
  queue_run_id       uuid not null references public.brand_queue_runs(id) on delete cascade,
  track_id           uuid not null references public.tracks(id) on delete cascade,
  sort_order         integer not null,
  source_playlist_id uuid,
  source_reason      text,
  artist_id          uuid,
  genre              text,
  mood               text,
  bpm                numeric,
  energy             numeric,
  created_at         timestamptz not null default now()
);
create index if not exists brand_queue_tracks_run_idx
  on public.brand_queue_tracks(queue_run_id, sort_order);

alter table public.brand_queue_runs enable row level security;
alter table public.brand_queue_tracks enable row level security;
do $$ begin
  if not exists (select 1 from pg_policy where polname = 'brand_queue_runs_admin_read') then
    create policy brand_queue_runs_admin_read on public.brand_queue_runs for select using (public._is_super_admin());
  end if;
  if not exists (select 1 from pg_policy where polname = 'brand_queue_tracks_admin_read') then
    create policy brand_queue_tracks_admin_read on public.brand_queue_tracks for select using (public._is_super_admin());
  end if;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- B. Ordering — 3 strategies (sequential / weighted / balanced_shuffle)
--    balanced_shuffle: seed 기반 deterministic + 동일 artist/genre/mood 연속 회피 (greedy).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_order_tracks(p_candidates jsonb, p_strategy text, p_seed text, p_limit integer)
returns jsonb
language plpgsql immutable
set search_path to 'public'
as $$
declare
  v_out jsonb := '[]'::jsonb;
  v_pool jsonb[];
  v_last_artist text := null; v_last_genre text := null; v_last_mood text := null;
  v_pick integer; v_cnt integer := 0; i integer; cand jsonb;
begin
  if p_candidates is null or jsonb_array_length(p_candidates) = 0 then return '[]'::jsonb; end if;

  if p_strategy in ('sequential', 'weighted') then
    return coalesce((
      select jsonb_agg(e order by ord)
      from (
        select e, row_number() over (
          order by
            case when p_strategy = 'sequential' then coalesce((e->>'sort_order')::numeric, 0) end asc,
            case when p_strategy = 'weighted'  then coalesce((e->>'weight')::numeric, 1) end desc,
            ('x' || substr(md5((e->>'track_id') || p_seed), 1, 8))::bit(32)::bigint
        ) as ord
        from jsonb_array_elements(p_candidates) e
      ) s
      where ord <= p_limit
    ), '[]'::jsonb);
  end if;

  -- balanced_shuffle: deterministic rand 순서로 pool 구성 후 greedy spacing
  select array_agg(e order by ('x' || substr(md5((e->>'track_id') || p_seed), 1, 8))::bit(32)::bigint)
    into v_pool from jsonb_array_elements(p_candidates) e;

  while array_length(v_pool, 1) is not null and v_cnt < p_limit loop
    v_pick := null;
    for i in 1 .. array_length(v_pool, 1) loop
      cand := v_pool[i];
      if (v_last_artist is null or lower(coalesce(cand->>'artist','')) is distinct from v_last_artist)
         and (v_last_genre is null or lower(coalesce(cand->>'genre','')) is distinct from v_last_genre)
         and (v_last_mood is null or lower(coalesce(cand->>'mood','')) is distinct from v_last_mood) then
        v_pick := i; exit;
      end if;
    end loop;
    if v_pick is null then v_pick := 1; end if;   -- 조건 만족 없으면 완화

    cand := v_pool[v_pick];
    v_out := v_out || jsonb_build_array(cand);
    v_last_artist := lower(coalesce(cand->>'artist',''));
    v_last_genre  := lower(coalesce(cand->>'genre',''));
    v_last_mood   := lower(coalesce(cand->>'mood',''));
    v_pool := v_pool[1:v_pick-1] || v_pool[v_pick+1:array_upper(v_pool,1)];
    v_cnt := v_cnt + 1;
  end loop;
  return v_out;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- C. 후보 해석 + 정렬 (내부). playlist → runtime → generate fallback.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_resolve_and_order(
  p_brand_id uuid, p_playlist_id uuid, p_context jsonb, p_strategy text, p_limit integer)
returns jsonb
language plpgsql security definer
set search_path to 'public'
as $$
declare
  v_src_playlist uuid := null; v_runtime_rule uuid := null;
  v_fallback boolean := false; v_reason text := null; v_gen_reason text := null;
  v_cands jsonb := '[]'::jsonb; v_ordered jsonb; v_seed text; v_strategy text;
  v_rt jsonb; v_expl jsonb := '[]'::jsonb; v_lim integer := greatest(1, least(coalesce(p_limit,100), 500));
begin
  if not exists (select 1 from public.brand_accounts where id = p_brand_id and deleted_at is null) then
    raise exception 'brand not found';
  end if;
  v_strategy := case when p_strategy in ('balanced_shuffle','sequential','weighted') then p_strategy else 'balanced_shuffle' end;

  -- 1) 소스 결정
  if p_playlist_id is not null then
    if not exists (select 1 from public.brand_playlists where id = p_playlist_id and brand_id = p_brand_id and deleted_at is null) then
      raise exception 'playlist not found in this brand';
    end if;
    v_src_playlist := p_playlist_id;
    v_expl := v_expl || jsonb_build_array('source: explicit playlist');
  else
    v_rt := public.admin_preview_brand_runtime(p_brand_id, coalesce(p_context, '{}'::jsonb));
    v_runtime_rule := nullif(v_rt->'selected_rule'->>'id','')::uuid;
    if (v_rt->'selected_playlist'->>'id') is not null then
      v_src_playlist := (v_rt->'selected_playlist'->>'id')::uuid;
      v_expl := v_expl || jsonb_build_array('source: runtime selected playlist');
      if coalesce((v_rt->>'fallback_used')::boolean, false) then v_fallback := true; v_reason := 'runtime_fallback'; end if;
    else
      v_fallback := true; v_reason := 'runtime_generated';
      v_expl := v_expl || jsonb_build_array('source: runtime returned generated (no stored playlist)');
    end if;
  end if;

  -- 2) 후보 트랙
  if v_src_playlist is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'track_id', t.id, 'title', t.title, 'artist', t.artist,
      'genre', coalesce(nullif(t.main_genre,''), t.genre), 'mood', t.mood,
      'bpm', coalesce(t.bpm, f.bpm), 'energy', f.energy,
      'sort_order', bt.sort_order, 'weight', bt.weight,
      'source_playlist_id', bt.playlist_id, 'source_reason', 'playlist') order by bt.sort_order), '[]'::jsonb)
      into v_cands
      from public.brand_playlist_tracks bt
      join public.tracks t on t.id = bt.track_id
      left join public.track_audio_features f on f.track_id = t.id
      where bt.playlist_id = v_src_playlist;
  end if;

  -- 3) 후보 부족 → generate fallback
  if jsonb_array_length(v_cands) = 0 then
    v_fallback := true;
    v_reason := coalesce(v_reason, case when v_src_playlist is not null then 'empty_playlist_generated' else 'generated' end);
    v_gen_reason := 'generated';
    select coalesce(jsonb_agg(jsonb_build_object(
      'track_id', t.id, 'title', t.title, 'artist', t.artist,
      'genre', coalesce(nullif(t.main_genre,''), t.genre), 'mood', t.mood,
      'bpm', coalesce(t.bpm, f.bpm), 'energy', f.energy,
      'sort_order', x.ord, 'weight', 1,
      'source_playlist_id', null, 'source_reason', v_gen_reason) order by x.ord), '[]'::jsonb)
      into v_cands
      from (select (e->>'id')::uuid id, ord from jsonb_array_elements(public._brand_generate_playlist(p_brand_id, v_lim)) with ordinality g(e, ord)) x
      join public.tracks t on t.id = x.id
      left join public.track_audio_features f on f.track_id = t.id;
    v_expl := v_expl || jsonb_build_array('fallback: _brand_generate_playlist (' || v_reason || ')');
  end if;

  -- 4) seed + 정렬
  v_seed := coalesce(nullif(p_context->>'seed',''), md5(p_brand_id::text || coalesce(v_src_playlist::text,'') || v_strategy || coalesce(p_context::text,'{}')));
  v_ordered := public._brand_order_tracks(v_cands, v_strategy, v_seed, v_lim);
  v_expl := v_expl || jsonb_build_array(format('strategy=%s, seed=%s', v_strategy, left(v_seed, 8)));
  v_expl := v_expl || jsonb_build_array(format('ordered %s of %s candidates (limit %s)', jsonb_array_length(v_ordered), jsonb_array_length(v_cands), v_lim));

  return jsonb_build_object(
    'source_playlist_id', v_src_playlist,
    'runtime_rule_id', v_runtime_rule,
    'strategy', v_strategy,
    'seed', v_seed,
    'fallback_used', v_fallback,
    'reason', v_reason,
    'tracks', v_ordered,
    'explanation', v_expl,
    'stats', jsonb_build_object(
      'total_candidates', jsonb_array_length(v_cands),
      'returned', jsonb_array_length(v_ordered),
      'distinct_artists', (select count(distinct lower(e->>'artist')) from jsonb_array_elements(v_ordered) e where e->>'artist' is not null),
      'distinct_genres', (select count(distinct lower(e->>'genre')) from jsonb_array_elements(v_ordered) e where e->>'genre' is not null),
      'distinct_moods', (select count(distinct lower(e->>'mood')) from jsonb_array_elements(v_ordered) e where e->>'mood' is not null),
      'strategy', v_strategy, 'fallback_used', v_fallback)
  );
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- D. Preview (저장 없음) / Build (저장)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_preview_brand_queue(
  p_brand_id uuid, p_playlist_id uuid default null, p_context jsonb default '{}'::jsonb,
  p_strategy text default 'balanced_shuffle', p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  v := public._brand_resolve_and_order(p_brand_id, p_playlist_id, coalesce(p_context,'{}'::jsonb), p_strategy, p_limit);
  return jsonb_build_object(
    'tracks', v->'tracks', 'explanation', v->'explanation', 'stats', v->'stats',
    'strategy', v->>'strategy', 'seed', v->>'seed', 'fallback_used', v->'fallback_used',
    'source_playlist_id', v->'source_playlist_id', 'runtime_rule_id', v->'runtime_rule_id');
end;
$$;

create or replace function public.admin_build_brand_queue(
  p_brand_id uuid, p_playlist_id uuid default null, p_context jsonb default '{}'::jsonb,
  p_strategy text default 'balanced_shuffle', p_limit integer default 100)
returns jsonb
language plpgsql security definer set search_path to 'public'
as $$
declare v jsonb; v_run uuid; v_cnt integer;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  v := public._brand_resolve_and_order(p_brand_id, p_playlist_id, coalesce(p_context,'{}'::jsonb), p_strategy, p_limit);
  v_cnt := jsonb_array_length(v->'tracks');

  insert into public.brand_queue_runs (brand_id, playlist_id, runtime_rule_id, context, strategy, status, track_count, seed, reason, created_by)
  values (p_brand_id, nullif(v->>'source_playlist_id','')::uuid, nullif(v->>'runtime_rule_id','')::uuid,
          coalesce(p_context,'{}'::jsonb), v->>'strategy', 'generated', v_cnt, v->>'seed', v->>'reason', auth.uid())
  returning id into v_run;

  insert into public.brand_queue_tracks (queue_run_id, track_id, sort_order, source_playlist_id, source_reason, genre, mood, bpm, energy)
  select v_run, (e->>'track_id')::uuid, (ord - 1)::int,
         nullif(e->>'source_playlist_id','')::uuid, e->>'source_reason',
         e->>'genre', e->>'mood', nullif(e->>'bpm','')::numeric, nullif(e->>'energy','')::numeric
  from jsonb_array_elements(v->'tracks') with ordinality as g(e, ord);

  perform public._brand_audit(p_brand_id, 'queue.build',
    jsonb_build_object('queue_run_id', v_run, 'strategy', v->>'strategy', 'track_count', v_cnt, 'fallback', v->'fallback_used'));

  return jsonb_build_object(
    'queue_run', jsonb_build_object('id', v_run, 'strategy', v->>'strategy', 'track_count', v_cnt,
      'status', 'generated', 'seed', v->>'seed', 'reason', v->>'reason',
      'playlist_id', nullif(v->>'source_playlist_id','')::uuid, 'runtime_rule_id', nullif(v->>'runtime_rule_id','')::uuid),
    'tracks', v->'tracks', 'explanation', v->'explanation', 'stats', v->'stats');
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- E. 조회
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_list_brand_queues(p_brand_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', qr.id, 'strategy', qr.strategy, 'status', qr.status, 'track_count', qr.track_count,
    'playlist_id', qr.playlist_id, 'playlist_name', pl.name,
    'runtime_rule_id', qr.runtime_rule_id, 'runtime_rule_name', rr.name,
    'reason', qr.reason, 'seed', qr.seed, 'created_at', qr.created_at
  ) order by qr.created_at desc), '[]'::jsonb) into v
  from public.brand_queue_runs qr
  left join public.brand_playlists pl on pl.id = qr.playlist_id
  left join public.brand_runtime_rules rr on rr.id = qr.runtime_rule_id
  where qr.brand_id = p_brand_id and qr.deleted_at is null
  limit 30;
  return v;
end;
$$;

create or replace function public.admin_get_brand_queue(p_queue_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path to 'public'
as $$
declare v_run public.brand_queue_runs%rowtype; v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only' using errcode = '42501'; end if;
  select * into v_run from public.brand_queue_runs where id = p_queue_run_id and deleted_at is null;
  if not found then raise exception 'queue run not found'; end if;

  select jsonb_build_object(
    'queue_run', jsonb_build_object('id', v_run.id, 'brand_id', v_run.brand_id, 'playlist_id', v_run.playlist_id,
      'runtime_rule_id', v_run.runtime_rule_id, 'strategy', v_run.strategy, 'status', v_run.status,
      'track_count', v_run.track_count, 'seed', v_run.seed, 'reason', v_run.reason,
      'context', v_run.context, 'created_at', v_run.created_at),
    'tracks', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'sort_order', qt.sort_order, 'track_id', qt.track_id, 'title', t.title, 'artist', t.artist,
        'genre', qt.genre, 'mood', qt.mood, 'bpm', qt.bpm, 'energy', qt.energy,
        'source_playlist_id', qt.source_playlist_id, 'source_reason', qt.source_reason) order by qt.sort_order), '[]'::jsonb)
      from public.brand_queue_tracks qt left join public.tracks t on t.id = qt.track_id
      where qt.queue_run_id = v_run.id)
  ) into v;
  return v;
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- F. Health 확장 — queue 체크 3개 추가 (시그니처 동일, CREATE OR REPLACE)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._brand_health(p_brand_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path to 'public'
as $$
declare
  v_b public.brand_accounts%rowtype;
  c_policy boolean; c_playlist boolean; c_default boolean; c_media boolean; c_session boolean;
  c_recent_queue boolean; v_queue_tracks int; c_strategy_valid boolean;
  v_tracks int; v_media_cnt int;
  checks jsonb; passed int := 0; total int := 11;
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

  c_recent_queue := exists (select 1 from public.brand_queue_runs where brand_id = p_brand_id and deleted_at is null and created_at > now() - interval '7 days');
  v_queue_tracks := coalesce((select track_count from public.brand_queue_runs where brand_id = p_brand_id and deleted_at is null order by created_at desc limit 1), 0);
  c_strategy_valid := coalesce((select strategy in ('balanced_shuffle','sequential','weighted') from public.brand_queue_runs where brand_id = p_brand_id and deleted_at is null order by created_at desc limit 1), false);

  checks := jsonb_build_array(
    jsonb_build_object('key','has_brand',               'label','브랜드 존재',        'passed', true,             'detail', v_b.name),
    jsonb_build_object('key','has_music_policy',        'label','음악 정책',          'passed', c_policy,         'detail', case when c_policy then '설정됨' else '기본값' end),
    jsonb_build_object('key','has_active_playlist',     'label','활성 플레이리스트',  'passed', c_playlist,       'detail', case when c_playlist then '있음' else '없음' end),
    jsonb_build_object('key','has_runtime_default_rule','label','기본 Runtime 규칙',  'passed', c_default,        'detail', case when c_default then '있음' else '미설정' end),
    jsonb_build_object('key','has_media',               'label','활성 이미지',        'passed', c_media,          'detail', v_media_cnt || '개'),
    jsonb_build_object('key','has_recent_player_session','label','최근 24h 세션',     'passed', c_session,        'detail', case when c_session then '있음' else '없음' end),
    jsonb_build_object('key','playlist_track_count',    'label','재생 가능 트랙',     'passed', v_tracks > 0,     'detail', v_tracks || '곡'),
    jsonb_build_object('key','media_asset_count',       'label','미디어 자산',        'passed', v_media_cnt > 0,  'detail', v_media_cnt || '개'),
    jsonb_build_object('key','has_recent_queue',        'label','최근 Queue(7일)',    'passed', c_recent_queue,   'detail', case when c_recent_queue then '있음' else '없음' end),
    jsonb_build_object('key','queue_track_count',       'label','최신 Queue 트랙',    'passed', v_queue_tracks > 0,'detail', v_queue_tracks || '곡'),
    jsonb_build_object('key','queue_strategy_valid',    'label','Queue strategy',     'passed', c_strategy_valid, 'detail', case when c_strategy_valid then '유효' else '없음' end)
  );

  select count(*) into passed from jsonb_array_elements(checks) e where (e->>'passed')::boolean;
  return jsonb_build_object('score', round(passed * 100.0 / total), 'checks', checks);
end;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- G. 권한
-- ─────────────────────────────────────────────────────────────────────
do $$
declare fn text;
begin
  foreach fn in array array[
    'public.admin_preview_brand_queue(uuid,uuid,jsonb,text,integer)',
    'public.admin_build_brand_queue(uuid,uuid,jsonb,text,integer)',
    'public.admin_list_brand_queues(uuid)',
    'public.admin_get_brand_queue(uuid)'
  ] loop
    execute format('revoke execute on function %s from public, anon;', fn);
    execute format('grant  execute on function %s to authenticated;', fn);
  end loop;
end $$;

comment on table public.brand_queue_runs is
  'ENT-OS-4 — Brand Queue Run. Runtime 가 선택한 Playlist 를 재생 순서(Track Queue)로 변환한 결과. Player 강제 연동은 후속 Phase.';
comment on function public.admin_build_brand_queue(uuid,uuid,jsonb,text,integer) is
  'ENT-OS-4 — Queue Builder. playlist→runtime→generate fallback + ordering(sequential/weighted/balanced_shuffle) 후 저장. _is_super_admin 게이트.';
