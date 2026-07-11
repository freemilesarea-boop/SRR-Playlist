-- 0464 — Phase AI-MUSIC-1: Intelligent Music Operating System Foundation
--
-- 목적:
--   기존 운영 플랫폼(WEB-OPT/OBS/OPS) 위에 Rule 기반 AI Music OS의 첫 기반 계층을 만든다. 실제 LLM/생성형
--   AI는 사용하지 않는다. 이 migration은 (1) AI 산출물(프로필/추천/디스커버리) 저장용 신규 격리 테이블,
--   (2) 기존 음악/재생/러닝 데이터를 READ-ONLY 로 집계해 클라이언트 engine(src/lib/aiMusic) 입력을 만드는
--   조회 RPC 를 제공한다. 판정(profile/compat/recommend/simulate)은 전부 클라이언트 규칙 엔진에서 수행한다.
--
-- 안전 (절대):
--   • Additive Only. 신규 테이블 4 + 신규 RPC 다수. 기존 테이블/뷰/RLS/데이터/정산/노출/Playlist 로직 무변경.
--     tracks / playback_events_v2 / track_*_scores / store_track_reactions / business_profiles / audio_qc_reports
--     는 READ-ONLY 참조만.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용.
--   • AI는 추천/시뮬레이션만. 어떤 RPC 도 Playlist 를 자동 생성·배포하거나 운영 정책을 실행하지 않는다.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + row 상한.

-- ─────────────────────────────────────────────────────────────────────
-- 1) AI 산출물 저장 테이블 (신규, 격리 — 기존 데이터와 분리)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_music_store_profiles (
  store_id     uuid primary key,
  store_type   text,
  profile      jsonb not null default '{}'::jsonb,   -- 계산된 StoreProfile 스냅샷(파생)
  computed_by  uuid,
  computed_at  timestamptz not null default now()
);
comment on table public.ai_music_store_profiles is 'AI-MUSIC-1 매장 AI 프로필 스냅샷(파생·추천용). 원본 store 데이터 아님.';

create table if not exists public.ai_music_track_profiles (
  track_id     uuid primary key,
  profile      jsonb not null default '{}'::jsonb,
  computed_at  timestamptz not null default now()
);
comment on table public.ai_music_track_profiles is 'AI-MUSIC-1 트랙 AI 프로필 스냅샷(파생). 원본 tracks 데이터 아님.';

create table if not exists public.ai_music_recommendations (
  id          uuid primary key default gen_random_uuid(),
  scope       text not null,
  store_id    uuid,
  kind        text not null check (kind in ('RECOMMEND_TRACK','EXCLUDE_TRACK','RECOMMEND_PLAYLIST','RECOMMEND_GENRE','RECOMMEND_MOOD')),
  target_id   text not null,
  label       text,
  score       numeric,
  reason      text,
  confidence  text,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
comment on table public.ai_music_recommendations is 'AI-MUSIC-1 추천 스냅샷(권고 전용). 자동 배포/실행 없음.';
create index if not exists air_store_idx on public.ai_music_recommendations (store_id, created_at desc);

create table if not exists public.ai_music_discovery_candidates (
  id           uuid primary key default gen_random_uuid(),
  track_id     uuid not null,
  stage        text not null default 'CANDIDATE' check (stage in ('CANDIDATE','PILOT','EVALUATION','RECOMMENDED_EXPANSION','APPROVED','GENERAL_DISTRIBUTION')),
  pilot_stores int not null default 0,
  pilot_plays  int not null default 0,
  note         text,
  updated_by   uuid,
  updated_at   timestamptz not null default now()
);
comment on table public.ai_music_discovery_candidates is 'AI-MUSIC-1 디스커버리 후보 단계(게이트). 자동 배포 없음 — 승격은 운영자 승인.';
create index if not exists adc_stage_idx on public.ai_music_discovery_candidates (stage, updated_at desc);

-- RLS: super-admin read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_music_store_profiles','ai_music_track_profiles','ai_music_recommendations','ai_music_discovery_candidates'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Store list — 재생 이벤트가 있는 매장(business_id) 목록 + 업종. READ-ONLY.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_store_list(p_window text default '30d', p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._obs_window_interval(p_window); v_limit int := least(greatest(coalesce(p_limit,100),1),300); v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'stores', coalesce((
    select jsonb_agg(jsonb_build_object('storeId', s.business_id, 'plays', s.plays,
      'storeType', bp.business_type, 'storeName', bp.store_name) order by s.plays desc)
    from (
      select business_id, count(*) plays from public.playback_events_v2
      where created_at >= v_since and business_id is not null group by business_id order by count(*) desc limit v_limit
    ) s left join public.business_profiles bp on bp.user_id = s.business_id
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_store_list(text,int) from public;
do $$ begin begin grant execute on function public.admin_ai_store_list(text,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Store aggregate — StorePlayAggregate JSON (playback_events_v2 by business_id + tracks + reactions).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_store_aggregate(p_store uuid, p_window text default '30d')
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_since timestamptz := now() - public._obs_window_interval(p_window); v jsonb; v_type text;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store is null then raise exception 'store required'; end if;
  select business_type into v_type from public.business_profiles where user_id = p_store;

  with ev as (
    select e.*, coalesce(t.main_genre, t.genre) as genre, coalesce(t.mood, (t.mood_tags)[1]) as mood,
           coalesce(af.energy, t.energy_level::numeric/5.0) as energy, t.instrumental
    from public.playback_events_v2 e
    join public.tracks t on t.id = e.track_id
    left join public.track_audio_features af on af.track_id = e.track_id
    where e.business_id = p_store and e.created_at >= v_since
  )
  select jsonb_build_object(
    'storeId', p_store, 'storeType', v_type,
    'plays', (select count(*) from ev),
    'skips', (select count(*) from ev where event_type='skip'),
    'completes', (select count(*) from ev where event_type='play_complete'),
    'likes', (select count(*) from ev where event_type='like'),
    'dislikes', (select count(*) from public.store_track_reactions where store_id = p_store and reaction_type='dislike'),
    'replays', (select count(*) from ev where event_type='replay'),
    'sessionCount', (select count(distinct session_id) from ev),
    'avgSessionSeconds', (select round(avg(s)) from (select session_id, sum(coalesce(listened_seconds,0)) s from ev group by session_id) x),
    'genreShare', coalesce((select jsonb_object_agg(genre, c) from (select genre, count(*) c from ev where genre is not null group by genre order by c desc limit 20) g), '{}'::jsonb),
    'moodShare', coalesce((select jsonb_object_agg(mood, c) from (select mood, count(*) c from ev where mood is not null group by mood order by c desc limit 20) m), '{}'::jsonb),
    'instrumentalPlays', (select count(*) from ev where instrumental is true),
    'vocalPlays', (select count(*) from ev where instrumental is not true),
    'energySum', coalesce((select round(sum(energy),3) from ev where energy is not null), 0),
    'energyCount', (select count(*) from ev where energy is not null),
    'activeHours', coalesce((select jsonb_object_agg(h::text, c) from (select extract(hour from created_at)::int h, count(*) c from ev group by 1) a), '{}'::jsonb)
  ) into v;
  return jsonb_build_object('ok', true, 'aggregate', v);
end; $$;
revoke execute on function public.admin_ai_store_aggregate(uuid,text) from public;
do $$ begin begin grant execute on function public.admin_ai_store_aggregate(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Track profiles — TrackMeta + TrackPerformance rows for candidate tracks (by store_type_slug).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_track_profiles(p_store_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_slug text := nullif(btrim(coalesce(p_store_type,'')),''); v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  begin if v_slug is not null then v_slug := public.normalize_store_label(v_slug); end if; exception when others then null; end;

  select jsonb_build_object('ok', true, 'tracks', coalesce((
    select jsonb_agg(jsonb_build_object(
      'meta', jsonb_build_object('trackId', t.id, 'title', t.title, 'artistId', null, 'genre', coalesce(t.main_genre, t.genre),
        'mood', coalesce(t.mood, (t.mood_tags)[1]), 'energy', coalesce(af.energy, t.energy_level::numeric/5.0),
        'danceability', af.danceability, 'bpm', coalesce(t.bpm, af.bpm::int), 'instrumental', t.instrumental,
        'vocal', case when t.vocal_type is not null then true when t.instrumental then false else null end,
        'durationSeconds', coalesce(t.duration, af.duration_seconds::int), 'qcStatus', qc.qc_grade),
      'perf', jsonb_build_object(
        'plays', coalesce(tsb.play_count, 0),
        'skips', round(coalesce(tsb.skip_rate,0) * coalesce(tsb.play_count,0)),
        'completes', round(coalesce(tsb.completion_rate,0) * coalesce(tsb.play_count,0)),
        'replays', round(coalesce(tsb.replay_rate,0) * coalesce(tsb.play_count,0)),
        'likes', round(coalesce(tsb.like_rate,0) * coalesce(tsb.play_count,0)),
        'dislikes', 0,
        'learningScore', tsb.store_behavior_score)
    ) order by t.created_at desc)
    from (
      select * from public.tracks
      where coalesce(is_recommendable, true) and coalesce(visibility,'public') = 'public'
      order by created_at desc limit v_limit
    ) t
    left join public.track_audio_features af on af.track_id = t.id
    left join lateral (
      select * from public.track_store_behavior_scores b
      where b.track_id = t.id and (v_slug is null or b.store_type_slug = v_slug)
      order by b.window_days desc limit 1
    ) tsb on true
    left join lateral (
      select qc_grade from public.audio_qc_reports r where r.track_id = t.id order by created_at desc limit 1
    ) qc on true
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_track_profiles(text,int) from public;
do $$ begin begin grant execute on function public.admin_ai_track_profiles(text,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Discovery read + write (advisory — no auto-distribution).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_discovery(p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'candidates', coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'trackId', d.track_id, 'title', t.title, 'stage', d.stage,
      'pilotStores', d.pilot_stores, 'pilotPlays', d.pilot_plays, 'note', d.note,
      'updatedAt', to_char(d.updated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by d.updated_at desc)
    from (select * from public.ai_music_discovery_candidates order by updated_at desc limit v_limit) d
    left join public.tracks t on t.id = d.track_id), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_discovery(int) from public;
do $$ begin begin grant execute on function public.admin_ai_discovery(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.upsert_ai_discovery_candidate(p_track uuid, p_stage text, p_pilot_stores int default 0, p_pilot_plays int default 0, p_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_stage text := upper(coalesce(p_stage,'CANDIDATE')); v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_stage not in ('CANDIDATE','PILOT','EVALUATION','RECOMMENDED_EXPANSION','APPROVED','GENERAL_DISTRIBUTION') then v_stage := 'CANDIDATE'; end if;
  insert into public.ai_music_discovery_candidates (track_id, stage, pilot_stores, pilot_plays, note, updated_by, updated_at)
    values (p_track, v_stage, greatest(coalesce(p_pilot_stores,0),0), greatest(coalesce(p_pilot_plays,0),0), left(coalesce(p_note,''),500), auth.uid(), now())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory only — no auto-distribution');
end; $$;
revoke execute on function public.upsert_ai_discovery_candidate(uuid,text,int,int,text) from public;
do $$ begin begin grant execute on function public.upsert_ai_discovery_candidate(uuid,text,int,int,text) to authenticated; exception when undefined_object then null; end; end $$;

-- Save a recommendation snapshot (advisory — nothing is deployed/played).
create or replace function public.record_ai_recommendation(p_scope text, p_store uuid, p_kind text, p_target text, p_label text, p_score numeric, p_reason text, p_confidence text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_kind text := upper(coalesce(p_kind,'')); v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_kind not in ('RECOMMEND_TRACK','EXCLUDE_TRACK','RECOMMEND_PLAYLIST','RECOMMEND_GENRE','RECOMMEND_MOOD') then raise exception 'invalid kind'; end if;
  insert into public.ai_music_recommendations (scope, store_id, kind, target_id, label, score, reason, confidence, created_by)
    values (left(coalesce(p_scope,'FLEET'),120), p_store, v_kind, left(coalesce(p_target,''),200), left(coalesce(p_label,''),200),
            p_score, left(coalesce(p_reason,''),500), left(coalesce(p_confidence,''),24), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory recommendation stored — not executed');
end; $$;
revoke execute on function public.record_ai_recommendation(text,uuid,text,text,text,numeric,text,text) from public;
do $$ begin begin grant execute on function public.record_ai_recommendation(text,uuid,text,text,text,numeric,text,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.record_ai_recommendation(text,uuid,text,text,text,numeric,text,text);
--   drop function if exists public.upsert_ai_discovery_candidate(uuid,text,int,int,text);
--   drop function if exists public.admin_ai_discovery(int);
--   drop function if exists public.admin_ai_track_profiles(text,int);
--   drop function if exists public.admin_ai_store_aggregate(uuid,text);
--   drop function if exists public.admin_ai_store_list(text,int);
--   drop table if exists public.ai_music_discovery_candidates;
--   drop table if exists public.ai_music_recommendations;
--   drop table if exists public.ai_music_track_profiles;
--   drop table if exists public.ai_music_store_profiles;
-- 신규(0464) 테이블 4 + 함수 6. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/정산/노출/Playlist 로직 영향 없음.
-- tracks / playback_events_v2 / track_*_scores / store_track_reactions / business_profiles / audio_qc_reports 는 READ-ONLY.
