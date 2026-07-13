-- ============================================
-- 0494_admin_strategy_sandbox.sql
--
-- Phase AI-MUSIC-6 — Autonomous Strategy Sandbox & Validation Engine.
--
-- AI-MUSIC-5 의 Optimization Strategy 를 **실제 운영에 반영하지 않고** 격리된 Sandbox 안에서
-- 입력 검증 · 정책/제약 검증 · 시나리오 시뮬레이션 · 회귀 검증 · Risk/Benefit 비교 · 승인 가능
-- 여부(Go/Review/Reject)까지 판정한다.
--
--   Strategy → Sandbox Run → Constraint Validation → Scenario Simulation → Regression
--   → Risk/Benefit → Go / Review / Reject
--
-- 이 마이그레이션은 **Sandbox Run/Audit 저장소 + 검증/조회 RPC + Constraint 소스 조회 RPC** 만
-- 추가한다. 검증/시뮬레이션 계산은 프론트 strategySandbox.ts(순수 로직·단위 테스트)가 수행하고,
-- RPC 는 **불변 Snapshot 과 계산 결과를 저장**한다. 원천은 기존 RPC 최대 재사용(AI-M2~M5).
--
-- ⚠️ 절대: Sandbox 는 **복제 Snapshot 과 계산 결과만** 저장한다. Production Entity(playlists/
--   playlist_tracks/track_rollouts/scheduler/queue/playback) 를 절대 UPDATE 하지 않는다.
--   applied_to_production / auto_execute / execute_at / production_* 필드를 만들지 않는다.
--   자동 승인/실행/Draft 생성 금지. Go 는 Hard Constraint Pass + Sample 충족일 때만 허용.
--
-- 절대 조건: SECURITY DEFINER + search_path 고정 · 관리자 가드 · Evidence 필수 · status/decision/
--   objective/scenario/review whitelist · 점수 0~100 clamp · NaN 금지 · 다른 Run 접근은 조회만.
-- ============================================

-- 가드 _admin_growth_guard()(0472) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 0) Constraint 소스 조회 — 실제 Guardrail(genre_store_guardrails · store_guardrails)만 반환.
--    검증 계산은 프론트. numeric(bpm/energy 등)은 track 메타 부재(NULL)로 프론트에서 미지원 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_sandbox_constraints(p_store_type text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_genre jsonb; v_store jsonb;
begin
  perform public._admin_growth_guard();
  if p_store_type is null then
    return jsonb_build_object('supported', false, 'reason', 'store_type 필수', 'generated_at', now());
  end if;

  -- genre_store_guardrails: hard_block/soft_penalty/bonus.
  select coalesce(jsonb_agg(jsonb_build_object(
    'genre', g.genre_pattern,
    'severity', case g.rule_type when 'hard_block' then 'hard' when 'soft_penalty' then 'soft' when 'bonus' then 'bonus' else g.rule_type end,
    'score_delta', g.score_delta, 'source', 'genre_store_guardrails'
  ) order by g.rule_type, g.genre_pattern), '[]'::jsonb) into v_genre
  from public.genre_store_guardrails g
  where g.is_active and g.store_slug = p_store_type;

  -- store_guardrails: genre/mood/flag(explicit)/numeric × hard_block/soft_block.
  select coalesce(jsonb_agg(jsonb_build_object(
    'rule_type', s.rule_type, 'rule_key', s.rule_key, 'operator', s.operator, 'value', s.value,
    'severity', case s.severity when 'hard_block' then 'hard' when 'soft_block' then 'soft' else s.severity end,
    'source', 'store_guardrails'
  ) order by s.rule_type, s.rule_key), '[]'::jsonb) into v_store
  from public.store_guardrails s
  where s.enabled and s.store_key = p_store_type;

  return jsonb_build_object('store_type', p_store_type, 'genre_guardrails', v_genre, 'store_guardrails', v_store, 'generated_at', now());
end;
$$;
grant execute on function public.admin_sandbox_constraints(text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Sandbox Run/Audit 저장소 — 불변 Snapshot + 계산 결과. Production 반영 필드 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.strategy_sandbox_runs (
  id                 uuid primary key default gen_random_uuid(),
  strategy_id        text,
  context_key        text not null,
  run_name           text,
  run_status         text not null default 'draft'
                       check (run_status in ('draft','validating','simulated','passed','review_required','rejected','failed','expired')),
  review_status      text not null default 'not_reviewed'
                       check (review_status in ('not_reviewed','reviewing','approval_candidate','rejected')),
  objective          text,
  scenario           text,
  decision           text check (decision in ('go','review_required','reject','insufficient_data','failed')),
  -- 불변 Input Snapshot(재현용).
  strategy_snapshot  jsonb not null default '{}'::jsonb,
  baseline_snapshot  jsonb not null default '{}'::jsonb,
  constraint_snapshot jsonb not null default '{}'::jsonb,
  scenario_config    jsonb not null default '{}'::jsonb,
  -- 계산 결과.
  simulation_result  jsonb,
  validation_result  jsonb,
  risk_result        jsonb,
  recommendation     jsonb,
  safety_score       int, benefit_score int, roi_score int, risk_score int, cost_score int,
  sample_size        int, confidence int,
  hard_constraint_pass boolean,
  fallback_used      boolean default false,
  input_hash         text,          -- 동일 Input 재현/Replay 판정
  model_version      text,          -- 계산 버전(Expiration/Replay 비교)
  replay_of          uuid references public.strategy_sandbox_runs(id) on delete set null,
  evidence           jsonb not null default '[]'::jsonb,
  created_by         uuid,
  created_at         timestamptz not null default now(),
  completed_at       timestamptz,
  expired_at         timestamptz
);
comment on table public.strategy_sandbox_runs is
  'AI-MUSIC-6 — Strategy Sandbox Run. 불변 Snapshot + 검증/시뮬레이션 결과만 저장. Production 무변경, 자동 실행/승인 없음.';
create index if not exists idx_sandbox_ctx on public.strategy_sandbox_runs (context_key, created_at desc);
create index if not exists idx_sandbox_status on public.strategy_sandbox_runs (run_status, created_at desc);
create index if not exists idx_sandbox_review on public.strategy_sandbox_runs (review_status, created_at desc);

create table if not exists public.strategy_sandbox_audit (
  id             uuid primary key default gen_random_uuid(),
  sandbox_run_id uuid references public.strategy_sandbox_runs(id) on delete cascade,
  action         text not null,
  previous_state text, next_state text,
  actor_id       uuid, reason text, metadata jsonb,
  created_at     timestamptz not null default now()
);
create index if not exists idx_sandbox_audit on public.strategy_sandbox_audit (sandbox_run_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Sandbox 생성 — 불변 Snapshot + 결과 저장. Go 는 Hard Pass + Sample 충족일 때만 허용(방어).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_sandbox_create(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid; v_row public.strategy_sandbox_runs;
  v_decision text := nullif(p_payload->>'decision','');
  v_status text := coalesce(nullif(p_payload->>'run_status',''), 'simulated');
  v_review text := coalesce(nullif(p_payload->>'review_status',''), 'not_reviewed');
  v_objective text := nullif(p_payload->>'objective','');
  v_scenario text := nullif(p_payload->>'scenario','');
  v_hard_pass boolean := coalesce((p_payload->>'hard_constraint_pass')::boolean, false);
  v_sample int := coalesce(nullif(p_payload->>'sample_size','')::int, 0);
begin
  perform public._admin_growth_guard();

  if coalesce(p_payload->>'context_key','') = '' then raise exception 'context_key required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Evidence 없는 Sandbox Run 완료 금지)' using errcode='22023';
  end if;
  if v_status not in ('draft','validating','simulated','passed','review_required','rejected','failed','expired') then
    raise exception 'invalid run_status' using errcode='22023';
  end if;
  if v_review not in ('not_reviewed','reviewing','approval_candidate','rejected') then
    raise exception 'invalid review_status' using errcode='22023';
  end if;
  if v_decision is not null and v_decision not in ('go','review_required','reject','insufficient_data','failed') then
    raise exception 'invalid decision' using errcode='22023';
  end if;
  if v_objective is not null and v_objective not in ('maximize_completion','minimize_skip','maximize_listening','maximize_health','maximize_diversity','maximize_new_track_exposure','balanced') then
    raise exception 'invalid objective' using errcode='22023';
  end if;
  if v_scenario is not null and v_scenario not in ('conservative','balanced','aggressive','custom') then
    raise exception 'invalid scenario' using errcode='22023';
  end if;
  -- 정합성: Go 는 Hard Pass + Sample>=20 일 때만.
  if v_decision = 'go' and (not v_hard_pass or v_sample < 20) then
    raise exception 'go 불가 — Hard Constraint Pass + Sample>=20 필요' using errcode='22023';
  end if;
  -- 생성 시 승인 후보 지정 금지(Review Workflow 를 거쳐야 함).
  if v_review = 'approval_candidate' then
    raise exception 'approval_candidate 는 생성 시 지정 불가(mark_review 필요)' using errcode='22023';
  end if;

  insert into public.strategy_sandbox_runs(
    strategy_id, context_key, run_name, run_status, review_status, objective, scenario, decision,
    strategy_snapshot, baseline_snapshot, constraint_snapshot, scenario_config,
    simulation_result, validation_result, risk_result, recommendation,
    safety_score, benefit_score, roi_score, risk_score, cost_score, sample_size, confidence,
    hard_constraint_pass, fallback_used, input_hash, model_version, replay_of, evidence, created_by, completed_at
  ) values (
    nullif(p_payload->>'strategy_id',''), p_payload->>'context_key', nullif(p_payload->>'run_name',''),
    v_status, v_review, v_objective, v_scenario, v_decision,
    coalesce(p_payload->'strategy_snapshot','{}'::jsonb), coalesce(p_payload->'baseline_snapshot','{}'::jsonb),
    coalesce(p_payload->'constraint_snapshot','{}'::jsonb), coalesce(p_payload->'scenario_config','{}'::jsonb),
    p_payload->'simulation_result', p_payload->'validation_result', p_payload->'risk_result', p_payload->'recommendation',
    least(100,greatest(0,nullif(p_payload->>'safety_score','')::int)),
    least(100,greatest(0,nullif(p_payload->>'benefit_score','')::int)),
    least(100,greatest(0,nullif(p_payload->>'roi_score','')::int)),
    least(100,greatest(0,nullif(p_payload->>'risk_score','')::int)),
    least(100,greatest(0,nullif(p_payload->>'cost_score','')::int)),
    v_sample, least(100,greatest(0,nullif(p_payload->>'confidence','')::int)),
    v_hard_pass, coalesce((p_payload->>'fallback_used')::boolean, false),
    nullif(p_payload->>'input_hash',''), nullif(p_payload->>'model_version',''),
    nullif(p_payload->>'replay_of','')::uuid, p_payload->'evidence', auth.uid(),
    case when v_status in ('simulated','passed','review_required','rejected','failed') then now() else null end
  ) returning id into v_id;

  insert into public.strategy_sandbox_audit(sandbox_run_id, action, next_state, actor_id, metadata)
  values (v_id, case when nullif(p_payload->>'replay_of','') is not null then 'replay' else 'created' end, v_status, auth.uid(),
    jsonb_build_object('decision', v_decision, 'scenario', v_scenario, 'objective', v_objective));

  select * into v_row from public.strategy_sandbox_runs where id = v_id;
  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_sandbox_create(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) 조회 — detail / history / summary / audit.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_sandbox_detail(p_run_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.strategy_sandbox_runs; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.strategy_sandbox_runs where id = p_run_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit
  from public.strategy_sandbox_audit a where a.sandbox_run_id = p_run_id;
  return jsonb_build_object('run', to_jsonb(v_row), 'audit', v_audit);
end;
$$;
grant execute on function public.admin_sandbox_detail(uuid) to authenticated;

create or replace function public.admin_sandbox_history(
  p_context_key text default null, p_run_status text default null, p_review_status text default null, p_limit int default 100
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select id, strategy_id, context_key, run_name, run_status, review_status, objective, scenario, decision,
      safety_score, benefit_score, roi_score, risk_score, cost_score, sample_size, confidence,
      hard_constraint_pass, fallback_used, created_at, completed_at, expired_at
    from public.strategy_sandbox_runs r
    where (p_context_key is null or r.context_key = p_context_key)
      and (p_run_status is null or r.run_status = p_run_status)
      and (p_review_status is null or r.review_status = p_review_status)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_sandbox_history(text, text, text, int) to authenticated;

create or replace function public.admin_sandbox_summary(p_context_key text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select to_jsonb(x) into v from (
    select
      count(*) as total,
      count(*) filter (where decision='go') as passed,
      count(*) filter (where decision='review_required') as review_required,
      count(*) filter (where decision='reject') as rejected,
      count(*) filter (where decision='insufficient_data') as insufficient_data,
      count(*) filter (where run_status='failed') as failures,
      count(*) filter (where run_status='expired') as expired,
      count(*) filter (where review_status='approval_candidate') as approval_candidates,
      round(avg(safety_score)::numeric,1) as avg_safety,
      round(avg(benefit_score)::numeric,1) as avg_benefit,
      round(avg(roi_score)::numeric,1) as avg_roi
    from public.strategy_sandbox_runs
    where (p_context_key is null or context_key = p_context_key)
  ) x;
  return jsonb_build_object('context_key', p_context_key, 'summary', v, 'generated_at', now());
end;
$$;
grant execute on function public.admin_sandbox_summary(text) to authenticated;

create or replace function public.admin_sandbox_audit(p_run_id uuid, p_limit int default 200)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_items
  from public.strategy_sandbox_audit a where a.sandbox_run_id = p_run_id order by a.created_at desc limit v_limit;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end;
$$;
grant execute on function public.admin_sandbox_audit(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Review Workflow — 상태 전이 + Audit. Expired → approval_candidate 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_sandbox_mark_review(
  p_run_id uuid, p_review_status text, p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare v_row public.strategy_sandbox_runs; v_prev text;
begin
  perform public._admin_growth_guard();
  if p_review_status not in ('not_reviewed','reviewing','approval_candidate','rejected') then
    raise exception 'invalid review_status' using errcode='22023';
  end if;

  select * into v_row from public.strategy_sandbox_runs where id = p_run_id;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  v_prev := v_row.review_status;

  -- Expired Run 은 승인 후보로 지정 불가.
  if p_review_status = 'approval_candidate' and (v_row.run_status = 'expired' or v_row.expired_at is not null) then
    raise exception 'Expired Run 은 approval_candidate 로 지정 불가' using errcode='22023';
  end if;
  -- Go 아닌 Run 을 승인 후보로 지정 불가(Hard Fail/Reject/부족).
  if p_review_status = 'approval_candidate' and coalesce(v_row.decision,'') not in ('go','review_required') then
    raise exception 'go/review_required 결정만 approval_candidate 가능' using errcode='22023';
  end if;

  update public.strategy_sandbox_runs set review_status = p_review_status where id = p_run_id returning * into v_row;

  insert into public.strategy_sandbox_audit(sandbox_run_id, action, previous_state, next_state, actor_id, reason)
  values (p_run_id, 'review', v_prev, p_review_status, auth.uid(), p_reason);

  return to_jsonb(v_row);
end;
$$;
grant execute on function public.admin_sandbox_mark_review(uuid, text, text) to authenticated;
