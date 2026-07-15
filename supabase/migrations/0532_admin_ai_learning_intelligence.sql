-- 0532_admin_ai_learning_intelligence.sql
-- Phase AI-OPS-29 — Enterprise Learning Intelligence, Continuous Improvement &
-- Organizational Optimization Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Learning 원본: ai_organizational_learnings/patterns/evidence(0515).
--   Memory 원본: ai_org_memory(0531 — lesson_learned/retrospective).
--   Outcome 원본: ai_decision_outcomes(0514). 정책 원본: ai_enterprise_policies(0512).
--   전부 읽기 전용 참조(AI-OPS-1~28 데이터 원본 미변경).
--   교육/HR/조직 협업 도구 원본 없음(실측) → learning_unverified 유지.
--
-- Learning 정직성(전부 강제):
--   * Improvement/Optimization 자동 적용/정책·조직 규칙·전략 자동 변경 없음.
--   * Learning ≠ Correctness. Improvement ≠ Adoption. Optimization ≠ Better Outcome.
--   * Maturity ≠ Organizational Success. Recommendation ≠ Organizational Decision.
--   * Learning 상태는 candidate/approved/archived/unknown 4종만 — 생성 시 candidate 강제
--     (Adoption/승인은 사람 review RPC 로만 — 서버 강제). Evidence 없는 approved 금지.
--   * Timeline 7단계(issue→learning→improvement→validation→approval→adoption→outcome)
--     는 기록이며 완료 보장 아님. approval/adoption 기록은 Human Required.
--   * Unknown 유지(null→0 금지). 표본 부족 sample_too_small. Trigger 없음 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Organizational Learning Registry — 사람 기록만(candidate 강제 시작).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_learning_registry (
  id                  uuid primary key default gen_random_uuid(),
  learning_code       text not null unique,
  learning_kind       text not null check (learning_kind in ('learning_record','improvement_candidate','optimization_candidate','retrospective','lesson_learned','organizational_insight')),
  optimization_domain text check (optimization_domain is null or optimization_domain in ('process','operational','strategy','ai')),
  title               text not null,
  content             text,
  linked_memory_ids   jsonb not null default '[]'::jsonb,        -- ai_org_memory(0531) 실존 검증
  linked_learning_ids jsonb not null default '[]'::jsonb,        -- 관계 참조(인과 주장 아님)
  learning_status     text not null default 'candidate' check (learning_status in ('candidate','approved','archived','unknown')),
  adoption_recorded   boolean not null default false,            -- 사람 승인 Adoption 기록 여부(적용 보장 아님)
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Learning ≠ Correctness","Improvement ≠ Adoption","Optimization ≠ Better Outcome"]'::jsonb,
  source_version      text not null default 'learning_v1(0532)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_learning_reg on public.ai_learning_registry (learning_kind, learning_status, created_at desc);

-- Improvement/Optimization/Evolution/Effectiveness/Timeline/Maturity/Graph/Briefing/권고/Audit 는 Event 통합(테이블 최소화 — 신규 테이블 2개뿐).
create table if not exists public.ai_learning_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('learning_recorded','learning_reviewed','learning_approved','learning_archive_candidate_noted','improvement_timeline_recorded','improvement_validated_note','adoption_recorded','optimization_candidate_noted','organizational_evolution_analyzed','learning_effectiveness_measured','organizational_maturity_evaluated','learning_graph_analyzed','learning_briefing_recorded','learning_recommendation_created','external_learning_reference','learning_review_noted')),
  ref_id              uuid,
  stage               text check (stage is null or stage in ('issue','learning','improvement','validation','approval','adoption','outcome')),   -- Timeline 7단계
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_learn_evt on public.ai_learning_events (event_type, created_at desc);
create index if not exists idx_learn_evt_ref on public.ai_learning_events (ref_id, stage, created_at asc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 요약 — 학습/개선 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'registry_total', (select count(*) from public.ai_learning_registry),
    'registry_by_kind', (select coalesce(jsonb_object_agg(learning_kind, n), '{}'::jsonb) from (select learning_kind, count(*) n from public.ai_learning_registry group by learning_kind) x),
    'registry_by_status', (select coalesce(jsonb_object_agg(learning_status, n), '{}'::jsonb) from (select learning_status, count(*) n from public.ai_learning_registry group by learning_status) x),
    'adoption_recorded_count', (select count(*) from public.ai_learning_registry where adoption_recorded = true),
    -- 학습 계층 실측(0515/0531/0514/0512 참조 — 원본 미변경):
    'learning_actuals', jsonb_build_object(
      'org_learnings_0515', (select count(*) from public.ai_organizational_learnings),
      'learning_patterns_0515', (select count(*) from public.ai_organizational_learning_patterns),
      'policy_evolution_candidates_0515', (select count(*) from public.ai_policy_evolution_candidates),
      'org_memory_0531', (select count(*) from public.ai_org_memory),
      'lessons_0531', (select count(*) from public.ai_org_memory where memory_kind in ('lesson_learned','retrospective')),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'enterprise_policies_0512', (select count(*) from public.ai_enterprise_policies)
    ),
    'learning_unavailable', jsonb_build_array('training_platform','hr_learning_records','collaboration_tool_analytics','external_benchmark_maturity'),   -- 원본 없음(실측)
    'no_auto_improvement_apply', true, 'no_auto_optimization_apply', true, 'no_auto_policy_change', true,
    'learning_is_not_correctness', true, 'improvement_is_not_adoption', true, 'maturity_is_not_success', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Learning 기록·검토·Adoption — 사람 RPC 만(candidate 강제 시작).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_register_create(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_content text default null, p_domain text default null,
  p_memory_ids jsonb default '[]'::jsonb, p_learning_ids jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 기록 — 자동 생성 없음)'; end if;
  if p_kind not in ('learning_record','improvement_candidate','optimization_candidate','retrospective','lesson_learned','organizational_insight') then raise exception '허용되지 않는 learning_kind'; end if;
  if p_domain is not null and p_domain not in ('process','operational','strategy','ai') then raise exception '허용되지 않는 optimization_domain'; end if;
  if p_kind = 'optimization_candidate' and p_domain is null then raise exception 'optimization_candidate 는 domain(process/operational/strategy/ai) 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(learning_unverified 방지)'; end if;
  v_cnt := jsonb_array_length(coalesce(p_memory_ids, '[]'::jsonb));
  if v_cnt > 20 or jsonb_array_length(coalesce(p_learning_ids, '[]'::jsonb)) > 20 then raise exception '연결 20개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_org_memory m where m.id in (select (jsonb_array_elements_text(p_memory_ids))::uuid);
    if v_found <> v_cnt then raise exception 'memory(0531) 실존 검증 실패'; end if;
  end if;
  v_cnt := jsonb_array_length(coalesce(p_learning_ids, '[]'::jsonb));
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_learning_registry l where l.id in (select (jsonb_array_elements_text(p_learning_ids))::uuid);
    if v_found <> v_cnt then raise exception 'learning 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_learning_registry where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  -- learning_status 는 candidate 로 강제 시작(자동 승인/적용 금지)
  insert into public.ai_learning_registry (learning_code, learning_kind, optimization_domain, title, content, linked_memory_ids, linked_learning_ids, evidence, idempotency_key, created_by)
  values (p_code, p_kind, p_domain, left(p_title, 200), p_content, coalesce(p_memory_ids, '[]'::jsonb), coalesce(p_learning_ids, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_learning_events (event_type, ref_id, detail, actor_id)
  values (case when p_kind = 'optimization_candidate' then 'optimization_candidate_noted' else 'learning_recorded' end, v_id, p_code || ' (' || p_kind || ') — candidate 시작(자동 적용 아님)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'learning_status', 'candidate', 'auto_applied', false, 'production_applied', false);
end $$;

create or replace function public.admin_learning_register_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_ev int; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('candidate','approved','archived','unknown') then raise exception 'Learning 상태는 candidate/approved/archived/unknown 4종만'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(자동 승인/적용 없음)'; end if;
  select learning_status, created_by, jsonb_array_length(evidence) into v_cur, v_creator, v_ev from public.ai_learning_registry where id = p_id for update;
  if v_cur is null then raise exception 'learning 없음'; end if;
  if v_cur = 'archived' then raise exception '종결 상태(archived)에서 재결정 불가(삭제 없음 — 보존)'; end if;
  if p_status = 'approved' and v_ev = 0 then raise exception 'Evidence 없음 — 승인 금지(learning_unverified)'; end if;
  if v_creator is not null and v_creator = v_uid and p_status = 'approved' then
    v_warnings := jsonb_build_array('self_review_warning: 기록자와 승인자가 동일');
  end if;
  update public.ai_learning_registry
     set learning_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500), updated_at = now()
   where id = p_id;
  v_evt := case when p_status = 'approved' then 'learning_approved' when p_status = 'archived' then 'learning_archive_candidate_noted' else 'learning_reviewed' end;
  insert into public.ai_learning_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (사람 승인 — 적용 보장 아님)', v_uid);
  return jsonb_build_object('ok', true, 'learning_status', p_status, 'warnings', v_warnings, 'auto_applied', false, 'production_applied', false);
end $$;

create or replace function public.admin_learning_adoption_record(p_id uuid, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Adoption 사유 필수(Human Required)'; end if;
  select learning_status into v_cur from public.ai_learning_registry where id = p_id for update;
  if v_cur is null then raise exception 'learning 없음'; end if;
  -- Adoption 기록은 approved(사람 승인) 이후에만 — Improvement ≠ Adoption 강제
  if v_cur <> 'approved' then raise exception 'approved 상태에서만 Adoption 기록 가능(Improvement ≠ Adoption)'; end if;
  update public.ai_learning_registry
     set adoption_recorded = true, reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500), updated_at = now()
   where id = p_id;
  insert into public.ai_learning_events (event_type, ref_id, stage, detail, actor_id) values ('adoption_recorded', p_id, 'adoption', left(p_reason, 200) || ' (사람 승인 Adoption 기록 — 적용 결과 보장 아님)', v_uid);
  return jsonb_build_object('ok', true, 'adoption_recorded', true, 'human_approved', true, 'outcome_guaranteed', false, 'production_applied', false);
end $$;

create or replace function public.admin_learning_register_list(p_kind text default null, p_limit int default 100)
returns setof public.ai_learning_registry language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_learning_registry where (p_kind is null or learning_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Improvement Timeline — Issue→Learning→Improvement→Validation→Approval→
--    Adoption→Outcome(기록만 — 완료 보장 아님).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_timeline_record(p_learning_id uuid, p_stage text, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_stage not in ('issue','learning','improvement','validation','approval','adoption','outcome') then raise exception '허용되지 않는 stage(7단계)'; end if;
  if p_note is null or btrim(p_note) = '' then raise exception '기록 내용 필수'; end if;
  if not exists (select 1 from public.ai_learning_registry where id = p_learning_id) then raise exception 'learning 실존 검증 실패'; end if;
  insert into public.ai_learning_events (event_type, ref_id, stage, detail, actor_id)
  values ('improvement_timeline_recorded', p_learning_id, p_stage, left(p_note, 300) || case when p_stage in ('approval','adoption') then ' (Human Required)' else '' end || ' (기록 — 완료 보장 아님)', v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'stage', p_stage, 'stage_completed_guarantee', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Governance Event / Audit — Evolution/Effectiveness/Maturity/Graph/
--    Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_learning_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('improvement_validated_note','organizational_evolution_analyzed','learning_effectiveness_measured','organizational_maturity_evaluated','learning_graph_analyzed','learning_briefing_recorded','learning_recommendation_created','external_learning_reference','learning_review_noted','optimization_candidate_noted') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_learning_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'organizational_evolution_analyzed' then ' (Evolution — 사실 단정 아님)'
      when p_kind = 'learning_effectiveness_measured' then ' (Coverage 실측만)'
      when p_kind = 'organizational_maturity_evaluated' then ' (Maturity ≠ Organizational Success)'
      when p_kind = 'learning_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'learning_graph_analyzed' then ' (Cycle 감지 — 인과 주장 없음)'
      when p_kind = 'optimization_candidate_noted' then ' (후보 — 자동 적용 아님)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'improvement_applied', false, 'optimization_applied', false, 'policy_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_learning_audit(p_limit int default 100)
returns setof public.ai_learning_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_learning_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_learning_registry enable row level security;
alter table public.ai_learning_events enable row level security;

comment on table public.ai_learning_registry is 'AI-OPS-29 — Learning Registry(사람 기록만 — candidate 강제 시작·4상태·Adoption 은 approved 후 사람 기록·삭제 없음).';
comment on table public.ai_learning_events is 'AI-OPS-29 — Learning Audit(event_type whitelist 16종·Timeline 7단계·Evolution/Effectiveness/Maturity/Graph 통합).';
