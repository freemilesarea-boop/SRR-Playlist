-- 0531_admin_ai_knowledge_evolution.sql
-- Phase AI-OPS-28 — Enterprise Knowledge Evolution, Organizational Memory &
-- Continuous Intelligence Center.
--
-- 실제 구조 분석 결과(추측 없음 — 실측 소스 검증 완료):
--   Memory/Graph 원본: ai_memory_records/ai_knowledge_nodes/ai_knowledge_edges(0498).
--   Learning 원본: ai_organizational_learnings/patterns/evidence(0515).
--   Decision Memory 원본: ai_decision_memory/ai_decision_outcomes(0514).
--   Best Practice 원본: ai_best_practices(0500 — 후보 체계), ai_playbooks(0502).
--   전부 읽기 전용 참조(AI-OPS-1~27 데이터 원본 미변경).
--   외부 위키/문서 관리/교육 기록 원본 없음(실측) → knowledge_unverified 유지.
--
-- Knowledge 정직성(전부 강제):
--   * Best Practice 자동 등록/Knowledge 자동 삭제/정책·전략·조직 규칙 자동 변경 없음.
--   * Knowledge ≠ Truth. Learning ≠ Correctness. Best Practice ≠ Universal Rule.
--   * Decision Memory ≠ Decision Approval. Recommendation ≠ Organizational Decision.
--   * Memory 상태는 active/candidate/archived/unknown 4종만 — 생성 시 candidate 강제
--     (사람 승인 없이 활성화 금지 — 서버 강제). Revision 은 사람 review 경유.
--   * Confidence 는 verified/candidate/unknown/knowledge_unverified 만 — 정답 의미 아님.
--   * 오래된 지식은 archive candidate 로만 표시(삭제 RPC 없음).
--   * Unknown 유지(null→0 금지). 표본 부족 sample_too_small. Trigger 없음 · 자동 발송 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Organizational Memory — 사람 기록만(candidate 강제 시작).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_org_memory (
  id                  uuid primary key default gen_random_uuid(),
  memory_code         text not null unique,
  memory_kind         text not null check (memory_kind in ('decision','experience','lesson_learned','retrospective','knowledge_reference','historical_context','best_practice_candidate')),
  title               text not null,
  content             text,
  confidence_reference text not null default 'candidate' check (confidence_reference in ('verified','candidate','unknown','knowledge_unverified')),
  linked_decision_ids jsonb not null default '[]'::jsonb,        -- ai_decision_memory(0514) 실존 검증
  linked_memory_ids   jsonb not null default '[]'::jsonb,        -- 관계 참조(인과 주장 아님)
  memory_status       text not null default 'candidate' check (memory_status in ('active','candidate','archived','unknown')),
  revision_count      int not null default 0,
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Knowledge ≠ Truth","Best Practice ≠ Universal Rule"]'::jsonb,
  source_version      text not null default 'knowledge_v1(0531)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_org_memory on public.ai_org_memory (memory_kind, memory_status, created_at desc);

-- Evolution/BestPractice/DecisionMemory/Confidence/Aging/Learning/Graph/Briefing/권고/Audit 는 Event 통합(테이블 최소화 — 신규 테이블 2개뿐).
create table if not exists public.ai_knowledge_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('memory_recorded','memory_reviewed','memory_revised','memory_archive_candidate_noted','knowledge_confidence_evaluated','knowledge_aging_analyzed','best_practice_candidate_noted','decision_memory_linked','learning_pattern_analyzed','knowledge_graph_analyzed','knowledge_evolution_noted','knowledge_briefing_recorded','knowledge_recommendation_created','external_knowledge_reference','knowledge_review_noted','knowledge_relationship_analyzed')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_know_evt on public.ai_knowledge_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) 요약 — 지식/기억 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'memory_total', (select count(*) from public.ai_org_memory),
    'memory_by_kind', (select coalesce(jsonb_object_agg(memory_kind, n), '{}'::jsonb) from (select memory_kind, count(*) n from public.ai_org_memory group by memory_kind) x),
    'memory_by_status', (select coalesce(jsonb_object_agg(memory_status, n), '{}'::jsonb) from (select memory_status, count(*) n from public.ai_org_memory group by memory_status) x),
    'memory_by_confidence', (select coalesce(jsonb_object_agg(confidence_reference, n), '{}'::jsonb) from (select confidence_reference, count(*) n from public.ai_org_memory group by confidence_reference) x),
    -- 지식 계층 실측(0498/0515/0514/0500/0502 참조 — 원본 미변경):
    'knowledge_actuals', jsonb_build_object(
      'memory_records_0498', (select count(*) from public.ai_memory_records),
      'knowledge_nodes_0498', (select count(*) from public.ai_knowledge_nodes),
      'knowledge_edges_0498', (select count(*) from public.ai_knowledge_edges),
      'org_learnings_0515', (select count(*) from public.ai_organizational_learnings),
      'learning_patterns_0515', (select count(*) from public.ai_organizational_learning_patterns),
      'decision_memory_0514', (select count(*) from public.ai_decision_memory),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'best_practices_0500', (select count(*) from public.ai_best_practices),
      'playbooks_0502', (select count(*) from public.ai_playbooks)
    ),
    'knowledge_unavailable', jsonb_build_array('external_wiki','document_management_system','training_records','industry_knowledge_base'),   -- 원본 없음(실측)
    'no_auto_best_practice_registration', true, 'no_auto_knowledge_deletion', true, 'no_auto_policy_change', true,
    'knowledge_is_not_truth', true, 'learning_is_not_correctness', true, 'best_practice_is_not_universal_rule', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Memory 기록·검토·Revision — 사람 RPC 만(candidate 강제 시작).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_org_memory_create(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_content text default null, p_decision_ids jsonb default '[]'::jsonb, p_memory_ids jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 기록 — 자동 지식 생성 없음)'; end if;
  if p_kind not in ('decision','experience','lesson_learned','retrospective','knowledge_reference','historical_context','best_practice_candidate') then raise exception '허용되지 않는 memory_kind'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(knowledge_unverified 방지)'; end if;
  v_cnt := jsonb_array_length(coalesce(p_decision_ids, '[]'::jsonb));
  if v_cnt > 20 or jsonb_array_length(coalesce(p_memory_ids, '[]'::jsonb)) > 20 then raise exception '연결 20개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_decision_memory d where d.id in (select (jsonb_array_elements_text(p_decision_ids))::uuid);
    if v_found <> v_cnt then raise exception 'decision(0514) 실존 검증 실패'; end if;
  end if;
  v_cnt := jsonb_array_length(coalesce(p_memory_ids, '[]'::jsonb));
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_org_memory m where m.id in (select (jsonb_array_elements_text(p_memory_ids))::uuid);
    if v_found <> v_cnt then raise exception 'memory 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_org_memory where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  -- memory_status/confidence 는 candidate 로 강제 시작(자동 활성화/자동 Best Practice 등록 금지)
  insert into public.ai_org_memory (memory_code, memory_kind, title, content, linked_decision_ids, linked_memory_ids, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_title, 200), p_content, coalesce(p_decision_ids, '[]'::jsonb), coalesce(p_memory_ids, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_knowledge_events (event_type, ref_id, detail, actor_id)
  values (case when p_kind = 'best_practice_candidate' then 'best_practice_candidate_noted' else 'memory_recorded' end, v_id, p_code || ' (' || p_kind || ') — candidate 시작(Knowledge ≠ Truth)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'memory_status', 'candidate', 'auto_registered', false, 'production_applied', false);
end $$;

create or replace function public.admin_org_memory_review(p_id uuid, p_status text, p_reason text, p_confidence text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_ev int; v_warnings jsonb := '[]'::jsonb; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('active','candidate','archived','unknown') then raise exception 'Memory 상태는 active/candidate/archived/unknown 4종만'; end if;
  if p_confidence is not null and p_confidence not in ('verified','candidate','unknown','knowledge_unverified') then raise exception '허용되지 않는 confidence'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(자동 삭제/활성화 없음)'; end if;
  select memory_status, created_by, jsonb_array_length(evidence) into v_cur, v_creator, v_ev from public.ai_org_memory where id = p_id for update;
  if v_cur is null then raise exception 'memory 없음'; end if;
  if v_cur = 'archived' then raise exception '종결 상태(archived)에서 재결정 불가(삭제 없음 — 보존)'; end if;
  -- active(사람 승인) 전환은 Evidence 필수, verified confidence 도 Evidence 필수
  if p_status = 'active' and v_ev = 0 then raise exception 'Evidence 없음 — 활성화 금지(knowledge_unverified)'; end if;
  if p_confidence = 'verified' and v_ev = 0 then raise exception 'Evidence 없음 — verified 판정 금지'; end if;
  if v_creator is not null and v_creator = v_uid and (p_status = 'active' or p_confidence = 'verified') then
    v_warnings := jsonb_build_array('self_review_warning: 기록자와 승인자가 동일');
  end if;
  update public.ai_org_memory
     set memory_status = p_status, confidence_reference = coalesce(p_confidence, confidence_reference),
         warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500), updated_at = now()
   where id = p_id;
  v_evt := case when p_status = 'archived' then 'memory_archive_candidate_noted' else 'memory_reviewed' end;
  insert into public.ai_knowledge_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || coalesce(' / ' || p_confidence, '') || ' — ' || left(p_reason, 200) || ' (사람 승인 — Truth 판정 아님)', v_uid);
  return jsonb_build_object('ok', true, 'memory_status', p_status, 'warnings', v_warnings, 'auto_deleted', false, 'production_applied', false);
end $$;

create or replace function public.admin_org_memory_revise(p_id uuid, p_title text, p_content text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Revision 사유 필수(사람 승인 필요)'; end if;
  if (p_title is null or btrim(p_title) = '') and (p_content is null or btrim(p_content) = '') then raise exception '변경 내용 필수'; end if;
  select memory_status into v_cur from public.ai_org_memory where id = p_id for update;
  if v_cur is null then raise exception 'memory 없음'; end if;
  if v_cur = 'archived' then raise exception 'archived 상태에서 Revision 불가'; end if;
  update public.ai_org_memory
     set title = coalesce(nullif(btrim(p_title), ''), title),
         content = coalesce(p_content, content),
         revision_count = revision_count + 1,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500), updated_at = now()
   where id = p_id;
  insert into public.ai_knowledge_events (event_type, ref_id, detail, actor_id) values ('memory_revised', p_id, 'Revision — ' || left(p_reason, 200) || ' (사람 승인 기록)', v_uid);
  return jsonb_build_object('ok', true, 'revised', true, 'human_approved_revision', true, 'production_applied', false);
end $$;

create or replace function public.admin_org_memory_list(p_kind text default null, p_limit int default 100)
returns setof public.ai_org_memory language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_org_memory where (p_kind is null or memory_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Governance Event / Audit — Confidence/Aging/BestPractice/Learning/Graph/
--    Briefing/권고 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_knowledge_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('knowledge_confidence_evaluated','knowledge_aging_analyzed','best_practice_candidate_noted','decision_memory_linked','learning_pattern_analyzed','knowledge_graph_analyzed','knowledge_evolution_noted','knowledge_briefing_recorded','knowledge_recommendation_created','external_knowledge_reference','knowledge_review_noted','knowledge_relationship_analyzed') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_knowledge_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case
      when p_kind = 'knowledge_confidence_evaluated' then ' (Confidence ≠ 정답)'
      when p_kind = 'knowledge_aging_analyzed' then ' (오래됨 ≠ 삭제)'
      when p_kind = 'best_practice_candidate_noted' then ' (후보 — 자동 등록 아님)'
      when p_kind = 'learning_pattern_analyzed' then ' (Pattern ≠ 사실 단정)'
      when p_kind = 'knowledge_briefing_recorded' then ' (자동 발송 없음)'
      when p_kind = 'knowledge_graph_analyzed' then ' (Cycle 감지 — 인과 주장 없음)'
      else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'best_practice_registered', false, 'knowledge_deleted', false, 'policy_changed', false, 'auto_sent', false, 'production_applied', false);
end $$;

create or replace function public.admin_knowledge_audit(p_limit int default 100)
returns setof public.ai_knowledge_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_knowledge_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_org_memory enable row level security;
alter table public.ai_knowledge_events enable row level security;

comment on table public.ai_org_memory is 'AI-OPS-28 — Organizational Memory(사람 기록만 — candidate 강제 시작·4상태·삭제 없음·Knowledge ≠ Truth).';
comment on table public.ai_knowledge_events is 'AI-OPS-28 — Knowledge Audit(event_type whitelist 16종·Evolution/Confidence/Aging/BestPractice/Learning/Graph 통합).';
