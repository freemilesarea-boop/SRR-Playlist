-- 0468 — Phase AI-MUSIC-5: Approval-Gated Pilot Execution & Safe Rollout Orchestration
--
-- 목적:
--   AI-MUSIC-4 에서 *승인된* Experiment Plan 을, 운영자가 수동 승인 게이트를 통과한 뒤에만 제한된 Pilot Store
--   집합에서 실행할 수 있게 하는 *오케스트레이션* 계층. 실행 시스템이지만 어떤 것도 자동으로 하지 않는다:
--   어떤 RPC도 Pilot 을 자동 시작하거나, Store 를 자동 배정하거나, Playlist 를 배포/확장/중단/롤백하지 않는다.
--   모든 상태 전이는 운영자 승인(별도 RPC 호출) 을 요구하며, 승인 저장만으로는 절대 활성화되지 않는다.
--
-- 안전 (절대):
--   • Additive Only. 신규 격리 테이블 6 + 신규 RPC. 기존 테이블/뷰/RLS/데이터/정산/노출/Playlist·Queue·Player·
--     Ranking·Streaming·Governance/AI-MUSIC-1~4 테이블 무변경. playback_events_v2 / store_track_reactions /
--     tracks / business_profiles / franchise_stores / playlists / playlist_tracks 는 READ-ONLY 참조만.
--   • 원본 Playlist 를 UPDATE 하지 않는다. Treatment Override 는 격리된 preview 테이블에만 기록되며, 어떤
--     runtime(Player/Queue/get_store_active_music_policy) 도 이 테이블을 읽지 않는다(Runtime 연결 DEFERRED).
--   • Control Store 는 Override 를 절대 받지 않는다(Control 보존).
--   • 상태 전이는 엄격한 allowlist 로만 허용되며 terminal 상태는 재활성화 불가. 자동 start/assign/deploy/
--     expand/stop/rollback 없음. Guardrail 실패는 STOP_RECOMMENDED 기록만 — 운영자 승인 없이는 중단하지 않는다.
--   • Production Apply 금지. Preview / rollback-txn(synthetic) 검증 전용. 운영 head 는 0453 유지.
--   • Security Definer + _is_super_admin() 게이트 + search_path 고정 + 파라미터 바인딩 + row/array 상한 +
--     auth.uid() actor 기록. Dynamic SQL 없음.

-- ─────────────────────────────────────────────────────────────────────
-- 1) Pilot 저장 테이블 (신규, 격리)
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public.ai_music_pilot_runs (
  id                   uuid primary key default gen_random_uuid(),
  experiment_id        uuid,                       -- AI-MUSIC-4 실험 참조(느슨) — 실제 배정/배포 아님
  name                 text not null,
  candidate_playlist_id text,
  candidate_version    int,                        -- 승인된 버전으로 고정(pin)
  state                text not null default 'DRAFT'
                         check (state in ('DRAFT','REVIEW_REQUIRED','APPROVED','SCHEDULED','ACTIVE','PAUSED',
                                          'STOP_REQUESTED','STOPPED','COMPLETED','ROLLBACK_REQUESTED','ROLLED_BACK',
                                          'CANCELLED','FAILED','EXPIRED')),
  scheduled_start      timestamptz,
  scheduled_end        timestamptz,
  expiry               timestamptz,
  approved_by          uuid,
  approved_at          timestamptz,
  approval_reason      text,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.ai_music_pilot_runs is 'AI-MUSIC-5 Pilot 실행 인스턴스. 상태 전이는 운영자 승인 RPC 로만. 승인 저장≠활성화. 원본 Playlist/Player 무변경.';
create index if not exists ampr_state_idx on public.ai_music_pilot_runs (state, created_at desc);

create table if not exists public.ai_music_pilot_assignments (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.ai_music_pilot_runs(id) on delete cascade,
  store_id             uuid not null,
  arm                  text not null check (arm in ('control','treatment')),
  candidate_playlist_id text,                      -- control 은 항상 null (Control 보존)
  candidate_version    int,
  previous_playlist_id text,                       -- rollback 대상(참고) — 원본 UPDATE 아님
  previous_playlist_version int,
  assignment_hash      text not null,              -- 클라이언트 결정적 엔진이 산출한 immutable 해시
  created_by           uuid,
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_pilot_assignments is 'AI-MUSIC-5 불변 배정 스냅샷. Playback 에 연결되지 않음 — 실제 Store Playlist UPDATE 아님. control 은 candidate 없음.';
create unique index if not exists ampa_run_store_uq on public.ai_music_pilot_assignments (run_id, store_id);
create index if not exists ampa_store_idx on public.ai_music_pilot_assignments (store_id);

create table if not exists public.ai_music_playlist_overrides (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.ai_music_pilot_runs(id) on delete cascade,
  assignment_id        uuid not null references public.ai_music_pilot_assignments(id) on delete cascade,
  store_id             uuid not null,
  arm                  text not null check (arm in ('control','treatment')),
  candidate_playlist_id text,
  candidate_version    int,
  state                text not null default 'ACTIVE' check (state in ('ACTIVE','PAUSED','STOPPED','ROLLED_BACK','EXPIRED')),
  start_at             timestamptz,
  end_at               timestamptz,
  expiry               timestamptz,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.ai_music_playlist_overrides is 'AI-MUSIC-5 Treatment Override (PREVIEW 전용, 격리). 어떤 runtime 도 읽지 않음(Runtime 연결 DEFERRED). 원본 Playlist 무변경. control 행은 생성되지 않음.';
-- 한 Store 는 하나의 라이브(ACTIVE) override 만: preview 충돌 방지.
create unique index if not exists ampo_store_active_uq on public.ai_music_playlist_overrides (store_id) where state = 'ACTIVE';
create index if not exists ampo_run_idx on public.ai_music_playlist_overrides (run_id, state);

create table if not exists public.ai_music_pilot_observations (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.ai_music_pilot_runs(id) on delete cascade,
  obs_window           text not null check (obs_window in ('BASELINE','EARLY','MID','LATE','FINAL')),
  status               text not null check (status in ('READY','NO_DATA','INSUFFICIENT_DATA')),
  payload              jsonb not null default '{}'::jsonb,
  created_by           uuid,
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_pilot_observations is 'AI-MUSIC-5 관측 스냅샷(READ-ONLY 롤업). 분석 전용 — 어떤 실행도 트리거하지 않음.';
create index if not exists ampo_obs_run_idx on public.ai_music_pilot_observations (run_id, created_at desc);

create table if not exists public.ai_music_pilot_guardrails (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid not null references public.ai_music_pilot_runs(id) on delete cascade,
  status               text not null check (status in ('PASS','WARNING','STOP_RECOMMENDED','BLOCKED','NOT_AVAILABLE','INSUFFICIENT_DATA')),
  triggers             jsonb not null default '[]'::jsonb,
  recommendation       text,
  created_by           uuid,
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_pilot_guardrails is 'AI-MUSIC-5 Guardrail 모니터 기록(권고 전용). STOP_RECOMMENDED/BLOCKED 는 권고일 뿐 — 자동 중단 아님.';
create index if not exists ampg_run_idx on public.ai_music_pilot_guardrails (run_id, created_at desc);

create table if not exists public.ai_music_pilot_actions (
  id                   uuid primary key default gen_random_uuid(),
  run_id               uuid references public.ai_music_pilot_runs(id) on delete cascade,
  action               text not null,
  from_state           text,
  to_state             text,
  actor                uuid,
  reason               text,
  created_at           timestamptz not null default now()
);
comment on table public.ai_music_pilot_actions is 'AI-MUSIC-5 전체 감사 추적(append-only 용도). 모든 운영자 승인/전이 기록. 자동 실행 아님.';
create index if not exists ampact_run_idx on public.ai_music_pilot_actions (run_id, created_at desc);

-- RLS: super-admin read; writes via RPC only.
do $$ declare t text;
begin
  foreach t in array array['ai_music_pilot_runs','ai_music_pilot_assignments','ai_music_playlist_overrides','ai_music_pilot_observations','ai_music_pilot_guardrails','ai_music_pilot_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists %I on public.%I', t||'_super_admin_read', t);
    execute format('create policy %I on public.%I for select using (public._is_super_admin())', t||'_super_admin_read', t);
    execute format('revoke insert, update, delete on public.%I from authenticated, anon', t);
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 2) 상태 전이 allowlist helper (클라이언트 stateMachine 과 1:1 동일). terminal 재활성화 불가.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_pilot_can_transition(p_from text, p_to text)
returns boolean language sql immutable set search_path = public as $$
  select case p_from
    when 'DRAFT'              then p_to = any(array['REVIEW_REQUIRED','APPROVED','CANCELLED'])
    when 'REVIEW_REQUIRED'    then p_to = any(array['APPROVED','DRAFT','CANCELLED'])
    when 'APPROVED'           then p_to = any(array['SCHEDULED','CANCELLED','EXPIRED'])
    when 'SCHEDULED'          then p_to = any(array['ACTIVE','CANCELLED','EXPIRED'])
    when 'ACTIVE'             then p_to = any(array['PAUSED','STOP_REQUESTED','COMPLETED','FAILED','EXPIRED'])
    when 'PAUSED'             then p_to = any(array['ACTIVE','STOP_REQUESTED','FAILED','EXPIRED'])
    when 'STOP_REQUESTED'     then p_to = any(array['STOPPED','FAILED'])
    when 'STOPPED'            then p_to = any(array['ROLLBACK_REQUESTED','COMPLETED'])
    when 'ROLLBACK_REQUESTED' then p_to = any(array['ROLLED_BACK','FAILED'])
    else false  -- ROLLED_BACK / COMPLETED / CANCELLED / FAILED / EXPIRED = terminal
  end;
$$;
revoke execute on function public._ai_pilot_can_transition(text,text) from public;

-- 공통 전이 실행 helper: 검증 + run.state 갱신 + action 기록. 금지 전이는 예외.
create or replace function public._ai_pilot_apply_transition(p_run uuid, p_to text, p_action text, p_reason text)
returns text language plpgsql security definer set search_path = public as $$
declare v_from text;
begin
  select state into v_from from public.ai_music_pilot_runs where id = p_run for update;
  if v_from is null then raise exception 'pilot run not found'; end if;
  if v_from = p_to then raise exception 'invalid transition: same state (%)', v_from; end if;
  if not public._ai_pilot_can_transition(v_from, p_to) then
    raise exception 'forbidden transition: % -> %', v_from, p_to;
  end if;
  update public.ai_music_pilot_runs set state = p_to, updated_at = now() where id = p_run;
  insert into public.ai_music_pilot_actions (run_id, action, from_state, to_state, actor, reason)
    values (p_run, coalesce(p_action,'TRANSITION'), v_from, p_to, auth.uid(), left(coalesce(p_reason,''),1000));
  return v_from;
end; $$;
revoke execute on function public._ai_pilot_apply_transition(uuid,text,text,text) from public;

-- ─────────────────────────────────────────────────────────────────────
-- 3) READ-ONLY 조회 RPC
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pilot_overview(p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'runs', coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', r.id, 'name', r.name, 'state', r.state, 'experimentId', r.experiment_id,
      'candidatePlaylistId', r.candidate_playlist_id, 'candidateVersion', r.candidate_version,
      'scheduledStart', to_char(r.scheduled_start,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'scheduledEnd', to_char(r.scheduled_end,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'expiry', to_char(r.expiry,'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'controlCount', (select count(*) from public.ai_music_pilot_assignments a where a.run_id=r.id and a.arm='control'),
      'treatmentCount', (select count(*) from public.ai_music_pilot_assignments a where a.run_id=r.id and a.arm='treatment'),
      'activeOverrides', (select count(*) from public.ai_music_playlist_overrides o where o.run_id=r.id and o.state='ACTIVE'),
      'createdAt', to_char(r.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by r.created_at desc)
    from (select * from public.ai_music_pilot_runs order by created_at desc limit v_limit) r
  ), '[]'::jsonb),
  'note', 'runtime 연결 DEFERRED — override 는 preview 전용, 어떤 Player/Queue 도 읽지 않음') into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_pilot_overview(int) from public;
do $$ begin begin grant execute on function public.admin_ai_pilot_overview(int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_pilot_run(p_run uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true,
    'run', (select to_jsonb(r) from public.ai_music_pilot_runs r where r.id = p_run),
    'assignments', coalesce((select jsonb_agg(jsonb_build_object(
        'id', a.id, 'storeId', a.store_id, 'arm', a.arm, 'candidatePlaylistId', a.candidate_playlist_id,
        'candidateVersion', a.candidate_version, 'previousPlaylistId', a.previous_playlist_id,
        'assignmentHash', a.assignment_hash) order by a.arm, a.created_at)
      from public.ai_music_pilot_assignments a where a.run_id = p_run), '[]'::jsonb),
    'overrides', coalesce((select jsonb_agg(jsonb_build_object(
        'id', o.id, 'storeId', o.store_id, 'arm', o.arm, 'state', o.state,
        'candidatePlaylistId', o.candidate_playlist_id, 'candidateVersion', o.candidate_version) order by o.created_at)
      from public.ai_music_playlist_overrides o where o.run_id = p_run), '[]'::jsonb),
    'actions', coalesce((select jsonb_agg(jsonb_build_object(
        'action', ac.action, 'fromState', ac.from_state, 'toState', ac.to_state, 'actor', ac.actor,
        'reason', ac.reason, 'createdAt', to_char(ac.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by ac.created_at desc)
      from public.ai_music_pilot_actions ac where ac.run_id = p_run), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_pilot_run(uuid) from public;
do $$ begin begin grant execute on function public.admin_ai_pilot_run(uuid) to authenticated; exception when undefined_object then null; end; end $$;

-- Pilot 진행 신호 집계(배정된 Store 들의 기존 Playback 을 READ-ONLY 관찰). 실제 그룹 배정 아님.
create or replace function public.admin_ai_pilot_progress(p_run uuid, p_days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_days int := least(greatest(coalesce(p_days,30),1),90); v_c uuid[]; v_t uuid[];
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select array_agg(store_id) into v_c from public.ai_music_pilot_assignments where run_id=p_run and arm='control';
  select array_agg(store_id) into v_t from public.ai_music_pilot_assignments where run_id=p_run and arm='treatment';
  return jsonb_build_object('ok', true, 'windowDays', v_days,
    'control', public._ai_pilot_arm(coalesce(v_c,'{}'::uuid[]), v_days),
    'treatment', public._ai_pilot_arm(coalesce(v_t,'{}'::uuid[]), v_days),
    'note', 'observational · Store/Session/Playback 구분 · 실제 그룹 배정/실행 아님');
end; $$;
revoke execute on function public.admin_ai_pilot_progress(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_pilot_progress(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public._ai_pilot_arm(p_stores uuid[], p_days int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_stores uuid[];
begin
  v_stores := (select array_agg(x) from (select unnest(coalesce(p_stores,'{}'::uuid[])) x limit 200) s);
  with ev as (
    select * from public.playback_events_v2
    where business_id = any(coalesce(v_stores,'{}'::uuid[])) and created_at >= now() - make_interval(days => p_days)
  )
  select jsonb_build_object(
    'stores', coalesce(array_length(v_stores,1),0),
    'sessions', (select count(distinct session_id) from ev),
    'playbacks', (select count(*) from ev),
    'completes', (select count(*) from ev where event_type='play_complete'),
    'skips', (select count(*) from ev where event_type='skip'),
    'likes', (select count(*) from ev where event_type='like'),
    'completionRate', (select round(count(*) filter (where event_type='play_complete')::numeric / nullif(count(*),0),4) from ev),
    'skipRate', (select round(count(*) filter (where event_type='skip')::numeric / nullif(count(*),0),4) from ev),
    'streamingQualityScore', null, 'criticalIncidents', null) into v;  -- streaming/incident source 미적용 → NOT_AVAILABLE
  return v;
end; $$;
revoke execute on function public._ai_pilot_arm(uuid[],int) from public;

create or replace function public.admin_ai_pilot_observations(p_run uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'observations', coalesce((
    select jsonb_agg(jsonb_build_object('id', o.id, 'window', o.obs_window, 'status', o.status, 'payload', o.payload,
      'createdAt', to_char(o.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by o.created_at desc)
    from (select * from public.ai_music_pilot_observations where run_id=p_run order by created_at desc limit v_limit) o
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_pilot_observations(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_pilot_observations(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.admin_ai_pilot_guardrails(p_run uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb; v_limit int := least(greatest(coalesce(p_limit,50),1),200);
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select jsonb_build_object('ok', true, 'guardrails', coalesce((
    select jsonb_agg(jsonb_build_object('id', g.id, 'status', g.status, 'triggers', g.triggers, 'recommendation', g.recommendation,
      'createdAt', to_char(g.created_at,'YYYY-MM-DD"T"HH24:MI:SS"Z"')) order by g.created_at desc)
    from (select * from public.ai_music_pilot_guardrails where run_id=p_run order by created_at desc limit v_limit) g
  ), '[]'::jsonb)) into v;
  return v;
end; $$;
revoke execute on function public.admin_ai_pilot_guardrails(uuid,int) from public;
do $$ begin begin grant execute on function public.admin_ai_pilot_guardrails(uuid,int) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4) 승인 게이트 — Run 생성 + 불변 배정 스냅샷 기록. 상태 = APPROVED. 활성화 아님(override 미생성).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_pilot_approval(
  p_experiment uuid, p_name text, p_candidate text, p_version int,
  p_scheduled_start timestamptz, p_scheduled_end timestamptz, p_expiry timestamptz,
  p_reason text, p_assignments jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; rec jsonb; v_n int := 0; v_arm text; v_cand text; v_ver int;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if p_version is null then raise exception 'candidate version must be pinned (non-null)'; end if;
  insert into public.ai_music_pilot_runs (experiment_id, name, candidate_playlist_id, candidate_version,
      state, scheduled_start, scheduled_end, expiry, approved_by, approved_at, approval_reason, created_by)
    values (p_experiment, left(coalesce(p_name,'pilot'),160), left(coalesce(p_candidate,''),120), p_version,
      'APPROVED', p_scheduled_start, p_scheduled_end, p_expiry, auth.uid(), now(), left(coalesce(p_reason,''),1000), auth.uid())
    returning id into v_id;

  for rec in select * from jsonb_array_elements(coalesce(p_assignments,'[]'::jsonb)) loop
    exit when v_n >= 400;
    v_arm := lower(coalesce(rec->>'arm','treatment'));
    if v_arm not in ('control','treatment') then v_arm := 'treatment'; end if;
    -- Control 은 candidate 를 절대 갖지 않는다(Control 보존).
    if v_arm = 'control' then v_cand := null; v_ver := null;
    else v_cand := nullif(rec->>'candidatePlaylistId',''); v_ver := nullif(rec->>'candidateVersion','')::int; end if;
    insert into public.ai_music_pilot_assignments (run_id, store_id, arm, candidate_playlist_id, candidate_version,
        previous_playlist_id, previous_playlist_version, assignment_hash, created_by)
      values (v_id, (rec->>'storeId')::uuid, v_arm, v_cand, v_ver,
        nullif(rec->>'previousPlaylistId',''), nullif(rec->>'previousPlaylistVersion','')::int,
        left(coalesce(rec->>'assignmentHash','0'),32), auth.uid())
    on conflict (run_id, store_id) do nothing;
    v_n := v_n + 1;
  end loop;

  insert into public.ai_music_pilot_actions (run_id, action, from_state, to_state, actor, reason)
    values (v_id, 'APPROVAL_RECORDED', 'DRAFT', 'APPROVED', auth.uid(), 'approval stored — NOT activated, no override created');
  return jsonb_build_object('ok', true, 'id', v_id, 'assignmentsStored', v_n,
    'note', 'APPROVED — 승인 저장만으로 활성화되지 않음. 별도 activate_ai_pilot 필요. override 미생성.');
end; $$;
revoke execute on function public.record_ai_pilot_approval(uuid,text,text,int,timestamptz,timestamptz,timestamptz,text,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_pilot_approval(uuid,text,text,int,timestamptz,timestamptz,timestamptz,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5) 수동 활성화 — APPROVED → SCHEDULED → ACTIVE. Treatment 만 Override(preview) 생성. Control 은 미생성.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.activate_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_state text; v_created int := 0; a record; v_run public.ai_music_pilot_runs;
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  select * into v_run from public.ai_music_pilot_runs where id = p_run for update;
  if v_run.id is null then raise exception 'pilot run not found'; end if;
  v_state := v_run.state;
  if v_state <> 'APPROVED' then raise exception 'activate requires APPROVED state (got %)', v_state; end if;
  if v_run.expiry is not null and v_run.expiry <= now() then raise exception 'approval expired — re-approval required'; end if;

  perform public._ai_pilot_apply_transition(p_run, 'SCHEDULED', 'SCHEDULE', p_reason);
  perform public._ai_pilot_apply_transition(p_run, 'ACTIVE', 'ACTIVATE', p_reason);

  -- Treatment 배정에만 Override(preview) 생성. Control 은 절대 생성하지 않음(Control 보존).
  for a in select * from public.ai_music_pilot_assignments where run_id = p_run and arm = 'treatment' and candidate_playlist_id is not null loop
    insert into public.ai_music_playlist_overrides (run_id, assignment_id, store_id, arm, candidate_playlist_id, candidate_version,
        state, start_at, end_at, expiry, created_by)
      values (p_run, a.id, a.store_id, 'treatment', a.candidate_playlist_id, a.candidate_version,
        'ACTIVE', now(), v_run.scheduled_end, v_run.expiry, auth.uid())
    on conflict (store_id) where state = 'ACTIVE' do nothing;
    v_created := v_created + 1;
  end loop;

  return jsonb_build_object('ok', true, 'state', 'ACTIVE', 'overridesCreated', v_created,
    'note', 'ACTIVE — Override 는 preview 전용(격리). 원본 Playlist/Player/Queue 무변경. Control override 미생성.');
end; $$;
revoke execute on function public.activate_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.activate_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 6) Pause / Resume / Stop(request→confirm) / Rollback(request→confirm) / Complete — 각각 운영자 승인 전이.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._ai_pilot_set_overrides(p_run uuid, p_state text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.ai_music_playlist_overrides set state = p_state, updated_at = now()
    where run_id = p_run and state not in ('ROLLED_BACK','EXPIRED');
end; $$;
revoke execute on function public._ai_pilot_set_overrides(uuid,text) from public;

create or replace function public.pause_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'PAUSED', 'PAUSE', p_reason);
  perform public._ai_pilot_set_overrides(p_run, 'PAUSED');
  return jsonb_build_object('ok', true, 'state', 'PAUSED', 'note', 'preview override paused — no player impact');
end; $$;
revoke execute on function public.pause_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.pause_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.resume_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'ACTIVE', 'RESUME', p_reason);
  update public.ai_music_playlist_overrides set state='ACTIVE', updated_at=now() where run_id=p_run and state='PAUSED';
  return jsonb_build_object('ok', true, 'state', 'ACTIVE', 'note', 'preview override resumed');
end; $$;
revoke execute on function public.resume_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.resume_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.request_ai_pilot_stop(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'STOP_REQUESTED', 'REQUEST_STOP', p_reason);
  return jsonb_build_object('ok', true, 'state', 'STOP_REQUESTED', 'note', 'stop requested — separate confirm required, not auto-stopped');
end; $$;
revoke execute on function public.request_ai_pilot_stop(uuid,text) from public;
do $$ begin begin grant execute on function public.request_ai_pilot_stop(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.stop_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'STOPPED', 'STOP', p_reason);
  perform public._ai_pilot_set_overrides(p_run, 'STOPPED');
  return jsonb_build_object('ok', true, 'state', 'STOPPED', 'note', 'override stopped — fails open to existing store path (original playlist untouched)');
end; $$;
revoke execute on function public.stop_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.stop_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.request_ai_pilot_rollback(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'ROLLBACK_REQUESTED', 'REQUEST_ROLLBACK', p_reason);
  return jsonb_build_object('ok', true, 'state', 'ROLLBACK_REQUESTED', 'note', 'rollback requested — separate confirm required, not auto-rolled-back');
end; $$;
revoke execute on function public.request_ai_pilot_rollback(uuid,text) from public;
do $$ begin begin grant execute on function public.request_ai_pilot_rollback(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.rollback_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'ROLLED_BACK', 'ROLLBACK', p_reason);
  update public.ai_music_playlist_overrides set state='ROLLED_BACK', updated_at=now() where run_id=p_run and state not in ('EXPIRED');
  return jsonb_build_object('ok', true, 'state', 'ROLLED_BACK',
    'note', 'override rolled back — store resolves to previous/existing playlist. 원본 Playlist 를 UPDATE 하지 않음.');
end; $$;
revoke execute on function public.rollback_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.rollback_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.complete_ai_pilot(p_run uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  perform public._ai_pilot_apply_transition(p_run, 'COMPLETED', 'COMPLETE', p_reason);
  update public.ai_music_playlist_overrides set state='EXPIRED', updated_at=now() where run_id=p_run and state not in ('ROLLED_BACK');
  return jsonb_build_object('ok', true, 'state', 'COMPLETED', 'note', 'pilot completed by operator — overrides expired, original playlists untouched');
end; $$;
revoke execute on function public.complete_ai_pilot(uuid,text) from public;
do $$ begin begin grant execute on function public.complete_ai_pilot(uuid,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 7) 관측/Guardrail 스냅샷 기록 RPC (분석/권고 전용 — 실행 없음).
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.record_ai_pilot_observation(p_run uuid, p_window text, p_status text, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_w text := upper(coalesce(p_window,'EARLY')); v_s text := upper(coalesce(p_status,'NO_DATA'));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_w not in ('BASELINE','EARLY','MID','LATE','FINAL') then v_w := 'EARLY'; end if;
  if v_s not in ('READY','NO_DATA','INSUFFICIENT_DATA') then v_s := 'NO_DATA'; end if;
  insert into public.ai_music_pilot_observations (run_id, window, status, payload, created_by)
    values (p_run, v_w, v_s, coalesce(p_payload,'{}'::jsonb), auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'observation snapshot stored — read-only analysis');
end; $$;
revoke execute on function public.record_ai_pilot_observation(uuid,text,text,jsonb) from public;
do $$ begin begin grant execute on function public.record_ai_pilot_observation(uuid,text,text,jsonb) to authenticated; exception when undefined_object then null; end; end $$;

create or replace function public.record_ai_pilot_guardrail(p_run uuid, p_status text, p_triggers jsonb, p_recommendation text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_s text := upper(coalesce(p_status,'NOT_AVAILABLE'));
begin
  if not public._is_super_admin() then raise exception 'forbidden: admin only'; end if;
  if v_s not in ('PASS','WARNING','STOP_RECOMMENDED','BLOCKED','NOT_AVAILABLE','INSUFFICIENT_DATA') then v_s := 'NOT_AVAILABLE'; end if;
  insert into public.ai_music_pilot_guardrails (run_id, status, triggers, recommendation, created_by)
    values (p_run, v_s, coalesce(p_triggers,'[]'::jsonb), left(coalesce(p_recommendation,''),1000), auth.uid()) returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'note', 'guardrail recorded — recommendation only, no automatic stop');
end; $$;
revoke execute on function public.record_ai_pilot_guardrail(uuid,text,jsonb,text) from public;
do $$ begin begin grant execute on function public.record_ai_pilot_guardrail(uuid,text,jsonb,text) to authenticated; exception when undefined_object then null; end; end $$;

-- ─────────────────────────────────────────────────────────────────────
-- ROLLBACK (참고용 — Preview/rollback-txn 검증 전용. Production apply 금지):
--   drop function if exists public.record_ai_pilot_guardrail(uuid,text,jsonb,text);
--   drop function if exists public.record_ai_pilot_observation(uuid,text,text,jsonb);
--   drop function if exists public.complete_ai_pilot(uuid,text);
--   drop function if exists public.rollback_ai_pilot(uuid,text);
--   drop function if exists public.request_ai_pilot_rollback(uuid,text);
--   drop function if exists public.stop_ai_pilot(uuid,text);
--   drop function if exists public.request_ai_pilot_stop(uuid,text);
--   drop function if exists public.resume_ai_pilot(uuid,text);
--   drop function if exists public.pause_ai_pilot(uuid,text);
--   drop function if exists public._ai_pilot_set_overrides(uuid,text);
--   drop function if exists public.activate_ai_pilot(uuid,text);
--   drop function if exists public.record_ai_pilot_approval(uuid,text,text,int,timestamptz,timestamptz,timestamptz,text,jsonb);
--   drop function if exists public.admin_ai_pilot_guardrails(uuid,int);
--   drop function if exists public.admin_ai_pilot_observations(uuid,int);
--   drop function if exists public._ai_pilot_arm(uuid[],int);
--   drop function if exists public.admin_ai_pilot_progress(uuid,int);
--   drop function if exists public.admin_ai_pilot_run(uuid);
--   drop function if exists public.admin_ai_pilot_overview(int);
--   drop function if exists public._ai_pilot_apply_transition(uuid,text,text,text);
--   drop function if exists public._ai_pilot_can_transition(text,text);
--   drop table if exists public.ai_music_pilot_actions;
--   drop table if exists public.ai_music_pilot_guardrails;
--   drop table if exists public.ai_music_pilot_observations;
--   drop table if exists public.ai_music_playlist_overrides;
--   drop table if exists public.ai_music_pilot_assignments;
--   drop table if exists public.ai_music_pilot_runs;
-- 신규(0468) 테이블 6 + 함수 20. 롤백은 순수 DROP. 기존 데이터/스키마/RLS/정산/노출/Playlist·Queue·Player 로직 영향 없음.
-- playback_events_v2 / store_track_reactions / tracks / business_profiles / franchise_stores / playlists / playlist_tracks 는 READ-ONLY.
-- 어떤 runtime 도 ai_music_playlist_overrides 를 읽지 않는다(Runtime 연결 DEFERRED — 다음 단계에서 별도 승인 후).
