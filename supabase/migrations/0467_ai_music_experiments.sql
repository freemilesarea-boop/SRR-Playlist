-- 0467 — Phase AI-MUSIC-4: Controlled Playlist Experimentation & Pilot Rollout Intelligence
--
-- 목적:
--   AI-MUSIC-1~3 위에, AI가 생성한 Playlist Candidate를 전체 매장에 즉시 적용하지 않고 제한된 Store로 안전하게
--   검증하는 실험 *설계·분석·추천* 계층을 만든다. 실행 시스템이 아니다: 어떤 RPC도 Pilot을 시작하거나 Store를
--   그룹에 배정하거나 Playlist를 배포·확장·중단·롤백하지 않는다. 판정(eligibility/그룹설계/outcome/guardrail/
--   rollout)은 전부 클라이언트 규칙 엔진(src/lib/aiExperiments)에서 수행하며, 이 migration은 (1) 실험 Draft/
--   그룹추천/스냅샷/추천/감사 저장용 신규 격리 테이블, (2) 실험 신호를 READ-ONLY 로 집계하는 조회 RPC +
--   Draft/Audit/Snapshot 기록 RPC 를 제공한다. LLM/ML/통계 유의성 라이브러리 없음.
--
-- 안전 (절대):
--   • Additive Only. 신규 테이블 5 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/정산/노출/Playlist·Queue·Player·
--     Ranking·Streaming·Governance/AI-MUSIC-1~3 테이블 무변경. playback_events_v2 / store_track_reactions /
--     tracks / track_audio_features / business_profiles / franchise_stores 는 READ-ONLY 참조만.
--   • Production Apply 금지. Preview / rollback-txn(synthetic) 검증 전용. 운영 head 는 0453 유지.
--   • AI는 Recommendation/Draft/Simulation 만. 실제 실험 Assignment 를 Playback 에 연결하지 않는다. Draft 는
--     운영자 승인 후 별도 수동 setup 으로만 진행되며 자동 실행되지 않는다.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + row/array 상한 +
--     auth.uid() actor 기록. Dynamic SQL 없음.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 실험 저장 테이블 (신규, 격리 — Draft/Recommendation/Snapshot/Audit 전용, 자동 실행 없음)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_music_experiments (
  id                 uuid primary key default gen_random_uuid(),
  name               text not null,
  hypothesis         text,
  candidate_playlist_id text,
  candidate_version  int,
  target_industry    text,
  primary_metric     text,
  secondary_metrics  jsonb not null default '[]'::jsonb,
  guardrail_metrics  jsonb not null default '[]'::jsonb,
  status             text not null default 'DRAFT' check (status in ('DRAFT','REVIEW_REQUIRED','APPROVED_FOR_MANUAL_SETUP','NOT_STARTED','OBSERVING','ANALYSIS_READY','COMPLETED','CANCELLED')),
  confidence         numeric,
  created_by         uuid,
  created_at         timestamptz not null default now()
);
comment on table public.ai_music_experiments is 'AI-MUSIC-4 실험 Draft(설계). 자동 실행 없음 — 승인 후 수동 setup. 실제 Playlist/Store 배정 아님.';
create index if not exists ame_status_idx on public.ai_music_experiments (status, created_at desc);

create table if not exists public.ai_music_experiment_groups (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid not null references public.ai_music_experiments(id) on delete cascade,
  arm            text not null check (arm in ('control','treatment')),
  store_id       uuid not null,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_music_experiment_groups is 'AI-MUSIC-4 그룹 배정 *추천* 기록(Draft). Playback 에 연결되지 않음 — 실제 Assignment 아님.';
create index if not exists ameg_exp_idx on public.ai_music_experiment_groups (experiment_id, arm);
create index if not exists ameg_store_idx on public.ai_music_experiment_groups (store_id);

create table if not exists public.ai_music_experiment_snapshots (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid references public.ai_music_experiments(id) on delete cascade,
  snapshot_type  text not null,
  payload        jsonb not null default '{}'::jsonb,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_music_experiment_snapshots is 'AI-MUSIC-4 관측/분석 스냅샷(outcome/guardrail/rollout 등). 분석 전용.';
create index if not exists ames_exp_idx on public.ai_music_experiment_snapshots (experiment_id, created_at desc);

create table if not exists public.ai_music_experiment_recommendations (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid references public.ai_music_experiments(id) on delete cascade,
  kind           text not null,
  recommendation text,
  reasons        jsonb not null default '[]'::jsonb,
  confidence     numeric,
  created_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table public.ai_music_experiment_recommendations is 'AI-MUSIC-4 Rollout/Learning 추천 기록(권고 전용). 자동 실행 없음.';
create index if not exists amer_exp_idx on public.ai_music_experiment_recommendations (experiment_id, created_at desc);

create table if not exists public.ai_music_experiment_audit (
  id             uuid primary key default gen_random_uuid(),
  experiment_id  uuid references public.ai_music_experiments(id) on delete cascade,
  action         text not null,
  actor          uuid,
  note           text,
  created_at     timestamptz not null default now()
);
comment on table public.ai_music_experiment_audit is 'AI-MUSIC-4 운영자 리뷰/승인 감사 로그(append-only 용도). 자동 실행 기록 아님.';
create index if not exists amea_exp_idx on public.ai_music_experiment_audit (experiment_id, created_at desc);

-- RLS: super-admin read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_music_experiments','ai_music_experiment_groups','ai_music_experiment_snapshots','ai_music_experiment_recommendations','ai_music_experiment_audit'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) Experiment eligibility signals — per-store 실험 신호 집계. READ-ONLY.
--    Store / Session / Playback 을 엄격히 구분한다.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_experiment_eligibility(p_days int default 30, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days,30),1),90); v_limit int := least(greatest(coalesce(p_limit,200),1),500); v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  with ev as (
    select e.business_id, e.session_id, e.event_type, e.browser, e.device_type, e.track_id, e.playlist_id, e.created_at,
           t.main_genre, t.genre, af.energy
    from public.playback_events_v2 e
    left join public.tracks t on t.id = e.track_id
    left join public.track_audio_features af on af.track_id = e.track_id
    where e.business_id is not null and e.created_at >= now() - make_interval(days => v_days)
  ), agg as (
    select business_id,
      count(*) playbacks,
      count(distinct session_id) sessions,
      count(*) filter (where event_type='play_complete') completes,
      count(*) filter (where event_type='skip') skips,
      count(*) filter (where event_type='like') likes,
      mode() within group (order by browser) browser,
      mode() within group (order by device_type) device,
      count(distinct playlist_id) filter (where created_at >= now() - make_interval(days => 3)) recent_playlists,
      count(*) filter (where main_genre is not null or genre is not null) genre_plays,
      count(*) filter (where energy is not null) af_plays
    from ev group by business_id
  )
  select jsonb_build_object('ok', true, 'windowDays', v_days, 'stores', coalesce((
    select jsonb_agg(jsonb_build_object(
      'storeId', a.business_id, 'storeName', bp.store_name, 'industry', bp.business_type,
      'browser', a.browser, 'device', a.device,
      'enterpriseId', fs.franchise_id,
      'playbacks', a.playbacks, 'sessions', a.sessions, 'completes', a.completes, 'skips', a.skips, 'likes', a.likes,
      'dislikes', coalesce((select count(*) from public.store_track_reactions r where r.store_id = a.business_id and r.reaction_type='dislike'), 0),
      'completionRate', round((a.completes::numeric / nullif(a.playbacks,0)), 4),
      'skipRate', round((a.skips::numeric / nullif(a.playbacks,0)), 4),
      'profileCoverage', round((a.genre_plays::numeric / nullif(a.playbacks,0)), 4),
      'compatibilityCoverage', round((a.af_plays::numeric / nullif(a.playbacks,0)), 4),
      'recentPlaylistChange', (a.recent_playlists > 1),
      'activeExperiments', coalesce((select count(*) from public.ai_music_experiment_groups g join public.ai_music_experiments x on x.id=g.experiment_id where g.store_id=a.business_id and x.status in ('OBSERVING','APPROVED_FOR_MANUAL_SETUP','ANALYSIS_READY')), 0),
      'streamingQualityScore', null, 'criticalIncidents', null, 'recentRecoveryCount', null, 'recentReleaseRegression', null, 'offlineDays', null
    ) order by a.playbacks desc)
    from (select * from agg order by playbacks desc limit v_limit) a
    left join public.business_profiles bp on bp.user_id = a.business_id
    left join lateral (select franchise_id from public.franchise_stores f where f.store_id = a.business_id limit 1) fs on true
  ), '[]'::jsonb),
  'note', 'streaming/incident/recovery/release/region 신호는 source 미적용 → NOT_AVAILABLE(null)') into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_experiment_eligibility(int,int) from public;
do $$ begin begin grant execute on function public.admin_ai_experiment_eligibility(int,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) Experiment outcome — 제공된 control/treatment Store 목록의 관측 지표 집계(관찰적·Directional). READ-ONLY.
--    실제 그룹 배정이 아니라, 두 Store 집합의 기존 Playback 을 비교하는 분석용.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_experiment_outcome(p_control uuid[], p_treatment uuid[], p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days,30),1),90); v_c uuid[]; v_t uuid[];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  v_c := (select array_agg(x) from (select unnest(coalesce(p_control,'{}'::uuid[])) x limit 200) s);
  v_t := (select array_agg(x) from (select unnest(coalesce(p_treatment,'{}'::uuid[])) x limit 200) s);
  return jsonb_build_object('ok', true, 'windowDays', v_days,
    'control', public._ai_experiment_arm(v_c, v_days),
    'treatment', public._ai_experiment_arm(v_t, v_days),
    'note', 'observational · directional only · 통계 유의성 미산출 · 실제 그룹 배정 아님');
end; $$;
revoke execute on function public.admin_ai_experiment_outcome(uuid[],uuid[],int) from public;
do $$ begin begin grant execute on function public.admin_ai_experiment_outcome(uuid[],uuid[],int) to authenticated; exception when undefined_object then null; end; end $$;

-- helper: arm aggregate (Store / Session / Playback 구분)
create or replace function public._ai_experiment_arm(p_stores uuid[], p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  with ev as (
    select * from public.playback_events_v2
    where business_id = any(coalesce(p_stores,'{}'::uuid[])) and created_at >= now() - make_interval(days => p_days)
  )
  select jsonb_build_object(
    'stores', coalesce(array_length(p_stores,1),0),
    'sessions', (select count(distinct session_id) from ev),
    'playbacks', (select count(*) from ev),
    'completes', (select count(*) from ev where event_type='play_complete'),
    'skips', (select count(*) from ev where event_type='skip'),
    'likes', (select count(*) from ev where event_type='like'),
    'completionRate', (select round(count(*) filter (where event_type='play_complete')::numeric / nullif(count(*),0),4) from ev),
    'skipRate', (select round(count(*) filter (where event_type='skip')::numeric / nullif(count(*),0),4) from ev),
    'likeRatio', (select round(count(*) filter (where event_type='like')::numeric / nullif(count(*),0),4) from ev)
  ) into v;
  return v;
end; $$;
revoke execute on function public._ai_experiment_arm(uuid[],int) from public;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Read persisted experiments / recommendations. READ-ONLY.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_experiment_history(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'experiments', coalesce((
    select jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'status', x.status, 'targetIndustry', x.target_industry,
      'primaryMetric', x.primary_metric, 'confidence', x.confidence,
      'controlCount', (select count(*) from public.ai_music_experiment_groups g where g.experiment_id=x.id and g.arm='control'),
      'treatmentCount', (select count(*) from public.ai_music_experiment_groups g where g.experiment_id=x.id and g.arm='treatment'),
      'snapshots', (select count(*) from public.ai_music_experiment_snapshots s where s.experiment_id=x.id),
      'createdAt', to_char(x.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by x.created_at desc)
    from (select * from public.ai_music_experiments order by created_at desc limit v_limit) x
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_experiment_history(int) from public;
do $$ begin begin grant execute on function public.admin_ai_experiment_history(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_experiment_recommendation(p_experiment uuid default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,100),1),300);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'recommendations', coalesce((
    select jsonb_agg(jsonb_build_object('id', r.id, 'experimentId', r.experiment_id, 'kind', r.kind, 'recommendation', r.recommendation,
      'reasons', r.reasons, 'confidence', r.confidence, 'createdAt', to_char(r.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by r.created_at desc)
    from (select * from public.ai_music_experiment_recommendations where (p_experiment is null or experiment_id = p_experiment) order by created_at desc limit v_limit) r
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_experiment_recommendation(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_experiment_recommendation(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) Advisory record RPCs (Draft / Snapshot / Review — 배포/배정/실행 없음).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_experiment_draft(
  p_name text, p_hypothesis text, p_candidate text, p_version int, p_industry text,
  p_primary text, p_secondary jsonb, p_guardrail jsonb, p_confidence numeric,
  p_control uuid[], p_treatment uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; s uuid; v_c int := 0; v_t int := 0;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_music_experiments (name, hypothesis, candidate_playlist_id, candidate_version, target_industry, primary_metric, secondary_metrics, guardrail_metrics, status, confidence, created_by)
    values (left(coalesce(p_name,'experiment'),160), left(coalesce(p_hypothesis,''),1000), left(coalesce(p_candidate,''),120), p_version, left(coalesce(p_industry,''),80),
            left(coalesce(p_primary,''),60), coalesce(p_secondary,'[]'::jsonb), coalesce(p_guardrail,'[]'::jsonb), 'DRAFT', p_confidence, auth.uid())
    returning id into v_id;
  foreach s in array coalesce(p_control,'{}'::uuid[]) loop exit when v_c >= 200; insert into public.ai_music_experiment_groups (experiment_id, arm, store_id, created_by) values (v_id, 'control', s, auth.uid()); v_c := v_c + 1; end loop;
  foreach s in array coalesce(p_treatment,'{}'::uuid[]) loop exit when v_t >= 200; insert into public.ai_music_experiment_groups (experiment_id, arm, store_id, created_by) values (v_id, 'treatment', s, auth.uid()); v_t := v_t + 1; end loop;
  insert into public.ai_music_experiment_audit (experiment_id, action, actor, note) values (v_id, 'DRAFT_CREATED', auth.uid(), 'draft only — no assignment/deploy');
  return jsonb_build_object('ok', true, 'id', v_id, 'controlStored', v_c, 'treatmentStored', v_t, 'note', 'DRAFT recommendation stored — not started, no playback assignment');
end; $$;
revoke execute on function public.record_ai_experiment_draft(text,text,text,int,text,text,jsonb,jsonb,numeric,uuid[],uuid[]) from public;
do $$ begin begin grant execute on function public.record_ai_experiment_draft(text,text,text,int,text,text,jsonb,jsonb,numeric,uuid[],uuid[]) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_experiment_snapshot(p_experiment uuid, p_type text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  insert into public.ai_music_experiment_snapshots (experiment_id, snapshot_type, payload, created_by)
    values (p_experiment, left(coalesce(p_type,'snapshot'),40), coalesce(p_payload,'{}'::jsonb), auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'analysis snapshot stored — read-only analysis');
end; $$;
revoke execute on function public.record_ai_experiment_snapshot(uuid,text,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_experiment_snapshot(uuid,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_experiment_review(p_experiment uuid, p_action text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_action text := upper(coalesce(p_action,'REVIEW'));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_action not in ('REVIEW','APPROVE_FOR_MANUAL_SETUP','CANCEL','NOTE') then v_action := 'REVIEW'; end if;
  insert into public.ai_music_experiment_audit (experiment_id, action, actor, note)
    values (p_experiment, v_action, auth.uid(), left(coalesce(p_note,''),1000)) returning id into v_id;
  -- operator review may move status to REVIEW_REQUIRED / APPROVED_FOR_MANUAL_SETUP / CANCELLED (never OBSERVING auto)
  if v_action = 'APPROVE_FOR_MANUAL_SETUP' then update public.ai_music_experiments set status='APPROVED_FOR_MANUAL_SETUP' where id=p_experiment and status in ('DRAFT','REVIEW_REQUIRED');
  elsif v_action = 'CANCEL' then update public.ai_music_experiments set status='CANCELLED' where id=p_experiment;
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'action', v_action, 'note', 'audit recorded — no automatic experiment start/assignment/deploy');
end; $$;
revoke execute on function public.record_ai_experiment_review(uuid,text,text) from public;
do $$ begin begin grant execute on function public.record_ai_experiment_review(uuid,text,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.record_ai_experiment_review(uuid,text,text);
--   drop function if exists public.record_ai_experiment_snapshot(uuid,text,jsonb);
--   drop function if exists public.record_ai_experiment_draft(text,text,text,int,text,text,jsonb,jsonb,numeric,uuid[],uuid[]);
--   drop function if exists public.admin_ai_experiment_recommendation(uuid,int);
--   drop function if exists public.admin_ai_experiment_history(int);
--   drop function if exists public.admin_ai_experiment_outcome(uuid[],uuid[],int);
--   drop function if exists public._ai_experiment_arm(uuid[],int);
--   drop function if exists public.admin_ai_experiment_eligibility(int,int);
--   drop table if exists public.ai_music_experiment_audit;
--   drop table if exists public.ai_music_experiment_recommendations;
--   drop table if exists public.ai_music_experiment_snapshots;
--   drop table if exists public.ai_music_experiment_groups;
--   drop table if exists public.ai_music_experiments;
-- 신규(0467) 테이블 5 + 함수 8. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/정산/노출/Playlist·Queue·Player 로직 영향 없음.
-- playback_events_v2 / store_track_reactions / tracks / track_audio_features / business_profiles / franchise_stores 는 READ-ONLY.
