-- ============================================
-- 0497_admin_ai_agents.sql
--
-- Phase AI-MUSIC-9 — Multi-Agent Collaboration Engine & Autonomous Music Operating System.
--
-- 하나의 AI 가 모든 결정을 하던 구조를 여러 전문 Agent(Context/Prediction/Playlist/Ranking/
-- Rotation/Quality/Revenue/Governance)가 독립 분석 → 협업(Discussion) → Consensus → Conflict
-- 해결 → Governance 제출하는 구조로 확장한다.
--
--   Operational Data → 각 Agent 독립 의견 → Discussion → Consensus → Conflict → Governance
--   → Trust → Draft → Production Change Candidate
--
-- ⚠️ 절대: Production Apply 없음. Agent 가 Production Entity/Trust/Constitution 을 직접 수정 불가.
--   Agent 가 서로의 Memory 를 수정 불가(Memory 는 읽기 전용 Snapshot). 자동 Publish/Rollout/
--   Scheduler/Queue/Playback 반영 없음. Discussion/Consensus/Conflict 는 기록만.
--
-- 저장소: ai_agents(레지스트리 + Reputation, **Outcome 으로만 갱신** — 직접 setter 없음) +
--   ai_agent_collaboration(Discussion 세션: 참여 Agent/의견/Consensus/Conflict/최종/Governance).
--   Agent Memory 는 기존 Snapshot(context_learning/prediction/strategy) 읽기 전용 재사용 — 신규
--   Memory 테이블 미생성. Conflict/Audit 는 collaboration jsonb + ai_governance_events 재사용.
--
-- 절대 조건: SECURITY DEFINER + search_path 고정 · 관리자 가드 · Evidence 필수 · Idempotency/
--   Duplicate 방지 · agent_code whitelist · 점수 0~100 clamp · NaN 금지 · Production Entity/Trust/
--   Constitution UPDATE 없음 · Reputation 직접 입력 RPC 없음 · Trigger 없음.
-- ============================================

-- 가드 _admin_growth_guard()(0472) 재사용.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Agent 레지스트리(+ Reputation). Reputation 은 Outcome RPC 로만 갱신.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_agents (
  id           uuid primary key default gen_random_uuid(),
  agent_code   text not null unique,
  name         text not null,
  domain       text not null,
  responsibilities jsonb not null default '[]'::jsonb,
  is_active    boolean not null default true,
  reputation   int not null default 60,   -- 0~100, Outcome 기반 갱신
  decisions    int not null default 0,
  wins         int not null default 0,
  losses       int not null default 0,
  created_at   timestamptz not null default now(), updated_at timestamptz not null default now()
);
comment on table public.ai_agents is
  'AI-MUSIC-9 — Multi-Agent 레지스트리. Reputation 은 실제 Outcome 으로만 갱신(직접 setter 없음).';

insert into public.ai_agents (agent_code, name, domain, responsibilities) values
  ('context','Context Agent','context','["시간","요일","계절","날씨","업종","브랜드","Store Context"]'),
  ('prediction','Prediction Agent','prediction','["Skip 예측","Like 예측","Completion 예측","Revenue 영향","Risk 예측"]'),
  ('playlist','Playlist Agent','playlist','["Playlist 생성","개선","다양성","신선도"]'),
  ('ranking','Ranking Agent','ranking','["Track 우선순위","Artist Exposure","Discovery"]'),
  ('rotation','Rotation Agent','rotation','["반복 제거","Fatigue 방지","Rotation 균형"]'),
  ('quality','Quality Agent','quality','["Playback Quality","Buffer","Decoder Error","Streaming Quality"]'),
  ('revenue','Revenue Agent','revenue','["정산 영향","계약 영향","ROI","Store Satisfaction"]'),
  ('governance','Governance Agent','governance','["Constitution","Trust","Audit","Candidate 검증"]')
on conflict (agent_code) do nothing;

create or replace function public.admin_ai_agents(p_active boolean default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.domain), '[]'::jsonb) into v_items
  from public.ai_agents t where (p_active is null or t.is_active = p_active);
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_agents(boolean) to authenticated;

create or replace function public.admin_ai_agent_detail(p_agent_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agent public.ai_agents; v_recent jsonb;
begin
  perform public._admin_growth_guard();
  select * into v_agent from public.ai_agents where agent_code = p_agent_code;
  if v_agent.id is null then return jsonb_build_object('found', false); end if;
  -- 최근 참여 협업.
  select coalesce(jsonb_agg(to_jsonb(c) order by c.created_at desc), '[]'::jsonb) into v_recent from (
    select id, context_key, consensus_type, final_decision, created_at from public.ai_agent_collaboration
    where participants ? p_agent_code order by created_at desc limit 20
  ) c;
  return jsonb_build_object('agent', to_jsonb(v_agent), 'recent_collaborations', v_recent);
end; $$;
grant execute on function public.admin_ai_agent_detail(text) to authenticated;

create or replace function public.admin_ai_agent_reputation()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(jsonb_build_object('agent_code', agent_code, 'name', name, 'domain', domain,
    'reputation', reputation, 'decisions', decisions, 'wins', wins, 'losses', losses,
    'win_rate', case when decisions>0 then round(100.0*wins/decisions,1) else null end) order by reputation desc), '[]'::jsonb) into v_items
  from public.ai_agents;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_agent_reputation() to authenticated;

-- Agent Memory(읽기 전용) — 도메인별 기존 Snapshot 재사용. 다른 Agent Memory 수정 없음.
create or replace function public.admin_ai_agent_memory(p_agent_code text, p_context_key text default null, p_limit int default 20)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,20), 200)); v_mem jsonb;
begin
  perform public._admin_growth_guard();
  if p_agent_code in ('context') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_mem from (
      select context_key, health_score, drift_score, confidence, created_at from public.context_learning_snapshots
      where (p_context_key is null or context_key = p_context_key) order by created_at desc limit v_limit) t;
  elsif p_agent_code in ('prediction') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_mem from (
      select context_key, prediction_type, horizon, confidence, created_at from public.prediction_snapshots
      where (p_context_key is null or context_key = p_context_key) order by created_at desc limit v_limit) t;
  elsif p_agent_code in ('playlist','ranking','rotation','revenue','quality') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_mem from (
      select context_key, strategy_type, roi_score, risk_score, status, outcome, created_at from public.strategy_snapshots
      where (p_context_key is null or context_key = p_context_key) order by created_at desc limit v_limit) t;
  elsif p_agent_code in ('governance') then
    select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_mem from (
      select source_type, event_type, governance_decision, created_at from public.ai_governance_events
      order by created_at desc limit v_limit) t;
  else v_mem := '[]'::jsonb; end if;
  return jsonb_build_object('agent_code', p_agent_code, 'read_only', true, 'memory', v_mem, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_agent_memory(text, text, int) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Collaboration(Discussion 세션) 저장소.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_agent_collaboration (
  id             uuid primary key default gen_random_uuid(),
  context_key    text not null,
  topic          text,
  participants   jsonb not null default '[]'::jsonb,   -- ["context","prediction",...]
  opinions       jsonb not null default '[]'::jsonb,   -- [{agent,score,stance,confidence,rationale}]
  consensus_type text check (consensus_type in ('unanimous','majority','weighted_consensus','governance_required','insufficient_data')),
  consensus_score int,
  conflicts      jsonb not null default '[]'::jsonb,   -- [{a,b,reason,severity}]
  final_decision text, governance_result jsonb,
  input_hash     text, idempotency_key text, evidence jsonb not null default '[]'::jsonb,
  created_by     uuid, created_at timestamptz not null default now()
);
comment on table public.ai_agent_collaboration is
  'AI-MUSIC-9 — Multi-Agent Discussion/Consensus/Conflict 기록. Production 무변경, 기록만.';
create unique index if not exists uq_collab_idem on public.ai_agent_collaboration (idempotency_key) where idempotency_key is not null;
create index if not exists idx_collab_ctx on public.ai_agent_collaboration (context_key, created_at desc);

create or replace function public.admin_ai_collaboration_save(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_row public.ai_agent_collaboration; v_ct text := nullif(p_payload->>'consensus_type',''); v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_agent_collaboration;
begin
  perform public._admin_growth_guard();
  if coalesce(p_payload->>'context_key','') = '' then raise exception 'context_key required' using errcode='22023'; end if;
  if v_ct is not null and v_ct not in ('unanimous','majority','weighted_consensus','governance_required','insufficient_data') then raise exception 'invalid consensus_type' using errcode='22023'; end if;
  if p_payload->'evidence' is null or jsonb_array_length(coalesce(p_payload->'evidence','[]'::jsonb)) = 0 then raise exception 'evidence required' using errcode='22023'; end if;
  if p_payload->'participants' is null or jsonb_array_length(coalesce(p_payload->'participants','[]'::jsonb)) = 0 then raise exception 'participants required' using errcode='22023'; end if;

  if v_idem is not null then
    select * into v_existing from public.ai_agent_collaboration where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('idempotent', true, 'collaboration', to_jsonb(v_existing)); end if;
  end if;

  insert into public.ai_agent_collaboration(context_key, topic, participants, opinions, consensus_type, consensus_score, conflicts, final_decision, governance_result, input_hash, idempotency_key, evidence, created_by)
  values (p_payload->>'context_key', nullif(p_payload->>'topic',''), coalesce(p_payload->'participants','[]'::jsonb), coalesce(p_payload->'opinions','[]'::jsonb),
    v_ct, least(100,greatest(0,nullif(p_payload->>'consensus_score','')::int)), coalesce(p_payload->'conflicts','[]'::jsonb),
    nullif(p_payload->>'final_decision',''), p_payload->'governance_result', nullif(p_payload->>'input_hash',''), v_idem, p_payload->'evidence', auth.uid())
  returning id into v_id;

  insert into public.ai_governance_events(source_type, source_id, context_key, event_type, actor_id, evidence, governance_decision)
  values ('collaboration', v_id::text, p_payload->>'context_key', 'constitution_check', auth.uid(), p_payload->'evidence', v_ct);

  select * into v_row from public.ai_agent_collaboration where id = v_id;
  return jsonb_build_object('idempotent', false, 'collaboration', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_collaboration_save(jsonb) to authenticated;

create or replace function public.admin_ai_collaboration_history(p_context_key text default null, p_consensus_type text default null, p_limit int default 100)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_limit int := greatest(1, least(coalesce(p_limit,100), 1000)); v_items jsonb;
begin
  perform public._admin_growth_guard();
  select coalesce(jsonb_agg(to_jsonb(t) order by t.created_at desc), '[]'::jsonb) into v_items from (
    select * from public.ai_agent_collaboration c
    where (p_context_key is null or c.context_key = p_context_key) and (p_consensus_type is null or c.consensus_type = p_consensus_type)
    order by c.created_at desc limit v_limit
  ) t;
  return jsonb_build_object('items', v_items, 'generated_at', now());
end; $$;
grant execute on function public.admin_ai_collaboration_history(text, text, int) to authenticated;

create or replace function public.admin_ai_collaboration_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_row public.ai_agent_collaboration;
begin
  perform public._admin_growth_guard();
  select * into v_row from public.ai_agent_collaboration where id = p_id;
  if v_row.id is null then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('collaboration', to_jsonb(v_row));
end; $$;
grant execute on function public.admin_ai_collaboration_detail(uuid) to authenticated;

-- Agent Outcome 반영 — Reputation 은 여기서만 갱신(Win/Loss 기반, 직접 setter 없음).
create or replace function public.admin_ai_agent_record_outcome(p_agent_code text, p_win boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_agent public.ai_agents;
begin
  perform public._admin_growth_guard();
  select * into v_agent from public.ai_agents where agent_code = p_agent_code;
  if v_agent.id is null then raise exception 'agent not found' using errcode='P0002'; end if;
  update public.ai_agents set
    decisions = decisions + 1,
    wins = wins + case when p_win then 1 else 0 end,
    losses = losses + case when p_win then 0 else 1 end,
    -- Reputation = win_rate 로 수렴(Outcome 기반, 0~100 clamp).
    reputation = least(100, greatest(0, round(100.0 * (wins + case when p_win then 1 else 0 end) / nullif(decisions+1,0)))),
    updated_at = now()
  where agent_code = p_agent_code returning * into v_agent;
  insert into public.ai_governance_events(source_type, source_id, event_type, actor_id, evidence, governance_decision)
  values ('agent', p_agent_code, 'reputation_update', auth.uid(), jsonb_build_array(jsonb_build_object('label','win','value',p_win)), case when p_win then 'win' else 'loss' end);
  return to_jsonb(v_agent);
end; $$;
grant execute on function public.admin_ai_agent_record_outcome(text, boolean) to authenticated;
