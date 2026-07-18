-- 0555_admin_ai_enterprise_mission_intelligence.sql
-- AI-OPS-51 — Enterprise Mission Intelligence, Objective Alignment &
-- Strategic Outcome Center.
--
-- Enterprise Vision → Enterprise Mission → Strategic Objectives → Enterprise
-- OKRs → Cross-Organization Alignment → Initiative Alignment → Execution
-- Alignment → Performance Alignment → Business Outcome Alignment → Mission
-- Drift Detection → Strategic Outcome → Executive Mission Review → Mission
-- Learning → Audit.
--
-- 정직성(전부 서버 강제):
--  * Mission Alignment ≠ Mission Success — Mission/Vision 자동 변경·OKR 자동
--    생성·KPI/Strategy/Governance/Budget/Organization/Portfolio 자동 변경 RPC
--    자체가 없음.
--  * Objective Alignment ≠ Objective Achievement.
--  * Strategic Outcome ≠ Business Success. Mission Drift ≠ Organizational
--    Failure. Alignment Score ≠ Executive Judgment.
--  * Recommendation ≠ Decision. Pattern ≠ Causality. Forecast ≠ Future Fact.
--  * Null → 0 변환 금지. insufficient_data / sample_too_small 유지.
--  * 자동 Merge/Deploy/Rollback/Production 변경 — 없음.
--  * Trigger 없음 · 삭제 RPC 없음 · 기존 0514/0520/0524/0545/0547/0548/0549/
--    0550/0551/0552/0553/0554 원본 무변경(참조만).
--  * OKR 시스템 원장/공식 Mission 헌장 원장은 실측 부재 — insufficient_data
--    로 유지(Vision/Objective 기록은 0524 참조만).
--  * Mission Tree/Alignment History/Outcome Mapping 은 신규 테이블 대신
--    JSONB + Events 통합(후보 다수 → 3 테이블 최소화).

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Enterprise Mission(≠ Mission 변경 원장 — Alignment 관측용 Model).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_missions (
  id                        uuid primary key default gen_random_uuid(),
  mission_code              text not null,
  mission_name              text not null,
  mission_category          text not null check (mission_category in ('enterprise','strategic','financial','customer','product','engineering','operations','ai','security','compliance','esg','innovation','executive','custom')),
  mission_status            text not null default 'draft' check (mission_status in ('draft','candidate','active_reference','archived_reference','insufficient_data')),
  mission_statement         text,
  alignment_status          text not null default 'insufficient_data' check (alignment_status in ('highly_aligned_candidate','aligned_candidate','partially_aligned_candidate','misaligned_candidate','insufficient_data')),
  drift_status              text not null default 'insufficient_data' check (drift_status in ('stable_candidate','watch_candidate','drifting_candidate','critical_drift_candidate','insufficient_data')),
  outcome_status            text not null default 'insufficient_data' check (outcome_status in ('strongly_supported_candidate','adequately_supported_candidate','weakly_supported_candidate','unsupported_candidate','insufficient_data')),
  confidence                int check (confidence is null or (confidence >= 0 and confidence <= 100)),
  strategy_portfolio_id     uuid,
  vision_record_id          uuid,
  mission_tree              jsonb,
  objective_mappings        jsonb not null default '[]'::jsonb,
  okr_mappings              jsonb not null default '[]'::jsonb,
  alignment_result          jsonb,
  initiative_alignment_result jsonb,
  kpi_alignment_result      jsonb,
  portfolio_alignment_result jsonb,
  organization_alignment_result jsonb,
  value_alignment_result    jsonb,
  execution_alignment_result jsonb,
  drift_result              jsonb,
  outcome_result            jsonb,
  trend_result              jsonb,
  coverage_result           jsonb,
  scorecard_result          jsonb,
  alignment_history         jsonb not null default '[]'::jsonb,
  recommendation_candidate  jsonb,
  mission_reviews           jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  learning_references       jsonb not null default '[]'::jsonb,
  assumptions               jsonb not null default '[]'::jsonb,
  unknown_factors           jsonb not null default '[]'::jsonb,
  external_factors          jsonb not null default '[]'::jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aem_idem on public.ai_enterprise_missions (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aem_status on public.ai_enterprise_missions (mission_status, mission_category, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Objective Alignment(§5 — Alignment ≠ Achievement, Evidence 필수).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_objective_alignments (
  id                        uuid primary key default gen_random_uuid(),
  alignment_code            text not null,
  mission_id                uuid not null,
  objective_name            text not null,
  alignment_dimension       text not null check (alignment_dimension in ('strategy_alignment','portfolio_alignment','execution_alignment','kpi_alignment','organization_alignment','business_value_alignment')),
  alignment_status          text not null default 'insufficient_data' check (alignment_status in ('highly_aligned_candidate','aligned_candidate','partially_aligned_candidate','misaligned_candidate','insufficient_data')),
  record_status             text not null default 'recorded' check (record_status in ('recorded','under_review','review_reference_recorded','revision_requested','insufficient_data')),
  target_reference          jsonb,
  evidence                  jsonb not null default '[]'::jsonb,
  review_reference          jsonb,
  limitations               jsonb not null default '[]'::jsonb,
  idempotency_key           text,
  created_by                uuid,
  reviewed_by               uuid,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);
create unique index if not exists uq_aeoa_idem on public.ai_enterprise_objective_alignments (idempotency_key) where idempotency_key is not null;
create index if not exists idx_aeoa_mission on public.ai_enterprise_objective_alignments (mission_id, record_status, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Mission 이벤트(31종) — Objective/OKR Mapping/Alignment/Drift/Outcome/
--    Trend/Coverage/Scorecard/Recommendation/Review/Learning/Link 통합
--    Audit(자동 Mission 변경 이벤트 생성 금지).
-- ─────────────────────────────────────────────────────────────────────────
create table if not exists public.ai_enterprise_mission_events (
  id                        uuid primary key default gen_random_uuid(),
  event_type                text not null check (event_type in ('mission_created','mission_reviewed','strategic_objective_mapped','okr_mapped','initiative_alignment_reviewed','kpi_alignment_reviewed','portfolio_alignment_reviewed','organization_alignment_reviewed','value_alignment_reviewed','execution_alignment_reviewed','mission_alignment_reviewed','mission_drift_reviewed','strategic_outcome_reviewed','alignment_trend_reviewed','objective_coverage_reviewed','objective_alignment_created','objective_alignment_reviewed','objective_alignment_reference_recorded','executive_mission_summary_recorded','executive_mission_scorecard_recorded','mission_recommendation_recorded','mission_review_requested','executive_review_requested','strategic_review_requested','mission_review_reference_recorded','mission_learning_recorded','portfolio_reference_linked','program_reference_linked','kpi_reference_linked','organization_reference_linked','value_reference_linked')),
  mission_id                uuid,
  objective_alignment_id    uuid,
  detail                    text,
  payload                   jsonb,
  actor_id                  uuid,
  created_at                timestamptz not null default now()
);
create index if not exists idx_aeme_evt on public.ai_enterprise_mission_events (event_type, created_at desc);
create index if not exists idx_aeme_mission on public.ai_enterprise_mission_events (mission_id, created_at desc);

-- ─────────────────────────────────────────────────────────────────────────
-- 4) Mission 생성 — 자동 Mission/Vision 변경 계열 구조적 차단.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_mission_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_cat text; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_missions;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_cat := coalesce(p_payload->>'mission_category','');
  -- 자동 Mission/Vision 변경·OKR 자동 생성 계열 — 구조적 차단.
  if v_cat in ('automatic_mission_change','automatic_vision_change','automatic_okr_generation','automatic_strategy_change','automatic_kpi_change') then
    raise exception '금지된 mission_category(자동 Mission/Vision 변경 계열 비활성)';
  end if;
  if v_cat not in ('enterprise','strategic','financial','customer','product','engineering','operations','ai','security','compliance','esg','innovation','executive','custom') then
    raise exception '허용되지 않는 mission_category';
  end if;
  if coalesce(btrim(p_payload->>'mission_name'),'') = '' then raise exception 'mission_name 필수'; end if;
  if nullif(p_payload->>'strategy_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_strategy_portfolios where id = (p_payload->>'strategy_portfolio_id')::uuid) then
    raise exception 'Strategy Portfolio 없음(실존 검증 실패)';
  end if;
  if nullif(p_payload->>'vision_record_id','') is not null
     and not exists (select 1 from public.ai_corporate_vision_records where id = (p_payload->>'vision_record_id')::uuid) then
    raise exception 'Vision Record 없음(실존 검증 실패 — 0524)';
  end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_missions where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'alignment_is_not_mission_success', true); end if;
  end if;
  insert into public.ai_enterprise_missions (mission_code, mission_name, mission_category, mission_statement, strategy_portfolio_id, vision_record_id, mission_tree, assumptions, unknown_factors, external_factors, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'mission_code',''), 'EM-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    left(p_payload->>'mission_name', 200), v_cat,
    nullif(left(coalesce(p_payload->>'mission_statement',''), 2000),''),
    nullif(p_payload->>'strategy_portfolio_id','')::uuid, nullif(p_payload->>'vision_record_id','')::uuid,
    p_payload->'mission_tree',
    coalesce(p_payload->'assumptions', '[]'::jsonb), coalesce(p_payload->'unknown_factors', '[]'::jsonb),
    coalesce(p_payload->'external_factors', '[]'::jsonb), coalesce(p_payload->'evidence', '[]'::jsonb),
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_mission_events (event_type, mission_id, detail, payload, actor_id)
  values ('mission_created', v_id, left(v_cat, 80) || ' (Mission Model — 관측용 Candidate·Mission 변경 아님)', jsonb_build_object('mission_name', p_payload->>'mission_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'draft', 'alignment_is_not_mission_success', true, 'mission_changed', false, 'vision_changed', false, 'okr_generated', false, 'strategy_changed', false, 'kpi_changed', false, 'production_applied', false);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 5) Mission 검토 — review_reference 는 Self 차단 + Evidence 필수.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_mission_review(p_mission_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_missions; v_next text := null; v_note text := ''; v_ref jsonb; v_evt text := 'mission_reviewed';
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_candidate','activate_reference','record_review_reference','archive_reference','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_missions where id = p_mission_id;
  if v_row.id is null then raise exception 'Mission 없음(실존 검증 실패)'; end if;
  if v_row.mission_status = 'archived_reference' then raise exception '종결 상태 재결정 차단(archived_reference)'; end if;

  if p_action = 'mark_candidate' then v_next := 'candidate';
  elsif p_action = 'activate_reference' then v_next := 'active_reference'; v_note := ' (Active Reference ≠ Mission 변경 확정)';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Review ≠ Approval — Mission 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Mission Review Reference 금지';
    end if;
    v_next := v_row.mission_status; v_note := ' (Review Reference ≠ Approval — Mission 변경은 사람)'; v_evt := 'mission_review_reference_recorded';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'review_is_not_approval', true, 'mission_changed', false, 'vision_changed', false, 'strategy_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_missions set review_reference = v_ref, mission_reviews = mission_reviews || jsonb_build_array(v_ref) where id = p_mission_id;
  elsif p_action = 'archive_reference' then v_next := 'archived_reference';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_missions set mission_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_mission_id;
  insert into public.ai_enterprise_mission_events (event_type, mission_id, detail, payload, actor_id)
  values (v_evt, p_mission_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_mission_id, 'status', v_next, 'alignment_is_not_mission_success', true, 'mission_changed', false, 'vision_changed', false, 'strategy_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 6) Objective Alignment 생성/검토(§5 — Alignment ≠ Achievement).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_objective_alignment_create(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_dim text; v_mission public.ai_enterprise_missions; v_idem text := nullif(p_payload->>'idempotency_key',''); v_existing public.ai_enterprise_objective_alignments;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  v_dim := coalesce(p_payload->>'alignment_dimension','');
  if v_dim not in ('strategy_alignment','portfolio_alignment','execution_alignment','kpi_alignment','organization_alignment','business_value_alignment') then
    raise exception '허용되지 않는 alignment_dimension(§5 — 6종)';
  end if;
  if coalesce(btrim(p_payload->>'objective_name'),'') = '' then raise exception 'objective_name 필수'; end if;
  -- Objective Alignment ≠ Objective Achievement — Evidence 없이 기록 차단.
  if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
    raise exception 'Evidence 없는 Objective Alignment 기록 금지';
  end if;
  if nullif(p_payload->>'mission_id','') is null then raise exception 'mission_id 필수'; end if;
  select * into v_mission from public.ai_enterprise_missions where id = (p_payload->>'mission_id')::uuid;
  if v_mission.id is null then raise exception 'Mission 없음(실존 검증 실패)'; end if;
  if v_idem is not null then
    select * into v_existing from public.ai_enterprise_objective_alignments where idempotency_key = v_idem;
    if v_existing.id is not null then return jsonb_build_object('ok', true, 'idempotent', true, 'id', v_existing.id, 'alignment_is_not_achievement', true); end if;
  end if;
  insert into public.ai_enterprise_objective_alignments (alignment_code, mission_id, objective_name, alignment_dimension, target_reference, evidence, limitations, idempotency_key, created_by)
  values (left(coalesce(nullif(p_payload->>'alignment_code',''), 'EOA-' || substr(gen_random_uuid()::text, 1, 8)), 40),
    v_mission.id, left(p_payload->>'objective_name', 200), v_dim,
    p_payload->'target_reference', p_payload->'evidence',
    coalesce(p_payload->'limitations', '[]'::jsonb), v_idem, v_uid)
  returning id into v_id;
  insert into public.ai_enterprise_mission_events (event_type, mission_id, objective_alignment_id, detail, payload, actor_id)
  values ('objective_alignment_created', v_mission.id, v_id, left(v_dim, 80) || ' (Objective Alignment ≠ Objective Achievement)', jsonb_build_object('objective_name', p_payload->>'objective_name'), v_uid);
  return jsonb_build_object('ok', true, 'idempotent', false, 'id', v_id, 'initial_status', 'recorded', 'alignment_is_not_achievement', true, 'mission_changed', false, 'okr_generated', false, 'kpi_changed', false, 'production_applied', false);
end $$;

create or replace function public.admin_enterprise_objective_alignment_review(p_alignment_id uuid, p_action text, p_reason text, p_payload jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_row public.ai_enterprise_objective_alignments; v_next text; v_note text := ''; v_ref jsonb; v_result text := nullif(p_payload->>'result','');
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_action not in ('mark_under_review','record_review_reference','request_revision','mark_insufficient_data') then
    raise exception '허용되지 않는 action';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수(Human Review)'; end if;
  if pg_column_size(p_payload) > 32768 then raise exception 'payload 32KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  select * into v_row from public.ai_enterprise_objective_alignments where id = p_alignment_id;
  if v_row.id is null then raise exception 'Objective Alignment 없음(실존 검증 실패)'; end if;
  if v_row.record_status = 'review_reference_recorded' then raise exception '종결 상태 재결정 차단(review_reference_recorded)'; end if;
  if v_result is not null and v_result not in ('highly_aligned_candidate','aligned_candidate','partially_aligned_candidate','misaligned_candidate','insufficient_data') then
    raise exception '허용되지 않는 alignment result(§5 — 5종)';
  end if;

  if p_action = 'mark_under_review' then v_next := 'under_review';
  elsif p_action = 'record_review_reference' then
    -- Self-Review 차단 + Evidence 필수(Alignment 판정 기록 — Mission 변경은 사람).
    if v_row.created_by = v_uid then raise exception 'Self-Review 차단(작성자 ≠ 평가자)'; end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Alignment Review Reference 금지';
    end if;
    v_next := 'review_reference_recorded'; v_note := ' (Review Reference ≠ 달성 확정 — Mission 변경은 사람)';
    v_ref := jsonb_build_object('action', p_action, 'reason', left(p_reason, 500), 'reviewed_by', v_uid, 'reviewed_at', now(),
      'alignment_is_not_achievement', true, 'mission_changed', false, 'kpi_changed', false, 'production_applied', false,
      'evidence', p_payload->'evidence');
    update public.ai_enterprise_objective_alignments set review_reference = v_ref, alignment_status = coalesce(v_result, alignment_status) where id = p_alignment_id;
  elsif p_action = 'request_revision' then v_next := 'revision_requested';
  else v_next := 'insufficient_data';
  end if;

  update public.ai_enterprise_objective_alignments set record_status = v_next, reviewed_by = v_uid, updated_at = now() where id = p_alignment_id;
  insert into public.ai_enterprise_mission_events (event_type, mission_id, objective_alignment_id, detail, payload, actor_id)
  values (case when p_action = 'record_review_reference' then 'objective_alignment_reference_recorded' else 'objective_alignment_reviewed' end,
    v_row.mission_id, p_alignment_id, left(p_reason, 200) || v_note, p_payload || jsonb_build_object('next_status', v_next), v_uid);
  return jsonb_build_object('ok', true, 'id', p_alignment_id, 'status', v_next, 'alignment_is_not_achievement', true, 'mission_changed', false, 'kpi_changed', false, 'production_applied', false, 'human_decision', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 7) Mission 이벤트 기록(통합) — 자동 Mission 변경 이벤트 생성 금지.
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_mission_event_record(p_kind text, p_reason text, p_payload jsonb, p_mission_id uuid default null, p_alignment_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid; v_id uuid; v_result text;
begin
  perform public._admin_growth_guard();
  v_uid := auth.uid();
  if p_kind not in ('strategic_objective_mapped','okr_mapped','initiative_alignment_reviewed','kpi_alignment_reviewed','portfolio_alignment_reviewed','organization_alignment_reviewed','value_alignment_reviewed','execution_alignment_reviewed','mission_alignment_reviewed','mission_drift_reviewed','strategic_outcome_reviewed','alignment_trend_reviewed','objective_coverage_reviewed','executive_mission_summary_recorded','executive_mission_scorecard_recorded','mission_recommendation_recorded','mission_review_requested','executive_review_requested','strategic_review_requested','mission_learning_recorded','portfolio_reference_linked','program_reference_linked','kpi_reference_linked','organization_reference_linked','value_reference_linked') then
    raise exception '허용되지 않는 kind(생성/Review 진행은 전용 RPC)';
  end if;
  if p_reason is null or btrim(p_reason) = '' then raise exception 'Reason 필수'; end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then raise exception 'payload(object) 필수'; end if;
  if pg_column_size(p_payload) > 65536 then raise exception 'payload 64KB 초과'; end if;
  perform public._runtime_reject_secret_payload(p_payload);
  if p_mission_id is not null and not exists (select 1 from public.ai_enterprise_missions where id = p_mission_id) then raise exception 'Mission 없음(실존 검증 실패)'; end if;
  if p_alignment_id is not null and not exists (select 1 from public.ai_enterprise_objective_alignments where id = p_alignment_id) then raise exception 'Objective Alignment 없음(실존 검증 실패)'; end if;
  v_result := coalesce(p_payload->>'result','');

  if p_kind = 'strategic_objective_mapped' and p_mission_id is not null then
    update public.ai_enterprise_missions set objective_mappings = objective_mappings || jsonb_build_array(p_payload), updated_at = now() where id = p_mission_id;
  end if;
  if p_kind = 'okr_mapped' and p_mission_id is not null then
    -- OKR Mapping ≠ OKR 자동 생성(기존 OKR 관측 매핑만).
    update public.ai_enterprise_missions set okr_mappings = okr_mappings || jsonb_build_array(p_payload), updated_at = now() where id = p_mission_id;
  end if;
  if p_kind in ('initiative_alignment_reviewed','kpi_alignment_reviewed','portfolio_alignment_reviewed','organization_alignment_reviewed','value_alignment_reviewed','execution_alignment_reviewed','mission_alignment_reviewed') then
    if v_result not in ('highly_aligned_candidate','aligned_candidate','partially_aligned_candidate','misaligned_candidate','insufficient_data') then raise exception '허용되지 않는 alignment result(§5 — 5종)'; end if;
    if p_mission_id is not null then
      if p_kind = 'initiative_alignment_reviewed' then update public.ai_enterprise_missions set initiative_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      elsif p_kind = 'kpi_alignment_reviewed' then update public.ai_enterprise_missions set kpi_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      elsif p_kind = 'portfolio_alignment_reviewed' then update public.ai_enterprise_missions set portfolio_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      elsif p_kind = 'organization_alignment_reviewed' then update public.ai_enterprise_missions set organization_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      elsif p_kind = 'value_alignment_reviewed' then update public.ai_enterprise_missions set value_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      elsif p_kind = 'execution_alignment_reviewed' then update public.ai_enterprise_missions set execution_alignment_result = p_payload, updated_at = now() where id = p_mission_id;
      else update public.ai_enterprise_missions set alignment_status = v_result, alignment_result = p_payload, alignment_history = alignment_history || jsonb_build_array(p_payload), updated_at = now() where id = p_mission_id;
      end if;
    end if;
  end if;
  if p_kind = 'mission_drift_reviewed' then
    if coalesce(p_payload->>'drift_dimension','') not in ('objective_drift','kpi_drift','portfolio_drift','execution_drift','organizational_drift') then
      raise exception '허용되지 않는 drift_dimension(§6 — 5종)';
    end if;
    if v_result not in ('stable_candidate','watch_candidate','drifting_candidate','critical_drift_candidate','insufficient_data') then raise exception '허용되지 않는 drift result(§6 — 5종)'; end if;
    if p_mission_id is not null then update public.ai_enterprise_missions set drift_status = v_result, drift_result = coalesce(drift_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'drift_dimension', p_payload), updated_at = now() where id = p_mission_id; end if;
  end if;
  if p_kind = 'strategic_outcome_reviewed' then
    if coalesce(p_payload->>'outcome_dimension','') not in ('mission_coverage','outcome_coverage','kpi_contribution','initiative_contribution','value_contribution') then
      raise exception '허용되지 않는 outcome_dimension(§7 — 5종)';
    end if;
    if v_result not in ('strongly_supported_candidate','adequately_supported_candidate','weakly_supported_candidate','unsupported_candidate','insufficient_data') then raise exception '허용되지 않는 outcome result(§7 — 5종)'; end if;
    if p_mission_id is not null then update public.ai_enterprise_missions set outcome_status = v_result, outcome_result = coalesce(outcome_result, '{}'::jsonb) || jsonb_build_object(p_payload->>'outcome_dimension', p_payload), updated_at = now() where id = p_mission_id; end if;
  end if;
  if p_kind = 'alignment_trend_reviewed' then
    if v_result not in ('improving_alignment_candidate','stable_alignment_candidate','declining_alignment_candidate','trend_unverified','insufficient_data') then raise exception '허용되지 않는 trend result'; end if;
    if p_mission_id is not null then update public.ai_enterprise_missions set trend_result = p_payload, updated_at = now() where id = p_mission_id; end if;
  end if;
  if p_kind = 'objective_coverage_reviewed' then
    if v_result not in ('full_coverage_candidate','partial_coverage_candidate','uncovered_objectives_candidate','coverage_unverified','insufficient_data') then raise exception '허용되지 않는 coverage result'; end if;
    if p_mission_id is not null then update public.ai_enterprise_missions set coverage_result = p_payload, updated_at = now() where id = p_mission_id; end if;
  end if;
  if p_kind = 'executive_mission_scorecard_recorded' and p_mission_id is not null then
    update public.ai_enterprise_missions set scorecard_result = p_payload, updated_at = now() where id = p_mission_id;
  end if;
  if p_kind = 'mission_recommendation_recorded' then
    if coalesce(p_payload->>'recommendation_type','') not in ('create_mission_model','map_strategic_objective','map_okr','review_initiative_alignment','review_kpi_alignment','review_portfolio_alignment','review_organization_alignment','review_value_alignment','review_execution_alignment','review_mission_alignment','review_mission_drift','review_strategic_outcome','review_alignment_trend','review_objective_coverage','create_objective_alignment','build_executive_mission_summary','build_executive_mission_scorecard','request_mission_review','request_executive_review','request_strategic_review','record_mission_learning','gather_more_evidence_candidate','insufficient_data') then
      raise exception '허용되지 않는 recommendation_type';
    end if;
    if p_payload->'evidence' is null or jsonb_typeof(p_payload->'evidence') <> 'array' or jsonb_array_length(p_payload->'evidence') = 0 then
      raise exception 'Evidence 없는 Mission Recommendation 금지';
    end if;
    if p_mission_id is not null then update public.ai_enterprise_missions set recommendation_candidate = p_payload, updated_at = now() where id = p_mission_id; end if;
  end if;
  if p_kind = 'mission_learning_recorded' and p_mission_id is not null then
    update public.ai_enterprise_missions set learning_references = learning_references || jsonb_build_array(p_payload), updated_at = now() where id = p_mission_id;
  end if;
  if p_kind = 'portfolio_reference_linked' and nullif(p_payload->>'investment_portfolio_id','') is not null
     and not exists (select 1 from public.ai_enterprise_investment_portfolios where id = (p_payload->>'investment_portfolio_id')::uuid) then
    raise exception 'Investment Portfolio 없음(실존 검증 실패)';
  end if;
  if p_kind = 'program_reference_linked' and nullif(p_payload->>'execution_program_id','') is not null
     and not exists (select 1 from public.ai_enterprise_execution_programs where id = (p_payload->>'execution_program_id')::uuid) then
    raise exception 'Execution Program 없음(실존 검증 실패)';
  end if;
  if p_kind = 'kpi_reference_linked' and nullif(p_payload->>'kpi_id','') is not null
     and not exists (select 1 from public.ai_enterprise_kpis where id = (p_payload->>'kpi_id')::uuid) then
    raise exception 'Enterprise KPI 없음(실존 검증 실패)';
  end if;
  if p_kind = 'organization_reference_linked' and nullif(p_payload->>'organization_model_id','') is not null
     and not exists (select 1 from public.ai_enterprise_organization_models where id = (p_payload->>'organization_model_id')::uuid) then
    raise exception 'Organization Model 없음(실존 검증 실패)';
  end if;
  if p_kind = 'value_reference_linked' and nullif(p_payload->>'business_value_id','') is not null
     and not exists (select 1 from public.ai_enterprise_business_values where id = (p_payload->>'business_value_id')::uuid) then
    raise exception 'Business Value 없음(실존 검증 실패)';
  end if;

  insert into public.ai_enterprise_mission_events (event_type, mission_id, objective_alignment_id, detail, payload, actor_id)
  values (p_kind, p_mission_id, p_alignment_id,
    left(p_reason, 200) || case
      when p_kind = 'strategic_objective_mapped' then ' (Objective Mapping ≠ Objective 확정)'
      when p_kind = 'okr_mapped' then ' (OKR Mapping ≠ OKR 자동 생성)'
      when p_kind = 'initiative_alignment_reviewed' then ' (Initiative Alignment ≠ 실행 보장)'
      when p_kind = 'kpi_alignment_reviewed' then ' (KPI Alignment ≠ KPI 변경)'
      when p_kind = 'portfolio_alignment_reviewed' then ' (Portfolio Alignment ≠ Portfolio 변경)'
      when p_kind = 'organization_alignment_reviewed' then ' (Organization Alignment ≠ 조직 변경)'
      when p_kind = 'value_alignment_reviewed' then ' (Value Alignment ≠ 가치 확정)'
      when p_kind = 'execution_alignment_reviewed' then ' (Execution Alignment ≠ 실행 지시)'
      when p_kind = 'mission_alignment_reviewed' then ' (Mission Alignment ≠ Mission Success)'
      when p_kind = 'mission_drift_reviewed' then ' (Mission Drift ≠ Organizational Failure)'
      when p_kind = 'strategic_outcome_reviewed' then ' (Strategic Outcome ≠ Business Success)'
      when p_kind = 'alignment_trend_reviewed' then ' (Trend ≠ Forecast 확정)'
      when p_kind = 'objective_coverage_reviewed' then ' (Coverage Candidate ≠ Objective 달성)'
      when p_kind = 'executive_mission_summary_recorded' then ' (Summary ≠ Mission 확정)'
      when p_kind = 'executive_mission_scorecard_recorded' then ' (Scorecard ≠ Executive Judgment)'
      when p_kind = 'mission_recommendation_recorded' then ' (Recommendation ≠ Decision)'
      when p_kind = 'mission_review_requested' then ' (Mission Review 요청 — Review ≠ Approval)'
      when p_kind = 'executive_review_requested' then ' (Executive Review 요청 — Review ≠ Approval)'
      when p_kind = 'strategic_review_requested' then ' (Strategic Review 요청 — Mission 변경은 사람)'
      when p_kind = 'mission_learning_recorded' then ' (Mission Learning ≠ 자동 Mission 변경)'
      when p_kind = 'portfolio_reference_linked' then ' (Portfolio Reference ≠ Portfolio 변경)'
      when p_kind = 'program_reference_linked' then ' (Program Reference ≠ 실행 승인)'
      when p_kind = 'kpi_reference_linked' then ' (KPI Reference ≠ KPI 변경)'
      when p_kind = 'organization_reference_linked' then ' (Organization Reference ≠ 조직 변경)'
      when p_kind = 'value_reference_linked' then ' (Value Reference ≠ 가치 확정)'
      else '' end,
    p_payload, v_uid)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'mission_changed', false, 'vision_changed', false, 'okr_generated', false, 'kpi_changed', false, 'strategy_changed', false, 'governance_changed', false, 'budget_changed', false, 'organization_changed', false, 'portfolio_changed', false, 'production_applied', false, 'human_review_required', true);
end $$;

-- ─────────────────────────────────────────────────────────────────────────
-- 8) 목록/Summary/Audit(읽기 전용).
-- ─────────────────────────────────────────────────────────────────────────
create or replace function public.admin_enterprise_missions_list(p_status text default null, p_category text default null, p_limit int default 100)
returns setof public.ai_enterprise_missions language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_missions
  where (p_status is null or mission_status = p_status)
    and (p_category is null or mission_category = p_category)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_objective_alignments_list(p_mission_id uuid default null, p_limit int default 100)
returns setof public.ai_enterprise_objective_alignments language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_objective_alignments
  where (p_mission_id is null or mission_id = p_mission_id)
  order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

create or replace function public.admin_enterprise_mission_intel_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare v jsonb;
begin
  perform public._admin_growth_guard();
  select jsonb_build_object(
    'missions', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_missions),
      'draft', (select count(*) from public.ai_enterprise_missions where mission_status = 'draft'),
      'candidate', (select count(*) from public.ai_enterprise_missions where mission_status = 'candidate'),
      'active', (select count(*) from public.ai_enterprise_missions where mission_status = 'active_reference'),
      'archived', (select count(*) from public.ai_enterprise_missions where mission_status = 'archived_reference'),
      'aligned', (select count(*) from public.ai_enterprise_missions where alignment_status in ('highly_aligned_candidate','aligned_candidate')),
      'misaligned', (select count(*) from public.ai_enterprise_missions where alignment_status in ('partially_aligned_candidate','misaligned_candidate')),
      'drifting', (select count(*) from public.ai_enterprise_missions where drift_status in ('drifting_candidate','critical_drift_candidate')),
      'strongly_supported', (select count(*) from public.ai_enterprise_missions where outcome_status = 'strongly_supported_candidate'),
      'unsupported', (select count(*) from public.ai_enterprise_missions where outcome_status in ('weakly_supported_candidate','unsupported_candidate')),
      'reviewed_references', (select count(*) from public.ai_enterprise_missions where review_reference is not null),
      'by_category', (select coalesce(jsonb_object_agg(mission_category, cnt), '{}'::jsonb) from (select mission_category, count(*) cnt from public.ai_enterprise_missions group by mission_category) t)
    ),
    'alignments', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_objective_alignments),
      'recorded', (select count(*) from public.ai_enterprise_objective_alignments where record_status = 'recorded'),
      'under_review', (select count(*) from public.ai_enterprise_objective_alignments where record_status = 'under_review'),
      'reference_recorded', (select count(*) from public.ai_enterprise_objective_alignments where record_status = 'review_reference_recorded'),
      'revision_requested', (select count(*) from public.ai_enterprise_objective_alignments where record_status = 'revision_requested'),
      'misaligned', (select count(*) from public.ai_enterprise_objective_alignments where alignment_status = 'misaligned_candidate'),
      'by_dimension', (select coalesce(jsonb_object_agg(alignment_dimension, cnt), '{}'::jsonb) from (select alignment_dimension, count(*) cnt from public.ai_enterprise_objective_alignments group by alignment_dimension) t)
    ),
    'mission_events', jsonb_build_object(
      'total', (select count(*) from public.ai_enterprise_mission_events),
      'objective_mappings', (select count(*) from public.ai_enterprise_mission_events where event_type = 'strategic_objective_mapped'),
      'okr_mappings', (select count(*) from public.ai_enterprise_mission_events where event_type = 'okr_mapped'),
      'initiative_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'initiative_alignment_reviewed'),
      'kpi_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'kpi_alignment_reviewed'),
      'portfolio_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'portfolio_alignment_reviewed'),
      'organization_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'organization_alignment_reviewed'),
      'value_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'value_alignment_reviewed'),
      'execution_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'execution_alignment_reviewed'),
      'mission_alignment_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_alignment_reviewed'),
      'drift_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_drift_reviewed'),
      'outcome_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'strategic_outcome_reviewed'),
      'trend_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'alignment_trend_reviewed'),
      'coverage_reviews', (select count(*) from public.ai_enterprise_mission_events where event_type = 'objective_coverage_reviewed'),
      'summaries', (select count(*) from public.ai_enterprise_mission_events where event_type = 'executive_mission_summary_recorded'),
      'scorecards', (select count(*) from public.ai_enterprise_mission_events where event_type = 'executive_mission_scorecard_recorded'),
      'recommendations', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_recommendation_recorded'),
      'mission_review_requests', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_review_requested'),
      'executive_review_requests', (select count(*) from public.ai_enterprise_mission_events where event_type = 'executive_review_requested'),
      'strategic_review_requests', (select count(*) from public.ai_enterprise_mission_events where event_type = 'strategic_review_requested'),
      'review_references', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_review_reference_recorded'),
      'learnings', (select count(*) from public.ai_enterprise_mission_events where event_type = 'mission_learning_recorded'),
      'kpi_links', (select count(*) from public.ai_enterprise_mission_events where event_type = 'kpi_reference_linked'),
      'portfolio_links', (select count(*) from public.ai_enterprise_mission_events where event_type = 'portfolio_reference_linked'),
      'organization_links', (select count(*) from public.ai_enterprise_mission_events where event_type = 'organization_reference_linked')
    ),
    -- Mission 원천 실측(전부 읽기 전용):
    'mission_actuals', jsonb_build_object(
      'strategy_portfolios_0545', (select count(*) from public.ai_enterprise_strategy_portfolios),
      'execution_programs_0547', (select count(*) from public.ai_enterprise_execution_programs),
      'enterprise_kpis_0548', (select count(*) from public.ai_enterprise_kpis),
      'business_values_0549', (select count(*) from public.ai_enterprise_business_values),
      'investment_portfolios_0550', (select count(*) from public.ai_enterprise_investment_portfolios),
      'governance_decisions_0551', (select count(*) from public.ai_enterprise_governance_decisions),
      'organization_models_0552', (select count(*) from public.ai_enterprise_organization_models),
      'knowledge_memories_0553', (select count(*) from public.ai_enterprise_knowledge_memories),
      'ai_reviews_0554', (select count(*) from public.ai_enterprise_ai_reviews),
      'decision_outcomes_0514', (select count(*) from public.ai_decision_outcomes),
      'execution_commitments_0520', (select count(*) from public.ai_execution_commitments),
      'corporate_visions_0524', (select count(*) from public.ai_corporate_vision_records),
      'corporate_objectives_0524', (select count(*) from public.ai_corporate_objectives)
    ),
    'mission_unavailable', jsonb_build_array('okr_system_feed','official_mission_charter_ledger','board_mission_minutes','employee_survey_feed','market_research_feed','esg_reporting_feed'),   -- 원본 없음(실측)
    'mission_alignment_is_not_mission_success', true, 'objective_alignment_is_not_achievement', true,
    'strategic_outcome_is_not_business_success', true, 'mission_drift_is_not_organizational_failure', true,
    'recommendation_is_not_decision', true, 'alignment_score_is_not_executive_judgment', true,
    'pattern_is_not_causality', true, 'forecast_is_not_future_fact', true, 'confidence_is_not_certainty', true,
    'no_auto_mission_change', true, 'no_auto_vision_change', true, 'no_auto_okr_generation', true,
    'no_auto_kpi_change', true, 'no_auto_strategy_change', true, 'no_auto_governance_change', true,
    'no_auto_budget_change', true, 'no_auto_organization_change', true, 'no_auto_portfolio_change', true, 'no_production_change', true,
    'generated_at', now()
  ) into v;
  return v;
end $$;

create or replace function public.admin_enterprise_mission_intel_audit(p_limit int default 100)
returns setof public.ai_enterprise_mission_events language plpgsql security definer set search_path = public as $$
begin
  perform public._admin_growth_guard();
  return query select * from public.ai_enterprise_mission_events order by created_at desc limit least(greatest(coalesce(p_limit, 100), 1), 500);
end $$;

-- RLS — service role/definer 경유만.
alter table public.ai_enterprise_missions enable row level security;
alter table public.ai_enterprise_objective_alignments enable row level security;
alter table public.ai_enterprise_mission_events enable row level security;

comment on table public.ai_enterprise_missions is 'AI-OPS-51 — Mission Model(≠ Mission 변경 원장·Category 14종·자동 Mission/Vision/OKR 변경 차단·Alignment ≠ Mission Success).';
comment on table public.ai_enterprise_objective_alignments is 'AI-OPS-51 — Objective Alignment(§5 6차원·Evidence 필수·Self-Review 차단·Alignment ≠ Achievement).';
comment on table public.ai_enterprise_mission_events is 'AI-OPS-51 — Mission 이벤트 31종(자동 Mission 변경 이벤트 생성 금지·Mission Drift ≠ Organizational Failure).';
