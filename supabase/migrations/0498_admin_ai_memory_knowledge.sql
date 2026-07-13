-- ============================================
-- 0498_admin_ai_memory_knowledge.sql
--
-- Phase AI-MUSIC-10 — Long-Term Memory, Knowledge Graph & Pattern Intelligence Engine.
--
-- AI 가 매번 현재 Snapshot 만 보고 판단하는 수준을 넘어, 과거 실제 운영 경험을 구조화된
-- Memory 로 보존 → 검색(Retrieval) → 패턴 발견(Pattern Discovery) → Experience Replay →
-- Multi-Agent Evidence 로 제공하는 Memory Intelligence Layer.
--
--   Operational Outcome → Eligibility → Episodic/Semantic Memory → Knowledge Graph
--   → Quality/Freshness → Retrieval → Pattern → Replay → Agent Evidence → Governance
--
-- ⚠️ 절대: Memory/Graph/Pattern 은 Evidence 계층일 뿐 — Production Playlist/Rotation/
--   Scheduler/Queue/Playback/Rollout/Experiment/Strategy/Draft/Candidate/Trust/Constitution
--   을 직접 수정·실행하지 않는다. 자동 삭제 없음(상태 기반 Aging). Trigger 없음.
--
-- 재사용: 기존 Snapshot/Outcome(context_learning_snapshots·prediction_snapshots·
--   strategy_snapshots·sandbox·promotion·governance·collaboration)은 Memory Source 로
--   참조만 한다(복제 금지 — 이중 진실 공급원 방지). Agent Memory 는 0497 RPC 재사용.
--   ai_governance_events.event_type CHECK 가 memory 이벤트를 포함하지 않아(기존 정의
--   무변경 원칙) 전용 ai_memory_audit 를 신설한다.
--
-- 절대 조건: SECURITY DEFINER + search_path 고정 · _admin_growth_guard() · Evidence 필수 ·
--   source_version/input_hash 필수 · Outcome 없는 성공 Memory 금지 · 중복/Idempotency ·
--   whitelist(type/scope/status/relation/pattern) · 0~100 clamp · NaN 금지 · JSON size 제한 ·
--   Self Edge 차단 · validated Pattern sample 기준 · 자동 삭제/자동 실행/Production UPDATE 없음.
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Long-Term Memory 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_memory_records (
  id                     uuid primary key default gen_random_uuid(),
  memory_type            text not null check (memory_type in ('episodic','semantic','procedural','negative','observation')),
  memory_scope           text not null check (memory_scope in ('global','industry','brand','store','playlist','track','artist','context','strategy','agent')),
  scope_id               text,
  agent_code             text check (agent_code is null or agent_code in ('context','prediction','playlist','ranking','rotation','quality','revenue','governance')),
  source_type            text not null,
  source_id              text not null,
  source_version         text not null,
  input_hash             text not null,
  context_key            text,
  context_snapshot       jsonb not null default '{}'::jsonb,
  subject_type           text,
  subject_id             text,
  action_type            text,
  action_snapshot        jsonb,
  outcome_status         text not null check (outcome_status in ('improved','neutral','degraded','pending_outcome','observation_only')),
  outcome_snapshot       jsonb,
  evidence               jsonb not null default '[]'::jsonb,
  sample_size            int check (sample_size is null or sample_size >= 0),
  confidence             int check (confidence is null or (confidence between 0 and 100)),
  freshness_score        int check (freshness_score is null or (freshness_score between 0 and 100)),
  quality_score          int check (quality_score is null or (quality_score between 0 and 100)),
  lifecycle_status       text not null default 'candidate' check (lifecycle_status in ('candidate','active','provisional','stale','contradicted','superseded','archived','blocked')),
  seasonal_tag           text,
  recurrence_count       int not null default 0,
  contradiction_count    int not null default 0,
  occurred_at            timestamptz not null,
  observation_started_at timestamptz,
  observation_ended_at   timestamptz,
  last_reinforced_at     timestamptz,
  created_by             uuid,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
comment on table public.ai_memory_records is
  'AI-MUSIC-10 — Long-Term Memory. 실제 운영 Outcome 기반 경험 기록(Evidence 계층). 자동 삭제/자동 실행/Production 반영 없음.';
create unique index if not exists uq_memory_hash on public.ai_memory_records (memory_type, input_hash);
create index if not exists idx_memory_scope on public.ai_memory_records (memory_scope, scope_id, created_at desc);
create index if not exists idx_memory_type on public.ai_memory_records (memory_type, lifecycle_status, created_at desc);
create index if not exists idx_memory_ctx on public.ai_memory_records (context_key, occurred_at desc);
create index if not exists idx_memory_agent on public.ai_memory_records (agent_code, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Memory Audit(별도 테이블 — 기존 governance event_type CHECK 무변경 원칙).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_memory_audit (
  id             uuid primary key default gen_random_uuid(),
  memory_id      uuid references public.ai_memory_records(id),
  event_type     text not null check (event_type in ('candidate_created','eligibility_checked','activated','reinforced','contradicted','marked_stale','superseded','archived','blocked','retrieval_used','replay_used','pattern_derived','status_changed')),
  previous_state text,
  new_state      text,
  reason         text,
  evidence       jsonb not null default '[]'::jsonb,
  actor_id       uuid,
  source_type    text,
  source_id      text,
  created_at     timestamptz not null default now()
);
comment on table public.ai_memory_audit is
  'AI-MUSIC-10 — Memory 상태 변화 Audit(생성/강화/모순/상태 전이/사용). 재현 가능한 이력.';
create index if not exists idx_memory_audit on public.ai_memory_audit (memory_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Knowledge Graph(운영 테이블 복제 없이 관계 지식만 — 이중 진실 공급원 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_knowledge_nodes (
  id             uuid primary key default gen_random_uuid(),
  node_type      text not null check (node_type in ('track','artist','genre','mood','playlist','store','industry','context','time_slot','weekday','season','strategy','sandbox_run','draft','rollout','experiment','prediction','outcome','governance_event','agent','memory','pattern','guardrail')),
  entity_id      text,
  canonical_key  text not null unique,
  label          text not null,
  properties     jsonb not null default '{}'::jsonb,
  source_version text not null,
  is_active      boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
comment on table public.ai_knowledge_nodes is
  'AI-MUSIC-10 — Knowledge Node. 기존 Entity 참조(entity_id) — 운영 데이터 복제 없음.';
create index if not exists idx_kn_node_type on public.ai_knowledge_nodes (node_type, is_active);

create table if not exists public.ai_knowledge_edges (
  id               uuid primary key default gen_random_uuid(),
  from_node_id     uuid not null references public.ai_knowledge_nodes(id),
  to_node_id       uuid not null references public.ai_knowledge_nodes(id),
  relation_type    text not null check (relation_type in ('belongs_to','contains','associated_with','played_in','preferred_by','rejected_by','succeeds_in','underperforms_in','suitable_for','unsuitable_for','improves','reduces','increases','conflicts_with','derived_from','predicted_by','validated_by','governed_by','approved_by','rejected_by_human','reinforced_by','contradicted_by','supersedes','similar_to','follows','precedes','exposed_in','rolled_out_to','tested_in','affected_by','restricted_by')),
  scope            text,
  context_key      text,
  weight           numeric check (weight is null or (weight >= 0 and weight <= 1000000)),
  confidence       int check (confidence is null or (confidence between 0 and 100)),
  sample_size      int check (sample_size is null or sample_size >= 0),
  evidence         jsonb not null default '[]'::jsonb,
  valid_from       timestamptz,
  valid_to         timestamptz,
  lifecycle_status text not null default 'active' check (lifecycle_status in ('active','stale','contradicted','superseded','archived')),
  source_version   text not null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  check (from_node_id <> to_node_id),
  check (valid_from is null or valid_to is null or valid_from <= valid_to)
);
comment on table public.ai_knowledge_edges is
  'AI-MUSIC-10 — Knowledge Edge. Evidence 필수 · 동시 등장≠인과(associated_with 구분) · Self Edge 금지.';
create unique index if not exists uq_kn_edge on public.ai_knowledge_edges (from_node_id, to_node_id, relation_type, coalesce(context_key,''));
create index if not exists idx_kn_edge_from on public.ai_knowledge_edges (from_node_id, relation_type);
create index if not exists idx_kn_edge_to on public.ai_knowledge_edges (to_node_id, relation_type);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Pattern 저장소(관찰 상관관계 — 인과 아님 · 자동 운영 명령 아님).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_discovered_patterns (
  id                  uuid primary key default gen_random_uuid(),
  pattern_code        text not null unique,
  pattern_type        text not null check (pattern_type in ('context_performance','seasonal','time_of_day','weekday','industry','store','genre','mood','energy','track_lifecycle','playlist_diversity','rotation_fatigue','skip','completion','reaction','quality_regression','roi','governance_violation','human_override','agent_conflict','consensus_accuracy')),
  scope               text not null check (scope in ('global','industry','brand','store','playlist','track','artist','context','strategy','agent')),
  scope_id            text,
  context_definition  jsonb not null default '{}'::jsonb,
  subject_definition  jsonb not null default '{}'::jsonb,
  outcome_definition  jsonb not null default '{}'::jsonb,
  direction           text check (direction is null or direction in ('positive','negative','neutral','mixed')),
  effect_size         numeric check (effect_size is null or (effect_size >= -1000000 and effect_size <= 1000000)),
  confidence          int check (confidence is null or (confidence between 0 and 100)),
  sample_size         int check (sample_size is null or sample_size >= 0),
  support_count       int not null default 0,
  contradiction_count int not null default 0,
  quality_score       int check (quality_score is null or (quality_score between 0 and 100)),
  status              text not null default 'hypothesis' check (status in ('hypothesis','emerging','provisional','validated','contradicted','deprecated','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  source_period_start timestamptz,
  source_period_end   timestamptz,
  first_detected_at   timestamptz not null default now(),
  last_detected_at    timestamptz not null default now(),
  last_validated_at   timestamptz,
  source_version      text not null,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (source_period_start is null or source_period_end is null or source_period_start <= source_period_end)
);
comment on table public.ai_discovered_patterns is
  'AI-MUSIC-10 — Pattern Discovery. 관찰된 상관관계(인과 아님). validated 는 실제 Outcome+Sample 기준 충족 시만.';
create index if not exists idx_pattern_type on public.ai_discovered_patterns (pattern_type, status, last_detected_at desc);
create index if not exists idx_pattern_scope on public.ai_discovered_patterns (scope, scope_id);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Memory 요약(Overview) — 기존 Snapshot Source 카운트 포함(참조만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_mem jsonb; v_graph jsonb; v_pat jsonb; v_src jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where lifecycle_status = 'active'),
    'candidate', count(*) filter (where lifecycle_status = 'candidate'),
    'provisional', count(*) filter (where lifecycle_status = 'provisional'),
    'stale', count(*) filter (where lifecycle_status = 'stale'),
    'contradicted', count(*) filter (where lifecycle_status = 'contradicted'),
    'high_quality', count(*) filter (where quality_score >= 70),
    'with_outcome', count(*) filter (where outcome_status in ('improved','neutral','degraded')),
    'pending_outcome', count(*) filter (where outcome_status = 'pending_outcome'),
    'negative', count(*) filter (where memory_type = 'negative'),
    'seasonal', count(*) filter (where seasonal_tag is not null),
    'last_event_at', max(created_at)
  ) into v_mem from public.ai_memory_records;
  select jsonb_build_object(
    'nodes', (select count(*) from public.ai_knowledge_nodes where is_active),
    'edges', (select count(*) from public.ai_knowledge_edges where lifecycle_status = 'active')
  ) into v_graph;
  select jsonb_build_object(
    'total', count(*),
    'validated', count(*) filter (where status = 'validated'),
    'emerging', count(*) filter (where status = 'emerging'),
    'hypothesis', count(*) filter (where status = 'hypothesis'),
    'contradicted', count(*) filter (where status = 'contradicted')
  ) into v_pat from public.ai_discovered_patterns;
  -- Memory Source(기존 Snapshot/Outcome — 참조 카운트만, 복제 없음).
  select jsonb_build_object(
    'context_learning_snapshots', (select count(*) from public.context_learning_snapshots),
    'context_recommendation_outcomes', (select count(*) from public.context_recommendation_outcomes),
    'prediction_snapshots', (select count(*) from public.prediction_snapshots),
    'strategy_snapshots', (select count(*) from public.strategy_snapshots),
    'sandbox_runs', (select count(*) from public.strategy_sandbox_runs),
    'promotion_drafts', (select count(*) from public.strategy_promotion_drafts),
    'governance_events', (select count(*) from public.ai_governance_events),
    'collaborations', (select count(*) from public.ai_agent_collaboration)
  ) into v_src;
  return jsonb_build_object('memory', v_mem, 'graph', v_graph, 'patterns', v_pat, 'sources', v_src, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_memory_summary() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Memory 목록/상세/이력 — 필터 + limit clamp. blocked 는 기본 제외(명시 조회만).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_records(
  p_memory_type text default null, p_scope text default null, p_agent_code text default null,
  p_status text default null, p_context_key text default null, p_outcome text default null,
  p_include_blocked boolean default false, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.occurred_at desc, t.id asc), '[]'::jsonb) into v_items from (
    select * from public.ai_memory_records m
    where (p_memory_type is null or m.memory_type = p_memory_type)
      and (p_scope is null or m.memory_scope = p_scope)
      and (p_agent_code is null or m.agent_code = p_agent_code)
      and (p_status is null or m.lifecycle_status = p_status)
      and (p_context_key is null or m.context_key = p_context_key)
      and (p_outcome is null or m.outcome_status = p_outcome)
      and (p_include_blocked or m.lifecycle_status <> 'blocked')
    order by m.occurred_at desc, m.id asc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_memory_records(text, text, text, text, text, text, boolean, int) to authenticated;

create or replace function public.admin_ai_memory_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_memory_records; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_memory_records where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(a) order by a.created_at desc), '[]'::jsonb) into v_audit from (
    select * from public.ai_memory_audit where memory_id = p_id order by created_at desc limit 100
  ) a;
  return jsonb_build_object('found', true, 'memory', to_jsonb(v_row), 'audit', v_audit);
end; $$;
grant execute on function public.admin_ai_memory_detail(uuid) to authenticated;

create or replace function public.admin_ai_memory_audit_log(p_memory_id uuid default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_memory_audit a where (p_memory_id is null or a.memory_id = p_memory_id)
    order by a.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_memory_audit_log(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Memory 후보 저장 — Eligibility Engine(검증 실패 시 저장 거부).
--    Source/Version/Hash/Context/Evidence/Outcome 상태 필수 · 중복 시 기존 반환(idempotent) ·
--    Outcome 없는 improved 금지 · semantic 은 최소 Sample · JSON size 제한.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_create_candidate(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_type text := p_payload->>'memory_type'; v_scope text := p_payload->>'memory_scope';
  v_outcome text := p_payload->>'outcome_status'; v_hash text := nullif(p_payload->>'input_hash','');
  v_sample int := nullif(p_payload->>'sample_size','')::int;
  v_existing public.ai_memory_records; v_row public.ai_memory_records; v_id uuid;
  v_lifecycle text; v_eligibility text;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if v_type is null or v_type not in ('episodic','semantic','procedural','negative','observation') then raise exception 'invalid memory_type' using errcode='22023'; end if;
  if v_scope is null or v_scope not in ('global','industry','brand','store','playlist','track','artist','context','strategy','agent') then raise exception 'invalid memory_scope' using errcode='22023'; end if;
  if v_scope <> 'global' and coalesce(p_payload->>'scope_id','') = '' then raise exception 'scope_id required for non-global scope' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_type','') = '' or coalesce(p_payload->>'source_id','') = '' then raise exception 'source_type/source_id required (실존 운영 Source 없는 Memory 금지)' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;
  if v_hash is null then raise exception 'input_hash required (장기 Memory 승격 조건)' using errcode='22023'; end if;
  if p_payload->'context_snapshot' is null or jsonb_typeof(p_payload->'context_snapshot') <> 'object' then raise exception 'context_snapshot required' using errcode='22023'; end if;
  if coalesce(p_payload->>'occurred_at','') = '' then raise exception 'occurred_at required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required (Evidence 없는 Memory 금지)' using errcode='22023'; end if;
  if v_outcome is null or v_outcome not in ('improved','neutral','degraded','pending_outcome','observation_only') then raise exception 'invalid outcome_status' using errcode='22023'; end if;
  if v_outcome = 'improved' and (p_payload->'outcome_snapshot' is null or jsonb_typeof(p_payload->'outcome_snapshot') <> 'object') then
    raise exception 'outcome_snapshot required for improved (Outcome 없는 성공 Memory 금지)' using errcode='22023';
  end if;
  if v_type = 'semantic' and coalesce(v_sample, 0) < 10 then
    raise exception 'semantic memory requires sample_size >= 10 (단일 사건 일반화 금지)' using errcode='22023';
  end if;

  -- Duplicate → 기존 반환(idempotent · 동일 사건 중복 Memory 금지).
  select * into v_existing from public.ai_memory_records where memory_type = v_type and input_hash = v_hash;
  if v_existing.id is not null then
    return jsonb_build_object('eligibility', 'duplicate', 'idempotent', true, 'memory', to_jsonb(v_existing));
  end if;

  v_eligibility := case when v_outcome = 'pending_outcome' then 'pending_outcome'
                        when v_outcome = 'observation_only' then 'observation_only'
                        when coalesce(v_sample, 0) = 0 then 'insufficient_data'
                        else 'eligible' end;
  v_lifecycle := case v_eligibility when 'eligible' then 'active'
                                    when 'insufficient_data' then 'provisional'
                                    else 'candidate' end;

  insert into public.ai_memory_records(
    memory_type, memory_scope, scope_id, agent_code, source_type, source_id, source_version, input_hash,
    context_key, context_snapshot, subject_type, subject_id, action_type, action_snapshot,
    outcome_status, outcome_snapshot, evidence, sample_size, confidence, freshness_score, quality_score,
    lifecycle_status, seasonal_tag, occurred_at, observation_started_at, observation_ended_at, created_by)
  values (
    v_type, v_scope, nullif(p_payload->>'scope_id',''), nullif(p_payload->>'agent_code',''),
    p_payload->>'source_type', p_payload->>'source_id', p_payload->>'source_version', v_hash,
    nullif(p_payload->>'context_key',''), p_payload->'context_snapshot',
    nullif(p_payload->>'subject_type',''), nullif(p_payload->>'subject_id',''),
    nullif(p_payload->>'action_type',''), p_payload->'action_snapshot',
    v_outcome, p_payload->'outcome_snapshot', p_payload->'evidence', v_sample,
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    least(100, greatest(0, nullif(p_payload->>'freshness_score','')::int)),
    least(100, greatest(0, nullif(p_payload->>'quality_score','')::int)),
    v_lifecycle, nullif(p_payload->>'seasonal_tag',''), (p_payload->>'occurred_at')::timestamptz,
    nullif(p_payload->>'observation_started_at','')::timestamptz, nullif(p_payload->>'observation_ended_at','')::timestamptz, auth.uid())
  returning id into v_id;

  insert into public.ai_memory_audit(memory_id, event_type, new_state, reason, evidence, actor_id, source_type, source_id)
  values (v_id, 'candidate_created', v_lifecycle, v_eligibility, p_payload->'evidence', auth.uid(), p_payload->>'source_type', p_payload->>'source_id');

  select * into v_row from public.ai_memory_records where id = v_id;
  return jsonb_build_object('eligibility', v_eligibility, 'idempotent', false, 'memory', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_memory_create_candidate(jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Memory 상태 전이(자동 삭제 없음 — 상태 기반 Aging). 사유 필수 · Audit 기록.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_memory_records; v_prev text;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('active','provisional','stale','contradicted','superseded','archived','blocked') then raise exception 'invalid lifecycle_status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_memory_records where id = p_id;
  if v_row.id is null then raise exception 'memory not found' using errcode='P0002'; end if;
  v_prev := v_row.lifecycle_status;
  update public.ai_memory_records set lifecycle_status = p_status, updated_at = now() where id = p_id returning * into v_row;
  insert into public.ai_memory_audit(memory_id, event_type, previous_state, new_state, reason, actor_id)
  values (p_id, case p_status when 'active' then 'activated' when 'stale' then 'marked_stale' when 'superseded' then 'superseded'
                              when 'archived' then 'archived' when 'blocked' then 'blocked' else 'status_changed' end,
          v_prev, p_status, p_reason, auth.uid());
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_memory_set_status(uuid, text, text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Reinforcement / Contradiction — 원본 덮어쓰기 없음(카운터+Audit 로 재현 가능).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_reinforce(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_memory_records;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'source_type','') = '' or coalesce(p_payload->>'source_id','') = '' then raise exception 'reinforcement source required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  select * into v_row from public.ai_memory_records where id = p_id;
  if v_row.id is null then raise exception 'memory not found' using errcode='P0002'; end if;
  update public.ai_memory_records set
    recurrence_count = recurrence_count + 1,
    last_reinforced_at = now(),
    confidence = coalesce(least(100, greatest(0, nullif(p_payload->>'new_confidence','')::int)), confidence),
    quality_score = coalesce(least(100, greatest(0, nullif(p_payload->>'new_quality','')::int)), quality_score),
    freshness_score = coalesce(least(100, greatest(0, nullif(p_payload->>'new_freshness','')::int)), freshness_score),
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_memory_audit(memory_id, event_type, previous_state, new_state, reason, evidence, actor_id, source_type, source_id)
  values (p_id, 'reinforced', null, null, nullif(p_payload->>'reason',''), p_payload->'evidence', auth.uid(), p_payload->>'source_type', p_payload->>'source_id');
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_memory_reinforce(uuid, jsonb) to authenticated;

create or replace function public.admin_ai_memory_contradict(p_id uuid, p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_memory_records; v_level text := p_payload->>'level';
begin
  perform public._admin_growth_guard();
  if v_level is null or v_level not in ('weak_contradiction','meaningful_contradiction','strong_contradiction','unresolved_conflict') then raise exception 'invalid contradiction level' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  select * into v_row from public.ai_memory_records where id = p_id;
  if v_row.id is null then raise exception 'memory not found' using errcode='P0002'; end if;
  update public.ai_memory_records set
    contradiction_count = contradiction_count + 1,
    -- strong/unresolved 만 lifecycle 전이(삭제 아님 — 추적 가능 상태 유지).
    lifecycle_status = case when v_level in ('strong_contradiction','unresolved_conflict') then 'contradicted' else lifecycle_status end,
    updated_at = now()
  where id = p_id returning * into v_row;
  insert into public.ai_memory_audit(memory_id, event_type, previous_state, new_state, reason, evidence, actor_id, source_type, source_id)
  values (p_id, 'contradicted', null, v_level, nullif(p_payload->>'reason',''), p_payload->'evidence', auth.uid(), nullif(p_payload->>'source_type',''), nullif(p_payload->>'source_id',''));
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_memory_contradict(uuid, jsonb) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) Knowledge Graph 저장/조회 — Evidence 필수 · Self Edge/중복/미존재 Node 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_knowledge_node_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_knowledge_nodes; v_key text := nullif(p_payload->>'canonical_key','');
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'node_type','') not in ('track','artist','genre','mood','playlist','store','industry','context','time_slot','weekday','season','strategy','sandbox_run','draft','rollout','experiment','prediction','outcome','governance_event','agent','memory','pattern','guardrail') then raise exception 'invalid node_type' using errcode='22023'; end if;
  if v_key is null then raise exception 'canonical_key required' using errcode='22023'; end if;
  if coalesce(p_payload->>'label','') = '' then raise exception 'label required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;
  insert into public.ai_knowledge_nodes(node_type, entity_id, canonical_key, label, properties, source_version)
  values (p_payload->>'node_type', nullif(p_payload->>'entity_id',''), v_key, p_payload->>'label', coalesce(p_payload->'properties','{}'::jsonb), p_payload->>'source_version')
  on conflict (canonical_key) do update set label = excluded.label, properties = excluded.properties, updated_at = now()
  returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_knowledge_node_save(jsonb) to authenticated;

create or replace function public.admin_ai_knowledge_edge_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_from uuid := (p_payload->>'from_node_id')::uuid; v_to uuid := (p_payload->>'to_node_id')::uuid; v_rel text := p_payload->>'relation_type'; v_row public.ai_knowledge_edges; v_existing public.ai_knowledge_edges;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if v_from is null or v_to is null then raise exception 'from/to node required' using errcode='22023'; end if;
  if v_from = v_to then raise exception 'self edge not allowed' using errcode='22023'; end if;
  if v_rel is null or v_rel not in ('belongs_to','contains','associated_with','played_in','preferred_by','rejected_by','succeeds_in','underperforms_in','suitable_for','unsuitable_for','improves','reduces','increases','conflicts_with','derived_from','predicted_by','validated_by','governed_by','approved_by','rejected_by_human','reinforced_by','contradicted_by','supersedes','similar_to','follows','precedes','exposed_in','rolled_out_to','tested_in','affected_by','restricted_by') then raise exception 'invalid relation_type' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required (근거 없는 Edge 금지 — 동시 등장≠인과)' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;
  if not exists (select 1 from public.ai_knowledge_nodes where id = v_from) then raise exception 'from node not found' using errcode='P0002'; end if;
  if not exists (select 1 from public.ai_knowledge_nodes where id = v_to) then raise exception 'to node not found' using errcode='P0002'; end if;

  select * into v_existing from public.ai_knowledge_edges
  where from_node_id = v_from and to_node_id = v_to and relation_type = v_rel and coalesce(context_key,'') = coalesce(nullif(p_payload->>'context_key',''),'');
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'edge', to_jsonb(v_existing)); end if;

  insert into public.ai_knowledge_edges(from_node_id, to_node_id, relation_type, scope, context_key, weight, confidence, sample_size, evidence, valid_from, valid_to, source_version)
  values (v_from, v_to, v_rel, nullif(p_payload->>'scope',''), nullif(p_payload->>'context_key',''),
    nullif(p_payload->>'weight','')::numeric, least(100, greatest(0, nullif(p_payload->>'confidence','')::int)),
    greatest(0, nullif(p_payload->>'sample_size','')::int), p_payload->'evidence',
    nullif(p_payload->>'valid_from','')::timestamptz, nullif(p_payload->>'valid_to','')::timestamptz, p_payload->>'source_version')
  returning * into v_row;
  return jsonb_build_object('idempotent', false, 'edge', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_knowledge_edge_save(jsonb) to authenticated;

create or replace function public.admin_ai_knowledge_nodes(p_node_type text default null, p_q text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_knowledge_nodes n
    where n.is_active and (p_node_type is null or n.node_type = p_node_type)
      and (p_q is null or n.canonical_key ilike '%' || p_q || '%' or n.label ilike '%' || p_q || '%')
    order by n.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_knowledge_nodes(text, text, int) to authenticated;

create or replace function public.admin_ai_knowledge_neighbors(p_node_id uuid, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,50), 200)); v_node public.ai_knowledge_nodes; v_out jsonb; v_in jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_node from public.ai_knowledge_nodes where id = p_node_id;
  if v_node.id is null then return jsonb_build_object('found', false); end if;
  -- 1-Hop 만(재귀 없음 — Recursive Graph Abuse 방지).
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_out from (
    select jsonb_build_object('edge', to_jsonb(e), 'node', to_jsonb(n)) as x
    from public.ai_knowledge_edges e join public.ai_knowledge_nodes n on n.id = e.to_node_id
    where e.from_node_id = p_node_id and e.lifecycle_status = 'active' limit v_limit
  ) s;
  select coalesce(jsonb_agg(x order by x->>'created_at' desc), '[]'::jsonb) into v_in from (
    select jsonb_build_object('edge', to_jsonb(e), 'node', to_jsonb(n)) as x
    from public.ai_knowledge_edges e join public.ai_knowledge_nodes n on n.id = e.from_node_id
    where e.to_node_id = p_node_id and e.lifecycle_status = 'active' limit v_limit
  ) s;
  return jsonb_build_object('found', true, 'node', to_jsonb(v_node), 'outgoing', v_out, 'incoming', v_in);
end; $$;
grant execute on function public.admin_ai_knowledge_neighbors(uuid, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 11) Pattern 저장/조회 — validated 는 Sample/Support/Outcome 기준 충족 시만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_pattern_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_code text := nullif(p_payload->>'pattern_code',''); v_status text := coalesce(nullif(p_payload->>'status',''),'hypothesis');
        v_sample int := nullif(p_payload->>'sample_size','')::int; v_support int := coalesce(nullif(p_payload->>'support_count','')::int, 0);
        v_existing public.ai_discovered_patterns; v_row public.ai_discovered_patterns;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 65536 then raise exception 'payload too large (64KB limit)' using errcode='22023'; end if;
  if v_code is null then raise exception 'pattern_code required' using errcode='22023'; end if;
  if coalesce(p_payload->>'pattern_type','') not in ('context_performance','seasonal','time_of_day','weekday','industry','store','genre','mood','energy','track_lifecycle','playlist_diversity','rotation_fatigue','skip','completion','reaction','quality_regression','roi','governance_violation','human_override','agent_conflict','consensus_accuracy') then raise exception 'invalid pattern_type' using errcode='22023'; end if;
  if coalesce(p_payload->>'scope','') not in ('global','industry','brand','store','playlist','track','artist','context','strategy','agent') then raise exception 'invalid scope' using errcode='22023'; end if;
  if v_status not in ('hypothesis','emerging','provisional','validated','contradicted','deprecated','insufficient_data') then raise exception 'invalid status' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' then raise exception 'source_version required' using errcode='22023'; end if;
  -- validated 통계 정직성: 최소 Sample 30 + Support 3 + Outcome 정의 필수.
  if v_status = 'validated' and (coalesce(v_sample,0) < 30 or v_support < 3 or p_payload->'outcome_definition' is null) then
    raise exception 'validated pattern requires sample>=30, support>=3 and outcome_definition' using errcode='22023';
  end if;

  select * into v_existing from public.ai_discovered_patterns where pattern_code = v_code;
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'pattern', to_jsonb(v_existing)); end if;

  insert into public.ai_discovered_patterns(
    pattern_code, pattern_type, scope, scope_id, context_definition, subject_definition, outcome_definition,
    direction, effect_size, confidence, sample_size, support_count, contradiction_count, quality_score, status,
    evidence, source_period_start, source_period_end, source_version, created_by)
  values (v_code, p_payload->>'pattern_type', p_payload->>'scope', nullif(p_payload->>'scope_id',''),
    coalesce(p_payload->'context_definition','{}'::jsonb), coalesce(p_payload->'subject_definition','{}'::jsonb), coalesce(p_payload->'outcome_definition','{}'::jsonb),
    nullif(p_payload->>'direction',''), nullif(p_payload->>'effect_size','')::numeric,
    least(100, greatest(0, nullif(p_payload->>'confidence','')::int)), v_sample, v_support,
    coalesce(nullif(p_payload->>'contradiction_count','')::int, 0),
    least(100, greatest(0, nullif(p_payload->>'quality_score','')::int)), v_status,
    p_payload->'evidence', nullif(p_payload->>'source_period_start','')::timestamptz, nullif(p_payload->>'source_period_end','')::timestamptz,
    p_payload->>'source_version', auth.uid())
  returning * into v_row;
  return jsonb_build_object('idempotent', false, 'pattern', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_pattern_save(jsonb) to authenticated;

create or replace function public.admin_ai_pattern_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_discovered_patterns;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('hypothesis','emerging','provisional','validated','contradicted','deprecated','insufficient_data') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required' using errcode='22023'; end if;
  select * into v_row from public.ai_discovered_patterns where id = p_id;
  if v_row.id is null then raise exception 'pattern not found' using errcode='P0002'; end if;
  if p_status = 'validated' and (coalesce(v_row.sample_size,0) < 30 or v_row.support_count < 3) then
    raise exception 'validated requires sample>=30 and support>=3' using errcode='22023';
  end if;
  update public.ai_discovered_patterns set status = p_status,
    last_validated_at = case when p_status = 'validated' then now() else last_validated_at end,
    updated_at = now()
  where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_pattern_set_status(uuid, text, text) to authenticated;

create or replace function public.admin_ai_patterns(p_pattern_type text default null, p_status text default null, p_scope text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 500)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.last_detected_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_discovered_patterns p
    where (p_pattern_type is null or p.pattern_type = p_pattern_type)
      and (p_status is null or p.status = p_status)
      and (p_scope is null or p.scope = p_scope)
    order by p.last_detected_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_patterns(text, text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 12) Retrieval/Replay 사용 Audit(왜 이 Memory 가 사용됐는지 재현 가능).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_memory_mark_used(p_id uuid, p_use_type text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  if p_use_type is null or p_use_type not in ('retrieval_used','replay_used','pattern_derived') then raise exception 'invalid use type' using errcode='22023'; end if;
  if not exists (select 1 from public.ai_memory_records where id = p_id) then raise exception 'memory not found' using errcode='P0002'; end if;
  insert into public.ai_memory_audit(memory_id, event_type, reason, actor_id) values (p_id, p_use_type, p_reason, auth.uid());
  return jsonb_build_object('ok', true);
end; $$;
grant execute on function public.admin_ai_memory_mark_used(uuid, text, text) to authenticated;
