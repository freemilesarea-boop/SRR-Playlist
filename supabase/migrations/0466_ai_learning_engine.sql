-- 0466 — Phase AI-MUSIC-3: Adaptive Music Intelligence & Continuous Learning
--
-- 목적:
--   AI-MUSIC-1(0464)/AI-MUSIC-2(0465) 위에, 실제 운영 데이터(재생 + 반응)를 기반으로 Playlist 를 계속
--   개선하는 Learning Loop 를 만든다. 판정(reinforcement/adaptive score/reputation/evolution/drift)은 전부
--   클라이언트 규칙 엔진(src/lib/aiLearning)에서 수행하며, 이 migration 은 (1) 학습 산출물(버전/학습이력/
--   평판/드리프트)을 저장할 신규 격리 테이블, (2) 강화신호·평판 입력을 READ-ONLY 로 집계하는 조회 RPC +
--   advisory 기록 RPC 를 제공한다. 실제 LLM / 강화학습 모델 없음.
--
-- 안전 (절대):
--   • Additive Only. 신규 테이블 4 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/정산/노출/Playlist·Queue·Player·
--     Ranking·Streaming·Governance 로직 무변경. playback_events_v2 / store_track_reactions /
--     track_store_behavior_scores / tracks 는 READ-ONLY 참조만.
--   • Production Apply 금지. Preview / rollback-txn 검증 전용. 운영 head 는 0453 유지.
--   • AI는 Recommendation 만. 어떤 RPC 도 실제 Playlist/Queue/재생/노출/정산을 변경하지 않는다. 학습 결과는
--     제안 스냅샷으로만 저장되고, 실제 반영은 운영자 승인 후 별도로 수행된다(자동 없음).
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + row 상한.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 학습 산출물 저장 테이블 (신규, 격리 — 기존 데이터와 분리, 자동 반영 없음)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_playlist_versions (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid,
  playlist_ref text,                         -- 논리적 Playlist 식별(제안 스냅샷 참조)
  version      int  not null default 1,
  score        numeric,
  track_count  int  not null default 0,
  diversity    numeric,
  fatigue_risk numeric,
  label        text,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
comment on table public.ai_playlist_versions is 'AI-MUSIC-3 Playlist 버전 이력(V1..Vn) 스냅샷. 제안 전용 — 실제 Playlist 아님.';
create index if not exists apv_store_idx on public.ai_playlist_versions (store_id, playlist_ref, version);

create table if not exists public.ai_learning_history (
  id             uuid primary key default gen_random_uuid(),
  store_id       uuid,
  playlist_ref   text,
  yesterday_score numeric,
  today_score    numeric,
  next_score     numeric,
  reward         numeric,
  penalty        numeric,
  net            numeric,
  trend          text,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_learning_history is 'AI-MUSIC-3 Adaptive Score 학습 이력(Yesterday→Today→Next). 권고 전용.';
create index if not exists alh_store_idx on public.ai_learning_history (store_id, created_at desc);

create table if not exists public.ai_track_reputation (
  id          uuid primary key default gen_random_uuid(),
  track_id    uuid not null,
  store_type  text,
  score       numeric,
  band        text,
  trend       text,
  prior_score numeric,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
comment on table public.ai_track_reputation is 'AI-MUSIC-3 Track 평판 스냅샷(Excellent/Good/Weak/Recovering). 평가 전용 — 노출/랭킹 변경 아님.';
create index if not exists atr_track_idx on public.ai_track_reputation (track_id, created_at desc);

create table if not exists public.ai_playlist_drift (
  id           uuid primary key default gen_random_uuid(),
  store_id     uuid,
  playlist_ref text,
  drift        numeric,
  band         text,
  genre_drift  numeric,
  mood_drift   numeric,
  energy_drift numeric,
  created_by   uuid,
  created_at   timestamptz not null default now()
);
comment on table public.ai_playlist_drift is 'AI-MUSIC-3 Playlist Drift 스냅샷(원래 목적 대비 이탈도). 분석 전용.';
create index if not exists apd_store_idx on public.ai_playlist_drift (store_id, created_at desc);

-- RLS: super-admin read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_playlist_versions','ai_learning_history','ai_track_reputation','ai_playlist_drift'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Learning inputs — 강화신호(reward/penalty) 집계. READ-ONLY.
--    reward: complete / like / long-session ; penalty: skip / dislike / repeat-fatigue.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_learning(p_store uuid, p_days int default 14)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days,14),1),90); v_since timestamptz := now() - make_interval(days => v_days); v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_store is null then raise exception 'store required'; end if;
  with ev as (
    select * from public.playback_events_v2 where business_id = p_store and created_at >= v_since
  ), sess as (
    select session_id, sum(coalesce(listened_seconds,0)) secs from ev where session_id is not null group by session_id
  ), rep as (
    select track_id, count(*) c from ev where track_id is not null group by track_id
  )
  select jsonb_build_object(
    'plays', (select count(*) from ev),
    'completes', (select count(*) from ev where event_type='play_complete'),
    'likes', (select count(*) from ev where event_type='like'),
    'longSessions', (select count(*) from sess where secs >= 600),
    'skips', (select count(*) from ev where event_type='skip'),
    'dislikes', (select count(*) from public.store_track_reactions where store_id = p_store and reaction_type='dislike'),
    'repeatFatigue', coalesce((select sum(greatest(c - 5, 0)) from rep), 0)
  ) into v;
  return jsonb_build_object('ok', true, 'windowDays', v_days, 'signals', v);
end; $$;
revoke execute on function public.admin_ai_learning(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_learning(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Track reputation inputs — completion/skip/like/replay from behavior scores. READ-ONLY.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_track_reputation(p_store_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_slug text := nullif(btrim(coalesce(p_store_type,'')),''); v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  begin if v_slug is not null then v_slug := public.normalize_store_label(v_slug); end if; exception when others then null; end;
  select jsonb_build_object('ok', true, 'tracks', coalesce((
    select jsonb_agg(jsonb_build_object('trackId', t.id, 'title', t.title,
      'completionRate', tsb.completion_rate, 'skipRate', tsb.skip_rate, 'likeRate', tsb.like_rate,
      'replayRate', tsb.replay_rate, 'plays', coalesce(tsb.play_count,0),
      'priorScore', case when tsb.store_behavior_score is not null then round(tsb.store_behavior_score*100) else null end) order by tsb.play_count desc nulls last)
    from (select * from public.tracks where coalesce(is_recommendable, true) and coalesce(visibility,'public')='public' order by created_at desc limit v_limit) t
    left join lateral (
      select * from public.track_store_behavior_scores b
      where b.track_id = t.id and (v_slug is null or b.store_type_slug = v_slug)
      order by b.window_days desc limit 1
    ) tsb on true
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_track_reputation(text,int) from public;
do $$ begin begin grant execute on function public.admin_ai_track_reputation(text,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Read persisted history / drift / adaptive-score timeline. READ-ONLY.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_playlist_history(p_store uuid default null, p_ref text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'versions', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'storeId', x.store_id, 'playlistRef', x.playlist_ref,
      'version', x.version, 'score', x.score, 'trackCount', x.track_count, 'diversity', x.diversity,
      'fatigueRisk', x.fatigue_risk, 'label', x.label,
      'createdAt', to_char(x.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by x.version)
    from (select * from public.ai_playlist_versions
          where (p_store is null or store_id = p_store) and (p_ref is null or playlist_ref = p_ref)
          order by version limit v_limit) x
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_playlist_history(uuid,text,int) from public;
do $$ begin begin grant execute on function public.admin_ai_playlist_history(uuid,text,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_drift(p_store uuid default null, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'drift', coalesce((
    select jsonb_agg(jsonb_build_object('id', d.id, 'storeId', d.store_id, 'playlistRef', d.playlist_ref,
      'drift', d.drift, 'band', d.band, 'genreDrift', d.genre_drift, 'moodDrift', d.mood_drift, 'energyDrift', d.energy_drift,
      'createdAt', to_char(d.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by d.created_at desc)
    from (select * from public.ai_playlist_drift where (p_store is null or store_id = p_store) order by created_at desc limit v_limit) d
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_drift(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_drift(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_adaptive_score(p_store uuid default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'history', coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'storeId', h.store_id, 'playlistRef', h.playlist_ref,
      'yesterday', h.yesterday_score, 'today', h.today_score, 'next', h.next_score,
      'reward', h.reward, 'penalty', h.penalty, 'net', h.net, 'trend', h.trend,
      'createdAt', to_char(h.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by h.created_at desc)
    from (select * from public.ai_learning_history where (p_store is null or store_id = p_store) order by created_at desc limit v_limit) h
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_adaptive_score(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_adaptive_score(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Advisory record RPCs (스냅샷 저장 — 배포/반영 없음).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_playlist_version(p_store uuid, p_ref text, p_version int, p_score numeric, p_track_count int, p_diversity numeric, p_fatigue numeric, p_label text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_playlist_versions (store_id, playlist_ref, version, score, track_count, diversity, fatigue_risk, label, created_by)
    values (p_store, left(coalesce(p_ref,''),120), greatest(coalesce(p_version,1),1), p_score, greatest(coalesce(p_track_count,0),0), p_diversity, p_fatigue, left(coalesce(p_label,''),80), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory version snapshot — not applied');
end; $$;
revoke execute on function public.record_ai_playlist_version(uuid,text,int,numeric,int,numeric,numeric,text) from public;
do $$ begin begin grant execute on function public.record_ai_playlist_version(uuid,text,int,numeric,int,numeric,numeric,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_learning_snapshot(p_store uuid, p_ref text, p_yesterday numeric, p_today numeric, p_next numeric, p_reward numeric, p_penalty numeric, p_net numeric, p_trend text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_learning_history (store_id, playlist_ref, yesterday_score, today_score, next_score, reward, penalty, net, trend, created_by)
    values (p_store, left(coalesce(p_ref,''),120), p_yesterday, p_today, p_next, p_reward, p_penalty, p_net, left(coalesce(p_trend,''),16), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory learning snapshot — recommendation only');
end; $$;
revoke execute on function public.record_ai_learning_snapshot(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,text) from public;
do $$ begin begin grant execute on function public.record_ai_learning_snapshot(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_track_reputation(p_track uuid, p_store_type text, p_score numeric, p_band text, p_trend text, p_prior numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_track_reputation (track_id, store_type, score, band, trend, prior_score, created_by)
    values (p_track, left(coalesce(p_store_type,''),80), p_score, left(coalesce(p_band,''),24), left(coalesce(p_trend,''),16), p_prior, auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory reputation snapshot — no ranking/exposure change');
end; $$;
revoke execute on function public.record_ai_track_reputation(uuid,text,numeric,text,text,numeric) from public;
do $$ begin begin grant execute on function public.record_ai_track_reputation(uuid,text,numeric,text,text,numeric) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_playlist_drift(p_store uuid, p_ref text, p_drift numeric, p_band text, p_genre numeric, p_mood numeric, p_energy numeric)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_playlist_drift (store_id, playlist_ref, drift, band, genre_drift, mood_drift, energy_drift, created_by)
    values (p_store, left(coalesce(p_ref,''),120), p_drift, left(coalesce(p_band,''),16), p_genre, p_mood, p_energy, auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'advisory drift snapshot — analysis only');
end; $$;
revoke execute on function public.record_ai_playlist_drift(uuid,text,numeric,text,numeric,numeric,numeric) from public;
do $$ begin begin grant execute on function public.record_ai_playlist_drift(uuid,text,numeric,text,numeric,numeric,numeric) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.record_ai_playlist_drift(uuid,text,numeric,text,numeric,numeric,numeric);
--   drop function if exists public.record_ai_track_reputation(uuid,text,numeric,text,text,numeric);
--   drop function if exists public.record_ai_learning_snapshot(uuid,text,numeric,numeric,numeric,numeric,numeric,numeric,text);
--   drop function if exists public.record_ai_playlist_version(uuid,text,int,numeric,int,numeric,numeric,text);
--   drop function if exists public.admin_ai_adaptive_score(uuid,int);
--   drop function if exists public.admin_ai_drift(uuid,int);
--   drop function if exists public.admin_ai_playlist_history(uuid,text,int);
--   drop function if exists public.admin_ai_track_reputation(text,int);
--   drop function if exists public.admin_ai_learning(uuid,int);
--   drop table if exists public.ai_playlist_drift;
--   drop table if exists public.ai_track_reputation;
--   drop table if exists public.ai_learning_history;
--   drop table if exists public.ai_playlist_versions;
-- 신규(0466) 테이블 4 + 함수 9. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/정산/노출/Playlist·Queue·Player 로직 영향 없음.
-- playback_events_v2 / store_track_reactions / track_store_behavior_scores / tracks 는 READ-ONLY.
