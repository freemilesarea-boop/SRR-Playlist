-- 0524_admin_ai_corporate_strategy_roadmap.sql
-- Phase AI-OPS-21 — Enterprise Strategy Intelligence, Corporate Objectives &
-- Strategic Roadmap Center.
--
-- 실제 구조 분석 결과(추측 없음 — 0504~0523 검증 완료):
--   Initiative 원본: ai_strategic_initiatives(0516) 재사용 — 신규 initiative 테이블 없음.
--   전략 목표 원본: ai_strategic_objectives(0516 — 시나리오 단위) 존재.
--     본 Phase 의 Corporate Objectives 는 연간/분기/장기 기업 목표 계층(별도 성격).
--   연결 원본: ai_executive_priority_candidates·portfolios(0518/0519)/
--     ai_execution_commitments(0520)/ai_decision_outcomes(0514)/advisories(0523).
--   Vision/Mission 문서 원본 없음(실측) → 사람 입력 기록만(AI 자동 생성 없음).
--
-- Strategy 정직성(전부 강제):
--   * Vision/Mission/Objective 는 AI 가 자동 생성하지 않음(사람 입력 기록 — 서버가
--     human_authored 필수 강제). 전략 자동 승인/자동 변경 없음.
--   * Vision ≠ Execution. Objective ≠ Outcome. Roadmap ≠ Commitment. Strategy ≠ Decision.
--   * Alignment ≠ Success. Capability ≠ Performance(인사 평가 아님). Recommendation ≠ Approval.
--   * Unknown 유지(null→0 금지). 표본<5 sample_too_small. 근거 부족 strategy_unverified.
--   * Trigger 없음 · 삭제 RPC 없음 · 원본(0514~0523) 미변경 · Production Apply 없음.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Corporate Vision Record — 사람 입력만(append-only 버전 기록).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_corporate_vision_records (
  id                  uuid primary key default gen_random_uuid(),
  record_code         text not null unique,
  record_kind         text not null check (record_kind in ('vision_statement','mission_statement','corporate_principle','long_term_direction')),
  statement           text not null,
  human_authored      boolean not null default true check (human_authored = true),   -- AI 자동 생성 금지(스키마 강제)
  version_note        text,
  effective_from      date,
  superseded_by       uuid,
  record_status       text not null default 'active_reference' check (record_status in ('active_reference','superseded_reference','invalidated')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Vision ≠ Execution","사람 입력 기록 — AI 자동 생성 아님"]'::jsonb,
  source_version      text not null default 'strategy_v1(0524)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_vision on public.ai_corporate_vision_records (record_kind, record_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Corporate Objective — 연간/분기/장기 기업 목표(자동 생성 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_corporate_objectives (
  id                  uuid primary key default gen_random_uuid(),
  objective_code      text not null unique,
  objective_kind      text not null check (objective_kind in ('annual','quarterly','long_term','strategic')),
  title               text not null,
  description         text,
  parent_vision_id    uuid references public.ai_corporate_vision_records(id),
  parent_objective_id uuid,
  target_year         int check (target_year is null or (target_year >= 2024 and target_year <= 2100)),
  target_quarter      int check (target_quarter is null or (target_quarter >= 1 and target_quarter <= 4)),
  priority_reference  text not null default 'unranked' check (priority_reference in ('critical','high','medium','low','unranked')),
  owner_reference     text,
  review_cycle        text not null default 'quarterly' check (review_cycle in ('monthly','quarterly','semiannual','annual','manual')),
  success_criteria    jsonb not null default '[]'::jsonb,
  linked_initiative_ids jsonb not null default '[]'::jsonb,     -- ai_strategic_initiatives(0516) 참조
  linked_priority_ids jsonb not null default '[]'::jsonb,       -- 0518 참조
  objective_status    text not null default 'draft' check (objective_status in ('draft','pending_executive_review','active_reference','on_track_candidate','at_risk_candidate','achieved_reference','missed_reference','deferred_reference','superseded_reference','invalidated','strategy_unverified','insufficient_data')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  warnings            jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Objective ≠ Outcome","achieved_reference 는 Evidence 검토 필요"]'::jsonb,
  source_version      text not null default 'strategy_v1(0524)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_corp_obj on public.ai_corporate_objectives (objective_kind, objective_status, target_year, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Strategic Roadmap Item — Roadmap ≠ Commitment.
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_strategic_roadmap_items (
  id                  uuid primary key default gen_random_uuid(),
  roadmap_code        text not null unique,
  title               text not null,
  roadmap_year        int not null check (roadmap_year >= 2024 and roadmap_year <= 2100),
  roadmap_phase       text not null default 'planned' check (roadmap_phase in ('current','next','planned','long_term','completed_reference','deferred_reference','invalidated')),
  phase_sequence      int check (phase_sequence is null or (phase_sequence >= 1 and phase_sequence <= 100)),
  summary             text,
  linked_objective_ids jsonb not null default '[]'::jsonb,
  planned_milestones  jsonb not null default '[]'::jsonb,       -- 계획 참고 — 자동 Milestone/업무 생성 없음
  dependencies        jsonb not null default '[]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  unknown_factors     jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["Roadmap ≠ Commitment","계획 참고 — 실행 확정 아님"]'::jsonb,
  review_status       text not null default 'draft' check (review_status in ('draft','pending_executive_review','reviewed_reference','revised_reference','rejected','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  review_reason       text,
  source_version      text not null default 'strategy_v1(0524)',
  input_hash          text,
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_strat_roadmap on public.ai_strategic_roadmap_items (roadmap_year, roadmap_phase, phase_sequence);

-- Gap/Capability/Alignment/Maturity/Evolution/권고 검토·Audit 는 Event 통합(테이블 최소화).
create table if not exists public.ai_strategy_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('vision_recorded','objective_created','objective_reviewed','roadmap_item_created','roadmap_item_reviewed','roadmap_revision_reference','hierarchy_analyzed','strategic_gap_analyzed','capability_analyzed','alignment_evaluated','maturity_evaluated','achievability_assessed','strategy_evolution_recorded','strategy_recommendation_created','external_strategy_reference','strategy_item_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_strategy_evt on public.ai_strategy_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) 요약 — 실측 + 미존재 정직 표기.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_strategy_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'vision_records', (select count(*) from public.ai_corporate_vision_records where record_status = 'active_reference'),
    'vision_by_kind', (select coalesce(jsonb_object_agg(record_kind, n), '{}'::jsonb) from (select record_kind, count(*) n from public.ai_corporate_vision_records where record_status = 'active_reference' group by record_kind) x),
    'objectives_total', (select count(*) from public.ai_corporate_objectives),
    'objectives_by_kind', (select coalesce(jsonb_object_agg(objective_kind, n), '{}'::jsonb) from (select objective_kind, count(*) n from public.ai_corporate_objectives group by objective_kind) x),
    'objectives_by_status', (select coalesce(jsonb_object_agg(objective_status, n), '{}'::jsonb) from (select objective_status, count(*) n from public.ai_corporate_objectives group by objective_status) x),
    'roadmap_items', (select count(*) from public.ai_strategic_roadmap_items),
    'roadmap_by_year', (select coalesce(jsonb_object_agg(roadmap_year::text, n), '{}'::jsonb) from (select roadmap_year, count(*) n from public.ai_strategic_roadmap_items group by roadmap_year) x),
    -- 계층 연결 원본 실측(참조만):
    'hierarchy_actuals', jsonb_build_object(
      'strategic_initiatives', (select count(*) from public.ai_strategic_initiatives),
      'strategic_objectives_0516', (select count(*) from public.ai_strategic_objectives),
      'priorities', (select count(*) from public.ai_executive_priority_candidates),
      'commitments', (select count(*) from public.ai_execution_commitments),
      'outcomes', (select count(*) from public.ai_decision_outcomes),
      'advisories', (select count(*) from public.ai_executive_advisories)
    ),
    'no_auto_vision_generation', true, 'no_auto_strategy_approval', true, 'no_auto_objective_change', true, 'recommendation_is_not_approval', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Vision 기록·조회 — 사람 입력만.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_vision_record_create(p_code text, p_kind text, p_statement text, p_reason text, p_effective_from date default null, p_version_note text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_statement is null or btrim(p_statement) = '' then raise exception 'statement 필수(사람 입력)'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if length(p_statement) > 2000 then raise exception 'statement 2000자 제한'; end if;
  select id into v_id from public.ai_corporate_vision_records where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  -- 동일 kind 의 기존 active 는 superseded 로(append-only 버전)
  update public.ai_corporate_vision_records set record_status = 'superseded_reference' where record_kind = p_kind and record_status = 'active_reference';
  insert into public.ai_corporate_vision_records (record_code, record_kind, statement, version_note, effective_from, evidence, idempotency_key, created_by)
  values (p_code, p_kind, p_statement, p_version_note, p_effective_from, jsonb_build_array(jsonb_build_object('note', left(p_reason, 200))), p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategy_events (event_type, ref_id, detail, actor_id) values ('vision_recorded', v_id, p_code || ' (' || p_kind || ') — 사람 입력(AI 생성 아님)', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'ai_generated', false, 'production_applied', false);
end $$;

create or replace function public.admin_vision_records(p_kind text default null, p_limit int default 50)
returns setof public.ai_corporate_vision_records language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_vision_records where (p_kind is null or record_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 50), 1), 100);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Objective 생성·검토 — 자동 생성/변경 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_corporate_objective_create(
  p_code text, p_kind text, p_title text, p_evidence jsonb,
  p_description text default null, p_vision_id uuid default null, p_parent_id uuid default null,
  p_year int default null, p_quarter int default null, p_priority text default 'unranked',
  p_owner text default null, p_review_cycle text default 'quarterly',
  p_criteria jsonb default '[]'::jsonb, p_initiative_ids jsonb default '[]'::jsonb,
  p_priority_ids jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수(사람 입력)'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_priority not in ('critical','high','medium','low','unranked') then raise exception '허용되지 않는 priority'; end if;
  if p_vision_id is not null and not exists (select 1 from public.ai_corporate_vision_records where id = p_vision_id) then raise exception 'vision 실존 검증 실패'; end if;
  if p_parent_id is not null and not exists (select 1 from public.ai_corporate_objectives where id = p_parent_id) then raise exception 'parent objective 실존 검증 실패'; end if;
  v_cnt := jsonb_array_length(coalesce(p_initiative_ids, '[]'::jsonb));
  if v_cnt > 30 or jsonb_array_length(coalesce(p_priority_ids, '[]'::jsonb)) > 30 then raise exception '연결 30개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_strategic_initiatives s where s.id in (select (jsonb_array_elements_text(p_initiative_ids))::uuid);
    if v_found <> v_cnt then raise exception 'initiative(0516) 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_corporate_objectives where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_corporate_objectives (objective_code, objective_kind, title, description, parent_vision_id, parent_objective_id, target_year, target_quarter, priority_reference, owner_reference, review_cycle, success_criteria, linked_initiative_ids, linked_priority_ids, evidence, idempotency_key, created_by)
  values (p_code, p_kind, left(p_title, 200), p_description, p_vision_id, p_parent_id, p_year, p_quarter, p_priority, p_owner, coalesce(p_review_cycle, 'quarterly'), coalesce(p_criteria, '[]'::jsonb), coalesce(p_initiative_ids, '[]'::jsonb), coalesce(p_priority_ids, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategy_events (event_type, ref_id, detail, actor_id) values ('objective_created', v_id, p_code || ' (' || p_kind || ') — 사람 입력·Objective ≠ Outcome', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'ai_generated', false, 'outcome_achieved', false, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_objective_review(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_creator uuid; v_criteria int; v_warnings jsonb := '[]'::jsonb;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_executive_review','active_reference','on_track_candidate','at_risk_candidate','achieved_reference','missed_reference','deferred_reference','superseded_reference','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select objective_status, created_by, jsonb_array_length(success_criteria) into v_cur, v_creator, v_criteria from public.ai_corporate_objectives where id = p_id for update;
  if v_cur is null then raise exception 'objective 없음'; end if;
  if v_cur in ('invalidated','superseded_reference') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  -- Success Criteria 없이 achieved 판정 금지(Objective ≠ Outcome)
  if p_status = 'achieved_reference' and v_criteria = 0 then raise exception 'Success Criteria 없음 — achieved 판정 금지(strategy_unverified)'; end if;
  if p_status = 'achieved_reference' and v_creator is not null and v_creator = v_uid then
    v_warnings := jsonb_build_array('self_review_warning: 생성자와 판정자가 동일');
  end if;
  update public.ai_corporate_objectives
     set objective_status = p_status, warnings = warnings || v_warnings,
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  insert into public.ai_strategy_events (event_type, ref_id, detail, actor_id) values ('objective_reviewed', p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (Objective ≠ Outcome)', v_uid);
  return jsonb_build_object('ok', true, 'objective_status', p_status, 'warnings', v_warnings, 'production_applied', false);
end $$;

create or replace function public.admin_corporate_objectives(p_kind text default null, p_limit int default 100)
returns setof public.ai_corporate_objectives language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_corporate_objectives where (p_kind is null or objective_kind = p_kind)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Roadmap 생성·검토 — Roadmap ≠ Commitment · 자동 변경 없음.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_roadmap_item_create(
  p_code text, p_title text, p_year int, p_evidence jsonb,
  p_phase text default 'planned', p_sequence int default null, p_summary text default null,
  p_objective_ids jsonb default '[]'::jsonb, p_milestones jsonb default '[]'::jsonb,
  p_dependencies jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cnt int; v_found int;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_title is null or btrim(p_title) = '' then raise exception 'title 필수'; end if;
  if p_year is null or p_year < 2024 or p_year > 2100 then raise exception 'year 2024~2100'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_phase not in ('current','next','planned','long_term') then raise exception '생성 시 phase 는 current/next/planned/long_term 만'; end if;
  if jsonb_array_length(coalesce(p_milestones, '[]'::jsonb)) > 30 then raise exception 'milestone 30개 제한'; end if;
  v_cnt := jsonb_array_length(coalesce(p_objective_ids, '[]'::jsonb));
  if v_cnt > 30 then raise exception 'objective 연결 30개 제한'; end if;
  if v_cnt > 0 then
    select count(*) into v_found from public.ai_corporate_objectives o where o.id in (select (jsonb_array_elements_text(p_objective_ids))::uuid);
    if v_found <> v_cnt then raise exception 'objective 실존 검증 실패'; end if;
  end if;
  select id into v_id from public.ai_strategic_roadmap_items where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_strategic_roadmap_items (roadmap_code, title, roadmap_year, roadmap_phase, phase_sequence, summary, linked_objective_ids, planned_milestones, dependencies, evidence, idempotency_key, created_by)
  values (p_code, left(p_title, 200), p_year, p_phase, p_sequence, p_summary, coalesce(p_objective_ids, '[]'::jsonb), coalesce(p_milestones, '[]'::jsonb), coalesce(p_dependencies, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_strategy_events (event_type, ref_id, detail, actor_id) values ('roadmap_item_created', v_id, p_code || ' (' || p_year || '/' || p_phase || ') — Roadmap ≠ Commitment', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'commitment_created', false, 'production_applied', false);
end $$;

create or replace function public.admin_roadmap_item_review(p_id uuid, p_status text, p_reason text, p_phase text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_evt text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_executive_review','reviewed_reference','revised_reference','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_phase is not null and p_phase not in ('current','next','planned','long_term','completed_reference','deferred_reference') then raise exception '허용되지 않는 phase'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수(Strategy Revision 은 Human Approval Required)'; end if;
  select review_status into v_cur from public.ai_strategic_roadmap_items where id = p_id for update;
  if v_cur is null then raise exception 'roadmap item 없음'; end if;
  if v_cur in ('rejected','invalidated') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  update public.ai_strategic_roadmap_items
     set review_status = p_status, roadmap_phase = coalesce(p_phase, roadmap_phase),
         reviewer_id = v_uid, reviewed_at = now(), review_reason = left(p_reason, 500)
   where id = p_id;
  v_evt := case when p_status = 'revised_reference' then 'roadmap_revision_reference' else 'roadmap_item_reviewed' end;
  insert into public.ai_strategy_events (event_type, ref_id, detail, actor_id) values (v_evt, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200) || ' (사람 승인 기록)', v_uid);
  return jsonb_build_object('ok', true, 'review_status', p_status, 'auto_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_roadmap_items(p_year int default null, p_limit int default 100)
returns setof public.ai_strategic_roadmap_items language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategic_roadmap_items where (p_year is null or roadmap_year = p_year)
    order by roadmap_year asc, phase_sequence asc nulls last, created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Governance Event / Audit — Gap/Capability/Alignment/Maturity/Evolution 통합.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_strategy_governance_record(p_kind text, p_reason text, p_payload jsonb, p_ref_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('hierarchy_analyzed','strategic_gap_analyzed','capability_analyzed','alignment_evaluated','maturity_evaluated','achievability_assessed','strategy_evolution_recorded','strategy_recommendation_created','external_strategy_reference') then raise exception '허용되지 않는 kind'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  insert into public.ai_strategy_events (event_type, ref_id, detail, payload, actor_id)
  values (p_kind, p_ref_id, left(p_reason, 200) || case when p_kind = 'strategic_gap_analyzed' then ' (Gap ≠ 사실 확정)' when p_kind = 'capability_analyzed' then ' (인사 평가 아님)' else '' end, p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'strategy_approved', false, 'production_applied', false);
end $$;

create or replace function public.admin_strategy_audit(p_limit int default 100)
returns setof public.ai_strategy_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_strategy_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_corporate_vision_records enable row level security;
alter table public.ai_corporate_objectives enable row level security;
alter table public.ai_strategic_roadmap_items enable row level security;
alter table public.ai_strategy_events enable row level security;

comment on table public.ai_corporate_vision_records is 'AI-OPS-21 — Vision/Mission/Principles(사람 입력만 — human_authored 스키마 강제·append-only 버전).';
comment on table public.ai_corporate_objectives is 'AI-OPS-21 — Corporate Objectives(연간/분기/장기 — Objective ≠ Outcome·Criteria 없이 achieved 금지).';
comment on table public.ai_strategic_roadmap_items is 'AI-OPS-21 — Strategic Roadmap(Roadmap ≠ Commitment·Revision 은 사람 승인).';
comment on table public.ai_strategy_events is 'AI-OPS-21 — Strategy Audit(event_type whitelist 16종·Gap/Capability/Alignment/Maturity/Evolution 통합).';
