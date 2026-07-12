-- 0469 — Phase AI-MUSIC-6: Shadow Playlist Resolution & Runtime Certification
--
-- 목적:
--   기존 Playlist Resolution 결과를 *변경하지 않고*, 각 Store 세션에서 기존 Resolution 과 Pilot Override
--   Shadow Resolution 을 동시에 계산·비교한 결과를 저빈도 Decision Event 로 기록하고, 그 위에서 Runtime
--   Integration 준비도를 *인증(certify)* 하는 격리 계층. Shadow 결과는 로그·분석·Dashboard 전용이며 실제
--   음악 재생/Queue/Player 에는 절대 사용되지 않는다. 판정(divergence/certification/readiness)은 전부
--   클라이언트 규칙 엔진(src/lib/aiShadow)에서 수행하고, 이 migration 은 (1) Shadow Event/Session/
--   Certification 저장용 신규 격리 테이블, (2) auth.uid() 기반 Store attribution 으로 Event 를 기록하는
--   ingest RPC + 관리자 조회/인증기록 RPC 를 제공한다. LLM/ML 없음.
--
-- 안전 (절대):
--   • Additive Only. 신규 격리 테이블 3 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/Playlist/Store/Playback/Queue/
--     Resolver RPC(get_store_active_music_policy / get_playlist_tracks) 무변경. 기존 Playlist 를 UPDATE 하지
--     않는다. Shadow Event 는 실제 재생에 사용되지 않는다.
--   • Store attribution 은 auth.uid() 로 서버에서 확정한다 — Client 가 보낸 Store ID 를 신뢰하지 않는다.
--     Event 는 hash 만 저장(제목/트랙/URL/PII/raw stack/raw query/token 저장 금지).
--   • Production Apply 금지. Preview / rollback-txn(synthetic) 검증 전용. 운영 head 는 0453 유지.
--   • Security Definer + search_path 고정 + 파라미터 바인딩 + batch/row/time 상한 + Dynamic SQL 없음.
--     관리자 RPC 는 _is_super_admin() 게이트. ingest 는 authenticated(본인 store=auth.uid()) 만.

-- ─────────────────────────────────────────────────────────────────────
-- 1) 신규 격리 테이블
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_music_shadow_sessions (
  id                   uuid primary key default gen_random_uuid(),
  store_uid            uuid not null,             -- auth.uid() 로 서버 확정 (client 신뢰 안함)
  session_hash         text not null,             -- 불투명 세션 hash (PII 아님)
  eval_count           int not null default 0,
  first_evaluated_at   timestamptz not null default now(),
  last_evaluated_at    timestamptz not null default now()
);
comment on table public.ai_music_shadow_sessions is 'AI-MUSIC-6 Shadow 세션 요약. store_uid=auth.uid(). Shadow 분석 전용 — 실제 재생 아님.';
create unique index if not exists amss_store_session_uq on public.ai_music_shadow_sessions (store_uid, session_hash);
create index if not exists amss_last_idx on public.ai_music_shadow_sessions (last_evaluated_at desc);

create table if not exists public.ai_music_shadow_resolution_events (
  id                   uuid primary key default gen_random_uuid(),
  store_uid            uuid not null,             -- auth.uid() 서버 확정
  session_hash         text not null,
  event_name           text not null,
  existing_playlist_hash text,                    -- hash only
  shadow_playlist_hash text,
  existing_source      text,
  shadow_source        text,
  divergence_type      text not null,
  experiment_id        uuid,
  pilot_run_id         uuid,
  assignment_id        uuid,
  candidate_version    int,
  reason_code          text,
  evaluated_at         timestamptz not null default now(),
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_shadow_resolution_events is 'AI-MUSIC-6 Shadow Decision Event(저빈도, hash 전용). 제목/트랙/URL/PII 저장 안함. 실제 재생 미사용.';
create index if not exists amsre_store_time_idx on public.ai_music_shadow_resolution_events (store_uid, evaluated_at desc);
create index if not exists amsre_session_time_idx on public.ai_music_shadow_resolution_events (session_hash, evaluated_at desc);
create index if not exists amsre_divergence_idx on public.ai_music_shadow_resolution_events (divergence_type, evaluated_at desc);
create index if not exists amsre_experiment_idx on public.ai_music_shadow_resolution_events (experiment_id);

create table if not exists public.ai_music_shadow_certifications (
  id                   uuid primary key default gen_random_uuid(),
  pilot_run_id         uuid,
  score                numeric,
  cert_status          text not null,             -- CERTIFIED/READY_WITH_WARNINGS/REVIEW_REQUIRED/BLOCKED/INSUFFICIENT_DATA
  readiness            text not null,             -- NOT_READY/SHADOW_ONLY/READY_FOR_PREVIEW_RUNTIME_TEST/READY_FOR_MANUAL_CANARY_REVIEW/BLOCKED/INSUFFICIENT_DATA
  components           jsonb not null default '{}'::jsonb,
  blockers             jsonb not null default '[]'::jsonb,
  limitations          jsonb not null default '[]'::jsonb,
  created_by           uuid,
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_shadow_certifications is 'AI-MUSIC-6 Runtime Certification 스냅샷(운영자 기록). 참고용 — 실제 재생/통합 승인 아님.';
create index if not exists amsc_run_idx on public.ai_music_shadow_certifications (pilot_run_id, created_at desc);

-- RLS: 관리자 read; ingest/record 는 RPC 로만.
do $$ declare t text;
begin
  foreach t in array array['ai_music_shadow_sessions','ai_music_shadow_resolution_events','ai_music_shadow_certifications'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) ingest — Shadow Event 배치 기록. Store attribution = auth.uid() (client Store ID 신뢰 안함).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.ingest_ai_shadow_resolution_events(p_events jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid(); rec jsonb; v_n int := 0; v_sess text; v_div text; v_name text;
begin
  if v_uid is null then raise exception 'auth required'; end if;
  if jsonb_typeof(coalesce(p_events,'null'::jsonb)) <> 'array' then raise exception 'events must be an array'; end if;

  for rec in select * from jsonb_array_elements(p_events) loop
    exit when v_n >= 50;                          -- batch cap
    v_sess := left(coalesce(rec->>'sessionHash','0'),16);
    v_div := upper(coalesce(rec->>'divergenceType','UNKNOWN'));
    if v_div not in ('SAME_RESULT','EXPECTED_TREATMENT_DIVERGENCE','UNEXPECTED_CONTROL_DIVERGENCE','VERSION_MISMATCH',
                     'CANDIDATE_MISSING','POLICY_CONFLICT','SCHEDULE_CONFLICT','ASSIGNMENT_CONFLICT','EXPIRED_OVERRIDE',
                     'RESOLVER_ERROR','UNKNOWN') then v_div := 'UNKNOWN'; end if;
    v_name := left(coalesce(rec->>'eventName','shadow_resolution_evaluated'),48);

    insert into public.ai_music_shadow_resolution_events (
      store_uid, session_hash, event_name, existing_playlist_hash, shadow_playlist_hash,
      existing_source, shadow_source, divergence_type, experiment_id, pilot_run_id, assignment_id,
      candidate_version, reason_code, evaluated_at)
    values (
      v_uid, v_sess, v_name, left(nullif(rec->>'existingPlaylistHash',''),16), left(nullif(rec->>'shadowPlaylistHash',''),16),
      left(nullif(rec->>'existingSource',''),24), left(nullif(rec->>'shadowSource',''),24), v_div,
      (nullif(rec->>'experimentId',''))::uuid, (nullif(rec->>'pilotRunId',''))::uuid, (nullif(rec->>'assignmentId',''))::uuid,
      (nullif(rec->>'candidateVersion',''))::int, left(nullif(rec->>'reasonCode',''),32),
      coalesce((nullif(rec->>'evaluatedAt',''))::timestamptz, now()));

    insert into public.ai_music_shadow_sessions (store_uid, session_hash, eval_count, first_evaluated_at, last_evaluated_at)
      values (v_uid, v_sess, 1, now(), now())
    on conflict (store_uid, session_hash) do update
      set eval_count = public.ai_music_shadow_sessions.eval_count + 1, last_evaluated_at = now();
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('ok', true, 'ingested', v_n, 'note', 'shadow events stored — analysis only, not used for playback');
end; $$;
revoke execute on function public.ingest_ai_shadow_resolution_events(jsonb) from public;
do $$ begin begin grant execute on function public.ingest_ai_shadow_resolution_events(jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 3) 관리자 조회 RPC (READ-ONLY, super-admin)
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_shadow_overview(p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_days int := least(greatest(coalesce(p_days,30),1),90);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  with ev as (
    select * from public.ai_music_shadow_resolution_events
    where evaluated_at >= now() - make_interval(days => v_days)
  )
  select jsonb_build_object('ok', true, 'windowDays', v_days,
    'sessionsEvaluated', (select count(distinct session_hash) from ev),
    'shadowEvaluations', (select count(*) from ev),
    'sameResult', (select count(*) from ev where divergence_type='SAME_RESULT'),
    'expectedDivergence', (select count(*) from ev where divergence_type='EXPECTED_TREATMENT_DIVERGENCE'),
    'unexpectedControlDivergence', (select count(*) from ev where divergence_type='UNEXPECTED_CONTROL_DIVERGENCE'),
    'versionMismatch', (select count(*) from ev where divergence_type='VERSION_MISMATCH'),
    'candidateMissing', (select count(*) from ev where divergence_type='CANDIDATE_MISSING'),
    'assignmentConflict', (select count(*) from ev where divergence_type='ASSIGNMENT_CONFLICT'),
    'resolverErrors', (select count(*) from ev where divergence_type='RESOLVER_ERROR'),
    'failOpen', (select count(*) from ev where divergence_type in ('SAME_RESULT','VERSION_MISMATCH','CANDIDATE_MISSING','ASSIGNMENT_CONFLICT','EXPIRED_OVERRIDE','RESOLVER_ERROR')),
    'note', 'Shadow 는 실제 재생을 변경하지 않음 — 분석 전용. Store attribution=auth.uid().') into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_shadow_overview(int) from public;
do $$ begin begin grant execute on function public.admin_ai_shadow_overview(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_shadow_sessions(p_days int default 30, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_days int := least(greatest(coalesce(p_days,30),1),90); v_limit int := least(greatest(coalesce(p_limit,100),1),500);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'sessions', coalesce((
    select jsonb_agg(jsonb_build_object('sessionHash', s.session_hash, 'evalCount', s.eval_count,
      'lastEvaluatedAt', to_char(s.last_evaluated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by s.last_evaluated_at desc)
    from (select * from public.ai_music_shadow_sessions where last_evaluated_at >= now() - make_interval(days => v_days) order by last_evaluated_at desc limit v_limit) s
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_shadow_sessions(int,int) from public;
do $$ begin begin grant execute on function public.admin_ai_shadow_sessions(int,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_shadow_divergences(p_days int default 30, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_days int := least(greatest(coalesce(p_days,30),1),90); v_limit int := least(greatest(coalesce(p_limit,200),1),500);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'byType', coalesce((select jsonb_object_agg(divergence_type, c) from (
        select divergence_type, count(*) c from public.ai_music_shadow_resolution_events
        where evaluated_at >= now() - make_interval(days => v_days) group by divergence_type) t), '{}'::jsonb),
    'recent', coalesce((select jsonb_agg(jsonb_build_object('divergenceType', e.divergence_type, 'eventName', e.event_name,
        'existingSource', e.existing_source, 'shadowSource', e.shadow_source, 'reasonCode', e.reason_code,
        'evaluatedAt', to_char(e.evaluated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by e.evaluated_at desc)
      from (select * from public.ai_music_shadow_resolution_events
            where evaluated_at >= now() - make_interval(days => v_days) and divergence_type <> 'SAME_RESULT'
            order by evaluated_at desc limit v_limit) e), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_shadow_divergences(int,int) from public;
do $$ begin begin grant execute on function public.admin_ai_shadow_divergences(int,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_shadow_trace(p_session_hash text, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'sessionHash', left(coalesce(p_session_hash,''),16), 'trace', coalesce((
    select jsonb_agg(jsonb_build_object('eventName', e.event_name, 'divergenceType', e.divergence_type,
      'existingSource', e.existing_source, 'shadowSource', e.shadow_source, 'reasonCode', e.reason_code,
      'candidateVersion', e.candidate_version, 'evaluatedAt', to_char(e.evaluated_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by e.evaluated_at)
    from (select * from public.ai_music_shadow_resolution_events where session_hash = left(coalesce(p_session_hash,''),16) order by evaluated_at limit v_limit) e
  ), '[]'::jsonb),
  'note', '실제 재생은 항상 기존 Resolution 을 사용 — Shadow 는 관찰용') into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_shadow_trace(text,int) from public;
do $$ begin begin grant execute on function public.admin_ai_shadow_trace(text,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_shadow_certification(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'certifications', coalesce((
    select jsonb_agg(jsonb_build_object('id', c.id, 'pilotRunId', c.pilot_run_id, 'score', c.score,
      'certStatus', c.cert_status, 'readiness', c.readiness, 'components', c.components, 'blockers', c.blockers,
      'createdAt', to_char(c.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by c.created_at desc)
    from (select * from public.ai_music_shadow_certifications order by created_at desc limit v_limit) c
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_shadow_certification(int) from public;
do $$ begin begin grant execute on function public.admin_ai_shadow_certification(int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) Certification 스냅샷 기록 (super-admin) — 참고용. 실제 Runtime 통합/Canary 승인 아님.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_shadow_certification(
  p_pilot_run uuid, p_score numeric, p_status text, p_readiness text, p_components jsonb, p_blockers jsonb, p_limitations jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_status text := upper(coalesce(p_status,'INSUFFICIENT_DATA')); v_ready text := upper(coalesce(p_readiness,'SHADOW_ONLY'));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_status not in ('CERTIFIED','READY_WITH_WARNINGS','REVIEW_REQUIRED','BLOCKED','INSUFFICIENT_DATA') then v_status := 'INSUFFICIENT_DATA'; end if;
  if v_ready not in ('NOT_READY','SHADOW_ONLY','READY_FOR_PREVIEW_RUNTIME_TEST','READY_FOR_MANUAL_CANARY_REVIEW','BLOCKED','INSUFFICIENT_DATA') then v_ready := 'SHADOW_ONLY'; end if;
  -- 이 Phase 는 실제 Canary 시작을 하지 않는다. READINESS 는 최대 READY_FOR_MANUAL_CANARY_REVIEW 까지만 의미.
  insert into public.ai_music_shadow_certifications (pilot_run_id, score, cert_status, readiness, components, blockers, limitations, created_by)
    values (p_pilot_run, p_score, v_status, v_ready, coalesce(p_components,'{}'::jsonb), coalesce(p_blockers,'[]'::jsonb), coalesce(p_limitations,'[]'::jsonb), auth.uid())
    returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'certification snapshot recorded — 참고용, 실제 Runtime 통합/Canary 실행 아님');
end; $$;
revoke execute on function public.record_ai_shadow_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_shadow_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.record_ai_shadow_certification(uuid,numeric,text,text,jsonb,jsonb,jsonb);
--   drop function if exists public.admin_ai_shadow_certification(int);
--   drop function if exists public.admin_ai_shadow_trace(text,int);
--   drop function if exists public.admin_ai_shadow_divergences(int,int);
--   drop function if exists public.admin_ai_shadow_sessions(int,int);
--   drop function if exists public.admin_ai_shadow_overview(int);
--   drop function if exists public.ingest_ai_shadow_resolution_events(jsonb);
--   drop table if exists public.ai_music_shadow_certifications;
--   drop table if exists public.ai_music_shadow_resolution_events;
--   drop table if exists public.ai_music_shadow_sessions;
-- 신규(0469) 테이블 3 + 함수 7. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/Playlist/Store/Playback/Queue/Resolver 무영향.
-- 기존 Resolver(get_store_active_music_policy / get_playlist_tracks) 및 Playlist/Store 원본은 READ 조차 하지 않는다.
-- Shadow Event/Certification 은 실제 재생/Queue/Player 에 사용되지 않는다. Retention: 운영 적용 시 evaluated_at 기준 주기 정리 권장.
