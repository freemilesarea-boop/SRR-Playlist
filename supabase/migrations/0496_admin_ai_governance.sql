-- ============================================
-- 0496_admin_ai_governance.sql
--
-- Phase AI-MUSIC-8 — AI Constitution, Trust Governance & Controlled Production Gateway.
--
-- Context→Learning→Prediction→Strategy→Sandbox→Draft Promotion 전체 흐름에 대해 AI 가 절대 위반할
-- 수 없는 **헌법(Constitution)** · 정책/권한 경계 · **AI 신뢰도(Trust)/평판(Reputation)** · 헌법
-- 위반 탐지 · **Production Change Request Candidate** 생성까지 통합 관리한다.
--
--   AI Constitution → Policy/Trust Validation → Decision Reputation → Governance Health
--   → Human Approval → Production Change Request Candidate → 별도 운영 승인 대기
--
-- ⚠️ 절대: 실제 Production Apply 없음. Production Entity(playlists/playlist_tracks/track_rollouts/
--   scheduler/queue/playback) UPDATE 금지. Experiment running 생성/publish/deploy/migration apply 금지.
--   AI 가 Constitution 을 수정할 수 없다(rule 변경 RPC 없음, immutable rule 차단). AI 가 자신의 Trust
--   를 직접 수정할 수 없다(trust 직접 입력 RPC 없음 — Trust 는 실제 Outcome/Audit 집계에서 계산).
--   Evidence 없는 Governance 판정 금지. Critical Risk/Constitution 위반 상태 Candidate 생성 금지.
--   사람 명시 승인 없는 Change Candidate 생성 금지.
--
-- Trust/Reputation 은 **실시간 집계**(기존 strategy_learning/promotion_summary/sandbox_summary +
-- governance_events)로 계산한다(불필요한 Snapshot 테이블 미생성). 계산은 프론트 aiGovernance.ts.
--
-- 절대 조건: SECURITY DEFINER + search_path 고정 · 관리자 가드 · whitelist · Evidence 필수 ·
--   Idempotency/Duplicate 방지 · 점수 0~100 clamp · NaN 금지 · Production Entity UPDATE 없음 · Trigger 없음.
-- ============================================

-- 가드 _admin_growth_guard()(0472) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) AI Constitution 규칙(불변 규칙 집합). AI 는 수정 불가(변경 RPC 미제공).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_constitution_rules (
  id               uuid primary key default gen_random_uuid(),
  rule_code        text not null unique,
  category         text not null,
  title            text not null,
  description      text,
  severity         text not null check (severity in ('informational','warning','high','critical')),
  enforcement_type text not null check (enforcement_type in ('audit','warn','block','immutable_block')),
  scope            text,
  rule_definition  jsonb not null default '{}'::jsonb,
  version          int not null default 1,
  is_active        boolean not null default true,
  immutable        boolean not null default false,
  created_by       uuid, approved_by uuid,
  created_at       timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.ai_constitution_rules is
  'AI-MUSIC-8 — AI Constitution. AI 수정 불가(변경 RPC 없음). immutable rule 은 UI 비활성화 불가.';
create index if not exists idx_constitution_active on public.ai_constitution_rules (is_active, category);

-- 초기 Constitution Rule 시드(현재 시스템에서 검증 가능한 규칙만). 재적용 안전(ON CONFLICT).
insert into public.ai_constitution_rules (rule_code, category, title, description, severity, enforcement_type, scope, immutable) values
  ('HUMAN_APPROVAL_REQUIRED','production_safety','사람 승인 필수','Production 방향 후보는 사람 명시 승인 필요','critical','immutable_block','all', true),
  ('NO_AUTOMATIC_PRODUCTION_APPLY','production_safety','자동 Production Apply 금지','자동 Apply 불가','critical','immutable_block','all', true),
  ('NO_AUTOMATIC_PLAYLIST_PUBLISH','production_safety','자동 Playlist Publish 금지',null,'critical','immutable_block','playlist', true),
  ('NO_AUTOMATIC_SCHEDULER_CHANGE','production_safety','자동 Scheduler 변경 금지',null,'critical','immutable_block','scheduler', true),
  ('NO_AUTOMATIC_QUEUE_CHANGE','production_safety','자동 Queue 변경 금지',null,'critical','immutable_block','queue', true),
  ('NO_AUTOMATIC_PLAYBACK_CHANGE','production_safety','자동 Playback 변경 금지',null,'critical','immutable_block','playback', true),
  ('NO_AUTOMATIC_ROLLOUT_PROMOTION','production_safety','자동 Rollout 승격 금지',null,'critical','immutable_block','rollout', true),
  ('NO_AUTOMATIC_EXPERIMENT_START','production_safety','자동 Experiment 시작 금지',null,'critical','immutable_block','experiment', true),
  ('NO_AUTOMATIC_CANARY_START','production_safety','자동 Canary 시작 금지',null,'critical','immutable_block','canary', true),
  ('EVIDENCE_REQUIRED','evidence','Evidence 필수',null,'high','block','all', false),
  ('BASELINE_REQUIRED','evidence','Baseline 필수',null,'high','block','all', false),
  ('INPUT_SNAPSHOT_REQUIRED','evidence','Input Snapshot 필수',null,'high','block','all', false),
  ('SOURCE_VERSION_REQUIRED','evidence','Source Version 필수',null,'high','block','all', false),
  ('CONFIDENCE_REQUIRED','evidence','Confidence 필수',null,'warning','warn','all', false),
  ('SAMPLE_SUFFICIENCY_REQUIRED','evidence','Sample 충족 필수',null,'high','block','all', false),
  ('NO_SYNTHETIC_OPERATIONAL_DATA','data_integrity','합성 운영 데이터 금지',null,'high','block','all', false),
  ('NO_UNSUPPORTED_DIMENSION_INFERENCE','data_integrity','미지원 Dimension 추론 금지',null,'high','block','all', false),
  ('NO_NULL_TO_ZERO_PERFORMANCE_CONVERSION','data_integrity','null→0 성과 변환 금지',null,'warning','warn','all', false),
  ('NO_NAN_OR_INFINITY','data_integrity','NaN/Infinity 금지',null,'high','block','all', false),
  ('NO_EXPIRED_INPUT_PROMOTION','data_integrity','Expired Input 승격 금지',null,'high','block','all', false),
  ('CRITICAL_RISK_BLOCK','governance','Critical Risk 차단',null,'critical','immutable_block','all', true),
  ('CONSTITUTION_VIOLATION_BLOCK','governance','Constitution 위반 승격 차단',null,'critical','immutable_block','all', true),
  ('UNRESOLVED_CONFLICT_BLOCK','governance','미해결 Conflict 차단',null,'high','block','all', false),
  ('MISSING_DEPENDENCY_BLOCK','governance','필수 Dependency 누락 차단',null,'high','block','all', false),
  ('AUDIT_REQUIRED','governance','Audit 필수',null,'high','block','all', false),
  ('HUMAN_OVERRIDE_RECORDED','governance','Human Override 기록',null,'warning','audit','all', false),
  ('IDEMPOTENCY_REQUIRED','governance','Idempotency 필수',null,'warning','warn','all', false)
on conflict (rule_code) do nothing;

create or replace function public.admin_ai_constitution_rules(p_active boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.severity desc, t.rule_code), '[]'::jsonb) into v_items
  from public.ai_constitution_rules t where (p_active is null or t.is_active = p_active);
  return jsonb_build_object('constitution_version', 1, 'items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_constitution_rules(boolean) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Governance Event Log(constitution_check/violation/override/approval 등).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_governance_events (
  id                  uuid primary key default gen_random_uuid(),
  source_type         text not null, source_id text, context_key text,
  event_type          text not null check (event_type in ('constitution_check','violation_detected','violation_blocked','human_override','approval','rejection','trust_adjustment','reputation_update','change_request_candidate_created','change_request_candidate_rejected')),
  constitution_version int default 1,
  rule_results        jsonb, trust_before jsonb, trust_after jsonb,
  governance_decision text, actor_id uuid, evidence jsonb not null default '[]'::jsonb, metadata jsonb,
  created_at          timestamptz not null default now()
);
create index if not exists idx_gov_event on public.ai_governance_events (source_type, event_type, created_at desc);
create index if not exists idx_gov_event_ctx on public.ai_governance_events (context_key, created_at desc);

create or replace function public.admin_ai_constitution_check(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_governance_events; v_decision text := nullif(p_payload->>'governance_decision','');
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'source_type','') = '' then raise exception 'source_type required' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'evidence required (Evidence 없는 Governance 판정 금지)' using errcode='22023';
  end if;
  insert into public.ai_governance_events(source_type, source_id, context_key, event_type, constitution_version, rule_results, trust_before, trust_after, governance_decision, actor_id, evidence, metadata)
  values (p_payload->>'source_type', nullif(p_payload->>'source_id',''), nullif(p_payload->>'context_key',''),
    coalesce(nullif(p_payload->>'event_type',''),'constitution_check'), 1, p_payload->'rule_results', p_payload->'trust_before', p_payload->'trust_after',
    v_decision, auth.uid(), p_payload->'evidence', p_payload->'metadata')
  returning id into v_id;
  select * into v_row from public.ai_governance_events where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_constitution_check(jsonb) to authenticated;

create or replace function public.admin_ai_governance_events(p_source_type text default null, p_event_type text default null, p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_governance_events e
    where (p_source_type is null or e.source_type = p_source_type) and (p_event_type is null or e.event_type = p_event_type)
    order by e.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_governance_events(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Human Override 기록(기록만 · 자동 Weight 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_human_overrides (
  id                 uuid primary key default gen_random_uuid(),
  source_type        text not null, source_id text, context_key text,
  override_type      text not null, reason_code text, reason text, risk_tier text,
  previous_decision  text, overridden_decision text, actor_id uuid, created_at timestamptz not null default now()
);
create index if not exists idx_override on public.ai_human_overrides (source_type, created_at desc);

create or replace function public.admin_ai_human_override(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_human_overrides;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'source_type','') = '' or coalesce(p_payload->>'override_type','') = '' then
    raise exception 'source_type/override_type required' using errcode='22023';
  end if;
  insert into public.ai_human_overrides(source_type, source_id, context_key, override_type, reason_code, reason, risk_tier, previous_decision, overridden_decision, actor_id)
  values (p_payload->>'source_type', nullif(p_payload->>'source_id',''), nullif(p_payload->>'context_key',''), p_payload->>'override_type',
    nullif(p_payload->>'reason_code',''), nullif(p_payload->>'reason',''), nullif(p_payload->>'risk_tier',''),
    nullif(p_payload->>'previous_decision',''), nullif(p_payload->>'overridden_decision',''), auth.uid())
  returning id into v_id;
  insert into public.ai_governance_events(source_type, source_id, context_key, event_type, actor_id, evidence, metadata)
  values (p_payload->>'source_type', nullif(p_payload->>'source_id',''), nullif(p_payload->>'context_key',''), 'human_override', auth.uid(),
    jsonb_build_array(jsonb_build_object('label','override_type','value',p_payload->>'override_type')), p_payload);
  select * into v_row from public.ai_human_overrides where id = v_id;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_human_override(jsonb) to authenticated;

create or replace function public.admin_ai_human_overrides(p_limit int default 200)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,200), 1000)); v_items jsonb; v_signal jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_human_overrides o order by o.created_at desc limit v_limit
  ) t;
  -- Human Preference Signal(집계).
  select coalesce(jsonb_agg(to_jsonb(s) order by s.n desc), '[]'::jsonb) into v_signal from (
    select override_type, reason_code, count(*) n from public.ai_human_overrides group by override_type, reason_code
  ) s;
  return jsonb_build_object('items', v_items, 'signal', v_signal, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_human_overrides(int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Production Change Request Candidate(별도 운영 승인 대기). Production 반영 필드 없음.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_production_change_candidates (
  id                     uuid primary key default gen_random_uuid(),
  source_draft_id        uuid references public.strategy_promotion_drafts(id) on delete set null,
  source_promotion_request_id uuid references public.strategy_promotion_requests(id) on delete set null,
  source_sandbox_run_id  uuid references public.strategy_sandbox_runs(id) on delete set null,
  context_key            text not null, change_type text not null,
  candidate_status       text not null default 'pending_governance_review'
                           check (candidate_status in ('draft','pending_governance_review','governance_ready','review_required','rejected','expired','cancelled')),
  risk_tier              text check (risk_tier in ('low','medium','high','critical')),
  readiness_score        int,
  trust_snapshot         jsonb, constitution_result jsonb, governance_result jsonb,
  rollback_plan          jsonb, observation_plan jsonb, execution_preconditions jsonb, go_criteria jsonb,
  source_input_hash      text, source_model_version text, source_policy_version text, source_constitution_version int default 1,
  idempotency_key        text, evidence jsonb not null default '[]'::jsonb,
  requested_by           uuid, reviewed_by uuid,
  created_at             timestamptz not null default now(), reviewed_at timestamptz, expired_at timestamptz
);
comment on table public.ai_production_change_candidates is
  'AI-MUSIC-8 — Production Change Request Candidate. 별도 Change Management 승인 대기. Production Apply 없음, applied/deployed/running 필드 없음.';
create unique index if not exists uq_change_idem on public.ai_production_change_candidates (idempotency_key) where idempotency_key is not null;
create index if not exists idx_change_ctx on public.ai_production_change_candidates (context_key, created_at desc);
create index if not exists idx_change_status on public.ai_production_change_candidates (candidate_status, created_at desc);

create or replace function public.admin_ai_change_candidate_request(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_id uuid; v_row public.ai_production_change_candidates; v_draft public.strategy_promotion_drafts;
  v_risk text := nullif(p_payload->>'risk_tier','');
  v_idem text := nullif(p_payload->>'idempotency_key','');
  v_draft_id uuid := nullif(p_payload->>'source_draft_id','')::uuid;
  v_existing public.ai_production_change_candidates;
begin
  perform public._admin_growth_guard();

  if coalesce(p_payload->>'context_key','') = '' or coalesce(p_payload->>'change_type','') = '' then raise exception 'context_key/change_type required' using errcode='22023'; end if;
  if v_risk is not null and v_risk not in ('low','medium','high','critical') then raise exception 'invalid risk_tier' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  -- 사람 명시 승인 없이는 생성 금지.
  if coalesce((p_payload->>'human_approved')::boolean, false) = false then raise exception '사람 명시 Change Candidate 생성 승인 필요' using errcode='22023'; end if;
  -- Constitution 위반/Critical Risk 차단.
  if coalesce((p_payload->>'constitution_pass')::boolean, false) = false then raise exception 'Constitution 위반 상태 Candidate 생성 금지' using errcode='22023'; end if;
  if v_risk = 'critical' then raise exception 'Critical Risk Candidate 생성 금지' using errcode='22023'; end if;
  -- Rollback/Observation Plan 필수.
  if p_payload->'rollback_plan' is null or p_payload->'observation_plan' is null then raise exception 'Rollback/Observation Plan 필수' using errcode='22023'; end if;

  -- Draft 유효성(ready + candidate) 재검증.
  if v_draft_id is not null then
    select * into v_draft from public.strategy_promotion_drafts where id = v_draft_id;
    if v_draft.id is null then raise exception 'source draft not found' using errcode='P0002'; end if;
    if v_draft.draft_status <> 'ready' then raise exception 'Draft ready 아님' using errcode='22023'; end if;
    if v_draft.canary_status <> 'candidate' then raise exception 'Canary Candidate 아님' using errcode='22023'; end if;
    if v_draft.expired_at is not null then raise exception 'Expired Draft' using errcode='22023'; end if;
  end if;

  -- Idempotency.
  if v_idem is not null then
    select * into v_existing from public.ai_production_change_candidates where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'candidate', to_jsonb(v_existing)); end if;
  end if;
  -- Duplicate(동일 draft active).
  if v_draft_id is not null then
    select * into v_existing from public.ai_production_change_candidates
      where source_draft_id = v_draft_id and candidate_status in ('draft','pending_governance_review','governance_ready') limit 1;
    if v_existing.id is not null then raise exception 'Duplicate Change Candidate(동일 Draft active)' using errcode='23505'; end if;
  end if;

  insert into public.ai_production_change_candidates(
    source_draft_id, source_promotion_request_id, source_sandbox_run_id, context_key, change_type, candidate_status, risk_tier,
    readiness_score, trust_snapshot, constitution_result, governance_result, rollback_plan, observation_plan, execution_preconditions,
    go_criteria, source_input_hash, source_model_version, source_policy_version, idempotency_key, evidence, requested_by
  ) values (
    v_draft_id, nullif(p_payload->>'source_promotion_request_id','')::uuid, nullif(p_payload->>'source_sandbox_run_id','')::uuid,
    p_payload->>'context_key', p_payload->>'change_type', 'pending_governance_review', v_risk,
    least(100,greatest(0,nullif(p_payload->>'readiness_score','')::int)),
    p_payload->'trust_snapshot', p_payload->'constitution_result', p_payload->'governance_result',
    p_payload->'rollback_plan', p_payload->'observation_plan', p_payload->'execution_preconditions', p_payload->'go_criteria',
    coalesce(nullif(p_payload->>'source_input_hash',''), v_draft.source_input_hash),
    coalesce(nullif(p_payload->>'source_model_version',''), v_draft.source_model_version),
    nullif(p_payload->>'source_policy_version',''), v_idem, p_payload->'evidence', auth.uid()
  ) returning id into v_id;

  insert into public.ai_governance_events(source_type, source_id, context_key, event_type, actor_id, evidence, governance_decision)
  values ('change_candidate', v_id::text, p_payload->>'context_key', 'change_request_candidate_created', auth.uid(), p_payload->'evidence', 'pending_governance_review');

  select * into v_row from public.ai_production_change_candidates where id = v_id;
  return jsonb_build_object('idempotent', false, 'candidate', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_change_candidate_request(jsonb) to authenticated;

create or replace function public.admin_ai_change_candidate_set_status(p_id uuid, p_status text, p_reason text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_production_change_candidates; v_prev text;
begin
  perform public._admin_growth_guard();
  if p_status not in ('pending_governance_review','governance_ready','review_required','rejected','cancelled') then
    raise exception 'invalid status' using errcode='22023';
  end if;
  select * into v_row from public.ai_production_change_candidates where id = p_id;
  if v_row.id is null then raise exception 'not found' using errcode='P0002'; end if;
  v_prev := v_row.candidate_status;
  -- Governance Ready 조건: Constitution Pass + Critical 아님 + 미Expired + Rollback/Observation 존재.
  if p_status = 'governance_ready' then
    if v_row.expired_at is not null then raise exception 'Expired Candidate' using errcode='22023'; end if;
    if v_row.risk_tier = 'critical' then raise exception 'Critical Risk — governance_ready 불가' using errcode='22023'; end if;
    if v_row.rollback_plan is null or v_row.observation_plan is null then raise exception 'Rollback/Observation Plan 필수' using errcode='22023'; end if;
    if coalesce((v_row.constitution_result->>'pass')::boolean, false) = false then raise exception 'Constitution 미Pass — governance_ready 불가' using errcode='22023'; end if;
  end if;

  update public.ai_production_change_candidates set candidate_status = p_status, reviewed_by = auth.uid(), reviewed_at = now() where id = p_id returning * into v_row;
  insert into public.ai_governance_events(source_type, source_id, context_key, event_type, actor_id, governance_decision, metadata, evidence)
  values ('change_candidate', p_id::text, v_row.context_key,
    case when p_status='rejected' then 'change_request_candidate_rejected' else 'approval' end, auth.uid(), p_status,
    jsonb_build_object('reason', p_reason), jsonb_build_array(jsonb_build_object('label','status','value',p_status)));
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_ai_change_candidate_set_status(uuid, text, text) to authenticated;

create or replace function public.admin_ai_change_candidate_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_production_change_candidates; v_events jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_production_change_candidates where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at desc), '[]'::jsonb) into v_events
  from public.ai_governance_events e where e.source_type='change_candidate' and e.source_id = p_id::text;
  return jsonb_build_object('candidate', to_jsonb(v_row), 'events', v_events);
end; $$;
grant execute on function public.admin_ai_change_candidate_detail(uuid) to authenticated;

create or replace function public.admin_ai_change_candidate_history(p_context_key text default null, p_status text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_production_change_candidates c
    where (p_context_key is null or c.context_key = p_context_key) and (p_status is null or c.candidate_status = p_status)
    order by c.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_change_candidate_history(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Summary — 실시간 집계(events/overrides/candidates). Trust 는 프론트 계산.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_governance_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_events jsonb; v_candidates jsonb; v_audit jsonb;
begin
  perform public._admin_growth_guard();
  select to_jsonb(x) into v_events from (
    select count(*) total,
      count(*) filter (where event_type='violation_detected') violations,
      count(*) filter (where event_type='violation_blocked') blocked,
      count(*) filter (where event_type='human_override') overrides,
      count(*) filter (where event_type='constitution_check') checks
    from public.ai_governance_events
  ) x;
  select to_jsonb(y) into v_candidates from (
    select count(*) total,
      count(*) filter (where candidate_status='pending_governance_review') pending,
      count(*) filter (where candidate_status='governance_ready') governance_ready,
      count(*) filter (where candidate_status='rejected') rejected,
      count(*) filter (where candidate_status='expired') expired,
      count(*) filter (where risk_tier='high') high_risk,
      count(*) filter (where risk_tier='critical') critical_risk
    from public.ai_production_change_candidates
  ) y;
  -- Constitution Rule 별 위반 집계(rule_results jsonb 내 violation).
  select coalesce(jsonb_agg(to_jsonb(z) order by z.violations desc), '[]'::jsonb) into v_audit from (
    select r.value->>'rule_code' rule_code,
      count(*) checked,
      count(*) filter (where r.value->>'result' in ('violation','blocked')) violations,
      count(*) filter (where r.value->>'result'='warning') warnings
    from public.ai_governance_events e, jsonb_array_elements(coalesce(e.rule_results,'[]'::jsonb)) r
    where e.event_type='constitution_check'
    group by r.value->>'rule_code'
  ) z;
  return jsonb_build_object('events', v_events, 'candidates', v_candidates, 'constitution_audit', v_audit, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_governance_summary() to authenticated;
