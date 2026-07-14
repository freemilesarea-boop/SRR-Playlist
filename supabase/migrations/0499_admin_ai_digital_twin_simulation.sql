-- ============================================
-- 0499_admin_ai_digital_twin_simulation.sql
--
-- Phase AI-MUSIC-11 — Store Digital Twin, Counterfactual Simulation & Scenario Laboratory.
--
-- 실제 운영 환경을 읽기 전용 Snapshot 으로 복제한 Immutable Digital Twin 위에서
-- 여러 Scenario/Variant 를 결정적(Seeded)으로 비교하는 Simulation Evidence Layer.
--
--   Production Snapshot → Twin Eligibility → Immutable Twin → Scenario → Variants
--   → Deterministic Simulation → Multi-Agent 평가 → Risk/Benefit/Confidence
--   → Comparison → Governance Review Evidence → Sandbox/Draft 참고 근거
--
-- ⚠️ 경계: 기존 Sandbox(0494)는 "단일 Strategy 후보의 제약/정책 통과 검증" —
--   Digital Twin 은 "환경 Snapshot 전체에 다중 Variant 비교". Twin 은 Sandbox 를
--   대체하지 않으며 판정을 덮어쓰지 않는다(참고 Evidence 만).
--
-- ⚠️ 절대: Simulation 결과는 simulated/counterfactual(관찰되지 않은 가상 추정치) —
--   실제 Outcome 으로 저장 금지. Production Playlist/Rotation/Scheduler/Queue/Playback/
--   Rollout/Experiment/Strategy/Sandbox/Draft/Candidate/Trust/Constitution/Reputation/
--   Memory Quality/Pattern Confidence 를 생성·수정·실행하지 않는다. Write-back 없음.
--   Twin Snapshot 불변(수정 RPC 없음 — supersede 만) · 삭제 RPC 없음 · Trigger 없음.
--
-- 재사용: guardrail 은 admin_sandbox_constraints(0494), Memory/Pattern 은 ID Reference 만
--   (전체 JSON 복제 금지), Agent 평가는 0497 Consensus 재사용(정의 무변경).
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Immutable Digital Twin — Snapshot 수정 RPC 없음(supersede 로만 교체).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_digital_twins (
  id                  uuid primary key default gen_random_uuid(),
  twin_code           text not null unique,
  twin_type           text not null check (twin_type in ('store','brand','industry','playlist','context')),
  twin_scope          text not null,
  scope_id            text,
  source_type         text not null,
  source_id           text not null,
  source_version      text not null,
  source_hash         text not null,
  snapshot_at         timestamptz not null,
  snapshot_version    int not null default 1,
  context_snapshot    jsonb not null default '{}'::jsonb,
  policy_snapshot     jsonb,
  guardrail_snapshot  jsonb,
  playlist_snapshot   jsonb,
  track_pool_snapshot jsonb,
  outcome_snapshot    jsonb,
  quality_snapshot    jsonb,
  memory_snapshot_refs  jsonb not null default '[]'::jsonb,   -- Memory ID Reference 만(복제 금지)
  pattern_snapshot_refs jsonb not null default '[]'::jsonb,
  agent_snapshot_refs   jsonb not null default '[]'::jsonb,
  completeness_score  int check (completeness_score is null or (completeness_score between 0 and 100)),
  freshness_score     int check (freshness_score is null or (freshness_score between 0 and 100)),
  readiness_status    text not null default 'partially_ready' check (readiness_status in ('ready','partially_ready','stale','unsupported','insufficient_data','blocked')),
  lifecycle_status    text not null default 'active' check (lifecycle_status in ('draft','active','superseded','archived','blocked')),
  limitations         jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  idempotency_key     text,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
comment on table public.ai_digital_twins is
  'AI-MUSIC-11 — Immutable Digital Twin(읽기 전용 Production Snapshot 복제). 원본과 동기화/Write-back 없음. Snapshot 수정 불가(supersede 만).';
create unique index if not exists uq_twin_idem on public.ai_digital_twins (idempotency_key) where idempotency_key is not null;
create index if not exists idx_twin_type on public.ai_digital_twins (twin_type, lifecycle_status, created_at desc);
create index if not exists idx_twin_source on public.ai_digital_twins (source_type, source_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Scenario / Variant — Baseline 필수 · Variant 상한 · Dimension whitelist.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_twin_scenarios (
  id                  uuid primary key default gen_random_uuid(),
  scenario_code       text not null unique,
  twin_id             uuid not null references public.ai_digital_twins(id),
  scenario_type       text not null check (scenario_type in ('playlist_mix','genre_mix','mood_mix','track_ranking','artist_exposure','diversity','freshness','rotation','fatigue','time_slot','weekday','season','rollout','quality_degradation','recovery','policy_change','guardrail_change','strategy_comparison','combined')),
  title               text not null,
  objective           text,
  hypothesis          text,
  baseline_definition jsonb not null,
  simulation_horizon  int not null check (simulation_horizon between 1 and 30),   -- 최대 30일(장기 정밀 예측 미지원)
  time_granularity    text check (time_granularity is null or time_granularity in ('session','hour','day')),
  requested_metrics   jsonb not null default '[]'::jsonb,
  assumption_snapshot jsonb not null default '{}'::jsonb,
  constraint_snapshot jsonb,
  model_version       text not null,
  input_hash          text not null,
  risk_tier           text check (risk_tier is null or risk_tier in ('low','medium','high','critical')),
  lifecycle_status    text not null default 'active' check (lifecycle_status in ('draft','active','superseded','archived','blocked')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '[]'::jsonb,
  idempotency_key     text,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
comment on table public.ai_twin_scenarios is
  'AI-MUSIC-11 — Twin Scenario. Baseline 필수 · Horizon<=30일 · weather/event/energy_mix 는 데이터 없어 whitelist 제외(정직).';
create unique index if not exists uq_scenario_idem on public.ai_twin_scenarios (idempotency_key) where idempotency_key is not null;
create index if not exists idx_scenario_twin on public.ai_twin_scenarios (twin_id, created_at desc);

create table if not exists public.ai_twin_variants (
  id                 uuid primary key default gen_random_uuid(),
  scenario_id        uuid not null references public.ai_twin_scenarios(id),
  variant_code       text not null,
  variant_name       text not null,
  variant_definition jsonb not null default '{}'::jsonb,
  changed_dimensions jsonb not null default '[]'::jsonb,
  expected_direction text check (expected_direction is null or expected_direction in ('improve','neutral','worsen','unknown')),
  assumption_snapshot jsonb not null default '{}'::jsonb,
  input_hash         text not null,
  is_baseline        boolean not null default false,
  lifecycle_status   text not null default 'active' check (lifecycle_status in ('active','superseded','archived','blocked')),
  created_at         timestamptz not null default now(),
  unique (scenario_id, input_hash)
);
comment on table public.ai_twin_variants is
  'AI-MUSIC-11 — Scenario Variant. Scenario 당 최대 20개 · Baseline 정확히 1개 · 중복 Input Hash 차단.';
create unique index if not exists uq_variant_baseline on public.ai_twin_variants (scenario_id) where is_baseline;
create index if not exists idx_variant_scenario on public.ai_twin_variants (scenario_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Simulation Run / Result — simulated ≠ actual(실제 Outcome 테이블과 분리).
--    Worker 없음 → 동기(클라이언트 결정적 계산) 완료 저장만. production/live 상태 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_twin_simulation_runs (
  id                        uuid primary key default gen_random_uuid(),
  run_code                  text not null unique,
  twin_id                   uuid not null references public.ai_digital_twins(id),
  scenario_id               uuid not null references public.ai_twin_scenarios(id),
  baseline_variant_id       uuid references public.ai_twin_variants(id),
  run_status                text not null check (run_status in ('draft','pending','completed','partial','failed','cancelled','expired','invalidated')),
  simulation_engine_version text not null,
  model_version             text not null,
  memory_version            text,
  pattern_version           text,
  seed                      bigint not null check (seed >= 0 and seed <= 2147483647),
  iteration_count           int not null default 1 check (iteration_count between 1 and 100),
  simulation_horizon        int not null check (simulation_horizon between 1 and 30),
  input_hash                text not null,
  input_snapshot            jsonb not null default '{}'::jsonb,
  assumption_snapshot       jsonb not null default '{}'::jsonb,
  constraint_snapshot       jsonb,
  started_at                timestamptz,
  completed_at              timestamptz,
  failure_code              text,
  failure_reason            text,
  output_summary            jsonb,
  confidence_summary        jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  requested_by              uuid,
  created_at                timestamptz not null default now(),
  unique (scenario_id, input_hash)
);
comment on table public.ai_twin_simulation_runs is
  'AI-MUSIC-11 — Simulation Run. Seed 고정 결정적(동일 Input=동일 결과) · production/deployed/live 상태 없음 · 자동 실행 없음.';
create index if not exists idx_simrun_twin on public.ai_twin_simulation_runs (twin_id, created_at desc);
create index if not exists idx_simrun_status on public.ai_twin_simulation_runs (run_status, created_at desc);

create table if not exists public.ai_twin_simulation_results (
  id                  uuid primary key default gen_random_uuid(),
  simulation_run_id   uuid not null references public.ai_twin_simulation_runs(id),
  variant_id          uuid not null references public.ai_twin_variants(id),
  metric_code         text not null,
  metric_type         text not null default 'simulated' check (metric_type in ('simulated','proxy')),
  baseline_value      numeric,
  simulated_value     numeric,
  delta_value         numeric,
  delta_percent       numeric,
  confidence          int check (confidence is null or (confidence between 0 and 100)),
  uncertainty_low     numeric,
  uncertainty_high    numeric,
  sample_size         int check (sample_size is null or sample_size >= 0),
  result_status       text not null default 'available' check (result_status in ('available','provisional','unsupported','insufficient_data','contradicted','invalid')),
  evidence            jsonb not null default '[]'::jsonb,
  assumptions         jsonb,
  limitations         jsonb,
  -- Calibration(실제 Outcome 연결 — 없으면 pending_outcome 유지, Accuracy 계산 없음).
  calibration_status  text not null default 'pending_outcome' check (calibration_status in ('pending_outcome','calibrated','partially_calibrated','invalidated','insufficient_data')),
  actual_outcome_source text,
  actual_outcome_id   text,
  observed_value      numeric,
  absolute_error      numeric,
  relative_error      numeric,
  observed_at         timestamptz,
  created_at          timestamptz not null default now(),
  unique (simulation_run_id, variant_id, metric_code)
);
comment on table public.ai_twin_simulation_results is
  'AI-MUSIC-11 — Simulation Result(simulated/counterfactual — Not Actual Outcome). 실제 Outcome 테이블과 분리 저장.';
create index if not exists idx_simresult_run on public.ai_twin_simulation_results (simulation_run_id, variant_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Simulation Audit(기존 governance event whitelist 무변경 원칙 — 전용 테이블).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_twin_simulation_audit (
  id                uuid primary key default gen_random_uuid(),
  twin_id           uuid references public.ai_digital_twins(id),
  scenario_id       uuid references public.ai_twin_scenarios(id),
  simulation_run_id uuid references public.ai_twin_simulation_runs(id),
  variant_id        uuid references public.ai_twin_variants(id),
  event_type        text not null check (event_type in ('twin_created','twin_superseded','twin_archived','twin_blocked','scenario_created','variant_created','simulation_requested','simulation_completed','simulation_partial','simulation_failed','simulation_cancelled','simulation_invalidated','result_generated','comparison_generated','review_requested','agent_reviewed','governance_checked','calibration_linked')),
  previous_state    text,
  new_state         text,
  actor_id          uuid,
  reason            text,
  evidence          jsonb not null default '[]'::jsonb,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);
comment on table public.ai_twin_simulation_audit is
  'AI-MUSIC-11 — Twin/Scenario/Simulation 상태 전이 Audit(재현 가능한 이력).';
create index if not exists idx_twin_audit on public.ai_twin_simulation_audit (twin_id, created_at desc);
create index if not exists idx_twin_audit_run on public.ai_twin_simulation_audit (simulation_run_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Summary / 목록 / 상세.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_twin_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_twins jsonb; v_runs jsonb; v_cal jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'ready', count(*) filter (where readiness_status = 'ready'),
    'partial', count(*) filter (where readiness_status = 'partially_ready'),
    'stale', count(*) filter (where readiness_status = 'stale'),
    'avg_completeness', round(avg(completeness_score)),
    'avg_freshness', round(avg(freshness_score)),
    'scenarios', (select count(*) from public.ai_twin_scenarios where lifecycle_status = 'active'),
    'variants', (select count(*) from public.ai_twin_variants where lifecycle_status = 'active')
  ) into v_twins from public.ai_digital_twins where lifecycle_status = 'active';
  select jsonb_build_object(
    'completed', count(*) filter (where run_status = 'completed'),
    'partial', count(*) filter (where run_status = 'partial'),
    'failed', count(*) filter (where run_status = 'failed'),
    'last_run_at', max(created_at)
  ) into v_runs from public.ai_twin_simulation_runs;
  select jsonb_build_object(
    'pending_outcome', count(*) filter (where calibration_status = 'pending_outcome'),
    'calibrated', count(*) filter (where calibration_status = 'calibrated')
  ) into v_cal from public.ai_twin_simulation_results;
  return jsonb_build_object('twins', v_twins, 'runs', v_runs, 'calibration', v_cal, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_summary() to authenticated;

create or replace function public.admin_ai_twins(p_twin_type text default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select id, twin_code, twin_type, twin_scope, scope_id, source_type, source_id, source_version, snapshot_at,
           completeness_score, freshness_score, readiness_status, lifecycle_status, limitations, created_at
    from public.ai_digital_twins d
    where (p_twin_type is null or d.twin_type = p_twin_type) and (p_status is null or d.lifecycle_status = p_status)
    order by d.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twins(text, text, int) to authenticated;

create or replace function public.admin_ai_twin_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_digital_twins; v_scenarios jsonb; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_digital_twins where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc), '[]'::jsonb) into v_scenarios from (
    select id, scenario_code, scenario_type, title, simulation_horizon, lifecycle_status, created_at
    from public.ai_twin_scenarios where twin_id = p_id order by created_at desc limit 50) s;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit from (
    select event_type, previous_state, new_state, reason, created_at from public.ai_twin_simulation_audit
    where twin_id = p_id order by created_at desc limit 50) a;
  return jsonb_build_object('found', true, 'twin', to_jsonb(v_row), 'scenarios', v_scenarios, 'audit', v_audit);
end; $$;
grant execute on function public.admin_ai_twin_detail(uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Twin 생성(Eligibility Engine 내장) — 검증 실패 시 저장 거부.
--    Source/Version/Hash/Snapshot Time/Evidence/Idempotency 필수 · 중복 차단 · 불변.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_twin_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_type text := p_payload->>'twin_type'; v_idem text := nullif(p_payload->>'idempotency_key','');
        v_existing public.ai_digital_twins; v_row public.ai_digital_twins; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 131072 then raise exception 'payload too large (128KB limit)' using errcode='22023'; end if;
  if v_type is null or v_type not in ('store','brand','industry','playlist','context') then raise exception 'invalid twin_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'twin_code','') = '' then raise exception 'twin_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'twin_scope','') = '' then raise exception 'twin_scope required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_type','') = '' or coalesce(p_payload->>'source_id','') = '' then raise exception 'source required (존재하지 않는 Entity 복제 금지)' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_hash','') = '' then raise exception 'source_hash required' using errcode='22023'; end if;
  if coalesce(p_payload->>'snapshot_at','') = '' then raise exception 'snapshot_at required' using errcode='22023'; end if;
  if p_payload->'context_snapshot' is null or jsonb_typeof(p_payload->'context_snapshot') <> 'object' then raise exception 'context_snapshot required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if v_idem is null then raise exception 'idempotency_key required' using errcode='22023'; end if;

  select * into v_existing from public.ai_digital_twins where idempotency_key = v_idem;
  if v_existing.id is not null then return jsonb_build_object('eligibility', 'duplicate', 'idempotent', true, 'twin', to_jsonb(v_existing)); end if;

  insert into public.ai_digital_twins(
    twin_code, twin_type, twin_scope, scope_id, source_type, source_id, source_version, source_hash,
    snapshot_at, context_snapshot, policy_snapshot, guardrail_snapshot, playlist_snapshot, track_pool_snapshot,
    outcome_snapshot, quality_snapshot, memory_snapshot_refs, pattern_snapshot_refs, agent_snapshot_refs,
    completeness_score, freshness_score, readiness_status, lifecycle_status, limitations, evidence, idempotency_key, created_by)
  values (
    p_payload->>'twin_code', v_type, p_payload->>'twin_scope', nullif(p_payload->>'scope_id',''),
    p_payload->>'source_type', p_payload->>'source_id', p_payload->>'source_version', p_payload->>'source_hash',
    (p_payload->>'snapshot_at')::timestamptz, p_payload->'context_snapshot', p_payload->'policy_snapshot',
    p_payload->'guardrail_snapshot', p_payload->'playlist_snapshot', p_payload->'track_pool_snapshot',
    p_payload->'outcome_snapshot', p_payload->'quality_snapshot',
    coalesce(p_payload->'memory_snapshot_refs','[]'::jsonb), coalesce(p_payload->'pattern_snapshot_refs','[]'::jsonb), coalesce(p_payload->'agent_snapshot_refs','[]'::jsonb),
    least(100, greatest(0, nullif(p_payload->>'completeness_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'freshness_score','')::int)),
    coalesce(nullif(p_payload->>'readiness_status',''),'partially_ready'), 'active',
    coalesce(p_payload->'limitations','[]'::jsonb), p_payload->'evidence', v_idem, auth.uid())
  returning id into v_id;

  insert into public.ai_twin_simulation_audit(twin_id, event_type, new_state, reason, evidence, actor_id)
  values (v_id, 'twin_created', 'active', p_payload->>'readiness_status', p_payload->'evidence', auth.uid());

  select * into v_row from public.ai_digital_twins where id = v_id;
  return jsonb_build_object('eligibility', coalesce(nullif(p_payload->>'eligibility',''),'eligible'), 'idempotent', false, 'twin', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_twin_create(jsonb) to authenticated;

-- Twin 상태 전이(supersede/archive/block 만 — 삭제/Snapshot 수정 없음).
create or replace function public.admin_ai_twin_set_lifecycle(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_digital_twins; v_prev text;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('superseded','archived','blocked') then raise exception 'invalid lifecycle transition (superseded/archived/blocked only)' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_digital_twins where id = p_id;
  if v_row.id is null then raise exception 'twin not found' using errcode='P0002'; end if;
  v_prev := v_row.lifecycle_status;
  update public.ai_digital_twins set lifecycle_status = p_status where id = p_id returning * into v_row;
  insert into public.ai_twin_simulation_audit(twin_id, event_type, previous_state, new_state, reason, actor_id)
  values (p_id, case p_status when 'superseded' then 'twin_superseded' when 'archived' then 'twin_archived' else 'twin_blocked' end, v_prev, p_status, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_twin_set_lifecycle(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Scenario / Variant 생성 — Baseline 필수 · Horizon<=30 · Variant<=20 · Metric<=12.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_twin_scenario_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_twin public.ai_digital_twins; v_type text := p_payload->>'scenario_type'; v_idem text := nullif(p_payload->>'idempotency_key','');
        v_existing public.ai_twin_scenarios; v_row public.ai_twin_scenarios; v_id uuid; v_horizon int := nullif(p_payload->>'simulation_horizon','')::int;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  select * into v_twin from public.ai_digital_twins where id = (p_payload->>'twin_id')::uuid;
  if v_twin.id is null then raise exception 'twin not found' using errcode='P0002'; end if;
  if v_twin.lifecycle_status <> 'active' then raise exception 'twin not active (superseded/archived twin 에 Scenario 생성 금지)' using errcode='22023'; end if;
  if v_type is null or v_type not in ('playlist_mix','genre_mix','mood_mix','track_ranking','artist_exposure','diversity','freshness','rotation','fatigue','time_slot','weekday','season','rollout','quality_degradation','recovery','policy_change','guardrail_change','strategy_comparison','combined') then raise exception 'invalid scenario_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'title','') = '' then raise exception 'title required' using errcode='22023'; end if;
  if p_payload->'baseline_definition' is null or jsonb_typeof(p_payload->'baseline_definition') <> 'object' then raise exception 'baseline required (Baseline 없는 Scenario 금지)' using errcode='22023'; end if;
  if v_horizon is null or v_horizon < 1 or v_horizon > 30 then raise exception 'simulation_horizon must be 1..30 days' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_payload->'requested_metrics','[]'::jsonb)) = 0 then raise exception 'requested_metrics required' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_payload->'requested_metrics','[]'::jsonb)) > 12 then raise exception 'max 12 metrics per scenario' using errcode='22023'; end if;
  if coalesce(p_payload->>'model_version','') = '' then raise exception 'model_version required' using errcode='22023'; end if;
  if coalesce(p_payload->>'input_hash','') = '' then raise exception 'input_hash required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;

  if v_idem is not null then
    select * into v_existing from public.ai_twin_scenarios where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'scenario', to_jsonb(v_existing)); end if;
  end if;

  insert into public.ai_twin_scenarios(scenario_code, twin_id, scenario_type, title, objective, hypothesis, baseline_definition,
    simulation_horizon, time_granularity, requested_metrics, assumption_snapshot, constraint_snapshot, model_version, input_hash,
    risk_tier, evidence, limitations, idempotency_key, created_by)
  values (p_payload->>'scenario_code', v_twin.id, v_type, p_payload->>'title', nullif(p_payload->>'objective',''), nullif(p_payload->>'hypothesis',''),
    p_payload->'baseline_definition', v_horizon, nullif(p_payload->>'time_granularity',''), p_payload->'requested_metrics',
    coalesce(p_payload->'assumption_snapshot','{}'::jsonb), p_payload->'constraint_snapshot', p_payload->>'model_version', p_payload->>'input_hash',
    nullif(p_payload->>'risk_tier',''), p_payload->'evidence', coalesce(p_payload->'limitations','[]'::jsonb), v_idem, auth.uid())
  returning id into v_id;

  insert into public.ai_twin_simulation_audit(twin_id, scenario_id, event_type, new_state, evidence, actor_id)
  values (v_twin.id, v_id, 'scenario_created', 'active', p_payload->'evidence', auth.uid());

  select * into v_row from public.ai_twin_scenarios where id = v_id;
  return jsonb_build_object('idempotent', false, 'scenario', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_twin_scenario_create(jsonb) to authenticated;

create or replace function public.admin_ai_twin_scenarios(p_twin_id uuid default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_twin_scenarios s where (p_twin_id is null or s.twin_id = p_twin_id)
    order by s.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_scenarios(uuid, int) to authenticated;

create or replace function public.admin_ai_twin_variant_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_scenario public.ai_twin_scenarios; v_count int; v_row public.ai_twin_variants; v_id uuid;
        v_is_baseline boolean := coalesce((p_payload->>'is_baseline')::boolean, false);
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  select * into v_scenario from public.ai_twin_scenarios where id = (p_payload->>'scenario_id')::uuid;
  if v_scenario.id is null then raise exception 'scenario not found' using errcode='P0002'; end if;
  if coalesce(p_payload->>'variant_code','') = '' or coalesce(p_payload->>'variant_name','') = '' then raise exception 'variant_code/name required' using errcode='22023'; end if;
  if coalesce(p_payload->>'input_hash','') = '' then raise exception 'input_hash required' using errcode='22023'; end if;
  select count(*) into v_count from public.ai_twin_variants where scenario_id = v_scenario.id and lifecycle_status = 'active';
  if v_count >= 20 then raise exception 'max 20 variants per scenario' using errcode='22023'; end if;
  if v_is_baseline and exists (select 1 from public.ai_twin_variants where scenario_id = v_scenario.id and is_baseline) then
    raise exception 'baseline variant already exists (Baseline 정확히 1개)' using errcode='22023';
  end if;
  if exists (select 1 from public.ai_twin_variants where scenario_id = v_scenario.id and input_hash = p_payload->>'input_hash') then
    select * into v_row from public.ai_twin_variants where scenario_id = v_scenario.id and input_hash = p_payload->>'input_hash';
    return jsonb_build_object('idempotent', true, 'variant', to_jsonb(v_row));
  end if;

  insert into public.ai_twin_variants(scenario_id, variant_code, variant_name, variant_definition, changed_dimensions,
    expected_direction, assumption_snapshot, input_hash, is_baseline)
  values (v_scenario.id, p_payload->>'variant_code', p_payload->>'variant_name', coalesce(p_payload->'variant_definition','{}'::jsonb),
    coalesce(p_payload->'changed_dimensions','[]'::jsonb), nullif(p_payload->>'expected_direction',''),
    coalesce(p_payload->'assumption_snapshot','{}'::jsonb), p_payload->>'input_hash', v_is_baseline)
  returning id into v_id;

  insert into public.ai_twin_simulation_audit(twin_id, scenario_id, variant_id, event_type, new_state, actor_id)
  values (v_scenario.twin_id, v_scenario.id, v_id, 'variant_created', 'active', auth.uid());

  select * into v_row from public.ai_twin_variants where id = v_id;
  return jsonb_build_object('idempotent', false, 'variant', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_twin_variant_create(jsonb) to authenticated;

create or replace function public.admin_ai_twin_variants(p_scenario_id uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,50), 100)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.is_baseline desc, t.created_at asc), '[]'::jsonb) into v_items from (
    select * from public.ai_twin_variants v where v.scenario_id = p_scenario_id order by v.is_baseline desc, v.created_at asc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_variants(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Simulation Run 저장 — 클라이언트 결정적(Seeded) 계산 결과의 불변 기록.
--    결과는 simulated(Not Actual). 실제 Outcome 저장/Production 반영 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_twin_simulation_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_scenario public.ai_twin_scenarios; v_status text := p_payload->>'run_status'; v_seed bigint := nullif(p_payload->>'seed','')::bigint;
        v_existing public.ai_twin_simulation_runs; v_run public.ai_twin_simulation_runs; v_id uuid; v_r jsonb; v_cnt int := 0;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 262144 then raise exception 'payload too large (256KB limit)' using errcode='22023'; end if;
  select * into v_scenario from public.ai_twin_scenarios where id = (p_payload->>'scenario_id')::uuid;
  if v_scenario.id is null then raise exception 'scenario not found' using errcode='P0002'; end if;
  if v_status is null or v_status not in ('completed','partial','failed','cancelled') then raise exception 'invalid run_status (production/live 상태 금지)' using errcode='22023'; end if;
  if v_seed is null or v_seed < 0 or v_seed > 2147483647 then raise exception 'seed required (0..2^31-1, 고정 Seed 없는 Simulation 금지)' using errcode='22023'; end if;
  if coalesce(p_payload->>'simulation_engine_version','') = '' or coalesce(p_payload->>'model_version','') = '' then raise exception 'engine/model version required' using errcode='22023'; end if;
  if coalesce(p_payload->>'input_hash','') = '' then raise exception 'input_hash required' using errcode='22023'; end if;
  if p_payload->'input_snapshot' is null or jsonb_typeof(p_payload->'input_snapshot') <> 'object' then raise exception 'input_snapshot required' using errcode='22023'; end if;
  if jsonb_array_length(coalesce(p_payload->'results','[]'::jsonb)) > 200 then raise exception 'max 200 result rows per run' using errcode='22023'; end if;

  select * into v_existing from public.ai_twin_simulation_runs where scenario_id = v_scenario.id and input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'run', to_jsonb(v_existing)); end if;

  insert into public.ai_twin_simulation_runs(run_code, twin_id, scenario_id, baseline_variant_id, run_status,
    simulation_engine_version, model_version, memory_version, pattern_version, seed, iteration_count, simulation_horizon,
    input_hash, input_snapshot, assumption_snapshot, constraint_snapshot, started_at, completed_at, failure_code, failure_reason,
    output_summary, confidence_summary, limitations, requested_by)
  values (p_payload->>'run_code', v_scenario.twin_id, v_scenario.id, nullif(p_payload->>'baseline_variant_id','')::uuid, v_status,
    p_payload->>'simulation_engine_version', p_payload->>'model_version', nullif(p_payload->>'memory_version',''), nullif(p_payload->>'pattern_version',''),
    v_seed, least(100, greatest(1, coalesce(nullif(p_payload->>'iteration_count','')::int, 1))), least(30, greatest(1, coalesce(nullif(p_payload->>'simulation_horizon','')::int, v_scenario.simulation_horizon))),
    p_payload->>'input_hash', p_payload->'input_snapshot', coalesce(p_payload->'assumption_snapshot','{}'::jsonb), p_payload->'constraint_snapshot',
    nullif(p_payload->>'started_at','')::timestamptz, nullif(p_payload->>'completed_at','')::timestamptz,
    nullif(p_payload->>'failure_code',''), nullif(p_payload->>'failure_reason',''),
    p_payload->'output_summary', p_payload->'confidence_summary', coalesce(p_payload->'limitations','[]'::jsonb), auth.uid())
  returning id into v_id;

  -- Result rows(simulated — Not Actual Outcome).
  for v_r in select * from jsonb_array_elements(coalesce(p_payload->'results','[]'::jsonb)) loop
    if coalesce(v_r->>'metric_code','') = '' or coalesce(v_r->>'variant_id','') = '' then continue; end if;
    insert into public.ai_twin_simulation_results(simulation_run_id, variant_id, metric_code, metric_type,
      baseline_value, simulated_value, delta_value, delta_percent, confidence, uncertainty_low, uncertainty_high,
      sample_size, result_status, evidence, assumptions, limitations)
    values (v_id, (v_r->>'variant_id')::uuid, v_r->>'metric_code', coalesce(nullif(v_r->>'metric_type',''),'simulated'),
      nullif(v_r->>'baseline_value','')::numeric, nullif(v_r->>'simulated_value','')::numeric,
      nullif(v_r->>'delta_value','')::numeric, nullif(v_r->>'delta_percent','')::numeric,
      least(100, greatest(0, nullif(v_r->>'confidence','')::int)),
      nullif(v_r->>'uncertainty_low','')::numeric, nullif(v_r->>'uncertainty_high','')::numeric,
      greatest(0, nullif(v_r->>'sample_size','')::int),
      coalesce(nullif(v_r->>'result_status',''),'available'), coalesce(v_r->'evidence','[]'::jsonb), v_r->'assumptions', v_r->'limitations')
    on conflict (simulation_run_id, variant_id, metric_code) do nothing;
    v_cnt := v_cnt + 1;
  end loop;

  insert into public.ai_twin_simulation_audit(twin_id, scenario_id, simulation_run_id, event_type, new_state, reason, evidence, actor_id)
  values (v_scenario.twin_id, v_scenario.id, v_id,
    case v_status when 'completed' then 'simulation_completed' when 'partial' then 'simulation_partial'
                  when 'failed' then 'simulation_failed' else 'simulation_cancelled' end,
    v_status, format('%s results (simulated, not actual)', v_cnt), coalesce(p_payload->'evidence','[]'::jsonb), auth.uid());

  select * into v_run from public.ai_twin_simulation_runs where id = v_id;
  return jsonb_build_object('idempotent', false, 'run', to_jsonb(v_run), 'result_count', v_cnt);
end; $$;
grant execute on function public.admin_ai_twin_simulation_save(jsonb) to authenticated;

create or replace function public.admin_ai_twin_simulation_runs(p_twin_id uuid default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_twin_simulation_runs r
    where (p_twin_id is null or r.twin_id = p_twin_id) and (p_status is null or r.run_status = p_status)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_simulation_runs(uuid, text, int) to authenticated;

create or replace function public.admin_ai_twin_simulation_results(p_run_id uuid, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.metric_code, t.variant_id), '[]'::jsonb) into v_items from (
    select * from public.ai_twin_simulation_results r where r.simulation_run_id = p_run_id
    order by r.metric_code, r.variant_id limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'note', 'simulated / counterfactual — not actual outcome', 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_simulation_results(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Calibration 연결 — 실제 Outcome 이 실존할 때만(없으면 pending_outcome 유지).
--    Accuracy 를 임의 생성하지 않는다(observed 필수, 0 나눗셈 방어).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_twin_calibration_link(p_result_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_twin_simulation_results; v_observed numeric := nullif(p_payload->>'observed_value','')::numeric;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'actual_outcome_source','') = '' or coalesce(p_payload->>'actual_outcome_id','') = '' then
    raise exception 'actual outcome source required (실제 Outcome 없는 Calibration 금지)' using errcode='22023';
  end if;
  if v_observed is null then raise exception 'observed_value required' using errcode='22023'; end if;
  select * into v_row from public.ai_twin_simulation_results where id = p_result_id;
  if v_row.id is null then raise exception 'result not found' using errcode='P0002'; end if;
  update public.ai_twin_simulation_results set
    calibration_status = 'calibrated',
    actual_outcome_source = p_payload->>'actual_outcome_source',
    actual_outcome_id = p_payload->>'actual_outcome_id',
    observed_value = v_observed,
    absolute_error = case when simulated_value is not null then abs(simulated_value - v_observed) end,
    relative_error = case when simulated_value is not null and v_observed <> 0 then round(abs(simulated_value - v_observed) / abs(v_observed) * 100, 2) end,
    observed_at = coalesce(nullif(p_payload->>'observed_at','')::timestamptz, now())
  where id = p_result_id returning * into v_row;
  insert into public.ai_twin_simulation_audit(simulation_run_id, variant_id, event_type, new_state, reason, actor_id)
  values (v_row.simulation_run_id, v_row.variant_id, 'calibration_linked', 'calibrated', p_payload->>'actual_outcome_source', auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_twin_calibration_link(uuid, jsonb) to authenticated;

create or replace function public.admin_ai_twin_audit(p_twin_id uuid default null, p_run_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_twin_simulation_audit a
    where (p_twin_id is null or a.twin_id = p_twin_id) and (p_run_id is null or a.simulation_run_id = p_run_id)
    order by a.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_twin_audit(uuid, uuid, int) to authenticated;
