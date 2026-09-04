-- ============================================================================
-- 0508_brand_daily_playlist_and_playback_policy.sql
-- Phase BRAND-DAILY-PLAYLIST-1
--
-- 두 가지를 추가한다.
--
-- ① 매일 아침 9시(KST) 브랜드별 신규 플레이리스트 자동 제작
--    관리자가 정해둔 규칙(brand_music_policies)으로 그날의 재생목록을 만들고
--    스냅샷으로 고정한다. 신규 발매곡이 자연스럽게 섞여 들어간다.
--
--    지금까지는 재생목록이 "요청할 때마다" 계산됐고(daily seed 로 순서만 매일 변경),
--    돌고 있는 플레이어는 config 를 다시 안 불러서 새 곡이 영원히 안 들어왔다.
--
--    ⚠ 교체 시 음악이 꺼지면 안 된다 — 그래서 서버는 스냅샷과 버전만 발행하고,
--      실제 큐 교체는 클라이언트가 "현재 재생 중인 곡을 건드리지 않고" 수행한다
--      (playerStore.replaceQueueKeepingCurrent). 서버는 재생을 끊지 않는다.
--
-- ② 브랜드별 재생 정책 (24시간 / 영업시간)
--    관리자 페이지에서 브랜드마다 24시간 상시 재생인지, 영업시간에만 재생인지
--    설정할 수 있게 한다. 기본값은 24시간(always_on) — 기존 동작 그대로.
--
-- additive only. 기존 함수 중 _brand_generate_playlist / get_brand_player_config
-- 두 개만 재정의하며, 둘 다 기존 반환 계약을 유지한다(필드 추가만).
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1) 브랜드별 재생 정책 컬럼
-- ----------------------------------------------------------------------------
alter table public.brand_accounts
  add column if not exists playback_mode text not null default 'always_on',
  add column if not exists open_time time,
  add column if not exists close_time time,
  add column if not exists playback_timezone text not null default 'Asia/Seoul',
  -- 0=일 … 6=토. null 이면 매일.
  add column if not exists playback_days int[];

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'brand_accounts_playback_mode_chk') then
    alter table public.brand_accounts
      add constraint brand_accounts_playback_mode_chk
      check (playback_mode in ('always_on','business_hours'));
  end if;
end $$;

comment on column public.brand_accounts.playback_mode is
  '0508 — always_on(24시간, 기본) | business_hours(영업시간에만)';

-- ----------------------------------------------------------------------------
-- 2) 일일 플레이리스트 스냅샷
--    브랜드 × 날짜(KST) 당 1건. 하루 동안은 이 목록이 고정된다.
-- ----------------------------------------------------------------------------
create table if not exists public.brand_daily_playlists (
  id uuid primary key default gen_random_uuid(),
  brand_id uuid not null references public.brand_accounts(id) on delete cascade,
  service_date date not null,
  tracks jsonb not null,
  track_count int not null default 0,
  new_release_count int not null default 0,
  total_seconds int not null default 0,
  generated_at timestamptz not null default now(),
  generated_by text not null default 'cron'
);
create unique index if not exists uniq_brand_daily_playlist
  on public.brand_daily_playlists (brand_id, service_date);
create index if not exists idx_brand_daily_playlist_recent
  on public.brand_daily_playlists (brand_id, service_date desc);

alter table public.brand_daily_playlists enable row level security;
drop policy if exists brand_daily_playlist_admin on public.brand_daily_playlists;
create policy brand_daily_playlist_admin on public.brand_daily_playlists for select to authenticated
  using (exists (select 1 from public.users u where u.id = auth.uid() and u.role = 'admin'));

-- ----------------------------------------------------------------------------
-- 3) 생성기 — 신규 발매곡 가산점
--    prod 정의(0503, artist_rank <= 12)를 그대로 옮기고 score 에 가산점만 더한다.
--    최근 14일 내 등록곡에 +18점. preferred_genre 1개(25점)보다 작게 두어
--    "신곡이 섞여 들어오되 정책을 뒤집지는 않는" 수준으로 맞춘다.
-- ----------------------------------------------------------------------------
create or replace function public._brand_generate_playlist(p_brand_id uuid, p_limit integer default 200)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb; pol public.brand_music_policies%rowtype;
  v_blocked_g text[]; v_pref_g text[]; v_blocked_m text[]; v_pref_m text[];
  v_allowed_g text[];
  v_limit int := greatest(1, least(coalesce(p_limit,200), 500));
  v_seed text := to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') || ':' || p_brand_id::text;
  v_industry text; v_is_study boolean;
begin
  select * into pol from public.brand_music_policies where brand_id = p_brand_id;
  select industry_type into v_industry from public.brand_accounts where id = p_brand_id;
  v_is_study := coalesce(public.normalize_store_label(v_industry),'') = 'study_cafe'
    or lower(btrim(coalesce(v_industry,''))) in ('study_cafe','스터디카페','스터디 카페','독서실','study cafe','studycafe');

  v_blocked_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.blocked_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_pref_g    := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.preferred_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');
  v_blocked_m := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.blocked_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_pref_m    := coalesce((select array_agg(distinct lower(btrim(m))) from unnest(coalesce(pol.preferred_moods,'{}')) m where btrim(m) <> ''), '{}');
  v_allowed_g := coalesce((select array_agg(distinct public._ai_norm_genre(g)) from unnest(coalesce(pol.allowed_genres,'{}')) g where public._ai_norm_genre(g) <> ''), '{}');

  with base as (
    select t.id, t.title, t.artist, t.genre, t.mood, t.audio_url, t.cover_url, t.duration, t.created_at,
           t.owner_user_id, t.instrumental, t.lyric_type, t.vocal_type, f.energy as feat_energy,
           coalesce(t.bpm, f.bpm) as feat_bpm,
           coalesce((select array_agg(distinct public._ai_norm_genre(z)) from unnest(array_remove(array[t.main_genre, t.genre] || coalesce(t.genre_tags,'{}'), null)) z where public._ai_norm_genre(z) <> ''), '{}') as norm_genres,
           lower(coalesce(t.mood,'') || ' ' || array_to_string(coalesce(t.mood_tags,'{}'),' ') || ' ' || array_to_string(coalesce(m.ai_moods,'{}'),' ')) as mood_blob
    from public.tracks t
    left join public.track_audio_features f on f.track_id = t.id
    left join public.track_ai_metadata m on m.track_id = t.id
    where t.audio_url is not null and length(btrim(t.audio_url)) > 0
      and t.cover_url is not null and length(btrim(t.cover_url)) > 0
      and (t.release_status = 'released' or t.release_status is null)
      and t.removed_at is null
      and (t.audio_health_status is null or t.audio_health_status in ('ok','unknown'))
      and (not v_is_study or coalesce((public._study_cafe_track_eligible(t.id)->>'eligible')::boolean, false))
  ),
  filtered as (
    select b.*,
      (case when pol.vocal_policy = 'instrumental_only' then (b.instrumental is true or b.lyric_type = 'instrumental' or b.vocal_type = 'instrumental') else true end) as vocal_ok,
      (case when b.feat_energy is null then true else (pol.energy_min is null or b.feat_energy >= pol.energy_min) and (pol.energy_max is null or b.feat_energy <= pol.energy_max) end) as energy_ok,
      (array_length(v_allowed_g,1) is null or exists (select 1 from unnest(v_allowed_g) ag where ag = any(b.norm_genres))) as allowed_ok,
      (case when b.feat_bpm is null then true else (pol.bpm_min is null or b.feat_bpm >= pol.bpm_min) and (pol.bpm_max is null or b.feat_bpm <= pol.bpm_max) end) as bpm_ok,
      (exists (select 1 from unnest(v_blocked_g) bg where bg = any(b.norm_genres))) as blocked_g_hit,
      (exists (select 1 from unnest(v_blocked_m) bm where b.mood_blob like '%'||bm||'%')) as blocked_m_hit,
      (select count(*) from unnest(v_pref_g) pg where pg = any(b.norm_genres)) as pref_g_hits,
      (select count(*) from unnest(v_pref_m) pm where b.mood_blob like '%'||pm||'%') as pref_m_hits,
      -- 🆕 0508: 최근 14일 신규 발매곡
      (b.created_at > now() - interval '14 days') as is_new_release
    from base b
  ),
  eligible as (
    select f.*,
      (f.pref_g_hits*25 + f.pref_m_hits*15 + case when f.energy_ok then 5 else 0 end
        + case when pol.vocal_policy='prefer_instrumental' and (f.instrumental is true or f.lyric_type='instrumental') then 10 else 0 end
        -- 🆕 0508: 신곡 가산점. preferred_genre 1개(25)보다 작게 두어 정책을 뒤집지 않는다.
        + case when f.is_new_release then 18 else 0 end)::numeric as score,
      ('x' || substr(md5(f.id::text || v_seed),1,8))::bit(32)::bigint as rot
    from filtered f
    where not f.blocked_g_hit and not f.blocked_m_hit and f.vocal_ok
      and f.allowed_ok and f.bpm_ok
  ),
  diversified as (
    select e.*, row_number() over (partition by coalesce(lower(btrim(e.artist)), e.id::text) order by (case when e.energy_ok then 1 else 0 end) desc, e.score desc, e.rot) as artist_rank
    from eligible e
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'title', d.title, 'artist', d.artist, 'genre', d.genre, 'mood', d.mood, 'audio_url', d.audio_url, 'cover_url', d.cover_url, 'duration', d.duration, 'created_at', d.created_at, 'is_new_release', d.is_new_release)
           order by (case when d.energy_ok then 1 else 0 end) desc, d.score desc, d.rot), '[]'::jsonb) into v
  from diversified d where d.artist_rank <= 12 limit v_limit;
  return v;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4) 일일 스냅샷 생성 (아침 9시 KST cron)
-- ----------------------------------------------------------------------------
create or replace function public.generate_brand_daily_playlist(p_brand_id uuid, p_force boolean default false)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_date date := (now() at time zone 'Asia/Seoul')::date;
  v_tracks jsonb;
  v_count int; v_new int; v_secs int;
  v_row public.brand_daily_playlists;
begin
  if not p_force and exists (
    select 1 from public.brand_daily_playlists
     where brand_id = p_brand_id and service_date = v_date
  ) then
    return jsonb_build_object('ok', true, 'skipped', 'already_generated', 'service_date', v_date);
  end if;

  v_tracks := public._brand_generate_playlist(p_brand_id, 300);
  v_count := jsonb_array_length(v_tracks);

  -- 곡이 하나도 안 나오면 기존 스냅샷을 지우지 않는다 (재생 중단 방지)
  if v_count = 0 then
    return jsonb_build_object('ok', false, 'reason', 'empty_playlist', 'service_date', v_date);
  end if;

  select count(*) filter (where (e->>'is_new_release')::boolean),
         coalesce(sum((e->>'duration')::int), 0)
    into v_new, v_secs
  from jsonb_array_elements(v_tracks) e;

  insert into public.brand_daily_playlists
    (brand_id, service_date, tracks, track_count, new_release_count, total_seconds, generated_at, generated_by)
  values (p_brand_id, v_date, v_tracks, v_count, coalesce(v_new,0), coalesce(v_secs,0), now(), 'cron')
  on conflict (brand_id, service_date) do update set
    tracks = excluded.tracks, track_count = excluded.track_count,
    new_release_count = excluded.new_release_count, total_seconds = excluded.total_seconds,
    generated_at = now()
  returning * into v_row;

  return jsonb_build_object('ok', true, 'service_date', v_date,
    'track_count', v_row.track_count, 'new_release_count', v_row.new_release_count,
    'total_hours', round(v_row.total_seconds/3600.0, 2), 'generated_at', v_row.generated_at);
end;
$$;

create or replace function public.cron_generate_brand_daily_playlists()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  b record; v_ok int := 0; v_fail int := 0; v_results jsonb := '[]'::jsonb; r jsonb;
begin
  for b in select id, name from public.brand_accounts where deleted_at is null and status = 'active' loop
    begin
      r := public.generate_brand_daily_playlist(b.id, true);
      if coalesce((r->>'ok')::boolean, false) then v_ok := v_ok + 1; else v_fail := v_fail + 1; end if;
      v_results := v_results || jsonb_build_array(jsonb_build_object('brand', b.name) || r);
    exception when others then
      -- 브랜드 하나가 실패해도 나머지는 계속 생성한다
      v_fail := v_fail + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object('brand', b.name, 'ok', false, 'error', SQLERRM));
    end;
  end loop;
  return jsonb_build_object('ok', true, 'generated', v_ok, 'failed', v_fail,
                            'service_date', (now() at time zone 'Asia/Seoul')::date, 'results', v_results);
end;
$$;

-- ----------------------------------------------------------------------------
-- 5) 영업시간 판정 — 지금 재생해도 되는가
--    always_on(기본)이면 항상 true. 자정을 넘기는 영업시간(22:00~02:00)도 처리한다.
-- ----------------------------------------------------------------------------
create or replace function public.resolve_brand_playback_window(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  ba public.brand_accounts;
  v_tz text; v_local timestamp; v_t time; v_dow int; v_open boolean;
begin
  select * into ba from public.brand_accounts where id = p_brand_id and deleted_at is null;
  if ba.id is null then
    return jsonb_build_object('mode', 'always_on', 'should_play', true, 'reason', 'brand_not_found');
  end if;
  if ba.playback_mode <> 'business_hours' or ba.open_time is null or ba.close_time is null then
    return jsonb_build_object('mode', 'always_on', 'should_play', true);
  end if;

  v_tz := coalesce(nullif(btrim(ba.playback_timezone), ''), 'Asia/Seoul');
  v_local := now() at time zone v_tz;
  v_t := v_local::time;
  v_dow := extract(dow from v_local)::int;

  if ba.playback_days is not null and array_length(ba.playback_days, 1) is not null
     and not (v_dow = any(ba.playback_days)) then
    return jsonb_build_object('mode', 'business_hours', 'should_play', false,
                              'reason', 'closed_day', 'local_time', to_char(v_local, 'YYYY-MM-DD HH24:MI'),
                              'open_time', ba.open_time, 'close_time', ba.close_time);
  end if;

  if ba.open_time <= ba.close_time then
    v_open := v_t >= ba.open_time and v_t < ba.close_time;
  else
    -- 자정을 넘기는 영업시간 (예: 22:00 ~ 02:00)
    v_open := v_t >= ba.open_time or v_t < ba.close_time;
  end if;

  return jsonb_build_object('mode', 'business_hours', 'should_play', v_open,
                            'reason', case when v_open then 'open' else 'closed_hours' end,
                            'local_time', to_char(v_local, 'YYYY-MM-DD HH24:MI'),
                            'open_time', ba.open_time, 'close_time', ba.close_time,
                            'timezone', v_tz);
end;
$$;

-- ----------------------------------------------------------------------------
-- 6) 플레이어 config — 오늘 스냅샷 우선 + 버전 + 재생 정책
--    스냅샷이 없으면(첫날/cron 미실행) 즉석 생성으로 폴백 → 재생이 끊기지 않는다.
-- ----------------------------------------------------------------------------
create or replace function public.get_brand_player_config(p_brand_id uuid, p_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions'
as $$
declare
  v_brand public.brand_accounts%rowtype; v_hash text; v_sid uuid;
  v_daily public.brand_daily_playlists;
  v_playlist jsonb; v_version text;
begin
  if coalesce(btrim(p_session_token),'') = '' then raise exception 'session required' using errcode='42501'; end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select s.id into v_sid from public.brand_player_sessions s
   where s.brand_id = p_brand_id and s.session_token_hash = v_hash limit 1;
  if v_sid is null then raise exception 'invalid session' using errcode='42501'; end if;

  select * into v_brand from public.brand_accounts where id = p_brand_id and deleted_at is null and status='active';
  if not found then raise exception 'brand unavailable'; end if;

  update public.brand_player_sessions set last_seen_at = now() where id = v_sid;

  -- 오늘(KST) 스냅샷 우선. 없으면 즉석 생성 폴백.
  select * into v_daily from public.brand_daily_playlists
   where brand_id = p_brand_id and service_date = (now() at time zone 'Asia/Seoul')::date
   limit 1;

  if v_daily.id is not null and v_daily.track_count > 0 then
    v_playlist := v_daily.tracks;
    v_version  := to_char(v_daily.generated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS');
  else
    v_playlist := public._brand_generate_playlist(p_brand_id, 300);
    v_version  := 'live-' || to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD');
  end if;

  return jsonb_build_object(
    'brand', jsonb_build_object('id', v_brand.id, 'name', v_brand.name, 'industry_type', v_brand.industry_type),
    'policy', (select row_to_json(p) from (
        select preferred_genres, blocked_genres, preferred_moods, blocked_moods,
               energy_min, energy_max, vocal_policy, auto_generate_enabled
        from public.brand_music_policies where brand_id = p_brand_id) p),
    'media', (select coalesce(jsonb_agg(jsonb_build_object(
                'id', id, 'title', title, 'image_url', image_url,
                'display_duration_seconds', display_duration_seconds, 'sort_order', sort_order,
                'asset_type', asset_type, 'mime_type', mime_type,
                'thumbnail_url', thumbnail_url, 'media_duration_seconds', media_duration_seconds)
              order by sort_order, created_at), '[]'::jsonb)
        from public.brand_media_assets
        where brand_id = p_brand_id and deleted_at is null and status='active'
          and (starts_at is null or starts_at <= now())
          and (ends_at   is null or ends_at   >= now())),
    'signage', public._brand_signage_json(p_brand_id),
    'playlist', v_playlist,
    -- 🆕 0508
    'playlist_version', v_version,
    'playback', public.resolve_brand_playback_window(p_brand_id)
  );
end;
$$;

-- 가벼운 폴링용 — 큐 전체를 다시 받지 않고 버전만 확인한다
create or replace function public.get_brand_playlist_version(p_brand_id uuid, p_session_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions'
as $$
declare v_hash text; v_sid uuid; v_daily public.brand_daily_playlists;
begin
  if coalesce(btrim(p_session_token),'') = '' then raise exception 'session required' using errcode='42501'; end if;
  v_hash := encode(extensions.digest(p_session_token::bytea, 'sha256'), 'hex');
  select s.id into v_sid from public.brand_player_sessions s
   where s.brand_id = p_brand_id and s.session_token_hash = v_hash limit 1;
  if v_sid is null then raise exception 'invalid session' using errcode='42501'; end if;

  select * into v_daily from public.brand_daily_playlists
   where brand_id = p_brand_id and service_date = (now() at time zone 'Asia/Seoul')::date limit 1;

  return jsonb_build_object(
    'playlist_version', case when v_daily.id is not null and v_daily.track_count > 0
      then to_char(v_daily.generated_at at time zone 'UTC', 'YYYYMMDD"T"HH24MISS')
      else 'live-' || to_char((now() at time zone 'Asia/Seoul')::date, 'YYYYMMDD') end,
    'track_count', coalesce(v_daily.track_count, 0),
    'new_release_count', coalesce(v_daily.new_release_count, 0),
    'playback', public.resolve_brand_playback_window(p_brand_id)
  );
end;
$$;

-- ----------------------------------------------------------------------------
-- 7) 관리자 — 재생 정책 조회/설정
-- ----------------------------------------------------------------------------
create or replace function public.admin_get_brand_playback_policy(p_brand_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare v jsonb;
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  select jsonb_build_object(
    'brand_id', ba.id, 'brand_name', ba.name,
    'playback_mode', ba.playback_mode,
    'open_time', ba.open_time, 'close_time', ba.close_time,
    'playback_timezone', ba.playback_timezone, 'playback_days', ba.playback_days,
    'now', public.resolve_brand_playback_window(ba.id),
    'today', (select jsonb_build_object('service_date', d.service_date, 'track_count', d.track_count,
                     'new_release_count', d.new_release_count,
                     'total_hours', round(d.total_seconds/3600.0, 2), 'generated_at', d.generated_at)
                from public.brand_daily_playlists d
               where d.brand_id = ba.id and d.service_date = (now() at time zone 'Asia/Seoul')::date)
  ) into v
  from public.brand_accounts ba where ba.id = p_brand_id and ba.deleted_at is null;
  return v;
end;
$$;

create or replace function public.admin_set_brand_playback_policy(
  p_brand_id uuid, p_playback_mode text,
  p_open_time time default null, p_close_time time default null,
  p_timezone text default 'Asia/Seoul', p_days int[] default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  if p_playback_mode not in ('always_on','business_hours') then
    raise exception 'invalid playback_mode';
  end if;
  if p_playback_mode = 'business_hours' and (p_open_time is null or p_close_time is null) then
    raise exception '영업시간 모드는 시작/종료 시각이 필요합니다.';
  end if;
  if p_open_time is not null and p_close_time is not null and p_open_time = p_close_time then
    raise exception '시작 시각과 종료 시각이 같습니다. 24시간 재생이면 always_on 을 선택하세요.';
  end if;

  update public.brand_accounts
     set playback_mode = p_playback_mode,
         open_time  = case when p_playback_mode = 'business_hours' then p_open_time else null end,
         close_time = case when p_playback_mode = 'business_hours' then p_close_time else null end,
         playback_timezone = coalesce(nullif(btrim(p_timezone),''), 'Asia/Seoul'),
         playback_days = case when p_playback_mode = 'business_hours' then p_days else null end,
         updated_at = now()
   where id = p_brand_id and deleted_at is null;
  if not found then raise exception 'brand not found'; end if;

  return public.admin_get_brand_playback_policy(p_brand_id);
end;
$$;

-- 관리자 수동 재생성
create or replace function public.admin_regenerate_brand_daily_playlist(p_brand_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not exists (select 1 from public.users u where u.id=auth.uid() and u.role='admin') then
    raise exception 'unauthorized';
  end if;
  return public.generate_brand_daily_playlist(p_brand_id, true);
end;
$$;

-- ----------------------------------------------------------------------------
-- 8) 권한
-- ----------------------------------------------------------------------------
revoke execute on function public.generate_brand_daily_playlist(uuid, boolean) from public, anon, authenticated;
grant  execute on function public.generate_brand_daily_playlist(uuid, boolean) to service_role;
revoke execute on function public.cron_generate_brand_daily_playlists() from public, anon, authenticated;
grant  execute on function public.cron_generate_brand_daily_playlists() to service_role;
revoke execute on function public.resolve_brand_playback_window(uuid) from public, anon;
grant  execute on function public.resolve_brand_playback_window(uuid) to authenticated, service_role;
revoke execute on function public.get_brand_playlist_version(uuid, text) from public, anon;
grant  execute on function public.get_brand_playlist_version(uuid, text) to authenticated, service_role;
revoke execute on function public.admin_get_brand_playback_policy(uuid) from public, anon;
grant  execute on function public.admin_get_brand_playback_policy(uuid) to authenticated, service_role;
revoke execute on function public.admin_set_brand_playback_policy(uuid, text, time, time, text, int[]) from public, anon;
grant  execute on function public.admin_set_brand_playback_policy(uuid, text, time, time, text, int[]) to authenticated, service_role;
revoke execute on function public.admin_regenerate_brand_daily_playlist(uuid) from public, anon;
grant  execute on function public.admin_regenerate_brand_daily_playlist(uuid) to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 9) 매일 09:00 KST (00:00 UTC) 자동 생성
--    관리자가 정해둔 규칙으로 그날의 브랜드 플레이리스트를 만든다.
--    클라이언트는 버전 변경을 감지해 09:01~09:05 사이에 큐만 교체한다(무중단).
-- ----------------------------------------------------------------------------
select cron.schedule(
  'srr-brand-daily-playlist',
  '0 0 * * *',
  $cron$select public.cron_generate_brand_daily_playlists();$cron$
);
