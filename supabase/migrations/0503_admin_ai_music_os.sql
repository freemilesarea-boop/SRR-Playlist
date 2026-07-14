-- ============================================
-- 0503_admin_ai_music_os.sql
--
-- Phase AI-MUSIC-16 — Autonomous Music Operating System, Executive Intelligence
-- & Strategic AI Governance.
--
-- 기존 개별 AI 기능(Playlist/Context/Prediction/Strategy/Sandbox/Governance/Multi-Agent/
-- Memory/Graph/Twin/Fleet/Federated/Self-Healing)을 하나의 운영체제 관점으로 통합해
-- 경영진 시각의 종합 판단·전략 제안을 생성한다.
--
--   Executive Intelligence → Strategic Planning → Cross-Agent Orchestration
--   → Fleet Coordination → Risk Management → Governance → Executive Recommendation
--   → Evidence Only
--
-- ⚠️ 절대: Production Apply/자동 Merge/Rollout/Publish 없음. AI 가 Executive Policy/
--   Production Entity 를 직접 수정하지 않는다. 모든 Executive Recommendation 은
--   Governance Review 대상(자동 승인 없음). 기존 기능 정의 전부 무변경. Trigger 없음.
--
-- 재사용 최우선: Executive KPI/Health/Risk/Opportunity/Simulation 은 기존 RPC
--   (fleet_summary·revenue_summary·agent_reputation·governance_summary·self_healing_summary·
--   federated_summary·twin_summary·memory_summary 등) 집계를 클라이언트 오케스트레이션.
--   신규 저장은 Executive Recommendation 1개 테이블만(전략 이력 = 동일 테이블 category).
-- ============================================

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Executive Recommendation(전략/위험/기회 제안 — Evidence Only).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_executive_recommendations (
  id                uuid primary key default gen_random_uuid(),
  rec_code          text not null unique,
  category          text not null check (category in ('strategy','risk_mitigation','opportunity','recovery_reference')),
  horizon           text not null check (horizon in ('7d','30d','quarter','season')),
  title             text not null,
  summary           text not null,
  -- 필수 4요소(없으면 저장 거부): Evidence · Confidence · Risk · Expected Outcome.
  evidence          jsonb not null,
  confidence        int not null check (confidence between 0 and 100),
  risk_tier         text not null check (risk_tier in ('low','medium','high','critical')),
  expected_outcome  jsonb not null,
  source_refs       jsonb not null default '[]'::jsonb,     -- 근거 도메인/RPC/simulation run 참조
  status            text not null default 'proposed' check (status in ('proposed','governance_review','approved_reference','rejected','expired')),
  limitations       jsonb not null default '[]'::jsonb,
  source_version    text not null,
  input_hash        text not null unique,
  created_by        uuid,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
comment on table public.ai_executive_recommendations is
  'AI-MUSIC-16 — Executive 제안(전략/위험/기회). Evidence·Confidence·Risk·Expected Outcome 필수. Governance Review 대상 — 자동 승인/실행 없음.';
create index if not exists idx_exec_rec on public.ai_executive_recommendations (category, status, created_at desc);
create index if not exists idx_exec_horizon on public.ai_executive_recommendations (horizon, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) AI OS Health — 전 도메인 상태 집계(읽기 전용 · 복제 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_ai_os_health()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'agents', (select jsonb_build_object('count', count(*), 'avg_reputation', round(avg(reputation))) from public.ai_agents where is_active),
    'governance', (select jsonb_build_object(
        'violations_30d', count(*) filter (where event_type in ('violation_detected','violation_blocked') and created_at >= now() - interval '30 days'),
        'overrides_30d', count(*) filter (where event_type = 'human_override' and created_at >= now() - interval '30 days'))
      from public.ai_governance_events),
    'memory', (select jsonb_build_object('total', count(*), 'active', count(*) filter (where lifecycle_status = 'active')) from public.ai_memory_records),
    'patterns', (select jsonb_build_object('total', count(*), 'validated', count(*) filter (where status = 'validated')) from public.ai_discovered_patterns),
    'twins', (select jsonb_build_object('total', count(*), 'ready', count(*) filter (where readiness_status = 'ready')) from public.ai_digital_twins where lifecycle_status = 'active'),
    'simulation_runs', (select count(*) from public.ai_twin_simulation_runs where run_status = 'completed'),
    'fleet', (select jsonb_build_object('best_practices', count(*)) from public.ai_best_practices where status not in ('rejected','superseded')),
    'opportunities', (select count(*) from public.ai_fleet_opportunities where status in ('detected','under_review','review_candidate')),
    'federated', (select jsonb_build_object('patterns', count(*), 'global_validated', count(*) filter (where status = 'global_validated')) from public.ai_federated_patterns),
    'incidents', (select jsonb_build_object('active', count(*) filter (where status in ('detected','analyzing','rca_complete','twin_validated','governance_review')), 'resolved', count(*) filter (where status = 'resolved')) from public.ai_incidents),
    'recovery', (select jsonb_build_object('twin_validated', count(*) filter (where validation_status = 'twin_validated'), 'succeeded', count(*) filter (where outcome = 'succeeded')) from public.ai_recovery_candidates),
    'executive_recommendations', (select jsonb_build_object('proposed', count(*) filter (where status = 'proposed'), 'governance_review', count(*) filter (where status = 'governance_review')) from public.ai_executive_recommendations)
  ) into v;
  return jsonb_build_object('domains', v, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_os_health() to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Executive Recommendation 저장/조회/상태(Governance Review — 자동 승인 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_executive_recommendation_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_existing public.ai_executive_recommendations; v_row public.ai_executive_recommendations; v_id uuid;
begin
  perform public._admin_growth_guard();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload too large (32KB limit)' using errcode='22023'; end if;
  if coalesce(p_payload->>'rec_code','') = '' or coalesce(p_payload->>'title','') = '' or coalesce(p_payload->>'summary','') = '' then raise exception 'rec_code/title/summary required' using errcode='22023'; end if;
  if coalesce(p_payload->>'category','') not in ('strategy','risk_mitigation','opportunity','recovery_reference') then raise exception 'invalid category' using errcode='22023'; end if;
  if coalesce(p_payload->>'horizon','') not in ('7d','30d','quarter','season') then raise exception 'invalid horizon' using errcode='22023'; end if;
  -- 필수 4요소 강제(Recommendation·Evidence·Confidence·Risk·Expected Outcome).
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if nullif(p_payload->>'confidence','') is null then raise exception 'confidence required' using errcode='22023'; end if;
  if coalesce(p_payload->>'risk_tier','') not in ('low','medium','high','critical') then raise exception 'risk_tier required' using errcode='22023'; end if;
  if p_payload->'expected_outcome' is null or jsonb_typeof(p_payload->'expected_outcome') <> 'object' then raise exception 'expected_outcome required' using errcode='22023'; end if;
  if coalesce(p_payload->>'source_version','') = '' or coalesce(p_payload->>'input_hash','') = '' then raise exception 'source_version/input_hash required' using errcode='22023'; end if;

  select * into v_existing from public.ai_executive_recommendations where input_hash = p_payload->>'input_hash';
  if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'recommendation', to_jsonb(v_existing)); end if;

  insert into public.ai_executive_recommendations(rec_code, category, horizon, title, summary, evidence, confidence, risk_tier,
    expected_outcome, source_refs, limitations, source_version, input_hash, created_by)
  values (p_payload->>'rec_code', p_payload->>'category', p_payload->>'horizon', p_payload->>'title', p_payload->>'summary',
    p_payload->'evidence', least(100, greatest(0, (p_payload->>'confidence')::int)), p_payload->>'risk_tier',
    p_payload->'expected_outcome', coalesce(p_payload->'source_refs','[]'::jsonb),
    coalesce(p_payload->'limitations','["Evidence Only — 자동 실행 없음"]'::jsonb), p_payload->>'source_version', p_payload->>'input_hash', auth.uid())
  returning id into v_id;
  select * into v_row from public.ai_executive_recommendations where id = v_id;
  return jsonb_build_object('idempotent', false, 'recommendation', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_executive_recommendation_save(jsonb) to authenticated;

create or replace function public.admin_executive_recommendations(p_category text default null, p_status text default null, p_horizon text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 300)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_executive_recommendations r
    where (p_category is null or r.category = p_category) and (p_status is null or r.status = p_status) and (p_horizon is null or r.horizon = p_horizon)
    order by r.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_executive_recommendations(text, text, text, int) to authenticated;

create or replace function public.admin_executive_recommendation_set_status(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_executive_recommendations;
begin
  perform public._admin_growth_guard();
  if p_status is null or p_status not in ('governance_review','approved_reference','rejected','expired') then raise exception 'invalid status' using errcode='22023'; end if;
  if coalesce(p_reason,'') = '' then raise exception 'reason required (Governance 근거)' using errcode='22023'; end if;
  select * into v_row from public.ai_executive_recommendations where id = p_id;
  if v_row.id is null then raise exception 'recommendation not found' using errcode='P0002'; end if;
  -- 자동 승인 방지: approved_reference 는 governance_review 를 거친 뒤에만.
  if p_status = 'approved_reference' and v_row.status <> 'governance_review' then
    raise exception 'approved_reference requires governance_review first (자동 승인 없음)' using errcode='22023';
  end if;
  update public.ai_executive_recommendations set status = p_status, updated_at = now() where id = p_id returning * into v_row;
  return to_jsonb(v_row);
end; $$;
grant execute on function public.admin_executive_recommendation_set_status(uuid, text, text) to authenticated;
