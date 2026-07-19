-- ─────────────────────────────────────────────────────────────────────────
-- 0571 — AI-EXPERIMENT-3: Internal Test Execution Readiness, Live Validation &
--        Canary Promotion Gate.
--
-- 0569/0570 자산을 재사용하며 중복 테이블을 만들지 않는다. 이 마이그레이션은
-- **실제 Runtime 실행 증거**(Test Session / Execution Check / Operator Feedback)를
-- 기록하고 Promotion Gate 를 집계하기 위한 최소 자산만 추가한다.
--
-- 절대 원칙:
--   · 이 자산은 격리된 Test/Preview DB 에서만 실제 데이터를 담는다. Preview 앱이
--     Production DB 에 연결됐거나 격리 DB 가 없으면 실제 실행은 NO-GO 이며, 이 테이블은
--     비어 있어야 한다(Synthetic 데이터와 실제 데이터 혼합 금지).
--   · Execution Check 의 status 는 pass/fail/not_run/insufficient_data 로만 기록하며,
--     증거(evidence)가 없는 항목을 pass 로 저장하지 않는다(서버가 not_run 으로 정규화).
--   · Canary 활성화 / 외부 Store 추가 / Production Apply / Weight Apply / Global
--     Rollout / Auto Rollback 함수는 존재하지 않는다.
--   · Recommendation v1/v2 점수식·Production Weight·Queue·Player·Scheduler·Settlement
--     을 일절 변경하지 않는다. Runtime Insert 는 없고 관리는 관리자 RPC 로만.
--   · 재사용: _admin_growth_guard(0472) · _touch_updated_at(0025).
-- ─────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Test Session — 하나의 Internal Test 실행 단위(환경/Store/Browser/Operator).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_test_sessions (
  id                   uuid primary key default gen_random_uuid(),
  experiment_id        uuid references public.ai_recommendation_experiments(id) on delete set null,
  store_id             uuid,
  brand_id             uuid,
  assignment_id        uuid references public.ai_experiment_assignments(id) on delete set null,
  environment_status   text not null default 'unknown'
    check (environment_status in ('ready','partially_ready','blocked','unknown')),
  db_isolation         text not null default 'unknown'
    check (db_isolation in ('isolated_test_db','isolated_preview_db','production_connected','unknown')),
  migration_status     text not null default 'unknown'
    check (migration_status in ('fully_applied','partially_applied','not_applied','failed','unknown')),
  browser              text,
  os                   text,
  device               text,
  operator             text,
  status               text not null default 'draft'
    check (status in ('draft','running','completed','aborted')),
  final_decision       text
    check (final_decision is null or final_decision in ('NO_GO','CONTINUE_INTERNAL','EXTEND_INTERNAL','RETURN_TO_SHADOW','CANARY_CANDIDATE')),
  decision_reason      text,
  started_at           timestamptz,
  ended_at             timestamptz,
  metadata             jsonb not null default '{}'::jsonb,
  created_by           uuid,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_ai_exp_test_sessions
  on public.ai_experiment_test_sessions (experiment_id, created_at desc);

drop trigger if exists tg_ai_exp_test_sessions_touch on public.ai_experiment_test_sessions;
create trigger tg_ai_exp_test_sessions_touch before update on public.ai_experiment_test_sessions
  for each row execute function public._touch_updated_at();

alter table public.ai_experiment_test_sessions enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Execution Check — 각 검증 항목 + 증거. pass/fail/not_run/insufficient_data.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_execution_checks (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.ai_experiment_test_sessions(id) on delete cascade,
  check_key        text not null,
  category         text not null
    check (category in ('environment','runtime','playback','emergency','data','operations')),
  status           text not null default 'not_run'
    check (status in ('pass','fail','not_run','insufficient_data')),
  evidence_type    text not null default 'none'
    check (evidence_type in ('db_row','rpc_response','runtime_event','browser_console','network_request',
      'screenshot','player_state','queue_state','exposure_row','playback_event_row','audit_event','test_log','none')),
  evidence_summary text not null default '',
  occurred_at      timestamptz not null default now(),
  created_at       timestamptz not null default now(),
  unique (session_id, check_key)
);

create index if not exists idx_ai_exp_exec_checks
  on public.ai_experiment_execution_checks (session_id, category);

alter table public.ai_experiment_execution_checks enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Operator Feedback — 통계 결과를 대체하지 않는 보조 자료.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_experiment_operator_feedback (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid not null references public.ai_experiment_test_sessions(id) on delete cascade,
  store_id       uuid,
  audio_ok       boolean,
  selection_fit  int check (selection_fit is null or selection_fit between 1 and 5),
  transition_ok  boolean,
  mood_fit       int check (mood_fit is null or mood_fit between 1 and 5),
  anomaly        text,
  reproducible   boolean,
  severity       text check (severity is null or severity in ('info','low','medium','high','critical')),
  comment        text,
  operator       text,
  created_at     timestamptz not null default now()
);

create index if not exists idx_ai_exp_operator_feedback
  on public.ai_experiment_operator_feedback (session_id, created_at desc);

alter table public.ai_experiment_operator_feedback enable row level security;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Admin — Test Session 생성.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_create_test_session(p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._admin_growth_guard();
  insert into public.ai_experiment_test_sessions(
    experiment_id, store_id, brand_id, assignment_id, environment_status, db_isolation,
    migration_status, browser, os, device, operator, status, started_at, metadata, created_by)
  values (
    nullif(p_payload->>'experiment_id','')::uuid, nullif(p_payload->>'store_id','')::uuid,
    nullif(p_payload->>'brand_id','')::uuid, nullif(p_payload->>'assignment_id','')::uuid,
    coalesce(nullif(p_payload->>'environment_status',''), 'unknown'),
    coalesce(nullif(p_payload->>'db_isolation',''), 'unknown'),
    coalesce(nullif(p_payload->>'migration_status',''), 'unknown'),
    nullif(p_payload->>'browser',''), nullif(p_payload->>'os',''), nullif(p_payload->>'device',''),
    nullif(p_payload->>'operator',''), 'draft',
    coalesce((p_payload->>'started_at')::timestamptz, now()),
    coalesce(p_payload->'metadata','{}'::jsonb), auth.uid())
  returning id into v_id;
  return jsonb_build_object('session_id', v_id);
end;
$$;

grant execute on function public.admin_ai_exp_create_test_session(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Admin — Execution Check 기록. 증거 없는 pass 는 서버가 not_run 으로 정규화.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_record_execution_check(p_session_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_status text := coalesce(nullif(p_payload->>'status',''), 'not_run');
  v_ev_type text := coalesce(nullif(p_payload->>'evidence_type',''), 'none');
  v_ev_sum text := coalesce(p_payload->>'evidence_summary', '');
  v_id uuid;
begin
  perform public._admin_growth_guard();
  if not exists (select 1 from public.ai_experiment_test_sessions where id = p_session_id) then
    raise exception 'test session not found' using errcode = 'P0002';
  end if;
  -- 증거 없는 pass 는 not_run 으로 강등(증거 기반 원칙).
  if v_status = 'pass' and (v_ev_type = 'none' or btrim(v_ev_sum) = '') then
    v_status := 'not_run';
  end if;

  insert into public.ai_experiment_execution_checks(
    session_id, check_key, category, status, evidence_type, evidence_summary, occurred_at)
  values (
    p_session_id, p_payload->>'check_key',
    coalesce(nullif(p_payload->>'category',''), 'runtime'),
    v_status, v_ev_type, v_ev_sum, now())
  on conflict (session_id, check_key) do update
    set status = excluded.status, evidence_type = excluded.evidence_type,
        evidence_summary = excluded.evidence_summary, occurred_at = now()
  returning id into v_id;

  return jsonb_build_object('check_id', v_id, 'status', v_status);
end;
$$;

grant execute on function public.admin_ai_exp_record_execution_check(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Admin — Operator Feedback 기록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_record_operator_feedback(p_session_id uuid, p_payload jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_id uuid;
begin
  perform public._admin_growth_guard();
  if not exists (select 1 from public.ai_experiment_test_sessions where id = p_session_id) then
    raise exception 'test session not found' using errcode = 'P0002';
  end if;
  insert into public.ai_experiment_operator_feedback(
    session_id, store_id, audio_ok, selection_fit, transition_ok, mood_fit, anomaly,
    reproducible, severity, comment, operator)
  values (
    p_session_id, nullif(p_payload->>'store_id','')::uuid,
    (p_payload->>'audio_ok')::boolean, (p_payload->>'selection_fit')::int,
    (p_payload->>'transition_ok')::boolean, (p_payload->>'mood_fit')::int,
    nullif(p_payload->>'anomaly',''), (p_payload->>'reproducible')::boolean,
    nullif(p_payload->>'severity',''), nullif(p_payload->>'comment',''),
    nullif(p_payload->>'operator',''))
  returning id into v_id;
  return jsonb_build_object('feedback_id', v_id);
end;
$$;

grant execute on function public.admin_ai_exp_record_operator_feedback(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Admin — Test Session 상세(Checks + Feedback 집계).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_test_session_detail(p_session_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'session', to_jsonb(s),
    'checks', (select coalesce(jsonb_agg(to_jsonb(c) order by c.category, c.check_key), '[]'::jsonb)
      from public.ai_experiment_execution_checks c where c.session_id = p_session_id),
    'check_summary', (select jsonb_build_object(
        'pass', count(*) filter (where status = 'pass'),
        'fail', count(*) filter (where status = 'fail'),
        'not_run', count(*) filter (where status = 'not_run'),
        'insufficient_data', count(*) filter (where status = 'insufficient_data'))
      from public.ai_experiment_execution_checks where session_id = p_session_id),
    'feedback', (select coalesce(jsonb_agg(to_jsonb(f) order by f.created_at desc), '[]'::jsonb)
      from public.ai_experiment_operator_feedback f where f.session_id = p_session_id)
  ) into v
  from public.ai_experiment_test_sessions s
  where s.id = p_session_id;
  if v is null then raise exception 'test session not found' using errcode = 'P0002'; end if;
  return v;
end;
$$;

grant execute on function public.admin_ai_exp_test_session_detail(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Admin — Test Session 목록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_test_sessions(p_experiment_id uuid default null, p_limit int default 50)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) into v
  from (
    select id, experiment_id, store_id, environment_status, db_isolation, migration_status,
      browser, device, operator, status, final_decision, started_at, ended_at, created_at
    from public.ai_experiment_test_sessions
    where p_experiment_id is null or experiment_id = p_experiment_id
    order by created_at desc
    limit greatest(1, least(coalesce(p_limit, 50), 200))
  ) s;
  return v;
end;
$$;

grant execute on function public.admin_ai_exp_test_sessions(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Admin — Promotion Gate 집계 + Decision 저장(자동 실행 없음 · Human 기록).
--    실제 Check/Runtime Event 근거로 Gate 를 산출한다. 근거 부족 시 NO_GO/보류.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_exp_compute_promotion_gate(p_session_id uuid, p_decision text default null, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s record;
  v_env_pass boolean;
  v_runtime_fail int; v_runtime_notrun int;
  v_data_fail int;
  v_general_impact boolean;
  v_gate jsonb;
  v_decision text;
begin
  perform public._admin_growth_guard();
  select * into s from public.ai_experiment_test_sessions where id = p_session_id;
  if s.id is null then raise exception 'test session not found' using errcode = 'P0002'; end if;

  -- Environment: 격리 DB + Migration 적용이어야 통과.
  v_env_pass := s.db_isolation in ('isolated_test_db','isolated_preview_db') and s.migration_status = 'fully_applied';

  select
    count(*) filter (where category in ('runtime','playback','emergency') and status = 'fail'),
    count(*) filter (where category in ('runtime','playback','emergency') and status in ('not_run','insufficient_data')),
    count(*) filter (where category = 'data' and status = 'fail')
    into v_runtime_fail, v_runtime_notrun, v_data_fail
  from public.ai_experiment_execution_checks where session_id = p_session_id;

  v_general_impact := exists (
    select 1 from public.ai_experiment_execution_checks
    where session_id = p_session_id and check_key = 'general_store_impact' and status = 'fail');

  v_gate := jsonb_build_object(
    'environment', case when v_env_pass then 'pass' else 'fail' end,
    'runtime', case when v_runtime_fail > 0 then 'fail' when v_runtime_notrun > 0 then 'not_run' else 'pass' end,
    'data', case when v_data_fail > 0 then 'fail' else 'not_run' end,
    'operations', case when v_general_impact then 'fail' else 'not_run' end);

  -- Decision 은 Human 이 지정한 값만 기록한다(자동 승격 없음). 미지정 시 근거 기반 보수적 산출.
  if p_decision is not null then
    v_decision := p_decision;
  elsif not v_env_pass then
    v_decision := 'NO_GO';
  elsif v_runtime_fail > 0 or v_data_fail > 0 or v_general_impact then
    v_decision := 'NO_GO';
  else
    v_decision := 'CONTINUE_INTERNAL'; -- 근거 부족 — 승자/Canary 단정 금지.
  end if;

  update public.ai_experiment_test_sessions
    set final_decision = v_decision, decision_reason = p_reason, status = 'completed', ended_at = now()
  where id = p_session_id;

  return jsonb_build_object('gate', v_gate, 'decision', v_decision,
    'note', 'CANARY_CANDIDATE 는 Human Review 로만 지정되며 외부 Canary 활성화가 아니다. 근거 부족 시 승자/우열을 단정하지 않는다.');
end;
$$;

grant execute on function public.admin_ai_exp_compute_promotion_gate(uuid, text, text) to authenticated;
