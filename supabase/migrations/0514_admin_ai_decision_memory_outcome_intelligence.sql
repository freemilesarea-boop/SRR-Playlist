-- 0514_admin_ai_decision_memory_outcome_intelligence.sql
-- Phase AI-OPS-11 — Enterprise Decision Memory, Outcome Intelligence & Institutional Learning.
--
-- 실제 Decision/Outcome 구조 분석 결과(추측 없음):
--   Recommendation/Decision 원본(전부 실존 확인): ai_operations(0504 approve/reject),
--   ai_execution_plans(0505), ai_reliability_decisions(0507 freeze/rollback/release/certification),
--   ai_capacity_plans(0508), ai_operational_work_items/escalations(0509),
--   ai_security_access_reviews/ai_privacy_requests/ai_compliance_controls(0510),
--   ai_executive_recommendations(0503)/ai_executive_decisions(0511),
--   ai_policy_recommendations(0512), ai_knowledge_reviews(0513),
--   ai_incidents/ai_recovery_candidates(0502).
--   Observation 원본: ai_post_change_observations + metrics(0506).
--   Audit 원본: ai_*_events/ai_*_audit + payout_reveal_audit(0061).
--
-- 학습 정직성(전부 강제):
--   * 승인 ≠ 성공. 실행 Reference ≠ 실제 실행 검증. 외부 성공 보고 ≠ 내부 검증 완료.
--   * decided ≠ 실행 완료. evaluated ≠ 인과 확정. 관찰 종료 전 closed 금지(서버 차단).
--   * baseline/actual 없으면 계산 금지(0 대체 금지). 표본 부족 시 일반화 금지.
--   * Decision Quality 는 절차·근거 품질 평가 — 인사 평가 용도 아님.
--   * 자동 의사결정/승인/실행/모델 학습/Weight·Prompt·Trust 변경 없음. Trigger 없음.
--   * 원본 Recommendation/Decision/Outcome 테이블 미변경(참조 기록만). 삭제 RPC 없음.
--   * 민감 원문/Token/Secret/계좌/개인정보/계약 원문 저장 금지 — 요약(summary)만.

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Decision Memory — 추천→사람 결정 기록(원본 복제 아님 — 요약+참조).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_memory (
  id                  uuid primary key default gen_random_uuid(),
  decision_code       text not null unique,
  decision_domain     text not null check (decision_domain in ('operations','execution','reliability','release','capacity','cost','continuity','security','privacy','compliance','executive','strategy','policy','knowledge_graph','incident','recovery','governance','manual')),
  decision_type       text not null check (decision_type in ('accept_recommendation','reject_recommendation','defer_decision','request_more_evidence','retain_current_state','approve_reference','reject_reference','correction_recommended','risk_accepted_reference','freeze_reference','rollback_reference','release_reference','policy_reference','access_reference','privacy_reference','security_reference','executive_reference','manual')),
  source_system       text not null check (source_system in ('ai_operations','ai_execution_plans','ai_reliability_decisions','ai_capacity_plans','ai_operational_work_items','ai_operational_escalations','ai_security_access_reviews','ai_privacy_requests','ai_compliance_controls','ai_executive_recommendations','ai_executive_decisions','ai_policy_recommendations','ai_knowledge_reviews','ai_incidents','ai_recovery_candidates','manual_decision')),
  source_reference_id uuid,                                   -- 수동 연결(ID 동일만으로 자동 연결 금지)
  recommendation_summary text,                                -- 요약만(원본 payload 무제한 복제 금지)
  decision_summary    text not null,
  decision_status     text not null default 'draft' check (decision_status in ('draft','pending_review','waiting_evidence','decided','execution_reference_pending','observation_pending','outcome_review_pending','evaluated','invalidated','cancelled','expired')),
  decision_reason     text,
  decision_maker_id   uuid,
  reviewer_id         uuid,
  approver_id         uuid,
  self_approval_warning boolean not null default false,       -- approver = maker 경고(차단 아님)
  decision_at         timestamptz,
  expected_outcome    jsonb,                                  -- {metric,direction,target,acceptable_range,horizon,confidence,assumptions,unknown_factors} — 없으면 null(expected_outcome_unavailable)
  confidence_at_decision numeric check (confidence_at_decision is null or (confidence_at_decision >= 0 and confidence_at_decision <= 100)),
  risk_at_decision    text,
  alternatives        jsonb not null default '[]'::jsonb,
  preconditions       jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["decided ≠ 실행 완료","evaluated ≠ 인과 확정","인사 평가 용도 아님"]'::jsonb,
  evidence            jsonb not null default '[]'::jsonb,
  source_version      text not null default 'dmem_v1(0514)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_dmem on public.ai_decision_memory (decision_domain, decision_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Execution Reference — 외부 실행 참고 기록(실행 기능 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_execution_references (
  id                  uuid primary key default gen_random_uuid(),
  decision_memory_id  uuid not null references public.ai_decision_memory(id),
  action_type         text not null,
  execution_system    text not null,
  external_reference  text,
  performed_by        uuid,
  performed_at        timestamptz,
  reported_result     text,
  verification_status text not null default 'reference_recorded' check (verification_status in ('reference_recorded','verification_pending','externally_reported_success','externally_reported_failure','internally_observed_effect','partially_verified','execution_unverified','invalidated')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["외부 실행 Reference — 내부 검증 완료 아님"]'::jsonb,
  source_version      text not null default 'dmem_v1(0514)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_dmem_exec on public.ai_decision_execution_references (decision_memory_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Observation Window — baseline/관찰 기록(운영 설정 변경 없음).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_observation_windows (
  id                  uuid primary key default gen_random_uuid(),
  decision_memory_id  uuid not null references public.ai_decision_memory(id),
  observation_type    text not null,
  baseline_start_at   timestamptz,
  baseline_end_at     timestamptz,
  observation_start_at timestamptz not null,
  observation_end_at  timestamptz not null,
  metric_definitions  jsonb not null default '[]'::jsonb,
  baseline_values     jsonb,                                  -- 없으면 null(baseline_unavailable — 0 대체 금지)
  expected_values     jsonb,
  actual_values       jsonb,
  data_coverage       numeric check (data_coverage is null or (data_coverage >= 0 and data_coverage <= 100)),
  observation_status  text not null default 'planned' check (observation_status in ('planned','baseline_collecting','observing','observation_incomplete','ready_for_review','closed','invalidated','insufficient_data')),
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["관찰 기록 — 운영 설정 미변경","기간 종료 전 확정 금지"]'::jsonb,
  closed_at           timestamptz,
  input_hash          text,
  source_version      text not null default 'dmem_v1(0514)',
  created_by          uuid,
  created_at          timestamptz not null default now(),
  check (observation_end_at > observation_start_at),
  check (baseline_end_at is null or baseline_start_at is null or baseline_end_at > baseline_start_at)
);
create index if not exists idx_dmem_obs on public.ai_decision_observation_windows (decision_memory_id, observation_status);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Outcome — Expected vs Actual/인과/재현성/품질/Lesson(사람 검토 필수).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_decision_outcomes (
  id                  uuid primary key default gen_random_uuid(),
  decision_memory_id  uuid not null references public.ai_decision_memory(id),
  observation_window_id uuid references public.ai_decision_observation_windows(id),
  outcome_status      text not null default 'pending' check (outcome_status in ('pending','observation_incomplete','positive','mixed','neutral','negative','inconclusive','invalidated','insufficient_data')),
  expected_vs_actual  jsonb,                                  -- metric 별 판정(exceeded/met/…/insufficient_data)
  benefit_summary     text,
  risk_realized       text,
  unintended_effects  jsonb not null default '[]'::jsonb,
  metric_results      jsonb not null default '[]'::jsonb,
  confidence_after_observation numeric check (confidence_after_observation is null or (confidence_after_observation >= 0 and confidence_after_observation <= 100)),
  causality_status    text not null default 'not_evaluated' check (causality_status in ('not_evaluated','temporally_correlated','scope_correlated','plausible_contribution','causality_unverified','confounded','unrelated','insufficient_data')),
  repeatability_status text not null default 'not_evaluated' check (repeatability_status in ('not_evaluated','single_observation','partially_repeated','consistently_observed','inconsistent','repeatability_unverified','insufficient_data')),
  decision_quality    text check (decision_quality is null or decision_quality in ('well_supported','adequately_supported','partially_supported','weakly_supported','unsupported','insufficient_data')),
  outcome_score       numeric check (outcome_score is null or (outcome_score >= 0 and outcome_score <= 100)),
  lessons_learned     jsonb,                                  -- {context,what_worked,what_did_not,unknown_factors,reusable_insight,non_reusable_conditions,future_preconditions}
  lesson_status       text not null default 'draft' check (lesson_status in ('draft','pending_review','validated_reference','rejected','invalidated')),
  outcome_review_status text not null default 'pending' check (outcome_review_status in ('pending','waiting_observation','waiting_evidence','reviewed','accepted_reference','rejected','invalidated')),
  reviewer_id         uuid,
  reviewed_at         timestamptz,
  evidence            jsonb not null default '[]'::jsonb,
  limitations         jsonb not null default '["positive ≠ 인과 확정","단일 성공 ≠ 재현 보장","인사 평가 용도 아님"]'::jsonb,
  source_version      text not null default 'dmem_v1(0514)',
  idempotency_key     text not null unique,
  created_by          uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists idx_dmem_out on public.ai_decision_outcomes (decision_memory_id, outcome_status);

create table if not exists public.ai_decision_memory_events (
  id                  uuid primary key default gen_random_uuid(),
  event_type          text not null check (event_type in ('decision_memory_created','recommendation_linked','human_review_started','evidence_requested','decision_recorded','execution_reference_added','execution_verification_updated','observation_window_created','baseline_recorded','observation_started','observation_completed','outcome_review_started','outcome_recorded','causality_reviewed','repeatability_reviewed','lesson_drafted','lesson_validated_reference','external_outcome_reference','decision_memory_invalidated')),
  ref_id              uuid,
  detail              text,
  payload             jsonb,
  actor_id            uuid,
  created_at          timestamptz not null default now()
);
create index if not exists idx_dmem_evt on public.ai_decision_memory_events (event_type, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 5) 요약.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_memory_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'decisions_total', (select count(*) from public.ai_decision_memory),
    'decisions_by_status', (select coalesce(jsonb_object_agg(decision_status, n), '{}'::jsonb) from (select decision_status, count(*) n from public.ai_decision_memory group by decision_status) x),
    'decisions_by_domain', (select coalesce(jsonb_object_agg(decision_domain, n), '{}'::jsonb) from (select decision_domain, count(*) n from public.ai_decision_memory group by decision_domain) x),
    'decisions_without_execution_ref', (select count(*) from public.ai_decision_memory d where decision_status in ('decided','execution_reference_pending') and not exists (select 1 from public.ai_decision_execution_references r where r.decision_memory_id = d.id)),
    'decisions_without_observation', (select count(*) from public.ai_decision_memory d where decision_status not in ('draft','pending_review','waiting_evidence','cancelled','invalidated') and not exists (select 1 from public.ai_decision_observation_windows w where w.decision_memory_id = d.id)),
    'execution_refs_by_status', (select coalesce(jsonb_object_agg(verification_status, n), '{}'::jsonb) from (select verification_status, count(*) n from public.ai_decision_execution_references group by verification_status) x),
    'observations_by_status', (select coalesce(jsonb_object_agg(observation_status, n), '{}'::jsonb) from (select observation_status, count(*) n from public.ai_decision_observation_windows group by observation_status) x),
    'outcomes_by_status', (select coalesce(jsonb_object_agg(outcome_status, n), '{}'::jsonb) from (select outcome_status, count(*) n from public.ai_decision_outcomes group by outcome_status) x),
    'lessons_by_status', (select coalesce(jsonb_object_agg(lesson_status, n), '{}'::jsonb) from (select lesson_status, count(*) n from public.ai_decision_outcomes where lessons_learned is not null group by lesson_status) x),
    -- 원본 실측(참조만 — 미변경):
    'source_counts', jsonb_build_object(
      'ai_operations', (select count(*) from public.ai_operations),
      'ai_operations_decided', (select count(*) from public.ai_operations where status in ('approved','rejected')),
      'ai_executive_decisions', (select count(*) from public.ai_executive_decisions),
      'ai_policy_recommendations', (select count(*) from public.ai_policy_recommendations),
      'ai_knowledge_reviews', (select count(*) from public.ai_knowledge_reviews),
      'ai_reliability_decisions', (select count(*) from public.ai_reliability_decisions),
      'ai_post_change_observations', (select count(*) from public.ai_post_change_observations),
      'ai_incidents', (select count(*) from public.ai_incidents)
    ),
    'no_auto_decision', true, 'no_auto_training', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) 기록 조회/생성/결정.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_memory_records(p_domain text default null, p_status text default null, p_limit int default 100, p_offset int default 0)
returns setof public.ai_decision_memory language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_decision_memory
    where (p_domain is null or decision_domain = p_domain) and (p_status is null or decision_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200) offset greatest(coalesce(p_offset, 0), 0);
end $$;

create or replace function public.admin_decision_memory_detail(p_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'decision', to_jsonb(d),
    'execution_references', (select coalesce(jsonb_agg(to_jsonb(r) order by r.created_at), '[]'::jsonb) from (select * from public.ai_decision_execution_references where decision_memory_id = p_id limit 50) r),
    'observation_windows', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at), '[]'::jsonb) from (select * from public.ai_decision_observation_windows where decision_memory_id = p_id limit 20) w),
    'outcomes', (select coalesce(jsonb_agg(to_jsonb(o) order by o.created_at), '[]'::jsonb) from (select * from public.ai_decision_outcomes where decision_memory_id = p_id limit 20) o),
    'timeline', (select coalesce(jsonb_agg(jsonb_build_object('event_type', e.event_type, 'detail', e.detail, 'actor_id', e.actor_id, 'created_at', e.created_at) order by e.created_at), '[]'::jsonb)
        from (select * from public.ai_decision_memory_events where ref_id = p_id order by created_at limit 100) e)
  ) into v from public.ai_decision_memory d where d.id = p_id;
  if v is null then raise exception 'decision 없음'; end if;
  return v;
end $$;

create or replace function public.admin_decision_memory_create(
  p_code text, p_domain text, p_type text, p_source_system text, p_decision_summary text,
  p_evidence jsonb, p_source_reference_id uuid default null, p_recommendation_summary text default null,
  p_expected_outcome jsonb default null, p_confidence numeric default null, p_risk text default null,
  p_alternatives jsonb default '[]'::jsonb, p_preconditions jsonb default '[]'::jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_linked boolean := false;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_decision_summary is null or btrim(p_decision_summary) = '' then raise exception 'decision_summary 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수(빈 배열 금지)'; end if;
  if pg_column_size(p_evidence) > 32768 or pg_column_size(coalesce(p_expected_outcome, '{}'::jsonb)) > 16384 then raise exception 'payload 크기 초과'; end if;
  if p_source_system = 'manual_decision' and p_source_reference_id is not null then raise exception 'manual_decision 은 source_reference 없음'; end if;
  -- source 실존 검증(수동 연결 — ID 동일만으로 자동 연결 금지, 명시 지정 시에만 검증 후 연결)
  if p_source_reference_id is not null then
    if (p_source_system = 'ai_operations' and not exists (select 1 from public.ai_operations where id = p_source_reference_id))
      or (p_source_system = 'ai_executive_decisions' and not exists (select 1 from public.ai_executive_decisions where id = p_source_reference_id))
      or (p_source_system = 'ai_executive_recommendations' and not exists (select 1 from public.ai_executive_recommendations where id = p_source_reference_id))
      or (p_source_system = 'ai_policy_recommendations' and not exists (select 1 from public.ai_policy_recommendations where id = p_source_reference_id))
      or (p_source_system = 'ai_knowledge_reviews' and not exists (select 1 from public.ai_knowledge_reviews where id = p_source_reference_id))
      or (p_source_system = 'ai_reliability_decisions' and not exists (select 1 from public.ai_reliability_decisions where id = p_source_reference_id))
      or (p_source_system = 'ai_incidents' and not exists (select 1 from public.ai_incidents where id = p_source_reference_id))
      or (p_source_system = 'ai_recovery_candidates' and not exists (select 1 from public.ai_recovery_candidates where id = p_source_reference_id))
    then raise exception 'source_reference 실존 검증 실패: %', p_source_system; end if;
    v_linked := true;
  end if;
  select id into v_id from public.ai_decision_memory where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_decision_memory (decision_code, decision_domain, decision_type, source_system, source_reference_id, recommendation_summary, decision_summary, decision_status, expected_outcome, confidence_at_decision, risk_at_decision, alternatives, preconditions, evidence, idempotency_key, created_by)
  values (p_code, p_domain, p_type, p_source_system, p_source_reference_id, left(coalesce(p_recommendation_summary, ''), 2000), left(p_decision_summary, 2000), 'pending_review', p_expected_outcome, p_confidence, p_risk, coalesce(p_alternatives, '[]'::jsonb), coalesce(p_preconditions, '[]'::jsonb), p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('decision_memory_created', v_id, p_code || ' (' || p_domain || '/' || p_type || ')', v_uid);
  if v_linked then insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('recommendation_linked', v_id, p_source_system || ':' || p_source_reference_id, v_uid); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'decision_status', 'pending_review', 'executed', false, 'production_applied', false);
end $$;

create or replace function public.admin_decision_memory_decide(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_cur text; v_maker uuid; v_warn boolean := false;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('pending_review','waiting_evidence','decided','execution_reference_pending','observation_pending','outcome_review_pending','evaluated','invalidated','cancelled','expired') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select decision_status, created_by into v_cur, v_maker from public.ai_decision_memory where id = p_id for update;
  if v_cur is null then raise exception 'decision 없음'; end if;
  if v_cur in ('invalidated','cancelled','expired') then raise exception '종결 상태(%)에서 재결정 불가', v_cur; end if;
  if p_status = 'decided' and v_maker = v_uid then v_warn := true; end if;   -- Self approval 경고(차단 아님)
  update public.ai_decision_memory
     set decision_status = p_status, decision_reason = p_reason,
         decision_maker_id = case when p_status = 'decided' then v_uid else decision_maker_id end,
         approver_id = case when p_status = 'decided' then v_uid else approver_id end,
         self_approval_warning = self_approval_warning or v_warn,
         decision_at = case when p_status = 'decided' then now() else decision_at end,
         updated_at = now()
   where id = p_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'decided' then 'decision_recorded' when p_status = 'waiting_evidence' then 'evidence_requested' when p_status = 'invalidated' then 'decision_memory_invalidated' else 'human_review_started' end, p_id, v_cur || ' → ' || p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'decision_status', p_status, 'self_approval_warning', v_warn, 'executed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Execution Reference(참고 기록 — 실행 기능 없음).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_execution_reference_add(
  p_code text, p_decision_id uuid, p_action_type text, p_execution_system text,
  p_reported_result text, p_evidence jsonb, p_external_reference text default null, p_performed_at timestamptz default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_decision_memory where id = p_decision_id) then raise exception 'decision 없음'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if pg_column_size(p_evidence) > 32768 then raise exception 'evidence 32KB 초과'; end if;
  select id into v_id from public.ai_decision_execution_references where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_decision_execution_references (decision_memory_id, action_type, execution_system, external_reference, performed_by, performed_at, reported_result, verification_status, evidence, idempotency_key, created_by)
  values (p_decision_id, p_action_type, p_execution_system, p_external_reference, v_uid, p_performed_at, left(coalesce(p_reported_result, ''), 1000), 'reference_recorded', p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('execution_reference_added', p_decision_id, p_action_type || ' @ ' || p_execution_system || ' — 실행 검증 아님', v_uid);
  return jsonb_build_object('ok', true, 'id', v_id, 'verification_status', 'reference_recorded', 'internally_verified', false, 'production_applied', false);
end $$;

create or replace function public.admin_decision_execution_verification_update(p_id uuid, p_status text, p_reason text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_dec uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('verification_pending','externally_reported_success','externally_reported_failure','internally_observed_effect','partially_verified','execution_unverified','invalidated') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select decision_memory_id into v_dec from public.ai_decision_execution_references where id = p_id for update;
  if v_dec is null then raise exception 'reference 없음'; end if;
  update public.ai_decision_execution_references set verification_status = p_status where id = p_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('execution_verification_updated', v_dec, p_status || ' — ' || left(p_reason, 200) || ' (외부 성공 보고 ≠ 내부 검증 완료)', v_uid);
  return jsonb_build_object('ok', true, 'verification_status', p_status, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) Observation Window(종료 전 closed 서버 차단).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_observation_create(
  p_decision_id uuid, p_observation_type text, p_start timestamptz, p_end timestamptz,
  p_metric_definitions jsonb, p_baseline_start timestamptz default null, p_baseline_end timestamptz default null,
  p_baseline_values jsonb default null, p_expected_values jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_decision_memory where id = p_decision_id) then raise exception 'decision 없음'; end if;
  if p_end <= p_start then raise exception 'observation 기간 오류(end ≤ start)'; end if;
  if p_metric_definitions is null or jsonb_typeof(p_metric_definitions) <> 'array' or jsonb_array_length(p_metric_definitions) = 0 then raise exception 'metric_definitions 필수'; end if;
  if jsonb_array_length(p_metric_definitions) > 30 then raise exception 'metric 30개 제한'; end if;
  if pg_column_size(p_metric_definitions) > 16384 or pg_column_size(coalesce(p_baseline_values, '{}'::jsonb)) > 16384 then raise exception 'payload 크기 초과'; end if;
  insert into public.ai_decision_observation_windows (decision_memory_id, observation_type, baseline_start_at, baseline_end_at, observation_start_at, observation_end_at, metric_definitions, baseline_values, expected_values, observation_status, created_by)
  values (p_decision_id, p_observation_type, p_baseline_start, p_baseline_end, p_start, p_end, p_metric_definitions, p_baseline_values, p_expected_values,
          case when p_baseline_values is not null then 'observing' else 'planned' end, v_uid)
  returning id into v_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('observation_window_created', p_decision_id, p_observation_type || ' (' || p_start || ' ~ ' || p_end || ')', v_uid);
  if p_baseline_values is not null then insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('baseline_recorded', p_decision_id, 'baseline 기록', v_uid); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'production_applied', false);
end $$;

create or replace function public.admin_decision_observation_update(
  p_id uuid, p_status text, p_reason text, p_actual_values jsonb default null, p_data_coverage numeric default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_dec uuid; v_end timestamptz; v_cur text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_status not in ('baseline_collecting','observing','observation_incomplete','ready_for_review','closed','invalidated','insufficient_data') then raise exception '허용되지 않는 상태: %', p_status; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  if p_data_coverage is not null and (p_data_coverage < 0 or p_data_coverage > 100) then raise exception 'data_coverage 0~100'; end if;
  select decision_memory_id, observation_end_at, observation_status into v_dec, v_end, v_cur from public.ai_decision_observation_windows where id = p_id for update;
  if v_dec is null then raise exception 'observation 없음'; end if;
  if v_cur in ('closed','invalidated') then raise exception '종결 상태에서 변경 불가'; end if;
  if p_status = 'closed' and now() < v_end then raise exception '관찰 기간 종료 전 closed 금지(종료: %)', v_end; end if;
  update public.ai_decision_observation_windows
     set observation_status = p_status,
         actual_values = coalesce(p_actual_values, actual_values),
         data_coverage = coalesce(p_data_coverage, data_coverage),
         closed_at = case when p_status = 'closed' then now() else closed_at end
   where id = p_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id)
  values (case when p_status = 'closed' then 'observation_completed' else 'observation_started' end, v_dec, p_status || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'observation_status', p_status, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 9) Outcome 기록/검토 + Lesson(사람 검토 Reference 필수).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_outcome_record(
  p_code text, p_decision_id uuid, p_outcome_status text, p_evidence jsonb,
  p_observation_id uuid default null, p_expected_vs_actual jsonb default null, p_metric_results jsonb default '[]'::jsonb,
  p_causality text default 'not_evaluated', p_repeatability text default 'not_evaluated',
  p_decision_quality text default null, p_outcome_score numeric default null,
  p_benefit text default null, p_risk_realized text default null, p_lessons jsonb default null
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_obs_status text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if not exists (select 1 from public.ai_decision_memory where id = p_decision_id) then raise exception 'decision 없음'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if p_observation_id is not null then
    select observation_status into v_obs_status from public.ai_decision_observation_windows where id = p_observation_id;
    if v_obs_status is null then raise exception 'observation 없음'; end if;
    if p_outcome_status in ('positive','mixed','neutral','negative') and v_obs_status <> 'closed' then
      raise exception '관찰 미종료(%) — 결과 확정 금지(observation_incomplete/pending 만 허용)', v_obs_status;
    end if;
  elsif p_outcome_status in ('positive','mixed','neutral','negative') then
    raise exception 'observation window 없이 결과 확정 금지';
  end if;
  if pg_column_size(coalesce(p_metric_results, '[]'::jsonb)) > 32768 or pg_column_size(p_evidence) > 32768 then raise exception 'payload 크기 초과'; end if;
  select id into v_id from public.ai_decision_outcomes where idempotency_key = p_code;
  if v_id is not null then return jsonb_build_object('ok', true, 'id', v_id, 'idempotent', true); end if;
  insert into public.ai_decision_outcomes (decision_memory_id, observation_window_id, outcome_status, expected_vs_actual, metric_results, causality_status, repeatability_status, decision_quality, outcome_score, benefit_summary, risk_realized, lessons_learned, lesson_status, evidence, idempotency_key, created_by)
  values (p_decision_id, p_observation_id, p_outcome_status, p_expected_vs_actual, coalesce(p_metric_results, '[]'::jsonb), coalesce(p_causality, 'not_evaluated'), coalesce(p_repeatability, 'not_evaluated'), p_decision_quality, p_outcome_score, p_benefit, p_risk_realized, p_lessons, case when p_lessons is not null then 'draft' else 'draft' end, p_evidence, p_code, v_uid)
  returning id into v_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('outcome_recorded', p_decision_id, p_outcome_status || ' (positive ≠ 인과 확정)', v_uid);
  if p_lessons is not null then insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id) values ('lesson_drafted', p_decision_id, 'lesson draft', v_uid); end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'causality_confirmed', false, 'production_applied', false);
end $$;

create or replace function public.admin_decision_outcome_review(p_id uuid, p_review_status text, p_reason text, p_lesson_status text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_dec uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_review_status not in ('waiting_observation','waiting_evidence','reviewed','accepted_reference','rejected','invalidated') then raise exception '허용되지 않는 상태: %', p_review_status; end if;
  if p_lesson_status is not null and p_lesson_status not in ('pending_review','validated_reference','rejected','invalidated') then raise exception '허용되지 않는 lesson 상태'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception '사유 필수'; end if;
  select decision_memory_id into v_dec from public.ai_decision_outcomes where id = p_id for update;
  if v_dec is null then raise exception 'outcome 없음'; end if;
  update public.ai_decision_outcomes
     set outcome_review_status = p_review_status, lesson_status = coalesce(p_lesson_status, lesson_status),
         reviewer_id = v_uid, reviewed_at = now(), updated_at = now()
   where id = p_id;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, actor_id)
  values (case when p_lesson_status = 'validated_reference' then 'lesson_validated_reference' else 'outcome_review_started' end, v_dec, p_review_status || coalesce('/lesson:' || p_lesson_status, '') || ' — ' || left(p_reason, 200), v_uid);
  return jsonb_build_object('ok', true, 'outcome_review_status', p_review_status, 'production_applied', false);
end $$;

create or replace function public.admin_decision_external_outcome_reference(p_decision_id uuid, p_action_type text, p_reason text, p_evidence jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action_type not in ('execution_completed_reference','execution_failed_reference','metric_verified_reference','revenue_confirmed_reference','contract_outcome_reference','settlement_outcome_reference','deployment_outcome_reference','rollback_outcome_reference','security_outcome_reference','privacy_outcome_reference','manual_outcome_reference') then raise exception '허용되지 않는 action_type'; end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_evidence is null or jsonb_typeof(p_evidence) <> 'array' or jsonb_array_length(p_evidence) = 0 then raise exception 'Evidence 필수'; end if;
  if not exists (select 1 from public.ai_decision_memory where id = p_decision_id) then raise exception 'decision 없음'; end if;
  insert into public.ai_decision_memory_events (event_type, ref_id, detail, payload, actor_id)
  values ('external_outcome_reference', p_decision_id, p_action_type || ' — ' || left(p_reason, 200), jsonb_build_object('evidence', p_evidence), v_uid);
  return jsonb_build_object('ok', true, 'reference_only', true, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 10) 조회.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_decision_execution_references(p_limit int default 100)
returns setof public.ai_decision_execution_references language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_decision_execution_references order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_decision_observations(p_status text default null, p_limit int default 100)
returns setof public.ai_decision_observation_windows language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_decision_observation_windows
    where (p_status is null or observation_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_decision_outcomes(p_status text default null, p_limit int default 100)
returns setof public.ai_decision_outcomes language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_decision_outcomes
    where (p_status is null or outcome_status = p_status)
    order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 200);
end $$;

create or replace function public.admin_decision_memory_audit(p_limit int default 100)
returns setof public.ai_decision_memory_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_decision_memory_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_decision_memory enable row level security;
alter table public.ai_decision_execution_references enable row level security;
alter table public.ai_decision_observation_windows enable row level security;
alter table public.ai_decision_outcomes enable row level security;
alter table public.ai_decision_memory_events enable row level security;

comment on table public.ai_decision_memory is 'AI-OPS-11 — Decision Memory(요약+참조 — 원본 복제/변경 없음). decided ≠ 실행, evaluated ≠ 인과 확정.';
comment on table public.ai_decision_execution_references is 'AI-OPS-11 — 외부 실행 참고 기록(실행 기능 없음 — 외부 성공 보고 ≠ 내부 검증).';
comment on table public.ai_decision_observation_windows is 'AI-OPS-11 — 관찰 창(종료 전 closed 서버 차단 · baseline 없으면 null — 0 대체 금지).';
comment on table public.ai_decision_outcomes is 'AI-OPS-11 — Outcome/인과/재현성/품질/Lesson(positive ≠ 인과 확정 · 인사 평가 아님).';
comment on table public.ai_decision_memory_events is 'AI-OPS-11 — Decision Memory Audit(event_type whitelist 19종).';
